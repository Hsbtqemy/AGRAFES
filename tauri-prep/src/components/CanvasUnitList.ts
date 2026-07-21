/**
 * CanvasUnitList.ts — the shared unit-list base of the "Texte" canvas (R5.1a).
 *
 * Extracted verbatim from RolesPane so several modes (Rôles, Curation…) render the
 * SAME unit list — text + role badges + coarse-grain grouping + one selection model
 * — and only *layer their own decor on top* (§9 "base persistante + 1 mode actif",
 * docs/DESIGN_R5_1_curation_layer.md). Behaviour is identical to the former
 * RolesPane._renderUnits; the roles-specific catalogue/assign/lift logic stays in
 * RolesPane and drives this base through the hooks below.
 *
 * Pure logic (filterUnits, resolveRoleBadge, summarizeUnits, deriveCoarseBlocks)
 * lives in lib/*. This holds only DOM + selection wiring. No sidecar calls.
 */
import type { ConventionRole, UnitRecord } from "../lib/sidecarClient.ts";
import { escHtml as esc } from "../lib/diff.ts";
import {
  filterUnits,
  isParatext,
  resolveRoleBadge,
  summarizeUnits,
} from "../lib/conventionsUnitList.ts";
import { safeColor } from "../lib/conventionsRoles.ts";
import { deriveCoarseBlocks, blockIndexByUnitId } from "../lib/coarseGrain.ts";
import { setHtml, raw } from "../lib/safeHtml.ts";

export interface CanvasUnitListOptions {
  /** Fired after the selection changes (click / shift-range / clear). */
  onSelectionChange?: (selected: Set<number>) => void;
  /** Per-row decor hook: the active mode adds its overlay to a rendered row. */
  decorateRow?: (unit: UnitRecord, rowEl: HTMLElement) => void;
  /** Fired when the user clicks "remove boundary" on the text-start marker. */
  onClearTextStart?: () => void;
  /** Emits the search/summary line for the host to place in its toolbar. */
  onStats?: (text: string) => void;
  /** Optional extra row predicate ANDed with the text search (e.g. the curation review
   *  filter). Returning false hides the unit. Re-evaluated on every render, so the host
   *  just calls render() after changing whatever the predicate closes over. */
  rowFilter?: (unit: UnitRecord) => boolean;
  /** The "stylo" in-place text correction (DESIGN_inline_text_correction.md, D-C8).
   *  When provided, each row gets a ✎ affordance; editing swaps the text for an
   *  auto-sized textarea in place and persists ``newTextNorm`` via this callback (β,
   *  immediate). Reject to keep the editor open (the host surfaces the error). */
  onEditText?: (unitId: number, newTextNorm: string) => Promise<void>;
}

export class CanvasUnitList {
  private readonly _host: HTMLElement;
  private readonly _opts: CanvasUnitListOptions;

  private _units: UnitRecord[] = [];
  private _roles: ConventionRole[] = [];
  private _docId: number | null = null;
  private _textStartN: number | null = null;
  private _selected = new Set<number>();
  private _searchQuery = "";
  private _lastClickedIdx = -1;
  /** The unit whose in-place editor is open (single editor at a time), or null. */
  private _editingUid: number | null = null;

  constructor(host: HTMLElement, opts: CanvasUnitListOptions = {}) {
    this._host = host;
    this._opts = opts;
  }

  /** Update the data/context. Any provided field replaces the current one. */
  setData(d: {
    units?: UnitRecord[];
    roles?: ConventionRole[];
    docId?: number | null;
    textStartN?: number | null;
  }): void {
    if (d.units !== undefined) this._units = d.units;
    if (d.roles !== undefined) this._roles = d.roles;
    if (d.docId !== undefined) this._docId = d.docId;
    if (d.textStartN !== undefined) this._textStartN = d.textStartN;
  }

