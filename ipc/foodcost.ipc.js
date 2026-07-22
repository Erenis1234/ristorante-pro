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

function getIngredientiPiatto(db, piattoId, userId) {
	return db.prepare(`
		SELECT
			pi.id,
			pi.piatto_id,
			pi.ingrediente_id,
			pi.quantita,
			pi.unita_misura,
			i.nome AS ingrediente_nome,
			i.prezzo_kg,
			i.categoria AS ingrediente_categoria,
			i.unita_misura AS ingrediente_unita_misura
		FROM piatto_ingredienti pi
		JOIN ingredienti i ON i.id = pi.ingrediente_id
		WHERE pi.piatto_id = ? AND (pi.user_id = ? OR pi.user_id IS NULL) AND (i.user_id = ? OR i.user_id IS NULL)
		ORDER BY i.nome ASC
	`).all(piattoId, userId, userId).map(row => {
		const costoUnitario = ['g', 'ml'].includes((row.unita_misura || '').toLowerCase())
			? Number(row.prezzo_kg || 0) / 1000
			: Number(row.prezzo_kg || 0)

		return {
			...row,
			costo_unitario: round(costoUnitario, 4),
			costo_totale: round(calculateIngredientCost(row.quantita, row.unita_misura, row.prezzo_kg), 4),
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

function buildFoodCostRecord(db, piatto, userId, prezzoOverride) {
	const ingredienti = getIngredientiPiatto(db, piatto.id, userId)
	const prezzoVendita = prezzoOverride !== undefined ? Number(prezzoOverride) : Number(piatto.prezzo || 0)
	const costoIngredienti = round(
		ingredienti.reduce((sum, ingrediente) => sum + Number(ingrediente.costo_totale || 0), 0),
		3
	)
	const margine = round(prezzoVendita - costoIngredienti, 2)
	const percentuale = prezzoVendita > 0
		? round((costoIngredienti / prezzoVendita) * 100, 2)
		: null

	return {
		piatto_id: piatto.id,
		piatto_nome: piatto.nome,
		categoria_nome: piatto.categoria_nome,
		disponibile: piatto.disponibile,
		prezzo_vendita: round(prezzoVendita, 2),
		costo_ingredienti: costoIngredienti,
		margine,
		percentuale,
		food_cost_pct: percentuale,
		stato: getStatoFoodCost(percentuale),
		ingredienti,
	}
}

function getPiattiQuery(db, userId, piattoId = null) {
	const hasPiatto = piattoId !== null && piattoId !== undefined
	const wherePiatto = hasPiatto ? 'AND p.id = ?' : ''
	const params = hasPiatto ? [userId, userId, piattoId] : [userId, userId]

	return db.prepare(`
		SELECT
			p.id,
			p.nome,
			p.prezzo,
			p.disponibile,
			c.nome AS categoria_nome
		FROM piatti p
		LEFT JOIN categorie c ON c.id = p.categoria_id AND (c.user_id = ? OR c.user_id IS NULL)
		WHERE (p.user_id = ? OR p.user_id IS NULL) ${wherePiatto}
		ORDER BY c.ordine, p.nome
	`).all(...params)
}

async function getFoodcostTutti() {
	const userId = getUserIdOrThrow()
	const db = getDb()
	const piatti = getPiattiQuery(db, userId)

	return piatti.map(piatto => buildFoodCostRecord(db, piatto, userId))
}

async function getFoodcostPiatto(piattoId) {
	const userId = getUserIdOrThrow()
	const db = getDb()
	const piatto = getPiattiQuery(db, userId, piattoId)[0]

	if (!piatto) {
		throw new Error('Piatto non trovato')
	}

	return buildFoodCostRecord(db, piatto, userId)
}

async function simulaPrezzo(piattoId, nuovoPrezzo) {
	const userId = getUserIdOrThrow()
	const db = getDb()
	const piatto = getPiattiQuery(db, userId, piattoId)[0]

	if (!piatto) {
		throw new Error('Piatto non trovato')
	}

	const simulazione = buildFoodCostRecord(db, piatto, userId, nuovoPrezzo)

	return {
		piatto_id: simulazione.piatto_id,
		piatto_nome: simulazione.piatto_nome,
		prezzo_attuale: round(Number(piatto.prezzo || 0), 2),
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
		// 1. Crea il piatto
		const now = db.prepare("SELECT datetime('now') AS now").get().now
		const piattoResult = db.prepare(`
			INSERT INTO piatti (nome, prezzo, disponibile, user_id, updated_at)
			VALUES (?, ?, 1, ?, ?)
		`).run(nome, Number(prezzo) || 0, userId, now)
		const piattoId = piattoResult.lastInsertRowid

		// 2. Per ogni ingrediente: trova/crea per questo utente + inserisci in piatto_ingredienti
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

			// Inserisci piatto_ingredienti (quantita=1, unita_misura='pz' → costo_totale = prezzo_kg)
			db.prepare(`
				INSERT OR IGNORE INTO piatto_ingredienti (piatto_id, ingrediente_id, quantita, unita_misura, user_id, updated_at)
				VALUES (?, ?, 1, 'pz', ?, ?)
			`).run(piattoId, ingId, userId, now)
		}
	})()

	// Ritorna il food cost calcolato del piatto appena creato
	const piatto = db.prepare(`SELECT * FROM piatti WHERE nome = ? AND user_id = ? ORDER BY id DESC LIMIT 1`).get(nome, userId)
	if (!piatto) throw new Error('Errore creazione piatto')
	return buildFoodCostRecord(db, piatto, userId)
}

function registerFoodcostIpcHandlers() {
	registerHandler('get-foodcost-tutti', async () => getFoodcostTutti())
	registerHandler('get-foodcost-piatto', async (_event, piattoId) => getFoodcostPiatto(piattoId))
	registerHandler('simula-prezzo', async (_event, piattoId, nuovoPrezzo) => simulaPrezzo(piattoId, nuovoPrezzo))
	registerHandler('salva-simulazione-foodcost', async (_event, dati) => salvaSimulazioneFoodcost(dati))
}

module.exports = {
	registerFoodcostIpcHandlers,
}
