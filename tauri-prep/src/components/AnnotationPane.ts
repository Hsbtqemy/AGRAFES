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
import { listConventions, listUnits, listTokens, listModels, downloadModel, updateToken } from "../lib/sidecarClient.ts";
import { languageLabel, type ModelInfo } from "../lib/models.ts";
import { setHtml, raw } from "../lib/safeHtml.ts";
import { buildProseUnitInline, UPOS_TAGS, type ProseToken } from "../ui/annotationProse.ts";
import { runJobWithPolling, type JobHandle } from "../lib/jobPolling.ts";
import { CanvasUnitList } from "./CanvasUnitList.ts";

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

  private _roles: ConventionRole[] = [];
  private _units: UnitRecord[] = [];
  private _docId: number | null = null;
  private _textStartN: number | null = null;
  private _language: string | null = null;
  private _loaded = false;
  private _list: CanvasUnitList | null = null;

  /** unit_id → its tokens (ordered by sent_id, position); drives the coloured overlay. */
  private _tokensByUnit = new Map<number, ProseToken[]>();
  /** token_id → full record; feeds the on-demand token editor (R5.2d). */
  private _tokenById = new Map<number, TokenRecord>();
  /** In-flight annotation job (via the shared runJobWithPolling controller). */
  private _annotHandle: JobHandle | null = null;
  /** In-flight in-context model download. */
  private _modelHandle: JobHandle | null = null;

  constructor(
    root: HTMLElement,
    getConn: () => Conn | null,
    onError: (msg: string) => void,
    onManageModels?: () => void,
  ) {
    this._root = root;
    this._getConn = getConn;
    this._onError = onError;
    this._onManageModels = onManageModels;
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
        onStats: (t) => {
          const s = this._q("#prep-annot-search-stats");
          if (s) s.textContent = t;
        },
      });
    }

    const searchEl = this._q<HTMLInputElement>("#prep-annot-search");
    searchEl?.addEventListener("input", () => this._list?.setSearch(searchEl.value));

    this._q<HTMLButtonElement>("#prep-annot-run-btn")?.addEventListener("click", () => void this._runAnnotate());
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
          this._list?.render();
          this._renderSummary();
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

  // Token editor (R5.2d): on-demand token annotation editing.

  /** Open the editor for a token (Mot / Lemme / UPOS / XPOS / Feats / Misc). */
  private _openTokenEditor(tokenId: number): void {
    const editor = this._q<HTMLElement>("#prep-annot-token-editor");
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
  }

  private _closeTokenEditor(): void {
    const editor = this._q<HTMLElement>("#prep-annot-token-editor");
    if (editor) { editor.replaceChildren(); editor.style.display = "none"; }
  }

  private async _saveToken(tokenId: number): Promise<void> {
    const conn = this._getConn();
    const editor = this._q<HTMLElement>("#prep-annot-token-editor");
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
      this._list?.render();
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

  /** decorateRow hook: repaint an annotated unit's text as UPOS-coloured prose. */
  private _decorateAnnotated(u: UnitRecord, el: HTMLElement): void {
    const toks = this._tokensByUnit.get(u.unit_id);
    if (!toks || toks.length === 0) return;
    const textEl = el.querySelector<HTMLElement>(".prep-conv-unit-text");
    if (!textEl) return;
    el.classList.add("prep-annot-unit-row--annotated");
    // A token click opens its editor (R5.2d); the span handler stopPropagation-s so the
    // row's own selection is not toggled. The span title still shows POS · lemma.
    textEl.replaceChildren(buildProseUnitInline(toks, {
      onTokenClick: (id) => this._openTokenEditor(id),
    }));
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
