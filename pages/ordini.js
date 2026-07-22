;(function () {

var state = {
	container: null,
	loading: false,
	errorMessage: '',
	noticeMessage: '',
	ordini: [],
	filtroStato: 'tutti',
	modal: {
		open: false,
		error: '',
		saving: false,
		values: {
			fornitore: '',
			data_ordine: '',
			data_consegna_prevista: '',
			note: '',
			stato: 'inviato',
			righe: [
				{ ingrediente_id: '', quantita: '', prezzo: '' },
			],
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

function formatCurrency(value) {
	return toNumber(value).toFixed(2) + ' EUR'
}

function formatDate(value) {
	if (!value) {
		return '-'
	}

	var date = new Date(value)
	if (Number.isNaN(date.getTime())) {
		return '-'
	}

	return date.toLocaleDateString('it-IT')
}

function todayIso() {
	return new Date().toISOString().slice(0, 10)
}

function mapStatoToBadge(stato) {
	switch (String(stato || '').toLowerCase()) {
		case 'ricevuto':
			return { className: 'badge-green', label: 'Ricevuto' }
		case 'parziale':
			return { className: 'badge-amber', label: 'Parziale' }
		case 'inviato':
			return { className: 'badge-blue', label: 'Inviato' }
		default:
			return { className: 'badge-dim', label: stato || 'Sconosciuto' }
	}
}

function getOrdiniFiltrati() {
	if (state.filtroStato === 'tutti') {
		return state.ordini.slice()
	}

	return state.ordini.filter(function (ordine) {
		return String(ordine.stato || '').toLowerCase() === String(state.filtroStato).toLowerCase()
	})
}

function calculateRowsTotal(righe) {
	return righe.reduce(function (acc, row) {
		return acc + (toNumber(row.quantita) * toNumber(row.prezzo))
	}, 0)
}

function renderLoading() {
	return `
	<div class="empty-state page-ordini">
		<div class="spinner" aria-hidden="true"></div>
		<div class="empty-state-title">Caricamento ordini fornitori</div>
		<div class="empty-state-sub">Recupero ordini in corso...</div>
	</div>`
}

function renderError() {
	return `
	<div class="empty-state page-ordini">
		<div class="empty-state-icon">⚠️</div>
		<div class="empty-state-title">Errore caricamento ordini</div>
		<div class="empty-state-sub">${escapeHtml(state.errorMessage || 'Errore sconosciuto')}</div>
		<button class="btn btn-primary" data-action="retry-load">🔄 Riprova</button>
	</div>`
}

function renderFilterOptions() {
	var current = state.filtroStato
	return `
		<option value="tutti"${current === 'tutti' ? ' selected' : ''}>Tutti gli stati</option>
		<option value="inviato"${current === 'inviato' ? ' selected' : ''}>Inviato</option>
		<option value="parziale"${current === 'parziale' ? ' selected' : ''}>Parziale</option>
		<option value="ricevuto"${current === 'ricevuto' ? ' selected' : ''}>Ricevuto</option>`
}

function renderRows() {
	var ordini = getOrdiniFiltrati()

	if (!ordini.length) {
		return `
		<tr>
			<td colspan="6" class="td-center td-dim">Nessun ordine trovato per il filtro selezionato</td>
		</tr>`
	}

	return ordini.map(function (ordine) {
		var badge = mapStatoToBadge(ordine.stato)
		var azioneRicevi = String(ordine.stato || '').toLowerCase() === 'inviato'
			? `<button class="btn btn-success btn-sm" data-action="ricevi-ordine" data-id="${ordine.id}">📦 Ricevi ordine</button>`
			: ''

		return `
		<tr>
			<td>${escapeHtml(ordine.fornitore || '-')}</td>
			<td>${escapeHtml(formatDate(ordine.data_ordine))}</td>
			<td>${escapeHtml(formatDate(ordine.data_consegna_prevista))}</td>
			<td class="td-center"><span class="badge ${badge.className}">${escapeHtml(badge.label)}</span></td>
			<td class="td-right td-mono">${formatCurrency(ordine.totale)}</td>
			<td class="td-right">
				${azioneRicevi}
				<button class="btn btn-danger btn-sm" data-action="delete-ordine" data-id="${ordine.id}">🗑️ Elimina</button>
			</td>
		</tr>`
	}).join('')
}

function renderRigheRows() {
	var righe = state.modal.values.righe
	return righe.map(function (row, index) {
		return `
		<tr>
			<td>
				<input class="form-input" name="ingrediente_nome_${index}" type="text" value="${escapeHtml(row.ingrediente_nome || '')}" placeholder="Nome ingrediente">
			</td>
			<td>
				<input class="form-input" name="quantita_${index}" type="number" min="0.01" step="0.01" value="${escapeHtml(row.quantita)}" placeholder="Quantita">
			</td>
			<td>
				<input class="form-input" name="prezzo_${index}" type="number" min="0" step="0.01" value="${escapeHtml(row.prezzo)}" placeholder="Prezzo unitario">
			</td>
			<td class="td-right td-mono">${formatCurrency(toNumber(row.quantita) * toNumber(row.prezzo))}</td>
			<td class="td-right">
				<button type="button" class="btn btn-danger btn-sm" data-action="remove-riga" data-index="${index}">➖ Rimuovi</button>
			</td>
		</tr>`
	}).join('')
}

function renderModal() {
	if (!state.modal.open) {
		return ''
	}

	var values = state.modal.values
	var totaleRighe = calculateRowsTotal(values.righe)

	return `
	<div class="modal-overlay" data-action="close-modal-bg">
		<div class="modal modal-lg" role="dialog" aria-modal="true" aria-label="Nuovo ordine fornitore">
			<div class="modal-header">
				<div>
					<div class="modal-title">Nuovo ordine fornitore</div>
					<div class="modal-subtitle">Inserisci dati ordine e righe di acquisto</div>
				</div>
				<button class="modal-close" type="button" data-action="close-modal">×</button>
			</div>

			<form data-action="submit-ordine-form" style="display:flex; flex-direction:column; flex:1; overflow:hidden; min-height:0;">
				<div class="modal-body">
					<div class="form-group">
						<label class="form-label" for="ordine-fornitore">Fornitore</label>
						<input id="ordine-fornitore" class="form-input" name="fornitore" maxlength="140" required value="${escapeHtml(values.fornitore)}" placeholder="Es. Mercato Centrale">
					</div>

					<div class="form-row">
						<div class="form-group">
							<label class="form-label" for="ordine-data">Data ordine</label>
							<input id="ordine-data" class="form-input" name="data_ordine" type="date" required value="${escapeHtml(values.data_ordine)}">
						</div>

						<div class="form-group">
							<label class="form-label" for="ordine-consegna">Data consegna prevista</label>
							<input id="ordine-consegna" class="form-input" name="data_consegna_prevista" type="date" value="${escapeHtml(values.data_consegna_prevista)}">
						</div>
					</div>

					<div class="form-row">
						<div class="form-group">
							<label class="form-label" for="ordine-stato">Stato</label>
							<select id="ordine-stato" class="form-select" name="stato">
								<option value="inviato"${values.stato === 'inviato' ? ' selected' : ''}>Inviato</option>
								<option value="parziale"${values.stato === 'parziale' ? ' selected' : ''}>Parziale</option>
								<option value="ricevuto"${values.stato === 'ricevuto' ? ' selected' : ''}>Ricevuto</option>
							</select>
						</div>

						<div class="form-group">
							<label class="form-label" for="ordine-note">Note</label>
							<input id="ordine-note" class="form-input" name="note" maxlength="240" value="${escapeHtml(values.note)}" placeholder="Note facoltative">
						</div>
					</div>

					<div class="section-title" style="margin-top: 6px;">Righe ordine</div>
					<div class="table-wrapper">
						<table>
							<thead>
								<tr>
									<th>ID ingrediente</th>
									<th>Quantita</th>
									<th>Prezzo unitario</th>
									<th class="th-right">Subtotale</th>
									<th class="th-right">Azioni</th>
								</tr>
							</thead>
							<tbody>
								${renderRigheRows()}
							</tbody>
						</table>
					</div>

					<div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px;">
						<button type="button" class="btn btn-secondary btn-sm" data-action="add-riga">➕ Aggiungi riga</button>
						<div class="label">Totale ordine: <strong>${formatCurrency(totaleRighe)}</strong></div>
					</div>

					${state.modal.error ? `<div class="form-error" style="margin-top: 12px;">⚠️ ${escapeHtml(state.modal.error)}</div>` : ''}
				</div>

				<div class="modal-footer">
					<button type="button" class="btn btn-ghost" data-action="close-modal">❌ Annulla</button>
					<button type="submit" class="btn btn-primary"${state.modal.saving ? ' disabled' : ''}>✅ Crea ordine</button>
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

	var noData = state.ordini.length === 0
	var noFilterResult = !noData && getOrdiniFiltrati().length === 0

	return `
	<div class="card">
		<div class="section-title">Ordini fornitori</div>

		<div class="tabella-toolbar" style="margin-bottom: 14px;">
			<button class="btn btn-primary" data-action="open-modal">➕ Nuovo ordine</button>
			<div class="form-group" style="margin: 0 0 0 auto; min-width: 220px;">
				<label class="form-label" for="ordini-filtro-stato">Filtro stato</label>
				<select id="ordini-filtro-stato" class="form-select" data-action="filter-stato">
					${renderFilterOptions()}
				</select>
			</div>
		</div>

		${state.noticeMessage ? `<div class="card" style="margin-bottom: 14px; padding: 12px 14px;">${escapeHtml(state.noticeMessage)}</div>` : ''}

		<div class="table-wrapper">
			<table>
				<thead>
					<tr>
						<th>Fornitore</th>
						<th>Data ordine</th>
						<th>Consegna prevista</th>
						<th class="th-center">Stato</th>
						<th class="th-right">Totale</th>
						<th class="th-right">Azioni</th>
					</tr>
				</thead>
				<tbody>
					${renderRows()}
				</tbody>
			</table>
		</div>

		${noData ? `
		<div class="empty-state" style="padding: 28px 16px;">
			<div class="empty-state-icon">🚚</div>
			<div class="empty-state-title">Nessun ordine fornitore</div>
			<div class="empty-state-sub">Crea il primo ordine con il pulsante Nuovo ordine.</div>
		</div>` : ''}

		${noFilterResult ? `
		<div class="empty-state" style="padding: 28px 16px;">
			<div class="empty-state-icon">🔎</div>
			<div class="empty-state-title">Nessun risultato</div>
			<div class="empty-state-sub">Nessun ordine trovato per lo stato selezionato.</div>
		</div>` : ''}
	</div>

	${renderModal()}`
}

function rerender() {
	if (!state.container) return
	state.container.innerHTML = render()
}

async function refreshData() {
	var ordini = await window.api.ordini.getOrdiniFornitori()
	state.ordini = Array.isArray(ordini) ? ordini : []
}

function openModal() {
	state.modal.open = true
	state.modal.error = ''
	state.modal.saving = false
	state.modal.values = {
		fornitore: '',
		data_ordine: todayIso(),
		data_consegna_prevista: '',
		note: '',
		stato: 'inviato',
		righe: [{ ingrediente_id: '', quantita: '', prezzo: '' }],
	}
	rerender()
}

function closeModal() {
	state.modal.open = false
	state.modal.error = ''
	state.modal.saving = false
	rerender()
}

function addRiga() {
	state.modal.values.righe.push({ ingrediente_nome: '', quantita: '', prezzo: '' })
	rerender()
}

function removeRiga(index) {
	if (state.modal.values.righe.length <= 1) {
		state.modal.error = 'E necessario almeno una riga ordine'
		rerender()
		return
	}

	state.modal.values.righe.splice(index, 1)
	rerender()
}

function updateRigaField(index, field, value) {
	var row = state.modal.values.righe[index]
	if (!row) return
	row[field] = value
	rerender()
}

function validatePayload(payload) {
	if (!payload.fornitore) {
		return 'Il fornitore e obbligatorio'
	}

	if (!payload.data_ordine) {
		return 'La data ordine e obbligatoria'
	}

	if (!Array.isArray(payload.ingredienti) || payload.ingredienti.length === 0) {
		return 'Inserisci almeno una riga ordine'
	}

	for (var i = 0; i < payload.ingredienti.length; i += 1) {
		var riga = payload.ingredienti[i]
		if (!riga.ingrediente_nome) {
			return 'Inserisci il nome dell\'ingrediente per ogni riga'
		}
		if (riga.quantita <= 0) {
			return 'La quantita di ogni riga deve essere maggiore di zero'
		}
		if (riga.prezzo < 0) {
			return 'Il prezzo non puo essere negativo'
		}
	}

	return ''
}

function buildPayload(form) {
	var formData = new FormData(form)
	var righe = state.modal.values.righe.map(function (_row, index) {
		return {
			ingrediente_nome: String(formData.get(`ingrediente_nome_${index}`) || '').trim(),
			quantita: toNumber(formData.get(`quantita_${index}`)),
			prezzo: toNumber(formData.get(`prezzo_${index}`)),
		}
	}).filter(function (riga) {
		return riga.ingrediente_nome || riga.quantita || riga.prezzo
	})

	return {
		fornitore: String(formData.get('fornitore') || '').trim(),
		data_ordine: String(formData.get('data_ordine') || '').trim(),
		data_consegna_prevista: String(formData.get('data_consegna_prevista') || '').trim() || null,
		note: String(formData.get('note') || '').trim() || null,
		stato: String(formData.get('stato') || 'inviato').trim(),
		ingredienti: righe,
	}
}

async function saveOrdine(form) {
	var payload = buildPayload(form)
	var validationError = validatePayload(payload)
	if (validationError) {
		state.modal.error = validationError
		rerender()
		return
	}

	state.modal.error = ''
	state.modal.saving = true
	rerender()

	try {
		await window.api.ordini.addOrdineFornitore(payload)
		state.modal.open = false
		state.modal.saving = false
		state.noticeMessage = 'Ordine creato correttamente'
		await refreshData()
		rerender()
	} catch (error) {
		state.modal.saving = false
		state.modal.error = error && error.message ? error.message : 'Errore creazione ordine'
		rerender()
	}
}

async function riceviOrdine(id) {
	try {
		await window.api.ordini.riceviOrdine(Number(id))
		state.noticeMessage = 'Ordine ricevuto e magazzino aggiornato'
		await refreshData()
		rerender()
	} catch (error) {
		state.noticeMessage = error && error.message ? error.message : 'Errore ricezione ordine'
		rerender()
	}
}

async function deleteOrdine(id) {
	var ordine = state.ordini.find(function (item) {
		return String(item.id) === String(id)
	})
	if (!ordine) return

	var confirmed = window.confirm(`Confermi l'eliminazione dell'ordine #${ordine.id} (${ordine.fornitore})?`)
	if (!confirmed) return

	try {
		await window.api.ordini.deleteOrdine(Number(id))
		state.noticeMessage = 'Ordine eliminato correttamente'
		await refreshData()
		rerender()
	} catch (error) {
		state.noticeMessage = error && error.message ? error.message : 'Errore eliminazione ordine'
		rerender()
	}
}

function initEvents(container) {
	if (container.__ordiniEventsBound) return
	container.__ordiniEventsBound = true

	container.addEventListener('click', function (event) {
		var target = event.target
		if (!(target instanceof Element)) return

		var actionNode = target.closest('[data-action]')
		if (!actionNode) return

		var action = actionNode.getAttribute('data-action')
		var id = actionNode.getAttribute('data-id')
		var index = actionNode.getAttribute('data-index')

		if (action === 'retry-load') {
			load(container)
			return
		}

		if (action === 'open-modal') {
			openModal()
			return
		}

		if (action === 'close-modal' || action === 'close-modal-bg') {
			if (action === 'close-modal-bg' && !actionNode.classList.contains('modal-overlay')) return
			closeModal()
			return
		}

		if (action === 'add-riga') {
			addRiga()
			return
		}

		if (action === 'remove-riga') {
			removeRiga(Number(index))
			return
		}

		if (action === 'ricevi-ordine') {
			riceviOrdine(id)
			return
		}

		if (action === 'delete-ordine') {
			deleteOrdine(id)
		}
	})

	container.addEventListener('change', function (event) {
		var target = event.target
		if (!(target instanceof Element)) return

		var action = target.getAttribute('data-action')
		if (action === 'filter-stato') {
			state.filtroStato = target.value || 'tutti'
			rerender()
			return
		}

		if (state.modal.open) {
			var name = target.getAttribute('name') || ''
			if (name.startsWith('ingrediente_nome_')) {
				updateRigaField(Number(name.replace('ingrediente_nome_', '')), 'ingrediente_nome', target.value)
			}
			if (name.startsWith('quantita_')) {
				updateRigaField(Number(name.replace('quantita_', '')), 'quantita', target.value)
			}
			if (name.startsWith('prezzo_')) {
				updateRigaField(Number(name.replace('prezzo_', '')), 'prezzo', target.value)
			}
		}
	})

	container.addEventListener('submit', function (event) {
		var form = event.target
		if (!(form instanceof HTMLFormElement)) return
		if (form.getAttribute('data-action') !== 'submit-ordine-form') return

		event.preventDefault()
		saveOrdine(form)
	})
}

async function load(container) {
	state.container = container
	state.loading = true
	state.errorMessage = ''
	state.noticeMessage = ''
	rerender()

	try {
		var results = await Promise.all([
			window.api.ordini.getOrdiniFornitori(),
			window.api.magazzino.getIngredienti(),
		])
		state.ordini = Array.isArray(results[0]) ? results[0] : []
		state.ingredientielenco = Array.isArray(results[1]) ? results[1] : []
	} catch (error) {
		state.errorMessage = error && error.message ? error.message : 'Impossibile caricare gli ordini fornitori'
	} finally {
		state.loading = false
		rerender()
		initEvents(container)
	}
}

var pageApi = { render, initEvents, load }

if (typeof window !== 'undefined') {
	window.pages = window.pages || {}
	window.pages.ordini = pageApi
}

if (typeof module !== 'undefined' && module.exports) {
	module.exports = pageApi
}

})()
