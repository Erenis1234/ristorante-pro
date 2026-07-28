# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Comandi

- `npm start` — avvia l'app Electron in locale (`electron .`)
- `npm test` — esegue i test con il test runner nativo di Node (`node --test`), nessuna dipendenza aggiuntiva. Copertura minima su `core/db-manager.js` in `core/db-manager.test.js` (isolamento per `user_id`, upsert, validazione nome tabella, coda_sync)
- `npm run build` — build Windows (NSIS) con electron-builder, output in `dist/`
- `npm run postinstall` — ricompila `better-sqlite3` per Electron (`electron-rebuild`), gira automaticamente dopo `npm install`

Stato attuale del repo, utile da sapere prima di proporre comandi che non esistono:
- `eslint` è tra le devDependencies ma non c'è nessun file di configurazione (`.eslintrc*`, `eslint.config.*`) né uno script `lint` in `package.json`.
- Il progetto è sotto controllo di versione Git (branch `master`), con `.gitignore` che esclude `.env`, `node_modules/`, `dist/` e i file `*.db`.

## Struttura cartelle

Il codice sorgente è organizzato per responsabilità:
- `electron/` — entry point Electron: `main.js` (main process) e `preload.js` (contextBridge)
- `assets/js/` — `renderer.js` e `components/*.js` (modal, toast, confirm, table)
- `assets/css/` — `style.css` (entry point con gli `@import`) e i moduli `base/login/layout/components/utilities.css`
- `assets/images/` — icone statiche (`icon.ico`)
- `pages/` — una IIFE per pagina (`window.pages.<nome>`)
- `ipc/`, `core/`, `database/` — invariati (vedi sezioni sotto)
- `config/` — `.env.production`, copiato come `.env` nelle risorse dell'app da electron-builder in fase di build

`index.html` e `package.json` restano nella root (richiesto da Electron/npm), così come `.env`/`supabaseClient.js` (i percorsi di risoluzione di `dotenv` in `core/crypto-utils.js` e `supabaseClient.js` assumono che questi file restino a livello radice).

## Architettura

### Processo main / renderer (Electron)
`electron/main.js` è l'entry point: inizializza il DB (`core/db-manager.js`), registra tutti gli IPC handler (`ipc/*.ipc.js`), controlla la sessione salvata e carica `index.html` (con hash `#login` se non autenticato).

`electron/preload.js` espone `window.api` al renderer via `contextBridge` (context isolation attiva, `nodeIntegration: false`). Ogni dominio ha un proprio namespace — `window.api.menuBuilder`, `.magazzino`, `.ricette`, `.ordini`, `.foodcost`, `.personale`, `.auth`, `.sync` — mappato 1:1 sui canali IPC registrati nei rispettivi `ipc/*.ipc.js`.

Il frontend è JS vanilla, senza bundler né framework: `index.html` carica in sequenza `assets/js/components/*.js`, poi `pages/*.js`, poi `assets/js/renderer.js` con `<script>` tag classici. Ogni file in `pages/` è una IIFE che si registra su `window.pages.<nome> = { render, initEvents, load }`; `assets/js/renderer.js` (funzione `caricaPagina`) decide quale pagina mostrare in base alla sidebar.

### Livello dati condiviso: `core/db-manager.js`
Quasi tutti gli IPC handler passano da quattro funzioni generiche: `salva(tabella, dati, userId)`, `leggi(tabella, userId)`, `leggiPerId(tabella, id, userId)`, `elimina(tabella, id, userId)`. Costruiscono SQL dinamicamente in base al nome tabella (validato solo con una regex, non con whitelist) e ai campi presenti nell'oggetto `dati`. Una modifica a questo file (o a `database/schema.js`) si ripercuote potenzialmente su **tutti** i moduli — menu, magazzino, ricette, ordini fornitori, food cost, personale — contemporaneamente. È il punto con la più alta probabilità che un fix in un modulo rompa un altro modulo apparentemente scollegato.

