'use strict'

// Test minimi sul livello dati condiviso (core/db-manager.js). Ogni IPC
// handler (menu, magazzino, ricette, ordini, food cost, personale) passa da
// qui: un fix in un modulo che rompe queste convenzioni (isolamento per
// user_id, upsert, validazione nome tabella, coda_sync) si ripercuote su
// tutti gli altri. Eseguiti con `npm test` (test runner nativo di Node,
// nessuna dipendenza aggiuntiva).
//
// core/db-manager.js chiama `app.getPath('userData')` di Electron per
// individuare il file del DB. Qui i test girano con `node`, non con
// `electron`, quindi il modulo 'electron' non espone quell'API: lo
// sostituiamo in cache con uno stub minimale prima che db-manager.js venga
// richiesto per la prima volta.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ristorante-pro-test-'))
const electronPath = require.resolve('electron')
require.cache[electronPath] = {
	id: electronPath,
	filename: electronPath,
	loaded: true,
	exports: { app: { getPath: () => tmpDir } },
}

const assert = require('node:assert/strict')
const { test, before, beforeEach, after } = require('node:test')

const dbManager = require('./db-manager')

const USER_A = 'test-user-a'
const USER_B = 'test-user-b'

function pulisciTabelle(db) {
	db.exec(`
		DELETE FROM ingredienti;
		DELETE FROM movimenti_magazzino;
		DELETE FROM menu_voci;
		DELETE FROM menu;
		DELETE FROM coda_sync;
	`)
}

before(() => {
	dbManager.getDb() // crea/apre il DB e le tabelle (createTables è idempotente)
})

beforeEach(() => {
	pulisciTabelle(dbManager.getDb())
})

after(() => {
	dbManager.getDb().close() // su Windows non si può rimuovere un file SQLite ancora aperto
	fs.rmSync(tmpDir, { recursive: true, force: true })
})

test('salva()/elimina() rifiutano nomi tabella non validi (protezione da SQL injection)', async () => {
	await assert.rejects(
		() => dbManager.salva('ingredienti; DROP TABLE ingredienti;--', { nome: 'x' }, USER_A),
		/Nome tabella non valido/
	)
	await assert.rejects(
		() => dbManager.elimina('ingredienti; DROP TABLE ingredienti;--', 1, USER_A),
		/Nome tabella non valido/
	)
})

test('salva()/elimina() richiedono sempre un userId', async () => {
	await assert.rejects(() => dbManager.salva('ingredienti', { nome: 'x' }, null), /userId obbligatorio/)
	await assert.rejects(() => dbManager.elimina('ingredienti', 1, null), /userId obbligatorio/)
})

test('salvaLocale(): inserisce un nuovo record e lo accoda in coda_sync', () => {
	const risultato = dbManager.salvaLocale('ingredienti', { nome: 'Farina 00', unita_misura: 'kg', scorta: 10 }, USER_A)

	assert.equal(risultato.queued, true)
	assert.equal(risultato.data.nome, 'Farina 00')
	assert.equal(risultato.data.user_id, USER_A)
	assert.ok(risultato.data.id > 0)

	const coda = dbManager.getDb()
		.prepare(`SELECT * FROM coda_sync WHERE entita = 'ingredienti' AND record_id = ?`)
		.get(String(risultato.data.id))
	assert.equal(coda.stato, 'pending')
	assert.equal(coda.azione, 'upsert')
})

test('salvaLocale(): aggiorna (upsert) un record esistente dello stesso utente', () => {
	const creato = dbManager.salvaLocale('ingredienti', { nome: 'Farina 00', scorta: 10 }, USER_A)
	const aggiornato = dbManager.salvaLocale('ingredienti', { id: creato.data.id, scorta: 5 }, USER_A)

	assert.equal(aggiornato.data.id, creato.data.id)
	assert.equal(aggiornato.data.scorta, 5)
})

