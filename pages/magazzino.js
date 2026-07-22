;(function () {

var state = {
	container: null,
	loading: false,
	errorMessage: '',
	noticeMessage: '',
	ingredienti: [],
	searchQuery: '',
	ingredienteModal: {
		open: false,
		mode: 'create',
		error: '',
		values: {
			id: '',
			nome: '',
			categoria: '',
			quantita: '0',
			soglia_minima: '0',
			unita_misura: 'kg',
			scadenza: '',
			fornitore: '',
		},
	},
	movimentoModal: {
		open: false,
		error: '',
		values: {
			ingrediente_id: '',
			tipo: 'carico',
			quantita: '',
			nota: '',
		},
	},
}

function escapeHtml(value) {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')
}

function toNumber(value) {
	var parsed = Number(value)
	return Number.isFinite(parsed) ? parsed : 0
}

function formatDateDisplay(value) {
	if (!value) {
		return '-'
	}

	var date = new Date(value)
	if (Number.isNaN(date.getTime())) {
		return '-'
	}

	return date.toLocaleDateString('it-IT')
}

function formatDateInput(value) {
	if (!value) {
		return ''
	}

	var date = new Date(value)
	if (Number.isNaN(date.getTime())) {
		return ''
	}

	var year = String(date.getFullYear())
	var month = String(date.getMonth() + 1).padStart(2, '0')
	var day = String(date.getDate()).padStart(2, '0')
	return `${year}-${month}-${day}`
}

function getStatusInfo(ingrediente) {
	var scorta = toNumber(ingrediente && ingrediente.scorta)
	var soglia = toNumber(ingrediente && ingrediente.scorta_min)

	if (scorta <= 0) {
		return {
			className: 'badge-red',
			label: 'Esaurito',
		}
	}

	if (scorta <= soglia) {
		return {
			className: 'badge-amber',
			label: 'Basso',
		}
	}

	return {
		className: 'badge-green',
		label: 'OK',
	}
}

function findIngredienteById(id) {
	return state.ingredienti.find(function (ingrediente) {
		return String(ingrediente.id) === String(id)
	}) || null
}

function getFilteredIngredienti() {
	var query = String(state.searchQuery || '').trim().toLowerCase()
	if (!query) {
		return state.ingredienti.slice()
	}

	return state.ingredienti.filter(function (ingrediente) {
		var parts = [
			ingrediente && ingrediente.nome,
			ingrediente && ingrediente.categoria,
			ingrediente && ingrediente.fornitore,
			ingrediente && ingrediente.unita_misura,
		]
			.map(function (part) {
				return String(part || '').toLowerCase()
			})
			.join(' ')

		return parts.includes(query)
	})
}

function renderLoading() {
	return `
	<div class="empty-state page-magazzino">
		<div class="spinner" aria-hidden="true"></div>
		<div class="empty-state-title">Caricamento magazzino</div>
		<div class="empty-state-sub">Recupero ingredienti in corso...</div>
	</div>`
}

function renderError() {
	return `
	<div class="empty-state page-magazzino">
		<div class="empty-state-icon">⚠️</div>
		<div class="empty-state-title">Errore caricamento magazzino</div>
		<div class="empty-state-sub">${escapeHtml(state.errorMessage || 'Errore sconosciuto')}</div>
		<button class="btn btn-primary" data-action="retry-load">🔄 Riprova</button>
	</div>`
}

function renderRows() {
	var items = getFilteredIngredienti()

	if (!items.length) {
		return `
		<tr>
			<td colspan="9" class="td-center td-dim">Nessun ingrediente trovato</td>
		</tr>`
	}

	return items
		.map(function (ingrediente) {
			var status = getStatusInfo(ingrediente)
			var nome = escapeHtml(ingrediente && ingrediente.nome ? ingrediente.nome : 'Ingrediente')
			var categoria = escapeHtml(ingrediente && ingrediente.categoria ? ingrediente.categoria : '-')
			var unita = escapeHtml(ingrediente && ingrediente.unita_misura ? ingrediente.unita_misura : '-')
			var fornitore = escapeHtml(ingrediente && ingrediente.fornitore ? ingrediente.fornitore : '-')
			var scorta = toNumber(ingrediente && ingrediente.scorta)
			var soglia = toNumber(ingrediente && ingrediente.scorta_min)
			var scadenza = formatDateDisplay(ingrediente && ingrediente.scadenza)

			return `
			<tr>
				<td>${nome}</td>
				<td>${categoria}</td>
				<td class="td-right td-mono">${scorta}</td>
				<td class="td-right td-mono">${soglia}</td>
				<td>${unita}</td>
				<td>${escapeHtml(scadenza)}</td>
				<td>${fornitore}</td>
				<td class="td-center"><span class="badge ${status.className}">${status.label}</span></td>
				<td class="td-right">
					<button class="btn btn-secondary btn-sm" data-action="open-movimento-modal" data-id="${ingrediente.id}">📥 Movimento</button>
					<button class="btn btn-secondary btn-sm" data-action="open-edit-ingrediente" data-id="${ingrediente.id}">✏️ Modifica</button>
					<button class="btn btn-danger btn-sm" data-action="delete-ingrediente" data-id="${ingrediente.id}">🗑️ Elimina</button>
				</td>
			</tr>`
		})
		.join('')
}

function renderIngredienteModal() {
	if (!state.ingredienteModal.open) {
		return ''
	}

	var isEdit = state.ingredienteModal.mode === 'edit'
	var values = state.ingredienteModal.values
	var title = isEdit ? 'Modifica ingrediente' : 'Nuovo ingrediente'
	var submitText = isEdit ? '💾 Salva modifiche' : '✅ Crea ingrediente'

	return `
	<div class="modal-overlay" data-action="close-ingrediente-modal-bg">
		<div class="modal modal-lg" role="dialog" aria-modal="true" aria-label="${title}">
			<div class="modal-header">
				<div>
					<div class="modal-title">${title}</div>
					<div class="modal-subtitle">Gestisci anagrafica e scorte minime dell'ingrediente</div>
				</div>
				<button class="modal-close" type="button" data-action="close-ingrediente-modal">×</button>
			</div>

			<form data-action="submit-ingrediente-form" style="display:flex; flex-direction:column; flex:1; overflow:hidden; min-height:0;">
				<div class="modal-body">
					<input type="hidden" name="id" value="${escapeHtml(values.id)}">

					<div class="form-group">
						<label class="form-label" for="ing-nome">Nome</label>
						<input id="ing-nome" class="form-input" name="nome" required maxlength="120" value="${escapeHtml(values.nome)}" placeholder="Es. Pomodoro pelato">
					</div>

					<div class="form-row">
						<div class="form-group">
							<label class="form-label" for="ing-categoria">Categoria</label>
							<input id="ing-categoria" class="form-input" name="categoria" maxlength="80" value="${escapeHtml(values.categoria)}" placeholder="Es. Dispensa">
						</div>

						<div class="form-group">
							<label class="form-label" for="ing-unita">Unita misura</label>
							<select id="ing-unita" class="form-select" name="unita_misura" required>
								<option value="kg"${values.unita_misura === 'kg' ? ' selected' : ''}>kg</option>
								<option value="g"${values.unita_misura === 'g' ? ' selected' : ''}>g</option>
								<option value="l"${values.unita_misura === 'l' ? ' selected' : ''}>l</option>
								<option value="ml"${values.unita_misura === 'ml' ? ' selected' : ''}>ml</option>
								<option value="pz"${values.unita_misura === 'pz' ? ' selected' : ''}>pz</option>
							</select>
						</div>
					</div>

					<div class="form-row">
						<div class="form-group">
							<label class="form-label" for="ing-quantita">Scorta attuale</label>
							<input id="ing-quantita" class="form-input" name="quantita" type="number" min="0" step="0.01" required value="${escapeHtml(values.quantita)}">
						</div>

						<div class="form-group">
							<label class="form-label" for="ing-soglia">Scorta minima</label>
							<input id="ing-soglia" class="form-input" name="soglia_minima" type="number" min="0" step="0.01" required value="${escapeHtml(values.soglia_minima)}">
						</div>
					</div>

					<div class="form-row">
						<div class="form-group">
							<label class="form-label" for="ing-scadenza">Scadenza</label>
							<input id="ing-scadenza" class="form-input" name="scadenza" type="date" value="${escapeHtml(values.scadenza)}">
						</div>

						<div class="form-group">
							<label class="form-label" for="ing-fornitore">Fornitore</label>
							<input id="ing-fornitore" class="form-input" name="fornitore" maxlength="120" value="${escapeHtml(values.fornitore)}" placeholder="Es. Mercato Centrale">
						</div>
					</div>

					${state.ingredienteModal.error ? `<div class="form-error">⚠️ ${escapeHtml(state.ingredienteModal.error)}</div>` : ''}
				</div>

				<div class="modal-footer">
					<button type="button" class="btn btn-ghost" data-action="close-ingrediente-modal">❌ Annulla</button>
					<button type="submit" class="btn btn-primary">${submitText}</button>
				</div>
			</form>
		</div>
	</div>`
}

function renderIngredienteOptions(selectedId) {
	var current = String(selectedId || '')
	var options = ['<option value="">Seleziona ingrediente</option>']

	state.ingredienti.forEach(function (ingrediente) {
		var id = String(ingrediente.id)
		var selected = id === current ? ' selected' : ''
		options.push(`<option value="${id}"${selected}>${escapeHtml(ingrediente.nome || 'Ingrediente')}</option>`)
	})

	return options.join('')
}

function renderMovimentoModal() {
	if (!state.movimentoModal.open) {
		return ''
	}

	var values = state.movimentoModal.values

	return `
	<div class="modal-overlay" data-action="close-movimento-modal-bg">
		<div class="modal" role="dialog" aria-modal="true" aria-label="Nuovo movimento magazzino">
			<div class="modal-header">
				<div>
					<div class="modal-title">Nuovo movimento magazzino</div>
					<div class="modal-subtitle">Registra carico o scarico su un ingrediente</div>
				</div>
				<button class="modal-close" type="button" data-action="close-movimento-modal">×</button>
			</div>

			<form data-action="submit-movimento-form" style="display:flex; flex-direction:column; flex:1; overflow:hidden; min-height:0;">
				<div class="modal-body">
					<div class="form-group">
						<label class="form-label" for="mov-ingrediente">Ingrediente</label>
						<select id="mov-ingrediente" class="form-select" name="ingrediente_id" required>
							${renderIngredienteOptions(values.ingrediente_id)}
						</select>
					</div>

					<div class="form-row">
						<div class="form-group">
							<label class="form-label" for="mov-tipo">Tipo movimento</label>
							<select id="mov-tipo" class="form-select" name="tipo" required>
								<option value="carico"${values.tipo === 'carico' ? ' selected' : ''}>Carico</option>
								<option value="scarico"${values.tipo === 'scarico' ? ' selected' : ''}>Scarico</option>
							</select>
						</div>

						<div class="form-group">
							<label class="form-label" for="mov-quantita">Quantita</label>
							<input id="mov-quantita" class="form-input" name="quantita" type="number" min="0.01" step="0.01" required value="${escapeHtml(values.quantita)}">
						</div>
					</div>

					<div class="form-group" style="margin-bottom: 0;">
						<label class="form-label" for="mov-nota">Nota</label>
						<textarea id="mov-nota" class="form-textarea" name="nota" rows="3" placeholder="Es. consegna fornitore, rettifica inventario">${escapeHtml(values.nota)}</textarea>
					</div>

					${state.movimentoModal.error ? `<div class="form-error" style="margin-top: 12px;">⚠️ ${escapeHtml(state.movimentoModal.error)}</div>` : ''}
				</div>

				<div class="modal-footer">
					<button type="button" class="btn btn-ghost" data-action="close-movimento-modal">❌ Annulla</button>
					<button type="submit" class="btn btn-primary">📥 Registra movimento</button>
				</div>
			</form>
		</div>
	</div>`
}

function render() {
	if (state.loading) {
		return renderLoading()
	}

	if (state.errorMessage) {
		return renderError()
	}

	var filtered = getFilteredIngredienti()
	var noData = state.ingredienti.length === 0
	var noSearchResult = !noData && filtered.length === 0

	return `
	<div class="card">
		<div class="section-title">Gestione magazzino</div>
		<div class="tabella-toolbar" style="margin-bottom: 14px;">
			<button class="btn btn-primary" data-action="open-create-ingrediente">➕ Nuovo ingrediente</button>
			<input class="form-input search-bar" data-action="search-ingredienti" placeholder="Cerca per nome, categoria, fornitore..." value="${escapeHtml(state.searchQuery)}">
		</div>

		${state.noticeMessage ? `<div class="card" style="margin-bottom: 14px; padding: 12px 14px;">${escapeHtml(state.noticeMessage)}</div>` : ''}

		<div class="table-wrapper">
			<table>
				<thead>
					<tr>
						<th>Nome</th>
						<th>Categoria</th>
						<th class="th-right">Scorta attuale</th>
						<th class="th-right">Scorta minima</th>
						<th>Unita misura</th>
						<th>Scadenza</th>
						<th>Fornitore</th>
						<th class="th-center">Stato</th>
						<th class="th-right">Azioni</th>
					</tr>
				</thead>
				<tbody>
					${renderRows()}
				</tbody>
			</table>
		</div>

		${noData ? `
		<div class="empty-state" style="padding: 26px 16px;">
			<div class="empty-state-icon">📦</div>
			<div class="empty-state-title">Magazzino vuoto</div>
			<div class="empty-state-sub">Aggiungi il primo ingrediente per iniziare la gestione scorte.</div>
		</div>` : ''}

		${noSearchResult ? `
		<div class="empty-state" style="padding: 26px 16px;">
			<div class="empty-state-icon">🔎</div>
			<div class="empty-state-title">Nessun risultato</div>
			<div class="empty-state-sub">Nessun ingrediente corrisponde alla ricerca inserita.</div>
		</div>` : ''}
	</div>

	${renderIngredienteModal()}
	${renderMovimentoModal()}`
}

function rerender() {
	if (!state.container) return
	state.container.innerHTML = render()
}

function openIngredienteModalForCreate() {
	state.ingredienteModal.open = true
	state.ingredienteModal.mode = 'create'
	state.ingredienteModal.error = ''
	state.ingredienteModal.values = {
		id: '',
		nome: '',
		categoria: '',
		quantita: '0',
		soglia_minima: '0',
		unita_misura: 'kg',
		scadenza: '',
		fornitore: '',
	}
	rerender()
}

function openIngredienteModalForEdit(id) {
	var ingrediente = findIngredienteById(id)
	if (!ingrediente) {
		state.noticeMessage = 'Ingrediente non trovato'
		rerender()
		return
	}

	state.ingredienteModal.open = true
	state.ingredienteModal.mode = 'edit'
	state.ingredienteModal.error = ''
	state.ingredienteModal.values = {
		id: String(ingrediente.id),
		nome: String(ingrediente.nome || ''),
		categoria: String(ingrediente.categoria || ''),
		quantita: String(toNumber(ingrediente.scorta)),
		soglia_minima: String(toNumber(ingrediente.scorta_min)),
		unita_misura: String(ingrediente.unita_misura || 'kg'),
		scadenza: formatDateInput(ingrediente.scadenza),
		fornitore: String(ingrediente.fornitore || ''),
	}
	rerender()
}

function closeIngredienteModal() {
	state.ingredienteModal.open = false
	state.ingredienteModal.error = ''
	rerender()
}

function openMovimentoModal(ingredienteId) {
	state.movimentoModal.open = true
	state.movimentoModal.error = ''
	state.movimentoModal.values = {
		ingrediente_id: ingredienteId ? String(ingredienteId) : '',
		tipo: 'carico',
		quantita: '',
		nota: '',
	}
	rerender()
}

function closeMovimentoModal() {
	state.movimentoModal.open = false
	state.movimentoModal.error = ''
	rerender()
}

async function refreshData() {
	var ingredienti = await window.api.magazzino.getIngredienti()
	state.ingredienti = Array.isArray(ingredienti) ? ingredienti : []
}

function validateIngredientePayload(payload) {
	if (!payload.nome) {
		return 'Il nome ingrediente e obbligatorio'
	}

	if (payload.quantita < 0) {
		return 'La scorta attuale non puo essere negativa'
	}

	if (payload.soglia_minima < 0) {
		return 'La scorta minima non puo essere negativa'
	}

	if (!payload.unita_misura) {
		return 'Seleziona una unita di misura'
	}

	return ''
}

async function saveIngrediente(form) {
	var formData = new FormData(form)
	var id = String(formData.get('id') || '').trim()
	var payload = {
		nome: String(formData.get('nome') || '').trim(),
		categoria: String(formData.get('categoria') || '').trim() || null,
		quantita: toNumber(formData.get('quantita')),
		soglia_minima: toNumber(formData.get('soglia_minima')),
		unita_misura: String(formData.get('unita_misura') || '').trim(),
		scadenza: String(formData.get('scadenza') || '').trim() || null,
		fornitore: String(formData.get('fornitore') || '').trim() || null,
	}

	var validationError = validateIngredientePayload(payload)
	if (validationError) {
		state.ingredienteModal.error = validationError
		rerender()
		return
	}

	if (id) {
		payload.id = Number(id)
		await window.api.magazzino.updateIngrediente(payload)
		state.noticeMessage = 'Ingrediente aggiornato correttamente'
	} else {
		await window.api.magazzino.addIngrediente(payload)
		state.noticeMessage = 'Ingrediente creato correttamente'
	}

	state.ingredienteModal.open = false
	state.ingredienteModal.error = ''
	await refreshData()
	rerender()
}

async function saveMovimento(form) {
	var formData = new FormData(form)
	var payload = {
		ingrediente_id: Number(formData.get('ingrediente_id')),
		tipo: String(formData.get('tipo') || '').trim(),
		quantita: toNumber(formData.get('quantita')),
		nota: String(formData.get('nota') || '').trim() || null,
	}

	if (!payload.ingrediente_id) {
		state.movimentoModal.error = 'Seleziona un ingrediente'
		rerender()
		return
	}

	if (!['carico', 'scarico'].includes(payload.tipo)) {
		state.movimentoModal.error = 'Seleziona un tipo movimento valido'
		rerender()
		return
	}

	if (payload.quantita <= 0) {
		state.movimentoModal.error = 'La quantita deve essere maggiore di zero'
		rerender()
		return
	}

	await window.api.magazzino.addMovimento(payload)
	state.noticeMessage = 'Movimento registrato correttamente'
	state.movimentoModal.open = false
	state.movimentoModal.error = ''
	await refreshData()
	rerender()
}

async function deleteIngrediente(id) {
	var ingrediente = findIngredienteById(id)
	if (!ingrediente) {
		state.noticeMessage = 'Ingrediente non trovato'
		rerender()
		return
	}

	var confirmDelete = window.confirm(`Confermi l'eliminazione di "${ingrediente.nome}"?`)
	if (!confirmDelete) {
		return
	}

	await window.api.magazzino.deleteIngrediente(Number(id))
	state.noticeMessage = 'Ingrediente eliminato correttamente'
	await refreshData()
	rerender()
}

function initEvents(container) {
	if (container.__magazzinoEventsBound) {
		return
	}
	container.__magazzinoEventsBound = true

	container.addEventListener('click', function (event) {
		var target = event.target
		if (!(target instanceof Element)) return

		var actionNode = target.closest('[data-action]')
		if (!actionNode) return

		var action = actionNode.getAttribute('data-action')
		var id = actionNode.getAttribute('data-id')

		if (action === 'retry-load') {
			load(container)
			return
		}

		if (action === 'open-create-ingrediente') {
			openIngredienteModalForCreate()
			return
		}

		if (action === 'open-edit-ingrediente') {
			openIngredienteModalForEdit(id)
			return
		}

		if (action === 'open-movimento-modal') {
			openMovimentoModal(id)
			return
		}

		if (action === 'close-ingrediente-modal' || action === 'close-ingrediente-modal-bg') {
			if (action === 'close-ingrediente-modal-bg' && !actionNode.classList.contains('modal-overlay')) return
			closeIngredienteModal()
			return
		}

		if (action === 'close-movimento-modal' || action === 'close-movimento-modal-bg') {
			if (action === 'close-movimento-modal-bg' && !actionNode.classList.contains('modal-overlay')) return
			closeMovimentoModal()
			return
		}

		if (action === 'delete-ingrediente') {
			deleteIngrediente(id).catch(function (error) {
				state.noticeMessage = error && error.message ? error.message : 'Errore eliminazione ingrediente'
				rerender()
			})
		}
	})

	container.addEventListener('input', function (event) {
		var target = event.target
		if (!(target instanceof Element)) return

		var action = target.getAttribute('data-action')
		if (action === 'search-ingredienti') {
			state.searchQuery = target.value || ''
			rerender()
		}
	})

	container.addEventListener('submit', function (event) {
		var form = event.target
		if (!(form instanceof HTMLFormElement)) return

		if (form.getAttribute('data-action') === 'submit-ingrediente-form') {
			event.preventDefault()
			saveIngrediente(form).catch(function (error) {
				state.ingredienteModal.error = error && error.message ? error.message : 'Errore salvataggio ingrediente'
				rerender()
			})
			return
		}

		if (form.getAttribute('data-action') === 'submit-movimento-form') {
			event.preventDefault()
			saveMovimento(form).catch(function (error) {
				state.movimentoModal.error = error && error.message ? error.message : 'Errore registrazione movimento'
				rerender()
			})
		}
	})
}

async function load(container) {
	state.container = container
	state.loading = true
	state.errorMessage = ''
	state.noticeMessage = ''
	rerender()

	try {
		await refreshData()
	} catch (error) {
		state.errorMessage = error && error.message ? error.message : 'Impossibile caricare il magazzino'
	} finally {
		state.loading = false
		rerender()
		initEvents(container)
	}
}

var pageApi = { render, initEvents, load }

if (typeof window !== 'undefined') {
	window.pages = window.pages || {}
	window.pages.magazzino = pageApi
}

if (typeof module !== 'undefined' && module.exports) {
	module.exports = pageApi
}

})()
