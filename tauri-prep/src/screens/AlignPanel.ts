/**
 * AlignPanel.ts — Panneau d'alignement bitext.
 *
 * Architecture :
 *  - Topbar : sélection de paire, run, filtres, KPI de révision
 *  - Éditeur bitext : grille pivot | cible + actions inline ✓/✗/?/🗑
 *  - Barre d'actions en lot (sélection multiple)
 *  - Section collisions : masquée par défaut, accessible via le badge KPI
 *  - Familles : propagation via POST /families/{id}/align
 *  - Confirmation inline (pas de window.confirm)
 */

import {
  enqueueJob,
  alignFamily,
  getFamilies,
  alignAudit,
  alignQuality,
  listCollisions,
  resolveCollisions,
  updateAlignLinkStatus,
  deleteAlignLink,
  retargetAlignLink,
  createAlignLink,
  retargetCandidates,
  listUnits,
  batchUpdateAlignLinks,
  SidecarError,
  type Conn,
  type DocumentRecord,
  type FamilyRecord,
  type FamilyAlignResponse,
  type FamilyAlignOptions,
  type AlignLinkRecord,
  type AlignBatchAction,
  type AlignQualityStats,
  type CollisionGroup,
  type RetargetCandidate,
  type UnitRecord,
} from "../lib/sidecarClient.ts";
import type { JobCenter } from "../components/JobCenter.ts";
import { initCardAccordions } from "../lib/uiAccordions.ts";

// ─── Types locaux ─────────────────────────────────────────────────────────────

type AlignStrategy = "external_id" | "external_id_then_position" | "position" | "similarity";

export interface AlignPanelCallbacks {
  log: (msg: string, isError?: boolean) => void;
  toast: (msg: string, isError?: boolean) => void;
  setBusy: (v: boolean) => void;
  jobCenter: () => JobCenter | null;
  /** Appelé après run réussi. runId = identifiant du run créé (null si indisponible). */
  onRunDone: (pivotId: number, targetIds: number[], runId: string | null) => void;
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
  private _families: FamilyRecord[] = [];
  private _pendingConfirm: (() => void) | null = null;
  private _el: HTMLElement | null = null;

  // Bitext state
  private _auditLinks: AlignLinkRecord[] = [];
  private _auditOffset = 0;
  private _auditHasMore = false;
  private _auditQuickFilter: "all" | "accepted" | "rejected" | "unreviewed" = "all";
  private _auditTextFilter = "";
  private _selectedLinkIds = new Set<number>();

  // Collision state
  private _lastCollisionCount = 0;
  private _collOffset = 0;
  private _collLimit = 20;
  private _collGroups: CollisionGroup[] = [];
  private _collHasMore = false;
  private _collTotalCount = 0;

  // Retarget / create-link picker state
  private _retargetActive: { pivotUnitId: number; linkId: number | null; mode: "retarget" | "create" | "add" } | null = null;
  private _retargetCandidates: RetargetCandidate[] | null = null; // null = loading

  // Orphan pivot state
  private _orphanPivots: UnitRecord[] = [];
  private _orphansLoaded = false;

