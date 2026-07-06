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

import type { Conn, SegmentPreviewResponse, PrepUndoEligibilityResponse } from "../lib/sidecarClient.ts";
import {
  segmentPreview, segment, getDocumentStats, listUnits,
  mergeUnits, splitUnit, prepUndo, prepUndoEligibility,
} from "../lib/sidecarClient.ts";
import { escHtml as esc } from "../lib/diff.ts";
import { setHtml, raw } from "../lib/safeHtml.ts";
import { modalConfirm } from "../lib/modalConfirm.ts";
import {
  buildSegmentParams,
  groupSegmentsBySource,
  segmentSummaryLine,
  needsAlignmentConfirm,
  surfaceHint,
  defaultAbbreviations,
  parseAbbreviations,
  autoSplitText,
  type SegSurface,
  type CustomSpecState,
} from "../lib/segmentControls.ts";
import { computeAnomalyView, type AnomalyView } from "../lib/segmentAnomalies.ts";
import { formatUndoActionLabel, formatUndoTooltip, isUndoDisabled } from "../lib/prepUndo.ts";

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
  /** Current units (n + text + line-vs-structure) — rendered as-is by the "Brut" tab so the
   *  user can compare the current state against a proposed segmentation by switching tabs,
   *  flag anomalies, and edit (merge/split) line units in place (R5.4b-3). */
  private _units: { n: number; text: string; isLine: boolean }[] = [];
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
  /** Unit n to scroll to + flash once after a merge/split reload, or null. */
  private _pendingFocusN: number | null = null;
  /** Last Mode A undo eligibility for this doc — drives the Brut "↶ Annuler" button. */
  private _undoElig: PrepUndoEligibilityResponse | null = null;

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
          </div>
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
  async setDocument(docId: number | null, lang: string | null): Promise<void> {
    this.mount();
    this._docId = docId;
    this._lang = lang;
    this._lastPreview = null;
    this._units = [];
    this._splitEditingN = null; // a stale inline split editor must not survive a reload/doc switch
    this._splitDraft = null;
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
      this._renderEmpty("Sélectionnez un document.");
      this._renderApplyBar();
      return;
    }
    await this._loadUnits();
    await this._renderActiveView();
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
        n: u.n, text: u.text_norm ?? u.text_raw ?? "", isLine: u.unit_type === "line",
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
    if (s === this._surface) return;
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

  /** One Brut unit: number + edit actions (line units only) + text, decorated per anomaly.
   *  When this unit is being split, render the inline split editor in its place. */
  private _brutRowHtml(u: { n: number; text: string; isLine: boolean }, i: number, view: AnomalyView): string {
    if (this._splitEditingN === u.n && u.isLine) return this._splitEditorHtml(u);
    const row = view.rows[i];
    const clsMod = row.cls ? ` prep-seg-canvas-unit--${row.cls}` : "";
    const hidden = row.visible ? "" : " hidden";
    const tag = u.isLine
      ? this._rowActionsHtml(u, i)
      : `<span class="prep-seg-canvas-unit-struct" title="Unit&#233; de structure &#8212; non segmentable">structure</span>`;
    return `<div class="prep-seg-canvas-unit${clsMod}" data-n="${u.n}"${hidden}>
        <div class="prep-seg-canvas-unit-head"><span class="prep-seg-canvas-unit-n">unit&#233; ${esc(String(u.n))}</span>${tag}</div>
        <div class="prep-seg-canvas-unit-text"><span class="prep-seg-canvas-seg-text">${esc(u.text)}</span></div>
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
    return `<span class="prep-seg-canvas-unit-actions">${up}${down}${split}</span>`;
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
    else if (act === "split") { this._splitEditingN = n; this._splitDraft = null; this._renderBrut(); }
    else if (act === "split-cancel") { this._splitEditingN = null; this._splitDraft = null; this._renderBrut(); }
    else if (act === "split-confirm") void this._confirmSplit(n);
  }

  /** Merge unit n with its previous ("up") or next ("down") neighbour — both must be adjacent
   *  line units (the sidecar requires n2 == n1+1). Destructive (clears the two units' alignment);
   *  recoverable via the undo button, and the host reload keeps the state strip honest. */
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
      await mergeUnits(conn, { doc_id: this._docId, n1, n2 });
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
      await splitUnit(conn, { doc_id: this._docId, unit_n: n, text_a: textA, text_b: textB });
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

  private async _undo(): Promise<void> {
    const conn = this._getConn();
    if (!conn || this._docId === null || this._busy) return;
    this._busy = true;
    try {
      const res = await prepUndo(conn, this._docId);
      const nn = res.units_restored;
      this._notify(`↶ Annulation : ${res.reverted_action_type} — ${nn} unité${nn > 1 ? "s" : ""} restaurée${nn > 1 ? "s" : ""}.`);
      await this._onResegmented?.();
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
    if (!conn || this._docId === null || this._surface === "brut") return; // Brut has its own render path
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
}
