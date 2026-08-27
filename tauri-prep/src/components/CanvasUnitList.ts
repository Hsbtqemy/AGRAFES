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
import { rendersRich, richTextToHtml } from "../lib/sidecarClient.ts";
import {
  applyMark, canStyle, domOffsetToPlain, hasMark, parseRich,
  plainOffsetToDom, type RichToken,
} from "../lib/richTextModel.ts";
import { selectRangeIn, selectionRangeIn } from "../lib/richSelection.ts";
import { escHtml as esc } from "../lib/diff.ts";
import {
  filterUnits,
  isParatext,
  resolveRoleBadge,
  summarizeUnits,
} from "../lib/conventionsUnitList.ts";
import { safeColor, structuralRoleNamesOr } from "../lib/conventionsRoles.ts";
import { deriveCoarseBlocks, blockIndexByUnitId, STRUCTURAL_ROLES } from "../lib/coarseGrain.ts";
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
  /** Stylisation inline (`docs/DESIGN_inline_restyling.md`, D-R1/D-R3). Fournie, elle fait
   *  apparaître une barre I/G au-dessus de toute sélection faite dans une ligne, et
   *  persiste le `text_raw` balisé. `text_norm` n'est jamais modifié par ce geste. */
  onStyleText?: (unitId: number, newTextRaw: string) => Promise<void>;
}

/**
 * Déclarer qu'une couche a repeint le texte de cette ligne.
 *
 * À appeler par tout `decorateRow` qui remplace le contenu de `.prep-conv-unit-text` —
 * aujourd'hui la seule surcouche dans ce cas est celle des tokens de l'Annotation. Le
 * geste de stylisation lit ce marqueur pour refuser : sur une ligne repeinte, les
 * positions lues à l'écran ne désignent pas les caractères de la base. Le marqueur meurt
 * avec la ligne, chaque rendu reconstruisant les `.prep-conv-unit-row`.
 */