  setSearch(q: string): void {
    this._searchQuery = q;
    // The shift-click anchor indexes the *filtered* list — search changes that list,
    // so the anchor is invalid: reset it (verbatim from RolesPane).
    this._lastClickedIdx = -1;
    this.render();
  }

  getSelection(): Set<number> {
    return this._selected;
  }

  clearSelection(): void {
    this._selected.clear();
    this._lastClickedIdx = -1;
    this.render();
    this._opts.onSelectionChange?.(this._selected);
  }

  /** Clear selection without rendering or firing the callback (e.g. a doc switch). */
  clearSelectionQuiet(): void {
    this._selected.clear();
    this._lastClickedIdx = -1;
    this._editingUid = null; // a context change closes any open editor (F1)
  }

  /** Update the role of the given units in-place (after an assign) + re-render. */
  setUnitsRole(ids: Iterable<number>, roleName: string | null): void {
    const set = ids instanceof Set ? ids : new Set(ids);
    for (const u of this._units) if (set.has(u.unit_id)) u.unit_role = roleName;
    this.render();
  }

  /** Reset all state. Clearing the host DOM is the caller's job. */
  reset(): void {
    this._units = [];
    this._roles = [];
    this._docId = null;
    this._textStartN = null;
    this._selected.clear();
    this._searchQuery = "";
    this._lastClickedIdx = -1;
    this._editingUid = null;
  }

  private get _filteredUnits(): UnitRecord[] {
    const bySearch = filterUnits(this._units, this._searchQuery);
    return this._opts.rowFilter ? bySearch.filter((u) => this._opts.rowFilter!(u)) : bySearch;
  }

  /** Explicit "start of text" marker shown before the boundary unit (and as a
   *  fallback header when that unit is filtered out of view). */
  private _textStartMarkerHtml(suffix = ""): string {
    return `<div class="prep-conv-text-start-sep"><span class="prep-conv-text-start-sep-label">&#9873; D&#233;but du texte (unit&#233; ${this._textStartN})${esc(suffix)}</span><button type="button" class="prep-conv-text-start-clear" title="Retirer la borne (tout redevient texte)">&#10005; Retirer la borne</button></div>`;
  }

