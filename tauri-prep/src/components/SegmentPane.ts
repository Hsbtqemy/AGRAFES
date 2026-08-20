/**
 * SegmentPane.ts — the canvas "Segmentation" layer (R5.4b-1).
 *
 * A preview→apply flow (not a per-unit selection flow like RolesPane): the header
 * carries the surface (Phrases | Balises | Personnalisé), the body renders the
 * *proposed* segmentation as a list grouped by source unit (aperçu en contexte,
 * decision A), and the fixed bottom sheet holds the summary + Apply so it stays
 * reachable after scrolling (R5.3). Apply is destructive (clears alignment) →
 * modalConfirm only when there is an alignment to lose (garde-fou conditionnel,
 * no imposed WORKCOPY); on success the host reloads the document.
 *
 * Pure logic (surface → params, grouping, summary, guard) lives in
 * lib/segmentControls.ts and is unit-tested; this file is DOM + sidecar wiring.
 *
 * Personnalisé (custom terminators / Mots) is deliberately disabled here → R5.4b-2.
 */

import type {
  Conn, SegmentPreviewResponse, PrepUndoEligibilityResponse,
  PropagatePreviewResponse, ApplyPropagatedUnit, ConventionRole,
} from "../lib/sidecarClient.ts";
import {
  segmentPreview, segment, getDocumentStats, listUnits,
  mergeUnits, splitUnit, prepUndo, prepUndoEligibility, regroupCoarse,
  getDocRelations, segmentPropagatePreview, applyPropagated, listConventions,
  richTextToHtml, updateUnitTextNorm, setParagraphBoundary,
} from "../lib/sidecarClient.ts";
import { escHtml as esc } from "../lib/diff.ts";
import { setHtml, raw } from "../lib/safeHtml.ts";
import { modalConfirm } from "../lib/modalConfirm.ts";
import { resolveRoleBadge } from "../lib/conventionsUnitList.ts";
import { safeColor } from "../lib/conventionsRoles.ts";
import { hasImportOriginal } from "../lib/importOriginal.ts";
import {
  buildSegmentParams,
  groupSegmentsBySource,
  segmentSummaryLine,
  needsAlignmentConfirm,
  alignmentLossNote,
  cutDissolvedNote,
  surfaceHint,
  defaultAbbreviations,
  parseAbbreviations,
  autoSplitText,
  type SegSurface,
  type CustomSpecState,
} from "../lib/segmentControls.ts";
import { computeAnomalyView, type AnomalyView } from "../lib/segmentAnomalies.ts";
import { formatUndoActionLabel, formatUndoTooltip, isUndoDisabled, formatUndoLinkSuffix } from "../lib/prepUndo.ts";

/** Roles that mark a section wall (a heading line, not a paragraph). Mirrors
 *  coarse_grain.STRUCTURAL_ROLES — the engine rejects a paragraph toggle on these. */
const STRUCTURAL_ROLES = new Set<string>(["intertitre"]);

export class SegmentPane {
  private readonly _root: HTMLElement;
  private readonly _getConn: () => Conn | null;
  /** Toast channel (success + error). Prep proscrit alert()/confirm() natifs. */
  private readonly _notify: (msg: string, isError?: boolean) => void;
  /** Shared fixed bottom sheet (R5.3): the summary + Apply live here. Null → in-pane. */
  private readonly _sheet: HTMLElement | null;
  /** Host reload after a successful resegmentation (stats/bandeau/couches se rechargent). */
  private readonly _onResegmented: (() => void | Promise<void>) | null;

  private _docId: number | null = null;
  private _lang: string | null = null;
  private _surface: SegSurface = "phrases";
  /** Current units, rendered as-is by the "Brut" tab so the user can compare the current state
   *  against a proposed segmentation by switching tabs, flag anomalies, and edit (merge/split)
   *  line units in place (R5.4b-3). Carries role + verbatim raw + import-original for parity with
   *  SegmentationView's rendering (tranche 3: role badge · richText · « voir l'original » fold). */
  private _units: {
    n: number; unitId: number; text: string; isLine: boolean;
    role: string | null; textRaw: string; textSource: string | null;
    parentN: number | null;
  }[] = [];
  /** Paratext boundary (documents.text_start_n): line units with n < this are paratext and
   *  carry no paragraph number / ¶ toggle (mirrors the matrix + the engine's text scope). */
  private _textStartN: number | null = null;
  private _applyBarEl: HTMLElement | null = null;
  private _lastPreview: SegmentPreviewResponse | null = null;
  private _previewTimer: ReturnType<typeof setTimeout> | null = null;
  private _busy = false;
  /** Guards against a stale async preview overwriting a newer one (doc/surface switch). */
  private _previewToken = 0;
  /** Personnalisé (R5.4b-2) controls state → a full SegmentSpec via buildSegmentParams. */
  private _custom: CustomSpecState = {
    terminators: [".!?"], requireUppercase: false, wordMode: false, abbreviations: [],
  };
  /** Doc the abbreviation field was last pre-filled for — so a layer re-entry doesn't wipe edits. */
  private _prefillDoc: number | null | undefined = undefined;
  /** Brut view anomaly filters (R5.4b-3): short segments / orphan closing punctuation. */
  private _filterShort = false;
  private _filterOrphan = false;
  /** Unit n currently showing the inline split editor in the Brut view, or null. */
  private _splitEditingN: number | null = null;
  /** In-progress split editor text, preserved across re-renders (e.g. a filter toggle). */
  private _splitDraft: { a: string; b: string } | null = null;
  /** Unit n currently showing the inline stylo (text-correction) editor, or null. Mutually
   *  exclusive with _splitEditingN — opening one closes the other. */
  private _textEditingN: number | null = null;
  /** In-progress stylo text, preserved across re-renders (e.g. a filter toggle). */
  private _textDraft: string | null = null;
  /** Unit n to scroll to + flash once after a merge/split reload, or null. */
  private _pendingFocusN: number | null = null;
  /** Last Mode A undo eligibility for this doc — drives the Brut "↶ Annuler" button. */
  private _undoElig: PrepUndoEligibilityResponse | null = null;
  /** Custom coarse boundary pattern for the Tours « Pré-remplir » (empty → the built-in `tours` preset). */
  private _toursPattern = "";
  /** Source doc (this doc's `translation_of` target) → drives family propagation, or null. */
  private _sourceDocId: number | null = null;
  /** Transient "Propager la segmentation" mode (not a surface): body = propagate preview. */
  private _propagateActive = false;
  /** Last propagate preview (drives the destructive apply). */
  private _lastPropagate: PropagatePreviewResponse | null = null;
  /** Convention catalogue (name → label/color/icon), loaded lazily to paint the propagate
   *  preview's section-header role badges — so the user sees intertitre roles ARE preserved. */
  private _roles: ConventionRole[] = [];
  private _rolesLoaded = false;

  constructor(
    root: HTMLElement,
    getConn: () => Conn | null,
    notify: (msg: string, isError?: boolean) => void,
    sheet?: HTMLElement | null,
    onResegmented?: (() => void | Promise<void>) | null,
  ) {
    this._root = root;
    this._getConn = getConn;
    this._notify = notify;
    this._sheet = sheet ?? null;
    this._onResegmented = onResegmented ?? null;
  }

