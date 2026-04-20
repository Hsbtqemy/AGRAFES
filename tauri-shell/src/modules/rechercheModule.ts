/**
 * rechercheModule.ts — Recherche grammaticale (CQL / token-level).
 *
 * Wraps POST /token_query with a CQL input, filters, paginated KWIC
 * interlinear display, and a distribution stats panel.
 */

import type { ShellContext } from "../context.ts";
import { validateCqlSyntax } from "../../../tauri-app/src/features/search.ts";
import { ensureRunning, SidecarError, type Conn } from "../../../tauri-prep/src/lib/sidecarClient.ts";

// ─── State ────────────────────────────────────────────────────────────────────

let _conn: Conn | null = null;
let _unsub: (() => void) | null = null;
let _mounted = false;
let _root: HTMLElement | null = null;

let _hits: _Hit[] = [];
let _sortOrder: "default" | "doc" | "pivot" | "left" | "right" = "default";
let _total = 0;
let _offset = 0;
let _lastQuery: _QueryParams | null = null;
let _loading = false;

// Stats (server-side, covers all hits — not just loaded page)
let _statsRows: Array<{ value: string; count: number; pct: number }> = [];
let _statsTotalPivot = 0;
let _statsLoading = false;
// Monotonic counter — incremented on every new query so in-flight stats
// fetches from a previous query are silently discarded when they arrive.
let _statsGeneration = 0;

// Collocations (server-side)
interface _CollocateRow {
  value: string;
  freq: number;
  left_freq: number;
  right_freq: number;
  corpus_freq: number;
  pmi: number;
  ll: number;
}
let _collRows: _CollocateRow[] = [];
let _collLoading = false;
let _collGeneration = 0;
let _collSortBy: "pmi" | "ll" | "freq" = "pmi";

// Aligned language filter: set of language codes to SHOW; null = all
let _alignedLangFilter: Set<string> | null = null;

const PAGE_SIZE = 50;

// ─── Types ────────────────────────────────────────────────────────────────────

interface _Token {
  token_id: number;
  position: number;
  word: string;
  lemma?: string | null;
  upos?: string | null;
  xpos?: string | null;
  feats?: string | null;
}

interface _AlignedUnit {
  unit_id: number;
  doc_id: number;
  title: string;
  language: string;
  text_norm: string;
  status: string | null;
}

interface _Hit {
  doc_id: number;
  unit_id: number;
  title: string;
  language: string;
  text_norm: string;
  sent_id: number;
  start_position: number;
  end_position: number;
  tokens: _Token[];
  context_tokens: _Token[];
  left?: string;
  match?: string;
  right?: string;
  aligned?: _AlignedUnit[];
}

interface _QueryParams {
  cql: string;
  language: string | null;
  doc_ids: number[] | null;
  window: number;
}

// ─── UPOS palette (same as ActionsScreen) ─────────────────────────────────────

const UPOS_COLORS: Record<string, string> = {
  NOUN: "#4e9af1", VERB: "#e07b39", ADJ: "#8e6bbf",
  ADV: "#3aab6d", PRON: "#c9a227", DET: "#5bb8c4",
  ADP: "#b0b0b0", CCONJ: "#b0b0b0", SCONJ: "#b0b0b0",
  PUNCT: "#cccccc", NUM: "#c94040", PROPN: "#2e7dbf",
  AUX: "#d97ab8", PART: "#b0b0b0", INTJ: "#e04444",
  SYM: "#999999", X: "#bbbbbb",
};

// ─── Module lifecycle ─────────────────────────────────────────────────────────

export async function mount(container: HTMLElement, ctx: ShellContext): Promise<void> {
  _mounted = true;
  _hits = [];
  _sortOrder = "default";
  _total = 0;
  _offset = 0;
  _loading = false;
  _lastQuery = null;
  _statsRows = [];
  _statsTotalPivot = 0;
  _statsLoading = false;
  _statsGeneration = 0;
  _collRows = [];
  _collLoading = false;
  _collGeneration = 0;
  _alignedLangFilter = null;
  // Reset quick-mode state so remount always starts clean
  _quickMode = "mot";
  _posSelection = [];

  container.innerHTML = "";
  const style = document.createElement("style");
  style.textContent = MODULE_CSS;
  container.appendChild(style);

  const root = document.createElement("div");
  root.className = "rech-root";
  container.appendChild(root);
  _root = root;

  _renderShell(root);

  // Connect to sidecar when DB path available
  const dbPath = ctx.getDbPath();
  if (dbPath) await _connect(dbPath, root);

  _unsub = ctx.onDbChange(async (path) => {
    if (!_mounted) return;
    _conn = null;
    _hits = [];
    _total = 0;
    _offset = 0;
    _lastQuery = null;
    _statsRows = [];
    _statsTotalPivot = 0;
    _statsLoading = false;
    _statsGeneration++;
    _collRows = [];
    _collLoading = false;
    _collGeneration++;
    _alignedLangFilter = null;
    if (path) await _connect(path, root);
    else _setStatus(root, "Aucune base de données sélectionnée.", true);
  });
}

export function dispose(): void {
  _mounted = false;
  _unsub?.();
  _unsub = null;
  _conn = null;
  _root = null;
  _closePopover();
}

/** Pre-fill the CQL input with *cql* and launch a search. Called by the bridge. */
export function prefill(cql: string): void {
  if (_root) _prefillAndSearch(_root, cql);
}

// ─── Connection ───────────────────────────────────────────────────────────────

async function _connect(dbPath: string, root: HTMLElement): Promise<void> {
  _setStatus(root, "Connexion au sidecar…", false);
  try {
    _conn = await ensureRunning(dbPath);
    _setStatus(root, "", false);
    await _populateDocFilter(root);
  } catch (err) {
    _setStatus(root, `Connexion impossible : ${String(err)}`, true);
  }
}

// ─── Shell layout ─────────────────────────────────────────────────────────────

function _renderShell(root: HTMLElement): void {
  root.innerHTML = `
    <div class="rech-toolbar">
      <div class="rech-toolbar-top">
        <span class="rech-title">Recherche grammaticale</span>
        <span class="rech-status-bar" aria-live="polite"></span>
      </div>

      <!-- ── Mode rapide ─────────────────────────────────────────── -->
      <div class="rech-mode-bar">
        <button class="rech-mode-btn active" data-mode="mot"   title="Rechercher une forme de mot">Mot</button>
        <button class="rech-mode-btn"         data-mode="lemme" title="Rechercher toutes les formes d'un lemme">Lemme</button>
        <button class="rech-mode-btn"         data-mode="pos"   title="Rechercher par catégorie grammaticale">POS</button>
        <button class="rech-mode-btn"         data-mode="cql"   title="Requête CQL avancée">CQL ↓</button>
      </div>

      <!-- Mot / Lemme panels -->
      <div class="rech-quick-panel rech-quick-panel--mot">
        <div class="rech-quick-row">
          <input class="rech-quick-input" type="text" placeholder="ex. liberté  ou  liber.*" spellcheck="false">
          <label class="rech-quick-cs">
            <input type="checkbox" class="rech-quick-cs-cb" checked> ignorer la casse
          </label>
          <button class="rech-btn-search">Rechercher</button>
        </div>
        <div class="rech-quick-hint">Tapez un mot ou un préfixe (wildcard <code>.*</code>). Ex&nbsp;: <code>libr.*</code> trouve <em>libre</em>, <em>liberté</em>, etc.</div>
      </div>

      <div class="rech-quick-panel rech-quick-panel--lemme" hidden>
        <div class="rech-quick-row">
          <input class="rech-quick-input" type="text" placeholder="ex. aller  ou  êtr.*" spellcheck="false">
          <label class="rech-quick-cs">
            <input type="checkbox" class="rech-quick-cs-cb" checked> ignorer la casse
          </label>
          <button class="rech-btn-search">Rechercher</button>
        </div>
        <div class="rech-quick-hint">Toutes les formes conjuguées/fléchies du lemme.</div>
      </div>

      <!-- POS panel -->
      <div class="rech-quick-panel rech-quick-panel--pos" hidden>
        <div class="rech-pos-grid">
          ${["NOUN","VERB","ADJ","ADV","PRON","DET","ADP","AUX","CCONJ","SCONJ","NUM","PROPN","PUNCT","PART","INTJ","X"].map(p =>
            `<button class="rech-pos-chip" data-pos="${p}">${p}</button>`
          ).join("")}
        </div>
        <div class="rech-pos-selection"></div>
        <div class="rech-quick-row rech-pos-actions">
          <button class="rech-pos-clear-btn" title="Effacer la sélection">✕ effacer</button>
          <button class="rech-btn-search">Rechercher</button>
        </div>
      </div>

      <!-- CQL panel (advanced) -->
      <div class="rech-quick-panel rech-quick-panel--cql" hidden>
        <div class="rech-toolbar-query">
          <textarea
            class="rech-cql-input"
            rows="1"
            spellcheck="false"
            placeholder='ex. [upos="VERB"]  ou  [upos="DET"][upos="NOUN"]'
            aria-label="Requête CQL"
          ></textarea>
          <button class="rech-btn-search">Rechercher</button>
          <button class="rech-btn-help" title="Aide CQL" aria-label="Aide sur la syntaxe CQL">?</button>
        </div>
        <div class="rech-examples">
          <span class="rech-examples-label">Exemples :</span>
          <button class="rech-eg" data-cql='[upos="VERB"]'>verbes</button>
          <button class="rech-eg" data-cql='[lemma="être"]'>formes d'être</button>
          <button class="rech-eg" data-cql='[upos="DET"][upos="NOUN"]'>DET + NOM</button>
          <button class="rech-eg" data-cql='[upos="ADJ"]{1,2}[upos="NOUN"]'>groupe nominal</button>
          <button class="rech-eg" data-cql='[upos="VERB"][] [upos="NOUN"] within s'>V __ N (phrase)</button>
        </div>
      </div>

      <div class="rech-toolbar-filters">
        <label class="rech-filter-label">Langue
          <select class="rech-filter-lang">
            <option value="">(toutes)</option>
          </select>
        </label>
        <label class="rech-filter-label">Documents
          <select class="rech-filter-docs" multiple size="1">
            <option value="">(tous)</option>
          </select>
        </label>
        <label class="rech-filter-label">Contexte
          <select class="rech-filter-window">
            <option value="5">5 tokens</option>
            <option value="10" selected>10 tokens</option>
            <option value="20">20 tokens</option>
          </select>
        </label>
        <label class="rech-filter-check">
          <input type="checkbox" class="rech-filter-within-s"> dans la phrase
        </label>
        <label class="rech-filter-check rech-filter-check--aligned" title="Afficher les segments traduits liés (requiert des alignements en base)">
          <input type="checkbox" class="rech-filter-aligned"> + traductions
        </label>
        <div class="rech-lang-pills" hidden aria-label="Filtrer les langues affichées"></div>
      </div>
    </div>

    <div class="rech-help-panel" hidden>
      <div class="rech-help-inner">
        <button class="rech-help-close" aria-label="Fermer l'aide">✕</button>
        <h3>Syntaxe CQL</h3>
        <table class="rech-help-table">
          <thead><tr><th>Attribut</th><th>Description</th><th>Exemple</th></tr></thead>
          <tbody>
            <tr><td><code>word</code></td><td>Forme exacte</td><td><code>[word="Maison"]</code></td></tr>
            <tr><td><code>lemma</code></td><td>Lemme</td><td><code>[lemma="aller"]</code></td></tr>
            <tr><td><code>upos</code></td><td>Catégorie (Universal POS)</td><td><code>[upos="VERB"]</code></td></tr>
            <tr><td><code>xpos</code></td><td>Catégorie fine (treebank)</td><td><code>[xpos="VBC"]</code></td></tr>
            <tr><td><code>feats</code></td><td>Traits morphologiques</td><td><code>[feats=".*Tense=Past.*"]</code></td></tr>
          </tbody>
        </table>
        <table class="rech-help-table">
          <thead><tr><th>Opérateur</th><th>Sens</th><th>Exemple</th></tr></thead>
          <tbody>
            <tr><td><code>[]</code></td><td>N'importe quel token</td><td><code>[upos="VERB"][]</code></td></tr>
            <tr><td><code>{m,n}</code></td><td>Répétition m à n fois</td><td><code>[]{0,3}</code></td></tr>
            <tr><td><code>&amp;</code></td><td>ET dans un token</td><td><code>[upos="NOUN" &amp; lemma="temp.*"]</code></td></tr>
            <tr><td><code>%c</code></td><td>Insensible à la casse</td><td><code>[word="Maison" %c]</code></td></tr>
            <tr><td><code>within s</code></td><td>Dans la même phrase</td><td><code>[...][...] within s</code></td></tr>
          </tbody>
        </table>
        <p class="rech-help-hint">Les valeurs sont des expressions régulières Python (<code>re.fullmatch</code>).</p>
      </div>
    </div>

    <div class="rech-body">
      <div class="rech-results">
        <div class="rech-results-header" hidden>
          <span class="rech-total-label"></span>
          <div class="rech-sort-group">
            <span class="rech-sort-label">Trier</span>
            <button class="rech-sort-btn rech-sort-btn--active" data-sort="default" title="Ordre de la requête">Défaut</button>
            <button class="rech-sort-btn" data-sort="doc" title="Trier par document">Doc</button>
            <button class="rech-sort-btn" data-sort="pivot" title="Trier par lemme du pivot">Lemme pivot</button>
            <button class="rech-sort-btn" data-sort="left" title="Trier par contexte gauche">Contexte G</button>
            <button class="rech-sort-btn" data-sort="right" title="Trier par contexte droit">Contexte D</button>
          </div>
          <button class="rech-btn-analytics" title="Distribution et collocations">📊</button>
          <button class="rech-btn-export" title="Exporter en CSV">↓ CSV</button>
        </div>
        <div class="rech-hits-list"></div>
        <div class="rech-load-more-wrap" hidden>
          <button class="rech-btn-more">Charger plus</button>
        </div>
        <div class="rech-empty" hidden>Aucune occurrence trouvée.</div>
        <div class="rech-spinner" hidden>
          <span class="rech-spinner-dot"></span> Recherche…
        </div>
      </div>

      <!-- Analytics content lives in the modal (#rech-analytics-modal), not inline -->
      <div class="rech-analytics-panel" style="display:none" aria-hidden="true">
        <div class="rech-analytics-body">
          <div class="rech-stats-panel">
            <div class="rech-stats-header">Distribution</div>
            <div class="rech-dispersion-wrap" hidden>
              <div class="rech-dispersion-title">Dispersion par document</div>
              <canvas class="rech-dispersion-chart"></canvas>
            </div>
            <div class="rech-stats-group-row">
              <span class="rech-stats-group-label">Grouper par</span>
              <select class="rech-stats-group-by">
                <option value="lemma">Lemme</option>
                <option value="upos">UPOS</option>
                <option value="word">Forme</option>
              </select>
            </div>
            <div class="rech-stats-bars"></div>
            <div class="rech-stats-reset" hidden>
              <button class="rech-btn-reset-filter">Tout afficher</button>
            </div>
          </div>
          <div class="rech-coll-panel">
            <div class="rech-coll-header">
              <span>Collocations</span>
              <div class="rech-coll-sort-group">
                <button class="rech-coll-sort-btn rech-coll-sort-btn--active" data-sort="pmi" title="Trier par PMI">PMI</button>
                <button class="rech-coll-sort-btn" data-sort="ll" title="Trier par log-vraisemblance (G²)">G²</button>
                <button class="rech-coll-sort-btn" data-sort="freq" title="Trier par fréquence">Fréq.</button>
              </div>
            </div>
            <div class="rech-coll-controls">
              <label class="rech-coll-window-label">Fenêtre ±</label>
              <select class="rech-coll-window">
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="5" selected>5</option>
                <option value="8">8</option>
              </select>
              <label class="rech-coll-by-label">Par</label>
              <select class="rech-coll-by">
                <option value="lemma" selected>Lemme</option>
                <option value="word">Forme</option>
                <option value="upos">UPOS</option>
              </select>
            </div>
            <div class="rech-coll-body"></div>
          </div>
        </div>
      </div>
    </div>
  `;

  _wireEvents(root);
}