test('leggi()/leggiPerId(): isolano i dati fra utenti diversi (user_id)', () => {
	const diA = dbManager.salvaLocale('ingredienti', { nome: 'Solo A' }, USER_A).data
	const diB = dbManager.salvaLocale('ingredienti', { nome: 'Solo B' }, USER_B).data

	const perA = dbManager.leggi('ingredienti', USER_A)
	assert.ok(perA.some(r => r.id === diA.id))
	assert.ok(!perA.some(r => r.id === diB.id))

	assert.equal(dbManager.leggiPerId('ingredienti', diB.id, USER_A), null)
	assert.ok(dbManager.leggiPerId('ingredienti', diA.id, USER_A))
})

test('leggi(): include le righe condivise con user_id IS NULL', () => {
	const db = dbManager.getDb()
	const now = db.prepare("SELECT datetime('now') AS now").get().now
	const condiviso = db
		.prepare(`INSERT INTO ingredienti (nome, user_id, updated_at) VALUES (?, NULL, ?)`)
		.run('Condiviso', now)

	const perA = dbManager.leggi('ingredienti', USER_A)
	assert.ok(perA.some(r => r.id === condiviso.lastInsertRowid))
})

test('leggi() permette di selezionare un sottoinsieme di colonne', () => {
	dbManager.salvaLocale('ingredienti', { nome: 'Solo colonne', scorta: 4, categoria: 'Test' }, USER_A)

	const rows = dbManager.leggi('ingredienti', USER_A, ['id', 'nome'])
	assert.ok(rows.length > 0)
	assert.deepEqual(Object.keys(rows[0]).sort(), ['id', 'nome'])
})

test('leggi()/leggiPerId() rifiutano nomi colonna non validi', () => {
	dbManager.salvaLocale('ingredienti', { nome: 'Validazione colonne' }, USER_A)

	assert.throws(
		() => dbManager.leggi('ingredienti', USER_A, ['id', 'nome;DROP TABLE ingredienti;--']),
		/Nome colonna non valido/
	)
	assert.throws(
		() => dbManager.leggiPerId('ingredienti', 1, USER_A, ['id', 'nome--']),
		/Nome colonna non valido/
	)
})

test('eliminaLocale(): rimuove un record di proprietà e lo accoda come delete', () => {
	const creato = dbManager.salvaLocale('ingredienti', { nome: 'Da eliminare' }, USER_A).data
	const risultato = dbManager.eliminaLocale('ingredienti', creato.id, USER_A)

	assert.equal(risultato.deleted, true)
	assert.equal(dbManager.leggiPerId('ingredienti', creato.id, USER_A), null)

	const coda = dbManager.getDb()
		.prepare(`SELECT * FROM coda_sync WHERE entita = 'ingredienti' AND record_id = ? ORDER BY id DESC LIMIT 1`)
		.get(String(creato.id))
	assert.equal(coda.azione, 'delete')
})

test('coda_sync: coalesce mantiene una sola riga pending per record', () => {
	const creato = dbManager.salvaLocale('ingredienti', { nome: 'Coalesce coda', scorta: 1 }, USER_A).data
	dbManager.salvaLocale('ingredienti', { id: creato.id, scorta: 2 }, USER_A)
	dbManager.eliminaLocale('ingredienti', creato.id, USER_A)

	const rows = dbManager.getDb()
		.prepare(`SELECT azione FROM coda_sync WHERE entita = 'ingredienti' AND record_id = ? AND user_id = ? AND sincronizzato = 0`)
		.all(String(creato.id), USER_A)

	assert.equal(rows.length, 1)
	assert.equal(rows[0].azione, 'delete')
})