  // Family review mode state
  private _familyMode = false;
  private _familyId: number | null = null;
  private _familyAudits = new Map<number, AlignLinkRecord[]>(); // targetDocId → links
  private _familyOffsets = new Map<number, number>();           // targetDocId → next offset
  private _familyAuditHasMore = false;
  private _familyLoading = false;
  // Which target doc the active picker is targeting (needed in family mode)
  private _retargetTargetDocId: number | null = null;

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
    el.className = "prep-align-panel-root";
    el.innerHTML = this._html();
    this._el = el;
    this._bindEvents(el);
    this._populatePairSelects(el);
    initCardAccordions(el);
    void this._loadFamilies(el);
    return el;
  }

  refreshDocs(): void {
    if (!this._el) return;
    this._populatePairSelects(this._el);
    this._populateFamilySelect(this._el);
  }

  // ─── HTML template ──────────────────────────────────────────────────────────

  private _html(): string {
    return `
<div class="prep-align-root">

  <!-- ═══ Barre supérieure : paire + run ═══ -->
  <div class="prep-align-topbar">
    <div class="prep-align-pair-group">
      <label class="prep-align-pair-label">Pivot
        <select id="align-pivot-sel" class="prep-align-pair-sel">
          <option value="">— choisir —</option>
        </select>
      </label>
      <span class="prep-align-pair-arrow" aria-hidden="true">&#8596;</span>
      <label class="prep-align-pair-label">Cible
        <select id="align-target-sel" class="prep-align-pair-sel">
          <option value="">— choisir —</option>
        </select>
      </label>
      <button id="align-load-btn" class="btn btn-sm btn-secondary" disabled>Charger</button>
    </div>
    <div class="prep-align-topbar-run">
      <button id="align-run-btn" class="btn btn-sm prep-btn-warning" disabled>&#9889; Auto-aligner</button>
      <button id="align-run-options-toggle" class="btn btn-sm btn-ghost" title="Options d&#39;alignement">&#9881;</button>
    </div>
    <div class="prep-align-topbar-filters">
      <div class="prep-align-filter-chips" role="group" aria-label="Filtre statut">
        <button class="chip active" data-qf="all">Tout</button>
        <button class="chip" data-qf="accepted">&#10003; Accept&#233;s</button>
        <button class="chip" data-qf="rejected">&#10007; Rejet&#233;s</button>
        <button class="chip" data-qf="unreviewed">? Non r&#233;vis&#233;s</button>
      </div>
      <input id="align-text-filter" class="prep-align-search" type="search" placeholder="Rechercher&#8230;" autocomplete="off">
      <button id="align-audit-next-btn" class="btn btn-sm btn-ghost" title="Lien suivant &#224; revoir">&#8595; Suivant</button>
      <button id="align-orphan-toggle" class="btn btn-sm btn-ghost" title="Afficher les segments pivot sans lien" disabled>&#9651; Orphelins</button>
    </div>
    <div id="align-topbar-kpi" class="prep-align-topbar-kpi" style="display:none"></div>
  </div>

  <!-- ═══ Panneau d'options run (disclosure) ═══ -->
  <div id="align-run-options" class="prep-align-run-options" style="display:none">
    <div class="prep-align-run-options-row">
      <label class="prep-align-run-opt-field">Strat&#233;gie
        <select id="align-strategy-sel" class="prep-align-select">
          <option value="external_id">external_id</option>
          <option value="external_id_then_position" selected>external_id &#8594; position</option>
          <option value="position">position</option>
          <option value="similarity">similarit&#233;</option>
        </select>
      </label>
      <div id="align-sim-row" class="prep-align-run-opt-field" style="display:none">
        <label>Seuil
          <input id="align-sim-threshold" type="number" class="prep-align-input-num"
                 min="0" max="1" step="0.05" value="0.8"/>
        </label>
      </div>
      <label class="prep-align-check-label">
        <input id="align-preserve-accepted" type="checkbox" checked/>
        Conserver les liens valid&#233;s
      </label>
      <label class="prep-align-check-label">
        <input id="align-debug-cb" type="checkbox"/>
        Debug
      </label>
      <button id="align-recalc-btn" class="btn btn-sm btn-secondary" disabled>&#8635; Recalcul global</button>
    </div>
    <div class="prep-align-run-options-row prep-align-run-options-family">
      <label class="prep-align-run-opt-field" style="flex:1">Par famille
        <div style="display:flex;gap:6px;align-items:center">
          <select id="align-family-sel" class="prep-align-select" style="flex:1">
            <option value="">&#8212; choisir une famille &#8212;</option>
          </select>
          <button id="align-family-refresh" class="btn btn-sm btn-ghost" title="Rafra&#238;chir">&#8635;</button>
          <button id="align-family-run-btn" class="btn btn-sm prep-btn-warning" disabled>&#9889; Aligner famille</button>
          <button id="align-family-review-btn" class="btn btn-sm btn-secondary" disabled>&#9998; R&#233;viser famille</button>
        </div>
      </label>
      <div id="align-family-stats" class="prep-align-family-stats"></div>
    </div>
  </div>

  <!-- ═══ Confirmation inline ═══ -->
  <div id="align-confirm-banner" class="prep-align-confirm-banner" style="display:none">
    <div id="align-confirm-msg" class="prep-align-confirm-msg"></div>
    <div class="prep-align-confirm-btns">
      <button id="align-confirm-ok" class="btn prep-btn-warning btn-sm">&#9658; Confirmer</button>
      <button id="align-confirm-cancel" class="btn btn-ghost btn-sm">Annuler</button>
    </div>
  </div>

  <!-- ═══ Progression ═══ -->
  <div id="align-progress-area" class="prep-align-progress-area" style="display:none">
    <div class="prep-align-progress-spinner">&#9203;</div>
    <div id="align-progress-msg" class="prep-align-progress-msg">Alignement en cours&#8230;</div>
  </div>

  <!-- ═══ R&#233;sum&#233; KPI apr&#232;s run ═══ -->
  <div id="align-summary" class="prep-align-summary" style="display:none">
    <div class="prep-align-summary-head">
      <span class="prep-align-summary-title">R&#233;sultats du run</span>
      <button id="align-summary-close" class="btn btn-ghost btn-sm" title="Fermer">&#10005;</button>
    </div>
    <div id="align-summary-banner" class="prep-align-summary-banner"></div>
    <div class="prep-align-kpi-row">
      <div class="prep-align-kpi-card">
        <div class="prep-align-kpi-val" id="align-kpi-created">&#8212;</div>
        <div class="prep-align-kpi-lbl">Cr&#233;&#233;s</div>
      </div>
      <div class="prep-align-kpi-card">
        <div class="prep-align-kpi-val" id="align-kpi-skipped">&#8212;</div>
        <div class="prep-align-kpi-lbl">Ignor&#233;s</div>
      </div>
      <div class="prep-align-kpi-card prep-align-kpi-card--coverage" id="align-kpi-coverage-wrap"
           title="Part des segments pivot ayant au moins un lien. &#8805; 90&#160;% = bon&#160;; &#8805; 60&#160;% = acceptable.">
        <div class="prep-align-kpi-val" id="align-kpi-coverage">&#8230;</div>
        <div class="prep-align-kpi-lbl">Couverture</div>
      </div>
    </div>
    <div id="align-summary-per-target" class="prep-align-summary-per-target"></div>
    <details id="align-quality-details" class="prep-align-quality-details" style="display:none">
      <summary class="prep-align-quality-details-summary">D&#233;tails qualit&#233; &#9658;</summary>
      <div id="align-quality-details-body" class="prep-align-quality-details-body"></div>
    </details>
  </div>

  <!-- ═══ Éditeur bitext ═══ -->
  <div class="prep-align-bitext" id="align-bitext">
    <div class="prep-align-bitext-head">
      <div class="prep-align-bitext-check">
        <input type="checkbox" id="align-check-all" title="Tout s&#233;lectionner">
      </div>
      <div class="prep-align-bitext-col-head" id="align-col-pivot-title">Pivot</div>
      <div class="prep-align-bitext-col-head" id="align-col-target-title">Cible</div>
      <div class="prep-align-bitext-col-actions"></div>
    </div>
    <div id="align-bitext-body">
      <p class="empty-hint">S&#233;lectionnez un pivot et une cible, puis cliquez sur Charger.</p>
    </div>
    <div class="prep-align-bitext-foot" id="align-bitext-foot" style="display:none">
      <span id="align-audit-stats" class="prep-align-audit-stats"></span>
      <button id="align-audit-more-btn" class="btn btn-sm btn-secondary" style="display:none">Charger plus</button>
    </div>
  </div>

  <!-- ═══ Orphelins pivot (segments sans lien) ═══ -->
  <div id="align-orphan-section" class="prep-align-orphan-section" style="display:none">
    <div class="prep-align-coll-section-head">
      <span class="prep-align-coll-section-title">&#9651; Segments pivot sans lien</span>
      <button id="align-orphan-close" class="btn btn-ghost btn-sm" title="Fermer">&#10005;</button>
    </div>
    <p class="hint" style="margin:0.3rem 0 0.6rem">Segments du pivot qui n&#8217;ont aucun lien dans la paire active. Cliquez &#8629; pour cr&#233;er un lien.</p>
    <div id="align-orphan-body"></div>
  </div>

  <!-- ═══ Vue famille multi-colonnes ═══ -->
  <div id="align-family-bitext" class="prep-fam-bitext" style="display:none">
    <div class="prep-fam-bitext-head">
      <span id="align-family-bitext-title" class="prep-fam-bitext-title"></span>
      <div class="prep-fam-bitext-actions">
        <button id="align-family-more-btn" class="btn btn-sm btn-secondary" style="display:none">Charger plus</button>
        <button id="align-family-close-btn" class="btn btn-sm btn-ghost" title="Fermer la vue famille">&#10005; Fermer</button>
      </div>
    </div>
    <div id="align-family-bitext-body"></div>
  </div>

  <!-- ═══ Barre d'actions en lot ═══ -->
  <div id="align-batch-bar" class="prep-align-batch-bar" style="display:none">
    <span id="align-batch-count">0 s&#233;lectionn&#233;(s)</span>
    <button id="align-batch-accept" class="btn btn-sm btn-secondary">&#10003; Accepter</button>
    <button id="align-batch-reject" class="btn btn-sm btn-secondary">&#10007; Rejeter</button>
    <button id="align-batch-unreview" class="btn btn-sm btn-secondary">? Non r&#233;vis&#233;</button>
    <button id="align-batch-delete" class="btn btn-sm btn-danger">Supprimer</button>
  </div>

  <!-- ═══ Résolution des collisions (affiché via le badge KPI) ═══ -->
  <div id="align-coll-section" class="prep-align-coll-section" style="display:none">
    <div class="prep-align-coll-section-head">
      <span class="prep-align-coll-section-title">&#9888; Collisions d&#8217;alignement</span>
      <button id="align-coll-close" class="btn btn-ghost btn-sm" title="Fermer">&#10005;</button>
    </div>
    <p class="hint" style="margin:0.3rem 0 0.6rem">Un pivot li&#233; &#224; plusieurs segments dans le m&#234;me document cible est une collision. La paire active est utilis&#233;e automatiquement.</p>
    <div>
      <button id="align-coll-load-btn" class="btn btn-secondary btn-sm">Rafra&#238;chir les collisions</button>
    </div>
    <div id="align-coll-result" style="display:none;margin-top:0.75rem"></div>
    <div id="align-coll-more-wrap" style="display:none;margin-top:0.5rem;text-align:center">
      <button id="align-coll-more-btn" class="btn btn-sm btn-secondary">Charger plus</button>
    </div>
  </div>

</div>
    `;
  }

  // ─── Event binding ──────────────────────────────────────────────────────────

  private _bindEvents(el: HTMLElement): void {
    // Pair selects → enable/disable load + run buttons
    el.querySelector("#align-pivot-sel")?.addEventListener("change", () =>
      this._updateRunBtnState(el));
    el.querySelector("#align-target-sel")?.addEventListener("change", () =>
      this._updateRunBtnState(el));

    // Load bitext
    el.querySelector("#align-load-btn")?.addEventListener("click", () =>
      void this._loadAuditPage(el, false));

    // Auto-align (run)
    el.querySelector("#align-run-btn")?.addEventListener("click", () =>
      this._askConfirm(el, false));
    el.querySelector("#align-recalc-btn")?.addEventListener("click", () =>
      this._askConfirm(el, true));

    // Run options toggle
    el.querySelector("#align-run-options-toggle")?.addEventListener("click", () => {
      const panel = el.querySelector<HTMLElement>("#align-run-options");
      if (panel) panel.style.display = panel.style.display === "none" ? "" : "none";
    });

    // Strategy: show/hide similarity threshold
    el.querySelector("#align-strategy-sel")?.addEventListener("change", (e) => {
      const v = (e.target as HTMLSelectElement).value;
      const simRow = el.querySelector<HTMLElement>("#align-sim-row");
      if (simRow) simRow.style.display = v === "similarity" ? "" : "none";
    });

    // Family run
    el.querySelector("#align-family-sel")?.addEventListener("change", () =>
      this._onFamilyChange(el));
    el.querySelector("#align-family-refresh")?.addEventListener("click", () =>
      void this._loadFamilies(el));
    el.querySelector("#align-family-run-btn")?.addEventListener("click", () =>
      this._askConfirmFamily(el));
    el.querySelector("#align-family-review-btn")?.addEventListener("click", () =>
      void this._enterFamilyReview(el));
    el.querySelector("#align-family-close-btn")?.addEventListener("click", () =>
      this._exitFamilyReview(el));
    el.querySelector("#align-family-more-btn")?.addEventListener("click", () => {
      const fam = this._families.find(f => f.family_id === this._familyId);
      if (fam) void this._loadFamilyAuditPage(el, fam, true);
    });

    // Confirm/cancel
    el.querySelector("#align-confirm-ok")?.addEventListener("click", () => {
      const fn = this._pendingConfirm;
      this._pendingConfirm = null;
      this._hideConfirmBanner(el);
      fn?.();
    });
    el.querySelector("#align-confirm-cancel")?.addEventListener("click", () => {
      this._pendingConfirm = null;
      this._hideConfirmBanner(el);
    });

    // Summary close
    el.querySelector("#align-summary-close")?.addEventListener("click", () => {
      const s = el.querySelector<HTMLElement>("#align-summary");
      if (s) s.style.display = "none";
    });

    // Filter chips
    el.querySelectorAll<HTMLButtonElement>("[data-qf]").forEach(btn => {
      btn.addEventListener("click", () => {
        el.querySelectorAll("[data-qf]").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        this._auditQuickFilter = (btn.dataset.qf ?? "all") as typeof this._auditQuickFilter;
        this._renderBitextBody(el);
      });
    });

    // Text search
    const textFilter = el.querySelector<HTMLInputElement>("#align-text-filter");
    textFilter?.addEventListener("input", () => {
      this._auditTextFilter = textFilter.value.trim().toLowerCase();
      this._renderBitextBody(el);
    });

    // Load more / next
    el.querySelector("#align-audit-more-btn")?.addEventListener("click", () =>
      void this._loadAuditPage(el, true));
    el.querySelector("#align-audit-next-btn")?.addEventListener("click", () =>
      this._scrollToNextUnreviewed(el));

    // Check-all (static header, bind once)
    el.querySelector<HTMLInputElement>("#align-check-all")?.addEventListener("change", (e) => {
      const checked = (e.target as HTMLInputElement).checked;
      const visible = this._visibleLinks();
      visible.forEach(lk => {
        if (checked) this._selectedLinkIds.add(lk.link_id);
        else this._selectedLinkIds.delete(lk.link_id);
      });
      this._renderBitextBody(el);
      this._updateBatchBar(el);
    });

    // Batch actions
    el.querySelector("#align-batch-accept")?.addEventListener("click", () =>
      void this._batchAction(el, "accepted"));
    el.querySelector("#align-batch-reject")?.addEventListener("click", () =>
      void this._batchAction(el, "rejected"));
    el.querySelector("#align-batch-unreview")?.addEventListener("click", () =>
      void this._batchAction(el, null));
    el.querySelector("#align-batch-delete")?.addEventListener("click", () =>
      void this._batchDeleteSelected(el));

    // ── Section collisions ────────────────────────────────────────────────────
    el.querySelector("#align-coll-load-btn")?.addEventListener("click", () => {
      this._collOffset = 0; this._collGroups = []; void this._loadCollisionsPage(el, false);
    });
    el.querySelector("#align-coll-more-btn")?.addEventListener("click", () =>
      void this._loadCollisionsPage(el, true));
    el.querySelector("#align-coll-close")?.addEventListener("click", () => {
      const section = el.querySelector<HTMLElement>("#align-coll-section");
      if (section) section.style.display = "none";
    });

    // ── Orphan section ────────────────────────────────────────────────────────
    el.querySelector("#align-orphan-toggle")?.addEventListener("click", () => {
      const section = el.querySelector<HTMLElement>("#align-orphan-section");
      if (!section) return;
      const isOpen = section.style.display !== "none";
      if (isOpen) {
        section.style.display = "none";
      } else {
        section.style.display = "";
        section.scrollIntoView({ behavior: "smooth", block: "nearest" });
        void this._loadOrphanPivots(el);
      }
    });
    el.querySelector("#align-orphan-close")?.addEventListener("click", () => {
      const section = el.querySelector<HTMLElement>("#align-orphan-section");
      if (section) section.style.display = "none";
    });
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
    const statsEl = el.querySelector<HTMLElement>("#align-family-stats");
    if (isNaN(famId)) {
      if (statsEl) statsEl.innerHTML = "";
      this._updateRunBtnState(el);
      return;
    }
    const fam = this._families.find(f => f.family_id === famId);
    if (!fam) { if (statsEl) statsEl.innerHTML = ""; return; }
    if (statsEl) {
      const { aligned_pairs, total_pairs, completion_pct } = fam.stats;
      const children = fam.children.map(c => {
        const doc = c.doc;
        const lang = doc?.language ? ` (${_esc(doc.language)})` : "";
        const segTag = c.segmented
          ? `<span class="prep-align-fp-tag-ok">✓</span>`
          : `<span class="prep-align-fp-tag-warn">⚠</span>`;
        return `<span class="prep-align-fp-child">${segTag} ${_esc(doc?.title ?? `#${c.doc_id}`)}${lang}</span>`;
      }).join(" ");
      statsEl.innerHTML =
        `<span class="prep-align-fp-stat">${aligned_pairs}/${total_pairs} paires · ${completion_pct.toFixed(0)}%</span>` +
        (fam.stats.ratio_warnings.length > 0
          ? ` <span class="prep-align-fp-warn">⚠ ${fam.stats.ratio_warnings.length} ratio(s)</span>` : "") +
        ` ${children}`;
    }
    this._updateRunBtnState(el);
  }

  // ─── Mode révision famille ───────────────────────────────────────────────────

  private async _enterFamilyReview(el: HTMLElement): Promise<void> {
    const btn = el.querySelector<HTMLButtonElement>("#align-family-review-btn");
    if (btn?.disabled) return;
    const famId = parseInt(el.querySelector<HTMLSelectElement>("#align-family-sel")?.value ?? "");
    if (isNaN(famId)) return;
    const conn = this._conn();
    if (!conn) return;
    const fam = this._families.find(f => f.family_id === famId);
    if (!fam) return;

    if (btn) btn.disabled = true;
    this._familyMode = true;
    this._familyId = famId;
    this._familyAudits.clear();
    this._familyOffsets.clear();
    this._familyAuditHasMore = false;
    this._familyLoading = false;
    this._retargetActive = null;
    this._retargetCandidates = null;
    this._retargetTargetDocId = null;

    const normalBitext = el.querySelector<HTMLElement>("#align-bitext");
    const familyBitext = el.querySelector<HTMLElement>("#align-family-bitext");
    const orphanSection = el.querySelector<HTMLElement>("#align-orphan-section");
    const batchBar = el.querySelector<HTMLElement>("#align-batch-bar");
    if (normalBitext) normalBitext.style.display = "none";
    if (orphanSection) orphanSection.style.display = "none";
    if (batchBar) batchBar.style.display = "none";
    this._selectedLinkIds.clear();
    if (familyBitext) familyBitext.style.display = "";

    const titleEl = el.querySelector<HTMLElement>("#align-family-bitext-title");
    if (titleEl) {
      const label = fam.parent?.title ?? `Famille #${famId}`;
      const n = fam.children.length;
      titleEl.textContent = `Révision famille : ${label} (${n} enfant${n > 1 ? "s" : ""})`;
    }

    await this._loadFamilyAuditPage(el, fam, false);
  }

  private _exitFamilyReview(el: HTMLElement): void {
    this._familyMode = false;
    this._familyId = null;
    this._familyAudits.clear();
    this._familyOffsets.clear();
    this._familyLoading = false;
    this._retargetActive = null;
    this._retargetCandidates = null;
    this._retargetTargetDocId = null;
    // Re-enable review button for the still-selected family
    this._updateRunBtnState(el);

    const normalBitext = el.querySelector<HTMLElement>("#align-bitext");
    const familyBitext = el.querySelector<HTMLElement>("#align-family-bitext");
    if (familyBitext) familyBitext.style.display = "none";
    if (normalBitext) normalBitext.style.display = "";
  }

  private async _loadFamilyAuditPage(el: HTMLElement, fam: FamilyRecord, append: boolean): Promise<void> {
    if (this._familyLoading) return;
    const conn = this._conn();
    if (!conn) return;
    this._familyLoading = true;
    const moreBtn = el.querySelector<HTMLButtonElement>("#align-family-more-btn");
    if (moreBtn) moreBtn.disabled = true;

    const pivotId = fam.family_id;
    const childIds = fam.children.map(c => c.doc_id);
    const bodyEl = el.querySelector<HTMLElement>("#align-family-bitext-body");
    if (!append && bodyEl) bodyEl.innerHTML = `<p class="empty-hint">&#8230; chargement</p>`;
    if (!append) this._familyOffsets.clear();

    try {
      const responses = await Promise.all(
        childIds.map(cid => alignAudit(conn, {
          pivot_doc_id: pivotId,
          target_doc_id: cid,
          limit: 50,
          offset: this._familyOffsets.get(cid) ?? 0,
        }))
      );
      let anyHasMore = false;
      childIds.forEach((cid, i) => {
        const links = responses[i].links ?? [];
        const prev = this._familyOffsets.get(cid) ?? 0;
        this._familyOffsets.set(cid, prev + links.length);
        if (append) {
          this._familyAudits.set(cid, [...(this._familyAudits.get(cid) ?? []), ...links]);
        } else {
          this._familyAudits.set(cid, links);
        }
        if (responses[i].has_more) anyHasMore = true;
      });
      this._familyAuditHasMore = anyHasMore;
      this._renderFamilyBitext(el, fam);
    } catch (err) {
      if (bodyEl) bodyEl.innerHTML = `<p class="empty-hint">Erreur : ${_esc(err instanceof Error ? err.message : String(err))}</p>`;
      this._cb.log(`✗ Chargement famille : ${err instanceof Error ? err.message : String(err)}`, true);
    } finally {
      this._familyLoading = false;
      if (moreBtn) { moreBtn.disabled = false; moreBtn.style.display = this._familyAuditHasMore ? "" : "none"; }
    }
  }

  private _buildFamilyRows(fam: FamilyRecord): Array<{
    pivot_unit_id: number;
    external_id: number | null;
    pivot_text: string;
    cells: Map<number, AlignLinkRecord[]>;
  }> {
    const childIds = fam.children.map(c => c.doc_id);
    const orderedPivotIds: number[] = [];
    const seenPivotIds = new Set<number>();
    for (const cid of childIds) {
      for (const lk of this._familyAudits.get(cid) ?? []) {
        if (!seenPivotIds.has(lk.pivot_unit_id)) {
          orderedPivotIds.push(lk.pivot_unit_id);
          seenPivotIds.add(lk.pivot_unit_id);
        }
      }
    }
    return orderedPivotIds.map(pid => {
      let pivot_text = "";
      let external_id: number | null = null;
      const cells = new Map<number, AlignLinkRecord[]>();
      for (const cid of childIds) {
        const links = (this._familyAudits.get(cid) ?? []).filter(l => l.pivot_unit_id === pid);
        cells.set(cid, links);
        if (!pivot_text && links.length > 0) {
          pivot_text = links[0].pivot_text ?? "";
          external_id = links[0].external_id ?? null;
        }
      }
      return { pivot_unit_id: pid, external_id, pivot_text, cells };
    });
  }

  private _renderFamilyBitext(el: HTMLElement, fam: FamilyRecord): void {
    const bodyEl = el.querySelector<HTMLElement>("#align-family-bitext-body");
    if (!bodyEl) return;
    const childIds = fam.children.map(c => c.doc_id);
    const docs = this._getDocs();
    const rows = this._buildFamilyRows(fam);

    if (rows.length === 0) {
      bodyEl.innerHTML = `<p class="empty-hint">Aucun lien charg&#233;. Lancez d&apos;abord un alignement automatique.</p>`;
      const moreBtn = el.querySelector<HTMLElement>("#align-family-more-btn");
      if (moreBtn) moreBtn.style.display = "none";
      return;
    }

    const pivotDoc = docs.find(d => d.doc_id === fam.family_id);
    const childHeaders = childIds.map(cid => {
      const doc = docs.find(d => d.doc_id === cid);
      return `<th class="prep-fam-col-child">${_esc(_trunc(doc?.title ?? `#${cid}`, 24))}<br>
        <span class="prep-fam-col-lang">${_esc(doc?.language ?? "?")}</span></th>`;
    }).join("");

    const rowsHtml = rows.map(row => {
      const extId = row.external_id != null
        ? `<span class="prep-align-row-extid">[§${_esc(String(row.external_id))}]</span> ` : "";

      const cellsHtml = childIds.map(cid => {
        const links = row.cells.get(cid) ?? [];

        if (links.length === 0) {
          const isCreateOpen = this._retargetActive?.pivotUnitId === row.pivot_unit_id
            && this._retargetActive.mode === "create"
            && this._retargetTargetDocId === cid;
          return `<td class="prep-fam-cell">
            <div class="prep-fam-cell--orphan">
              <span class="prep-fam-orphan-dash">&#8212;</span>
              <button class="btn btn-sm btn-ghost prep-fam-orphan-link-btn${isCreateOpen ? " active" : ""}"
                data-pivot-uid="${row.pivot_unit_id}" data-target-doc="${cid}" title="Cr&#233;er un lien">&#8629; Lier</button>
            </div>
            ${isCreateOpen ? this._pickerRowHtml(row.pivot_unit_id, null, row.pivot_text) : ""}
          </td>`;
        }

        const isAddOpen = this._retargetActive?.pivotUnitId === row.pivot_unit_id
          && this._retargetActive.mode === "add"
          && this._retargetTargetDocId === cid;

        const linksHtml = links.map(lk => {
          const isRetargetOpen = this._retargetActive?.linkId === lk.link_id
            && this._retargetActive.mode === "retarget";
          const statusCls = lk.status === "accepted" ? "prep-fam-link--accepted"
            : lk.status === "rejected" ? "prep-fam-link--rejected" : "";
          return `<div class="prep-fam-link-item ${statusCls}">
            <div class="prep-fam-cell-text">${_esc(_trunc(lk.target_text ?? "", 100))}</div>
            <div class="prep-fam-cell-actions">
              <button class="prep-align-act-btn prep-align-act-accept${lk.status === "accepted" ? " active" : ""}" data-link-id="${lk.link_id}" title="Accepter">&#10003;</button>
              <button class="prep-align-act-btn prep-align-act-reject${lk.status === "rejected" ? " active" : ""}" data-link-id="${lk.link_id}" title="Rejeter">&#10007;</button>
              <button class="prep-align-act-btn prep-align-act-unreview${lk.status === null ? " active" : ""}" data-link-id="${lk.link_id}" title="Non r&#233;vis&#233;">?</button>
              <button class="prep-align-act-btn prep-align-act-delete" data-link-id="${lk.link_id}" title="Supprimer">&#128465;</button>
              <button class="prep-align-act-btn prep-align-act-retarget${isRetargetOpen ? " active" : ""}" data-link-id="${lk.link_id}" data-pivot-uid="${lk.pivot_unit_id}" data-target-doc="${cid}" title="Changer la cible">&#9998;</button>
            </div>
            ${isRetargetOpen ? this._pickerRowHtml(lk.pivot_unit_id, lk.link_id, lk.pivot_text ?? "") : ""}
          </div>`;
        }).join("");

        return `<td class="prep-fam-cell">
          ${linksHtml}
          <div class="prep-fam-cell-foot">
            <button class="prep-align-act-btn prep-align-act-addtarget${isAddOpen ? " active" : ""}"
              data-pivot-uid="${row.pivot_unit_id}" data-target-doc="${cid}" title="Ajouter une cible">&#43;</button>
          </div>
          ${isAddOpen ? this._pickerRowHtml(row.pivot_unit_id, null, row.pivot_text) : ""}
        </td>`;
      }).join("");

      return `<tr data-pivot-uid="${row.pivot_unit_id}">
        <td class="prep-fam-cell-pivot">${extId}${_esc(row.pivot_text)}</td>
        ${cellsHtml}
      </tr>`;
    }).join("");

    bodyEl.innerHTML = `<table class="prep-fam-table">
      <thead><tr>
        <th class="prep-fam-col-pivot">${_esc(_trunc(pivotDoc?.title ?? "Pivot", 24))}</th>
        ${childHeaders}
      </tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>`;

    this._bindFamilyBitextEvents(el, bodyEl, fam);
  }

  private _bindFamilyBitextEvents(el: HTMLElement, bodyEl: HTMLElement, fam: FamilyRecord): void {
    bodyEl.querySelectorAll<HTMLButtonElement>(".prep-align-act-accept").forEach(btn =>
      btn.addEventListener("click", () => void this._setLinkStatus(el, parseInt(btn.dataset.linkId!), "accepted")));
    bodyEl.querySelectorAll<HTMLButtonElement>(".prep-align-act-reject").forEach(btn =>
      btn.addEventListener("click", () => void this._setLinkStatus(el, parseInt(btn.dataset.linkId!), "rejected")));
    bodyEl.querySelectorAll<HTMLButtonElement>(".prep-align-act-unreview").forEach(btn =>
      btn.addEventListener("click", () => void this._setLinkStatus(el, parseInt(btn.dataset.linkId!), null)));
    bodyEl.querySelectorAll<HTMLButtonElement>(".prep-align-act-delete").forEach(btn =>
      btn.addEventListener("click", () => void this._deleteLink(el, parseInt(btn.dataset.linkId!))));

    bodyEl.querySelectorAll<HTMLButtonElement>(".prep-align-act-retarget").forEach(btn =>
      btn.addEventListener("click", () => {
        const linkId = parseInt(btn.dataset.linkId!);
        const pivotUnitId = parseInt(btn.dataset.pivotUid!);
        const targetDoc = parseInt(btn.dataset.targetDoc!);
        if (this._retargetActive?.linkId === linkId && this._retargetActive.mode === "retarget") {
          this._retargetActive = null; this._retargetCandidates = null; this._retargetTargetDocId = null;
          this._renderFamilyBitext(el, fam);
        } else {
          void this._activateRetarget(el, linkId, pivotUnitId, "retarget", targetDoc);
        }
      }));

    bodyEl.querySelectorAll<HTMLButtonElement>(".prep-align-act-addtarget").forEach(btn =>
      btn.addEventListener("click", () => {
        const pivotUnitId = parseInt(btn.dataset.pivotUid!);
        const targetDoc = parseInt(btn.dataset.targetDoc!);
        if (this._retargetActive?.pivotUnitId === pivotUnitId && this._retargetActive.mode === "add" && this._retargetTargetDocId === targetDoc) {
          this._retargetActive = null; this._retargetCandidates = null; this._retargetTargetDocId = null;
          this._renderFamilyBitext(el, fam);
        } else {
          void this._activateRetarget(el, null, pivotUnitId, "add", targetDoc);
        }
      }));

    bodyEl.querySelectorAll<HTMLButtonElement>(".prep-fam-orphan-link-btn").forEach(btn =>
      btn.addEventListener("click", () => {
        const pivotUnitId = parseInt(btn.dataset.pivotUid!);
        const targetDoc = parseInt(btn.dataset.targetDoc!);
        if (this._retargetActive?.pivotUnitId === pivotUnitId && this._retargetActive.mode === "create" && this._retargetTargetDocId === targetDoc) {
          this._retargetActive = null; this._retargetCandidates = null; this._retargetTargetDocId = null;
          this._renderFamilyBitext(el, fam);
        } else {
          void this._activateRetarget(el, null, pivotUnitId, "create", targetDoc);
        }
      }));

    // Picker events inside family bitext (cancel + candidates)
    bodyEl.querySelectorAll<HTMLButtonElement>(".prep-align-picker-cancel").forEach(btn =>
      btn.addEventListener("click", () => {
        this._retargetActive = null; this._retargetCandidates = null; this._retargetTargetDocId = null;
        this._renderFamilyBitext(el, fam);
      }));
    bodyEl.querySelectorAll<HTMLElement>(".prep-align-picker-candidates").forEach(candsEl =>
      this._bindPickerCandidateEvents(el, candsEl));
  }

  /** Dispatcher: re-render whichever bitext view is active. */
  private _renderActiveBitext(el: HTMLElement): void {
    if (this._familyMode) {
      const fam = this._families.find(f => f.family_id === this._familyId);
      if (fam) this._renderFamilyBitext(el, fam);
    } else {
      this._renderBitextBody(el);
    }
  }

  /** Find a link across both normal audit and all family audits. */
  private _findLinkInFamilyAudits(linkId: number): AlignLinkRecord | undefined {
    for (const links of this._familyAudits.values()) {
      const found = links.find(l => l.link_id === linkId);
      if (found) return found;
    }
    return undefined;
  }

  // ─── Sélects paire pivot/cible ──────────────────────────────────────────────

  private _populatePairSelects(el: HTMLElement): void {
    const docs = this._getDocs();
    for (const id of ["#align-pivot-sel", "#align-target-sel"]) {
      const sel = el.querySelector<HTMLSelectElement>(id);
      if (!sel) continue;
      const prev = sel.value;
      sel.innerHTML = `<option value="">— choisir —</option>`;
      for (const d of docs) {
        const opt = document.createElement("option");
        opt.value = String(d.doc_id);
        opt.textContent = `${d.title} (${d.language ?? "?"})`;
        if (String(d.doc_id) === prev) opt.selected = true;
        sel.appendChild(opt);
      }
    }
    this._updateRunBtnState(el);
  }

  private _updateRunBtnState(el: HTMLElement): void {
    const piv = el.querySelector<HTMLSelectElement>("#align-pivot-sel")?.value;
    const tgt = el.querySelector<HTMLSelectElement>("#align-target-sel")?.value;
    const pairOk = !!(piv && tgt);
    const runBtn = el.querySelector<HTMLButtonElement>("#align-run-btn");
    const recalcBtn = el.querySelector<HTMLButtonElement>("#align-recalc-btn");
    const loadBtn = el.querySelector<HTMLButtonElement>("#align-load-btn");
    if (runBtn) runBtn.disabled = !pairOk;
    if (recalcBtn) recalcBtn.disabled = !pairOk;
    if (loadBtn) loadBtn.disabled = !pairOk;
    const famVal = el.querySelector<HTMLSelectElement>("#align-family-sel")?.value ?? "";
    const famRunBtn = el.querySelector<HTMLButtonElement>("#align-family-run-btn");
    if (famRunBtn) famRunBtn.disabled = !famVal;
    const famReviewBtn = el.querySelector<HTMLButtonElement>("#align-family-review-btn");
    if (famReviewBtn) famReviewBtn.disabled = !famVal;
    // Orphan toggle only valid after an audit load for the current pair
    const orphanBtn = el.querySelector<HTMLButtonElement>("#align-orphan-toggle");
    if (orphanBtn && !pairOk) orphanBtn.disabled = true;
  }

  // ─── Confirmation inline ─────────────────────────────────────────────────────

  private _askConfirm(el: HTMLElement, recalculate: boolean): void {
    const strategy = el.querySelector<HTMLSelectElement>("#align-strategy-sel")?.value ?? "?";
    const preserve = el.querySelector<HTMLInputElement>("#align-preserve-accepted")?.checked ?? true;
    const debug = el.querySelector<HTMLInputElement>("#align-debug-cb")?.checked ?? false;
    const pivId = el.querySelector<HTMLSelectElement>("#align-pivot-sel")?.value;
    const tgtId = el.querySelector<HTMLSelectElement>("#align-target-sel")?.value;
    const docs = this._getDocs();
    const pivTitle = docs.find(d => String(d.doc_id) === pivId)?.title ?? `#${pivId}`;
    const tgtTitle = docs.find(d => String(d.doc_id) === tgtId)?.title ?? `#${tgtId}`;
    const action = recalculate ? "Recalcul global" : "Alignement";
    const msgEl = el.querySelector<HTMLElement>("#align-confirm-msg");
    const banner = el.querySelector<HTMLElement>("#align-confirm-banner");
    if (msgEl) msgEl.innerHTML =
      `<strong>${action}</strong> · ${_esc(pivTitle)} &#8596; ${_esc(tgtTitle)}<br>
       Stratégie : <strong>${_esc(strategy)}</strong> ·
       Liens validés : <strong>${preserve ? "conservés" : "remplacés"}</strong>` +
       (debug ? " · debug" : "");
    if (banner) {
      banner.style.display = "";
      banner.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    this._pendingConfirm = () => void this._doRun(el, recalculate);
  }

  private _askConfirmFamily(el: HTMLElement): void {
    const famId = el.querySelector<HTMLSelectElement>("#align-family-sel")?.value;
    if (!famId) return;
    const fam = this._families.find(f => String(f.family_id) === famId);
    const label = fam?.parent?.title ?? `Famille #${famId}`;
    const n = fam?.children.length ?? "?";
    const strategy = (el.querySelector<HTMLSelectElement>("#align-strategy-sel")?.value ?? "external_id_then_position") as AlignStrategy;
    const preserve = el.querySelector<HTMLInputElement>("#align-preserve-accepted")?.checked ?? true;
    const simThreshold = parseFloat(el.querySelector<HTMLInputElement>("#align-sim-threshold")?.value ?? "0.8") || 0.8;
    const debugAlign = el.querySelector<HTMLInputElement>("#align-debug-cb")?.checked ?? false;
    const msgEl = el.querySelector<HTMLElement>("#align-confirm-msg");
    const banner = el.querySelector<HTMLElement>("#align-confirm-banner");
    if (msgEl) msgEl.innerHTML =
      `<strong>Aligner famille</strong> · ${_esc(label)} (${n} paires)<br>
       Stratégie : <strong>${_esc(strategy)}</strong> ·
       Liens validés : <strong>${preserve ? "conservés" : "remplacés"}</strong>`;
    if (banner) {
      banner.style.display = "";
      banner.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    this._pendingConfirm = () => {
      const conn = this._conn();
      if (!conn) { this._cb.log("Pas de connexion.", true); return; }
      this._setRunningState(el, true);
      void this._doFamilyRun(el, conn, { strategy, simThreshold, preserveAccepted: preserve, debugAlign, skipUnready: true, recalculate: false });
    };
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
    this._setRunningState(el, true);
    await this._doManualRun(el, conn, { strategy, simThreshold, preserveAccepted, debugAlign, recalculate });
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
      const runId = result.results.find(r => r.run_id)?.run_id ?? null;
      this._cb.onRunDone(famId, result.results.map(r => r.target_doc_id), runId);
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
    const tgtId = parseInt(el.querySelector<HTMLSelectElement>("#align-target-sel")?.value ?? "");
    const tgtIds = isNaN(tgtId) ? [] : [tgtId];
    if (isNaN(pivId) || tgtIds.length === 0) {
      this._cb.log("Sélectionnez un pivot et une cible.", true);
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
              run_id?: string;
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
            this._cb.onRunDone(pivId, tgtIds, res?.run_id ?? null);
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
    if (progress) progress.style.display = running ? "" : "none";
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
    const banner = summary.querySelector<HTMLElement>("#align-summary-banner");
    if (banner) {
      banner.innerHTML = (recalculate && s.deleted !== undefined)
        ? `<span class="stat-warn">${s.deleted} nettoyés</span> · <span class="prep-stat-ok">${s.preserved} conservés</span>`
        : "";
    }
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
        const cls = r.status === "aligned" ? "prep-stat-ok" : r.status === "error" ? "stat-err" : "";
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
    const pivSel = el.querySelector<HTMLSelectElement>("#align-pivot-sel");
    const tgtSel = el.querySelector<HTMLSelectElement>("#align-target-sel");
    if (pivSel) pivSel.value = String(pivotId);
    if (tgtSel) tgtSel.value = String(targetId);
    this._auditQuickFilter = "unreviewed";
    el.querySelectorAll<HTMLElement>("[data-qf]").forEach(b =>
      b.classList.toggle("active", b.dataset.qf === "unreviewed"));
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
      this._lastCollisionCount = s.collision_count;
      this._updateTopbarKpi(el);
      this._cb.log(`Qualité auto : couverture ${pct}%, orphelins=${s.orphan_pivot_count}p/${s.orphan_target_count}c`);
    } catch {
      if (coverageEl) coverageEl.textContent = "—";
    }
  }

  // ─── Audit loading ───────────────────────────────────────────────────────────

  private async _loadAuditPage(el: HTMLElement, append: boolean): Promise<void> {
    const conn = this._conn();
    if (!conn) return;
    const pivotId = parseInt(el.querySelector<HTMLSelectElement>("#align-pivot-sel")?.value ?? "");
    const targetId = parseInt(el.querySelector<HTMLSelectElement>("#align-target-sel")?.value ?? "");
    if (isNaN(pivotId) || isNaN(targetId)) {
      const body = el.querySelector<HTMLElement>("#align-bitext-body");
      if (body) body.innerHTML = `<p class="empty-hint">Choisissez un pivot et une cible, puis cliquez sur Charger.</p>`;
      return;
    }
    if (!append) {
      this._auditOffset = 0;
      this._lastCollisionCount = 0;
      this._collGroups = [];
      this._collOffset = 0;
      this._retargetActive = null;
      this._retargetCandidates = null;
      this._orphanPivots = [];
      this._orphansLoaded = false;
      const collSection = el.querySelector<HTMLElement>("#align-coll-section");
      if (collSection) { collSection.style.display = "none"; }
      const collResult = el.querySelector<HTMLElement>("#align-coll-result");
      if (collResult) { collResult.style.display = "none"; collResult.innerHTML = ""; }
      const orphanSection = el.querySelector<HTMLElement>("#align-orphan-section");
      if (orphanSection) { orphanSection.style.display = "none"; }
    }
    try {
      const res = await alignAudit(conn, {
        pivot_doc_id: pivotId,
        target_doc_id: targetId,
        limit: 50,
        offset: this._auditOffset,
      });
      const links = res.links ?? [];
      if (append) this._auditLinks = [...this._auditLinks, ...links];
      else this._auditLinks = links;
      this._auditHasMore = res.has_more ?? false;
      this._auditOffset += links.length;
      this._renderBitextBody(el);
      const statsEl = el.querySelector<HTMLElement>("#align-audit-stats");
      if (statsEl) statsEl.textContent = `${this._auditLinks.length} lien(s)${this._auditHasMore ? " · suite dispo" : ""}`;
      const foot = el.querySelector<HTMLElement>("#align-bitext-foot");
      if (foot) foot.style.display = "";
      // Update column header titles
      const docs = this._getDocs();
      const pivColHead = el.querySelector<HTMLElement>("#align-col-pivot-title");
      const tgtColHead = el.querySelector<HTMLElement>("#align-col-target-title");
      if (pivColHead) pivColHead.textContent = docs.find(d => d.doc_id === pivotId)?.title ?? `Pivot #${pivotId}`;
      if (tgtColHead) tgtColHead.textContent = docs.find(d => d.doc_id === targetId)?.title ?? `Cible #${targetId}`;
      const orphanBtn = el.querySelector<HTMLButtonElement>("#align-orphan-toggle");
      if (orphanBtn) orphanBtn.disabled = false;
      this._updateTopbarKpi(el);
    } catch (err) {
      this._cb.log(`✗ Chargement bitext : ${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  // ─── Bitext rendering ────────────────────────────────────────────────────────

  private _visibleLinks(): AlignLinkRecord[] {
    const qf = this._auditQuickFilter;
    const textLo = this._auditTextFilter;
    return this._auditLinks.filter(lk => {
      if (qf === "accepted" && lk.status !== "accepted") return false;
      if (qf === "rejected" && lk.status !== "rejected") return false;
      if (qf === "unreviewed" && lk.status !== null) return false;
      if (textLo) {
        const p = (lk.pivot_text ?? "").toLowerCase();
        const t = (lk.target_text ?? "").toLowerCase();
        if (!p.includes(textLo) && !t.includes(textLo)) return false;
      }
      return true;
    });
  }

  private _renderBitextBody(el: HTMLElement): void {
    const body = el.querySelector<HTMLElement>("#align-bitext-body");
    if (!body) return;
    const visible = this._visibleLinks();

    if (visible.length === 0) {
      if (this._auditLinks.length > 0) {
        body.innerHTML = `<p class="empty-hint">Aucun lien avec ce filtre. <button class="btn btn-ghost btn-sm" id="align-filter-clear-btn">Afficher tout</button></p>`;
        body.querySelector("#align-filter-clear-btn")?.addEventListener("click", () => {
          this._auditQuickFilter = "all";
          this._auditTextFilter = "";
          el.querySelectorAll("[data-qf]").forEach(b => b.classList.remove("active"));
          el.querySelector("[data-qf='all']")?.classList.add("active");
          const textInput = el.querySelector<HTMLInputElement>("#align-text-filter");
          if (textInput) textInput.value = "";
          this._renderBitextBody(el);
        });
      } else {
        body.innerHTML = `<p class="empty-hint">Sélectionnez un pivot et une cible, puis cliquez sur Charger.</p>`;
      }
      this._updateBatchBar(el);
      return;
    }

    const statusCls = (s: string | null) =>
      s === "accepted" ? "prep-align-row--accepted" :
      s === "rejected" ? "prep-align-row--rejected" : "prep-align-row--unreviewed";

    const rows: string[] = [];
    const addPickerRendered = new Set<number>(); // pivotUnitIds whose "add" picker is already in DOM
    for (const lk of visible) {
      const checked = this._selectedLinkIds.has(lk.link_id);
      const extId = lk.external_id != null
        ? `<span class="prep-align-row-extid">[§${_esc(String(lk.external_id))}]</span> ` : "";
      const isRetargetOpen = this._retargetActive?.linkId === lk.link_id && this._retargetActive.mode === "retarget";
      const isAddOpen = this._retargetActive?.pivotUnitId === lk.pivot_unit_id && this._retargetActive.mode === "add";
      rows.push(`<div class="prep-align-row ${statusCls(lk.status)}" data-link-id="${lk.link_id}" role="row">
        <div class="prep-align-row-check">
          <input type="checkbox" class="prep-align-row-cb" data-link-id="${lk.link_id}"${checked ? " checked" : ""} aria-label="Sélectionner lien ${lk.link_id}">
        </div>
        <div class="prep-align-row-pivot">${extId}${_esc(lk.pivot_text ?? "")}</div>
        <div class="prep-align-row-target">${_esc(lk.target_text ?? "")}</div>
        <div class="prep-align-row-actions">
          <button class="prep-align-act-btn prep-align-act-accept${lk.status === "accepted" ? " active" : ""}" data-link-id="${lk.link_id}" title="Accepter">✓</button>
          <button class="prep-align-act-btn prep-align-act-reject${lk.status === "rejected" ? " active" : ""}" data-link-id="${lk.link_id}" title="Rejeter">✗</button>
          <button class="prep-align-act-btn prep-align-act-unreview${lk.status === null ? " active" : ""}" data-link-id="${lk.link_id}" title="Non révisé">?</button>
          <button class="prep-align-act-btn prep-align-act-delete" data-link-id="${lk.link_id}" title="Supprimer ce lien">🗑</button>
          <button class="prep-align-act-btn prep-align-act-retarget${isRetargetOpen ? " active" : ""}" data-link-id="${lk.link_id}" data-pivot-uid="${lk.pivot_unit_id}" title="Changer la cible de ce lien">✎</button>
          <button class="prep-align-act-btn prep-align-act-addtarget${isAddOpen ? " active" : ""}" data-link-id="${lk.link_id}" data-pivot-uid="${lk.pivot_unit_id}" title="Ajouter une deuxième cible à ce segment VO">➕</button>
        </div>
      </div>`);
      if (isRetargetOpen) {
        rows.push(this._pickerRowHtml(lk.pivot_unit_id, lk.link_id, lk.pivot_text ?? ""));
      } else if (isAddOpen && !addPickerRendered.has(lk.pivot_unit_id)) {
        rows.push(this._pickerRowHtml(lk.pivot_unit_id, null, lk.pivot_text ?? ""));
        addPickerRendered.add(lk.pivot_unit_id);
      }
    }
    body.innerHTML = rows.join("");

    const moreBtn = el.querySelector<HTMLElement>("#align-audit-more-btn");
    if (moreBtn) moreBtn.style.display = this._auditHasMore ? "" : "none";

    body.querySelectorAll<HTMLButtonElement>(".prep-align-act-accept").forEach(btn =>
      btn.addEventListener("click", () => void this._setLinkStatus(el, parseInt(btn.dataset.linkId!), "accepted")));
    body.querySelectorAll<HTMLButtonElement>(".prep-align-act-reject").forEach(btn =>
      btn.addEventListener("click", () => void this._setLinkStatus(el, parseInt(btn.dataset.linkId!), "rejected")));
    body.querySelectorAll<HTMLButtonElement>(".prep-align-act-unreview").forEach(btn =>
      btn.addEventListener("click", () => void this._setLinkStatus(el, parseInt(btn.dataset.linkId!), null)));
    body.querySelectorAll<HTMLButtonElement>(".prep-align-act-delete").forEach(btn =>
      btn.addEventListener("click", () => void this._deleteLink(el, parseInt(btn.dataset.linkId!))));
    body.querySelectorAll<HTMLButtonElement>(".prep-align-act-retarget").forEach(btn =>
      btn.addEventListener("click", () => {
        const linkId = parseInt(btn.dataset.linkId!);
        const pivotUnitId = parseInt(btn.dataset.pivotUid!);
        if (this._retargetActive?.linkId === linkId && this._retargetActive.mode === "retarget") {
          this._retargetActive = null;
          this._retargetCandidates = null;
          this._renderBitextBody(el);
        } else {
          void this._activateRetarget(el, linkId, pivotUnitId, "retarget");
        }
      }));
    body.querySelectorAll<HTMLButtonElement>(".prep-align-act-addtarget").forEach(btn =>
      btn.addEventListener("click", () => {
        const pivotUnitId = parseInt(btn.dataset.pivotUid!);
        if (this._retargetActive?.pivotUnitId === pivotUnitId && this._retargetActive.mode === "add") {
          this._retargetActive = null;
          this._retargetCandidates = null;
          this._renderBitextBody(el);
        } else {
          void this._activateRetarget(el, null, pivotUnitId, "add");
        }
      }));

    // Picker events (re-bind after each render)
    this._bindPickerEvents(el, body);

    body.querySelectorAll<HTMLInputElement>(".prep-align-row-cb").forEach(cb => {
      cb.addEventListener("change", () => {
        const lid = parseInt(cb.dataset.linkId!);
        if (cb.checked) this._selectedLinkIds.add(lid);
        else this._selectedLinkIds.delete(lid);
        this._updateBatchBar(el);
      });
    });

    this._updateBatchBar(el);
  }

  private async _setLinkStatus(el: HTMLElement, linkId: number, status: "accepted" | "rejected" | null): Promise<void> {
    const conn = this._conn();
    if (!conn) return;
    try {
      await updateAlignLinkStatus(conn, { link_id: linkId, status });
      const lk = this._auditLinks.find(l => l.link_id === linkId)
        ?? this._findLinkInFamilyAudits(linkId);
      if (lk) lk.status = status;
      this._renderActiveBitext(el);
      if (!this._familyMode) this._updateTopbarKpi(el);
    } catch (err) {
      this._cb.log(`✗ Statut lien : ${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  private async _deleteLink(el: HTMLElement, linkId: number): Promise<void> {
    const conn = this._conn();
    if (!conn) return;
    try {
      await deleteAlignLink(conn, { link_id: linkId });
      if (this._familyMode) {
        for (const [cid, links] of this._familyAudits) {
          this._familyAudits.set(cid, links.filter(l => l.link_id !== linkId));
        }
      } else {
        this._auditLinks = this._auditLinks.filter(l => l.link_id !== linkId);
        this._selectedLinkIds.delete(linkId);
        this._updateTopbarKpi(el);
      }
      this._renderActiveBitext(el);
    } catch (err) {
      this._cb.log(`✗ Suppression lien : ${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  // ─── Retarget / create-link picker ──────────────────────────────────────────

  /** Generate the HTML for the inline candidate picker row. */
  private _pickerRowHtml(pivotUnitId: number, linkId: number | null, pivotText: string): string {
    const candidates = this._retargetCandidates;
    // target_unit_ids already linked to this pivot (excluding the link being retargeted)
    // In family mode, only look within the active target doc's audit.
    const sourceLinks = this._familyMode && this._retargetTargetDocId !== null
      ? (this._familyAudits.get(this._retargetTargetDocId) ?? [])
      : this._auditLinks;
    const alreadyLinked = new Set(
      sourceLinks
        .filter(l => l.pivot_unit_id === pivotUnitId && l.link_id !== linkId)
        .map(l => l.target_unit_id)
    );
    let content: string;
    if (candidates === null) {
      content = `<span class="prep-align-picker-loading">&#8230; chargement des candidats</span>`;
    } else if (candidates.length === 0) {
      content = `<span class="prep-align-picker-empty">Aucun candidat trouv&#233;.</span>`;
    } else {
      content = candidates.map(c => {
        const conflict = alreadyLinked.has(c.target_unit_id);
        return `<button class="prep-align-picker-cand${conflict ? " prep-align-picker-cand--conflict" : ""}"
          data-uid="${c.target_unit_id}"
          title="${conflict ? "Déjà lié à ce pivot — sélectionner supprimera le lien existant" : `score ${c.score.toFixed(2)} — ${_esc(c.reason)}`}"
          ${conflict ? 'data-conflict="1"' : ""}>
          <span class="prep-align-picker-cand-ext">[§${c.external_id ?? "?"}]</span>
          <span class="prep-align-picker-cand-text">${_esc(c.target_text.slice(0, 120))}</span>
          <span class="prep-align-picker-cand-score">${conflict ? "⚠ déjà lié" : `${(c.score * 100).toFixed(0)}%`}</span>
        </button>`;
      }).join("");
    }
    return `<div class="prep-align-picker-row" data-picker-for="${pivotUnitId}">
      <div class="prep-align-picker-header">
        <span>&#9997; Recibler : <em>${_esc(pivotText.slice(0, 60))}</em></span>
        <button class="btn btn-ghost btn-sm prep-align-picker-cancel" data-pivot-uid="${pivotUnitId}" title="Annuler">&#10005;</button>
      </div>
      <div class="prep-align-picker-candidates" id="picker-cands-${pivotUnitId}">${content}</div>
    </div>`;
  }

  /** Activate the retarget/create/add picker for a given pivot unit. Fetches candidates async.
   *  In family mode, pass targetDocId explicitly (the column's target doc).
   */
  private async _activateRetarget(el: HTMLElement, linkId: number | null, pivotUnitId: number, mode: "retarget" | "create" | "add", targetDocId?: number): Promise<void> {
    const conn = this._conn();
    if (!conn) return;
    const targetId = targetDocId ?? parseInt(el.querySelector<HTMLSelectElement>("#align-target-sel")?.value ?? "");
    if (isNaN(targetId)) return;

    this._retargetActive = { pivotUnitId, linkId, mode };
    this._retargetTargetDocId = targetDocId ?? null;
    this._retargetCandidates = null; // trigger loading state
    if (this._familyMode) {
      const fam = this._families.find(f => f.family_id === this._familyId);
      if (fam) this._renderFamilyBitext(el, fam);
    } else {
      this._renderBitextBody(el);
      if (mode === "create") this._renderOrphanPivots(el);
    }

    try {
      const res = await retargetCandidates(conn, { pivot_unit_id: pivotUnitId, target_doc_id: targetId, limit: 8 });
      this._retargetCandidates = res.candidates;
    } catch {
      this._retargetCandidates = [];
    }

    // Update just the candidates container if picker is still open
    if (this._retargetActive?.pivotUnitId !== pivotUnitId) return;
    const candsEl = el.querySelector<HTMLElement>(`#picker-cands-${pivotUnitId}`);
    if (candsEl) {
      const candidates = this._retargetCandidates;
      const active = this._retargetActive;
      const sourceLinks = this._familyMode && this._retargetTargetDocId !== null
        ? (this._familyAudits.get(this._retargetTargetDocId) ?? [])
        : this._auditLinks;
      const alreadyLinked = new Set(
        sourceLinks
          .filter(l => l.pivot_unit_id === pivotUnitId && l.link_id !== (active?.linkId ?? null))
          .map(l => l.target_unit_id)
      );
      if (candidates.length === 0) {
        candsEl.innerHTML = `<span class="prep-align-picker-empty">Aucun candidat trouv\u00e9.</span>`;
      } else {
        candsEl.innerHTML = candidates.map(c => {
          const conflict = alreadyLinked.has(c.target_unit_id);
          return `<button class="prep-align-picker-cand${conflict ? " prep-align-picker-cand--conflict" : ""}"
            data-uid="${c.target_unit_id}"
            title="${conflict ? "D\u00e9j\u00e0 li\u00e9 \u00e0 ce pivot" : `score ${c.score.toFixed(2)} \u2014 ${_esc(c.reason)}`}"
            ${conflict ? 'data-conflict="1"' : ""}>
            <span class="prep-align-picker-cand-ext">[§${c.external_id ?? "?"}]</span>
            <span class="prep-align-picker-cand-text">${_esc(c.target_text.slice(0, 120))}</span>
            <span class="prep-align-picker-cand-score">${conflict ? "\u26a0 d\u00e9j\u00e0 li\u00e9" : `${(c.score * 100).toFixed(0)}%`}</span>
          </button>`;
        }).join("");
        this._bindPickerCandidateEvents(el, candsEl);
      }
    }
  }

  /** Bind click events on candidate buttons inside a given container. */
  private _bindPickerCandidateEvents(el: HTMLElement, container: HTMLElement): void {
    container.querySelectorAll<HTMLButtonElement>(".prep-align-picker-cand").forEach(btn => {
      if (btn.dataset.conflict) { btn.disabled = true; return; }
      btn.addEventListener("click", () => void this._doPickerSelect(el, parseInt(btn.dataset.uid!)));
    });
  }

  /** Called when user selects a candidate in the picker. */
  private async _doPickerSelect(el: HTMLElement, targetUnitId: number): Promise<void> {
    const conn = this._conn();
    if (!conn || !this._retargetActive) return;
    const { linkId, pivotUnitId, mode } = this._retargetActive;
    try {
      if (mode === "retarget" && linkId !== null) {
        const res = await retargetAlignLink(conn, { link_id: linkId, new_target_unit_id: targetUnitId });
        const lk = this._auditLinks.find(l => l.link_id === linkId)
          ?? this._findLinkInFamilyAudits(linkId);
        if (lk) {
          const cand = this._retargetCandidates?.find(c => c.target_unit_id === targetUnitId);
          lk.target_unit_id = res.new_target_unit_id;
          if (cand) lk.target_text = cand.target_text;
        }
        this._cb.toast(`✓ Lien ${linkId} reciblé`);
      } else if (mode === "create" || mode === "add") {
        const res = await createAlignLink(conn, { pivot_unit_id: pivotUnitId, target_unit_id: targetUnitId });
        const cand = this._retargetCandidates?.find(c => c.target_unit_id === targetUnitId);
        const famForPivot = this._familyMode ? this._families.find(f => f.family_id === this._familyId) : undefined;
        const pivotText = famForPivot
          ? (this._buildFamilyRows(famForPivot).find(r => r.pivot_unit_id === pivotUnitId)?.pivot_text ?? "")
          : mode === "create"
            ? (this._orphanPivots.find(u => u.unit_id === pivotUnitId)?.text_norm ?? "")
            : (this._auditLinks.find(l => l.pivot_unit_id === pivotUnitId)?.pivot_text ?? "");
        const newLink: AlignLinkRecord = {
          link_id: res.link_id,
          pivot_unit_id: pivotUnitId,
          target_unit_id: targetUnitId,
          external_id: cand?.external_id ?? null,
          pivot_text: pivotText,
          target_text: cand?.target_text ?? "",
          status: res.status,
        };
        if (this._familyMode && this._retargetTargetDocId !== null) {
          const existing = this._familyAudits.get(this._retargetTargetDocId) ?? [];
          this._familyAudits.set(this._retargetTargetDocId, [...existing, newLink]);
        } else {
          this._auditLinks.push(newLink);
          if (mode === "create") {
            this._orphanPivots = this._orphanPivots.filter(u => u.unit_id !== pivotUnitId);
          }
        }
        const hint = mode === "add" ? " — acceptez les deux liens pour valider l'alignement multiple" : "";
        this._cb.toast(`✓ Lien créé${hint}`);
      }
    } catch (err) {
      this._cb.log(`✗ ${mode === "retarget" ? "Reciblage" : "Création lien"} : ${err instanceof Error ? err.message : String(err)}`, true);
    }
    this._retargetActive = null;
    this._retargetCandidates = null;
    this._retargetTargetDocId = null;
    this._renderActiveBitext(el);
    if (!this._familyMode) {
      this._renderOrphanPivots(el);
      this._updateTopbarKpi(el);
    }
  }

  /** Bind picker row cancel + candidate buttons after bitext re-render. */
  private _bindPickerEvents(el: HTMLElement, body: HTMLElement): void {
    body.querySelectorAll<HTMLButtonElement>(".prep-align-picker-cancel").forEach(btn => {
      btn.addEventListener("click", () => {
        this._retargetActive = null;
        this._retargetCandidates = null;
        this._renderBitextBody(el);
        this._renderOrphanPivots(el);
      });
    });
    body.querySelectorAll<HTMLElement>(".prep-align-picker-candidates").forEach(candsEl => {
      this._bindPickerCandidateEvents(el, candsEl);
    });
  }

  // ─── Orphan pivot section ────────────────────────────────────────────────────

  private async _loadOrphanPivots(el: HTMLElement): Promise<void> {
    const conn = this._conn();
    if (!conn) return;
    const pivotId = parseInt(el.querySelector<HTMLSelectElement>("#align-pivot-sel")?.value ?? "");
    if (isNaN(pivotId)) return;
    const bodyEl = el.querySelector<HTMLElement>("#align-orphan-body");
    if (bodyEl) bodyEl.innerHTML = `<p class="hint">&#8230; chargement</p>`;
    try {
      const units = await listUnits(conn, pivotId);
      const linkedIds = new Set(this._auditLinks.map(l => l.pivot_unit_id));
      // Only text units (not structure), not already linked
      this._orphanPivots = units.filter(u => u.unit_type === "line" && !linkedIds.has(u.unit_id));
      this._orphansLoaded = true;
      this._renderOrphanPivots(el);
    } catch (err) {
      if (bodyEl) bodyEl.innerHTML = `<p class="hint">Erreur : ${_esc(err instanceof Error ? err.message : String(err))}</p>`;
    }
  }

  private _renderOrphanPivots(el: HTMLElement): void {
    const bodyEl = el.querySelector<HTMLElement>("#align-orphan-body");
    if (!bodyEl || !this._orphansLoaded) return;
    if (this._orphanPivots.length === 0) {
      bodyEl.innerHTML = `<p class="hint">&#10003; Aucun orphelin &#8212; tous les segments ont au moins un lien.</p>`;
      return;
    }
    bodyEl.innerHTML = this._orphanPivots.map(u => {
      const isOpen = this._retargetActive?.pivotUnitId === u.unit_id && this._retargetActive.mode === "create";
      return `<div class="prep-align-orphan-row${isOpen ? " prep-align-orphan-row--active" : ""}" data-unit-id="${u.unit_id}">
        <span class="prep-align-row-extid">[§${u.n}]</span>
        <span class="prep-align-orphan-text">${_esc(u.text_norm?.slice(0, 100) ?? "")}</span>
        <button class="btn btn-sm btn-secondary prep-align-orphan-link-btn${isOpen ? " active" : ""}" data-unit-id="${u.unit_id}" title="Créer un lien pour ce segment">&#8629; Lier</button>
      </div>${isOpen ? this._pickerRowHtml(u.unit_id, null, u.text_norm ?? "") : ""}`;
    }).join("");
    bodyEl.querySelectorAll<HTMLButtonElement>(".prep-align-orphan-link-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const uid = parseInt(btn.dataset.unitId!);
        if (this._retargetActive?.pivotUnitId === uid) {
          this._retargetActive = null;
          this._retargetCandidates = null;
          this._renderOrphanPivots(el);
        } else {
          void this._activateRetarget(el, null, uid, "create");
        }
      });
    });
    // Bind picker events in orphan section
    bodyEl.querySelectorAll<HTMLButtonElement>(".prep-align-picker-cancel").forEach(btn => {
      btn.addEventListener("click", () => {
        this._retargetActive = null;
        this._retargetCandidates = null;
        this._renderOrphanPivots(el);
      });
    });
    bodyEl.querySelectorAll<HTMLElement>(".prep-align-picker-candidates").forEach(candsEl => {
      this._bindPickerCandidateEvents(el, candsEl);
    });
  }

  private _scrollToNextUnreviewed(el: HTMLElement): void {
    const body = el.querySelector<HTMLElement>("#align-bitext-body");
    if (!body) return;
    const rows = Array.from(body.querySelectorAll<HTMLElement>(".prep-align-row--unreviewed"));
    if (rows.length === 0) { this._cb.toast("Aucun lien non révisé visible."); return; }
    rows[0].scrollIntoView({ behavior: "smooth", block: "nearest" });
    rows[0].classList.add("prep-align-row--highlight");
    setTimeout(() => rows[0].classList.remove("prep-align-row--highlight"), 1200);
  }

  private _updateTopbarKpi(el: HTMLElement): void {
    const kpi = el.querySelector<HTMLElement>("#align-topbar-kpi");
    if (!kpi) return;
    if (this._auditLinks.length === 0) { kpi.style.display = "none"; return; }
    const accepted = this._auditLinks.filter(l => l.status === "accepted").length;
    const rejected = this._auditLinks.filter(l => l.status === "rejected").length;
    const unreviewed = this._auditLinks.filter(l => l.status === null).length;
    const collBadge = this._lastCollisionCount > 0
      ? ` <button id="align-coll-toggle" class="prep-align-coll-badge" title="Voir et r\u00e9soudre les collisions">&#9888; ${this._lastCollisionCount} collision(s)</button>`
      : "";
    kpi.style.display = "";
    kpi.innerHTML = `<span class="kpi-ok">&#10003;${accepted}</span> <span class="kpi-err">&#10007;${rejected}</span> <span class="kpi-muted">?${unreviewed}</span>${collBadge}`;
    kpi.querySelector("#align-coll-toggle")?.addEventListener("click", () => {
      const section = el.querySelector<HTMLElement>("#align-coll-section");
      if (!section) return;
      const isOpen = section.style.display !== "none";
      section.style.display = isOpen ? "none" : "";
      if (!isOpen) {
        section.scrollIntoView({ behavior: "smooth", block: "nearest" });
        this._collOffset = 0; this._collGroups = [];
        void this._loadCollisionsPage(el, false);
      }
    });
  }

  private _updateBatchBar(el: HTMLElement): void {
    const bar = el.querySelector<HTMLElement>("#align-batch-bar");
    const count = el.querySelector<HTMLElement>("#align-batch-count");
    const n = this._selectedLinkIds.size;
    if (count) count.textContent = `${n} sélectionné(s)`;
    if (bar) bar.style.display = n > 0 ? "" : "none";
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
      this._renderBitextBody(el);
      this._updateTopbarKpi(el);
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
      this._renderBitextBody(el);
      this._updateTopbarKpi(el);
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
    this._retargetActive = null;
    this._retargetCandidates = null;
    this._retargetTargetDocId = null;
    this._familyMode = false;
    this._familyId = null;
    this._familyAudits.clear();
    this._familyOffsets.clear();
    this._familyLoading = false;
    this._el = null;
  }

  private async _loadCollisionsPage(el: HTMLElement, append: boolean): Promise<void> {
    const conn = this._conn();
    if (!conn) return;
    const pivotId = parseInt(el.querySelector<HTMLSelectElement>("#align-pivot-sel")?.value ?? "");
    const targetId = parseInt(el.querySelector<HTMLSelectElement>("#align-target-sel")?.value ?? "");
    if (!pivotId || !targetId) {
      this._cb.toast("Chargez d'abord une paire dans l'éditeur bitext.", true);
      return;
    }
    if (!append) { this._collOffset = 0; this._collGroups = []; }
    try {
      const res = await listCollisions(conn, {
        pivot_doc_id: pivotId,
        target_doc_id: targetId,
        limit: this._collLimit,
        offset: this._collOffset,
      });
      this._collTotalCount = res.total_collisions;
      this._collGroups = append ? [...this._collGroups, ...res.collisions] : res.collisions;
      this._collHasMore = res.has_more;
      this._collOffset = res.next_offset;
      this._lastCollisionCount = this._collTotalCount;
      this._renderCollisionTable(el, targetId);
      this._updateTopbarKpi(el);
      this._cb.log(`Collisions : ${this._collTotalCount} groupe(s) trouvé(s).`);
    } catch (err) {
      this._cb.log(`Erreur collisions : ${err instanceof SidecarError ? err.message : String(err)}`, true);
      this._cb.toast("✗ Erreur chargement collisions", true);
    }
  }

  private _renderCollisionTable(el: HTMLElement, targetDocId: number): void {
    const resultEl = el.querySelector<HTMLElement>("#align-coll-result");
    const moreWrap = el.querySelector<HTMLElement>("#align-coll-more-wrap");
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
          ? `<span class="prep-status-badge prep-status-ok">✅ Accepté</span>`
          : lnk.status === "rejected"
          ? `<span class="prep-status-badge prep-status-error">❌ Rejeté</span>`
          : `<span class="prep-status-badge prep-status-unknown">🔵 Non révisé</span>`;
        return `<tr>
          <td class="prep-audit-cell-text">${lnk.target_text}</td>
          <td>[§${lnk.target_external_id ?? "?"}]</td>
          <td>${badge}</td>
          <td class="prep-audit-cell-actions">
            <button class="btn btn-sm btn-primary coll-keep-btn" data-link="${lnk.link_id}" data-group="${g.pivot_unit_id}" title="Garder">✓ Garder</button>
            <button class="btn btn-sm btn-secondary coll-reject-btn" data-link="${lnk.link_id}" title="Rejeter">❌ Rejeter</button>
            <button class="btn btn-sm btn-danger coll-delete-btn" data-link="${lnk.link_id}" data-group="${g.pivot_unit_id}" data-target="${targetDocId}" aria-label="Supprimer ce lien">🗑</button>
          </td>
        </tr>`;
      }).join("");
      return `<div class="collision-group" style="margin-bottom:1rem;border:1px solid var(--border);border-radius:6px;overflow:hidden">
        <div class="collision-pivot-header" style="background:var(--surface-alt,#f5f5f5);padding:0.4rem 0.75rem;font-size:0.85rem;font-weight:600">
          [§${g.pivot_external_id ?? "?"}] ${g.pivot_text}
          <button class="btn btn-sm btn-danger coll-delete-others-btn" data-group="${g.pivot_unit_id}" data-target="${targetDocId}"
            style="float:right;font-size:0.75rem" aria-label="Supprimer tous les liens de ce groupe">🗑 Tout supprimer</button>
        </div>
        <table class="prep-meta-table" style="margin:0;width:100%">
          <thead><tr><th>Texte cible</th><th>Ext. id</th><th>Statut</th><th>Actions</th></tr></thead>
          <tbody>${linksHtml}</tbody>
        </table>
      </div>`;
    }).join("");
    resultEl.innerHTML = header + groupHtml;
    if (moreWrap) moreWrap.style.display = this._collHasMore ? "" : "none";
    resultEl.querySelectorAll<HTMLButtonElement>(".coll-keep-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        void this._resolveCollision([{ action: "keep", link_id: parseInt(btn.dataset.link!) }], el);
      });
    });
    resultEl.querySelectorAll<HTMLButtonElement>(".coll-reject-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        void this._resolveCollision([{ action: "reject", link_id: parseInt(btn.dataset.link!) }], el);
      });
    });
    resultEl.querySelectorAll<HTMLButtonElement>(".coll-delete-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        void this._resolveCollision([{ action: "delete", link_id: parseInt(btn.dataset.link!) }], el);
      });
    });
    resultEl.querySelectorAll<HTMLButtonElement>(".coll-delete-others-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const pivotUid = parseInt(btn.dataset.group!);
        const targetDoc = parseInt(btn.dataset.target!);
        const group = this._collGroups.find(g => g.pivot_unit_id === pivotUid);
        if (!group) return;
        const actions = group.links.map(lnk => ({ action: "delete" as const, link_id: lnk.link_id }));
        void this._resolveCollision(actions, el);
      });
    });
  }

  private async _resolveCollision(
    actions: Array<{ action: "keep" | "delete" | "reject" | "unreviewed"; link_id: number }>,
    el: HTMLElement,
  ): Promise<void> {
    const conn = this._conn();
    if (!conn) return;
    try {
      const res = await resolveCollisions(conn, actions);
      if (res.errors.length > 0) {
        this._cb.toast(`⚠ ${res.errors.length} erreur(s)`, true);
      } else {
        this._cb.toast(`✓ Résolution appliquée (${res.applied} modif., ${res.deleted} suppr.)`);
      }
      this._collOffset = 0;
      this._collGroups = [];
      await this._loadCollisionsPage(el, false);
    } catch (err) {
      this._cb.log(`Erreur résolution collision : ${err instanceof SidecarError ? err.message : String(err)}`, true);
      this._cb.toast("✗ Erreur résolution collision", true);
    }
  }

}

