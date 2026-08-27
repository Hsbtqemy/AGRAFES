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
import { listConventions, listUnits, listTokens, listModels, downloadModel, updateToken, updateUnitTextNorm, updateUnitRichText } from "../lib/sidecarClient.ts";
import { languageLabel, type ModelInfo } from "../lib/models.ts";
import { setHtml, raw } from "../lib/safeHtml.ts";
import { buildProseUnitInline, buildInterlinearSentence, UPOS_TAGS, type ProseToken } from "../ui/annotationProse.ts";
import { runJobWithPolling, type JobHandle } from "../lib/jobPolling.ts";
import { CanvasUnitList, markRowTextRepainted } from "./CanvasUnitList.ts";

const _TOKENS_PAGE = 500;
// A hard cap on pagination loops — a backstop against a misbehaving next_offset, far
// above any real document's token page count.
const _MAX_TOKEN_PAGES = 400;

export class AnnotationPane {
  private readonly _root: HTMLElement;
  private readonly _getConn: () => Conn | null;
  private readonly _onError: (msg: string) => void;
  /** Optional: navigate to the Paramètres model manager (renders the "Gérer" link). */
  private readonly _onManageModels?: () => void;
  /** Shared canvas action dock; when set, the token editor is re-parented here so it stays
   *  pinned to the viewport bottom during scroll instead of scrolling away (R5.3). */
  private readonly _dock: HTMLElement | null;

  private _roles: ConventionRole[] = [];
  private _units: UnitRecord[] = [];
  private _docId: number | null = null;
  private _textStartN: number | null = null;
  private _language: string | null = null;
  private _loaded = false;
  private _list: CanvasUnitList | null = null;
  /** Display mode for annotated units: coloured prose (default) or interlinear grid (R5.2e). */
  private _viewMode: "prose" | "extended" = "prose";
  /** The token editor element. Lives in the dock when one is provided, else in-pane. */
  private _editorEl: HTMLElement | null = null;
  /** token_id being edited, to keep its highlight across list re-renders (R5.3). */
  private _editingTokenId: number | null = null;
  /** R6.5-A token search (word/lemma/UPOS) — matched token_ids in reading order + cursor. */
  private _tokSearchQuery = "";
  private _tokSearchMatches: number[] = [];
  private _tokSearchCursor = 0;

  /** unit_id → its tokens (ordered by sent_id, position); drives the coloured overlay. */
  private _tokensByUnit = new Map<number, ProseToken[]>();
  /** token_id → full record; feeds the on-demand token editor (R5.2d). */
  private _tokenById = new Map<number, TokenRecord>();
  /** Units whose text was corrected (stylo) since the last annotation run: their tokens
   *  now describe stale text. Kept (never destroyed — a fix mustn't discard hand-corrected
   *  POS/lemma) but the overlay falls back to the corrected plain text + a "réannoter" nudge
   *  (signal, don't destroy — mirrors the D-C2 alignment philosophy). In-session only. */
  private _staleAnnot = new Set<number>();
  /** In-flight annotation job (via the shared runJobWithPolling controller). */
  private _annotHandle: JobHandle | null = null;
  /** In-flight in-context model download. */
  private _modelHandle: JobHandle | null = null;

  constructor(
    root: HTMLElement,
    getConn: () => Conn | null,
    onError: (msg: string) => void,
    onManageModels?: () => void,
    dock?: HTMLElement | null,
  ) {
    this._root = root;
    this._getConn = getConn;
    this._onError = onError;
    this._onManageModels = onManageModels;
    this._dock = dock ?? null;
  }

