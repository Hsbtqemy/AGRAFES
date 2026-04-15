/**
 * AlignPanel.ts — Panneau d'alignement refactorisé.
 *
 * Améliorations :
 *  - Layout 2 colonnes : Configuration (gauche) | Audit / Résultats (droite)
 *  - Mode Famille : sélecteur famille → pivot + cibles auto-remplis
 *  - Propagation famille via POST /families/{id}/align
 *  - Plus de window.confirm : bannière de confirmation inline
 *  - Chargement automatique de l'audit dès la fin du run
 *  - Suppressions/modifications en lot sans pop-up natif
 */

import {
  enqueueJob,
  alignFamily,
  getFamilies,
  alignAudit,
  alignQuality,
  updateAlignLinkStatus,
  deleteAlignLink,
  batchUpdateAlignLinks,
  type Conn,
  type DocumentRecord,
  type FamilyRecord,
  type FamilyAlignResponse,
  type FamilyAlignOptions,
  type AlignLinkRecord,
  type AlignBatchAction,
  type AlignQualityStats,
} from "../lib/sidecarClient.ts";
import type { JobCenter } from "../components/JobCenter.ts";

// ─── Types locaux ─────────────────────────────────────────────────────────────

type AlignStrategy = "external_id" | "external_id_then_position" | "position" | "similarity";
type AlignMode = "famille" | "manuel";

export interface AlignPanelCallbacks {
  log: (msg: string, isError?: boolean) => void;
  toast: (msg: string, isError?: boolean) => void;
  setBusy: (v: boolean) => void;
  jobCenter: () => JobCenter | null;
  /** Appelé après run réussi (pour MAJ sélects qualité/collision dans ActionsScreen) */
  onRunDone: (pivotId: number, targetIds: number[]) => void;
  onNav: (target: string) => void;
}

interface RunSummary {
  created: number;
  skipped: number;
  deleted?: number;
  preserved?: number;
  effective?: number;
  perTarget: Array<{ doc_id: number; created: number; skipped: number }>;
}

// ─── AlignPanel ───────────────────────────────────────────────────────────────

export class AlignPanel {
  private _conn: () => Conn | null;
  private _getDocs: () => DocumentRecord[];
  private _cb: AlignPanelCallbacks;
  private _mode: AlignMode = "famille";
  private _families: FamilyRecord[] = [];
  private _pendingConfirm: (() => void) | null = null;
  private _el: HTMLElement | null = null;

  // Audit state
  private _auditLinks: AlignLinkRecord[] = [];
  private _auditOffset = 0;
  private _auditHasMore = false;
  private _auditQuickFilter: "all" | "review" | "unreviewed" | "rejected" = "review";
  private _auditTextFilter = "";
  private _selectedLinkId: number | null = null;
  private _selectedLinkIds = new Set<number>();

