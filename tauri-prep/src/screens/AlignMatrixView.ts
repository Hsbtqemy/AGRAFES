/**
 * AlignMatrixView.ts — source-anchored matrix grid (R3.3 tranches 2c/3b/D-W12,
 * docs/DESIGN_alignment_workspace §3.2/§3.4/§6). A family selector + a grid that
 * projects the aligned form (`/align/matrix` → `buildMatrixView` → `buildMatrixGridHtml`)
 * with ⚠ markers and a completeness strip. Gestures resolve through the payload's own
 * `cell_links` (A2, sidecar ≥ 1.6.54) — synchronous, no audit round-trip:
 *
 * - « ✂ Couper » on a fused ⚠ cell (3b): slice the shared target between the two rows
 *   (`set_target_span` ×2, atomic batch).
 * - « ✂ couper à cheval » on ANY aligned cell (D-W12 — on demand, the ⚠ only
 *   prioritizes): the translation spills over the neighbouring hub segment — create
 *   the missing link toward the neighbour, then slice (atomic batch; the created link
 *   is deleted in compensation if the batch fails).
 *
 * Both use the two-panel move-only picker (§3.2). Sub-view of ActionsScreen.
 */

import type { Conn, FamilyRecord, MatrixCellLink } from "../lib/sidecarClient.ts";
import {
  getFamilies, getAlignMatrix, batchUpdateAlignLinks, createAlignLink, deleteAlignLink,
} from "../lib/sidecarClient.ts";
import type { AlignMatrix } from "../lib/sidecarClient.ts";
import type { MatrixView, MatrixRowView } from "../lib/alignMatrix.ts";
import { buildMatrixView, matrixSummaryLine } from "../lib/alignMatrix.ts";
import { buildMatrixGridHtml } from "../lib/alignMatrixGrid.ts";
import type { CellLinkColumn, StraddleDirection } from "../lib/alignCellCut.ts";
import {
  resolveFusedCellLinks, resolveStraddleCut, resolveCellUncut,
  buildPartitionActions, buildUncutActions, suggestCutOffset, buildCutPanelsHtml,
} from "../lib/alignCellCut.ts";
import { setHtml, raw, safeHtml } from "../lib/safeHtml.ts";
import { escHtml as _esc } from "../lib/diff.ts";

export interface AlignMatrixCallbacks {
  toast?: (msg: string, isError?: boolean) => void;
}

export class AlignMatrixView {
  private _root: HTMLElement | null = null;
  private _families: FamilyRecord[] = [];
  private _selectedFamilyId: number | null = null;
  private _loading = false;
  /** Last loaded matrix + view-model — the gestures map cells through the view. */
  private _matrix: AlignMatrix | null = null;
  private _view: MatrixView | null = null;
  /** Connection the matrix was loaded on — its ids are meaningless on any other DB (F1). */
  private _loadedConn: Conn | null = null;
  /** A cut gesture is in flight (open modal) — blocks reentrancy (F5). */
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
    // Gesture buttons are delegated once here — bindings survive every grid re-render.
    const area = root.querySelector<HTMLElement>("#matrix-grid-area")!;
    area.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const fusedBtn = t.closest<HTMLButtonElement>(".prep-matrix-cut-btn");
      if (fusedBtn) {
        this._openFusedCut(Number(fusedBtn.dataset.cutRow), Number(fusedBtn.dataset.cutCol));
        return;
      }
      const anyBtn = t.closest<HTMLButtonElement>(".prep-matrix-cut-any-btn");
      if (anyBtn) {
        this._openStraddleCut(Number(anyBtn.dataset.cutRow), Number(anyBtn.dataset.cutCol));
        return;
      }
      const uncutBtn = t.closest<HTMLButtonElement>(".prep-matrix-uncut-btn");
      if (uncutBtn) void this._performCellUncut(Number(uncutBtn.dataset.cutRow), Number(uncutBtn.dataset.cutCol));
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

  // ─── Gestures — shared preconditions & picker shell ───────────────────────────

