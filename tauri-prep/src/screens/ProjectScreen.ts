/**
 * ProjectScreen — open/create corpus DB, show sidecar status, shutdown.
 */

import { open } from "@tauri-apps/plugin-dialog";
import type { Conn } from "../lib/sidecarClient.ts";
import {
  ensureRunning,
  getHealth,
  shutdownSidecar,
  resetConnection,
  SidecarError,
} from "../lib/sidecarClient.ts";
import {
  getCurrentDbPath,
  setCurrentDbPath,
  getOrCreateDefaultDbPath,
} from "../lib/db.ts";

export type ProjectEventHandler = (event: "db-changed", dbPath: string) => void;

export class ProjectScreen {
  private _conn: Conn | null = null;
  private _onEvent: ProjectEventHandler;
  private _statusEl!: HTMLElement;
  private _dbPathEl!: HTMLElement;
  private _logEl!: HTMLElement;
  private _openInCardEl!: HTMLElement;
  private _copyToastEl!: HTMLElement;
  private _copyFallbackEl!: HTMLElement;
  private _copyInputEl!: HTMLInputElement;
  private _instructionsModalEl!: HTMLElement;
  private _copyToastTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(onEvent: ProjectEventHandler) {
    this._onEvent = onEvent;
  }

  render(): HTMLElement {
    const root = document.createElement("div");
    root.className = "screen project-screen";

    root.innerHTML = `
      <h2 class="screen-title">Projet / Base de données</h2>

      <section class="card">
        <h3>Base de données active</h3>
        <p class="db-path" id="proj-db-path">—</p>
        <div class="btn-row">
          <button id="proj-open-btn" class="btn btn-primary">Ouvrir un corpus…</button>
          <button id="proj-new-btn" class="btn btn-secondary">Nouveau corpus…</button>
          <button id="proj-default-btn" class="btn btn-secondary">Corpus par défaut</button>
        </div>
      </section>

      <section class="card" id="proj-open-in-concordancier" style="display:none">
        <h3>Ouvrir dans Concordancier</h3>
        <p class="hint">Utilise la même DB dans l’app Concordancier.</p>
        <div class="btn-row">
          <button id="proj-copy-db-btn" class="btn btn-primary">Copier le chemin de la DB</button>
          <button id="proj-instructions-btn" class="btn btn-secondary">Instructions Concordancier</button>
          <span id="proj-copy-toast" class="status-badge status-ok" style="display:none">Copié !</span>
        </div>
        <div id="proj-copy-fallback" style="display:none; margin-top:0.75rem">
          <p class="hint" style="margin-bottom:0.4rem">Copie automatique indisponible. Sélectionne puis copie manuellement.</p>
          <div class="btn-row">
            <input id="proj-copy-input" type="text" readonly style="flex:1; min-width:280px; padding:0.35rem 0.5rem; border:1px solid var(--color-border); border-radius:var(--radius)" />
            <button id="proj-select-all-btn" class="btn btn-secondary">Sélectionner tout</button>
          </div>
        </div>
      </section>

      <section class="card">
        <h3>État du sidecar</h3>
        <div id="proj-status" class="status-badge status-unknown">Inconnu</div>
        <table class="meta-table" id="proj-meta-table" style="display:none">
          <tbody></tbody>
        </table>
        <div class="btn-row" style="margin-top:0.75rem">
          <button id="proj-refresh-btn" class="btn btn-secondary">Actualiser</button>
          <button id="proj-shutdown-btn" class="btn btn-danger">Arrêter le sidecar</button>
        </div>
      </section>

      <section class="card">
        <h3>Journal</h3>
        <div id="proj-log" class="log-pane"></div>
      </section>

      <div
        id="proj-instructions-modal"
        style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.35); align-items:center; justify-content:center; z-index:1000;"
      >
        <div style="background:#fff; width:min(520px, 92vw); border-radius:8px; padding:1rem 1rem 0.9rem 1rem; box-shadow:0 8px 24px rgba(0,0,0,0.24);">
          <h3 style="margin:0 0 0.6rem">Workflow Prep → Concordancier</h3>
          <ol style="margin:0 0 0.85rem 1rem; padding:0; line-height:1.45;">
            <li>Ouvre l’app Concordancier (<code>tauri-app</code>).</li>
            <li>Clique <code>Open DB…</code>.</li>
            <li>Colle le chemin déjà copié ou sélectionne le fichier <code>.db</code>.</li>
            <li>Lance une recherche et active la vue Alignés si nécessaire.</li>
          </ol>
          <div class="btn-row" style="justify-content:flex-end">
            <button id="proj-close-instructions-btn" class="btn btn-primary">OK</button>
          </div>
        </div>
      </div>
    `;

    this._dbPathEl = root.querySelector("#proj-db-path")!;
    this._statusEl = root.querySelector("#proj-status")!;
    this._logEl = root.querySelector("#proj-log")!;
    this._openInCardEl = root.querySelector("#proj-open-in-concordancier")!;
    this._copyToastEl = root.querySelector("#proj-copy-toast")!;
    this._copyFallbackEl = root.querySelector("#proj-copy-fallback")!;
    this._copyInputEl = root.querySelector("#proj-copy-input")!;
    this._instructionsModalEl = root.querySelector("#proj-instructions-modal")!;

    this._updateDbPath();

    root.querySelector("#proj-open-btn")!.addEventListener("click", () => this._openDb());
    root.querySelector("#proj-new-btn")!.addEventListener("click", () => this._newDb());
    root.querySelector("#proj-default-btn")!.addEventListener("click", () => this._useDefault());
    root.querySelector("#proj-copy-db-btn")!.addEventListener("click", () => this._copyDbPath());
    root.querySelector("#proj-select-all-btn")!.addEventListener("click", () => this._selectAllDbPath());
    root.querySelector("#proj-instructions-btn")!.addEventListener("click", () => this._showInstructions());
    root.querySelector("#proj-close-instructions-btn")!.addEventListener("click", () => this._hideInstructions());
    root.querySelector("#proj-refresh-btn")!.addEventListener("click", () => this._refreshStatus());
    root.querySelector("#proj-shutdown-btn")!.addEventListener("click", () => this._shutdownSidecar());
    this._instructionsModalEl.addEventListener("click", (event) => {
      if (event.target === this._instructionsModalEl) this._hideInstructions();
    });

    return root;
  }