// ─── Quick-search mode ────────────────────────────────────────────────────────

type _QuickMode = "mot" | "lemme" | "pos" | "cql";
let _quickMode: _QuickMode = "mot";
/** Sequence of tokens built in POS panel. word is optional (generates & conjunction). */
interface _PosToken { pos: string; word: string; }
let _posSelection: _PosToken[] = [];

function _escCqlVal(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function _buildQuickCql(root: HTMLElement): string | null {
  if (_quickMode === "cql") {
    const ta = root.querySelector<HTMLTextAreaElement>(".rech-cql-input");
    return ta?.value.trim() ?? null;
  }

  if (_quickMode === "mot" || _quickMode === "lemme") {
    const panel = root.querySelector<HTMLElement>(`.rech-quick-panel--${_quickMode}`);
    if (!panel) return null;
    const val = panel.querySelector<HTMLInputElement>(".rech-quick-input")?.value.trim() ?? "";
    if (!val) return null;
    const ignoreCase = panel.querySelector<HTMLInputElement>(".rech-quick-cs-cb")?.checked ?? true;
    const attr = _quickMode === "mot" ? "word" : "lemma";
    return `[${attr}="${_escCqlVal(val)}"${ignoreCase ? " %c" : ""}]`;
  }

  if (_quickMode === "pos") {
    if (_posSelection.length === 0) return null;
    return _posSelection.map(({ pos, word }) => {
      const w = word.trim();
      return w
        ? `[word="${_escCqlVal(w)}" & upos="${pos}"]`
        : `[upos="${pos}"]`;
    }).join("");
  }

  return null;
}

function _switchQuickMode(root: HTMLElement, mode: _QuickMode): void {
  _quickMode = mode;
  _closePopover();
  root.querySelectorAll<HTMLButtonElement>(".rech-mode-btn").forEach(b => {
    b.classList.toggle("active", (b.dataset.mode as _QuickMode) === mode);
  });
  root.querySelectorAll<HTMLElement>(".rech-quick-panel").forEach(p => { p.hidden = true; });
  root.querySelector<HTMLElement>(`.rech-quick-panel--${mode}`)!.hidden = false;
  // Always close help panel when leaving CQL mode
  if (mode !== "cql") {
    const hp = root.querySelector<HTMLElement>(".rech-help-panel");
    if (hp) hp.hidden = true;
  }
}

function _updatePosSelection(root: HTMLElement): void {
  const sel = root.querySelector<HTMLElement>(".rech-pos-selection")!;
  sel.innerHTML = "";

  if (_posSelection.length === 0) {
    sel.textContent = "Cliquez sur des tags pour composer une séquence.";
  } else {
    // Render each token as a small editable block
    _posSelection.forEach((tok, idx) => {
      const tag = document.createElement("span");
      tag.className = "rech-pos-token";
      const col = UPOS_COLORS[tok.pos] ?? "#888";
      tag.style.borderColor = col;

      // POS label
      const posLabel = document.createElement("span");
      posLabel.className = "rech-pos-token-label";
      posLabel.textContent = tok.pos;
      posLabel.style.background = col;

      // Optional word input
      const wordInput = document.createElement("input");
      wordInput.type = "text";
      wordInput.className = "rech-pos-token-word";
      wordInput.placeholder = "mot…";
      wordInput.value = tok.word;
      wordInput.title = 'Mot spécifique (optionnel). Ex : "It" pour chercher "It" comme ' + tok.pos;
      wordInput.addEventListener("input", () => {
        _posSelection[idx].word = wordInput.value;
      });
      wordInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); void _doSearch(root, false); }
      });

      // Remove button
      const removeBtn = document.createElement("button");
      removeBtn.className = "rech-pos-token-remove";
      removeBtn.textContent = "×";
      removeBtn.title = "Retirer ce token";
      removeBtn.addEventListener("click", () => {
        _posSelection.splice(idx, 1);
        _updatePosSelection(root);
      });

      tag.appendChild(posLabel);
      tag.appendChild(wordInput);
      tag.appendChild(removeBtn);
      sel.appendChild(tag);

      // Separator between tokens
      if (idx < _posSelection.length - 1) {
        const sep = document.createElement("span");
        sep.className = "rech-pos-sep";
        sep.textContent = "→";
        sel.appendChild(sep);
      }
    });
  }

  // Update chip colors (a chip can appear multiple times in the sequence — show as active if present at least once)
  const activePosSet = new Set(_posSelection.map(t => t.pos));
  root.querySelectorAll<HTMLButtonElement>(".rech-pos-chip").forEach(btn => {
    const pos = btn.dataset.pos ?? "";
    const col = UPOS_COLORS[pos] ?? "#888";
    const active = activePosSet.has(pos);
    btn.style.background = active ? col : "";
    btn.style.color = active ? "#fff" : col;
    btn.style.borderColor = col;
  });
}

// ─── Event wiring ─────────────────────────────────────────────────────────────

// v2: renamed key (old "agrafes.recherche.aligned" defaulted to false — now defaults to true)
const LS_ALIGNED = "agrafes.recherche.aligned.v2";

