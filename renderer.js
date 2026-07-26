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
    'profilo':             { titolo: 'Profilo', nome: 'profilo' },
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

    // Profilo / menu
    const btnProfile = document.getElementById('btn-profile')
    const profileMenu = document.getElementById('profile-menu')

    chiudiMenuProfilo()

    if (btnProfile && profileMenu) {
      profileMenu.setAttribute('aria-hidden', 'true')
      btnProfile.addEventListener('click', (e) => {
        e.stopPropagation()
        const aperto = !profileMenu.classList.contains('hidden')
        impostaMenuProfilo(!aperto)
      })
    }

    document.addEventListener('click', (e) => {
      if (!profileMenu || profileMenu.classList.contains('hidden')) return
      const cliccatoSulTrigger = btnProfile?.contains(e.target)
      const cliccatoSulMenu = profileMenu.contains(e.target)
      if (!cliccatoSulTrigger && !cliccatoSulMenu) {
        chiudiMenuProfilo()
      }
    })

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        chiudiMenuProfilo()
      }
    })

    const profileLogoutBtn = document.getElementById('profile-logout-btn')
    if (profileLogoutBtn) {
      profileLogoutBtn.addEventListener('click', async () => {
        try {
          await window.api.auth.logout()
          window.location.hash = '#login'
          location.reload()
        } catch (e) {
          console.error('[Logout] Errore:', e)
        }
      })
    }

    const profileSettingsBtn = document.getElementById('profile-settings-btn')
    if (profileSettingsBtn) {
      profileSettingsBtn.addEventListener('click', () => {
        profileMenu?.classList.add('hidden')
        const pageTitle = document.getElementById('topbar-title')
        if (pageTitle) pageTitle.textContent = 'Profilo'
        caricaPagina('profilo')
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

    chiudiMenuProfilo()

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
      container.innerHTML = `
        <div id="page-loader" class="page-loading-state">
          <div class="spinner"></div>
          <span>Caricamento…</span>
        </div>`

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
    const dbStatus = document.getElementById('db-status')
    const dbLabel = document.getElementById('db-label')
    const profileSync = document.getElementById('profile-sync')
    if (!connDot) return

    let online = false
    let configured = true
    let label = 'Supabase offline'

    try {
      const result = await Promise.race([
        window.api.sync.getStatoSupabase?.(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2000))
      ])

      configured = result?.configured ?? true
      online = result?.online ?? false
      label = result?.label || (online ? 'Supabase online' : 'Supabase offline')

      connDot.classList.remove('offline')
      if (connIndicator) {
        connIndicator.title = online ? 'Supabase online' : 'Supabase offline'
      }
    } catch (err) {
      configured = false
      label = 'Supabase offline'
      connDot.classList.add('offline')
      if (connIndicator) {
        connIndicator.title = 'Supabase offline'
      }
    }

    if (dbStatus) {
      dbStatus.classList.toggle('offline', !online || !configured)
    }

    if (dbLabel) {
      dbLabel.textContent = label
    }

    if (profileSync) {
      profileSync.textContent = online ? 'Supabase online' : 'Supabase offline'
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