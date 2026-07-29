# Pubblicazione su Microsoft Store

Checklist dei passaggi necessari per pubblicare Ristorante Pro come app desktop
sul Microsoft Store (pacchetto AppX/MSIX), da eseguire nell'ordine indicato.

## 1. Configurazione appx in `package.json`

- [ ] Verificare che `build.win.target` includa `"appx"` insieme a `"nsis"` (già presente).
- [ ] Compilare il blocco `build.appx` in [package.json](package.json) sostituendo i placeholder con i valori reali:
  - `identityName` → nome riservato su Partner Center (vedi punto 3).
  - `publisher` → CN (Common Name) del publisher fornito da Partner Center.
  - `publisherDisplayName` → nome editore visualizzato, come registrato su Partner Center.
  - `applicationId` → può restare `RistorantePro` se non richiesto diversamente da Partner Center.
- [ ] Confermare che `version` in [package.json](package.json) sia in formato semver a 3 parti (es. `1.0.0`): electron-builder aggiunge automaticamente una 4ª parte (`.0`) per generare la versione MSIX richiesta da AppX. Non serve intervenire manualmente su questo, salvo esigenze particolari di versionamento.

## 2. Generazione icone Store

- [ ] Procurarsi un'immagine sorgente PNG ad alta risoluzione (idealmente ≥ 310x310px, sfondo trasparente o pieno a seconda del design scelto).
- [ ] Posizionarla come `assets/images/icon-source.png` (default) oppure passarla come argomento allo script.
- [ ] Eseguire `npm run generate-icons` (vedi [scripts/generate-store-icons.js](scripts/generate-store-icons.js)) per generare i tile richiesti (44x44, 71x71, 150x150, 310x150, 310x310) in `assets/images/store/`.
- [ ] Verificare visivamente i tile generati prima di procedere con il build.

## 3. Riserva nome su Microsoft Partner Center

- [ ] Accedere a [Microsoft Partner Center](https://partner.microsoft.com/) con un account sviluppatore registrato.
- [ ] Riservare il nome dell'app (App name) nella sezione dedicata alla creazione di una nuova submission.
- [ ] Annotare i valori generati da Partner Center necessari per il manifest: `Package/Identity/Name`, `Publisher` (CN) e `Publisher Display Name`.
- [ ] Riportare questi valori nel blocco `build.appx` di [package.json](package.json) (punto 1) e nel `Package.appxmanifest` (punto 4).

## 4. Compilazione `Package.appxmanifest`

- [ ] Se electron-builder non genera automaticamente un manifest sufficiente per la submission (es. per personalizzazioni avanzate: capabilities, associazioni file, splash screen dedicato), creare/aggiornare un `Package.appxmanifest` con i valori di identity ottenuti da Partner Center:
  - `Identity Name`, `Publisher`, `Version` (4 parti).
  - `Properties/DisplayName`, `Properties/PublisherDisplayName`.
  - Riferimenti alle icone generate al punto 2 (`Square44x44Logo`, `Square71x71Logo`, `Square150x150Logo`, `Wide310x150Logo`, `Square310x310Logo`).
- [ ] Verificare coerenza tra i valori del manifest e quelli configurati in `build.appx` di [package.json](package.json).

## 5. Verifica `.env.production` con chiavi Supabase di produzione

- [ ] Aprire [config/.env.production](config/.env.production) e confermare che contenga le chiavi Supabase dell'ambiente di **produzione** (non quelle di sviluppo/staging).
- [ ] Verificare che `extraResources` in [package.json](package.json) copi correttamente questo file come `.env` nelle risorse dell'app in fase di build.
- [ ] Non committare mai chiavi di produzione reali in chiaro nel repository pubblico, se applicabile.

## 6. Build su macchina Windows con Windows SDK

- [ ] Eseguire il build su una macchina Windows (non cross-compilazione), con **Windows SDK** installato (richiesto da electron-builder per firmare/pacchettizzare il target `appx`).
- [ ] Lanciare `npm install` per assicurarsi che le dipendenze (incluso `better-sqlite3` ricompilato via `postinstall`) siano aggiornate.
- [ ] Lanciare `npm run build` per generare sia l'installer NSIS che il pacchetto AppX in `dist/`.
- [ ] Verificare che il file `.appx`/`.msix` sia stato generato correttamente in `dist/` senza errori nel log di electron-builder.

## 7. Verifica con Windows App Certification Kit (WACK)

- [ ] Installare il **Windows App Certification Kit** (incluso nell'SDK di Windows o disponibile separatamente).
- [ ] Eseguire WACK sul pacchetto `.appx`/`.msix` generato al punto 6.
- [ ] Correggere eventuali problemi segnalati (performance, sicurezza, compatibilità, manifest) prima di procedere con la submission.
- [ ] Conservare il report di certificazione come riferimento in caso di problemi in fase di revisione da parte di Microsoft.

## 8. Submission e questionario età/contenuti su Partner Center

- [ ] Accedere a Partner Center e creare una nuova submission per l'app riservata al punto 3.
- [ ] Caricare il pacchetto `.appx`/`.msix` verificato con WACK.
- [ ] Compilare le informazioni di store listing: descrizione, screenshot, categoria, prezzo/disponibilità.
- [ ] Completare il **questionario su età e contenuti** (age ratings / content questionnaire) richiesto da Partner Center per la classificazione dell'app.
- [ ] Compilare eventuali dichiarazioni sulla privacy, collegando la pagina [web/privacy.html](web/privacy.html) come informativa privacy pubblica (verificare che il contatto `TODO-email-supporto` sia stato sostituito con un indirizzo reale prima della submission).
- [ ] Inviare la submission per la revisione Microsoft e monitorare lo stato da Partner Center.

---

**Nota:** questa checklist copre i passaggi operativi noti al momento della stesura. Prima di ogni submission, verificare sulla documentazione ufficiale Microsoft Partner Center eventuali requisiti aggiornati (policy, formati pacchetto, questionari) che potrebbero cambiare nel tempo.
