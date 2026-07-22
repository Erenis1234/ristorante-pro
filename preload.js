'use strict'

const { contextBridge, ipcRenderer } = require('electron')

// Invoca un canale IPC passando gli argomenti direttamente.
// Gli errori lanciati nel main process vengono propagati come rejection.
function call(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args).catch(err => {
    console.error(`[IPC Error] Channel: ${channel}`, err)
    throw err
  })
}

contextBridge.exposeInMainWorld('api', {

  // ── AUTH ──────────────────────────────────────────────────────────────────
  auth: {
    login:             (email, password) => call('ipc-login', email, password),
    registrati:        (email, password) => call('ipc-registrati', email, password),
    logout:            ()                => call('ipc-logout'),
    recuperaPassword:  (email)           => call('ipc-recupera-password', email),
    getUtenteCorrente: ()                => call('ipc-utente-corrente'),
    controllaSessione: ()                => call('ipc-controlla-sessione'),
  },

  // ── MENU ──────────────────────────────────────────────────────────────────
  menu: {
    getCategorie:      ()     => call('get-categorie'),
    addCategoria:      (dati) => call('add-categoria', dati),
    updateCategoria:   (dati) => call('update-categoria', dati),
    deleteCategoria:   (id)   => call('delete-categoria', id),
    getPiatti:         ()     => call('get-piatti'),
    addPiatto:         (dati) => call('add-piatto', dati),
    updatePiatto:      (dati) => call('update-piatto', dati),
    deletePiatto:      (id)   => call('delete-piatto', id),
    toggleDisponibile: (id)   => call('toggle-disponibile-piatto', id),
  },

  // ── MAGAZZINO ─────────────────────────────────────────────────────────────
  magazzino: {
    getIngredienti:    ()     => call('get-ingredienti'),
    addIngrediente:    (dati) => call('add-ingrediente', dati),
    updateIngrediente: (dati) => call('update-ingrediente', dati),
    deleteIngrediente: (id)   => call('delete-ingrediente', id),
    getScorteBasse:    ()     => call('get-scorte-basse'),
    getInScadenza:     ()     => call('get-in-scadenza'),
    addMovimento:      (dati) => call('add-movimento', dati),
  },

  // ── RICETTE ───────────────────────────────────────────────────────────────
  ricette: {
    getRicette:          ()     => call('get-ricette'),
    addRicetta:          (dati) => call('add-ricetta', dati),
    updateRicetta:       (dati) => call('update-ricetta', dati),
    deleteRicetta:       (id)   => call('delete-ricetta', id),
    getRicettaDettaglio: (id)   => call('get-ricetta-dettaglio', id),
  },

  // ── MENU BUILDER ──────────────────────────────────────────────────────────
  menuBuilder: {
    getMenu:          ()     => call('get-menu'),
    addMenu:          (dati) => call('add-menu', dati),
    updateMenu:       (dati) => call('update-menu', dati),
    deleteMenu:       (id)   => call('delete-menu', id),
    getMenuDettaglio: (id)   => call('get-menu-dettaglio', id),
  },

  // ── ORDINI FORNITORI ──────────────────────────────────────────────────────
  ordini: {
    getOrdiniFornitori: ()              => call('get-ordini-fornitori'),
    addOrdineFornitore: (dati)          => call('add-ordine-fornitore', dati),
    updateStatoOrdine:  (id, stato)     => call('update-stato-ordine', id, stato),
    deleteOrdine:       (id)            => call('delete-ordine', id),
    riceviOrdine:       (id)            => call('ricevi-ordine', id),
  },

  // ── FOOD COST ─────────────────────────────────────────────────────────────
  foodcost: {
    getFoodcostTutti:         ()                  => call('get-foodcost-tutti'),
    getFoodcostRicetta:       (ricettaId)         => call('get-foodcost-ricetta', ricettaId),
    simulaPrezzo:             (ricettaId, prezzo) => call('simula-prezzo', ricettaId, prezzo),
    salvaSimulazione:         (dati)              => call('salva-simulazione-foodcost', dati),
  },

  // ── PERSONALE ─────────────────────────────────────────────────────────────
  personale: {
    getPersonale:       ()            => call('get-personale'),
    addDipendente:      (dati)        => call('add-dipendente', dati),
    updateDipendente:   (dati)        => call('update-dipendente', dati),
    toggleAttivo:       (id)          => call('toggle-attivo-dipendente', id),
    getTurniSettimana:  (data)        => call('get-turni-settimana', data),
    addTurno:           (dati)        => call('add-turno', dati),
    updateTurno:        (dati)        => call('update-turno', dati),
    deleteTurno:        (id)          => call('delete-turno', id),
    getTurniDipendente: (personaleId) => call('get-turni-dipendente', personaleId),
  },

  // ── SYNC ──────────────────────────────────────────────────────────────────
  sync: {
    ping:                () => call('sync-ping'),
    getStatoConnessione: () => call('get-stato-connessione'),
    syncManuale:         () => call('sync-manuale'),
    avviaAuto:           () => call('avvia-sync-automatica'),
  },
})
