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
 * - « ∅ non traduit » on an empty cell (D-W8, sidecar ≥ 1.6.56): per-cell mark via
 *   `/align/cell_status` (its ↺ clears; a hub-global mark is managed source-side).
 * - « N hors matrice » column badge (D-W14): panel of the uncovered units, from which
 *   « ＋ Ajout » poses unit_status='ajout' → the flux [ajout] row appears (its ↺ clears).
 *
 * Both cuts use the two-panel move-only picker (§3.2). Sub-view of ActionsScreen.
 */

import type { Conn, FamilyRecord, MatrixCellLink, FamilyAlignOptions } from "../lib/sidecarClient.ts";
import {
  getFamilies, getAlignMatrix, batchUpdateAlignLinks, createAlignLink, deleteAlignLink,
  setAlignCellStatus, bulkSetUnitStatus, alignFamily,
} from "../lib/sidecarClient.ts";
import type { AlignStrategy } from "../lib/alignRunBar.ts";
import {
  ALIGN_DEFAULTS, STRATEGY_LABELS, buildAlignAdvancedHtml, buildAlignRerunConfirmHtml,
  alignRunSummary,
} from "../lib/alignRunBar.ts";
import type { AlignMatrix } from "../lib/sidecarClient.ts";
import type { MatrixView, MatrixRowView } from "../lib/alignMatrix.ts";
import { buildMatrixView, matrixSummaryLine } from "../lib/alignMatrix.ts";
import { buildMatrixGridHtml } from "../lib/alignMatrixGrid.ts";
import type { CellLinkColumn, StraddleDirection } from "../lib/alignCellCut.ts";
import {
  resolveFusedCellLinks, resolveStraddleCut, resolveCellUncut, resolveCellMerge,
  cellCutTargets, buildPartitionActions, buildUncutActions, buildCellBeadActions,
  suggestCutOffset, buildCutPanelsHtml,
} from "../lib/alignCellCut.ts";
import { setHtml, raw, safeHtml } from "../lib/safeHtml.ts";
import { escHtml as _esc } from "../lib/diff.ts";

export interface AlignMatrixCallbacks {
  toast?: (msg: string, isError?: boolean) => void;
}

/** Truncate for display on CODE POINTS: slicing UTF-16 units splits a surrogate pair
 *  (emoji, CJK ext.) and leaves a lone half that renders as « � » (revue R6c). */
