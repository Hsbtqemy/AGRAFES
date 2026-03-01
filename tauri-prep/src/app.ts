/**
 * app.ts — ConcordancierPrep V0.4 shell.
 *
 * Tab navigation: [Projet] [Import] [Actions] [Métadonnées] [Exports]
 * Manages shared Conn state and propagates db-changed events.
 */

import type { Conn } from "./lib/sidecarClient.ts";
import { ensureRunning, SidecarError } from "./lib/sidecarClient.ts";
import { getCurrentDbPath, setCurrentDbPath, getOrCreateDefaultDbPath } from "./lib/db.ts";
import { open as dialogOpen, save as dialogSave } from "@tauri-apps/plugin-dialog";
import { writeTextFile, readTextFile } from "@tauri-apps/plugin-fs";
import { ProjectScreen } from "./screens/ProjectScreen.ts";
import { ImportScreen } from "./screens/ImportScreen.ts";
import { ActionsScreen, type ProjectPreset } from "./screens/ActionsScreen.ts";
import { MetadataScreen } from "./screens/MetadataScreen.ts";
import { ExportsScreen } from "./screens/ExportsScreen.ts";
import { JobCenter, JOB_CENTER_CSS, showToast } from "./components/JobCenter.ts";

// ─── Project Presets store ─────────────────────────────────────────────────────

const LS_PRESETS = "agrafes.prep.presets";

const SEED_PRESETS: ProjectPreset[] = [
  {
    id: "default-fr-en",
    name: "Par défaut (FR\u2194EN)",
    description: "Configuration standard pour corpus bilingue fran\u00e7ais/anglais",
    languages: ["fr", "en"],
    pivot_language: "fr",
    segmentation_lang: "fr",
    segmentation_pack: "auto",
    curation_preset: "spaces",
    alignment_strategy: "external_id_then_position",
    created_at: 0,
  },
  {
    id: "default-de-fr",
    name: "Allemand\u2194Fran\u00e7ais",
    description: "Corpus bilingue DE/FR, alignement par id externe",
    languages: ["de", "fr"],
    pivot_language: "de",
    segmentation_lang: "de",
    segmentation_pack: "auto",
    curation_preset: "spaces",
    alignment_strategy: "external_id",
    created_at: 0,
  },
];

function _loadPresets(): ProjectPreset[] {
  try {
    const raw = localStorage.getItem(LS_PRESETS);
    return raw ? JSON.parse(raw) as ProjectPreset[] : SEED_PRESETS.map(p => ({ ...p }));
  } catch { return SEED_PRESETS.map(p => ({ ...p })); }
}

function _savePresets(presets: ProjectPreset[]): void {
  try { localStorage.setItem(LS_PRESETS, JSON.stringify(presets)); } catch { /* */ }
}

// ─── CSS ─────────────────────────────────────────────────────────────────────