  /** Build the static layout once. Idempotent. */
  mount(): void {
    if (this._root.querySelector(".prep-annot-root")) return;
    setHtml(this._root, raw(`
      <div class="prep-annot-root">
        <div class="prep-annot-toolbar">
          <input type="search" class="prep-conv-search prep-annot-search" id="prep-annot-search"
            placeholder="Chercher mot, lemme, UPOS&#8230;" autocomplete="off"
            aria-label="Rechercher un token (mot, lemme, UPOS)" />
          <button type="button" class="btn btn-sm btn-ghost prep-annot-search-nav" id="prep-annot-search-prev"
            title="Occurrence pr&#233;c&#233;dente" disabled>&#9668;</button>
          <button type="button" class="btn btn-sm btn-ghost prep-annot-search-nav" id="prep-annot-search-next"
            title="Occurrence suivante" disabled>&#9658;</button>
          <span class="prep-annot-search-count" id="prep-annot-search-count" aria-live="polite"></span>
          <div class="prep-annot-viewmode" role="group" aria-label="Mode d'affichage de l'annotation">
            <button type="button" class="prep-annot-viewmode-btn active" data-mode="prose"
              title="Prose color&#233;e &#8212; nature au survol">Prose</button>
            <button type="button" class="prep-annot-viewmode-btn" data-mode="extended"
              title="Grille interlin&#233;aire &#8212; nature et lemme affich&#233;s">&#201;tendu</button>
          </div>
        </div>
        <div class="prep-annot-dock" role="group" aria-label="Annotation grammaticale">
          <button type="button" class="btn btn-primary btn-sm" id="prep-annot-run-btn"
            title="Lancer l'analyse grammaticale (POS + lemmes) sur ce document">Annoter &#9654;</button>
          <span class="prep-annot-summary" id="prep-annot-summary" aria-live="polite"></span>
          <span class="prep-annot-status" id="prep-annot-status" aria-live="polite"></span>
        </div>
        <div class="prep-annot-model-band" id="prep-annot-model-band" style="display:none" aria-live="polite"></div>
        <div class="prep-annot-token-editor" id="prep-annot-token-editor" style="display:none"></div>
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
        // Stylo: transversal in-place text correction (β immediate). Editing an annotated
        // unit's text invalidates its tokens → flag it stale (see _saveText).
        onEditText: (uid, textNorm) => this._saveText(uid, textNorm),
        onStyleText: (uid, textRaw) => this._saveStyle(uid, textRaw),
      });
    }

    // R6.5-A — la recherche de la couche Annotation est une recherche de TOKEN (mot/lemme/UPOS)
    // « pour éditer » : surligne + navigue les occurrences ; un clic sur un token ouvre déjà
    // l'éditeur (R5.2d). La recherche « scientifique » (cross-corpus, KWIC) reste au
    // concordancier (CQL) — cf. DESIGN_R6_4_canvas_parity.md §7.5. Remplace, dans cette pane
    // seule, le filtre d'unités générique du CanvasUnitList.
    const searchEl = this._q<HTMLInputElement>("#prep-annot-search");
    searchEl?.addEventListener("input", () => this._updateTokenSearch());
    searchEl?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); this._navTokenSearch(e.shiftKey ? -1 : 1); }
      else if (e.key === "Escape") { searchEl.value = ""; this._updateTokenSearch(); }
    });
    this._q<HTMLButtonElement>("#prep-annot-search-prev")?.addEventListener("click", () => this._navTokenSearch(-1));
    this._q<HTMLButtonElement>("#prep-annot-search-next")?.addEventListener("click", () => this._navTokenSearch(1));

    this._root.querySelectorAll<HTMLButtonElement>(".prep-annot-viewmode-btn").forEach((b) => {
      b.addEventListener("click", () => this._setViewMode(b.dataset.mode === "extended" ? "extended" : "prose"));
    });

    this._q<HTMLButtonElement>("#prep-annot-run-btn")?.addEventListener("click", () => void this._runAnnotate());

    // Re-parent the token editor into the shared canvas action sheet (fixed bottom) if
    // provided, so it stays in view while the unit list scrolls (R5.3); else it stays in-pane.
    this._editorEl = this._q<HTMLElement>("#prep-annot-token-editor");
    if (this._dock && this._editorEl) this._dock.appendChild(this._editorEl);
  }

  /** Switch the annotated-unit display between coloured prose and the interlinear grid. */
  private _setViewMode(mode: "prose" | "extended"): void {
    if (this._viewMode === mode) return;
    this._viewMode = mode;
    this._root.querySelectorAll<HTMLButtonElement>(".prep-annot-viewmode-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.mode === mode);
    });
    this._renderList(); // re-run decorateRow with the new mode (keeps the edit highlight)
  }

  async setDocument(docId: number | null, textStartN: number | null, language: string | null = null): Promise<void> {
    this.mount();
    // A doc switch abandons any in-flight annotation / model poll (the job keeps
    // running server-side; we just stop applying its result to a now-different doc).
    this._annotHandle?.cancel();
    this._annotHandle = null;
    this._modelHandle?.cancel();
    this._modelHandle = null;
    this._docId = docId;
    this._textStartN = textStartN;
    this._language = language;
    this._tokensByUnit = new Map();
    this._tokenById = new Map();
    this._staleAnnot.clear();
    this._resetTokenSearch();
    this._closeTokenEditor();
    this._resetRunBtn();
    this._setStatus("");
    this._list?.setData({ docId, textStartN });
    this._list?.clearSelectionQuiet();
    this._setSummary(docId === null ? "" : "Analyse de l’annotation…");
    if (!this._loaded) await this._loadRoles();
    await this._loadUnits();
    await this._loadTokens();
    this._list?.render(); // decorateRow now repaints the annotated rows
    this._renderSummary();
    await this._loadModelBand();
  }

  dispose(): void {
    this._annotHandle?.cancel();
    this._annotHandle = null;
    this._modelHandle?.cancel();
    this._modelHandle = null;
    this._closeTokenEditor();
    this._roles = [];
    this._units = [];
    this._tokensByUnit = new Map();
    this._tokenById = new Map();
    this._staleAnnot.clear();
    this._resetTokenSearch();
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
    this._tokenById = new Map();
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
      for (const t of toks) this._tokenById.set(t.token_id, t);
    }
  }

  // ─── Annotation trigger (R5.2c-4b) ───────────────────────────────────────

  /** Launch spaCy annotation on the current document via the shared job controller;
   *  on completion, reload the tokens and repaint. The engine picks the corpus's active
   *  model for the language (R5.2c-2) — no model is passed here. */
  private async _runAnnotate(): Promise<void> {
    const conn = this._getConn();
    if (!conn) { this._onError("Non connecté."); return; }
    if (this._docId === null) { this._onError("Sélectionnez un document."); return; }
    if (this._annotHandle !== null) return; // already running
    const docId = this._docId;
    const btn = this._q<HTMLButtonElement>("#prep-annot-run-btn");
    if (btn) { btn.disabled = true; btn.textContent = "En cours…"; }
    this._setStatus("Lancement…");
    this._annotHandle = runJobWithPolling(conn, {
      enqueue: async () => {
        const res = await conn.post("/jobs/enqueue", { kind: "annotate", params: { doc_id: docId } });
        return (res as { job?: { job_id?: string } }).job?.job_id ?? "";
      },
      onProgress: (msg) => this._setStatus(msg),
      onDone: async () => {
        this._annotHandle = null;
        this._resetRunBtn();
        // Only apply if we are still on the document we annotated.
        if (this._docId === docId) {
          await this._loadTokens();
          this._staleAnnot.clear(); // fresh tokens for the whole doc → nothing is stale
          this._list?.render();
          this._renderSummary();
          if (this._tokSearchQuery) this._updateTokenSearch(); // recompute against new tokens
        }
        this._setStatus("✓ Annotation terminée.");
      },
      onError: (msg) => {
        this._annotHandle = null;
        this._resetRunBtn();
        this._setStatus(`✗ ${msg}`);
      },
    });
  }

  private _resetRunBtn(): void {
    const btn = this._q<HTMLButtonElement>("#prep-annot-run-btn");
    if (btn) { btn.disabled = this._docId === null; btn.textContent = "Annoter ▶"; }
  }

  private _setStatus(text: string): void {
    const s = this._q("#prep-annot-status");
    if (s) s.textContent = text;
  }

  // ─── Stylo: in-place text correction (β immediate, transversal) ───────────

  /** Stylisation inline (`docs/DESIGN_inline_restyling.md`) : persiste le `text_raw`
   *  balisé. `text_norm` est renvoyé inchangé — le geste n'ajoute que des balises, donc
   *  le texte cherchable, les tokens et les bornes d'alignement restent valables. */
  private async _saveStyle(unitId: number, textRaw: string): Promise<void> {
    const conn = this._getConn();
    if (!conn) throw new Error("Non connecté.");
    const unit = this._units.find((u) => u.unit_id === unitId);
    try {
      await updateUnitRichText(conn, unitId, textRaw, unit?.text_norm ?? "");
    } catch (e) {
      this._onError(e instanceof Error ? e.message : String(e));
      throw e;
    }
  }

  /** onEditText for the shared list: persist a stylo correction (β), keeping text_raw
   *  (D-C1, via updateUnitTextNorm) — the flag-stale + undo side effects live server-side.
   *  On success, if the unit is annotated its tokens (POS/lemma, possibly hand-corrected)
   *  still describe the pre-edit text: flag it stale so the overlay drops to the corrected
   *  plain text + a nudge (kept, signalled — cf. D-C2), rather than paint a misleading
   *  overlay. Throws so CanvasUnitList keeps the editor open on failure. */
  private async _saveText(unitId: number, textNorm: string): Promise<void> {
    const conn = this._getConn();
    if (!conn) throw new Error("Non connecté.");
    try {
      await updateUnitTextNorm(conn, unitId, textNorm);
    } catch (e) {
      this._onError(e instanceof Error ? e.message : String(e));
      throw e;
    }
    // Only an annotated unit has an overlay to invalidate; a plain unit has nothing to flag.
    if (this._tokensByUnit.has(unitId)) {
      this._staleAnnot.add(unitId);
      this._renderSummary();
      // The unit's tokens just left the searchable set (now stale) — refresh count/nav so a
      // "chercher pour éditer" pass doesn't navigate to a token whose overlay just vanished.
      if (this._tokSearchQuery) this._refreshTokenSearchAfterEdit();
      // CanvasUnitList re-renders right after this resolves; _decorateAnnotated will see
      // the unit as stale and skip its overlay.
    }
  }

  // Token editor (R5.2d): on-demand token annotation editing.

  /** Open the editor for a token (Mot / Lemme / UPOS / XPOS / Feats / Misc). */
  private _openTokenEditor(tokenId: number): void {
    const editor = this._editorEl;
    const tok = this._tokenById.get(tokenId);
    if (!editor || !tok) return;
    const cur = (tok.upos ?? "");
    const uposOpts = ["", ...UPOS_TAGS]
      .map((u) => `<option value="${esc(u)}"${cur === u ? " selected" : ""}>${u ? esc(u) : "(vide)"}</option>`)
      .join("");
    const field = (label: string, name: string, value: string): string =>
      `<label class="prep-annot-field"><span>${label}</span>`
      + `<input type="text" data-field="${name}" value="${esc(value)}" /></label>`;
    setHtml(editor, raw(
      `<div class="prep-annot-editor-head">`
      + `<span class="prep-annot-editor-title">Token #${tok.token_id} : ${esc(tok.word ?? "")}</span>`
      + `<button type="button" class="prep-annot-editor-close">Fermer</button></div>`
      + `<div class="prep-annot-editor-fields">`
      + field("Mot", "word", tok.word ?? "")
      + field("Lemme", "lemma", tok.lemma ?? "")
      + `<label class="prep-annot-field"><span>UPOS</span>`
      + `<select data-field="upos">${uposOpts}</select></label>`
      + field("XPOS", "xpos", tok.xpos ?? "")
      + field("Feats", "feats", tok.feats ?? "")
      + field("Misc", "misc", tok.misc ?? "")
      + `</div>`
      + `<div class="prep-annot-editor-actions">`
      + `<button type="button" class="btn btn-primary btn-sm prep-annot-editor-save">Enregistrer</button>`
      + `<span class="prep-annot-editor-status" aria-live="polite"></span></div>`,
    ));
    editor.style.display = "";
    // Set the select value explicitly (more reliable than the `selected` attribute).
    const uposEl = editor.querySelector<HTMLSelectElement>('[data-field="upos"]');
    if (uposEl) uposEl.value = cur;
    editor.querySelector(".prep-annot-editor-close")?.addEventListener("click", () => this._closeTokenEditor());
    editor.querySelector(".prep-annot-editor-save")?.addEventListener("click", () => void this._saveToken(tokenId));
    // The box sits in the bottom sheet; keep the visual link by highlighting the token.
    this._highlightEditingToken(tokenId);
  }

