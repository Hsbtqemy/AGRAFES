/**
 * app.ts — ConcordancierPrep V0.4 shell.
 *
 * Tab navigation: [Projet] [Import] [Actions] [Métadonnées] [Exports]
 * Manages shared Conn state and propagates db-changed events.
 */

import type { Conn } from "./lib/sidecarClient.ts";
import { ensureRunning, SidecarError } from "./lib/sidecarClient.ts";
import { getCurrentDbPath, setCurrentDbPath, getOrCreateDefaultDbPath } from "./lib/db.ts";
import { ProjectScreen } from "./screens/ProjectScreen.ts";
import { ImportScreen } from "./screens/ImportScreen.ts";
import { ActionsScreen } from "./screens/ActionsScreen.ts";
import { MetadataScreen } from "./screens/MetadataScreen.ts";
import { ExportsScreen } from "./screens/ExportsScreen.ts";
import { JobCenter, JOB_CENTER_CSS, showToast } from "./components/JobCenter.ts";

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
    display: flex; align-items: center; height: 44px; gap: 1rem; }
  .topbar-title { font-size: 1rem; font-weight: 600; flex: 1; }
  .topbar-dbpath { font-size: 11px; opacity: 0.75; max-width: 400px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

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
    topbar.innerHTML = `
      <span class="topbar-title">Concordancier Prep</span>
      <span id="topbar-dbpath" class="topbar-dbpath">${getCurrentDbPath() ?? "Aucun corpus"}</span>
    `;
    this._dbPathEl = topbar.querySelector("#topbar-dbpath")!;
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
}
