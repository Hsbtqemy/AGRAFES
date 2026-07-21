/**
 * CurationPane.ts — the "Curation" mode of the "Texte" canvas (R5.1b).
 *
 * A thin mode over the shared CanvasUnitList (R5.1a): the same unit list + role
 * badges (base decor, §9 "base persistante") with a *light* curation overlay — a
 * discreet marker on the units the selected rules would change. The full diff is
 * R5.1c; applying is R5.1d. Read-only here.
 *
 * Reuses the existing curation contract unchanged: CURATE_PRESETS +
 * curatePreview(limit_examples ≥ units_total → all changed units in examples).
 * Docs: docs/DESIGN_R5_1_curation_layer.md. DOM + wiring only; no business rules.
 */
import type { Conn, ConventionRole, CurateRule, UnitRecord } from "../lib/sidecarClient.ts";
import { escHtml as esc, highlightChanges } from "../lib/diff.ts";
import {
  listConventions, listUnits, curatePreview, curate, updateUnitTextNorm,
  listCurateExceptions, setCurateException, deleteCurateException,
} from "../lib/sidecarClient.ts";
import { CURATE_PRESETS } from "../lib/curationPresets.ts";
import { rulesSignature, fnv1a } from "../lib/curationFingerprint.ts";
import { modalConfirm } from "../lib/modalConfirm.ts";
import { setHtml, raw } from "../lib/safeHtml.ts";
import { CanvasUnitList } from "./CanvasUnitList.ts";

/** A unit's pending diff from the last preview (kept for R5.1c on-demand reveal). */
export interface CurationChange {
  before: string;
  after: string;
  /** 0-based indices into the previewed rules array — drives the rule filter (#14). */
  ruleIds?: number[];
}

// Presets offered in the dock — skip the empty "custom" placeholder and the
// deprecated "punctuation" alias (punctuation_fr/en are the live ones).
const _DOCK_PRESETS = Object.entries(CURATE_PRESETS).filter(
  ([key]) => key !== "custom" && key !== "punctuation",
);

export class CurationPane {
  private readonly _root: HTMLElement;
  private readonly _getConn: () => Conn | null;
  private readonly _onError: (msg: string) => void;

  private _roles: ConventionRole[] = [];
  private _units: UnitRecord[] = [];
  private _docId: number | null = null;
  private _textStartN: number | null = null;
  private _loaded = false;
  private _list: CanvasUnitList | null = null;

  private _selectedPresets = new Set<string>();
  /** unit_id → diff from the last preview; drives the discreet marker (decorateRow). */
  private _changed = new Map<number, CurationChange>();
  private _stats: { units_changed: number; units_total: number } | null = null;
  /** R5.1c — diff on demand: units whose full diff is revealed inline. */
  private _expanded = new Set<number>();
  /** R5.1c — global "show all diffs" toggle for a review pass. */
  private _showAllDiffs = false;
  /** R6.5-B Lot A — unit_id → persistent curation exception. Loaded independently of
   *  the preview: an `ignore` unit is suppressed from preview `examples` by design
   *  (sidecar `_handle_curate_preview`), so the preview can't be the source of truth for
   *  badges/undo — `listCurateExceptions` is. Honored server-side by `/curate` (priorities
   *  1 & 3 in curation.py). */
  private _exceptions = new Map<number, { kind: "ignore" | "override"; override_text: string | null }>();
  /** R6.5-B Lot B — unit_ids the reviewer has marked "relu" (a changed unit they've looked
   *  at and let the rule apply). Pure review progress: no effect on /curate. Persisted per
   *  doc (D2) under a canvas-specific key, guarded by the rule signature + a per-unit `before`
   *  hash so a rule change or a stylo edit between sessions drops the now-stale marker. */
  private _relu = new Set<number>();
  /** R6.5-B Lot B — review filters (#2 status, #14 by-rule). Purely a view over the changed
   *  set; no effect on preview/apply. `_ruleFilter` holds a preset *label*; `_ruleLabels` maps
   *  each previewed rule index → its preset label (built at preview time). */
  private _statusFilter: "all" | "todo" | "relu" | "ignore" | "override" = "all";
  private _ruleFilter: string | null = null;
  private _ruleLabels: string[] = [];

  constructor(root: HTMLElement, getConn: () => Conn | null, onError: (msg: string) => void) {
    this._root = root;
    this._getConn = getConn;
    this._onError = onError;
  }

