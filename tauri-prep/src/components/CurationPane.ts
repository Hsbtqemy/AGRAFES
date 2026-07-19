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
import { escHtml as esc, highlightChangesWordLevel } from "../lib/diff.ts";
import { listConventions, listUnits, curatePreview, curate } from "../lib/sidecarClient.ts";
import { CURATE_PRESETS } from "../lib/curationPresets.ts";
import { modalConfirm } from "../lib/modalConfirm.ts";
import { setHtml, raw } from "../lib/safeHtml.ts";
import { CanvasUnitList } from "./CanvasUnitList.ts";

/** A unit's pending diff from the last preview (kept for R5.1c on-demand reveal). */
export interface CurationChange {
  before: string;
  after: string;
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
  /** Lot 1 (parité gap #9) — staged manual overrides: unit_id → replacement text.
   *  Applied VERBATIM via manual_overrides→/curate (α). Preview-independent: survives a
   *  re-preview (a manual edit must persist), flushed at Apply. Covers both overriding a
   *  rule suggestion and directly editing an un-suggested unit. */
  private _overrides = new Map<number, string>();
  /** The unit whose inline editor is currently open (single editor at a time), or null. */
  private _editing: number | null = null;

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
    this._overrides.clear();
    this._editing = null;
    this._renderSummary();
    this._renderToggleAll();
    this._renderApplyBtn();
    this._list?.setData({ docId, textStartN });
    this._list?.clearSelectionQuiet();
    if (!this._loaded) await this._loadRoles();
    await this._loadUnits();
  }

  dispose(): void {
    this._roles = [];
    this._units = [];
    this._changed.clear();
    this._stats = null;
    this._expanded.clear();
    this._showAllDiffs = false;
    this._overrides.clear();
    this._editing = null;
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

  private async _loadUnits(): Promise<void> {
    const area = this._q("#prep-cur-units");
    const conn = this._getConn();
    if (this._docId === null || !conn) {
      this._units = [];
      this._list?.setData({ units: [], roles: this._roles, docId: this._docId, textStartN: this._textStartN });
      this._list?.render();
      return;
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
      return;
    }
    this._list?.setData({ units: this._units, roles: this._roles, docId: this._docId, textStartN: this._textStartN });
    this._list?.render();
  }

  // ─── Preview (read-only) ────────────────────────────────────────────────

  /** The rules of the currently-checked presets, in dock order. */
  private _currentRules(): CurateRule[] {
    const rules: CurateRule[] = [];
    for (const [key, p] of _DOCK_PRESETS) {
      if (this._selectedPresets.has(key)) rules.push(...p.rules);
    }
    return rules;
  }

  private async _runPreview(): Promise<void> {
    const conn = this._getConn();
    if (!conn || this._docId === null) {
      this._onError("Sélectionnez un document avant l'aperçu.");
      return;
    }
    const rules = this._currentRules();
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
      this._changed = new Map(res.examples.map((e) => [e.unit_id, { before: e.before, after: e.after }]));
      this._stats = { units_changed: res.stats.units_changed, units_total: res.stats.units_total };
      this._expanded.clear(); // a fresh preview clears any per-unit reveals from the last run
      this._editing = null;   // …and closes any open editor (overrides survive — §6 preview-independent)
      this._renderSummary();
      this._renderApplyBtn(); // enable Apply iff the preview found changes
      this._list?.render(); // decorateRow marks the changed rows
    } catch (e) {
      this._onError(e instanceof Error ? e.message : String(e));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Aperçu"; }
    }
  }

  private _renderSummary(): void {
    const s = this._q("#prep-cur-summary");
    if (!s) return;
    if (!this._stats) {
      // No preview yet — but staged manual edits are still pending work to surface.
      s.textContent = this._overrides.size === 0 ? "" : this._overridesSuffix().replace(/^ · /, "");
      return;
    }
    const { units_changed, units_total } = this._stats;
    const base = units_changed === 0
      ? "Aucune unité modifiée par ces règles."
      : `${units_changed} unité${units_changed > 1 ? "s" : ""} modifiée${units_changed > 1 ? "s" : ""} / ${units_total}`;
    s.textContent = base + this._overridesSuffix();
  }

  /** Staged manual edits are pending work that must stay visible (§6). */
  private _overridesSuffix(): string {
    const n = this._overrides.size;
    return n === 0 ? "" : ` · ${n} correction${n > 1 ? "s" : ""} manuelle${n > 1 ? "s" : ""}`;
  }

  private _renderToggleAll(): void {
    const b = this._q("#prep-cur-toggle-all");
    if (b) b.textContent = this._showAllDiffs ? "Masquer les diffs" : "Afficher tous les diffs";
  }

  /** True when there is unsaved work — a preview with rule changes, OR staged manual
   *  overrides (Lot 1). Drives the Apply button; a host may guard leaving on it (R5.1d). */
  hasPendingEdits(): boolean {
    return (this._stats !== null && this._stats.units_changed > 0) || this._overrides.size > 0;
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
    const overrides = this._buildOverrides();
    // α accepts rules=[] + manual_overrides=[…] (verified sidecar.py:3595) → a pure manual
    // edit applies with no presets selected. Only bail if there is genuinely nothing to do.
    if (rules.length === 0 && overrides.length === 0) return;
    const ruleN = this._stats?.units_changed ?? 0;
    const affected = new Set<number>([...this._changed.keys(), ...this._overrides.keys()]).size;
    const msg = overrides.length === 0
      ? `Appliquer la curation à ${ruleN} unité${ruleN > 1 ? "s" : ""} ? Le texte de recherche sera réécrit (l'original est conservé).`
      : `Appliquer la curation (${affected} unité${affected > 1 ? "s" : ""}, dont ${overrides.length} correction${overrides.length > 1 ? "s" : ""} manuelle${overrides.length > 1 ? "s" : ""}) ? Le texte de recherche sera réécrit (l'original est conservé).`;
    const ok = await modalConfirm({ message: msg, confirmLabel: "Appliquer", danger: true });
    if (!ok) return;
    const btn = this._q<HTMLButtonElement>("#prep-cur-apply-btn");
    if (btn) { btn.disabled = true; btn.textContent = "Application…"; }
    try {
      const res = await curate(conn, {
        doc_id: this._docId,
        rules,
        ...(overrides.length > 0 ? { manual_overrides: overrides } : {}),
      });
      // Applied → the preview + staged edits are consumed; reload the (now-rewritten) units.
      this._changed.clear();
      this._expanded.clear();
      this._showAllDiffs = false;
      this._stats = null;
      this._overrides.clear();
      this._editing = null;
      await this._loadUnits(); // fresh text, markers gone
      const s = this._q("#prep-cur-summary");
      if (s) {
        const m = res.units_modified;
        s.textContent = `Curation appliquée : ${m} unité${m > 1 ? "s" : ""} modifiée${m > 1 ? "s" : ""}`
          + (res.fts_stale ? " · réindexez pour la recherche." : ".");
      }
      this._renderToggleAll();
    } catch (e) {
      this._onError(e instanceof Error ? e.message : String(e));
    } finally {
      if (btn) btn.textContent = "Appliquer";
      this._renderApplyBtn();
    }
  }

  /** decorateRow hook — R5.1b marker + R5.1c on-demand diff (changed units) + Lot 1 inline
   *  edit affordance (every unit) + the open editor / override note. */
  private _decorateRow(u: UnitRecord, el: HTMLElement): void {
    const change = this._changed.get(u.unit_id);
    const override = this._overrides.get(u.unit_id);
    if (change) el.classList.add("prep-conv-unit-row--curated");
    if (override !== undefined) el.classList.add("prep-conv-unit-row--overridden");

    // The row being edited shows only its editor panel (no buttons, no diff).
    if (this._editing === u.unit_id) {
      el.insertAdjacentElement("afterend", this._buildEditor(u, change, override));
      return;
    }

    // Inline edit affordance — on EVERY row (override a suggestion OR edit an un-suggested unit).
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "prep-cur-edit-btn";
    editBtn.textContent = override !== undefined ? "✎ édité" : "✎";
    editBtn.title = "Éditer le texte curé de cette unité";
    editBtn.addEventListener("click", (e) => { e.stopPropagation(); this._openEditor(u.unit_id); });
    el.appendChild(editBtn);

    // R5.1c diff toggle — changed units not (yet) manually overridden.
    if (change && override === undefined) {
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
      if (open) {
        const panel = document.createElement("div");
        panel.className = "prep-cur-diff-panel";
        // highlightChangesWordLevel escapes its inputs and returns <mark>/<del> spans.
        setHtml(panel, raw(highlightChangesWordLevel(change.before, change.after)));
        el.insertAdjacentElement("afterend", panel);
      }
    }

    // Staged override note — the manual edit stays visible until Apply (§6), with revert.
    if (override !== undefined) {
      const note = document.createElement("div");
      note.className = "prep-cur-override-note";
      const label = document.createElement("span");
      label.className = "prep-cur-override-text";
      label.textContent = `✎ ${override}`;
      const revert = document.createElement("button");
      revert.type = "button";
      revert.className = "prep-cur-override-revert";
      revert.textContent = "Revenir";
      revert.title = "Annuler cette correction manuelle";
      revert.addEventListener("click", (e) => { e.stopPropagation(); this._revertOverride(u.unit_id); });
      note.append(label, revert);
      el.insertAdjacentElement("afterend", note);
    }
  }

  // ─── Inline editor (Lot 1 — override / direct edit, staged as manual_overrides) ──────────

  private _openEditor(unitId: number): void {
    this._editing = unitId;
    this._list?.render();
    this._q<HTMLTextAreaElement>(".prep-cur-editor-textarea")?.focus();
  }

  private _cancelEdit(): void {
    this._editing = null;
    this._list?.render();
  }

  /** Stage `text` as this unit's override (or clear it if it equals the baseline). */
  private _saveEdit(u: UnitRecord, text: string): void {
    const baseline = this._changed.get(u.unit_id)?.after ?? (u.text_norm ?? "");
    if (text === baseline) this._overrides.delete(u.unit_id); // no real change → not an override
    else this._overrides.set(u.unit_id, text);
    this._editing = null;
    this._afterEdit();
  }

  private _revertOverride(unitId: number): void {
    this._overrides.delete(unitId);
    if (this._editing === unitId) this._editing = null;
    this._afterEdit();
  }

  private _afterEdit(): void {
    this._renderSummary();
    this._renderApplyBtn();
    this._list?.render();
  }

  /** Build the inline editor panel for the row being edited. */
  private _buildEditor(u: UnitRecord, change: CurationChange | undefined, override: string | undefined): HTMLElement {
    const panel = document.createElement("div");
    panel.className = "prep-cur-editor-panel";
    const ta = document.createElement("textarea");
    ta.className = "prep-cur-editor-textarea";
    ta.rows = 3;
    // Seed: the staged override if any, else the rule's proposed result (override a suggestion),
    // else the unit's current text_norm (direct edit of an un-suggested unit).
    ta.value = override ?? change?.after ?? (u.text_norm ?? "");
    const actions = document.createElement("div");
    actions.className = "prep-cur-editor-actions";
    const save = document.createElement("button");
    save.type = "button"; save.className = "btn btn-primary btn-xs"; save.textContent = "Enregistrer";
    save.addEventListener("click", (e) => { e.stopPropagation(); this._saveEdit(u, ta.value); });
    const cancel = document.createElement("button");
    cancel.type = "button"; cancel.className = "btn btn-ghost btn-xs"; cancel.textContent = "Annuler";
    cancel.addEventListener("click", (e) => { e.stopPropagation(); this._cancelEdit(); });
    actions.append(save, cancel);
    if (override !== undefined) {
      const revert = document.createElement("button");
      revert.type = "button"; revert.className = "btn btn-ghost btn-xs prep-cur-override-revert";
      revert.textContent = "Revenir";
      revert.addEventListener("click", (e) => { e.stopPropagation(); this._revertOverride(u.unit_id); });
      actions.append(revert);
    }
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this._saveEdit(u, ta.value); }
      else if (e.key === "Escape") { e.preventDefault(); this._cancelEdit(); }
    });
    panel.append(ta, actions);
    return panel;
  }

  /** Staged overrides as the {unit_id, text} array the /curate manual_overrides field expects. */
  private _buildOverrides(): Array<{ unit_id: number; text: string }> {
    return [...this._overrides.entries()].map(([unit_id, text]) => ({ unit_id, text }));
  }

  // ─── Utility ────────────────────────────────────────────────────────────

  private _q<T extends HTMLElement>(sel: string): T | null {
    return this._root.querySelector<T>(sel);
  }
}
