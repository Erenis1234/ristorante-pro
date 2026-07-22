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

function round(value, decimals = 2) {
	const factor = 10 ** decimals
	return Math.round(Number(value || 0) * factor) / factor
}

function calculateIngredientCost(quantita, unitaMisura, prezzoKg) {
	switch ((unitaMisura || '').toLowerCase()) {
		case 'kg':
		case 'l':
		case 'pz':
			return Number(quantita || 0) * Number(prezzoKg || 0)
		case 'g':
		case 'ml':
			return Number(quantita || 0) * Number(prezzoKg || 0) / 1000
		default:
			return Number(quantita || 0) * Number(prezzoKg || 0)
	}
}

function getDb() {
	return dbManager.getDb()
}

function getIngredientiRicetta(db, ricettaId, userId) {
	return db.prepare(`
		SELECT
			ri.id,
			ri.ricetta_id,
			ri.ingrediente_id,
			ri.nome,
			ri.quantita,
			ri.unita_misura,
			i.nome AS ingrediente_nome,
			i.prezzo_kg,
			i.categoria AS ingrediente_categoria
		FROM ricetta_ingredienti ri
		LEFT JOIN ingredienti i ON i.id = ri.ingrediente_id AND (i.user_id = ? OR i.user_id IS NULL)
		WHERE ri.ricetta_id = ? AND (ri.user_id = ? OR ri.user_id IS NULL)
		ORDER BY ri.nome ASC
	`).all(userId, ricettaId, userId).map(row => {
		// prezzo_kg è null se l'ingrediente non è collegato al catalogo (testo libero): costo 0
		const prezzoKg = row.prezzo_kg !== null && row.prezzo_kg !== undefined ? row.prezzo_kg : 0
		const costoUnitario = ['g', 'ml'].includes((row.unita_misura || '').toLowerCase())
			? Number(prezzoKg) / 1000
			: Number(prezzoKg)

		return {
			...row,
			ingrediente_nome: row.ingrediente_nome || row.nome,
			costo_unitario: round(costoUnitario, 4),
			costo_totale: round(calculateIngredientCost(row.quantita, row.unita_misura, prezzoKg), 4),
		}
	})
}

function getStatoFoodCost(percentuale) {
	if (percentuale === null) {
		return 'no_prezzo'
	}

	if (percentuale <= 25) {
		return 'ottimo'
	}

	if (percentuale <= 33) {
		return 'buono'
	}

	if (percentuale <= 40) {
		return 'attenzione'
	}

	return 'critico'
}

function buildFoodCostRecord(db, ricetta, userId, prezzoOverride) {
	const ingredienti = getIngredientiRicetta(db, ricetta.id, userId)
	const porzioni = Number(ricetta.porzioni) > 0 ? Number(ricetta.porzioni) : 1
	const prezzoVendita = prezzoOverride !== undefined ? Number(prezzoOverride) : Number(ricetta.prezzo_vendita || 0)
	const costoTotaleRicetta = round(
		ingredienti.reduce((sum, ingrediente) => sum + Number(ingrediente.costo_totale || 0), 0),
		3
	)
	const costoPerPorzione = round(costoTotaleRicetta / porzioni, 3)
	const margine = round(prezzoVendita - costoPerPorzione, 2)
	const percentuale = prezzoVendita > 0
		? round((costoPerPorzione / prezzoVendita) * 100, 2)
		: null

	return {
		ricetta_id: ricetta.id,
		ricetta_nome: ricetta.nome,
		categoria: ricetta.categoria,
		porzioni,
		prezzo_vendita: round(prezzoVendita, 2),
		costo_ingredienti: costoPerPorzione,
		costo_totale_ricetta: costoTotaleRicetta,
		margine,
		percentuale,
		food_cost_pct: percentuale,
		stato: getStatoFoodCost(percentuale),
		ingredienti,
	}
}

function getRicetteQuery(db, userId, ricettaId = null) {
	const hasRicetta = ricettaId !== null && ricettaId !== undefined
	const whereRicetta = hasRicetta ? 'AND r.id = ?' : ''
	const params = hasRicetta ? [userId, ricettaId] : [userId]

	return db.prepare(`
		SELECT
			r.id,
			r.nome,
			r.porzioni,
			r.categoria,
			r.prezzo_vendita
		FROM ricette r
		WHERE (r.user_id = ? OR r.user_id IS NULL) ${whereRicetta}
		ORDER BY r.categoria, r.nome
	`).all(...params)
}

async function getFoodcostTutti() {
	const userId = getUserIdOrThrow()
	const db = getDb()
	const ricette = getRicetteQuery(db, userId)

	return ricette.map(ricetta => buildFoodCostRecord(db, ricetta, userId))
}

