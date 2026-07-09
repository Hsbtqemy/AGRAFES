/**
 * AlignMatrixView.ts — source-anchored matrix grid (R3.3 tranches 2c/3b,
 * docs/DESIGN_alignment_workspace §6). A family selector + a grid that projects the
 * aligned form (`/align/matrix` → `buildMatrixView` → `buildMatrixGridHtml`) with ⚠
 * markers on cells à réparer and a completeness strip. First inline gesture (3b):
 * « ✂ Couper » on a fused cell — resolve its 2-1 bead via the tranche-3a identifiers
 * + `/align/audit`, pick the cut point in the two-panel move-only picker (§3.2),
 * apply `set_target_span` ×2, re-project. Sub-view of ActionsScreen.
 */

import type { Conn, FamilyRecord, AlignLinkRecord } from "../lib/sidecarClient.ts";
import { getFamilies, getAlignMatrix, alignAudit, batchUpdateAlignLinks } from "../lib/sidecarClient.ts";
import type { AlignMatrix } from "../lib/sidecarClient.ts";
import type { MatrixView } from "../lib/alignMatrix.ts";
import { buildMatrixView, matrixSummaryLine } from "../lib/alignMatrix.ts";
import { buildMatrixGridHtml } from "../lib/alignMatrixGrid.ts";
import { resolveFusedCellLinks, suggestCutOffset, buildCutPanelsHtml } from "../lib/alignCellCut.ts";
import { buildCutActions, codePointLength } from "../lib/alignBeads.ts";
import { setHtml, raw, safeHtml } from "../lib/safeHtml.ts";
import { escHtml as _esc } from "../lib/diff.ts";

export interface AlignMatrixCallbacks {
  toast?: (msg: string, isError?: boolean) => void;
}

/** Audit paging bounds for cell→links resolution (server max limit = 200). */
const AUDIT_PAGE = 200;
const AUDIT_MAX_PAGES = 30;

export class AlignMatrixView {
  private _root: HTMLElement | null = null;
  private _families: FamilyRecord[] = [];
  private _selectedFamilyId: number | null = null;
  private _loading = false;
  /** Last loaded matrix + view-model — the cut gesture maps cells through them (3a ids). */
  private _matrix: AlignMatrix | null = null;
  private _view: MatrixView | null = null;
  /** Connection the matrix was loaded on — its ids are meaningless on any other DB (F1). */
  private _loadedConn: Conn | null = null;
  /** A cut gesture is in flight (audit fetch or open modal) — blocks reentrancy (F5). */
  private _cutBusy = false;
  /** Teardown of the open cut modal, so dispose()/reset can force-close it (F4). */
  private _closeCutModal: (() => void) | null = null;

  constructor(
    private _getConn: () => Conn | null,
    private _cb: AlignMatrixCallbacks = {},
  ) {}

