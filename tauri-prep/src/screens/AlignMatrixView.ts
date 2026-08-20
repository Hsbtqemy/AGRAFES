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

import type { Conn, FamilyRecord, MatrixCellLink, FamilyAlignOptions, AlignBatchAction } from "../lib/sidecarClient.ts";
import {
  getFamilies, getAlignMatrix, batchUpdateAlignLinks, createAlignLink, deleteAlignLink,
  setAlignCellStatus, bulkSetUnitStatus, alignFamily, resolveCollisions,
  retargetCandidates, retargetAlignLink, updateUnitTextNorm, setParagraphBoundary,
  undoAlignRun,
} from "../lib/sidecarClient.ts";
import { buildPickerRowHtml } from "../lib/alignPickerRow.ts";
import { getCurrentDbPath } from "../lib/db.ts";
import type { AlignStrategy } from "../lib/alignRunBar.ts";
import {
  ALIGN_DEFAULTS, STRATEGY_LABELS, buildAlignAdvancedHtml, buildAlignRerunConfirmHtml,
  alignRunSummary,
  undoableRunIds,
  formatRunUndoOutcome,
  buildRunUndoOfferHtml,
  saveRunOffer,
  loadRunOffer,
  clearRunOffer,
  type RunUndoOutcome,
} from "../lib/alignRunBar.ts";
import type { AlignMatrix } from "../lib/sidecarClient.ts";
import type { MatrixView, MatrixRowView } from "../lib/alignMatrix.ts";
import { buildMatrixView, matrixSummaryLine, resolveStyloTarget } from "../lib/alignMatrix.ts";
import { buildMatrixGridHtml } from "../lib/alignMatrixGrid.ts";
import type { AnchorWarning } from "../lib/anchorWarn.ts";
import { anchorWarnings, buildAnchorNoticeHtml, buildAnchorGateHtml } from "../lib/anchorWarn.ts";
import type { CellLinkColumn, StraddleDirection, CellSplitPlan, CutPanelsLabels } from "../lib/alignCellCut.ts";
import {
  resolveFusedCellLinks, resolveCellUncut, resolveCellMerge, resolveCellSplit,
  cellMergeReversalNoteHtml,
  cellCutTargets, buildPartitionActions, buildUncutActions, buildCellBeadActions,
  suggestCutOffset, buildCutPanelsHtml, buildCellSplitPanelsHtml, linkWindow,
  cellRemovableTranslations, viableCutOffsetsIn,
} from "../lib/alignCellCut.ts";
import { setHtml, raw, safeHtml } from "../lib/safeHtml.ts";
import { escHtml as _esc } from "../lib/diff.ts";
import type { RevisionFineScope } from "../lib/revisionFineScope.ts";

