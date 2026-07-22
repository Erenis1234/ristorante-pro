;(function () {

var CATEGORIE = [
	{ id: 'antipasto', label: 'Antipasti', icon: '🥗' },
	{ id: 'primo', label: 'Primi piatti', icon: '🍝' },
	{ id: 'secondo', label: 'Secondi piatti', icon: '🍖' },
	{ id: 'dolce', label: 'Dolci', icon: '🍰' },
	{ id: 'salsa', label: 'Salse', icon: '🥣' },
]

var INPUT_S =
	'padding:6px 10px; border:1px solid var(--border); border-radius:6px; background:var(--bg); color:var(--text); font-size:13px; outline:none; box-sizing:border-box;'

var state = {
	container: null,
	loading: false,
	errorMessage: '',
	noticeMessage: '',
	menuList: [],
	ricette: [],
	categoriaSelezionata: CATEGORIE[0].id,
	composer: {
		open: false,
		mode: 'create',
		id: '',
		nome: '',
		tipo: 'giornaliero',
		voci: [], // [{ uid, nome, prezzo }]
		error: '',
		saving: false,
	},
	confirmDelete: {
		open: false,
		id: null,
		nome: '',
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

function findMenuById(id) {
	return state.menuList.find(function (menu) {
		return String(menu.id) === String(id)
	}) || null
}

function renderCategoriaSelectOptions(selected) {
	return CATEGORIE.map(function (cat) {
		var sel = cat.id === selected ? ' selected' : ''
		return `<option value="${cat.id}"${sel}>${cat.icon} ${cat.label}</option>`
	}).join('')
}

function renderRicetteOptions(categoria) {
	var ricette = state.ricette.filter(function (ricetta) {
		return String(ricetta && ricetta.categoria || '') === categoria
	})

	if (!ricette.length) {
		return '<option value="">Nessuna ricetta in questa categoria</option>'
	}

	return ricette.map(function (ricetta) {
		return `<option value="${ricetta.id}">${escapeHtml(ricetta.nome || 'Ricetta senza nome')}</option>`
	}).join('')
}

function renderLoading() {
	return `
	<div class="empty-state page-menu">
		<div class="spinner" aria-hidden="true"></div>
		<div class="empty-state-title">Caricamento menu</div>
		<div class="empty-state-sub">Recupero menu e ricette in corso...</div>
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

function renderMenuList() {
	if (!state.menuList.length) {
		return `
		<div class="empty-state" style="padding: 30px 16px;">
			<div class="empty-state-icon">🍽️</div>
			<div class="empty-state-title">Nessun menu creato</div>
			<div class="empty-state-sub">Componi il primo menu con il pulsante Nuovo menu.</div>
		</div>`
	}

	return `
	<div class="grid-auto">
		${state.menuList.map(function (menu) {
			var voci = Array.isArray(menu.voci) ? menu.voci : []
			var nome = escapeHtml(menu.nome || 'Menu senza nome')
			var tipoLabel = menu.tipo === 'settimanale' ? 'Settimanale' : 'Giornaliero'
			return `
			<div class="card">
				<div class="section-title" style="margin-bottom: 8px;">🍽️ ${nome}</div>
				<div class="label" style="margin-bottom: 3px;">Tipo</div>
				<div style="margin-bottom: 8px;">${tipoLabel}</div>
				<div class="label" style="margin-bottom: 3px;">Voci</div>
				<div style="margin-bottom: 14px;">${voci.length} piatti</div>
				<div style="display: flex; gap: 6px; flex-wrap:wrap; justify-content: flex-end;">
					<button class="btn btn-secondary btn-sm" data-action="print-menu" data-id="${menu.id}">🖨️ Stampa</button>
					<button class="btn btn-secondary btn-sm" data-action="edit-menu" data-id="${menu.id}">✏️ Modifica</button>
					<button class="btn btn-danger btn-sm" data-action="confirm-delete-menu" data-id="${menu.id}">🗑️ Elimina</button>
				</div>
			</div>`
		}).join('')}
	</div>`
}

function renderVociComposer() {
	var voci = state.composer.voci

	if (!voci.length) {
		return `
		<div class="empty-state" style="padding: 16px;">
			<div class="empty-state-sub">Nessuna voce aggiunta. Scegli una categoria e una ricetta, poi premi "+ Aggiungi".</div>
		</div>`
	}

	var righe = voci.map(function (voce, idx) {
		return `
		<tr>
			<td style="padding:6px 8px; font-size:13px;">${escapeHtml(voce.nome)}</td>
			<td style="padding:6px 8px;">
				<input type="number" min="0" step="0.01" value="${escapeHtml(String(voce.prezzo))}" data-action="composer-prezzo-voce" data-idx="${idx}" style="${INPUT_S} width:100px;">
			</td>
			<td style="padding:6px 4px; text-align:center;">
				<button type="button" class="btn btn-danger btn-sm" data-action="composer-del-voce" data-idx="${idx}">🗑️</button>
			</td>
		</tr>`
	}).join('')

	return `
	<div style="border:1px solid var(--border); border-radius:8px; overflow:hidden;">
		<table style="width:100%; border-collapse:collapse;">
			<thead>
				<tr style="border-bottom:1px solid var(--border);">
					<th style="text-align:left; padding:6px 8px; font-size:11px; color:var(--text-muted);">Piatto</th>
					<th style="text-align:left; padding:6px 8px; font-size:11px; color:var(--text-muted);">Prezzo (€)</th>
					<th style="width:40px;"></th>
				</tr>
			</thead>
			<tbody>${righe}</tbody>
		</table>
	</div>`
}

function renderComposerModal() {
	if (!state.composer.open) {
		return ''
	}

	var isEdit = state.composer.mode === 'edit'
	var categoriaCorrente = state.categoriaSelezionata

	return `
	<div class="modal-overlay" data-action="close-composer-bg">
		<div class="modal modal-lg" role="dialog" aria-modal="true" aria-label="${isEdit ? 'Modifica menu' : 'Nuovo menu'}">
			<div class="modal-header">
				<div>
					<div class="modal-title">${isEdit ? 'Modifica menu' : 'Nuovo menu'}</div>
					<div class="modal-subtitle">Componi il menu scegliendo le ricette per categoria</div>
				</div>
				<button class="modal-close" type="button" data-action="close-composer">×</button>
			</div>

			<form data-action="submit-menu-form" style="display:flex; flex-direction:column; flex:1; overflow:hidden; min-height:0;">
				<div class="modal-body">
					<input type="hidden" name="id" value="${escapeHtml(state.composer.id)}">

					<div class="form-row">
						<div class="form-group">
							<label class="form-label" for="menu-nome">Nome menu</label>
							<input id="menu-nome" class="form-input" name="nome" maxlength="120" required value="${escapeHtml(state.composer.nome)}" placeholder="Es. Menu del giorno">
						</div>

						<div class="form-group">
							<label class="form-label" for="menu-tipo">Tipo</label>
							<select id="menu-tipo" class="form-select" name="tipo">
								<option value="giornaliero"${state.composer.tipo === 'giornaliero' ? ' selected' : ''}>Giornaliero</option>
								<option value="settimanale"${state.composer.tipo === 'settimanale' ? ' selected' : ''}>Settimanale</option>
							</select>
						</div>
					</div>

					<div class="form-group">
						<label class="form-label">Aggiungi ricetta al menu</label>
						<div style="display:flex; gap:8px; flex-wrap:wrap; align-items:flex-end;">
							<div style="flex:1; min-width:160px;">
								<div style="font-size:11px; color:var(--text-muted); margin-bottom:3px;">Categoria</div>
								<select id="menu-composer-categoria" data-action="composer-categoria" style="${INPUT_S} width:100%;">
									${renderCategoriaSelectOptions(categoriaCorrente)}
								</select>
							</div>
							<div style="flex:2; min-width:200px;">
								<div style="font-size:11px; color:var(--text-muted); margin-bottom:3px;">Ricetta</div>
								<select id="menu-composer-ricetta" style="${INPUT_S} width:100%;">
									${renderRicetteOptions(categoriaCorrente)}
								</select>
							</div>
							<button type="button" class="btn btn-primary btn-sm" data-action="composer-add-voce">+ Aggiungi</button>
						</div>
					</div>

					<div class="form-group" style="margin-bottom: 0;">
						<label class="form-label">Voci del menu</label>
						${renderVociComposer()}
					</div>

					${state.composer.error ? `<div class="form-error" style="margin-top: 12px;">⚠️ ${escapeHtml(state.composer.error)}</div>` : ''}
				</div>

				<div class="modal-footer">
					<button type="button" class="btn btn-ghost" data-action="close-composer">❌ Annulla</button>
					<button type="submit" class="btn btn-primary"${state.composer.saving ? ' disabled' : ''}>${isEdit ? '💾 Salva modifiche' : '💾 Salva menu'}</button>
				</div>
			</form>
		</div>
	</div>`
}

function renderConfirmDeleteModal() {
	if (!state.confirmDelete.open) {
		return ''
	}

	return `
	<div class="modal-overlay" data-action="close-confirm-delete-menu-bg">
		<div class="modal modal-sm modal-confirm" role="dialog" aria-modal="true" aria-label="Conferma eliminazione">
			<div class="modal-header">
				<div>
					<div class="modal-title">Conferma eliminazione</div>
					<div class="modal-subtitle">Questa operazione non puo essere annullata</div>
				</div>
				<button class="modal-close" type="button" data-action="close-confirm-delete-menu">×</button>
			</div>

			<div class="modal-body">
				<div class="confirm-icon">🗑️</div>
				<div class="confirm-message">Vuoi eliminare il menu <strong>${escapeHtml(state.confirmDelete.nome)}</strong>?</div>
			</div>

			<div class="modal-footer">
				<button type="button" class="btn btn-ghost" data-action="close-confirm-delete-menu">❌ Annulla</button>
				<button type="button" class="btn btn-danger" data-action="delete-menu-confirmed">🗑️ Elimina</button>
			</div>
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

	return `
	<div class="card">
		<div class="section-title">Menu del ristorante</div>
		<div class="tabella-toolbar" style="margin-bottom: 14px;">
			<button class="btn btn-primary" data-action="open-create-composer">➕ Nuovo menu</button>
		</div>
		${state.noticeMessage ? `<div class="card" style="margin-bottom: 14px; padding: 12px 14px;">${escapeHtml(state.noticeMessage)}</div>` : ''}
		${renderMenuList()}
	</div>
	${renderComposerModal()}
	${renderConfirmDeleteModal()}`
}

function rerender() {
	if (!state.container) return
	state.container.innerHTML = render()
}

// Salva nello state i valori attuali del form composer (evita reset al rerender)
function captureComposerFormValues() {
	if (!state.container || !state.composer.open) return
	var form = state.container.querySelector('form[data-action="submit-menu-form"]')
	if (!form) return
	var fd = new FormData(form)
	state.composer.nome = String(fd.get('nome') || '')
	state.composer.tipo = fd.get('tipo') === 'settimanale' ? 'settimanale' : 'giornaliero'
}

async function refreshMenuList() {
	var menu = await window.api.menuBuilder.getMenu()
	state.menuList = Array.isArray(menu) ? menu : []
}

async function refreshRicette() {
	var ricette = await window.api.ricette.getRicette()
	state.ricette = Array.isArray(ricette) ? ricette : []
}

function openCreateComposer() {
	state.composer = {
		open: true,
		mode: 'create',
		id: '',
		nome: '',
		tipo: 'giornaliero',
		voci: [],
		error: '',
		saving: false,
	}
	rerender()
}

async function openEditComposer(id) {
	try {
		var dettaglio = await window.api.menuBuilder.getMenuDettaglio(Number(id))
		var voci = Array.isArray(dettaglio && dettaglio.voci) ? dettaglio.voci : []

		state.composer = {
			open: true,
			mode: 'edit',
			id: String(dettaglio && dettaglio.id ? dettaglio.id : ''),
			nome: String(dettaglio && dettaglio.nome ? dettaglio.nome : ''),
			tipo: dettaglio && dettaglio.tipo === 'settimanale' ? 'settimanale' : 'giornaliero',
			voci: voci
				.slice()
				.sort(function (a, b) { return toNumber(a.ordine) - toNumber(b.ordine) })
				.map(function (voce) {
					return {
						uid: String(voce.id || Date.now() + '-' + Math.random()),
						nome: String(voce.nome || ''),
						prezzo: toNumber(voce.prezzo),
					}
				}),
			error: '',
			saving: false,
		}
		rerender()
	} catch (error) {
		state.noticeMessage = error && error.message ? error.message : 'Impossibile caricare il dettaglio menu'
		rerender()
	}
}

function closeComposer() {
	state.composer.open = false
	rerender()
}

function askDeleteMenu(id) {
	var menu = findMenuById(id)
	if (!menu) return
	state.confirmDelete = { open: true, id: id, nome: menu.nome || '' }
	rerender()
}

function closeConfirmDelete() {
	state.confirmDelete = { open: false, id: null, nome: '' }
	rerender()
}

async function deleteMenuConfirmed() {
	try {
		await window.api.menuBuilder.deleteMenu(Number(state.confirmDelete.id))
		state.noticeMessage = 'Menu eliminato correttamente'
		closeConfirmDelete()
		await refreshMenuList()
		rerender()
	} catch (error) {
		state.noticeMessage = error && error.message ? error.message : 'Errore durante l\'eliminazione del menu'
		rerender()
	}
}

function validateComposerPayload(payload) {
	if (!payload.nome) {
		return 'Il nome del menu e obbligatorio'
	}
	if (!payload.voci.length) {
		return 'Aggiungi almeno una voce al menu'
	}
	return ''
}

async function salvaMenu(form) {
	var formData = new FormData(form)
	var payload = {
		nome: String(formData.get('nome') || '').trim(),
		tipo: formData.get('tipo') === 'settimanale' ? 'settimanale' : 'giornaliero',
		voci: state.composer.voci.map(function (voce, idx) {
			return {
				nome: voce.nome,
				prezzo: toNumber(voce.prezzo),
				ordine: idx,
			}
		}),
	}

	var validationError = validateComposerPayload(payload)
	if (validationError) {
		state.composer.error = validationError
		rerender()
		return
	}

	state.composer.saving = true
	state.composer.error = ''
	rerender()

	try {
		if (state.composer.mode === 'edit') {
			payload.id = Number(state.composer.id)
			await window.api.menuBuilder.updateMenu(payload)
			state.noticeMessage = 'Menu aggiornato correttamente'
		} else {
			await window.api.menuBuilder.addMenu(payload)
			state.noticeMessage = 'Menu creato correttamente'
		}

		state.composer.open = false
		state.composer.saving = false
		state.composer.error = ''
		await refreshMenuList()
		rerender()
	} catch (error) {
		state.composer.saving = false
		state.composer.error = error && error.message ? error.message : 'Errore durante il salvataggio del menu'
		rerender()
	}
}

function stampaMenu(id) {
	var menu = findMenuById(id)
	if (!menu) return

	var voci = Array.isArray(menu.voci) ? menu.voci.slice() : []
	voci.sort(function (a, b) { return toNumber(a.ordine) - toNumber(b.ordine) })

	var tipoLabel = menu.tipo === 'settimanale' ? 'Menu settimanale' : 'Menu giornaliero'

	var righe = voci.length
		? voci.map(function (voce) {
				var prezzo = toNumber(voce.prezzo)
				return `<tr>
					<td>${escapeHtml(voce.nome || '')}</td>
					<td class="prezzo">${prezzo > 0 ? prezzo.toFixed(2) + ' €' : ''}</td>
				</tr>`
			}).join('')
		: '<tr><td colspan="2" style="text-align:center; color:#888;">Nessuna voce nel menu</td></tr>'

	var html = `<!DOCTYPE html><html><head><meta charset="utf-8">
	<title>${escapeHtml(menu.nome || 'Menu')}</title>
	<style>
		body { font-family: Georgia, 'Times New Roman', serif; padding: 32px; color: #111; }
		h1 { font-size: 26px; margin-bottom: 4px; text-align: center; }
		.sub { color: #555; font-size: 12px; margin-bottom: 26px; text-align: center; text-transform: uppercase; letter-spacing: 1px; }
		table { width: 100%; border-collapse: collapse; font-size: 15px; }
		td { padding: 10px 6px; border-bottom: 1px solid #ddd; }
		td.prezzo { text-align: right; white-space: nowrap; }
		@media print { body { padding: 10px; } }
	</style>
	</head><body>
	<h1>${escapeHtml(menu.nome || 'Menu')}</h1>
	<div class="sub">${escapeHtml(tipoLabel)}</div>
	<table><tbody>${righe}</tbody></table>
	<script>window.onload = function () { window.print(); }<\/script>
	</body></html>`

	var w = window.open('', '_blank', 'width=700,height=800')
	if (w) {
		w.document.write(html)
		w.document.close()
	}
}

function initEvents(container) {
	if (container.__menuEventsBound) {
		return
	}
	container.__menuEventsBound = true

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

		if (action === 'open-create-composer') {
			openCreateComposer()
			return
		}

		if (action === 'edit-menu') {
			openEditComposer(id)
			return
		}

		if (action === 'print-menu') {
			stampaMenu(id)
			return
		}

		if (action === 'confirm-delete-menu') {
			askDeleteMenu(id)
			return
		}

		if (action === 'delete-menu-confirmed') {
			deleteMenuConfirmed()
			return
		}

		if (action === 'close-confirm-delete-menu' || action === 'close-confirm-delete-menu-bg') {
			if (action === 'close-confirm-delete-menu-bg' && !actionNode.classList.contains('modal-overlay')) return
			closeConfirmDelete()
			return
		}

		if (action === 'close-composer' || action === 'close-composer-bg') {
			if (action === 'close-composer-bg' && !actionNode.classList.contains('modal-overlay')) return
			closeComposer()
			return
		}

		if (action === 'composer-add-voce') {
			var select = container.querySelector('#menu-composer-ricetta')
			var ricettaId = select ? select.value : ''
			if (!ricettaId) return

			var ricetta = state.ricette.find(function (r) {
				return String(r.id) === String(ricettaId)
			})
			if (!ricetta) return

			captureComposerFormValues()
			state.composer.voci.push({
				uid: Date.now() + '-' + Math.random(),
				nome: ricetta.nome || 'Ricetta senza nome',
				prezzo: 0,
			})
			rerender()
			return
		}

		if (action === 'composer-del-voce') {
			var delIdx = Number(actionNode.getAttribute('data-idx'))
			captureComposerFormValues()
			state.composer.voci.splice(delIdx, 1)
			rerender()
			return
		}
	})

	container.addEventListener('change', function (event) {
		var target = event.target
		if (!(target instanceof Element)) return

		var action = target.getAttribute('data-action')
		if (action === 'composer-categoria') {
			captureComposerFormValues()
			state.categoriaSelezionata = target.value
			rerender()
		}
	})

	container.addEventListener('input', function (event) {
		var target = event.target
		if (!(target instanceof Element)) return

		var action = target.getAttribute('data-action')
		if (action === 'composer-prezzo-voce') {
			var idx = Number(target.getAttribute('data-idx'))
			if (state.composer.voci[idx]) {
				state.composer.voci[idx].prezzo = target.value
			}
		}
	})

	container.addEventListener('submit', function (event) {
		var form = event.target
		if (!(form instanceof HTMLFormElement)) return

		event.preventDefault()

		if (form.getAttribute('data-action') === 'submit-menu-form') {
			salvaMenu(form)
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
		await Promise.all([refreshMenuList(), refreshRicette()])
	} catch (error) {
		state.errorMessage = error && error.message ? error.message : 'Impossibile caricare i menu'
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
