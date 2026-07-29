const dns = require('dns').promises
const path = require('path')

const SYNC_INTERVAL_MS = 30 * 1000
const DEFAULT_TIMEOUT_MS = 3500

function logSupabaseBootstrapDiagnostic(context, reason) {
	const stack = new Error(reason).stack || ''
	const fileLine = stack.split('\n').find(line => /:\d+:\d+/.test(line)) || 'n/a'
	console.error(`[Supabase Diagnostic] ${context}`)
	console.error('[Supabase Diagnostic] - reason:', reason)
	console.error('[Supabase Diagnostic] - fileLine:', fileLine)
	console.error('[Supabase Diagnostic] - stack:', stack)
}

function formatSupabaseDiagnostic(context, error) {
	const normalizedError = error || {}
	const message = normalizedError.message || String(normalizedError)
	const stack = normalizedError.stack || ''
	const errorCode = normalizedError.code || normalizedError.status || null
	const fileLine = stack.split('\n').find(line => /\((.*:\d+:\d+)\)|at\s+.*:\d+:\d+/.test(line)) || null

	return {
		context,
		errorCode,
		message,
		stack,
		fileLine,
	}
}

function logSupabaseDiagnostic(context, diagnostic) {
	console.error(`[Supabase Diagnostic] ${context}`)
	console.error(`[Supabase Diagnostic] - errorCode: ${diagnostic.errorCode ?? 'n/a'}`)
	console.error(`[Supabase Diagnostic] - message: ${diagnostic.message}`)
	console.error(`[Supabase Diagnostic] - fileLine: ${diagnostic.fileLine || 'n/a'}`)
	console.error(`[Supabase Diagnostic] - stack: ${diagnostic.stack || 'n/a'}`)
}

function ensureValidTableName(tabella) {
	if (!/^[a-z_][a-z0-9_]*$/i.test(tabella)) {
		throw new Error(`Nome tabella non valido: ${tabella}`)
	}
}

async function controllaConnessione(supabaseClient = null, timeoutMs = DEFAULT_TIMEOUT_MS) {
	if (!supabaseClient) {
		const diagnostic = formatSupabaseDiagnostic('controllaConnessione', new Error('Client Supabase non disponibile'))
		logSupabaseDiagnostic('controllaConnessione', diagnostic)
		console.warn('[Sync] Controllo connessione fallito: client Supabase non disponibile.')
		return false
	}

	if (!supabaseClient.auth || typeof supabaseClient.auth.getSession !== 'function') {
		const diagnostic = formatSupabaseDiagnostic('controllaConnessione', new Error('Client Supabase senza auth.getSession'))
		logSupabaseDiagnostic('controllaConnessione', diagnostic)
		console.warn('[Sync] Controllo connessione fallito: client Supabase senza auth.getSession.')
		return false
	}

	try {
		const sessionResult = await Promise.race([
			supabaseClient.auth.getSession(),
			new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
		])

		if (sessionResult?.error) {
			const diagnostic = formatSupabaseDiagnostic('auth.getSession', sessionResult.error)
			logSupabaseDiagnostic('auth.getSession', diagnostic)
			return false
		}

		console.log('[Sync] Controllo connessione Supabase OK. Sessione:', sessionResult?.data?.session ? 'presente' : 'assente')
		return true
	} catch (error) {
		const diagnostic = formatSupabaseDiagnostic('auth.getSession', error)
		logSupabaseDiagnostic('auth.getSession', diagnostic)

		try {
			await dns.lookup('google.com')
			console.log('[Sync] DNS lookup OK, ma il check Supabase è fallito.')
		} catch (_dnsError) {
			const dnsDiagnostic = formatSupabaseDiagnostic('dns.lookup', _dnsError)
			logSupabaseDiagnostic('dns.lookup', dnsDiagnostic)
			console.warn('[Sync] DNS lookup fallito:', _dnsError?.message || _dnsError)
		}

		return false
	}
}

async function getSupabaseConnectionStatus(supabaseClient = null, timeoutMs = DEFAULT_TIMEOUT_MS) {
	if (!supabaseClient) {
		return {
			configured: false,
			online: false,
			label: 'Supabase offline',
			reason: 'Client Supabase non disponibile',
		}
	}

	if (!supabaseClient.auth || typeof supabaseClient.auth.getSession !== 'function') {
		return {
			configured: false,
			online: false,
			label: 'Supabase offline',
			reason: 'Client Supabase senza auth.getSession',
		}
	}

	const online = await controllaConnessione(supabaseClient, timeoutMs)
	return {
		configured: true,
		online,
		label: online ? 'Supabase online' : 'Supabase offline',
		reason: online ? 'auth.getSession completato con successo' : 'auth.getSession non riuscito',
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
		const online = await controllaConnessione(supabase)
		if (!online) {
			return
		}

		try {
			await syncCoda(db, supabase, userId)
		} catch (error) {
			console.error('[Sync] Sync automatica fallita:', error?.message || error)
		}
	}, SYNC_INTERVAL_MS)
}

module.exports = {
	controllaConnessione,
	getSupabaseConnectionStatus,
	formatSupabaseDiagnostic,
	syncCoda,
	avviaSyncAutomatica,
}
