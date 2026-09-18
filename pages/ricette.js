(function () {
  var state = {
    container: null,
    loading: false,
    errorMessage: "",
    noticeMessage: "",
    searchQuery: "",
    ricette: [],
    categoriaSelezionata: null, // null = vista categorie; "" = ricette senza categoria; altrimenti id categoria
    dettaglioRicetta: null,
    dettaglioLoading: false,
    dettaglioError: "",
    modal: {
      open: false,
      mode: "create",
      error: "",
      loading: false,
      ingredienti: [], // [{ uid, nome, quantita, unita_misura }] - unico per create e edit
      values: {
        id: "",
        nome: "",
        porzioni: "1",
        tempo_preparazione: "20",
        temperatura: "",
        categoria: "",
        foto: null, // stringa base64 (data URL) o null
      },
    },
  };

  var CATEGORIE = [
    { id: "antipasto", label: "Antipasti", icon: "\uD83E\uDD57" },
    { id: "primo", label: "Primi piatti", icon: "\uD83C\uDF5D" },
    { id: "secondo", label: "Secondi piatti", icon: "\uD83C\uDF56" },
    { id: "dolce", label: "Dolci", icon: "\uD83C\uDF70" },
    { id: "salsa", label: "Salse", icon: "\uD83E\uDD63" },
  ];

  var FOTO_MAX_SIZE = 3 * 1024 * 1024; // 3MB
  var SEARCH_DEBOUNCE_MS = 180;
  var searchRerenderTimeoutId = null;

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function toNumber(value) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function getRicetteFiltrate() {
    var query = String(state.searchQuery || "").trim().toLowerCase();
    var categoria = state.categoriaSelezionata;

    return state.ricette.filter(function (ricetta) {
      var matchCategoria = categoria === ""
        ? !(ricetta && ricetta.categoria)
        : String((ricetta && ricetta.categoria) || "") === categoria;
      if (!matchCategoria) return false;
      if (!query) return true;
      return String(ricetta && ricetta.nome || "").toLowerCase().includes(query);
    });
  }

  function getCategoriaInfo(id) {
    for (var i = 0; i < CATEGORIE.length; i++) {
      if (CATEGORIE[i].id === id) return CATEGORIE[i];
    }
    return null;
  }

  function contaRicettePerCategoria(categoriaId) {
    return state.ricette.filter(function (ricetta) {
      if (categoriaId === "") return !(ricetta && ricetta.categoria);
      return ricetta && ricetta.categoria === categoriaId;
    }).length;
  }

  function renderCategoriaOptions(selected) {
    var options = ['<option value=""' + (selected ? "" : " selected") + ">Nessuna categoria</option>"];
    CATEGORIE.forEach(function (cat) {
      var sel = cat.id === selected ? " selected" : "";
      options.push(`<option value="${cat.id}"${sel}>${cat.icon} ${cat.label}</option>`);
    });
    return options.join("");
  }

  function formatTempo(value) {
    var tempo = Math.max(0, Math.round(toNumber(value)));
    return tempo + " min";
  }

  function renderLoading() {
    return `
	<div class="empty-state page-ricette">
		<div class="spinner" aria-hidden="true"></div>
		<div class="empty-state-title">Caricamento ricette</div>
		<div class="empty-state-sub">Recupero archivio ricette in corso...</div>
	</div>`;
  }

  function renderError() {
    return `
	<div class="empty-state page-ricette">
		<div class="empty-state-icon">⚠️</div>
		<div class="empty-state-title">Errore caricamento ricette</div>
		<div class="empty-state-sub">${escapeHtml(state.errorMessage || "Errore sconosciuto")}</div>
		<button class="btn btn-primary" data-action="retry-load">🔄 Riprova</button>
	</div>`;
  }

  function renderCategorie() {
    var cards = CATEGORIE.map(function (cat) {
      var count = contaRicettePerCategoria(cat.id);
      return `
	<div class="card" style="cursor:pointer; text-align:center; padding:24px 16px;" data-action="open-categoria" data-categoria="${cat.id}">
		<div style="font-size:34px; margin-bottom:10px;">${cat.icon}</div>
		<div class="section-title" style="margin-bottom:4px; justify-content:center;">${cat.label}</div>
		<div class="label">${count} ricett${count === 1 ? "a" : "e"}</div>
	</div>`;
    });

    var senzaCategoria = contaRicettePerCategoria("");
    if (senzaCategoria > 0) {
      cards.push(`
	<div class="card" style="cursor:pointer; text-align:center; padding:24px 16px;" data-action="open-categoria" data-categoria="">
		<div style="font-size:34px; margin-bottom:10px;">📁</div>
		<div class="section-title" style="margin-bottom:4px; justify-content:center;">Senza categoria</div>
		<div class="label">${senzaCategoria} ricett${senzaCategoria === 1 ? "a" : "e"}</div>
	</div>`);
    }

    return `
	<div class="grid-auto">
		${cards.join("")}
	</div>`;
  }

  function renderCards() {
    var ricette = getRicetteFiltrate();
    if (!ricette.length) {
      return `
		<div class="empty-state" style="padding: 30px 16px;">
			<div class="empty-state-icon">📖</div>
			<div class="empty-state-title">Nessuna ricetta trovata</div>
			<div class="empty-state-sub">Aggiungi una ricetta o modifica la ricerca per vedere risultati.</div>
		</div>`;
    }

    return `
	<div class="grid-auto">
		${ricette.map(function (ricetta) {
        var nome = escapeHtml(ricetta && ricetta.nome ? ricetta.nome : "Ricetta senza nome");
        var porzioni = Math.max(1, Math.round(toNumber(ricetta && ricetta.porzioni)));
        var tempo = formatTempo(ricetta && ricetta.tempo_preparazione);
        var temp = escapeHtml(ricetta && ricetta.temperatura ? ricetta.temperatura : "-");
        var nIng = Array.isArray(ricetta && ricetta.ingredienti) ? ricetta.ingredienti.length : 0;
        var fotoHtml = ricetta && ricetta.foto
          ? `<img src="${ricetta.foto}" alt="${nome}" style="width:100%; height:120px; object-fit:cover; border-radius:8px; margin-bottom:10px; cursor:pointer;" data-action="open-dettaglio" data-id="${ricetta.id}">`
          : "";
        return `
			<div class="card">
				${fotoHtml}
				<div class="section-title" style="margin-bottom: 8px; cursor:pointer;" data-action="open-dettaglio" data-id="${ricetta.id}">🍲 ${nome}</div>
				<div class="label" style="margin-bottom: 3px;">Persone</div>
				<div style="margin-bottom: 8px;">${porzioni}</div>
				<div class="label" style="margin-bottom: 3px;">Tempo preparazione</div>
				<div style="margin-bottom: 8px;">${tempo}</div>
				<div class="label" style="margin-bottom: 3px;">Temperatura</div>
				<div style="margin-bottom: 8px;">${temp}</div>
				<div class="label" style="margin-bottom: 3px;">Ingredienti</div>
				<div style="margin-bottom: 14px;">${nIng} ingredienti</div>
				<div style="display: flex; gap: 6px; flex-wrap:wrap; justify-content: flex-end;">
					<button class="btn btn-secondary btn-sm" data-action="open-dettaglio" data-id="${ricetta.id}">📋 Dettagli</button>
					<button class="btn btn-secondary btn-sm" data-action="open-edit-modal" data-id="${ricetta.id}">✏️ Modifica</button>
					<button class="btn btn-danger btn-sm" data-action="delete-ricetta" data-id="${ricetta.id}">🗑️ Elimina</button>
				</div>
			</div>`;
      }).join("")}
	</div>`;
  }

  function renderDettaglio() {
    if (state.dettaglioLoading) {
      return `
		<div class="card" style="margin-top: 16px;">
			<div class="section-title">Dettaglio ricetta</div>
			<div class="empty-state" style="padding: 26px 16px;">
				<div class="spinner" aria-hidden="true"></div>
				<div class="empty-state-sub">Caricamento dettaglio ricetta...</div>
			</div>
		</div>`;
    }

    if (state.dettaglioError) {
      return `
		<div class="card" style="margin-top: 16px;">
			<div class="section-title">Dettaglio ricetta</div>
			<div class="empty-state" style="padding: 26px 16px;">
				<div class="empty-state-icon">⚠️</div>
				<div class="empty-state-sub">${escapeHtml(state.dettaglioError)}</div>
			</div>
		</div>`;
    }

    if (!state.dettaglioRicetta) {
      return `
		<div class="card" style="margin-top: 16px;">
			<div class="section-title">Dettaglio ricetta</div>
			<div class="empty-state" style="padding: 26px 16px;">
				<div class="empty-state-icon">👆</div>
				<div class="empty-state-sub">Seleziona una card ricetta per visualizzare ingredienti e dettaglio operativo.</div>
			</div>
		</div>`;
    }

    var ricetta = state.dettaglioRicetta;
    var ingredienti = Array.isArray(ricetta.ingredienti)
      ? ricetta.ingredienti
      : [];
    var categoriaInfo = getCategoriaInfo(ricetta.categoria);
    var categoriaLabel = categoriaInfo
      ? categoriaInfo.icon + " " + categoriaInfo.label
      : "Senza categoria";

    return `
	<div class="card" style="margin-top: 16px;">
		<div class="section-title">Dettaglio ricetta: ${escapeHtml(ricetta.nome || "")}</div>
		${ricetta.foto ? `<img src="${ricetta.foto}" alt="${escapeHtml(ricetta.nome || "")}" style="width:100%; max-height:220px; object-fit:cover; border-radius:8px; margin-bottom:14px;">` : ""}
		<div class="grid-2" style="margin-bottom: 14px;">
			<div>
				<div class="label" style="margin-bottom: 4px;">Per quante persone</div>
				<div>${Math.max(1, Math.round(toNumber(ricetta.porzioni)))}</div>
			</div>
			<div>
				<div class="label" style="margin-bottom: 4px;">Tempo preparazione</div>
				<div>${formatTempo(ricetta.tempo_preparazione)}</div>
			</div>
		</div>
		<div class="grid-2" style="margin-bottom: 14px;">
			<div>
				<div class="label" style="margin-bottom: 4px;">Temperatura</div>
				<div>${escapeHtml(ricetta.temperatura || "-")}</div>
			</div>
			<div>
				<div class="label" style="margin-bottom: 4px;">Categoria</div>
				<div>${escapeHtml(categoriaLabel)}</div>
			</div>
		</div>

		<div class="table-wrapper">
			<table>
				<thead>
					<tr>
						<th>Ingrediente</th>
						<th class="th-right">Quantita</th>
						<th>Unita</th>
					</tr>
				</thead>
				<tbody>
					${
            ingredienti.length
              ? ingredienti
                  .map(function (ingrediente) {
                    return `<tr>
								<td>${escapeHtml(ingrediente.nome || "")}</td>
								<td class="td-right td-mono">${toNumber(ingrediente.quantita)}</td>
								<td>${escapeHtml(ingrediente.unita_misura || "-")}</td>
							</tr>`;
                  })
                  .join("")
              : '<tr><td colspan="3" class="td-center td-dim">Nessun ingrediente associato</td></tr>'
          }
				</tbody>
			</table>
		</div>
	</div>`;
  }

  var INPUT_S =
    "padding:6px 10px; border:1px solid var(--border); border-radius:6px; background:var(--bg); color:var(--text); font-size:13px; outline:none; box-sizing:border-box;";

  function renderModalIngredients() {
    var ings = state.modal.ingredienti;

    var rows = ings.length
      ? ings
          .map(function (ing, idx) {
            return `
		<tr>
			<td style="padding:5px 8px; font-size:13px;">${escapeHtml(ing.nome)}</td>
			<td style="padding:5px 8px; font-size:13px;">${toNumber(ing.quantita)} ${escapeHtml(ing.unita_misura || "")}</td>
			<td style="padding:5px 4px; text-align:center;">
				<button type="button" class="btn btn-danger btn-sm" data-action="modal-del-ing" data-idx="${idx}">🗑️</button>
			</td>
		</tr>`;
          })
          .join("")
      : `<tr><td colspan="3" style="text-align:center; color:var(--text-muted); padding:8px; font-size:12px;">Nessun ingrediente aggiunto</td></tr>`;

    return `
	<div style="border:1px solid var(--border); border-radius:8px; overflow:hidden; margin-top:6px;">
		<div style="display:flex; gap:8px; padding:10px; background:var(--secondary); flex-wrap:wrap; align-items:flex-end;">
			<div style="flex:2; min-width:140px;">
				<div style="font-size:11px; color:var(--text-muted); margin-bottom:3px;">Ingrediente</div>
				<input type="text" id="modal-new-ing-nome" placeholder="Nome ingrediente" autocomplete="off" style="${INPUT_S} width:100%;">
			</div>
			<div style="width:90px;">
				<div style="font-size:11px; color:var(--text-muted); margin-bottom:3px;">Quantità</div>
				<input type="number" id="modal-new-ing-quantita" min="0.001" step="0.001" placeholder="0" style="${INPUT_S} width:100%;">
			</div>
			<div style="width:75px;">
				<div style="font-size:11px; color:var(--text-muted); margin-bottom:3px;">Unità</div>
				<select id="modal-new-ing-unita" style="${INPUT_S} width:100%;">
					<option value="g">g</option>
					<option value="kg">kg</option>
					<option value="ml">ml</option>
					<option value="l">l</option>
					<option value="pz">pz</option>
				</select>
			</div>
			<button type="button" class="btn btn-primary btn-sm" data-action="modal-add-ing">+ Aggiungi</button>
		</div>
		<table style="width:100%; border-collapse:collapse;">
			<thead>
				<tr style="border-bottom:1px solid var(--border);">
					<th style="text-align:left; padding:5px 8px; font-size:11px; color:var(--text-muted);">Ingrediente</th>
					<th style="text-align:left; padding:5px 8px; font-size:11px; color:var(--text-muted);">Quantità</th>
					<th style="width:40px;"></th>
				</tr>
			</thead>
			<tbody>${rows}</tbody>
		</table>
	</div>`;
  }

  function renderModal() {
    if (!state.modal.open) {
      return "";
    }

    var isEdit = state.modal.mode === "edit";
    var values = state.modal.values;

    return `
	<div class="modal-overlay" data-action="close-modal-bg">
		<div class="modal modal-lg" role="dialog" aria-modal="true" aria-label="${isEdit ? "Modifica ricetta" : "Nuova ricetta"}">
			<div class="modal-header">
				<div>
					<div class="modal-title">${isEdit ? "Modifica ricetta" : "Nuova ricetta"}</div>
					<div class="modal-subtitle">Compila i dati principali della ricetta</div>
				</div>
				<button class="modal-close" type="button" data-action="close-modal">×</button>
			</div>

			<form data-action="submit-ricetta-form" style="display:flex; flex-direction:column; flex:1; overflow:hidden; min-height:0;">
				<div class="modal-body">
					<input type="hidden" name="id" value="${escapeHtml(values.id)}">

					<div class="form-group">
						<label class="form-label" for="ricetta-nome">Nome ricetta</label>
						<input id="ricetta-nome" class="form-input" name="nome" maxlength="140" required value="${escapeHtml(values.nome)}" placeholder="Es. Lasagna classica">
					</div>

					<div class="form-row">
						<div class="form-group">
							<label class="form-label" for="ricetta-porzioni">Per quante persone</label>
							<input id="ricetta-porzioni" class="form-input" name="porzioni" type="number" min="1" step="1" required value="${escapeHtml(values.porzioni)}">
						</div>

						<div class="form-group">
							<label class="form-label" for="ricetta-tempo">Tempo di preparazione (min)</label>
							<input id="ricetta-tempo" class="form-input" name="tempo_preparazione" type="number" min="0" step="1" required value="${escapeHtml(values.tempo_preparazione)}">
						</div>

						<div class="form-group">
							<label class="form-label" for="ricetta-temperatura">Temperatura</label>
							<input id="ricetta-temperatura" class="form-input" name="temperatura" maxlength="60" value="${escapeHtml(values.temperatura)}" placeholder="Es. 180°C, fuoco vivo">
						</div>

						<div class="form-group">
							<label class="form-label" for="ricetta-categoria">Categoria</label>
							<select id="ricetta-categoria" class="form-select" name="categoria">
								${renderCategoriaOptions(values.categoria)}
							</select>
						</div>
					</div>

					<div class="form-group">
						<label class="form-label" for="ricetta-foto">Foto (opzionale)</label>
						<input id="ricetta-foto" type="file" accept="image/*" data-action="modal-foto-input">
						${values.foto ? `
						<div style="margin-top:8px; display:flex; align-items:center; gap:10px;">
							<img src="${values.foto}" alt="Anteprima foto ricetta" style="width:64px; height:64px; object-fit:cover; border-radius:8px; border:1px solid var(--border);">
							<button type="button" class="btn btn-ghost btn-sm" data-action="modal-foto-rimuovi">🗑️ Rimuovi foto</button>
						</div>` : ""}
					</div>

					<div class="form-group" style="margin-bottom: 0;">
						<label class="form-label">Ingredienti</label>
						${renderModalIngredients()}
					</div>

					${state.modal.error ? `<div class="form-error" style="margin-top: 12px;">⚠️ ${escapeHtml(state.modal.error)}</div>` : ""}
				</div>

				<div class="modal-footer">
					<button type="button" class="btn btn-ghost" data-action="close-modal">❌ Annulla</button>
					<button type="submit" class="btn btn-primary"${state.modal.loading ? " disabled" : ""}>${isEdit ? "💾 Salva modifiche" : "💾 Salva ricetta"}</button>
				</div>
			</form>
		</div>
	</div>`;
  }

  function render() {
    if (state.loading) {
      return renderLoading();
    }

    if (state.errorMessage) {
      return renderError();
    }

    var vistaCategorie = state.categoriaSelezionata === null;

    if (vistaCategorie) {
      return `
	<div class="card">
		<div class="section-title">Gestione ricette</div>
		<div class="tabella-toolbar" style="margin-bottom: 14px;">
			<button class="btn btn-primary" data-action="open-create-modal">➕ Nuova ricetta</button>
		</div>
		${state.noticeMessage ? `<div class="card" style="margin-bottom: 14px; padding: 12px 14px;">${escapeHtml(state.noticeMessage)}</div>` : ""}
		${renderCategorie()}
	</div>
	${renderModal()}`;
    }

    var categoriaInfo = getCategoriaInfo(state.categoriaSelezionata);
    var categoriaLabel = categoriaInfo ? `${categoriaInfo.icon} ${categoriaInfo.label}` : "📁 Senza categoria";

    return `
	<div class="card">
		<div class="section-title" style="display:flex; align-items:center; gap:10px;">
			<button class="btn btn-secondary btn-sm" data-action="back-to-categorie">⬅️ Categorie</button>
			<span>${escapeHtml(categoriaLabel)}</span>
		</div>
		<div class="tabella-toolbar" style="margin-bottom: 14px;">
			<button class="btn btn-primary" data-action="open-create-modal">➕ Nuova ricetta</button>
			<input class="form-input search-bar" data-action="search-ricette" value="${escapeHtml(state.searchQuery)}" placeholder="Cerca per nome...">
		</div>
		${state.noticeMessage ? `<div class="card" style="margin-bottom: 14px; padding: 12px 14px;">${escapeHtml(state.noticeMessage)}</div>` : ""}
		${renderCards()}
	</div>
	${renderDettaglio()}
	${renderModal()}`;
  }

  function rerender() {
    if (!state.container) return;
    state.container.innerHTML = render();
  }

  function scheduleSearchRerender() {
    if (searchRerenderTimeoutId) {
      clearTimeout(searchRerenderTimeoutId);
    }
    searchRerenderTimeoutId = setTimeout(function () {
      searchRerenderTimeoutId = null;
      rerender();
    }, SEARCH_DEBOUNCE_MS);
  }

  // Salva nello state i valori attuali del form modale (evita reset al rerender)
  function captureModalFormValues() {
    if (!state.container || !state.modal.open) return;
    var form = state.container.querySelector('form[data-action="submit-ricetta-form"]');
    if (!form) return;
    var fd = new FormData(form);
    state.modal.values.nome               = String(fd.get("nome") || "").trim();
    state.modal.values.porzioni           = String(fd.get("porzioni") || "1");
    state.modal.values.tempo_preparazione = String(fd.get("tempo_preparazione") || "20");
    state.modal.values.temperatura        = String(fd.get("temperatura") || "").trim();
    state.modal.values.categoria          = String(fd.get("categoria") || "").trim();
  }

  async function refreshRicette() {
    var ricette = await window.api.ricette.getRicette();
    state.ricette = Array.isArray(ricette) ? ricette : [];
  }

  function closeModal() {
    state.modal.open = false;
    state.modal.error = "";
    state.modal.loading = false;
    rerender();
  }

  function openCreateModal() {
    state.modal.open = true;
    state.modal.mode = "create";
    state.modal.error = "";
    state.modal.loading = false;
    state.modal.ingredienti = [];
    state.modal.values = {
      id: "",
      nome: "",
      porzioni: "1",
      tempo_preparazione: "20",
      temperatura: "",
      categoria: state.categoriaSelezionata ? state.categoriaSelezionata : "",
      foto: null,
    };
    rerender();
  }

  async function openEditModal(id) {
    state.modal.open = true;
    state.modal.mode = "edit";
    state.modal.error = "";
    state.modal.loading = true;
    rerender();

    try {
      var dettaglio = await window.api.ricette.getRicettaDettaglio(Number(id));
      state.modal.loading = false;
      state.modal.ingredienti = Array.isArray(dettaglio && dettaglio.ingredienti)
        ? dettaglio.ingredienti.map(function (item) {
            return {
              uid: String(item.id || Date.now() + "-" + Math.random()),
              nome: String(item.nome || ""),
              quantita: toNumber(item.quantita),
              unita_misura: item.unita_misura || "g",
            };
          })
        : [];
      state.modal.values = {
        id: String(dettaglio && dettaglio.id ? dettaglio.id : ""),
        nome: String(dettaglio && dettaglio.nome ? dettaglio.nome : ""),
        porzioni: String(Math.max(1, Math.round(toNumber(dettaglio && dettaglio.porzioni)))),
        tempo_preparazione: String(Math.max(0, Math.round(toNumber(dettaglio && dettaglio.tempo_preparazione)))),
        temperatura: String(dettaglio && dettaglio.temperatura ? dettaglio.temperatura : ""),
        categoria: String(dettaglio && dettaglio.categoria ? dettaglio.categoria : ""),
        foto: dettaglio && dettaglio.foto ? dettaglio.foto : null,
      };
    } catch (error) {
      state.modal.loading = false;
      state.modal.error = error && error.message ? error.message : "Impossibile caricare il dettaglio ricetta";
    }

    rerender();
  }

  async function openDettaglio(id) {
    state.dettaglioLoading = true;
    state.dettaglioError = "";
    state.dettaglioRicetta = null;
    rerender();

    try {
      state.dettaglioRicetta = await window.api.ricette.getRicettaDettaglio(
        Number(id),
      );
    } catch (error) {
      state.dettaglioError =
        error && error.message
          ? error.message
          : "Impossibile caricare il dettaglio ricetta";
    } finally {
      state.dettaglioLoading = false;
      rerender();
    }
  }

  function validateRicettaPayload(payload) {
    if (!payload.nome) {
      return "Il nome della ricetta e obbligatorio";
    }
    if (payload.porzioni < 1) {
      return "Le porzioni devono essere almeno 1";
    }
    if (payload.tempo_preparazione < 0) {
      return "Il tempo di preparazione non puo essere negativo";
    }
    return "";
  }

  async function saveRicetta(form) {
    var formData = new FormData(form);
    var payload = {
      nome: String(formData.get("nome") || "").trim(),
      porzioni: Math.max(1, Math.round(toNumber(formData.get("porzioni")))),
      tempo_preparazione: Math.max(0, Math.round(toNumber(formData.get("tempo_preparazione")))),
      temperatura: String(formData.get("temperatura") || "").trim() || null,
      categoria: String(formData.get("categoria") || "").trim() || null,
      foto: state.modal.values.foto || null,
      ingredienti: state.modal.ingredienti.map(function (ing) {
        return {
          nome: ing.nome,
          quantita: ing.quantita,
          unita_misura: ing.unita_misura || "g",
          note: null,
        };
      }),
    };

    var validationError = validateRicettaPayload(payload);
    if (validationError) {
      state.modal.error = validationError;
      rerender();
      return;
    }

    state.modal.loading = true;
    state.modal.error = "";
    rerender();

    try {
      if (state.modal.mode === "edit") {
        payload.id = Number(state.modal.values.id);
        await window.api.ricette.updateRicetta(payload);
        state.noticeMessage = "Ricetta aggiornata correttamente";
      } else {
        await window.api.ricette.addRicetta(payload);
        state.noticeMessage = "Ricetta creata correttamente";
      }

      state.modal.open = false;
      state.modal.loading = false;
      state.modal.error = "";
      await refreshRicette();
      rerender();
    } catch (error) {
      state.modal.loading = false;
      state.modal.error = error && error.message ? error.message : "Errore durante il salvataggio";
      rerender();
    }
  }

  async function deleteRicetta(id) {
    var ricetta = state.ricette.find(function (item) {
      return String(item.id) === String(id);
    });
    if (!ricetta) {
      return;
    }

    var confirmed = window.confirm(
      `Confermi l'eliminazione della ricetta "${ricetta.nome}"?`,
    );
    if (!confirmed) {
      return;
    }

    try {
      await window.api.ricette.deleteRicetta(Number(id));
      state.noticeMessage = "Ricetta eliminata correttamente";
      if (
        state.dettaglioRicetta &&
        String(state.dettaglioRicetta.id) === String(id)
      ) {
        state.dettaglioRicetta = null;
        state.dettaglioError = "";
      }
      await refreshRicette();
      rerender();
    } catch (error) {
      state.noticeMessage =
        error && error.message ? error.message : "Errore eliminazione ricetta";
      rerender();
    }
  }

  function initEvents(container) {
    if (container.__ricetteEventsBound) {
      return;
    }
    container.__ricetteEventsBound = true;

    container.addEventListener("click", function (event) {
      var target = event.target;
      if (!(target instanceof Element)) return;

      var actionNode = target.closest("[data-action]");
      if (!actionNode) return;

      var action = actionNode.getAttribute("data-action");
      var id = actionNode.getAttribute("data-id");

      if (action === "retry-load") {
        load(container);
        return;
      }

      if (action === "open-categoria") {
        state.categoriaSelezionata = actionNode.hasAttribute("data-categoria")
          ? actionNode.getAttribute("data-categoria")
          : "";
        state.searchQuery = "";
        rerender();
        return;
      }

      if (action === "back-to-categorie") {
        state.categoriaSelezionata = null;
        state.searchQuery = "";
        state.dettaglioRicetta = null;
        state.dettaglioError = "";
        rerender();
        return;
      }

      if (action === "open-create-modal") {
        openCreateModal();
        return;
      }

      if (action === "open-edit-modal") {
        event.stopPropagation();
        openEditModal(id);
        return;
      }

      if (action === "delete-ricetta") {
        event.stopPropagation();
        deleteRicetta(id);
        return;
      }

      if (action === "open-dettaglio") {
        openDettaglio(id);
        return;
      }

      if (action === "modal-foto-rimuovi") {
        captureModalFormValues();
        state.modal.values.foto = null;
        rerender();
        return;
      }

      if (action === "close-modal" || action === "close-modal-bg") {
        if (
          action === "close-modal-bg" &&
          !actionNode.classList.contains("modal-overlay")
        )
          return;
        closeModal();
        return;
      }

      if (action === "modal-add-ing") {
        var ingNomeInput = container.querySelector("#modal-new-ing-nome");
        var quantitaInput = container.querySelector("#modal-new-ing-quantita");
        var unitaSelect = container.querySelector("#modal-new-ing-unita");

        var ingNome = ingNomeInput ? ingNomeInput.value.trim() : "";
        if (!ingNome) return;

        var quantita = toNumber(quantitaInput && quantitaInput.value);
        if (quantita <= 0) return;

        var unita = unitaSelect ? unitaSelect.value || "g" : "g";
        state.modal.ingredienti.push({
          uid: Date.now() + "-" + Math.random(),
          nome: ingNome,
          quantita: quantita,
          unita_misura: unita,
        });
        if (ingNomeInput) ingNomeInput.value = "";
        if (quantitaInput) quantitaInput.value = "";
        captureModalFormValues();
        rerender();
        return;
      }

      if (action === "modal-del-ing") {
        var delIdx = Number(actionNode.getAttribute("data-idx"));
        state.modal.ingredienti.splice(delIdx, 1);
        captureModalFormValues();
        rerender();
        return;
      }
    });

    container.addEventListener("input", function (event) {
      var target = event.target;
      if (!(target instanceof Element)) return;

      var action = target.getAttribute("data-action");
      if (action === "search-ricette") {
        state.searchQuery = target.value || "";
        scheduleSearchRerender();
      }
    });

    container.addEventListener("change", function (event) {
      var target = event.target;
      if (!(target instanceof Element)) return;

      var action = target.getAttribute("data-action");
      if (action !== "modal-foto-input") return;

      var file = target.files && target.files[0];
      if (!file) return;

      if (file.type.indexOf("image/") !== 0) {
        captureModalFormValues();
        state.modal.error = "Seleziona un file immagine valido";
        rerender();
        return;
      }

      if (file.size > FOTO_MAX_SIZE) {
        captureModalFormValues();
        state.modal.error = "L'immagine supera la dimensione massima di 3MB";
        rerender();
        return;
      }

      var reader = new FileReader();
      reader.onload = function () {
        captureModalFormValues();
        state.modal.values.foto = String(reader.result || "");
        state.modal.error = "";
        rerender();
      };
      reader.onerror = function () {
        captureModalFormValues();
        state.modal.error = "Impossibile leggere il file immagine selezionato";
        rerender();
      };
      reader.readAsDataURL(file);
    });

    container.addEventListener("submit", function (event) {
      var form = event.target;
      if (!(form instanceof HTMLFormElement)) return;

      event.preventDefault();

      if (form.getAttribute("data-action") === "submit-ricetta-form") {
        saveRicetta(form);
        return;
      }
    });
  }

  async function load(container) {
    state.container = container;
    state.loading = true;
    state.errorMessage = "";
    state.noticeMessage = "";
    rerender();

    try {
      await refreshRicette();
    } catch (error) {
      state.errorMessage =
        error && error.message
          ? error.message
          : "Impossibile caricare le ricette";
    } finally {
      state.loading = false;
      rerender();
      initEvents(container);
    }
  }

  var pageApi = { render, initEvents, load };

  if (typeof window !== "undefined") {
    window.pages = window.pages || {};
    window.pages.ricette = pageApi;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = pageApi;
  }
})();
