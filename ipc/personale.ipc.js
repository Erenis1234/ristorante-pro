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

function getWeekRange(dateInput) {
	const baseDate = dateInput ? new Date(dateInput) : new Date()
	if (Number.isNaN(baseDate.getTime())) {
		throw new Error('Data settimana non valida')
	}

	baseDate.setHours(0, 0, 0, 0)
	const day = baseDate.getDay()
	const mondayOffset = day === 0 ? -6 : 1 - day
	const monday = new Date(baseDate)
	monday.setDate(baseDate.getDate() + mondayOffset)

	const sunday = new Date(monday)
	sunday.setDate(monday.getDate() + 6)

	return {
		start: monday.toISOString().slice(0, 10),
		end: sunday.toISOString().slice(0, 10),
	}
}

function mapTurnoRows(rows) {
	return rows.map(row => ({
		...row,
		dipendente: `${row.nome} ${row.cognome}`.trim(),
	}))
}

async function getPersonale() {
	const userId = getUserIdOrThrow()
	return dbManager
		.leggi('personale', userId)
		.sort((left, right) => `${left.cognome} ${left.nome}`.localeCompare(`${right.cognome} ${right.nome}`, 'it'))
}

async function addDipendente(dati) {
	const userId = getUserIdOrThrow()
	return dbManager.salva('personale', {
		nome: dati?.nome,
		cognome: dati?.cognome,
		ruolo: dati?.ruolo,
		telefono: dati?.telefono || null,
		email: dati?.email || null,
		stipendio: Number(dati?.stipendio ?? 0),
		attivo: 1,
	}, userId)
}

async function updateDipendente(dati) {
	const userId = getUserIdOrThrow()
	const esistente = dbManager.leggiPerId('personale', dati?.id, userId)

	if (!esistente) {
		throw new Error('Dipendente non trovato')
	}

	return dbManager.salva('personale', {
		id: dati.id,
		nome: dati?.nome ?? esistente.nome,
		cognome: dati?.cognome ?? esistente.cognome,
		ruolo: dati?.ruolo ?? esistente.ruolo,
		telefono: dati?.telefono ?? esistente.telefono,
		email: dati?.email ?? esistente.email,
		stipendio: dati?.stipendio !== undefined ? Number(dati.stipendio) : esistente.stipendio,
		attivo: dati?.attivo !== undefined ? Number(dati.attivo) : esistente.attivo,
	}, userId)
}

async function toggleAttivoDipendente(id) {
	const userId = getUserIdOrThrow()
	const dipendente = dbManager.leggiPerId('personale', id, userId)

	if (!dipendente) {
		throw new Error('Dipendente non trovato')
	}

	const nuovoValore = Number(dipendente.attivo) !== 0 ? 0 : 1

	await dbManager.salva('personale', { id, attivo: nuovoValore }, userId)

	// Se il dipendente viene disattivato, elimina tutti i suoi turni futuri
	if (nuovoValore === 0) {
		const db = getDb()
		const oggi = new Date().toISOString().slice(0, 10)
		db.prepare(`DELETE FROM turni WHERE personale_id = ? AND (user_id = ? OR user_id IS NULL) AND data >= ?`)
			.run(id, userId, oggi)
	}

	return dbManager.leggiPerId('personale', id, userId)
}

async function getTurniSettimana(data) {
	const userId = getUserIdOrThrow()
	const db = getDb()
	const { start, end } = getWeekRange(data)

	const rows = db.prepare(`
		SELECT
			t.id,
			t.personale_id,
			t.data,
			t.ora_inizio,
			t.ora_fine,
			t.ruolo_turno,
			t.note,
			p.nome,
			p.cognome,
			p.ruolo
		FROM turni t
		JOIN personale p ON p.id = t.personale_id
		WHERE (t.user_id = ? OR t.user_id IS NULL)
		  AND (p.user_id = ? OR p.user_id IS NULL)
		  AND p.attivo != 0
		  AND t.data BETWEEN ? AND ?
		ORDER BY t.data ASC, t.ora_inizio ASC, p.cognome ASC, p.nome ASC
	`).all(userId, userId, start, end)

	return {
		settimana: { start, end },
		turni: mapTurnoRows(rows),
	}
}

async function addTurno(dati) {
	const userId = getUserIdOrThrow()
	const dipendente = dbManager.leggiPerId('personale', dati?.personale_id, userId)

	if (!dipendente) {
		throw new Error('Dipendente non trovato')
	}

	return dbManager.salva('turni', {
		personale_id: dati.personale_id,
		data: dati.data,
		ora_inizio: dati.ora_inizio,
		ora_fine: dati.ora_fine,
		ruolo_turno: dati.ruolo_turno || dipendente.ruolo,
		note: dati.note || null,
	}, userId)
}

async function updateTurno(dati) {
	const userId = getUserIdOrThrow()
	const existing = dbManager.leggiPerId('turni', dati?.id, userId)
	if (!existing) throw new Error('Turno non trovato')

	return dbManager.salva('turni', {
		id: dati.id,
		personale_id: dati.personale_id ?? existing.personale_id,
		data: dati.data ?? existing.data,
		ora_inizio: dati.ora_inizio ?? existing.ora_inizio,
		ora_fine: dati.ora_fine ?? existing.ora_fine,
		ruolo_turno: dati.ruolo_turno !== undefined ? dati.ruolo_turno : existing.ruolo_turno,
		note: dati.note !== undefined ? dati.note : existing.note,
	}, userId)
}

async function deleteTurno(id) {
	const userId = getUserIdOrThrow()
	return dbManager.elimina('turni', id, userId)
}

async function getTurniDipendente(personaleId) {
	const userId = getUserIdOrThrow()
	const db = getDb()
	const dipendente = dbManager.leggiPerId('personale', personaleId, userId)

	if (!dipendente) {
		throw new Error('Dipendente non trovato')
	}

	const rows = db.prepare(`
		SELECT
			id,
			personale_id,
			data,
			ora_inizio,
			ora_fine,
			ruolo_turno,
			note,
			updated_at
		FROM turni
		WHERE personale_id = ? AND user_id = ?
		ORDER BY data DESC, ora_inizio DESC
	`).all(personaleId, userId)

	return {
		dipendente,
		turni: rows,
	}
}

function registerPersonaleIpcHandlers() {
	registerHandler('get-personale', async () => getPersonale())
	registerHandler('add-dipendente', async (_event, dati) => addDipendente(dati))
	registerHandler('update-dipendente', async (_event, dati) => updateDipendente(dati))
	registerHandler('toggle-attivo-dipendente', async (_event, id) => toggleAttivoDipendente(id))
	registerHandler('get-turni-settimana', async (_event, data) => getTurniSettimana(data))
	registerHandler('add-turno', async (_event, dati) => addTurno(dati))
	registerHandler('update-turno', async (_event, dati) => updateTurno(dati))
	registerHandler('delete-turno', async (_event, id) => deleteTurno(id))
	registerHandler('get-turni-dipendente', async (_event, personaleId) => getTurniDipendente(personaleId))
}

module.exports = {
	registerPersonaleIpcHandlers,
}