  /** Mark the token being edited (a liseré) so the link survives the box being in the bottom
   *  sheet; re-applied after a list re-render. Pass null to clear. */
  private _highlightEditingToken(tokenId: number | null): void {
    this._editingTokenId = tokenId;
    this._root.querySelectorAll(".annot-editing-token")
      .forEach((el) => el.classList.remove("annot-editing-token"));
    if (tokenId !== null) {
      this._root.querySelector(`[data-token-id="${tokenId}"]`)?.classList.add("annot-editing-token");
    }
  }

  // ─── R6.5-A token search (word/lemma/UPOS) — find-to-edit within the doc ──────

  /** Flat token list in reading order (units in list order, tokens ordered within).
   *  Skips units flagged stale by a stylo edit: their overlay is dropped, so their tokens
   *  aren't shown and must not be counted/navigated as search hits until re-annotation. */
  private _tokensInReadingOrder(): ProseToken[] {
    const out: ProseToken[] = [];
    for (const u of this._units) {
      if (this._staleAnnot.has(u.unit_id)) continue;
      const toks = this._tokensByUnit.get(u.unit_id);
      if (toks) out.push(...toks);
    }
    return out;
  }

  /** token_ids (reading order) whose word/lemma/UPOS contains the lowercased query. */
  private _computeMatches(q: string): number[] {
    return this._tokensInReadingOrder()
      .filter((t) =>
        t.word.toLowerCase().includes(q) ||
        (t.lemma?.toLowerCase().includes(q) ?? false) ||
        (t.upos?.toLowerCase().includes(q) ?? false))
      .map((t) => t.token_id);
  }

