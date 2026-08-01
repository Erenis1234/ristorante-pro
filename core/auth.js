const crypto = require('crypto')
const { getDb } = require('./db-manager')
const { cifra, decifra } = require('./crypto-utils')

let supabase = null
try {
  supabase = require('./supabase')
} catch (_) {
  console.warn('[Auth] Modalità locale attiva.')
}

function logSupabaseDiagnostic(context, reason) {
	const stack = new Error(reason).stack || ''
	const fileLine = stack.split('\n').find(line => /:\d+:\d+/.test(line)) || 'n/a'
	console.error(`[Supabase Diagnostic] ${context}`)
	console.error('[Supabase Diagnostic] - reason:', reason)
	console.error('[Supabase Diagnostic] - fileLine:', fileLine)
	console.error('[Supabase Diagnostic] - stack:', stack)
}

function getSupabaseClientOrLog(context, requireAuth = false) {
	if (!supabase) {
		logSupabaseDiagnostic(context, 'Client Supabase non disponibile (require nullo o fallback offline).')
		return null
	}

	if (requireAuth && !supabase.auth) {
		logSupabaseDiagnostic(context, 'Client Supabase privo di proprietà auth.')
		return null
	}

	return supabase
}

const PASSWORD_RESET_COOLDOWN_MS = 20000
let lastPasswordResetRequestAt = 0

// Pagina statica (deploy automatico su GitHub Pages, vedi
// .github/workflows/deploy-pages.yml e web/reset-password.html) che riceve
// il link di reset e permette all'utente di impostare la nuova password.
// Sovrascrivibile con la variabile d'ambiente PASSWORD_RESET_REDIRECT_URL
// se in futuro si usa un dominio proprio o un altro hosting.
const PASSWORD_RESET_REDIRECT_URL = process.env.PASSWORD_RESET_REDIRECT_URL
	|| 'https://erenis1234.github.io/ristorante-pro/reset-password.html'

// Errori di signUp considerati transitori: vale la pena riaccodare il tentativo
// (rete assente, timeout, rate limit, errori 5xx del servizio Supabase Auth).
// Errori come "email invalida" o "utente già registrato" sono permanenti: non
// hanno senso da riprovare automaticamente e non vengono accodati.
function isSupabaseAuthErrorRetryable(error) {
  const status = Number(error?.status)
  if (status === 429 || (status >= 500 && status < 600)) {
    return true
  }

  const message = error?.message || String(error || '')
  return /fetch failed|ENOTFOUND|ECONNREFUSED|network|timeout|Failed to fetch|rate limit/i.test(message)
}

function normalizeEmail(email) {
	return String(email || '').trim().toLowerCase()
}

function isValidEmailAddress(value) {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim().toLowerCase())
}

function normalizePhone(phone) {
	return String(phone || '')
		.replace(/\D/g, '')
		.replace(/^0/, '39')
}

function normalizeLoginIdentifier(value) {
	const raw = String(value || '').trim()
	if (!raw) {
		return { type: 'unknown', value: '' }
	}

	if (/^\+?\d[\d\s().-]{4,}$/.test(raw)) {
		const normalizedPhone = normalizePhone(raw)
		return { type: 'phone', value: `+${normalizedPhone}` }
	}

	return { type: 'email', value: normalizeEmail(raw) }
}

function buildPasswordHash(password) {
	const salt = crypto.randomBytes(16).toString('hex')
	const hash = crypto.scryptSync(password, salt, 64).toString('hex')
	return `${salt}:${hash}`
}

function verifyPassword(password, serializedHash) {
	if (!serializedHash || !serializedHash.includes(':')) {
		return false
	}

	const [salt, storedHashHex] = serializedHash.split(':')
	if (!salt || !storedHashHex) {
		return false
	}

	const derived = crypto.scryptSync(password, salt, 64)
	const stored = Buffer.from(storedHashHex, 'hex')

	if (derived.length !== stored.length) {
		return false
	}

	return crypto.timingSafeEqual(derived, stored)
}