  /** Build the static layout once. Idempotent. */
  mount(): void {
    if (this._root.querySelector(".prep-seg-canvas-root")) return;
    this._root.innerHTML = `
      <div class="prep-seg-canvas-root">
        <div class="prep-seg-canvas-toolbar">
          <div class="prep-seg-canvas-surface" role="tablist" aria-label="Vue de segmentation">
            <button type="button" class="prep-seg-canvas-surfbtn" data-surface="brut" role="tab" aria-selected="false">Brut</button>
            <button type="button" class="prep-seg-canvas-surfbtn active" data-surface="phrases" role="tab" aria-selected="true">Phrases</button>
            <button type="button" class="prep-seg-canvas-surfbtn" data-surface="balises" role="tab" aria-selected="false">Balises [N]</button>
            <button type="button" class="prep-seg-canvas-surfbtn" data-surface="custom" role="tab" aria-selected="false">Personnalis&#233;</button>
            <button type="button" class="prep-seg-canvas-surfbtn" data-surface="tours" role="tab" aria-selected="false" title="Grain grossier : regrouper en tours de parole (parent_n), sans re-d&#233;couper">Tours</button>
          </div>
          <button type="button" class="prep-seg-canvas-propbtn btn btn-ghost btn-sm" id="prep-seg-canvas-propagate" hidden
            title="Recouper cette traduction pour qu'elle ait le m&#234;me nombre de segments par section que sa source.">Propager la segmentation</button>
          <span class="prep-seg-canvas-hint" id="prep-seg-canvas-hint"></span>
          <div class="prep-seg-canvas-custom" id="prep-seg-canvas-custom" hidden>
            <div class="prep-seg-canvas-custom-row">
              <span class="prep-seg-canvas-custom-lbl">D&#233;coupe :</span>
              <label class="prep-seg-canvas-radio"><input type="radio" name="prep-seg-kind" value="term" checked /> Terminateurs</label>
              <label class="prep-seg-canvas-radio"><input type="radio" name="prep-seg-kind" value="words" /> Mots</label>
            </div>
            <div class="prep-seg-canvas-custom-row" id="prep-seg-canvas-term-row">
              <span class="prep-seg-canvas-custom-lbl">Terminateurs :</span>
              <label class="prep-seg-canvas-chk"><input type="checkbox" data-term=".!?" checked /> . ! ?</label>
              <label class="prep-seg-canvas-chk"><input type="checkbox" data-term=";:" /> ; :</label>
              <label class="prep-seg-canvas-chk"><input type="checkbox" data-term="&#8230;" /> &#8230;</label>
              <label class="prep-seg-canvas-chk"><input type="checkbox" id="prep-seg-uc" /> Majuscule apr&#232;s</label>
            </div>
            <div class="prep-seg-canvas-custom-row" id="prep-seg-canvas-abbrev-row">
              <span class="prep-seg-canvas-custom-lbl" title="Le filet de base (M., p., d&#233;cimales) reste toujours actif">Abr&#233;viations en plus :</span>
              <input type="text" id="prep-seg-abbrev" class="prep-seg-canvas-abbrev" placeholder="cap, p&#225;g, art&#8230;" autocomplete="off" spellcheck="false" />
            </div>
          </div>
        </div>
        <div class="prep-seg-canvas-preview" id="prep-seg-canvas-preview">
          <div class="prep-seg-canvas-empty">S&#233;lectionnez un document.</div>
        </div>
      </div>
    `;

    this._root.querySelectorAll<HTMLButtonElement>(".prep-seg-canvas-surfbtn").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        this._setSurface(btn.dataset.surface as SegSurface);
      });
    });
    this._root.querySelector<HTMLButtonElement>("#prep-seg-canvas-propagate")
      ?.addEventListener("click", () => void this._runPropagate());

    // Personnalisé (R5.4b-2) controls → _custom, then a debounced live preview.
    this._root.querySelectorAll<HTMLInputElement>('input[name="prep-seg-kind"]').forEach((r) => {
      r.addEventListener("change", () => {
        this._custom.wordMode =
          this._root.querySelector<HTMLInputElement>('input[name="prep-seg-kind"]:checked')?.value === "words";
        this._syncCustomEnabled();
        this._schedulePreview();
      });
    });
    this._root.querySelectorAll<HTMLInputElement>("[data-term]").forEach((cb) => {
      cb.addEventListener("change", () => { this._readTerminators(); this._schedulePreview(); });
    });
    this._root.querySelector<HTMLInputElement>("#prep-seg-uc")?.addEventListener("change", (e) => {
      this._custom.requireUppercase = (e.target as HTMLInputElement).checked;
      this._schedulePreview();
    });
    this._root.querySelector<HTMLInputElement>("#prep-seg-abbrev")?.addEventListener("input", (e) => {
      this._custom.abbreviations = parseAbbreviations((e.target as HTMLInputElement).value);
      this._schedulePreview();
    });

    // The summary + Apply live in the shared canvas sheet (sticky bottom, R5.3) if one is
    // provided, so they stay reachable without scrolling back up. Else in-pane.
    this._applyBarEl = document.createElement("div");
    this._applyBarEl.className = "prep-seg-canvas-applybar";
    (this._sheet ?? this._root).appendChild(this._applyBarEl);

    this._syncHint();
  }

  /** Point the pane at a document; renders the active view (Brut = current units,
   *  else the live segmentation preview). */
  async setDocument(docId: number | null, lang: string | null, textStartN: number | null = null): Promise<void> {
    this.mount();
    this._docId = docId;
    this._lang = lang;
    this._textStartN = textStartN;
    this._lastPreview = null;
    this._propagateActive = false; // a doc switch/reload leaves the transient propagate mode
    this._lastPropagate = null;
    this._units = [];
    this._splitEditingN = null; // a stale inline split editor must not survive a reload/doc switch
    this._splitDraft = null;
    this._textEditingN = null; // nor a stale stylo editor
    this._textDraft = null;
    this._previewToken++; // invalidate any in-flight preview from the previous document
    if (this._previewTimer) { clearTimeout(this._previewTimer); this._previewTimer = null; } // and any scheduled one
    // Pre-fill the Personnalisé abbreviations from the doc's language pack — only on an actual
    // document change, so switching layers back to Segmentation doesn't wipe the user's edits.
    if (docId !== this._prefillDoc) {
      this._prefillDoc = docId;
      this._custom.abbreviations = defaultAbbreviations(lang);
      const abbrevInput = this._root.querySelector<HTMLInputElement>("#prep-seg-abbrev");
      if (abbrevInput) abbrevInput.value = this._custom.abbreviations.join(", ");
    }
    if (docId === null) {
      this._sourceDocId = null;
      this._togglePropagateBtn();
      this._renderEmpty("Sélectionnez un document.");
      this._renderApplyBar();
      return;
    }
    await this._loadUnits();
    await this._refreshSource(); // derive the family source → show/hide the propagate action
    await this._renderActiveView();
  }

  /** Public deep-link (Explorer→Prep, retrait Seg tranche 5): reveal unit `n` in the Brut view
   *  (scroll + flash). Switches to Brut — the surface that lists units by n — then renders so
   *  `_consumePendingFocus` scrolls to it. Handles the "already on Brut" case (where `_setSurface`
   *  early-returns) by re-rendering directly. */
  async focusUnit(n: number): Promise<void> {
    this._pendingFocusN = n;
    if (this._surface !== "brut") this._setSurface("brut");
    else await this._renderBrutView();
  }

  /** Load the current line units (for the Brut view). Mode switches don't change them,
   *  so this is per-document, not per-preview. */
  private async _loadUnits(): Promise<void> {
    const conn = this._getConn();
    const docId = this._docId;
    if (!conn || docId === null) return;
    try {
      const units = await listUnits(conn, docId);
      if (docId !== this._docId) return; // document switched during the await — drop stale units
      this._units = units.map((u) => ({
        n: u.n, unitId: u.unit_id, text: u.text_norm ?? u.text_raw ?? "", isLine: u.unit_type === "line",
        role: u.unit_role ?? null, textRaw: u.text_raw ?? "", textSource: u.text_source ?? null,
        parentN: u.parent_n ?? null,
      }));
    } catch {
      if (docId === this._docId) this._units = [];
    }
  }

  /** Render whichever view the active surface calls for: Brut shows the current units
   *  (no segmentation, no Apply); the other surfaces run the live preview. */
  private async _renderActiveView(): Promise<void> {
    if (this._surface === "brut") {
      this._lastPreview = null;
      await this._renderBrutView();
      return;
    }
    if (this._surface === "tours") {
      this._lastPreview = null;
      void this._renderToursView();
      return;
    }
    await this._runPreview();
  }

  /** Canvas switched away from the Segmentation layer: retract our sheet contribution (R5.3). */
  deactivate(): void {
    const bar = this._applyBarEl;
    if (bar) { bar.classList.remove("visible"); bar.innerHTML = ""; }
  }

  dispose(): void {
    if (this._previewTimer) { clearTimeout(this._previewTimer); this._previewTimer = null; }
    this._docId = null;
    this._lastPreview = null;
  }

  // ─── Surface ──────────────────────────────────────────────────────────────

  private _setSurface(s: SegSurface): void {
    // A surface click also leaves the transient propagate mode (even for the current surface).
    if (s === this._surface && !this._propagateActive) return;
    this._propagateActive = false;
    this._lastPropagate = null;
    this._root.querySelector<HTMLElement>("#prep-seg-canvas-propagate")?.classList.remove("active");
    this._surface = s;
    // Cancel a debounced preview scheduled by the previous surface — otherwise a pending
    // Personnalisé preview could fire after switching to Brut and overwrite its view.
    if (this._previewTimer) { clearTimeout(this._previewTimer); this._previewTimer = null; }
    this._root.querySelectorAll<HTMLButtonElement>(".prep-seg-canvas-surfbtn").forEach((b) => {
      const on = b.dataset.surface === s;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", String(on));
    });
    this._syncHint();
    const customPanel = this._root.querySelector<HTMLElement>("#prep-seg-canvas-custom");
    if (customPanel) customPanel.hidden = s !== "custom";
    if (s === "brut") {
      this._previewToken++; // cancel any in-flight preview render
      this._lastPreview = null;
      void this._renderBrutView();
    } else if (s === "tours") {
      this._previewToken++;
      this._lastPreview = null;
      void this._renderToursView();
    } else {
      this._schedulePreview();
    }
  }

  /** Read the checked terminator boxes into _custom.terminators (order = DOM order). */
  private _readTerminators(): void {
    const chunks: string[] = [];
    this._root.querySelectorAll<HTMLInputElement>("[data-term]").forEach((cb) => {
      if (cb.checked && cb.dataset.term) chunks.push(cb.dataset.term);
    });
    this._custom.terminators = chunks;
  }

  /** Grey out the terminator + abbreviation rows when "Mots" is chosen (they don't apply). */
  private _syncCustomEnabled(): void {
    const dim = this._custom.wordMode;
    ["#prep-seg-canvas-term-row", "#prep-seg-canvas-abbrev-row"].forEach((sel) => {
      const row = this._root.querySelector<HTMLElement>(sel);
      if (!row) return;
      row.classList.toggle("prep-seg-canvas-row-dim", dim);
      row.querySelectorAll<HTMLInputElement>("input").forEach((i) => { i.disabled = dim; });
    });
  }

  // ─── Brut view: read current units · flag anomalies · edit (merge/split) ─────

  /** Render the Brut view, refreshing Mode A undo eligibility first (one cheap GET). */
  private async _renderBrutView(): Promise<void> {
    const conn = this._getConn();
    if (conn) await this._ensureRoles(conn); // catalogue for the Brut role badges (tranche 3)
    await this._refreshUndoElig();
    if (this._surface !== "brut") return; // a fast surface switch during the await supersedes us
    this._renderBrut();
    this._renderApplyBar(); // Brut has no preview → the sheet apply bar hides itself
  }

  /** Fetch Mode A undo eligibility for the current doc (best-effort; drives the button). */
  private async _refreshUndoElig(): Promise<void> {
    const conn = this._getConn();
    const docId = this._docId;
    if (!conn || docId === null) { this._undoElig = null; return; }
    try {
      const elig = await prepUndoEligibility(conn, docId);
      if (docId === this._docId) this._undoElig = elig;
    } catch {
      if (docId === this._docId) this._undoElig = null;
    }
  }

  /** Brut view: the current units in full (nothing truncated — this tab exists to read the
   *  raw text), with anomaly filters and per-unit merge/split editing (R5.4b-3). No Apply —
   *  Brut is the current state, not a transform; edits mutate units directly. */
  private _renderBrut(): void {
    const el = this._root.querySelector<HTMLElement>("#prep-seg-canvas-preview");
    if (!el) return;
    if (!this._units.length) {
      this._renderEmpty("Aucune unité de texte dans ce document.");
      return;
    }
    const view = computeAnomalyView(
      this._units.map((u) => ({ text: u.text, isLine: u.isLine })),
      { short: this._filterShort, orphan: this._filterOrphan },
      this._lang,
    );
    const rows = this._units.map((u, i) => this._brutRowHtml(u, i, view)).join("");
    setHtml(el, raw(`${this._brutBarHtml(view)}<div class="prep-seg-canvas-units">${rows}</div>`));
    this._wireBrut(el);
    this._consumePendingFocus(el);
  }

  /** Anomaly filter bar (short / orphan chips) + the Mode A undo button. */
  private _brutBarHtml(view: AnomalyView): string {
    return `<div class="prep-seg-canvas-anom">
      <label class="prep-seg-canvas-anom-cb">
        <input type="checkbox" id="prep-seg-canvas-f-short"${this._filterShort ? " checked" : ""} />
        Segments courts <span class="prep-seg-canvas-anom-chip prep-seg-canvas-anom-chip--short">${view.shortCount}</span>
      </label>
      <label class="prep-seg-canvas-anom-cb">
        <input type="checkbox" id="prep-seg-canvas-f-orphan"${this._filterOrphan ? " checked" : ""} />
        Ponctuation orpheline <span class="prep-seg-canvas-anom-chip prep-seg-canvas-anom-chip--orphan">${view.orphanCount}</span>
      </label>
      ${this._undoBtnHtml()}
    </div>`;
  }

  private _undoBtnHtml(): string {
    const elig = this._undoElig;
    const disabled = isUndoDisabled(elig ?? undefined);
    const label = elig ? formatUndoActionLabel(elig) : "↶ Annuler";
    const title = elig ? formatUndoTooltip(elig) : "";
    return `<button type="button" class="btn btn-ghost btn-sm prep-seg-canvas-undo" id="prep-seg-canvas-undo"${disabled ? " disabled" : ""} title="${esc(title)}">${esc(label)}</button>`;
  }

  /** Repaint the undo button in place, keeping its listener. Brut re-renders its whole bar on
   *  every change; Tours only re-renders its ¶ list, so the button needs this cheap sync. */
  private _syncUndoBtn(): void {
    const btn = this._root.querySelector<HTMLButtonElement>("#prep-seg-canvas-undo");
    if (!btn) return;
    const elig = this._undoElig;
    btn.disabled = isUndoDisabled(elig ?? undefined);
    btn.textContent = elig ? formatUndoActionLabel(elig) : "↶ Annuler";
    btn.title = elig ? formatUndoTooltip(elig) : "";
  }

  /** One Brut unit: number + edit actions (line units only) + text, decorated per anomaly.
   *  When this unit is being split, render the inline split editor in its place. */
  private _brutRowHtml(
    u: { n: number; text: string; isLine: boolean; role: string | null; textRaw: string; textSource: string | null },
    i: number, view: AnomalyView,
  ): string {
    if (this._splitEditingN === u.n && u.isLine) return this._splitEditorHtml(u);
    if (this._textEditingN === u.n && u.isLine) return this._textEditorHtml(u);
    const row = view.rows[i];
    const clsMod = row.cls ? ` prep-seg-canvas-unit--${row.cls}` : "";
    const hidden = row.visible ? "" : " hidden";
    const tag = u.isLine
      ? this._rowActionsHtml(u, i)
      : `<span class="prep-seg-canvas-unit-struct" title="Unit&#233; de structure &#8212; non segmentable">structure</span>`;
    // Tranche 3 — parity with SegmentationView: role badge · rich text (verbatim text_raw) ·
    // « voir l'original d'import » fold when a destructive op rewrote the line (ADR-043 P3).
    const badge = this._roleBadgeHtml(u.role);
    const body = richTextToHtml(u.textRaw, u.text);
    const fold = hasImportOriginal({ text_raw: u.textRaw, text_source: u.textSource })
      ? `<details class="prep-seg-canvas-source"><summary class="prep-seg-canvas-source-sum" title="Texte tel qu'import&#233;, avant red&#233;coupage / fusion">&#8982;&#160;voir l'original d'import</summary><div class="prep-seg-canvas-source-txt">${richTextToHtml(u.textSource, u.textSource ?? "")}</div></details>`
      : "";
    return `<div class="prep-seg-canvas-unit${clsMod}" data-n="${u.n}"${hidden}>
        <div class="prep-seg-canvas-unit-head"><span class="prep-seg-canvas-unit-n">unit&#233; ${esc(String(u.n))}</span>${tag}</div>
        <div class="prep-seg-canvas-unit-text">${badge}<span class="prep-seg-canvas-seg-text">${body}</span>${fold}</div>
      </div>`;
  }

  /** Merge-up / merge-down (only between two adjacent line units) + split. */
  private _rowActionsHtml(u: { n: number }, i: number): string {
    const prev = this._units[i - 1];
    const next = this._units[i + 1];
    const up = prev && prev.isLine
      ? `<button type="button" class="prep-seg-canvas-uabtn" data-act="merge-up" data-n="${u.n}" title="Fusionner avec le pr&#233;c&#233;dent">&#8679;</button>`
      : "";
    const down = next && next.isLine
      ? `<button type="button" class="prep-seg-canvas-uabtn" data-act="merge-down" data-n="${u.n}" title="Fusionner avec le suivant">&#8681;</button>`
      : "";
    const split = `<button type="button" class="prep-seg-canvas-uabtn" data-act="split" data-n="${u.n}" title="Couper ce segment">&#9986;</button>`;
    const edit = `<button type="button" class="prep-seg-canvas-uabtn" data-act="edit-text" data-n="${u.n}" title="Corriger le texte de ce segment">&#9998;</button>`;
    return `<span class="prep-seg-canvas-unit-actions">${edit}${up}${down}${split}</span>`;
  }

  /** Inline split editor: two editable halves pre-filled by the auto-split heuristic (or the
   *  user's in-progress draft, so a re-render — e.g. a filter toggle — doesn't wipe their edits). */
  private _splitEditorHtml(u: { n: number; text: string }): string {
    const { a, b } = this._splitDraft ?? autoSplitText(u.text);
    return `<div class="prep-seg-canvas-unit prep-seg-canvas-unit--editing" data-n="${u.n}">
        <div class="prep-seg-canvas-unit-head"><span class="prep-seg-canvas-unit-n">Couper l&#8217;unit&#233; ${esc(String(u.n))}</span></div>
        <div class="prep-seg-canvas-split">
          <textarea class="prep-seg-canvas-split-ta" data-half="a" rows="2">${esc(a)}</textarea>
          <textarea class="prep-seg-canvas-split-ta" data-half="b" rows="2">${esc(b)}</textarea>
          <div class="prep-seg-canvas-split-actions">
            <button type="button" class="btn btn-primary btn-sm" data-act="split-confirm" data-n="${u.n}">Confirmer la coupure</button>
            <button type="button" class="btn btn-ghost btn-sm" data-act="split-cancel">Annuler</button>
          </div>
        </div>
      </div>`;
  }

  /** Inline stylo editor: a single textarea seeded from the unit's text_norm (or the user's
   *  in-progress draft, so a re-render — e.g. a filter toggle — doesn't wipe it). Persists via
   *  updateUnitTextNorm (β, edits text_norm, keeps text_raw). Reuses the split editor's shell. */
  private _textEditorHtml(u: { n: number; text: string }): string {
    const val = this._textDraft ?? u.text;
    return `<div class="prep-seg-canvas-unit prep-seg-canvas-unit--editing" data-n="${u.n}">
        <div class="prep-seg-canvas-unit-head"><span class="prep-seg-canvas-unit-n">Corriger l&#8217;unit&#233; ${esc(String(u.n))}</span></div>
        <div class="prep-seg-canvas-split">
          <textarea class="prep-seg-canvas-edit-ta" rows="2">${esc(val)}</textarea>
          <div class="prep-seg-canvas-split-actions">
            <button type="button" class="btn btn-primary btn-sm" data-act="edit-text-confirm" data-n="${u.n}">Enregistrer</button>
            <button type="button" class="btn btn-ghost btn-sm" data-act="edit-text-cancel">Annuler</button>
          </div>
        </div>
      </div>`;
  }

  private _wireBrut(el: HTMLElement): void {
    el.querySelector<HTMLInputElement>("#prep-seg-canvas-f-short")?.addEventListener("change", (e) => {
      this._filterShort = (e.target as HTMLInputElement).checked;
      this._renderBrut();
    });
    el.querySelector<HTMLInputElement>("#prep-seg-canvas-f-orphan")?.addEventListener("change", (e) => {
      this._filterOrphan = (e.target as HTMLInputElement).checked;
      this._renderBrut();
    });
    el.querySelector<HTMLButtonElement>("#prep-seg-canvas-undo")?.addEventListener("click", () => void this._undo());
    el.querySelectorAll<HTMLButtonElement>(".prep-seg-canvas-unit [data-act]").forEach((btn) => {
      btn.addEventListener("click", () => this._onRowAction(btn.dataset.act ?? "", btn));
    });
    // Keep the split draft in sync so a re-render (filter toggle) restores the typed halves.
    el.querySelectorAll<HTMLTextAreaElement>(".prep-seg-canvas-split-ta").forEach((ta) => {
      ta.addEventListener("input", () => {
        const a = el.querySelector<HTMLTextAreaElement>('.prep-seg-canvas-split-ta[data-half="a"]')?.value ?? "";
        const b = el.querySelector<HTMLTextAreaElement>('.prep-seg-canvas-split-ta[data-half="b"]')?.value ?? "";
        this._splitDraft = { a, b };
      });
    });
    // Stylo editor: keep the draft in sync (survive a filter-toggle re-render), Ctrl+Entrée to
    // save / Échap to cancel, and focus on open.
    const editTa = el.querySelector<HTMLTextAreaElement>(".prep-seg-canvas-edit-ta");
    if (editTa) {
      editTa.addEventListener("input", () => { this._textDraft = editTa.value; });
      editTa.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          if (this._textEditingN !== null) void this._confirmTextEdit(this._textEditingN);
        } else if (e.key === "Escape") {
          e.preventDefault();
          this._textEditingN = null; this._textDraft = null; this._renderBrut();
        }
      });
      editTa.focus();
      editTa.setSelectionRange(editTa.value.length, editTa.value.length);
    }
  }

  /** Scroll to + briefly flash the unit touched by the last merge/split (consumed once). */
  private _consumePendingFocus(el: HTMLElement): void {
    const n = this._pendingFocusN;
    this._pendingFocusN = null;
    if (n === null) return;
    const target = el.querySelector<HTMLElement>(`.prep-seg-canvas-unit[data-n="${n}"]`);
    if (!target) return;
    target.scrollIntoView({ block: "center" });
    target.classList.add("prep-seg-canvas-unit--flash");
    setTimeout(() => target.classList.remove("prep-seg-canvas-unit--flash"), 800);
  }

  private _onRowAction(act: string, btn: HTMLElement): void {
    const n = Number(btn.dataset.n);
    if (act === "merge-up") void this._merge(n, "up");
    else if (act === "merge-down") void this._merge(n, "down");
    else if (act === "split") { this._splitEditingN = n; this._splitDraft = null; this._textEditingN = null; this._renderBrut(); }
    else if (act === "split-cancel") { this._splitEditingN = null; this._splitDraft = null; this._renderBrut(); }
    else if (act === "split-confirm") void this._confirmSplit(n);
    else if (act === "edit-text") { this._textEditingN = n; this._textDraft = null; this._splitEditingN = null; this._renderBrut(); }
    else if (act === "edit-text-cancel") { this._textEditingN = null; this._textDraft = null; this._renderBrut(); }
    else if (act === "edit-text-confirm") void this._confirmTextEdit(n);
  }

  /** Merge unit n with its previous ("up") or next ("down") neighbour — both must be adjacent
   *  line units (the sidecar requires n2 == n1+1). Destructive (clears the two units' alignment);
   *  recoverable via the undo button, and the host reload keeps the state strip honest.
   *
   *  « Recoverable » became true for the ALIGNMENT only with migration 035 (ALI-03): before it,
   *  undo returned the units and dropped their links for good. Now that the promise holds, the
   *  gesture reports what it cost — see alignmentLossNote for why after and not before. */
  private async _merge(n: number, dir: "up" | "down"): Promise<void> {
    const conn = this._getConn();
    if (!conn || this._docId === null || this._busy) return;
    const idx = this._units.findIndex((u) => u.n === n);
    if (idx < 0) return;
    const other = dir === "up" ? this._units[idx - 1] : this._units[idx + 1];
    if (!other || !other.isLine) return;
    const n1 = dir === "up" ? other.n : n;
    const n2 = dir === "up" ? n : other.n;
    this._busy = true;
    try {
      const res = await mergeUnits(conn, { doc_id: this._docId, n1, n2 });
      // Say what was destroyed, exactly, instead of confirming a loss we can't size
      // beforehand (audit §11.16). Silent when the two units carried no link.
      const note = alignmentLossNote(res.links_archived);
      if (note) this._notify(`Fusion effectuée —${note}`);
      this._pendingFocusN = n1; // the surviving unit keeps n1
      await this._onResegmented?.();
    } catch (e) {
      this._notify(e instanceof Error ? e.message : String(e), true);
    } finally {
      this._busy = false;
    }
  }

  private async _confirmSplit(n: number): Promise<void> {
    const conn = this._getConn();
    if (!conn || this._docId === null || this._busy) return;
    const box = this._root.querySelector<HTMLElement>(`.prep-seg-canvas-unit--editing[data-n="${n}"]`);
    const textA = box?.querySelector<HTMLTextAreaElement>('[data-half="a"]')?.value.trim() ?? "";
    const textB = box?.querySelector<HTMLTextAreaElement>('[data-half="b"]')?.value.trim() ?? "";
    if (!textA || !textB) { this._notify("Les deux parties doivent être non-vides.", true); return; }
    this._busy = true;
    try {
      const res = await splitUnit(
        conn, { doc_id: this._docId, unit_n: n, text_a: textA, text_b: textB });
      const note = alignmentLossNote(res.links_archived);
      if (note) this._notify(`Scission effectuée —${note}`);
      this._splitEditingN = null;
      this._splitDraft = null;
      this._pendingFocusN = n; // the first half keeps n
      await this._onResegmented?.();
    } catch (e) {
      this._notify(e instanceof Error ? e.message : String(e), true);
    } finally {
      this._busy = false;
    }
  }

  /** Persist a stylo correction on unit n (β immediate, edits text_norm, keeps text_raw).
   *  Non-structural, so — unlike merge/split — it patches the unit locally and refreshes the
   *  Mode-A undo button (this edit is undoable) rather than reloading the whole document. */
  private async _confirmTextEdit(n: number): Promise<void> {
    const conn = this._getConn();
    if (!conn || this._docId === null || this._busy) return;
    const u = this._units.find((x) => x.n === n);
    if (!u) return;
    const box = this._root.querySelector<HTMLElement>(`.prep-seg-canvas-unit--editing[data-n="${n}"]`);
    const newText = box?.querySelector<HTMLTextAreaElement>(".prep-seg-canvas-edit-ta")?.value ?? "";
    if (newText === u.text) { this._textEditingN = null; this._textDraft = null; this._renderBrut(); return; } // no-op
    this._busy = true;
    try {
      const res = await updateUnitTextNorm(conn, u.unitId, newText);
      u.text = res.text_norm; // β edits text_norm; reflect it, keep provenance from the response
      u.textRaw = res.text_raw;
      // D-1 — si cette phrase etait coupee entre plusieurs segments source, la correction
      // vient de dissoudre la coupe : les bornes indexaient la chaine qu'on reecrit.
      const cut = cutDissolvedNote(res.cut_spans_cleared);
      if (cut) this._notify(`Texte corrige.${cut}`);
      this._textEditingN = null;
      this._textDraft = null;
      await this._refreshUndoElig(); // the edit recorded an undoable Mode-A action
      this._renderBrut();
    } catch (e) {
      this._notify(e instanceof Error ? e.message : String(e), true);
    } finally {
      this._busy = false;
    }
  }

  private async _undo(): Promise<void> {
    const conn = this._getConn();
    if (!conn || this._docId === null || this._busy) return;
    this._busy = true;
    try {
      const res = await prepUndo(conn, this._docId);
      const nn = res.units_restored;
      this._notify(`↶ Annulation : ${res.reverted_action_type} — ${nn} unité${nn > 1 ? "s" : ""} restaurée${nn > 1 ? "s" : ""}${formatUndoLinkSuffix(res)}.`);
      await this._onResegmented?.();
      if (this._surface === "tours") {
        // The screen-level reload rebuilds the canvas, not this pane's ¶ list — repaint it
        // here so an undo triggered from Tours is visible where it was asked for.
        await this._loadUnits();
        await this._refreshUndoElig();
        this._renderToursList();
        this._syncUndoBtn();
      }
    } catch (e) {
      this._notify(e instanceof Error ? e.message : String(e), true);
    } finally {
      this._busy = false;
    }
  }

  private _syncHint(): void {
    const el = this._root.querySelector<HTMLElement>("#prep-seg-canvas-hint");
    if (el) el.textContent = surfaceHint(this._surface);
  }

  // ─── Preview ──────────────────────────────────────────────────────────────

  private _schedulePreview(): void {
    if (this._previewTimer) clearTimeout(this._previewTimer);
    this._previewTimer = setTimeout(() => void this._runPreview(), 180);
  }

  private async _runPreview(): Promise<void> {
    const conn = this._getConn();
    if (!conn || this._docId === null || this._surface === "brut" || this._surface === "tours") return; // these have their own render path
    const token = ++this._previewToken;
    const previewEl = this._root.querySelector<HTMLElement>("#prep-seg-canvas-preview");
    if (previewEl) setHtml(previewEl, raw(`<div class="prep-seg-canvas-empty">Calcul de l&#8217;aper&#231;u&#8230;</div>`));
    const params = buildSegmentParams(this._surface, this._custom);
    try {
      const resp = await segmentPreview(conn, { doc_id: this._docId, lang: this._lang ?? "und", ...params });
      if (token !== this._previewToken) return; // a newer preview superseded this one
      this._lastPreview = resp;
      this._renderPreview(resp);
    } catch (e) {
      if (token !== this._previewToken) return;
      this._lastPreview = null;
      this._renderEmpty(`Erreur : ${e instanceof Error ? e.message : String(e)}`, true);
    }
    this._renderApplyBar();
  }

  private _renderPreview(resp: SegmentPreviewResponse): void {
    const el = this._root.querySelector<HTMLElement>("#prep-seg-canvas-preview");
    if (!el) return;
    if (!resp.segments.length) {
      this._renderEmpty("Aucun segment — document vide ou non segmentable.");
      return;
    }
    const warns = resp.warnings.length
      ? `<div class="prep-seg-canvas-warns">${resp.warnings
          .map((w) => `<div class="prep-seg-canvas-warn">&#9888; ${esc(w)}</div>`)
          .join("")}</div>`
      : "";
    const groups = groupSegmentsBySource(resp.segments);
    const groupsHtml = groups
      .map((g) => {
        const segs = g.segments
          .map((s) => {
            const badge = s.external_id != null
              ? `<span class="prep-seg-canvas-extid">[${esc(String(s.external_id))}]</span>`
              : "";
            return `<div class="prep-seg-canvas-seg">${badge}<span class="prep-seg-canvas-seg-text">${esc(s.text)}</span></div>`;
          })
          .join("");
        const n = g.segments.length;
        return `<div class="prep-seg-canvas-group">
            <div class="prep-seg-canvas-group-head">unit&#233; ${esc(String(g.source_unit_n))} &#183; ${n} segment${n > 1 ? "s" : ""}</div>
            ${segs}
          </div>`;
      })
      .join("");
    setHtml(el, raw(warns + groupsHtml));
  }

  private _renderEmpty(msg: string, isError = false): void {
    const el = this._root.querySelector<HTMLElement>("#prep-seg-canvas-preview");
    if (el) {
      setHtml(el, raw(
        `<div class="prep-seg-canvas-empty${isError ? " prep-seg-canvas-error" : ""}">${esc(msg)}</div>`,
      ));
    }
  }

  // ─── Apply bar (in the fixed sheet) ───────────────────────────────────────

  private _renderApplyBar(): void {
    const bar = this._applyBarEl;
    if (!bar) return;
    const resp = this._lastPreview;
    if (!resp || this._docId === null) {
      bar.classList.remove("visible");
      bar.innerHTML = "";
      return;
    }
    bar.classList.add("visible");
    setHtml(bar, raw(`
      <span class="prep-seg-canvas-summary">${esc(segmentSummaryLine(resp.units_input, resp.units_output))}</span>
      <button type="button" class="btn btn-primary btn-sm" id="prep-seg-canvas-apply">Appliquer la segmentation</button>
    `));
    bar.querySelector("#prep-seg-canvas-apply")?.addEventListener("click", () => void this._apply());
  }

  private async _apply(): Promise<void> {
    const conn = this._getConn();
    if (!conn || this._docId === null || this._busy) return;

    // Fresh alignment signal → confirm only when there is an alignment to lose
    // (garde-fou conditionnel). Stats unavailable → best-effort treat as none.
    let alignedCount = 0;
    try {
      alignedCount = (await getDocumentStats(conn, this._docId)).aligned_count;
    } catch { /* ignore — no confirm */ }
    if (needsAlignmentConfirm(alignedCount)) {
      const ok = await modalConfirm({
        message: `Ce document a ${alignedCount} lien${alignedCount > 1 ? "s" : ""} d’alignement. Resegmenter les effacera. Continuer ?`,
        confirmLabel: "Resegmenter",
        danger: true,
      });
      if (!ok) return;
    }

    this._busy = true;
    const btn = this._applyBarEl?.querySelector<HTMLButtonElement>("#prep-seg-canvas-apply");
    if (btn) { btn.disabled = true; btn.textContent = "Application…"; }
    const params = buildSegmentParams(this._surface, this._custom);
    try {
      const resp = await segment(conn, { doc_id: this._docId, lang: this._lang ?? "und", ...params });
      this._notify(`Segmentation appliquée — ${segmentSummaryLine(resp.units_input, resp.units_output)}.`);
      // Host reloads: re-fetch docs + re-focus → stats/bandeau/couches à jour, fts_stale remonté.
      // The re-focus re-enters setDocument here and rebuilds the preview + apply bar.
      await this._onResegmented?.();
    } catch (e) {
      this._notify(e instanceof Error ? e.message : String(e), true);
      if (btn) { btn.disabled = false; btn.textContent = "Appliquer la segmentation"; }
    } finally {
      this._busy = false;
    }
  }

  // ─── Tours: manual paragraph boundaries (non-destructive parent_n relabel, R6) ──
  //
  // The surface is a live, editable list of the doc's segments with the coarse ¶ column to
  // the LEFT of the text (¶ | seg | texte), mirroring the alignment matrix. Clicking a
  // segment's ¶ toggles a paragraph boundary there (immediate persist, per /segment/
  // paragraph_boundary, undoable Mode A). The dialogue-dash / regex boundary survives as a
  // one-click « Pré-remplir » that bootstraps the grouping (/segment/coarse), then editable
  // by hand. R5.4c preview-then-apply flow retired (retrait Segmentation lineage).

  /** Render the Tours surface, refreshing Mode A undo eligibility first (one cheap GET) —
   *  same shape as _renderBrutView, so the undo button is accurate on arrival. */
  private async _renderToursView(): Promise<void> {
    await this._refreshUndoElig();
    if (this._surface !== "tours") return; // a fast surface switch during the await supersedes us
    this._renderTours();
  }

  /** Build the Tours surface: the pré-remplir control above the editable ¶ list. */
  private _renderTours(): void {
    const el = this._root.querySelector<HTMLElement>("#prep-seg-canvas-preview");
    if (!el) return;
    setHtml(el, raw(`${this._toursCtrlHtml()}<div class="prep-seg-canvas-units prep-seg-canvas-tours-list" id="prep-seg-canvas-tours-list"></div>`));
    this._wireToursCtrl(el);
    this._renderToursList();
    // Manual list persists per click — the sheet apply bar is not used on this surface.
    const bar = this._applyBarEl;
    if (bar) { bar.classList.remove("visible"); bar.innerHTML = ""; }
  }

  private _toursCtrlHtml(): string {
    return `<div class="prep-seg-canvas-tours-ctrl">
      <p class="prep-seg-canvas-tours-hint">Cliquez le n&#176; de paragraphe (&#182;) d'un segment pour ouvrir un paragraphe ici — le bloc pr&#233;c&#233;dent est regroup&#233; et la suite absorb&#233;e ; recliquez un d&#233;but de &#182; pour le fusionner.</p>
      <div class="prep-seg-canvas-tours-prefill">
        <label class="prep-seg-canvas-tours-lbl">Pr&#233;-remplir par motif (optionnel)
          <input type="text" id="prep-seg-canvas-tours-pat" class="prep-seg-canvas-abbrev" value="${esc(this._toursPattern)}" placeholder="d&#233;faut : tiret de dialogue — ; ex. ^[A-Z]+ :" autocomplete="off" spellcheck="false" />
        </label>
        <button type="button" class="btn btn-ghost btn-sm" id="prep-seg-canvas-tours-prefill" title="Regrouper d'un coup selon ce motif (tours de parole) — modifiable ensuite à la main">Pr&#233;-remplir</button>
        ${this._undoBtnHtml()}
      </div>
    </div>`;
  }

  private _wireToursCtrl(el: HTMLElement): void {
    const inp = el.querySelector<HTMLInputElement>("#prep-seg-canvas-tours-pat");
    inp?.addEventListener("input", () => { this._toursPattern = inp.value; });
    el.querySelector<HTMLButtonElement>("#prep-seg-canvas-tours-prefill")
      ?.addEventListener("click", () => void this._prefillTours());
    // QA-06: both gestures of this surface are undoable (¶ toggle and « Pré-remplir »), so the
    // button belongs here too — it used to live only on the Brut bar, forcing a tab change to
    // undo what was just done here. Same document-scoped semantics as Brut (the engine's undo
    // is strictly linear); the label names the action, so it never undoes something unnamed.
    el.querySelector<HTMLButtonElement>("#prep-seg-canvas-undo")
      ?.addEventListener("click", () => void this._undo());
    // Delegated ¶ toggle: the listener sits on the persistent list host, so a re-render of
    // its rows (after a toggle / pré-remplir) does not detach it.
    const list = el.querySelector<HTMLElement>("#prep-seg-canvas-tours-list");
    list?.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".prep-seg-canvas-para-btn");
      if (btn) void this._onToursParaToggle(Number(btn.dataset.paraUnit));
    });
  }

  /** Sequential ¶ number + boundary flag + 1-based segment position for each text-scope line
   *  unit (a distinct parent_n anchor opens a new paragraph — same rule as the matrix ¶ column).
   *  Excluded (carry no ¶, hence no toggle): paratext (n < text_start_n), structure units, and
   *  intertitre-role lines — the engine treats the last two as section walls and rejects a
   *  toggle on them, so they must not offer one. STRUCTURAL_ROLES mirrors coarse_grain.py. */
  private _toursParaByN(): Map<number, { num: number; start: boolean; seg: number }> {
    const out = new Map<number, { num: number; start: boolean; seg: number }>();
    let para = 0;
    let seg = 0;
    let prevAnchor: number | null = null;
    for (const u of this._units) {
      if (!u.isLine) continue;
      if (this._textStartN != null && u.n < this._textStartN) continue;
      if (u.role != null && STRUCTURAL_ROLES.has(u.role)) continue; // intertitre = section wall
      seg++;
      const anchor = u.parentN ?? u.n;
      const start = anchor !== prevAnchor;
      if (start) para++;
      prevAnchor = anchor;
      out.set(u.n, { num: para, start, seg });
    }
    return out;
  }

  /** Re-render only the list rows (the pré-remplir control keeps its focus/value). */
  private _renderToursList(): void {
    const host = this._root.querySelector<HTMLElement>("#prep-seg-canvas-tours-list");
    if (!host) return;
    if (!this._units.length) {
      setHtml(host, raw(`<div class="prep-seg-canvas-empty">Aucune unité de texte dans ce document.</div>`));
      return;
    }
    const para = this._toursParaByN();
    const rows = this._units.map((u) => this._toursRowHtml(u, para.get(u.n) ?? null)).join("");
    setHtml(host, raw(rows));
  }

  private _toursRowHtml(
    u: { text: string; unitId: number },
    info: { num: number; start: boolean; seg: number } | null,
  ): string {
    if (!info) {
      // Paratext or a structure unit — shown for context, no ¶/seg, not toggleable.
      return `<div class="prep-seg-canvas-tours-row prep-seg-canvas-tours-row--mute">`
        + `<span class="prep-seg-canvas-tours-para"></span>`
        + `<span class="prep-seg-canvas-tours-seg"></span>`
        + `<span class="prep-seg-canvas-seg-text">${esc(u.text)}</span></div>`;
    }
    const cls = "prep-seg-canvas-para-btn" + (info.start ? " prep-seg-canvas-para-btn--start" : "");
    const title = info.start
      ? "Retirer cette frontière de paragraphe (fusionner avec le précédent)"
      : "Commencer un nouveau paragraphe à ce segment";
    return `<div class="prep-seg-canvas-tours-row${info.start ? " prep-seg-canvas-tours-row--start" : ""}">`
      + `<span class="prep-seg-canvas-tours-para"><button type="button" class="${cls}" data-para-unit="${u.unitId}" title="${title}">${info.num}${info.start ? " &#182;" : ""}</button></span>`
      + `<span class="prep-seg-canvas-tours-seg">${info.seg}</span>`
      + `<span class="prep-seg-canvas-seg-text">${esc(u.text)}</span></div>`;
  }

  /** Toggle a paragraph boundary at one segment (designate / remove). Non-destructive; the
   *  local reload re-projects the ¶ column (sequential numbers) without leaving the list. */
  private async _onToursParaToggle(unitId: number): Promise<void> {
    const conn = this._getConn();
    if (!conn || this._docId === null || this._busy) return;
    this._busy = true;
    try {
      await setParagraphBoundary(conn, this._docId, unitId);
      await this._loadUnits();       // re-fetch parent_n
      await this._refreshUndoElig(); // the toggle is undoable — reflect it
      this._renderToursList();
      this._syncUndoBtn();           // QA-06: the ¶ list re-render leaves the ctrl bar alone
    } catch (e) {
      this._notify(e instanceof Error ? e.message : String(e), true);
    } finally {
      this._busy = false;
    }
  }

  /** Bootstrap the coarse grouping from the dialogue-dash / custom regex boundary (one shot),
   *  then leave it editable by hand. Non-destructive (alignment kept). The pattern is sent RAW
   *  — the engine compiles it untrimmed, so a trailing space is significant. */
  private async _prefillTours(): Promise<void> {
    const conn = this._getConn();
    if (!conn || this._docId === null || this._busy) return;
    this._busy = true;
    const btn = this._root.querySelector<HTMLButtonElement>("#prep-seg-canvas-tours-prefill");
    if (btn) { btn.disabled = true; btn.textContent = "Regroupement…"; }
    const hasPattern = this._toursPattern.trim().length > 0;
    try {
      const resp = await regroupCoarse(
        conn,
        hasPattern
          ? { doc_id: this._docId, pattern: this._toursPattern }
          : { doc_id: this._docId, preset: "tours" },
      );
      const nn = resp.units_changed;
      this._notify(`Pré-rempli : ${resp.blocks} tour${resp.blocks > 1 ? "s" : ""} — ${nn} unité${nn > 1 ? "s" : ""} modifiée${nn > 1 ? "s" : ""}.`);
      await this._loadUnits();
      await this._refreshUndoElig();
      this._renderToursList();
      this._syncUndoBtn();
    } catch (e) {
      this._notify(e instanceof Error ? e.message : String(e), true);
    } finally {
      this._busy = false;
      if (btn) { btn.disabled = false; btn.textContent = "Pré-remplir"; }
    }
  }

  // ─── Propager la segmentation (famille-pilotée, front-pur — DESIGN_segmentation_retirement) ──

  /** Derive this doc's source (its `translation_of` target) and show/hide the propagate action.
   *  Front-pure: the "family" logic is just resolving the relation, no engine change. Best-effort. */
  private async _refreshSource(): Promise<void> {
    const conn = this._getConn();
    const docId = this._docId;
    this._sourceDocId = null;
    if (conn && docId !== null) {
      try {
        const rel = await getDocRelations(conn, docId);
        if (docId !== this._docId) return; // document switched during the await
        const src = rel.relations.find((r) => r.relation_type === "translation_of");
        this._sourceDocId = src ? src.target_doc_id : null;
      } catch { /* no declared source → no propagate action */ }
    }
    this._togglePropagateBtn();
  }

  private _togglePropagateBtn(): void {
    const btn = this._root.querySelector<HTMLButtonElement>("#prep-seg-canvas-propagate");
    if (btn) btn.hidden = this._sourceDocId === null;
  }

  /** Load the convention catalogue once (best-effort) for the propagate preview badges. */
  private async _ensureRoles(conn: Conn): Promise<void> {
    if (this._rolesLoaded) return;
    try {
      this._roles = (await listConventions(conn)) ?? [];
    } catch {
      this._roles = [];
    }
    this._rolesLoaded = true;
  }

  /** A role badge for a section header, styled like the Rôles layer (colour + icon + label).
   *  Unknown role → a neutral badge with the raw name (never hide a role that IS preserved). */
  private _roleBadgeHtml(roleName: string | null): string {
    if (!roleName) return "";
    const b = resolveRoleBadge(roleName, this._roles);
    const label = b ? b.label : roleName;
    const color = safeColor(b ? b.color : "#374151", "#374151");
    const icon = b && b.icon ? esc(b.icon) + " " : "";
    return `<span class="prep-conv-unit-badge prep-seg-canvas-prop-role" `
      + `style="background:${color}22;border-color:${color};color:${color}">`
      + `${icon}${esc(label)}</span>`;
  }

  /** Enter the transient propagate mode: fetch the positional propagate preview (target recut to
   *  the source's segment count per section) and render it read-only + an Apply in the sheet. */
  private async _runPropagate(): Promise<void> {
    const conn = this._getConn();
    const docId = this._docId;
    const refId = this._sourceDocId;
    if (!conn || docId === null || refId === null) return;
    this._propagateActive = true;
    this._lastPreview = null;
    this._previewToken++; // cancel any in-flight surface preview
    this._root.querySelectorAll<HTMLButtonElement>(".prep-seg-canvas-surfbtn").forEach((b) => {
      b.classList.remove("active");
      b.setAttribute("aria-selected", "false");
    });
    this._root.querySelector<HTMLElement>("#prep-seg-canvas-propagate")?.classList.add("active");
    const el = this._root.querySelector<HTMLElement>("#prep-seg-canvas-preview");
    if (el) setHtml(el, raw(`<div class="prep-seg-canvas-empty">Calcul de la propagation&#8230;</div>`));
    try {
      const [res] = await Promise.all([
        segmentPropagatePreview(conn, {
          doc_id: docId, reference_doc_id: refId, lang: this._lang ?? "und",
        }),
        this._ensureRoles(conn), // catalogue for the section-header role badges
      ]);
      if (docId !== this._docId || !this._propagateActive) return; // stale (doc switch / left the mode)
      this._lastPropagate = res;
      this._renderPropagate(res);
    } catch (e) {
      if (docId !== this._docId || !this._propagateActive) return;
      this._lastPropagate = null;
      this._renderEmpty(`Erreur : ${e instanceof Error ? e.message : String(e)}`, true);
    }
    this._renderPropagateApplyBar();
  }

  /** Read-only, section-by-section: header, source-vs-result count (delta), warnings, segments.
   *  Fine tweaks are NOT here — the user resegments via Brut merge/split after applying. */
  private _renderPropagate(res: PropagatePreviewResponse): void {
    const el = this._root.querySelector<HTMLElement>("#prep-seg-canvas-preview");
    if (!el) return;
    const warns = res.warnings.length
      ? `<div class="prep-seg-canvas-warns">${res.warnings
          .map((w) => `<div class="prep-seg-canvas-warn">&#9888; ${esc(w)}</div>`)
          .join("")}</div>`
      : "";
    const sections = res.sections
      .map((s) => {
        const header = s.header_text != null
          ? `<span class="prep-seg-canvas-seg-text">${esc(s.header_text)}</span>`
          : `<em>avant le premier intertitre</em>`;
        // Show the intertitre's role badge — it IS preserved on apply, so surfacing it
        // reassures the user their roles survive the (line-only) recut.
        const badge = s.header_text != null ? this._roleBadgeHtml(s.header_role) : "";
        const count = s.delta === 0
          ? `<span class="prep-seg-canvas-prop-ok">${s.result_count} = source</span>`
          : `<span class="prep-seg-canvas-prop-delta" title="Écart avec la source">${s.result_count} vs ${s.ref_count} (${s.delta > 0 ? "+" : ""}${s.delta})</span>`;
        const segs = s.segments.length
          ? s.segments
              .map((seg) => `<div class="prep-seg-canvas-seg"><span class="prep-seg-canvas-seg-text">${esc(seg.text)}</span></div>`)
              .join("")
          : `<div class="prep-seg-canvas-seg prep-seg-canvas-empty">Aucun segment.</div>`;
        return `<div class="prep-seg-canvas-group">
            <div class="prep-seg-canvas-group-head prep-seg-canvas-prop-head">${header}${badge} &#183; ${count}</div>
            ${segs}
          </div>`;
      })
      .join("");
    setHtml(el, raw(warns + sections));
  }

  private _renderPropagateApplyBar(): void {
    const bar = this._applyBarEl;
    if (!bar) return;
    const res = this._lastPropagate;
    if (!res || this._docId === null) {
      bar.classList.remove("visible");
      bar.innerHTML = "";
      return;
    }
    const t = res.total_segments;
    bar.classList.add("visible");
    setHtml(bar, raw(`
      <span class="prep-seg-canvas-summary">${t} segment${t > 1 ? "s" : ""} propagé${t > 1 ? "s" : ""} depuis la source</span>
      <button type="button" class="btn prep-btn-warning btn-sm" id="prep-seg-canvas-prop-apply">Appliquer la propagation</button>
    `));
    bar.querySelector("#prep-seg-canvas-prop-apply")?.addEventListener("click", () => void this._applyPropagate());
  }

  /** Write the propagated segmentation (apply_propagated). Destructive (clears alignment) → confirm
   *  only when there is an alignment to lose; on success the host reloads. */
  private async _applyPropagate(): Promise<void> {
    const conn = this._getConn();
    const res = this._lastPropagate;
    if (!conn || this._docId === null || this._busy || !res) return;

    let alignedCount = 0;
    try {
      alignedCount = (await getDocumentStats(conn, this._docId)).aligned_count;
    } catch { /* ignore — no confirm */ }
    if (needsAlignmentConfirm(alignedCount)) {
      const ok = await modalConfirm({
        message: `Ce document a ${alignedCount} lien${alignedCount > 1 ? "s" : ""} d’alignement. Propager la segmentation les effacera. Continuer ?`,
        confirmLabel: "Propager",
        danger: true,
      });
      if (!ok) return;
    }

    // Flatten sections → units: each section's boundary header — PRESERVING its original
    // unit_type (a structural-role line stays a line + role; a structure unit stays structure).
    // No line→structure conversion: that would drop the intertitre from FTS/alignment, and the
    // canonical intertitre in this model is a line carrying the role (docx_paragraphs). Then the
    // section's recut line segments, in order.
    const units: ApplyPropagatedUnit[] = [];
    for (const s of res.sections) {
      if (s.header_text && s.header_text.trim()) {
        const htype = s.header_unit_type === "line" ? "line" : "structure";
        units.push(s.header_role
          ? { type: htype, text: s.header_text, role: s.header_role }
          : { type: htype, text: s.header_text });
      }
      for (const seg of s.segments) {
        if (seg.text.trim()) units.push({ type: "line", text: seg.text });
      }
    }
    if (!units.length) { this._notify("Rien à propager.", true); return; }

    this._busy = true;
    const btn = this._applyBarEl?.querySelector<HTMLButtonElement>("#prep-seg-canvas-prop-apply");
    if (btn) { btn.disabled = true; btn.textContent = "Application…"; }
    try {
      const r = await applyPropagated(conn, this._docId, units);
      this._notify(`Segmentation propagée — ${r.units_written} unité${r.units_written > 1 ? "s" : ""} écrite${r.units_written > 1 ? "s" : ""}.`);
      await this._onResegmented?.();
    } catch (e) {
      this._notify(e instanceof Error ? e.message : String(e), true);
      if (btn) { btn.disabled = false; btn.textContent = "Appliquer la propagation"; }
    } finally {
      this._busy = false;
    }
  }
}