  constructor(
    conn: () => Conn | null,
    getDocs: () => DocumentRecord[],
    cb: AlignPanelCallbacks,
  ) {
    this._conn = conn;
    this._getDocs = getDocs;
    this._cb = cb;
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  render(): HTMLElement {
    const el = document.createElement("div");
    el.className = "align-v2-root";
    el.innerHTML = this._html();
    this._el = el;
    this._bindEvents(el);
    this._populateManualSelects(el);
    void this._loadFamilies(el);
    return el;
  }

  refreshDocs(): void {
    if (!this._el) return;
    this._populateManualSelects(this._el);
    this._populateFamilySelect(this._el);
    this._populateAuditSelects(this._el);
  }

  // ─── HTML template ──────────────────────────────────────────────────────────

  private _html(): string {
    return `
<div class="prep-align-v2-layout">

  <!-- ═══ Colonne gauche : Configuration ═══ -->
  <div class="prep-align-v2-config">

    <div class="prep-align-v2-config-head">
      <h3>Configuration du run</h3>
      <div class="prep-align-mode-toggle" role="group" aria-label="Mode">
        <button class="prep-align-mode-btn active" data-mode="famille">📁 Par famille</button>
        <button class="prep-align-mode-btn" data-mode="manuel">🔧 Manuel</button>
      </div>
    </div>

    <!-- Mode Famille -->
    <div id="align-famille-section" class="prep-align-config-section">
      <div class="prep-align-field-row">
        <label class="prep-align-field-label">Famille</label>
        <div style="display:flex;gap:6px;align-items:center">
          <select id="align-family-sel" class="prep-align-select" style="flex:1">
            <option value="">— choisir une famille —</option>
          </select>
          <button id="align-family-refresh" class="btn btn-sm btn-ghost" title="Rafraîchir">⟳</button>
        </div>
      </div>
      <div id="align-family-preview" class="prep-align-family-preview" style="display:none">
        <div class="prep-align-fp-row">
          <span class="prep-align-fp-label">Pivot</span>
          <span id="align-fp-pivot" class="prep-align-fp-value">—</span>
        </div>
        <div class="prep-align-fp-row" style="align-items:flex-start">
          <span class="prep-align-fp-label">Cibles</span>
          <div id="align-fp-targets" class="prep-align-fp-value" style="flex-wrap:wrap;gap:4px"></div>
        </div>
        <div id="align-family-stats" class="prep-align-family-stats"></div>
      </div>
    </div>

    <!-- Mode Manuel -->
    <div id="align-manuel-section" class="prep-align-config-section" style="display:none">
      <div class="prep-align-field-row">
        <label class="prep-align-field-label">Pivot</label>
        <select id="align-pivot-sel" class="prep-align-select">
          <option value="">— choisir —</option>
        </select>
      </div>
      <div class="prep-align-field-row">
        <label class="prep-align-field-label">Cible(s) <span style="font-weight:400;font-size:0.72rem">(Ctrl+clic)</span></label>
        <select id="align-targets-sel" class="prep-align-select" multiple size="4"></select>
      </div>
    </div>

    <!-- Stratégie + options (communs) -->
    <div class="prep-align-config-section prep-align-options-section">
      <div class="prep-align-field-row">
        <label class="prep-align-field-label">Stratégie</label>
        <select id="align-strategy-sel" class="prep-align-select">
          <option value="external_id">external_id</option>
          <option value="external_id_then_position" selected>external_id → position (hybride)</option>
          <option value="position">position</option>
          <option value="similarity">similarité</option>
        </select>
      </div>
      <div id="align-sim-row" class="prep-align-field-row" style="display:none">
        <label class="prep-align-field-label">Seuil similarité</label>
        <input id="align-sim-threshold" type="number" class="prep-align-input-num"
               min="0" max="1" step="0.05" value="0.8"/>
      </div>
      <div class="prep-align-checks-row">
        <label class="prep-align-check-label">
          <input id="align-preserve-accepted" type="checkbox" checked/>
          Conserver les liens validés
        </label>
        <label class="prep-align-check-label">
          <input id="align-debug-cb" type="checkbox"/>
          Explainability debug
        </label>
        <label class="prep-align-check-label" id="align-skip-unready-wrap">
          <input id="align-skip-unready" type="checkbox" checked/>
          Ignorer les cibles non segmentées
        </label>
      </div>
    </div>

    <!-- Bannière de confirmation inline -->
    <div id="align-confirm-banner" class="prep-align-confirm-banner" style="display:none">
      <div id="align-confirm-msg" class="prep-align-confirm-msg"></div>
      <div class="prep-align-confirm-btns">
        <button id="align-confirm-ok" class="btn btn-warning btn-sm">▶ Confirmer</button>
        <button id="align-confirm-cancel" class="btn btn-ghost btn-sm">Annuler</button>
      </div>
    </div>

    <!-- Boutons lancement -->
    <div id="align-launch-btns" class="prep-align-launch-row">
      <button id="align-run-btn" class="btn btn-warning" disabled>▶ Lancer l'alignement</button>
      <button id="align-recalc-btn" class="btn btn-secondary" disabled>↺ Recalcul global</button>
    </div>

    <!-- Progression pendant run -->
    <div id="align-progress-area" class="prep-align-progress-area" style="display:none">
      <div class="prep-align-progress-spinner">⏳</div>
      <div id="align-progress-msg" class="prep-align-progress-msg">Alignement en cours…</div>
    </div>

    <!-- Résumé KPI après run -->
    <div id="align-summary" class="prep-align-summary" style="display:none">
      <div class="prep-align-summary-head">
        <span class="prep-align-summary-title">Résultats du run</span>
        <button id="align-summary-recalc" class="btn btn-ghost btn-sm">↺ Recalcul</button>
      </div>
      <div id="align-summary-banner" class="prep-align-summary-banner"></div>
      <div class="prep-align-kpi-row">
        <div class="prep-align-kpi-card">
          <div class="prep-align-kpi-val" id="align-kpi-created">—</div>
          <div class="prep-align-kpi-lbl">Créés</div>
        </div>
        <div class="prep-align-kpi-card">
          <div class="prep-align-kpi-val" id="align-kpi-skipped">—</div>
          <div class="prep-align-kpi-lbl">Ignorés</div>
        </div>
        <div class="prep-align-kpi-card" id="align-kpi-effective-wrap" style="display:none">
          <div class="prep-align-kpi-val" id="align-kpi-effective">—</div>
          <div class="prep-align-kpi-lbl">Effectifs</div>
        </div>
        <div class="prep-align-kpi-card prep-align-kpi-card--coverage" id="align-kpi-coverage-wrap" title="Part des segments pivot ayant au moins un lien. ≥ 90 % = bon ; ≥ 60 % = acceptable.">
          <div class="prep-align-kpi-val" id="align-kpi-coverage">…</div>
          <div class="prep-align-kpi-lbl">Couverture</div>
        </div>
      </div>
      <div id="align-summary-per-target" class="prep-align-summary-per-target"></div>
      <!-- Métriques de debug (orphelins, collisions, statuts) -->
      <details id="align-quality-details" class="prep-align-quality-details" style="display:none">
        <summary class="prep-align-quality-details-summary">Détails qualité ▸</summary>
        <div id="align-quality-details-body" class="prep-align-quality-details-body"></div>
      </details>
    </div>

  </div><!-- /align-v2-config -->

  <!-- ═══ Colonne droite : Audit / Vérification ═══ -->
  <div class="prep-align-v2-results">

    <div class="prep-align-v2-results-head">
      <h3>Vérification des liens</h3>
      <div class="prep-align-audit-toolbar">
        <div class="prep-align-audit-qf-chips" role="group">
          <button class="chip" data-qf="all">Tout</button>
          <button class="chip active" data-qf="review">À revoir</button>
          <button class="chip" data-qf="unreviewed">Non révisés</button>
          <button class="chip" data-qf="rejected">Rejetés</button>
        </div>
        <button id="align-audit-load-btn" class="btn btn-sm btn-secondary">Charger les liens</button>
        <button id="align-audit-next-btn" class="btn btn-sm btn-ghost">Suivant ↓</button>
      </div>
    </div>

    <!-- Filtres audit -->
    <div class="prep-align-audit-filters">
      <label class="prep-align-filter-group">
        <span class="prep-align-field-label">Pivot</span>
        <select id="align-audit-pivot" class="prep-align-select-sm">
          <option value="">— —</option>
        </select>
      </label>
      <label class="prep-align-filter-group">
        <span class="prep-align-field-label">Cible</span>
        <select id="align-audit-target" class="prep-align-select-sm">
          <option value="">— —</option>
        </select>
      </label>
      <label class="prep-align-filter-group">
        <span class="prep-align-field-label">Statut</span>
        <select id="align-audit-status" class="prep-align-select-sm">
          <option value="">Tous</option>
          <option value="unreviewed">Non révisés</option>
          <option value="accepted">Acceptés</option>
          <option value="rejected">Rejetés</option>
        </select>
      </label>
      <label class="prep-align-filter-group">
        <span class="prep-align-field-label">Texte</span>
        <input id="align-audit-text" type="text" class="prep-align-input-text" placeholder="mot clé…"/>
      </label>
    </div>

    <div id="align-audit-stats" class="prep-align-audit-stats"></div>

    <!-- Tableau des liens -->
    <div id="align-audit-table-wrap" class="prep-align-audit-table-wrap">
      <p class="empty-hint">Lancez un alignement ou cliquez sur « Charger les liens ».</p>
    </div>

    <!-- Barre d'actions en lot -->
    <div id="align-batch-bar" class="prep-align-batch-bar" style="display:none">
      <span id="align-batch-count">0 sélectionné(s)</span>
      <button id="align-batch-accept" class="btn btn-sm btn-secondary">✓ Accepter</button>
      <button id="align-batch-reject" class="btn btn-sm btn-secondary">✗ Rejeter</button>
      <button id="align-batch-unreview" class="btn btn-sm btn-secondary">? Non révisé</button>
      <button id="align-batch-delete" class="btn btn-sm btn-danger">Supprimer</button>
    </div>

    <div class="prep-align-audit-load-more">
      <button id="align-audit-more-btn" class="btn btn-sm btn-secondary" style="display:none">Charger plus</button>
    </div>

    <!-- Panneau focus (correction ciblée) -->
    <div id="align-focus-panel" class="prep-align-focus-panel" style="display:none">
      <div class="prep-align-focus-head">
        <strong id="align-focus-meta"></strong>
        <button id="align-focus-close" class="btn btn-ghost btn-sm">✕</button>
      </div>
      <div class="prep-align-focus-texts">
        <div class="prep-align-focus-text-block">
          <div class="prep-align-focus-text-label">Pivot</div>
          <div id="align-focus-pivot-text" class="prep-align-focus-text"></div>
        </div>
        <div class="prep-align-focus-text-block">
          <div class="prep-align-focus-text-label">Cible</div>
          <div id="align-focus-target-text" class="prep-align-focus-text"></div>
        </div>
      </div>
      <div class="prep-align-focus-actions">
        <button data-focus-action="accepted" class="btn btn-sm btn-secondary">✓ Valider</button>
        <button data-focus-action="rejected" class="btn btn-sm btn-secondary">✗ À revoir</button>
        <button data-focus-action="unreviewed" class="btn btn-sm btn-secondary">? Non révisé</button>
        <button data-focus-action="delete" class="btn btn-sm btn-danger">Supprimer</button>
      </div>
    </div>

  </div><!-- /align-v2-results -->
</div><!-- /align-v2-layout -->
    `;
  }

  // ─── Event binding ──────────────────────────────────────────────────────────

  private _bindEvents(el: HTMLElement): void {
    el.querySelectorAll<HTMLButtonElement>(".prep-align-mode-btn").forEach(btn => {
      btn.addEventListener("click", () => this._setMode(btn.dataset.mode as AlignMode, el));
    });

    el.querySelector("#align-strategy-sel")!.addEventListener("change", (e) => {
      const v = (e.target as HTMLSelectElement).value;
      (el.querySelector("#align-sim-row") as HTMLElement).style.display =
        v === "similarity" ? "" : "none";
    });

    el.querySelector("#align-family-sel")!.addEventListener("change", () =>
      this._onFamilyChange(el));
    el.querySelector("#align-family-refresh")!.addEventListener("click", () =>
      void this._loadFamilies(el));

    el.querySelector("#align-run-btn")!.addEventListener("click", () =>
      this._askConfirm(el, false));
    el.querySelector("#align-recalc-btn")!.addEventListener("click", () =>
      this._askConfirm(el, true));
    el.querySelector("#align-summary-recalc")!.addEventListener("click", () =>
      this._askConfirm(el, true));

    el.querySelector("#align-confirm-ok")!.addEventListener("click", () => {
      const fn = this._pendingConfirm;
      this._pendingConfirm = null;
      this._hideConfirmBanner(el);
      fn?.();
    });
    el.querySelector("#align-confirm-cancel")!.addEventListener("click", () => {
      this._pendingConfirm = null;
      this._hideConfirmBanner(el);
    });

    // Pivot/target selects (mode manuel)
    el.querySelector("#align-pivot-sel")?.addEventListener("change", () =>
      this._updateRunBtnState(el));
    el.querySelector("#align-targets-sel")?.addEventListener("change", () =>
      this._updateRunBtnState(el));

    // Audit quick-filter chips
    el.querySelectorAll<HTMLButtonElement>("[data-qf]").forEach(btn => {
      btn.addEventListener("click", () => {
        el.querySelectorAll("[data-qf]").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        this._auditQuickFilter = (btn.dataset.qf ?? "all") as typeof this._auditQuickFilter;
        this._renderAuditTable(el);
      });
    });

    el.querySelector("#align-audit-load-btn")!.addEventListener("click", () => {
      this._auditOffset = 0;
      this._auditLinks = [];
      void this._loadAuditPage(el, false);
    });
    el.querySelector("#align-audit-more-btn")!.addEventListener("click", () =>
      void this._loadAuditPage(el, true));
    el.querySelector("#align-audit-next-btn")?.addEventListener("click", () =>
      this._focusNextException(el));

    const textFilter = el.querySelector<HTMLInputElement>("#align-audit-text");
    textFilter?.addEventListener("input", () => {
      this._auditTextFilter = textFilter.value.trim().toLowerCase();
      this._renderAuditTable(el);
    });

    ["#align-audit-pivot", "#align-audit-target", "#align-audit-status"].forEach(id => {
      el.querySelector(id)?.addEventListener("change", () => {
        this._auditOffset = 0;
        this._auditLinks = [];
        void this._loadAuditPage(el, false);
      });
    });

    el.querySelector("#align-batch-accept")!.addEventListener("click", () =>
      void this._batchAction(el, "accepted"));
    el.querySelector("#align-batch-reject")!.addEventListener("click", () =>
      void this._batchAction(el, "rejected"));
    el.querySelector("#align-batch-unreview")!.addEventListener("click", () =>
      void this._batchAction(el, null));
    el.querySelector("#align-batch-delete")!.addEventListener("click", () =>
      void this._batchDeleteSelected(el));

    el.querySelector("#align-focus-close")?.addEventListener("click", () =>
      this._closeFocus(el));
    el.querySelectorAll<HTMLButtonElement>("[data-focus-action]").forEach(btn => {
      btn.addEventListener("click", () => {
        const action = btn.dataset.focusAction!;
        if (action === "delete") void this._focusDelete(el);
        else void this._focusSetStatus(el, action === "unreviewed" ? null : action as "accepted" | "rejected");
      });
    });
  }

  // ─── Mode ───────────────────────────────────────────────────────────────────

  private _setMode(mode: AlignMode, el: HTMLElement): void {
    this._mode = mode;
    el.querySelectorAll<HTMLButtonElement>(".prep-align-mode-btn").forEach(btn =>
      btn.classList.toggle("active", btn.dataset.mode === mode));
    (el.querySelector("#align-famille-section") as HTMLElement).style.display =
      mode === "famille" ? "" : "none";
    (el.querySelector("#align-manuel-section") as HTMLElement).style.display =
      mode === "manuel" ? "" : "none";
    (el.querySelector("#align-skip-unready-wrap") as HTMLElement).style.display =
      mode === "famille" ? "" : "none";
    if (mode === "manuel") this._populateManualSelects(el);
    this._updateRunBtnState(el);
  }

  // ─── Familles ────────────────────────────────────────────────────────────────

  private async _loadFamilies(el: HTMLElement): Promise<void> {
    const conn = this._conn();
    if (!conn) return;
    try {
      this._families = await getFamilies(conn);
      this._populateFamilySelect(el);
    } catch (e) {
      this._cb.log(`⚠ Chargement familles : ${e instanceof Error ? e.message : String(e)}`, true);
    }
  }

  private _populateFamilySelect(el: HTMLElement): void {
    const sel = el.querySelector<HTMLSelectElement>("#align-family-sel");
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = `<option value="">— choisir une famille —</option>`;
    for (const fam of this._families) {
      const parentTitle = fam.parent?.title ?? `Famille #${fam.family_id}`;
      const n = fam.children.length;
      const { aligned_pairs, total_pairs } = fam.stats;
      const opt = document.createElement("option");
      opt.value = String(fam.family_id);
      opt.textContent = `${parentTitle} (${n} enfant${n > 1 ? "s" : ""} · ${aligned_pairs}/${total_pairs} paires)`;
      if (String(fam.family_id) === prev) opt.selected = true;
      sel.appendChild(opt);
    }
    if (prev && sel.value === prev) this._onFamilyChange(el);
    this._updateRunBtnState(el);
  }

  private _onFamilyChange(el: HTMLElement): void {
    const famId = parseInt((el.querySelector<HTMLSelectElement>("#align-family-sel"))?.value ?? "");
    const preview = el.querySelector<HTMLElement>("#align-family-preview");
    if (!preview) return;
    if (isNaN(famId)) { preview.style.display = "none"; this._updateRunBtnState(el); return; }

    const fam = this._families.find(f => f.family_id === famId);
    if (!fam) { preview.style.display = "none"; return; }
    preview.style.display = "";

    const pivotEl = el.querySelector("#align-fp-pivot");
    const targetsEl = el.querySelector("#align-fp-targets");
    const statsEl = el.querySelector("#align-family-stats");

    if (pivotEl) pivotEl.textContent = fam.parent?.title ?? `#${fam.family_id}`;
    if (targetsEl) {
      targetsEl.innerHTML = fam.children.map(c => {
        const doc = c.doc;
        const lang = doc?.language ? ` (${doc.language})` : "";
        const seg = c.segmented
          ? `<span class="prep-align-fp-tag-ok">✓ segmenté</span>`
          : `<span class="prep-align-fp-tag-warn">⚠ non segmenté</span>`;
        return `<span class="prep-align-fp-child">${_esc(doc?.title ?? `#${c.doc_id}`)}${lang} ${seg}</span>`;
      }).join("");
    }
    if (statsEl) {
      const { aligned_pairs, total_pairs, completion_pct } = fam.stats;
      statsEl.innerHTML = `<span class="prep-align-fp-stat">${aligned_pairs}/${total_pairs} paires alignées · ${completion_pct.toFixed(0)} %</span>`;
      if (fam.stats.ratio_warnings.length > 0) {
        statsEl.innerHTML += `<span class="prep-align-fp-warn"> · ⚠ ${fam.stats.ratio_warnings.length} ratio(s) inhabituels</span>`;
      }
    }
    this._updateRunBtnState(el);
  }

  // ─── Mode manuel — sélects docs ─────────────────────────────────────────────

  private _populateManualSelects(el: HTMLElement): void {
    const docs = this._getDocs();
    const pivSel = el.querySelector<HTMLSelectElement>("#align-pivot-sel");
    const tgtSel = el.querySelector<HTMLSelectElement>("#align-targets-sel");
    if (!pivSel || !tgtSel) return;
    const prevPiv = pivSel.value;
    const prevTgts = Array.from(tgtSel.selectedOptions).map(o => o.value);
    const fill = (sel: HTMLSelectElement, withEmpty: boolean) => {
      sel.innerHTML = withEmpty ? `<option value="">— choisir —</option>` : "";
      for (const d of docs) {
        const opt = document.createElement("option");
        opt.value = String(d.doc_id);
        opt.textContent = `${d.title} (${d.language ?? "?"})`;
        sel.appendChild(opt);
      }
    };
    fill(pivSel, true);
    fill(tgtSel, false);
    pivSel.value = prevPiv;
    prevTgts.forEach(v => {
      const o = tgtSel.querySelector<HTMLOptionElement>(`option[value="${v}"]`);
      if (o) o.selected = true;
    });
    this._updateRunBtnState(el);
  }

  private _populateAuditSelects(el: HTMLElement): void {
    const docs = this._getDocs();
    for (const id of ["#align-audit-pivot", "#align-audit-target"]) {
      const sel = el.querySelector<HTMLSelectElement>(id);
      if (!sel) continue;
      const prev = sel.value;
      sel.innerHTML = `<option value="">— —</option>`;
      for (const d of docs) {
        const opt = document.createElement("option");
        opt.value = String(d.doc_id);
        opt.textContent = `${d.title} (${d.language ?? "?"})`;
        if (String(d.doc_id) === prev) opt.selected = true;
        sel.appendChild(opt);
      }
    }
  }

  private _updateRunBtnState(el: HTMLElement): void {
    const runBtn = el.querySelector<HTMLButtonElement>("#align-run-btn");
    const recalcBtn = el.querySelector<HTMLButtonElement>("#align-recalc-btn");
    let ok = false;
    if (this._mode === "famille") {
      ok = !!el.querySelector<HTMLSelectElement>("#align-family-sel")?.value;
    } else {
      const piv = el.querySelector<HTMLSelectElement>("#align-pivot-sel")?.value;
      const tgts = el.querySelector<HTMLSelectElement>("#align-targets-sel");
      ok = !!(piv && tgts && tgts.selectedOptions.length > 0);
    }
    if (runBtn) runBtn.disabled = !ok;
    if (recalcBtn) recalcBtn.disabled = !ok;
  }

  // ─── Confirmation inline ─────────────────────────────────────────────────────

  private _askConfirm(el: HTMLElement, recalculate: boolean): void {
    const strategy = el.querySelector<HTMLSelectElement>("#align-strategy-sel")?.value ?? "?";
    const preserve = el.querySelector<HTMLInputElement>("#align-preserve-accepted")?.checked ?? true;
    const debug = el.querySelector<HTMLInputElement>("#align-debug-cb")?.checked ?? false;

    let target = "";
    if (this._mode === "famille") {
      const famId = el.querySelector<HTMLSelectElement>("#align-family-sel")?.value;
      const fam = this._families.find(f => String(f.family_id) === famId);
      target = `Famille « ${fam?.parent?.title ?? `#${famId}`} » (${fam?.children.length ?? "?"} paires)`;
    } else {
      const pivId = el.querySelector<HTMLSelectElement>("#align-pivot-sel")?.value;
      const tgtSel = el.querySelector<HTMLSelectElement>("#align-targets-sel");
      const tgtIds = tgtSel ? Array.from(tgtSel.selectedOptions).map(o => o.value) : [];
      target = `Pivot #${pivId} → cibles [${tgtIds.join(", ")}]`;
    }

    const action = recalculate ? "Recalcul global" : "Alignement";
    const msgEl = el.querySelector<HTMLElement>("#align-confirm-msg");
    const banner = el.querySelector<HTMLElement>("#align-confirm-banner");
    if (msgEl) msgEl.innerHTML =
      `<strong>${action}</strong> · ${_esc(target)}<br>
       Stratégie : <strong>${_esc(strategy)}</strong> · 
       Liens validés : <strong>${preserve ? "conservés" : "remplacés"}</strong>` +
       (debug ? " · debug" : "");
    if (banner) {
      banner.style.display = "";
      banner.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    this._pendingConfirm = () => void this._doRun(el, recalculate);
  }

  private _hideConfirmBanner(el: HTMLElement): void {
    const banner = el.querySelector<HTMLElement>("#align-confirm-banner");
    if (banner) banner.style.display = "none";
  }

  // ─── Run ────────────────────────────────────────────────────────────────────

  private async _doRun(el: HTMLElement, recalculate: boolean): Promise<void> {
    const conn = this._conn();
    if (!conn) return;
    const strategy = (el.querySelector<HTMLSelectElement>("#align-strategy-sel")?.value ?? "external_id_then_position") as AlignStrategy;
    const simThreshold = parseFloat(el.querySelector<HTMLInputElement>("#align-sim-threshold")?.value ?? "0.8") || 0.8;
    const preserveAccepted = el.querySelector<HTMLInputElement>("#align-preserve-accepted")?.checked ?? true;
    const debugAlign = el.querySelector<HTMLInputElement>("#align-debug-cb")?.checked ?? false;
    const skipUnready = el.querySelector<HTMLInputElement>("#align-skip-unready")?.checked ?? true;

    this._setRunningState(el, true);

    if (this._mode === "famille") {
      await this._doFamilyRun(el, conn, { strategy, simThreshold, preserveAccepted, debugAlign, skipUnready, recalculate });
    } else {
      await this._doManualRun(el, conn, { strategy, simThreshold, preserveAccepted, debugAlign, recalculate });
    }
  }

  private async _doFamilyRun(
    el: HTMLElement,
    conn: Conn,
    opts: { strategy: AlignStrategy; simThreshold: number; preserveAccepted: boolean; debugAlign: boolean; skipUnready: boolean; recalculate: boolean },
  ): Promise<void> {
    const famId = parseInt(el.querySelector<HTMLSelectElement>("#align-family-sel")?.value ?? "");
    if (isNaN(famId)) { this._cb.log("Sélectionnez une famille.", true); this._setRunningState(el, false); return; }

    const fam = this._families.find(f => f.family_id === famId);
    const label = fam?.parent?.title ?? `Famille #${famId}`;
    this._setProgressMsg(el, `Alignement famille « ${label} »…`);
    this._cb.log(`Alignement famille #${famId} (stratégie : ${opts.strategy})`);

    const famOpts: FamilyAlignOptions = {
      strategy: opts.strategy,
      replace_existing: opts.recalculate,
      preserve_accepted: opts.preserveAccepted,
      skip_unready: opts.skipUnready,
    };
    if (opts.strategy === "similarity") famOpts.sim_threshold = opts.simThreshold;

    try {
      const result = await alignFamily(conn, famId, famOpts);
      this._setRunningState(el, false);
      this._showFamilyRunSummary(el, result);

      const firstAligned = result.results.find(r => r.status === "aligned");
      if (firstAligned) this._autoLoadAudit(el, firstAligned.pivot_doc_id, firstAligned.target_doc_id);

      const total = result.summary.total_links_created;
      this._cb.toast(`✓ Famille alignée (${total} lien${total > 1 ? "s" : ""})`);
      this._cb.log(`✓ Famille #${famId} : ${total} liens créés · ${result.summary.aligned}/${result.summary.total_pairs} paires.`);
      void this._loadFamilies(el);
      this._cb.onRunDone(famId, result.results.map(r => r.target_doc_id));
    } catch (err) {
      this._setRunningState(el, false);
      this._cb.log(`✗ Alignement famille : ${err instanceof Error ? err.message : String(err)}`, true);
      this._cb.toast("✗ Erreur alignement", true);
    }
  }

  private async _doManualRun(
    el: HTMLElement,
    conn: Conn,
    opts: { strategy: AlignStrategy; simThreshold: number; preserveAccepted: boolean; debugAlign: boolean; recalculate: boolean },
  ): Promise<void> {
    const pivId = parseInt(el.querySelector<HTMLSelectElement>("#align-pivot-sel")?.value ?? "");
    const tgtSel = el.querySelector<HTMLSelectElement>("#align-targets-sel");
    const tgtIds = tgtSel ? Array.from(tgtSel.selectedOptions).map(o => parseInt(o.value)) : [];
    if (isNaN(pivId) || tgtIds.length === 0) {
      this._cb.log("Sélectionnez un pivot et au moins une cible.", true);
      this._setRunningState(el, false); return;
    }

    const modeLabel = opts.recalculate ? "Recalcul global" : "Alignement";
    this._setProgressMsg(el, `${modeLabel} pivot #${pivId} → [${tgtIds.join(", ")}]…`);

    const alignParams: Record<string, unknown> = {
      pivot_doc_id: pivId,
      target_doc_ids: tgtIds,
      strategy: opts.strategy,
      debug_align: opts.debugAlign,
      replace_existing: opts.recalculate,
      preserve_accepted: opts.preserveAccepted,
    };
    if (opts.strategy === "similarity") alignParams.sim_threshold = opts.simThreshold;

    try {
      const job = await enqueueJob(conn, "align", alignParams);
      this._cb.log(`${modeLabel} soumis (${job.job_id.slice(0, 8)}…)`);

      this._cb.jobCenter()?.trackJob(
        job.job_id,
        `Alignement #${pivId}→[${tgtIds.join(",")}]`,
        (done: { status: string; result?: unknown; error?: string }) => {
          if (done.status === "done") {
            const res = done.result as {
              reports?: Array<{ target_doc_id: number; links_created: number; links_skipped?: number }>;
              deleted_before?: number;
              preserved_before?: number;
              total_effective_links?: number;
            } | undefined;
            const reports = res?.reports ?? [];
            const summary: RunSummary = {
              created: reports.reduce((s, r) => s + r.links_created, 0),
              skipped: reports.reduce((s, r) => s + (r.links_skipped ?? 0), 0),
              deleted: opts.recalculate ? Number(res?.deleted_before ?? 0) : undefined,
              preserved: opts.recalculate ? Number(res?.preserved_before ?? 0) : undefined,
              effective: opts.recalculate ? Number(res?.total_effective_links ?? 0) : undefined,
              perTarget: reports.map(r => ({ doc_id: r.target_doc_id, created: r.links_created, skipped: r.links_skipped ?? 0 })),
            };
            this._setRunningState(el, false);
            this._showManualRunSummary(el, summary, opts.recalculate);
            this._autoLoadAudit(el, pivId, tgtIds[0]);
            const n = summary.created;
            this._cb.toast(`✓ ${modeLabel} terminé (${n} lien${n > 1 ? "s" : ""})`);
            this._cb.log(`✓ ${modeLabel} : ${n} liens créés.`);
            this._cb.onRunDone(pivId, tgtIds);
          } else {
            this._setRunningState(el, false);
            this._cb.log(`✗ ${modeLabel} : ${done.error ?? done.status}`, true);
            this._cb.toast(`✗ Erreur ${modeLabel.toLowerCase()}`, true);
          }
        }
      );
    } catch (err) {
      this._setRunningState(el, false);
      this._cb.log(`✗ Alignement : ${err instanceof Error ? err.message : String(err)}`, true);
      this._cb.toast("✗ Erreur alignement", true);
    }
  }

  // ─── UI state helpers ────────────────────────────────────────────────────────

  private _setRunningState(el: HTMLElement, running: boolean): void {
    this._cb.setBusy(running);
    const progress = el.querySelector<HTMLElement>("#align-progress-area");
    const launchBtns = el.querySelector<HTMLElement>("#align-launch-btns");
    if (progress) progress.style.display = running ? "" : "none";
    if (launchBtns) launchBtns.style.display = running ? "none" : "";
  }

  private _setProgressMsg(el: HTMLElement, msg: string): void {
    const msgEl = el.querySelector<HTMLElement>("#align-progress-msg");
    if (msgEl) msgEl.textContent = msg;
  }

  // ─── Run summaries ───────────────────────────────────────────────────────────

  private _showManualRunSummary(el: HTMLElement, s: RunSummary, recalculate: boolean): void {
    const summary = el.querySelector<HTMLElement>("#align-summary");
    if (!summary) return;
    summary.style.display = "";
    this._setKpi(summary, "created", s.created);
    this._setKpi(summary, "skipped", s.skipped);
    const ewrap = summary.querySelector<HTMLElement>("#align-kpi-effective-wrap");
    if (ewrap) ewrap.style.display = (recalculate && s.effective !== undefined) ? "" : "none";
    if (recalculate && s.effective !== undefined) this._setKpi(summary, "effective", s.effective);

    const banner = summary.querySelector<HTMLElement>("#align-summary-banner");
    if (banner && recalculate) {
      banner.innerHTML = s.deleted !== undefined
        ? `<span class="stat-warn">${s.deleted} nettoyés</span> · <span class="stat-ok">${s.preserved} conservés</span>`
        : "";
    } else if (banner) banner.innerHTML = "";

    const perTarget = summary.querySelector<HTMLElement>("#align-summary-per-target");
    if (perTarget) {
      perTarget.innerHTML = s.perTarget.map(t =>
        `<div class="prep-align-summary-row">→ Doc #${t.doc_id} : <strong>${t.created}</strong> créés, ${t.skipped} ignorés</div>`
      ).join("");
    }
  }

  private _showFamilyRunSummary(el: HTMLElement, result: FamilyAlignResponse): void {
    const summary = el.querySelector<HTMLElement>("#align-summary");
    if (!summary) return;
    summary.style.display = "";
    this._setKpi(summary, "created", result.summary.total_links_created);
    this._setKpi(summary, "skipped", result.summary.skipped);
    (summary.querySelector<HTMLElement>("#align-kpi-effective-wrap"))!.style.display = "none";

    const banner = summary.querySelector<HTMLElement>("#align-summary-banner");
    if (banner) {
      const { aligned, total_pairs, errors } = result.summary;
      banner.innerHTML = `${aligned}/${total_pairs} paires` +
        (errors > 0 ? ` · <span class="stat-err">${errors} erreur(s)</span>` : "");
    }

    const perTarget = summary.querySelector<HTMLElement>("#align-summary-per-target");
    if (perTarget) {
      perTarget.innerHTML = result.results.map(r => {
        const icon = r.status === "aligned" ? "✓" : r.status === "skipped" ? "⏭" : "✗";
        const cls = r.status === "aligned" ? "stat-ok" : r.status === "error" ? "stat-err" : "";
        return `<div class="prep-align-summary-row ${cls}">${icon} Doc #${r.target_doc_id} (${r.target_lang}) : ${r.links_created} liens · ${r.status}` +
          (r.warnings.length > 0 ? `<br><em>${r.warnings.map(_esc).join(" · ")}</em>` : "") +
          `</div>`;
      }).join("");
    }
  }

  private _setKpi(parent: HTMLElement, key: string, val: number): void {
    const el = parent.querySelector<HTMLElement>(`#align-kpi-${key}`);
    if (el) el.textContent = String(val);
  }

  // ─── Auto-load audit ─────────────────────────────────────────────────────────

  private _autoLoadAudit(el: HTMLElement, pivotId: number, targetId: number): void {
    const pivSel = el.querySelector<HTMLSelectElement>("#align-audit-pivot");
    const tgtSel = el.querySelector<HTMLSelectElement>("#align-audit-target");
    if (pivSel) pivSel.value = String(pivotId);
    if (tgtSel) tgtSel.value = String(targetId);
    this._auditQuickFilter = "review";
    el.querySelectorAll<HTMLElement>("[data-qf]").forEach(b =>
      b.classList.toggle("active", b.dataset.qf === "review"));
    this._auditOffset = 0;
    this._auditLinks = [];
    void this._loadAuditPage(el, false);
    void this._autoFetchQuality(el, pivotId, targetId);
  }

  // ─── Auto-fetch quality after run ────────────────────────────────────────────

  private async _autoFetchQuality(el: HTMLElement, pivotId: number, targetId: number): Promise<void> {
    const conn = this._conn();
    if (!conn) return;
    const coverageEl = el.querySelector<HTMLElement>("#align-kpi-coverage");
    const coverageWrap = el.querySelector<HTMLElement>("#align-kpi-coverage-wrap");
    const detailsEl = el.querySelector<HTMLDetailsElement>("#align-quality-details");
    const detailsBody = el.querySelector<HTMLElement>("#align-quality-details-body");
    if (!coverageEl) return;
    coverageEl.textContent = "…";
    try {
      const res = await alignQuality(conn, pivotId, targetId);
      const s: AlignQualityStats = res.stats;
      const pct = s.coverage_pct;
      coverageEl.textContent = `${pct}%`;
      if (coverageWrap) {
        coverageWrap.classList.remove("prep-align-kpi-card--ok", "align-kpi-card--warn", "align-kpi-card--err");
        coverageWrap.classList.add(pct >= 90 ? "align-kpi-card--ok" : pct >= 60 ? "align-kpi-card--warn" : "align-kpi-card--err");
        coverageWrap.title = `Couverture : ${s.covered_pivot_units}/${s.total_pivot_units} segments pivot liés. ≥ 90 % = bon.`;
      }
      // Populate details panel
      if (detailsEl && detailsBody) {
        detailsBody.innerHTML = `
          <div class="prep-align-qd-grid">
            <span class="prep-align-qd-label" title="Segments pivot sans aucun lien">Orphelins pivot</span>
            <span class="prep-align-qd-val ${s.orphan_pivot_count === 0 ? "ok" : "warn"}">${s.orphan_pivot_count}</span>
            <span class="prep-align-qd-label" title="Segments cible sans aucun lien">Orphelins cible</span>
            <span class="prep-align-qd-val ${(s.orphan_target_count ?? 0) === 0 ? "ok" : "warn"}">${s.orphan_target_count ?? 0}</span>
            <span class="prep-align-qd-label" title="Liens en conflit (même pivot → deux segments cible différents)">Collisions</span>
            <span class="prep-align-qd-val ${s.collision_count === 0 ? "ok" : "err"}">${s.collision_count}</span>
            <span class="prep-align-qd-label">Liens total</span>
            <span class="prep-align-qd-val">${s.total_links}</span>
            <span class="prep-align-qd-label" title="Liens acceptés manuellement / rejetés / non révisés">Statuts</span>
            <span class="prep-align-qd-val">✓${s.status_counts.accepted} ✗${s.status_counts.rejected} ?${s.status_counts.unreviewed}</span>
          </div>
          ${res.sample_orphan_pivot.length > 0 ? `
          <div class="prep-align-qd-orphans">
            <div class="prep-align-qd-orphans-label">Exemples orphelins pivot :</div>
            ${res.sample_orphan_pivot.slice(0, 3).map(o =>
              `<div class="prep-align-qd-orphan">[§${o.external_id ?? "?"}] ${o.text?.slice(0, 80) ?? ""}</div>`
            ).join("")}
          </div>` : ""}
        `;
        detailsEl.style.display = "";
      }
      this._cb.log(`Qualité auto : couverture ${pct}%, orphelins=${s.orphan_pivot_count}p/${s.orphan_target_count}c`);
    } catch {
      if (coverageEl) coverageEl.textContent = "—";
    }
  }

  // ─── Audit loading ───────────────────────────────────────────────────────────

  private async _loadAuditPage(el: HTMLElement, append: boolean): Promise<void> {
    const conn = this._conn();
    if (!conn) return;
    const pivotId = parseInt(el.querySelector<HTMLSelectElement>("#align-audit-pivot")?.value ?? "");
    const targetId = parseInt(el.querySelector<HTMLSelectElement>("#align-audit-target")?.value ?? "");
    if (isNaN(pivotId) || isNaN(targetId)) {
      const wrap = el.querySelector<HTMLElement>("#align-audit-table-wrap");
      if (wrap) wrap.innerHTML = `<p class="empty-hint">Choisissez un pivot et une cible dans les filtres.</p>`;
      return;
    }

    const status = el.querySelector<HTMLSelectElement>("#align-audit-status")?.value;
    if (!append) this._auditOffset = 0;

    try {
      const res = await alignAudit(conn, {
        pivot_doc_id: pivotId,
        target_doc_id: targetId,
        status: (status || undefined) as "accepted" | "rejected" | "unreviewed" | undefined,
        limit: 50,
        offset: this._auditOffset,
      });
      const links = res.links ?? [];
      if (append) this._auditLinks = [...this._auditLinks, ...links];
      else this._auditLinks = links;
      this._auditHasMore = res.has_more ?? false;
      this._auditOffset += links.length;
      this._renderAuditTable(el);
      const statsEl = el.querySelector<HTMLElement>("#align-audit-stats");
      if (statsEl) statsEl.textContent = `${this._auditLinks.length} lien(s) chargé(s)${this._auditHasMore ? " (suite disponible)" : ""}`;
    } catch (err) {
      this._cb.log(`✗ Chargement audit : ${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  // ─── Audit rendering ─────────────────────────────────────────────────────────

  private _renderAuditTable(el: HTMLElement): void {
    const wrap = el.querySelector<HTMLElement>("#align-audit-table-wrap");
    if (!wrap) return;
    const textLo = this._auditTextFilter;
    const qf = this._auditQuickFilter;

    const visible = this._auditLinks.filter(lk => {
      if (qf === "review" && lk.status === "accepted") return false;
      if (qf === "unreviewed" && lk.status !== null) return false;
      if (qf === "rejected" && lk.status !== "rejected") return false;
      if (textLo) {
        const p = (lk.pivot_text ?? "").toLowerCase();
        const t = (lk.target_text ?? "").toLowerCase();
        if (!p.includes(textLo) && !t.includes(textLo)) return false;
      }
      return true;
    });

    if (visible.length === 0) {
      wrap.innerHTML = `<p class="empty-hint">Aucun lien correspondant au filtre.</p>`;
      this._updateBatchBar(el); return;
    }

    const statusIcon = (s: string | null) =>
      s === "accepted" ? `<span class="prep-align-status-accepted" title="Accepté">✓</span>` :
      s === "rejected" ? `<span class="prep-align-status-rejected" title="Rejeté">✗</span>` :
      `<span class="prep-align-status-unreviewed" title="Non révisé">?</span>`;

    const rows = visible.map(lk => {
      const isFocused = this._selectedLinkId === lk.link_id;
      const isChecked = this._selectedLinkIds.has(lk.link_id);
      return `<tr class="audit-row${isFocused ? " audit-row-focused" : ""}" data-link-id="${lk.link_id}">
        <td class="audit-col-check"><input type="checkbox" class="audit-row-cb" data-link-id="${lk.link_id}" ${isChecked ? "checked" : ""}></td>
        <td class="audit-col-status">${statusIcon(lk.status)}</td>
        <td class="audit-col-extid">${lk.external_id != null ? _esc(String(lk.external_id)) : ""}</td>
        <td class="audit-col-pivot">${_esc(_trunc(lk.pivot_text ?? "", 120))}</td>
        <td class="audit-col-target">${_esc(_trunc(lk.target_text ?? "", 120))}</td>
      </tr>`;
    }).join("");

    wrap.innerHTML = `
      <table class="prep-align-audit-table">
        <thead>
          <tr>
            <th class="audit-col-check"><input type="checkbox" id="align-audit-check-all"></th>
            <th>St.</th>
            <th>ID</th>
            <th>Pivot</th>
            <th>Cible</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;

    const moreBtn = el.querySelector<HTMLElement>("#align-audit-more-btn");
    if (moreBtn) moreBtn.style.display = this._auditHasMore ? "" : "none";

    wrap.querySelectorAll<HTMLElement>(".audit-row").forEach(row => {
      row.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).tagName === "INPUT") return;
        const lid = parseInt(row.dataset.linkId ?? "");
        const lk = this._auditLinks.find(l => l.link_id === lid);
        if (lk) this._openFocus(el, lk);
      });
    });

    wrap.querySelectorAll<HTMLInputElement>(".audit-row-cb").forEach(cb => {
      cb.addEventListener("change", () => {
        const lid = parseInt(cb.dataset.linkId ?? "");
        if (cb.checked) this._selectedLinkIds.add(lid);
        else this._selectedLinkIds.delete(lid);
        this._updateBatchBar(el);
      });
    });

    const checkAll = wrap.querySelector<HTMLInputElement>("#align-audit-check-all");
    checkAll?.addEventListener("change", () => {
      visible.forEach(lk => {
        if (checkAll.checked) this._selectedLinkIds.add(lk.link_id);
        else this._selectedLinkIds.delete(lk.link_id);
      });
      this._renderAuditTable(el);
      this._updateBatchBar(el);
    });

    this._updateBatchBar(el);
  }