async function getFoodcostRicetta(ricettaId) {
	const userId = getUserIdOrThrow()
	const db = getDb()
	const ricetta = getRicetteQuery(db, userId, ricettaId)[0]

	if (!ricetta) {
		throw new Error('Ricetta non trovata')
	}

	return buildFoodCostRecord(db, ricetta, userId)
}

async function simulaPrezzo(ricettaId, nuovoPrezzo) {
	const userId = getUserIdOrThrow()
	const db = getDb()
	const ricetta = getRicetteQuery(db, userId, ricettaId)[0]

	if (!ricetta) {
		throw new Error('Ricetta non trovata')
	}

	const simulazione = buildFoodCostRecord(db, ricetta, userId, nuovoPrezzo)

	return {
		ricetta_id: simulazione.ricetta_id,
		ricetta_nome: simulazione.ricetta_nome,
		prezzo_attuale: round(Number(ricetta.prezzo_vendita || 0), 2),
		nuovo_prezzo: round(Number(nuovoPrezzo || 0), 2),
		costo_ingredienti: simulazione.costo_ingredienti,
		margine: simulazione.margine,
		percentuale: simulazione.percentuale,
		food_cost_pct: simulazione.food_cost_pct,
		stato: simulazione.stato,
	}
}

async function salvaSimulazioneFoodcost({ nome, prezzo, ingredienti }) {
	const userId = getUserIdOrThrow()
	const db = getDb()

	db.transaction(() => {
		// 1. Crea la ricetta (porzioni=1: il simulatore non gestisce il numero di porzioni)
		const now = db.prepare("SELECT datetime('now') AS now").get().now
		const ricettaResult = db.prepare(`
			INSERT INTO ricette (nome, porzioni, prezzo_vendita, user_id, updated_at)
			VALUES (?, 1, ?, ?, ?)
		`).run(nome, Number(prezzo) || 0, userId, now)
		const ricettaId = ricettaResult.lastInsertRowid

		// 2. Per ogni ingrediente: trova/crea per questo utente + collega in ricetta_ingredienti
		for (const ing of (ingredienti || [])) {
			const ingNome = String(ing.nome || '').trim()
			const costo = Number(ing.costo) || 0
			if (!ingNome) continue

			// Cerca ingrediente esistente solo per questo utente (evita di toccare dati di altri utenti)
			const existingIng = db.prepare(
				`SELECT id FROM ingredienti WHERE lower(nome) = lower(?) AND user_id = ? LIMIT 1`
			).get(ingNome, userId)

			let ingId
			if (existingIng) {
				db.prepare(`UPDATE ingredienti SET prezzo_kg = ?, updated_at = ? WHERE id = ?`)
					.run(costo, now, existingIng.id)
				ingId = existingIng.id
			} else {
				const ins = db.prepare(`
					INSERT INTO ingredienti (nome, prezzo_kg, unita_misura, scorta, scorta_min, categoria, user_id, updated_at)
					VALUES (?, ?, 'pz', 0, 0, 'Simulazione', ?, ?)
				`).run(ingNome, costo, userId, now)
				ingId = ins.lastInsertRowid
			}

			// Collega l'ingrediente alla ricetta (quantita=1, unita_misura='pz' → costo_totale = prezzo_kg)
			db.prepare(`
				INSERT INTO ricetta_ingredienti (ricetta_id, ingrediente_id, nome, quantita, unita_misura, user_id, updated_at)
				VALUES (?, ?, ?, 1, 'pz', ?, ?)
			`).run(ricettaId, ingId, ingNome, userId, now)
		}
	})()

	// Ritorna il food cost calcolato della ricetta appena creata
	const ricetta = db.prepare(`SELECT * FROM ricette WHERE nome = ? AND user_id = ? ORDER BY id DESC LIMIT 1`).get(nome, userId)
	if (!ricetta) throw new Error('Errore creazione ricetta')
	return buildFoodCostRecord(db, ricetta, userId)
}

function registerFoodcostIpcHandlers() {
	registerHandler('get-foodcost-tutti', async () => getFoodcostTutti())
	registerHandler('get-foodcost-ricetta', async (_event, ricettaId) => getFoodcostRicetta(ricettaId))
	registerHandler('simula-prezzo', async (_event, ricettaId, nuovoPrezzo) => simulaPrezzo(ricettaId, nuovoPrezzo))
	registerHandler('salva-simulazione-foodcost', async (_event, dati) => salvaSimulazioneFoodcost(dati))
}

module.exports = {
	registerFoodcostIpcHandlers,
}
