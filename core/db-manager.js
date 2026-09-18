const path = require('path')
const dns = require('dns').promises
const { app } = require('electron')
const Database = require('better-sqlite3')

const { controllaConnessione } = require('./sync')

let supabase = null
try {
  supabase = require('./supabase')
} catch (_) {
  console.warn('[DB] Supabase non disponibile, modalità locale attiva.')
}
const { createTables } = require('../database/schema')

let db

function getDb() {
	if (!db) {
		const dbPath = path.join(app.getPath('userData'), 'ristorante.db')
		db = new Database(dbPath)
		db.pragma('journal_mode = WAL')
		db.pragma('foreign_keys = ON')
		createTables(db)
	}

	return db
}

// Whitelist esplicita delle tabelle raggiungibili tramite le funzioni generiche
// salva/leggi/leggiPerId/elimina (e le varianti *Locale). Tabelle sensibili come
// utenti_locali, auth_session, coda_sync e signup_pendenti sono gestite solo con
// SQL dedicato (core/auth.js, db-manager.js stesso) e restano fuori di proposito:
// non devono mai diventare raggiungibili da un handler IPC generico.
const TABELLE_CONSENTITE = new Set([
	'ingredienti',
	'ricette',
	'ricetta_ingredienti',
	'menu',
	'menu_voci',
	'personale',
	'turni',
	'movimenti_magazzino',
	'ordini_fornitori',
	'ordine_fornitore_righe',
])

const BACKEND_CACHE_TTL_MS = 10 * 1000
let backendModeCache = { mode: 'local', checkedAt: 0 }
let remoteTableAvailabilityCache = {}

function ensureValidTableName(tabella) {
	if (typeof tabella !== 'string' || !TABELLE_CONSENTITE.has(tabella)) {
		throw new Error(`Nome tabella non valido o non consentito: ${tabella}`)
	}
}

function ensureValidSelectColumns(columns) {
	if (!Array.isArray(columns) || columns.length === 0) {
		return '*'
	}

	const normalized = columns
		.map(column => String(column || '').trim())
		.filter(Boolean)

	if (!normalized.length) {
		return '*'
	}

	for (const column of normalized) {
		if (!/^[a-z_][a-z0-9_]*$/i.test(column)) {
			throw new Error(`Nome colonna non valido: ${column}`)
		}
	}

	return normalized.join(', ')
}

function isMissingRemoteTableError(error) {
	const message = error?.message || String(error || '')
	return /could not find the table|relation .* does not exist|schema cache|42p01|pgrst205|does not exist/i.test(message)
}

async function hasRemoteTable(tabella) {
	if (!supabase) {
		return false
	}

	const cacheKey = `${tabella}:${supabase?.auth ? 'auth' : 'noauth'}`
	const cached = remoteTableAvailabilityCache[cacheKey]
	if (cached !== undefined) {
		return cached
	}

	try {
		const { error } = await supabase.from(tabella).select('id', { count: 'exact', head: true })
		if (error) {
			const available = !isMissingRemoteTableError(error)
			remoteTableAvailabilityCache[cacheKey] = available
			return available
		}
		remoteTableAvailabilityCache[cacheKey] = true
		return true
	} catch (error) {
		const available = !isMissingRemoteTableError(error)
		remoteTableAvailabilityCache[cacheKey] = available
		return available
	}
}

async function getActiveBackend(forceRefresh = false, tabella = null) {
	if (!supabase) {
		return 'local'
	}

	const now = Date.now()
	if (!forceRefresh && backendModeCache.mode && now - backendModeCache.checkedAt < BACKEND_CACHE_TTL_MS) {
		return backendModeCache.mode
	}

	try {
		await dns.lookup('google.com')
	} catch (_error) {
		backendModeCache = { mode: 'local', checkedAt: now }
		return 'local'
	}

	const online = await controllaConnessione(supabase)
	if (!online) {
		backendModeCache = { mode: 'local', checkedAt: now }
		return 'local'
	}

	if (tabella) {
		const remoteTableAvailable = await hasRemoteTable(tabella)
		if (!remoteTableAvailable) {
			backendModeCache = { mode: 'local', checkedAt: now }
			return 'local'
		}
	}

	const mode = online ? 'remote' : 'local'
	backendModeCache = { mode, checkedAt: now }
	return mode
}

