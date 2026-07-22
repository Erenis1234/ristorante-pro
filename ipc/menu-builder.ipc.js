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

function getVociMenu(db, menuId, userId) {
	return db.prepare(`
		SELECT
			mv.id,
			mv.menu_id,
			mv.nome,
			mv.prezzo,
			mv.ordine,
			mv.user_id
		FROM menu_voci mv
		WHERE mv.menu_id = ? AND mv.user_id = ?
		ORDER BY mv.ordine ASC, mv.id ASC
	`).all(menuId, userId)
}

function buildMenuDettaglio(db, menu, userId) {
	return {
		id: menu.id,
		nome: menu.nome,
		descrizione: menu.descrizione || null,
		tipo: menu.tipo === 'settimanale' ? 'settimanale' : 'giornaliero',
		voci: getVociMenu(db, menu.id, userId),
		updated_at: menu.updated_at,
	}
}

function syncVociMenu(menuId, voci, userId) {
	const db = dbManager.getDb()

	// Transazione atomica: elimina e reinserisce tutte le voci in un unico
	// blocco, così un errore a metà non lascia il menu con voci parzialmente
	// cancellate o duplicate.
	db.transaction(() => {
		const esistenti = db.prepare(
			'SELECT id FROM menu_voci WHERE menu_id = ? AND user_id = ?'
		).all(menuId, userId)

		for (const voce of esistenti) {
			dbManager.eliminaLocale('menu_voci', voce.id, userId)
		}

		voci.forEach((voce, index) => {
			const nome = String(voce?.nome || '').trim()
			if (!nome) return

			dbManager.salvaLocale('menu_voci', {
				menu_id: menuId,
				nome,
				prezzo: Number(voce.prezzo ?? 0),
				ordine: Number.isFinite(Number(voce.ordine)) ? Number(voce.ordine) : index,
			}, userId)
		})
	})()
}

async function getMenu() {
	const userId = getUserIdOrThrow()
	const db = dbManager.getDb()
	const menuRows = dbManager.leggi('menu', userId)

	return menuRows.map(menu => buildMenuDettaglio(db, menu, userId))
}

async function addMenu(dati) {
	const userId = getUserIdOrThrow()
	const db = dbManager.getDb()
	const voci = Array.isArray(dati?.voci) ? dati.voci : []

	const menuResult = await dbManager.salva('menu', {
		nome: dati?.nome,
		descrizione: dati?.descrizione || null,
		tipo: dati?.tipo === 'settimanale' ? 'settimanale' : 'giornaliero',
	}, userId)

	syncVociMenu(menuResult.data.id, voci, userId)

	return buildMenuDettaglio(db, menuResult.data, userId)
}

async function updateMenu(dati) {
	const userId = getUserIdOrThrow()
	const db = dbManager.getDb()
	const existing = dbManager.leggiPerId('menu', dati?.id, userId)

	if (!existing) {
		throw new Error('Menu non trovato')
	}

	const voci = Array.isArray(dati?.voci) ? dati.voci : []
	const menuResult = await dbManager.salva('menu', {
		id: dati.id,
		nome: dati?.nome ?? existing.nome,
		descrizione: dati?.descrizione !== undefined ? dati.descrizione : existing.descrizione,
		tipo: dati?.tipo !== undefined ? (dati.tipo === 'settimanale' ? 'settimanale' : 'giornaliero') : existing.tipo,
	}, userId)

	syncVociMenu(menuResult.data.id, voci, userId)

	return buildMenuDettaglio(db, menuResult.data, userId)
}

async function deleteMenu(id) {
	const userId = getUserIdOrThrow()
	const db = dbManager.getDb()
	const voci = db.prepare(
		'SELECT id FROM menu_voci WHERE menu_id = ? AND user_id = ?'
	).all(id, userId)

	for (const voce of voci) {
		await dbManager.elimina('menu_voci', voce.id, userId)
	}

	return dbManager.elimina('menu', id, userId)
}

async function getMenuDettaglio(id) {
	const userId = getUserIdOrThrow()
	const db = dbManager.getDb()
	const menu = dbManager.leggiPerId('menu', id, userId)

	if (!menu) {
		throw new Error('Menu non trovato')
	}

	return buildMenuDettaglio(db, menu, userId)
}

function registerMenuBuilderIpcHandlers() {
	registerHandler('get-menu', async () => getMenu())
	registerHandler('add-menu', async (_event, dati) => addMenu(dati))
	registerHandler('update-menu', async (_event, dati) => updateMenu(dati))
	registerHandler('delete-menu', async (_event, id) => deleteMenu(id))
	registerHandler('get-menu-dettaglio', async (_event, id) => getMenuDettaglio(id))
}

module.exports = {
	registerMenuBuilderIpcHandlers,
}