function buildLocalSession(localUser) {
	const nowInSeconds = Math.floor(Date.now() / 1000)
	const expiresAt = nowInSeconds + (60 * 60 * 24 * 365 * 10)
	const user = {
		id: `local-${localUser.id}`,
		email: localUser.email,
		app_metadata: { provider: 'local' },
		user_metadata: { source: 'sqlite' },
	}

	return {
		access_token: `local_access_${localUser.id}`,
		refresh_token: `local_refresh_${localUser.id}`,
		expires_at: expiresAt,
		token_type: 'local',
		user,
	}
}

function findLocalUserByEmail(email) {
	return getDb().prepare(
		`SELECT id, username, email, password_hash, attivo
		 FROM utenti_locali
		 WHERE lower(username) = lower(?) OR lower(email) = lower(?)
		 LIMIT 1`
	).get(email, email) || null
}

function findLocalUserByIdentifier(identifier) {
	const normalized = normalizeLoginIdentifier(identifier)
	if (normalized.type === 'phone') {
		return getDb().prepare(
			`SELECT id, username, email, password_hash, attivo
			 FROM utenti_locali
			 WHERE lower(username) = lower(?) OR lower(email) = lower(?)
			 LIMIT 1`
		).get(normalized.value, normalized.value) || null
	}

	return findLocalUserByEmail(normalized.value)
}

function registerLocalUser(email, password) {
	const database = getDb()
	const normalizedEmail = normalizeEmail(email)
	const existing = findLocalUserByEmail(normalizedEmail)

	if (existing) {
		throw new Error('Utente già registrato. Effettua l\'accesso.')
	}

	const passwordHash = buildPasswordHash(password)
	const result = database.prepare(
		`INSERT INTO utenti_locali (
			username, password_hash, ruolo, nome, email, attivo, ultimo_accesso, updated_at
		 ) VALUES (?, ?, 'owner', ?, ?, 1, datetime('now'), datetime('now'))`
	).run(normalizedEmail, passwordHash, normalizedEmail.split('@')[0], normalizedEmail)

	return database.prepare(
		`SELECT id, username, email, attivo FROM utenti_locali WHERE id = ?`
	).get(result.lastInsertRowid)
}

function loginLocalUser(email, password) {
	const database = getDb()
	const normalizedEmail = normalizeEmail(email)
	const user = findLocalUserByEmail(normalizedEmail)

	if (!user) {
		throw new Error('Nessun account locale trovato. Registrati prima per usare l\'app offline.')
	}

	if (!verifyPassword(password, user.password_hash)) {
		throw new Error('Password errata per questo account locale.')
	}

	if (!user.attivo) {
		throw new Error('Utente disattivato.')
	}

	database.prepare(
		`UPDATE utenti_locali
		 SET ultimo_accesso = datetime('now'), updated_at = datetime('now')
		 WHERE id = ?`
	).run(user.id)

	return {
		id: user.id,
		email: user.email || user.username,
	}
}

function saveSession(session) {
	const database = getDb()
	const user = session?.user || null

	database.prepare(
		`INSERT INTO auth_session (
			 id, user_id, email, access_token, refresh_token, expires_at, token_type, user_json, session_json, updated_at
		 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
		 ON CONFLICT(id) DO UPDATE SET
			 user_id = excluded.user_id,
			 email = excluded.email,
			 access_token = excluded.access_token,
			 refresh_token = excluded.refresh_token,
			 expires_at = excluded.expires_at,
			 token_type = excluded.token_type,
			 user_json = excluded.user_json,
			 session_json = excluded.session_json,
			 updated_at = datetime('now')`
	).run(
		1,
		user?.id || null,
		user?.email || null,
		session.access_token,
		session.refresh_token,
		session.expires_at || null,
		session.token_type || null,
		JSON.stringify(user || null),
		JSON.stringify(session)
	)
}

function clearSavedSession() {
	getDb().prepare('DELETE FROM auth_session WHERE id = 1').run()
}

