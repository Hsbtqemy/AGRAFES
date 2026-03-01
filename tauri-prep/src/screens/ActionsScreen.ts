/**
 * ActionsScreen — curate / segment / align with V0.3 extensions:
 *   - Curation Preview Diff (preset selector + before/after diff table)
 *   - Align Audit UI (paginated link table after alignment run)
 */

import type {
  Conn,
  DocumentRecord,
  CurateRule,
  CuratePreviewExample,
  AlignLinkRecord,
  AlignBatchAction,
  AlignDebugPayload,
  AlignQualityResponse,
  RetargetCandidate,
  CollisionGroup,
} from "../lib/sidecarClient.ts";
import {
  listDocuments,
  curate,
  curatePreview,
  segment,
  align,
  alignAudit,
  alignQuality,
  updateAlignLinkStatus,
  deleteAlignLink,
  retargetAlignLink,
  batchUpdateAlignLinks,
  retargetCandidates,
  listCollisions,
  resolveCollisions,
  validateMeta,
  rebuildIndex,
  enqueueJob,
  SidecarError,
} from "../lib/sidecarClient.ts";
import type { JobCenter } from "../components/JobCenter.ts";

// ─── Curation presets ─────────────────────────────────────────────────────────

const CURATE_PRESETS: Record<string, { label: string; rules: CurateRule[] }> = {
  spaces: {
    label: "Espaces",
    rules: [
      { pattern: "\\u00A0", replacement: " ", description: "Non-breaking space → espace" },
      { pattern: "[ \\t]{2,}", replacement: " ", flags: "g", description: "Espaces multiples → un seul" },
      { pattern: "^\\s+|\\s+$", replacement: "", flags: "gm", description: "Trim lignes" },
    ],
  },
  quotes: {
    label: "Apostrophes et guillemets",
    rules: [
      { pattern: "[\u2018\u2019\u02BC]", replacement: "'", description: "Apostrophes courbes → droites" },
      { pattern: "[\u201C\u201D]", replacement: '"', description: "Guillemets anglais → droits" },
      { pattern: "\u00AB\\s*", replacement: "\u00AB\u00A0", description: "Guillemet ouvrant + espace insécable" },
      { pattern: "\\s*\u00BB", replacement: "\u00A0\u00BB", description: "Espace insécable + guillemet fermant" },
    ],
  },
  punctuation: {
    label: "Ponctuation",
    rules: [
      { pattern: "\\s+([,;:!?])", replacement: "$1", description: "Supprimer espace avant ponctuation" },
      { pattern: "([.!?])([A-ZÀ-Ÿ])", replacement: "$1 $2", description: "Espace après ponctuation terminale" },
      { pattern: "\\.{4,}", replacement: "…", description: "Points de suspension multiples → …" },
    ],
  },
  custom: {
    label: "Règles personnalisées",
    rules: [],
  },
};

interface AlignExplainabilityEntry {
  target_doc_id: number;
  links_created: number;
  links_skipped: number;
  debug?: AlignDebugPayload;
}

// ─── ActionsScreen ────────────────────────────────────────────────────────────

export class ActionsScreen {
  private _conn: Conn | null = null;
  private _docs: DocumentRecord[] = [];
  private _jobCenter: JobCenter | null = null;
  private _showToast: ((msg: string, isError?: boolean) => void) | null = null;

  // Audit state
  private _auditPivotId: number | null = null;
  private _auditTargetId: number | null = null;
  private _auditOffset = 0;
  private _auditLimit = 30;
  private _auditHasMore = false;
  private _auditLinks: AlignLinkRecord[] = [];
  private _alignExplainability: AlignExplainabilityEntry[] = [];
  private _alignRunId: string | null = null;

  // V1.5 — Collision state
  private _collOffset = 0;
  private _collLimit = 20;
  private _collGroups: CollisionGroup[] = [];
  private _collHasMore = false;
  private _collTotalCount = 0;

  // Log + busy
  private _logEl!: HTMLElement;
  private _busyEl!: HTMLElement;