function _wireEvents(root: HTMLElement): void {
  const helpPan   = root.querySelector<HTMLElement>(".rech-help-panel")!;
  const closeH    = root.querySelector<HTMLButtonElement>(".rech-help-close")!;
  const moreBtn   = root.querySelector<HTMLButtonElement>(".rech-btn-more")!;
  const groupSel  = root.querySelector<HTMLSelectElement>(".rech-stats-group-by")!;
  const resetBtn  = root.querySelector<HTMLButtonElement>(".rech-btn-reset-filter")!;
  const analyticsBtn = root.querySelector<HTMLButtonElement>(".rech-btn-analytics")!;
  const exportBtn = root.querySelector<HTMLButtonElement>(".rech-btn-export")!;
  const alignedCb = root.querySelector<HTMLInputElement>(".rech-filter-aligned")!;

  // Restore persisted toggle state; default ON (traductions alignées visibles par défaut)
  try {
    const stored = localStorage.getItem(LS_ALIGNED);
    alignedCb.checked = stored === null ? true : stored === "1";
  } catch { alignedCb.checked = true; }

  // Toggle change: persist + relaunch search if results exist
  alignedCb.addEventListener("change", () => {
    try { localStorage.setItem(LS_ALIGNED, alignedCb.checked ? "1" : "0"); } catch { /* ignore */ }
    const pillsWrap = root.querySelector<HTMLElement>(".rech-lang-pills");
    if (pillsWrap) pillsWrap.hidden = !alignedCb.checked;
    if (_lastQuery) void _doSearch(root, false);
  });

  // Init pills visibility based on initial checkbox state
  {
    const pillsWrap = root.querySelector<HTMLElement>(".rech-lang-pills");
    if (pillsWrap) pillsWrap.hidden = !alignedCb.checked;
  }

  // ── Mode bar ──
  root.querySelectorAll<HTMLButtonElement>(".rech-mode-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      _switchQuickMode(root, btn.dataset.mode as _QuickMode);
    });
  });

  // ── Quick input: Mot / Lemme — Enter submits ──
  root.querySelectorAll<HTMLInputElement>(".rech-quick-input").forEach(inp => {
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); void _doSearch(root, false); }
    });
  });

  // ── POS chips ──
  root.querySelectorAll<HTMLButtonElement>(".rech-pos-chip").forEach(chip => {
    const pos = chip.dataset.pos ?? "";
    const col = UPOS_COLORS[pos] ?? "#888";
    chip.style.borderColor = col;
    chip.style.color = col;
    chip.addEventListener("click", () => {
      // Always append — allows repeated POS (e.g. NOUN VERB NOUN)
      _posSelection.push({ pos, word: "" });
      _updatePosSelection(root);
    });
  });

  // POS clear — also remove last token on repeated click of same chip
  root.querySelector<HTMLButtonElement>(".rech-pos-clear-btn")?.addEventListener("click", () => {
    _posSelection = [];
    _updatePosSelection(root);
  });

  // Backspace on POS panel: remove last token
  root.querySelector<HTMLElement>(".rech-quick-panel--pos")?.addEventListener("keydown", (e) => {
    if (e.key === "Backspace" && (e.target as HTMLElement).tagName !== "INPUT") {
      if (_posSelection.length > 0) { _posSelection.pop(); _updatePosSelection(root); }
    }
  });

  _updatePosSelection(root);

  // ── CQL textarea: auto-resize + Enter submit ──
  const cqlInput = root.querySelector<HTMLTextAreaElement>(".rech-cql-input");
  if (cqlInput) {
    cqlInput.addEventListener("input", () => {
      cqlInput.style.height = "auto";
      cqlInput.style.height = Math.min(cqlInput.scrollHeight, 120) + "px";
    });
    cqlInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void _doSearch(root, false); }
    });
  }

  // ── All "Rechercher" buttons ──
  root.querySelectorAll<HTMLButtonElement>(".rech-btn-search").forEach(b => {
    b.addEventListener("click", () => void _doSearch(root, false));
  });

  moreBtn.addEventListener("click", () => void _doSearch(root, true));

  // ── Help (CQL panel only) ──
  root.querySelector<HTMLButtonElement>(".rech-btn-help")?.addEventListener("click", () => {
    helpPan.hidden = !helpPan.hidden;
  });
  closeH.addEventListener("click", () => { helpPan.hidden = true; });

  // ── Example chips (CQL mode) ──
  root.querySelectorAll<HTMLButtonElement>(".rech-eg").forEach(chip => {
    chip.addEventListener("click", () => {
      if (!cqlInput) return;
      cqlInput.value = chip.dataset.cql ?? "";
      cqlInput.dispatchEvent(new Event("input"));
      cqlInput.focus();
    });
  });

  // Stats group-by change → re-fetch from server with new attribute.
  // Cancel any in-flight stats request (increment generation + reset flag) so
  // the change is never silently dropped by the _statsLoading guard.
  groupSel.addEventListener("change", () => {
    if (!_lastQuery) return;
    _statsGeneration++;
    _statsLoading = false;
    // Clear active filter — it refers to the previous group_by's values.
    root.dataset.statsFilter = "";
    root.querySelector<HTMLElement>(".rech-stats-reset")!.hidden = true;
    void _fetchStats(root, groupSel.value);
  });

  // Reset stats filter
  resetBtn.addEventListener("click", () => {
    root.dataset.statsFilter = "";
    root.querySelector<HTMLElement>(".rech-stats-reset")!.hidden = true;
    _renderHits(root, _hits);
    _renderStats(root);
  });

  // Analytics modal (Distribution + Collocations)
  analyticsBtn.addEventListener("click", () => _openAnalyticsModal(root));

  // Export CSV
  exportBtn.addEventListener("click", () => _doExportCsv(root));

  // Sort buttons
  root.querySelectorAll<HTMLButtonElement>(".rech-sort-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      _sortOrder = (btn.dataset.sort ?? "default") as typeof _sortOrder;
      root.querySelectorAll<HTMLButtonElement>(".rech-sort-btn").forEach(b => {
        b.classList.toggle("rech-sort-btn--active", b === btn);
      });
      _renderHits(root, _hits);
    });
  });

  // Collocation sort buttons
  root.querySelectorAll<HTMLButtonElement>(".rech-coll-sort-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      if (!_lastQuery) return;
      _collSortBy = (btn.dataset.sort ?? "pmi") as typeof _collSortBy;
      root.querySelectorAll<HTMLButtonElement>(".rech-coll-sort-btn").forEach(b => {
        b.classList.toggle("rech-coll-sort-btn--active", b === btn);
      });
      _collGeneration++;
      _collLoading = false;
      void _fetchCollocates(root);
    });
  });

  // Collocation window/by change
  const collWindowSel = root.querySelector<HTMLSelectElement>(".rech-coll-window");
  const collBySel = root.querySelector<HTMLSelectElement>(".rech-coll-by");
  const _refetchColl = () => {
    if (!_lastQuery) return;
    _collGeneration++;
    _collLoading = false;
    void _fetchCollocates(root);
  };
  collWindowSel?.addEventListener("change", _refetchColl);
  collBySel?.addEventListener("change", _refetchColl);
}

// ─── Populate document filter ─────────────────────────────────────────────────

async function _populateDocFilter(root: HTMLElement): Promise<void> {
  if (!_conn) return;
  try {
    const res = await _conn.get("/documents") as {
      documents?: Array<{ doc_id: number; title?: string; language?: string }>;
    };
    const docs = res.documents ?? [];

    // Languages
    const langSel = root.querySelector<HTMLSelectElement>(".rech-filter-lang")!;
    // Clear previous options (keep only the static "(toutes)" placeholder)
    langSel.innerHTML = `<option value="">(toutes)</option>`;
    const langs = [...new Set(docs.map(d => d.language ?? "").filter(Boolean))].sort();
    langs.forEach(lang => {
      const opt = document.createElement("option");
      opt.value = lang; opt.textContent = lang;
      langSel.appendChild(opt);
    });

    // Documents
    const docSel = root.querySelector<HTMLSelectElement>(".rech-filter-docs")!;
    // Remove placeholder
    docSel.innerHTML = "";
    const allOpt = document.createElement("option");
    allOpt.value = ""; allOpt.textContent = "(tous)"; allOpt.selected = true;
    docSel.appendChild(allOpt);
    docs.forEach(doc => {
      const opt = document.createElement("option");
      opt.value = String(doc.doc_id);
      opt.textContent = doc.title ?? `#${doc.doc_id}`;
      docSel.appendChild(opt);
    });
    // Make it a reasonable height
    docSel.size = Math.min(docs.length + 1, 4);
  } catch { /* non-fatal */ }
}

// ─── Prefill helper ──────────────────────────────────────────────────────────

/**
 * Pre-fill the CQL textarea with *cql* and immediately launch a new search.
 * Called by the pivot token popover and by the window bridge.
 */
function _prefillAndSearch(root: HTMLElement, cql: string): void {
  // Always switch to CQL mode so the user can see the injected query
  _switchQuickMode(root, "cql");
  const input = root.querySelector<HTMLTextAreaElement>(".rech-cql-input");
  if (!input) return;
  input.value = cql;
  // Trigger auto-resize
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 120) + "px";
  // Scroll toolbar into view
  root.querySelector(".rech-toolbar")?.scrollIntoView({ block: "nearest" });
  void _doSearch(root, false);
}

// ─── Search ───────────────────────────────────────────────────────────────────

async function _doSearch(root: HTMLElement, loadMore: boolean): Promise<void> {
  if (!_conn) { _setStatus(root, "Non connecté.", true); return; }
  if (_loading) return;

  const langSel   = root.querySelector<HTMLSelectElement>(".rech-filter-lang")!;
  const docSel    = root.querySelector<HTMLSelectElement>(".rech-filter-docs")!;
  const windowSel = root.querySelector<HTMLSelectElement>(".rech-filter-window")!;
  const withinCb  = root.querySelector<HTMLInputElement>(".rech-filter-within-s")!;
  const alignedCb = root.querySelector<HTMLInputElement>(".rech-filter-aligned")!;

  let cql = _buildQuickCql(root) ?? "";
  if (!cql) {
    const hint = _quickMode === "pos"
      ? "Sélectionnez au moins une catégorie POS."
      : "Saisissez un terme à rechercher.";
    _setStatus(root, hint, true);
    return;
  }

  // Inject "within s" suffix if checkbox checked and not already present
  if (withinCb.checked && !cql.includes("within s")) cql += " within s";

  const cqlErr = validateCqlSyntax(cql);
  if (cqlErr) {
    _setStatus(root, `CQL invalide : ${cqlErr} — utilisez des clauses entre crochets, ex. [word = "…"] ou [lemma = "…"].`, true);
    return;
  }

  const language = langSel.value || null;
  const selectedDocIds = Array.from(docSel.selectedOptions)
    .map(o => parseInt(o.value))
    .filter(v => !isNaN(v));
  const doc_ids = selectedDocIds.length > 0 ? selectedDocIds : null;
  const ctxWindow = parseInt(windowSel.value) || 10;

  const params: _QueryParams = { cql, language, doc_ids, window: ctxWindow };

  if (!loadMore) {
    // New query — reset state (including any in-flight stats)
    _hits = [];
    _total = 0;
    _offset = 0;
    _lastQuery = params;
    _statsRows = [];
    _statsTotalPivot = 0;
    _statsLoading = false;
    _statsGeneration++;
    _collRows = [];
    _collLoading = false;
    _collGeneration++;
    _alignedLangFilter = null;
    root.dataset.statsFilter = "";
    _renderHits(root, []);
    _renderStats(root);
    _renderCollocates(root);
  } else if (!_lastQuery) {
    return;
  }

  _loading = true;
  _showSpinner(root, true);
  _setStatus(root, "Recherche…", false);

  try {
    const includeAligned = alignedCb?.checked ?? false;
    const payload: Record<string, unknown> = {
      cql: _lastQuery!.cql,
      mode: "kwic",
      window: _lastQuery!.window,
      limit: PAGE_SIZE,
      offset: _offset,
      include_aligned: includeAligned,
    };
    if (_lastQuery!.language) payload.language = _lastQuery!.language;
    if (_lastQuery!.doc_ids) payload.doc_ids = _lastQuery!.doc_ids;

    const res = await _conn.post("/token_query", payload) as {
      hits?: _Hit[];
      total?: number;
      has_more?: boolean;
      next_offset?: number | null;
    };

    const newHits = res.hits ?? [];
    _total = res.total ?? (_hits.length + newHits.length);
    _hits = loadMore ? [..._hits, ...newHits] : newHits;
    _offset = res.next_offset ?? _hits.length;

    _renderHits(root, _hits);
    if (includeAligned) {
      _updateLangPills(root, _hits);
      _applyLangFilter(root);
    }
    _updateResultsHeader(root, _total);
    _showLoadMore(root, res.has_more ?? false);
    const hasAligned = includeAligned && _hits.some(h => h.aligned && h.aligned.length > 0);
    const alignedNote = includeAligned && !hasAligned && _hits.length > 0
      ? " · (aucune traduction alignée trouvée)" : "";
    _setStatus(root, _total === 0 ? "" : `${_total} occurrence${_total > 1 ? "s" : ""}${alignedNote}`, false);
    root.querySelector<HTMLElement>(".rech-empty")!.hidden = _hits.length > 0;

    // Persist last successful query so the Publier screen can offer a direct re-export
    if (!loadMore && _lastQuery) {
      try {
        sessionStorage.setItem("agrafes.rg.lastQuery", JSON.stringify({
          cql: _lastQuery.cql,
          language: _lastQuery.language,
          doc_ids: _lastQuery.doc_ids,
          window: _lastQuery.window,
          total: _total,
          ts: new Date().toISOString(),
        }));
      } catch { /* storage full or private mode */ }
    }

    // Fetch server-side stats only on new query (not load-more) and only if there are hits
    if (!loadMore && _hits.length > 0) {
      const groupBy = root.querySelector<HTMLSelectElement>(".rech-stats-group-by")?.value ?? "lemma";
      void _fetchStats(root, groupBy);
      void _renderDispersionChart(root, _hits);
      void _fetchCollocates(root);
      // Show analytics button as active when results arrive
      const analyticsBtn = root.querySelector<HTMLButtonElement>(".rech-btn-analytics");
      if (analyticsBtn) analyticsBtn.title = "Distribution et collocations (données disponibles)";
    } else if (!loadMore) {
      const wrap = root.querySelector<HTMLElement>(".rech-dispersion-wrap");
      if (wrap) wrap.hidden = true;
    }
  } catch (err) {
    const msg = err instanceof SidecarError ? err.message : String(err);
    _setStatus(root, `Erreur : ${msg}`, true);
  } finally {
    _loading = false;
    _showSpinner(root, false);
  }
}