  /** Recompute matches for the current query text; refresh nav buttons, count, highlights. */
  private _updateTokenSearch(): void {
    const input = this._q<HTMLInputElement>("#prep-annot-search");
    const prev = this._q<HTMLButtonElement>("#prep-annot-search-prev");
    const next = this._q<HTMLButtonElement>("#prep-annot-search-next");
    const count = this._q("#prep-annot-search-count");
    const q = (input?.value ?? "").trim().toLowerCase();
    this._tokSearchQuery = q;
    this._tokSearchCursor = 0;
    if (!q) {
      this._tokSearchMatches = [];
      if (count) count.textContent = "";
      if (prev) prev.disabled = true;
      if (next) next.disabled = true;
      this._clearTokenSearchHighlights();
      return;
    }
    this._tokSearchMatches = this._computeMatches(q);
    const n = this._tokSearchMatches.length;
    if (prev) prev.disabled = n === 0;
    if (next) next.disabled = n === 0;
    if (count) count.textContent = n === 0 ? "0 résultat" : `1 / ${n}`;
    this._applyTokenSearchHighlights();
    if (n > 0) this._scrollToMatch(0);
  }

  /** Step to the previous/next occurrence (wraps); update count + highlight + scroll. */
  private _navTokenSearch(dir: 1 | -1): void {
    const n = this._tokSearchMatches.length;
    if (n === 0) return;
    this._tokSearchCursor = (this._tokSearchCursor + dir + n) % n;
    const count = this._q("#prep-annot-search-count");
    if (count) count.textContent = `${this._tokSearchCursor + 1} / ${n}`;
    this._applyTokenSearchHighlights();
    this._scrollToMatch(this._tokSearchCursor);
  }