  render(): HTMLElement {
    const root = document.createElement("div");
    root.className = "screen actions-screen";

    root.innerHTML = `
      <h2 class="screen-title">Actions corpus</h2>

      <!-- Documents -->
      <section class="card">
        <h3>Documents du corpus</h3>
        <div class="btn-row">
          <button id="act-reload-docs" class="btn btn-secondary">Rafraîchir</button>
        </div>
        <div id="act-doc-list" class="doc-list"><p class="empty-hint">Aucun corpus ouvert.</p></div>
      </section>

      <!-- ═══ FEATURE 1: Curation Preview Diff ═══ -->
      <section class="card" id="act-curate-card">
        <h3>Curation <span class="badge-preview">avec prévisualisation</span></h3>

        <div class="form-row">
          <label>Preset :
            <select id="act-preset-sel">
              <option value="spaces">Espaces</option>
              <option value="quotes">Apostrophes et guillemets</option>
              <option value="punctuation">Ponctuation</option>
              <option value="custom">Règles personnalisées</option>
            </select>
          </label>
          <label>Document :
            <select id="act-curate-doc"><option value="">Tous</option></select>
          </label>
        </div>

        <div id="act-custom-rules-wrap" style="display:none; margin-top:0.5rem">
          <label>Règles JSON :
            <textarea id="act-curate-rules" rows="4" placeholder='[{"pattern":"foo","replacement":"bar","flags":"gi"}]'></textarea>
          </label>
        </div>

        <div class="btn-row" style="margin-top:0.75rem">
          <button id="act-preview-btn" class="btn btn-secondary" disabled>Prévisualiser</button>
          <button id="act-curate-btn" class="btn btn-warning" disabled>Appliquer</button>
        </div>

        <!-- Preview panel -->
        <div id="act-preview-panel" style="display:none; margin-top:0.75rem">
          <div id="act-preview-stats" class="preview-stats"></div>
          <div id="act-diff-list" class="diff-list"></div>
          <div class="btn-row" style="margin-top:0.5rem">
            <button id="act-apply-after-preview-btn" class="btn btn-warning btn-sm">Appliquer maintenant</button>
            <button id="act-reindex-after-curate-btn" class="btn btn-secondary btn-sm" style="display:none">Re-indexer</button>
          </div>
        </div>
      </section>

      <!-- Segmentation -->
      <section class="card">
        <h3>Segmentation</h3>
        <p class="hint">Remplace les unités-lignes par des unités-phrase (efface les liens d'alignement).</p>
        <div class="form-row">
          <label>Document :
            <select id="act-seg-doc"><option value="">— choisir —</option></select>
          </label>
          <label>Langue :
            <input id="act-seg-lang" type="text" value="fr" maxlength="10" style="width:70px" />
          </label>
          <label>Pack :
            <select id="act-seg-pack">
              <option value="auto">auto (recommandé)</option>
              <option value="fr_strict">fr_strict</option>
              <option value="en_strict">en_strict</option>
              <option value="default">default</option>
            </select>
          </label>
        </div>
        <div class="btn-row" style="margin-top:0.5rem">
          <button id="act-seg-btn" class="btn btn-warning" disabled>Segmenter</button>
        </div>
      </section>

      <!-- ═══ FEATURE 2: Align + Audit UI ═══ -->
      <section class="card">
        <h3>Alignement <span class="badge-preview">avec audit</span></h3>
        <div class="form-row">
          <label>Doc pivot :
            <select id="act-align-pivot"><option value="">— choisir —</option></select>
          </label>
          <label>Doc(s) cible(s) :
            <select id="act-align-targets" multiple size="3"></select>
          </label>
        </div>
        <div class="form-row">
          <label>Stratégie :
            <select id="act-align-strategy">
              <option value="external_id">external_id</option>
              <option value="external_id_then_position">external_id_then_position (hybride)</option>
              <option value="position">position</option>
              <option value="similarity">similarité</option>
            </select>
          </label>
          <label id="act-sim-row" style="display:none">Seuil :
            <input id="act-sim-threshold" type="number" min="0" max="1" step="0.05" value="0.8" style="width:70px"/>
          </label>
          <label style="display:flex; align-items:center; gap:0.35rem">
            <input id="act-align-debug" type="checkbox" />
            debug explainability
          </label>
        </div>
        <div class="btn-row" style="margin-top:0.5rem">
          <button id="act-align-btn" class="btn btn-warning" disabled>Aligner</button>
        </div>

        <!-- Align results banner -->
        <div id="act-align-results" style="display:none; margin-top:0.75rem">
          <div id="act-align-banner" class="preview-stats"></div>
        </div>

        <div id="act-align-debug-panel" style="display:none; margin-top:0.75rem">
          <div class="align-debug-head">
            <h4 style="margin:0; font-size:0.9rem">Explainability</h4>
            <button id="act-align-copy-debug-btn" class="btn btn-secondary btn-sm">Copier diagnostic JSON</button>
          </div>
          <div id="act-align-debug-content" class="align-debug-content"></div>
        </div>

        <!-- Audit panel -->
        <div id="act-audit-panel" style="display:none; margin-top:0.75rem">
          <h4 style="margin:0 0 0.4rem; font-size:0.9rem">Audit des liens</h4>
          <div class="form-row">
            <label>Pivot :
              <select id="act-audit-pivot"><option value="">— choisir —</option></select>
            </label>
            <label>Cible :
              <select id="act-audit-target"><option value="">— choisir —</option></select>
            </label>
            <label>ext_id exact :
              <input id="act-audit-extid" type="number" placeholder="optionnel" style="width:100px"/>
            </label>
            <label>Statut :
              <select id="act-audit-status">
                <option value="">Tous</option>
                <option value="unreviewed">Non révisés</option>
                <option value="accepted">Acceptés</option>
                <option value="rejected">Rejetés</option>
              </select>
            </label>
          </div>
          <div class="btn-row" style="margin-top:0.4rem">
            <button id="act-audit-load-btn" class="btn btn-secondary btn-sm">Charger les liens</button>
          </div>
          <div id="act-audit-table-wrap" style="margin-top:0.5rem; overflow-x:auto"></div>
          <div id="act-audit-batch-bar" class="audit-batch-bar" style="display:none">
            <span id="act-audit-sel-count" class="audit-sel-count">0 sélectionné(s)</span>
            <button id="act-audit-batch-accept" class="btn btn-sm btn-secondary">✓ Accepter</button>
            <button id="act-audit-batch-reject" class="btn btn-sm btn-secondary">✗ Rejeter</button>
            <button id="act-audit-batch-unreviewed" class="btn btn-sm btn-secondary">? Non révisé</button>
            <button id="act-audit-batch-delete" class="btn btn-sm btn-danger">🗑 Supprimer</button>
          </div>
          <div class="btn-row" style="margin-top:0.4rem">
            <button id="act-audit-more-btn" class="btn btn-secondary btn-sm" style="display:none">Charger plus</button>
          </div>
        </div>
      </section>

      <!-- ═══ FEATURE 3: Align Quality Metrics ═══ -->
      <section class="card">
        <h3>Qualité alignement <span class="badge-preview">métriques</span></h3>
        <p class="hint">Calculer les métriques de couverture et d'orphelins pour une paire pivot↔cible.</p>
        <div class="form-row">
          <label>Pivot
            <select id="act-quality-pivot"><option value="">— choisir —</option></select>
          </label>
          <label>Cible
            <select id="act-quality-target"><option value="">— choisir —</option></select>
          </label>
          <div style="align-self:flex-end">
            <button id="act-quality-btn" class="btn btn-secondary btn-sm" disabled>Calculer métriques</button>
          </div>
        </div>
        <div id="act-quality-result" style="display:none; margin-top:0.75rem"></div>
      </section>

      <!-- ═══ FEATURE 4: Collision resolver (V1.5) ═══ -->
      <section class="card" id="act-collision-card">
        <h3>Collisions d'alignement <span class="badge-preview">résolution</span></h3>
        <p class="hint">Un pivot ayant plusieurs liens vers le même document cible est une collision. Résolvez-les ici.</p>
        <div class="form-row">
          <label>Pivot
            <select id="act-coll-pivot"><option value="">— choisir —</option></select>
          </label>
          <label>Cible
            <select id="act-coll-target"><option value="">— choisir —</option></select>
          </label>
          <div style="align-self:flex-end">
            <button id="act-coll-load-btn" class="btn btn-secondary btn-sm" disabled>Charger les collisions</button>
          </div>
        </div>
        <div id="act-coll-result" style="display:none; margin-top:0.75rem"></div>
        <div id="act-coll-more-wrap" style="display:none; margin-top:0.5rem; text-align:center">
          <button id="act-coll-more-btn" class="btn btn-sm btn-secondary">Charger plus</button>
        </div>
      </section>

      <!-- Validate meta -->
      <section class="card">
        <h3>Validation métadonnées</h3>
        <div class="form-row">
          <label>Document :
            <select id="act-meta-doc"><option value="">Tous</option></select>
          </label>
        </div>
        <div class="btn-row" style="margin-top:0.5rem">
          <button id="act-meta-btn" class="btn btn-secondary" disabled>Valider</button>
        </div>
      </section>

      <!-- FTS index -->
      <section class="card">
        <h3>Index FTS</h3>
        <div class="btn-row">
          <button id="act-index-btn" class="btn btn-secondary" disabled>Reconstruire l'index</button>
        </div>
      </section>

      <div id="act-busy" class="busy-overlay" style="display:none">
        <div class="busy-spinner">⏳ Opération en cours…</div>
      </div>

      <section class="card">
        <h3>Journal</h3>
        <div id="act-log" class="log-pane"></div>
      </section>
    `;

    this._logEl = root.querySelector("#act-log")!;
    this._busyEl = root.querySelector("#act-busy")!;

    // Wire events
    root.querySelector("#act-reload-docs")!.addEventListener("click", () => this._loadDocs());

    // Preset selector
    root.querySelector("#act-preset-sel")!.addEventListener("change", (e) => {
      const v = (e.target as HTMLSelectElement).value;
      (root.querySelector("#act-custom-rules-wrap") as HTMLElement).style.display =
        v === "custom" ? "" : "none";
    });

    // Curate
    root.querySelector("#act-preview-btn")!.addEventListener("click", () => this._runPreview());
    root.querySelector("#act-curate-btn")!.addEventListener("click", () => this._runCurate());
    root.querySelector("#act-apply-after-preview-btn")!.addEventListener("click", () => this._runCurate());
    root.querySelector("#act-reindex-after-curate-btn")!.addEventListener("click", () => this._runIndex());

    // Segment
    root.querySelector("#act-seg-btn")!.addEventListener("click", () => this._runSegment());

    // Align + strategy
    root.querySelector("#act-align-strategy")!.addEventListener("change", (e) => {
      const v = (e.target as HTMLSelectElement).value;
      (root.querySelector("#act-sim-row") as HTMLElement).style.display =
        v === "similarity" ? "" : "none";
    });
    root.querySelector("#act-align-btn")!.addEventListener("click", () => this._runAlign());
    root.querySelector("#act-align-copy-debug-btn")!.addEventListener("click", () => this._copyAlignDebugJson());

    // Audit
    root.querySelector("#act-audit-load-btn")!.addEventListener("click", () => {
      this._auditOffset = 0;
      this._auditLinks = [];
      this._renderAuditTable(root);
      this._loadAuditPage(root, false);
    });
    root.querySelector("#act-audit-more-btn")!.addEventListener("click", () => this._loadAuditPage(root, true));

    // Batch action bar
    root.querySelector("#act-audit-batch-accept")!.addEventListener("click", () =>
      this._runBatchAction(root, "set_status", "accepted"));
    root.querySelector("#act-audit-batch-reject")!.addEventListener("click", () =>
      this._runBatchAction(root, "set_status", "rejected"));
    root.querySelector("#act-audit-batch-unreviewed")!.addEventListener("click", () =>
      this._runBatchAction(root, "set_status", null));
    root.querySelector("#act-audit-batch-delete")!.addEventListener("click", () =>
      this._runBatchAction(root, "delete", null));

    // Quality metrics
    root.querySelector("#act-quality-btn")!.addEventListener("click", () => this._runAlignQuality(root));

    // Collision resolver (V1.5)
    root.querySelector("#act-coll-load-btn")!.addEventListener("click", () => {
      this._collOffset = 0;
      this._collGroups = [];
      this._loadCollisionsPage(root, false);
    });
    root.querySelector("#act-coll-more-btn")!.addEventListener("click", () => this._loadCollisionsPage(root, true));

    // Validate meta + index
    root.querySelector("#act-meta-btn")!.addEventListener("click", () => this._runValidateMeta());
    root.querySelector("#act-index-btn")!.addEventListener("click", () => this._runIndex());

    return root;
  }