// ─── Render hits ──────────────────────────────────────────────────────────────

function _sortedHits(hits: _Hit[]): _Hit[] {
  if (_sortOrder === "default") return hits;
  return [...hits].sort((a, b) => {
    if (_sortOrder === "doc") {
      return (a.title ?? "").localeCompare(b.title ?? "", "fr") || a.unit_id - b.unit_id;
    }
    if (_sortOrder === "pivot") {
      const la = _pivotTokens(a).map(t => t.lemma ?? t.word).join(" ");
      const lb = _pivotTokens(b).map(t => t.lemma ?? t.word).join(" ");
      return la.localeCompare(lb, "fr");
    }
    if (_sortOrder === "left") {
      const la = (a.context_tokens ?? []).filter(t => t.position < a.start_position).map(t => t.word).join(" ");
      const lb = (b.context_tokens ?? []).filter(t => t.position < b.start_position).map(t => t.word).join(" ");
      // Reverse left context so last word before pivot is primary sort key
      const ra = la.split(" ").reverse().join(" ");
      const rb = lb.split(" ").reverse().join(" ");
      return ra.localeCompare(rb, "fr");
    }
    if (_sortOrder === "right") {
      const ra = (a.context_tokens ?? []).filter(t => t.position > a.end_position).map(t => t.word).join(" ");
      const rb = (b.context_tokens ?? []).filter(t => t.position > b.end_position).map(t => t.word).join(" ");
      return ra.localeCompare(rb, "fr");
    }
    return 0;
  });
}

function _renderHits(root: HTMLElement, hits: _Hit[]): void {
  const list = root.querySelector<HTMLElement>(".rech-hits-list")!;
  list.innerHTML = "";

  const statsFilter = root.dataset.statsFilter ?? "";
  const groupBy = root.querySelector<HTMLSelectElement>(".rech-stats-group-by")?.value ?? "lemma";

  const filtered = statsFilter
    ? hits.filter(h => {
        const pivotTokens = _pivotTokens(h);
        return pivotTokens.some(t => {
          const val = groupBy === "lemma" ? (t.lemma ?? t.word)
                    : groupBy === "upos"  ? (t.upos ?? "")
                    : t.word;
          return val === statsFilter;
        });
      })
    : hits;

  for (const hit of _sortedHits(filtered)) {
    list.appendChild(_buildHitCard(hit));
  }
}

async function _renderDispersionChart(root: HTMLElement, hits: _Hit[]): Promise<void> {
  const wrap = root.querySelector<HTMLElement>(".rech-dispersion-wrap");
  const canvas = root.querySelector<HTMLCanvasElement>(".rech-dispersion-chart");
  if (!wrap || !canvas) return;

  if (hits.length === 0) { wrap.hidden = true; return; }

  // Count hits per document title
  const countByDoc = new Map<string, number>();
  for (const h of hits) {
    const key = h.title || `doc#${h.doc_id}`;
    countByDoc.set(key, (countByDoc.get(key) ?? 0) + 1);
  }
  const labels = [...countByDoc.keys()];
  const data   = labels.map(l => countByDoc.get(l)!);

  // Lazy-load Chart.js
  let Chart: typeof import("chart.js").Chart;
  try {
    const mod = await import("chart.js/auto");
    Chart = mod.default;
  } catch {
    wrap.hidden = true;
    return;
  }

  wrap.hidden = false;

  // Destroy previous chart if any
  const existing = (canvas as HTMLCanvasElement & { _chartInstance?: import("chart.js").Chart })._chartInstance;
  if (existing) existing.destroy();

  const maxLabelLen = 18;
  const shortLabels = labels.map(l => l.length > maxLabelLen ? l.slice(0, maxLabelLen) + "…" : l);

  const chartH = Math.max(120, labels.length * 28);
  canvas.style.height = chartH + "px";
  canvas.height = chartH;

  const instance = new Chart(canvas, {
    type: "bar",
    data: {
      labels: shortLabels,
      datasets: [{
        label: "Occurrences",
        data,
        backgroundColor: "rgba(46,184,154,0.6)",
        borderColor: "rgba(46,184,154,1)",
        borderWidth: 1,
        borderRadius: 3,
      }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => labels[items[0].dataIndex] ?? "",
          },
        },
      },
      scales: {
        x: { beginAtZero: true, ticks: { precision: 0, font: { size: 10 } } },
        y: { ticks: { font: { size: 10 } } },
      },
    },
  });
  (canvas as HTMLCanvasElement & { _chartInstance?: import("chart.js").Chart })._chartInstance = instance;
}

function _pivotTokens(hit: _Hit): _Token[] {
  // The pivot tokens are those within start_position..end_position in context_tokens
  return hit.context_tokens.filter(t =>
    t.position >= hit.start_position && t.position <= hit.end_position
  );
}

function _buildHitCard(hit: _Hit): HTMLElement {
  const card = document.createElement("div");
  card.className = "rech-hit";

  // Header: doc title + position info
  const header = document.createElement("div");
  header.className = "rech-hit-header";
  header.innerHTML =
    `<span class="rech-hit-doc">${_esc(hit.title)}</span>` +
    `<span class="rech-hit-lang">${_esc(hit.language || "")}</span>` +
    `<span class="rech-hit-loc" title="Segment ${hit.unit_id}${hit.sent_id > 1 ? ` \u2014 phrase\u202f${hit.sent_id} dans ce segment` : ""}">seg.\u202f${hit.unit_id}${hit.sent_id > 1 ? `\u202f\u00b7\u202fph.\u202f${hit.sent_id}` : ""}</span>`;
  card.appendChild(header);

  // Interlinear KWIC row
  const kwicRow = document.createElement("div");
  kwicRow.className = "rech-kwic-row";

  // Split context_tokens into left / pivot / right
  const ctx = hit.context_tokens ?? [];
  const pivotStart = hit.start_position;
  const pivotEnd   = hit.end_position;

  const left   = ctx.filter(t => t.position < pivotStart);
  const pivot  = ctx.filter(t => t.position >= pivotStart && t.position <= pivotEnd);
  const right  = ctx.filter(t => t.position > pivotEnd);

  const hitCtx = { doc_id: hit.doc_id, unit_id: hit.unit_id };
  if (left.length)  kwicRow.appendChild(_buildTokenGroup(left, "left"));
  if (pivot.length) kwicRow.appendChild(_buildTokenGroup(pivot, "pivot", hitCtx));
  if (right.length) kwicRow.appendChild(_buildTokenGroup(right, "right"));

  if (kwicRow.hasChildNodes()) card.appendChild(kwicRow);

  // Aligned translations (only when include_aligned=true and has partners)
  if (hit.aligned && hit.aligned.length > 0) {
    const alBlock = document.createElement("div");
    alBlock.className = "rech-aligned-block";
    for (const partner of hit.aligned) {
      const row = document.createElement("div");
      row.className = "rech-aligned-row";
      row.dataset.lang = (partner.language ?? "").toLowerCase();

      const langBadge = document.createElement("span");
      langBadge.className = "rech-aligned-lang";
      langBadge.textContent = partner.language.toUpperCase();

      const text = document.createElement("span");
      text.className = "rech-aligned-text";
      text.textContent = partner.text_norm;

      const statusBadge = document.createElement("span");
      statusBadge.className = `rech-aligned-status rech-aligned-status--${partner.status ?? "none"}`;
      statusBadge.textContent =
        partner.status === "accepted" ? "✓ accepté"
        : partner.status === "rejected" ? "✗ rejeté"
        : "non révisé";

      row.appendChild(langBadge);
      row.appendChild(text);
      row.appendChild(statusBadge);
      alBlock.appendChild(row);
    }
    card.appendChild(alBlock);
  }

  // Actions bar
  const actionsBar = document.createElement("div");
  actionsBar.className = "rech-hit-actions";
  actionsBar.appendChild(_buildCitationBtn(hit));
  card.appendChild(actionsBar);

  return card;
}

// ─── Analytics modal ──────────────────────────────────────────────────────────

function _openAnalyticsModal(root: HTMLElement): void {
  // Remove existing modal if open (toggle)
  const existing = document.getElementById("rech-analytics-modal");
  if (existing) { existing.remove(); return; }

  // The analytics panel (hidden in main layout) is our source of truth
  const panel = root.querySelector<HTMLElement>(".rech-analytics-panel");
  if (!panel) return;

  const overlay = document.createElement("div");
  overlay.id = "rech-analytics-modal";
  overlay.className = "rech-analytics-modal-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Distribution et collocations");

  const box = document.createElement("div");
  box.className = "rech-analytics-modal-box";

  // Header
  const header = document.createElement("div");
  header.className = "rech-analytics-modal-header";
  const title = document.createElement("span");
  title.textContent = "Distribution & Collocations";
  title.style.cssText = "font-weight:700;font-size:1rem";
  const closeBtn = document.createElement("button");
  closeBtn.className = "rech-analytics-modal-close";
  closeBtn.textContent = "✕";
  closeBtn.setAttribute("aria-label", "Fermer");
  closeBtn.addEventListener("click", () => overlay.remove());
  header.appendChild(title);
  header.appendChild(closeBtn);
  box.appendChild(header);

  // Body: move the analytics content in (it stays in DOM, just repositioned visually)
  const body = panel.querySelector<HTMLElement>(".rech-analytics-body");
  if (body) {
    const bodyClone = body.cloneNode(true) as HTMLElement;
    bodyClone.style.cssText = "display:flex;flex-direction:row;gap:16px;flex:1;min-height:0;overflow:hidden";
    // Stats panel side
    const statsPanel = bodyClone.querySelector<HTMLElement>(".rech-stats-panel");
    if (statsPanel) statsPanel.style.cssText = "flex:0 0 260px;overflow-y:auto;border-right:1px solid #e0e0e0;padding:12px";
    // Coll panel side
    const collPanel = bodyClone.querySelector<HTMLElement>(".rech-coll-panel");
    if (collPanel) collPanel.style.cssText = "flex:1;overflow-y:auto;padding:12px";
    box.appendChild(bodyClone);

    // Wire select changes in clone back to the real panel (so data re-renders into real DOM)
    bodyClone.querySelector<HTMLSelectElement>(".rech-stats-group-by")?.addEventListener("change", (e) => {
      const realSel = panel.querySelector<HTMLSelectElement>(".rech-stats-group-by");
      if (realSel) {
        realSel.value = (e.target as HTMLSelectElement).value;
        realSel.dispatchEvent(new Event("change"));
      }
    });
    bodyClone.querySelectorAll<HTMLButtonElement>(".rech-coll-sort-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const sort = btn.dataset.sort ?? "";
        panel.querySelectorAll<HTMLButtonElement>(".rech-coll-sort-btn").forEach(b =>
          b.classList.toggle("rech-coll-sort-btn--active", b.dataset.sort === sort)
        );
        const realBtn = panel.querySelector<HTMLButtonElement>(`.rech-coll-sort-btn[data-sort="${sort}"]`);
        if (realBtn) realBtn.click();
      });
    });
  }

  overlay.appendChild(box);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.addEventListener("keydown", function esc(e) {
    if (e.key === "Escape") { overlay.remove(); document.removeEventListener("keydown", esc); }
  }, { once: false });

  document.body.appendChild(overlay);
}

