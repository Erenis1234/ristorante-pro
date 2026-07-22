function createTables(db) {
	db.exec(`
		CREATE TABLE IF NOT EXISTS categorie (
			id          INTEGER PRIMARY KEY AUTOINCREMENT,
			nome        TEXT    NOT NULL UNIQUE,
			icona       TEXT,
			descrizione TEXT,
			colore      TEXT    DEFAULT '#6366f1',
			ordine      INTEGER DEFAULT 0,
			user_id     TEXT,
			updated_at  TEXT    DEFAULT (datetime('now'))
		);

		CREATE TABLE IF NOT EXISTS piatti (
			id                  INTEGER PRIMARY KEY AUTOINCREMENT,
			nome                TEXT    NOT NULL,
			descrizione         TEXT,
			prezzo              REAL    NOT NULL DEFAULT 0,
			tempo_preparazione  INTEGER DEFAULT 15,
			categoria_id        INTEGER REFERENCES categorie(id) ON DELETE SET NULL,
			immagine            TEXT,
			disponibile         INTEGER NOT NULL DEFAULT 1,
			allergeni           TEXT,
			user_id             TEXT,
			updated_at          TEXT    DEFAULT (datetime('now'))
		);

		CREATE TABLE IF NOT EXISTS ingredienti (
			id            INTEGER PRIMARY KEY AUTOINCREMENT,
			nome          TEXT    NOT NULL UNIQUE,
			unita_misura  TEXT    NOT NULL DEFAULT 'kg',
			scorta        REAL    NOT NULL DEFAULT 0,
			scorta_min    REAL    NOT NULL DEFAULT 0,
			scadenza      TEXT,
			prezzo_kg     REAL    DEFAULT 0,
			categoria     TEXT    DEFAULT 'Generici',
			fornitore     TEXT,
			user_id       TEXT,
			updated_at    TEXT    DEFAULT (datetime('now'))
		);

		CREATE TABLE IF NOT EXISTS piatto_ingredienti (
			id              INTEGER PRIMARY KEY AUTOINCREMENT,
			piatto_id       INTEGER NOT NULL REFERENCES piatti(id) ON DELETE CASCADE,
			ingrediente_id  INTEGER NOT NULL REFERENCES ingredienti(id) ON DELETE CASCADE,
			quantita        REAL    NOT NULL DEFAULT 0,
			unita_misura    TEXT    NOT NULL DEFAULT 'g',
			user_id         TEXT,
			updated_at      TEXT    DEFAULT (datetime('now')),
			UNIQUE(piatto_id, ingrediente_id)
		);

		CREATE TABLE IF NOT EXISTS ricette (
			id                  INTEGER PRIMARY KEY AUTOINCREMENT,
			nome                TEXT    NOT NULL,
			porzioni            INTEGER NOT NULL DEFAULT 1,
			tempo_preparazione  INTEGER DEFAULT 20,
			temperatura         TEXT,
			categoria           TEXT,
			foto                TEXT,
			user_id             TEXT,
			updated_at          TEXT    DEFAULT (datetime('now'))
		);

		CREATE TABLE IF NOT EXISTS ricetta_ingredienti (
			id              INTEGER PRIMARY KEY AUTOINCREMENT,
			ricetta_id      INTEGER NOT NULL REFERENCES ricette(id) ON DELETE CASCADE,
			ingrediente_id  INTEGER REFERENCES ingredienti(id) ON DELETE SET NULL,
			nome            TEXT    NOT NULL DEFAULT '',
			quantita        REAL    NOT NULL DEFAULT 0,
			unita_misura    TEXT    NOT NULL DEFAULT 'g',
			note            TEXT,
			user_id         TEXT,
			updated_at      TEXT    DEFAULT (datetime('now'))
		);

		CREATE TABLE IF NOT EXISTS personale (
			id         INTEGER PRIMARY KEY AUTOINCREMENT,
			nome       TEXT    NOT NULL,
			cognome    TEXT    NOT NULL,
			ruolo      TEXT    NOT NULL DEFAULT 'cameriere',
			telefono   TEXT,
			email      TEXT,
			stipendio  REAL    NOT NULL DEFAULT 0,
			attivo     INTEGER NOT NULL DEFAULT 1,
			user_id    TEXT,
			updated_at TEXT    DEFAULT (datetime('now'))
		);

		CREATE TABLE IF NOT EXISTS turni (
			id            INTEGER PRIMARY KEY AUTOINCREMENT,
			personale_id  INTEGER NOT NULL REFERENCES personale(id) ON DELETE CASCADE,
			data          TEXT    NOT NULL,
			ora_inizio    TEXT    NOT NULL,
			ora_fine      TEXT    NOT NULL,
			ruolo_turno   TEXT,
			note          TEXT,
			user_id       TEXT,
			updated_at    TEXT    DEFAULT (datetime('now'))
		);

		CREATE TABLE IF NOT EXISTS utenti_locali (
			id             INTEGER PRIMARY KEY AUTOINCREMENT,
			username       TEXT    NOT NULL UNIQUE,
			password_hash  TEXT    NOT NULL,
			ruolo          TEXT    NOT NULL DEFAULT 'staff',
			nome           TEXT,
			email          TEXT,
			attivo         INTEGER NOT NULL DEFAULT 1,
			ultimo_accesso TEXT,
			user_id        TEXT,
			updated_at     TEXT    DEFAULT (datetime('now'))
		);

		CREATE TABLE IF NOT EXISTS coda_sync (
			id           INTEGER PRIMARY KEY AUTOINCREMENT,
			entita       TEXT    NOT NULL,
			record_id    TEXT    NOT NULL,
			azione       TEXT    NOT NULL,
			payload      TEXT,
			sincronizzato INTEGER NOT NULL DEFAULT 0,
			stato        TEXT    NOT NULL DEFAULT 'pending',
			tentativi    INTEGER NOT NULL DEFAULT 0,
			ultimo_errore TEXT,
			sincronizzato_il TEXT,
			user_id      TEXT,
			updated_at   TEXT    DEFAULT (datetime('now'))
		);

		CREATE TABLE IF NOT EXISTS movimenti_magazzino (
			id             INTEGER PRIMARY KEY AUTOINCREMENT,
			ingrediente_id INTEGER NOT NULL REFERENCES ingredienti(id) ON DELETE CASCADE,
			tipo           TEXT    NOT NULL,
			quantita       REAL    NOT NULL DEFAULT 0,
			nota           TEXT,
			data_movimento TEXT    NOT NULL DEFAULT (datetime('now')),
			user_id        TEXT,
			updated_at     TEXT    DEFAULT (datetime('now'))
		);

		CREATE TABLE IF NOT EXISTS ordini_fornitori (
			id                      INTEGER PRIMARY KEY AUTOINCREMENT,
			fornitore               TEXT    NOT NULL,
			stato                   TEXT    NOT NULL DEFAULT 'inviato',
			data_ordine             TEXT    NOT NULL,
			data_consegna_prevista  TEXT,
			data_ricezione          TEXT,
			note                    TEXT,
			totale                  REAL    NOT NULL DEFAULT 0,
			user_id                 TEXT,
			updated_at              TEXT    DEFAULT (datetime('now'))
		);

		CREATE TABLE IF NOT EXISTS ordine_fornitore_righe (
			id                  INTEGER PRIMARY KEY AUTOINCREMENT,
			ordine_id           INTEGER NOT NULL REFERENCES ordini_fornitori(id) ON DELETE CASCADE,
			ingrediente_id      INTEGER REFERENCES ingredienti(id) ON DELETE SET NULL,
			ingrediente_nome    TEXT    NOT NULL DEFAULT '',
			quantita            REAL    NOT NULL DEFAULT 0,
			prezzo              REAL    NOT NULL DEFAULT 0,
			quantita_ricevuta   REAL    NOT NULL DEFAULT 0,
			totale              REAL    GENERATED ALWAYS AS (quantita * prezzo) STORED,
			user_id             TEXT,
			updated_at          TEXT    DEFAULT (datetime('now'))
		);

		CREATE TABLE IF NOT EXISTS auth_session (
			id            INTEGER PRIMARY KEY CHECK (id = 1),
			user_id       TEXT,
			email         TEXT,
			access_token  TEXT NOT NULL,
			refresh_token TEXT NOT NULL,
			expires_at    INTEGER,
			token_type    TEXT,
			user_json     TEXT NOT NULL,
			session_json  TEXT NOT NULL,
			updated_at    TEXT DEFAULT (datetime('now'))
		);
	`)

	// ── Migrazioni per DB esistenti ──────────────────────────────────────────
	_migrateRicettaIngredienti(db)
	_migrateOrdineFornitoreRighe(db)
	_migrateRicetteTemperatura(db)
	_migrateRicetteCategoriaFoto(db)
}

