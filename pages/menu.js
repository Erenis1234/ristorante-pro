;(function () {

var state = {
	container: null,
	loading: false,
	errorMessage: '',
	noticeMessage: '',
	categorie: [],
	piatti: [],
	filtroCategoria: 'all',
	editModal: {
		open: false,
		mode: 'create',
		error: '',
		values: {
			id: '',
			nome: '',
			descrizione: '',
			prezzo: '',
			categoria_id: '',
			tempo_preparazione: '0',
			allergeni: '',
			disponibile: true,
		},
	},
	confirmModal: {
		open: false,
		id: null,
		nome: '',
		error: '',
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

function formatPrezzo(value) {
	return toNumber(value).toFixed(2) + ' EUR'
}

function isDisponibile(value) {
	return Number(value) === 1 || value === true
}

function getCategoriaNome(categoriaId) {
	var found = state.categorie.find(function (categoria) {
		return String(categoria.id) === String(categoriaId)
	})
	return found && found.nome ? found.nome : 'Senza categoria'
}

function getPiattiFiltrati() {
	if (state.filtroCategoria === 'all') {
		return state.piatti.slice()
	}

	return state.piatti.filter(function (piatto) {
		return String(piatto.categoria_id) === String(state.filtroCategoria)
	})
}

function findPiattoById(id) {
	return state.piatti.find(function (piatto) {
		return String(piatto.id) === String(id)
	}) || null
}

function renderCategoriaFilterOptions() {
	var options = [`<option value="all"${state.filtroCategoria === 'all' ? ' selected' : ''}>Tutte le categorie</option>`]

	state.categorie.forEach(function (categoria) {
		var value = String(categoria.id)
		var selected = value === String(state.filtroCategoria) ? ' selected' : ''
		options.push(`<option value="${value}"${selected}>${escapeHtml(categoria.nome)}</option>`)
	})

	return options.join('')
}

function renderCategoriaFormOptions(selectedValue) {
	var current = String(selectedValue || '')
	var options = ['<option value="">Seleziona categoria</option>']

	state.categorie.forEach(function (categoria) {
		var value = String(categoria.id)
		var selected = value === current ? ' selected' : ''
		options.push(`<option value="${value}"${selected}>${escapeHtml(categoria.nome)}</option>`)
	})

	return options.join('')
}

function renderRows() {
	var piatti = getPiattiFiltrati()

	if (!piatti.length) {
		return `
		<tr>
			<td colspan="6" class="td-center td-dim">Nessun piatto trovato per il filtro selezionato</td>
		</tr>`
	}

	return piatti
		.map(function (piatto) {
			var categoriaNome = escapeHtml(getCategoriaNome(piatto.categoria_id))
			var nome = escapeHtml(piatto.nome || 'Piatto senza nome')
			var prezzo = formatPrezzo(piatto.prezzo)
			var tempoPrep = Math.max(0, Math.round(toNumber(piatto.tempo_preparazione)))
			var checked = isDisponibile(piatto.disponibile) ? ' checked' : ''

			return `
			<tr>
				<td>${nome}</td>
				<td>${categoriaNome}</td>
				<td class="td-right td-mono">${prezzo}</td>
				<td class="td-right td-mono">${tempoPrep} min</td>
				<td class="td-center">
					<label class="toggle-wrapper" style="justify-content: center;">
						<input class="toggle" type="checkbox" data-action="toggle-disponibile" data-id="${piatto.id}"${checked}>
					</label>
				</td>
				<td class="td-right">
					<button class="btn btn-secondary btn-sm" data-action="edit-piatto" data-id="${piatto.id}">✏️ Modifica</button>
					<button class="btn btn-danger btn-sm" data-action="confirm-delete-piatto" data-id="${piatto.id}">🗑️ Elimina</button>
				</td>
			</tr>`
		})
		.join('')
}

function renderEditModal() {
	if (!state.editModal.open) {
		return ''
	}

	var values = state.editModal.values
	var isEdit = state.editModal.mode === 'edit'
	var title = isEdit ? 'Modifica piatto' : 'Nuovo piatto'
	var submitLabel = isEdit ? '💾 Salva modifiche' : '✅ Crea piatto'

	return `
	<div class="modal-overlay" data-action="close-edit-modal-bg">
		<div class="modal modal-lg" role="dialog" aria-modal="true" aria-label="${title}">
			<div class="modal-header">
				<div>
					<div class="modal-title">${title}</div>
					<div class="modal-subtitle">Compila i dati del piatto per la gestione del menu</div>
				</div>
				<button class="modal-close" type="button" data-action="close-edit-modal">×</button>
			</div>

			<form data-action="submit-piatto-form" style="display:flex; flex-direction:column; flex:1; overflow:hidden; min-height:0;">
				<div class="modal-body">
					<input type="hidden" name="id" value="${escapeHtml(values.id)}">

					<div class="form-group">
						<label class="form-label" for="piatto-nome">Nome</label>
						<input id="piatto-nome" class="form-input" name="nome" maxlength="120" required value="${escapeHtml(values.nome)}" placeholder="Es. Spaghetti al pomodoro">
					</div>

					<div class="form-group">
						<label class="form-label" for="piatto-descrizione">Descrizione</label>
						<textarea id="piatto-descrizione" class="form-textarea" name="descrizione" rows="4" maxlength="1000" placeholder="Descrizione breve del piatto">${escapeHtml(values.descrizione)}</textarea>
					</div>

					<div class="form-row">
						<div class="form-group">
							<label class="form-label" for="piatto-prezzo">Prezzo</label>
							<input id="piatto-prezzo" class="form-input" name="prezzo" type="number" min="0" step="0.01" required value="${escapeHtml(values.prezzo)}">
						</div>

						<div class="form-group">
							<label class="form-label" for="piatto-categoria">Categoria</label>
							<select id="piatto-categoria" class="form-select" name="categoria_id" required>
								${renderCategoriaFormOptions(values.categoria_id)}
							</select>
						</div>
					</div>

					<div class="form-row">
						<div class="form-group">
							<label class="form-label" for="piatto-tempo">Tempo preparazione (min)</label>
							<input id="piatto-tempo" class="form-input" name="tempo_preparazione" type="number" min="0" step="1" required value="${escapeHtml(values.tempo_preparazione)}">
						</div>

						<div class="form-group">
							<label class="form-label" for="piatto-allergeni">Allergeni</label>
							<input id="piatto-allergeni" class="form-input" name="allergeni" maxlength="255" value="${escapeHtml(values.allergeni)}" placeholder="Es. glutine, latte, uova">
						</div>
					</div>

					<div class="form-group" style="margin-bottom: 0;">
						<label class="toggle-wrapper">
							<input class="toggle" type="checkbox" name="disponibile"${values.disponibile ? ' checked' : ''}>
							<span class="form-label" style="margin: 0;">Disponibile nel menu</span>
						</label>
					</div>

					${state.editModal.error ? `<div class="form-error" style="margin-top: 12px;">⚠️ ${escapeHtml(state.editModal.error)}</div>` : ''}
				</div>

				<div class="modal-footer">
					<button type="button" class="btn btn-ghost" data-action="close-edit-modal">❌ Annulla</button>
					<button type="submit" class="btn btn-primary">${submitLabel}</button>
				</div>
			</form>
		</div>
	</div>`
}

function renderDeleteConfirmModal() {
	if (!state.confirmModal.open) {
		return ''
	}

	return `
	<div class="modal-overlay" data-action="close-confirm-modal-bg">
		<div class="modal modal-sm modal-confirm" role="dialog" aria-modal="true" aria-label="Conferma eliminazione">
			<div class="modal-header">
				<div>
					<div class="modal-title">Conferma eliminazione</div>
					<div class="modal-subtitle">Questa operazione non puo essere annullata</div>
				</div>
				<button class="modal-close" type="button" data-action="close-confirm-modal">×</button>
			</div>

			<div class="modal-body">
				<div class="confirm-icon">🗑️</div>
				<div class="confirm-message">Vuoi eliminare il piatto <strong>${escapeHtml(state.confirmModal.nome)}</strong>?</div>
				${state.confirmModal.error ? `<div class="form-error" style="margin-top: 12px; justify-content: center;">⚠️ ${escapeHtml(state.confirmModal.error)}</div>` : ''}
			</div>

			<div class="modal-footer">
				<button type="button" class="btn btn-ghost" data-action="close-confirm-modal">❌ Annulla</button>
				<button type="button" class="btn btn-danger" data-action="delete-piatto-confirmed">🗑️ Elimina</button>
			</div>
		</div>
	</div>`
}

function renderLoading() {
	return `
	<div class="empty-state page-menu">
		<div class="spinner" aria-hidden="true"></div>
		<div class="empty-state-title">Caricamento menu</div>
		<div class="empty-state-sub">Recupero categorie e piatti in corso...</div>
	</div>`
}

function renderError() {
	return `
	<div class="empty-state page-menu">
		<div class="empty-state-icon">⚠️</div>
		<div class="empty-state-title">Errore caricamento menu</div>
		<div class="empty-state-sub">${escapeHtml(state.errorMessage || 'Errore sconosciuto')}</div>
		<button class="btn btn-primary" data-action="retry-load">🔄 Riprova</button>
	</div>`
}

function render() {
	if (state.loading) {
		return renderLoading()
	}

	if (state.errorMessage) {
		return renderError()
	}

	var piattiFiltrati = getPiattiFiltrati()
	var isEmpty = state.piatti.length === 0

	return `
	<div class="card">
		<div class="section-title">Gestione menu</div>

		<div class="tabella-toolbar" style="margin-bottom: 14px;">
			<button class="btn btn-primary" data-action="open-create-modal">➕ Nuovo piatto</button>
			<div class="form-group" style="margin: 0 0 0 auto; min-width: 240px;">
				<label class="form-label" for="menu-filter-categoria">Filtro categoria</label>
				<select id="menu-filter-categoria" class="form-select" data-action="filter-categoria">
					${renderCategoriaFilterOptions()}
				</select>
			</div>
		</div>

		${state.noticeMessage ? `<div class="card" style="margin-bottom: 14px; padding: 12px 14px;">${escapeHtml(state.noticeMessage)}</div>` : ''}

		<div class="table-wrapper">
			<table>
				<thead>
					<tr>
						<th>Nome</th>
						<th>Categoria</th>
						<th class="th-right">Prezzo</th>
						<th class="th-right">Tempo prep</th>
						<th class="th-center">Disponibile</th>
						<th class="th-right">Azioni</th>
					</tr>
				</thead>
				<tbody>
					${renderRows()}
				</tbody>
			</table>
		</div>

		${isEmpty ? `
		<div class="empty-state" style="padding: 28px 18px;">
			<div class="empty-state-icon">🍽️</div>
			<div class="empty-state-title">Nessun piatto presente</div>
			<div class="empty-state-sub">Aggiungi il primo piatto con il pulsante Nuovo piatto.</div>
		</div>` : ''}

		${!isEmpty && !piattiFiltrati.length ? `
		<div class="empty-state" style="padding: 28px 18px;">
			<div class="empty-state-icon">🔎</div>
			<div class="empty-state-title">Nessun risultato</div>
			<div class="empty-state-sub">Nessun piatto trovato per la categoria selezionata.</div>
		</div>` : ''}
	</div>

	${renderEditModal()}
	${renderDeleteConfirmModal()}`
}

function rerender() {
	if (!state.container) return
	state.container.innerHTML = render()
}

async function refreshData() {
	var results = await Promise.all([
		window.api.menu.getCategorie(),
		window.api.menu.getPiatti(),
	])

	state.categorie = Array.isArray(results[0]) ? results[0] : []
	state.piatti = Array.isArray(results[1]) ? results[1] : []
}

function openCreateModal() {
	state.editModal = {
		open: true,
		mode: 'create',
		error: '',
		values: {
			id: '',
			nome: '',
			descrizione: '',
			prezzo: '',
			categoria_id: '',
			tempo_preparazione: '0',
			allergeni: '',
			disponibile: true,
		},
	}
	rerender()
}

function openEditModal(id) {
	var piatto = findPiattoById(id)
	if (!piatto) {
		state.noticeMessage = 'Piatto non trovato'
		rerender()
		return
	}

	state.editModal = {
		open: true,
		mode: 'edit',
		error: '',
		values: {
			id: String(piatto.id),
			nome: String(piatto.nome || ''),
			descrizione: String(piatto.descrizione || ''),
			prezzo: String(toNumber(piatto.prezzo)),
			categoria_id: String(piatto.categoria_id || ''),
			tempo_preparazione: String(Math.max(0, Math.round(toNumber(piatto.tempo_preparazione)))),
			allergeni: String(piatto.allergeni || ''),
			disponibile: isDisponibile(piatto.disponibile),
		},
	}
	rerender()
}

function closeEditModal() {
	state.editModal.open = false
	state.editModal.error = ''
	rerender()
}

function openDeleteConfirm(id) {
	var piatto = findPiattoById(id)
	if (!piatto) {
		state.noticeMessage = 'Piatto non trovato'
		rerender()
		return
	}

	state.confirmModal.open = true
	state.confirmModal.id = Number(id)
	state.confirmModal.nome = String(piatto.nome || 'Piatto')
	state.confirmModal.error = ''
	rerender()
}

function closeDeleteConfirm() {
	state.confirmModal.open = false
	state.confirmModal.error = ''
	rerender()
}

function readFormPayload(form) {
	var formData = new FormData(form)
	var payload = {
		nome: String(formData.get('nome') || '').trim(),
		descrizione: String(formData.get('descrizione') || '').trim() || null,
		prezzo: toNumber(formData.get('prezzo')),
		categoria_id: toNumber(formData.get('categoria_id')),
		tempo_preparazione: Math.max(0, Math.round(toNumber(formData.get('tempo_preparazione')))),
		allergeni: String(formData.get('allergeni') || '').trim() || null,
		disponibile: formData.get('disponibile') ? 1 : 0,
	}
	var id = String(formData.get('id') || '').trim()
	if (id) {
		payload.id = Number(id)
	}
	return payload
}

function validatePayload(payload) {
	if (!payload.nome) {
		return 'Il nome del piatto e obbligatorio'
	}
	if (!payload.categoria_id) {
		return 'Seleziona una categoria'
	}
	if (payload.prezzo < 0) {
		return 'Il prezzo non puo essere negativo'
	}
	if (payload.tempo_preparazione < 0) {
		return 'Il tempo di preparazione non puo essere negativo'
	}
	return ''
}

async function savePiatto(form) {
	var payload = readFormPayload(form)
	state.editModal.values = {
		id: String(payload.id || ''),
		nome: String(payload.nome || ''),
		descrizione: String(payload.descrizione || ''),
		prezzo: String(payload.prezzo),
		categoria_id: String(payload.categoria_id || ''),
		tempo_preparazione: String(payload.tempo_preparazione),
		allergeni: String(payload.allergeni || ''),
		disponibile: payload.disponibile === 1,
	}

	var validationError = validatePayload(payload)
	if (validationError) {
		state.editModal.error = validationError
		rerender()
		return
	}

	state.editModal.error = ''
	if (payload.id) {
		await window.api.menu.updatePiatto(payload)
		state.noticeMessage = 'Piatto aggiornato correttamente'
	} else {
		await window.api.menu.addPiatto(payload)
		state.noticeMessage = 'Piatto creato correttamente'
	}

	state.editModal.open = false
	await refreshData()
	rerender()
}

async function deletePiattoConfirmed() {
	if (!state.confirmModal.id) {
		state.confirmModal.error = 'ID piatto non valido'
		rerender()
		return
	}

	await window.api.menu.deletePiatto(state.confirmModal.id)
	state.noticeMessage = 'Piatto eliminato correttamente'
	state.confirmModal.open = false
	state.confirmModal.error = ''
	await refreshData()
	rerender()
}

async function toggleDisponibile(id) {
	await window.api.menu.toggleDisponibile(Number(id))
	state.noticeMessage = 'Disponibilita aggiornata'
	await refreshData()
	rerender()
}

function initEvents(container) {
	if (container.__menuEventsBound) return
	container.__menuEventsBound = true

	container.addEventListener('click', function (event) {
		var target = event.target
		if (!(target instanceof Element)) return
		var actionNode = target.closest('[data-action]')
		if (!actionNode) return

		var action = actionNode.getAttribute('data-action')
		var id = actionNode.getAttribute('data-id')

		if (action === 'open-create-modal') {
			openCreateModal()
			return
		}

		if (action === 'edit-piatto') {
			openEditModal(id)
			return
		}

		if (action === 'confirm-delete-piatto') {
			openDeleteConfirm(id)
			return
		}

		if (action === 'delete-piatto-confirmed') {
			deletePiattoConfirmed().catch(function (error) {
				state.confirmModal.error = error && error.message ? error.message : 'Errore eliminazione piatto'
				rerender()
			})
			return
		}

		if (action === 'close-edit-modal' || action === 'close-edit-modal-bg') {
			if (action === 'close-edit-modal-bg' && !actionNode.classList.contains('modal-overlay')) return
			closeEditModal()
			return
		}

		if (action === 'close-confirm-modal' || action === 'close-confirm-modal-bg') {
			if (action === 'close-confirm-modal-bg' && !actionNode.classList.contains('modal-overlay')) return
			closeDeleteConfirm()
			return
		}

		if (action === 'retry-load') {
			load(container)
		}
	})

	container.addEventListener('change', function (event) {
		var target = event.target
		if (!(target instanceof Element)) return
		var action = target.getAttribute('data-action')

		if (action === 'filter-categoria') {
			state.filtroCategoria = target.value || 'all'
			rerender()
			return
		}

		if (action === 'toggle-disponibile') {
			var id = target.getAttribute('data-id')
			toggleDisponibile(id).catch(function (error) {
				state.noticeMessage = error && error.message ? error.message : 'Errore aggiornamento disponibilita'
				rerender()
			})
		}
	})

	container.addEventListener('submit', function (event) {
		var form = event.target
		if (!(form instanceof HTMLFormElement)) return
		if (form.getAttribute('data-action') !== 'submit-piatto-form') return

		event.preventDefault()
		savePiatto(form).catch(function (error) {
			state.editModal.error = error && error.message ? error.message : 'Errore salvataggio piatto'
			rerender()
		})
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
		state.errorMessage = error && error.message ? error.message : 'Impossibile caricare dati menu'
	} finally {
		state.loading = false
		rerender()
		initEvents(container)
	}
}

var pageApi = { render, initEvents, load }

if (typeof window !== 'undefined') {
	window.pages = window.pages || {}
	window.pages.menu = pageApi
}

if (typeof module !== 'undefined' && module.exports) {
	module.exports = pageApi
}

})()
