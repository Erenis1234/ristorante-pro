const { ipcMain } = require('electron')

const dbManager = require('../core/db-manager')
const auth = require('../core/auth')

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

async function toggleDisponibilePiatto(id) {
	const userId = getUserIdOrThrow()
	const piatto = dbManager.leggiPerId('piatti', id, userId)

	if (!piatto) {
		throw new Error('Piatto non trovato')
	}

	return dbManager.salva('piatti', {
		id,
		disponibile: piatto.disponibile ? 0 : 1,
	}, userId)
}

function registerMenuIpcHandlers() {
	registerHandler('get-categorie', async () => {
		const userId = getUserIdOrThrow()
		return dbManager.leggi('categorie', userId)
	})

	registerHandler('add-categoria', async (_event, dati) => {
		const userId = getUserIdOrThrow()
		return dbManager.salva('categorie', dati, userId)
	})

	registerHandler('update-categoria', async (_event, dati) => {
		const userId = getUserIdOrThrow()
		return dbManager.salva('categorie', dati, userId)
	})

	registerHandler('delete-categoria', async (_event, id) => {
		const userId = getUserIdOrThrow()
		return dbManager.elimina('categorie', id, userId)
	})

	registerHandler('get-piatti', async () => {
		const userId = getUserIdOrThrow()
		return dbManager.leggi('piatti', userId)
	})

	registerHandler('add-piatto', async (_event, dati) => {
		const userId = getUserIdOrThrow()
		return dbManager.salva('piatti', dati, userId)
	})

	registerHandler('update-piatto', async (_event, dati) => {
		const userId = getUserIdOrThrow()
		return dbManager.salva('piatti', dati, userId)
	})

	registerHandler('delete-piatto', async (_event, id) => {
		const userId = getUserIdOrThrow()
		return dbManager.elimina('piatti', id, userId)
	})

	registerHandler('toggle-disponibile-piatto', async (_event, id) => toggleDisponibilePiatto(id))
}

module.exports = {
	registerMenuIpcHandlers,
}