function shortenCp(s: string, max: number): string {
  const cps = Array.from(s);
  return cps.length > max ? `${cps.slice(0, max).join("")}…` : s;
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
  /** An alignment run is in flight — the button must not fire twice (tranche 5). */
  private _aligning = false;
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
      // Tranche 5 (§4) — « Aligner » runs on an ASSUMED DEFAULT; the mode is a fold-away,
      // not a prerequisite (it used to be buried in the Settings, and opaque).
      + `<button type="button" id="matrix-align" class="btn btn-secondary btn-sm" disabled`
      + ` title="Aligner cette famille (longueurs ¶ — le mode se change dans « Avancé »)">&#8646; Aligner</button>`
      + `<button type="button" id="matrix-align-adv-toggle" class="btn btn-ghost btn-sm" disabled`
      + ` aria-expanded="false" aria-controls="matrix-align-adv">Avanc&#233;&#8230;</button>`
      + `<span id="matrix-summary" class="prep-matrix-summary" aria-live="polite"></span>`
      + `</div>`
      + buildAlignAdvancedHtml()
      + `<div id="matrix-align-strip" class="prep-matrix-align-strip" aria-live="polite"></div>`
      + `<div id="matrix-grid-area" class="prep-matrix-grid-area">`
      + `<p class="prep-matrix-hint">Choisis une famille puis &laquo;&nbsp;Charger la matrice&nbsp;&raquo; pour visualiser l'alignement.</p>`
      + `</div>`,
    ));

    const sel = root.querySelector<HTMLSelectElement>("#matrix-family")!;
    const loadBtn = root.querySelector<HTMLButtonElement>("#matrix-load")!;
    const alignBtn = root.querySelector<HTMLButtonElement>("#matrix-align")!;
    const advBtn = root.querySelector<HTMLButtonElement>("#matrix-align-adv-toggle")!;
    sel.addEventListener("change", () => {
      this._selectedFamilyId = sel.value ? Number(sel.value) : null;
      const none = this._selectedFamilyId === null;
      loadBtn.disabled = none;
      alignBtn.disabled = none;
      advBtn.disabled = none;
    });
    loadBtn.addEventListener("click", () => void this._loadMatrix());
    alignBtn.addEventListener("click", () => this._onAlignClick());
    advBtn.addEventListener("click", () => {
      const adv = root.querySelector<HTMLElement>("#matrix-align-adv")!;
      const open = adv.hasAttribute("hidden");
      adv.toggleAttribute("hidden", !open);
      advBtn.setAttribute("aria-expanded", String(open));
    });
    const strategySel = root.querySelector<HTMLSelectElement>("#matrix-align-strategy")!;
    strategySel.addEventListener("change", () => {
      const s = STRATEGY_LABELS.find((x) => x.value === strategySel.value);
      const hint = root.querySelector<HTMLElement>("#matrix-align-hint")!;
      hint.textContent = s?.hint ?? "";
      root.querySelector<HTMLElement>("#matrix-align-sim-field")!
        .toggleAttribute("hidden", strategySel.value !== "similarity");
    });
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
      const mergeBtn = t.closest<HTMLButtonElement>(".prep-matrix-merge-btn");
      if (mergeBtn) {
        this._openCellMerge(Number(mergeBtn.dataset.cutRow), Number(mergeBtn.dataset.cutCol));
        return;
      }
      const uncutBtn = t.closest<HTMLButtonElement>(".prep-matrix-uncut-btn");
      if (uncutBtn) {
        this._onUncutClick(Number(uncutBtn.dataset.cutRow), Number(uncutBtn.dataset.cutCol));
        return;
      }
      const ntBtn = t.closest<HTMLButtonElement>(".prep-matrix-nt-btn");
      if (ntBtn) {
        void this._onNonTraduitClick(
          Number(ntBtn.dataset.cutRow), Number(ntBtn.dataset.cutCol),
          ntBtn.dataset.ntAction === "set" ? "set" : "clear");
        return;
      }
      const unaddBtn = t.closest<HTMLButtonElement>(".prep-matrix-unadd-btn");
      if (unaddBtn) {
        void this._onUnaddClick(Number(unaddBtn.dataset.addRow));
        return;
      }
      const uncoveredBtn = t.closest<HTMLButtonElement>(".prep-matrix-uncovered-btn");
      if (uncoveredBtn) this._openUncoveredPanel(Number(uncoveredBtn.dataset.uncoveredCol));
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

  // ─── « ⇄ Aligner » — assumed default + « Avancé » (tranche 5, §4) ─────────────

  /** The options behind the button: the assumed default, overridden by « Avancé ». */
  private _alignOptions(): FamilyAlignOptions {
    const root = this._root;
    const strategy = (root?.querySelector<HTMLSelectElement>("#matrix-align-strategy")?.value
      ?? ALIGN_DEFAULTS.strategy) as AlignStrategy;
    const preserve = root?.querySelector<HTMLInputElement>("#matrix-align-preserve")?.checked ?? true;
    const opts: FamilyAlignOptions = {
      ...ALIGN_DEFAULTS, strategy, preserve_accepted: preserve,
    };
    if (strategy === "similarity") {
      opts.sim_threshold =
        parseFloat(root?.querySelector<HTMLInputElement>("#matrix-align-sim")?.value ?? "0.8") || 0.8;
    }
    return opts;
  }

  /** Links currently projected for the loaded family (0 when nothing is loaded). */
  private _loadedLinkCount(): number {
    return (this._view?.rows ?? []).reduce(
      (n, r) => n + r.cells.reduce((m, c) => m + c.links.length, 0), 0);
  }

  private _onAlignClick(): void {
    if (this._selectedFamilyId === null || this._aligning) return;
    // The footgun the engine has always had (D-annexe): re-running the aligner on an
    // already-aligned family adds NOTHING — existing links are kept, and the run reports
    // a hollow success. Make the choice explicit instead of hiding it.
    const existing = this._loadedLinkCount();
    if (existing > 0) {
      this._showRerunConfirm(existing);
      return;
    }
    void this._runAlign(this._alignOptions());
  }

  private _showRerunConfirm(linkCount: number): void {
    const strip = this._root?.querySelector<HTMLElement>("#matrix-align-strip");
    if (!strip) return;
    setHtml(strip, raw(buildAlignRerunConfirmHtml(linkCount)));
    const close = () => setHtml(strip, raw(""));
    strip.querySelector<HTMLButtonElement>("#matrix-align-cancel")?.addEventListener("click", close);
    strip.querySelector<HTMLButtonElement>("#matrix-align-complete")?.addEventListener("click", () => {
      close();
      void this._runAlign({ ...this._alignOptions(), replace_existing: false });
    });
    strip.querySelector<HTMLButtonElement>("#matrix-align-recalc")?.addEventListener("click", () => {
      close();
      void this._runAlign({ ...this._alignOptions(), replace_existing: true });
    });
  }

  private async _runAlign(opts: FamilyAlignOptions): Promise<void> {
    const conn = this._getConn();
    const familyId = this._selectedFamilyId;
    if (!conn || familyId === null || this._aligning) return;
    const alignBtn = this._root?.querySelector<HTMLButtonElement>("#matrix-align");
    const strip = this._root?.querySelector<HTMLElement>("#matrix-align-strip");
    this._aligning = true;
    if (alignBtn) alignBtn.disabled = true;
    if (strip) strip.textContent = "Alignement en cours…";
    try {
      const res = await alignFamily(conn, familyId, opts);
      if (strip) strip.textContent = alignRunSummary(res, opts);
      this._cb.toast?.(alignRunSummary(res, opts), res.summary.errors > 0);
      // The whole point of aligning from here: see the result in the grid at once.
      await this._loadMatrix();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (strip) strip.textContent = `✗ Alignement : ${msg}`;
      this._cb.toast?.(`✗ Alignement : ${msg}`, true);
    } finally {
      this._aligning = false;
      if (alignBtn) alignBtn.disabled = this._selectedFamilyId === null;
    }
  }

  // ─── Gestures — shared preconditions & picker shell ───────────────────────────

  /**
   * Common gesture guard (F1/F5 + cell_links availability). Returns the view, the
   * **hub rows** and the clicked cell's coordinates within them, or null after having
   * toasted the reason. Everything here is synchronous — resolution happens on the
   * already-loaded payload, so no staleness window can open between the click and the
   * modal (ex-F3).
   *
   * The cut resolvers walk a column row by row (`column[row-1]` is « the segment
   * above »), so the column MUST be built from hub rows only: a flux [ajout] row
   * (D8) woven between two hub rows is not a segment — it has no hub unit and no
   * links. Feeding it to them made a legitimately fused ⚠ cell answer « liens
   * introuvables » and let a straddle cut target a null hub unit (revue 2026-07-13,
   * R3). `viewRow` (the grid's index, addition rows included) is therefore remapped
   * to its hub index here, once, for every gesture.
   */
  private _cellGestureCtx(col: number, viewRow: number): {
    view: MatrixView; hubRows: MatrixRowView[]; column: CellLinkColumn; row: number;
  } | null {
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
    const hubRows = view.rows.filter((r) => !r.addition);
    const row = hubRows.indexOf(view.rows[viewRow]);
    if (row < 0) return null; // an addition row carries no cut gesture (defensive)
    return { view, hubRows, column: hubRows.map((r) => r.cells[col]?.links ?? []), row };
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

  private _openFusedCut(viewRow: number, col: number): void {
    const ctx = this._cellGestureCtx(col, viewRow);
    if (!ctx || ctx.row < 1) return;
    const row = ctx.row;
    const res = resolveFusedCellLinks(ctx.column, row);
    if (res.error !== undefined) {
      this._cb.toast?.(`✗ ${res.error}`, true);
      return;
    }
    // Hub texts of the group's two sides drive the proportional suggestion — for an
    // N-1 partition (D-W13) each side may span several rows.
    const rowsOf = (links: MatrixCellLink[]): MatrixRowView[] =>
      ctx.hubRows.filter((r) => r.cells[col]?.links.some((l) => links.includes(l)));
    const aboveRows = rowsOf(res.above);
    const belowRows = rowsOf(res.below);
    const hubAbove = aboveRows.map((r) => r.hubText).join(" ");
    const hubBelow = belowRows.map((r) => r.hubText).join(" ");
    const rowAbove = ctx.hubRows[row - 1];
    const rowCur = ctx.hubRows[row];
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

  private _openStraddleCut(viewRow: number, col: number): void {
    const ctx = this._cellGestureCtx(col, viewRow);
    if (!ctx) return;
    const row = ctx.row;
    const resUp = resolveStraddleCut(ctx.column, row, "up");
    const resDown = resolveStraddleCut(ctx.column, row, "down");
    if (resUp.error !== undefined && resDown.error !== undefined) {
      this._cb.toast?.(`✗ ${resUp.error}`, true);
      return;
    }
    const view = ctx.view;
    const rowCur = ctx.hubRows[row];
    let dir: StraddleDirection = resUp.error === undefined ? "up" : "down";

    // On a multi-link cell the direction picks the EDGE link (§3.5) — link, window
    // and raw text are therefore per-direction.
    const dirCtx = (d: StraddleDirection): {
      link: MatrixCellLink; window: [number, number]; targetRaw: string;
      top: MatrixRowView; bottom: MatrixRowView; neighbor: MatrixRowView;
      neighborLinks: readonly MatrixCellLink[];
    } | null => {
      const r = d === "up" ? resUp : resDown;
      if (r.error !== undefined) return null;
      const neighbor = ctx.hubRows[r.neighborRow];
      return {
        link: r.link, window: r.window, targetRaw: r.link.target_text_raw ?? "",
        // The created link lands on the NEIGHBOUR's cell — it is that cell whose links
        // must end up in one bead (D-W16), or the detector reads a phantom collision.
        neighborLinks: ctx.column[r.neighborRow] ?? [],
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
    const segUp = row > 0 ? ctx.hubRows[row - 1]?.segment : null;
    const segDown = ctx.hubRows[row + 1]?.segment ?? null;
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
      if (!c || c.neighbor.hubUnitId == null) {
        // Unreachable now that the column is hub-only (R3) — but a confirm click must
        // never be a silent no-op: say so rather than leave the user pressing a dead
        // button.
        this._cb.toast?.("✗ Segment voisin introuvable — recharger la matrice", true);
        return;
      }
      void this._performStraddleCut(
        c.link, c.neighbor.hubUnitId, dir, c.window, cur, c.neighborLinks,
        this._closeCutModal!, okBtn);
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
    neighborLinks: readonly MatrixCellLink[],
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
      // The neighbour's cell now holds its own link(s) + the one we just created: it is
      // ONE bead (1 hub ↔ N targets), not a collision (D-W16). Best-effort, in its OWN
      // non-atomic batch: it is hygiene, not the gesture — an older sidecar (< 1.6.57)
      // would reject the unknown action and, inside the atomic batch, roll the whole cut
      // back (revue T5). The cut has already committed; a failed grouping only leaves the
      // pre-1.6.57 behaviour (a phantom collision), never a broken cut.
      await this._groupCellBead(conn, [...neighborLinks, { link_id: createdId, manual: true }]);
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

  // ─── « ⭙ Fusionner » — absorb the neighbouring sentence (D-W16 §3.6) ──────────

  /**
   * The inverse of ✂ Couper: the neighbour's sentence belongs to THIS hub segment
   * (the translation is segmented more finely than the source). A confirm strip, not
   * a picker — there is no cut point to choose, only a direction.
   */
  private _openCellMerge(viewRow: number, col: number): void {
    const ctx = this._cellGestureCtx(col, viewRow);
    if (!ctx) return;
    const row = ctx.row;
    const resUp = resolveCellMerge(ctx.column, row, "up");
    const resDown = resolveCellMerge(ctx.column, row, "down");
    if (resUp.error !== undefined && resDown.error !== undefined) {
      // Prefer the ACTIONABLE reason over the structural one (« pas de segment en
      // dessous ») — on the last row the structural error would hide it (T8).
      const structural = /Pas de segment/;
      const actionable = [resDown.error, resUp.error].find((e) => !structural.test(e));
      this._cb.toast?.(`✗ ${actionable ?? resDown.error}`, true);
      return;
    }
    let dir: StraddleDirection = resDown.error === undefined ? "down" : "up";
    const rowCur = ctx.hubRows[row];
    const lang = ctx.view.translationLangs[col] ?? "?";
    /** Links the neighbour keeps: only its EDGE link is absorbed (T6). */
    const remainingOf = (d: StraddleDirection): number => {
      const r = d === "up" ? resUp : resDown;
      if (r.error !== undefined) return 0;
      return Math.max(0, (ctx.column[r.neighborRow]?.length ?? 1) - 1);
    };

    const preview = (d: StraddleDirection): string => {
      const r = d === "up" ? resUp : resDown;
      if (r.error !== undefined) return "";
      const neighbor = ctx.hubRows[r.neighborRow];
      const text = r.link.target_text_raw ?? "";
      const left = remainingOf(d);
      const fate = left === 0
        ? `Le segment ${neighbor.segment} perdra cette traduction (il deviendra ∅).`
        : `Le segment ${neighbor.segment} gardera ses ${left} autre${left > 1 ? "s" : ""} traduction${left > 1 ? "s" : ""}.`;
      return `<p class="prep-matrix-merge-preview">Le segment ${rowCur.segment} absorbera&nbsp;:`
        + ` <span class="prep-matrix-merge-text">${_esc(shortenCp(text, 160))}</span>`
        + `<br><small>${fate}</small></p>`;
    };
    const radio = (d: StraddleDirection, label: string): string => {
      const r = d === "up" ? resUp : resDown;
      const off = r.error !== undefined;
      return `<label class="prep-matrix-cut-dir-opt${off ? " prep-matrix-cut-dir-opt--off" : ""}"`
        + (off ? ` title="${_esc(r.error!)}"` : "")
        + `><input type="radio" name="prep-matrix-merge-dir" value="${d}"`
        + `${d === dir ? " checked" : ""}${off ? " disabled" : ""}> ${label}</label>`;
    };
    const segUp = row > 0 ? ctx.hubRows[row - 1]?.segment : null;
    const segDown = ctx.hubRows[row + 1]?.segment ?? null;
    const extra = `<div class="prep-matrix-cut-dir" role="radiogroup" aria-label="Sens de la fusion">`
      + radio("down", `Absorber la phrase du segment <b>suivant</b>${segDown != null ? ` (${segDown})` : ""}`)
      + radio("up", `Absorber la phrase du segment <b>précédent</b>${segUp != null ? ` (${segUp})` : ""}`)
      + `</div><div class="prep-matrix-merge-host"></div>`;

    const { dialog, okBtn } = this._openPickerShell(
      `⭙ Fusionner (${lang}, segment ${rowCur.segment})`,
      `La traduction est découpée plus finement que l'original : la phrase voisine appartient `
      + `à ce segment. Elle sera rattachée ici (réversible — ⭙ dans l'autre sens).`,
      extra,
    );
    okBtn.textContent = "⭙ Fusionner";
    const host = dialog.querySelector<HTMLElement>(".prep-matrix-merge-host")!;
    const renderPreview = () => setHtml(host, raw(preview(dir)));
    renderPreview();
    dialog.querySelectorAll<HTMLInputElement>('input[name="prep-matrix-merge-dir"]').forEach((r) =>
      r.addEventListener("change", () => {
        dir = r.value as StraddleDirection;
        renderPreview();
      }));
    okBtn.addEventListener("click", () => {
      const r = dir === "up" ? resUp : resDown;
      if (r.error !== undefined || rowCur.hubUnitId == null) {
        this._cb.toast?.("✗ Fusion impossible — recharger la matrice", true);
        return;
      }
      void this._performCellMerge(
        r.link, rowCur.hubUnitId, ctx.column[row] ?? [], remainingOf(dir),
        this._closeCutModal!, okBtn);
    });
  }

  /**
   * Group a cell into one bead — **best effort, out of band** (revue T5). The grouping is
   * hygiene (it silences the phantom collision the gesture would otherwise seed), not the
   * gesture itself: putting it in the gesture's atomic batch would make an older sidecar
   * (< 1.6.57, which does not know `set_bead`) roll the whole cut/merge back. Here a
   * failure only means the pre-1.6.57 behaviour, never a broken write.
   *
   * `buildCellBeadActions` refuses to group a cell that already carried ≥ 2 aligner links
   * (a genuine collision to arbitrate — T1); the caller says so to the user.
   */
  private async _groupCellBead(
    conn: Conn, cellLinks: ReadonlyArray<Pick<MatrixCellLink, "link_id" | "manual">>,
  ): Promise<{ grouped: boolean }> {
    const actions = buildCellBeadActions(cellLinks);
    if (actions.length === 0) return { grouped: false };
    try {
      await batchUpdateAlignLinks(conn, actions);
      return { grouped: true };
    } catch {
      return { grouped: false };
    }
  }

  /**
   * Move the neighbour's link onto this hub segment: create it here (inheriting the
   * pair number), then delete the neighbour's — atomically. The created link is deleted
   * in compensation if the batch is refused, so a failed merge can never leave the
   * sentence attached to BOTH segments. The cell's bead follows, best-effort.
   */
  private async _performCellMerge(
    neighborLink: MatrixCellLink,
    hubUnitId: number,
    cellLinks: readonly MatrixCellLink[],
    neighborRemaining: number,
    close: () => void,
    okBtn: HTMLButtonElement,
  ): Promise<void> {
    const conn = this._getConn();
    if (!conn) return;
    okBtn.disabled = true;
    let createdId: number | null = null;
    try {
      const created = await createAlignLink(conn, {
        pivot_unit_id: hubUnitId,
        target_unit_id: neighborLink.target_unit_id,
        ...(typeof neighborLink.external_id === "number"
          ? { external_id: neighborLink.external_id } : {}),
      });
      createdId = created.link_id;
      const actions = [{ action: "delete" as const, link_id: neighborLink.link_id }];
      const res = await batchUpdateAlignLinks(conn, actions, { atomic: true });
      if (res.errors.length) {
        if (res.applied > 0 || res.deleted > 0) {
          close();
          this._cb.toast?.(
            `✗ Fusion partielle : ${res.errors[0].error} — matrice resynchronisée`, true);
          await this._reloadPreservingScroll();
          return;
        }
        await deleteAlignLink(conn, { link_id: createdId });
        createdId = null;
        this._cb.toast?.(`✗ Fusion refusée : ${res.errors[0].error} (rien n'a été appliqué)`, true);
        okBtn.disabled = false;
        return;
      }
      const { grouped } = await this._groupCellBead(
        conn, [...cellLinks, { link_id: createdId, manual: true }]);
      close();
      // Say what actually happened: only the EDGE link moves, so the neighbour keeps its
      // other links (T6); and a cell that already carried several aligner links is a real
      // ambiguity we refuse to silence (T1) — the user must arbitrate it in Révision fine.
      const tail = neighborRemaining > 0
        ? ` — le segment voisin garde ${neighborRemaining} traduction${neighborRemaining > 1 ? "s" : ""}`
        : " — le segment voisin est à traiter";
      const warn = !grouped && cellLinks.filter((l) => l.manual !== true).length > 1
        ? " (cette cellule porte une ambiguïté d'alignement — à arbitrer en Révision fine)"
        : "";
      this._cb.toast?.(`✓ Phrase absorbée${tail}${warn}`);
      await this._reloadPreservingScroll();
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      // A REJECTED link (P,T) still occupies the unique index (mig 008) but is invisible
      // in the matrix, so the resolver cannot see it and create returns a bare 409 (T7).
      const msg = /already exists|CONFLICT|409/i.test(raw)
        ? "un lien (rejeté ?) existe déjà entre ce segment et cette phrase — le réactiver ou le supprimer en Révision fine"
        : raw;
      if (createdId != null) {
        try {
          await deleteAlignLink(conn, { link_id: createdId });
          okBtn.disabled = false;
          this._cb.toast?.(`✗ Fusion : ${msg}`, true);
        } catch {
          close();
          this._cb.toast?.(`✗ Fusion : ${msg} — matrice resynchronisée`, true);
          await this._reloadPreservingScroll();
        }
        return;
      }
      okBtn.disabled = false;
      this._cb.toast?.(`✗ Fusion : ${msg}`, true);
    }
  }

  // ─── « ↺ » on a cut cell — the target becomes whole again (D-W13 §3.5) ────────

  private _onUncutClick(viewRow: number, col: number): void {
    const ctx = this._cellGestureCtx(col, viewRow);
    if (!ctx) return;
    const targets = cellCutTargets(ctx.column[ctx.row] ?? []);
    if (targets.length > 1) {
      // Mixed cell (e.g. inherited tail + own cut head): no guessing — the user
      // picks which translation becomes whole again (§3.5).
      this._openUncutChooser(viewRow, col, targets);
      return;
    }
    void this._performCellUncut(viewRow, col);
  }

  /** Mini-chooser for a multi-cut cell: one button per cut translation (its slice). */
  private _openUncutChooser(
    row: number, col: number,
    targets: Array<{ target_unit_id: number; slice: string }>,
  ): void {
    this._cutBusy = true;
    const overlay = document.createElement("div");
    overlay.className = "prep-matrix-cut-overlay";
    const dialog = document.createElement("div");
    dialog.className = "prep-matrix-cut-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    const options = targets.map((t) =>
      `<button type="button" class="prep-matrix-uncut-choice" data-uncut-target="${t.target_unit_id}">`
      + `&#8635; ${_esc(shortenCp(t.slice, 90))}</button>`).join("");
    setHtml(dialog, safeHtml`
      <div class="prep-matrix-cut-title">↺ Annuler quelle coupe ?</div>
      <p class="prep-matrix-cut-hint">Cette cellule porte plusieurs traductions coupées —
        choisissez celle qui doit redevenir entière.</p>
      <div class="prep-matrix-uncut-choices">${raw(options)}</div>
      <div class="prep-matrix-cut-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-cut-cancel>Annuler</button>
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
    dialog.querySelectorAll<HTMLButtonElement>(".prep-matrix-uncut-choice").forEach((btn) =>
      btn.addEventListener("click", () => {
        const target = Number(btn.dataset.uncutTarget);
        close();
        void this._performCellUncut(row, col, target);
      }));
  }

  private async _performCellUncut(viewRow: number, col: number, targetUnitId?: number): Promise<void> {
    const ctx = this._cellGestureCtx(col, viewRow);
    if (!ctx) return;
    const res = resolveCellUncut(ctx.column, ctx.row, targetUnitId);
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

  // ─── Statuts « lignes blanches » — ∅ non traduit / ＋ ajout (D-W8/D8/D-W14) ────

  /**
   * Guard for the status gestures — same conn-identity / busy discipline as
   * `_cellGestureCtx`, gated on the status axes (sidecar ≥ 1.6.56) instead of
   * cell_links.
   */
  private _statusGestureCtx(): MatrixView | null {
    const conn = this._getConn();
    const view = this._view;
    if (!conn || !view || this._cutBusy) return null;
    if (conn !== this._loadedConn) {
      this._cb.toast?.("✗ Connexion changée — recharger la matrice avant d'agir", true);
      this._resetMatrix();
      return null;
    }
    if (!view.hasStatuses) {
      this._cb.toast?.("✗ Sidecar trop ancien — statuts de cellule absents (recompiler le sidecar)", true);
      return null;
    }
    return view;
  }

  /** « ∅ non traduit » on an empty cell — set; its ↺ on a per-cell mark — clear. */
  private async _onNonTraduitClick(row: number, col: number, action: "set" | "clear"): Promise<void> {
    const view = this._statusGestureCtx();
    if (!view) return;
    const hubUnitId = view.rows[row]?.hubUnitId;
    const targetDocId = view.translationDocIds[col];
    if (hubUnitId == null || targetDocId == null) return;
    const conn = this._getConn();
    if (!conn) return;
    this._cutBusy = true; // no modal — the flag guards the whole round-trip (F5)
    try {
      await setAlignCellStatus(conn, {
        pivot_unit_id: hubUnitId,
        target_doc_id: targetDocId,
        status: action === "set" ? "non_traduit" : null,
      });
      this._cb.toast?.(action === "set"
        ? "✓ Cellule marquée « non traduit » (comptée comme faite)"
        : "✓ Marque « non traduit » retirée");
      await this._reloadPreservingScroll();
    } catch (err) {
      // The 409 guard (the cell has active links) can ONLY fire on a stale grid — the
      // ∅ button is offered on cells the grid shows as unlinked. Toasting alone would
      // leave the user staring at an empty cell with no ↺ to click and a button that
      // re-409s forever: resync so the real state (the aligned text) becomes visible
      // (R6e — the « matrice resynchronisée » convention of the cut gestures).
      this._cb.toast?.(
        `✗ Non traduit : ${err instanceof Error ? err.message : String(err)} — matrice resynchronisée`,
        true,
      );
      await this._reloadPreservingScroll();
    } finally {
      this._cutBusy = false;
    }
  }

  /** « ↺ » on a flux [ajout] row — clear the ajout mark (the unit becomes uncovered again). */
  private async _onUnaddClick(row: number): Promise<void> {
    const view = this._statusGestureCtx();
    if (!view) return;
    const addition = view.rows[row]?.addition;
    if (!addition) return;
    const conn = this._getConn();
    if (!conn) return;
    this._cutBusy = true;
    try {
      const res = await bulkSetUnitStatus(conn, [addition.unitId], null);
      // bulk_set_status is a blind UPDATE: a vanished unit (re-segmented elsewhere)
      // answers {updated: 0}. Claiming success would be a lie (R6d).
      this._cb.toast?.(
        res.updated > 0
          ? "✓ Marque d'ajout retirée — l'unité repasse « hors matrice »"
          : "✗ Unité introuvable (matrice périmée) — matrice resynchronisée",
        res.updated === 0,
      );
      await this._reloadPreservingScroll();
    } catch (err) {
      this._cb.toast?.(`✗ Ajout : ${err instanceof Error ? err.message : String(err)}`, true);
    } finally {
      this._cutBusy = false;
    }
  }

  /**
   * « N hors matrice » header badge (D-W14): panel of the column's uncovered units —
   * the only surface where an unlinked translation unit is visible. « ＋ Ajout »
   * poses unit_status='ajout' and the flux [ajout] row appears at its position.
   */
  private _openUncoveredPanel(col: number): void {
    const view = this._statusGestureCtx();
    if (!view) return;
    const units = view.uncovered[col] ?? [];
    const lang = view.translationLangs[col] ?? "?";
    if (units.length === 0) return;

    this._cutBusy = true;
    const overlay = document.createElement("div");
    overlay.className = "prep-matrix-cut-overlay";
    const dialog = document.createElement("div");
    dialog.className = "prep-matrix-cut-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    const items = units.map((u) =>
      `<li class="prep-matrix-orphan">`
      + `<span class="prep-matrix-orphan-n">[${u.n}]</span> `
      + `<span class="prep-matrix-orphan-text">${_esc(shortenCp(u.text_raw, 120))}</span>`
      + `<button type="button" class="prep-matrix-add-choice" data-add-unit="${u.unit_id}"`
      + ` title="Marquer comme ajout du traducteur — une ligne [ajout] appara&#238;t dans la matrice">&#65291; Ajout</button>`
      + `</li>`).join("");
    setHtml(dialog, safeHtml`
      <div class="prep-matrix-cut-title">Unités hors matrice (${lang})</div>
      <p class="prep-matrix-cut-hint">Ces unités de la traduction ne sont couvertes par aucun
        lien : invisibles dans la grille. Un ajout du traducteur (sans segment source) se marque
        ici — sinon, l'alignement les rattrapera.</p>
      <ul class="prep-matrix-orphans">${raw(items)}</ul>
      <div class="prep-matrix-cut-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-cut-cancel>Fermer</button>
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
    dialog.querySelectorAll<HTMLButtonElement>(".prep-matrix-add-choice").forEach((btn) =>
      btn.addEventListener("click", () => {
        const unitId = Number(btn.dataset.addUnit);
        close();
        void this._performMarkAddition(unitId);
      }));
  }

  private async _performMarkAddition(unitId: number): Promise<void> {
    const conn = this._getConn();
    if (!conn) return;
    if (conn !== this._loadedConn) {
      // The panel closed before this ran — the corpus may have changed under it (F1).
      this._cb.toast?.("✗ Connexion changée — recharger la matrice", true);
      this._resetMatrix();
      return;
    }
    this._cutBusy = true;
    try {
      const res = await bulkSetUnitStatus(conn, [unitId], "ajout");
      if (res.updated === 0) {
        // Blind UPDATE: the unit vanished (re-segmented elsewhere) — do not claim a row
        // was created (R6d).
        this._cb.toast?.("✗ Unité introuvable (matrice périmée) — matrice resynchronisée", true);
        await this._reloadPreservingScroll();
        return;
      }
      await this._reloadPreservingScroll();
      // The panel could be stale: if the unit got aligned meanwhile, the engine projects
      // it through its cell and weaves NO flux row (R2). Say what actually happened.
      const woven = this._view?.rows.some((r) => r.addition?.unitId === unitId) ?? false;
      this._cb.toast?.(
        woven
          ? "✓ Ligne [ajout] créée — visible dans la matrice à sa position"
          : "✓ Marque posée — l'unité est alignée, elle reste projetée par sa cellule",
      );
    } catch (err) {
      this._cb.toast?.(`✗ Ajout : ${err instanceof Error ? err.message : String(err)}`, true);
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