const CSS = `
  :root {
    --color-bg: #f0f2f5;
    --color-surface: #ffffff;
    --color-border: #dde1e8;
    --color-primary: #2c5f9e;
    --color-primary-hover: #1e4a80;
    --color-secondary: #6c757d;
    --color-warning: #b8590a;
    --color-danger: #c0392b;
    --color-ok: #1a7f4e;
    --color-text: #1a1a2e;
    --color-muted: #6c757d;
    --radius: 6px;
    --shadow: 0 1px 3px rgba(0,0,0,0.12);
  }

  *, *::before, *::after { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: var(--color-bg); color: var(--color-text); font-size: 14px; }

  /* Topbar */
  .topbar { background: var(--color-primary); color: #fff; padding: 0 1rem;
    display: flex; align-items: center; height: 44px; gap: 0.75rem; }
  .topbar-title { font-size: 1rem; font-weight: 600; flex: 1; }
  .topbar-dbpath { font-size: 11px; opacity: 0.75; max-width: 280px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .topbar-db-btn {
    background: rgba(255,255,255,0.13);
    border: 1px solid rgba(255,255,255,0.25);
    border-radius: 4px;
    color: rgba(255,255,255,0.9);
    font-size: 0.75rem;
    padding: 3px 9px;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.13s;
  }
  .topbar-db-btn:hover { background: rgba(255,255,255,0.22); }
  /* ── Presets modal ─────────────────────────────────────────────────────── */
  .presets-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.4);
    display: flex; align-items: center; justify-content: center; z-index: 9000;
  }
  .presets-modal {
    background: #fff; border-radius: 8px; width: min(640px, 95vw);
    max-height: 80vh; display: flex; flex-direction: column;
    box-shadow: 0 8px 32px rgba(0,0,0,0.22);
  }
  .presets-modal-head {
    padding: 0.9rem 1.1rem 0.7rem; border-bottom: 1px solid #dee2e6;
    display: flex; align-items: center; gap: 0.5rem;
  }
  .presets-modal-head h3 { margin: 0; font-size: 1rem; flex: 1; }
  .presets-modal-body { overflow-y: auto; flex: 1; padding: 0.75rem 1.1rem; }
  .presets-modal-foot {
    padding: 0.6rem 1.1rem; border-top: 1px solid #dee2e6;
    display: flex; gap: 0.5rem; justify-content: flex-end; flex-wrap: wrap;
  }
  .preset-row {
    display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.6rem;
    border: 1px solid #dee2e6; border-radius: 6px; margin-bottom: 0.4rem;
    background: #f8f9fa;
  }
  .preset-row:hover { background: #edf2ff; }
  .preset-name { font-weight: 600; font-size: 0.88rem; flex: 1; }
  .preset-desc { font-size: 0.78rem; color: #6c757d; display: block; }
  .preset-chips { display: flex; gap: 0.25rem; flex-wrap: wrap; margin-top: 0.2rem; }
  .preset-chip {
    background: #e0ecff; color: #2c5f9e; border-radius: 99px;
    padding: 0.05rem 0.45rem; font-size: 0.72rem; font-weight: 500;
  }
  .presets-empty { color: #6c757d; font-style: italic; padding: 1rem 0; }

  /* DB init error banner in prep */
  .prep-init-error {
    position: sticky;
    top: 0;
    background: #fff3cd;
    border-bottom: 2px solid #e6a817;
    padding: 8px 16px;
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    font-size: 0.83rem;
    z-index: 100;
  }
  .prep-init-error-detail { font-family: monospace; font-size: 0.77rem; color: #555; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

  /* Tab bar */
  .tabbar { background: var(--color-surface); border-bottom: 2px solid var(--color-border);
    display: flex; gap: 0; }
  .tab-btn { padding: 0.6rem 1.25rem; border: none; background: none; cursor: pointer;
    font-size: 0.9rem; color: var(--color-muted); border-bottom: 3px solid transparent;
    margin-bottom: -2px; transition: color 0.15s, border-color 0.15s; }
  .tab-btn:hover { color: var(--color-text); }
  .tab-btn.active { color: var(--color-primary); border-bottom-color: var(--color-primary); font-weight: 600; }

  /* Content area */
  .content { padding: 1.25rem; max-width: 900px; margin: 0 auto; }
  .screen { display: none; }
  .screen.active { display: block; }
  .screen-title { font-size: 1.1rem; font-weight: 600; margin: 0 0 1rem; }

  /* Card */
  .card { background: var(--color-surface); border-radius: var(--radius);
    border: 1px solid var(--color-border); box-shadow: var(--shadow);
    padding: 1rem; margin-bottom: 1rem; position: relative; }
  .card h3 { margin: 0 0 0.75rem; font-size: 0.95rem; font-weight: 600; }

  /* Buttons */
  .btn { padding: 0.35rem 0.9rem; border: none; border-radius: var(--radius);
    cursor: pointer; font-size: 0.85rem; font-weight: 500; transition: background 0.15s; }
  .btn:disabled { opacity: 0.45; cursor: not-allowed; }
  .btn-primary { background: var(--color-primary); color: #fff; }
  .btn-primary:hover:not(:disabled) { background: var(--color-primary-hover); }
  .btn-secondary { background: #e9ecef; color: var(--color-text); }
  .btn-secondary:hover:not(:disabled) { background: #d0d4db; }
  .btn-warning { background: var(--color-warning); color: #fff; }
  .btn-warning:hover:not(:disabled) { background: #9b4a08; }
  .btn-danger { background: var(--color-danger); color: #fff; }
  .btn-danger:hover:not(:disabled) { background: #a93226; }
  .btn-sm { padding: 0.2rem 0.55rem; font-size: 0.78rem; }
  .btn-row { display: flex; gap: 0.5rem; flex-wrap: wrap; }

  /* Status badges */
  .status-badge { display: inline-block; padding: 0.2rem 0.6rem; border-radius: 20px;
    font-size: 0.8rem; font-weight: 600; }
  .status-ok { background: #d4edda; color: var(--color-ok); }
  .status-error { background: #f8d7da; color: var(--color-danger); }
  .status-unknown { background: #e9ecef; color: var(--color-muted); }

  /* Log pane */
  .log-pane { background: #1a1a2e; color: #c8d6e5; font-family: monospace; font-size: 0.78rem;
    padding: 0.6rem 0.75rem; border-radius: var(--radius); height: 160px; overflow-y: auto; }
  .log-line { white-space: pre-wrap; line-height: 1.5; }
  .log-error { color: #ff7675; }

  /* Meta table */
  .meta-table { border-collapse: collapse; font-size: 0.82rem; width: 100%; margin-top: 0.5rem; }
  .meta-table th, .meta-table td { border: 1px solid var(--color-border); padding: 0.3rem 0.6rem; text-align: left; }
  .meta-table th { background: var(--color-bg); font-weight: 600; }

  /* Import list */
  .import-list { margin-top: 0.75rem; }
  .import-row { border: 1px solid var(--color-border); border-radius: var(--radius);
    padding: 0.5rem; margin-bottom: 0.4rem; background: var(--color-bg); }
  .import-row-pending { border-left: 4px solid var(--color-muted); }
  .import-row-importing { border-left: 4px solid var(--color-primary); }
  .import-row-done { border-left: 4px solid var(--color-ok); }
  .import-row-error { border-left: 4px solid var(--color-danger); }
  .import-row-info { display: flex; justify-content: space-between; margin-bottom: 0.3rem; }
  .import-row-name { font-weight: 500; max-width: 300px; overflow: hidden; text-overflow: ellipsis; }
  .import-row-status { font-size: 0.78rem; color: var(--color-muted); }
  .import-row-controls { display: flex; gap: 0.4rem; flex-wrap: wrap; align-items: center; }
  .import-row-controls select, .import-row-controls input[type=text] {
    font-size: 0.82rem; padding: 0.15rem 0.3rem; border: 1px solid var(--color-border);
    border-radius: 4px; }
  .import-defaults { display: flex; gap: 1rem; margin-top: 0.5rem; flex-wrap: wrap; }
  .import-defaults label { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.82rem; }
  .import-defaults select, .import-defaults input { font-size: 0.82rem; padding: 0.2rem; border: 1px solid var(--color-border); border-radius: 4px; }

  /* Doc list */
  .doc-list { margin-top: 0.5rem; overflow-x: auto; }

  /* Actions form */
  .actions-screen label { display: flex; flex-direction: column; gap: 0.2rem; margin-bottom: 0.5rem; font-size: 0.85rem; }
  .actions-screen select, .actions-screen input[type=text], .actions-screen input[type=number],
  .actions-screen textarea {
    font-size: 0.85rem; padding: 0.3rem 0.5rem; border: 1px solid var(--color-border);
    border-radius: var(--radius); width: 100%; max-width: 420px; }
  .actions-screen textarea { resize: vertical; }

  /* Busy overlay */
  .busy-overlay { position: absolute; inset: 0; background: rgba(255,255,255,0.75);
    display: flex; align-items: center; justify-content: center; border-radius: var(--radius);
    z-index: 10; }
  .busy-spinner { font-size: 0.9rem; font-weight: 600; color: var(--color-primary); }

  /* Misc */
  .empty-hint { color: var(--color-muted); font-style: italic; font-size: 0.85rem; margin: 0; }
  .hint { font-size: 0.82rem; color: var(--color-muted); margin: 0 0 0.5rem; }
  .db-path { font-family: monospace; font-size: 0.82rem; word-break: break-all; color: var(--color-muted); margin: 0 0 0.5rem; }
  code { font-family: monospace; background: var(--color-bg); padding: 0 3px; border-radius: 3px; }

  /* Actions screen — form rows */
  .form-row { display: flex; gap: 1rem; flex-wrap: wrap; margin-bottom: 0.4rem; }
  .form-row label { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.85rem; }
  .form-row select, .form-row input[type=text], .form-row input[type=number] {
    font-size: 0.85rem; padding: 0.25rem 0.4rem; border: 1px solid var(--color-border);
    border-radius: var(--radius); }
  .actions-screen textarea {
    font-size: 0.85rem; padding: 0.3rem 0.5rem; border: 1px solid var(--color-border);
    border-radius: var(--radius); width: 100%; max-width: 480px; resize: vertical; }

  /* Preview stats banner */
  .preview-stats { font-size: 0.85rem; margin-bottom: 0.5rem; }
  .stat-ok { color: var(--color-ok); font-weight: 600; }
  .stat-warn { color: var(--color-warning); font-weight: 600; }

  /* Badge for feature labels */
  .badge-preview { font-size: 0.7rem; font-weight: 500; background: #e0ecff;
    color: var(--color-primary); padding: 1px 6px; border-radius: 10px; vertical-align: middle; }

  /* Diff table */
  .diff-table { border-collapse: collapse; font-size: 0.82rem; width: 100%; table-layout: fixed; }
  .diff-table th, .diff-table td { border: 1px solid var(--color-border); padding: 0.25rem 0.45rem;
    vertical-align: top; word-break: break-word; }
  .diff-table th { background: var(--color-bg); font-weight: 600; }
  .diff-extid { color: var(--color-muted); font-family: monospace; }
  .diff-before { background: #fff5f5; color: #6c1a1a; }
  .diff-after { background: #f0fff4; }
  mark.diff-mark { background: #b7f5c8; color: #14532d; border-radius: 2px; padding: 0 1px; font-weight: 600; }

  /* Audit table */
  .audit-table { font-size: 0.82rem; }
  .audit-text { max-width: 300px; word-break: break-word; }

  /* Batch action bar (V1.3) */
  .audit-batch-bar {
    display: none;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
    padding: 0.35rem 0.5rem;
    background: #f0f4ff;
    border: 1px solid #c7d2f7;
    border-radius: var(--radius);
    margin-top: 0.35rem;
    font-size: 0.83rem;
  }
  .audit-sel-count { color: var(--color-muted); margin-right: 0.2rem; }

  /* Align explainability panel */
  .align-debug-head { display: flex; align-items: center; justify-content: space-between; gap: 0.6rem; margin-bottom: 0.45rem; }
  .align-debug-content { display: grid; grid-template-columns: 1fr; gap: 0.45rem; }
  .align-debug-card {
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: #f8fafc;
    padding: 0.45rem 0.6rem;
  }
  .align-debug-title { font-weight: 600; font-size: 0.82rem; }
  .align-debug-meta { margin-top: 0.2rem; font-size: 0.8rem; color: var(--color-muted); }
  .align-debug-row { margin-top: 0.32rem; font-size: 0.8rem; display: flex; gap: 0.45rem; align-items: baseline; flex-wrap: wrap; }
  .align-debug-label { font-weight: 600; min-width: 72px; color: var(--color-text); }
  .align-debug-pills { display: flex; flex-wrap: wrap; gap: 0.3rem; }
  .align-debug-pill { background: #e6eefb; color: var(--color-primary); padding: 0.08rem 0.38rem; border-radius: 999px; font-size: 0.76rem; }
  .align-debug-list { margin: 0; padding-left: 1rem; }

  /* Align quality panel */
  .quality-stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 0.5rem;
  }
  .quality-stat {
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    padding: 0.4rem 0.6rem;
    background: #f8fafc;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .quality-label { font-size: 0.78rem; color: var(--color-muted); }
  .quality-value { font-weight: 700; font-size: 0.92rem; }
  .quality-value.ok  { color: var(--color-success, #2dc653); }
  .quality-value.warn { color: #f4a261; }
  .quality-value.err  { color: var(--color-danger, #e63946); }
`+ JOB_CENTER_CSS;