  render(): void {
    const area = this._host;

    if (this._docId === null) {
      area.innerHTML = `<div class="prep-conv-empty">S&#233;lectionnez un document.</div>`;
      this._opts.onStats?.("");
      return;
    }

    const filtered = this._filteredUnits;
    const summary = summarizeUnits(this._units, filtered);
    // Show matched/total whenever anything narrows the list — a text search OR a mode's
    // rowFilter (e.g. the curation review filter). Keying off searchQuery alone made the count
    // lie under a rowFilter (showed the full total while fewer rows were rendered).
    this._opts.onStats?.(
      summary.matched !== summary.total
        ? `${summary.matched}/${summary.total} unités · ${summary.withRole} avec rôle`
        : `${summary.total} unités · ${summary.withRole} avec rôle`,
    );

    if (this._units.length === 0) {
      area.innerHTML = `<div class="prep-conv-empty">Aucune unit&#233; dans ce document.</div>`;
      return;
    }
    if (filtered.length === 0) {
      area.innerHTML = `<div class="prep-conv-empty">Aucune unit&#233; ne correspond &#224; la recherche.</div>`;
      return;
    }

    // R2.3 — coarse grain (paragraph ⊃ sentence). Blocks are derived over the *full*
    // unit list so anchors/sizes stay correct under search filtering; grouped rows are
    // indented and a ¶ separator opens each multi-sentence paragraph. Separators use a
    // distinct class, so the `.prep-conv-unit-row` NodeList (and its shift-range index)
    // stays aligned with `filtered`.
    const blocks = deriveCoarseBlocks(this._units);
    const blockIdx = blockIndexByUnitId(blocks);
    let prevBi = -1;
    const rowsHtml = filtered
      .map((u) => {
        const badge = resolveRoleBadge(u.unit_role, this._roles);
        const selected = this._selected.has(u.unit_id);
        const para = isParatext(u.n, this._textStartN);
        const badgeHtml = badge
          ? `<span class="prep-conv-unit-badge" style="background:${safeColor(badge.color, "#374151")}22;border-color:${safeColor(badge.color, "#374151")};color:${safeColor(badge.color, "#94a3b8")}">${badge.icon ? esc(badge.icon) + " " : ""}${esc(badge.label)}</span>`
          : "";
        const marker = this._textStartN !== null && u.n === this._textStartN
          ? this._textStartMarkerHtml()
          : "";
        const bi = blockIdx.get(u.unit_id) ?? -1;
        const block = bi >= 0 ? blocks[bi] : null;
        const grouped = block !== null && block.kind === "sentence-grouped" && block.fineCount > 1;
        const sep = grouped && bi !== prevBi
          ? `<div class="prep-conv-para-sep"><span class="prep-conv-para-label">&#182; ${block!.fineCount} phrases</span></div>`
          : "";
        prevBi = bi;
        const fineHint = block !== null && block.kind === "composite"
          ? `<span class="prep-conv-unit-fine" title="Segments &#164; (grain fin déjà présent)">&#164;${block.fineCount}</span>`
          : "";
        return `${marker}${sep}
          <div class="prep-conv-unit-row${selected ? " selected" : ""}${para ? " paratext" : ""}${grouped ? " prep-conv-unit-row--grouped" : ""}" data-uid="${u.unit_id}">
            <span class="prep-conv-unit-n">${u.n}</span>
            <span class="prep-conv-unit-text">${esc(u.text_norm ?? "")}</span>
            ${fineHint}
            ${badgeHtml}
          </div>`;
      })
      .join("");
    // Keep the boundary visible/clearable even when its unit is filtered out of view.
    const boundaryInView = this._textStartN !== null && filtered.some((u) => u.n === this._textStartN);
    const topMarker = this._textStartN !== null && !boundaryInView
      ? this._textStartMarkerHtml(" — hors recherche")
      : "";
    setHtml(area, raw(topMarker + rowsHtml));

    const rows = area.querySelectorAll<HTMLElement>(".prep-conv-unit-row");
    rows.forEach((el, idx) => {
      el.addEventListener("click", (e) => {
        // While a row is being edited, clicks never change the selection — the user
        // must save/cancel first (avoids losing the edit to an accidental select).
        if (this._editingUid !== null) return;
        const uid = parseInt(el.dataset.uid!, 10);
        if ((e as MouseEvent).shiftKey && this._lastClickedIdx >= 0) {
          const lo = Math.min(this._lastClickedIdx, idx);
          const hi = Math.max(this._lastClickedIdx, idx);
          for (let i = lo; i <= hi; i++) this._selected.add(filtered[i].unit_id);
        } else {
          if (this._selected.has(uid)) this._selected.delete(uid);
          else this._selected.add(uid);
          this._lastClickedIdx = idx;
        }
        this.render();
        this._opts.onSelectionChange?.(this._selected);
      });
    });

    // Let the active mode layer its per-unit decor (curation markers, …) on the rows.
    if (this._opts.decorateRow) {
      rows.forEach((el) => {
        const uid = parseInt(el.dataset.uid!, 10);
        const u = this._units.find((x) => x.unit_id === uid);
        if (u) this._opts.decorateRow!(u, el);
      });
    }

    // The "stylo" in-place editor (D-C8), only where the host wired persistence.
    if (this._opts.onEditText) {
      rows.forEach((el) => {
        const uid = parseInt(el.dataset.uid!, 10);
        const u = this._units.find((x) => x.unit_id === uid);
        if (!u) return;
        if (this._editingUid === uid) this._mountEditor(el, u);
        else this._mountPen(el, u);
      });
    }

    area.querySelector<HTMLButtonElement>(".prep-conv-text-start-clear")?.addEventListener("click", (e) => {
      e.stopPropagation();
      this._opts.onClearTextStart?.();
    });
  }

