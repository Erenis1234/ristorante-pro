;(function () {
  'use strict'

  const STORAGE_KEY = 'ristorante-profile-data'

  function getProfileData() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        return { ...defaultProfileData(), ...JSON.parse(stored) }
      }
    } catch (_) {}
    return defaultProfileData()
  }

  function defaultProfileData() {
    return {
      nome: 'Chef Manager',
      email: 'chef@ristorante.it',
      ruolo: 'Amministratore',
      avatar: 'CM',
      avatarImage: ''
    }
  }

  function saveProfileData(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    window.dispatchEvent(new CustomEvent('profile:data-updated', { detail: data }))
  }

  function renderProfilePage(container, profileData) {
    container.innerHTML = `
      <div class="profile-page">
        <div class="profile-card">
          <div class="profile-card-header">
            <div class="profile-avatar-large">${profileData.avatarImage ? `<img src="${escapeHtml(profileData.avatarImage)}" alt="Avatar" />` : escapeHtml(profileData.avatar || 'U')}</div>
            <div>
              <h2>${escapeHtml(profileData.nome || 'Utente')}</h2>
              <p>${escapeHtml(profileData.email || 'Nessuna email')}</p>
              <span class="profile-badge">${escapeHtml(profileData.ruolo || 'Utente')}</span>
            </div>
          </div>

          <div class="profile-form-grid">
            <label class="form-field">
              <span>Nome utente</span>
              <input id="profile-name-input" type="text" value="${escapeHtml(profileData.nome || '')}" />
            </label>

            <label class="form-field">
              <span>Email</span>
              <input id="profile-email-input" type="email" value="${escapeHtml(profileData.email || '')}" />
            </label>

            <label class="form-field">
              <span>Avatar</span>
              <input id="profile-avatar-file" type="file" accept="image/*" />
              <input id="profile-avatar-input" type="text" value="${escapeHtml(profileData.avatar || '')}" placeholder="CM" />
            </label>

          </div>

          <div class="profile-actions">
            <button id="profile-save-btn" class="btn btn-primary" type="button">Salva modifiche</button>
            <button id="profile-cancel-btn" class="btn btn-secondary" type="button">Annulla</button>
          </div>
        </div>
      </div>
    `
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function applyProfileToUi(profileData) {
    const avatarEl = document.getElementById('topbar-user-avatar')
    const profileMenuAvatarEl = document.getElementById('profile-menu-avatar')
    const nameEl = document.getElementById('topbar-user-name')
    const emailEl = document.getElementById('topbar-user-email')
    const profileNameEl = document.getElementById('profile-menu-name')
    const profileEmailEl = document.getElementById('profile-menu-email')
    const profileModeEl = document.getElementById('profile-mode')

    const displayName = profileData.nome || 'Profilo'
    const initials = (profileData.avatar || displayName).slice(0, 2).toUpperCase()

    if (profileData.avatarImage) {
      if (avatarEl) {
        avatarEl.innerHTML = `<img src="${escapeHtml(profileData.avatarImage)}" alt="Avatar" />`
      }
      if (profileMenuAvatarEl) {
        profileMenuAvatarEl.innerHTML = `<img src="${escapeHtml(profileData.avatarImage)}" alt="Avatar" />`
      }
    } else {
      if (avatarEl) avatarEl.textContent = initials
      if (profileMenuAvatarEl) profileMenuAvatarEl.textContent = initials
    }
    if (nameEl) nameEl.textContent = displayName
    if (emailEl) emailEl.textContent = profileData.email || 'Nessuna email'
    if (profileNameEl) profileNameEl.textContent = displayName
    if (profileEmailEl) profileEmailEl.textContent = profileData.email || 'Nessuna email'
    if (profileModeEl) profileModeEl.textContent = profileData.email?.includes('@') ? 'Cloud / Supabase' : 'Locale'
  }

  window.pages = window.pages || {}
  window.pages.profilo = {
    render: renderProfilePage,
    initEvents() {},
    load(container) {
      const profileData = getProfileData()
      renderProfilePage(container, profileData)

      const saveBtn = container.querySelector('#profile-save-btn')
      const cancelBtn = container.querySelector('#profile-cancel-btn')
      const nameInput = container.querySelector('#profile-name-input')
      const emailInput = container.querySelector('#profile-email-input')
      const avatarInput = container.querySelector('#profile-avatar-input')
      const avatarFileInput = container.querySelector('#profile-avatar-file')

      const persist = async () => {
        const nextData = {
          ...profileData,
          nome: nameInput?.value?.trim() || profileData.nome,
          email: emailInput?.value?.trim() || profileData.email,
          avatar: avatarInput?.value?.trim() || profileData.avatar,
          avatarImage: profileData.avatarImage || '',
        }

        try {
          await window.api.auth.updateProfile(nextData)
        } catch (err) {
          console.warn('[Profile] Salvataggio auth fallito:', err)
        }

        saveProfileData(nextData)
        applyProfileToUi(nextData)
        renderProfilePage(container, nextData)
      }

      avatarFileInput?.addEventListener('change', (event) => {
        const file = event.target.files && event.target.files[0]
        if (!file) return

        const reader = new FileReader()
        reader.onload = () => {
          const nextData = {
            ...profileData,
            avatarImage: String(reader.result || ''),
            avatar: file.name?.split('.')[0] || profileData.avatar,
          }
          saveProfileData(nextData)
          applyProfileToUi(nextData)
          renderProfilePage(container, nextData)
        }
        reader.readAsDataURL(file)
      })

      saveBtn?.addEventListener('click', persist)
      cancelBtn?.addEventListener('click', () => {
        renderProfilePage(container, profileData)
      })

      window.addEventListener('profile:data-updated', () => {
        const latest = getProfileData()
        applyProfileToUi(latest)
      })

      applyProfileToUi(profileData)
      return Promise.resolve()
    }
  }
})()