  render(): HTMLElement {
    const root = document.createElement("div");
    root.className = "prep-matrix";
    this._root = root;
    setHtml(root, raw(
      `<div class="prep-matrix-toolbar">`
      + `<label class="prep-matrix-fam-label">Famille (moyeu)`
      + `<select id="matrix-family" class="prep-matrix-family"><option value="">&#8212; choisir &#8212;</option></select>`
      + `</label>`
      + `<button type="button" id="matrix-load" class="btn btn-primary btn-sm" disabled>Charger la matrice</button>`
      + `<span id="matrix-summary" class="prep-matrix-summary" aria-live="polite"></span>`
      + `</div>`
      + `<div id="matrix-grid-area" class="prep-matrix-grid-area">`
      + `<p class="prep-matrix-hint">Choisis une famille puis &laquo;&nbsp;Charger la matrice&nbsp;&raquo; pour visualiser l'alignement.</p>`
      + `</div>`,
    ));

    const sel = root.querySelector<HTMLSelectElement>("#matrix-family")!;
    const loadBtn = root.querySelector<HTMLButtonElement>("#matrix-load")!;
    sel.addEventListener("change", () => {
      this._selectedFamilyId = sel.value ? Number(sel.value) : null;
      loadBtn.disabled = this._selectedFamilyId === null;
    });
    loadBtn.addEventListener("click", () => void this._loadMatrix());
    // Cut buttons are delegated once here — bindings survive every grid re-render.
    const area = root.querySelector<HTMLElement>("#matrix-grid-area")!;
    area.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".prep-matrix-cut-btn");
      if (btn) void this._openCellCut(Number(btn.dataset.cutRow), Number(btn.dataset.cutCol));
    });
    return root;
  }

  /** Called by ActionsScreen when the sub-view becomes visible. */
  onActivated(): void {
    void this._loadFamilies();
  }

  refreshDocs(): void {
    // A connection change invalidates the loaded matrix: its doc/unit ids belong to
    // the OLD database — a still-visible ✂ would write into the new one (F1).
    if (this._loadedConn && this._getConn() !== this._loadedConn) this._resetMatrix();
    void this._loadFamilies();
  }

  /** Drop the loaded matrix (and any open cut modal) — e.g. after a conn change. */
  private _resetMatrix(): void {
    this._closeCutModal?.();
    this._matrix = null;
    this._view = null;
    this._loadedConn = null;
    const area = this._root?.querySelector<HTMLElement>("#matrix-grid-area");
    if (area) setHtml(area, raw('<p class="prep-matrix-hint">Connexion chang&#233;e &#8212; recharger la matrice.</p>'));
    const summary = this._root?.querySelector<HTMLElement>("#matrix-summary");
    if (summary) summary.textContent = "";
  }

  private async _loadFamilies(): Promise<void> {
    const conn = this._getConn();
    if (!conn || !this._root) return;
    try {
      this._families = (await getFamilies(conn)).filter((f) => f.parent);
    } catch {
      this._families = [];
    }
    const sel = this._root.querySelector<HTMLSelectElement>("#matrix-family");
    if (!sel) return;
    const prev = this._selectedFamilyId;
    sel.innerHTML = '<option value="">— choisir —</option>';
    for (const f of this._families) {
      const opt = document.createElement("option");
      opt.value = String(f.family_id);
      opt.textContent = `#${f.family_id} ${f.parent!.title} (${f.stats.total_docs} docs)`;
      sel.appendChild(opt);
    }
    if (prev !== null && this._families.some((f) => f.family_id === prev)) {
      sel.value = String(prev);
    } else {
      this._selectedFamilyId = null;
    }
    const loadBtn = this._root.querySelector<HTMLButtonElement>("#matrix-load");
    if (loadBtn) loadBtn.disabled = this._selectedFamilyId === null;
  }

  private async _loadMatrix(): Promise<void> {
    const conn = this._getConn();
    if (!conn || this._selectedFamilyId === null || this._loading || !this._root) return;
    const area = this._root.querySelector<HTMLElement>("#matrix-grid-area")!;
    const summary = this._root.querySelector<HTMLElement>("#matrix-summary")!;
    this._loading = true;
    setHtml(area, raw('<p class="prep-matrix-hint">Chargement&#8230;</p>'));
    summary.textContent = "";
    try {
      const matrix = await getAlignMatrix(conn, this._selectedFamilyId);
      const view = buildMatrixView(matrix);
      this._matrix = matrix;
      this._view = view;
      this._loadedConn = conn;
      if (view.rows.length === 0) {
        setHtml(area, raw('<p class="prep-matrix-hint">Aucun segment dans le moyeu de cette famille.</p>'));
      } else {
        setHtml(area, raw(buildMatrixGridHtml(view)));
        summary.textContent = matrixSummaryLine(view);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setHtml(area, raw(`<p class="prep-matrix-error">Erreur&nbsp;: ${_esc(msg)}</p>`));
      this._cb.toast?.("✗ Erreur chargement matrice", true);
    } finally {
      this._loading = false;
    }
  }

  // ─── Tranche 3b — « ✂ Couper » from a fused cell ──────────────────────────────

  /** All audit links of the hub↔target pair (paged; the pair is small vs the corpus). */
  private async _fetchAllAuditLinks(
    conn: Conn, pivotDocId: number, targetDocId: number,
  ): Promise<AlignLinkRecord[]> {
    const links: AlignLinkRecord[] = [];
    for (let page = 0; page < AUDIT_MAX_PAGES; page++) {
      const res = await alignAudit(conn, {
        pivot_doc_id: pivotDocId,
        target_doc_id: targetDocId,
        limit: AUDIT_PAGE,
        offset: page * AUDIT_PAGE,
      });
      links.push(...(res.links ?? []));
      if (!res.has_more) return links;
    }
    // The 3-1 guard in resolveFusedCellLinks needs the full link set to be sound.
    throw new Error(`plus de ${AUDIT_MAX_PAGES * AUDIT_PAGE} liens — couper via la Révision fine`);
  }

  private async _openCellCut(row: number, col: number): Promise<void> {
    const conn = this._getConn();
    const matrix = this._matrix;
    const view = this._view;
    if (!conn || !matrix || !view || row < 1 || this._cutBusy) return;
    if (conn !== this._loadedConn) {
      // Conn changed under a still-rendered grid: its ids belong to another DB (F1).
      this._cb.toast?.("✗ Connexion changée — recharger la matrice avant de couper", true);
      this._resetMatrix();
      return;
    }
    const hubIds = matrix.hub_unit_ids;
    const docIds = matrix.language_doc_ids;
    if (!hubIds || !docIds) {
      this._cb.toast?.("✗ Sidecar trop ancien — identifiants de cellule absents (recompiler le sidecar)", true);
      return;
    }
    this._cutBusy = true; // released on early exit below, else when the modal closes
    let opened = false;
    try {
      let links: AlignLinkRecord[];
      try {
        links = await this._fetchAllAuditLinks(conn, matrix.hub_doc_id, docIds[col + 1]);
      } catch (err) {
        this._cb.toast?.(`✗ Audit : ${err instanceof Error ? err.message : String(err)}`, true);
        return;
      }
      if (this._matrix !== matrix) {
        // The matrix was reloaded during the audit round-trips — row/col no longer
        // point at the same cells (F3).
        this._cb.toast?.("✗ Matrice rechargée pendant la résolution — geste annulé", true);
        return;
      }
      const res = resolveFusedCellLinks(links, hubIds[row - 1], hubIds[row]);
      if (res.error !== undefined) {
        this._cb.toast?.(`✗ ${res.error}`, true);
        return;
      }
      this._openCutModal(res.links, row, col, view);
      opened = true;
    } finally {
      if (!opened) this._cutBusy = false;
    }
  }

  /**
   * The §3.2 two-panel move-only picker, as a centered modal (modalConfirm pattern).
   * `view` is the view-model captured BEFORE the audit round-trip — never re-read
   * from `this` here, a concurrent reload would mislabel the panels (F3).
   */
  private _openCutModal(
    links: [AlignLinkRecord, AlignLinkRecord], row: number, col: number, view: MatrixView,
  ): void {
    const targetRaw = links[0].target_text_raw ?? "";
    const rowAbove = view.rows[row - 1];
    const rowCur = view.rows[row];
    const suggested = suggestCutOffset(targetRaw, rowAbove.hubText, rowCur.hubText);
    if (suggested === null) { this._cutBusy = false; return; } // resolver guarantees a boundary
    let cur: number = suggested;

    const overlay = document.createElement("div");
    overlay.className = "prep-matrix-cut-overlay";
    const dialog = document.createElement("div");
    dialog.className = "prep-matrix-cut-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    setHtml(dialog, safeHtml`
      <div class="prep-matrix-cut-title">&#9986; Couper la traduction (${view.translationLangs[col] ?? "?"})</div>
      <p class="prep-matrix-cut-hint">Panneau haut = ce qui restera align&#233; au segment ${String(rowAbove.segment)},
        panneau bas = au segment ${String(rowCur.segment)}. Cliquez un mot pour le d&#233;placer
        d'un panneau &#224; l'autre (coupe en un point, texte conserv&#233; verbatim &#8212; rien &#224; retaper).</p>
      <div class="prep-matrix-cut-panels"></div>
      <div class="prep-matrix-cut-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-cut-cancel>Annuler</button>
        <button type="button" class="btn btn-primary btn-sm" data-cut-ok>&#9986; Couper</button>
      </div>
    `);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const panelsHost = dialog.querySelector<HTMLElement>(".prep-matrix-cut-panels")!;
    const labels = {
      topSeg: rowAbove.segment, topHub: rowAbove.hubText,
      bottomSeg: rowCur.segment, bottomHub: rowCur.hubText,
    };
    const renderPanels = () => setHtml(panelsHost, raw(buildCutPanelsHtml(targetRaw, cur, labels)));
    renderPanels();

    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    const close = () => {
      document.removeEventListener("keydown", onKey);
      overlay.remove();
      this._closeCutModal = null;
      this._cutBusy = false;
    };
    this._closeCutModal = close;
    // Backdrop dismiss decides on the MOUSEDOWN target: a text-selection drag that
    // starts in the dialog and releases on the backdrop must not discard the
    // adjusted cut point (the click lands on the common ancestor = overlay, F10).
    let downOnBackdrop = false;
    overlay.addEventListener("mousedown", (e) => { downOnBackdrop = e.target === overlay; });
    overlay.addEventListener("click", (e) => { if (downOnBackdrop && e.target === overlay) close(); });
    document.addEventListener("keydown", onKey);
    // Word clicks re-render the panels — delegate so bindings survive re-renders.
    panelsHost.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".prep-matrix-cut-word[data-cut-offset]");
      if (!btn) return;
      cur = Number(btn.dataset.cutOffset);
      renderPanels();
    });
    dialog.querySelector<HTMLButtonElement>("[data-cut-cancel]")!
      .addEventListener("click", close);
    const okBtn = dialog.querySelector<HTMLButtonElement>("[data-cut-ok]")!;
    okBtn.addEventListener("click", () => void this._performCellCut(links, targetRaw, cur, close, okBtn));
  }

  private async _performCellCut(
    links: [AlignLinkRecord, AlignLinkRecord],
    targetRaw: string,
    offset: number,
    close: () => void,
    okBtn: HTMLButtonElement,
  ): Promise<void> {
    const conn = this._getConn();
    if (!conn) return;
    const actions = buildCutActions(links, offset, codePointLength(targetRaw));
    if (actions.length === 0) return;
    okBtn.disabled = true; // one flight max — a double-click must not double-post (F5)
    try {
      const res = await batchUpdateAlignLinks(conn, actions);
      if (res.errors.length) {
        if (res.applied > 0) {
          // The batch is NOT transactional server-side: the applied half is durably
          // committed. Pretending nothing happened would desync the UI (F2) —
          // close and re-project so the grid shows the real state.
          close();
          this._cb.toast?.(
            `✗ Coupe partielle (${res.applied}/${actions.length} appliquée) : ${res.errors[0].error} — matrice resynchronisée`,
            true,
          );
          await this._reloadPreservingScroll();
        } else {
          this._cb.toast?.(`✗ Coupe refusée : ${res.errors[0].error}`, true);
          okBtn.disabled = false;
        }
        return;
      }
      close();
      this._cb.toast?.("✓ Traduction coupée");
      await this._reloadPreservingScroll();
    } catch (err) {
      okBtn.disabled = false;
      this._cb.toast?.(`✗ Coupe : ${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  /** Re-project the matrix without losing the reading position (§4.1 invariant). */
  private async _reloadPreservingScroll(): Promise<void> {
    // #matrix-grid-area itself persists (only its innerHTML is swapped) — but the
    // interim « Chargement… » hint collapses the content and clamps the scroll.
    const area = this._root?.querySelector<HTMLElement>("#matrix-grid-area");
    const scroller = this._findScrollParent(area);
    const left = area?.scrollLeft ?? 0;
    const top = scroller?.scrollTop ?? 0;
    await this._loadMatrix();
    if (area) area.scrollLeft = left;
    if (scroller) scroller.scrollTop = top;
  }

  private _findScrollParent(el: HTMLElement | null | undefined): HTMLElement | null {
    let cur = el?.parentElement ?? null;
    while (cur) {
      const oy = getComputedStyle(cur).overflowY;
      if (oy === "auto" || oy === "scroll") return cur;
      cur = cur.parentElement;
    }
    return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : null;
  }

  dispose(): void {
    // Force-close an open cut modal: its overlay lives on document.body and its
    // Escape handler on document — they must not outlive the view (F4).
    this._closeCutModal?.();
    this._root = null;
    this._families = [];
    this._selectedFamilyId = null;
    this._matrix = null;
    this._view = null;
    this._loadedConn = null;
    this._cutBusy = false;
  }
}