Convenzioni da conoscere prima di toccarlo:
- Ogni tabella ha una colonna `user_id`; le letture filtrano con `WHERE user_id = ? OR user_id IS NULL` (righe con `user_id IS NULL` = dati condivisi/seed visibili a tutti).
- `salva()` fa upsert (INSERT se manca `id`, UPDATE se presente e di proprietà dell'utente) e in più accoda la sincronizzazione verso Supabase.
- Operazioni multi-tabella — `addMovimento` in `ipc/magazzino.ipc.js`, `syncRigheOrdine` in `ipc/ordini.ipc.js`, `saveRecipeIngredients` in `ipc/ricette.ipc.js`, `salvaSimulazioneFoodcost` in `ipc/foodcost.ipc.js`, `syncVociMenu` in `ipc/menu-builder.ipc.js` — sono avvolte in `db.transaction()` per garantire atomicità tra le tabelle coinvolte. Dentro una transazione si usano le varianti sincrone `dbManager.salvaLocale`/`dbManager.eliminaLocale` (mai `salva`/`elimina`, che sono `async` e tentano subito la sync remota: incompatibili con `db.transaction()`, che richiede una funzione sincrona). `salvaLocale`/`eliminaLocale` scrivono solo in locale e accodano sempre la riga in `coda_sync`, sincronizzata poi dal worker periodico o dalla sync manuale.
- Alcune colonne sono `GENERATED ALWAYS AS (...) STORED` (es. `totale` in `ordine_fornitore_righe`): non vanno mai incluse nel payload passato a `salva()`, altrimenti SQLite rifiuta la query.

### Sync locale-cloud (opzionale)
Il DB primario è SQLite locale (`better-sqlite3`, file in `app.getPath('userData')/ristorante.db`). Supabase (`core/supabase.js` → `supabaseClient.js`, richiede `.env` con le credenziali del progetto) è opzionale: se il modulo o le credenziali mancano, l'app resta in modalità locale senza errori bloccanti.

Ogni scrittura tenta la sync immediata verso Supabase; se offline o se fallisce, l'operazione finisce nella tabella `coda_sync` (stato `pending`/`error`, contatore tentativi). `core/sync.js` (`syncCoda`) processa la coda confrontando `updated_at` locale/remoto (last-write-wins) e viene richiamato sia manualmente (canale `sync-manuale`) sia automaticamente ogni 30s (`avviaSyncAutomatica`, avviato da `electron/main.js` dopo il login). Il controllo di connessione è stato reso affidabile usando `supabase.auth.getSession()` con timeout e log di diagnostica dettagliati: URL Supabase, presenza della `ANON KEY`, risultato della connessione, codice errore, messaggio completo e stack trace. In caso di errore il diagnostico segnala anche il file/riga dove il problema è stato rilevato.

### Autenticazione
`core/auth.js` prova prima Supabase Auth (`signInWithPassword`); se non disponibile o se fallisce con un errore non-HTTP, fa fallback su utenti locali salvati in SQLite (tabella `utenti_locali`, password con `scrypt` + salt, confronto con `timingSafeEqual`). La sessione (locale o Supabase) è sempre persistita nella tabella `auth_session` (riga singola, `id = 1`) e riletta ad ogni avvio da `controllaSessione()`.

### UI / renderer
Il renderer usa `assets/js/renderer.js` e `index.html` per gestire topbar, sidebar, menu profilo e caricamento delle pagine. Il menu profilo deve essere chiuso in modo esplicito su click esterno, pressione di `Esc`, cambio pagina e logout; eventuali refactor devono preservare questo comportamento per evitare che il menu resti visibile erroneamente.

### Attenzione all'omonimia "ordini"
La pagina e l'handler chiamati "ordini" (`pages/ordini.js`, `ipc/ordini.ipc.js`) gestiscono gli **ordini ai fornitori** (`ordini_fornitori`/`ordine_fornitore_righe`), non ordini al tavolo/asporto — quella funzionalità non esiste nell'app (le vecchie tabelle `ordini`/`ordine_righe` e i moduli `core/menu-service.js`, `menu-reader.js`, `menu-writer.js` erano residui morti di un'iterazione precedente e sono stati rimossi).

### Schema dati (`database/schema.js`)
Tabelle principali: `ingredienti`, `ricette` (include `categoria` — una delle 5 categorie fisse antipasto/primo/secondo/dolce/salsa usate anche per raggruppare la vista in `pages/ricette.js` — `foto`, immagine caricata come stringa base64/data URL, e `prezzo_vendita`, usato da `ipc/foodcost.ipc.js` come prezzo di riferimento per il calcolo del margine) + `ricetta_ingredienti` (`ingrediente_id` nullable: collegato a `ingredienti` per il costo food cost via `prezzo_kg`, oppure testo libero in `nome` se l'ingrediente non è a catalogo — esplicitamente indipendenti dal magazzino per il modulo ricette, vedi commento in cima a `ricette.ipc.js`, ma referenziati da `ipc/foodcost.ipc.js` per il calcolo costi), `menu` (`nome`, `tipo` — `giornaliero`/`settimanale` — `descrizione`) + `menu_voci` (righe libere del menu: `nome`, `prezzo`, `ordine`; **non** collegate da FK a `ricette`, sono uno snapshot testuale scelto al momento della composizione), `personale` + `turni`, `ordini_fornitori` + `ordine_fornitore_righe`, `movimenti_magazzino`, `utenti_locali`, `auth_session`, `coda_sync`. Le migrazioni per DB già esistenti sono funzioni `_migrate*` in coda a `createTables()`, eseguite a ogni avvio in modo idempotente (controllano `pragma('table_info(...)')` prima di alterare lo schema).

Le tabelle `categorie`, `piatti` e `piatto_ingredienti` (insieme a `ipc/menu.ipc.js`, namespace `window.api.menu`, e `database/seed.js`) sono state rimosse: erano residui non più referenziati da alcun modulo attivo dopo la migrazione del food cost su `ricette`. La rimozione ha toccato solo `database/schema.js` (le `CREATE TABLE IF NOT EXISTS` non vengono più eseguite per i nuovi database) e non include una migrazione di `DROP TABLE`: eventuali database SQLite locali già esistenti mantengono quelle tabelle vuote/orfane sul disco, senza impatto funzionale. La tabella Supabase equivalente in `database/migrations/20260401_initial_schema.sql` non è stata toccata, essendo lo storico di una migrazione già applicata al progetto remoto.
