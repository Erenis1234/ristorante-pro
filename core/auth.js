const crypto = require('crypto')
const { getDb } = require('./db-manager')

let supabase = null
try {
  supabase = require('./supabase')
} catch (_) {
  console.warn('[Auth] Modalità locale attiva.')
}

function normalizeEmail(email) {
	return String(email || '').trim().toLowerCase()
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

	if (!user || !verifyPassword(password, user.password_hash)) {
		throw new Error('Credenziali non valide.')
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

function getSavedSessionRow() {
	return getDb().prepare('SELECT * FROM auth_session WHERE id = 1').get() || null
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

	if (!supabase) {
		return savedSession
	}

	let data, error
	try {
		;({ data, error } = await supabase.auth.setSession({
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
	const normalizedEmail = normalizeEmail(email)
	if (!normalizedEmail || !password) {
		throw new Error('Email e password sono obbligatorie.')
	}

	if (supabase) {
		try {
			const { data, error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password })
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

	const localUser = loginLocalUser(normalizedEmail, password)
	const localSession = buildLocalSession(localUser)
	saveSession(localSession)

	return {
		user: localSession.user,
		session: localSession,
		provider: 'local',
	}
}

async function registrati(email, password) {
	const normalizedEmail = normalizeEmail(email)
	if (!normalizedEmail || !password || password.length < 6) {
		throw new Error('Inserisci email valida e password di almeno 6 caratteri.')
	}

	if (supabase) {
		try {
			const { data, error } = await supabase.auth.signUp({ email: normalizedEmail, password })
			if (error) {
				if (error.status) {
					throw new Error(error.message || 'Errore durante la registrazione.')
				}
				console.warn('[Auth] Supabase signUp fallito, fallback locale attivato:', error.message)
			} else {
				try { registerLocalUser(normalizedEmail, password) } catch (_) { /* già esistente */ }
				if (data?.session) {
					saveSession(data.session)
					return data
				}
				return data
			}
		} catch (err) {
			console.warn('[Auth] Supabase registrazione fallita, uso fallback locale:', err.message)
		}
	}

	registerLocalUser(normalizedEmail, password)
	return {
		user: {
			email: normalizedEmail,
			app_metadata: { provider: 'local' },
		},
		session: null,
		provider: 'local',
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

	if (supabase && saved?.access_token && saved?.refresh_token) {
		await supabase.auth.setSession({
			access_token: saved.access_token,
			refresh_token: saved.refresh_token,
		})
		const { error } = await supabase.auth.signOut()
		clearSavedSession()
		if (error) throw error
		return true
	}

	clearSavedSession()

	return true
}

async function recuperaPassword(email) {
	const normalizedEmail = normalizeEmail(email)
	const localUser = findLocalUserByEmail(normalizedEmail)
	if (localUser) {
		throw new Error('Recupero password non disponibile per account locale. Registrati di nuovo o contatta l\'amministratore.')
	}

	if (!supabase) {
		throw new Error('Recupero password non disponibile in modalità offline. Contatta l\'amministratore.')
	}

	const { data, error } = await supabase.auth.resetPasswordForEmail(normalizedEmail)

	if (error) {
		throw error
	}

	return data
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

module.exports = {
	login,
	registrati,
	logout,
	recuperaPassword,
	getUtenteCorrente,
	controllaSessione,
}
