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
		WHERE mv.menu_id = ? AND (mv.user_id = ? OR mv.user_id IS NULL)
		ORDER BY mv.ordine ASC, mv.id ASC
	`).all(menuId, userId)
}

function getVociMenuBatch(db, menuIds, userId) {
	if (!Array.isArray(menuIds) || menuIds.length === 0) {
		return new Map()
	}

	const placeholders = menuIds.map(() => '?').join(', ')
	const rows = db.prepare(`
		SELECT
			mv.id,
			mv.menu_id,
			mv.nome,
			mv.prezzo,
			mv.ordine,
			mv.user_id
		FROM menu_voci mv
		WHERE (mv.user_id = ? OR mv.user_id IS NULL) AND mv.menu_id IN (${placeholders})
		ORDER BY mv.menu_id ASC, mv.ordine ASC, mv.id ASC
	`).all(userId, ...menuIds)

	const map = new Map()
	for (const row of rows) {
		const menuId = row.menu_id
		if (!map.has(menuId)) {
			map.set(menuId, [])
		}
		map.get(menuId).push(row)
	}
	return map
}

function buildMenuDettaglio(db, menu, userId, vociByMenuId = null) {
	return {
		id: menu.id,
		nome: menu.nome,
		descrizione: menu.descrizione || null,
		tipo: menu.tipo === 'settimanale' ? 'settimanale' : 'giornaliero',
		voci: vociByMenuId ? (vociByMenuId.get(menu.id) || []) : getVociMenu(db, menu.id, userId),
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

		db.prepare('DELETE FROM menu_voci WHERE menu_id = ? AND user_id = ?')
			.run(menuId, userId)

		for (const voce of esistenti) {
			dbManager.accodaSyncLocale(
				'menu_voci',
				voce.id,
				{ id: voce.id, user_id: userId },
				userId,
				'delete'
			)
		}

		const insertStmt = db.prepare(`
			INSERT INTO menu_voci (
				menu_id,
				nome,
				prezzo,
				ordine,
				user_id,
				updated_at
			) VALUES (?, ?, ?, ?, ?, datetime('now'))
		`)
		const getInsertedStmt = db.prepare(`
			SELECT
				id,
				menu_id,
				nome,
				prezzo,
				ordine,
				user_id,
				updated_at
			FROM menu_voci
			WHERE id = ? AND user_id = ?
		`)

		voci.forEach((voce, index) => {
			const nome = String(voce?.nome || '').trim()
			if (!nome) return

			const inserted = insertStmt.run(
				menuId,
				nome,
				Number(voce.prezzo ?? 0),
				Number.isFinite(Number(voce.ordine)) ? Number(voce.ordine) : index,
				userId
			)
			const localRecord = getInsertedStmt.get(inserted.lastInsertRowid, userId)
			dbManager.accodaSyncLocale(
				'menu_voci',
				localRecord.id,
				localRecord,
				userId,
				'upsert'
			)
		})
	})()
}

async function getMenu() {
	const userId = getUserIdOrThrow()
	const db = dbManager.getDb()
	const menuRows = dbManager.leggi('menu', userId, [
		'id',
		'nome',
		'descrizione',
		'tipo',
		'user_id',
		'updated_at',
	])
	const vociByMenuId = getVociMenuBatch(
		db,
		menuRows.map(menu => menu.id),
		userId
	)

	return menuRows.map(menu => buildMenuDettaglio(db, menu, userId, vociByMenuId))
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
	// La FK menu_voci.menu_id è ON DELETE CASCADE: eliminando il menu padre
	// vengono rimosse automaticamente (in locale e remoto) tutte le voci figlie.
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
