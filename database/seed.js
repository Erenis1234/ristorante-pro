function seedDemo(db) {
	const isEmpty = db.prepare(`
		SELECT COUNT(*) AS count FROM categorie WHERE user_id IS NULL
	`).get()

	if (isEmpty.count > 0) {
		return
	}

	db.transaction(() => {
		const demoUserId = null

		const insertCategory = db.prepare(
			`INSERT INTO categorie (nome, icona, descrizione, colore, ordine, user_id, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
		)
		const categories = [
			['Antipasti', 'utensils', 'Stuzzichini e piccoli assaggi', '#f59e0b', 1],
			['Primi', 'bowl-hot', 'Paste e risotti della casa', '#0ea5e9', 2],
			['Secondi', 'drumstick-bite', 'Carne, pesce e griglia', '#ef4444', 3],
			['Contorni', 'leaf', 'Verdure e accompagnamenti', '#22c55e', 4],
			['Dolci', 'cake-candles', 'Dessert artigianali', '#ec4899', 5],
			['Bevande', 'glass-water', 'Soft drink, vini e cocktail', '#6366f1', 6],
		]

		const categoryIds = {}
		for (const [name, icon, description, color, order] of categories) {
			const result = insertCategory.run(name, icon, description, color, order, demoUserId)
			categoryIds[name] = result.lastInsertRowid
		}

		const insertDish = db.prepare(
			`INSERT INTO piatti (
				nome, descrizione, prezzo, tempo_preparazione, categoria_id,
				disponibile, allergeni, user_id, updated_at
			) VALUES (?, ?, ?, ?, ?, 1, ?, ?, datetime('now'))`
		)
		const dishes = [
			['Bruschetta classica', 'Pane tostato, pomodoro, basilico', 6.5, 8, categoryIds.Antipasti, 'glutine'],
			['Fiori di zucca fritti', 'Ripieni di ricotta e alici', 8.5, 10, categoryIds.Antipasti, 'glutine, latte, pesce'],
			['Tagliere misto', 'Salumi e formaggi locali', 14.0, 12, categoryIds.Antipasti, 'latte'],
			['Spaghetti al pomodoro', 'Sugo semplice e basilico fresco', 9.0, 12, categoryIds.Primi, 'glutine'],
			['Penne arrabbiata', 'Pomodoro, aglio, peperoncino', 9.5, 12, categoryIds.Primi, 'glutine'],
			['Risotto ai funghi', 'Mantecato al parmigiano', 13.5, 18, categoryIds.Primi, 'latte'],
			['Lasagna della casa', 'Ragu, besciamella e parmigiano', 14.5, 20, categoryIds.Primi, 'glutine, latte, uova'],
			['Gnocchi al pesto', 'Pesto genovese e pinoli', 12.0, 14, categoryIds.Primi, 'glutine, frutta a guscio'],
			['Pollo alla griglia', 'Petto marinato alle erbe', 14.5, 15, categoryIds.Secondi, null],
			['Filetto al pepe verde', 'Con salsa cremosa al pepe', 24.0, 20, categoryIds.Secondi, 'latte'],
			['Salmone al forno', 'Con limone e timo', 18.5, 17, categoryIds.Secondi, 'pesce'],
			['Patate al forno', 'Rosmarino e olio evo', 4.5, 10, categoryIds.Contorni, null],
			['Verdure grigliate', 'Misto stagionale alla piastra', 5.5, 10, categoryIds.Contorni, null],
			['Tiramisu', 'Mascarpone, caffe, cacao', 6.0, 6, categoryIds.Dolci, 'glutine, latte, uova'],
			['Calice vino bianco', 'Vino fermo della casa', 5.0, 2, categoryIds.Bevande, 'solfiti'],
		]

		for (const [name, description, price, prepTime, categoryId, allergens] of dishes) {
			insertDish.run(
				name,
				description,
				price,
				prepTime,
				categoryId,
				allergens,
				demoUserId
			)
		}

		const insertIngredient = db.prepare(
			`INSERT INTO ingredienti (
				nome, unita_misura, scorta, scorta_min, prezzo_kg, categoria, fornitore, user_id, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
		)
		const ingredients = [
			['Farina 00', 'kg', 30, 6, 1.2, 'dispensa', 'Molini Rossi'],
			['Uova fresche', 'pz', 180, 36, 0.22, 'freschi', 'Azienda Agricola Bianchi'],
			['Pomodoro pelato', 'kg', 45, 10, 1.6, 'dispensa', 'Conserve Sud'],
			['Mozzarella', 'kg', 15, 4, 8.5, 'freschi', 'Caseificio Napoli'],
			['Parmigiano', 'kg', 8, 2, 18.5, 'freschi', 'Consorzio Parmigiano'],
			['Olio evo', 'l', 20, 5, 7.9, 'dispensa', 'Frantoio Toscano'],
			['Sale fino', 'kg', 8, 1, 0.6, 'dispensa', 'Grossista Locale'],
			['Pepe nero', 'g', 700, 120, 12, 'spezie', 'Grossista Locale'],
			['Aglio', 'kg', 4, 1, 3.2, 'ortofrutta', 'Mercato Centrale'],
			['Cipolla dorata', 'kg', 7, 1.5, 1.1, 'ortofrutta', 'Mercato Centrale'],
			['Pasta secca', 'kg', 28, 6, 2.1, 'dispensa', 'Pastificio Artigiano'],
			['Riso carnaroli', 'kg', 12, 3, 3.8, 'dispensa', 'Riseria Lombarda'],
			['Petto di pollo', 'kg', 13, 3, 12.5, 'macelleria', 'Macelleria Verdi'],
			['Filetto di manzo', 'kg', 7, 2, 29, 'macelleria', 'Macelleria Verdi'],
			['Salmone fresco', 'kg', 6, 1.5, 22.5, 'pescheria', 'Pescheria Azzurra'],
			['Burro', 'kg', 5, 1, 6.2, 'freschi', 'Caseificio Lombardo'],
			['Panna fresca', 'l', 6, 1.5, 3.2, 'freschi', 'Caseificio Lombardo'],
			['Basilico', 'g', 500, 120, 25, 'ortofrutta', 'Orto Bio'],
			['Limoni', 'kg', 5, 1, 2.8, 'ortofrutta', 'Mercato Centrale'],
			['Funghi champignon', 'kg', 9, 2, 5.4, 'ortofrutta', 'Orto Bio'],
		]

		for (const [
			name,
			unit,
			stock,
			minStock,
			price,
			category,
			supplier,
		] of ingredients) {
			insertIngredient.run(
				name,
				unit,
				stock,
				minStock,
				price,
				category,
				supplier,
				demoUserId
			)
		}

		const insertEmployee = db.prepare(
			`INSERT INTO personale (
				nome, cognome, ruolo, telefono, email, stipendio, attivo, user_id, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, 1, ?, datetime('now'))`
		)
		const employees = [
			['Andrea', 'Rossi', 'chef executive', '3331100001', 'andrea.rossi@demo.local', 3200],
			['Giulia', 'Esposito', 'sous chef', '3331100002', 'giulia.esposito@demo.local', 2600],
			['Matteo', 'Conti', 'chef de partie', '3331100003', 'matteo.conti@demo.local', 2200],
			['Elena', 'Bianchi', 'pasticcere', '3331100004', 'elena.bianchi@demo.local', 2100],
			['Luca', 'Romano', 'aiuto cuoco', '3331100005', 'luca.romano@demo.local', 1800],
		]

		for (const [name, surname, role, phone, email, salary] of employees) {
			insertEmployee.run(name, surname, role, phone, email, salary, demoUserId)
		}
	})()
}

module.exports = {
	seedDemo,
}
