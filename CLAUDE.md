# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Comandi

- `npm start` — avvia l'app Electron in locale (`electron .`)
- `npm run build` — build Windows (NSIS) con electron-builder, output in `dist/`
- `npm run postinstall` — ricompila `better-sqlite3` per Electron (`electron-rebuild`), gira automaticamente dopo `npm install`

Stato attuale del repo, utile da sapere prima di proporre comandi che non esistono:
- Nessuno script di test (`npm test` non è definito, non ci sono file `*.test.js` nel progetto).
- `eslint` è tra le devDependencies ma non c'è nessun file di configurazione (`.eslintrc*`, `eslint.config.*`) né uno script `lint` in `package.json`.
- Il progetto è sotto controllo di versione Git (branch `master`), con `.gitignore` che esclude `.env`, `node_modules/`, `dist/` e i file `*.db`.

## Architettura

### Processo main / renderer (Electron)
`main.js` è l'entry point: inizializza il DB (`core/db-manager.js`), registra tutti gli IPC handler (`ipc/*.ipc.js`), controlla la sessione salvata e carica `index.html` (con hash `#login` se non autenticato).

`preload.js` espone `window.api` al renderer via `contextBridge` (context isolation attiva, `nodeIntegration: false`). Ogni dominio ha un proprio namespace — `window.api.menu`, `.magazzino`, `.ricette`, `.ordini`, `.foodcost`, `.personale`, `.auth`, `.sync` — mappato 1:1 sui canali IPC registrati nei rispettivi `ipc/*.ipc.js`.

Il frontend è JS vanilla, senza bundler né framework: `index.html` carica in sequenza `components/*.js`, poi `pages/*.js`, poi `renderer.js` con `<script>` tag classici. Ogni file in `pages/` è una IIFE che si registra su `window.pages.<nome> = { render, initEvents, load }`; `renderer.js` (funzione `caricaPagina`) decide quale pagina mostrare in base alla sidebar.

### Livello dati condiviso: `core/db-manager.js`
Quasi tutti gli IPC handler passano da quattro funzioni generiche: `salva(tabella, dati, userId)`, `leggi(tabella, userId)`, `leggiPerId(tabella, id, userId)`, `elimina(tabella, id, userId)`. Costruiscono SQL dinamicamente in base al nome tabella (validato solo con una regex, non con whitelist) e ai campi presenti nell'oggetto `dati`. Una modifica a questo file (o a `database/schema.js`) si ripercuote potenzialmente su **tutti** i moduli — menu, magazzino, ricette, ordini fornitori, food cost, personale — contemporaneamente. È il punto con la più alta probabilità che un fix in un modulo rompa un altro modulo apparentemente scollegato.

Convenzioni da conoscere prima di toccarlo:
- Ogni tabella ha una colonna `user_id`; le letture filtrano con `WHERE user_id = ? OR user_id IS NULL` (righe con `user_id IS NULL` = dati condivisi/seed visibili a tutti).
- `salva()` fa upsert (INSERT se manca `id`, UPDATE se presente e di proprietà dell'utente) e in più accoda la sincronizzazione verso Supabase.
- Operazioni multi-tabella — `addMovimento` in `ipc/magazzino.ipc.js`, `syncRigheOrdine` in `ipc/ordini.ipc.js`, `saveRecipeIngredients` in `ipc/ricette.ipc.js`, `salvaSimulazioneFoodcost` in `ipc/foodcost.ipc.js` — sono avvolte in `db.transaction()` per garantire atomicità tra le tabelle coinvolte. Dentro una transazione si usano le varianti sincrone `dbManager.salvaLocale`/`dbManager.eliminaLocale` (mai `salva`/`elimina`, che sono `async` e tentano subito la sync remota: incompatibili con `db.transaction()`, che richiede una funzione sincrona). `salvaLocale`/`eliminaLocale` scrivono solo in locale e accodano sempre la riga in `coda_sync`, sincronizzata poi dal worker periodico o dalla sync manuale.
- Alcune colonne sono `GENERATED ALWAYS AS (...) STORED` (es. `totale` in `ordine_fornitore_righe`): non vanno mai incluse nel payload passato a `salva()`, altrimenti SQLite rifiuta la query.

### Sync locale-cloud (opzionale)
Il DB primario è SQLite locale (`better-sqlite3`, file in `app.getPath('userData')/ristorante.db`). Supabase (`core/supabase.js` → `supabaseClient.js`, richiede `.env` con le credenziali del progetto) è opzionale: se il modulo o le credenziali mancano, l'app resta in modalità locale senza errori bloccanti.

Ogni scrittura tenta la sync immediata verso Supabase; se offline o se fallisce, l'operazione finisce nella tabella `coda_sync` (stato `pending`/`error`, contatore tentativi). `core/sync.js` (`syncCoda`) processa la coda confrontando `updated_at` locale/remoto (last-write-wins) e viene richiamato sia manualmente (canale `sync-manuale`) sia automaticamente ogni 30s (`avviaSyncAutomatica`, avviato da `main.js` dopo il login). Il controllo di connessione (`dns.lookup('google.com')`) è duplicato sia in `db-manager.js` (`haInternet`) che in `sync.js` (`controllaConnessione`).

### Autenticazione
`core/auth.js` prova prima Supabase Auth (`signInWithPassword`); se non disponibile o se fallisce con un errore non-HTTP, fa fallback su utenti locali salvati in SQLite (tabella `utenti_locali`, password con `scrypt` + salt, confronto con `timingSafeEqual`). La sessione (locale o Supabase) è sempre persistita nella tabella `auth_session` (riga singola, `id = 1`) e riletta ad ogni avvio da `controllaSessione()`.

### Attenzione all'omonimia "ordini"
La pagina e l'handler chiamati "ordini" (`pages/ordini.js`, `ipc/ordini.ipc.js`) gestiscono gli **ordini ai fornitori** (`ordini_fornitori`/`ordine_fornitore_righe`), non ordini al tavolo/asporto — quella funzionalità non esiste nell'app (le vecchie tabelle `ordini`/`ordine_righe` e i moduli `core/menu-service.js`, `menu-reader.js`, `menu-writer.js` erano residui morti di un'iterazione precedente e sono stati rimossi).

### Schema dati (`database/schema.js`)
Tabelle principali: `categorie`, `piatti`, `ingredienti`, `piatto_ingredienti` (composizione piatto per il food cost), `ricette` + `ricetta_ingredienti` (ricette di preparazione interna, esplicitamente indipendenti dal magazzino — vedi commento in cima a `ricette.ipc.js`), `personale` + `turni`, `ordini_fornitori` + `ordine_fornitore_righe`, `movimenti_magazzino`, `utenti_locali`, `auth_session`, `coda_sync`. Le migrazioni per DB già esistenti sono funzioni `_migrate*` in coda a `createTables()`, eseguite a ogni avvio in modo idempotente (controllano `pragma('table_info(...)')` prima di alterare lo schema).