  private _updateBatchBar(el: HTMLElement): void {
    const bar = el.querySelector<HTMLElement>("#align-batch-bar");
    const count = el.querySelector<HTMLElement>("#align-batch-count");
    const n = this._selectedLinkIds.size;
    if (count) count.textContent = `${n} sélectionné(s)`;
    if (bar) bar.style.display = n > 0 ? "" : "none";
  }

  // ─── Focus panel ─────────────────────────────────────────────────────────────

  private _openFocus(el: HTMLElement, lk: AlignLinkRecord): void {
    this._selectedLinkId = lk.link_id;
    const panel = el.querySelector<HTMLElement>("#align-focus-panel");
    if (!panel) return;
    panel.style.display = "";
    const meta = el.querySelector<HTMLElement>("#align-focus-meta");
    if (meta) meta.textContent = `Lien #${lk.link_id} · ${lk.status ?? "non révisé"}`;
    (el.querySelector("#align-focus-pivot-text") as HTMLElement).textContent = lk.pivot_text ?? "";
    (el.querySelector("#align-focus-target-text") as HTMLElement).textContent = lk.target_text ?? "";
    el.querySelectorAll(".audit-row").forEach(r =>
      r.classList.toggle("audit-row-focused", (r as HTMLElement).dataset.linkId === String(lk.link_id)));
  }

