const { ipcMain } = require('electron')

const auth = require('../core/auth')
const dbManager = require('../core/db-manager')

function registerHandler(channel, handler) {
	ipcMain.removeHandler(channel)
	ipcMain.handle(channel, handler)
}

function getUserIdOrThrow() {
	const utente = auth.getUtenteCorrente()
	const userId = utente?.id

	if (!userId) {
		throw new Error('Nessun utente loggato')
	}

	return userId
}

function getDb() {
	return dbManager.getDb()
}

function mapOrdineRighe(db, ordineId, userId) {
	return db.prepare(`
		SELECT
			ofr.id,
			ofr.ordine_id,
			ofr.ingrediente_id,
			ofr.ingrediente_nome,
			ofr.quantita,
			ofr.prezzo,
			ofr.quantita_ricevuta,
			ofr.totale
		FROM ordine_fornitore_righe ofr
		WHERE ofr.ordine_id = ? AND (ofr.user_id = ? OR ofr.user_id IS NULL)
		ORDER BY ofr.ingrediente_nome ASC
	`).all(ordineId, userId)
}

function mapOrdineRigheBatch(db, ordineIds, userId) {
	if (!Array.isArray(ordineIds) || ordineIds.length === 0) {
		return new Map()
	}

	const placeholders = ordineIds.map(() => '?').join(', ')
	const rows = db.prepare(`
		SELECT
			ofr.id,
			ofr.ordine_id,
			ofr.ingrediente_id,
			ofr.ingrediente_nome,
			ofr.quantita,
			ofr.prezzo,
			ofr.quantita_ricevuta,
			ofr.totale
		FROM ordine_fornitore_righe ofr
		WHERE (ofr.user_id = ? OR ofr.user_id IS NULL) AND ofr.ordine_id IN (${placeholders})
		ORDER BY ofr.ordine_id ASC, ofr.ingrediente_nome ASC
	`).all(userId, ...ordineIds)

	const map = new Map()
	for (const row of rows) {
		const ordineId = row.ordine_id
		if (!map.has(ordineId)) {
			map.set(ordineId, [])
		}
		map.get(ordineId).push(row)
	}
	return map
}

function mapOrdine(db, ordine, userId, righeByOrdineId = null) {
	return {
		...ordine,
		righe: righeByOrdineId ? (righeByOrdineId.get(ordine.id) || []) : mapOrdineRighe(db, ordine.id, userId),
	}
}

function syncRigheOrdine(ordineId, righe, userId) {
	const db = getDb()

	// Transazione atomica: elimina e reinserisce tutte le righe in un unico
	// blocco, cos\u00ec un errore a met\u00e0 non lascia l'ordine con righe parzialmente
	// cancellate o duplicate.
	db.transaction(() => {
		const esistenti = db.prepare(
			'SELECT id FROM ordine_fornitore_righe WHERE ordine_id = ? AND user_id = ?'
		).all(ordineId, userId)

		db.prepare(
			'DELETE FROM ordine_fornitore_righe WHERE ordine_id = ? AND user_id = ?'
		).run(ordineId, userId)

		for (const riga of esistenti) {
			dbManager.accodaSyncLocale(
				'ordine_fornitore_righe',
				riga.id,
				{ id: riga.id, user_id: userId },
				userId,
				'delete'
			)
		}

		const insertStmt = db.prepare(`
			INSERT INTO ordine_fornitore_righe (
				ordine_id,
				ingrediente_id,
				ingrediente_nome,
				quantita,
				prezzo,
				quantita_ricevuta,
				user_id,
				updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
		`)
		const getInsertedStmt = db.prepare(`
			SELECT
				id,
				ordine_id,
				ingrediente_id,
				ingrediente_nome,
				quantita,
				prezzo,
				quantita_ricevuta,
				totale,
				user_id,
				updated_at
			FROM ordine_fornitore_righe
			WHERE id = ? AND user_id = ?
		`)

		for (const riga of righe) {
			const nomeIngrediente = String(riga.ingrediente_nome || riga.ingrediente_id || '').trim()
			if (!nomeIngrediente) continue
			const ingredienteId = Number(riga.ingrediente_id)
			const inserted = insertStmt.run(
				ordineId,
				Number.isFinite(ingredienteId) ? ingredienteId : null,
				nomeIngrediente,
				Number(riga.quantita ?? 0),
				Number(riga.prezzo ?? 0),
				Number(riga.quantita_ricevuta ?? 0),
				userId
			)
			const localRecord = getInsertedStmt.get(inserted.lastInsertRowid, userId)
			dbManager.accodaSyncLocale(
				'ordine_fornitore_righe',
				localRecord.id,
				localRecord,
				userId,
				'upsert'
			)
		}
	})()
}