  /** Build the static layout once. Idempotent. */
  mount(): void {
    if (this._root.querySelector(".prep-cur-root")) return;
    const presetsHtml = _DOCK_PRESETS
      .map(([key, p]) =>
        `<label class="prep-cur-preset"><input type="checkbox" data-preset="${esc(key)}" /> ${esc(p.label)}</label>`)
      .join("");
    // presetsHtml is built from esc()'d preset keys/labels → vouched safe via raw().
    setHtml(this._root, raw(`
      <div class="prep-cur-root">
        <div class="prep-cur-toolbar">
          <input type="search" class="prep-conv-search prep-cur-search" id="prep-cur-search"
            placeholder="Rechercher des unit&#233;s&#8230;" autocomplete="off" />
          <span class="prep-conv-search-stats" id="prep-cur-search-stats"></span>
        </div>
        <div class="prep-cur-dock" role="group" aria-label="R&#232;gles de curation">
          <div class="prep-cur-presets">${presetsHtml}</div>
          <button type="button" class="btn btn-secondary btn-sm" id="prep-cur-preview-btn"
            title="Aper&#231;u des unit&#233;s que ces r&#232;gles modifieraient (sans &#233;crire)">Aper&#231;u</button>
          <button type="button" class="btn btn-ghost btn-sm" id="prep-cur-toggle-all"
            title="Afficher / masquer le diff complet de toutes les unit&#233;s modifi&#233;es">Afficher tous les diffs</button>
          <button type="button" class="btn prep-btn-warning btn-sm" id="prep-cur-apply-btn" disabled
            title="Appliquer la curation au document (r&#233;&#233;crit le texte de recherche ; l'original est conserv&#233;)">Appliquer</button>
          <span class="prep-cur-summary" id="prep-cur-summary" aria-live="polite"></span>
        </div>
        <div class="prep-cur-review-bar" id="prep-cur-review-bar" role="group" aria-label="Filtres de revue"></div>
        <div class="prep-conv-units-area prep-cur-units" id="prep-cur-units">
          <div class="prep-conv-empty">S&#233;lectionnez un document.</div>
        </div>
      </div>
    `));

    this._root.querySelectorAll<HTMLInputElement>("input[data-preset]").forEach((cb) => {
      cb.addEventListener("change", () => {
        const key = cb.dataset.preset!;
        if (cb.checked) this._selectedPresets.add(key);
        else this._selectedPresets.delete(key);
        // Changing the rule set makes the last preview stale (its marks/count no longer
        // reflect the selected rules). Invalidate it so the summary, the Apply gate and the
        // Apply confirm-count stay truthful (revue adverse Lot 1). Staged overrides survive.
        this._invalidatePreview();
      });
    });
    this._q("#prep-cur-preview-btn")?.addEventListener("click", () => void this._runPreview());
    this._q("#prep-cur-toggle-all")?.addEventListener("click", () => {
      this._showAllDiffs = !this._showAllDiffs;
      this._renderToggleAll();
      this._list?.render();
    });
    this._q("#prep-cur-apply-btn")?.addEventListener("click", () => void this._apply());

    const area = this._q<HTMLElement>("#prep-cur-units");
    if (area) {
      this._list = new CanvasUnitList(area, {
        // Light overlay (§9 D2): a discreet marker on the units the rules would change,
        // + on-demand full diff (per-unit toggle or the global "show all diffs", R5.1c).
        decorateRow: (u, el) => this._decorateRow(u, el),
        // Stylo: in-place text correction (β immediate, DESIGN_inline_text_correction.md).
        onEditText: (uid, textNorm) => this._saveText(uid, textNorm),
        // Review filters (#2 status / #14 by-rule) hide non-matching units.
        rowFilter: (u) => this._rowVisible(u),
        onStats: (t) => {
          const s = this._q("#prep-cur-search-stats");
          if (s) s.textContent = t;
        },
      });
    }

    const searchEl = this._q<HTMLInputElement>("#prep-cur-search");
    searchEl?.addEventListener("input", () => this._list?.setSearch(searchEl.value));
  }