test('accodaSyncLocale aggiorna payload pending esistente', () => {
	dbManager.accodaSyncLocale('ingredienti', 'manual-1', { id: 'manual-1', nome: 'Prima' }, USER_A, 'upsert')
	dbManager.accodaSyncLocale('ingredienti', 'manual-1', { id: 'manual-1', nome: 'Seconda' }, USER_A, 'upsert')

	const rows = dbManager.getDb()
		.prepare(`SELECT payload FROM coda_sync WHERE entita = 'ingredienti' AND record_id = ? AND user_id = ? AND sincronizzato = 0`)
		.all('manual-1', USER_A)

	assert.equal(rows.length, 1)
	assert.equal(JSON.parse(rows[0].payload).nome, 'Seconda')
})

test('transazione figli: delete bulk + accodaSyncLocale mantiene coda coerente', () => {
	const db = dbManager.getDb()
	const menu = dbManager.salvaLocale('menu', { nome: 'Menu test' }, USER_A).data
	const voceA = dbManager.salvaLocale('menu_voci', { menu_id: menu.id, nome: 'Voce A', prezzo: 10, ordine: 0 }, USER_A).data
	const voceB = dbManager.salvaLocale('menu_voci', { menu_id: menu.id, nome: 'Voce B', prezzo: 12, ordine: 1 }, USER_A).data

	db.transaction(() => {
		const esistenti = db.prepare(
			'SELECT id FROM menu_voci WHERE menu_id = ? AND user_id = ?'
		).all(menu.id, USER_A)

		db.prepare('DELETE FROM menu_voci WHERE menu_id = ? AND user_id = ?')
			.run(menu.id, USER_A)

		for (const voce of esistenti) {
			dbManager.accodaSyncLocale('menu_voci', voce.id, { id: voce.id, user_id: USER_A }, USER_A, 'delete')
		}

		const inserted = db.prepare(`
			INSERT INTO menu_voci (menu_id, nome, prezzo, ordine, user_id, updated_at)
			VALUES (?, ?, ?, ?, ?, datetime('now'))
		`).run(menu.id, 'Voce C', 14, 0, USER_A)
		const localRecord = db.prepare(`
			SELECT id, menu_id, nome, prezzo, ordine, user_id, updated_at
			FROM menu_voci
			WHERE id = ? AND user_id = ?
		`).get(inserted.lastInsertRowid, USER_A)
		dbManager.accodaSyncLocale('menu_voci', localRecord.id, localRecord, USER_A, 'upsert')
	})()

	const pending = db.prepare(`
		SELECT record_id, azione
		FROM coda_sync
		WHERE entita = 'menu_voci' AND user_id = ? AND sincronizzato = 0
	`).all(USER_A)

	assert.ok(pending.some(row => row.record_id === String(voceA.id) && row.azione === 'delete'))
	assert.ok(pending.some(row => row.record_id === String(voceB.id) && row.azione === 'delete'))
	assert.ok(pending.some(row => row.azione === 'upsert'))
})

test('eliminaLocale(): non elimina (e segnala notFound) un record di un altro utente', () => {
	const diB = dbManager.salvaLocale('ingredienti', { nome: 'Di B' }, USER_B).data
	const risultato = dbManager.eliminaLocale('ingredienti', diB.id, USER_A)

	assert.equal(risultato.deleted, false)
	assert.equal(risultato.notFound, true)
	assert.ok(dbManager.leggiPerId('ingredienti', diB.id, USER_B))
})

test('salvaLocale()/eliminaLocale() sono sincrone e componibili dentro db.transaction()', () => {
	const db = dbManager.getDb()

	const risultato = db.transaction(() => {
		const ingrediente = dbManager.salvaLocale('ingredienti', { nome: 'Transazionale', scorta: 20 }, USER_A)
		const movimento = dbManager.salvaLocale('movimenti_magazzino', {
			ingrediente_id: ingrediente.data.id,
			tipo: 'carico',
			quantita: 20,
		}, USER_A)
		return { ingrediente, movimento }
	})()

	assert.ok(risultato.ingrediente.data.id)
	assert.ok(risultato.movimento.data.id)
	assert.equal(risultato.movimento.data.ingrediente_id, risultato.ingrediente.data.id)
})