// ─── Utilitaires ─────────────────────────────────────────────────────────────

function _esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function _trunc(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

/**
 * Render a word-level diff between two texts.
 * Returns [pivotHtml, targetHtml] with unmatched spans wrapped in
 * <mark class="align-diff-unmatched">.
 * Uses a greedy longest-common-subsequence on word tokens.
 */
function _wordDiff(a: string, b: string): [string, string] {
  const tokA = a.split(/(\s+)/);
  const tokB = b.split(/(\s+)/);
  const wordsA = tokA.filter((_, i) => i % 2 === 0);
  const wordsB = tokB.filter((_, i) => i % 2 === 0);
  const spacesA = tokA.filter((_, i) => i % 2 === 1);
  const spacesB = tokB.filter((_, i) => i % 2 === 1);

  // LCS on normalised words
  const normA = wordsA.map(w => w.toLowerCase().replace(/[.,;:!?«»""'']/g, ""));
  const normB = wordsB.map(w => w.toLowerCase().replace(/[.,;:!?«»""'']/g, ""));
  const m = normA.length, n = normB.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = normA[i - 1] === normB[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);

  // Backtrack
  const matchedA = new Set<number>(), matchedB = new Set<number>();
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (normA[i - 1] === normB[j - 1]) { matchedA.add(i - 1); matchedB.add(j - 1); i--; j--; }
    else if (dp[i - 1][j] >= dp[i][j - 1]) i--;
    else j--;
  }

  const renderSide = (words: string[], spaces: string[], matched: Set<number>): string => {
    let out = "";
    let inMark = false;
    for (let k = 0; k < words.length; k++) {
      const isMatch = matched.has(k);
      if (!isMatch && !inMark)  { out += `<mark class="align-diff-unmatched">`; inMark = true; }
      if (isMatch  &&  inMark)  { out += `</mark>`; inMark = false; }
      out += _esc(words[k]);
      if (k < spaces.length) out += _esc(spaces[k]);
    }
    if (inMark) out += `</mark>`;
    return out;
  };

  return [renderSide(wordsA, spacesA, matchedA), renderSide(wordsB, spacesB, matchedB)];
}