// Aggiunge colonna `nome` e rende `ingrediente_id` nullable in ricetta_ingredienti
function _migrateRicettaIngredienti(db) {
	const cols = db.pragma('table_info(ricetta_ingredienti)')
	if (!cols.length || cols.some(c => c.name === 'nome')) return

	db.pragma('foreign_keys = OFF')
	try {
		db.exec(`
			CREATE TABLE ricetta_ingredienti_v2 (
				id              INTEGER PRIMARY KEY AUTOINCREMENT,
				ricetta_id      INTEGER NOT NULL REFERENCES ricette(id) ON DELETE CASCADE,
				ingrediente_id  INTEGER REFERENCES ingredienti(id) ON DELETE SET NULL,
				nome            TEXT    NOT NULL DEFAULT '',
				quantita        REAL    NOT NULL DEFAULT 0,
				unita_misura    TEXT    NOT NULL DEFAULT 'g',
				note            TEXT,
				user_id         TEXT,
				updated_at      TEXT    DEFAULT (datetime('now'))
			);
			INSERT INTO ricetta_ingredienti_v2 (id, ricetta_id, ingrediente_id, nome, quantita, unita_misura, note, user_id, updated_at)
			SELECT ri.id, ri.ricetta_id, ri.ingrediente_id, COALESCE(i.nome, ''), ri.quantita, ri.unita_misura, ri.note, ri.user_id, ri.updated_at
			FROM ricetta_ingredienti ri
			LEFT JOIN ingredienti i ON i.id = ri.ingrediente_id;
			DROP TABLE ricetta_ingredienti;
			ALTER TABLE ricetta_ingredienti_v2 RENAME TO ricetta_ingredienti;
		`)
	} finally {
		db.pragma('foreign_keys = ON')
	}
}

