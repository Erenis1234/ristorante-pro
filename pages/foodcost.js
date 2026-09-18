;(function () {

var state = {
	container: null,
	loading: false,
	errorMessage: '',
	noticeMessage: '',
	records: [],
	simulator: {
		ricettaId: '',
		ricettaNome: '',
		prezzoVendita: '',
		loading: false,
		error: '',
		saving: false,
		saveError: '',
		editingIngIdx: null,
		ingredienti: [],   // [{ uid, nome, costo }]
	},
	calculator: {
		open: false,
		display: '0',
		left: null,
		op: null,
		expectNew: false,
	},
	detailModal: {
		open: false,
		loading: false,
		error: '',
		record: null,
	},
}
var SIM_RESULT_DEBOUNCE_MS = 120
var simulatorResultTimeoutId = null

// ── Utilities ────────────────────────────────────────────────────────────────

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

function round(value, decimals) {
	var factor = Math.pow(10, decimals || 2)
	return Math.round(toNumber(value) * factor) / factor
}

function fmtCurrency(value) {
	return toNumber(value).toFixed(2) + ' €'
}

function fmtPct(value) {
	if (value === null || value === undefined || Number.isNaN(Number(value))) return '-'
	return toNumber(value).toFixed(2) + '%'
}

function getStatusConfig(percentuale) {
	if (percentuale === null || percentuale === undefined) {
		return { className: 'badge-dim', label: 'No prezzo' }
	}
	var pct = toNumber(percentuale)
	if (pct <= 25) return { className: 'badge-ottimo', label: 'Ottimo' }
	if (pct <= 33) return { className: 'badge-buono', label: 'Buono' }
	if (pct <= 40) return { className: 'badge-attenzione', label: 'Attenzione' }
	return { className: 'badge-critico', label: 'Critico' }
}

function calcIngredientCost(qty, um, prezzo) {
	var q = toNumber(qty)
	var p = toNumber(prezzo)
	var u = (um || '').toLowerCase()
	if (u === 'g' || u === 'ml') return q * p / 1000
	return q * p
}

// ── Simulation calculation (client-side) ─────────────────────────────────────

function calculateSimulation() {
	var costoIngredienti = state.simulator.ingredienti.reduce(function (sum, ing) {
		return sum + toNumber(ing.costo)
	}, 0)

	var prezzoVendita = toNumber(state.simulator.prezzoVendita)
	var margine = prezzoVendita > 0 ? prezzoVendita - costoIngredienti : null
	var foodCostPct = prezzoVendita > 0 ? (costoIngredienti / prezzoVendita) * 100 : null
	var marginePct = prezzoVendita > 0 ? ((prezzoVendita - costoIngredienti) / prezzoVendita) * 100 : null

	return {
		costoIngredienti: round(costoIngredienti, 4),
		margine: margine !== null ? round(margine, 2) : null,
		foodCostPct: foodCostPct !== null ? round(foodCostPct, 2) : null,
		marginePct: marginePct !== null ? round(marginePct, 2) : null,
	}
}

// ── KPI ──────────────────────────────────────────────────────────────────────

function getKpiData(records) {
	var withPct = records.filter(function (r) {
		return r && r.food_cost_pct !== null && r.food_cost_pct !== undefined
	})
	var media = withPct.length
		? withPct.reduce(function (sum, r) { return sum + toNumber(r.food_cost_pct) }, 0) / withPct.length
		: 0
	var ottimali = records.filter(function (r) { return toNumber(r.food_cost_pct) <= 25 }).length
	var critici  = records.filter(function (r) { return toNumber(r.food_cost_pct) > 40 }).length
	return { media: media, ottimali: ottimali, critici: critici }
}

// ── Render: loading / error ───────────────────────────────────────────────────

function renderLoading() {
	return `
	<div class="empty-state page-foodcost">
		<div class="spinner" aria-hidden="true"></div>
		<div class="empty-state-title">Caricamento analisi food cost</div>
		<div class="empty-state-sub">Recupero dati piatti e costi ingredienti in corso...</div>
	</div>`
}

function renderError() {
	return `
	<div class="empty-state page-foodcost">
		<div class="empty-state-icon">⚠️</div>
		<div class="empty-state-title">Errore analisi food cost</div>
		<div class="empty-state-sub">${escapeHtml(state.errorMessage || 'Errore sconosciuto')}</div>
		<button class="btn btn-primary" data-action="retry-load">🔄 Riprova</button>
	</div>`
}

// ── Render: main table ────────────────────────────────────────────────────────

function renderTableRows() {
	if (!state.records.length) {
		return `<tr><td colspan="6" class="td-center td-dim">Nessun dato food cost disponibile</td></tr>`
	}
	return state.records.map(function (record) {
		var status = getStatusConfig(record.food_cost_pct)
		return `
		<tr>
			<td>${escapeHtml(record.ricetta_nome || 'Ricetta')}</td>
			<td class="td-right td-mono">${fmtCurrency(record.costo_ingredienti)}</td>
			<td class="td-right td-mono">${fmtCurrency(record.prezzo_vendita)}</td>
			<td class="td-right td-mono">${fmtPct(record.food_cost_pct)}</td>
			<td class="td-center"><span class="badge ${status.className}">${status.label}</span></td>
			<td class="td-right">
				<button class="btn btn-secondary btn-sm" data-action="open-detail" data-id="${record.ricetta_id}">📋 Dettaglio</button>
			</td>
		</tr>`
	}).join('')
}

// ── Render: simulator ─────────────────────────────────────────────────────────

function renderSimulatorRicettaOptions() {
	var current = String(state.simulator.ricettaId || '')
	var options = ['<option value="">— Seleziona ricetta —</option>']
	state.records.forEach(function (record) {
		var id = String(record.ricetta_id)
		var selected = current === id ? ' selected' : ''
		options.push(`<option value="${id}"${selected}>${escapeHtml(record.ricetta_nome || 'Ricetta')}</option>`)
	})
	return options.join('')
}

var INPUT_STYLE = 'padding:6px 10px; border:1px solid var(--border); border-radius:6px; background:var(--bg); color:var(--text); font-size:13px; outline:none; box-sizing:border-box;'

function renderSimulatorIngredientRows() {
	if (!state.simulator.ingredienti.length) {
		return `
		<tr>
			<td colspan="4" style="text-align:center; color:var(--text-muted); padding:12px; font-size:13px;">
				Nessun ingrediente aggiunto — usa il form qui sopra
			</td>
		</tr>`
	}
	return state.simulator.ingredienti.map(function (ing, idx) {
		var isEditing = state.simulator.editingIngIdx === idx
		if (isEditing) {
			return `
			<tr style="background:var(--secondary);">
				<td style="padding:6px 8px;">
					<input type="text" data-action="sim-edit-nome" data-idx="${idx}"
						style="${INPUT_STYLE} width:100%;"
						value="${escapeHtml(ing.nome || '')}">
				</td>
				<td style="padding:6px 8px; width:130px;">
					<input type="number" min="0" step="0.001" data-action="sim-edit-costo" data-idx="${idx}"
						style="${INPUT_STYLE} width:110px;"
						value="${escapeHtml(String(ing.costo))}">
				</td>
				<td style="padding:6px 8px; white-space:nowrap;" colspan="2">
					<button class="btn btn-primary btn-sm" data-action="sim-edit-save" data-idx="${idx}">✔ Salva</button>
					<button class="btn btn-secondary btn-sm" data-action="sim-edit-cancel" style="margin-left:4px;">Annulla</button>
				</td>
			</tr>`
		}
		return `
		<tr>
			<td style="font-size:14px; padding:6px 8px;">${escapeHtml(ing.nome || 'Ingrediente')}</td>
			<td style="width:120px; padding:6px 8px; font-weight:700; color:var(--primary);">${fmtCurrency(ing.costo)}</td>
			<td style="padding:6px 8px; white-space:nowrap;">
				<button class="btn btn-secondary btn-sm" data-action="sim-edit-ing" data-idx="${idx}">✏️ Modifica</button>
				<button class="btn btn-danger btn-sm" data-action="sim-del-ing" data-idx="${idx}" style="margin-left:4px;">🗑️ Elimina</button>
			</td>
		</tr>`
	}).join('')
}


function renderSimulatorResult() {
	if (!state.simulator.ingredienti.length) {
		return `<div style="color:var(--text-muted); font-size:13px; padding:10px 0;">Aggiungi almeno un ingrediente per vedere il calcolo.</div>`
	}

	var calc = calculateSimulation()
	var prezzoVendita = toNumber(state.simulator.prezzoVendita)
	var fcStatus = getStatusConfig(calc.foodCostPct)
	var hasPrezzo = prezzoVendita > 0

	return `
	<div style="margin-top:14px; border:2px solid var(--border); border-radius:10px; overflow:hidden;">
		<div style="background:var(--secondary); padding:10px 14px; font-weight:700; font-size:13px;">📊 Risultato simulazione</div>
		<div style="padding:14px; display:grid; grid-template-columns:1fr 1fr; gap:12px;">
			<div style="background:var(--bg); border-radius:8px; padding:10px;">
				<div style="font-size:11px; color:var(--text-muted); margin-bottom:4px;">🥗 Costo ingredienti</div>
				<div style="font-size:18px; font-weight:700;">${fmtCurrency(calc.costoIngredienti)}</div>
			</div>
			<div style="background:var(--card); border:2px solid var(--primary); border-radius:8px; padding:10px;">
				<div style="font-size:11px; color:var(--text-muted); margin-bottom:4px;">💰 Costo totale ricetta</div>
				<div style="font-size:20px; font-weight:800; color:var(--primary);">${fmtCurrency(calc.costoIngredienti)}</div>
			</div>
		</div>
		${hasPrezzo ? `
		<div style="padding:0 14px 14px; display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px;">
			<div style="background:var(--bg); border-radius:8px; padding:10px;">
				<div style="font-size:11px; color:var(--text-muted); margin-bottom:4px;">💶 Prezzo vendita</div>
				<div style="font-size:18px; font-weight:700;">${fmtCurrency(prezzoVendita)}</div>
			</div>
			<div style="background:var(--bg); border-radius:8px; padding:10px;">
				<div style="font-size:11px; color:var(--text-muted); margin-bottom:4px;">📈 Margine (€)</div>
				<div style="font-size:18px; font-weight:700; color:${(calc.margine || 0) >= 0 ? 'var(--success)' : 'var(--danger)'};">${fmtCurrency(calc.margine)}</div>
			</div>
			<div style="background:${(calc.marginePct || 0) >= 60 ? '#dcfce7' : (calc.marginePct || 0) >= 40 ? '#fef9c3' : '#fee2e2'}; border-radius:8px; padding:10px;">
				<div style="font-size:11px; color:var(--text-muted); margin-bottom:4px;">📊 Margine %</div>
				<div style="font-size:24px; font-weight:800; color:${(calc.marginePct || 0) >= 60 ? '#16a34a' : (calc.marginePct || 0) >= 40 ? '#ca8a04' : '#dc2626'};">${fmtPct(calc.marginePct)}</div>
				<div style="font-size:11px; color:var(--text-muted);">Food cost: ${fmtPct(calc.foodCostPct)} <span class="badge ${fcStatus.className}" style="font-size:10px;">${fcStatus.label}</span></div>
			</div>
		</div>` : `
		<div style="padding:0 14px 14px;">
			<div style="background:var(--bg); border-radius:8px; padding:10px; text-align:center; color:var(--text-muted); font-size:13px;">
				👆 Inserisci il prezzo di vendita per vedere il margine %
			</div>
		</div>`}
	</div>`
}

function renderSimulatorBody() {
	var sim = state.simulator

	if (sim.loading) {
		return `
		<div style="padding:16px 0; text-align:center;">
			<div class="spinner" aria-hidden="true" style="display:inline-block;"></div>
			<span style="margin-left:8px; color:var(--text-muted);">Caricamento ingredienti...</span>
		</div>`
	}

	return `
	<div style="margin-top:16px;">

		<!-- Nome ricetta -->
		<div style="background:var(--secondary); border-radius:10px; padding:12px 14px; margin-bottom:16px; display:flex; align-items:center; gap:12px;">
			<div style="font-size:13px; font-weight:700; white-space:nowrap;">🍽️ Nome ricetta</div>
			<input type="text" placeholder="Es. Spaghetti alla carbonara"
				style="${INPUT_STYLE} flex:1;"
				value="${escapeHtml(String(sim.ricettaNome))}"
				data-action="sim-nome-ricetta-input">
		</div>

		<!-- Form aggiungi ingrediente -->
		<div style="background:var(--secondary); border-radius:10px; padding:14px; margin-bottom:16px;">
			<div style="font-size:13px; font-weight:700; margin-bottom:10px; color:var(--text);">➕ Aggiungi ingrediente</div>
			<div style="display:flex; gap:8px; align-items:flex-end; flex-wrap:wrap;">
				<div style="flex:1; min-width:140px;">
					<div style="font-size:12px; color:var(--text-muted); margin-bottom:4px;">Ingrediente</div>
					<input type="text" id="sim-new-nome" placeholder="Es. Farina 00"
						style="${INPUT_STYLE} width:100%;"
						data-action="sim-new-nome-input">
				</div>
				<div style="width:130px;">
					<div style="font-size:12px; color:var(--text-muted); margin-bottom:4px;">Costo (€)</div>
					<input type="number" id="sim-new-costo" min="0" step="0.001" placeholder="0.00"
						style="${INPUT_STYLE} width:100%;"
						data-action="sim-new-costo-input">
				</div>
				<button data-action="sim-add-ing"
					style="padding:7px 16px; background:var(--primary); color:#fff; border:none; border-radius:6px; font-size:13px; font-weight:700; cursor:pointer; white-space:nowrap;">
					+ Aggiungi
				</button>
			</div>
			${sim.error ? `<div style="color:var(--danger); font-size:12px; margin-top:6px;">⚠️ ${escapeHtml(sim.error)}</div>` : ''}
		</div>

		<!-- Lista ingredienti -->
		<div style="margin-bottom:16px;">
			<div style="font-size:13px; font-weight:700; margin-bottom:8px; color:var(--text);">🥗 Ingredienti della ricetta</div>
			<table style="width:100%; border-collapse:collapse;">
				<thead>
					<tr style="border-bottom:2px solid var(--border);">
						<th style="text-align:left; padding:6px 8px; font-size:12px; color:var(--text-muted);">Ingrediente</th>
						<th style="text-align:left; padding:6px 8px; font-size:12px; color:var(--text-muted);">Costo (€)</th>
						<th style="padding:6px 8px;"></th>
					</tr>
				</thead>
				<tbody>
					${renderSimulatorIngredientRows()}
				</tbody>
				${sim.ingredienti.length ? `
				<tfoot>
					<tr style="border-top:2px solid var(--border);">
						<td style="padding:6px 8px; font-size:13px; font-weight:700;">Totale ingredienti</td>
						<td style="padding:6px 8px; font-size:14px; font-weight:800; color:var(--primary);">${fmtCurrency(sim.ingredienti.reduce(function(s,i){return s+toNumber(i.costo)},0))}</td>
						<td></td>
					</tr>
				</tfoot>` : ''}
			</table>
		</div>

		<!-- Prezzo di vendita -->
		<div style="display:flex; align-items:center; gap:12px; margin-bottom:16px; background:var(--secondary); border-radius:10px; padding:12px 14px;">
			<div style="font-size:13px; font-weight:700; white-space:nowrap;">💶 Prezzo di vendita</div>
			<input type="number" min="0" step="0.01" placeholder="Es. 14.50"
				style="${INPUT_STYLE} width:140px; font-size:16px; font-weight:700;"
				value="${escapeHtml(String(sim.prezzoVendita))}"
				data-action="sim-prezzo-input">
			<span style="font-size:12px; color:var(--text-muted);">Inserisci il prezzo per calcolare il margine</span>
		</div>

		<!-- Risultato -->
		<div data-slot="sim-result">
			${renderSimulatorResult()}
		</div>

		<!-- Salva simulazione -->
		${sim.ingredienti.length ? `
		<div style="margin-top:16px; display:flex; align-items:center; gap:12px;">
			<button class="btn btn-primary" data-action="sim-salva" ${sim.saving ? 'disabled' : ''}>
				${sim.saving ? '⏳ Salvataggio...' : '💾 Salva simulazione'}
			</button>
			${sim.ricettaNome ? `<span style="font-size:12px; color:var(--text-muted);">Aggiunge <strong>${escapeHtml(sim.ricettaNome)}</strong> nell'analisi food cost</span>` : `<span style="font-size:12px; color:var(--text-muted);">Inserisci il nome della ricetta per poter salvare</span>`}
		</div>
		${sim.saveError ? `<div style="color:var(--danger); font-size:12px; margin-top:6px;">⚠️ ${escapeHtml(sim.saveError)}</div>` : ''}
		` : ''}
	</div>`
}

// ── Render: calculator ────────────────────────────────────────────────────────

function renderCalculatorPanel() {
	var calc = state.calculator
	var display = calc.display.length > 14 ? calc.display.slice(-14) : calc.display

	var btnStyle = function (bg, color) {
		return `style="padding:10px 0; font-size:15px; border-radius:8px; border:none; cursor:pointer; background:${bg}; color:${color}; font-weight:600;"`
	}

	var activeOp = calc.op
	var opStyle = function (op) {
		var active = activeOp === op && calc.expectNew
		return `style="padding:10px 0; font-size:15px; border-radius:8px; border:${active ? '2px solid var(--primary)' : 'none'}; cursor:pointer; background:var(--primary); color:#fff; font-weight:700;"`
	}

	return `
	<div data-slot="calculator" style="position:fixed; top:110px; right:20px; z-index:300;
		width:230px; background:var(--card); border:1px solid var(--border);
		border-radius:14px; box-shadow:0 8px 32px rgba(0,0,0,0.35); padding:14px;">
		<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
			<span style="font-size:12px; font-weight:600; color:var(--text-muted);">🧮 Calcolatrice</span>
			<button data-action="toggle-calc" style="background:none;border:none;cursor:pointer;font-size:16px;color:var(--text-muted);">✕</button>
		</div>
		<div style="font-size:22px; text-align:right; padding:10px 12px; background:var(--bg);
			border-radius:8px; margin-bottom:10px; font-family:monospace; min-height:44px;
			overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
			${escapeHtml(display)}
		</div>
		<div style="display:grid; grid-template-columns:repeat(4,1fr); gap:6px;">
			<button data-action="calc-btn" data-btn="C"  ${btnStyle('var(--danger-light,#fee2e2)', 'var(--danger)')}>C</button>
			<button data-action="calc-btn" data-btn="±"  ${btnStyle('var(--secondary)', 'var(--text)')}>±</button>
			<button data-action="calc-btn" data-btn="%"  ${btnStyle('var(--secondary)', 'var(--text)')}>%</button>
			<button data-action="calc-btn" data-btn="/"  ${opStyle('/')}>÷</button>

			<button data-action="calc-btn" data-btn="7"  ${btnStyle('var(--secondary)', 'var(--text)')}>7</button>
			<button data-action="calc-btn" data-btn="8"  ${btnStyle('var(--secondary)', 'var(--text)')}>8</button>
			<button data-action="calc-btn" data-btn="9"  ${btnStyle('var(--secondary)', 'var(--text)')}>9</button>
			<button data-action="calc-btn" data-btn="*"  ${opStyle('*')}>×</button>

			<button data-action="calc-btn" data-btn="4"  ${btnStyle('var(--secondary)', 'var(--text)')}>4</button>
			<button data-action="calc-btn" data-btn="5"  ${btnStyle('var(--secondary)', 'var(--text)')}>5</button>
			<button data-action="calc-btn" data-btn="6"  ${btnStyle('var(--secondary)', 'var(--text)')}>6</button>
			<button data-action="calc-btn" data-btn="-"  ${opStyle('-')}>−</button>

			<button data-action="calc-btn" data-btn="1"  ${btnStyle('var(--secondary)', 'var(--text)')}>1</button>
			<button data-action="calc-btn" data-btn="2"  ${btnStyle('var(--secondary)', 'var(--text)')}>2</button>
			<button data-action="calc-btn" data-btn="3"  ${btnStyle('var(--secondary)', 'var(--text)')}>3</button>
			<button data-action="calc-btn" data-btn="+"  ${opStyle('+')}>+</button>

			<button data-action="calc-btn" data-btn="0"
				style="grid-column:span 2; padding:10px 0; font-size:15px; border-radius:8px; border:none; cursor:pointer; background:var(--secondary); color:var(--text); font-weight:600;">0</button>
			<button data-action="calc-btn" data-btn="."  ${btnStyle('var(--secondary)', 'var(--text)')}>.</button>
			<button data-action="calc-btn" data-btn="="
				style="padding:10px 0; font-size:15px; border-radius:8px; border:none; cursor:pointer; background:var(--success,#22c55e); color:#fff; font-weight:700;">=</button>
		</div>
	</div>`
}

// ── Render: detail modal ──────────────────────────────────────────────────────

function renderDetailModal() {
	if (!state.detailModal.open) return ''

	if (state.detailModal.loading) {
		return `
		<div class="modal-overlay" data-action="close-detail-bg">
			<div class="modal modal-lg" role="dialog" aria-modal="true">
				<div class="modal-header">
					<div><div class="modal-title">Dettaglio food cost</div><div class="modal-subtitle">Caricamento...</div></div>
					<button class="modal-close" type="button" data-action="close-detail">×</button>
				</div>
				<div class="modal-body">
					<div class="empty-state" style="padding:24px 10px;"><div class="spinner" aria-hidden="true"></div></div>
				</div>
			</div>
		</div>`
	}

	if (state.detailModal.error) {
		return `
		<div class="modal-overlay" data-action="close-detail-bg">
			<div class="modal modal-lg" role="dialog" aria-modal="true">
				<div class="modal-header">
					<div><div class="modal-title">Dettaglio food cost</div></div>
					<button class="modal-close" type="button" data-action="close-detail">×</button>
				</div>
				<div class="modal-body"><div class="form-error">⚠️ ${escapeHtml(state.detailModal.error)}</div></div>
			</div>
		</div>`
	}

	var record = state.detailModal.record || {}
	var ingredienti = Array.isArray(record.ingredienti) ? record.ingredienti : []
	var status = getStatusConfig(record.food_cost_pct)

	return `
	<div class="modal-overlay" data-action="close-detail-bg">
		<div class="modal modal-lg" role="dialog" aria-modal="true" aria-label="Dettaglio food cost">
			<div class="modal-header">
				<div>
					<div class="modal-title">Dettaglio: ${escapeHtml(record.ricetta_nome || 'Ricetta')}</div>
					<div class="modal-subtitle">Analisi ingredienti e marginalità</div>
				</div>
				<button class="modal-close" type="button" data-action="close-detail">×</button>
			</div>
			<div class="modal-body">
				<div class="grid-2" style="margin-bottom:12px;">
					<div>Prezzo vendita: <strong>${fmtCurrency(record.prezzo_vendita)}</strong></div>
					<div>Costo ingredienti: <strong>${fmtCurrency(record.costo_ingredienti)}</strong></div>
					<div>Margine: <strong>${fmtCurrency(record.margine)}</strong></div>
					<div>Stato: <span class="badge ${status.className}">${status.label}</span></div>
				</div>
				<div class="table-wrapper">
					<table>
						<thead>
							<tr>
								<th>Ingrediente</th>
								<th class="th-right">Quantità</th>
								<th>Unità</th>
								<th class="th-right">Costo unitario</th>
								<th class="th-right">Costo totale</th>
							</tr>
						</thead>
						<tbody>
							${ingredienti.length
								? ingredienti.map(function (item) {
									return `<tr>
										<td>${escapeHtml(item.ingrediente_nome || 'Ingrediente')}</td>
										<td class="td-right td-mono">${toNumber(item.quantita)}</td>
										<td>${escapeHtml(item.unita_misura || '-')}</td>
										<td class="td-right td-mono">${fmtCurrency(item.costo_unitario)}</td>
										<td class="td-right td-mono">${fmtCurrency(item.costo_totale)}</td>
									</tr>`
								}).join('')
								: '<tr><td colspan="5" class="td-center td-dim">Nessun ingrediente associato</td></tr>'}
						</tbody>
					</table>
				</div>
			</div>
			<div class="modal-footer">
				<button type="button" class="btn btn-ghost" data-action="close-detail">❌ Chiudi</button>
			</div>
		</div>
	</div>`
}

// ── Main render ───────────────────────────────────────────────────────────────

function render() {
	if (state.loading) return renderLoading()
	if (state.errorMessage) return renderError()

	var kpi = getKpiData(state.records)
	var noData = state.records.length === 0

	return `
	<div style="position:relative;">

		<button data-action="toggle-calc"
			title="Apri calcolatrice"
			style="position:fixed; top:64px; right:20px; z-index:200;
				width:42px; height:42px; border-radius:50%; border:1px solid var(--border);
				background:var(--card); cursor:pointer; font-size:20px;
				box-shadow:0 2px 8px rgba(0,0,0,0.2); display:flex; align-items:center; justify-content:center;">
			🧮
		</button>

		${state.calculator.open ? renderCalculatorPanel() : '<div data-slot="calculator"></div>'}

		<div class="grid-kpi">
			<div class="kpi-card">
				<div class="kpi-icon">📊</div>
				<div class="kpi-label">Food cost medio</div>
				<div class="kpi-value">${fmtPct(kpi.media)}</div>
			</div>
			<div class="kpi-card">
				<div class="kpi-icon">✅</div>
				<div class="kpi-label">Piatti ottimali</div>
				<div class="kpi-value">${kpi.ottimali}</div>
			</div>
			<div class="kpi-card">
				<div class="kpi-icon">🚨</div>
				<div class="kpi-label">Piatti critici</div>
				<div class="kpi-value" style="color:var(--danger);">${kpi.critici}</div>
			</div>
		</div>

		<div class="card" style="margin-top:16px;">
			<div class="section-title">Analisi food cost per ricetta</div>
			<div class="table-wrapper">
				<table>
					<thead>
						<tr>
							<th>Ricetta</th>
							<th class="th-right">Costo ingredienti</th>
							<th class="th-right">Prezzo vendita</th>
							<th class="th-right">Food cost %</th>
							<th class="th-center">Stato</th>
							<th class="th-right">Azioni</th>
						</tr>
					</thead>
					<tbody>${renderTableRows()}</tbody>
				</table>
			</div>
			${noData ? `
			<div class="empty-state" style="padding:24px 16px;">
				<div class="empty-state-icon">🍽️</div>
				<div class="empty-state-title">Nessuna ricetta disponibile</div>
				<div class="empty-state-sub">Aggiungi ricette e ingredienti per avviare l'analisi food cost.</div>
			</div>` : ''}
		</div>

		<div class="card" style="margin-top:16px;">
			<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
				<div class="section-title" style="margin-bottom:0;">Simulatore food cost</div>
				${state.simulator.ingredienti.length ? `
				<button data-action="sim-reset"
					style="background:none; border:1px solid var(--border); border-radius:6px; padding:4px 10px; font-size:12px; cursor:pointer; color:var(--text-muted);">
					🗑 Azzera tutto
				</button>` : ''}
			</div>
			<div data-slot="simulator-body">
				${renderSimulatorBody()}
			</div>
		</div>

		${state.noticeMessage ? `<div class="card" style="margin-top:16px; padding:12px 14px;">${escapeHtml(state.noticeMessage)}</div>` : ''}

		${renderDetailModal()}
	</div>`
}

function rerender() {
	if (!state.container) return
	state.container.innerHTML = render()
}

// ── Partial DOM updates ───────────────────────────────────────────────────────

function updateSimResult() {
	if (!state.container) return
	var slot = state.container.querySelector('[data-slot="sim-result"]')
	if (slot) slot.innerHTML = renderSimulatorResult()
}

function scheduleSimResultUpdate() {
	if (simulatorResultTimeoutId) {
		clearTimeout(simulatorResultTimeoutId)
	}
	simulatorResultTimeoutId = setTimeout(function () {
		simulatorResultTimeoutId = null
		updateSimResult()
	}, SIM_RESULT_DEBOUNCE_MS)
}

function updateSimulatorBody() {
	if (!state.container) return
	var slot = state.container.querySelector('[data-slot="simulator-body"]')
	if (slot) slot.innerHTML = renderSimulatorBody()
}

function updateCalculator() {
	if (!state.container) return
	var slot = state.container.querySelector('[data-slot="calculator"]')
	if (slot) slot.outerHTML = state.calculator.open ? renderCalculatorPanel() : '<div data-slot="calculator"></div>'
}

// ── Calculator logic ──────────────────────────────────────────────────────────

function applyOp(op, left, right) {
	if (op === '+') return left + right
	if (op === '-') return left - right
	if (op === '*') return left * right
	if (op === '/') return right !== 0 ? left / right : 0
	return right
}

function formatCalcResult(val) {
	if (!Number.isFinite(val)) return '0'
	return String(Math.round(val * 1e10) / 1e10)
}

function calcPress(btn) {
	var calc = state.calculator
	var display = calc.display
	var val = parseFloat(display) || 0

	if ((btn >= '0' && btn <= '9') || btn === '.') {
		if (btn === '.' && display.includes('.') && !calc.expectNew) return
		if (calc.expectNew) {
			calc.display = btn === '.' ? '0.' : btn
			calc.expectNew = false
		} else {
			if (btn === '.' && display.includes('.')) return
			calc.display = (display === '0' && btn !== '.') ? btn : display + btn
		}
		return
	}

	if (btn === 'C') {
		calc.display = '0'
		calc.left = null
		calc.op = null
		calc.expectNew = false
		return
	}

	if (btn === '±') {
		calc.display = formatCalcResult(val * -1)
		return
	}

	if (btn === '%') {
		calc.display = formatCalcResult(val / 100)
		return
	}

	if (btn === '=') {
		if (calc.op !== null && calc.left !== null) {
			var result = applyOp(calc.op, calc.left, val)
			calc.display = formatCalcResult(result)
			calc.left = null
			calc.op = null
			calc.expectNew = true
		}
		return
	}

	// Operator button (+, -, *, /)
	if (calc.op !== null && !calc.expectNew) {
		var r = applyOp(calc.op, calc.left, val)
		calc.display = formatCalcResult(r)
		calc.left = parseFloat(calc.display)
	} else {
		calc.left = val
	}
	calc.op = btn
	calc.expectNew = true
}

// ── Data loading ──────────────────────────────────────────────────────────────

async function refreshData() {
	var records = await window.api.foodcost.getFoodcostTutti()
	state.records = Array.isArray(records) ? records : []
}

async function loadSimulatorRicetta(ricettaId) {
	if (!ricettaId) {
		state.simulator.ricettaId = ''
		state.simulator.ricettaNome = ''
		updateSimulatorBody()
		return
	}

	state.simulator.ricettaId = String(ricettaId)
	state.simulator.loading = true
	state.simulator.error = ''
	state.simulator.saveError = ''
	updateSimulatorBody()

	try {
		var data = await window.api.foodcost.getFoodcostRicetta(Number(ricettaId))
		state.simulator.ricettaNome = data.ricetta_nome || ''
		// Pre-popola prezzo di vendita con quello attuale della ricetta
		if (!state.simulator.prezzoVendita) {
			state.simulator.prezzoVendita = String(toNumber(data.prezzo_vendita) || '')
		}
		// Aggiunge gli ingredienti della ricetta alla lista (come voci semplici nome + costo)
		var nuovi = (Array.isArray(data.ingredienti) ? data.ingredienti : []).map(function (ing) {
			var costo = calcIngredientCost(ing.quantita, ing.unita_misura, ing.prezzo_kg)
			return {
				uid: 'db_' + ing.id + '_' + Date.now(),
				nome: ing.ingrediente_nome || 'Ingrediente',
				costo: String(round(costo, 4)),
			}
		})
		state.simulator.ingredienti = state.simulator.ingredienti.concat(nuovi)
	} catch (err) {
		state.simulator.error = err && err.message ? err.message : 'Errore caricamento ricetta'
	} finally {
		state.simulator.loading = false
		updateSimulatorBody()
	}
}

// ── Modal ─────────────────────────────────────────────────────────────────────

function closeDetailModal() {
	state.detailModal.open = false
	state.detailModal.loading = false
	state.detailModal.error = ''
	state.detailModal.record = null
	rerender()
}

async function openDetailModal(ricettaId) {
	state.detailModal.open = true
	state.detailModal.loading = true
	state.detailModal.error = ''
	state.detailModal.record = null
	rerender()

	try {
		state.detailModal.record = await window.api.foodcost.getFoodcostRicetta(Number(ricettaId))
	} catch (err) {
		state.detailModal.error = err && err.message ? err.message : 'Impossibile caricare il dettaglio'
	} finally {
		state.detailModal.loading = false
		rerender()
	}
}

async function salvaSimulazione() {
	var sim = state.simulator

	if (!sim.ricettaNome || !sim.ricettaNome.trim()) {
		sim.saveError = 'Inserisci il nome della ricetta prima di salvare'
		updateSimulatorBody()
		return
	}

	var prezzoVendita = toNumber(sim.prezzoVendita)
	if (prezzoVendita <= 0) {
		sim.saveError = 'Inserisci un prezzo di vendita valido prima di salvare'
		updateSimulatorBody()
		return
	}

	sim.saving = true
	sim.saveError = ''
	updateSimulatorBody()

	try {
		await window.api.foodcost.salvaSimulazione({
			nome: sim.ricettaNome.trim(),
			prezzo: prezzoVendita,
			ingredienti: sim.ingredienti,
		})
		await refreshData()
		state.noticeMessage = '"' + sim.ricettaNome.trim() + '" aggiunto all\'analisi food cost'
		sim.saving = false
		sim.ingredienti = []
		sim.prezzoVendita = ''
		sim.ricettaNome = ''
		sim.saveError = ''
		sim.editingIngIdx = null
		rerender()
	} catch (err) {
		sim.saveError = err && err.message ? err.message : 'Errore durante il salvataggio'
		sim.saving = false
		updateSimulatorBody()
	}
}

// ── Events ────────────────────────────────────────────────────────────────────

function initEvents(container) {
	if (container.__foodcostEventsBound) return
	container.__foodcostEventsBound = true

	// Click events (buttons, actions)
	container.addEventListener('click', function (event) {
		var target = event.target
		if (!(target instanceof Element)) return
		var actionNode = target.closest('[data-action]')
		if (!actionNode) return
		var action = actionNode.getAttribute('data-action')
		var id = actionNode.getAttribute('data-id')
		var idx = parseInt(actionNode.getAttribute('data-idx'), 10)

		if (action === 'retry-load') {
			load(container)
			return
		}

		if (action === 'open-detail') {
			openDetailModal(id)
			return
		}

		if (action === 'close-detail' || action === 'close-detail-bg') {
			if (action === 'close-detail-bg' && !actionNode.classList.contains('modal-overlay')) return
			closeDetailModal()
			return
		}

		if (action === 'toggle-calc') {
			state.calculator.open = !state.calculator.open
			updateCalculator()
			return
		}

		if (action === 'calc-btn') {
			var btn = actionNode.getAttribute('data-btn')
			if (btn) {
				calcPress(btn)
				updateCalculator()
			}
			return
		}

		if (action === 'sim-add-ing') {
			var nomeInput = container.querySelector('[data-action="sim-new-nome-input"]')
			var costoInput = container.querySelector('[data-action="sim-new-costo-input"]')
			var nome = nomeInput ? nomeInput.value.trim() : ''
			var costo = costoInput ? costoInput.value.trim() : ''
			if (!nome) {
				state.simulator.error = 'Inserisci il nome dell\'ingrediente'
				updateSimulatorBody()
				return
			}
			if (!costo || toNumber(costo) < 0) {
				state.simulator.error = 'Inserisci un costo valido (es. 0.50)'
				updateSimulatorBody()
				return
			}
			state.simulator.error = ''
			state.simulator.ingredienti.push({
				uid: 'manual_' + Date.now() + '_' + Math.random(),
				nome: nome,
				costo: costo,
			})
			updateSimulatorBody()
			return
		}

		if (action === 'sim-del-ing' && !isNaN(idx)) {
			state.simulator.ingredienti.splice(idx, 1)
			updateSimulatorBody()
			return
		}

		if (action === 'sim-salva') {
			salvaSimulazione()
			return
		}

		if (action === 'sim-edit-ing' && !isNaN(idx)) {
			state.simulator.editingIngIdx = idx
			updateSimulatorBody()
			return
		}

		if (action === 'sim-edit-cancel') {
			state.simulator.editingIngIdx = null
			updateSimulatorBody()
			return
		}

		if (action === 'sim-edit-save' && !isNaN(idx)) {
			var nomeInput = container.querySelector('[data-action="sim-edit-nome"][data-idx="' + idx + '"]')
			var costoInput = container.querySelector('[data-action="sim-edit-costo"][data-idx="' + idx + '"]')
			var newNome = nomeInput ? nomeInput.value.trim() : ''
			var newCosto = costoInput ? costoInput.value.trim() : ''
			if (!newNome) {
				state.simulator.error = 'Il nome dell\'ingrediente non può essere vuoto'
				updateSimulatorBody()
				return
			}
			if (state.simulator.ingredienti[idx]) {
				state.simulator.ingredienti[idx].nome = newNome
				state.simulator.ingredienti[idx].costo = newCosto || '0'
			}
			state.simulator.editingIngIdx = null
			state.simulator.error = ''
			updateSimulatorBody()
			return
		}

		if (action === 'sim-reset') {
			state.simulator.ingredienti = []
			state.simulator.prezzoVendita = ''
			state.simulator.ricettaId = ''
			state.simulator.ricettaNome = ''
			state.simulator.error = ''
			state.simulator.saveError = ''
			state.simulator.editingIngIdx = null
			rerender()
			return
		}
	})

	// Change event: selezione ricetta only
	container.addEventListener('change', function (event) {
		var target = event.target
		if (!(target instanceof Element)) return
		if (target.getAttribute('data-action') === 'sim-ricetta-select') {
			loadSimulatorRicetta(target.value)
		}
	})

	// Input event: live update for all simulator number fields
	container.addEventListener('input', function (event) {
		var target = event.target
		if (!(target instanceof Element)) return
		var action = target.getAttribute('data-action')
		var idx = parseInt(target.getAttribute('data-idx'), 10)

		if (action === 'sim-ing-costo' && !isNaN(idx)) {
			if (state.simulator.ingredienti[idx]) {
				state.simulator.ingredienti[idx].costo = target.value
			}
			scheduleSimResultUpdate()
			return
		}

		if (action === 'sim-nome-ricetta-input') {
			state.simulator.ricettaNome = target.value
			return
		}

		if (action === 'sim-prezzo-input') {
			state.simulator.prezzoVendita = target.value
			scheduleSimResultUpdate()
			return
		}
	})
}

// ── Load ──────────────────────────────────────────────────────────────────────

async function load(container) {
	state.container = container
	state.loading = true
	state.errorMessage = ''
	state.noticeMessage = ''
	rerender()

	try {
		await refreshData()
	} catch (err) {
		state.errorMessage = err && err.message ? err.message : "Impossibile caricare l'analisi food cost"
	} finally {
		state.loading = false
		rerender()
		initEvents(container)
	}
}

// ── Export ────────────────────────────────────────────────────────────────────

var pageApi = { render, initEvents, load }

if (typeof window !== 'undefined') {
	window.pages = window.pages || {}
	window.pages.foodcost = pageApi
}

if (typeof module !== 'undefined' && module.exports) {
	module.exports = pageApi
}

})()