export function markRowTextRepainted(rowEl: HTMLElement): void {
  rowEl.dataset.textRepainted = "1";
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
  /** Frappe en cours dans l'éditeur, relevée avant chaque rendu et resemée après lui.
   *  Sans elle, tout rendu (une frappe dans la recherche, une assignation de rôle, une
   *  stylisation) reseme la textarea depuis le modèle et efface la correction en silence.
   *  Même parade que `_textDraft` dans `SegmentPane`. */
  private _editDraft: { text: string; start: number; end: number; focused: boolean } | null = null;
  /** Barre de stylisation flottante (créée à la première sélection utile). */
  private _styleBar: HTMLElement | null = null;
  /** L'écoute de sélection est posée une seule fois, pas à chaque rendu. */
  private _selectionWatchBound = false;
  /** Sélection courante : unité visée + bornes dans le texte nu. */
  private _styleTarget: { unitId: number; start: number; end: number } | null = null;

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
    this._editDraft = null;
    this._hideStyleBar();    // ... et emporte la barre de stylisation avec lui
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
    this._editDraft = null;
    this._hideStyleBar();
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
    this._captureEditDraft(); // avant que le rendu n'emporte la textarea

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
    // R2.2 — the structural set comes from the corpus catalogue, not a constant, so a
    // custom structural role opens a heading block here exactly as it does in the engine.
    // Empty catalogue = not loaded yet (indistinguishable from "no role defined", which is
    // inert anyway since no unit could carry one) → keep the default.
    const blocks = deriveCoarseBlocks(
      this._units,
      structuralRoleNamesOr(this._roles, STRUCTURAL_ROLES),
    );
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
            <span class="prep-conv-unit-text">${richTextToHtml(u.text_raw, u.text_norm ?? "")}</span>
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

    // Un rendu remplace les lignes, donc détruit la sélection du navigateur : la barre
    // de stylisation ne doit jamais lui survivre (elle pointerait un texte disparu).
    this._hideStyleBar();

    const rows = area.querySelectorAll<HTMLElement>(".prep-conv-unit-row");
    rows.forEach((el, idx) => {
      el.addEventListener("click", (e) => {
        // While a row is being edited, clicks never change the selection — the user
        // must save/cancel first (avoids losing the edit to an accidental select).
        if (this._editingUid !== null) return;
        // Un glisser de sélection de texte se termine par un `click` sur la ligne. Le
        // traiter comme un clic de sélection rerendrait la liste — ce qui emporterait la
        // barre de stylisation qui vient d'apparaître, et détruirait la sélection que
        // l'utilisateur vient de faire. Sélectionner du texte n'est pas cliquer la ligne.
        const textSel = el.ownerDocument.defaultView?.getSelection();
        if (textSel && !textSel.isCollapsed && el.contains(textSel.anchorNode)) return;
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

    // Stylisation inline (D-R3), seulement là où l'hôte a câblé la persistance. L'écoute
    // est posée une fois pour toutes au niveau du document, pas par ligne : on relâche
    // souvent la souris hors du texte — dans la marge, sur un badge, au-delà de la fin de
    // ligne — et un écouteur posé sur le seul texte manquait alors la sélection.
    if (this._opts.onStyleText) this._bindSelectionWatch(area.ownerDocument);

    area.querySelector<HTMLButtonElement>(".prep-conv-text-start-clear")?.addEventListener("click", (e) => {
      e.stopPropagation();
      this._opts.onClearTextStart?.();
    });
  }

  // ─── Stylisation inline (docs/DESIGN_inline_restyling.md) ─────────────────

  /** Base à styliser : exactement la chaîne dont l'écran est le rendu.
   *
   *  `rendersRich` est la condition même de `richTextToHtml` : quand elle est vraie
   *  l'écran affiche le verbatim balisé, quand elle est fausse il affiche `text_norm`
   *  ré-échappé. Prendre la même décision ici garantit que les positions lues à l'écran
   *  désignent bien des caractères de la base — sans cette symétrie, une ligne « en
   *  phase » mais sans balise pouvait donner un verbatim qui diffère de l'affiché par un
   *  espace insécable, que `foldNorm` ignore et que les offsets, eux, ne pardonnent pas.
   *
   *  Sur une ligne corrigée, le balisage d'import ne décrit plus rien — styliser repart
   *  donc du texte courant, ce qui réécrit le verbatim et rétablit l'invariant. C'est le
   *  retournement que D-C1 disait réversible ; `text_source` garde l'original d'import. */
  private _styleBase(u: UnitRecord): string {
    const norm = u.text_norm ?? "";
    return rendersRich(u.text_raw, norm) ? (u.text_raw as string) : norm;
  }

  /** L'écran a-t-il replié les entités XML de cette ligne ?
   *
   *  Seule la branche riche les laisse résoudre par le navigateur ; la branche nue les
   *  ré-échappe et les affiche en toutes lettres. Les traducteurs d'offsets doivent le
   *  savoir : sur la branche nue, écran et base coïncident caractère pour caractère. */
  private _foldsEntities(u: UnitRecord): boolean {
    return rendersRich(u.text_raw, u.text_norm ?? "");
  }

  /** Pose l'écoute de sélection une seule fois pour la vie de la liste. */
  private _bindSelectionWatch(doc: Document): void {
    if (this._selectionWatchBound) return;
    this._selectionWatchBound = true;
    doc.addEventListener("mouseup", () => this._onSelectionSettled(doc));
  }

  /** Trouve la ligne qui porte la sélection courante, où qu'on ait relâché la souris. */
  private _onSelectionSettled(doc: Document): void {
    const selection = doc.defaultView?.getSelection() ?? null;
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      return this._hideStyleBar();
    }
    const anchor = selection.anchorNode;
    const start = anchor?.nodeType === 1 ? (anchor as Element) : (anchor?.parentElement ?? null);
    const span = start?.closest<HTMLElement>(".prep-conv-unit-text") ?? null;
    // Sélection hors liste, ou à cheval sur deux lignes : rien à styliser ici.
    if (!span || !this._host.contains(span) || !span.contains(selection.focusNode)) {
      return this._hideStyleBar();
    }
    const uid = parseInt(span.closest<HTMLElement>(".prep-conv-unit-row")?.dataset.uid ?? "", 10);
    if (!Number.isFinite(uid)) return this._hideStyleBar();
    this._onTextSelected(uid);
  }

  /** Lit la sélection faite dans une ligne et présente la barre I/G, ou la retire. */
  private _onTextSelected(unitId: number): void {
    // Une correction ouverte ailleurs n'interdit plus de styliser : le rendu qui suit
    // resème la textarea depuis `_editDraft`, donc la frappe survit. Sur la ligne en
    // cours de correction, il n'y a pas de texte à sélectionner — une textarea ne porte
    // que du texte nu — et la recherche du `span` ci-dessous n'aboutit tout simplement pas.
    const u = this._units.find((x) => x.unit_id === unitId);
    const row = this._host.querySelector<HTMLElement>(`.prep-conv-unit-row[data-uid="${unitId}"]`);
    const span = row?.querySelector<HTMLElement>(".prep-conv-unit-text");
    if (!u || !row || !span) return this._hideStyleBar();

    const dom = selectionRangeIn(span, span.ownerDocument.defaultView?.getSelection() ?? null);
    const base = this._styleBase(u);
    if (!dom || !canStyle(base)) return this._hideStyleBar();

    // La couche qui repeint une ligne le DÉCLARE (`markRowTextRepainted`). Le texte à
    // l'écran n'est alors plus celui de la base — la surcouche de tokens de l'Annotation
    // le reconstruit avec ses propres règles d'espacement — et les offsets lus dessus ne
    // désigneraient pas les mêmes caractères. On refuse, sans rien deviner : comparer les
    // longueurs, comme on le faisait, laissait passer toute ligne où deux écarts se
    // compensent (196 unités du corpus de travail, mesurées le 25 août).
    if (row.dataset.textRepainted) return this._hideStyleBar();

    // Sur la branche nue, l'écran montre les caractères de la base un à un : la
    // conversion doit alors être l'identité, et non un repliement d'entités que personne
    // n'a fait (`_foldsEntities`).
    const plainText = parseRich(base).plain;
    const folds = this._foldsEntities(u);
    const toPlain = (o: number): number => (folds ? domOffsetToPlain(plainText, o) : o);
    const start = toPlain(dom.start);
    const end = toPlain(dom.end);
    if (start >= end) return this._hideStyleBar();

    this._styleTarget = { unitId, start, end };
    this._showStyleBar(span, base, start, end);
  }

  private _showStyleBar(span: HTMLElement, base: string, start: number, end: number): void {
    const doc = span.ownerDocument;
    let bar = this._styleBar;
    if (!bar) {
      bar = doc.createElement("div");
      bar.className = "prep-conv-stylebar";
      for (const token of ["italic", "bold"] as RichToken[]) {
        const btn = doc.createElement("button");
        btn.type = "button";
        btn.className = `prep-conv-stylebar-btn prep-conv-stylebar-btn--${token}`;
        btn.dataset.token = token;
        btn.textContent = token === "italic" ? "I" : "G";
        btn.title = token === "italic" ? "Italique" : "Gras";
        // mousedown, pas click : un click ferait perdre la sélection avant l'appel.
        btn.addEventListener("mousedown", (e) => {
          e.preventDefault();
          e.stopPropagation();
          void this._applyStyle(token);
        });
        bar.appendChild(btn);
      }
      span.ownerDocument.body.appendChild(bar);
      this._styleBar = bar;
      // Positionnée en coordonnées de page : un défilement la laisserait en arrière du
      // texte qu'elle vise. En capture, pour attraper aussi les conteneurs défilants.
      const drop = (): void => this._hideStyleBar();
      doc.addEventListener("scroll", drop, { capture: true, passive: true });
      doc.defaultView?.addEventListener("resize", drop, { passive: true });
    }
    for (const btn of bar.querySelectorAll<HTMLElement>(".prep-conv-stylebar-btn")) {
      const token = btn.dataset.token as RichToken;
      const on = hasMark(base, start, end, token);
      btn.classList.toggle("prep-conv-stylebar-btn--on", on);
      btn.setAttribute("aria-pressed", String(on));
    }
    // Ancrée sur la SÉLECTION, pas sur la ligne. Une unité de 200 caractères tient sur
    // plusieurs lignes à l'écran (5,4 % du corpus), et une unité géante sur des écrans
    // entiers : accrochée au haut du bloc, la barre s'affichait loin du mot visé, voire
    // au-dessus de la zone visible. Le rectangle de la ligne reste le repli si la
    // sélection n'en donne pas — c'est le cas en happy-dom, où tout vaut zéro.
    const sel = doc.defaultView?.getSelection() ?? null;
    const selBox = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).getBoundingClientRect() : null;
    const box = selBox && (selBox.width > 0 || selBox.height > 0)
      ? selBox
      : span.getBoundingClientRect();
    bar.style.position = "absolute";
    bar.style.left = `${box.left + (doc.defaultView?.scrollX ?? 0)}px`;
    bar.style.top = `${box.top + (doc.defaultView?.scrollY ?? 0) - 28}px`;
    bar.hidden = false;
  }

  private _hideStyleBar(): void {
    this._styleTarget = null;
    if (this._styleBar) this._styleBar.hidden = true;
  }

  /** Poser ou retirer le style sur la sélection courante, puis persister. */
  private async _applyStyle(token: RichToken): Promise<void> {
    const target = this._styleTarget;
    const cb = this._opts.onStyleText;
    if (!target || !cb) return;
    const u = this._units.find((x) => x.unit_id === target.unitId);
    if (!u) return;

    const base = this._styleBase(u);
    const on = !hasMark(base, target.start, target.end, token);
    const next = applyMark(base, target.start, target.end, token, on);
    if (next === base) return this._hideStyleBar();

    // Bornes à l'écran, relevées avant le rendu : elles serviront à reposer la sélection
    // sur les nœuds neufs. Poser une balise ne change pas le texte nu, donc elles
    // désignent toujours le même passage.
    const plain = parseRich(base).plain;
    const folds = this._foldsEntities(u);
    const domStart = folds ? plainOffsetToDom(plain, target.start) : target.start;
    const domEnd = folds ? plainOffsetToDom(plain, target.end) : target.end;

    try {
      await cb(u.unit_id, next);
    } catch {
      return; // l'hôte a signalé l'erreur ; on garde la sélection pour réessayer
    }
    u.text_raw = next; // le geste ne touche pas text_norm
    this.render();     // le rendu retire la barre et refait la ligne…
    this._restoreStyleSelection(target, domStart, domEnd); // … on la remet en place
  }

  /** Reposer la sélection et la barre sur la ligne réaffichée, après un style appliqué.
   *
   *  Sans cela le surlignage tombe au premier clic : poser le second style, ou défaire
   *  celui qu'on vient de poser, obligerait à re-sélectionner le passage. La barre
   *  revient avec l'état à jour, donc le même bouton retire ce qu'il a mis. */
  private _restoreStyleSelection(
    target: { unitId: number; start: number; end: number },
    domStart: number,
    domEnd: number,
  ): void {
    const u = this._units.find((x) => x.unit_id === target.unitId);
    const row = this._host.querySelector<HTMLElement>(`.prep-conv-unit-row[data-uid="${target.unitId}"]`);
    const span = row?.querySelector<HTMLElement>(".prep-conv-unit-text");
    // La ligne peut avoir quitté l'affichage (filtre, changement de document) : on n'insiste pas.
    if (!u || !span || !selectRangeIn(span, domStart, domEnd)) return;
    this._styleTarget = target;
    this._showStyleBar(span, this._styleBase(u), target.start, target.end);
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

  /** Relève la frappe en cours (texte, caret, focus) avant que le rendu ne la détruise. */
  private _captureEditDraft(): void {
    if (this._editingUid === null) return;
    const ta = this._host.querySelector<HTMLTextAreaElement>(".prep-conv-unit-editor");
    // La textarea encore à l'écran peut être celle d'une *autre* unité (on vient d'ouvrir
    // ailleurs) : on ne relève une frappe que pour l'unité qu'elle concerne.
    if (!ta || ta.dataset.uid !== String(this._editingUid)) return;
    this._editDraft = {
      text: ta.value,
      start: ta.selectionStart ?? ta.value.length,
      end: ta.selectionEnd ?? ta.value.length,
      // On ne rend le focus que si la textarea l'avait : sinon un rendu déclenché depuis
      // la recherche le lui volerait en pleine frappe.
      focused: ta.ownerDocument.activeElement === ta,
    };
  }

  private _openEditor(uid: number): void {
    this._editingUid = uid;
    this._editDraft = null; // on ouvre sur le texte enregistré, pas sur une frappe d'ailleurs
    this.render();
    this._host.querySelector<HTMLTextAreaElement>(".prep-conv-unit-editor")?.focus();
  }

  private _cancelEdit(): void {
    this._editingUid = null;
    this._editDraft = null; // la frappe abandonnee ne doit pas reapparaitre a la reouverture
    this.render();
  }

  /** Swap the text span for an auto-sized textarea in place (port of legacy A). */
  private _mountEditor(el: HTMLElement, u: UnitRecord): void {
    const draft = this._editDraft;
    const current = draft ? draft.text : (u.text_norm ?? "");
    const wrap = document.createElement("div");
    wrap.className = "prep-conv-unit-editor-wrap";
    const ta = document.createElement("textarea");
    ta.className = "prep-conv-unit-editor";
    ta.dataset.uid = String(u.unit_id);
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
    if (draft) {
      // On repose le caret là où il était ; le focus n'est rendu que s'il était ici, pour
      // ne pas l'arracher au champ (recherche, barre I/G) qui a provoqué le rendu.
      ta.setSelectionRange(draft.start, draft.end);
      if (draft.focused) ta.focus();
    }

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
    this._editDraft = null;
    this.render();
  }
}