  private _closeFocus(el: HTMLElement): void {
    this._selectedLinkId = null;
    const panel = el.querySelector<HTMLElement>("#align-focus-panel");
    if (panel) panel.style.display = "none";
    el.querySelectorAll(".audit-row").forEach(r => r.classList.remove("audit-row-focused"));
  }

  private async _focusSetStatus(el: HTMLElement, status: "accepted" | "rejected" | null): Promise<void> {
    if (this._selectedLinkId == null) return;
    const conn = this._conn();
    if (!conn) return;
    try {
      await updateAlignLinkStatus(conn, { link_id: this._selectedLinkId, status });
      const lk = this._auditLinks.find(l => l.link_id === this._selectedLinkId);
      if (lk) lk.status = status;
      this._renderAuditTable(el);
      this._focusNextException(el);
    } catch (err) {
      this._cb.log(`✗ Mise à jour statut : ${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  private async _focusDelete(el: HTMLElement): Promise<void> {
    if (this._selectedLinkId == null) return;
    const conn = this._conn();
    if (!conn) return;
    const confirmed = await this._inlineConfirm(el, `Supprimer le lien #${this._selectedLinkId} ?`);
    if (!confirmed) return;
    try {
      await deleteAlignLink(conn, { link_id: this._selectedLinkId });
      this._auditLinks = this._auditLinks.filter(l => l.link_id !== this._selectedLinkId);
      this._closeFocus(el);
      this._renderAuditTable(el);
    } catch (err) {
      this._cb.log(`✗ Suppression lien : ${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  private _focusNextException(el: HTMLElement): void {
    const reviewable = this._auditLinks.filter(l => l.status !== "accepted");
    if (reviewable.length === 0) return;
    const idx = this._selectedLinkId != null
      ? reviewable.findIndex(l => l.link_id === this._selectedLinkId)
      : -1;
    const next = reviewable[idx + 1] ?? reviewable[0];
    if (next) this._openFocus(el, next);
  }

  // ─── Batch actions ───────────────────────────────────────────────────────────

  private async _batchAction(el: HTMLElement, status: "accepted" | "rejected" | null): Promise<void> {
    if (this._selectedLinkIds.size === 0) return;
    const conn = this._conn();
    if (!conn) return;
    const ids = [...this._selectedLinkIds];
    const actions: AlignBatchAction[] = ids.map(id => ({ action: "set_status", link_id: id, status }));
    try {
      await batchUpdateAlignLinks(conn, actions);
      ids.forEach(id => {
        const lk = this._auditLinks.find(l => l.link_id === id);
        if (lk) lk.status = status;
      });
      this._selectedLinkIds.clear();
      this._renderAuditTable(el);
      this._cb.toast(`✓ ${ids.length} lien(s) mis à jour`);
    } catch (err) {
      this._cb.log(`✗ Action lot : ${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  private async _batchDeleteSelected(el: HTMLElement): Promise<void> {
    if (this._selectedLinkIds.size === 0) return;
    const conn = this._conn();
    if (!conn) return;
    const ids = [...this._selectedLinkIds];
    const confirmed = await this._inlineConfirm(el, `Supprimer ${ids.length} lien(s) ?`);
    if (!confirmed) return;
    const actions: AlignBatchAction[] = ids.map(id => ({ action: "delete", link_id: id }));
    try {
      await batchUpdateAlignLinks(conn, actions);
      this._auditLinks = this._auditLinks.filter(l => !this._selectedLinkIds.has(l.link_id));
      this._selectedLinkIds.clear();
      this._renderAuditTable(el);
      this._cb.toast(`✓ ${ids.length} lien(s) supprimé(s)`);
    } catch (err) {
      this._cb.log(`✗ Suppression lot : ${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  /** Confirmation inline sans window.confirm — injecte temporairement des boutons dans la batch bar */
  private _inlineConfirm(el: HTMLElement, msg: string): Promise<boolean> {
    return new Promise(resolve => {
      const bar = el.querySelector<HTMLElement>("#align-batch-bar");
      if (!bar) { resolve(true); return; }
      const original = bar.innerHTML;
      const restore = () => { bar.innerHTML = original; this._updateBatchBar(el); };
      bar.innerHTML = `<span class="prep-align-del-confirm-msg">${_esc(msg)}</span>
        <button class="btn btn-sm btn-danger" id="_inline-ok">Confirmer</button>
        <button class="btn btn-sm btn-ghost" id="_inline-cancel">Annuler</button>`;
      bar.style.display = "";
      bar.querySelector("#_inline-ok")!.addEventListener("click", () => { restore(); resolve(true); }, { once: true });
      bar.querySelector("#_inline-cancel")!.addEventListener("click", () => { restore(); resolve(false); }, { once: true });
    });
  }

  dispose(): void {
    this._pendingConfirm = null;
    this._el = null;
  }
}

// ─── Utilitaires ─────────────────────────────────────────────────────────────

function _esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function _trunc(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}
