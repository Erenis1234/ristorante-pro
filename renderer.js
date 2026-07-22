;(function () {
  'use strict'

  // ── Mappa pagine ─────────────────────────────────────────────────
  const paginaMap = {
    'dashboard':           { titolo: 'Dashboard', nome: 'dashboard' },
    'menu':                { titolo: 'Menu', nome: 'menu' },
    'magazzino':           { titolo: 'Magazzino', nome: 'magazzino' },
    'ricette':             { titolo: 'Ricette', nome: 'ricette' },
    'ordini-fornitori':    { titolo: 'Ordini Fornitori', nome: 'ordini' },
    'food-cost':           { titolo: 'Food Cost', nome: 'foodcost' },
    'personale':           { titolo: 'Personale', nome: 'personale' },
  }

  let paginaAttuale = null

  // ── Init ─────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function init() {
    // Setup sidebar navigation
    const navLinks = document.querySelectorAll('#sidebar [data-page]')
    navLinks.forEach(link => {
      link.addEventListener('click', e => {
        e.preventDefault()
        const pageKey = link.dataset.page
        paginaAttuale = null
        caricaPagina(pageKey)
      })
    })

    if (window.location.hash === '#login') {
      // aspetta il login, non caricare nulla
    } else {
      void sincronizzaUiSessione(true)
      setTimeout(() => caricaPagina('dashboard'), 100)
    }

    window.addEventListener('app:login-success', () => {
      void sincronizzaUiSessione(true)
      setTimeout(() => caricaPagina('dashboard'), 100)
    })

    // Check connection status every 5 seconds
    aggiornaPinged()
    setInterval(aggiornaPinged, 5000)

    // Sync manuale
    const btnSync = document.getElementById('btn-sync')
    if (btnSync) {
      btnSync.addEventListener('click', async () => {
        if (btnSync.disabled) return
        btnSync.disabled = true
        btnSync.classList.add('syncing')
        try {
          const result = await window.api.sync.syncManuale()
          console.log('[Sync] Completata:', result)
        } catch (e) {
          console.error('[Sync] Errore:', e)
        } finally {
          btnSync.disabled = false
          btnSync.classList.remove('syncing')
        }
      })
    }

    // Logout
    const btnLogout = document.getElementById('btn-logout')
    if (btnLogout) {
      btnLogout.addEventListener('click', async () => {
        try {
          await window.api.auth.logout()
          window.location.hash = '#login'
          location.reload()
        } catch (e) {
          console.error('[Logout] Errore:', e)
        }
      })
    }
  })

  // ── Carica pagina ────────────────────────────────────────────────
  async function caricaPagina(pageKey) {
    // nessun controllo - ricarica sempre la pagina

    const config = paginaMap[pageKey]
    if (!config) {
      console.warn(`Pagina non nota: ${pageKey}`)
      return
    }

    // Aggiorna active state sulla sidebar
    aggiornaActiveNav(pageKey)

    // Aggiorna titolo topbar
    const titleEl = document.getElementById('topbar-title')
    if (titleEl) titleEl.textContent = config.titolo

    // Carica il modulo pagina
    const container = document.getElementById('page-content') || document.getElementById('main')
    if (!container) {
      console.error('Container pagina non trovato')
      return
    }

    try {
      const pageModule = window.pages?.[config.nome]
      const loadPage = pageModule?.load || pageModule?.init
      if (typeof loadPage !== 'function') {
        container.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">❌</div>
            <div class="empty-state-title">Modulo non disponibile</div>
            <div class="empty-state-sub">La pagina ${config.titolo} non è ancora caricata.</div>
          </div>`
        return
      }

      await loadPage(container)
      paginaAttuale = pageKey
    } catch (err) {
      console.error(`Errore caricamento pagina ${config.titolo}:`, err)
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">⚠️</div>
          <div class="empty-state-title">Errore di caricamento</div>
          <div class="empty-state-sub">${escapeHtml(err?.message ?? String(err))}</div>
        </div>`
    }
  }

  // ── Aggiorna active nav ──────────────────────────────────────────
  function aggiornaActiveNav(pageKey) {
    const navLinks = document.querySelectorAll('#sidebar [data-page]')
    navLinks.forEach(link => {
      link.classList.toggle('active', link.dataset.page === pageKey)
    })
  }

  // ── Aggiorna stato connessione ───────────────────────────────────
  async function aggiornaPinged() {
    const connIndicator = document.getElementById('conn-indicator')
    const connDot = document.getElementById('conn-dot')
    if (!connDot) return

    try {
      // Prova a contattare il backend
      const result = await Promise.race([
        window.api.sync.ping?.(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2000))
      ])

      // Connesso
      connDot.classList.remove('offline')
      if (connIndicator) {
        connIndicator.title = 'Connesso'
      }
    } catch (err) {
      // Offline
      connDot.classList.add('offline')
      if (connIndicator) {
        connIndicator.title = 'Offline - cambio locale'
      }
    }
  }

  async function sincronizzaUiSessione(forceShowShell = false) {
    if (!forceShowShell && window.location.hash === '#login') {
      return
    }

    if (typeof window.showAppShell !== 'function') {
      return
    }

    try {
      const utente = await window.api.auth.getUtenteCorrente()
      window.showAppShell(utente?.email || '')
    } catch (err) {
      console.error('[Auth] Errore aggiornamento UI sessione:', err)
      window.showAppShell('')
    }
  }

  // ── Utility ──────────────────────────────────────────────────────
  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }
})()