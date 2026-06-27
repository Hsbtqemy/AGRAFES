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
  getAlignSourceChangedSummary,
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
import { compareDocsByTitle } from "../lib/docSort.ts";
import { computeNextSteps, type PrepNavTarget } from "../lib/prepNextStep.ts";
import { NextStepBanner } from "../components/NextStepBanner.ts";
import { setHtml, raw } from "../lib/safeHtml.ts";
import { alignPanelTemplate } from "../lib/alignPanelTemplate.ts";

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
  /** Ouvre l'onglet Exporter (cible « export » du bandeau étape suivante). */
  onOpenExporter?: () => void;
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
  /** Bandeau « étape suivante » (HANDOFF Tier A #3). */
  private _nextStepBanner: NextStepBanner | null = null;
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
    setHtml(el, raw(alignPanelTemplate()));
    this._el = el;
    this._bindEvents(el);
    this._populatePairSelects(el);
    initCardAccordions(el);
    void this._loadFamilies(el);
    void this._refreshSourceChangedBanner();
    // Bandeau « étape suivante » (HANDOFF Tier A #3) — après la bannière
    // « source modifiée », masqué tant qu'aucun run n'a réussi.
    this._nextStepBanner = new NextStepBanner((target) => this._navigateNextStep(target));
    el.querySelector("#align-source-changed-banner")?.after(this._nextStepBanner.element);
    return el;
  }

  /** Cible du bandeau « étape suivante » → délègue aux callbacks de navigation. */
  private _navigateNextStep(target: PrepNavTarget): void {
    if (target === "export") this._cb.onOpenExporter?.();
    else this._cb.onNav(target);
  }

  refreshDocs(): void {
    if (!this._el) return;
    this._populatePairSelects(this._el);
    this._populateFamilySelect(this._el);
    void this._refreshSourceChangedBanner();
  }

  /**
   * Appelé par ActionsScreen quand la sous-vue Alignement (re)devient
   * visible. Les sous-vues sont du DOM persistant (toggle display), donc
   * render() ne se rejoue pas — sans ce hook, la bannière « source
   * modifiée » resterait figée après une curation faite ailleurs.
   */
  onActivated(): void {
    void this._refreshSourceChangedBanner();
  }

  /**
   * Bannière d'accueil « source modifiée » (Tier A #6) : un traducteur voit
   * immédiatement, sans ouvrir une paire ni l'audit, qu'il y a des liens
   * d'alignement dont la source pivot a changé depuis l'alignement. Le
   * détail + l'acquittement vivent dans l'écran Documents → Curation.
   */
  private async _refreshSourceChangedBanner(): Promise<void> {
    const banner = this._el?.querySelector<HTMLElement>("#align-source-changed-banner");
    if (!banner) return;
    const conn = this._conn();
    if (!conn) { banner.style.display = "none"; return; }
    try {
      const summary = await getAlignSourceChangedSummary(conn);
      if (summary.total <= 0) {
        banner.style.display = "none";
        banner.innerHTML = "";
        return;
      }
      const docCount = summary.docs.length;
      const liens = `${summary.total} lien${summary.total > 1 ? "s" : ""} d'alignement`;
      const docs = `${docCount} document${docCount > 1 ? "s" : ""}`;
      setHtml(banner, raw(
        `<span class="prep-align-src-changed-icon" aria-hidden="true">&#9888;</span> `
        + `<strong>${liens}</strong> sur ${docs} ont une source pivot modifiée `
        + `depuis l'alignement — la traduction alignée est peut-être à revoir. `
        + `<span class="prep-align-src-changed-hint">Détail et acquittement : `
        + `onglet Documents &#8594; bouton « Curation ».</span>`));
      banner.style.display = "";
    } catch {
      // best-effort : la bannière ne doit jamais casser l'écran.
      banner.style.display = "none";
    }
  }

  // ─── HTML template ──────────────────────────────────────────────────────────


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
      setHtml(statsEl, raw(
        `<span class="prep-align-fp-stat">${aligned_pairs}/${total_pairs} paires · ${completion_pct.toFixed(0)}%</span>` +
        (fam.stats.ratio_warnings.length > 0
          ? ` <span class="prep-align-fp-warn">⚠ ${fam.stats.ratio_warnings.length} ratio(s)</span>` : "") +
        ` ${children}`));
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

    setHtml(bodyEl, raw(`<table class="prep-fam-table">
      <thead><tr>
        <th class="prep-fam-col-pivot">${_esc(_trunc(pivotDoc?.title ?? "Pivot", 24))}</th>
        ${childHeaders}
      </tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>`));

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
    // Tri alphabétique par titre (helper docSort) pour cohérence avec
    // CurationView / SegmentationView / MetadataScreen / ImportScreen /
    // tauri-shell Conventions. Plus de doc_id ascendant brut.
    const docs = [...this._getDocs()].sort(compareDocsByTitle);
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
    if (msgEl) setHtml(msgEl, raw(
      `<strong>${action}</strong> · ${_esc(pivTitle)} &#8596; ${_esc(tgtTitle)}<br>
       Stratégie : <strong>${_esc(strategy)}</strong> ·
       Liens validés : <strong>${preserve ? "conservés" : "remplacés"}</strong>` +
       (debug ? " · debug" : "")));
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
    if (msgEl) setHtml(msgEl, raw(
      `<strong>Aligner famille</strong> · ${_esc(label)} (${n} paires)<br>
       Stratégie : <strong>${_esc(strategy)}</strong> ·
       Liens validés : <strong>${preserve ? "conservés" : "remplacés"}</strong>`));
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
            // Bandeau « étape suivante » (HANDOFF Tier A #3).
            this._nextStepBanner?.show(computeNextSteps({ completed: "align_run" }));
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
      setHtml(banner, raw((recalculate && s.deleted !== undefined)
        ? `<span class="stat-warn">${s.deleted} nettoyés</span> · <span class="prep-stat-ok">${s.preserved} conservés</span>`
        : ""));
    }
    const perTarget = summary.querySelector<HTMLElement>("#align-summary-per-target");
    if (perTarget) {
      setHtml(perTarget, raw(s.perTarget.map(t =>
        `<div class="prep-align-summary-row">→ Doc #${t.doc_id} : <strong>${t.created}</strong> créés, ${t.skipped} ignorés</div>`
      ).join("")));
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
      setHtml(banner, raw(`${aligned}/${total_pairs} paires` +
        (errors > 0 ? ` · <span class="stat-err">${errors} erreur(s)</span>` : "")));
    }

    const perTarget = summary.querySelector<HTMLElement>("#align-summary-per-target");
    if (perTarget) {
      setHtml(perTarget, raw(result.results.map(r => {
        const icon = r.status === "aligned" ? "✓" : r.status === "skipped" ? "⏭" : "✗";
        const cls = r.status === "aligned" ? "prep-stat-ok" : r.status === "error" ? "stat-err" : "";
        return `<div class="prep-align-summary-row ${cls}">${icon} Doc #${r.target_doc_id} (${_esc(r.target_lang)}) : ${r.links_created} liens · ${_esc(r.status)}` +
          (r.warnings.length > 0 ? `<br><em>${r.warnings.map(_esc).join(" · ")}</em>` : "") +
          `</div>`;
      }).join("")));
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
        setHtml(detailsBody, raw(`
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
              `<div class="prep-align-qd-orphan">[§${_esc(String(o.external_id ?? "?"))}] ${_esc(o.text?.slice(0, 80) ?? "")}</div>`
            ).join("")}
          </div>` : ""}
        `));
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
      // État vide : contenu non tabulaire (message) — retirer le rôle table
      // posé par un rendu précédent.
      body.removeAttribute("role");
      body.removeAttribute("aria-label");
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
        <div class="prep-align-row-check" role="cell">
          <input type="checkbox" class="prep-align-row-cb" data-link-id="${lk.link_id}"${checked ? " checked" : ""} aria-label="Sélectionner lien ${lk.link_id}">
        </div>
        <div class="prep-align-row-pivot" role="cell">${extId}${_esc(lk.pivot_text ?? "")}</div>
        <div class="prep-align-row-target" role="cell">${_esc(lk.target_text ?? "")}</div>
        <div class="prep-align-row-actions" role="cell">
          <button class="prep-align-act-btn prep-align-act-accept${lk.status === "accepted" ? " active" : ""}" data-link-id="${lk.link_id}" title="Accepter">✓</button>
          <button class="prep-align-act-btn prep-align-act-reject${lk.status === "rejected" ? " active" : ""}" data-link-id="${lk.link_id}" title="Rejeter">✗</button>
          <button class="prep-align-act-btn prep-align-act-unreview${lk.status === null ? " active" : ""}" data-link-id="${lk.link_id}" title="Non révisé">?</button>
          <button class="prep-align-act-btn prep-align-act-delete" data-link-id="${lk.link_id}" title="Supprimer ce lien">🗑</button>
          <button class="prep-align-act-btn prep-align-act-retarget${isRetargetOpen ? " active" : ""}" data-link-id="${lk.link_id}" data-pivot-uid="${lk.pivot_unit_id}" title="Changer la cible de ce lien">✎</button>
          <button class="prep-align-act-btn prep-align-act-addtarget${isAddOpen ? " active" : ""}" data-link-id="${lk.link_id}" data-pivot-uid="${lk.pivot_unit_id}" title="Ajouter une deuxième cible à ce segment VO">➕</button>
        </div>
      </div>`);
      if (isRetargetOpen) {
        rows.push(this._pickerRowHtml(lk.pivot_unit_id, lk.link_id, lk.pivot_text ?? "", true));
      } else if (isAddOpen && !addPickerRendered.has(lk.pivot_unit_id)) {
        rows.push(this._pickerRowHtml(lk.pivot_unit_id, null, lk.pivot_text ?? "", true));
        addPickerRendered.add(lk.pivot_unit_id);
      }
    }
    setHtml(body, raw(rows.join("")));

    // a11y (E-2) : la liste de liens d'alignement est une table (structure
    // tabulaire div-based). On expose `role="table"` — et non `role="grid"`,
    // qui impliquerait le pattern de navigation clavier grille non implémenté.
    // Les lignes portent `role="row"`, leurs cellules `role="cell"` ; les
    // picker-rows rendues ici le sont en mode `asTableRow` (cf. _pickerRowHtml).
    body.setAttribute("role", "table");
    body.setAttribute("aria-label", "Liens d'alignement à réviser");

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
  /**
   * @param asTableRow quand true, la picker-row est rendue comme une ligne de
   *   table ARIA (`role="row"` + cellules `role="cell"`) — requis lorsqu'elle
   *   est insérée directement dans le conteneur `role="table"` de l'audit
   *   d'alignement (E-2). Ailleurs (vues famille `<table>` HTML native, liste
   *   d'orphelins) elle reste un simple `<div>` sans rôle.
   */
  private _pickerRowHtml(pivotUnitId: number, linkId: number | null, pivotText: string, asTableRow = false): string {
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
          <span class="prep-align-picker-cand-ext">[§${_esc(String(c.external_id ?? "?"))}]</span>
          <span class="prep-align-picker-cand-text">${_esc(c.target_text.slice(0, 120))}</span>
          <span class="prep-align-picker-cand-score">${conflict ? "⚠ déjà lié" : `${(c.score * 100).toFixed(0)}%`}</span>
        </button>`;
      }).join("");
    }
    const rowRole = asTableRow ? ' role="row"' : "";
    const cellRole = asTableRow ? ' role="cell"' : "";
    return `<div class="prep-align-picker-row" data-picker-for="${pivotUnitId}"${rowRole}>
      <div class="prep-align-picker-header"${cellRole}>
        <span>&#9997; Recibler : <em>${_esc(pivotText.slice(0, 60))}</em></span>
        <button class="btn btn-ghost btn-sm prep-align-picker-cancel" data-pivot-uid="${pivotUnitId}" title="Annuler">&#10005;</button>
      </div>
      <div class="prep-align-picker-candidates" id="picker-cands-${pivotUnitId}"${cellRole}>${content}</div>
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
        setHtml(candsEl, raw(candidates.map(c => {
          const conflict = alreadyLinked.has(c.target_unit_id);
          return `<button class="prep-align-picker-cand${conflict ? " prep-align-picker-cand--conflict" : ""}"
            data-uid="${c.target_unit_id}"
            title="${conflict ? "D\u00e9j\u00e0 li\u00e9 \u00e0 ce pivot" : `score ${c.score.toFixed(2)} \u2014 ${_esc(c.reason)}`}"
            ${conflict ? 'data-conflict="1"' : ""}>
            <span class="prep-align-picker-cand-ext">[§${_esc(String(c.external_id ?? "?"))}]</span>
            <span class="prep-align-picker-cand-text">${_esc(c.target_text.slice(0, 120))}</span>
            <span class="prep-align-picker-cand-score">${conflict ? "\u26a0 d\u00e9j\u00e0 li\u00e9" : `${(c.score * 100).toFixed(0)}%`}</span>
          </button>`;
        }).join("")));
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
    setHtml(bodyEl, raw(this._orphanPivots.map(u => {
      const isOpen = this._retargetActive?.pivotUnitId === u.unit_id && this._retargetActive.mode === "create";
      return `<div class="prep-align-orphan-row${isOpen ? " prep-align-orphan-row--active" : ""}" data-unit-id="${u.unit_id}">
        <span class="prep-align-row-extid">[§${u.n}]</span>
        <span class="prep-align-orphan-text">${_esc(u.text_norm?.slice(0, 100) ?? "")}</span>
        <button class="btn btn-sm btn-secondary prep-align-orphan-link-btn${isOpen ? " active" : ""}" data-unit-id="${u.unit_id}" title="Créer un lien pour ce segment">&#8629; Lier</button>
      </div>${isOpen ? this._pickerRowHtml(u.unit_id, null, u.text_norm ?? "") : ""}`;
    }).join("")));
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
    setHtml(kpi, raw(`<span class="kpi-ok">&#10003;${accepted}</span> <span class="kpi-err">&#10007;${rejected}</span> <span class="kpi-muted">?${unreviewed}</span>${collBadge}`));
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
      const restore = () => { setHtml(bar, raw(original)); this._updateBatchBar(el); };
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
          <td class="prep-audit-cell-text">${_esc(lnk.target_text ?? "")}</td>
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
          [§${_esc(String(g.pivot_external_id ?? "?"))}] ${_esc(g.pivot_text ?? "")}
          <button class="btn btn-sm btn-danger coll-delete-others-btn" data-group="${g.pivot_unit_id}" data-target="${targetDocId}"
            style="float:right;font-size:0.75rem" aria-label="Supprimer tous les liens de ce groupe">🗑 Tout supprimer</button>
        </div>
        <table class="prep-meta-table" style="margin:0;width:100%">
          <thead><tr><th>Texte cible</th><th>Ext. id</th><th>Statut</th><th>Actions</th></tr></thead>
          <tbody>${linksHtml}</tbody>
        </table>
      </div>`;
    }).join("");
    setHtml(resultEl, raw(header + groupHtml));
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
  // S-03 — escape " too so the helper is safe in double-quoted attribute contexts,
  // not only in text content (& < > "). Keeps parity with the other prep escapers.
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function _trunc(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}
