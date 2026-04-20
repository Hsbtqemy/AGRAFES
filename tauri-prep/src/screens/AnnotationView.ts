/**
 * AnnotationView.ts — Standalone interlinear annotation view extracted from ActionsScreen.
 *
 * Single dependency injected via closure:
 *   - _getConn: () => Conn | null
 *
 * Public API:
 *   - render(container)  — mounts the panel into container
 *   - dispose()          — stops polling, releases references
 *   - focusDoc(docId, tokenId?) — programmatic navigation from app.ts
 *   - refreshIfConnected()      — called by parent when connection becomes available
 */

import "../ui/annotation.css";
import type { Conn } from "../lib/sidecarClient.ts";
import { SidecarError } from "../lib/sidecarClient.ts";

// ─── Local types ──────────────────────────────────────────────────────────────

interface AnnotDoc {
  doc_id: number;
  title: string;
  language: string | null;
  annotation_status?: string;
  token_count?: number;
}

interface AnnotToken {
  unit_id: number;
  unit_n: number;
  sent_id: number;
  position: number;
  word: string;
  lemma: string | null;
  upos: string | null;
  xpos: string | null;
  feats: string | null;
  misc: string | null;
  token_id: number;
}

// ─── AnnotationView ───────────────────────────────────────────────────────────

export class AnnotationView {
  // ─── Dependencies ─────────────────────────────────────────────────────────
  private readonly _getConn: () => Conn | null;

  // ─── State ────────────────────────────────────────────────────────────────
  private _panel: HTMLElement | null = null;
  private _annotDocs: AnnotDoc[] = [];
  private _annotSelectedDocId: number | null = null;
  private _annotTokens: AnnotToken[] = [];
  private _annotSelectedTokenId: number | null = null;
  private _annotJobPoll: ReturnType<typeof setInterval> | null = null;
  private _annotJobId: string | null = null;
  private _annotSearchQuery = "";
  private _annotSearchMatches: number[] = [];
  private _annotSearchCursor = 0;
  private _annotModelOverride = "";
  private _annotViewMode: "read" | "annotate" = "annotate";