  // ─── Stylo: in-place text correction (D-C8) ───────────────────────────────

  /** Add the discreet ✎ affordance (revealed on hover) + double-click to edit. */
  private _mountPen(el: HTMLElement, u: UnitRecord): void {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "prep-conv-unit-edit";
    btn.textContent = "✎";
    btn.title = "Corriger le texte de cette unité";
    btn.addEventListener("click", (e) => { e.stopPropagation(); this._openEditor(u.unit_id); });
    el.appendChild(btn);
    el.querySelector<HTMLElement>(".prep-conv-unit-text")?.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      this._openEditor(u.unit_id);
    });
  }

  private _openEditor(uid: number): void {
    this._editingUid = uid;
    this.render();
    this._host.querySelector<HTMLTextAreaElement>(".prep-conv-unit-editor")?.focus();
  }

  private _cancelEdit(): void {
    this._editingUid = null;
    this.render();
  }

  /** Swap the text span for an auto-sized textarea in place (port of legacy A). */
  private _mountEditor(el: HTMLElement, u: UnitRecord): void {
    const current = u.text_norm ?? "";
    const wrap = document.createElement("div");
    wrap.className = "prep-conv-unit-editor-wrap";
    const ta = document.createElement("textarea");
    ta.className = "prep-conv-unit-editor";
    ta.value = current;
    // Auto-grow to fit the content, but CAP at the CSS max-height so a huge unit (a whole
    // non-segmented doc) never gets an absurd inline height like 43160px — beyond the cap the
    // textarea scrolls internally. A modest, predictable layout change on open.
    const autoGrow = (): void => {
      ta.style.height = "auto";
      const maxH = parseFloat(getComputedStyle(ta).maxHeight);
      const h = Number.isFinite(maxH) ? Math.min(ta.scrollHeight, maxH) : ta.scrollHeight;
      ta.style.height = `${h}px`;
    };
    const actions = document.createElement("div");
    actions.className = "prep-conv-unit-editor-actions";
    const save = document.createElement("button");
    save.type = "button"; save.className = "btn btn-primary btn-xs"; save.textContent = "Enregistrer"; save.title = "Ctrl+Entrée";
    const cancel = document.createElement("button");
    cancel.type = "button"; cancel.className = "btn btn-ghost btn-xs"; cancel.textContent = "Annuler"; cancel.title = "Échap";
    actions.append(save, cancel);
    wrap.append(ta, actions);
    const textSpan = el.querySelector<HTMLElement>(".prep-conv-unit-text");
    if (textSpan) textSpan.replaceWith(wrap); else el.appendChild(wrap);
    el.classList.add("prep-conv-unit-row--editing");
    autoGrow(); // size to content now that the textarea is in the DOM

    const commit = (): void => { void this._saveEdit(u, ta.value); };
    save.addEventListener("click", (e) => { e.stopPropagation(); commit(); });
    cancel.addEventListener("click", (e) => { e.stopPropagation(); this._cancelEdit(); });
    ta.addEventListener("click", (e) => e.stopPropagation());
    ta.addEventListener("input", autoGrow);
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commit(); }
      else if (e.key === "Escape") { e.preventDefault(); this._cancelEdit(); }
    });
  }

  private async _saveEdit(u: UnitRecord, text: string): Promise<void> {
    const cb = this._opts.onEditText;
    if (!cb) { this._cancelEdit(); return; }
    if (text === (u.text_norm ?? "")) { this._cancelEdit(); return; } // no real change
    try {
      await cb(u.unit_id, text);
    } catch {
      return; // persistence failed — keep the editor open; the host surfaced the error
    }
    u.text_norm = text; // reflect the saved text locally (β edits text_norm, D-C1)
    this._editingUid = null;
    this.render();
  }
}
