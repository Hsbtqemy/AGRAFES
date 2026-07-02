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
import { escHtml as esc } from "../lib/diff.ts";
import { listConventions, listUnits, curatePreview } from "../lib/sidecarClient.ts";
import { CURATE_PRESETS } from "../lib/curationPresets.ts";
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

    const area = this._q<HTMLElement>("#prep-cur-units");
    if (area) {
      this._list = new CanvasUnitList(area, {
        // Light overlay (§9 D2): a discreet marker on the units the rules would change.
        decorateRow: (u, el) => {
          if (this._changed.has(u.unit_id)) {
            el.classList.add("prep-conv-unit-row--curated");
            el.title = "Modifiée par la curation (aperçu)";
          }
        },
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
    // A new document invalidates any prior preview.
    this._changed.clear();
    this._stats = null;
    this._renderSummary();
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
      this._renderSummary();
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
    if (!this._stats) { s.textContent = ""; return; }
    const { units_changed, units_total } = this._stats;
    s.textContent = units_changed === 0
      ? "Aucune unité modifiée par ces règles."
      : `${units_changed} unité${units_changed > 1 ? "s" : ""} modifiée${units_changed > 1 ? "s" : ""} / ${units_total}`;
  }

  // ─── Utility ────────────────────────────────────────────────────────────

  private _q<T extends HTMLElement>(sel: string): T | null {
    return this._root.querySelector<T>(sel);
  }
}
