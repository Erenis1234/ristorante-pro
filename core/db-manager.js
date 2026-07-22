const path = require('path')
const dns = require('dns').promises
const { app } = require('electron')
const Database = require('better-sqlite3')

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

function ensureValidTableName(tabella) {
	if (!/^[a-z_][a-z0-9_]*$/i.test(tabella)) {
		throw new Error(`Nome tabella non valido: ${tabella}`)
	}
}

async function haInternet() {
	try {
		await dns.lookup('google.com')
		return true
	} catch (_error) {
		return false
	}
}

function upsertSQLite(database, tabella, dati, userId) {
	const payload = {
		...dati,
		user_id: userId,
	}

	const now = database.prepare("SELECT datetime('now') AS now").get().now
	payload.updated_at = now

	const hasId = payload.id !== undefined && payload.id !== null

	if (hasId) {
		const existing = database
			.prepare(`SELECT id FROM ${tabella} WHERE id = ? AND (user_id = ? OR user_id IS NULL)`)
			.get(payload.id, userId)

		if (existing) {
			const entries = Object.entries(payload).filter(([key]) => key !== 'id')
			const setClause = entries.map(([key]) => `${key} = ?`).join(', ')
			const values = entries.map(([, value]) => value)

			database
				.prepare(`UPDATE ${tabella} SET ${setClause} WHERE id = ? AND (user_id = ? OR user_id IS NULL)`)
				.run(...values, payload.id, userId)

			return database
				.prepare(`SELECT * FROM ${tabella} WHERE id = ? AND user_id = ?`)
				.get(payload.id, userId)
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
		.prepare(`SELECT * FROM ${tabella} WHERE id = ? AND user_id = ?`)
		.get(result.lastInsertRowid, userId)
}

function enqueueSync(database, tabella, recordId, payload, userId, errorMessage = null) {
	database.prepare(
		`INSERT INTO coda_sync (
			 entita, record_id, azione, payload, sincronizzato, stato, tentativi, ultimo_errore, user_id, updated_at
		 ) VALUES (?, ?, 'upsert', ?, 0, 'pending', 0, ?, ?, datetime('now'))`
	).run(tabella, String(recordId || ''), JSON.stringify(payload), errorMessage, userId)
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

	const online = await haInternet()
	if (!online || !supabase) {
		enqueueSync(database, tabella, localRecord.id, remotePayload, userId)
		return {
			data: localRecord,
			synced: false,
			queued: true,
		}
	}

	try {
		const { error } = await supabase.from(tabella).upsert(remotePayload)

		if (error) {
			enqueueSync(database, tabella, localRecord.id, remotePayload, userId, error.message)
			return {
				data: localRecord,
				synced: false,
				queued: true,
				error: error.message,
			}
		}

		return {
			data: localRecord,
			synced: true,
			queued: false,
		}
	} catch (error) {
		enqueueSync(database, tabella, localRecord.id, remotePayload, userId, error.message)
		return {
			data: localRecord,
			synced: false,
			queued: true,
			error: error.message,
		}
	}
}

function leggi(tabella, userId) {
	ensureValidTableName(tabella)

	if (!userId) {
		throw new Error('userId obbligatorio per la lettura')
	}

	return getDb()
		.prepare(`SELECT * FROM ${tabella} 
					WHERE user_id = ? OR user_id IS NULL 
					ORDER BY updated_at DESC, id DESC`)
		.all(userId)
}

function leggiPerId(tabella, id, userId) {
	ensureValidTableName(tabella)

	if (!userId) {
		throw new Error('userId obbligatorio per la lettura')
	}

	return getDb()
		.prepare(`SELECT * FROM ${tabella} 
					WHERE id = ? AND (user_id = ? OR user_id IS NULL)`)
		.get(id, userId) || null
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

	const online = await haInternet()
	if (!online || !supabase) {
		enqueueSync(database, tabella, id, { id, user_id: userId }, userId)
		database.prepare(
			`UPDATE coda_sync SET azione = 'delete' WHERE id = last_insert_rowid()`
		).run()
		return {
			deleted: true,
			synced: false,
			queued: true,
		}
	}

	try {
		const { error } = await supabase.from(tabella).delete().eq('id', id).eq('user_id', userId)

		if (error) {
			enqueueSync(database, tabella, id, { id, user_id: userId }, userId, error.message)
			database.prepare(
				`UPDATE coda_sync SET azione = 'delete' WHERE id = last_insert_rowid()`
			).run()
			return {
				deleted: true,
				synced: false,
				queued: true,
				error: error.message,
			}
		}

		return {
			deleted: true,
			synced: true,
			queued: false,
		}
	} catch (error) {
		enqueueSync(database, tabella, id, { id, user_id: userId }, userId, error.message)
		database.prepare(
			`UPDATE coda_sync SET azione = 'delete' WHERE id = last_insert_rowid()`
		).run()
		return {
			deleted: true,
			synced: false,
			queued: true,
			error: error.message,
		}
	}
}

module.exports = {
	getDb,
	salva,
	leggi,
	leggiPerId,
	elimina,
}