  async setDocument(docId: number | null, textStartN: number | null): Promise<void> {
    this.mount();
    this._docId = docId;
    this._textStartN = textStartN;
    // A new document invalidates any prior preview + its revealed diffs + staged edits (F1).
    this._changed.clear();
    this._stats = null;
    this._expanded.clear();
    this._showAllDiffs = false;
    this._exceptions.clear();
    this._relu.clear();
    this._statusFilter = "all";
    this._ruleFilter = null;
    this._ruleLabels = [];
    this._renderSummary();
    this._renderReviewBar();
    this._renderToggleAll();
    this._renderApplyBtn();
    this._list?.setData({ docId, textStartN });
    this._list?.clearSelectionQuiet();
    if (!this._loaded) await this._loadRoles();
    // Only load exceptions + re-render when the units loaded — otherwise the final render
    // would clobber the error message _loadUnits left in the area (regression guard).
    if (await this._loadUnits()) {
      await this._loadExceptions(); // badges + Rétablir; independent of any preview
      this._renderSummary();
      this._renderReviewBar();
      this._list?.render();
    }
  }

  dispose(): void {
    this._roles = [];
    this._units = [];
    this._changed.clear();
    this._stats = null;
    this._expanded.clear();
    this._showAllDiffs = false;
    this._exceptions.clear();
    this._relu.clear();
    this._statusFilter = "all";
    this._ruleFilter = null;
    this._ruleLabels = [];
    this._list?.reset();
    this._docId = null;
    this._loaded = false;
  }

  // ─── Loading ────────────────────────────────────────────────────────────

  private async _loadRoles(): Promise<void> {
    const conn = this._getConn();
    if (!conn) { this._roles = []; return; }
    try {
      this._roles = await listConventions(conn);
      this._loaded = true;
    } catch {
      this._roles = [];
    }
    this._list?.setData({ roles: this._roles });
  }

  /** Returns false only when the units failed to load (an error message is left in the
   *  area) — the caller must then NOT re-render, or it would clobber that message. */
  private async _loadUnits(): Promise<boolean> {
    const area = this._q("#prep-cur-units");
    const conn = this._getConn();
    if (this._docId === null || !conn) {
      this._units = [];
      this._list?.setData({ units: [], roles: this._roles, docId: this._docId, textStartN: this._textStartN });
      this._list?.render();
      return true; // valid empty state, safe to re-render
    }
    if (area) area.innerHTML = `<div class="prep-conv-empty">Chargement&#8230;</div>`;
    try {
      this._units = await listUnits(conn, this._docId);
    } catch (e) {
      if (area) {
        area.innerHTML = `<div class="prep-conv-empty prep-conv-error">Erreur : ${esc(
          e instanceof Error ? e.message : String(e),
        )}</div>`;
      }
      this._units = [];
      return false; // preserve the error message — the caller skips its re-render
    }
    this._list?.setData({ units: this._units, roles: this._roles, docId: this._docId, textStartN: this._textStartN });
    this._list?.render();
    return true;
  }

  /** Load the doc's persistent curation exceptions (R6.5-B Lot A). Independent of the
   *  preview — the source of truth for the 🔒/🔒✏ badges + Rétablir. Non-fatal on error. */
  private async _loadExceptions(): Promise<void> {
    this._exceptions.clear();
    const conn = this._getConn();
    if (this._docId === null || !conn) return;
    try {
      const res = await listCurateExceptions(conn, this._docId);
      for (const e of res.exceptions) {
        this._exceptions.set(e.unit_id, { kind: e.kind, override_text: e.override_text });
      }
    } catch {
      // No exceptions shown; the rest of the pane still works.
    }
  }

  // ─── Preview (read-only) ────────────────────────────────────────────────

  /** The rules of the currently-checked presets, in dock order, with a parallel array of the
   *  preset *label* each rule came from (drives the by-rule filter chips, #14). */
  private _rulesWithLabels(): { rules: CurateRule[]; labels: string[] } {
    const rules: CurateRule[] = [];
    const labels: string[] = [];
    for (const [key, p] of _DOCK_PRESETS) {
      if (this._selectedPresets.has(key)) {
        for (const r of p.rules) { rules.push(r); labels.push(p.label); }
      }
    }
    return { rules, labels };
  }

  private _currentRules(): CurateRule[] {
    return this._rulesWithLabels().rules;
  }