  /** After a token edit changed its fields, refresh the match set in place — an edit can
   *  add or drop a match (e.g. fixing a UPOS while searching "NOUN"). Keeps the user's place
   *  (cursor clamped, no scroll) so a fix-pass isn't yanked back to the first occurrence. */
  private _refreshTokenSearchAfterEdit(): void {
    if (!this._tokSearchQuery) return;
    this._tokSearchMatches = this._computeMatches(this._tokSearchQuery);
    const n = this._tokSearchMatches.length;
    if (this._tokSearchCursor >= n) this._tokSearchCursor = Math.max(0, n - 1);
    const count = this._q("#prep-annot-search-count");
    const prev = this._q<HTMLButtonElement>("#prep-annot-search-prev");
    const next = this._q<HTMLButtonElement>("#prep-annot-search-next");
    if (count) count.textContent = n === 0 ? "0 résultat" : `${this._tokSearchCursor + 1} / ${n}`;
    if (prev) prev.disabled = n === 0;
    if (next) next.disabled = n === 0;
    this._applyTokenSearchHighlights();
  }

  /** Paint match classes on the token elements; the cursor's match is distinguished. */
  private _applyTokenSearchHighlights(): void {
    this._clearTokenSearchHighlights();
    const cur = this._tokSearchMatches[this._tokSearchCursor];
    for (const id of this._tokSearchMatches) {
      const el = this._root.querySelector(`[data-token-id="${id}"]`);
      if (!el) continue;
      el.classList.add("prep-annot-tok-match");
      if (id === cur) el.classList.add("prep-annot-tok-match--current");
    }
  }