function updateLocalProfile(profileData) {
	const database = getDb()
	const saved = getSavedSessionRow()
	const currentUser = parseJson(saved?.user_json) || null
	const userId = currentUser?.id || saved?.user_id || null
	const normalizedEmail = normalizeEmail(profileData?.email)

	if (!userId) {
		return null
	}

	const userRow = database.prepare(
		`SELECT id, username, email, nome, ruolo FROM utenti_locali WHERE id = ? LIMIT 1`
	).get(userId) || null

	if (!userRow) {
		return null
	}

	const nextName = String(profileData?.nome || userRow.nome || userRow.username || '').trim()
	const nextEmail = normalizedEmail || userRow.email || userRow.username || null
	const nextAvatar = String(profileData?.avatar || '').trim() || null

	database.prepare(
		`UPDATE utenti_locali
		 SET nome = ?, email = ?, updated_at = datetime('now')
		 WHERE id = ?`
	).run(nextName, nextEmail, userId)

	const updatedSessionUser = {
		...(currentUser || {}),
		id: currentUser?.id || userRow.id,
		email: nextEmail,
		user_metadata: {
			...(currentUser?.user_metadata || {}),
			name: nextName,
			avatar: nextAvatar,
		},
		app_metadata: {
			...(currentUser?.app_metadata || {}),
			role: userRow.ruolo || 'owner',
		},
	}

	if (saved) {
		const sessionJson = parseJson(saved.session_json)
		saveSession({
			...(sessionJson || {}),
			user: updatedSessionUser,
		})
	}

	return updatedSessionUser
}

async function syncProfileToSupabase(profileData) {
	const supabaseClient = getSupabaseClientOrLog('syncProfileToSupabase')
	if (!supabaseClient || typeof supabaseClient.from !== 'function') {
		if (supabaseClient) {
			logSupabaseDiagnostic('syncProfileToSupabase', 'Client Supabase privo di metodo from().')
		}
		return null
	}

	const saved = getSavedSessionRow()
	const currentUser = parseJson(saved?.user_json) || null
	if (!currentUser?.id) {
		return null
	}

	try {
		const updates = {
			full_name: profileData?.nome || currentUser?.user_metadata?.name || null,
			avatar_url: profileData?.avatar || currentUser?.user_metadata?.avatar || null,
		}

		const { error } = await supabaseClient.from('profiles').upsert({
			id: currentUser.id,
			...updates,
		}, { onConflict: 'id' })

		if (error) {
			throw error
		}

		return updates
	} catch (err) {
		console.warn('[Auth] Sync profilo Supabase fallita:', err.message)
		return null
	}
}

function getSavedSessionRow() {
	return getDb().prepare('SELECT * FROM auth_session WHERE id = 1').get() || null
}

function getPasswordRecoveryErrorMessage(err) {
	const message = err?.message || ''
	const status = Number(err?.status)

	if (/fetch failed|ENOTFOUND|network|Failed to fetch/i.test(message)) {
		return 'Reset password non disponibile: verifica la connessione internet e riprova.'
	}

	if (status === 403 || /access denied|not authorized|unauthorized|forbidden/i.test(message)) {
		return 'Reset password non disponibile: verifica la configurazione di Auth in Supabase (Site URL/Redirect URLs e email provider).'
	}

	if (status === 500 && /gmail\.com domain is not verified|add and verify your domain|resend/i.test(message)) {
		return 'Reset password non disponibile: il provider email non puo inviare da gmail.com. Verifica il dominio mittente verificato in Resend/Supabase Auth.'
	}

	if (status === 429 || /only request this after|rate limit|too many requests/i.test(message)) {
		const secondsMatch = message.match(/after\s+(\d+)\s+seconds?/i)
		const seconds = secondsMatch ? ` ${secondsMatch[1]}` : ''
		return `Reset password temporaneamente bloccato da Supabase${seconds}: attendi qualche istante e riprova.`
	}

	return message || 'Errore durante il recupero password.'
}

function buildPasswordRecoveryResult(success, payload) {
	return success
		? { success: true, data: payload }
		: { success: false, message: payload }
}

function getPasswordResetCooldownRemainingMs() {
	const remaining = PASSWORD_RESET_COOLDOWN_MS - (Date.now() - lastPasswordResetRequestAt)
	return remaining > 0 ? remaining : 0
}

function buildPasswordResetCooldownErrorMessage() {
	const remainingSeconds = Math.max(1, Math.ceil(getPasswordResetCooldownRemainingMs() / 1000))
	return `Reset password temporaneamente bloccato da Supabase ${remainingSeconds}: attendi qualche istante e riprova.`
}