  /**
   * Common gesture guard (F1/F5 + cell_links availability). Returns the view and the
   * translation column's per-row links, or null after having toasted the reason.
   * Everything here is synchronous — resolution happens on the already-loaded payload,
   * so no staleness window can open between the click and the modal (ex-F3).
   */
  private _cellGestureCtx(col: number): { view: MatrixView; column: CellLinkColumn } | null {
    const conn = this._getConn();
    const view = this._view;
    if (!conn || !view || this._cutBusy) return null;
    if (conn !== this._loadedConn) {
      this._cb.toast?.("✗ Connexion changée — recharger la matrice avant de couper", true);
      this._resetMatrix();
      return null;
    }
    if (!view.hasCellLinks) {
      this._cb.toast?.("✗ Sidecar trop ancien — identifiants de cellule absents (recompiler le sidecar)", true);
      return null;
    }
    return { view, column: view.rows.map((r) => r.cells[col]?.links ?? []) };
  }

  /**
   * Overlay + dialog shell shared by the two cut modals, carrying the lifecycle
   * hardening: tracked close (F4), busy flag released on close (F5), backdrop
   * dismiss decided on the MOUSEDOWN target so a text-selection drag never
   * discards the adjusted cut point (F10), Escape on document.
   */
  private _openPickerShell(title: string, hint: string, extraHtml: string): {
    dialog: HTMLElement; panelsHost: HTMLElement; okBtn: HTMLButtonElement; close: () => void;
  } {
    this._cutBusy = true;
    const overlay = document.createElement("div");
    overlay.className = "prep-matrix-cut-overlay";
    const dialog = document.createElement("div");
    dialog.className = "prep-matrix-cut-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    setHtml(dialog, safeHtml`
      <div class="prep-matrix-cut-title">${title}</div>
      <p class="prep-matrix-cut-hint">${hint}</p>
      ${raw(extraHtml)}
      <div class="prep-matrix-cut-panels"></div>
      <div class="prep-matrix-cut-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-cut-cancel>Annuler</button>
        <button type="button" class="btn btn-primary btn-sm" data-cut-ok>&#9986; Couper</button>
      </div>
    `);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    const close = () => {
      document.removeEventListener("keydown", onKey);
      overlay.remove();
      this._closeCutModal = null;
      this._cutBusy = false;
    };
    this._closeCutModal = close;
    let downOnBackdrop = false;
    overlay.addEventListener("mousedown", (e) => { downOnBackdrop = e.target === overlay; });
    overlay.addEventListener("click", (e) => { if (downOnBackdrop && e.target === overlay) close(); });
    document.addEventListener("keydown", onKey);
    dialog.querySelector<HTMLButtonElement>("[data-cut-cancel]")!.addEventListener("click", close);

    return {
      dialog,
      panelsHost: dialog.querySelector<HTMLElement>(".prep-matrix-cut-panels")!,
      okBtn: dialog.querySelector<HTMLButtonElement>("[data-cut-ok]")!,
      close,
    };
  }

  // ─── « ✂ Couper » on a fused cell (3b) ────────────────────────────────────────

  private _openFusedCut(row: number, col: number): void {
    const ctx = this._cellGestureCtx(col);
    if (!ctx || row < 1) return;
    const res = resolveFusedCellLinks(ctx.column, row);
    if (res.error !== undefined) {
      this._cb.toast?.(`✗ ${res.error}`, true);
      return;
    }
    // Hub texts of the group's two sides drive the proportional suggestion — for an
    // N-1 partition (D-W13) each side may span several rows.
    const rowsOf = (links: MatrixCellLink[]): MatrixRowView[] =>
      ctx.view.rows.filter((r) => r.cells[col]?.links.some((l) => links.includes(l)));
    const aboveRows = rowsOf(res.above);
    const belowRows = rowsOf(res.below);
    const hubAbove = aboveRows.map((r) => r.hubText).join(" ");
    const hubBelow = belowRows.map((r) => r.hubText).join(" ");
    const rowAbove = ctx.view.rows[row - 1];
    const rowCur = ctx.view.rows[row];
    const suggested = suggestCutOffset(res.targetRaw, hubAbove, hubBelow, res.window);
    if (suggested === null) return; // resolver guarantees a viable boundary
    let cur: number = suggested;

    const lang = ctx.view.translationLangs[col] ?? "?";
    const segsAbove = aboveRows.map((r) => r.segment).join("+");
    const segsBelow = belowRows.map((r) => r.segment).join("+");
    const { panelsHost, okBtn } = this._openPickerShell(
      `✂ Couper la traduction (${lang})`,
      `Panneau haut = ce qui restera aligné au segment ${segsAbove}, panneau bas = au segment `
      + `${segsBelow}. Cliquez un mot pour le déplacer d'un panneau à l'autre (coupe en un point, `
      + `texte conservé verbatim — rien à retaper).`,
      "",
    );
    const labels = {
      topSeg: rowAbove.segment, topHub: hubAbove,
      bottomSeg: rowCur.segment, bottomHub: hubBelow,
    };
    const renderPanels = () =>
      setHtml(panelsHost, raw(buildCutPanelsHtml(res.targetRaw, cur, labels, res.window)));
    renderPanels();
    panelsHost.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".prep-matrix-cut-word[data-cut-offset]");
      if (!btn) return;
      cur = Number(btn.dataset.cutOffset);
      renderPanels();
    });
    okBtn.addEventListener("click", () =>
      void this._performFusedCut(res.above, res.below, res.window, cur, this._closeCutModal!, okBtn));
  }

  private async _performFusedCut(
    above: MatrixCellLink[],
    below: MatrixCellLink[],
    window: [number, number],
    offset: number,
    close: () => void,
    okBtn: HTMLButtonElement,
  ): Promise<void> {
    const conn = this._getConn();
    if (!conn) return;
    const actions = buildPartitionActions(above, below, offset, window[0], window[1]);
    if (actions.length === 0) return;
    okBtn.disabled = true; // one flight max — a double-click must not double-post (F5)
    try {
      const res = await batchUpdateAlignLinks(conn, actions, { atomic: true });
      if (res.errors.length) {
        if (res.applied > 0) {
          // Old sidecar without atomic support: the applied half is durably committed.
          // Pretending nothing happened would desync the UI (F2) — resync.
          close();
          this._cb.toast?.(
            `✗ Coupe partielle (${res.applied}/${actions.length} appliquée) : ${res.errors[0].error} — matrice resynchronisée`,
            true,
          );
          await this._reloadPreservingScroll();
        } else {
          this._cb.toast?.(`✗ Coupe refusée : ${res.errors[0].error} (rien n'a été appliqué)`, true);
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

  // ─── « ✂ couper à cheval » on any cell (D-W12 §3.4) ───────────────────────────

  private _openStraddleCut(row: number, col: number): void {
    const ctx = this._cellGestureCtx(col);
    if (!ctx) return;
    const resUp = resolveStraddleCut(ctx.column, row, "up");
    const resDown = resolveStraddleCut(ctx.column, row, "down");
    if (resUp.error !== undefined && resDown.error !== undefined) {
      this._cb.toast?.(`✗ ${resUp.error}`, true);
      return;
    }
    const view = ctx.view;
    const rowCur = view.rows[row];
    let dir: StraddleDirection = resUp.error === undefined ? "up" : "down";

    // On a multi-link cell the direction picks the EDGE link (§3.5) — link, window
    // and raw text are therefore per-direction.
    const dirCtx = (d: StraddleDirection): {
      link: MatrixCellLink; window: [number, number]; targetRaw: string;
      top: MatrixRowView; bottom: MatrixRowView; neighbor: MatrixRowView;
    } | null => {
      const r = d === "up" ? resUp : resDown;
      if (r.error !== undefined) return null;
      const neighbor = view.rows[r.neighborRow];
      return {
        link: r.link, window: r.window, targetRaw: r.link.target_text_raw ?? "",
        ...(d === "up"
          ? { top: neighbor, bottom: rowCur, neighbor }
          : { top: rowCur, bottom: neighbor, neighbor }),
      };
    };

    const radio = (d: StraddleDirection, label: string): string => {
      const r = d === "up" ? resUp : resDown;
      const disabled = r.error !== undefined;
      return `<label class="prep-matrix-cut-dir-opt${disabled ? " prep-matrix-cut-dir-opt--off" : ""}"`
        + (disabled ? ` title="${_esc(r.error!)}"` : "")
        + `><input type="radio" name="prep-matrix-cut-dir" value="${d}"`
        + `${d === dir ? " checked" : ""}${disabled ? " disabled" : ""}> ${label}</label>`;
    };
    const segUp = row > 0 ? view.rows[row - 1]?.segment : null;
    const segDown = view.rows[row + 1]?.segment ?? null;
    const extra = `<div class="prep-matrix-cut-dir" role="radiogroup" aria-label="Sens de la coupe">`
      + radio("up", `Le <b>début</b> appartient au segment précédent${segUp != null ? ` (${segUp})` : ""}`)
      + radio("down", `La <b>fin</b> appartient au segment suivant${segDown != null ? ` (${segDown})` : ""}`)
      + `</div>`;

    const lang = view.translationLangs[col] ?? "?";
    const { dialog, panelsHost, okBtn } = this._openPickerShell(
      `✂ Couper à cheval (${lang}, segment ${rowCur.segment})`,
      `Cette traduction déborde sur un segment voisin : le lien manquant sera créé puis la coupe posée `
      + `(réversible). Cliquez un mot pour déplacer la frontière.`,
      extra,
    );

    let cur = 0;
    const renderPanels = () => {
      const c = dirCtx(dir)!;
      setHtml(panelsHost, raw(buildCutPanelsHtml(c.targetRaw, cur, {
        topSeg: c.top.segment, topHub: c.top.hubText,
        bottomSeg: c.bottom.segment, bottomHub: c.bottom.hubText,
      }, c.window)));
    };
    const resuggest = () => {
      const c = dirCtx(dir)!;
      cur = suggestCutOffset(c.targetRaw, c.top.hubText, c.bottom.hubText, c.window) ?? 0;
    };
    resuggest();
    renderPanels();

    dialog.querySelectorAll<HTMLInputElement>('input[name="prep-matrix-cut-dir"]').forEach((r) =>
      r.addEventListener("change", () => {
        dir = r.value as StraddleDirection;
        resuggest();
        renderPanels();
      }));
    panelsHost.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".prep-matrix-cut-word[data-cut-offset]");
      if (!btn) return;
      cur = Number(btn.dataset.cutOffset);
      renderPanels();
    });
    okBtn.addEventListener("click", () => {
      const c = dirCtx(dir);
      if (!c || c.neighbor.hubUnitId == null) return;
      void this._performStraddleCut(c.link, c.neighbor.hubUnitId, dir, c.window, cur, this._closeCutModal!, okBtn);
    });
  }

  /**
   * The compound gesture (§3.4): create the missing link toward the neighbour, then
   * slice both links in ONE atomic batch. If the batch fails, the created link is
   * deleted in compensation — never leave an orphan whole-unit link behind (it would
   * project the full text twice). If even the compensation fails, resync so the grid
   * shows the real state.
   */
  private async _performStraddleCut(
    existing: MatrixCellLink,
    neighborHubUnitId: number,
    direction: StraddleDirection,
    window: [number, number],
    offset: number,
    close: () => void,
    okBtn: HTMLButtonElement,
  ): Promise<void> {
    const conn = this._getConn();
    if (!conn) return;
    okBtn.disabled = true;
    let createdId: number | null = null;
    try {
      const created = await createAlignLink(conn, {
        pivot_unit_id: neighborHubUnitId,
        target_unit_id: existing.target_unit_id,
        // Inherit the sibling's pair number so audit views sort the new link next
        // to its family instead of a stray [§0] (D-W13, 1.6.55).
        ...(typeof existing.external_id === "number" ? { external_id: existing.external_id } : {}),
      });
      createdId = created.link_id;
      // "up": the neighbour above gets the head of the window; "down": the tail.
      const [aboveSide, belowSide] = direction === "up"
        ? [[{ link_id: createdId }], [{ link_id: existing.link_id }]]
        : [[{ link_id: existing.link_id }], [{ link_id: createdId }]];
      const actions = buildPartitionActions(aboveSide, belowSide, offset, window[0], window[1]);
      if (actions.length === 0) throw new Error("point de coupe invalide");
      const res = await batchUpdateAlignLinks(conn, actions, { atomic: true });
      if (res.errors.length) {
        if (res.applied > 0) {
          // Old sidecar without atomic: partially committed — resync, keep the link
          // (deleting it now could orphan an applied slice).
          close();
          this._cb.toast?.(
            `✗ Coupe à cheval partielle : ${res.errors[0].error} — matrice resynchronisée`, true);
          await this._reloadPreservingScroll();
          return;
        }
        await deleteAlignLink(conn, { link_id: createdId });
        createdId = null;
        this._cb.toast?.(`✗ Coupe à cheval refusée : ${res.errors[0].error} (rien n'a été appliqué)`, true);
        okBtn.disabled = false;
        return;
      }
      close();
      this._cb.toast?.("✓ Traduction coupée à cheval");
      await this._reloadPreservingScroll();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (createdId != null) {
        try {
          await deleteAlignLink(conn, { link_id: createdId });
          okBtn.disabled = false;
          this._cb.toast?.(`✗ Coupe à cheval : ${msg}`, true);
        } catch {
          // Compensation failed: an uncut extra link remains → show the real state.
          close();
          this._cb.toast?.(`✗ Coupe à cheval : ${msg} — matrice resynchronisée`, true);
          await this._reloadPreservingScroll();
        }
        return;
      }
      okBtn.disabled = false;
      this._cb.toast?.(`✗ Coupe à cheval : ${msg}`, true);
    }
  }

  // ─── « ↺ » on a cut cell — the target becomes whole again (D-W13 §3.5) ────────

  private async _performCellUncut(row: number, col: number): Promise<void> {
    const ctx = this._cellGestureCtx(col);
    if (!ctx) return;
    const res = resolveCellUncut(ctx.column, row);
    if (res.error !== undefined) {
      this._cb.toast?.(`✗ ${res.error}`, true);
      return;
    }
    const conn = this._getConn();
    if (!conn) return;
    const actions = buildUncutActions(res);
    if (actions.length === 0) return;
    this._cutBusy = true; // no modal here — the flag guards the whole round-trip (F5)
    try {
      const resp = await batchUpdateAlignLinks(conn, actions, { atomic: true });
      if (resp.errors.length) {
        if (resp.applied > 0 || resp.deleted > 0) {
          // Old sidecar without atomic: partially committed — resync.
          this._cb.toast?.(
            `✗ Annulation partielle : ${resp.errors[0].error} — matrice resynchronisée`, true);
          await this._reloadPreservingScroll();
        } else {
          this._cb.toast?.(`✗ Annulation refusée : ${resp.errors[0].error} (rien n'a été appliqué)`, true);
        }
        return;
      }
      this._cb.toast?.(
        res.deletes.length > 0
          ? `✓ Coupe annulée (${res.deletes.length} lien${res.deletes.length > 1 ? "s" : ""} de geste supprimé${res.deletes.length > 1 ? "s" : ""})`
          : "✓ Coupe annulée");
      await this._reloadPreservingScroll();
    } catch (err) {
      this._cb.toast?.(`✗ Annulation : ${err instanceof Error ? err.message : String(err)}`, true);
    } finally {
      this._cutBusy = false;
    }
  }

  // ─── Reload & lifecycle ───────────────────────────────────────────────────────

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