async function getOrdiniFornitori() {
	const userId = getUserIdOrThrow()
	const db = getDb()
	const ordini = db.prepare(`
		SELECT
			id,
			fornitore,
			stato,
			data_ordine,
			data_consegna_prevista,
			data_ricezione,
			note,
			totale,
			user_id,
			updated_at
		FROM ordini_fornitori
		WHERE user_id = ?
		ORDER BY data_ordine DESC, id DESC
	`).all(userId)
	const righeByOrdineId = mapOrdineRigheBatch(
		db,
		ordini.map(ordine => ordine.id),
		userId
	)

	return ordini.map(ordine => mapOrdine(db, ordine, userId, righeByOrdineId))
}

async function addOrdineFornitore(dati) {
	const userId = getUserIdOrThrow()
	const db = getDb()
	const righe = Array.isArray(dati?.ingredienti) ? dati.ingredienti : []
	const totale = righe.reduce((sum, riga) => sum + (Number(riga.quantita ?? 0) * Number(riga.prezzo ?? 0)), 0)

	const ordineResult = await dbManager.salva('ordini_fornitori', {
		fornitore: dati?.fornitore,
		stato: dati?.stato || 'inviato',
		data_ordine: dati?.data_ordine || new Date().toISOString().slice(0, 10),
		data_consegna_prevista: dati?.data_consegna_prevista || null,
		note: dati?.note || null,
		totale: Number(totale.toFixed(2)),
	}, userId)

	await syncRigheOrdine(ordineResult.data.id, righe, userId)
	return mapOrdine(db, ordineResult.data, userId)
}

async function updateStatoOrdine(id, stato) {
	const userId = getUserIdOrThrow()
	const ordine = dbManager.leggiPerId('ordini_fornitori', id, userId)

	if (!ordine) {
		throw new Error('Ordine fornitore non trovato')
	}

	if (!['inviato', 'ricevuto', 'parziale'].includes(stato)) {
		throw new Error('Stato ordine non valido')
	}

	const result = await dbManager.salva('ordini_fornitori', {
		id,
		stato,
		data_ricezione: stato === 'ricevuto' ? new Date().toISOString() : ordine.data_ricezione,
	}, userId)

	return mapOrdine(getDb(), result.data, userId)
}

async function deleteOrdine(id) {
	const userId = getUserIdOrThrow()
	// La FK ordine_fornitore_righe.ordine_id è ON DELETE CASCADE: eliminando
	// l'ordine padre vengono eliminate automaticamente tutte le righe figlie.
	return dbManager.elimina('ordini_fornitori', id, userId)
}

async function riceviOrdine(id) {
	const userId = getUserIdOrThrow()
	const db = getDb()
	const ordine = dbManager.leggiPerId('ordini_fornitori', id, userId)

	if (!ordine) {
		throw new Error('Ordine fornitore non trovato')
	}

	if (ordine.stato === 'ricevuto') {
		return mapOrdine(db, ordine, userId)
	}

	// Aggiorna quantita_ricevuta nelle righe (tracciamento interno ordini)
	const righe = mapOrdineRighe(db, id, userId)
	for (const riga of righe) {
		const quantitaRicevuta = Number(riga.quantita_ricevuta || riga.quantita || 0)
		await dbManager.salva('ordine_fornitore_righe', {
			id: riga.id,
			quantita_ricevuta: quantitaRicevuta,
		}, userId)
	}

	const ordineAggiornato = await dbManager.salva('ordini_fornitori', {
		id,
		stato: 'ricevuto',
		data_ricezione: new Date().toISOString(),
	}, userId)

	return mapOrdine(db, ordineAggiornato.data, userId)
}

function registerOrdiniIpcHandlers() {
	registerHandler('get-ordini-fornitori', async () => getOrdiniFornitori())
	registerHandler('add-ordine-fornitore', async (_event, dati) => addOrdineFornitore(dati))
	registerHandler('update-stato-ordine', async (_event, id, stato) => updateStatoOrdine(id, stato))
	registerHandler('delete-ordine', async (_event, id) => deleteOrdine(id))
	registerHandler('ricevi-ordine', async (_event, id) => riceviOrdine(id))
}

module.exports = {
	registerOrdiniIpcHandlers,
}