function parseJson(value) {
	if (!value) {
		return null
	}

	try {
		return JSON.parse(value)
	} catch (_error) {
		return null
	}
}

async function restoreSessionFromStorage() {
	const saved = getSavedSessionRow()
	if (!saved?.access_token || !saved?.refresh_token) {
		return null
	}

	const savedSession = parseJson(saved?.session_json)
	if (savedSession?.token_type === 'local') {
		return savedSession
	}

	const supabaseClient = getSupabaseClientOrLog('restoreSessionFromStorage', true)
	if (!supabaseClient) {
		return savedSession
	}

	let data, error
	try {
		;({ data, error } = await supabaseClient.auth.setSession({
			access_token: saved.access_token,
			refresh_token: saved.refresh_token,
		}))
	} catch (_err) {
		clearSavedSession()
		return null
	}

	if (error || !data?.session) {
		clearSavedSession()
		return null
	}

	saveSession(data.session)
	return data.session
}

async function login(email, password) {
	const normalizedIdentifier = normalizeLoginIdentifier(email)
	if (!normalizedIdentifier.value || !password) {
		throw new Error('Email, telefono e password sono obbligatori.')
	}

	const supabaseClient = getSupabaseClientOrLog('login', true)
	if (supabaseClient) {
		try {
			const payload = normalizedIdentifier.type === 'phone'
				? { phone: normalizedIdentifier.value, password }
				: { email: normalizedIdentifier.value, password }
			const { data, error } = await supabaseClient.auth.signInWithPassword(payload)
			if (!error && data?.session) {
				saveSession(data.session)
				return data
			}
			if (error?.status) {
				throw new Error(error.message || 'Credenziali non valide.')
			}
			console.warn('[Auth] Supabase auth fallita, fallback locale attivato:', error?.message || 'Nessun errore HTTP ricevuto')
		} catch (err) {
			console.warn('[Auth] Supabase login fallito, uso fallback locale:', err.message)
		}
	}

	const localUser = loginLocalUser(normalizedIdentifier.value, password)
	const localSession = buildLocalSession(localUser)
	saveSession(localSession)

	return {
		user: localSession.user,
		session: localSession,
		provider: 'local',
	}
}

const MAX_TENTATIVI_SIGNUP_PENDENTE = 20

// Accoda una registrazione fallita per un motivo transitorio (rete assente,
// rate limit, errore 5xx) in modo che venga ritentata automaticamente da
// sincronizzaRegistrazioniPendenti() quando la connessione torna disponibile.
// La password viene salvata cifrata con CRYPTO_KEY (mai in chiaro) e rimossa
// non appena il retry ha successo.
function accodaRegistrazionePendente(email, password) {
	const database = getDb()
	const passwordCifrata = cifra(password)

	database.prepare(
		`INSERT INTO signup_pendenti (email, password_cifrata, stato, tentativi, ultimo_errore, updated_at)
		 VALUES (?, ?, 'pending', 0, NULL, datetime('now'))
		 ON CONFLICT(email) DO UPDATE SET
			 password_cifrata = excluded.password_cifrata,
			 stato = 'pending',
			 updated_at = datetime('now')`
	).run(email, passwordCifrata)
}

// Variante "sicura" da chiamare nei rami catch: non deve mai far fallire il
// flusso di registrazione principale se l'accodamento stesso ha un problema.
function accodaRegistrazionePendenteSicura(email, password) {
	try {
		accodaRegistrazionePendente(email, password)
		console.warn('[Auth] Registrazione accodata per retry automatico verso Supabase:', email)
	} catch (queueErr) {
		console.error('[Auth] Impossibile accodare la registrazione pendente:', queueErr.message)
	}
}

function rimuoviRegistrazionePendente(email) {
	getDb().prepare('DELETE FROM signup_pendenti WHERE lower(email) = lower(?)').run(email)
}

