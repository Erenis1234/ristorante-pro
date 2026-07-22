;(function () {

var state = {
	container: null,
	loading: false,
	errorMessage: '',
	noticeMessage: '',
	searchQuery: '',
	dipendenti: [],
	settimanaDate: new Date().toISOString().slice(0, 10),
	turniData: {
		settimana: null,
		turni: [],
	},
	dipendenteModal: {
		open: false,
		mode: 'create',
		error: '',
		saving: false,
		values: {
			id: '',
			nome: '',
			cognome: '',
			ruolo: '',
			telefono: '',
			email: '',
			stipendio: '',
		},
	},
	turnoModal: {
		open: false,
		mode: 'create',
		editId: '',
		error: '',
		saving: false,
		values: {
			personale_id: '',
			data: new Date().toISOString().slice(0, 10),
			ora_inizio: '09:00',
			ora_fine: '17:00',
			ruolo_turno: '',
			note: '',
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

function getDipendentiFiltrati() {
	var query = String(state.searchQuery || '').trim().toLowerCase()
	if (!query) {
		return state.dipendenti.slice()
	}

	return state.dipendenti.filter(function (dipendente) {
		var searchable = [
			dipendente && dipendente.nome,
			dipendente && dipendente.cognome,
			dipendente && dipendente.ruolo,
			dipendente && dipendente.telefono,
			dipendente && dipendente.email,
		].map(function (value) {
			return String(value || '').toLowerCase()
		}).join(' ')

		return searchable.includes(query)
	})
}

function findDipendenteById(id) {
	return state.dipendenti.find(function (dipendente) {
		return String(dipendente.id) === String(id)
	}) || null
}

function renderLoading() {
	return `
	<div class="empty-state page-personale">
		<div class="spinner" aria-hidden="true"></div>
		<div class="empty-state-title">Caricamento personale</div>
		<div class="empty-state-sub">Recupero dipendenti e turni settimanali in corso...</div>
	</div>`
}

function renderError() {
	return `
	<div class="empty-state page-personale">
		<div class="empty-state-icon">⚠️</div>
		<div class="empty-state-title">Errore caricamento personale</div>
		<div class="empty-state-sub">${escapeHtml(state.errorMessage || 'Errore sconosciuto')}</div>
		<button class="btn btn-primary" data-action="retry-load">🔄 Riprova</button>
	</div>`
}

function isAttivo(dipendente) {
	return dipendente.attivo === undefined || dipendente.attivo === null || Number(dipendente.attivo) !== 0
}

function renderDipendentiRows() {
	var dipendenti = getDipendentiFiltrati()
	if (!dipendenti.length) {
		return `
		<tr>
			<td colspan="8" class="td-center td-dim">Nessun dipendente trovato</td>
		</tr>`
	}

	return dipendenti.map(function (dipendente) {
		var attivo = isAttivo(dipendente)
		var checked = attivo ? ' checked' : ''
		var rowStyle = attivo ? '' : ' style="opacity:0.55;"'
		return `
		<tr${rowStyle}>
			<td>${escapeHtml(dipendente.nome || '-')}</td>
			<td>${escapeHtml(dipendente.cognome || '-')}</td>
			<td>${escapeHtml(dipendente.ruolo || '-')}</td>
			<td>${escapeHtml(dipendente.telefono || '-')}</td>
			<td>${escapeHtml(dipendente.email || '-')}</td>
			<td class="td-right td-mono">${formatCurrency(dipendente.stipendio)}</td>
			<td class="td-center">
				<label class="toggle-wrapper" style="justify-content: center;">
					<input class="toggle" type="checkbox" data-action="toggle-attivo" data-id="${dipendente.id}"${checked}>
				</label>
			</td>
			<td class="td-right">
				<button class="btn btn-secondary btn-sm" data-action="open-edit-dipendente" data-id="${dipendente.id}">✏️ Modifica</button>
			</td>
		</tr>`
	}).join('')
}

function renderTurniRows() {
	var turni = Array.isArray(state.turniData.turni) ? state.turniData.turni : []
	if (!turni.length) {
		return `
		<tr>
			<td colspan="6" class="td-center td-dim">Nessun turno presente nella settimana selezionata</td>
		</tr>`
	}

	return turni.map(function (turno) {
		var ore = calcOreturno(turno.ora_inizio, turno.ora_fine)
		return `
		<tr>
			<td>${escapeHtml(formatDate(turno.data))}</td>
			<td>${escapeHtml(turno.dipendente || '-')}</td>
			<td class="td-mono">${escapeHtml(turno.ora_inizio || '-')}</td>
			<td class="td-mono">${escapeHtml(turno.ora_fine || '-')}</td>
			<td class="td-mono">${ore || '-'}</td>
			<td>${escapeHtml(turno.ruolo_turno || '-')}</td>
			<td class="td-right" style="white-space:nowrap;">
				<button class="btn btn-secondary btn-sm" data-action="open-edit-turno" data-id="${turno.id}">✏️ Modifica</button>
				<button class="btn btn-danger btn-sm" data-action="delete-turno" data-id="${turno.id}">🗑️ Elimina</button>
			</td>
		</tr>`
	}).join('')
}

function renderDipendenteModal() {
	if (!state.dipendenteModal.open) {
		return ''
	}

	var values = state.dipendenteModal.values
	var isEdit = state.dipendenteModal.mode === 'edit'

	return `
	<div class="modal-overlay" data-action="close-dipendente-modal-bg">
		<div class="modal modal-lg" role="dialog" aria-modal="true" aria-label="${isEdit ? 'Modifica dipendente' : 'Nuovo dipendente'}">
			<div class="modal-header">
				<div>
					<div class="modal-title">${isEdit ? 'Modifica dipendente' : 'Nuovo dipendente'}</div>
					<div class="modal-subtitle">Inserisci i dati anagrafici e contrattuali</div>
				</div>
				<button class="modal-close" type="button" data-action="close-dipendente-modal">×</button>
			</div>
			<form data-action="submit-dipendente-form" style="display:flex; flex-direction:column; flex:1; overflow:hidden; min-height:0;">
				<div class="modal-body">
					<input type="hidden" name="id" value="${escapeHtml(values.id)}">

					<div class="form-row">
						<div class="form-group">
							<label class="form-label" for="dip-nome">Nome</label>
							<input id="dip-nome" class="form-input" name="nome" required maxlength="80" value="${escapeHtml(values.nome)}">
						</div>
						<div class="form-group">
							<label class="form-label" for="dip-cognome">Cognome</label>
							<input id="dip-cognome" class="form-input" name="cognome" required maxlength="80" value="${escapeHtml(values.cognome)}">
						</div>
					</div>

					<div class="form-row">
						<div class="form-group">
							<label class="form-label" for="dip-ruolo">Ruolo</label>
							<input id="dip-ruolo" class="form-input" name="ruolo" required maxlength="120" value="${escapeHtml(values.ruolo)}" placeholder="Es. Sous chef">
						</div>
						<div class="form-group">
							<label class="form-label" for="dip-stipendio">Stipendio</label>
							<input id="dip-stipendio" class="form-input" name="stipendio" type="number" min="0" step="0.01" value="${escapeHtml(values.stipendio)}" required>
						</div>
					</div>

					<div class="form-row">
						<div class="form-group">
							<label class="form-label" for="dip-telefono">Telefono</label>
							<input id="dip-telefono" class="form-input" name="telefono" maxlength="32" value="${escapeHtml(values.telefono)}">
						</div>
						<div class="form-group">
							<label class="form-label" for="dip-email">Email</label>
							<input id="dip-email" class="form-input" name="email" type="email" maxlength="160" value="${escapeHtml(values.email)}">
						</div>
					</div>

					${state.dipendenteModal.error ? `<div class="form-error">⚠️ ${escapeHtml(state.dipendenteModal.error)}</div>` : ''}
				</div>
				<div class="modal-footer">
					<button type="button" class="btn btn-ghost" data-action="close-dipendente-modal">❌ Annulla</button>
					<button type="submit" class="btn btn-primary"${state.dipendenteModal.saving ? ' disabled' : ''}>${isEdit ? '💾 Salva modifiche' : '✅ Crea dipendente'}</button>
				</div>
			</form>
		</div>
	</div>`
}

function renderDipendenteOptionsForTurno() {
	var selected = String(state.turnoModal.values.personale_id || '')
	var attivi = state.dipendenti.filter(isAttivo)
	var options = ['<option value="">— Seleziona dipendente —</option>']
	attivi.forEach(function (dipendente) {
		var id = String(dipendente.id)
		var selectedAttr = id === selected ? ' selected' : ''
		var label = ((dipendente.cognome || '') + ' ' + (dipendente.nome || '')).trim() || 'Dipendente'
		if (dipendente.ruolo) label += ' (' + dipendente.ruolo + ')'
		options.push(`<option value="${id}"${selectedAttr}>${escapeHtml(label)}</option>`)
	})
	if (!attivi.length) {
		options = ['<option value="">Nessun dipendente attivo disponibile</option>']
	}
	return options.join('')
}

function calcOreturno(inizio, fine) {
	if (!inizio || !fine) return ''
	var parts1 = inizio.split(':').map(Number)
	var parts2 = fine.split(':').map(Number)
	var minInizio = parts1[0] * 60 + (parts1[1] || 0)
	var minFine   = parts2[0] * 60 + (parts2[1] || 0)
	var diff = minFine - minInizio
	if (diff <= 0) return ''
	var h = Math.floor(diff / 60)
	var m = diff % 60
	return h + 'h' + (m > 0 ? ' ' + m + 'min' : '')
}

function renderTurnoModal() {
	if (!state.turnoModal.open) {
		return ''
	}

	var values = state.turnoModal.values
	var ore = calcOreturno(values.ora_inizio, values.ora_fine)
	var attivi = state.dipendenti.filter(isAttivo)

	return `
	<div class="modal-overlay" data-action="close-turno-modal-bg">
		<div class="modal" role="dialog" aria-modal="true" aria-label="Aggiungi turno">
			<div class="modal-header">
				<div>
					<div class="modal-title">${state.turnoModal.mode === 'edit' ? '✏️ Modifica turno' : '➕ Aggiungi turno'}</div>
					<div class="modal-subtitle">Programma un turno per il personale</div>
				</div>
				<button class="modal-close" type="button" data-action="close-turno-modal">×</button>
			</div>
			<form data-action="submit-turno-form" style="display:flex; flex-direction:column; flex:1; overflow:hidden; min-height:0;">
				<div class="modal-body">

					${!attivi.length ? `
					<div class="form-error" style="margin-bottom:14px;">
						⚠️ Nessun dipendente attivo. Aggiungi prima un dipendente e attivalo dalla tabella.
					</div>` : ''}

					<div class="form-group">
						<label class="form-label" for="turno-personale">👤 Dipendente *</label>
						<select id="turno-personale" class="form-select" name="personale_id" required${!attivi.length ? ' disabled' : ''}>
							${renderDipendenteOptionsForTurno()}
						</select>
					</div>

					<div class="form-row">
						<div class="form-group">
							<label class="form-label" for="turno-data">📅 Data *</label>
							<input id="turno-data" class="form-input" name="data" type="date" required value="${escapeHtml(values.data)}">
						</div>
						<div class="form-group">
							<label class="form-label" for="turno-ruolo">🏷️ Ruolo turno</label>
							<input id="turno-ruolo" class="form-input" name="ruolo_turno" maxlength="120" value="${escapeHtml(values.ruolo_turno)}" placeholder="Es. Servizio sala">
						</div>
					</div>

					<div class="form-row">
						<div class="form-group">
							<label class="form-label" for="turno-inizio">🕐 Ora inizio *</label>
							<input id="turno-inizio" class="form-input" name="ora_inizio" type="time" required value="${escapeHtml(values.ora_inizio)}" data-action="turno-time-change">
						</div>
						<div class="form-group">
							<label class="form-label" for="turno-fine">🕔 Ora fine *</label>
							<input id="turno-fine" class="form-input" name="ora_fine" type="time" required value="${escapeHtml(values.ora_fine)}" data-action="turno-time-change">
						</div>
					</div>

					${ore ? `
					<div style="background:var(--secondary); border-radius:8px; padding:8px 12px; margin-bottom:12px; font-size:13px;">
						⏱️ Durata turno: <strong>${ore}</strong>
					</div>` : ''}

					<div class="form-group" style="margin-bottom:0;">
						<label class="form-label" for="turno-note">📝 Note</label>
						<input id="turno-note" class="form-input" name="note" maxlength="240" value="${escapeHtml(values.note)}" placeholder="Note opzionali">
					</div>

					${state.turnoModal.error ? `<div class="form-error" style="margin-top:12px;">⚠️ ${escapeHtml(state.turnoModal.error)}</div>` : ''}
				</div>
				<div class="modal-footer">
					<button type="button" class="btn btn-ghost" data-action="close-turno-modal">❌ Annulla</button>
					<button type="submit" class="btn btn-primary"${state.turnoModal.saving || !attivi.length ? ' disabled' : ''}>
						${state.turnoModal.saving ? '⏳ Salvataggio...' : '💾 Salva turno'}
					</button>
					${state.turnoModal.mode === 'create' ? '' : ''}
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

	var dipendentiFiltrati = getDipendentiFiltrati()
	var noDipendenti = state.dipendenti.length === 0
	var noSearchResult = !noDipendenti && dipendentiFiltrati.length === 0
	var settimana = state.turniData && state.turniData.settimana
	var settimanaLabel = settimana ? `${formatDate(settimana.start)} - ${formatDate(settimana.end)}` : '-'

	return `
	<div class="card">
		<div class="section-title">Gestione personale</div>
		<div class="tabella-toolbar" style="margin-bottom: 14px;">
			<button class="btn btn-primary" data-action="open-create-dipendente">➕ Nuovo dipendente</button>
			<input class="form-input search-bar" data-action="search-dipendenti" value="${escapeHtml(state.searchQuery)}" placeholder="Cerca per nome, cognome, ruolo, telefono, email...">
		</div>

		${state.noticeMessage ? `<div class="card" style="margin-bottom: 14px; padding: 12px 14px;">${escapeHtml(state.noticeMessage)}</div>` : ''}

		<div class="table-wrapper">
			<table>
				<thead>
					<tr>
						<th>Nome</th>
						<th>Cognome</th>
						<th>Ruolo</th>
						<th>Telefono</th>
						<th>Email</th>
						<th class="th-right">Stipendio</th>
						<th class="th-center">Attivo</th>
						<th class="th-right">Azioni</th>
					</tr>
				</thead>
				<tbody>
					${renderDipendentiRows()}
				</tbody>
			</table>
		</div>

		${noDipendenti ? `
		<div class="empty-state" style="padding: 28px 16px;">
			<div class="empty-state-icon">👥</div>
			<div class="empty-state-title">Nessun dipendente presente</div>
			<div class="empty-state-sub">Inserisci il primo dipendente per iniziare la gestione del personale.</div>
		</div>` : ''}

		${noSearchResult ? `
		<div class="empty-state" style="padding: 28px 16px;">
			<div class="empty-state-icon">🔎</div>
			<div class="empty-state-title">Nessun risultato</div>
			<div class="empty-state-sub">Nessun dipendente trovato con i criteri di ricerca correnti.</div>
		</div>` : ''}
	</div>

	<div class="card" style="margin-top: 16px;">
		<div class="section-title">Turni settimanali</div>
		<div class="tabella-toolbar" style="margin-bottom: 14px;">
			<button class="btn btn-primary" data-action="open-turno-modal">➕ Aggiungi turno</button>
			<button class="btn btn-secondary" data-action="stampa-tutti-turni">🖨️ Stampa turni</button>
			<div class="form-group" style="margin: 0 0 0 auto; min-width: 220px;">
				<label class="form-label" for="turni-settimana">Settimana (data riferimento)</label>
				<input id="turni-settimana" class="form-input" data-action="change-settimana" type="date" value="${escapeHtml(state.settimanaDate)}">
			</div>
		</div>
		<div class="label" style="margin-bottom: 10px;">Settimana visualizzata: ${escapeHtml(settimanaLabel)}</div>
		<div class="table-wrapper">
			<table>
				<thead>
					<tr>
						<th>Data</th>
						<th>Dipendente</th>
						<th>Ora inizio</th>
						<th>Ora fine</th>
						<th>Ore</th>
						<th>Ruolo turno</th>
						<th class="th-right">Azioni</th>
					</tr>
				</thead>
				<tbody>
					${renderTurniRows()}
				</tbody>
			</table>
		</div>
	</div>

	${renderDipendenteModal()}
	${renderTurnoModal()}`
}

function rerender() {
	if (!state.container) return
	state.container.innerHTML = render()
}

async function refreshData() {
	var results = await Promise.all([
		window.api.personale.getPersonale(),
		window.api.personale.getTurniSettimana(state.settimanaDate),
	])

	state.dipendenti = Array.isArray(results[0]) ? results[0] : []
	state.turniData = results[1] && typeof results[1] === 'object'
		? {
			settimana: results[1].settimana || null,
			turni: Array.isArray(results[1].turni) ? results[1].turni : [],
		}
		: { settimana: null, turni: [] }
}

function openCreateDipendenteModal() {
	state.dipendenteModal.open = true
	state.dipendenteModal.mode = 'create'
	state.dipendenteModal.error = ''
	state.dipendenteModal.saving = false
	state.dipendenteModal.values = {
		id: '',
		nome: '',
		cognome: '',
		ruolo: '',
		telefono: '',
		email: '',
		stipendio: '',
	}
	rerender()
}

function openEditDipendenteModal(id) {
	var dipendente = findDipendenteById(id)
	if (!dipendente) {
		state.noticeMessage = 'Dipendente non trovato'
		rerender()
		return
	}

	state.dipendenteModal.open = true
	state.dipendenteModal.mode = 'edit'
	state.dipendenteModal.error = ''
	state.dipendenteModal.saving = false
	state.dipendenteModal.values = {
		id: String(dipendente.id),
		nome: String(dipendente.nome || ''),
		cognome: String(dipendente.cognome || ''),
		ruolo: String(dipendente.ruolo || ''),
		telefono: String(dipendente.telefono || ''),
		email: String(dipendente.email || ''),
		stipendio: String(toNumber(dipendente.stipendio)),
	}
	rerender()
}

function closeDipendenteModal() {
	state.dipendenteModal.open = false
	state.dipendenteModal.error = ''
	state.dipendenteModal.saving = false
	rerender()
}

function openTurnoModal() {
	var primoAttivo = state.dipendenti.find(isAttivo)
	state.turnoModal.open = true
	state.turnoModal.mode = 'create'
	state.turnoModal.editId = ''
	state.turnoModal.error = ''
	state.turnoModal.saving = false
	state.turnoModal.values = {
		personale_id: primoAttivo ? String(primoAttivo.id) : '',
		data: state.settimanaDate,
		ora_inizio: '09:00',
		ora_fine: '17:00',
		ruolo_turno: '',
		note: '',
	}
	rerender()
}

function openEditTurnoModal(id) {
	var turno = (state.turniData.turni || []).find(function (t) {
		return String(t.id) === String(id)
	})
	if (!turno) {
		state.noticeMessage = 'Turno non trovato'
		rerender()
		return
	}
	state.turnoModal.open = true
	state.turnoModal.mode = 'edit'
	state.turnoModal.editId = String(turno.id)
	state.turnoModal.error = ''
	state.turnoModal.saving = false
	state.turnoModal.values = {
		personale_id: String(turno.personale_id || ''),
		data: String(turno.data || ''),
		ora_inizio: String(turno.ora_inizio || '09:00'),
		ora_fine: String(turno.ora_fine || '17:00'),
		ruolo_turno: String(turno.ruolo_turno || ''),
		note: String(turno.note || ''),
	}
	rerender()
}

function stampaTuttiTurni() {
	var turni = Array.isArray(state.turniData.turni) ? state.turniData.turni : []
	var settimana = state.turniData.settimana
	var settimanaLabel = settimana ? (formatDate(settimana.start) + ' — ' + formatDate(settimana.end)) : ''

	var righe = turni.length ? turni.map(function (t) {
		var ore = calcOreturno(t.ora_inizio, t.ora_fine)
		return `<tr>
			<td>${formatDate(t.data)}</td>
			<td>${t.dipendente || '-'}</td>
			<td>${t.ora_inizio || '-'}</td>
			<td>${t.ora_fine || '-'}</td>
			<td>${ore || '-'}</td>
			<td>${t.ruolo_turno || '-'}</td>
			<td>${t.note || '-'}</td>
		</tr>`
	}).join('') : '<tr><td colspan="7" style="text-align:center; color:#888;">Nessun turno</td></tr>'

	var html = `<!DOCTYPE html><html><head><meta charset="utf-8">
	<title>Turni settimana ${settimanaLabel}</title>
	<style>
		body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
		h1 { font-size: 20px; margin-bottom: 4px; }
		.sub { color: #555; font-size: 13px; margin-bottom: 18px; }
		table { width: 100%; border-collapse: collapse; font-size: 13px; }
		th { background: #f0f0f0; padding: 7px 10px; text-align: left; border-bottom: 2px solid #ccc; }
		td { padding: 6px 10px; border-bottom: 1px solid #e0e0e0; }
		tr:nth-child(even) td { background: #fafafa; }
		@media print { body { padding: 8px; } }
	</style>
	</head><body>
	<h1>🗓️ Turni settimanali</h1>
	<div class="sub">Settimana: ${settimanaLabel}</div>
	<table>
		<thead>
			<tr><th>Data</th><th>Dipendente</th><th>Inizio</th><th>Fine</th><th>Ore</th><th>Ruolo</th><th>Note</th></tr>
		</thead>
		<tbody>${righe}</tbody>
	</table>
	<script>window.onload = function() { window.print(); }<\/script>
	</body></html>`

	var w = window.open('', '_blank', 'width=820,height=600')
	if (w) {
		w.document.write(html)
		w.document.close()
	}
}

function closeTurnoModal() {
	state.turnoModal.open = false
	state.turnoModal.error = ''
	state.turnoModal.saving = false
	rerender()
}

function validateDipendentePayload(payload) {
	if (!payload.nome) return 'Il nome e obbligatorio'
	if (!payload.cognome) return 'Il cognome e obbligatorio'
	if (!payload.ruolo) return 'Il ruolo e obbligatorio'
	if (payload.stipendio < 0) return 'Lo stipendio non puo essere negativo'
	return ''
}

async function saveDipendente(form) {
	var formData = new FormData(form)
	var payload = {
		nome: String(formData.get('nome') || '').trim(),
		cognome: String(formData.get('cognome') || '').trim(),
		ruolo: String(formData.get('ruolo') || '').trim(),
		telefono: String(formData.get('telefono') || '').trim() || null,
		email: String(formData.get('email') || '').trim() || null,
		stipendio: toNumber(formData.get('stipendio')),
	}

	var id = String(formData.get('id') || '').trim()
	if (id) {
		payload.id = Number(id)
	}

	var validationError = validateDipendentePayload(payload)
	if (validationError) {
		state.dipendenteModal.error = validationError
		rerender()
		return
	}

	state.dipendenteModal.saving = true
	state.dipendenteModal.error = ''
	rerender()

	try {
		if (payload.id) {
			await window.api.personale.updateDipendente(payload)
			state.noticeMessage = 'Dipendente aggiornato correttamente'
		} else {
			await window.api.personale.addDipendente(payload)
			state.noticeMessage = 'Dipendente creato correttamente'
		}

		state.dipendenteModal.open = false
		state.dipendenteModal.saving = false
		await refreshData()
		rerender()
	} catch (error) {
		state.dipendenteModal.saving = false
		state.dipendenteModal.error = error && error.message ? error.message : 'Errore salvataggio dipendente'
		rerender()
	}
}

function validateTurnoPayload(payload) {
	if (!payload.personale_id) return 'Seleziona un dipendente'
	if (!payload.data) return 'La data turno e obbligatoria'
	if (!payload.ora_inizio || !payload.ora_fine) return 'Inserisci ora inizio e ora fine'
	if (payload.ora_fine <= payload.ora_inizio) return 'L\'ora fine deve essere successiva all\'ora inizio'
	return ''
}

async function saveTurno(form) {
	var formData = new FormData(form)
	var payload = {
		personale_id: Number(formData.get('personale_id')),
		data: String(formData.get('data') || '').trim(),
		ora_inizio: String(formData.get('ora_inizio') || '').trim(),
		ora_fine: String(formData.get('ora_fine') || '').trim(),
		ruolo_turno: String(formData.get('ruolo_turno') || '').trim() || null,
		note: String(formData.get('note') || '').trim() || null,
	}

	var validationError = validateTurnoPayload(payload)
	if (validationError) {
		state.turnoModal.error = validationError
		rerender()
		return
	}

	state.turnoModal.saving = true
	state.turnoModal.error = ''
	rerender()

	try {
		if (state.turnoModal.mode === 'edit' && state.turnoModal.editId) {
			payload.id = Number(state.turnoModal.editId)
			await window.api.personale.updateTurno(payload)
			state.noticeMessage = 'Turno modificato correttamente'
		} else {
			await window.api.personale.addTurno(payload)
			state.noticeMessage = 'Turno aggiunto correttamente'
		}
		state.turnoModal.open = false
		state.turnoModal.saving = false
		await refreshData()
		rerender()
	} catch (error) {
		state.turnoModal.saving = false
		state.turnoModal.error = error && error.message ? error.message : 'Errore salvataggio turno'
		rerender()
	}
}

async function toggleAttivo(id) {
	try {
		await window.api.personale.toggleAttivo(Number(id))
		state.noticeMessage = 'Stato dipendente aggiornato'
		await refreshData()
		rerender()
	} catch (error) {
		state.noticeMessage = error && error.message ? error.message : 'Errore aggiornamento stato dipendente'
		rerender()
	}
}

async function deleteTurno(id) {
	var confirmed = window.confirm('Confermi l\'eliminazione del turno selezionato?')
	if (!confirmed) return

	try {
		await window.api.personale.deleteTurno(Number(id))
		state.noticeMessage = 'Turno eliminato correttamente'
		await refreshData()
		rerender()
	} catch (error) {
		state.noticeMessage = error && error.message ? error.message : 'Errore eliminazione turno'
		rerender()
	}
}

async function changeSettimana(dateValue) {
	state.settimanaDate = dateValue || new Date().toISOString().slice(0, 10)
	state.loading = true
	rerender()
	try {
		await refreshData()
	} catch (error) {
		state.errorMessage = error && error.message ? error.message : 'Errore caricamento settimana turni'
	} finally {
		state.loading = false
		rerender()
	}
}

function initEvents(container) {
	if (container.__personaleEventsBound) return
	container.__personaleEventsBound = true

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

		if (action === 'open-create-dipendente') {
			openCreateDipendenteModal()
			return
		}

		if (action === 'open-edit-dipendente') {
			openEditDipendenteModal(id)
			return
		}

		if (action === 'close-dipendente-modal' || action === 'close-dipendente-modal-bg') {
			if (action === 'close-dipendente-modal-bg' && !actionNode.classList.contains('modal-overlay')) return
			closeDipendenteModal()
			return
		}

		if (action === 'open-turno-modal') {
			openTurnoModal()
			return
		}

		if (action === 'close-turno-modal' || action === 'close-turno-modal-bg') {
			if (action === 'close-turno-modal-bg' && !actionNode.classList.contains('modal-overlay')) return
			closeTurnoModal()
			return
		}

		if (action === 'open-edit-turno') {
			openEditTurnoModal(id)
			return
		}

		if (action === 'delete-turno') {
			deleteTurno(id)
			return
		}

		if (action === 'stampa-tutti-turni') {
			stampaTuttiTurni()
			return
		}
	})

	container.addEventListener('input', function (event) {
		var target = event.target
		if (!(target instanceof Element)) return
		var action = target.getAttribute('data-action')
		if (action === 'search-dipendenti') {
			state.searchQuery = target.value || ''
			var selStart = target.selectionStart
			var selEnd = target.selectionEnd
			rerender()
			var newInput = container.querySelector('[data-action="search-dipendenti"]')
			if (newInput) {
				newInput.focus()
				newInput.setSelectionRange(selStart, selEnd)
			}
		}
	})

	container.addEventListener('change', function (event) {
		var target = event.target
		if (!(target instanceof Element)) return
		var action = target.getAttribute('data-action')
		var id = target.getAttribute('data-id')

		if (action === 'toggle-attivo') {
			toggleAttivo(id)
			return
		}

		if (action === 'change-settimana') {
			changeSettimana(target.value)
			return
		}

		if (action === 'turno-time-change') {
			// Aggiorna state e re-render il modal per mostrare le ore calcolate
			var form = target.closest('form')
			if (form) {
				var fd = new FormData(form)
				state.turnoModal.values.ora_inizio = fd.get('ora_inizio') || state.turnoModal.values.ora_inizio
				state.turnoModal.values.ora_fine   = fd.get('ora_fine')   || state.turnoModal.values.ora_fine
				state.turnoModal.values.personale_id = fd.get('personale_id') || state.turnoModal.values.personale_id
				state.turnoModal.values.data       = fd.get('data')       || state.turnoModal.values.data
				state.turnoModal.values.ruolo_turno = fd.get('ruolo_turno') || state.turnoModal.values.ruolo_turno
				state.turnoModal.values.note       = fd.get('note')       || state.turnoModal.values.note
			}
			rerender()
			return
		}
	})

	container.addEventListener('submit', function (event) {
		var form = event.target
		if (!(form instanceof HTMLFormElement)) return

		if (form.getAttribute('data-action') === 'submit-dipendente-form') {
			event.preventDefault()
			saveDipendente(form)
			return
		}

		if (form.getAttribute('data-action') === 'submit-turno-form') {
			event.preventDefault()
			saveTurno(form)
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
		state.errorMessage = error && error.message ? error.message : 'Impossibile caricare i dati del personale'
	} finally {
		state.loading = false
		rerender()
		initEvents(container)
	}
}

var pageApi = { render, initEvents, load }

if (typeof window !== 'undefined') {
	window.pages = window.pages || {}
	window.pages.personale = pageApi
}

if (typeof module !== 'undefined' && module.exports) {
	module.exports = pageApi
}

})()