  setConn(conn: Conn | null): void {
    this._conn = conn;
    this._docs = [];
    this._alignExplainability = [];
    this._alignRunId = null;
    this._setButtonsEnabled(false);
    if (conn) this._loadDocs();
  }

  setJobCenter(jc: JobCenter, showToast: (msg: string, isError?: boolean) => void): void {
    this._jobCenter = jc;
    this._showToast = showToast;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private _log(msg: string, isError = false): void {
    const ts = new Date().toLocaleTimeString();
    const line = document.createElement("div");
    line.className = isError ? "log-line log-error" : "log-line";
    line.textContent = `[${ts}] ${msg}`;
    this._logEl.appendChild(line);
    this._logEl.scrollTop = this._logEl.scrollHeight;
  }

  private _setBusy(v: boolean): void {
    this._busyEl.style.display = v ? "flex" : "none";
  }

  private _setButtonsEnabled(on: boolean): void {
    ["act-preview-btn", "act-curate-btn", "act-seg-btn", "act-align-btn",
     "act-meta-btn", "act-index-btn", "act-quality-btn", "act-coll-load-btn"].forEach(id => {
      const el = document.querySelector(`#${id}`) as HTMLButtonElement | null;
      if (el) el.disabled = !on;
    });
  }

  private _currentRules(): CurateRule[] {
    const preset = (document.querySelector("#act-preset-sel") as HTMLSelectElement)?.value ?? "spaces";
    if (preset === "custom") {
      const raw = (document.querySelector("#act-curate-rules") as HTMLTextAreaElement)?.value.trim() ?? "[]";
      try { return JSON.parse(raw) as CurateRule[]; }
      catch { return []; }
    }
    return CURATE_PRESETS[preset]?.rules ?? [];
  }

  private _currentCurateDocId(): number | undefined {
    const v = (document.querySelector("#act-curate-doc") as HTMLSelectElement)?.value;
    return v ? parseInt(v) : undefined;
  }

  private _populateSelects(): void {
    const allDocSelects = ["act-curate-doc", "act-seg-doc", "act-align-pivot",
      "act-align-targets", "act-meta-doc", "act-audit-pivot", "act-audit-target",
      "act-quality-pivot", "act-quality-target",
      "act-coll-pivot", "act-coll-target"];
    allDocSelects.forEach(id => {
      const sel = document.querySelector(`#${id}`) as HTMLSelectElement | null;
      if (!sel) return;
      const keepFirst = sel.options[0]?.value === "" ? sel.options[0] : null;
      sel.innerHTML = "";
      if (keepFirst) sel.appendChild(keepFirst);
      for (const doc of this._docs) {
        const opt = document.createElement("option");
        opt.value = String(doc.doc_id);
        opt.textContent = `[${doc.doc_id}] ${doc.title} (${doc.language}, ${doc.unit_count} u.)`;
        sel.appendChild(opt);
      }
    });
  }

  private async _loadDocs(): Promise<void> {
    if (!this._conn) return;
    try {
      this._docs = await listDocuments(this._conn);
      this._renderDocList();
      this._populateSelects();
      this._setButtonsEnabled(true);
      // Show audit panel once docs are loaded
      const ap = document.querySelector("#act-audit-panel") as HTMLElement | null;
      if (ap) ap.style.display = "";
      this._log(`${this._docs.length} document(s) chargé(s).`);
    } catch (err) {
      this._log(`Erreur chargement docs : ${err instanceof SidecarError ? err.message : String(err)}`, true);
    }
  }

  private _renderDocList(): void {
    const el = document.querySelector("#act-doc-list");
    if (!el) return;
    if (this._docs.length === 0) {
      el.innerHTML = '<p class="empty-hint">Aucun document importé.</p>';
      return;
    }
    const table = document.createElement("table");
    table.className = "meta-table";
    table.innerHTML = `<thead><tr><th>ID</th><th>Titre</th><th>Langue</th><th>Rôle</th><th>Unités</th></tr></thead>`;
    const tbody = document.createElement("tbody");
    for (const doc of this._docs) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${doc.doc_id}</td><td>${doc.title}</td><td>${doc.language}</td><td>${doc.doc_role ?? "—"}</td><td>${doc.unit_count}</td>`;
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    el.innerHTML = "";
    el.appendChild(table);
  }

  // ─── Feature 1: Curation Preview ─────────────────────────────────────────

  private async _runPreview(): Promise<void> {
    if (!this._conn) return;
    const docId = this._currentCurateDocId();
    if (docId === undefined) {
      this._log("Sélectionnez un document pour la prévisualisation.", true);
      return;
    }
    const rules = this._currentRules();
    if (rules.length === 0) {
      this._log("Aucune règle de curation configurée.", true);
      return;
    }

    this._setBusy(true);
    const panel = document.querySelector("#act-preview-panel") as HTMLElement;
    panel.style.display = "none";

    try {
      const res = await curatePreview(this._conn, { doc_id: docId, rules, limit_examples: 10 });
      panel.style.display = "";

      // Stats banner
      const statsEl = document.querySelector("#act-preview-stats")!;
      const changed = res.stats.units_changed;
      const total = res.stats.units_total;
      const reps = res.stats.replacements_total;
      statsEl.innerHTML = changed === 0
        ? `<span class="stat-ok">✓ Aucune modification prévue (${total} unités analysées).</span>`
        : `<span class="stat-warn">⚠ ${changed}/${total} unité(s) modifiée(s), ${reps} remplacement(s).</span>`;

      // Diff table
      this._renderDiffList(res.examples);

      // Show / hide apply button
      const applyBtn = document.querySelector("#act-apply-after-preview-btn") as HTMLButtonElement;
      applyBtn.style.display = changed > 0 ? "" : "none";
      (document.querySelector("#act-reindex-after-curate-btn") as HTMLElement).style.display = "none";

      this._log(`Prévisualisation : ${changed}/${total} unités → ${reps} remplacements.`);
    } catch (err) {
      this._log(`✗ Prévisualisation : ${err instanceof SidecarError ? err.message : String(err)}`, true);
    }
    this._setBusy(false);
  }

  private _renderDiffList(examples: CuratePreviewExample[]): void {
    const el = document.querySelector("#act-diff-list")!;
    if (examples.length === 0) {
      el.innerHTML = "";
      return;
    }
    const table = document.createElement("table");
    table.className = "diff-table";
    table.innerHTML = `
      <thead>
        <tr>
          <th style="width:40px">ext_id</th>
          <th>Avant</th>
          <th>Après</th>
        </tr>
      </thead>
    `;
    const tbody = document.createElement("tbody");
    for (const ex of examples) {
      const tr = document.createElement("tr");
      const extIdCell = `<td class="diff-extid">${ex.external_id ?? "—"}</td>`;
      const beforeCell = `<td class="diff-before">${_escHtml(ex.before)}</td>`;
      const afterCell = `<td class="diff-after">${_highlightChanges(ex.before, ex.after)}</td>`;
      tr.innerHTML = extIdCell + beforeCell + afterCell;
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    el.innerHTML = "";
    el.appendChild(table);
  }

  private async _runCurate(): Promise<void> {
    if (!this._conn) return;
    const rules = this._currentRules();
    if (rules.length === 0) { this._log("Aucune règle configurée.", true); return; }

    const docId = this._currentCurateDocId();
    const label = docId !== undefined ? `doc #${docId}` : "tous les documents";
    if (!window.confirm(`Appliquer la curation sur ${label} ?\nCette opération modifie text_norm en base.`)) return;

    this._setBusy(true);
    const params: Record<string, unknown> = { rules };
    if (docId !== undefined) params.doc_id = docId;
    try {
      const job = await enqueueJob(this._conn, "curate", params);
      this._log(`Job curation soumis (${job.job_id.slice(0, 8)}…)`);
      (document.querySelector("#act-preview-panel") as HTMLElement).style.display = "none";
      this._jobCenter?.trackJob(job.job_id, `Curation ${label}`, (done) => {
        if (done.status === "done") {
          const r = done.result as { docs_curated?: number; units_modified?: number; fts_stale?: boolean } | undefined;
          this._log(`✓ Curation : ${r?.docs_curated ?? "?"} doc(s), ${r?.units_modified ?? "?"} unité(s).`);
          if (r?.fts_stale) {
            this._log("⚠ Index FTS périmé.");
            const btn = document.querySelector("#act-reindex-after-curate-btn") as HTMLElement | null;
            if (btn) btn.style.display = "";
          }
          this._showToast?.("✓ Curation appliquée");
        } else {
          this._log(`✗ Curation : ${done.error ?? done.status}`, true);
          this._showToast?.("✗ Erreur curation", true);
        }
        this._setBusy(false);
      });
    } catch (err) {
      this._log(`✗ Curation : ${err instanceof SidecarError ? err.message : String(err)}`, true);
      this._setBusy(false);
    }
  }

  // ─── Segment ─────────────────────────────────────────────────────────────

  private async _runSegment(): Promise<void> {
    if (!this._conn) return;
    const docSel = (document.querySelector("#act-seg-doc") as HTMLSelectElement).value;
    if (!docSel) { this._log("Sélectionnez un document.", true); return; }
    const docId = parseInt(docSel);
    const lang = (document.querySelector("#act-seg-lang") as HTMLInputElement).value.trim() || "und";
    const pack = (document.querySelector("#act-seg-pack") as HTMLSelectElement).value || "auto";
    const doc = this._docs.find(d => d.doc_id === docId);
    const docLabel = doc ? `"${doc.title}"` : `#${docId}`;

    if (!window.confirm(
      `Segmenter le document ${docLabel} ?\n` +
      `Pack: ${pack}\n` +
      "Cette opération EFFACE les liens d'alignement existants."
    )) return;

    this._setBusy(true);
    try {
      const job = await enqueueJob(this._conn, "segment", { doc_id: docId, lang, pack });
      this._log(`Job segmentation soumis pour ${docLabel} (${job.job_id.slice(0, 8)}…)`);
      this._jobCenter?.trackJob(job.job_id, `Segmentation ${docLabel}`, (done) => {
        if (done.status === "done") {
          const r = done.result as {
            units_input?: number;
            units_output?: number;
            segment_pack?: string;
            warnings?: string[];
            fts_stale?: boolean;
          } | undefined;
          const warns = r?.warnings?.length ? ` Avertissements : ${r.warnings.join("; ")}` : "";
          const usedPack = r?.segment_pack ? ` Pack=${r.segment_pack}.` : "";
          this._log(`✓ Segmentation : ${r?.units_input ?? "?"} → ${r?.units_output ?? "?"} unités.${usedPack}${warns}`);
          if (r?.fts_stale) this._log("⚠ Index FTS périmé.");
          this._showToast?.(`✓ Segmentation ${docLabel} terminée`);
        } else {
          this._log(`✗ Segmentation : ${done.error ?? done.status}`, true);
          this._showToast?.("✗ Erreur segmentation", true);
        }
        this._setBusy(false);
      });
    } catch (err) {
      this._log(`✗ Segmentation : ${err instanceof SidecarError ? err.message : String(err)}`, true);
      this._setBusy(false);
    }
  }

  // ─── Feature 2: Align + Audit ────────────────────────────────────────────

  private async _runAlign(): Promise<void> {
    if (!this._conn) return;
    const pivotSel = (document.querySelector("#act-align-pivot") as HTMLSelectElement).value;
    if (!pivotSel) { this._log("Sélectionnez un document pivot.", true); return; }
    const pivotId = parseInt(pivotSel);

    const targetsSel = document.querySelector("#act-align-targets") as HTMLSelectElement;
    const targetIds: number[] = [];
    for (const opt of targetsSel.selectedOptions) targetIds.push(parseInt(opt.value));
    if (targetIds.length === 0) { this._log("Sélectionnez au moins un doc cible.", true); return; }

    const strategy = (document.querySelector("#act-align-strategy") as HTMLSelectElement).value as
      "external_id" | "external_id_then_position" | "position" | "similarity";
    const debugAlign = (document.querySelector("#act-align-debug") as HTMLInputElement).checked;
    const simThreshold = parseFloat(
      (document.querySelector("#act-sim-threshold") as HTMLInputElement).value
    ) || 0.8;

    if (!window.confirm(
      `Aligner pivot #${pivotId} → cibles [${targetIds.join(", ")}]\nStratégie : ${strategy}\nDebug: ${debugAlign ? "on" : "off"}`
    )) return;

    this._alignExplainability = [];
    this._alignRunId = null;
    this._renderAlignExplainability();
    this._setBusy(true);
    const alignParams: Record<string, unknown> = {
      pivot_doc_id: pivotId,
      target_doc_ids: targetIds,
      strategy,
      debug_align: debugAlign,
    };
    if (strategy === "similarity") alignParams.sim_threshold = simThreshold;

    try {
      const job = await enqueueJob(this._conn, "align", alignParams);
      this._log(`Job alignement soumis pivot #${pivotId} → [${targetIds.join(",")}] (${job.job_id.slice(0, 8)}…)`);
      this._jobCenter?.trackJob(job.job_id, `Alignement #${pivotId}→[${targetIds.join(",")}]`, (done) => {
        if (done.status === "done") {
          const reports = (done.result as {
            run_id?: string;
            reports?: Array<{ target_doc_id: number; links_created: number; links_skipped?: number; debug?: AlignDebugPayload }>;
          } | undefined)?.reports ?? [];
          const runId = (done.result as { run_id?: string } | undefined)?.run_id;
          this._alignRunId = typeof runId === "string" && runId ? runId : null;
          this._alignExplainability = reports.map((r) => ({
            target_doc_id: r.target_doc_id,
            links_created: r.links_created,
            links_skipped: r.links_skipped ?? 0,
            debug: r.debug,
          }));
          const resultsEl = document.querySelector("#act-align-results") as HTMLElement | null;
          const bannerEl = document.querySelector("#act-align-banner");
          if (resultsEl) resultsEl.style.display = "";
          if (bannerEl) {
            bannerEl.innerHTML = reports
              .map((r) => {
                const skipped = r.links_skipped ?? 0;
                return `<span class="stat-ok">→ doc #${r.target_doc_id} : ${r.links_created} liens créés, ${skipped} ignorés.</span>`;
              })
              .join(" &nbsp;");
          }
          this._renderAlignExplainability();
          for (const r of reports) {
            const skipped = r.links_skipped ?? 0;
            this._log(`✓ → doc #${r.target_doc_id} : ${r.links_created} liens créés, ${skipped} ignorés.`);
          }
          if (debugAlign) {
            const withDebug = reports.filter((r) => Boolean(r.debug)).length;
            if (withDebug > 0) {
              const runSuffix = this._alignRunId ? ` (run ${this._alignRunId})` : "";
              this._log(`Explainability : ${withDebug}/${reports.length} rapport(s) détaillé(s) disponibles${runSuffix}.`);
            } else {
              this._log("Explainability : aucun détail debug renvoyé par le backend.");
            }
          }
          this._showToast?.(`✓ Alignement terminé (${reports.reduce((s, r) => s + r.links_created, 0)} liens)`);
          // Pre-fill audit selects
          this._auditPivotId = pivotId;
          this._auditTargetId = targetIds[0];
          this._auditOffset = 0;
          this._auditLinks = [];
          const auditPivSel = document.querySelector("#act-audit-pivot") as HTMLSelectElement | null;
          const auditTgtSel = document.querySelector("#act-audit-target") as HTMLSelectElement | null;
          if (auditPivSel) auditPivSel.value = String(pivotId);
          if (auditTgtSel) auditTgtSel.value = String(targetIds[0]);
          const root = document.querySelector(".actions-screen");
          if (root) {
            this._renderAuditTable(root as HTMLElement);
            void this._loadAuditPage(root as HTMLElement, false);
          }
        } else {
          this._log(`✗ Alignement : ${done.error ?? done.status}`, true);
          this._showToast?.("✗ Erreur alignement", true);
        }
        this._setBusy(false);
      });
    } catch (err) {
      this._log(`✗ Alignement : ${err instanceof SidecarError ? err.message : String(err)}`, true);
      this._setBusy(false);
    }
  }

  private _renderAlignExplainability(): void {
    const panel = document.querySelector("#act-align-debug-panel") as HTMLElement | null;
    const content = document.querySelector("#act-align-debug-content") as HTMLElement | null;
    const copyBtn = document.querySelector("#act-align-copy-debug-btn") as HTMLButtonElement | null;
    if (!panel || !content || !copyBtn) return;

    if (this._alignExplainability.length === 0) {
      panel.style.display = "none";
      content.innerHTML = "";
      copyBtn.disabled = true;
      return;
    }

    panel.style.display = "";
    const runMeta = this._alignRunId
      ? `<div class="align-debug-meta" style="margin-bottom:0.35rem">run_id: <code>${_escHtml(this._alignRunId)}</code></div>`
      : "";
    const rows = this._alignExplainability.map((rep) => {
      const debug = rep.debug;
      if (!debug) {
        return `
          <div class="align-debug-card">
            <div class="align-debug-title">Doc cible #${rep.target_doc_id}</div>
            <div class="align-debug-meta">
              liens créés: <strong>${rep.links_created}</strong>, ignorés: <strong>${rep.links_skipped}</strong>
            </div>
            <div class="empty-hint">Aucun détail debug pour ce rapport.</div>
          </div>
        `;
      }

      const strategy = typeof debug.strategy === "string" ? debug.strategy : "n/a";
      const sourceParts = _isRecord(debug.link_sources)
        ? Object.entries(debug.link_sources).map(([k, v]) => `<span class="align-debug-pill">${_escHtml(k)}: ${_escHtml(String(v))}</span>`)
        : [];
      const sim = _isRecord(debug.similarity_stats) ? debug.similarity_stats : null;
      const sampleLinks = Array.isArray(debug.sample_links) ? debug.sample_links.slice(0, 3) : [];
      const sampleRows = sampleLinks.map((item) => {
        if (!_isRecord(item)) return "";
        const pivot = item.pivot_unit_id ?? "n/a";
        const target = item.target_unit_id ?? "n/a";
        const ext = item.external_id ?? "—";
        return `<li>pivot ${_escHtml(String(pivot))} → cible ${_escHtml(String(target))} (ext_id=${_escHtml(String(ext))})</li>`;
      }).join("");

      return `
        <div class="align-debug-card">
          <div class="align-debug-title">Doc cible #${rep.target_doc_id}</div>
          <div class="align-debug-meta">
            stratégie: <strong>${_escHtml(strategy)}</strong> ·
            liens créés: <strong>${rep.links_created}</strong> · ignorés: <strong>${rep.links_skipped}</strong>
          </div>
          ${sourceParts.length > 0
            ? `<div class="align-debug-row"><span class="align-debug-label">Sources</span><div class="align-debug-pills">${sourceParts.join("")}</div></div>`
            : `<div class="align-debug-row"><span class="align-debug-label">Sources</span><span class="empty-hint">n/a</span></div>`}
          ${sim
            ? `<div class="align-debug-row">
                 <span class="align-debug-label">Similarité</span>
                 <span>mean=${_formatMaybeNumber(sim.score_mean)} min=${_formatMaybeNumber(sim.score_min)} max=${_formatMaybeNumber(sim.score_max)}</span>
               </div>`
            : ""}
          ${sampleRows
            ? `<div class="align-debug-row">
                 <span class="align-debug-label">Exemples</span>
                 <ul class="align-debug-list">${sampleRows}</ul>
               </div>`
            : ""}
        </div>
      `;
    });

    content.innerHTML = runMeta + rows.join("");
    copyBtn.disabled = false;
  }

  private async _copyAlignDebugJson(): Promise<void> {
    if (this._alignExplainability.length === 0) {
      this._showToast?.("Aucun diagnostic à copier.", true);
      return;
    }
    const payload = {
      generated_at: new Date().toISOString(),
      run_id: this._alignRunId,
      reports: this._alignExplainability,
    };
    const ok = await _copyTextToClipboard(JSON.stringify(payload, null, 2));
    if (ok) {
      this._showToast?.("Diagnostic JSON copié.");
      this._log("Diagnostic alignement copié dans le presse-papiers.");
    } else {
      this._showToast?.("Impossible de copier automatiquement le diagnostic.", true);
      this._log("✗ Copie diagnostic alignement impossible.", true);
    }
  }

  private async _loadAuditPage(root: HTMLElement, append: boolean): Promise<void> {
    if (!this._conn) return;
    const pivotSel = root.querySelector("#act-audit-pivot") as HTMLSelectElement;
    const targetSel = root.querySelector("#act-audit-target") as HTMLSelectElement;
    const extIdInput = root.querySelector("#act-audit-extid") as HTMLInputElement;

    const pivotId = pivotSel?.value ? parseInt(pivotSel.value) : this._auditPivotId;
    const targetId = targetSel?.value ? parseInt(targetSel.value) : this._auditTargetId;
    if (!pivotId || !targetId) {
      this._log("Sélectionnez pivot et cible pour l'audit.", true);
      return;
    }

    if (!append) {
      this._auditOffset = 0;
      this._auditLinks = [];
    }

    const statusSel = root.querySelector("#act-audit-status") as HTMLSelectElement;
    const opts: Parameters<typeof alignAudit>[1] = {
      pivot_doc_id: pivotId,
      target_doc_id: targetId,
      limit: this._auditLimit,
      offset: this._auditOffset,
    };
    const extIdVal = extIdInput?.value.trim();
    if (extIdVal) opts.external_id = parseInt(extIdVal);
    const statusVal = statusSel?.value;
    if (statusVal) opts.status = statusVal as "accepted" | "rejected" | "unreviewed";

    try {
      const res = await alignAudit(this._conn, opts);
      this._auditLinks = append
        ? ([...this._auditLinks, ...res.links] as AlignLinkRecord[])
        : (res.links as AlignLinkRecord[]);
      this._auditOffset = res.next_offset ?? this._auditOffset + res.limit;
      this._auditHasMore = res.has_more;
      this._auditPivotId = pivotId;
      this._auditTargetId = targetId;
      this._renderAuditTable(root);
      this._log(`Audit : ${this._auditLinks.length} lien(s) chargé(s)${res.has_more ? " (suite disponible)" : ""}.`);
    } catch (err) {
      this._log(`✗ Audit : ${err instanceof SidecarError ? err.message : String(err)}`, true);
    }
  }

  private _renderAuditTable(root: HTMLElement): void {
    const wrap = root.querySelector("#act-audit-table-wrap")!;
    const moreBtn = root.querySelector("#act-audit-more-btn") as HTMLElement;
    const batchBar = root.querySelector("#act-audit-batch-bar") as HTMLElement | null;

    if (this._auditLinks.length === 0) {
      wrap.innerHTML = '<p class="empty-hint">Aucun lien. Lancez un alignement ou chargez les liens.</p>';
      if (moreBtn) moreBtn.style.display = "none";
      if (batchBar) batchBar.style.display = "none";
      return;
    }

    const table = document.createElement("table");
    table.className = "meta-table audit-table";
    table.innerHTML = `
      <thead><tr>
        <th><input type="checkbox" id="act-audit-sel-all" title="Tout sélectionner"/></th>
        <th>ext_id</th>
        <th>Pivot (texte)</th>
        <th>Cible (texte)</th>
        <th>Statut</th>
        <th>Actions</th>
      </tr></thead>
    `;
    const tbody = document.createElement("tbody");
    for (const link of this._auditLinks) {
      const tr = document.createElement("tr");
      const statusBadge = link.status === "accepted"
        ? `<span class="status-badge status-ok">✅ Accepté</span>`
        : link.status === "rejected"
        ? `<span class="status-badge status-error">❌ Rejeté</span>`
        : `<span class="status-badge status-unknown">🔵 Non révisé</span>`;
      tr.innerHTML = `
        <td><input type="checkbox" class="audit-row-cb" data-id="${link.link_id}"/></td>
        <td style="white-space:nowrap">${link.external_id ?? "—"}</td>
        <td class="audit-text">${_escHtml(String(link.pivot_text ?? ""))}</td>
        <td class="audit-text">${_escHtml(String(link.target_text ?? ""))}</td>
        <td style="white-space:nowrap">${statusBadge}</td>
        <td style="white-space:nowrap">
          <button class="btn btn-sm btn-secondary audit-accept-btn" data-id="${link.link_id}" title="Accepter">✓</button>
          <button class="btn btn-sm btn-danger audit-reject-btn" data-id="${link.link_id}" title="Rejeter">✗</button>
          <button class="btn btn-sm btn-secondary audit-retarget-btn" data-id="${link.link_id}" data-pivot="${link.pivot_unit_id}" title="Reciblaer">⇄</button>
          <button class="btn btn-sm btn-danger audit-del-btn" data-id="${link.link_id}" title="Supprimer">🗑</button>
        </td>
      `;
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.innerHTML = "";
    wrap.appendChild(table);

    // Wire action buttons
    const self = this;
    wrap.querySelectorAll<HTMLButtonElement>(".audit-accept-btn").forEach(btn => {
      btn.addEventListener("click", () => self._updateLinkStatus(Number(btn.dataset.id), "accepted", root));
    });
    wrap.querySelectorAll<HTMLButtonElement>(".audit-reject-btn").forEach(btn => {
      btn.addEventListener("click", () => self._updateLinkStatus(Number(btn.dataset.id), "rejected", root));
    });
    wrap.querySelectorAll<HTMLButtonElement>(".audit-del-btn").forEach(btn => {
      btn.addEventListener("click", () => self._deleteLinkFromAudit(Number(btn.dataset.id), root));
    });
    wrap.querySelectorAll<HTMLButtonElement>(".audit-retarget-btn").forEach(btn => {
      btn.addEventListener("click", () =>
        self._openRetargetModal(Number(btn.dataset.id), Number(btn.dataset.pivot), root)
      );
    });

    // Select-all checkbox
    const selAllCb = table.querySelector<HTMLInputElement>("#act-audit-sel-all");
    const updateBatchBar = () => {
      const checked = wrap.querySelectorAll<HTMLInputElement>(".audit-row-cb:checked");
      const countEl = root.querySelector<HTMLElement>("#act-audit-sel-count");
      if (countEl) countEl.textContent = `${checked.length} sélectionné(s)`;
      if (batchBar) batchBar.style.display = checked.length > 0 ? "flex" : "none";
    };
    if (selAllCb) {
      selAllCb.addEventListener("change", () => {
        wrap.querySelectorAll<HTMLInputElement>(".audit-row-cb").forEach(cb => {
          cb.checked = selAllCb.checked;
        });
        updateBatchBar();
      });
    }
    wrap.querySelectorAll<HTMLInputElement>(".audit-row-cb").forEach(cb => {
      cb.addEventListener("change", updateBatchBar);
    });

    if (moreBtn) moreBtn.style.display = this._auditHasMore ? "" : "none";
    if (batchBar) batchBar.style.display = "none"; // hidden until selection
  }

  // ─── V1.3 — Batch audit actions ────────────────────────────────────────────

  private _getSelectedLinkIds(root: HTMLElement): number[] {
    return Array.from(root.querySelectorAll<HTMLInputElement>(".audit-row-cb:checked"))
      .map(cb => Number(cb.dataset.id))
      .filter(id => Number.isFinite(id));
  }

  private async _runBatchAction(
    root: HTMLElement,
    action: "set_status" | "delete",
    status: "accepted" | "rejected" | null
  ): Promise<void> {
    if (!this._conn) return;
    const ids = this._getSelectedLinkIds(root);
    if (ids.length === 0) return;

    if (action === "delete") {
      if (!confirm(`Supprimer ${ids.length} lien(s) sélectionné(s) ? Cette action est irréversible.`)) return;
    }

    const actions: AlignBatchAction[] = ids.map(id =>
      action === "delete" ? { action: "delete", link_id: id } : { action: "set_status", link_id: id, status }
    );

    try {
      const res = await batchUpdateAlignLinks(this._conn, actions);
      if (action === "delete") {
        this._auditLinks = this._auditLinks.filter(l => !ids.includes(l.link_id));
        this._log(`✓ ${res.deleted} lien(s) supprimé(s) en lot.`);
        this._showToast?.(`✓ ${res.deleted} lien(s) supprimé(s)`);
      } else {
        for (const l of this._auditLinks) {
          if (ids.includes(l.link_id)) l.status = status;
        }
        const label = status === "accepted" ? "accepté(s)" : status === "rejected" ? "rejeté(s)" : "réinitialisé(s)";
        this._log(`✓ ${res.applied} lien(s) ${label} en lot.${res.errors.length > 0 ? ` (${res.errors.length} erreur(s))` : ""}`);
        this._showToast?.(`✓ ${res.applied} lien(s) ${label}`);
      }
      this._renderAuditTable(root);
    } catch (err) {
      this._log(`✗ Opération lot : ${err instanceof SidecarError ? err.message : String(err)}`, true);
      this._showToast?.("✗ Erreur opération lot", true);
    }
  }

  // ─── V1.4 — Retarget modal ─────────────────────────────────────────────────

  private async _openRetargetModal(linkId: number, pivotUnitId: number, root: HTMLElement): Promise<void> {
    if (!this._conn) return;
    const link = this._auditLinks.find(l => l.link_id === linkId);
    if (!link) return;

    // Determine target_doc_id from stored audit context
    const targetDocId = this._auditTargetId;
    if (!targetDocId) return;

    // Fetch candidates
    let candidates: RetargetCandidate[] = [];
    try {
      const res = await retargetCandidates(this._conn, { pivot_unit_id: pivotUnitId, target_doc_id: targetDocId, limit: 10 });
      candidates = res.candidates;
    } catch (err) {
      this._log(`✗ Candidats retarget : ${err instanceof SidecarError ? err.message : String(err)}`, true);
      return;
    }

    // Build modal
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9999";

    const modal = document.createElement("div");
    modal.style.cssText = "background:#fff;border-radius:8px;padding:1.2rem 1.4rem;min-width:340px;max-width:520px;max-height:80vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.18)";
    modal.innerHTML = `<h3 style="margin:0 0 .7rem">Reciblaer le lien #${linkId}</h3>
      <p style="font-size:.83rem;color:#666;margin:0 0 .7rem">Pivot : <em>${_escHtml(String(link.pivot_text ?? ""))}</em></p>
      <p style="font-size:.83rem;color:#666;margin:0 0 .8rem">Actuel : <em>${_escHtml(String(link.target_text ?? ""))}</em></p>
      <div id="retarget-cands"></div>
      <div style="display:flex;gap:.5rem;margin-top:1rem;justify-content:flex-end">
        <button class="btn btn-secondary" id="retarget-cancel-btn">Annuler</button>
        <button class="btn btn-primary" id="retarget-apply-btn">Appliquer</button>
      </div>`;

    const candsDiv = modal.querySelector<HTMLElement>("#retarget-cands")!;
    if (candidates.length === 0) {
      candsDiv.innerHTML = `<p style="color:#888;font-size:.85rem">Aucun candidat trouvé.</p>`;
    } else {
      for (const c of candidates) {
        const label = document.createElement("label");
        label.style.cssText = "display:flex;align-items:flex-start;gap:.4rem;padding:.3rem .25rem;border-bottom:1px solid #eee;cursor:pointer;font-size:.88rem";
        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = "retarget-cand";
        radio.value = String(c.target_unit_id);
        radio.style.marginTop = "2px";
        label.appendChild(radio);
        label.appendChild(document.createTextNode(
          `[${c.external_id ?? "—"}] ${c.target_text} — score ${c.score.toFixed(2)} (${c.reason})`
        ));
        candsDiv.appendChild(label);
      }
    }

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const close = () => document.body.removeChild(overlay);

    modal.querySelector("#retarget-cancel-btn")!.addEventListener("click", close);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

    modal.querySelector("#retarget-apply-btn")!.addEventListener("click", async () => {
      const chosen = modal.querySelector<HTMLInputElement>("input[name='retarget-cand']:checked");
      if (!chosen) { alert("Sélectionnez un candidat."); return; }
      const newTargetUnitId = Number(chosen.value);
      try {
        await retargetAlignLink(this._conn!, { link_id: linkId, new_target_unit_id: newTargetUnitId });
        // Update in-memory
        const cand = candidates.find(c => c.target_unit_id === newTargetUnitId);
        if (link && cand) link.target_text = cand.target_text;
        this._renderAuditTable(root);
        this._log(`✓ Lien #${linkId} reciblé → unité ${newTargetUnitId}.`);
        this._showToast?.(`✓ Lien #${linkId} reciblé`);
        close();
      } catch (err) {
        this._log(`✗ Retarget : ${err instanceof SidecarError ? err.message : String(err)}`, true);
      }
    });
  }

  // ─── Align quality metrics ─────────────────────────────────────────────────

  private async _runAlignQuality(root: HTMLElement): Promise<void> {
    if (!this._conn) return;
    const pivotSel = root.querySelector<HTMLSelectElement>("#act-quality-pivot");
    const targetSel = root.querySelector<HTMLSelectElement>("#act-quality-target");
    const pivot = pivotSel?.value ? parseInt(pivotSel.value) : null;
    const target = targetSel?.value ? parseInt(targetSel.value) : null;
    if (!pivot || !target) {
      this._log("Qualité : sélectionnez un doc pivot et un doc cible.", true);
      return;
    }
    const btn = root.querySelector<HTMLButtonElement>("#act-quality-btn")!;
    btn.disabled = true;
    btn.textContent = "Calcul…";
    this._log(`Calcul métriques qualité pivot #${pivot} ↔ cible #${target}…`);
    try {
      const res: AlignQualityResponse = await alignQuality(this._conn, pivot, target);
      const s = res.stats;
      const resultEl = root.querySelector<HTMLElement>("#act-quality-result")!;
      resultEl.style.display = "";
      resultEl.innerHTML = `
        <div class="quality-stats-grid">
          <div class="quality-stat">
            <span class="quality-label">Couverture pivot</span>
            <span class="quality-value ${s.coverage_pct >= 90 ? "ok" : s.coverage_pct >= 60 ? "warn" : "err"}">
              ${s.coverage_pct}% (${s.covered_pivot_units}/${s.total_pivot_units})
            </span>
          </div>
          <div class="quality-stat">
            <span class="quality-label">Liens total</span>
            <span class="quality-value">${s.total_links}</span>
          </div>
          <div class="quality-stat">
            <span class="quality-label">Orphelins pivot</span>
            <span class="quality-value ${s.orphan_pivot_count === 0 ? "ok" : "warn"}">${s.orphan_pivot_count}</span>
          </div>
          <div class="quality-stat">
            <span class="quality-label">Orphelins cible</span>
            <span class="quality-value ${s.orphan_target_count === 0 ? "ok" : "warn"}">${s.orphan_target_count}</span>
          </div>
          <div class="quality-stat">
            <span class="quality-label">Collisions</span>
            <span class="quality-value ${s.collision_count === 0 ? "ok" : "err"}">${s.collision_count}</span>
          </div>
          <div class="quality-stat">
            <span class="quality-label">Statuts</span>
            <span class="quality-value">
              ✓${s.status_counts.accepted} ✗${s.status_counts.rejected} ?${s.status_counts.unreviewed}
            </span>
          </div>
        </div>
        ${res.sample_orphan_pivot.length > 0 ? `
        <details style="margin-top:0.5rem">
          <summary style="cursor:pointer;font-size:0.85rem;color:var(--text-muted)">
            Exemples orphelins pivot (${res.sample_orphan_pivot.length})
          </summary>
          <div style="font-size:0.82rem; margin-top:0.3rem">
            ${res.sample_orphan_pivot.map(o =>
              `<div>[§${o.external_id ?? "?"}] ${o.text ?? ""}</div>`
            ).join("")}
          </div>
        </details>` : ""}
        ${res.sample_orphan_target.length > 0 ? `
        <details style="margin-top:0.4rem">
          <summary style="cursor:pointer;font-size:0.85rem;color:var(--text-muted)">
            Exemples orphelins cible (${res.sample_orphan_target.length})
          </summary>
          <div style="font-size:0.82rem; margin-top:0.3rem">
            ${res.sample_orphan_target.map(o =>
              `<div>[§${o.external_id ?? "?"}] ${o.text ?? ""}</div>`
            ).join("")}
          </div>
        </details>` : ""}
      `;
      this._log(`Qualité : couverture ${s.coverage_pct}%, orphelins=${s.orphan_pivot_count}p/${s.orphan_target_count}c, collisions=${s.collision_count}`);
    } catch (err) {
      this._log(`Erreur qualité : ${err instanceof SidecarError ? err.message : String(err)}`, true);
    } finally {
      btn.disabled = false;
      btn.textContent = "Calculer métriques";
    }
  }

  // ─── Collision resolver (V1.5) ────────────────────────────────────────────

  private async _loadCollisionsPage(root: HTMLElement, append: boolean): Promise<void> {
    if (!this._conn) return;
    const pivotSel = root.querySelector<HTMLSelectElement>("#act-coll-pivot");
    const targetSel = root.querySelector<HTMLSelectElement>("#act-coll-target");
    const pivotId = parseInt(pivotSel?.value ?? "");
    const targetId = parseInt(targetSel?.value ?? "");
    if (!pivotId || !targetId) {
      this._showToast?.("Sélectionnez un pivot et une cible.", true);
      return;
    }
    if (!append) {
      this._collOffset = 0;
      this._collGroups = [];
    }
    try {
      const res = await listCollisions(this._conn, {
        pivot_doc_id: pivotId,
        target_doc_id: targetId,
        limit: this._collLimit,
        offset: this._collOffset,
      });
      this._collTotalCount = res.total_collisions;
      this._collGroups = append ? [...this._collGroups, ...res.collisions] : res.collisions;
      this._collHasMore = res.has_more;
      this._collOffset = res.next_offset;
      this._renderCollisionTable(root, targetId);
      this._log(`Collisions : ${this._collTotalCount} groupe(s) trouvé(s).`);
    } catch (err) {
      this._log(`Erreur collisions : ${err instanceof SidecarError ? err.message : String(err)}`, true);
      this._showToast?.("✗ Erreur chargement collisions", true);
    }
  }

  private _renderCollisionTable(root: HTMLElement, targetDocId: number): void {
    const resultEl = root.querySelector<HTMLElement>("#act-coll-result");
    const moreWrap = root.querySelector<HTMLElement>("#act-coll-more-wrap");
    if (!resultEl) return;
    resultEl.style.display = "";

    if (this._collGroups.length === 0) {
      resultEl.innerHTML = `<p class="hint">✓ Aucune collision détectée.</p>`;
      if (moreWrap) moreWrap.style.display = "none";
      return;
    }

    const header = `<p style="margin-bottom:0.5rem;font-size:0.88rem;color:var(--text-muted)">
      ${this._collTotalCount} groupe(s) de collision — ${this._collGroups.length} affiché(s)</p>`;

    const groupHtml = this._collGroups.map((g) => {
      const linksHtml = g.links.map((lnk) => {
        const badge = lnk.status === "accepted"
          ? `<span class="status-badge status-ok">✅ Accepté</span>`
          : lnk.status === "rejected"
          ? `<span class="status-badge status-error">❌ Rejeté</span>`
          : `<span class="status-badge status-unknown">🔵 Non révisé</span>`;
        return `<tr>
          <td class="audit-cell-text">${lnk.target_text}</td>
          <td>[§${lnk.target_external_id ?? "?"}]</td>
          <td>${badge}</td>
          <td class="audit-cell-actions">
            <button class="btn btn-sm btn-primary coll-keep-btn" data-link="${lnk.link_id}" data-group="${g.pivot_unit_id}" title="Garder — marquer accepté">✓ Garder</button>
            <button class="btn btn-sm btn-secondary coll-reject-btn" data-link="${lnk.link_id}" title="Rejeter">❌ Rejeter</button>
            <button class="btn btn-sm btn-danger coll-delete-btn" data-link="${lnk.link_id}" data-group="${g.pivot_unit_id}" data-target="${targetDocId}" title="Supprimer ce lien">🗑</button>
          </td>
        </tr>`;
      }).join("");

      return `<div class="collision-group" style="margin-bottom:1rem; border:1px solid var(--border); border-radius:6px; overflow:hidden">
        <div class="collision-pivot-header" style="background:var(--surface-alt,#f5f5f5); padding:0.4rem 0.75rem; font-size:0.85rem; font-weight:600">
          [§${g.pivot_external_id ?? "?"}] ${g.pivot_text}
          <button class="btn btn-sm btn-danger coll-delete-others-btn" data-group="${g.pivot_unit_id}" data-target="${targetDocId}"
            style="float:right; font-size:0.75rem" title="Supprimer tous les liens de ce groupe">🗑 Tout supprimer</button>
        </div>
        <table class="meta-table" style="margin:0; width:100%">
          <thead><tr><th>Texte cible</th><th>Ext. id</th><th>Statut</th><th>Actions</th></tr></thead>
          <tbody>${linksHtml}</tbody>
        </table>
      </div>`;
    }).join("");

    resultEl.innerHTML = header + groupHtml;
    if (moreWrap) moreWrap.style.display = this._collHasMore ? "" : "none";

    // Wire per-link actions
    const self = this;
    resultEl.querySelectorAll<HTMLButtonElement>(".coll-keep-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const linkId = parseInt(btn.dataset.link!);
        await self._resolveCollision([{ action: "keep", link_id: linkId }], root, parseInt(btn.dataset.group!), targetDocId);
      });
    });
    resultEl.querySelectorAll<HTMLButtonElement>(".coll-reject-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const linkId = parseInt(btn.dataset.link!);
        await self._resolveCollision([{ action: "reject", link_id: linkId }], root, null, targetDocId);
      });
    });
    resultEl.querySelectorAll<HTMLButtonElement>(".coll-delete-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const linkId = parseInt(btn.dataset.link!);
        const pivotUid = parseInt(btn.dataset.group!);
        await self._resolveCollision([{ action: "delete", link_id: linkId }], root, pivotUid, targetDocId);
      });
    });
    resultEl.querySelectorAll<HTMLButtonElement>(".coll-delete-others-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const pivotUid = parseInt(btn.dataset.group!);
        const targetDoc = parseInt(btn.dataset.target!);
        const group = self._collGroups.find(g => g.pivot_unit_id === pivotUid);
        if (!group) return;
        const actions = group.links.map(lnk => ({ action: "delete" as const, link_id: lnk.link_id }));
        await self._resolveCollision(actions, root, pivotUid, targetDoc);
      });
    });
  }

  private async _resolveCollision(
    actions: Array<{ action: "keep" | "delete" | "reject" | "unreviewed"; link_id: number }>,
    root: HTMLElement,
    pivotUnitId: number | null,
    targetDocId: number,
  ): Promise<void> {
    if (!this._conn) return;
    try {
      const res = await resolveCollisions(this._conn, actions);
      if (res.errors.length > 0) {
        this._showToast?.(`⚠ ${res.errors.length} erreur(s)`, true);
      } else {
        this._showToast?.(`✓ Résolution appliquée (${res.applied} modif., ${res.deleted} suppr.)`);
      }
      // Reload collision list to reflect changes
      this._collOffset = 0;
      this._collGroups = [];
      await this._loadCollisionsPage(root, false);
    } catch (err) {
      this._log(`Erreur résolution collision : ${err instanceof SidecarError ? err.message : String(err)}`, true);
      this._showToast?.("✗ Erreur résolution collision", true);
    }
  }

  // ─── Validate meta + index ────────────────────────────────────────────────

  private async _runValidateMeta(): Promise<void> {
    if (!this._conn) return;
    const docSel = (document.querySelector("#act-meta-doc") as HTMLSelectElement)?.value;
    const docId = docSel ? parseInt(docSel) : undefined;
    const label = docId !== undefined ? `doc #${docId}` : "tous les documents";
    this._log(`Validation métadonnées de ${label} (job asynchrone)…`);
    const params: Record<string, unknown> = {};
    if (docId !== undefined) params.doc_id = docId;
    try {
      const job = await enqueueJob(this._conn, "validate-meta", params);
      this._jobCenter?.trackJob(job.job_id, `Validation méta ${label}`, (done) => {
        if (done.status === "done") {
          const results = (done.result as { results?: Array<{ doc_id: number; is_valid: boolean; warnings: string[] }> } | undefined)?.results ?? [];
          const invalid = results.filter(r => !r.is_valid);
          if (invalid.length === 0) {
            this._log(`✓ Métadonnées valides (${results.length} doc(s)).`);
            this._showToast?.("✓ Métadonnées valides");
          } else {
            for (const r of invalid) {
              this._log(`⚠ doc #${r.doc_id}: ${r.warnings.join(", ")}`, true);
            }
            this._showToast?.(`⚠ ${invalid.length} doc(s) invalide(s)`, true);
          }
        } else {
          this._log(`✗ Validation : ${done.error ?? done.status}`, true);
          this._showToast?.("✗ Erreur validation méta", true);
        }
      });
    } catch (err) {
      this._log(`✗ Validation : ${err instanceof SidecarError ? err.message : String(err)}`, true);
    }
  }

  private async _runIndex(): Promise<void> {
    if (!this._conn) return;
    this._setBusy(true);
    this._log("Reconstruction de l'index FTS (job asynchrone)…");
    try {
      const job = await enqueueJob(this._conn, "index", {});
      this._log(`Job index soumis (${job.job_id.slice(0, 8)}…)`);
      this._jobCenter?.trackJob(job.job_id, "Rebuild index FTS", (done) => {
        if (done.status === "done") {
          const n = (done.result as { units_indexed?: number } | undefined)?.units_indexed ?? "?";
          this._log(`✓ Index reconstruit — ${n} unités indexées.`);
          const reindexBtn = document.querySelector("#act-reindex-after-curate-btn") as HTMLElement | null;
          if (reindexBtn) reindexBtn.style.display = "none";
          this._showToast?.(`✓ Index reconstruit (${n} unités)`);
        } else {
          this._log(`✗ Index : ${done.error ?? done.status}`, true);
          this._showToast?.("✗ Erreur index FTS", true);
        }
        this._setBusy(false);
      });
    } catch (err) {
      this._log(`✗ Index : ${err instanceof SidecarError ? err.message : String(err)}`, true);
      this._setBusy(false);
    }
  }

  // ─── V0.4C — Audit link actions ──────────────────────────────────────────────

  private async _updateLinkStatus(linkId: number, status: "accepted" | "rejected", root: HTMLElement): Promise<void> {
    if (!this._conn) return;
    try {
      await updateAlignLinkStatus(this._conn, { link_id: linkId, status });
      // Update in-memory link status
      const link = this._auditLinks.find(l => l.link_id === linkId);
      if (link) link.status = status;
      this._renderAuditTable(root);
      this._log(`✓ Lien #${linkId} marqué "${status}".`);
    } catch (err) {
      this._log(`✗ Mise à jour statut : ${err instanceof SidecarError ? err.message : String(err)}`, true);
    }
  }

  private async _deleteLinkFromAudit(linkId: number, root: HTMLElement): Promise<void> {
    if (!this._conn) return;
    if (!confirm(`Supprimer le lien d'alignement #${linkId} ? Cette action est irréversible.`)) return;
    try {
      await deleteAlignLink(this._conn, { link_id: linkId });
      this._auditLinks = this._auditLinks.filter(l => l.link_id !== linkId);
      this._renderAuditTable(root);
      this._log(`✓ Lien #${linkId} supprimé.`);
    } catch (err) {
      this._log(`✗ Suppression : ${err instanceof SidecarError ? err.message : String(err)}`, true);
    }
  }
}

// ─── Utility helpers ──────────────────────────────────────────────────────────

function _escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Highlight words in `after` that differ from `before`.
 * Simple word-level diff: words not present in before set get a <mark>.
 */
function _highlightChanges(before: string, after: string): string {
  const beforeWords = new Set(before.toLowerCase().split(/\s+/));
  return after
    .split(/(\s+)/)
    .map(token => {
      if (/^\s+$/.test(token)) return token;
      if (!beforeWords.has(token.toLowerCase())) {
        return `<mark class="diff-mark">${_escHtml(token)}</mark>`;
      }
      return _escHtml(token);
    })
    .join("");
}

function _formatMaybeNumber(v: unknown): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "n/a";
  return v.toFixed(3);
}

function _isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

async function _copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fallback below
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "true");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
