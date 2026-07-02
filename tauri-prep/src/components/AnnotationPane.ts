/**
 * AnnotationPane.ts — the "Annotation" mode of the "Texte" canvas (R5.2b).
 *
 * A thin, read-only mode over the shared CanvasUnitList (R5.1a): the same unit list +
 * role badges (base decor, §9 "base persistante") with a grammatical overlay — each
 * *annotated* unit's text is repainted as UPOS-coloured prose (hover a word for its
 * POS · lemma). Units without tokens keep their plain text and the dock guides the
 * user toward annotating.
 *
 * Relogement-by-extraction toward T4 (canvas replaces the legacy AnnotationView): the
 * colouring is the shared ui/annotationProse module (R5.2a). The upstream friction —
 * launching annotation, model download/selection — is R5.2c (Lots 3+4). No writes here.
 *
 * DOM + wiring only; the colouring/spacing rules live in ui/annotationProse.
 */
import "../ui/annotation.css";
import type { Conn, ConventionRole, TokenRecord, UnitRecord } from "../lib/sidecarClient.ts";
import { escHtml as esc } from "../lib/diff.ts";
import { listConventions, listUnits, listTokens } from "../lib/sidecarClient.ts";
import { setHtml, raw } from "../lib/safeHtml.ts";
import { buildProseUnitInline, type ProseToken } from "../ui/annotationProse.ts";
import { CanvasUnitList } from "./CanvasUnitList.ts";

const _TOKENS_PAGE = 500;
// A hard cap on pagination loops — a backstop against a misbehaving next_offset, far
// above any real document's token page count.
const _MAX_TOKEN_PAGES = 400;

export class AnnotationPane {
  private readonly _root: HTMLElement;
  private readonly _getConn: () => Conn | null;
  private readonly _onError: (msg: string) => void;

  private _roles: ConventionRole[] = [];
  private _units: UnitRecord[] = [];
  private _docId: number | null = null;
  private _textStartN: number | null = null;
  private _loaded = false;
  private _list: CanvasUnitList | null = null;

  /** unit_id → its tokens (ordered by sent_id, position); drives the coloured overlay. */
  private _tokensByUnit = new Map<number, ProseToken[]>();

  constructor(root: HTMLElement, getConn: () => Conn | null, onError: (msg: string) => void) {
    this._root = root;
    this._getConn = getConn;
    this._onError = onError;
  }

  /** Build the static layout once. Idempotent. */
  mount(): void {
    if (this._root.querySelector(".prep-annot-root")) return;
    setHtml(this._root, raw(`
      <div class="prep-annot-root">
        <div class="prep-annot-toolbar">
          <input type="search" class="prep-conv-search prep-annot-search" id="prep-annot-search"
            placeholder="Rechercher des unit&#233;s&#8230;" autocomplete="off" />
          <span class="prep-conv-search-stats" id="prep-annot-search-stats"></span>
        </div>
        <div class="prep-annot-dock" role="group" aria-label="Annotation grammaticale">
          <span class="prep-annot-summary" id="prep-annot-summary" aria-live="polite"></span>
        </div>
        <div class="prep-conv-units-area prep-annot-units" id="prep-annot-units">
          <div class="prep-conv-empty">S&#233;lectionnez un document.</div>
        </div>
      </div>
    `));

    const area = this._q<HTMLElement>("#prep-annot-units");
    if (area) {
      this._list = new CanvasUnitList(area, {
        // Grammatical overlay: repaint an annotated unit's text as coloured prose.
        decorateRow: (u, el) => this._decorateAnnotated(u, el),
        onStats: (t) => {
          const s = this._q("#prep-annot-search-stats");
          if (s) s.textContent = t;
        },
      });
    }

    const searchEl = this._q<HTMLInputElement>("#prep-annot-search");
    searchEl?.addEventListener("input", () => this._list?.setSearch(searchEl.value));
  }

