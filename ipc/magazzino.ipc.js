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

function normalizeIngrediente(ingrediente) {
	return {
		...ingrediente,
		quantita: ingrediente.scorta,
		soglia_minima: ingrediente.scorta_min,
	}
}

function sortByCategoria(ingredienti) {
	return [...ingredienti].sort((left, right) => {
		const categoriaCompare = (left.categoria || '').localeCompare(right.categoria || '', 'it')
		if (categoriaCompare !== 0) {
			return categoriaCompare
		}

		return (left.nome || '').localeCompare(right.nome || '', 'it')
	})
}

function isEntroTreGiorni(scadenza) {
	if (!scadenza) {
		return false
	}

	const oggi = new Date()
	oggi.setHours(0, 0, 0, 0)

	const limite = new Date(oggi)
	limite.setDate(limite.getDate() + 3)

	const dataScadenza = new Date(scadenza)
	dataScadenza.setHours(0, 0, 0, 0)

	return dataScadenza >= oggi && dataScadenza <= limite
}

async function addMovimento(dati) {
	const userId = getUserIdOrThrow()
	const ingredienteId = dati?.ingrediente_id
	const tipo = dati?.tipo
	const quantita = Number(dati?.quantita ?? 0)

	if (!ingredienteId) {
		throw new Error('ingrediente_id obbligatorio')
	}

	if (!['carico', 'scarico'].includes(tipo)) {
		throw new Error('Il tipo movimento deve essere carico o scarico')
	}

	if (!Number.isFinite(quantita) || quantita <= 0) {
		throw new Error('quantita deve essere un numero positivo')
	}

	const ingrediente = dbManager.leggiPerId('ingredienti', ingredienteId, userId)
	if (!ingrediente) {
		throw new Error('Ingrediente non trovato')
	}

	const nuovaScorta = tipo === 'carico'
		? Number(ingrediente.scorta) + quantita
		: Number(ingrediente.scorta) - quantita

	if (nuovaScorta < 0) {
		throw new Error('Scorta insufficiente per registrare lo scarico')
	}

	const ingredienteAggiornato = await dbManager.salva('ingredienti', {
		id: ingredienteId,
		scorta: nuovaScorta,
	}, userId)

	const movimento = await dbManager.salva('movimenti_magazzino', {
		ingrediente_id: ingredienteId,
		tipo,
		quantita,
		nota: dati?.nota || null,
		data_movimento: dati?.data || new Date().toISOString(),
	}, userId)

	return {
		ingrediente: normalizeIngrediente(ingredienteAggiornato.data),
		movimento: movimento.data,
	}
}

function registerMagazzinoIpcHandlers() {
	registerHandler('get-ingredienti', async () => {
		const userId = getUserIdOrThrow()
		const ingredienti = dbManager.leggi('ingredienti', userId).map(normalizeIngrediente)
		return sortByCategoria(ingredienti)
	})

	registerHandler('add-ingrediente', async (_event, dati) => {
		const userId = getUserIdOrThrow()
		const { quantita, soglia_minima, ...resto } = dati || {}
		const result = await dbManager.salva('ingredienti', {
			...resto,
			scorta: quantita ?? resto.scorta ?? 0,
			scorta_min: soglia_minima ?? resto.scorta_min ?? 0,
			scadenza: resto.scadenza ?? null,
		}, userId)

		return {
			...result,
			data: normalizeIngrediente(result.data),
		}
	})

	registerHandler('update-ingrediente', async (_event, dati) => {
		const userId = getUserIdOrThrow()
		const { quantita, soglia_minima, ...resto } = dati || {}
		const result = await dbManager.salva('ingredienti', {
			...resto,
			scorta: quantita ?? resto.scorta,
			scorta_min: soglia_minima ?? resto.scorta_min,
			scadenza: resto.scadenza,
		}, userId)

		return {
			...result,
			data: normalizeIngrediente(result.data),
		}
	})

	registerHandler('delete-ingrediente', async (_event, id) => {
		const userId = getUserIdOrThrow()
		return dbManager.elimina('ingredienti', id, userId)
	})

	registerHandler('get-scorte-basse', async () => {
		const userId = getUserIdOrThrow()
		return sortByCategoria(
			dbManager
				.leggi('ingredienti', userId)
				.filter(ingrediente => Number(ingrediente.scorta) <= Number(ingrediente.scorta_min))
				.map(normalizeIngrediente)
		)
	})

	registerHandler('get-in-scadenza', async () => {
		const userId = getUserIdOrThrow()
		return sortByCategoria(
			dbManager
				.leggi('ingredienti', userId)
				.filter(ingrediente => isEntroTreGiorni(ingrediente.scadenza))
				.map(normalizeIngrediente)
		)
	})

	registerHandler('add-movimento', async (_event, dati) => addMovimento(dati))
}

module.exports = {
	registerMagazzinoIpcHandlers,
}
