'use strict'

const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')

const AUTH_PAUSED = false
const INDEX_HTML_PATH = path.join(__dirname, '..', 'index.html')
const DEEP_LINK_PROTOCOL = 'ristorantepro'
let mainWindow = null
let pendingPasswordRecoveryLink = extractDeepLinkFromArgv(process.argv)

function extractDeepLinkFromArgv(argv) {
  return (argv || []).find((value) =>
    typeof value === 'string' && value.startsWith(`${DEEP_LINK_PROTOCOL}://`)
  ) || null
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }

  mainWindow.show()
  mainWindow.focus()
}

function deliverPendingPasswordRecoveryLink() {
  if (!pendingPasswordRecoveryLink || !mainWindow || mainWindow.isDestroyed()) {
    return
  }

  mainWindow.webContents.send('auth:password-recovery-link', pendingPasswordRecoveryLink)
  pendingPasswordRecoveryLink = null
}

function routePasswordRecoveryLink(recoveryUrl) {
  if (!recoveryUrl) {
    return
  }

  pendingPasswordRecoveryLink = recoveryUrl
  focusMainWindow()

  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoading()) {
    deliverPendingPasswordRecoveryLink()
  }
}

function registerDeepLinkProtocol() {
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL, process.execPath, [
      path.resolve(process.argv[1]),
    ])
    return
  }

  app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL)
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, commandLine) => {
    const deepLink = extractDeepLinkFromArgv(commandLine)
    focusMainWindow()
    if (deepLink) {
      routePasswordRecoveryLink(deepLink)
    }
  })
}

app.on('open-url', (event, url) => {
  event.preventDefault()
  routePasswordRecoveryLink(url)
})

// â”€â”€ Database â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const dbManager = require('../core/db-manager')
const { getDb }                  = dbManager

// â”€â”€ Auth â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const { controllaSessione, getUtenteCorrente, sincronizzaRegistrazioniPendenti } = require('../core/auth')

// ── Sync (facoltativo: richiede .env con SUPABASE_URL e SUPABASE_KEY) ─────────
let supabase = null
let avviaSyncAutomatica = null
let controllaConnessione = null
let getSupabaseConnectionStatus = null
let syncCoda = null
let syncIntervalId = null
try {
  supabase = require('../core/supabase')
  ;({ avviaSyncAutomatica, controllaConnessione, getSupabaseConnectionStatus, syncCoda } = require('../core/sync'))
  console.log('[Main] Modulo sync Supabase caricato. Client presente:', Boolean(supabase), 'auth presente:', Boolean(supabase?.auth))
  if (supabase && !supabase.auth) {
    const stack = new Error('client Supabase caricato senza auth').stack || ''
    const fileLine = stack.split('\n').find(line => /:\d+:\d+/.test(line)) || 'n/a'
    console.error('[Supabase Diagnostic] electron/main')
    console.error('[Supabase Diagnostic] - reason: client Supabase caricato senza proprietà auth')
    console.error('[Supabase Diagnostic] - fileLine:', fileLine)
    console.error('[Supabase Diagnostic] - stack:', stack)
  }
} catch (err) {
  console.error('[Main] Sync Supabase non disponibile:', err?.message || err)
  console.error('[Main] Stack completo errore require Supabase/sync:', err?.stack || '(nessuno stack disponibile)')
}

// â”€â”€ IPC handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const { registerAuthIpcHandlers }      = require('../ipc/auth.ipc')
const { registerMenuBuilderIpcHandlers } = require('../ipc/menu-builder.ipc')
const { registerMagazzinoIpcHandlers } = require('../ipc/magazzino.ipc')
const { registerRicetteIpcHandlers }   = require('../ipc/ricette.ipc')
const { registerOrdiniIpcHandlers }    = require('../ipc/ordini.ipc')
const { registerFoodcostIpcHandlers }  = require('../ipc/foodcost.ipc')
const { registerPersonaleIpcHandlers } = require('../ipc/personale.ipc')