async function sincronizzaDaSupabase(userId) {
	if (!userId) {
		throw new Error('userId obbligatorio per la sincronizzazione remote->locale')
	}

	const mode = await getActiveBackend(true)
	if (mode !== 'remote' || !supabase) {
		return { processed: 0, synced: 0 }
	}

	const database = getDb()
	let synced = 0

	for (const tabella of TABELLE_CONSENTITE) {
		const backendMode = await getActiveBackend(true, tabella)
		if (backendMode !== 'remote') {
			continue
		}

		const { data, error } = await supabase.from(tabella).select('*')
		if (error) {
			if (isMissingRemoteTableError(error)) {
				continue
			}
			throw error
		}

		for (const record of data || []) {
			const recordUserId = record?.user_id
			if (recordUserId !== undefined && recordUserId !== null && recordUserId !== userId) {
				continue
			}

			upsertSQLite(database, tabella, record, userId, recordUserId ?? null)
			synced += 1
		}
	}

	return { processed: synced, synced }
}

function upsertSQLite(database, tabella, dati, userId, targetUserId = userId) {
	const payload = {
		...dati,
		user_id: targetUserId,
	}

	const now = database.prepare("SELECT datetime('now') AS now").get().now
	payload.updated_at = now

	const hasId = payload.id !== undefined && payload.id !== null

	if (hasId) {
		const existing = database
			.prepare(`SELECT id FROM ${tabella} WHERE id = ? AND (user_id = ? OR user_id IS NULL)`)
			.get(payload.id, targetUserId)

		if (existing) {
			const entries = Object.entries(payload).filter(([key]) => key !== 'id')
			const setClause = entries.map(([key]) => `${key} = ?`).join(', ')
			const values = entries.map(([, value]) => value)

			database
				.prepare(`UPDATE ${tabella} SET ${setClause} WHERE id = ? AND (user_id = ? OR user_id IS NULL)`)
				.run(...values, payload.id, targetUserId)

			return database
				.prepare(`SELECT * FROM ${tabella} WHERE id = ? AND (user_id = ? OR user_id IS NULL)`)
				.get(payload.id, targetUserId)
		}
	}

	const entries = Object.entries(payload).filter(([, value]) => value !== undefined)
	const columns = entries.map(([key]) => key)
	const placeholders = columns.map(() => '?').join(', ')
	const values = entries.map(([, value]) => value)

	const result = database
		.prepare(`INSERT INTO ${tabella} (${columns.join(', ')}) VALUES (${placeholders})`)
		.run(...values)

	return database
		.prepare(`SELECT * FROM ${tabella} WHERE id = ? AND (user_id = ? OR user_id IS NULL)`)
		.get(result.lastInsertRowid, targetUserId)
}

function enqueueSync(database, tabella, recordId, payload, userId, action = 'upsert', errorMessage = null) {
	const normalizedRecordId = String(recordId || '')
	const serializedPayload = payload === undefined ? null : JSON.stringify(payload)

	const existing = database.prepare(
		`SELECT id
		 FROM coda_sync
		 WHERE entita = ? AND record_id = ? AND user_id = ? AND sincronizzato = 0
		 ORDER BY id DESC
		 LIMIT 1`
	).get(tabella, normalizedRecordId, userId)

	if (existing?.id) {
		database.prepare(
			`UPDATE coda_sync
			 SET azione = ?,
			     payload = ?,
			     stato = 'pending',
			     tentativi = 0,
			     ultimo_errore = ?,
			     updated_at = datetime('now')
			 WHERE id = ?`
		).run(action, serializedPayload, errorMessage, existing.id)
		return existing.id
	}

	const result = database.prepare(
		`INSERT INTO coda_sync (
			 entita, record_id, azione, payload, sincronizzato, stato, tentativi, ultimo_errore, user_id, updated_at
		 ) VALUES (?, ?, ?, ?, 0, 'pending', 0, ?, ?, datetime('now'))`
	).run(tabella, normalizedRecordId, action, serializedPayload, errorMessage, userId)

	return result.lastInsertRowid
}

function accodaSyncLocale(tabella, recordId, payload, userId, action = 'upsert', errorMessage = null) {
	ensureValidTableName(tabella)

	if (!userId) {
		throw new Error('userId obbligatorio per la coda di sincronizzazione')
	}

	const database = getDb()
	enqueueSync(database, tabella, recordId, payload, userId, action, errorMessage)

	return {
		queued: true,
	}
}

async function salva(tabella, dati, userId) {
	ensureValidTableName(tabella)

	if (!userId) {
		throw new Error('userId obbligatorio per il salvataggio')
	}

	const database = getDb()
	const localRecord = upsertSQLite(database, tabella, dati || {}, userId)

	const remotePayload = {
		...localRecord,
		user_id: userId,
		updated_at: localRecord.updated_at,
	}

	const backendMode = await getActiveBackend()
	if (backendMode !== 'remote' || !supabase) {
		enqueueSync(database, tabella, localRecord.id, remotePayload, userId, 'upsert')
		return {
			data: localRecord,
			synced: false,
			queued: true,
			backend: 'local',
		}
	}

	try {
		const { error } = await supabase.from(tabella).upsert(remotePayload)

		if (error) {
			enqueueSync(database, tabella, localRecord.id, remotePayload, userId, 'upsert', error.message)
			return {
				data: localRecord,
				synced: false,
				queued: true,
				error: error.message,
				backend: 'local',
			}
		}

		return {
			data: localRecord,
			synced: true,
			queued: false,
			backend: 'remote',
		}
	} catch (error) {
		enqueueSync(database, tabella, localRecord.id, remotePayload, userId, 'upsert', error.message)
		return {
			data: localRecord,
			synced: false,
			queued: true,
			error: error.message,
			backend: 'local',
		}
	}
}