  private async _runPreview(): Promise<void> {
    const conn = this._getConn();
    if (!conn || this._docId === null) {
      this._onError("Sélectionnez un document avant l'aperçu.");
      return;
    }
    const { rules, labels } = this._rulesWithLabels();
    if (rules.length === 0) {
      this._onError("Sélectionnez au moins un jeu de règles.");
      return;
    }
    const btn = this._q<HTMLButtonElement>("#prep-cur-preview-btn");
    if (btn) { btn.disabled = true; btn.textContent = "Aperçu…"; }
    try {
      // limit_examples ≥ unit count → every changed unit lands in `examples`, so the
      // marker set is exhaustive (R5.1b). No writes.
      const res = await curatePreview(conn, {
        doc_id: this._docId,
        rules,
        limit_examples: Math.max(this._units.length, 1),
      });
      this._changed = new Map(res.examples.map((e) => [e.unit_id, { before: e.before, after: e.after, ruleIds: e.matched_rule_ids }]));
      this._stats = { units_changed: res.stats.units_changed, units_total: res.stats.units_total };
      this._ruleLabels = labels; // rule index → preset label, for the by-rule filter
      this._expanded.clear(); // a fresh preview clears any per-unit reveals from the last run
      this._statusFilter = "all"; // a fresh preview resets the review filters
      this._ruleFilter = null;
      this._reconcileRelu(rules); // restore persisted "relu" markers still valid for this preview
      this._renderSummary();
      this._renderReviewBar();
      this._renderApplyBtn(); // enable Apply iff the preview found changes
      this._list?.render(); // decorateRow marks the changed rows
    } catch (e) {
      this._onError(e instanceof Error ? e.message : String(e));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Aperçu"; }
    }
  }

  /** Drop a now-stale preview (marks + stats + revealed diffs) after the rule set changed.
   *  Keeps staged overrides (preview-independent). No-op if there is no preview. */
  private _invalidatePreview(): void {
    if (this._stats === null && this._changed.size === 0) return;
    this._changed.clear();
    this._stats = null;
    this._expanded.clear();
    this._showAllDiffs = false;
    this._relu.clear(); // the changed set is gone; a fresh preview re-reconciles from storage
    this._ruleLabels = [];
    this._statusFilter = "all";
    this._ruleFilter = null;
    this._renderToggleAll();
    this._renderSummary();
    this._renderReviewBar();
    this._renderApplyBtn();
    this._list?.render();
  }

  // ─── Revue : marqueur « relu » persistant (R6.5-B Lot B, D2) ───────────────

  private _reluKey(): string {
    // Canvas-specific key: the legacy CurationView writes statuses/overrides under
    // `agrafes.prep.curate.review.<docId>`; a distinct key avoids clobbering while both coexist.
    return `agrafes.prep.curate.review.canvas.${this._docId}`;
  }

  private _readReluBlob(): { rulesSignature: string; relu: Record<number, string> } | null {
    try {
      const raw = localStorage.getItem(this._reluKey());
      if (!raw) return null;
      const b = JSON.parse(raw);
      if (b && typeof b.rulesSignature === "string" && b.relu && typeof b.relu === "object") {
        return { rulesSignature: b.rulesSignature, relu: b.relu as Record<number, string> };
      }
    } catch {
      // Corrupt/blocked storage → treat as no saved review.
    }
    return null;
  }

  /** Restore persisted "relu" markers valid for the current preview: same rule signature AND
   *  the unit's `before` still hashes to the stored value (else a stylo edit made it stale). */
  private _reconcileRelu(rules: CurateRule[]): void {
    this._relu.clear();
    if (this._docId === null) return;
    const stored = this._readReluBlob();
    if (!stored || stored.rulesSignature !== rulesSignature(rules)) return;
    for (const [uid, change] of this._changed) {
      const h = stored.relu[uid];
      if (h !== undefined && fnv1a(change.before) === h) this._relu.add(uid);
    }
  }

  private _persistRelu(): void {
    if (this._docId === null) return;
    const relu: Record<number, string> = {};
    for (const uid of this._relu) {
      const change = this._changed.get(uid);
      if (change) relu[uid] = fnv1a(change.before);
    }
    const blob = { version: 1, docId: this._docId, rulesSignature: rulesSignature(this._currentRules()), relu };
    try {
      localStorage.setItem(this._reluKey(), JSON.stringify(blob));
    } catch {
      // Storage full/blocked — the marker still works in-session, just not persisted.
    }
  }

  private _toggleRelu(unitId: number): void {
    if (this._relu.has(unitId)) this._relu.delete(unitId);
    else this._relu.add(unitId);
    this._persistRelu();
    this._renderSummary();
    this._renderReviewBar();
    this._list?.render();
  }

  // ─── Revue : filtres statut/règle + bulk (R6.5-B Lot B, #2/#14) ────────────