// Aggiunge colonna `ingrediente_nome` e rende `ingrediente_id` nullable in ordine_fornitore_righe
function _migrateOrdineFornitoreRighe(db) {
	const cols = db.pragma('table_info(ordine_fornitore_righe)')
	if (!cols.length || cols.some(c => c.name === 'ingrediente_nome')) return

	db.pragma('foreign_keys = OFF')
	try {
		db.exec(`
			CREATE TABLE ordine_fornitore_righe_v2 (
				id                  INTEGER PRIMARY KEY AUTOINCREMENT,
				ordine_id           INTEGER NOT NULL REFERENCES ordini_fornitori(id) ON DELETE CASCADE,
				ingrediente_id      INTEGER REFERENCES ingredienti(id) ON DELETE SET NULL,
				ingrediente_nome    TEXT    NOT NULL DEFAULT '',
				quantita            REAL    NOT NULL DEFAULT 0,
				prezzo              REAL    NOT NULL DEFAULT 0,
				quantita_ricevuta   REAL    NOT NULL DEFAULT 0,
				totale              REAL    GENERATED ALWAYS AS (quantita * prezzo) STORED,
				user_id             TEXT,
				updated_at          TEXT    DEFAULT (datetime('now'))
			);
			INSERT INTO ordine_fornitore_righe_v2 (id, ordine_id, ingrediente_id, ingrediente_nome, quantita, prezzo, quantita_ricevuta, user_id, updated_at)
			SELECT ofr.id, ofr.ordine_id, ofr.ingrediente_id, COALESCE(i.nome, ''), ofr.quantita, ofr.prezzo, ofr.quantita_ricevuta, ofr.user_id, ofr.updated_at
			FROM ordine_fornitore_righe ofr
			LEFT JOIN ingredienti i ON i.id = ofr.ingrediente_id;
			DROP TABLE ordine_fornitore_righe;
			ALTER TABLE ordine_fornitore_righe_v2 RENAME TO ordine_fornitore_righe;
		`)
	} finally {
		db.pragma('foreign_keys = ON')
	}
}

// Aggiunge colonna `temperatura` a ricette se non esiste
function _migrateRicetteTemperatura(db) {
	const cols = db.pragma('table_info(ricette)')
	if (!cols.length || cols.some(c => c.name === 'temperatura')) return
	db.exec(`ALTER TABLE ricette ADD COLUMN temperatura TEXT`)
}

// Aggiunge colonne `categoria` (antipasto/primo/secondo/dolce/salsa) e `foto`
// (immagine in base64) a ricette se non esistono
function _migrateRicetteCategoriaFoto(db) {
	const cols = db.pragma('table_info(ricette)')
	if (!cols.length) return
	if (!cols.some(c => c.name === 'categoria')) {
		db.exec(`ALTER TABLE ricette ADD COLUMN categoria TEXT`)
	}
	if (!cols.some(c => c.name === 'foto')) {
		db.exec(`ALTER TABLE ricette ADD COLUMN foto TEXT`)
	}
}

module.exports = {
	createTables,
}