function leggi(tabella, userId, columns = null) {
	ensureValidTableName(tabella)

	if (!userId) {
		throw new Error('userId obbligatorio per la lettura')
	}

	const selectColumns = ensureValidSelectColumns(columns)

	return getDb()
		.prepare(`SELECT ${selectColumns} FROM ${tabella} 
					WHERE user_id = ? OR user_id IS NULL 
					ORDER BY updated_at DESC, id DESC`)
		.all(userId)
}

function leggiPerId(tabella, id, userId, columns = null) {
	ensureValidTableName(tabella)

	if (!userId) {
		throw new Error('userId obbligatorio per la lettura')
	}

	const selectColumns = ensureValidSelectColumns(columns)

	return getDb()
		.prepare(`SELECT ${selectColumns} FROM ${tabella} 
					WHERE id = ? AND (user_id = ? OR user_id IS NULL)`)
		.get(id, userId) || null
}

// ── Varianti sincrone, solo-locale ──────────────────────────────────────────
// Da usare esclusivamente dentro un db.transaction() quando più scritture su
// tabelle diverse devono essere atomiche: a differenza di salva()/elimina(),
// non tentano la sync immediata verso Supabase (che è asincrona e quindi
// incompatibile con le transazioni sincrone di better-sqlite3). La riga
// finisce comunque in coda_sync e verrà sincronizzata dal worker periodico
// (avviaSyncAutomatica) o dalla sync manuale.
function salvaLocale(tabella, dati, userId) {
	ensureValidTableName(tabella)

	if (!userId) {
		throw new Error('userId obbligatorio per il salvataggio')
	}

	const database = getDb()
	const localRecord = upsertSQLite(database, tabella, dati || {}, userId)

	enqueueSync(database, tabella, localRecord.id, {
		...localRecord,
		user_id: userId,
	}, userId, 'upsert')

	return {
		data: localRecord,
		synced: false,
		queued: true,
	}
}

function eliminaLocale(tabella, id, userId) {
	ensureValidTableName(tabella)

	if (!userId) {
		throw new Error('userId obbligatorio per l\'eliminazione')
	}

	const database = getDb()
	const existing = leggiPerId(tabella, id, userId)

	if (!existing) {
		return {
			deleted: false,
			notFound: true,
		}
	}

	database.prepare(`DELETE FROM ${tabella} WHERE id = ? AND user_id = ?`).run(id, userId)
	enqueueSync(database, tabella, id, { id, user_id: userId }, userId, 'delete')

	return {
		deleted: true,
		synced: false,
		queued: true,
	}
}

async function elimina(tabella, id, userId) {
	ensureValidTableName(tabella)

	if (!userId) {
		throw new Error('userId obbligatorio per l\'eliminazione')
	}

	const database = getDb()
	const existing = leggiPerId(tabella, id, userId)

	if (!existing) {
		return {
			deleted: false,
			notFound: true,
		}
	}

	database.prepare(`DELETE FROM ${tabella} WHERE id = ? AND user_id = ?`).run(id, userId)

	const backendMode = await getActiveBackend()
	if (backendMode !== 'remote' || !supabase) {
		enqueueSync(database, tabella, id, { id, user_id: userId }, userId, 'delete')
		return {
			deleted: true,
			synced: false,
			queued: true,
			backend: 'local',
		}
	}

	try {
		const { error } = await supabase.from(tabella).delete().eq('id', id).eq('user_id', userId)

		if (error) {
			enqueueSync(database, tabella, id, { id, user_id: userId }, userId, 'delete', error.message)
			return {
				deleted: true,
				synced: false,
				queued: true,
				error: error.message,
				backend: 'local',
			}
		}

		return {
			deleted: true,
			synced: true,
			queued: false,
			backend: 'remote',
		}
	} catch (error) {
		enqueueSync(database, tabella, id, { id, user_id: userId }, userId, 'delete', error.message)
		return {
			deleted: true,
			synced: false,
			queued: true,
			error: error.message,
			backend: 'local',
		}
	}
}

module.exports = {
	getDb,
	getActiveBackend,
	sincronizzaDaSupabase,
	salva,
	leggi,
	leggiPerId,
	elimina,
	salvaLocale,
	eliminaLocale,
	accodaSyncLocale,
}