export interface AlignMatrixCallbacks {
  toast?: (msg: string, isError?: boolean) => void;
  /** Tranche 6 — ouvrir la « Révision fine » (l'ancien AlignPanel, mode secondaire : revue
   *  statut / collisions / qualité lien par lien). Sans `scope` (T6.1) = bascule de barre.
   *  Avec `scope` (T6.2, D-P2) = handoff scopé depuis une cellule : Révision fine pré-chargée
   *  sur la paire moyeu ↔ doc-colonne et scrollée sur le lien de la cellule. */
  onOpenRevisionFine?: (scope?: RevisionFineScope) => void;
  /** Open a document in the canvas Segmentation layer (Brut) — from a language-header shortcut
   *  (docId only) or a « hors matrice » orphan (docId + its unit n, deep-linked). Reduces the
   *  source↔translation round-trip when a segmentation mismatch must be fixed to align cleanly. */
  onOpenSegmentation?: (docId: number, unitN?: number) => void;
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
  /** Family the loaded view belongs to — a switch leaves the view behind (tranche 5). */
  private _loadedFamilyId: number | null = null;
  /** A cut gesture is in flight (open modal) — blocks reentrancy (F5). */
  private _cutBusy = false;
  /** The <td> hosting the inline stylo (text-correction) editor, or null (one at a time). */
  private _cellEditTd: HTMLElement | null = null;
  /** The edited cell's original innerHTML — restored verbatim on cancel. */
  private _cellEditRestore: string | null = null;
  /** An alignment run is in flight — the button must not fire twice (tranche 5). */
  private _aligning = false;
  /** Teardown of the open cut modal, so dispose()/reset can force-close it (F4). */
  private _closeCutModal: (() => void) | null = null;
  /** Family whose upstream-anchoring warning was acknowledged for the LOADED matrix — the
   *  « Aligner » gate warns once per loaded matrix (DESIGN_upstream_anchoring §4), not on
   *  every click. Reset on every `_loadMatrix` so the consent is tied to the loaded CONTENT,
   *  not to the family forever (revue m4/n2): a re-import that re-breaks the anchoring, or a
   *  switch to another family, re-arms the gate. */
  private _anchorAckFamilyId: number | null = null;

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
      // T6.1 — accès au mode secondaire « Révision fine » (revue statut/collisions/qualité par lien).
      + `<button type="button" id="matrix-revision-fine" class="btn btn-ghost btn-sm prep-matrix-revfine-btn"`
      + ` title="Contrôle — revue statut / collisions / qualité, lien par lien">&#9998; Contrôle</button>`
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
      // revue m1 — a rerun-confirm or an anchoring gate armed for the PREVIOUS family must
      // not survive the switch (it would describe the wrong entity above the new grid).
      this._closeAlignStrip();
    });
    loadBtn.addEventListener("click", () => void this._loadMatrix());
    alignBtn.addEventListener("click", () => void this._onAlignClick());
    root.querySelector<HTMLButtonElement>("#matrix-revision-fine")
      ?.addEventListener("click", () => this._cb.onOpenRevisionFine?.());
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
      const removeBtn = t.closest<HTMLButtonElement>(".prep-matrix-remove-btn");
      if (removeBtn) {
        this._openRemoveChooser(Number(removeBtn.dataset.cutRow), Number(removeBtn.dataset.cutCol));
        return;
      }
      const attachBtn = t.closest<HTMLButtonElement>(".prep-matrix-attach-btn");
      if (attachBtn) {
        this._openAttachPicker(Number(attachBtn.dataset.cutRow), Number(attachBtn.dataset.cutCol));
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
      if (uncoveredBtn) { this._openUncoveredPanel(Number(uncoveredBtn.dataset.uncoveredCol)); return; }
      // T6.2 (D-P2) — « → Révision fine » sur une cellule liée.
      const reviewBtn = t.closest<HTMLButtonElement>(".prep-matrix-review-btn");
      if (reviewBtn) { this._onReviewClick(Number(reviewBtn.dataset.cutRow), Number(reviewBtn.dataset.cutCol)); return; }
      // Stylo (β) — correct a cell's text in place (source or a clean translation).
      const editBtn = t.closest<HTMLButtonElement>(".prep-matrix-edit-btn");
      if (editBtn) { this._openCellEdit(editBtn, Number(editBtn.dataset.editRow), editBtn.dataset.editCol ?? ""); return; }
      // R6 — ¶ toggle: designate this segment as a paragraph start (or remove its boundary).
      const paraBtn = t.closest<HTMLButtonElement>(".prep-matrix-para-btn");
      if (paraBtn) { void this._onParagraphToggle(Number(paraBtn.dataset.paraRow)); return; }
      // Header shortcut → open this document's Segmentation layer (Brut).
      const segBtn = t.closest<HTMLButtonElement>(".prep-matrix-seg-btn");
      if (segBtn) this._cb.onOpenSegmentation?.(Number(segBtn.dataset.segDoc));
    });
    return root;
  }

  /** Called by ActionsScreen when the sub-view becomes visible. */
  onActivated(): void {
    void this._loadFamilies();
  }

  /**
   * Point d'entrée public (D-P9-2b) — pré-sélectionne `familyId` dans le sélecteur de la
   * matrice et charge sa matrice (deep-link « couverture → matrice » depuis le panneau
   * famille de « Documents »). La note §3 acte l'asymétrie : la matrice n'a pas d'équivalent
   * public de `AlignPanel.scopeTo`, on reproduit ici l'effet du handler `change` + clic
   * « Charger ». On fixe `_selectedFamilyId` AVANT `_loadFamilies` : celui-ci lit `prev` APRÈS
   * son `await`, donc l'appel `onActivated` concurrent (lui aussi `_loadFamilies`) converge
   * sur la même famille (double fetch bénin, pas de divergence). Renvoie false si la famille
   * reste introuvable (la sous-vue est déjà basculée, le toast suffit).
   */
  async selectAndLoadFamily(familyId: number): Promise<boolean> {
    if (!this._root) return false;
    // Sans connexion, _loadFamilies et _loadMatrix sont des no-op : sans ce garde on renverrait
    // true en n'ayant rien chargé (faux succès). Échouer explicitement (passe adverse D-P9-2b).
    if (!this._getConn()) {
      this._cb.toast?.("✗ Aucune connexion au moteur — matrice indisponible.", true);
      return false;
    }
    this._selectedFamilyId = familyId; // cible de re-sélection de _loadFamilies (lit prev après await)
    await this._loadFamilies();
    // _loadFamilies remet _selectedFamilyId à null si la famille n'est pas dans la liste.
    if (this._selectedFamilyId !== familyId) {
      this._cb.toast?.("✗ Famille introuvable dans la matrice — actualiser les documents.", true);
      return false;
    }
    this._closeAlignStrip();
    await this._loadMatrix();
    return true;
  }

  refreshDocs(): void {
    // A connection change invalidates the loaded matrix: its doc/unit ids belong to
    // the OLD database — a still-visible ✂ would write into the new one (F1).
    if (this._loadedConn && this._getConn() !== this._loadedConn) this._resetMatrix();
    void this._loadFamilies();
  }

  /** Drop the loaded matrix (and any open cut modal / armed confirm) — e.g. conn change. */
  private _resetMatrix(): void {
    this._closeCutModal?.();
    this._cellEditTd = null; // a stale inline stylo editor must not survive a reset
    this._cellEditRestore = null;
    // The re-run confirm strip must not survive a corpus switch: its « Recalcul global »
    // would rewrite a family of the OLD database (revue tranche 5, critique).
    this._closeAlignStrip();
    this._matrix = null;
    this._view = null;
    this._loadedConn = null;
    this._loadedFamilyId = null;
    // The anchoring ack is keyed by family_id, but a conn change invalidates ALL ids: the
    // same family_id on the new DB is a different family — it must be re-warned.
    this._anchorAckFamilyId = null;
    const area = this._root?.querySelector<HTMLElement>("#matrix-grid-area");
    if (area) setHtml(area, raw('<p class="prep-matrix-hint">Connexion chang&#233;e &#8212; recharger la matrice.</p>'));
    const summary = this._root?.querySelector<HTMLElement>("#matrix-summary");
    if (summary) summary.textContent = "";
  }

  private async _loadFamilies(): Promise<void> {
    const conn = this._getConn();
    if (!conn || !this._root) return;
    try {
      this._families = (await getFamilies(conn))
        .filter((f) => f.parent)
        // Alphabetical by parent title (case/accent-insensitive), family_id as a stable
        // tiebreak — the server order is insertion-ish and hard to scan.
        .sort((a, b) =>
          a.parent!.title.localeCompare(b.parent!.title, "fr", { sensitivity: "base" })
          || a.family_id - b.family_id);
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
    // Re-sync EVERY button of the bar, not just « Charger » — a family that vanished from
    // the list (corpus switch, deletion) would otherwise leave « Aligner » armed on an id
    // that no longer exists (revue tranche 5).
    const none = this._selectedFamilyId === null;
    for (const id of ["#matrix-load", "#matrix-align", "#matrix-align-adv-toggle"]) {
      const btn = this._root.querySelector<HTMLButtonElement>(id);
      if (btn) btn.disabled = none;
    }
    if (none) this._closeAlignStrip();
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
      this._loadedFamilyId = this._selectedFamilyId;
      // revue m4/n2 — a fresh matrix is fresh content: any prior anchoring acknowledgement is
      // void, so the gate re-arms (a re-import that re-broke the anchoring must warn again).
      this._anchorAckFamilyId = null;
      // ALI-17 — repeindre l'offre « ↺ Annuler ce run » si le run qui vient d'avoir lieu
      // sur CETTE famille et CE corpus est encore annulable. Sans ça, un rechargement de
      // page emportait l'offre — et le run qu'on veut le plus défaire (celui qui a doublé
      // un alignement) est justement celui qui déclenche un rechargement pour aller voir.
      this._restoreRunUndoOffer(conn);
      if (view.rows.length === 0) {
        setHtml(area, raw('<p class="prep-matrix-hint">Aucun segment dans le moyeu de cette famille.</p>'));
      } else {
        // Upstream-anchoring notice (DESIGN_upstream_anchoring §4): a passive banner above
        // the grid whenever a document of this family is not protected FOR THE CHOSEN
        // STRATEGY (m1 — length/similarity bound drift only via parent_n) — so a « Charger »
        // (no align yet) already surfaces the drift risk and its remedy.
        const notice = buildAnchorNoticeHtml(anchorWarnings(matrix, this._alignStrategy()));
        setHtml(area, raw(notice + buildMatrixGridHtml(view)));
        summary.textContent = matrixSummaryLine(view);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // A failed load must INVALIDATE the view: leaving the previous family's one in
      // place made every downstream check (the re-run gate, the gestures) answer for the
      // wrong family (revue tranche 5, critique).
      this._matrix = null;
      this._view = null;
      this._loadedFamilyId = null;
      setHtml(area, raw(`<p class="prep-matrix-error">Erreur&nbsp;: ${_esc(msg)}</p>`));
      this._cb.toast?.("✗ Erreur chargement matrice", true);
    } finally {
      this._loading = false;
    }
  }

  // ─── « ⇄ Aligner » — assumed default + « Avancé » (tranche 5, §4) ─────────────

  /** The strategy that « Aligner » will run — the fold-away « Avancé » select, else the
   *  assumed default. Concrete (never undefined) so the anchoring filet (m1) can key on it. */
  private _alignStrategy(): AlignStrategy {
    return (this._root?.querySelector<HTMLSelectElement>("#matrix-align-strategy")?.value
      ?? ALIGN_DEFAULTS.strategy) as AlignStrategy;
  }

  /** The options behind the button: the assumed default, overridden by « Avancé ». */
  private _alignOptions(): FamilyAlignOptions {
    const root = this._root;
    const strategy = this._alignStrategy();
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

  /**
   * The links the ALIGNER sees on the loaded family — rejected ones included (1.6.58).
   * NOT the links the grid shows: the projection hides rejected links (F8), but the
   * unique (pivot, target) index still holds their rows, so a family whose links were all
   * rejected re-aligns to NOTHING. Gating on what is displayed would let exactly that
   * no-op run through (revue tranche 5). Falls back to the projection on an older sidecar.
   */
  private _loadedLinkCount(): number {
    const view = this._view;
    if (!view) return 0;
    if (view.linkCount !== null) return view.linkCount;
    return view.rows.reduce((n, r) => n + r.cells.reduce((m, c) => m + c.links.length, 0), 0);
  }

  /** True when the loaded view really describes the family we are about to align. */
  private _viewMatchesSelection(conn: Conn): boolean {
    return this._view !== null
      && this._loadedFamilyId === this._selectedFamilyId
      && this._loadedConn === conn;
  }

  private async _onAlignClick(): Promise<void> {
    const conn = this._getConn();
    if (!conn || this._selectedFamilyId === null || this._aligning || this._cutBusy) return;
    // The confirm hinges on whether the family ALREADY has links — so it must look at the
    // family we are about to align, not at whatever is on screen: the button is live as
    // soon as a family is picked (no « Charger » needed), and a family switch leaves the
    // PREVIOUS family's view behind. Reading a stale/absent view would skip the confirm
    // and fire the very run that does nothing (revue tranche 5).
    if (!this._viewMatchesSelection(conn)) {
      await this._loadMatrix();
      if (!this._viewMatchesSelection(this._getConn() ?? conn)) return;  // load failed / moved on
    }
    // Upstream-anchoring gate (DESIGN_upstream_anchoring §4): if a text of this family carries
    // no anchor the length-bounded aligner will drift — warn ONCE per family before firing, so
    // the user anchors first instead of hand-repairing the matrix. Non-blocking (D-U1): the
    // gate's « Aligner quand même » sets the ack and re-enters, flowing on to the normal run.
    if (this._matrix && this._anchorAckFamilyId !== this._selectedFamilyId) {
      // m1 — evaluate against the strategy about to run: the gate must reflect what THIS run
      // will do (the fold-away « Avancé » may have switched to external_id, which is safe).
      const warnings = anchorWarnings(this._matrix, this._alignStrategy());
      if (warnings.length > 0) {
        this._showAnchorGate(warnings, this._selectedFamilyId);
        return;
      }
    }
    const existing = this._loadedLinkCount();
    if (existing > 0) {
      this._showRerunConfirm(existing);
      return;
    }
    await this._runAlign(this._alignOptions(), this._selectedFamilyId, 0);
  }

  /** Tear down the open confirm strip (a corpus/family switch must not leave it armed). */
  private _closeAlignStrip(): void {
    const strip = this._root?.querySelector<HTMLElement>("#matrix-align-strip");
    if (strip) setHtml(strip, raw(""));
  }


  /**
   * Peindre l'offre « ↺ Annuler ce run » dans la bande, et la câbler.
   *
   * `conn` et `familyId` sont **capturés à l'instant de l'offre**, comme le fait déjà
   * `_showRerunConfirm` : le bouton ne doit jamais réécrire une famille dont l'utilisateur
   * s'est éloigné entre-temps, ni un autre corpus (F1). La bande, elle, est vidée par
   * `_closeAlignStrip` à tout changement d'entité, donc l'offre ne survit pas au contexte
   * qui l'a produite.
   */
  /** Repeindre l'offre ↺ stockée si elle concerne ce corpus et cette famille. */
  private _restoreRunUndoOffer(conn: Conn): void {
    const strip = this._root?.querySelector<HTMLElement>("#matrix-align-strip");
    const familyId = this._selectedFamilyId;
    if (!strip || familyId === null) return;
    const offer = loadRunOffer(sessionStorage, getCurrentDbPath(), familyId);
    if (!offer) return;
    this._showRunUndoOffer(strip, offer.summary, offer.runIds, conn, familyId);
  }

  private _showRunUndoOffer(
    strip: HTMLElement, line: string, runIds: string[], conn: Conn, familyId: number,
  ): void {
    setHtml(strip, raw(buildRunUndoOfferHtml(line, runIds.length)));
    const btn = strip.querySelector<HTMLButtonElement>("#matrix-run-undo");
    if (!btn) return;
    btn.addEventListener("click", () => {
      void (async () => {
        if (this._aligning) return;
        btn.disabled = true;
        btn.textContent = "Annulation…";
        // Toutes les paires sont tentées : s'arrêter à la première refusée laisserait la
        // famille à moitié annulée, ce qui est pire que l'un ou l'autre des deux états
        // francs. Le moteur refuse en 409 la paire déjà remplacée par un run plus récent.
        const outcomes: RunUndoOutcome[] = [];
        for (const runId of runIds) {
          try {
            const r = await undoAlignRun(conn, runId);
            // `r.ok` est le drapeau d'enveloppe du sidecar ; le nôtre dit si l'APPEL
            // a abouti. Les étaler dans cet ordre écraserait le second par le premier.
            const { ok: _envelope, ...counts } = r;
            outcomes.push({ ...counts, ok: true });
          } catch (err) {
            outcomes.push({
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        const summary = formatRunUndoOutcome(outcomes);
        // Consommée : une offre qui survivrait à son annulation proposerait de défaire
        // un run qui n'existe plus, et le moteur répondrait « nothing_to_revert ».
        if (outcomes.some((o) => o.ok)) clearRunOffer(sessionStorage);
        strip.textContent = summary;
        this._cb.toast?.(summary, outcomes.every((o) => !o.ok));
        // Les liens ont bougé : la grille doit repartir de la base, pas d'un état déduit.
        if (outcomes.some((o) => o.ok)) {
          this._selectedFamilyId = familyId;
          await this._loadMatrix();
        }
      })();
    });
  }

  private _showRerunConfirm(linkCount: number): void {
    const strip = this._root?.querySelector<HTMLElement>("#matrix-align-strip");
    if (!strip) return;
    // Capture WHAT the strip is about: its buttons must never rewrite a family the user
    // has meanwhile moved away from, nor a different corpus (revue tranche 5, critique).
    const familyId = this._selectedFamilyId;
    const conn = this._getConn();
    setHtml(strip, raw(buildAlignRerunConfirmHtml(linkCount)));
    const close = () => setHtml(strip, raw(""));
    const run = (replace: boolean) => {
      close();
      if (familyId === null) return;
      if (this._getConn() !== conn || this._selectedFamilyId !== familyId) {
        this._cb.toast?.("✗ La sélection a changé — relancer « Aligner »", true);
        return;
      }
      void this._runAlign({ ...this._alignOptions(), replace_existing: replace }, familyId, linkCount);
    };
    strip.querySelector<HTMLButtonElement>("#matrix-align-cancel")?.addEventListener("click", close);
    strip.querySelector<HTMLButtonElement>("#matrix-align-complete")?.addEventListener("click", () => run(false));
    strip.querySelector<HTMLButtonElement>("#matrix-align-recalc")?.addEventListener("click", () => run(true));
  }

  /**
   * The « ce texte dérivera » gate (DESIGN_upstream_anchoring §4). Advisory (D-U1): it does
   * not block — « Aligner quand même » acks the family and re-enters `_onAlignClick`, which
   * (now past the gate) flows on to the rerun confirm / the run. Captures what the gate is
   * about so its button never fires a run for a family/corpus the user moved away from.
   */
  private _showAnchorGate(warnings: AnchorWarning[], familyId: number): void {
    const strip = this._root?.querySelector<HTMLElement>("#matrix-align-strip");
    if (!strip) return;
    const conn = this._getConn();
    setHtml(strip, raw(buildAnchorGateHtml(warnings)));
    const close = () => setHtml(strip, raw(""));
    strip.querySelector<HTMLButtonElement>("#matrix-anchor-cancel")?.addEventListener("click", close);
    strip.querySelector<HTMLButtonElement>("#matrix-anchor-proceed")?.addEventListener("click", () => {
      close();
      if (this._getConn() !== conn || this._selectedFamilyId !== familyId) {
        this._cb.toast?.("✗ La sélection a changé — relancer « Aligner »", true);
        return;
      }
      this._anchorAckFamilyId = familyId;  // ack — do not warn again for this family
      void this._onAlignClick();
    });
  }

  /**
   * @param familyId      the family the run was decided FOR — the re-projection must use
   *                      it, not `_selectedFamilyId`, which the user can change mid-run.
   * @param existingLinks links the family had BEFORE the run — `alignRunSummary` needs it
   *                      to tell « nothing added because it was already aligned » apart
   *                      from « nothing added because the strategy matched nothing ».
   */
  private async _runAlign(
    opts: FamilyAlignOptions, familyId: number, existingLinks: number,
  ): Promise<void> {
    const conn = this._getConn();
    if (!conn || this._aligning) return;
    // Same F1 discipline as every other mutation of this screen: ids belong to the DB
    // they were read from.
    if (this._loadedConn !== null && conn !== this._loadedConn) {
      this._cb.toast?.("✗ Connexion changée — recharger la matrice avant d'aligner", true);
      this._resetMatrix();
      return;
    }
    const root = this._root;
    const alignBtn = root?.querySelector<HTMLButtonElement>("#matrix-align");
    const loadBtn = root?.querySelector<HTMLButtonElement>("#matrix-load");
    const famSel = root?.querySelector<HTMLSelectElement>("#matrix-family");
    const strip = root?.querySelector<HTMLElement>("#matrix-align-strip");
    this._aligning = true;
    // A run REWRITES the links the grid's gestures resolve through — freeze the gestures
    // and the selectors while it flies (F5), or a ✂ would post link_ids that no longer
    // exist (revue tranche 5).
    this._cutBusy = true;
    if (alignBtn) alignBtn.disabled = true;
    if (loadBtn) loadBtn.disabled = true;
    if (famSel) famSel.disabled = true;
    if (strip) strip.textContent = "Alignement en cours…";
    try {
      const res = await alignFamily(conn, familyId, opts);
      const line = alignRunSummary(res, opts, existingLinks);
      // ALI-17 — offrir le retour arrière tant que le run est sous les yeux de celui qui
      // l'a fait. L'offre est transitoire par construction : elle vit dans la bande, que
      // _closeAlignStrip vide à tout changement de famille ou de corpus (même garde F1/F5
      // que le bandeau de confirmation).
      const undoable = undoableRunIds(res);
      if (strip && undoable.length > 0) {
        const dbPath = getCurrentDbPath();
        if (dbPath) {
          saveRunOffer(sessionStorage, {
            dbPath, familyId, runIds: undoable, summary: line,
            at: new Date().toISOString(),
          });
        }
        this._showRunUndoOffer(strip, line, undoable, conn, familyId);
      } else if (strip) {
        // Un run qui n'a rien fait n'annule rien : ne pas laisser traîner l'offre du run
        // précédent, qui porterait sur un état que celui-ci a pu changer.
        clearRunOffer(sessionStorage);
        strip.textContent = line;
      }
      this._cb.toast?.(line, res.summary.errors > 0 || !line.startsWith("✓"));
      // The whole point of aligning from here: see the result in the grid at once — for
      // THE family that was aligned.
      this._selectedFamilyId = familyId;
      if (famSel) famSel.value = String(familyId);
      await this._loadMatrix();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (strip) strip.textContent = `✗ Alignement : ${msg}`;
      this._cb.toast?.(`✗ Alignement : ${msg}`, true);
    } finally {
      this._aligning = false;
      this._cutBusy = false;
      const none = this._selectedFamilyId === null;
      if (alignBtn) alignBtn.disabled = none;
      if (loadBtn) loadBtn.disabled = none;
      if (famSel) famSel.disabled = false;
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

  // ─── Stylo: in-place text correction (β, DESIGN_inline_text_correction.md) ─────

  /** Open the inline stylo editor on a cell. `col` is "hub" (source pivot) or a numeric
   *  translation column index. Resolves the unit_id + current text through the view-model
   *  (the <td> is anonymous), then swaps the cell content for a textarea. The stale-flag on
   *  aligned translations is posted server-side by updateUnitTextNorm (D-C2).
   *
   *  ALI-01 tranche 1 — the editor is seeded from `text_norm`, NOT from the cell's displayed
   *  text. The grid projects `text_raw` (deliberate: the cut offsets index it and it is
   *  immutable), while the stylo writes `text_norm`. Seeding from the projection meant every
   *  edit reopened the ORIGINAL text: a second correction silently reverted the first.
   *  Measured on the reference corpus — u251536 lost `Sais-tu` and gained a stray « fb »,
   *  u251524 lost a line break, both within seconds of the first fix (audit §11.12).
   *  The two texts differ on 82 of 46 648 units, so the bug is rare AND invisible: nothing
   *  in the grid changes when a correction is lost. */
  private _openCellEdit(btn: HTMLElement, viewRow: number, col: string): void {
    const conn = this._getConn();
    const view = this._view;
    if (!conn || !view || this._cutBusy) return;
    if (conn !== this._loadedConn) { // F1 — the ids belong to another DB now
      this._cb.toast?.("✗ Connexion changée — recharger la matrice avant d'éditer", true);
      this._resetMatrix();
      return;
    }
    // Re-checks the clean predicate defensively (the payload could differ from the button).
    const target = resolveStyloTarget(view, viewRow, col);
    if (!target.ok) {
      if (target.reason === "no-norm") { // button is gated on hasTextNorm; defensive half
        this._cb.toast?.(
          "✗ Sidecar trop ancien — texte normalisé absent (recompiler le sidecar)", true);
      }
      return;
    }
    const td = btn.closest<HTMLElement>("td");
    if (td) this._mountCellEditor(td, target.unitId, target.text);
  }

  /** Replace a cell's content with a single-textarea editor (seeded from its text_norm).
   *  One editor at a time; Ctrl+Entrée saves, Échap / Annuler restores the cell verbatim. */
  private _mountCellEditor(td: HTMLElement, unitId: number, text: string): void {
    this._restoreCellEditor(); // close any editor already open elsewhere
    this._cellEditTd = td;
    this._cellEditRestore = td.innerHTML;
    td.classList.add("prep-matrix-cell--editing");
    const wrap = document.createElement("div");
    wrap.className = "prep-matrix-edit";
    const ta = document.createElement("textarea");
    ta.className = "prep-matrix-edit-ta";
    ta.rows = 2;
    ta.value = text;
    const actions = document.createElement("div");
    actions.className = "prep-matrix-edit-actions";
    const save = document.createElement("button");
    save.type = "button"; save.className = "btn btn-primary btn-xs prep-matrix-edit-save";
    save.textContent = "Enregistrer"; save.title = "Ctrl+Entrée";
    const cancel = document.createElement("button");
    cancel.type = "button"; cancel.className = "btn btn-ghost btn-xs prep-matrix-edit-cancel";
    cancel.textContent = "Annuler"; cancel.title = "Échap";
    actions.append(save, cancel);
    wrap.append(ta, actions);
    td.replaceChildren(wrap);
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    const commit = (): void => { void this._saveCellEdit(unitId, ta.value, text); };
    save.addEventListener("click", (e) => { e.stopPropagation(); commit(); });
    cancel.addEventListener("click", (e) => { e.stopPropagation(); this._restoreCellEditor(); });
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commit(); }
      else if (e.key === "Escape") { e.preventDefault(); this._restoreCellEditor(); }
    });
  }

  /** Restore the edited cell's original content (cancel / re-open elsewhere). */
  private _restoreCellEditor(): void {
    if (this._cellEditTd && this._cellEditRestore != null) {
      setHtml(this._cellEditTd, raw(this._cellEditRestore)); // captured, already-escaped cell HTML
      this._cellEditTd.classList.remove("prep-matrix-cell--editing");
    }
    this._cellEditTd = null;
    this._cellEditRestore = null;
  }

  /** Persist a stylo correction (β): edits text_norm, keeps text_raw, flags aligned
   *  translations stale server-side. On success re-project the matrix (shows the corrected
   *  text); on failure keep the editor open for retry. */
  private async _saveCellEdit(unitId: number, newText: string, oldText: string): Promise<void> {
    if (newText === oldText) { this._restoreCellEditor(); return; } // no-op
    const conn = this._getConn();
    if (!conn) { this._restoreCellEditor(); return; }
    if (conn !== this._loadedConn) { // F1 — a corpus switch mid-edit
      this._cb.toast?.("✗ Connexion changée — recharger la matrice avant d'éditer", true);
      this._resetMatrix();
      return;
    }
    this._cutBusy = true; // block concurrent gestures during the write
    try {
      await updateUnitTextNorm(conn, unitId, newText);
      this._cellEditTd = null; this._cellEditRestore = null; // the reload rebuilds the grid
      await this._reloadPreservingScroll();
      this._cb.toast?.("✓ Texte corrigé");
    } catch (e) {
      this._cb.toast?.(`✗ ${e instanceof Error ? e.message : String(e)}`, true);
      // keep the editor open so the user can retry
    } finally {
      this._cutBusy = false;
    }
  }

  /** R6 — toggle a paragraph boundary at the row's hub segment (designate a new paragraph
   *  start, or remove an existing boundary). Non-destructive parent_n relabel a block at a
   *  time; the reload re-projects the ¶ column (sequential numbers). F1 + busy guards, like
   *  every other matrix mutation. */
  private async _onParagraphToggle(rowIdx: number): Promise<void> {
    const view = this._view;
    const conn = this._getConn();
    if (!view || !conn || this._cutBusy) return;
    if (conn !== this._loadedConn) { // F1 — a corpus switch since load
      this._cb.toast?.("✗ Connexion changée — recharger la matrice", true);
      this._resetMatrix();
      return;
    }
    const row = view.rows[rowIdx];
    const docId = view.hubDocId;
    if (!row || row.hubUnitId == null || docId == null) return;
    const wasStart = row.paragraphStart;
    this._cutBusy = true; // block concurrent gestures during the write
    try {
      await setParagraphBoundary(conn, docId, row.hubUnitId);
      await this._reloadPreservingScroll();
      this._cb.toast?.(wasStart ? "✓ Frontière de paragraphe retirée" : "✓ Nouveau paragraphe");
    } catch (e) {
      this._cb.toast?.(`✗ ${e instanceof Error ? e.message : String(e)}`, true);
    } finally {
      this._cutBusy = false;
    }
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
      // Ownership (revue G2) : un close() capturé et rappelé APRÈS un await ne doit pas
      // écraser l'état d'un modal rouvert entretemps — no-op s'il n'est plus le propriétaire.
      if (this._closeCutModal !== close) return;
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
    const cell = ctx.column[row] ?? [];
    if (cell.length === 0) {
      this._cb.toast?.("✗ Cellule sans traduction alignée — rien à couper.", true);
      return;
    }
    const canUp = row > 0;
    const canDown = row < ctx.column.length - 1;
    if (!canUp && !canDown) {
      this._cb.toast?.("✗ Segment voisin introuvable — recharger la matrice", true);
      return;
    }
    // Revue G-min : une cellule d'UN lien sans frontière de mot interne (« Yes. ») n'a ni
    // scission ni déplacement possible — la garde « un seul mot » de l'ancien resolveStraddleCut,
    // perdue en D-W17 (une cellule multi-liens a toujours une frontière d'unité, elle).
    if (cell.length === 1) {
      const [ws0, we0] = linkWindow(cell[0]);
      if (viableCutOffsetsIn(cell[0].target_text_raw ?? "", ws0, we0).length === 0) {
        this._cb.toast?.("✗ Un seul mot — rien à couper.", true);
        return;
      }
    }
    const view = ctx.view;
    const rowCur = ctx.hubRows[row];
    let dir: StraddleDirection = canDown ? "down" : "up";

    // Default cut (D-W17): a multi-link cell defaults to the UNIT boundary that moves the
    // edge sentence toward the neighbour (« couper après le point ») ; a single-link cell
    // to a proportional in-unit split, as before.
    const defaultCut = (d: StraddleDirection): { link: number; offset: number } => {
      if (cell.length > 1) {
        return d === "down"
          ? { link: cell.length - 1, offset: linkWindow(cell[cell.length - 1])[0] }
          : { link: 0, offset: linkWindow(cell[0])[1] };
      }
      const [ws, we] = linkWindow(cell[0]);
      const neighbor = ctx.hubRows[d === "up" ? row - 1 : row + 1];
      const off = suggestCutOffset(
        cell[0].target_text_raw ?? "",
        d === "up" ? (neighbor?.hubText ?? "") : rowCur.hubText,
        d === "up" ? rowCur.hubText : (neighbor?.hubText ?? ""),
        [ws, we],
      );
      return { link: 0, offset: off ?? ws };
    };
    let cut = defaultCut(dir);

    // Top panel = the earlier segment, bottom = the later — the cut's head is on top.
    const labelsFor = (d: StraddleDirection): CutPanelsLabels => {
      const neighbor = ctx.hubRows[d === "up" ? row - 1 : row + 1];
      return d === "down"
        ? { topSeg: rowCur.segment, topHub: rowCur.hubText, bottomSeg: neighbor.segment, bottomHub: neighbor.hubText }
        : { topSeg: neighbor.segment, topHub: neighbor.hubText, bottomSeg: rowCur.segment, bottomHub: rowCur.hubText };
    };

    const radio = (d: StraddleDirection, label: string, ok: boolean): string =>
      `<label class="prep-matrix-cut-dir-opt${ok ? "" : " prep-matrix-cut-dir-opt--off"}"`
      + (ok ? "" : ` title="Pas de segment dans ce sens"`)
      + `><input type="radio" name="prep-matrix-cut-dir" value="${d}"`
      + `${d === dir ? " checked" : ""}${ok ? "" : " disabled"}> ${label}</label>`;
    const segUp = row > 0 ? ctx.hubRows[row - 1]?.segment : null;
    const segDown = ctx.hubRows[row + 1]?.segment ?? null;
    const extra = `<div class="prep-matrix-cut-dir" role="radiogroup" aria-label="Sens de la coupe">`
      + radio("down", `La <b>fin</b> (après la coupe) va au segment suivant${segDown != null ? ` (${segDown})` : ""}`, canDown)
      + radio("up", `Le <b>début</b> va au segment précédent${segUp != null ? ` (${segUp})` : ""}`, canUp)
      + `</div>`;

    const lang = view.translationLangs[col] ?? "?";
    const { dialog, panelsHost, okBtn } = this._openPickerShell(
      `✂ Couper à cheval (${lang}, segment ${rowCur.segment})`,
      `Coupez le texte de la cellule où vous voulez : sur une frontière de phrase (‧) la phrase entière `
      + `passe au segment voisin, à l'intérieur d'une phrase elle est scindée. Réversible (↺).`,
      extra,
    );

    const renderPanels = () =>
      setHtml(panelsHost, raw(buildCellSplitPanelsHtml(cell, cut.link, cut.offset, labelsFor(dir))));
    renderPanels();

    dialog.querySelectorAll<HTMLInputElement>('input[name="prep-matrix-cut-dir"]').forEach((r) =>
      r.addEventListener("change", () => {
        dir = r.value as StraddleDirection;
        cut = defaultCut(dir);
        renderPanels();
      }));
    panelsHost.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".prep-matrix-cut-word[data-cut-offset]");
      if (!btn || btn.dataset.cutLink == null) return;
      cut = { link: Number(btn.dataset.cutLink), offset: Number(btn.dataset.cutOffset) };
      renderPanels();
    });
    okBtn.addEventListener("click", () => {
      const plan = resolveCellSplit(ctx.column, row, dir, cut.link, cut.offset);
      if (plan.error !== undefined) {
        this._cb.toast?.(`✗ ${plan.error}`, true);
        return;
      }
      const neighbor = ctx.hubRows[plan.neighborRow];
      if (neighbor?.hubUnitId == null) {
        this._cb.toast?.("✗ Segment voisin introuvable — recharger la matrice", true);
        return;
      }
      void this._performCellSplit(
        plan, dir, neighbor.hubUnitId, ctx.column[plan.neighborRow] ?? [],
        this._closeCutModal!, okBtn);
    });
  }

  /**
   * The generalized cut (D-W17): create the going piece of the split (if any) plus one
   * link per whole-unit MOVE — all on the neighbour pivot — then, in ONE atomic batch,
   * partition the split, window any pre-cut move, and delete the moved originals. On
   * failure every created link is deleted in compensation (never leave an orphan whole-unit
   * link that would project text twice); if even that fails, resync to the real state. The
   * neighbour's cell is then beaded best-effort (D-W16), out of band (revue T5).
   */
  private async _performCellSplit(
    plan: CellSplitPlan,
    direction: StraddleDirection,
    neighborHubUnitId: number,
    neighborLinks: readonly MatrixCellLink[],
    close: () => void,
    okBtn: HTMLButtonElement,
  ): Promise<void> {
    const conn = this._getConn();
    if (!conn) return;
    okBtn.disabled = true;
    const createdIds: number[] = [];
    // Inherit the sibling's pair number so audit views sort the new link with its family.
    const inherit = (l: MatrixCellLink) =>
      typeof l.external_id === "number" ? { external_id: l.external_id } : {};
    try {
      let splitCreatedId: number | null = null;
      if (plan.split) {
        const c = await createAlignLink(conn, {
          pivot_unit_id: neighborHubUnitId, target_unit_id: plan.split.link.target_unit_id,
          ...inherit(plan.split.link),
        });
        splitCreatedId = c.link_id;
        createdIds.push(c.link_id);
      }
      const moveCreatedIds: number[] = [];
      for (const m of plan.moves) {
        const c = await createAlignLink(conn, {
          pivot_unit_id: neighborHubUnitId, target_unit_id: m.target_unit_id, ...inherit(m),
        });
        moveCreatedIds.push(c.link_id);
        createdIds.push(c.link_id);
      }

      const actions: AlignBatchAction[] = [];
      if (plan.split && splitCreatedId != null) {
        const [ws, we] = linkWindow(plan.split.link);
        const at = plan.split.at;
        // "down": the cell keeps the head [ws, at], the neighbour gets the tail [at, we].
        // "up": the cell keeps the tail, the neighbour (above) gets the head.
        const staying = direction === "down" ? { s: ws, e: at } : { s: at, e: we };
        const going = direction === "down" ? { s: at, e: we } : { s: ws, e: at };
        actions.push({ action: "set_target_span", link_id: plan.split.link.link_id, char_start: staying.s, char_end: staying.e });
        actions.push({ action: "set_target_span", link_id: splitCreatedId, char_start: going.s, char_end: going.e });
      }
      plan.moves.forEach((m, idx) => {
        // A whole-unit move needs no window; preserve one that was itself a slice.
        if (m.char_start != null && m.char_end != null) {
          actions.push({ action: "set_target_span", link_id: moveCreatedIds[idx], char_start: m.char_start, char_end: m.char_end });
        }
        actions.push({ action: "delete", link_id: m.link_id });
      });
      if (actions.length === 0) throw new Error("aucune action à appliquer");

      const res = await batchUpdateAlignLinks(conn, actions, { atomic: true });
      if (res.errors.length) {
        if (res.applied > 0 || res.deleted > 0) {
          // Old sidecar without atomic: partially committed — resync (revue G3 : un
          // déplacement est un batch delete-only, donc `deleted>0` EST le signal de partiel,
          // pas `applied` — sinon on tombait en compensation et on perdait le lien).
          close();
          this._cb.toast?.(`✗ Coupe partielle : ${res.errors[0].error} — matrice resynchronisée`, true);
          await this._reloadPreservingScroll();
          return;
        }
        // Rien de committé : compenser les liens créés. Si une compensation ÉCHOUE, un orphelin
        // survit → resync pour montrer l'état réel (revue G3 : c'était avalé sans resync).
        let compensated = true;
        for (const id of createdIds) {
          try { await deleteAlignLink(conn, { link_id: id }); } catch { compensated = false; }
        }
        if (!compensated) {
          close();
          this._cb.toast?.(`✗ Coupe refusée : ${res.errors[0].error} — matrice resynchronisée`, true);
          await this._reloadPreservingScroll();
          return;
        }
        this._cb.toast?.(`✗ Coupe refusée : ${res.errors[0].error} (rien n'a été appliqué)`, true);
        okBtn.disabled = false;
        return;
      }
      // The neighbour's cell now holds its own link(s) + the ones we created: ONE bead
      // (1 hub ↔ N targets, D-W16). Best-effort in its own non-atomic batch — hygiene, not
      // the gesture: inside the atomic batch a sidecar < 1.6.57 (no set_bead) would roll the
      // whole cut back (revue T5).
      await this._groupCellBead(conn, [
        ...neighborLinks, ...createdIds.map((id) => ({ link_id: id, manual: true as const })),
      ]);
      close();
      // A whole-unit MOVE onto an ALREADY-translated neighbour continues the drift: the
      // neighbour is now multi-phrase, likely still shifted (the Beigbeder cascade). Say so —
      // an in-unit split, or a move onto an empty cell, needs no such caution.
      const cascade = plan.moves.length > 0 && neighborLinks.length > 0;
      const base = plan.split ? "✓ Traduction coupée à cheval" : "✓ Phrase déplacée au segment voisin";
      this._cb.toast?.(cascade
        ? `${base} — le segment voisin porte maintenant plusieurs phrases (à vérifier)`
        : base);
      await this._reloadPreservingScroll();
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      // Revue G1 : le voisin peut porter un lien REJETÉ (invisible dans cell_links) sur la cible
      // déplacée → l'index unique (pivot,cible) le refuse en 409. Message actionnable.
      const msg = /already exists|conflict|409/i.test(raw)
        ? "un lien existe déjà pour cette cible chez le voisin (peut-être rejeté au Contrôle)"
        : raw;
      if (createdIds.length) {
        let compensated = true;
        for (const id of createdIds) {
          try { await deleteAlignLink(conn, { link_id: id }); } catch { compensated = false; }
        }
        if (compensated) {
          okBtn.disabled = false;
          this._cb.toast?.(`✗ Coupe : ${msg}`, true);
        } else {
          close();
          this._cb.toast?.(`✗ Coupe : ${msg} — matrice resynchronisée`, true);
          await this._reloadPreservingScroll();
        }
        return;
      }
      okBtn.disabled = false;
      this._cb.toast?.(`✗ Coupe : ${msg}`, true);
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
      + `</div><div class="prep-matrix-merge-host"></div>`
      + cellMergeReversalNoteHtml();

    const { dialog, okBtn } = this._openPickerShell(
      `⭙ Fusionner (${lang}, segment ${rowCur.segment})`,
      // « réversible — ⭙ dans l'autre sens » disait vrai à moitié et s'arrêtait là :
      // la phrase revient, sa provenance non. Le détail est dans la note, sous l'aperçu.
      `La traduction est découpée plus finement que l'original : la phrase voisine appartient `
      + `à ce segment. Elle sera rattachée ici.`,
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
        ? " (cette cellule porte une ambiguïté d'alignement — à arbitrer au Contrôle)"
        : "";
      this._cb.toast?.(`✓ Phrase absorbée${tail}${warn}`);
      await this._reloadPreservingScroll();
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      // A REJECTED link (P,T) still occupies the unique index (mig 008) but is invisible
      // in the matrix, so the resolver cannot see it and create returns a bare 409 (T7).
      const msg = /already exists|CONFLICT|409/i.test(raw)
        ? "un lien (rejeté ?) existe déjà entre ce segment et cette phrase — le réactiver ou le supprimer au Contrôle"
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
      // Ownership (revue G2) : un close() capturé et rappelé APRÈS un await ne doit pas
      // écraser l'état d'un modal rouvert entretemps — no-op s'il n'est plus le propriétaire.
      if (this._closeCutModal !== close) return;
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

  // ─── « ✕ » Retirer une traduction parasite de la cellule (D-W18 §3.8) ─────────

  /**
   * Chooser for the ✕ gesture: one button per translation of the cell. A WHOLE link is
   * removable (rejected → excluded from the projection, reversible) ; a CUT slice is shown
   * disabled (« ↺ d'abord »). Same lifecycle hardening as the ↺ chooser (F4/F5/F10/Escape).
   */
  private _openRemoveChooser(viewRow: number, col: number): void {
    const ctx = this._cellGestureCtx(col, viewRow); // F1 / F5 guard
    if (!ctx) return;
    const cell = ctx.column[ctx.row] ?? [];
    const candidates = cellRemovableTranslations(cell);
    if (candidates.length === 0) {
      this._cb.toast?.("✗ Cellule sans traduction — rien à retirer.", true);
      return;
    }
    if (!candidates.some((t) => t.removable)) {
      this._cb.toast?.("✗ Traduction(s) coupée(s) — annuler la coupe (↺) avant de retirer.", true);
      return;
    }
    const rowCur = ctx.hubRows[ctx.row];
    const lang = ctx.view.translationLangs[col] ?? "?";
    this._cutBusy = true;
    const overlay = document.createElement("div");
    overlay.className = "prep-matrix-cut-overlay";
    const dialog = document.createElement("div");
    dialog.className = "prep-matrix-cut-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    const options = candidates.map((t) => t.removable
      ? `<button type="button" class="prep-matrix-remove-choice" data-remove-link="${t.link_id}">`
        + `&#10005; ${_esc(shortenCp(t.text, 90))}</button>`
      : `<span class="prep-matrix-remove-choice prep-matrix-remove-choice--off"`
        + ` title="Traduction coupée — annuler (↺) d'abord">${_esc(shortenCp(t.text, 90))}</span>`,
    ).join("");
    setHtml(dialog, safeHtml`
      <div class="prep-matrix-cut-title">&#10005; Retirer une traduction (${lang}, segment ${rowCur.segment})</div>
      <p class="prep-matrix-cut-hint">La traduction choisie est <b>retirée</b> de la cellule ;
        l'unité cible reste dans le corpus. Pour la remettre : <b>＝ Rattacher</b>.</p>
      <div class="prep-matrix-remove-choices">${raw(options)}</div>
      <div class="prep-matrix-cut-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-cut-cancel>Annuler</button>
      </div>
    `);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    const close = () => {
      // Ownership (revue G2) : un close() capturé et rappelé APRÈS un await ne doit pas
      // écraser l'état d'un modal rouvert entretemps — no-op s'il n'est plus le propriétaire.
      if (this._closeCutModal !== close) return;
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
    dialog.querySelectorAll<HTMLButtonElement>(".prep-matrix-remove-choice[data-remove-link]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const linkId = Number(btn.dataset.removeLink);
        close();
        void this._performCellRemove(linkId);
      }));
  }

  /**
   * Remove one link (D-W18 ; revue G1 : **delete**, plus reject). Reuse
   * `/align/collisions/resolve` `{action:"delete"}`. Le rejet gardait le lien sur l'index
   * unique `(pivot,target)` — invisible (F8) mais bloquant : ＝ ne pouvait pas re-poser la
   * même cible (409) et un lien rejeté seul n'apparaît dans aucune collision (« réversible »
   * était faux). La suppression fait de ✕/＝ des inverses propres ; l'undo = ＝ Rattacher.
   * F1 vérifiée avant l'écriture (le delete part sur la connexion capturée).
   */
  private async _performCellRemove(linkId: number): Promise<void> {
    const conn = this._getConn();
    if (!conn) return;
    if (conn !== this._loadedConn) {
      this._cb.toast?.("✗ Connexion changée — recharger la matrice avant d'agir", true);
      this._resetMatrix();
      return;
    }
    this._cutBusy = true; // guards the round-trip (F5) — no modal is open here
    try {
      const res = await resolveCollisions(conn, [{ action: "delete", link_id: linkId }]);
      if (res.errors.length) {
        this._cb.toast?.(`✗ Retrait refusé : ${res.errors[0].error}`, true);
        return;
      }
      this._cb.toast?.("✓ Traduction retirée");
      await this._reloadPreservingScroll();
    } catch (err) {
      this._cb.toast?.(`✗ Retrait : ${err instanceof Error ? err.message : String(err)}`, true);
    } finally {
      this._cutBusy = false;
    }
  }

  // ─── « ＝ » Rattacher / re-cibler — le geste constructif (D-W19 §3.9) ──────────

  /**
   * ＝ Rattacher: an ASYNC picker (candidates come from `retargetCandidates`, pivot-anchored
   * — it handles the orphan pivot of an empty cell). Empty cell → create ; single-link cell
   * → retarget that link ; ≥ 2 links → refused (the retarget machinery assumes one link).
   * F1 re-checked after the fetch (the async gap could span a conn change).
   */
  private _openAttachPicker(viewRow: number, col: number): void {
    const ctx = this._cellGestureCtx(col, viewRow); // F1 / F5 guard
    if (!ctx) return;
    const cell = ctx.column[ctx.row] ?? [];
    if (cell.length > 1) {
      this._cb.toast?.(
        "✗ Cellule à plusieurs traductions — retirez-en (✕) ou restructurez (✂/⭙) avant de rattacher.", true);
      return;
    }
    // Revue G4 : re-cibler un lien COUPÉ garderait sa fenêtre périmée sur la nouvelle cible.
    if (cell.length === 1 && cell[0].char_start != null) {
      this._cb.toast?.("✗ Traduction coupée — annuler la coupe (↺) avant de re-cibler.", true);
      return;
    }
    const rowCur = ctx.hubRows[ctx.row];
    const pivotUnitId = rowCur.hubUnitId;
    if (pivotUnitId == null) {
      this._cb.toast?.("✗ Segment source introuvable — recharger la matrice", true);
      return;
    }
    const targetDocId = ctx.view.translationDocIds[col];
    const existingLinkId = cell.length === 1 ? cell[0].link_id : null;
    // RA-D1 (re-anchor): on an EMPTY cell, a candidate target already anchored on
    // EXACTLY ONE other hub row (and not cut) may be MOVED here (set_pivot) instead of
    // duplicated. Ambiguous (multi-row) or cut targets fall back to the plain create path.
    const linkedElsewhere = new Map<number, { linkId: number; segment: string }>();
    if (existingLinkId == null) {
      const occ = new Map<number, { linkId: number; segment: string; count: number }>();
      ctx.column.forEach((c, r) => {
        if (r === ctx.row) return;
        for (const l of (c ?? [])) {
          if (l.char_start != null) continue; // cut link — leave out (span/pivot edge case)
          const e = occ.get(l.target_unit_id);
          if (e) { e.count++; }
          else occ.set(l.target_unit_id, {
            linkId: l.link_id, segment: String(ctx.hubRows[r]?.segment ?? "?"), count: 1,
          });
        }
      });
      for (const [t, e] of occ) if (e.count === 1) linkedElsewhere.set(t, { linkId: e.linkId, segment: e.segment });
    }
    const lang = ctx.view.translationLangs[col] ?? "?";
    const conn = this._getConn();
    if (!conn) return;

    this._cutBusy = true;
    const overlay = document.createElement("div");
    overlay.className = "prep-matrix-cut-overlay";
    const dialog = document.createElement("div");
    dialog.className = "prep-matrix-cut-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    setHtml(dialog, safeHtml`
      <div class="prep-matrix-cut-title">&#61; Rattacher une traduction (${lang}, segment ${rowCur.segment})</div>
      <p class="prep-matrix-cut-hint">${existingLinkId != null
        ? "Choisir la BONNE cible — le lien de cette cellule est re-ciblé (réversible au ✕)."
        : "Choisir la traduction de ce segment — un lien est créé (réversible au ✕)."}</p>
      <div class="prep-matrix-attach-host">${raw(buildPickerRowHtml({
        pivotUnitId, pivotText: rowCur.hubText, asTableRow: false, candidates: null, alreadyLinked: new Set(),
      }))}</div>
      <div class="prep-matrix-cut-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-cut-cancel>Annuler</button>
      </div>
    `);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    const close = () => {
      // Ownership (revue G2) : un close() capturé et rappelé APRÈS un await ne doit pas
      // écraser l'état d'un modal rouvert entretemps — no-op s'il n'est plus le propriétaire.
      if (this._closeCutModal !== close) return;
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

    const host = dialog.querySelector<HTMLElement>(".prep-matrix-attach-host")!;
    void (async () => {
      let res;
      try {
        res = await retargetCandidates(conn, { pivot_unit_id: pivotUnitId, target_doc_id: targetDocId });
      } catch (err) {
        close();
        this._cb.toast?.(`✗ Candidats : ${err instanceof Error ? err.message : String(err)}`, true);
        return;
      }
      if (this._closeCutModal !== close) return; // the modal was closed while the fetch was in flight
      if (this._getConn() !== this._loadedConn) {
        close();
        this._cb.toast?.("✗ Connexion changée — recharger la matrice avant d'agir", true);
        this._resetMatrix();
        return;
      }
      const alreadyLinked = new Set(cell.map((l) => l.target_unit_id));
      setHtml(host, raw(buildPickerRowHtml({
        pivotUnitId, pivotText: rowCur.hubText, asTableRow: false, candidates: res.candidates, alreadyLinked,
        linkedElsewhere: new Map([...linkedElsewhere].map(([t, v]) => [t, v.segment])),
      })));
      host.querySelector<HTMLButtonElement>(".prep-align-picker-cancel")?.addEventListener("click", close);
      // Revue G-min : les candidats EN CONFLIT (déjà liés à ce pivot) ne sont pas câblés — les
      // choisir serait un no-op annoncé « ✓ re-ciblée » (ou un 409). Ils restent visibles, grisés.
      host.querySelectorAll<HTMLButtonElement>(".prep-align-picker-cand[data-uid]:not([data-conflict])").forEach((btn) =>
        btn.addEventListener("click", () => {
          const targetUnitId = Number(btn.dataset.uid);
          const elsewhere = linkedElsewhere.get(targetUnitId);
          if (elsewhere && existingLinkId == null) {
            // RA-D1: the target already lives on another hub row → two legitimate readings:
            // déplacer (ré-ancrer the mislinked link) OR ajouter aussi (a legit 1-M bead).
            this._showReanchorChoice(host, close, {
              pivotUnitId, targetUnitId, fromLinkId: elsewhere.linkId, fromSegment: elsewhere.segment,
              targetText: btn.querySelector<HTMLElement>(".prep-align-picker-cand-text")?.textContent ?? "",
            });
          } else {
            close();
            void this._performAttach(pivotUnitId, targetUnitId, existingLinkId);
          }
        }));
    })();
  }

  /**
   * Apply the ＝: create a link (orphan pivot) or retarget the cell's single link. Reversible
   * via ✕ (D-W18). F1 re-checked across the async gap.
   */
  private async _performAttach(
    pivotUnitId: number, targetUnitId: number, existingLinkId: number | null,
  ): Promise<void> {
    const conn = this._getConn();
    if (!conn) return;
    if (conn !== this._loadedConn) {
      this._cb.toast?.("✗ Connexion changée — recharger la matrice avant d'agir", true);
      this._resetMatrix();
      return;
    }
    this._cutBusy = true; // guards the round-trip (F5)
    try {
      if (existingLinkId != null) {
        await retargetAlignLink(conn, { link_id: existingLinkId, new_target_unit_id: targetUnitId });
        this._cb.toast?.("✓ Traduction re-ciblée");
      } else {
        await createAlignLink(conn, { pivot_unit_id: pivotUnitId, target_unit_id: targetUnitId });
        this._cb.toast?.("✓ Traduction rattachée");
      }
      await this._reloadPreservingScroll();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Revue G1 : un lien (peut-être rejeté par la Révision fine, donc invisible) occupe déjà
      // l'index unique (pivot,cible) → 409. Message actionnable plutôt que la chaîne brute.
      this._cb.toast?.(/already exists|conflict|409/i.test(msg)
        ? "✗ Un lien existe déjà pour cette cible (peut-être rejeté au Contrôle) — l'y réactiver ou le supprimer."
        : `✗ Rattacher : ${msg}`, true);
    } finally {
      this._cutBusy = false;
    }
  }

  /**
   * RA-D1: the picked target already lives on another hub row → offer the two
   * legitimate readings in place of the candidate list — **déplacer** (re-anchor the
   * mislinked link here, set_pivot) or **ajouter aussi** (create a second link, a legit
   * 1-M bead like EN1 ↔ FR1+FR2). The modal's own Annuler / Esc still dismisses.
   */
  private _showReanchorChoice(
    host: HTMLElement,
    close: () => void,
    p: { pivotUnitId: number; targetUnitId: number; fromLinkId: number; fromSegment: string; targetText: string },
  ): void {
    setHtml(host, safeHtml`
      <div class="prep-matrix-reanchor-choice">
        <p class="prep-matrix-cut-hint">« ${p.targetText.slice(0, 80)} » est déjà la traduction du segment source ${p.fromSegment}. Que faire&#8239;?</p>
        <div class="prep-matrix-cut-actions">
          <button type="button" class="btn btn-sm prep-matrix-reanchor-move" data-reanchor-move>&#61; Déplacer ici (ré-ancrer)</button>
          <button type="button" class="btn btn-ghost btn-sm" data-reanchor-add>&#43; Ajouter aussi (garder les deux)</button>
        </div>
      </div>
    `);
    host.querySelector<HTMLButtonElement>("[data-reanchor-move]")?.addEventListener("click", () => {
      close();
      void this._performReanchor(p.fromLinkId, p.pivotUnitId);
    });
    host.querySelector<HTMLButtonElement>("[data-reanchor-add]")?.addEventListener("click", () => {
      close();
      void this._performAttach(p.pivotUnitId, p.targetUnitId, null);
    });
  }

  /**
   * Apply the re-anchor (RA-D1): move `fromLinkId` onto `newPivotUnitId` via set_pivot.
   * Only pivot_unit_id changes (status / target / cut span kept, stale bead_uid cleared
   * server-side). F1 re-checked across the async gap, like `_performAttach`.
   */
  private async _performReanchor(fromLinkId: number, newPivotUnitId: number): Promise<void> {
    const conn = this._getConn();
    if (!conn) return;
    if (conn !== this._loadedConn) {
      this._cb.toast?.("✗ Connexion changée — recharger la matrice avant d'agir", true);
      this._resetMatrix();
      return;
    }
    this._cutBusy = true;
    try {
      const res = await batchUpdateAlignLinks(
        conn,
        [{ action: "set_pivot", link_id: fromLinkId, new_pivot_unit_id: newPivotUnitId }],
        { atomic: true },
      );
      if (res.errors.length > 0) {
        this._cb.toast?.(`✗ Ré-ancrer : ${res.errors[0].error}`, true);
      } else {
        this._cb.toast?.("✓ Traduction ré-ancrée");
      }
      await this._reloadPreservingScroll();
    } catch (err) {
      this._cb.toast?.(`✗ Ré-ancrer : ${err instanceof Error ? err.message : String(err)}`, true);
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
  /**
   * T6.2 (D-P2) — handoff scopé : renvoyer le lien de la cellule (row, col) vers la
   * « Révision fine », paire moyeu ↔ doc-colonne pré-chargée et scrollée sur ce lien.
   * La matrice est famille-scopée : le pivot est le moyeu (`_loadedFamilyId` = family_id),
   * la cible le doc de la colonne (`translationDocIds[col]`), le lien le premier de la cellule.
   */
  private _onReviewClick(row: number, col: number): void {
    const conn = this._getConn();
    const view = this._view;
    if (!conn || !view) return;
    // Même garde F1 que les gestes : une matrice chargée sur une AUTRE base porte des ids
    // qui ne veulent rien dire ici — la Révision fine ouvrirait la mauvaise paire.
    if (conn !== this._loadedConn) {
      this._cb.toast?.("✗ Connexion changée — recharger la matrice avant d'agir", true);
      this._resetMatrix();
      return;
    }
    const pivotDocId = this._loadedFamilyId;
    const targetDocId = view.translationDocIds[col];
    if (pivotDocId == null || targetDocId == null) {
      this._cb.toast?.("✗ Colonne sans document cible — recharger la matrice", true);
      return;
    }
    const linkId = view.rows[row]?.cells[col]?.links[0]?.link_id ?? null;
    this._cb.onOpenRevisionFine?.({ pivotDocId, targetDocId, linkId });
  }

  private _openUncoveredPanel(col: number): void {
    const view = this._statusGestureCtx();
    if (!view) return;
    const units = view.uncovered[col] ?? [];
    const lang = view.translationLangs[col] ?? "?";
    const docId = view.translationDocIds[col] ?? null;
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
      + (docId != null
        ? `<button type="button" class="prep-matrix-orphan-seg" data-seg-unit="${u.n}"`
          + ` title="Ouvrir cette unité dans la Segmentation (Brut) — la fusionner/couper pour recaler l'alignement">&#8599; Segmenter</button>`
        : "")
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
      // Ownership (revue G2) : un close() capturé et rappelé APRÈS un await ne doit pas
      // écraser l'état d'un modal rouvert entretemps — no-op s'il n'est plus le propriétaire.
      if (this._closeCutModal !== close) return;
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
    // Deep-link an orphan to its exact unit in the Segmentation/Brut layer of the target doc.
    dialog.querySelectorAll<HTMLButtonElement>(".prep-matrix-orphan-seg").forEach((btn) =>
      btn.addEventListener("click", () => {
        const n = Number(btn.dataset.segUnit);
        close();
        if (docId != null) this._cb.onOpenSegmentation?.(docId, n);
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
    // Any re-projection rebuilds the grid → an inline stylo editor (and its restore snapshot)
    // is discarded with the old <td>; drop the refs so a later cancel can't touch a stale node.
    this._cellEditTd = null;
    this._cellEditRestore = null;
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
    this._loadedFamilyId = null;
    this._cutBusy = false;
    this._cellEditTd = null;
    this._cellEditRestore = null;
  }
}