function _buildCitationText(hit: _Hit): string {
  const lang = (hit.language ?? "?").toUpperCase();
  // Location: always show segment; show phrase only if > 1 (segmentation per sentence → sent_id always 1)
  const loc = hit.sent_id > 1
    ? `seg.\u202f${hit.unit_id}\u202f\u00b7\u202fph.\u202f${hit.sent_id}`
    : `seg.\u202f${hit.unit_id}`;
  const lines: string[] = [
    `[${lang}] ${hit.title || "\u2014"} \u00b7 ${loc}`,
    `\u00ab${hit.text_norm}\u00bb`,
  ];
  for (const partner of hit.aligned ?? []) {
    const pLang = (partner.language ?? "?").toUpperCase();
    lines.push("", `[${pLang}] ${partner.title || "\u2014"}`, `\u00ab${partner.text_norm}\u00bb`);
  }
  return lines.join("\n");
}

function _buildCitationBtn(hit: _Hit): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = "rech-citation-btn";
  btn.title = "Copier la citation (pivot + traductions)";
  btn.type = "button";
  btn.textContent = "\uD83D\uDCC4 Citation";
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    void navigator.clipboard?.writeText(_buildCitationText(hit)).then(() => {
      btn.textContent = "\u2713 Copi\u00e9";
      btn.classList.add("rech-citation-btn--copied");
      setTimeout(() => {
        btn.textContent = "\uD83D\uDCC4 Citation";
        btn.classList.remove("rech-citation-btn--copied");
      }, 1500);
    });
  });
  return btn;
}

function _buildTokenGroup(
  tokens: _Token[],
  role: "left" | "pivot" | "right",
  hitCtx?: { doc_id: number; unit_id: number },
): HTMLElement {
  const group = document.createElement("div");
  group.className = `rech-kwic-group rech-kwic-${role}`;

  for (const tok of tokens) {
    const cell = document.createElement("div");
    cell.className = "rech-kwic-token";
    if (role === "pivot") cell.classList.add("rech-kwic-token--pivot");

    const wordEl = document.createElement("div");
    wordEl.className = "rech-kwic-word";
    wordEl.textContent = tok.word;

    const uposEl = document.createElement("div");
    uposEl.className = "rech-kwic-upos";
    const col = UPOS_COLORS[tok.upos ?? ""] ?? "#bbb";
    if (tok.upos) {
      uposEl.textContent = tok.upos;
      uposEl.style.background = col + (role === "pivot" ? "30" : "18");
      uposEl.style.color = col;
    }

    const lemmaEl = document.createElement("div");
    lemmaEl.className = "rech-kwic-lemma";
    const lemma = tok.lemma ?? "";
    lemmaEl.textContent = (lemma && lemma.toLowerCase() !== tok.word.toLowerCase()) ? lemma : "";

    cell.appendChild(wordEl);
    cell.appendChild(uposEl);
    cell.appendChild(lemmaEl);

    // Pivot tokens: click → popover with CQL suggestions; right-click → context menu
    if (role === "pivot") {
      const parts: string[] = [tok.word];
      if (tok.upos) parts.push(tok.upos);
      if (tok.lemma && tok.lemma.toLowerCase() !== tok.word.toLowerCase()) parts.push(`lemme: ${tok.lemma}`);
      cell.title = parts.join(" · ") + "\nClic : rechercher · Clic droit : options";
      cell.addEventListener("click", (e) => {
        e.stopPropagation();
        _closeContextMenu();
        _showTokenPopover(cell, tok);
      });
      if (hitCtx) {
        cell.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          e.stopPropagation();
          _closePopover();
          _showTokenContextMenu(cell, tok, hitCtx);
        });
      }
    }

    group.appendChild(cell);
  }

  return group;
}

// ─── Token pivot popover ──────────────────────────────────────────────────────

let _popoverEl: HTMLElement | null = null;
let _popoverCloseHandler: ((e: MouseEvent) => void) | null = null;

function _showTokenPopover(anchor: HTMLElement, tok: _Token): void {
  // Find the root by walking up to .rech-root
  let root: HTMLElement | null = anchor;
  while (root && !root.classList.contains("rech-root")) root = root.parentElement;
  if (!root) return;

  _closePopover();

  const pop = document.createElement("div");
  pop.className = "rech-tok-popover";
  _popoverEl = pop;

  const options: Array<{ label: string; cql: string }> = [];
  const lemma = tok.lemma?.trim();
  const word  = tok.word?.trim();
  const upos  = tok.upos?.trim();
  const feats = tok.feats?.trim();

  if (lemma) options.push({ label: `lemme = "${lemma}"`, cql: `[lemma="${lemma}"]` });
  if (word)  options.push({ label: `mot = "${word}"`,   cql: `[word="${word}"]` });
  if (upos)  options.push({ label: `POS = ${upos}`,     cql: `[upos="${upos}"]` });
  if (lemma && upos) options.push({ label: `${lemma} (${upos})`, cql: `[lemma="${lemma}" & upos="${upos}"]` });
  if (feats) options.push({ label: `feats ∋ ${feats.split("|")[0]}`, cql: `[feats=".*${feats.split("|")[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*"]` });

  if (options.length === 0) { _popoverEl = null; return; }

  const title = document.createElement("div");
  title.className = "rech-tok-popover-title";
  title.textContent = "Nouvelle recherche";
  pop.appendChild(title);

  for (const { label, cql } of options) {
    const btn = document.createElement("button");
    btn.className = "rech-tok-popover-btn";
    btn.textContent = label;
    btn.title = cql;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      _closePopover();
      _prefillAndSearch(root!, cql);
    });
    pop.appendChild(btn);
  }

  // Position below anchor
  document.body.appendChild(pop);
  const rect = anchor.getBoundingClientRect();
  pop.style.left = `${rect.left + window.scrollX}px`;
  pop.style.top  = `${rect.bottom + window.scrollY + 4}px`;

  // Adjust if off-screen right
  const popRect = pop.getBoundingClientRect();
  if (popRect.right > window.innerWidth - 8) {
    pop.style.left = `${window.innerWidth - popRect.width - 8 + window.scrollX}px`;
  }

  // Close on outside click
  _popoverCloseHandler = (e: MouseEvent) => {
    if (!pop.contains(e.target as Node)) _closePopover();
  };
  setTimeout(() => document.addEventListener("click", _popoverCloseHandler!), 0);
}

function _closePopover(): void {
  if (_popoverEl) { _popoverEl.remove(); _popoverEl = null; }
  if (_popoverCloseHandler) {
    document.removeEventListener("click", _popoverCloseHandler);
    _popoverCloseHandler = null;
  }
}

// ─── Token context menu (right-click) ─────────────────────────────────────────

let _ctxMenuEl: HTMLElement | null = null;
let _ctxMenuCloseHandler: ((e: MouseEvent) => void) | null = null;
let _ctxMenuKeyHandler: ((e: KeyboardEvent) => void) | null = null;

function _closeContextMenu(): void {
  if (_ctxMenuEl) { _ctxMenuEl.remove(); _ctxMenuEl = null; }
  if (_ctxMenuCloseHandler) { document.removeEventListener("mousedown", _ctxMenuCloseHandler); _ctxMenuCloseHandler = null; }
  if (_ctxMenuKeyHandler) { document.removeEventListener("keydown", _ctxMenuKeyHandler); _ctxMenuKeyHandler = null; }
}

function _showTokenContextMenu(
  anchor: HTMLElement,
  tok: _Token,
  hit: { doc_id: number; unit_id: number },
): void {
  _closeContextMenu();

  let root: HTMLElement | null = anchor;
  while (root && !root.classList.contains("rech-root")) root = root.parentElement;
  if (!root) return;

  const menu = document.createElement("div");
  menu.className = "rech-ctx-menu";
  menu.setAttribute("role", "menu");
  _ctxMenuEl = menu;

  // — Modifier dans Prep
  const editBtn = document.createElement("button");
  editBtn.className = "rech-ctx-item";
  editBtn.textContent = "✏ Modifier ce token dans Prep";
  editBtn.title = `Ouvre Prep sur le document #${hit.doc_id}, segment ${hit.unit_id}`;
  editBtn.addEventListener("click", () => {
    _closeContextMenu();
    try {
      sessionStorage.setItem("agrafes:prep-token-nav", JSON.stringify({
        doc_id: hit.doc_id,
        unit_id: hit.unit_id,
        token_id: tok.token_id,
      }));
    } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent("agrafes:open-prep-token", {
      detail: { doc_id: hit.doc_id, unit_id: hit.unit_id, token_id: tok.token_id },
    }));
  });
  menu.appendChild(editBtn);

  // Séparateur
  const sep = document.createElement("div");
  sep.className = "rech-ctx-sep";
  menu.appendChild(sep);

  // — Chercher ce lemme
  if (tok.lemma) {
    const lemmaBtn = document.createElement("button");
    lemmaBtn.className = "rech-ctx-item";
    lemmaBtn.textContent = `🔍 Chercher lemme "${tok.lemma}"`;
    lemmaBtn.addEventListener("click", () => {
      _closeContextMenu();
      _prefillAndSearch(root!, `[lemma="${tok.lemma}"]`);
    });
    menu.appendChild(lemmaBtn);
  }

  // — Chercher ce POS
  if (tok.upos) {
    const posBtn = document.createElement("button");
    posBtn.className = "rech-ctx-item";
    posBtn.textContent = `🔍 Chercher POS "${tok.upos}"`;
    posBtn.addEventListener("click", () => {
      _closeContextMenu();
      _prefillAndSearch(root!, `[upos="${tok.upos}"]`);
    });
    menu.appendChild(posBtn);
  }

  // Position
  document.body.appendChild(menu);
  const rect = anchor.getBoundingClientRect();
  menu.style.left = `${rect.left + window.scrollX}px`;
  menu.style.top  = `${rect.bottom + window.scrollY + 2}px`;
  const mr = menu.getBoundingClientRect();
  if (mr.right > window.innerWidth - 8) {
    menu.style.left = `${window.innerWidth - mr.width - 8 + window.scrollX}px`;
  }

  // Close handlers
  _ctxMenuCloseHandler = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) _closeContextMenu();
  };
  _ctxMenuKeyHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") _closeContextMenu();
  };
  setTimeout(() => {
    document.addEventListener("mousedown", _ctxMenuCloseHandler!);
    document.addEventListener("keydown", _ctxMenuKeyHandler!);
  }, 0);
}

// ─── Stats panel ──────────────────────────────────────────────────────────────

/**
 * Fetch frequency distribution from the server (covers ALL hits, not just
 * the loaded page). Updates _statsRows and re-renders the panel.
 */
async function _fetchStats(root: HTMLElement, groupBy: string): Promise<void> {
  if (!_conn || !_lastQuery || _statsLoading) return;
  _statsLoading = true;
  const gen = _statsGeneration;
  _renderStatsLoading(root);

  try {
    const payload: Record<string, unknown> = {
      cql: _lastQuery.cql,
      group_by: groupBy,
      limit: 25,
    };
    if (_lastQuery.language) payload.language = _lastQuery.language;
    if (_lastQuery.doc_ids)  payload.doc_ids  = _lastQuery.doc_ids;

    const res = await _conn.post("/token_stats", payload) as {
      total_pivot_tokens?: number;
      rows?: Array<{ value: string; count: number; pct: number }>;
    };

    // Discard if a new query was started while this was in-flight
    if (gen !== _statsGeneration) return;

    _statsRows = res.rows ?? [];
    _statsTotalPivot = res.total_pivot_tokens ?? 0;
    _renderStats(root);
  } catch {
    if (gen !== _statsGeneration) return;
    _statsRows = [];
    _renderStats(root);
  } finally {
    if (gen === _statsGeneration) _statsLoading = false;
  }
}

/** Show a brief loading state in the stats panel while fetching. */
function _renderStatsLoading(root: HTMLElement): void {
  const bars = root.querySelector<HTMLElement>(".rech-stats-bars")!;
  bars.innerHTML = `<div style="font-size:0.75rem;color:#aaa;padding:8px 0">Calcul…</div>`;
}

