/**
 * ui/buildUI.ts — DOM construction and event listener wiring.
 * Imports all feature modules to connect DOM events to feature logic.
 */

import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { state } from "../state";
import { elt, injectStyles } from "./dom";
import { showToast } from "./status";
import { renderResults } from "../features/query";
import { doSearch } from "../features/query";
import { renderChips, clearDocSelector, loadFamiliesForFilter, populateLangCheckboxes } from "../features/filters";
import { updateFtsPreview, buildFtsQuery } from "../features/search";
import { renderHistPanel, saveToHistory } from "../features/history";
import { showImportModal, hideImportModal, doImport } from "../features/importFlow";
import { exportHits } from "../features/export";
import { closeMetaPanel } from "../features/metaPanel";
import { doOpenDb } from "../bootstrap";
import { buildStatsPanel, toggleStatsPanel } from "../features/stats";

export function buildUI(container: HTMLElement): void {
  injectStyles();

  // ── Topbar ──
  const topbar = elt("div", { class: "topbar" });
  topbar.appendChild(elt("h1", {}, "Concordancier"));
  const dbBadge = elt("span", { class: "db-badge", id: "db-badge" }, "—");
  topbar.appendChild(dbBadge);
  const statusDot = elt("span", { class: "status-dot idle", id: "status-dot" });
  topbar.appendChild(statusDot);

  // ── Toolbar ──
  const toolbar = elt("div", { class: "toolbar" });

  // Search row
  const searchRow = elt("div", { class: "search-row" });
  const searchInput = elt("input", {
    type: "text",
    class: "search-input",
    id: "search-input",
    placeholder: "Rechercher dans le corpus (FTS5)…",
    autocomplete: "off",
  }) as HTMLInputElement;
  const searchBtn = elt("button", { class: "btn btn-primary", id: "search-btn", disabled: "disabled", title: "Sidecar en cours de démarrage…" }, "Chercher");
  searchRow.appendChild(searchInput);
  searchRow.appendChild(searchBtn);
  toolbar.appendChild(searchRow);

  // Mode toggle
  const modeGroup = elt("div", { class: "mode-group" });
  const segBtn = elt("button", { class: "btn btn-secondary active", id: "mode-seg" }, "Segment");
  const kwicBtn = elt("button", { class: "btn btn-secondary", id: "mode-kwic" }, "KWIC");
  modeGroup.appendChild(segBtn);
  modeGroup.appendChild(kwicBtn);
  toolbar.appendChild(modeGroup);

  const alignedToggleBtn = elt(
    "button",
    { class: "btn btn-secondary aligned-toggle", id: "aligned-toggle-btn", type: "button" },
    "Alignés: off"
  ) as HTMLButtonElement;
  toolbar.appendChild(alignedToggleBtn);

  const parallelToggleBtn = elt(
    "button",
    { class: "btn btn-secondary", id: "parallel-toggle-btn", type: "button", style: "display:none" },
    "Parallèle: off"
  ) as HTMLButtonElement;
  toolbar.appendChild(parallelToggleBtn);

  const sourceChangedBtn = elt(
    "button",
    {
      class: "btn btn-ghost source-changed-btn",
      id: "source-changed-btn",
      type: "button",
      title: "Montrer uniquement les unités dont la source a changé (curation propagée)",
      style: "display:none",
    },
    "⚠ Source modifiée"
  ) as HTMLButtonElement;
  toolbar.appendChild(sourceChangedBtn);

  // Case-sensitive toggle
  const caseSensBtn = elt(
    "button",
    {
      class: "btn btn-ghost case-sensitive-btn",
      id: "case-sensitive-btn",
      type: "button",
      title: "Respecter la casse (post-filtre sur text_raw)",
    },
    "Aa"
  ) as HTMLButtonElement;
  toolbar.appendChild(caseSensBtn);

  // Window slider (hidden by default)
  const windowCtrl = elt("div", { class: "window-control", id: "window-ctrl", style: "display:none" });
  windowCtrl.appendChild(document.createTextNode("Fenêtre "));
  const rangeInput = elt("input", { type: "range", min: "3", max: "25", value: "10", id: "window-range" }) as HTMLInputElement;
  const windowValue = elt("span", { class: "window-value", id: "window-value" }, "10");
  windowCtrl.appendChild(rangeInput);
  windowCtrl.appendChild(windowValue);
  toolbar.appendChild(windowCtrl);

  // Filter + Builder + Help + Import + OpenDB + Reset buttons
  const filterBtn = elt("button", { class: "btn btn-ghost", id: "filter-btn" }, "⚙ Filtres");
  const builderBtn = elt("button", { class: "btn btn-ghost", id: "builder-btn" }, "✏ Requête");
  const statsBtn = elt("button", { class: "btn btn-ghost", id: "stats-btn", title: "Statistiques lexicales (fréquences, comparaison A/B)" }, "📊 Stats");

  // Help popover
  const helpWrap = elt("div", { class: "help-wrap" });
  const helpBtn = elt("button", {
    class: "btn btn-ghost",
    id: "help-btn",
    title: "Aide sur la syntaxe FTS5",
    style: "padding:4px 8px;font-size:0.85rem",
  }, "?");
  const helpPopover = elt("div", { class: "help-popover", id: "help-popover" });
  helpPopover.innerHTML = `
    <div class="help-popover-head">
      Aide — Syntaxe FTS5
      <button id="help-close-btn" style="background:none;border:none;cursor:pointer;font-size:0.9rem;color:#6c757d">\u2715</button>
    </div>
    <div class="help-popover-body">
      <div class="help-section">
        <div class="help-section-title">Exemples de requêtes</div>
        <div class="help-ex">
          <span class="help-ex-code">liberté</span>
          <span class="help-ex-desc">Mot simple</span>
          <button class="help-ex-copy" data-q="liberté">Copier</button>
        </div>
        <div class="help-ex">
          <span class="help-ex-code">"liberté égalité"</span>
          <span class="help-ex-desc">Expression exacte</span>
          <button class="help-ex-copy" data-q='"liberté égalité"'>Copier</button>
        </div>
        <div class="help-ex">
          <span class="help-ex-code">liberté AND fraternité</span>
          <span class="help-ex-desc">Les deux mots</span>
          <button class="help-ex-copy" data-q="liberté AND fraternité">Copier</button>
        </div>
        <div class="help-ex">
          <span class="help-ex-code">liberté OR égalité</span>
          <span class="help-ex-desc">Au moins un des mots</span>
          <button class="help-ex-copy" data-q="liberté OR égalité">Copier</button>
        </div>
        <div class="help-ex">
          <span class="help-ex-code">libr*</span>
          <span class="help-ex-desc">Préfixe (wildcard)</span>
          <button class="help-ex-copy" data-q="libr*">Copier</button>
        </div>
        <div class="help-ex">
          <span class="help-ex-code">NEAR(liberté fraternité, 10)</span>
          <span class="help-ex-desc">Deux mots proches (≤10 tokens)</span>
          <button class="help-ex-copy" data-q="NEAR(liberté fraternité, 10)">Copier</button>
        </div>
        <div class="help-ex">
          <span class="help-ex-code">NOT liberté</span>
          <span class="help-ex-desc">Exclusion</span>
          <button class="help-ex-copy" data-q="NOT liberté">Copier</button>
        </div>
      </div>
      <div class="help-section">
        <div class="help-section-title">Mode Regex (balayage complet)</div>
        <div class="help-ex">
          <span class="help-ex-code">\\blib(é|e)r\\w*</span>
          <span class="help-ex-desc">Variantes orthographiques</span>
          <button class="help-ex-copy" data-q="\\blib(é|e)r\\w*">Copier</button>
        </div>
        <div class="help-ex">
          <span class="help-ex-code">M(me|lle|\.)?\\s+\\w+</span>
          <span class="help-ex-desc">Titres de civilité</span>
          <button class="help-ex-copy" data-q="M(me|lle|\.)?\\s+\\w+">Copier</button>
        </div>
        <div class="help-ex">
          <span class="help-ex-code">\\d{4}</span>
          <span class="help-ex-desc">Années (4 chiffres)</span>
          <button class="help-ex-copy" data-q="\\d{4}">Copier</button>
        </div>
        <div class="help-ex">
          <span class="help-ex-code">(?&lt;=[.!?])\\s+[A-Z]</span>
          <span class="help-ex-desc">Début de phrase</span>
          <button class="help-ex-copy" data-q="(?<=[.!?])\\s+[A-Z]">Copier</button>
        </div>
        <div class="help-passthrough-note" style="margin-top:4px">
          Syntaxe Python. La casse est ignorée par défaut. Utilisez <code>(?-i)</code> ou le bouton <strong>Aa</strong> pour la respecter.
        </div>
      </div>
      <div class="help-section">
        <div class="help-section-title">Mode CQL (token-level)</div>
        <div class="help-ex">
          <span class="help-ex-code">[lemma = "liv.*" %c]</span>
          <span class="help-ex-desc">Lemme par regex (insensible casse)</span>
          <button class="help-ex-copy" data-q='[lemma = "liv.*" %c]'>Copier</button>
        </div>
        <div class="help-ex">
          <span class="help-ex-code">[pos = "DET" & lemma = "le"]</span>
          <span class="help-ex-desc">Contraintes combinées sur un token</span>
          <button class="help-ex-copy" data-q='[pos = "DET" & lemma = "le"]'>Copier</button>
        </div>
        <div class="help-ex">
          <span class="help-ex-code">[pos = "DET"][lemma = "liv.*" %c]</span>
          <span class="help-ex-desc">Séquence fixe de deux tokens</span>
          <button class="help-ex-copy" data-q='[pos = "DET"][lemma = "liv.*" %c]'>Copier</button>
        </div>
        <div class="help-ex">
          <span class="help-ex-code">[pos = "DET"][]{0,2}[lemma = "arriv.*"] within s</span>
          <span class="help-ex-desc">Wildcard + quantifieur + contrainte de phrase</span>
          <button class="help-ex-copy" data-q='[pos = "DET"][]{0,2}[lemma = "arriv.*"] within s'>Copier</button>
        </div>
        <div class="help-passthrough-note" style="margin-top:4px">
          Attributs supportés : <code>word</code>, <code>lemma</code>, <code>pos</code>/<code>upos</code>. Quantifieurs : <code>{m}</code>, <code>{m,n}</code>.
        </div>
      </div>
      <div class="help-section">
        <div class="help-section-title">Guardrails FTS</div>
        <div class="help-passthrough-note">
          <strong>Mode pass-through :</strong> si votre requête contient déjà <code>AND</code>, <code>OR</code>, <code>NOT</code>, <code>NEAR</code> ou des guillemets, le builder ne la transforme pas — elle est envoyée telle quelle au moteur FTS5.
        </div>
        <div class="help-passthrough-note" style="margin-top:4px">
          <strong>NEAR :</strong> requiert au moins 2 mots. Avec 1 seul mot, la requête est passée sans transformation.
        </div>
        <div class="help-passthrough-note" style="margin-top:4px">
          <strong>Guillemets internes :</strong> en mode "Expression exacte", les guillemets internes sont automatiquement convertis en apostrophes pour éviter les erreurs FTS5.
        </div>
      </div>
    </div>
  `;
  helpWrap.appendChild(helpBtn);
  helpWrap.appendChild(helpPopover);
  const importBtn = elt("button", { class: "btn btn-ghost", id: "import-btn" }, "⬆ Importer…");
  const reindexBtn = elt("button", { class: "btn btn-ghost", id: "reindex-btn", title: "Reconstruire l'index FTS5 (à faire après import ou modification du corpus)" }, "⟳ Réindexer");
  const openDbBtn = elt("button", { class: "btn btn-ghost", id: "open-db-btn" }, "📂 Ouvrir DB…");
  const resetBtn = elt("button", { class: "btn btn-ghost", id: "reset-btn", title: "Effacer la recherche et tous les filtres" }, "✕ Réinitialiser");

  // History dropdown
  const histWrap = elt("div", { class: "hist-wrap" });
  const histBtn = elt("button", { class: "btn btn-ghost", id: "hist-btn", title: "Historique des recherches" }, "\uD83D\uDD52 Hist.");
  const histPanel = elt("div", { class: "hist-panel", id: "hist-panel" });
  histWrap.appendChild(histBtn);
  histWrap.appendChild(histPanel);

  // Export dropdown
  const exportWrap = elt("div", { class: "export-wrap" });
  const exportBtn = elt("button", { class: "btn btn-ghost", id: "export-btn", title: "Exporter les résultats chargés" }, "\u2B07 Export");
  const exportMenu = elt("div", { class: "export-menu", id: "export-menu" });
  const exportJsonlSimpleBtn  = elt("button", { class: "export-menu-item" }, "JSONL — simple");
  const exportJsonlParallelBtn = elt("button", { class: "export-menu-item" }, "JSONL — parallèle (pivot+aligned)");
  const exportCsvFlatBtn = elt("button", { class: "export-menu-item" }, "CSV — plat (N colonnes aligned)");
  const exportCsvLongBtn = elt("button", { class: "export-menu-item" }, "CSV — long (1 ligne/aligned) \u2605");
  const exportCsvFamilyBtn = elt("button", { class: "export-menu-item export-menu-item--family", id: "export-csv-family-btn", title: "CSV avec une colonne par document de la famille" }, "CSV — famille (colonnes par langue) \uD83D\uDCC1");
  exportMenu.appendChild(exportJsonlSimpleBtn);
  exportMenu.appendChild(exportJsonlParallelBtn);
  exportMenu.appendChild(exportCsvFlatBtn);
  exportMenu.appendChild(exportCsvLongBtn);
  exportMenu.appendChild(exportCsvFamilyBtn);
  exportWrap.appendChild(exportBtn);
  exportWrap.appendChild(exportMenu);

  toolbar.appendChild(filterBtn);
  toolbar.appendChild(builderBtn);
  toolbar.appendChild(statsBtn);
  toolbar.appendChild(helpWrap);
  toolbar.appendChild(importBtn);
  toolbar.appendChild(reindexBtn);
  toolbar.appendChild(openDbBtn);
  toolbar.appendChild(resetBtn);
  toolbar.appendChild(histWrap);
  toolbar.appendChild(exportWrap);

  // ── Filter drawer ──
  const filterDrawer = elt("div", { class: "filter-drawer hidden", id: "filter-drawer" });

  // Language multi-select (popover with checkboxes)
  const fg1 = elt("div", { class: "filter-group filter-group--lang" });
  const langBtn = elt("button", { class: "filter-lang-btn", id: "filter-lang-btn", type: "button" }, "Langue ▾") as HTMLButtonElement;
  const langDropdown = elt("div", { class: "filter-lang-dropdown hidden", id: "filter-lang-dropdown" });
  const langCheckboxContainer = elt("div", { class: "filter-lang-checkboxes", id: "filter-lang-checkboxes" });
  langDropdown.appendChild(langCheckboxContainer);
  langBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    langDropdown.classList.toggle("hidden");
  });
  document.addEventListener("click", (e) => {
    if (!fg1.contains(e.target as Node)) langDropdown.classList.add("hidden");
  }, { capture: false });
  fg1.appendChild(langBtn);
  fg1.appendChild(langDropdown);

  const fg2 = elt("div", { class: "filter-group" });
  fg2.appendChild(elt("label", {}, "Rôle"));
  const roleSel = elt("select", { class: "filter-select", id: "filter-role-sel" }) as HTMLSelectElement;
  roleSel.innerHTML = `<option value="">Tous</option>`;
  fg2.appendChild(roleSel);

  const fg2b = elt("div", { class: "filter-group" });
  fg2b.appendChild(elt("label", {}, "Type ressource"));
  const restypeSel = elt("select", { class: "filter-select", id: "filter-restype-sel" }) as HTMLSelectElement;
  restypeSel.innerHTML = `<option value="">Tous</option>`;
  fg2b.appendChild(restypeSel);

  const docSelectorMount = elt("div", { id: "doc-selector-mount", class: "doc-sel-mount" });

  const fgFam = elt("div", { class: "filter-group filter-group--family" });
  fgFam.appendChild(elt("label", { class: "filter-family-label" }, "📁 Famille"));
  const familySel = elt("select", { class: "filter-select", id: "filter-family-sel" }) as HTMLSelectElement;
  familySel.innerHTML = `<option value="">Toutes les familles</option>`;
  fgFam.appendChild(familySel);
  const pivotOnlyWrap = elt("div", { class: "filter-family-pivot" });
  const pivotOnlyCb = elt("input", { type: "checkbox", id: "filter-family-pivot-only" }) as HTMLInputElement;
  pivotOnlyWrap.appendChild(pivotOnlyCb);
  pivotOnlyWrap.appendChild(elt("label", { for: "filter-family-pivot-only", class: "filter-pivot-label" }, "Original uniquement"));
  fgFam.appendChild(pivotOnlyWrap);

  // ── Extended filters (author, title, date, source extension) ──
  const fgAuthor = elt("div", { class: "filter-group" });
  fgAuthor.appendChild(elt("label", {}, "Auteur"));
  const authorInput = elt("input", {
    type: "text", class: "filter-input-text", id: "filter-author",
    placeholder: "nom ou prénom…", title: "Filtre sur nom ou prénom d'auteur",
  }) as HTMLInputElement;
  fgAuthor.appendChild(authorInput);

  const fgTitle = elt("div", { class: "filter-group" });
  fgTitle.appendChild(elt("label", {}, "Titre"));
  const titleSearchInput = elt("input", {
    type: "text", class: "filter-input-text", id: "filter-title-search",
    placeholder: "mots dans le titre…",
  }) as HTMLInputElement;
  fgTitle.appendChild(titleSearchInput);

  const fgDate = elt("div", { class: "filter-group filter-group--date" });
  fgDate.appendChild(elt("label", {}, "Date"));
  const dateFromInput = elt("input", {
    type: "text", class: "filter-input-text filter-input-date", id: "filter-date-from",
    placeholder: "de (ex. 1800)", title: "Date de début (comparaison de chaînes)",
  }) as HTMLInputElement;
  fgDate.appendChild(dateFromInput);
  fgDate.appendChild(elt("span", { class: "filter-date-sep" }, "–"));
  const dateToInput = elt("input", {
    type: "text", class: "filter-input-text filter-input-date", id: "filter-date-to",
    placeholder: "à (ex. 1900)",
  }) as HTMLInputElement;
  fgDate.appendChild(dateToInput);

  const fgExt = elt("div", { class: "filter-group" });
  fgExt.appendChild(elt("label", {}, "Format"));
  const sourceExtSel = elt("select", { class: "filter-select", id: "filter-source-ext" }) as HTMLSelectElement;
  sourceExtSel.innerHTML = `
    <option value="">Tous</option>
    <option value=".docx">DOCX</option>
    <option value=".odt">ODT</option>
    <option value=".txt">TXT</option>
    <option value=".tei">TEI/XML</option>
    <option value=".xml">XML</option>
  `;
  fgExt.appendChild(sourceExtSel);

  const fgFederated = elt("div", { class: "filter-group", style: "align-items:flex-start;min-width:260px;max-width:420px" });
  fgFederated.appendChild(elt("label", { style: "padding-top:4px" }, "Fédération DB"));
  const federatedCol = elt("div", { style: "display:flex;flex-direction:column;gap:4px;min-width:220px;width:100%" });
  const federatedDbInput = elt("textarea", {
    id: "filter-federated-dbs",
    class: "filter-input-text",
    placeholder: "/abs/path/a.db\\n/abs/path/b.db",
    rows: "3",
    style: "min-width:220px;max-width:380px;width:100%;resize:vertical;line-height:1.3",
    title: "Une base par ligne. La DB courante est toujours incluse automatiquement.",
  }) as HTMLTextAreaElement;
  const federatedActions = elt("div", { style: "display:flex;align-items:center;gap:6px" });
  const federatedBrowseBtn = elt(
    "button",
    { class: "btn btn-secondary", type: "button", style: "padding:3px 8px;font-size:12px" },
    "Ajouter DB…",
  ) as HTMLButtonElement;
  federatedActions.appendChild(federatedBrowseBtn);
  federatedActions.appendChild(elt("span", { style: "font-size:11px;color:var(--text-muted)" }, "DB courante incluse automatiquement"));
  federatedCol.appendChild(federatedDbInput);
  federatedCol.appendChild(federatedActions);
  fgFederated.appendChild(federatedCol);

  const clearBtn = elt("span", { class: "filter-clear", id: "filter-clear" }, "Effacer tout");
  filterDrawer.appendChild(fg1);
  filterDrawer.appendChild(fg2);
  filterDrawer.appendChild(fg2b);
  filterDrawer.appendChild(fgFam);
  filterDrawer.appendChild(fgAuthor);
  filterDrawer.appendChild(fgTitle);
  filterDrawer.appendChild(fgDate);
  filterDrawer.appendChild(fgExt);
  filterDrawer.appendChild(fgFederated);
  filterDrawer.appendChild(docSelectorMount);
  filterDrawer.appendChild(clearBtn);

  // ── Query builder panel ──
  const builderPanel = elt("div", { class: "builder-panel hidden", id: "builder-panel" });

  const modeGrp = elt("div", { class: "builder-group" });
  modeGrp.appendChild(elt("label", {}, "Mode :"));
  const radioWrap = elt("div", { class: "builder-radio" });
  for (const [val, lbl] of [
    ["simple", "Simple"],
    ["phrase", "Expression exacte"],
    ["and", "ET (AND)"],
    ["or", "OU (OR)"],
    ["near", "NEAR"],
    ["regex", "Regex"],
    ["cql", "CQL"],
  ] as const) {
    const lbEl = document.createElement("label");
    const inp = elt("input", { type: "radio", name: "builder-mode", value: val }) as HTMLInputElement;
    if (val === "simple") inp.checked = true;
    inp.addEventListener("change", () => {
      state.builderMode = val;
      (document.getElementById("near-n-ctrl") as HTMLElement).style.display = val === "near" ? "flex" : "none";
      (document.getElementById("regex-info") as HTMLElement).style.display = val === "regex" ? "block" : "none";
      (document.getElementById("cql-info") as HTMLElement).style.display = val === "cql" ? "block" : "none";
      const si = document.getElementById("search-input") as HTMLInputElement | null;
      if (si) {
        if (val === "regex") {
          si.placeholder = "Expression régulière Python (ex : \\blib(é|e)r\\w+)…";
        } else if (val === "cql") {
          si.placeholder = 'Requête CQL (ex : [pos = "DET"][lemma = "liv.*" %c])…';
        } else {
          si.placeholder = "Rechercher dans le corpus (FTS5)…";
        }
      }
    });
    lbEl.appendChild(inp);
    lbEl.appendChild(document.createTextNode(lbl));
    radioWrap.appendChild(lbEl);
  }
  modeGrp.appendChild(radioWrap);
  builderPanel.appendChild(modeGrp);

  const regexInfo = elt("div", {
    id: "regex-info",
    class: "regex-info-note",
    style: "display:none",
  });
  regexInfo.innerHTML = `<strong>Mode Regex</strong> — Balayage complet de la table (plus lent que FTS sur de très grands corpus). Syntaxe Python : <code>\\b</code>, <code>(?i)</code>, groupes, classes, etc. La casse est ignorée par défaut (comme FTS).`;
  builderPanel.appendChild(regexInfo);

  const cqlInfo = elt("div", {
    id: "cql-info",
    class: "regex-info-note",
    style: "display:none",
  });
  cqlInfo.innerHTML = `<strong>Mode CQL</strong> — Requête token-level via <code>/token_query</code>. Syntaxe avancée: séquences <code>[...][...]</code>, wildcard <code>[]</code>, quantifieurs <code>{m,n}</code>, suffixe <code>within s</code>.`;
  builderPanel.appendChild(cqlInfo);

  const nearCtrl = elt("div", { class: "near-n-ctrl", id: "near-n-ctrl", style: "display:none" });
  nearCtrl.appendChild(document.createTextNode("N ="));
  const nearInput = elt("input", { type: "number", min: "1", max: "50", value: "5", id: "near-n-input" }) as HTMLInputElement;
  nearInput.addEventListener("input", () => {
    state.nearN = Math.max(1, parseInt(nearInput.value, 10) || 5);
  });
  nearCtrl.appendChild(nearInput);
  builderPanel.appendChild(nearCtrl);

  const builderWarn = elt("div", { id: "builder-warn", class: "builder-warn", style: "display:none" });
  builderPanel.appendChild(builderWarn);

  // ── Results area ──
  const resultsArea = elt("div", { class: "results-area", id: "results-area" });
  const empty = elt("div", { class: "empty-state" });
  empty.innerHTML = `<div class="icon">⏳</div><h3>Démarrage…</h3><p>Connexion au sidecar en cours.</p>`;
  resultsArea.appendChild(empty);

  // ── Status bar ──
  const statusbar = elt("div", { class: "statusbar" });
  statusbar.appendChild(elt("span", { id: "statusbar-msg" }, "Initialisation…"));
  statusbar.appendChild(elt("span", { id: "status-msg" }, "idle"));

  // ── Import modal ──
  const importModal = elt("div", { class: "modal-overlay hidden", id: "import-modal" });
  const modal = elt("div", { class: "modal" });
  modal.appendChild(elt("h2", {}, "Importer un document"));
  const modalBody = elt("div", { class: "modal-body" });

  const pathGroup = elt("div", { class: "form-group" });
  pathGroup.appendChild(elt("label", {}, "Fichier source"));
  const pathRow = elt("div", { style: "display:flex;gap:8px" });
  const pathInput = elt("input", { type: "text", class: "form-input", id: "import-path-input", placeholder: "/chemin/vers/fichier.docx", style: "flex:1" }) as HTMLInputElement;
  const browseBtn = elt("button", { class: "btn btn-secondary", id: "import-browse-btn" }, "Parcourir…");
  pathRow.appendChild(pathInput);
  pathRow.appendChild(browseBtn);
  pathGroup.appendChild(pathRow);
  modalBody.appendChild(pathGroup);

  const modeGroup2 = elt("div", { class: "form-group" });
  modeGroup2.appendChild(elt("label", {}, "Mode d'import"));
  const modeSelect = elt("select", { class: "form-select", id: "import-mode-select" }) as HTMLSelectElement;
  for (const [val, lbl] of [
    ["docx_numbered_lines", "DOCX lignes numérotées [n]"],
    ["docx_paragraphs", "DOCX paragraphes"],
    ["odt_numbered_lines", "ODT lignes numérotées [n]"],
    ["odt_paragraphs", "ODT paragraphes"],
    ["txt_numbered_lines", "TXT lignes numérotées"],
    ["tei", "TEI XML"],
  ]) {
    modeSelect.appendChild(elt("option", { value: val }, lbl));
  }
  modeGroup2.appendChild(modeSelect);
  modalBody.appendChild(modeGroup2);

  const langGroup = elt("div", { class: "form-group" });
  langGroup.appendChild(elt("label", {}, "Langue (code ISO)"));
  langGroup.appendChild(elt("input", { type: "text", class: "form-input", id: "import-lang-input", placeholder: "fr" }));
  modalBody.appendChild(langGroup);

  const titleGroup = elt("div", { class: "form-group" });
  titleGroup.appendChild(elt("label", {}, "Titre (optionnel)"));
  titleGroup.appendChild(elt("input", { type: "text", class: "form-input", id: "import-title-input", placeholder: "Mon corpus" }));
  modalBody.appendChild(titleGroup);

  const roleGroup = elt("div", { class: "form-group" });
  roleGroup.appendChild(elt("label", {}, "Rôle du document (optionnel)"));
  const roleSelect = elt("select", { class: "form-select", id: "import-role-select" }) as HTMLSelectElement;
  for (const [val, lbl] of [
    ["", "— non défini —"],
    ["source", "Source"],
    ["traduction", "Traduction"],
    ["référence", "Référence"],
    ["autre", "Autre"],
  ] as const) {
    roleSelect.appendChild(elt("option", { value: val }, lbl));
  }
  roleGroup.appendChild(roleSelect);
  modalBody.appendChild(roleGroup);

  const resTypeGroup = elt("div", { class: "form-group" });
  resTypeGroup.appendChild(elt("label", {}, "Type de ressource (optionnel)"));
  const resTypeSelect = elt("select", { class: "form-select", id: "import-restype-select" }) as HTMLSelectElement;
  for (const [val, lbl] of [
    ["", "— non défini —"],
    ["corpus", "Corpus"],
    ["glossaire", "Glossaire"],
    ["mémoire", "Mémoire de traduction"],
    ["autre", "Autre"],
  ] as const) {
    resTypeSelect.appendChild(elt("option", { value: val }, lbl));
  }
  resTypeGroup.appendChild(resTypeSelect);
  modalBody.appendChild(resTypeGroup);

  const modalError = elt("div", { id: "import-modal-error" });
  modalBody.appendChild(modalError);
  modal.appendChild(modalBody);

  const modalActions = elt("div", { class: "modal-actions" });
  const cancelBtn = elt("button", { class: "btn btn-secondary", id: "import-cancel-btn" }, "Annuler");
  const confirmBtn = elt("button", { class: "btn btn-primary", id: "import-confirm-btn" }, "Importer");
  modalActions.appendChild(cancelBtn);
  modalActions.appendChild(confirmBtn);
  modal.appendChild(modalActions);
  importModal.appendChild(modal);

  // ── Metadata side panel ──
  const metaBackdrop = elt("div", { class: "meta-backdrop", id: "meta-backdrop" });
  const metaPanel = elt("div", { class: "meta-panel", id: "meta-panel" });
  const metaPanelHead = elt("div", { class: "meta-panel-head" });
  metaPanelHead.appendChild(elt("h4", {}, "Métadonnées"));
  const metaCloseX = elt("button", { class: "btn btn-secondary", style: "padding:2px 8px;font-size:12px", type: "button" }, "✕") as HTMLButtonElement;
  metaPanelHead.appendChild(metaCloseX);
  metaPanel.appendChild(metaPanelHead);
  metaPanel.appendChild(elt("div", { class: "meta-body", id: "meta-body" }));
  metaPanel.appendChild(elt("div", { class: "meta-foot", id: "meta-foot" }));

  // ── FTS preview bar ──
  const ftsPreviewBar = elt("div", { class: "fts-preview-bar", id: "fts-preview-bar", style: "display:none" });
  ftsPreviewBar.appendChild(elt("span", { class: "fts-preview-label" }, "FTS\u00a0:"));
  ftsPreviewBar.appendChild(elt("code", { class: "fts-preview-code", id: "fts-preview-code" }));

  // ── Chips bar ──
  const chipsBar = elt("div", { class: "chips-bar", id: "chips-bar", style: "display:none" });

  // ── Stats panel ──
  const statsPanel = buildStatsPanel();

  // ── Assemble ──
  container.appendChild(topbar);
  container.appendChild(toolbar);
  container.appendChild(ftsPreviewBar);
  container.appendChild(filterDrawer);
  container.appendChild(chipsBar);
  container.appendChild(builderPanel);
  container.appendChild(statsPanel);
  container.appendChild(resultsArea);
  container.appendChild(statusbar);
  container.appendChild(importModal);
  container.appendChild(metaBackdrop);
  container.appendChild(metaPanel);

  // ── Event listeners ──────────────────────────────────────────────────────────

  const refreshAlignedToggle = (): void => {
    alignedToggleBtn.textContent = state.showAligned ? "Alignés: on" : "Alignés: off";
    alignedToggleBtn.classList.toggle("active", state.showAligned);
  };
  refreshAlignedToggle();

  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const raw = searchInput.value;
      const built = (state.builderMode === "regex" || state.builderMode === "cql")
        ? raw.trim()
        : buildFtsQuery(raw);
      saveToHistory(raw, built);
      void doSearch(raw);
    }
  });
  searchInput.addEventListener("input", () => updateFtsPreview(searchInput.value));
  searchBtn.addEventListener("click", () => {
    const raw = searchInput.value;
    const built = (state.builderMode === "regex" || state.builderMode === "cql")
      ? raw.trim()
      : buildFtsQuery(raw);
    saveToHistory(raw, built);
    void doSearch(raw);
  });

  segBtn.addEventListener("click", () => {
    if (state.mode === "segment") return;
    state.mode = "segment";
    segBtn.classList.add("active");
    kwicBtn.classList.remove("active");
    (document.getElementById("window-ctrl") as HTMLElement).style.display = "none";
    if (state.currentQuery || state.regexPattern) void doSearch(state.currentQuery || state.regexPattern);
  });
  kwicBtn.addEventListener("click", () => {
    if (state.mode === "kwic") return;
    state.mode = "kwic";
    kwicBtn.classList.add("active");
    segBtn.classList.remove("active");
    (document.getElementById("window-ctrl") as HTMLElement).style.display = "flex";
    if (state.currentQuery || state.regexPattern) void doSearch(state.currentQuery || state.regexPattern);
  });

  rangeInput.addEventListener("input", () => {
    state.window = parseInt(rangeInput.value, 10);
    windowValue.textContent = rangeInput.value;
  });

  const refreshParallelToggle = (): void => {
    parallelToggleBtn.textContent = state.showParallel ? "Parallèle: on" : "Parallèle: off";
    parallelToggleBtn.classList.toggle("active", state.showParallel);
    parallelToggleBtn.style.display = state.showAligned ? "" : "none";
  };
  refreshParallelToggle();

  const refreshSourceChangedToggle = (): void => {
    sourceChangedBtn.classList.toggle("active", state.filterSourceChanged);
    sourceChangedBtn.style.display = state.showAligned ? "" : "none";
    // Apply/remove CSS class on results-area for the post-filter
    document.getElementById("results-area")?.classList.toggle("filter-source-changed", state.filterSourceChanged);
  };
  refreshSourceChangedToggle();

  sourceChangedBtn.addEventListener("click", () => {
    state.filterSourceChanged = !state.filterSourceChanged;
    refreshSourceChangedToggle();
  });

  alignedToggleBtn.addEventListener("click", () => {
    state.showAligned = !state.showAligned;
    if (!state.showAligned) {
      state.expandedAlignedUnitIds.clear();
      state.showParallel = false;
      state.filterSourceChanged = false;
    }
    refreshAlignedToggle();
    refreshParallelToggle();
    refreshSourceChangedToggle();
    const q = searchInput.value.trim();
    if (q) {
      void doSearch(q);
    } else {
      renderResults();
    }
  });

  parallelToggleBtn.addEventListener("click", () => {
    state.showParallel = !state.showParallel;
    refreshParallelToggle();
    renderResults();
  });

  caseSensBtn.addEventListener("click", () => {
    state.caseSensitive = !state.caseSensitive;
    caseSensBtn.classList.toggle("active", state.caseSensitive);
    caseSensBtn.title = state.caseSensitive
      ? "Casse respectée — cliquer pour désactiver"
      : "Respecter la casse (post-filtre sur text_raw)";
    if (state.currentQuery) void doSearch(state.currentQuery);
  });

  filterBtn.addEventListener("click", () => {
    state.showFilters = !state.showFilters;
    filterDrawer.classList.toggle("hidden", !state.showFilters);
    filterBtn.classList.toggle("active", state.showFilters);
  });

  builderBtn.addEventListener("click", () => {
    state.showBuilder = !state.showBuilder;
    builderPanel.classList.toggle("hidden", !state.showBuilder);
    builderBtn.classList.toggle("active", state.showBuilder);
  });

  statsBtn.addEventListener("click", () => toggleStatsPanel());

  // lang checkboxes are wired in populateLangCheckboxes (called after docs load)
  roleSel.addEventListener("change", () => { state.filterRole = roleSel.value; renderChips(); });
  restypeSel.addEventListener("change", () => { state.filterResourceType = restypeSel.value; renderChips(); });

  const applyTextFilter = (key: "filterAuthor" | "filterTitleSearch" | "filterDateFrom" | "filterDateTo", val: string) => {
    state[key] = val;
    renderChips();
  };
  authorInput.addEventListener("input", () => applyTextFilter("filterAuthor", authorInput.value.trim()));
  titleSearchInput.addEventListener("input", () => applyTextFilter("filterTitleSearch", titleSearchInput.value.trim()));
  dateFromInput.addEventListener("input", () => applyTextFilter("filterDateFrom", dateFromInput.value.trim()));
  dateToInput.addEventListener("input", () => applyTextFilter("filterDateTo", dateToInput.value.trim()));
  sourceExtSel.addEventListener("change", () => { state.filterSourceExt = sourceExtSel.value; renderChips(); });
  const _parseFederatedDbPaths = (raw: string): string[] =>
    Array.from(new Set(raw.split(/\r?\n/).map((p) => p.trim()).filter((p) => p.length > 0)));
  const _syncFederatedDbPaths = (): void => {
    state.filterFederatedDbPaths = _parseFederatedDbPaths(federatedDbInput.value);
    renderChips();
  };
  federatedDbInput.addEventListener("input", _syncFederatedDbPaths);
  federatedBrowseBtn.addEventListener("click", async () => {
    const sel = await openDialog({
      title: "Ajouter des bases fédérées",
      filters: [{ name: "SQLite DB", extensions: ["db"] }],
      multiple: true,
    });
    if (!sel) return;
    const picked = Array.isArray(sel) ? sel : [sel];
    if (picked.length === 0) return;
    const merged = Array.from(
      new Set([..._parseFederatedDbPaths(federatedDbInput.value), ...picked.map((p) => p.trim())]),
    );
    federatedDbInput.value = merged.join("\n");
    _syncFederatedDbPaths();
  });

  familySel.addEventListener("change", () => {
    const val = familySel.value;
    state.filterFamilyId = val ? parseInt(val, 10) : null;
    // When a family is selected, auto-enable "aligned" toggle for cross-family view
    if (state.filterFamilyId !== null && !state.showAligned) {
      state.showAligned = true;
      refreshAlignedToggle();
      refreshParallelToggle();
    }
    renderChips();
    if (state.currentQuery) void doSearch(state.currentQuery);
  });

  pivotOnlyCb.addEventListener("change", () => {
    state.filterFamilyPivotOnly = pivotOnlyCb.checked;
    renderChips();
    if (state.currentQuery && state.filterFamilyId !== null) void doSearch(state.currentQuery);
  });

  // Load families when filter drawer opens (lazy)
  let familiesLoaded = false;
  filterBtn.addEventListener("click", () => {
    if (!familiesLoaded && state.conn) {
      familiesLoaded = true;
      void loadFamiliesForFilter();
    }
  });

  document.getElementById("filter-clear")!.addEventListener("click", () => {
    state.filterLangs = [];
    state.filterRole = "";
    state.filterResourceType = "";
    state.filterFamilyId = null;
    state.filterFamilyPivotOnly = false;
    state.filterAuthor = "";
    state.filterTitleSearch = "";
    state.filterDateFrom = "";
    state.filterDateTo = "";
    state.filterSourceExt = "";
    state.filterFederatedDbPaths = [];
    // Uncheck all lang checkboxes and reset button label
    document.querySelectorAll<HTMLInputElement>("#filter-lang-checkboxes input[type=checkbox]").forEach(cb => { cb.checked = false; });
    const langBtnEl = document.getElementById("filter-lang-btn");
    if (langBtnEl) { langBtnEl.textContent = "Langue ▾"; langBtnEl.classList.remove("active"); }
    roleSel.value = "";
    restypeSel.value = "";
    familySel.value = "";
    pivotOnlyCb.checked = false;
    authorInput.value = "";
    titleSearchInput.value = "";
    dateFromInput.value = "";
    dateToInput.value = "";
    sourceExtSel.value = "";
    federatedDbInput.value = "";
    clearDocSelector(state.dbPath ?? "");
    renderChips();
  });

  // ── History ──────────────────────────────────────────────────────────────────
  const closeAllPanels = (): void => {
    histPanel.classList.remove("open");
    exportMenu.classList.remove("open");
    helpPopover.classList.remove("open");
  };

  histBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    exportMenu.classList.remove("open");
    helpPopover.classList.remove("open");
    histPanel.classList.toggle("open");
    if (histPanel.classList.contains("open")) renderHistPanel(histPanel, searchInput);
  });

  // ── Help popover ──────────────────────────────────────────────────────────────
  helpBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    histPanel.classList.remove("open");
    exportMenu.classList.remove("open");
    helpPopover.classList.toggle("open");
  });

  helpPopover.querySelector("#help-close-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    helpPopover.classList.remove("open");
  });

  helpPopover.querySelectorAll<HTMLButtonElement>(".help-ex-copy").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const q = btn.getAttribute("data-q") ?? "";
      searchInput.value = q;
      updateFtsPreview(q);
      helpPopover.classList.remove("open");
      searchInput.focus();
    });
  });

  document.addEventListener("click", closeAllPanels);

  // ── Export ───────────────────────────────────────────────────────────────────
  exportBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    histPanel.classList.remove("open");
    exportMenu.classList.toggle("open");
  });

  exportJsonlSimpleBtn.addEventListener("click", () => {
    exportMenu.classList.remove("open"); void exportHits("jsonl-simple");
  });
  exportJsonlParallelBtn.addEventListener("click", () => {
    exportMenu.classList.remove("open"); void exportHits("jsonl-parallel");
  });
  exportCsvFlatBtn.addEventListener("click", () => {
    exportMenu.classList.remove("open"); void exportHits("csv-flat");
  });
  exportCsvLongBtn.addEventListener("click", () => {
    exportMenu.classList.remove("open"); void exportHits("csv-long");
  });
  exportCsvFamilyBtn.addEventListener("click", () => {
    exportMenu.classList.remove("open"); void exportHits("csv-family");
  });

  // ── Reset ────────────────────────────────────────────────────────────────────
  resetBtn.addEventListener("click", () => {
    searchInput.value = "";
    state.currentQuery = "";
    state.hits = [];
    state.total = null;
    state.hasMore = false;
    state.loadingMore = false;
    state.nextOffset = null;
    state.expandedAlignedUnitIds.clear();
    state.filterLangs = [];
    state.filterRole = "";
    state.filterResourceType = "";
    state.filterFamilyId = null;
    state.filterFamilyPivotOnly = false;
    state.filterAuthor = "";
    state.filterTitleSearch = "";
    state.filterDateFrom = "";
    state.filterDateTo = "";
    state.filterSourceExt = "";
    state.filterFederatedDbPaths = [];
    document.querySelectorAll<HTMLInputElement>("#filter-lang-checkboxes input[type=checkbox]").forEach(cb => { cb.checked = false; });
    const langBtnReset = document.getElementById("filter-lang-btn");
    if (langBtnReset) { langBtnReset.textContent = "Langue ▾"; langBtnReset.classList.remove("active"); }
    roleSel.value = "";
    restypeSel.value = "";
    familySel.value = "";
    pivotOnlyCb.checked = false;
    authorInput.value = "";
    titleSearchInput.value = "";
    dateFromInput.value = "";
    dateToInput.value = "";
    sourceExtSel.value = "";
    federatedDbInput.value = "";
    clearDocSelector(state.dbPath ?? "");
    state.builderMode = "simple";
    const simpleRadio = document.querySelector<HTMLInputElement>("input[name='builder-mode'][value='simple']");
    if (simpleRadio) simpleRadio.checked = true;
    (document.getElementById("near-n-ctrl") as HTMLElement | null)?.style.setProperty("display", "none");
    (document.getElementById("regex-info") as HTMLElement | null)?.style.setProperty("display", "none");
    (document.getElementById("cql-info") as HTMLElement | null)?.style.setProperty("display", "none");
    searchInput.placeholder = "Rechercher dans le corpus (FTS5)…";
    updateFtsPreview("");
    // Close all open panels/menus
    closeMetaPanel();
    state.showFilters = false;
    filterDrawer.classList.add("hidden");
    filterBtn.classList.remove("active");
    histPanel.classList.remove("open");
    exportMenu.classList.remove("open");
    renderChips();
    renderResults();
  });

  // ── Import ───────────────────────────────────────────────────────────────────
  importBtn.addEventListener("click", () => {
    if (state.status !== "ready") {
      const msg = state.status === "starting"
        ? "Sidecar en cours de démarrage — veuillez patienter."
        : "Sidecar non prêt — ouvrez une base de données pour commencer.";
      showToast(msg);
      return;
    }
    showImportModal();
  });
  reindexBtn.addEventListener("click", async () => {
    if (!state.conn) { showToast("Ouvrez une base de données avant de réindexer."); return; }
    reindexBtn.disabled = true;
    reindexBtn.textContent = "⏳ Réindexation…";
    try {
      const { rebuildIndex } = await import("../lib/sidecarClient");
      const res = await rebuildIndex(state.conn);
      showToast(`✓ Index reconstruit (${res.units_indexed} segment(s))`);
      // Relance la recherche en cours pour refléter le nouvel index
      if (state.currentQuery) void doSearch(state.currentQuery);
    } catch (e) {
      showToast(`✗ Erreur réindexation : ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      reindexBtn.disabled = false;
      reindexBtn.textContent = "⟳ Réindexer";
    }
  });
  openDbBtn.addEventListener("click", () => void doOpenDb());

  cancelBtn.addEventListener("click", hideImportModal);
  importModal.addEventListener("click", (e) => {
    if (e.target === importModal) hideImportModal();
  });

  browseBtn.addEventListener("click", async () => {
    const sel = await openDialog({
      title: "Choisir un fichier à importer",
      filters: [
        { name: "DOCX / ODT / TXT / TEI", extensions: ["docx", "odt", "txt", "xml"] },
        { name: "Tous les fichiers", extensions: ["*"] },
      ],
      multiple: false,
    });
    if (sel && !Array.isArray(sel)) {
      (document.getElementById("import-path-input") as HTMLInputElement).value = sel;
    }
  });

  metaCloseX.addEventListener("click", closeMetaPanel);
  metaBackdrop.addEventListener("click", closeMetaPanel);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMetaPanel();
  });

  confirmBtn.addEventListener("click", () => {
    const filePath = (document.getElementById("import-path-input") as HTMLInputElement).value.trim();
    const mode = (document.getElementById("import-mode-select") as HTMLSelectElement).value;
    const lang = (document.getElementById("import-lang-input") as HTMLInputElement).value.trim();
    const title = (document.getElementById("import-title-input") as HTMLInputElement).value.trim();
    const docRole = (document.getElementById("import-role-select") as HTMLSelectElement).value;
    const resourceType = (document.getElementById("import-restype-select") as HTMLSelectElement).value;
    if (!filePath) {
      document.getElementById("import-modal-error")!.innerHTML =
        `<p style="color:var(--danger);font-size:13px;margin:0;">Veuillez sélectionner un fichier.</p>`;
      return;
    }
    document.getElementById("import-modal-error")!.innerHTML = "";
    void doImport(filePath, mode, lang, title, docRole, resourceType);
  });
}