// ─── App ──────────────────────────────────────────────────────────────────────

const TABS = ["project", "import", "actions", "metadata", "exports"] as const;
type TabId = typeof TABS[number];

export class App {
  private _conn: Conn | null = null;
  private _activeTab: TabId = "project";

  private _project!: ProjectScreen;
  private _import!: ImportScreen;
  private _actions!: ActionsScreen;
  private _metadata!: MetadataScreen;
  private _exports!: ExportsScreen;
  private _jobCenter!: JobCenter;

  private _tabBtns: Record<TabId, HTMLButtonElement> = {} as never;
  private _screenEls: Record<TabId, HTMLElement> = {} as never;
  private _dbPathEl!: HTMLElement;

  async init(): Promise<void> {
    // Inject CSS
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);

    // Try to auto-open default DB
    try {
      const dbPath = await getOrCreateDefaultDbPath();
      setCurrentDbPath(dbPath);
      this._conn = await ensureRunning(dbPath);
    } catch {
      // no auto-start, user can open manually
    }

    this._buildUI();
    this._project.setConn(this._conn);
    this._import.setConn(this._conn);
    this._actions.setConn(this._conn);
    this._metadata.setConn(this._conn);
    this._exports.setConn(this._conn);
    this._jobCenter.setConn(this._conn);
    this._import.setJobCenter(this._jobCenter, showToast);
    this._actions.setJobCenter(this._jobCenter, showToast);
    this._exports.setJobCenter(this._jobCenter, showToast);
  }

  private _buildUI(): void {
    const root = document.getElementById("app")!;

    // Topbar
    const topbar = document.createElement("div");
    topbar.className = "topbar";

    const titleEl = document.createElement("span");
    titleEl.className = "topbar-title";
    titleEl.textContent = "Concordancier Prep";

    const dbPathEl = document.createElement("span");
    dbPathEl.id = "topbar-dbpath";
    dbPathEl.className = "topbar-dbpath";
    dbPathEl.textContent = this._dbBadge();

    const openBtn = document.createElement("button");
    openBtn.className = "topbar-db-btn";
    openBtn.textContent = "Ouvrir\u2026";
    openBtn.title = "Ouvrir une base de données existante";
    openBtn.addEventListener("click", () => void this._onOpenDb());

    const createBtn = document.createElement("button");
    createBtn.className = "topbar-db-btn";
    createBtn.textContent = "Cr\u00e9er\u2026";
    createBtn.title = "Créer une nouvelle base de données";
    createBtn.addEventListener("click", () => void this._onCreateDb(root));

    const presetsBtn = document.createElement("button");
    presetsBtn.className = "topbar-db-btn";
    presetsBtn.textContent = "\uD83D\uDCCB Presets";
    presetsBtn.title = "Gérer les presets de projet";
    presetsBtn.addEventListener("click", () => this._showPresetsModal());

    topbar.appendChild(titleEl);
    topbar.appendChild(dbPathEl);
    topbar.appendChild(openBtn);
    topbar.appendChild(createBtn);
    topbar.appendChild(presetsBtn);

    this._dbPathEl = dbPathEl;
    root.appendChild(topbar);

    // Tab bar
    const tabbar = document.createElement("div");
    tabbar.className = "tabbar";
    const LABELS: Record<TabId, string> = {
      project: "Projet",
      import: "Import",
      actions: "Actions",
      metadata: "Métadonnées",
      exports: "Exports",
    };
    for (const tab of TABS) {
      const btn = document.createElement("button");
      btn.className = "tab-btn" + (tab === this._activeTab ? " active" : "");
      btn.textContent = LABELS[tab];
      btn.addEventListener("click", () => this._switchTab(tab));
      this._tabBtns[tab] = btn as HTMLButtonElement;
      tabbar.appendChild(btn);
    }
    root.appendChild(tabbar);

    // Content
    const content = document.createElement("div");
    content.className = "content";

    // Job Center strip
    this._jobCenter = new JobCenter();
    root.appendChild(this._jobCenter.render());

    this._project = new ProjectScreen((event, dbPath) => {
      if (event === "db-changed") this._onDbChanged(dbPath);
    });
    this._import = new ImportScreen();
    this._actions = new ActionsScreen();
    this._metadata = new MetadataScreen();
    this._exports = new ExportsScreen();

    const screenMap: Record<TabId, () => HTMLElement> = {
      project: () => this._project.render(),
      import: () => this._import.render(),
      actions: () => this._actions.render(),
      metadata: () => this._metadata.render(),
      exports: () => this._exports.render(),
    };

    for (const tab of TABS) {
      const el = screenMap[tab]();
      el.classList.add("screen");
      if (tab === this._activeTab) el.classList.add("active");
      this._screenEls[tab] = el;
      content.appendChild(el);
    }

    root.appendChild(content);
  }

  private _switchTab(tab: TabId): void {
    this._screenEls[this._activeTab].classList.remove("active");
    this._tabBtns[this._activeTab].classList.remove("active");
    this._activeTab = tab;
    this._screenEls[tab].classList.add("active");
    this._tabBtns[tab].classList.add("active");
  }

  private _dbBadge(): string {
    const p = getCurrentDbPath();
    if (!p) return "Aucun corpus";
    return p.replace(/\\/g, "/").split("/").pop() ?? p;
  }

  private async _onOpenDb(): Promise<void> {
    let picked: string | string[] | null;
    try {
      picked = await dialogOpen({
        title: "Ouvrir une base de données SQLite",
        filters: [{ name: "SQLite", extensions: ["db", "sqlite", "sqlite3"] }],
        multiple: false,
      });
    } catch { return; }
    const p = Array.isArray(picked) ? picked[0] : picked;
    if (!p) return;
    setCurrentDbPath(p);
    this._dbPathEl.textContent = this._dbBadge();
    await this._onDbChanged(p);
    showToast(`DB active\u00a0: ${this._dbBadge()}`);
  }

  private async _onCreateDb(root: HTMLElement): Promise<void> {
    let savePath: string | null;
    try {
      savePath = await dialogSave({
        title: "Créer une nouvelle base de données AGRAFES",
        filters: [{ name: "SQLite", extensions: ["db"] }],
        defaultPath: "nouveau_corpus.db",
      });
    } catch { return; }
    if (!savePath) return;
    if (!/\.(db|sqlite|sqlite3)$/i.test(savePath)) savePath += ".db";

    setCurrentDbPath(savePath);
    this._dbPathEl.textContent = this._dbBadge();

    // Show init state
    const createBtns = root.querySelectorAll<HTMLButtonElement>(".topbar-db-btn");
    createBtns.forEach(b => { b.disabled = true; });

    // Remove any stale error banner
    root.querySelector(".prep-init-error")?.remove();

    try {
      await this._onDbChanged(savePath);
      showToast(`DB initialis\u00e9e\u00a0: ${this._dbBadge()}`);
    } catch (err) {
      this._showPrepInitError(root, savePath, String(err));
    } finally {
      createBtns.forEach(b => { b.disabled = false; });
    }
  }

  private _showPrepInitError(root: HTMLElement, dbPath: string, msg: string): void {
    root.querySelector(".prep-init-error")?.remove();
    const banner = document.createElement("div");
    banner.className = "prep-init-error";
    banner.innerHTML = `
      <span style="color:#856404;font-size:1.1rem">&#9888;</span>
      <span style="font-weight:600;color:#856404;white-space:nowrap">Impossible d&rsquo;initialiser la DB</span>
      <code class="prep-init-error-detail">${msg.replace(/&/g,"&amp;").replace(/</g,"&lt;")}</code>
      <button id="prep-retry-btn" class="topbar-db-btn">R&eacute;essayer</button>
      <button id="prep-change-btn" class="topbar-db-btn">Choisir un autre&hellip;</button>
      <button id="prep-dismiss-btn" class="topbar-db-btn">&times;</button>
    `;
    // Insert after topbar
    root.querySelector(".topbar")?.insertAdjacentElement("afterend", banner);
    banner.querySelector("#prep-retry-btn")?.addEventListener("click", () => {
      banner.remove();
      void this._onCreateDb(root);
    });
    banner.querySelector("#prep-change-btn")?.addEventListener("click", () => {
      banner.remove();
      void this._onOpenDb();
    });
    banner.querySelector("#prep-dismiss-btn")?.addEventListener("click", () => banner.remove());
  }

  // ─── Presets modal ─────────────────────────────────────────────────────────

  private _showPresetsModal(): void {
    const overlay = document.createElement("div");
    overlay.className = "presets-overlay";

    const modal = document.createElement("div");
    modal.className = "presets-modal";
    overlay.appendChild(modal);

    const head = document.createElement("div");
    head.className = "presets-modal-head";
    head.innerHTML = `<h3>\uD83D\uDCCB Presets de projet</h3>`;
    const closeX = document.createElement("button");
    closeX.className = "btn btn-secondary btn-sm";
    closeX.textContent = "\u2715 Fermer";
    closeX.addEventListener("click", () => overlay.remove());
    head.appendChild(closeX);
    modal.appendChild(head);

    const body = document.createElement("div");
    body.className = "presets-modal-body";
    modal.appendChild(body);

    const foot = document.createElement("div");
    foot.className = "presets-modal-foot";
    modal.appendChild(foot);

    const renderList = (): void => {
      body.innerHTML = "";
      const presets = _loadPresets();
      if (presets.length === 0) {
        body.innerHTML = `<p class="presets-empty">Aucun preset. Créez-en un ou importez un fichier JSON.</p>`;
        return;
      }
      for (const preset of presets) {
        const row = document.createElement("div");
        row.className = "preset-row";

        const info = document.createElement("div");
        info.style.flex = "1";
        info.innerHTML = `<span class="preset-name">${preset.name}</span>` +
          (preset.description ? `<span class="preset-desc">${preset.description}</span>` : "");
        const chips = document.createElement("div");
        chips.className = "preset-chips";
        if (preset.languages?.length) {
          chips.innerHTML += preset.languages.map(l => `<span class="preset-chip">${l}</span>`).join("");
        }
        if (preset.alignment_strategy)
          chips.innerHTML += `<span class="preset-chip">${preset.alignment_strategy}</span>`;
        if (preset.segmentation_pack)
          chips.innerHTML += `<span class="preset-chip">seg:${preset.segmentation_pack}</span>`;
        info.appendChild(chips);
        row.appendChild(info);

        const applyBtn = document.createElement("button");
        applyBtn.className = "btn btn-primary btn-sm";
        applyBtn.textContent = "Appliquer";
        applyBtn.addEventListener("click", () => {
          this._actions.applyPreset(preset);
          this._switchTab("actions");
          overlay.remove();
          showToast(`Preset appliqu\u00e9\u00a0: ${preset.name}`);
        });

        const dupBtn = document.createElement("button");
        dupBtn.className = "btn btn-secondary btn-sm";
        dupBtn.textContent = "Dupliquer";
        dupBtn.addEventListener("click", () => {
          const duped: ProjectPreset = {
            ...preset,
            id: `preset-${Date.now()}`,
            name: `${preset.name} (copie)`,
            created_at: Date.now(),
          };
          const all = _loadPresets();
          all.push(duped);
          _savePresets(all);
          renderList();
        });

        const delBtn = document.createElement("button");
        delBtn.className = "btn btn-danger btn-sm";
        delBtn.textContent = "\u2715";
        delBtn.title = "Supprimer ce preset";
        delBtn.addEventListener("click", () => {
          if (!confirm(`Supprimer le preset "${preset.name}" ?`)) return;
          const all = _loadPresets().filter(p => p.id !== preset.id);
          _savePresets(all);
          renderList();
        });

        row.appendChild(applyBtn);
        row.appendChild(dupBtn);
        row.appendChild(delBtn);
        body.appendChild(row);
      }
    };

    renderList();

    // ── Foot actions ──
    const newBtn = document.createElement("button");
    newBtn.className = "btn btn-secondary btn-sm";
    newBtn.textContent = "+ Nouveau preset";
    newBtn.addEventListener("click", () => this._showPresetEditModal(null, renderList));

    const importBtn = document.createElement("button");
    importBtn.className = "btn btn-secondary btn-sm";
    importBtn.textContent = "\u2B06 Importer\u2026";
    importBtn.addEventListener("click", async () => {
      try {
        const picked = await dialogOpen({
          title: "Importer un preset JSON",
          filters: [{ name: "JSON", extensions: ["json"] }],
          multiple: false,
        });
        const path = Array.isArray(picked) ? picked[0] : picked;
        if (!path) return;
        const raw = await readTextFile(path);
        const data = JSON.parse(raw);
        const presets = Array.isArray(data) ? data as ProjectPreset[] : [data as ProjectPreset];
        const all = _loadPresets();
        for (const p of presets) {
          if (!p.id) p.id = `preset-${Date.now()}`;
          if (!p.name) p.name = "Preset import\u00e9";
          if (!p.created_at) p.created_at = Date.now();
          all.push(p);
        }
        _savePresets(all);
        renderList();
        showToast(`${presets.length} preset(s) import\u00e9(s)`);
      } catch (err) {
        showToast(`Erreur import : ${String(err)}`, true);
      }
    });

    const exportBtn = document.createElement("button");
    exportBtn.className = "btn btn-secondary btn-sm";
    exportBtn.textContent = "\u2B07 Exporter\u2026";
    exportBtn.addEventListener("click", async () => {
      try {
        const path = await dialogSave({
          title: "Exporter les presets",
          filters: [{ name: "JSON", extensions: ["json"] }],
          defaultPath: "agrafes_presets.json",
        });
        if (!path) return;
        const presets = _loadPresets();
        await writeTextFile(path, JSON.stringify(presets, null, 2));
        showToast(`Presets export\u00e9s (${presets.length})`);
      } catch (err) {
        showToast(`Erreur export : ${String(err)}`, true);
      }
    });

    foot.appendChild(newBtn);
    foot.appendChild(importBtn);
    foot.appendChild(exportBtn);

    // Close on overlay click (not modal click)
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") overlay.remove(); }, { once: true });

    document.body.appendChild(overlay);
  }

  private _showPresetEditModal(preset: ProjectPreset | null, onSave: () => void): void {
    const isNew = preset === null;
    const draft: ProjectPreset = preset ? { ...preset } : {
      id: `preset-${Date.now()}`,
      name: "",
      description: "",
      languages: ["fr"],
      pivot_language: "fr",
      segmentation_lang: "fr",
      segmentation_pack: "auto",
      curation_preset: "spaces",
      alignment_strategy: "external_id_then_position",
      created_at: Date.now(),
    };

    const overlay = document.createElement("div");
    overlay.className = "presets-overlay";
    overlay.style.zIndex = "9100";

    const modal = document.createElement("div");
    modal.className = "presets-modal";
    overlay.appendChild(modal);

    modal.innerHTML = `
      <div class="presets-modal-head">
        <h3>${isNew ? "Nouveau preset" : "Modifier preset"}</h3>
      </div>
      <div class="presets-modal-body">
        <label style="display:flex;flex-direction:column;gap:0.2rem;margin-bottom:0.5rem;font-size:0.85rem">
          Nom <input id="pe-name" type="text" value="${draft.name}" style="padding:0.25rem 0.4rem;border:1px solid #dee2e6;border-radius:4px" />
        </label>
        <label style="display:flex;flex-direction:column;gap:0.2rem;margin-bottom:0.5rem;font-size:0.85rem">
          Description <input id="pe-desc" type="text" value="${draft.description ?? ""}" style="padding:0.25rem 0.4rem;border:1px solid #dee2e6;border-radius:4px" />
        </label>
        <label style="display:flex;flex-direction:column;gap:0.2rem;margin-bottom:0.5rem;font-size:0.85rem">
          Langues (séparées par virgule) <input id="pe-langs" type="text" value="${(draft.languages ?? []).join(",")}" style="padding:0.25rem 0.4rem;border:1px solid #dee2e6;border-radius:4px" />
        </label>
        <label style="display:flex;flex-direction:column;gap:0.2rem;margin-bottom:0.5rem;font-size:0.85rem">
          Langue pivot <input id="pe-pivot" type="text" value="${draft.pivot_language ?? ""}" style="padding:0.25rem 0.4rem;border:1px solid #dee2e6;border-radius:4px;width:80px" />
        </label>
        <div style="display:flex;gap:1rem;flex-wrap:wrap;margin-bottom:0.5rem">
          <label style="display:flex;flex-direction:column;gap:0.2rem;font-size:0.85rem">Langue segmentation
            <input id="pe-seg-lang" type="text" value="${draft.segmentation_lang ?? ""}" style="padding:0.25rem 0.4rem;border:1px solid #dee2e6;border-radius:4px;width:80px" />
          </label>
          <label style="display:flex;flex-direction:column;gap:0.2rem;font-size:0.85rem">Pack segmentation
            <select id="pe-seg-pack" style="padding:0.25rem 0.4rem;border:1px solid #dee2e6;border-radius:4px">
              <option value="auto" ${draft.segmentation_pack === "auto" ? "selected" : ""}>auto</option>
              <option value="fr_strict" ${draft.segmentation_pack === "fr_strict" ? "selected" : ""}>fr_strict</option>
              <option value="en_strict" ${draft.segmentation_pack === "en_strict" ? "selected" : ""}>en_strict</option>
              <option value="default" ${draft.segmentation_pack === "default" ? "selected" : ""}>default</option>
            </select>
          </label>
        </div>
        <div style="display:flex;gap:1rem;flex-wrap:wrap;margin-bottom:0.5rem">
          <label style="display:flex;flex-direction:column;gap:0.2rem;font-size:0.85rem">Preset curation
            <select id="pe-curation" style="padding:0.25rem 0.4rem;border:1px solid #dee2e6;border-radius:4px">
              <option value="spaces" ${draft.curation_preset === "spaces" ? "selected" : ""}>Espaces</option>
              <option value="quotes" ${draft.curation_preset === "quotes" ? "selected" : ""}>Apostrophes</option>
              <option value="punctuation" ${draft.curation_preset === "punctuation" ? "selected" : ""}>Ponctuation</option>
              <option value="custom" ${draft.curation_preset === "custom" ? "selected" : ""}>Personnalis\u00e9</option>
            </select>
          </label>
          <label style="display:flex;flex-direction:column;gap:0.2rem;font-size:0.85rem">Strat\u00e9gie alignement
            <select id="pe-strategy" style="padding:0.25rem 0.4rem;border:1px solid #dee2e6;border-radius:4px">
              <option value="external_id" ${draft.alignment_strategy === "external_id" ? "selected" : ""}>external_id</option>
              <option value="external_id_then_position" ${draft.alignment_strategy === "external_id_then_position" ? "selected" : ""}>hybride</option>
              <option value="position" ${draft.alignment_strategy === "position" ? "selected" : ""}>position</option>
              <option value="similarity" ${draft.alignment_strategy === "similarity" ? "selected" : ""}>similarit\u00e9</option>
            </select>
          </label>
        </div>
      </div>
      <div class="presets-modal-foot"></div>
    `;

    const foot = modal.querySelector(".presets-modal-foot")!;
    const saveBtn = document.createElement("button");
    saveBtn.className = "btn btn-primary btn-sm";
    saveBtn.textContent = "Enregistrer";
    saveBtn.addEventListener("click", () => {
      const nameVal = (modal.querySelector<HTMLInputElement>("#pe-name")!).value.trim();
      if (!nameVal) { alert("Le nom est requis."); return; }
      const saved: ProjectPreset = {
        ...draft,
        name: nameVal,
        description: (modal.querySelector<HTMLInputElement>("#pe-desc")!).value.trim() || undefined,
        languages: (modal.querySelector<HTMLInputElement>("#pe-langs")!).value.split(",").map(l => l.trim()).filter(Boolean),
        pivot_language: (modal.querySelector<HTMLInputElement>("#pe-pivot")!).value.trim() || undefined,
        segmentation_lang: (modal.querySelector<HTMLInputElement>("#pe-seg-lang")!).value.trim() || undefined,
        segmentation_pack: (modal.querySelector<HTMLSelectElement>("#pe-seg-pack")!).value || undefined,
        curation_preset: (modal.querySelector<HTMLSelectElement>("#pe-curation")!).value || undefined,
        alignment_strategy: (modal.querySelector<HTMLSelectElement>("#pe-strategy")!).value || undefined,
        created_at: draft.created_at || Date.now(),
      };
      const all = _loadPresets().filter(p => p.id !== saved.id);
      all.push(saved);
      _savePresets(all);
      overlay.remove();
      onSave();
      showToast(`Preset ${isNew ? "cr\u00e9\u00e9" : "mis \u00e0 jour"}\u00a0: ${saved.name}`);
    });
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "btn btn-secondary btn-sm";
    cancelBtn.textContent = "Annuler";
    cancelBtn.addEventListener("click", () => overlay.remove());
    foot.appendChild(saveBtn);
    foot.appendChild(cancelBtn);

    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") overlay.remove(); }, { once: true });
    document.body.appendChild(overlay);
  }

  private async _onDbChanged(dbPath: string): Promise<void> {
    this._dbPathEl.textContent = dbPath;
    try {
      this._conn = await ensureRunning(dbPath);
    } catch (err) {
      this._conn = null;
      console.error("db-changed: sidecar failed", err instanceof SidecarError ? err.message : err);
    }
    this._import.setConn(this._conn);
    this._actions.setConn(this._conn);
    this._metadata.setConn(this._conn);
    this._exports.setConn(this._conn);
    this._jobCenter.setConn(this._conn);
    this._import.setJobCenter(this._jobCenter, showToast);
    this._actions.setJobCenter(this._jobCenter, showToast);
    this._exports.setJobCenter(this._jobCenter, showToast);
  }

  /** Stop all background timers (JobCenter polling). Called by tauri-shell on unmount. */
  dispose(): void {
    this._jobCenter?.setConn(null);
  }
}