// â”€â”€ Window factory â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function createWindow() {
  mainWindow = new BrowserWindow({
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
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  mainWindow.webContents.on('did-finish-load', deliverPendingPasswordRecoveryLink)
  return mainWindow
}

// ── Retry periodico registrazioni pendenti (indipendente da login) ──────────
const SIGNUP_RETRY_INTERVAL_MS = 60 * 1000
let signupRetryIntervalId = null

function avviaRetrySignupPendenti() {
  if (!supabase || !sincronizzaRegistrazioniPendenti) return null
  return setInterval(async () => {
    try {
      const online = controllaConnessione ? await controllaConnessione(supabase) : false
      if (!online) return
      const risultato = await sincronizzaRegistrazioniPendenti()
      if (risultato.processed > 0) {
        console.log('[Auth] Retry automatico registrazioni pendenti:', risultato)
      }
    } catch (err) {
      console.error('[Auth] Retry automatico registrazioni pendenti fallito:', err?.message || err)
    }
  }, SIGNUP_RETRY_INTERVAL_MS)
}

async function loadInitialWindowContent(win, db) {
  if (AUTH_PAUSED) {
    win.loadFile(INDEX_HTML_PATH)
    return
  }

  if (pendingPasswordRecoveryLink) {
    win.loadFile(INDEX_HTML_PATH, { hash: 'reset-password' })
    return
  }

  let sessioneValida = false
  try {
    sessioneValida = await controllaSessione()
  } catch (err) {
    console.error('[Auth] Errore controllo sessione:', err.message)
  }

  if (sessioneValida) {
    try {
      const utente = getUtenteCorrente()
      if (utente?.id) {
        const risultatoImport = await dbManager.sincronizzaDaSupabase(utente.id)
        if (risultatoImport.processed > 0) {
          console.log('[DB] Dati Supabase importati in locale:', risultatoImport)
        }
      }
    } catch (err) {
      console.error('[DB] Import remoto->locale fallito:', err?.message || err)
    }

    win.loadFile(INDEX_HTML_PATH)

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

    return
  }

  win.loadFile(INDEX_HTML_PATH, { hash: 'login' })
}

// ── App ready ──────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  registerDeepLinkProtocol()

  // 1. Inizializza database (createTables viene chiamato internamente da getDb)
  const db = getDb()
  console.log('[DB] Database pronto:', db.name || 'ristorante.db')
  if (supabase) {
    try {
      const status = await getSupabaseConnectionStatus?.(supabase)
      console.log('[Supabase] Diagnostica iniziale:', status)
      if (status?.online) {
        try {
          const risultatoSignup = await sincronizzaRegistrazioniPendenti()
          if (risultatoSignup.processed > 0) {
            console.log('[Auth] Retry immediato registrazioni pendenti all\'avvio:', risultatoSignup)
          }
        } catch (err) {
          console.error('[Auth] Retry immediato registrazioni pendenti fallito:', err?.message || err)
        }
      }
    } catch (error) {
      const diagnostic = require('../core/sync').formatSupabaseDiagnostic?.('bootstrap', error)
      console.error('[Supabase] Diagnostica iniziale fallita:', diagnostic)
    }
    signupRetryIntervalId = avviaRetrySignupPendenti()
  }

  // 2. Registra tutti gli IPC handler
  registerAuthIpcHandlers()
  registerMenuBuilderIpcHandlers()
  registerMagazzinoIpcHandlers()
  registerRicetteIpcHandlers()
  registerOrdiniIpcHandlers()
  registerFoodcostIpcHandlers()
  registerPersonaleIpcHandlers()

  // ── Sync IPC handlers ──────────────────────────────────────────────────────
  ipcMain.removeHandler('sync-ping')
  ipcMain.handle('sync-ping', async () => {
    if (!controllaConnessione) return false
    const online = await controllaConnessione(supabase)
    console.log('[Main] Ping Supabase:', online)
    return online
  })

  ipcMain.removeHandler('get-stato-connessione')
  ipcMain.handle('get-stato-connessione', async () => {
    if (!getSupabaseConnectionStatus) return false
    const status = await getSupabaseConnectionStatus(supabase)
    console.log('[Main] Stato connessione:', status)
    return status.online
  })

  ipcMain.removeHandler('get-stato-supabase')
  ipcMain.handle('get-stato-supabase', async () => {
    if (!getSupabaseConnectionStatus) {
      return { configured: false, online: false, label: 'Supabase non configurato', reason: 'Modulo sync non disponibile' }
    }

    try {
      const status = await getSupabaseConnectionStatus(supabase)
      console.log('[Main] Stato Supabase:', status)
      return status
    } catch (err) {
      console.error('[Main] Errore stato Supabase:', err?.message || err)
      return { configured: Boolean(supabase), online: false, label: 'Supabase offline', reason: err?.message || String(err) }
    }
  })

  ipcMain.removeHandler('sync-manuale')
  ipcMain.handle('sync-manuale', async () => {
    const risultatoSignup = sincronizzaRegistrazioniPendenti
      ? await sincronizzaRegistrazioniPendenti().catch((err) => {
          console.error('[Auth] Errore retry registrazioni pendenti:', err.message)
          return { processed: 0, synced: 0, failed: 0 }
        })
      : { processed: 0, synced: 0, failed: 0 }

    if (!syncCoda || !supabase) return { ...risultatoSignup, coda: { processed: 0, synced: 0, failed: 0 } }
    const utente = getUtenteCorrente()
    if (!utente?.id) return { ...risultatoSignup, coda: { processed: 0, synced: 0, failed: 0 } }
    try {
      await dbManager.sincronizzaDaSupabase(utente.id)
      const risultatoCoda = await syncCoda(db, supabase, utente.id)
      return { ...risultatoSignup, coda: risultatoCoda }
    } catch (err) {
      console.error('[Sync] Errore sync manuale:', err.message)
      return { ...risultatoSignup, coda: { processed: 0, synced: 0, failed: 0, error: err.message } }
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
  await loadInitialWindowContent(win, db)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length !== 0) {
      focusMainWindow()
      return
    }

    const nextWindow = createWindow()
    nextWindow.webContents.on('console-message', (_e, level, msg) => {
      if (level >= 2) console.log(`[Renderer] ${msg}`)
    })
    loadInitialWindowContent(nextWindow, getDb()).catch((err) => {
      console.error('[Main] Errore caricamento finestra attiva:', err?.message || err)
    })
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