  private _clearTokenSearchHighlights(): void {
    this._root.querySelectorAll(".prep-annot-tok-match, .prep-annot-tok-match--current")
      .forEach((el) => el.classList.remove("prep-annot-tok-match", "prep-annot-tok-match--current"));
  }

  private _scrollToMatch(idx: number): void {
    const id = this._tokSearchMatches[idx];
    if (id === undefined) return;
    const el = this._root.querySelector<HTMLElement>(`[data-token-id="${id}"]`);
    el?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }

  /** Clear the token-search state + UI (doc switch / dispose). */
  private _resetTokenSearch(): void {
    this._tokSearchQuery = "";
    this._tokSearchMatches = [];
    this._tokSearchCursor = 0;
    const input = this._q<HTMLInputElement>("#prep-annot-search");
    if (input) input.value = "";
    const count = this._q("#prep-annot-search-count");
    if (count) count.textContent = "";
    const prev = this._q<HTMLButtonElement>("#prep-annot-search-prev");
    if (prev) prev.disabled = true;
    const next = this._q<HTMLButtonElement>("#prep-annot-search-next");
    if (next) next.disabled = true;
    this._clearTokenSearchHighlights();
  }

  /** Re-render the unit list and restore the edited-token highlight (lost on rebuild). */
  private _renderList(): void {
    this._list?.render();
    if (this._editingTokenId !== null) this._highlightEditingToken(this._editingTokenId);
    if (this._tokSearchQuery) this._applyTokenSearchHighlights(); // survive the repaint
  }

  private _closeTokenEditor(): void {
    const editor = this._editorEl;
    if (editor) { editor.replaceChildren(); editor.style.display = "none"; }
    this._highlightEditingToken(null);
  }

  /** Canvas switched away from the Annotation layer: retract our dock contribution. */
  deactivate(): void {
    this._closeTokenEditor();
  }

  /** Deep-link target (Explorer→Prep, #23): open the token editor to correct this token,
   *  scrolling it into view. No-op if it isn't loaded (doc not annotated / unknown id). */
  focusToken(tokenId: number): void {
    if (!this._tokenById.has(tokenId)) return;
    this._openTokenEditor(tokenId); // opens the editor + highlights the token (R5.2d)
    this._root.querySelector<HTMLElement>(`[data-token-id="${tokenId}"]`)
      ?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }

  private async _saveToken(tokenId: number): Promise<void> {
    const conn = this._getConn();
    const editor = this._editorEl;
    const tok = this._tokenById.get(tokenId);
    if (!conn || !editor || !tok) return;
    const get = (name: string): string =>
      (editor.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-field="${name}"]`)?.value ?? "").trim();
    const norm = (v: string): string | null => (v ? v : null);
    const status = editor.querySelector<HTMLElement>(".prep-annot-editor-status");
    const payload = {
      token_id: tokenId,
      word: get("word") || (tok.word ?? ""),
      lemma: norm(get("lemma")),
      upos: norm(get("upos")),
      xpos: norm(get("xpos")),
      feats: norm(get("feats")),
      misc: norm(get("misc")),
    };
    if (status) status.textContent = "Enregistrement...";
    try {
      await updateToken(conn, payload);
      // Update local caches so the prose (colour/title) and a re-open reflect the edit.
      const updated: TokenRecord = { ...tok, ...payload };
      this._tokenById.set(tokenId, updated);
      const arr = this._tokensByUnit.get(tok.unit_id);
      if (arr) {
        const i = arr.findIndex((p) => p.token_id === tokenId);
        if (i >= 0) arr[i] = { token_id: tokenId, word: updated.word ?? "", upos: updated.upos, lemma: updated.lemma };
      }
      this._renderList(); // keeps the editing highlight after the repaint
      if (this._tokSearchQuery) this._refreshTokenSearchAfterEdit(); // edit may add/drop a match
      if (status) status.textContent = "OK";
    } catch (e) {
      if (status) status.textContent = `Erreur : ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  // ─── Model band (R5.2c-4c) ───────────────────────────────────────────────

  /** Base language code of the current document (region tags reduce to the base). */
  private _baseLang(): string {
    return (this._language ?? "").trim().toLowerCase().split(/[-_]/)[0];
  }

  /** Refresh the in-context model band for the document's language. */
  private async _loadModelBand(): Promise<void> {
    const band = this._q<HTMLElement>("#prep-annot-model-band");
    if (!band) return;
    const conn = this._getConn();
    if (!conn || this._docId === null || !this._baseLang()) {
      band.replaceChildren();
      band.style.display = "none";
      return;
    }
    let models: ModelInfo[];
    try {
      models = await listModels(conn);
    } catch {
      band.replaceChildren();
      band.style.display = "none";
      return;
    }
    this._renderModelBand(band, models);
  }

  private _renderModelBand(band: HTMLElement, models: ModelInfo[]): void {
    const base = this._baseLang();
    // Models for this language, else the multilingual pool as a fallback.
    const langModels = models.filter((m) => m.language === base);
    const pool = langModels.length ? langModels : models.filter((m) => m.language === "xx");
    band.replaceChildren();
    if (pool.length === 0) { band.style.display = "none"; return; }
    band.style.display = "";

    const active = pool.find((m) => m.active && m.source !== "absent");
    const available = active ?? pool.find((m) => m.source !== "absent");
    const label = document.createElement("span");
    label.className = "prep-annot-model-label";

    if (available) {
      label.textContent = `Modèle ${languageLabel(base)} : ${available.name}${active ? " (actif)" : ""}`;
      band.appendChild(label);
    } else {
      // Nothing loadable for this language → recommend a download (default md, else first).
      const rec = pool.find((m) => m.size_class === "md")
        ?? pool.find((m) => m.size_class === "sm") ?? pool[0];
      label.classList.add("prep-annot-model-label--missing");
      label.textContent = `⚠ Aucun modèle pour ${languageLabel(base)} — ${rec.name} (~${rec.approx_size_mb} Mo)`;
      band.appendChild(label);
      const dl = document.createElement("button");
      dl.className = "btn btn-primary btn-sm";
      dl.textContent = "↓ Télécharger";
      dl.addEventListener("click", () => this._downloadModel(rec.name, dl));
      band.appendChild(dl);
    }

    if (this._onManageModels) {
      const manage = document.createElement("button");
      manage.type = "button";
      manage.className = "prep-annot-model-manage";
      manage.textContent = "Gérer les modèles";
      manage.addEventListener("click", () => this._onManageModels?.());
      band.appendChild(manage);
    }
  }

  private _downloadModel(name: string, btn: HTMLButtonElement): void {
    const conn = this._getConn();
    if (!conn || this._modelHandle !== null) return;
    btn.disabled = true;
    btn.textContent = "Téléchargement…";
    this._modelHandle = runJobWithPolling(conn, {
      enqueue: async () => {
        const job = await downloadModel(conn, name);
        return job.job_id ?? "";
      },
      onProgress: (msg) => { btn.textContent = msg; },
      onDone: async () => {
        this._modelHandle = null;
        await this._loadModelBand(); // now available → band updates
      },
      onError: (msg) => {
        this._modelHandle = null;
        btn.disabled = false;
        btn.textContent = "↓ Réessayer";
        this._onError(`Téléchargement échoué : ${msg}`);
      },
    });
  }

  // ─── Overlay + summary ──────────────────────────────────────────────────

  /** decorateRow hook: repaint an annotated unit's text — coloured prose (default) or the
   *  interlinear grid (Étendu, R5.2e), per the current view mode. In both modes a token
   *  click opens its editor (R5.2d); the shared builders stopPropagation so the row's own
   *  selection is not toggled. */
  private _decorateAnnotated(u: UnitRecord, el: HTMLElement): void {
    const toks = this._tokensByUnit.get(u.unit_id);
    if (!toks || toks.length === 0) return;
    const textEl = el.querySelector<HTMLElement>(".prep-conv-unit-text");
    if (!textEl) return;
    // Corrected (stylo) since the last annotation run → the tokens describe stale text.
    // Leave the corrected plain text_norm the base row already rendered and flag the row,
    // rather than paint a misleading token overlay (kept tokens, signalled — cf. D-C2).
    if (this._staleAnnot.has(u.unit_id)) {
      el.classList.add("prep-annot-unit-row--stale");
      const chip = document.createElement("span");
      chip.className = "prep-annot-stale-chip";
      chip.textContent = "⟳ texte modifié — à réannoter";
      chip.title = "Le texte a été corrigé depuis l'annotation ; relancez « Annoter » pour la mettre à jour.";
      el.appendChild(chip);
      return;
    }
    el.classList.add("prep-annot-unit-row--annotated");
    // À partir d'ici la surcouche remplace le texte de la ligne : le déclarer, pour que
    // le geste de stylisation refuse au lieu de viser des offsets qui ne correspondent
    // plus (la reconstruction depuis les tokens a ses propres règles d'espacement).
    markRowTextRepainted(el);
    const opts = { onTokenClick: (id: number) => this._openTokenEditor(id) };
    if (this._viewMode === "extended") {
      el.classList.add("prep-annot-unit-row--extended");
      textEl.replaceChildren(buildInterlinearSentence(toks, opts));
    } else {
      el.classList.remove("prep-annot-unit-row--extended");
      textEl.replaceChildren(buildProseUnitInline(toks, opts));
    }
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
      s.textContent = "Document non annoté — cliquez « Annoter » pour lancer l’analyse "
        + "grammaticale (POS + lemmes).";
      s.classList.add("prep-annot-summary--empty");
    } else {
      const staleN = this._staleAnnot.size;
      s.textContent = `${n} unité${n > 1 ? "s" : ""} annotée${n > 1 ? "s" : ""} `
        + "· survolez un mot pour sa catégorie (POS) et son lemme."
        + (staleN > 0 ? ` · ⚠ ${staleN} à réannoter (texte modifié)` : "");
      s.classList.remove("prep-annot-summary--empty");
    }
  }

  // ─── Utility ────────────────────────────────────────────────────────────

  private _q<T extends HTMLElement>(sel: string): T | null {
    return this._root.querySelector<T>(sel);
  }
}