  /** The review status a unit falls under (drives filters + counts). */
  private _unitStatus(uid: number): "todo" | "relu" | "ignore" | "override" | null {
    const exc = this._exceptions.get(uid);
    if (exc) return exc.kind;
    if (this._changed.has(uid)) return this._relu.has(uid) ? "relu" : "todo";
    return null; // unchanged, no exception
  }

  /** rowFilter predicate: hide units that don't match the active status/rule filters. */
  private _rowVisible(u: UnitRecord): boolean {
    if (this._statusFilter === "all" && this._ruleFilter === null) return true;
    if (this._statusFilter !== "all" && this._unitStatus(u.unit_id) !== this._statusFilter) return false;
    if (this._ruleFilter !== null) {
      const change = this._changed.get(u.unit_id);
      // Only rule-driven changed units (not exceptions) carry a rule origin.
      if (!change || this._exceptions.has(u.unit_id)) return false;
      if (!(change.ruleIds ?? []).some((ri) => this._ruleLabels[ri] === this._ruleFilter)) return false;
    }
    return true;
  }

  private _setStatusFilter(key: "all" | "todo" | "relu" | "ignore" | "override"): void {
    this._statusFilter = key;
    this._renderReviewBar();
    this._list?.render();
  }

  private _setRuleFilter(label: string | null): void {
    this._ruleFilter = label;
    this._renderReviewBar();
    this._list?.render();
  }

  /** Mark every currently-VISIBLE to-review unit as relu (respects the active filters). */
  private _bulkMarkRelu(): void {
    for (const uid of this._changed.keys()) {
      if (this._exceptions.has(uid) || this._relu.has(uid)) continue;
      const u = this._units.find((x) => x.unit_id === uid);
      if (u && this._rowVisible(u)) this._relu.add(uid);
    }
    this._persistRelu();
    this._renderSummary();
    this._renderReviewBar();
    this._list?.render();
  }

  private _renderReviewBar(): void {
    const bar = this._q("#prep-cur-review-bar");
    if (!bar) return;
    let nTodo = 0, nRelu = 0, nIgnore = 0, nOverride = 0;
    for (const uid of this._changed.keys()) {
      if (this._exceptions.has(uid)) continue;
      if (this._relu.has(uid)) nRelu++; else nTodo++;
    }
    for (const e of this._exceptions.values()) {
      if (e.kind === "ignore") nIgnore++; else nOverride++;
    }
    // Nothing to review or filter → collapse the bar.
    if (this._changed.size === 0 && this._exceptions.size === 0) { bar.innerHTML = ""; return; }

    const sChip = (key: string, label: string, count: number, always: boolean): string =>
      (count > 0 || always)
        ? `<button type="button" class="prep-cur-chip${this._statusFilter === key ? " prep-cur-chip--on" : ""}" data-sf="${key}">${esc(label)} (${count})</button>`
        : "";
    // "À revoir"/"Relues" are preview concepts: force-show them only when a preview is live
    // (else the bar, shown because exceptions exist, would carry meaningless "(0)" chips).
    const hasPreview = this._stats !== null;
    const statusChips =
      `<button type="button" class="prep-cur-chip${this._statusFilter === "all" ? " prep-cur-chip--on" : ""}" data-sf="all">Tout</button>` +
      sChip("todo", "À revoir", nTodo, hasPreview) +
      sChip("relu", "Relues", nRelu, hasPreview) +
      sChip("ignore", "Ignorées", nIgnore, false) +
      sChip("override", "Épinglées", nOverride, false);

    // By-rule chips: distinct preset labels among the rule-driven changed units.
    const ruleCounts = new Map<string, number>();
    for (const [uid, change] of this._changed) {
      if (this._exceptions.has(uid)) continue;
      const seen = new Set<string>();
      for (const ri of change.ruleIds ?? []) {
        const lbl = this._ruleLabels[ri];
        if (lbl && !seen.has(lbl)) { seen.add(lbl); ruleCounts.set(lbl, (ruleCounts.get(lbl) ?? 0) + 1); }
      }
    }
    const ruleChips = ruleCounts.size > 1
      ? `<span class="prep-cur-chip-sep"></span>` +
        (this._ruleFilter !== null ? `<button type="button" class="prep-cur-chip" data-rf="">toutes règles</button>` : "") +
        Array.from(ruleCounts.entries())
          .map(([lbl, n]) => `<button type="button" class="prep-cur-chip${this._ruleFilter === lbl ? " prep-cur-chip--on" : ""}" data-rf="${esc(lbl)}">${esc(lbl)} (${n})</button>`)
          .join("")
      : "";

    const bulk = nTodo > 0
      ? `<span class="prep-cur-bar-spacer"></span><button type="button" class="prep-cur-chip prep-cur-chip--bulk" id="prep-cur-bulk-relu">&#10003; Tout marquer relu</button>`
      : "";

    // Chips are built from esc()'d labels + fixed keys → vouched safe via raw().
    setHtml(bar, raw(statusChips + ruleChips + bulk));

    bar.querySelectorAll<HTMLButtonElement>("[data-sf]").forEach((b) =>
      b.addEventListener("click", () => this._setStatusFilter(b.dataset.sf as "all" | "todo" | "relu" | "ignore" | "override")));
    bar.querySelectorAll<HTMLButtonElement>("[data-rf]").forEach((b) =>
      b.addEventListener("click", () => this._setRuleFilter(b.dataset.rf || null)));
    bar.querySelector<HTMLButtonElement>("#prep-cur-bulk-relu")?.addEventListener("click", () => this._bulkMarkRelu());
  }

