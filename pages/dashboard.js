;(function () {

var state = {
	container: null,
	isLoading: false,
	errorMessage: '',
	noticeMessage: '',
	piatti: [],
	ingredienti: [],
	scorteBasse: [],
	personale: [],
	modal: {
		open: false,
		error: '',
		values: {
			ingredienteId: '',
			quantita: '',
			priorita: 'media',
			note: '',
		},
	},
}

function toArray(value) {
	return Array.isArray(value) ? value : []
}

function toNumber(value) {
	var parsed = Number(value)
	return Number.isFinite(parsed) ? parsed : 0
}

function escapeHtml(value) {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')
}

function countDipendentiAttivi(personale) {
	return personale.filter(function (dipendente) {
		if (dipendente && dipendente.attivo === undefined) {
			return true
		}
		return toNumber(dipendente && dipendente.attivo) === 1
	}).length
}

function renderScorteRows(scorteBasse) {
	if (!scorteBasse.length) {
		return `
		<tr>
			<td colspan="4" class="td-center td-dim">Nessuna scorta bassa rilevata</td>
		</tr>`
	}

	return scorteBasse
		.map(function (ingrediente) {
			var nome = escapeHtml(ingrediente && ingrediente.nome ? ingrediente.nome : 'Ingrediente')
			var scorta = toNumber(ingrediente && ingrediente.scorta)
			var scortaMin = toNumber(ingrediente && ingrediente.scorta_min)
			var esaurito = scorta <= 0
			var badgeClass = esaurito ? 'badge-red' : 'badge-amber'
			var badgeText = esaurito ? 'Esaurito' : 'Basso'

			return `
			<tr>
				<td>${nome}</td>
				<td class="td-right td-mono">${scorta}</td>
				<td class="td-right td-mono">${scortaMin}</td>
				<td class="td-center"><span class="badge ${badgeClass}">${badgeText}</span></td>
			</tr>`
		})
		.join('')
}

function renderIngredientiOptions(ingredienti, selectedId) {
	var current = String(selectedId || '')
	var options = ['<option value="">Seleziona ingrediente</option>']

	ingredienti.forEach(function (ingrediente) {
		var id = String(ingrediente.id)
		var selected = id === current ? ' selected' : ''
		options.push(`<option value="${id}"${selected}>${escapeHtml(ingrediente.nome || 'Ingrediente')}</option>`)
	})

	return options.join('')
}

function renderModal() {
	if (!state.modal.open) {
		return ''
	}

	var values = state.modal.values
	var modalError = state.modal.error

	return `
	<div class="modal-overlay" data-action="close-dashboard-modal-bg">
		<div class="modal modal-lg" role="dialog" aria-modal="true" aria-label="Nuova segnalazione scorta">
			<div class="modal-header">
				<div>
					<div class="modal-title">Nuova segnalazione scorta</div>
					<div class="modal-subtitle">Registra una richiesta di riordino manuale</div>
				</div>
				<button type="button" class="modal-close" data-action="close-dashboard-modal" aria-label="Chiudi">×</button>
			</div>

			<form data-action="submit-dashboard-alert">
				<div class="modal-body">
					<div class="form-group">
						<label class="form-label" for="dash-ingrediente">Ingrediente</label>
						<select id="dash-ingrediente" name="ingredienteId" class="form-select" required>
							${renderIngredientiOptions(state.ingredienti, values.ingredienteId)}
						</select>
					</div>

					<div class="form-row">
						<div class="form-group">
							<label class="form-label" for="dash-quantita">Quantita da ordinare</label>
							<input id="dash-quantita" name="quantita" class="form-input" type="number" min="1" step="1" required value="${escapeHtml(values.quantita)}">
						</div>

						<div class="form-group">
							<label class="form-label" for="dash-priorita">Priorita</label>
							<select id="dash-priorita" name="priorita" class="form-select" required>
								<option value="bassa"${values.priorita === 'bassa' ? ' selected' : ''}>Bassa</option>
								<option value="media"${values.priorita === 'media' ? ' selected' : ''}>Media</option>
								<option value="alta"${values.priorita === 'alta' ? ' selected' : ''}>Alta</option>
							</select>
						</div>
					</div>

					<div class="form-group" style="margin-bottom: 0;">
						<label class="form-label" for="dash-note">Note operative</label>
						<textarea id="dash-note" name="note" class="form-textarea" rows="4" placeholder="Inserisci eventuali note per il riordino...">${escapeHtml(values.note)}</textarea>
					</div>

					${modalError ? `<div class="form-error" style="margin-top: 12px;">⚠️ ${escapeHtml(modalError)}</div>` : ''}
				</div>

				<div class="modal-footer">
					<button type="button" class="btn btn-ghost" data-action="close-dashboard-modal">❌ Annulla</button>
					<button type="submit" class="btn btn-primary">💾 Salva segnalazione</button>
				</div>
			</form>
		</div>
	</div>`
}

function render() {
	if (state.isLoading) {
		return `
		<div class="empty-state">
			<div class="spinner" aria-hidden="true"></div>
			<div class="empty-state-title">Caricamento dashboard</div>
			<div class="empty-state-sub">Recupero indicatori e stato magazzino in corso...</div>
		</div>`
	}

	if (state.errorMessage) {
		return `
		<div class="empty-state">
			<div class="empty-state-icon">⚠️</div>
			<div class="empty-state-title">Errore caricamento dashboard</div>
			<div class="empty-state-sub">${escapeHtml(state.errorMessage)}</div>
			<button class="btn btn-primary" data-action="retry-dashboard">🔄 Riprova</button>
		</div>`
	}

	var piatti = toArray(state.piatti)
	var ingredienti = toArray(state.ingredienti)
	var scorteBasse = toArray(state.scorteBasse)
	var personale = toArray(state.personale)

	var totalePiatti = piatti.length
	var totaleIngredienti = ingredienti.length
	var totaleScorteBasse = scorteBasse.length
	var dipendentiAttivi = countDipendentiAttivi(personale)

	var kpiScorteStyle = totaleScorteBasse > 0 ? ' style="color: var(--danger);"' : ''
	var showGlobalEmptyState = totalePiatti === 0 && totaleIngredienti === 0 && dipendentiAttivi === 0

	return `
	<div class="card" style="margin-bottom: 16px;">
		<div class="section-title">Panoramica operativa</div>
		<div style="display: flex; justify-content: flex-end; gap: 10px; margin-bottom: 4px;">
			<button class="btn btn-secondary" data-action="open-dashboard-modal">➕ Nuova segnalazione</button>
			<button class="btn btn-primary" data-action="refresh-dashboard">🔄 Aggiorna</button>
		</div>
	</div>

	<div class="grid-kpi">
		<div class="kpi-card">
			<div class="kpi-icon">🍽️</div>
			<div class="kpi-label">Totale piatti</div>
			<div class="kpi-value">${totalePiatti}</div>
		</div>

		<div class="kpi-card">
			<div class="kpi-icon">🥕</div>
			<div class="kpi-label">Totale ingredienti</div>
			<div class="kpi-value">${totaleIngredienti}</div>
		</div>

		<div class="kpi-card">
			<div class="kpi-icon">🚨</div>
			<div class="kpi-label">Scorte basse</div>
			<div class="kpi-value"${kpiScorteStyle}>${totaleScorteBasse}</div>
		</div>

		<div class="kpi-card">
			<div class="kpi-icon">👥</div>
			<div class="kpi-label">Dipendenti attivi</div>
			<div class="kpi-value">${dipendentiAttivi}</div>
		</div>
	</div>

	<div class="card" style="margin-top: 16px;">
		<div class="section-title">Scorte basse</div>
		<div class="table-wrapper">
			<table>
				<thead>
					<tr>
						<th>Ingrediente</th>
						<th class="th-right">Scorta attuale</th>
						<th class="th-right">Scorta minima</th>
						<th class="th-center">Stato</th>
					</tr>
				</thead>
				<tbody>
					${renderScorteRows(scorteBasse)}
				</tbody>
			</table>
		</div>
	</div>

	${showGlobalEmptyState ? `
	<div class="empty-state" style="margin-top: 16px;">
		<div class="empty-state-icon">📊</div>
		<div class="empty-state-title">Nessun dato disponibile</div>
		<div class="empty-state-sub">Inizia inserendo categorie, ingredienti e personale per popolare la dashboard.</div>
	</div>` : ''}

	${state.noticeMessage ? `
	<div class="card" style="margin-top: 16px;">
		<div class="section-title">Ultima segnalazione</div>
		<div>${escapeHtml(state.noticeMessage)}</div>
	</div>` : ''}

	${renderModal()}`
}

function rerender() {
	if (!state.container) return
	state.container.innerHTML = render()
}

function openModal() {
	state.modal.open = true
	state.modal.error = ''
	rerender()
}

function closeModal() {
	state.modal.open = false
	state.modal.error = ''
	rerender()
}

function readFormValues(form) {
	var formData = new FormData(form)
	state.modal.values = {
		ingredienteId: String(formData.get('ingredienteId') || ''),
		quantita: String(formData.get('quantita') || ''),
		priorita: String(formData.get('priorita') || 'media'),
		note: String(formData.get('note') || ''),
	}
	return state.modal.values
}

function handleModalSubmit(form) {
	var values = readFormValues(form)

	if (!values.ingredienteId) {
		state.modal.error = 'Seleziona un ingrediente'
		rerender()
		return
	}

	if (toNumber(values.quantita) <= 0) {
		state.modal.error = 'Inserisci una quantita valida'
		rerender()
		return
	}

	var selected = state.ingredienti.find(function (ingrediente) {
		return String(ingrediente.id) === values.ingredienteId
	})
	var ingredienteNome = selected && selected.nome ? selected.nome : 'Ingrediente'

	state.noticeMessage = `Riordino registrato: ${ingredienteNome}, quantita ${toNumber(values.quantita)}, priorita ${values.priorita}.`
	state.modal.open = false
	state.modal.error = ''
	rerender()
}

function initEvents(container) {
	if (container.__dashboardEventsBound) return
	container.__dashboardEventsBound = true

	container.addEventListener('click', function (event) {
		var target = event.target
		if (!(target instanceof Element)) return

		var actionNode = target.closest('[data-action]')
		if (!actionNode) return

		var action = actionNode.getAttribute('data-action')

		if (action === 'refresh-dashboard' || action === 'retry-dashboard') {
			load(container)
			return
		}

		if (action === 'open-dashboard-modal') {
			openModal()
			return
		}

		if (action === 'close-dashboard-modal') {
			closeModal()
			return
		}

		if (action === 'close-dashboard-modal-bg' && actionNode.classList.contains('modal-overlay')) {
			closeModal()
		}
	})

	container.addEventListener('submit', function (event) {
		var form = event.target
		if (!(form instanceof HTMLFormElement)) return
		if (form.getAttribute('data-action') !== 'submit-dashboard-alert') return

		event.preventDefault()
		handleModalSubmit(form)
	})
}

async function load(container) {
	state.container = container
	state.isLoading = true
	state.errorMessage = ''
	rerender()

	try {
		var results = await Promise.all([
			window.api.menu.getPiatti(),
			window.api.magazzino.getIngredienti(),
			window.api.magazzino.getScorteBasse(),
			window.api.personale.getPersonale(),
		])

		state.piatti = toArray(results[0])
		state.ingredienti = toArray(results[1])
		state.scorteBasse = toArray(results[2])
		state.personale = toArray(results[3])
	} catch (error) {
		state.errorMessage = error && error.message ? error.message : 'Impossibile recuperare i dati della dashboard'
	} finally {
		state.isLoading = false
		rerender()
		initEvents(container)
	}
}

var pageApi = { render, initEvents, load }

if (typeof window !== 'undefined') {
	window.pages = window.pages || {}
	window.pages.dashboard = pageApi
}

if (typeof module !== 'undefined' && module.exports) {
	module.exports = pageApi
}

})()
