'use strict'

const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')

const AUTH_PAUSED = false

// â”€â”€ Database â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const { getDb }                  = require('./core/db-manager')

// â”€â”€ Auth â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const { controllaSessione, getUtenteCorrente } = require('./core/auth')

// ── Sync (facoltativo: richiede .env con SUPABASE_URL e SUPABASE_KEY) ─────────
let supabase = null
let avviaSyncAutomatica = null
let controllaConnessione = null
let syncCoda = null
let syncIntervalId = null
try {
  supabase = require('./core/supabase')
  ;({ avviaSyncAutomatica, controllaConnessione, syncCoda } = require('./core/sync'))
} catch (err) {
  console.warn('[Main] Sync Supabase non disponibile:', err.message)
}

// â”€â”€ IPC handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const { registerAuthIpcHandlers }      = require('./ipc/auth.ipc')
const { registerMenuIpcHandlers }      = require('./ipc/menu.ipc')
const { registerMagazzinoIpcHandlers } = require('./ipc/magazzino.ipc')
const { registerRicetteIpcHandlers }   = require('./ipc/ricette.ipc')
const { registerOrdiniIpcHandlers }    = require('./ipc/ordini.ipc')
const { registerFoodcostIpcHandlers }  = require('./ipc/foodcost.ipc')
const { registerPersonaleIpcHandlers } = require('./ipc/personale.ipc')

// â”€â”€ Window factory â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1a1a1a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })
  return win
}

// â”€â”€ App ready â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.whenReady().then(async () => {
  // 1. Inizializza database (createTables viene chiamato internamente da getDb)
  const db = getDb()
  console.log('[DB] Database pronto:', db.name || 'ristorante.db')

  // 2. Registra tutti gli IPC handler
  registerAuthIpcHandlers()
  registerMenuIpcHandlers()
  registerMagazzinoIpcHandlers()
  registerRicetteIpcHandlers()
  registerOrdiniIpcHandlers()
  registerFoodcostIpcHandlers()
  registerPersonaleIpcHandlers()

  // ── Sync IPC handlers ──────────────────────────────────────────────────────
  ipcMain.removeHandler('sync-ping')
  ipcMain.handle('sync-ping', async () => {
    if (controllaConnessione) return controllaConnessione()
    return false
  })

  ipcMain.removeHandler('get-stato-connessione')
  ipcMain.handle('get-stato-connessione', async () => {
    if (controllaConnessione) return controllaConnessione()
    return false
  })

  ipcMain.removeHandler('sync-manuale')
  ipcMain.handle('sync-manuale', async () => {
    if (!syncCoda || !supabase) return { processed: 0, synced: 0, failed: 0 }
    const utente = getUtenteCorrente()
    if (!utente?.id) return { processed: 0, synced: 0, failed: 0 }
    try {
      return await syncCoda(db, supabase, utente.id)
    } catch (err) {
      console.error('[Sync] Errore sync manuale:', err.message)
      return { processed: 0, synced: 0, failed: 0, error: err.message }
    }
  })

  ipcMain.removeHandler('avvia-sync-automatica')
  ipcMain.handle('avvia-sync-automatica', () => {
    if (!avviaSyncAutomatica || !supabase) return
    if (syncIntervalId) clearInterval(syncIntervalId)
    const utente = getUtenteCorrente()
    if (utente?.id) {
      syncIntervalId = avviaSyncAutomatica(db, supabase, utente.id)
      console.log('[Sync] Sync automatica avviata/riavviata per utente:', utente.id)
    }
  })

  // 3. Crea la finestra 1400Ã—900 con preload
  const win = createWindow()
  win.webContents.on('console-message', (_e, level, msg) => {
    if (level >= 2) console.log(`[Renderer] ${msg}`)
  })
  // 4. Login temporaneamente in pausa: apre direttamente la shell app.
  if (AUTH_PAUSED) {
    win.loadFile('index.html')
  } else {
    // 4. Controlla la sessione salvata â†’ app o schermata login
    let sessioneValida = false
    try {
      sessioneValida = await controllaSessione()
    } catch (err) {
      console.error('[Auth] Errore controllo sessione:', err.message)
    }

    if (sessioneValida) {
      win.loadFile('index.html')

      // 5. Avvia sync automatica dopo il caricamento (solo se Supabase Ã¨ configurato)
      if (avviaSyncAutomatica && supabase) {
        win.webContents.once('did-finish-load', () => {
          try {
            const utente = getUtenteCorrente()
            if (utente?.id) {
              syncIntervalId = avviaSyncAutomatica(db, supabase, utente.id)
              console.log('[Sync] Sync automatica avviata per utente:', utente.id)
            }
          } catch (err) {
            console.error('[Sync] Avvio sync fallito:', err.message)
          }
        })
      }
    } else {
      // Carica index.html con hash #login: il renderer gestirÃ  la schermata di login
      win.loadFile('index.html', { hash: 'login' })
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
