;(function () {

var state = {
	container: null,
	isLoading: false,
	errorMessage: '',
	ricette: [],
	ingredienti: [],
	personale: [],
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

function render() {
	if (state.isLoading) {
		return `
		<div class="empty-state">
			<div class="spinner" aria-hidden="true"></div>
			<div class="empty-state-title">Caricamento dashboard</div>
			<div class="empty-state-sub">Recupero indicatori in corso...</div>
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

	var ricette = toArray(state.ricette)
	var ingredienti = toArray(state.ingredienti)
	var personale = toArray(state.personale)

	var totaleRicette = ricette.length
	var totaleIngredienti = ingredienti.length
	var dipendentiAttivi = countDipendentiAttivi(personale)

	var showGlobalEmptyState = totaleRicette === 0 && totaleIngredienti === 0 && dipendentiAttivi === 0

	return `
	<div class="card" style="margin-bottom: 16px;">
		<div class="section-title">Panoramica operativa</div>
		<div style="display: flex; justify-content: flex-end; gap: 10px; margin-bottom: 4px;">
			<button class="btn btn-primary" data-action="refresh-dashboard">🔄 Aggiorna</button>
		</div>
	</div>

	<div class="grid-kpi">
		<div class="kpi-card">
			<div class="kpi-icon">📖</div>
			<div class="kpi-label">Totale ricette</div>
			<div class="kpi-value">${totaleRicette}</div>
		</div>

		<div class="kpi-card">
			<div class="kpi-icon">🥕</div>
			<div class="kpi-label">Totale ingredienti</div>
			<div class="kpi-value">${totaleIngredienti}</div>
		</div>

		<div class="kpi-card">
			<div class="kpi-icon">👥</div>
			<div class="kpi-label">Dipendenti attivi</div>
			<div class="kpi-value">${dipendentiAttivi}</div>
		</div>
	</div>

	${showGlobalEmptyState ? `
	<div class="empty-state" style="margin-top: 16px;">
		<div class="empty-state-icon">📊</div>
		<div class="empty-state-title">Nessun dato disponibile</div>
		<div class="empty-state-sub">Inizia inserendo ricette e ingredienti per popolare la dashboard.</div>
	</div>` : ''}`
}

function rerender() {
	if (!state.container) return
	state.container.innerHTML = render()
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
		}
	})
}

async function load(container) {
	state.container = container
	state.isLoading = true
	state.errorMessage = ''
	rerender()

	try {
		var results = await Promise.all([
			window.api.ricette.getRicette(),
			window.api.magazzino.getIngredienti(),
			window.api.personale.getPersonale(),
		])

		state.ricette = toArray(results[0])
		state.ingredienti = toArray(results[1])
		state.personale = toArray(results[2])
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