  setConn(conn: Conn | null): void {
    this._conn = conn;
    this._refreshStatus();
  }

  private _log(msg: string, isError = false): void {
    const ts = new Date().toLocaleTimeString();
    const line = document.createElement("div");
    line.className = isError ? "log-line log-error" : "log-line";
    line.textContent = `[${ts}] ${msg}`;
    this._logEl.appendChild(line);
    this._logEl.scrollTop = this._logEl.scrollHeight;
  }

  private _updateDbPath(): void {
    const p = getCurrentDbPath();
    this._dbPathEl.textContent = p ?? "Aucun corpus sélectionné";
    this._openInCardEl.style.display = p ? "" : "none";
    this._copyInputEl.value = p ?? "";
    if (!p) this._copyFallbackEl.style.display = "none";
  }

  private _showCopyToast(label: string): void {
    this._copyToastEl.textContent = label;
    this._copyToastEl.style.display = "";
    if (this._copyToastTimer) clearTimeout(this._copyToastTimer);
    this._copyToastTimer = setTimeout(() => {
      this._copyToastEl.style.display = "none";
      this._copyToastTimer = null;
    }, 1300);
  }

  private async _copyDbPath(): Promise<void> {
    const p = getCurrentDbPath();
    if (!p) {
      this._log("Aucune DB active à copier.");
      return;
    }
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(p);
        this._copyFallbackEl.style.display = "none";
        this._showCopyToast("Copié !");
        this._log("Chemin DB copié.");
        return;
      } catch {
        // fallback below
      }
    }
    this._copyFallbackEl.style.display = "";
    this._selectAllDbPath();
    this._showCopyToast("Sélectionne et copie");
    this._log("Copie automatique indisponible, fallback affiché.");
  }

  private _selectAllDbPath(): void {
    this._copyInputEl.focus();
    this._copyInputEl.select();
  }

  private _showInstructions(): void {
    this._instructionsModalEl.style.display = "flex";
  }

  private _hideInstructions(): void {
    this._instructionsModalEl.style.display = "none";
  }

  private async _openOrLoad(dbPath: string): Promise<void> {
    this._log(`Ouverture du corpus : ${dbPath}`);
    if (this._conn) {
      await shutdownSidecar(this._conn);
      this._conn = null;
    }
    resetConnection();
    setCurrentDbPath(dbPath);
    this._updateDbPath();
    try {
      this._conn = await ensureRunning(dbPath);
      this._log("Sidecar démarré.");
      this._onEvent("db-changed", dbPath);
      await this._refreshStatus();
    } catch (err) {
      this._log(`Erreur sidecar : ${err instanceof SidecarError ? err.message : String(err)}`, true);
    }
  }

  private async _openDb(): Promise<void> {
    const selected = await open({
      title: "Ouvrir un corpus",
      filters: [{ name: "SQLite DB", extensions: ["db", "sqlite", "sqlite3"] }],
      multiple: false,
    });
    if (!selected) return;
    const p = typeof selected === "string" ? selected : selected[0];
    if (p) await this._openOrLoad(p);
  }

  private async _newDb(): Promise<void> {
    const selected = await open({
      title: "Choisir l'emplacement du nouveau corpus",
      directory: true,
      multiple: false,
    });
    if (!selected) return;
    const dir = typeof selected === "string" ? selected : selected[0];
    if (!dir) return;
    const sep = dir.includes("/") ? "/" : "\\";
    const dbPath = `${dir}${sep}corpus.db`;
    await this._openOrLoad(dbPath);
  }

  private async _useDefault(): Promise<void> {
    const dbPath = await getOrCreateDefaultDbPath();
    await this._openOrLoad(dbPath);
  }

  private async _refreshStatus(): Promise<void> {
    if (!this._conn) {
      this._statusEl.className = "status-badge status-unknown";
      this._statusEl.textContent = "Aucun sidecar";
      return;
    }
    try {
      const health = await getHealth(this._conn);
      this._statusEl.className = "status-badge status-ok";
      this._statusEl.textContent = "En ligne";
      const container = this._statusEl.closest(".card")!;
      const table = container.querySelector("#proj-meta-table") as HTMLElement;
      table.style.display = "";
      const tbody = table.querySelector("tbody")!;
      tbody.innerHTML = `
        <tr><td>Port</td><td>${health.port}</td></tr>
        <tr><td>PID</td><td>${health.pid}</td></tr>
        <tr><td>Démarré</td><td>${health.started_at}</td></tr>
        <tr><td>Version</td><td>${health.version}</td></tr>
      `;
    } catch {
      this._statusEl.className = "status-badge status-error";
      this._statusEl.textContent = "Hors ligne";
    }
  }

  private async _shutdownSidecar(): Promise<void> {
    if (!this._conn) { this._log("Aucun sidecar actif."); return; }
    this._log("Arrêt du sidecar…");
    await shutdownSidecar(this._conn);
    this._conn = null;
    this._statusEl.className = "status-badge status-unknown";
    this._statusEl.textContent = "Arrêté";
    this._log("Sidecar arrêté.");
  }
}