/** Render the stats panel from _statsRows (server-side data). */
function _renderStats(root: HTMLElement): void {
  const bars        = root.querySelector<HTMLElement>(".rech-stats-bars")!;
  const groupBy     = root.querySelector<HTMLSelectElement>(".rech-stats-group-by")!.value;
  const statsFilter = root.dataset.statsFilter ?? "";

  bars.innerHTML = "";

  if (_statsRows.length === 0) return;

  // Max count for proportional bar widths
  const maxCount = _statsRows[0]?.count ?? 1;

  for (const { value: val, count, pct } of _statsRows) {
    const barPct  = (count / maxCount) * 100;
    const isActive = statsFilter === val;

    const row = document.createElement("div");
    row.className = "rech-stats-row" + (isActive ? " active" : "");
    row.title = `${val} — ${count} occ. (${pct}% des pivots)`;

    const label = document.createElement("span");
    label.className = "rech-stats-val";
    label.textContent = val;

    const barWrap = document.createElement("div");
    barWrap.className = "rech-stats-bar-wrap";
    const bar = document.createElement("div");
    bar.className = "rech-stats-bar";
    bar.style.width = barPct.toFixed(1) + "%";
    if (groupBy === "upos") {
      bar.style.background = UPOS_COLORS[val] ?? "#7b3fa0";
    }
    barWrap.appendChild(bar);

    const countEl = document.createElement("span");
    countEl.className = "rech-stats-count";
    countEl.textContent = String(count);

    row.appendChild(label);
    row.appendChild(barWrap);
    row.appendChild(countEl);

    row.addEventListener("click", () => {
      if (isActive) {
        root.dataset.statsFilter = "";
        root.querySelector<HTMLElement>(".rech-stats-reset")!.hidden = true;
      } else {
        root.dataset.statsFilter = val;
        root.querySelector<HTMLElement>(".rech-stats-reset")!.hidden = false;
      }
      _renderHits(root, _hits);
      _renderStats(root);
    });

    bars.appendChild(row);
  }

  // Footnote: total pivot tokens (contextualises the percentages)
  if (_statsTotalPivot > 0) {
    const note = document.createElement("div");
    note.style.cssText = "font-size:0.68rem;color:#aaa;margin-top:6px;padding-top:4px;border-top:1px solid #eee";
    note.textContent = `${_statsTotalPivot} token${_statsTotalPivot > 1 ? "s" : ""} pivot au total`;
    bars.appendChild(note);
  }
}

// ─── Collocations ─────────────────────────────────────────────────────────────

async function _fetchCollocates(root: HTMLElement): Promise<void> {
  if (!_conn || !_lastQuery || _collLoading) return;
  _collLoading = true;
  const gen = _collGeneration;
  _renderCollLoading(root);

  const windowVal = parseInt(
    root.querySelector<HTMLSelectElement>(".rech-coll-window")?.value ?? "5",
    10,
  );
  const byVal = root.querySelector<HTMLSelectElement>(".rech-coll-by")?.value ?? "lemma";

  try {
    const payload: Record<string, unknown> = {
      cql: _lastQuery.cql,
      window: windowVal,
      by: byVal,
      limit: 30,
      min_freq: 1,
      sort_by: _collSortBy,
    };
    if (_lastQuery.language) payload.language = _lastQuery.language;
    if (_lastQuery.doc_ids)  payload.doc_ids  = _lastQuery.doc_ids;

    const res = await _conn.post("/token_collocates", payload) as {
      rows?: _CollocateRow[];
    };

    if (gen !== _collGeneration) return;
    _collRows = res.rows ?? [];
    _renderCollocates(root);
  } catch {
    if (gen !== _collGeneration) return;
    _collRows = [];
    _renderCollocates(root);
  } finally {
    if (gen === _collGeneration) _collLoading = false;
  }
}

function _renderCollLoading(root: HTMLElement): void {
  const body = root.querySelector<HTMLElement>(".rech-coll-body");
  if (body) body.innerHTML = `<div class="rech-coll-hint">Calcul…</div>`;
}

function _renderCollocates(root: HTMLElement): void {
  const body = root.querySelector<HTMLElement>(".rech-coll-body");
  if (!body) return;

  if (_collRows.length === 0) {
    body.innerHTML = `<div class="rech-coll-hint">${
      _lastQuery ? "Aucune collocation trouvée." : "Lancez une recherche pour voir les collocations."
    }</div>`;
    return;
  }

  body.innerHTML = "";

  // Table header
  const thead = document.createElement("div");
  thead.className = "rech-coll-thead";
  thead.innerHTML = `
    <span class="rech-coll-th rech-coll-th-val">Collocat</span>
    <span class="rech-coll-th rech-coll-th-num" title="Fréquence observée dans la fenêtre">Fréq.</span>
    <span class="rech-coll-th rech-coll-th-num" title="Pointwise Mutual Information">PMI</span>
    <span class="rech-coll-th rech-coll-th-num" title="Log-vraisemblance G²">G²</span>
    <span class="rech-coll-th rech-coll-th-lr" title="Gauche / Droite">G/D</span>
  `;
  body.appendChild(thead);

  const maxFreq = _collRows[0]?.freq ?? 1;

  for (const row of _collRows) {
    const el = document.createElement("div");
    el.className = "rech-coll-row";

    const pct = Math.round((row.freq / maxFreq) * 100);
    const leftPct = row.freq > 0 ? Math.round((row.left_freq / row.freq) * 100) : 50;

    // value cell — textContent to avoid XSS (corpus data may contain < > ")
    const valEl = document.createElement("span");
    valEl.className = "rech-coll-val";
    valEl.title = `${row.corpus_freq} occ. dans le corpus`;
    valEl.textContent = row.value;

    // freq cell with background bar
    const freqEl = document.createElement("span");
    freqEl.className = "rech-coll-num";
    const bar = document.createElement("span");
    bar.className = "rech-coll-bar";
    bar.style.width = `${pct}%`;
    freqEl.appendChild(bar);
    freqEl.appendChild(document.createTextNode(String(row.freq)));

    // PMI
    const pmiEl = document.createElement("span");
    pmiEl.className = "rech-coll-num";
    pmiEl.textContent = `${row.pmi > 0 ? "+" : ""}${row.pmi.toFixed(1)}`;

    // G²
    const llEl = document.createElement("span");
    llEl.className = "rech-coll-num";
    llEl.textContent = row.ll.toFixed(1);

    // G/D bar
    const lrEl = document.createElement("span");
    lrEl.className = "rech-coll-lr";
    lrEl.title = `Gauche\u00a0: ${row.left_freq} · Droite\u00a0: ${row.right_freq}`;
    const lrBar = document.createElement("span");
    lrBar.className = "rech-coll-lr-bar";
    const lrLeft = document.createElement("span");
    lrLeft.className = "rech-coll-lr-left";
    lrLeft.style.width = `${leftPct}%`;
    lrBar.appendChild(lrLeft);
    lrEl.appendChild(lrBar);

    el.append(valEl, freqEl, pmiEl, llEl, lrEl);
    body.appendChild(el);
  }
}

// ─── Export CSV ───────────────────────────────────────────────────────────────