  private _renderSummary(): void {
    const s = this._q("#prep-cur-summary");
    if (!s) return;
    // Derived breakdown (D1): counts come from _changed (rule-driven) + _exceptions + _relu —
    // no stored status. "à curer" excludes any changed unit carrying an exception (P4): an
    // ignored unit isn't in _changed at all; an overridden one is, but it's decided.
    let nIgnore = 0, nOverride = 0;
    for (const e of this._exceptions.values()) {
      if (e.kind === "ignore") nIgnore++; else nOverride++;
    }
    let toCure = 0, relu = 0;
    for (const uid of this._changed.keys()) {
      if (this._exceptions.has(uid)) continue;
      toCure++;
      if (this._relu.has(uid)) relu++;
    }
    const excSuffix =
      (nIgnore ? ` · ${nIgnore} ignorée${nIgnore > 1 ? "s" : ""}` : "") +
      (nOverride ? ` · ${nOverride} épinglée${nOverride > 1 ? "s" : ""}` : "");
    if (!this._stats) {
      // No preview: only exception context is meaningful.
      s.textContent = excSuffix.replace(/^ · /, "");
      return;
    }
    const base = toCure === 0
      ? "Aucune unité à curer."
      : `${toCure} à curer${relu ? ` (${relu} relue${relu > 1 ? "s" : ""})` : ""} / ${this._stats.units_total}`;
    s.textContent = base + excSuffix;
  }

  private _renderToggleAll(): void {
    const b = this._q("#prep-cur-toggle-all");
    if (b) b.textContent = this._showAllDiffs ? "Masquer les diffs" : "Afficher tous les diffs";
  }

  /** True when a preview found rule changes still to apply. Drives the Apply button;
   *  a host may guard leaving on it (R5.1d). Direct text edits land immediately (stylo,
   *  β) so they are never "pending". */
  hasPendingEdits(): boolean {
    return this._stats !== null && this._stats.units_changed > 0;
  }

  private _renderApplyBtn(): void {
    const b = this._q<HTMLButtonElement>("#prep-cur-apply-btn");
    if (b) b.disabled = !this.hasPendingEdits();
  }

  /** Persist the previewed curation to the document (R5.1d). Destructive (rewrites
   *  text_norm; text_raw is kept) → confirm first. */
  private async _apply(): Promise<void> {
    const conn = this._getConn();
    if (!conn || this._docId === null || !this.hasPendingEdits()) return;
    const rules = this._currentRules();
    if (rules.length === 0) return;
    const ruleN = this._stats?.units_changed ?? 0;
    const msg = `Appliquer la curation à ${ruleN} unité${ruleN > 1 ? "s" : ""} ? Le texte de recherche sera réécrit (l'original est conservé).`;
    const ok = await modalConfirm({ message: msg, confirmLabel: "Appliquer", danger: true });
    if (!ok) return;
    const btn = this._q<HTMLButtonElement>("#prep-cur-apply-btn");
    if (btn) { btn.disabled = true; btn.textContent = "Application…"; }
    try {
      const res = await curate(conn, { doc_id: this._docId, rules });
      // Applied → the preview is consumed; reload the (now-rewritten) units.
      this._changed.clear();
      this._expanded.clear();
      this._showAllDiffs = false;
      this._stats = null;
      this._relu.clear(); // markers belonged to the consumed preview
      this._ruleLabels = [];
      this._statusFilter = "all";
      this._ruleFilter = null;
      await this._loadUnits(); // fresh text, markers gone
      const s = this._q("#prep-cur-summary");
      if (s) {
        const m = res.units_modified;
        s.textContent = `Curation appliquée : ${m} unité${m > 1 ? "s" : ""} modifiée${m > 1 ? "s" : ""}`
          + (res.fts_stale ? " · réindexez pour la recherche." : ".");
      }
      this._renderReviewBar();
      this._renderToggleAll();
    } catch (e) {
      this._onError(e instanceof Error ? e.message : String(e));
    } finally {
      if (btn) btn.textContent = "Appliquer";
      this._renderApplyBtn();
    }
  }