  async setDocument(docId: number | null, textStartN: number | null): Promise<void> {
    this.mount();
    this._docId = docId;
    this._textStartN = textStartN;
    this._tokensByUnit = new Map();
    this._list?.setData({ docId, textStartN });
    this._list?.clearSelectionQuiet();
    this._setSummary(docId === null ? "" : "Analyse de l’annotation…");
    if (!this._loaded) await this._loadRoles();
    await this._loadUnits();
    await this._loadTokens();
    this._list?.render(); // decorateRow now repaints the annotated rows
    this._renderSummary();
  }

  dispose(): void {
    this._roles = [];
    this._units = [];
    this._tokensByUnit = new Map();
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
    const area = this._q("#prep-annot-units");
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

  /** Page through all of the document's tokens and group them by unit (ordered). */
  private async _loadTokens(): Promise<void> {
    this._tokensByUnit = new Map();
    const conn = this._getConn();
    if (this._docId === null || !conn) return;
    const byUnit = new Map<number, TokenRecord[]>();
    let offset = 0;
    try {
      for (let page = 0; page < _MAX_TOKEN_PAGES; page++) {
        const res = await listTokens(conn, { doc_id: this._docId, limit: _TOKENS_PAGE, offset });
        for (const t of res.tokens) {
          const arr = byUnit.get(t.unit_id);
          if (arr) arr.push(t);
          else byUnit.set(t.unit_id, [t]);
        }
        if (!res.has_more || res.next_offset === null || res.next_offset <= offset) break;
        offset = res.next_offset;
      }
    } catch (e) {
      // Non-fatal: the overlay simply stays off; the base unit list still shows.
      this._onError(e instanceof Error ? e.message : String(e));
      return;
    }
    for (const [uid, toks] of byUnit) {
      toks.sort((a, b) => a.sent_id - b.sent_id || a.position - b.position);
      this._tokensByUnit.set(uid, toks.map((t) => ({
        token_id: t.token_id, word: t.word ?? "", upos: t.upos, lemma: t.lemma,
      })));
    }
  }

  // ─── Overlay + summary ──────────────────────────────────────────────────

  /** decorateRow hook: repaint an annotated unit's text as UPOS-coloured prose. */
  private _decorateAnnotated(u: UnitRecord, el: HTMLElement): void {
    const toks = this._tokensByUnit.get(u.unit_id);
    if (!toks || toks.length === 0) return;
    const textEl = el.querySelector<HTMLElement>(".prep-conv-unit-text");
    if (!textEl) return;
    el.classList.add("prep-annot-unit-row--annotated");
    // Read-only in R5.2b: no onTokenClick (interlinear-on-demand is R5.2d). The token
    // spans carry a POS · lemma title; the row's own click still toggles selection.
    textEl.replaceChildren(buildProseUnitInline(toks));
  }

  private _annotatedCount(): number {
    return this._tokensByUnit.size;
  }

  private _setSummary(text: string): void {
    const s = this._q("#prep-annot-summary");
    if (s) s.textContent = text;
  }

  private _renderSummary(): void {
    const s = this._q("#prep-annot-summary");
    if (!s) return;
    if (this._docId === null) { s.textContent = ""; s.classList.remove("prep-annot-summary--empty"); return; }
    const n = this._annotatedCount();
    if (n === 0) {
      s.textContent = "Document non annoté — l’annotation grammaticale se lance depuis l’atelier "
        + "« Annotation » (relogement au canvas prévu, R5.2c).";
      s.classList.add("prep-annot-summary--empty");
    } else {
      s.textContent = `${n} unité${n > 1 ? "s" : ""} annotée${n > 1 ? "s" : ""} `
        + "· survolez un mot pour sa catégorie (POS) et son lemme.";
      s.classList.remove("prep-annot-summary--empty");
    }
  }

  // ─── Utility ────────────────────────────────────────────────────────────

  private _q<T extends HTMLElement>(sel: string): T | null {
    return this._root.querySelector<T>(sel);
  }
}
