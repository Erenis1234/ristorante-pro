const dns = require('dns').promises

const SYNC_INTERVAL_MS = 30 * 1000

function ensureValidTableName(tabella) {
	if (!/^[a-z_][a-z0-9_]*$/i.test(tabella)) {
		throw new Error(`Nome tabella non valido: ${tabella}`)
	}
}

async function controllaConnessione() {
	try {
		await dns.lookup('google.com')
		return true
	} catch (_error) {
		return false
	}
}

function parsePayload(payload) {
	if (!payload) {
		return null
	}

	try {
		return JSON.parse(payload)
	} catch (_error) {
		return null
	}
}

function isRemoteMoreRecent(remoteRecord, localRecord) {
	if (!remoteRecord?.updated_at) {
		return false
	}

	if (!localRecord?.updated_at) {
		return true
	}

	return new Date(remoteRecord.updated_at).getTime() > new Date(localRecord.updated_at).getTime()
}

function upsertLocalRecord(db, tabella, record, userId) {
	const payload = {
		...record,
		user_id: userId,
	}

	const entries = Object.entries(payload).filter(([, value]) => value !== undefined)
	const hasId = payload.id !== undefined && payload.id !== null

	if (hasId) {
		const existing = db.prepare(`SELECT id FROM ${tabella} WHERE id = ? AND user_id = ?`).get(payload.id, userId)

		if (existing) {
			const updateEntries = entries.filter(([key]) => key !== 'id')
			const setClause = updateEntries.map(([key]) => `${key} = ?`).join(', ')
			const values = updateEntries.map(([, value]) => value)

			db.prepare(`UPDATE ${tabella} SET ${setClause} WHERE id = ? AND user_id = ?`).run(...values, payload.id, userId)
			return
		}
	}

	const columns = entries.map(([key]) => key)
	const placeholders = columns.map(() => '?').join(', ')
	const values = entries.map(([, value]) => value)

	db.prepare(`INSERT INTO ${tabella} (${columns.join(', ')}) VALUES (${placeholders})`).run(...values)
}

async function syncCoda(db, supabase, userId) {
	if (!userId) {
		throw new Error('userId obbligatorio per la sincronizzazione')
	}

	const queue = db
		.prepare(
			`SELECT * FROM coda_sync WHERE user_id = ? AND sincronizzato = 0 ORDER BY id ASC`
		)
		.all(userId)

	const result = {
		processed: 0,
		synced: 0,
		failed: 0,
	}

	for (const item of queue) {
		result.processed += 1
		ensureValidTableName(item.entita)

		const payload = parsePayload(item.payload)
		if (!payload) {
			db.prepare(
				`UPDATE coda_sync
				 SET tentativi = tentativi + 1, stato = 'error', ultimo_errore = ?, updated_at = datetime('now')
				 WHERE id = ?`
			).run('Payload coda_sync non valido', item.id)
			result.failed += 1
			continue
		}

		try {
			const { data: remoteRecord, error: remoteError } = await supabase
				.from(item.entita)
				.select('*')
				.eq('id', payload.id)
				.eq('user_id', userId)
				.maybeSingle()

			if (remoteError) {
				throw remoteError
			}

			if (isRemoteMoreRecent(remoteRecord, payload)) {
				upsertLocalRecord(db, item.entita, remoteRecord, userId)
			} else {
				const { error: upsertError } = await supabase.from(item.entita).upsert({
					...payload,
					user_id: userId,
				})

				if (upsertError) {
					throw upsertError
				}
			}

			db.prepare(
				`UPDATE coda_sync
				 SET sincronizzato = 1,
				     stato = 'synced',
				     ultimo_errore = NULL,
				     sincronizzato_il = datetime('now'),
				     updated_at = datetime('now')
				 WHERE id = ?`
			).run(item.id)
			result.synced += 1
		} catch (error) {
			db.prepare(
				`UPDATE coda_sync
				 SET tentativi = tentativi + 1,
				     stato = 'error',
				     ultimo_errore = ?,
				     updated_at = datetime('now')
				 WHERE id = ?`
			).run(error.message, item.id)
			result.failed += 1
		}
	}

	return result
}

function avviaSyncAutomatica(db, supabase, userId) {
	return setInterval(async () => {
		const online = await controllaConnessione()
		if (!online) {
			return
		}

		try {
			await syncCoda(db, supabase, userId)
		} catch (_error) {
			// Errore intenzionalmente ignorato: il prossimo ciclo ritentera la sync.
		}
	}, SYNC_INTERVAL_MS)
}

module.exports = {
	controllaConnessione,
	syncCoda,
	avviaSyncAutomatica,
}