  /** decorateRow hook — R5.1b marker + R5.1c on-demand diff + R6.5-B Lot A per-unit
   *  exceptions. Text editing itself is the transversal stylo, owned by CanvasUnitList
   *  (onEditText → _saveText). */
  private _decorateRow(u: UnitRecord, el: HTMLElement): void {
    // Exception state wins over the "would be curated" marker: an ignored/pinned unit is
    // no longer a pending rule change. Badge + Rétablir are always shown (even when the
    // unit is outside the current changed set — an ignored unit is not in _changed at all).
    const exc = this._exceptions.get(u.unit_id);
    if (exc) {
      el.classList.add(exc.kind === "ignore" ? "prep-conv-unit-row--exc-ignore" : "prep-conv-unit-row--exc-override");
      const badge = document.createElement("span");
      badge.className = "prep-cur-exc-badge";
      badge.textContent = exc.kind === "ignore" ? "🔒 ignorée" : "🔒✏ épinglée";
      badge.title = exc.kind === "ignore"
        ? "La curation ne touche pas cette unité (texte original conservé)."
        : "Texte verrouillé contre toute règle de curation future.";
      const restore = document.createElement("button");
      restore.type = "button";
      restore.className = "prep-cur-exc-btn";
      restore.textContent = "Rétablir";
      restore.title = "Retirer l'exception (la curation s'applique à nouveau à cette unité).";
      restore.addEventListener("click", (e) => { e.stopPropagation(); void this._deleteException(u.unit_id); });
      el.append(badge, restore);
      return;
    }

    const change = this._changed.get(u.unit_id);
    if (!change) return;
    el.classList.add("prep-conv-unit-row--curated");
    if (this._relu.has(u.unit_id)) el.classList.add("prep-conv-unit-row--relu");

    // R6.5-B Lot B — "relu" toggle: mark a changed unit as reviewed (pure progress, no effect
    // on /curate). Persisted per doc (D2).
    const relued = this._relu.has(u.unit_id);
    const reluBtn = document.createElement("button");
    reluBtn.type = "button";
    reluBtn.className = "prep-cur-relu-btn" + (relued ? " prep-cur-relu-btn--on" : "");
    reluBtn.textContent = relued ? "✓ relu" : "relu ?";
    reluBtn.title = relued ? "Relue — cliquer pour annuler." : "Marquer cette unité comme relue.";
    reluBtn.addEventListener("click", (e) => { e.stopPropagation(); this._toggleRelu(u.unit_id); });

    // R5.1c diff toggle — reveal the full diff of a changed unit on demand.
    const open = this._showAllDiffs || this._expanded.has(u.unit_id);
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "prep-cur-diff-toggle";
    toggle.textContent = open ? "▾ diff" : "▸ diff";
    toggle.title = "Afficher / masquer le diff de cette unité";
    toggle.addEventListener("click", (e) => {
      e.stopPropagation(); // don't toggle the base row's selection
      if (this._expanded.has(u.unit_id)) this._expanded.delete(u.unit_id);
      else this._expanded.add(u.unit_id);
      this._list?.render();
    });
    el.appendChild(toggle);
    el.appendChild(reluBtn);

    // R6.5-B Lot A — the one inline review action on a changed row: Ignorer (rule skips this
    // unit, original text kept). "Épingler" (override) was dropped as redundant on the canvas
    // (2026-07-21): the stylo now owns "custom text", and Ignorer covers "protect from the rule"
    // — override's only distinct behaviour (force-revert a drifted text) has no trigger here.
    // Existing override exceptions are still rendered (badge + Rétablir, above) for parity with
    // legacy/admin data; the Avancé panel (Lot E) remains the place to create one if ever needed.
    const ignore = document.createElement("button");
    ignore.type = "button";
    ignore.className = "prep-cur-exc-btn";
    ignore.textContent = "Ignorer";
    ignore.title = "Ne pas curer cette unité : garder le texte original.";
    ignore.addEventListener("click", (e) => { e.stopPropagation(); void this._setException(u.unit_id, "ignore"); });
    el.append(ignore);

    if (open) {
      const panel = document.createElement("div");
      panel.className = "prep-cur-diff-panel";
      // Char-level diff (not word-level): the word-level pass splits on \s+ and *drops* all
      // whitespace, so a spaces-only change (double→single, or a regular space → non-breaking
      // space — the whole point of the FR punctuation preset) showed nothing. highlightChanges
      // preserves whitespace and renders invisibles as glyphs (renderSpecialChars). It escapes
      // its inputs and returns <mark>/<del> spans.
      setHtml(panel, raw(highlightChanges(change.before, change.after)));
      el.insertAdjacentElement("afterend", panel);
    }
  }