async function _doExportCsv(root: HTMLElement): Promise<void> {
  if (!_conn || !_lastQuery) return;
  _setStatus(root, "Export CSV…", false);
  try {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const outPath = await save({
      defaultPath: `token_query_${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (!outPath) { _setStatus(root, "", false); return; }

    const payload: Record<string, unknown> = {
      cql: _lastQuery.cql,
      window: _lastQuery.window,
      out_path: outPath,
    };
    if (_lastQuery.language) payload.language = _lastQuery.language;
    if (_lastQuery.doc_ids)  payload.doc_ids  = _lastQuery.doc_ids;

    await _conn.post("/export/token_query_csv", payload);
    _setStatus(root, `✓ Exporté : ${outPath.split(/[\\/]/).pop()}`, false);
  } catch (err) {
    const msg = err instanceof SidecarError ? err.message : String(err);
    _setStatus(root, `✗ Export : ${msg}`, true);
  }
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function _setStatus(root: HTMLElement, msg: string, isError: boolean): void {
  const el = root.querySelector<HTMLElement>(".rech-status-bar");
  if (!el) return;
  el.textContent = msg;
  el.style.color = isError ? "var(--color-danger, #c0392b)" : "var(--color-muted, #888)";
}

function _showSpinner(root: HTMLElement, show: boolean): void {
  root.querySelector<HTMLElement>(".rech-spinner")!.hidden = !show;
  root.querySelectorAll<HTMLButtonElement>(".rech-btn-search").forEach(b => { b.disabled = show; });
}

function _showLoadMore(root: HTMLElement, show: boolean): void {
  root.querySelector<HTMLElement>(".rech-load-more-wrap")!.hidden = !show;
}

// ─── Aligned language pills ───────────────────────────────────────────────────

function _updateLangPills(root: HTMLElement, hits: _Hit[]): void {
  const wrap = root.querySelector<HTMLElement>(".rech-lang-pills");
  if (!wrap) return;

  // Collect all aligned languages across hits
  const langs = new Set<string>();
  for (const h of hits) {
    for (const a of h.aligned ?? []) {
      if (a.language) langs.add(a.language.toLowerCase());
    }
  }

  if (langs.size === 0) {
    wrap.hidden = true;
    wrap.innerHTML = "";
    _alignedLangFilter = null;
    return;
  }

  const alignedCb = root.querySelector<HTMLInputElement>(".rech-filter-aligned");
  wrap.hidden = !(alignedCb?.checked ?? true);

  // Only rebuild pills if the language set changed
  const existing = new Set(
    Array.from(wrap.querySelectorAll<HTMLElement>(".rech-lang-pill")).map(el => el.dataset.lang ?? "")
  );
  const sameSet = langs.size === existing.size && [...langs].every(l => existing.has(l));
  if (sameSet) return;

  // Init filter to all-on
  _alignedLangFilter = new Set(langs);
  wrap.innerHTML = "";

  const sorted = [...langs].sort();
  for (const lang of sorted) {
    const pill = document.createElement("button");
    pill.className = "rech-lang-pill rech-lang-pill--on";
    pill.dataset.lang = lang;
    pill.textContent = lang.toUpperCase();
    pill.title = `Afficher / masquer ${lang.toUpperCase()}`;
    pill.type = "button";
    pill.addEventListener("click", () => {
      const active = pill.classList.toggle("rech-lang-pill--on");
      if (!_alignedLangFilter) _alignedLangFilter = new Set(langs);
      if (active) {
        _alignedLangFilter.add(lang);
      } else {
        _alignedLangFilter.delete(lang);
      }
      _applyLangFilter(root);
    });
    wrap.appendChild(pill);
  }

  _applyLangFilter(root);
}

function _applyLangFilter(root: HTMLElement): void {
  // Use style.display instead of .hidden: CSS class rules (.rech-aligned-row { display:flex })
  // override the UA [hidden] selector (same specificity, author sheet wins), so the hidden
  // attribute would have no visual effect.
  root.querySelectorAll<HTMLElement>(".rech-aligned-row[data-lang]").forEach(row => {
    const lang = (row.dataset.lang ?? "").toLowerCase();
    const visible = !_alignedLangFilter || _alignedLangFilter.has(lang);
    row.style.display = visible ? "" : "none";
  });
  // Hide the whole aligned block if all its rows are hidden
  root.querySelectorAll<HTMLElement>(".rech-aligned-block").forEach(block => {
    const hasVisible = Array.from(block.querySelectorAll<HTMLElement>(".rech-aligned-row"))
      .some(r => r.style.display !== "none");
    block.style.display = hasVisible ? "" : "none";
  });
}

function _updateResultsHeader(root: HTMLElement, total: number): void {
  const header = root.querySelector<HTMLElement>(".rech-results-header")!;
  header.hidden = total === 0;
  const label = root.querySelector<HTMLElement>(".rech-total-label")!;
  label.textContent = `${total} occurrence${total > 1 ? "s" : ""}`;
}

function _esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ─── CSS ──────────────────────────────────────────────────────────────────────

const MODULE_CSS = `
/* ── Root layout ── */
.rech-root {
  display: flex; flex-direction: column; height: 100%;
  font-family: inherit; color: var(--fg, #111);
  background: var(--bg, #f8f8f8);
}

/* ── Toolbar ── */
.rech-toolbar {
  background: var(--bg-card, #fff);
  border-bottom: 1px solid var(--border, #e0e0e0);
  padding: 12px 16px 8px;
  display: flex; flex-direction: column; gap: 8px;
  flex-shrink: 0;
}
.rech-toolbar-top {
  display: flex; align-items: center; gap: 12px;
}
.rech-title {
  font-size: 1rem; font-weight: 700; letter-spacing: -0.01em;
  color: var(--accent, #7b3fa0);
}
.rech-status-bar {
  font-size: 0.8rem; color: var(--color-muted, #888); flex: 1;
}
.rech-toolbar-query {
  display: flex; gap: 8px; align-items: flex-start;
}
.rech-cql-input {
  flex: 1; resize: none; overflow: hidden;
  font-family: "JetBrains Mono", "Fira Mono", monospace;
  font-size: 0.88rem; padding: 7px 10px;
  border: 1px solid var(--border, #ccc); border-radius: 5px;
  background: var(--bg, #fff); color: inherit;
  line-height: 1.5; min-height: 36px;
}
.rech-cql-input:focus { outline: 2px solid var(--accent, #7b3fa0); outline-offset: -1px; }
.rech-btn-search {
  padding: 7px 16px; border-radius: 5px; cursor: pointer;
  background: var(--accent, #7b3fa0); color: #fff;
  border: none; font-size: 0.88rem; font-weight: 600;
  white-space: nowrap;
}
.rech-btn-search:hover:not(:disabled) { filter: brightness(1.1); }
.rech-btn-search:disabled { opacity: 0.5; cursor: default; }
.rech-btn-help {
  padding: 7px 10px; border-radius: 5px; cursor: pointer;
  border: 1px solid var(--border, #ccc);
  background: var(--bg-accent, #f5f5f5); font-size: 0.88rem;
}
.rech-btn-help:hover { background: var(--bg-hover, #ebebeb); }

/* ── Mode bar ── */
.rech-mode-bar {
  display: flex; gap: 4px; align-items: center;
}
.rech-mode-btn {
  padding: 4px 12px; border-radius: 20px; cursor: pointer;
  border: 1px solid var(--border, #ccc);
  background: transparent; color: var(--color-muted, #888);
  font-size: 0.8rem; font-weight: 500; transition: all 0.12s;
}
.rech-mode-btn:hover { border-color: var(--accent, #7b3fa0); color: var(--accent, #7b3fa0); }
.rech-mode-btn.active {
  background: var(--accent, #7b3fa0); color: #fff;
  border-color: var(--accent, #7b3fa0);
}

/* ── Quick panels ── */
.rech-quick-panel { display: flex; flex-direction: column; gap: 4px; }
/* [hidden] has lower priority than class rules in author stylesheet — override explicitly */
.rech-quick-panel[hidden] { display: none; }
.rech-quick-row {
  display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
}
.rech-quick-input {
  flex: 1; min-width: 180px;
  font-family: "JetBrains Mono", "Fira Mono", monospace;
  font-size: 0.88rem; padding: 7px 10px;
  border: 1px solid var(--border, #ccc); border-radius: 5px;
  background: var(--bg, #fff); color: inherit;
  line-height: 1.5; min-height: 36px;
}
.rech-quick-input:focus { outline: 2px solid var(--accent, #7b3fa0); outline-offset: -1px; }
.rech-quick-cs {
  display: flex; align-items: center; gap: 4px;
  font-size: 0.78rem; color: var(--color-muted, #888); cursor: pointer;
  white-space: nowrap;
}
.rech-quick-hint {
  font-size: 0.73rem; color: var(--color-muted, #aaa); padding-top: 2px;
}
.rech-quick-hint code {
  font-family: "JetBrains Mono", "Fira Mono", monospace; font-size: 0.82em;
  background: var(--bg-accent, #f0f0f0); padding: 0 3px; border-radius: 2px;
}

/* ── POS grid ── */
.rech-pos-grid {
  display: flex; flex-wrap: wrap; gap: 6px; padding: 4px 0;
}
.rech-pos-chip {
  padding: 3px 10px; border-radius: 12px; cursor: pointer;
  border: 1.5px solid currentColor; font-size: 0.75rem; font-weight: 700;
  background: transparent; transition: background 0.1s, color 0.1s;
}
.rech-pos-chip:hover { opacity: 0.8; }
.rech-pos-selection {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  min-height: 36px; padding: 4px 0;
}
.rech-pos-token {
  display: inline-flex; align-items: center; gap: 0;
  border: 1.5px solid; border-radius: 6px; overflow: hidden;
  font-size: 0.78rem;
}
.rech-pos-token-label {
  color: #fff; font-weight: 700; padding: 3px 7px;
  font-size: 0.73rem; letter-spacing: 0.03em; white-space: nowrap;
}
.rech-pos-token-word {
  border: none; border-left: 1px solid rgba(0,0,0,0.15);
  font-size: 0.78rem; padding: 3px 6px; width: 72px;
  background: var(--bg, #fff); color: inherit; outline: none;
  font-family: "JetBrains Mono","Fira Mono",monospace;
}
.rech-pos-token-word::placeholder { color: #bbb; font-style: italic; }
.rech-pos-token-remove {
  border: none; border-left: 1px solid rgba(0,0,0,0.12);
  background: rgba(0,0,0,0.06); color: #888; cursor: pointer;
  padding: 3px 6px; font-size: 0.8rem; line-height: 1;
}
.rech-pos-token-remove:hover { background: rgba(200,0,0,0.15); color: #c00; }
.rech-pos-sep {
  font-size: 0.75rem; color: var(--color-muted, #aaa); flex-shrink: 0;
}
.rech-pos-actions { margin-top: 4px; }
.rech-pos-clear-btn {
  padding: 5px 10px; border-radius: 5px; cursor: pointer;
  border: 1px solid var(--border, #ccc);
  background: var(--bg-accent, #f5f5f5); font-size: 0.78rem;
  color: var(--color-muted, #888);
}
.rech-pos-clear-btn:hover { border-color: var(--color-danger, #c0392b); color: var(--color-danger, #c0392b); }

/* ── Filters ── */
.rech-toolbar-filters {
  display: flex; gap: 12px; align-items: center; flex-wrap: wrap;
}
.rech-filter-label {
  display: flex; align-items: center; gap: 5px;
  font-size: 0.78rem; color: var(--color-muted, #888);
}
.rech-filter-label select {
  padding: 3px 6px; border: 1px solid var(--border, #ccc);
  border-radius: 4px; font-size: 0.8rem;
  background: var(--bg, #fff); color: inherit;
}
.rech-filter-check {
  display: flex; align-items: center; gap: 5px;
  font-size: 0.78rem; color: var(--color-muted, #888); cursor: pointer;
}

/* ── Example chips ── */
.rech-examples {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
}
.rech-examples-label {
  font-size: 0.73rem; color: var(--color-muted, #aaa); white-space: nowrap;
}
.rech-eg {
  padding: 2px 8px; border-radius: 12px; cursor: pointer;
  border: 1px solid var(--accent, #7b3fa0); font-size: 0.73rem;
  background: transparent; color: var(--accent, #7b3fa0);
  transition: background 0.1s;
}
.rech-eg:hover { background: var(--accent, #7b3fa0); color: #fff; }

/* ── Help panel ── */
.rech-help-panel {
  background: var(--bg-card, #fff);
  border-bottom: 1px solid var(--border, #e0e0e0);
  padding: 16px; position: relative;
}
.rech-help-inner { max-width: 700px; }
.rech-help-close {
  position: absolute; top: 12px; right: 16px;
  background: none; border: none; font-size: 1rem; cursor: pointer;
  color: var(--color-muted, #888);
}
.rech-help-panel h3 { margin: 0 0 12px; font-size: 0.9rem; }
.rech-help-table {
  border-collapse: collapse; font-size: 0.78rem; margin-bottom: 10px; width: 100%;
}
.rech-help-table th {
  text-align: left; padding: 4px 8px;
  border-bottom: 1px solid var(--border, #ddd);
  color: var(--color-muted, #888);
}
.rech-help-table td { padding: 3px 8px; }
.rech-help-table code {
  background: var(--bg-accent, #f0f0f0); padding: 1px 4px;
  border-radius: 3px; font-size: 0.82em;
}
.rech-help-hint { font-size: 0.75rem; color: var(--color-muted, #888); margin: 0; }

/* ── Body: results + stats ── */
.rech-body {
  display: flex; flex-direction: column;
  flex: 1; overflow: hidden; min-height: 0;
}
.rech-results {
  flex: 1; overflow-y: auto; padding: 12px 16px;
  display: flex; flex-direction: column; gap: 8px;
}

/* ── Analytics panel (hidden, source of truth for modal) ── */
.rech-analytics-panel { display: none !important; }

/* ── Analytics modal overlay ── */
.rech-analytics-modal-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.45);
  z-index: 9800;
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
}
.rech-analytics-modal-box {
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 12px 48px rgba(0,0,0,0.28);
  width: min(96vw, 1100px);
  height: min(80vh, 640px);
  display: flex; flex-direction: column;
  overflow: hidden;
}
.rech-analytics-modal-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px 10px;
  border-bottom: 1px solid #e0e6ef;
  flex-shrink: 0;
}
.rech-analytics-modal-close {
  background: none; border: none; font-size: 1.1rem;
  cursor: pointer; color: #6c757d; padding: 2px 6px; border-radius: 4px;
  transition: background 0.12s;
}
.rech-analytics-modal-close:hover { background: #f0f2f5; color: #1a2533; }

/* ── Analytics button in header ── */
.rech-btn-analytics {
  padding: 3px 8px; border-radius: 4px; cursor: pointer;
  border: 1px solid var(--border, #ccc);
  background: var(--bg-accent, #f5f5f5); font-size: 0.82rem;
  transition: background 0.12s;
}
.rech-btn-analytics:hover { background: #e8efff; border-color: #b8ccee; }
.rech-results-header {
  display: flex; align-items: center; gap: 12px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border, #eee);
}
.rech-total-label { font-size: 0.82rem; color: var(--color-muted, #888); flex: 1; }
.rech-btn-export {
  padding: 3px 10px; border-radius: 4px; cursor: pointer;
  border: 1px solid var(--border, #ccc);
  background: var(--bg-accent, #f5f5f5); font-size: 0.78rem;
}
.rech-btn-export:hover { background: var(--bg-hover, #ebebeb); }
.rech-spinner {
  display: flex; align-items: center; gap: 8px;
  font-size: 0.85rem; color: var(--color-muted, #888); padding: 16px 0;
}
.rech-spinner-dot {
  display: inline-block; width: 10px; height: 10px; border-radius: 50%;
  background: var(--accent, #7b3fa0);
  animation: rech-pulse 1s ease-in-out infinite;
}
@keyframes rech-pulse { 0%,100% { opacity: 0.3; } 50% { opacity: 1; } }
.rech-empty {
  font-size: 0.85rem; color: var(--color-muted, #888); padding: 24px 0;
  text-align: center;
}
.rech-load-more-wrap { display: flex; justify-content: center; padding: 8px 0; }
.rech-btn-more {
  padding: 6px 20px; border-radius: 5px; cursor: pointer;
  border: 1px solid var(--border, #ccc);
  background: var(--bg-accent, #f5f5f5); font-size: 0.85rem;
}
.rech-btn-more:hover { background: var(--bg-hover, #ebebeb); }

/* ── Hit card ── */
.rech-hit {
  background: var(--bg-card, #fff);
  border: 1px solid var(--border, #e8e8e8);
  border-radius: 6px; padding: 10px 12px;
  display: flex; flex-direction: column; gap: 8px;
}
.rech-hit-header {
  display: flex; align-items: center; gap: 8px;
  font-size: 0.75rem; color: var(--color-muted, #999);
}
.rech-hit-doc { font-weight: 600; color: var(--fg, #333); }
.rech-hit-lang {
  padding: 0 5px; border-radius: 3px;
  background: var(--accent, #7b3fa0); color: #fff;
  font-size: 0.65rem; font-weight: 700; text-transform: uppercase;
}
.rech-hit-loc { margin-left: auto; font-style: italic; }

/* ── KWIC row ── */
.rech-kwic-row {
  /* flex row: groups stretch to same height; fixed-height rows inside each token cell keep word/upos/lemma aligned across groups */
  display: flex; align-items: stretch; gap: 0;
  overflow-x: auto;
  scrollbar-width: thin; scrollbar-color: #ddd transparent;
}
.rech-kwic-row::-webkit-scrollbar { height: 3px; }
.rech-kwic-row::-webkit-scrollbar-thumb { background: #ddd; border-radius: 2px; }

.rech-kwic-group {
  display: flex; flex-wrap: nowrap; gap: 2px;
  padding: 4px 4px;
  /* Context groups: center word vertically against the taller pivot group */
  align-items: center;
}
.rech-kwic-left  { opacity: 0.65; }
.rech-kwic-right { opacity: 0.65; }
.rech-kwic-pivot {
  background: #7b3fa011; border-radius: 5px;
  box-shadow: inset 2px 0 0 var(--accent, #7b3fa0),
              inset -2px 0 0 var(--accent, #7b3fa0);
  padding: 4px 6px;
  /* Pivot tokens have 3 rows (word+upos+lemma); align to top within the group */
  align-items: flex-start;
}

/* ── Token cell (3 rows, fixed heights for cross-group alignment) ── */
.rech-kwic-token {
  display: flex; flex-direction: column;
  align-items: center; flex-shrink: 0;
  padding: 0 4px; min-width: 28px;
}
.rech-kwic-word {
  height: 22px; display: flex; align-items: center; justify-content: center;
  font-size: 0.88rem; font-weight: 500; white-space: nowrap;
}
.rech-kwic-upos {
  height: 16px; display: flex; align-items: center; justify-content: center;
  font-size: 0.58rem; font-weight: 700; letter-spacing: 0.04em;
  border-radius: 3px; padding: 0 3px; white-space: nowrap; min-width: 18px;
}
.rech-kwic-lemma {
  height: 15px; display: flex; align-items: center; justify-content: center;
  font-size: 0.67rem; font-style: italic;
  color: var(--color-muted, #999); white-space: nowrap;
}

/* ── Stats panel ── */
.rech-stats-panel {
  flex: 0 0 220px; min-width: 180px;
  border-right: 1px solid var(--border, #e0e0e0);
  overflow-y: auto; padding: 10px 12px;
  display: flex; flex-direction: column; gap: 8px;
}
.rech-stats-header {
  font-size: 0.78rem; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.06em; color: var(--color-muted, #888);
}
.rech-stats-group-row {
  display: flex; align-items: center; gap: 6px; font-size: 0.75rem;
  color: var(--color-muted, #888);
}
.rech-stats-group-by {
  flex: 1; padding: 2px 4px; border: 1px solid var(--border, #ccc);
  border-radius: 3px; font-size: 0.75rem;
  background: var(--bg, #fff); color: inherit;
}
.rech-stats-bars { display: flex; flex-direction: column; gap: 4px; }
.rech-stats-row {
  display: grid; grid-template-columns: 70px 1fr 28px;
  align-items: center; gap: 4px;
  cursor: pointer; border-radius: 3px; padding: 2px 3px;
}
.rech-stats-row:hover { background: var(--bg-hover, #ebebeb); }
.rech-stats-row.active { background: #7b3fa015; }
.rech-stats-val {
  font-size: 0.75rem; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis;
}
.rech-stats-bar-wrap {
  height: 8px; background: #e8e8e8; border-radius: 4px; overflow: hidden;
}
.rech-stats-bar {
  height: 100%; background: var(--accent, #7b3fa0);
  border-radius: 4px; transition: width 0.2s;
}
.rech-stats-count {
  font-size: 0.68rem; color: var(--color-muted, #aaa); text-align: right;
}
.rech-btn-reset-filter {
  font-size: 0.72rem; padding: 2px 8px; border-radius: 3px; cursor: pointer;
  border: 1px solid var(--border, #ccc);
  background: var(--bg-accent, #f5f5f5);
}
.rech-btn-reset-filter:hover { background: var(--bg-hover, #ebebeb); }

/* ── Pivot token clickable ── */
.rech-kwic-token--pivot {
  cursor: pointer;
  border-radius: 3px;
  transition: background 0.12s;
}
.rech-kwic-token--pivot:hover {
  background: rgba(123,63,160,0.08);
  outline: 1px solid rgba(123,63,160,0.25);
}

/* ── Token popover ── */
.rech-tok-popover {
  position: fixed;
  z-index: 99999;
  background: #fff;
  border: 1px solid rgba(0,0,0,0.12);
  border-radius: 7px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.16);
  padding: 6px 0;
  min-width: 180px;
  max-width: 320px;
}
.rech-tok-popover-title {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #aaa;
  padding: 2px 12px 6px;
  border-bottom: 1px solid #f0f0f0;
  margin-bottom: 2px;
}
.rech-tok-popover-btn {
  display: block;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  padding: 6px 12px;
  font-size: 0.82rem;
  font-family: "JetBrains Mono", "Fira Mono", monospace;
  color: #1a1a2e;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: background 0.1s;
}
.rech-tok-popover-btn:hover {
  background: #f0f4ff;
  color: #7b3fa0;
}

/* ── Toggle traductions ── */
.rech-filter-check--aligned {
  border-left: 1px solid var(--border, #ddd);
  padding-left: 0.75rem;
  margin-left: 0.25rem;
}

/* ── Aligned language pills filter ── */
.rech-lang-pills {
  display: flex; flex-wrap: wrap; gap: 4px; align-items: center;
  margin-left: 4px;
}
.rech-lang-pill {
  padding: 1px 7px; border-radius: 10px; font-size: 0.68rem;
  font-weight: 700; letter-spacing: 0.04em; cursor: pointer;
  border: 1px solid #b8cce8; background: #e8f0fb; color: #6c8ab5;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
  opacity: 0.45;
}
.rech-lang-pill--on {
  background: #d0e4ff; color: #1a4f7a; border-color: #7aaee8; opacity: 1;
}
.rech-lang-pill:hover { border-color: #5a8fc8; }

/* ── Aligned translations block ── */
.rech-aligned-block {
  display: flex; flex-direction: column; gap: 4px;
  margin-top: 8px;
  padding: 8px 10px;
  background: #f5f8ff;
  border-top: 1px solid #dde6f5;
  border-radius: 0 0 6px 6px;
}
.rech-aligned-row {
  display: flex; align-items: baseline; gap: 8px;
  font-size: 0.82rem;
}
.rech-aligned-lang {
  flex-shrink: 0;
  font-size: 0.65rem; font-weight: 700;
  padding: 1px 5px;
  border-radius: 3px;
  background: #d0e4ff; color: #1a4f7a;
  letter-spacing: 0.03em;
}
.rech-aligned-text {
  flex: 1; color: #2d3748; line-height: 1.4;
  font-style: italic;
}
.rech-aligned-status {
  flex-shrink: 0;
  font-size: 0.65rem; padding: 1px 5px; border-radius: 3px;
}
.rech-aligned-status--accepted  { background: #d1fae5; color: #145a38; }
.rech-aligned-status--rejected  { background: #fee2e2; color: #7f1d1d; }
.rech-aligned-status--none      { background: #f0f0f0; color: #888; }

/* ── Sort buttons ── */
.rech-sort-group {
  display: flex; align-items: center; gap: 4px;
  flex-wrap: wrap;
}
.rech-sort-label {
  font-size: 0.72rem; color: #6c757d; margin-right: 2px;
}
.rech-sort-btn {
  font-size: 0.7rem; padding: 2px 7px;
  border: 1px solid #c8d0dc; border-radius: 4px;
  background: #f5f7fa; color: #4a5568;
  cursor: pointer; white-space: nowrap;
  transition: background 0.1s;
}
.rech-sort-btn:hover { background: #e2e8f0; }
.rech-sort-btn--active {
  background: #1c2b3a; color: #fff; border-color: #1c2b3a;
}

/* ── Dispersion chart ── */
.rech-dispersion-wrap {
  padding: 8px 10px 0;
  border-bottom: 1px solid #e8ecf0;
  margin-bottom: 8px;
}
.rech-dispersion-title {
  font-size: 0.72rem; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.04em;
  color: #6c757d; margin-bottom: 6px;
}
.rech-dispersion-chart {
  width: 100% !important;
  display: block;
}

/* ── Hit actions bar ── */
.rech-hit-actions {
  display: flex; gap: 6px; align-items: center;
  margin-top: 8px; padding-top: 6px;
  border-top: 1px solid #e8ecf0;
}
.rech-citation-btn {
  font-size: 0.72rem;
  padding: 2px 8px;
  border: 1px solid #c8d0dc;
  border-radius: 4px;
  background: #f5f7fa;
  color: #4a5568;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
  white-space: nowrap;
}
.rech-citation-btn:hover { background: #e2e8f0; color: #1a2733; }
.rech-citation-btn--copied { background: #d1fae5; color: #145a38; border-color: #86efac; }

/* ── Collocations panel ── */
.rech-coll-panel {
  flex: 1; min-width: 300px;
  overflow-y: auto; padding: 10px 12px;
}
.rech-coll-header {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 0.72rem; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.04em; color: #6c757d; margin-bottom: 6px;
}
.rech-coll-sort-group { display: flex; gap: 3px; }
.rech-coll-sort-btn {
  font-size: 0.68rem; padding: 1px 6px; border-radius: 3px;
  border: 1px solid #dde1e7; background: #f5f7fa; color: #555;
  cursor: pointer;
}
.rech-coll-sort-btn--active { background: #7b3fa0; color: #fff; border-color: #7b3fa0; }
.rech-coll-controls {
  display: flex; align-items: center; gap: 6px;
  font-size: 0.72rem; color: #6c757d; margin-bottom: 6px;
}
.rech-coll-window, .rech-coll-by {
  font-size: 0.72rem; padding: 1px 4px;
  border: 1px solid #dde1e7; border-radius: 3px;
}
.rech-coll-hint { font-size: 0.75rem; color: #aaa; padding: 4px 0; }
.rech-coll-thead {
  display: grid;
  grid-template-columns: 1fr 52px 44px 52px 48px;
  gap: 2px; font-size: 0.66rem; font-weight: 600;
  color: #999; text-transform: uppercase; letter-spacing: 0.03em;
  padding: 0 4px 4px; border-bottom: 1px solid #eee; margin-bottom: 2px;
}
.rech-coll-th { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rech-coll-th-num, .rech-coll-th-lr { text-align: right; }
.rech-coll-row {
  display: grid;
  grid-template-columns: 1fr 52px 44px 52px 48px;
  gap: 2px; align-items: center;
  padding: 3px 4px; border-radius: 3px;
  font-size: 0.75rem;
}
.rech-coll-row:nth-child(even) { background: #f8f9fb; }
.rech-coll-val { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: default; }
.rech-coll-num {
  text-align: right; font-variant-numeric: tabular-nums;
  position: relative; white-space: nowrap;
}
.rech-coll-bar {
  display: inline-block; position: absolute;
  left: 0; top: 2px; height: calc(100% - 4px);
  background: #7b3fa015; border-radius: 2px;
  z-index: 0;
}
.rech-coll-lr { display: flex; align-items: center; justify-content: flex-end; }
.rech-coll-lr-bar {
  width: 36px; height: 6px;
  background: #e8ecf0; border-radius: 3px;
  overflow: hidden; flex-shrink: 0;
}
.rech-coll-lr-left {
  display: block; height: 100%;
  background: #7b3fa0; border-radius: 3px 0 0 3px;
}
`;
