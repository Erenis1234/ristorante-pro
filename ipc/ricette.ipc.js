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

// Funzioni calculateIngredientCost e factorForUnit non più necessarie - ricette
// sono indipendenti dal magazzino

function getRecipeIngredients(db, ricettaId, userId) {
	return db.prepare(`
		SELECT
			ri.id,
			ri.ricetta_id,
			ri.ingrediente_id,
			ri.nome,
			ri.quantita,
			ri.unita_misura,
			ri.note,
			ri.user_id
		FROM ricetta_ingredienti ri
		WHERE ri.ricetta_id = ? AND ri.user_id = ?
		ORDER BY ri.nome ASC
	`).all(ricettaId, userId)
		.map(row => ({
			...row,
			costo: 0,
		}))
}

function buildRicettaDettaglio(db, ricetta, userId) {
	const ingredienti = getRecipeIngredients(db, ricetta.id, userId)

	return {
		id: ricetta.id,
		nome: ricetta.nome,
		porzioni: ricetta.porzioni,
		tempo_preparazione: ricetta.tempo_preparazione,
		temperatura: ricetta.temperatura || null,
		categoria: ricetta.categoria || null,
		foto: ricetta.foto || null,
		ingredienti,
		updated_at: ricetta.updated_at,
	}
}

function saveRecipeIngredients(db, ricettaId, ingredienti, userId) {
	// Transazione atomica: elimina e reinserisce gli ingredienti in un unico
	// blocco, cos\u00ec un errore a met\u00e0 non lascia la ricetta con ingredienti
	// parzialmente cancellati o duplicati.
	db.transaction(() => {
		const currentRows = db.prepare(
			'SELECT id FROM ricetta_ingredienti WHERE ricetta_id = ? AND user_id = ?'
		).all(ricettaId, userId)

		for (const row of currentRows) {
			dbManager.eliminaLocale('ricetta_ingredienti', row.id, userId)
		}

		for (const ingrediente of ingredienti) {
			const nome = String(
				ingrediente.nome || ingrediente.ingrediente_nome || ''
			).trim()
			if (!nome) continue

			dbManager.salvaLocale('ricetta_ingredienti', {
				ricetta_id: ricettaId,
				ingrediente_id: null,
				nome,
				quantita: ingrediente.quantita,
				unita_misura: ingrediente.unita_misura || 'g',
				note: ingrediente.note || null,
			}, userId)
		}
	})()
}

async function getRicette() {
	const userId = getUserIdOrThrow()
	const db = dbManager.getDb()
	const ricette = dbManager.leggi('ricette', userId)

	return ricette.map(ricetta => ({
		...ricetta,
		ingredienti: getRecipeIngredients(db, ricetta.id, userId),
	}))
}

async function addRicetta(dati) {
	const userId = getUserIdOrThrow()
	const db = dbManager.getDb()
	const ingredienti = Array.isArray(dati?.ingredienti) ? dati.ingredienti : []

	const ricettaResult = await dbManager.salva('ricette', {
		nome: dati?.nome,
		porzioni: dati?.porzioni ?? 1,
		tempo_preparazione: dati?.tempo_preparazione ?? 20,
		temperatura: dati?.temperatura || null,
		categoria: dati?.categoria || null,
		foto: dati?.foto || null,
	}, userId)

	await saveRecipeIngredients(db, ricettaResult.data.id, ingredienti, userId)

	return buildRicettaDettaglio(db, ricettaResult.data, userId)
}

async function updateRicetta(dati) {
	const userId = getUserIdOrThrow()
	const db = dbManager.getDb()
	const existing = dbManager.leggiPerId('ricette', dati?.id, userId)

	if (!existing) {
		throw new Error('Ricetta non trovata')
	}

	const ingredienti = Array.isArray(dati?.ingredienti) ? dati.ingredienti : []
	const ricettaResult = await dbManager.salva('ricette', {
		id: dati.id,
		nome: dati?.nome ?? existing.nome,
		porzioni: dati?.porzioni ?? existing.porzioni,
		tempo_preparazione: dati?.tempo_preparazione ?? existing.tempo_preparazione,
		temperatura: dati?.temperatura !== undefined ? dati.temperatura : existing.temperatura,
		categoria: dati?.categoria !== undefined ? dati.categoria : existing.categoria,
		foto: dati?.foto !== undefined ? dati.foto : existing.foto,
	}, userId)

	await saveRecipeIngredients(db, ricettaResult.data.id, ingredienti, userId)

	return buildRicettaDettaglio(db, ricettaResult.data, userId)
}

async function deleteRicetta(id) {
	const userId = getUserIdOrThrow()
	const db = dbManager.getDb()
	const righe = db.prepare(
		'SELECT id FROM ricetta_ingredienti WHERE ricetta_id = ? AND user_id = ?'
	).all(id, userId)

	for (const riga of righe) {
		await dbManager.elimina('ricetta_ingredienti', riga.id, userId)
	}

	return dbManager.elimina('ricette', id, userId)
}

async function getRicettaDettaglio(id) {
	const userId = getUserIdOrThrow()
	const db = dbManager.getDb()
	const ricetta = dbManager.leggiPerId('ricette', id, userId)

	if (!ricetta) {
		throw new Error('Ricetta non trovata')
	}

	return buildRicettaDettaglio(db, ricetta, userId)
}

function registerRicetteIpcHandlers() {
	registerHandler('get-ricette', async () => getRicette())
	registerHandler('add-ricetta', async (_event, dati) => addRicetta(dati))
	registerHandler('update-ricetta', async (_event, dati) => updateRicetta(dati))
	registerHandler('delete-ricetta', async (_event, id) => deleteRicetta(id))
	registerHandler('get-ricetta-dettaglio', async (_event, id) => getRicettaDettaglio(id))
}

module.exports = {
	registerRicetteIpcHandlers,
}