  // ─── Stylo: persist an in-place text correction (β immediate) ──────────────

  /** onEditText callback for CanvasUnitList: persist the correction (β) then drop the
   *  now-stale preview mark for that unit. Throws on failure so the editor stays open. */
  private async _saveText(unitId: number, textNorm: string): Promise<void> {
    const conn = this._getConn();
    if (!conn) throw new Error("Non connecté.");
    try {
      await updateUnitTextNorm(conn, unitId, textNorm);
    } catch (e) {
      this._onError(e instanceof Error ? e.message : String(e));
      throw e;
    }
    // If this unit is pinned (override exception), keep the pin in sync with the new text.
    // Otherwise a later /curate would force the *stale* override_text (curation.py priority 1)
    // and silently revert the stylo edit — a silent loss. The stylo stays exception-agnostic
    // (transversal); the sync lives here, where the exception state is known.
    const exc = this._exceptions.get(unitId);
    if (exc?.kind === "override") {
      try {
        await setCurateException(conn, { unit_id: unitId, kind: "override", override_text: textNorm });
        this._exceptions.set(unitId, { kind: "override", override_text: textNorm });
      } catch {
        // Non-fatal: the text was saved; only the pin is stale. Surfaced nowhere to avoid
        // masking the successful edit.
      }
    }
    // The edit changed the text → any preview mark/diff for this unit is stale. Drop it
    // (and decrement the count) without rendering — CanvasUnitList re-renders after this.
    if (this._changed.delete(unitId)) {
      this._expanded.delete(unitId);
      if (this._stats) {
        this._stats = { ...this._stats, units_changed: Math.max(0, this._stats.units_changed - 1) };
      }
    }
    this._renderSummary();
    this._renderApplyBtn();
  }

  // ─── Exceptions par unité (R6.5-B Lot A) ──────────────────────────────────

  /** Set (or replace) a persistent exception on a unit and reflect it locally. Honored by
   *  `/curate` server-side (curation.py priorities 1 & 3) — no re-preview needed to be truthful. */
  private async _setException(unitId: number, kind: "ignore" | "override", overrideText?: string): Promise<void> {
    const conn = this._getConn();
    if (!conn) { this._onError("Non connecté."); return; }
    try {
      await setCurateException(conn, { unit_id: unitId, kind, override_text: overrideText });
    } catch (e) {
      this._onError(e instanceof Error ? e.message : String(e));
      return;
    }
    this._exceptions.set(unitId, { kind, override_text: overrideText ?? null });
    this._renderSummary();
    this._renderReviewBar();
    this._list?.render();
  }

  /** Remove a unit's exception (Rétablir) — the curation applies to it again. */
  private async _deleteException(unitId: number): Promise<void> {
    const conn = this._getConn();
    if (!conn) { this._onError("Non connecté."); return; }
    try {
      await deleteCurateException(conn, unitId);
    } catch (e) {
      this._onError(e instanceof Error ? e.message : String(e));
      return;
    }
    this._exceptions.delete(unitId);
    this._renderSummary();
    this._renderReviewBar();
    this._list?.render();
  }

  // ─── Utility ────────────────────────────────────────────────────────────

  private _q<T extends HTMLElement>(sel: string): T | null {
    return this._root.querySelector<T>(sel);
  }
}