// Ritenta le registrazioni accodate verso Supabase Auth. Va richiamata
// periodicamente (quando la connessione è disponibile) e manualmente dal
// pulsante di sync. Non richiede un utente autenticato: le registrazioni
// pendenti esistono per definizione prima che l'utente riesca ad accedere.
async function sincronizzaRegistrazioniPendenti() {
	const result = { processed: 0, synced: 0, failed: 0 }

	const supabaseClient = getSupabaseClientOrLog('sincronizzaRegistrazioniPendenti', true)
	if (!supabaseClient) {
		return result
	}

	const database = getDb()
	const pendenti = database.prepare(
		`SELECT * FROM signup_pendenti WHERE stato = 'pending' AND tentativi < ? ORDER BY id ASC`
	).all(MAX_TENTATIVI_SIGNUP_PENDENTE)

	for (const riga of pendenti) {
		result.processed += 1

		let password
		try {
			password = decifra(riga.password_cifrata)
		} catch (err) {
			database.prepare(
				`UPDATE signup_pendenti SET stato = 'error', ultimo_errore = ?, updated_at = datetime('now') WHERE id = ?`
			).run('Impossibile decifrare la password salvata: ' + err.message, riga.id)
			result.failed += 1
			continue
		}

		try {
			const { error } = await supabaseClient.auth.signUp({ email: riga.email, password })
			const giaRegistrato = /already registered|already exists/i.test(error?.message || '')
			if (error && !giaRegistrato) {
				throw error
			}

			// Se l'utente risulta già registrato su Supabase (creato da un tentativo
			// precedente andato a buon fine ma non tracciato localmente), consideriamo
			// la coda risolta: l'obiettivo (utente presente su Supabase) è raggiunto.
			database.prepare('DELETE FROM signup_pendenti WHERE id = ?').run(riga.id)
			result.synced += 1
			console.log('[Auth] Registrazione pendente sincronizzata con Supabase:', riga.email)
		} catch (err) {
			const message = err?.message || String(err)
			if (isSupabaseAuthErrorRetryable(err)) {
				database.prepare(
					`UPDATE signup_pendenti SET tentativi = tentativi + 1, ultimo_errore = ?, updated_at = datetime('now') WHERE id = ?`
				).run(message, riga.id)
			} else {
				// Errore permanente (es. email ormai invalida): smette di ritentare ma resta visibile per audit.
				database.prepare(
					`UPDATE signup_pendenti SET stato = 'error', ultimo_errore = ?, updated_at = datetime('now') WHERE id = ?`
				).run(message, riga.id)
			}
			result.failed += 1
			console.warn('[Auth] Retry registrazione pendente fallito per', riga.email, ':', message)
		}
	}

	return result
}

async function registrati(email, password) {
	const normalizedIdentifier = normalizeLoginIdentifier(email)
	if (!normalizedIdentifier.value || !password || password.length < 6) {
		throw new Error('Inserisci email o telefono valido e password di almeno 6 caratteri.')
	}

	if (normalizedIdentifier.type === 'phone') {
		try {
			const localUser = registerLocalUser(normalizedIdentifier.value, password)
			const localSession = buildLocalSession(localUser)
			saveSession(localSession)
			return {
				user: localSession.user,
				session: localSession,
				provider: 'local',
			}
		} catch (err) {
			throw new Error(err?.message || 'Errore durante la registrazione con numero di telefono.')
		}
	}

	let supabaseErrorMessage = null

	const supabaseClient = getSupabaseClientOrLog('registrati', true)
	if (supabaseClient) {
		try {
			const { data, error } = await supabaseClient.auth.signUp({ email: normalizedIdentifier.value, password })
			if (error) {
				if (error.status) {
					const httpError = new Error(error.message || 'Errore durante la registrazione.')
					httpError.status = error.status
					throw httpError
				}
				const authErrorMessage = error.message || 'Errore di registrazione Supabase'
				const isNetworkIssue = /fetch failed|network|timeout|Failed to fetch|ENOTFOUND|ECONNREFUSED/i.test(authErrorMessage)
				if (isNetworkIssue) {
					console.warn('[Auth] Supabase non raggiungibile, registrazione locale:', authErrorMessage)
				} else {
					console.warn('[Auth] Supabase signUp fallito, fallback locale attivato:', authErrorMessage)
				}
				supabaseErrorMessage = authErrorMessage
				if (isSupabaseAuthErrorRetryable(error)) {
					accodaRegistrazionePendenteSicura(normalizedIdentifier.value, password)
				}
			} else {
				try { registerLocalUser(normalizedIdentifier.value, password) } catch (_) { /* già esistente */ }
				rimuoviRegistrazionePendente(normalizedIdentifier.value)
				if (data?.session) {
					saveSession(data.session)
					return data
				}
				return data
			}
		} catch (err) {
			const message = err?.message || String(err)
			const isNetworkIssue = /fetch failed|network|timeout|Failed to fetch|ENOTFOUND|ECONNREFUSED/i.test(message)
			if (isNetworkIssue) {
				console.warn('[Auth] Supabase non raggiungibile, registrazione locale:', message)
			} else {
				console.warn('[Auth] Supabase registrazione fallita, uso fallback locale:', message)
			}
			supabaseErrorMessage = message
			if (isSupabaseAuthErrorRetryable(err)) {
				accodaRegistrazionePendenteSicura(normalizedIdentifier.value, password)
			}
		}
	}

	registerLocalUser(normalizedIdentifier.value, password)
	return {
		user: {
			email: normalizedIdentifier.value,
			app_metadata: { provider: 'local' },
		},
		session: null,
		provider: 'local',
		...(supabaseErrorMessage ? { supabaseError: true, supabaseErrorMessage } : {}),
	}
}