  constructor(getConn: () => Conn | null) {
    this._getConn = getConn;
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  render(container: HTMLElement): void {
    this._annotStopPoll();
    const panel = this._buildPanel();
    this._panel = panel;
    container.appendChild(panel);

    const sidebar = panel.querySelector<HTMLElement>(".annot-sidebar");
    const viewer  = panel.querySelector<HTMLElement>(".annot-viewer");
    const editor  = panel.querySelector<HTMLElement>(".annot-editor");

    const conn = this._getConn();
    if (conn && sidebar && viewer && editor) {
      void this._annotLoadDocs(sidebar, viewer, editor);
    } else if (sidebar) {
      sidebar.innerHTML = `<p class="annot-sidebar-loading">En attente de connexion\u2026</p>`;
    }
  }

  dispose(): void {
    this._annotStopPoll();
    this._panel = null;
  }

  /** Called by parent after connection becomes available (replaces _annotRefreshIfVisible). */
  refreshIfConnected(): void {
    const panel = this._panel;
    if (!panel) return;
    const sidebar = panel.querySelector<HTMLElement>(".annot-sidebar");
    const viewer  = panel.querySelector<HTMLElement>(".annot-viewer");
    const editor  = panel.querySelector<HTMLElement>(".annot-editor");
    if (sidebar && viewer && editor) {
      void this._annotLoadDocs(sidebar, viewer, editor);
    }
  }

  /** Called from app.ts after RG→Prep token navigation. */
  focusDoc(docId: number, tokenId?: number): void {
    const panel = this._panel;
    if (!panel) return;
    const li = panel.querySelector<HTMLElement>(`.annot-doc-item[data-doc-id="${docId}"]`);
    if (li) {
      li.click();
      li.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    if (tokenId != null) {
      const tryHighlight = (): void => {
        const tokEl = panel.querySelector<HTMLElement>(`.annot-token[data-token-id="${tokenId}"]`);
        if (tokEl) {
          tokEl.scrollIntoView({ behavior: "smooth", block: "center" });
          tokEl.classList.add("annot-token--highlighted");
          setTimeout(() => tokEl.classList.remove("annot-token--highlighted"), 2500);
        }
      };
      setTimeout(tryHighlight, 400);
      setTimeout(tryHighlight, 900);
    }
  }

  // ─── Panel builder ────────────────────────────────────────────────────────

  private _buildPanel(): HTMLElement {
    const panel = document.createElement("div");
    panel.className = "annot-panel";

    // ── Toolbar ──────────────────────────────────────────────────────────────
    const toolbar = document.createElement("div");
    toolbar.className = "annot-toolbar";

    const title = document.createElement("h3");
    title.className = "annot-title";
    title.textContent = "Annotation interlin\u00e9aire";

    const modelLabel = document.createElement("label");
    modelLabel.className = "annot-model-label";
    modelLabel.textContent = "Mod\u00e8le ";
    const modelSelect = document.createElement("select");
    modelSelect.className = "annot-model-select";
    const SPACY_MODELS: [string, string][] = [
      ["(auto)", ""],
      ["fr \u2014 fr_core_news_md",  "fr_core_news_md"],
      ["en \u2014 en_core_web_md",   "en_core_web_md"],
      ["de \u2014 de_core_news_md",  "de_core_news_md"],
      ["es \u2014 es_core_news_md",  "es_core_news_md"],
      ["it \u2014 it_core_news_md",  "it_core_news_md"],
      ["sv \u2014 sv_core_news_sm",  "sv_core_news_sm"],
      ["ro \u2014 ro_core_news_md",  "ro_core_news_md"],
      ["el \u2014 el_core_news_sm",  "el_core_news_sm"],
      ["multi \u2014 xx_ent_wiki_sm","xx_ent_wiki_sm"],
    ];
    for (const [label, value] of SPACY_MODELS) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      opt.selected = value === this._annotModelOverride;
      modelSelect.appendChild(opt);
    }
    modelSelect.addEventListener("change", () => {
      this._annotModelOverride = modelSelect.value;
    });
    modelLabel.appendChild(modelSelect);

    const refreshBtn = document.createElement("button");
    refreshBtn.className = "annot-btn-refresh";
    refreshBtn.title = "Rafra\u00eechir la liste des documents";
    refreshBtn.textContent = "\u21bb";
    refreshBtn.addEventListener("click", () => {
      const sidebar = panel.querySelector<HTMLElement>(".annot-sidebar");
      const viewer  = panel.querySelector<HTMLElement>(".annot-viewer");
      const editor  = panel.querySelector<HTMLElement>(".annot-editor");
      if (sidebar && viewer && editor) void this._annotLoadDocs(sidebar, viewer, editor);
    });

    const runBtn = document.createElement("button");
    runBtn.className = "annot-btn-run";
    runBtn.title = "Lancer l\u2019annotation spaCy sur le document s\u00e9lectionn\u00e9";
    runBtn.textContent = "Annoter \u25b6";
    runBtn.addEventListener("click", () => void this._annotRunJob(panel));

    const statusSpan = document.createElement("span");
    statusSpan.className = "annot-status";

    // ── Search bar ───────────────────────────────────────────────────────────
    const searchWrap = document.createElement("div");
    searchWrap.className = "annot-search-wrap";

    const searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.className = "annot-search-input";
    searchInput.placeholder = "Chercher mot, lemme, UPOS\u2026";
    searchInput.value = this._annotSearchQuery;
    searchInput.setAttribute("aria-label", "Rechercher dans les annotations");

    const searchPrev = document.createElement("button");
    searchPrev.className = "annot-search-nav";
    searchPrev.textContent = "\u25c4";
    searchPrev.title = "Occurrence pr\u00e9c\u00e9dente";
    searchPrev.disabled = true;

    const searchNext = document.createElement("button");
    searchNext.className = "annot-search-nav";
    searchNext.textContent = "\u25ba";
    searchNext.title = "Occurrence suivante";
    searchNext.disabled = true;

    const searchCount = document.createElement("span");
    searchCount.className = "annot-search-count";

    const _updateSearch = (): void => {
      const q = searchInput.value.trim().toLowerCase();
      this._annotSearchQuery = q;
      this._annotSearchCursor = 0;

      if (!q) {
        this._annotSearchMatches = [];
        searchCount.textContent = "";
        searchPrev.disabled = true;
        searchNext.disabled = true;
        panel.querySelectorAll<HTMLElement>(".annot-token--match, .annot-token--match-current").forEach(el => {
          el.classList.remove("annot-token--match", "annot-token--match-current");
        });
        return;
      }

      this._annotSearchMatches = this._annotTokens
        .filter(tok =>
          (tok.word?.toLowerCase().includes(q)) ||
          (tok.lemma?.toLowerCase().includes(q)) ||
          (tok.upos?.toLowerCase().includes(q))
        )
        .map(tok => tok.token_id);

      const count = this._annotSearchMatches.length;
      searchPrev.disabled = count === 0;
      searchNext.disabled = count === 0;
      searchCount.textContent = count === 0 ? "0 r\u00e9sultat" : `1 / ${count}`;

      this._annotApplySearchHighlights(panel);
      if (count > 0) this._annotScrollToMatch(panel, 0);
    };

    const _navSearch = (dir: 1 | -1): void => {
      const count = this._annotSearchMatches.length;
      if (count === 0) return;
      this._annotSearchCursor = (this._annotSearchCursor + dir + count) % count;
      searchCount.textContent = `${this._annotSearchCursor + 1} / ${count}`;
      this._annotApplySearchHighlights(panel);
      this._annotScrollToMatch(panel, this._annotSearchCursor);
    };

    searchInput.addEventListener("input", _updateSearch);
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); _navSearch(e.shiftKey ? -1 : 1); }
      if (e.key === "Escape") { searchInput.value = ""; _updateSearch(); }
    });
    searchPrev.addEventListener("click", () => _navSearch(-1));
    searchNext.addEventListener("click", () => _navSearch(1));

    searchWrap.appendChild(searchInput);
    searchWrap.appendChild(searchPrev);
    searchWrap.appendChild(searchNext);
    searchWrap.appendChild(searchCount);

    const viewToggle = document.createElement("button");
    viewToggle.className = "annot-btn-view-toggle";
    viewToggle.title = "Basculer entre vue lecture (prose color\u00e9e) et vue annotation (grille)";
    const _updateToggleLabel = (): void => {
      viewToggle.textContent = this._annotViewMode === "read" ? "\u25a6\u00a0Annoter" : "\u25a4\u00a0Lecture";
      viewToggle.classList.toggle("annot-btn-view-toggle--read", this._annotViewMode === "read");
    };
    _updateToggleLabel();
    viewToggle.addEventListener("click", () => {
      this._annotViewMode = this._annotViewMode === "read" ? "annotate" : "read";
      _updateToggleLabel();
      const v = panel.querySelector<HTMLElement>(".annot-viewer");
      const e = panel.querySelector<HTMLElement>(".annot-editor");
      if (v && e) this._annotRenderInterlinear(v, e);
    });

    toolbar.appendChild(title);
    toolbar.appendChild(viewToggle);
    toolbar.appendChild(modelLabel);
    toolbar.appendChild(refreshBtn);
    toolbar.appendChild(runBtn);
    toolbar.appendChild(statusSpan);
    toolbar.appendChild(searchWrap);
    panel.appendChild(toolbar);

    // ── Layout: sidebar + viewer + editor ────────────────────────────────────
    const layout = document.createElement("div");
    layout.className = "annot-layout";

    const sidebar = document.createElement("div");
    sidebar.className = "annot-sidebar";
    sidebar.innerHTML = `<p class="annot-sidebar-loading">Chargement\u2026</p>`;

    const viewer = document.createElement("div");
    viewer.className = "annot-viewer";
    viewer.innerHTML = `<p class="annot-placeholder">S\u00e9lectionnez un document dans la liste.</p>`;

    const editor = document.createElement("div");
    editor.className = "annot-editor";
    editor.innerHTML = `<p class="annot-placeholder">Cliquez sur un token.</p>`;

    layout.appendChild(sidebar);
    layout.appendChild(viewer);
    layout.appendChild(editor);
    panel.appendChild(layout);

    return panel;
  }

  // ─── Doc list ─────────────────────────────────────────────────────────────

  private async _annotLoadDocs(
    sidebar: HTMLElement,
    viewer: HTMLElement,
    editor: HTMLElement,
  ): Promise<void> {
    const conn = this._getConn();
    if (!conn) { sidebar.innerHTML = `<p class="annot-error">Non connect\u00e9.</p>`; return; }
    try {
      const res = await conn.get("/documents") as {
        documents?: Array<{
          doc_id: number; title?: string; language?: string;
          annotation_status?: string; token_count?: number;
        }>
      };
      const docs = res.documents ?? [];
      this._annotDocs = docs.map(d => ({
        doc_id: d.doc_id,
        title: d.title ?? `#${d.doc_id}`,
        language: d.language ?? null,
        annotation_status: d.annotation_status,
        token_count: d.token_count,
      }));
      this._annotRenderDocList(sidebar, viewer, editor);
    } catch (err) {
      sidebar.innerHTML = `<p class="annot-error">Erreur : ${_escHtml(String(err))}</p>`;
    }
  }

  private _annotRenderDocList(
    sidebar: HTMLElement,
    viewer: HTMLElement,
    editor: HTMLElement,
  ): void {
    sidebar.innerHTML = "";
    if (this._annotDocs.length === 0) {
      sidebar.innerHTML = `<p class="annot-placeholder">Aucun document.</p>`;
      return;
    }
    const ul = document.createElement("ul");
    ul.className = "annot-doc-list";
    for (const doc of this._annotDocs) {
      const li = document.createElement("li");
      li.className = "annot-doc-item" + (doc.doc_id === this._annotSelectedDocId ? " selected" : "");
      li.dataset.docId = String(doc.doc_id);

      const nameSpan = document.createElement("span");
      nameSpan.className = "annot-doc-name";
      nameSpan.textContent = doc.title;

      const badge = document.createElement("span");
      const isAnnotated = doc.annotation_status === "annotated";
      badge.className = "annot-doc-badge" + (isAnnotated ? " annotated" : "");
      badge.title = isAnnotated ? `${doc.token_count ?? 0} tokens` : "Non annot\u00e9";
      badge.textContent = isAnnotated ? "\u2713" : "\u00b7";

      li.appendChild(nameSpan);
      li.appendChild(badge);

      li.addEventListener("click", () => {
        this._annotSelectedDocId = doc.doc_id;
        this._annotSelectedTokenId = null;
        ul.querySelectorAll(".annot-doc-item").forEach(el => el.classList.remove("selected"));
        li.classList.add("selected");
        void this._annotSelectDoc(doc.doc_id, viewer, editor);
      });
      ul.appendChild(li);
    }
    sidebar.appendChild(ul);
  }

  // ─── Token loading ────────────────────────────────────────────────────────

  private async _annotSelectDoc(
    docId: number,
    viewer: HTMLElement,
    editor: HTMLElement,
  ): Promise<void> {
    viewer.innerHTML = `<p class="annot-placeholder">Chargement des tokens\u2026</p>`;
    editor.innerHTML = `<p class="annot-placeholder">Cliquez sur un token.</p>`;
    this._annotTokens = [];
    const conn = this._getConn();
    if (!conn) return;
    try {
      const PAGE = 1000;
      const all: AnnotToken[] = [];
      let offset = 0;
      while (true) {
        const res = await conn.get(`/tokens?doc_id=${docId}&limit=${PAGE}&offset=${offset}`) as { tokens?: AnnotToken[] };
        if (!this._panel) return; // disposed while loading
        const page = res.tokens ?? [];
        all.push(...page);
        if (page.length < PAGE) break;
        offset += PAGE;
      }
      this._annotTokens = all;
      this._annotRenderInterlinear(viewer, editor);
      // Re-apply search highlights if a query is active
      if (this._annotSearchQuery && this._panel) {
        this._annotSearchMatches = this._annotTokens
          .filter(tok =>
            (tok.word?.toLowerCase().includes(this._annotSearchQuery)) ||
            (tok.lemma?.toLowerCase().includes(this._annotSearchQuery)) ||
            (tok.upos?.toLowerCase().includes(this._annotSearchQuery))
          )
          .map(tok => tok.token_id);
        this._annotSearchCursor = 0;
        this._annotApplySearchHighlights(this._panel);
        if (this._annotSearchMatches.length > 0) this._annotScrollToMatch(this._panel, 0);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      viewer.innerHTML = `<p class="annot-error">Erreur chargement tokens\u00a0: ${_escHtml(msg)}</p>`;
    }
  }

  // ─── Interlinear renderer ─────────────────────────────────────────────────

  private _annotRenderInterlinear(viewer: HTMLElement, editor: HTMLElement): void {
    viewer.innerHTML = "";

    const doc = this._annotDocs.find(d => d.doc_id === this._annotSelectedDocId);
    if (doc) {
      const docHeader = document.createElement("div");
      docHeader.className = "annot-doc-header";
      const lang = doc.language ? ` · ${_escHtml(doc.language)}` : "";
      const tokens = this._annotTokens.length > 0 ? ` · ${this._annotTokens.length}\u00a0tokens` : "";
      docHeader.innerHTML = `<span class="annot-doc-header-title">${_escHtml(doc.title)}</span><span class="annot-doc-header-meta">${lang}${tokens}</span>`;
      viewer.appendChild(docHeader);
    }

    if (this._annotTokens.length === 0) {
      const p = document.createElement("p");
      p.className = "annot-placeholder";
      p.textContent = "Aucun token \u2014 lancez l\u2019annotation spaCy d\u2019abord.";
      viewer.appendChild(p);
      return;
    }

    // Group by unit_n then sent_id
    const byUnit = new Map<number, Map<number, AnnotToken[]>>();
    for (const tok of this._annotTokens) {
      if (!byUnit.has(tok.unit_n)) byUnit.set(tok.unit_n, new Map());
      const bySent = byUnit.get(tok.unit_n)!;
      if (!bySent.has(tok.sent_id)) bySent.set(tok.sent_id, []);
      bySent.get(tok.sent_id)!.push(tok);
    }

    const UPOS_COLORS: Record<string, string> = {
      NOUN: "#4e9af1", VERB: "#e07b39", ADJ: "#8e6bbf",
      ADV: "#3aab6d", PRON: "#c9a227", DET: "#5bb8c4",
      ADP: "#b0b0b0", CCONJ: "#b0b0b0", SCONJ: "#b0b0b0",
      PUNCT: "#cccccc", NUM: "#c94040", PROPN: "#2e7dbf",
      AUX: "#d97ab8", PART: "#b0b0b0", INTJ: "#e04444",
      SYM: "#999", X: "#bbb",
    };

    const PUNCT_NO_SPACE_BEFORE = new Set([".", ",", ":", ";", "!", "?", ")", "]", "}", "\u00bb", "\u2019", "\u2018"]);
    const PUNCT_NO_SPACE_AFTER  = new Set(["(", "[", "{", "\u00ab", "\u2018", "\u2019"]);
    const tokensToPlain = (tokens: AnnotToken[]): string => {
      let out = "";
      for (let i = 0; i < tokens.length; i++) {
        const word = tokens[i].word;
        const needsSpaceBefore = i > 0
          && !PUNCT_NO_SPACE_BEFORE.has(word)
          && !PUNCT_NO_SPACE_AFTER.has(tokens[i - 1].word);
        out += (needsSpaceBefore ? " " : "") + word;
      }
      return out;
    };

    // ── Read mode (prose colorée UPOS) ─────────────────────────────────────────
    if (this._annotViewMode === "read") {
      const prose = document.createElement("div");
      prose.className = "annot-prose";
      for (const [, bySent] of Array.from(byUnit.entries()).sort((a, b) => a[0] - b[0])) {
        const para = document.createElement("p");
        para.className = "annot-prose-unit";
        const allTokens = Array.from(bySent.values()).flat();
        for (let i = 0; i < allTokens.length; i++) {
          const tok = allTokens[i];
          const needsSpaceBefore = i > 0
            && !PUNCT_NO_SPACE_BEFORE.has(tok.word)
            && !PUNCT_NO_SPACE_AFTER.has(allTokens[i - 1].word);
          if (needsSpaceBefore) para.appendChild(document.createTextNode(" "));
          const span = document.createElement("span");
          span.className = "annot-prose-token";
          span.textContent = tok.word;
          span.title = [tok.upos, tok.lemma !== tok.word ? tok.lemma : null].filter(Boolean).join(" · ") || tok.word;
          span.dataset.tokenId = String(tok.token_id);
          if (tok.upos && UPOS_COLORS[tok.upos]) {
            span.style.setProperty("--upos-color", UPOS_COLORS[tok.upos]);
            span.classList.add("annot-prose-token--colored");
          }
          span.addEventListener("click", () => {
            this._annotViewMode = "annotate";
            const toggleBtn = this._panel?.querySelector<HTMLButtonElement>(".annot-btn-view-toggle");
            if (toggleBtn) {
              toggleBtn.textContent = "\u25a4\u00a0Lecture";
              toggleBtn.classList.remove("annot-btn-view-toggle--read");
            }
            this._annotSelectedTokenId = tok.token_id;
            this._annotRenderInterlinear(viewer, editor);
          });
          para.appendChild(span);
        }
        prose.appendChild(para);
      }
      viewer.appendChild(prose);
      return;
    }

    // ── Annotate mode (grille interlinéaire) ───────────────────────────────────
    for (const [unitN, bySent] of Array.from(byUnit.entries()).sort((a, b) => a[0] - b[0])) {
      const unitDiv = document.createElement("div");
      unitDiv.className = "annot-unit";

      const allUnitTokens = Array.from(bySent.values()).flat();
      const plainText = tokensToPlain(allUnitTokens);

      const unitHeader = document.createElement("div");
      unitHeader.className = "annot-unit-header";
      unitHeader.innerHTML =
        `<span class="annot-unit-n">\u00a7${unitN}</span>` +
        `<span class="annot-unit-plain">${_escHtml(plainText)}</span>`;
      unitDiv.appendChild(unitHeader);

      const sentEntries = Array.from(bySent.entries()).sort((a, b) => a[0] - b[0]);
      for (const [sentId, tokens] of sentEntries) {
        const sentWrapper = document.createElement("div");
        sentWrapper.className = "annot-sent-wrapper";

        const sentLabel = document.createElement("div");
        sentLabel.className = "annot-sent-n";
        sentLabel.textContent = sentEntries.length > 1 ? String(sentId) : "";
        sentWrapper.appendChild(sentLabel);

        const sentDiv = document.createElement("div");
        sentDiv.className = "annot-sent";

        for (const tok of tokens) {
          const cell = document.createElement("div");
          cell.className = "annot-token" + (tok.token_id === this._annotSelectedTokenId ? " selected" : "");
          cell.dataset.tokenId = String(tok.token_id);

          const wordEl = document.createElement("div");
          wordEl.className = "annot-word";
          wordEl.textContent = tok.word;

          const uposEl = document.createElement("div");
          uposEl.className = "annot-upos";
          const col = UPOS_COLORS[tok.upos ?? ""] ?? "#bbb";
          if (tok.upos) {
            uposEl.textContent = tok.upos;
            uposEl.style.background = col + "28";
            uposEl.style.color = col;
          } else {
            uposEl.textContent = "";
            uposEl.style.background = "transparent";
          }

          const lemmaEl = document.createElement("div");
          lemmaEl.className = "annot-lemma";
          const lemmaVal = tok.lemma ?? "";
          lemmaEl.textContent = lemmaVal && lemmaVal.toLowerCase() !== tok.word.toLowerCase()
            ? lemmaVal : "";

          cell.appendChild(wordEl);
          cell.appendChild(uposEl);
          cell.appendChild(lemmaEl);

          cell.addEventListener("click", () => {
            this._annotSelectedTokenId = tok.token_id;
            viewer.querySelectorAll(".annot-token").forEach(el => el.classList.remove("selected"));
            cell.classList.add("selected");
            this._annotRenderEditor(tok, editor);
          });

          sentDiv.appendChild(cell);
        }

        sentWrapper.appendChild(sentDiv);
        unitDiv.appendChild(sentWrapper);
      }

      viewer.appendChild(unitDiv);
    }
  }

  // ─── Token editor ─────────────────────────────────────────────────────────

  private _annotRenderEditor(tok: AnnotToken, editor: HTMLElement): void {
    const UPOS_LIST = [
      "ADJ","ADP","ADV","AUX","CCONJ","DET","INTJ","NOUN","NUM",
      "PART","PRON","PROPN","PUNCT","SCONJ","SYM","VERB","X",
    ];
    editor.innerHTML = `
      <div class="annot-editor-header">Token #${tok.token_id}</div>
      <label class="annot-field-label">Mot
        <input class="annot-field" data-field="word" value="${_escHtml(tok.word)}">
      </label>
      <label class="annot-field-label">Lemme
        <input class="annot-field" data-field="lemma" value="${_escHtml(tok.lemma ?? "")}">
      </label>
      <label class="annot-field-label">UPOS
        <select class="annot-field" data-field="upos">
          <option value="">(vide)</option>
          ${UPOS_LIST.map(u => `<option value="${u}"${tok.upos === u ? " selected" : ""}>${u}</option>`).join("")}
        </select>
      </label>
      <label class="annot-field-label">XPOS
        <input class="annot-field" data-field="xpos" value="${_escHtml(tok.xpos ?? "")}">
      </label>
      <label class="annot-field-label">Feats
        <input class="annot-field" data-field="feats" value="${_escHtml(tok.feats ?? "")}">
      </label>
      <label class="annot-field-label">Misc
        <input class="annot-field" data-field="misc" value="${_escHtml(tok.misc ?? "")}">
      </label>
      <button class="annot-btn-save">Enregistrer</button>
      <span class="annot-save-status"></span>
    `;
    editor.querySelector(".annot-btn-save")!.addEventListener("click", () => {
      void this._annotSaveField(tok, editor);
    });
  }

  private async _annotSaveField(tok: AnnotToken, editor: HTMLElement): Promise<void> {
    const statusEl = editor.querySelector(".annot-save-status") as HTMLElement | null;
    const get = (field: string) =>
      (editor.querySelector(`[data-field="${field}"]`) as HTMLInputElement | HTMLSelectElement | null)?.value ?? null;

    const payload = {
      token_id: tok.token_id,
      word: get("word") || tok.word,
      lemma: get("lemma") || null,
      upos: get("upos") || null,
      xpos: get("xpos") || null,
      feats: get("feats") || null,
      misc: get("misc") || null,
    };

    const conn = this._getConn();
    if (!conn) { if (statusEl) statusEl.textContent = "\u2717 Non connect\u00e9."; return; }
    if (statusEl) statusEl.textContent = "Enregistrement\u2026";
    try {
      await conn.post("/tokens/update", payload);
      const idx = this._annotTokens.findIndex(t => t.token_id === tok.token_id);
      if (idx >= 0) {
        this._annotTokens[idx] = { ...this._annotTokens[idx], ...payload };
      }
      if (statusEl) {
        statusEl.textContent = "\u2713";
        setTimeout(() => { if (statusEl) statusEl.textContent = ""; }, 1500);
      }
      // Refresh interlinear view with updated data
      const panel = this._panel;
      if (panel) {
        const viewer = panel.querySelector<HTMLElement>(".annot-viewer");
        if (viewer) {
          this._annotRenderInterlinear(viewer, editor);
          const updated = this._annotTokens.find(t => t.token_id === tok.token_id);
          if (updated) this._annotRenderEditor(updated, editor);
        }
      }
    } catch (err) {
      if (statusEl) statusEl.textContent = `\u2717 ${err instanceof SidecarError ? err.message : String(err)}`;
    }
  }

  // ─── Annotation job ───────────────────────────────────────────────────────

  private async _annotRunJob(panel: HTMLElement): Promise<void> {
    const conn = this._getConn();
    if (!conn) { this._annotSetStatus(panel, "Non connect\u00e9.", true); return; }
    if (this._annotSelectedDocId === null) {
      this._annotSetStatus(panel, "S\u00e9lectionnez d\u2019abord un document.", true);
      return;
    }
    if (this._annotJobPoll !== null) {
      this._annotSetStatus(panel, "Annotation d\u00e9j\u00e0 en cours\u2026", false);
      return;
    }
    const btn = panel.querySelector<HTMLButtonElement>(".annot-btn-run");
    if (btn) { btn.disabled = true; btn.textContent = "En cours\u2026"; }
    this._annotSetStatus(panel, "Lancement\u2026", false);
    try {
      const params: Record<string, unknown> = { doc_id: this._annotSelectedDocId };
      if (this._annotModelOverride) params.model = this._annotModelOverride;
      const res = await conn.post("/jobs/enqueue", { kind: "annotate", params });
      const enqueued = res as { job?: { job_id?: string } };
      this._annotJobId = enqueued.job?.job_id ?? null;
      if (!this._annotJobId) throw new Error("Pas de job_id dans la r\u00e9ponse");
      this._annotJobPoll = setInterval(() => { void this._annotPoll(panel); }, 1000);
    } catch (err) {
      if (btn) { btn.disabled = false; btn.textContent = "Annoter \u25b6"; }
      this._annotSetStatus(panel, `\u2717 ${err instanceof SidecarError ? err.message : String(err)}`, true);
    }
  }

  private async _annotPoll(panel: HTMLElement): Promise<void> {
    const conn = this._getConn();
    if (!this._annotJobId || !conn) return;
    try {
      const res = await conn.get(`/jobs/${this._annotJobId}`) as {
        job?: {
          status: string; error?: string;
          progress_pct?: number; progress_message?: string;
        }
      };
      const job = res.job;
      if (!job) { this._annotStopPoll(); return; }

      if (job.status === "running" && job.progress_message) {
        this._annotSetStatus(panel, job.progress_message, false);
      }

      if (job.status === "done") {
        this._annotStopPoll();
        const btn = panel.querySelector<HTMLButtonElement>(".annot-btn-run");
        if (btn) { btn.disabled = false; btn.textContent = "Annoter \u25b6"; }
        this._annotSetStatus(panel, "\u2713 Annotation termin\u00e9e.", false);
        const sidebar = panel.querySelector<HTMLElement>(".annot-sidebar");
        const viewer  = panel.querySelector<HTMLElement>(".annot-viewer");
        const editor  = panel.querySelector<HTMLElement>(".annot-editor");
        if (sidebar && viewer && editor) {
          await this._annotLoadDocs(sidebar, viewer, editor);
          if (this._annotSelectedDocId !== null) {
            await this._annotSelectDoc(this._annotSelectedDocId, viewer, editor);
          }
        }
      } else if (job.status === "error" || job.status === "cancelled") {
        this._annotStopPoll();
        const btn = panel.querySelector<HTMLButtonElement>(".annot-btn-run");
        if (btn) { btn.disabled = false; btn.textContent = "Annoter \u25b6"; }
        this._annotSetStatus(panel, `\u2717 ${job.error ?? job.status}`, true);
      }
    } catch {
      // transient error — keep polling
    }
  }

  // ─── Search helpers ───────────────────────────────────────────────────────

  private _annotApplySearchHighlights(panel: HTMLElement): void {
    panel.querySelectorAll<HTMLElement>(".annot-token--match, .annot-token--match-current").forEach(el => {
      el.classList.remove("annot-token--match", "annot-token--match-current");
    });
    if (this._annotSearchMatches.length === 0) return;
    this._annotSearchMatches.forEach((tokenId, idx) => {
      const el = panel.querySelector<HTMLElement>(`.annot-token[data-token-id="${tokenId}"]`);
      if (!el) return;
      el.classList.add(idx === this._annotSearchCursor ? "annot-token--match-current" : "annot-token--match");
    });
  }

  private _annotScrollToMatch(panel: HTMLElement, cursorIdx: number): void {
    const tokenId = this._annotSearchMatches[cursorIdx];
    if (tokenId == null) return;
    const el = panel.querySelector<HTMLElement>(`.annot-token[data-token-id="${tokenId}"]`);
    if (!el) return;
    const viewer = panel.querySelector<HTMLElement>(".annot-viewer");
    if (viewer) {
      const elRect = el.getBoundingClientRect();
      const viewerRect = viewer.getBoundingClientRect();
      const offset = elRect.top - viewerRect.top - viewerRect.height / 2 + elRect.height / 2;
      viewer.scrollBy({ top: offset, behavior: "smooth" });
    } else {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  // ─── Misc helpers ─────────────────────────────────────────────────────────

  private _annotStopPoll(): void {
    if (this._annotJobPoll !== null) {
      clearInterval(this._annotJobPoll);
      this._annotJobPoll = null;
    }
    this._annotJobId = null;
  }

  private _annotSetStatus(panel: HTMLElement, msg: string, isError: boolean): void {
    const el = panel.querySelector(".annot-status") as HTMLElement | null;
    if (!el) return;
    el.textContent = msg;
    el.style.color = isError ? "var(--color-danger, #c0392b)" : "var(--color-muted, #888)";
  }
}

// ─── Module-level helpers ─────────────────────────────────────────────────────

function _escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