async function logout() {
	const saved = getSavedSessionRow()
	const session = parseJson(saved?.session_json)
	const tokenType = session?.token_type || saved?.token_type

	if (tokenType === 'local') {
		clearSavedSession()
		return true
	}

	const supabaseClient = getSupabaseClientOrLog('logout', true)
	if (supabaseClient && saved?.access_token && saved?.refresh_token) {
		await supabaseClient.auth.setSession({
			access_token: saved.access_token,
			refresh_token: saved.refresh_token,
		})
		const { error } = await supabaseClient.auth.signOut()
		clearSavedSession()
		if (error) throw error
		return true
	}

	clearSavedSession()

	return true
}

async function recuperaPassword(email) {
	const normalizedEmail = normalizeEmail(email)
	if (!isValidEmailAddress(normalizedEmail)) {
		return buildPasswordRecoveryResult(false, 'Inserisci un indirizzo email valido per il reset password.')
	}

	const supabaseClient = getSupabaseClientOrLog('recuperaPassword', true)

	if (!supabaseClient) {
		return buildPasswordRecoveryResult(false, 'Recupero password non disponibile in modalita offline. Verifica la connessione o registrati nuovamente.')
	}

	const remainingCooldownMs = getPasswordResetCooldownRemainingMs()
	if (remainingCooldownMs > 0) {
		return buildPasswordRecoveryResult(false, buildPasswordResetCooldownErrorMessage())
	}

	lastPasswordResetRequestAt = Date.now()

	try {
		const { data, error } = await supabaseClient.auth.resetPasswordForEmail(normalizedEmail, {
			redirectTo: PASSWORD_RESET_REDIRECT_URL,
		})

		if (error) {
			throw error
		}

		return buildPasswordRecoveryResult(true, data)
	} catch (err) {
		return buildPasswordRecoveryResult(false, getPasswordRecoveryErrorMessage(err))
	}
}

function getUtenteCorrente() {
	const saved = getSavedSessionRow()
	if (!saved) {
		return null
	}

	return parseJson(saved.user_json)
}

async function controllaSessione() {
	const saved = getSavedSessionRow()
	if (!saved) {
		return false
	}

	const session = parseJson(saved.session_json)
	const expiresAt = session?.expires_at || saved.expires_at
	const nowInSeconds = Math.floor(Date.now() / 1000)

	if (expiresAt && expiresAt > nowInSeconds) {
		return true
	}

	const restoredSession = await restoreSessionFromStorage()
	return Boolean(restoredSession)
}

async function updateProfile(profileData) {
	const updatedUser = updateLocalProfile(profileData)
	await syncProfileToSupabase(profileData)
	return updatedUser
}

module.exports = {
	login,
	registrati,
	logout,
	recuperaPassword,
	normalizeLoginIdentifier,
	getPasswordRecoveryErrorMessage,
	buildPasswordRecoveryResult,
	buildPasswordResetCooldownErrorMessage,
	getUtenteCorrente,
	controllaSessione,
	updateProfile,
	sincronizzaRegistrazioniPendenti,
}
