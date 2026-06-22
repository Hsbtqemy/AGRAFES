/**
 * ShareDocsImportScreen.ts — import depuis un dépôt WebDAV (ShareDocs, Phase 3).
 *
 * Flux : connexion (URL + auth) → POST /webdav/list → navigation dossier →
 * choix mode/langue/filtre → POST /import-remote (job async) → progression via
 * JobCenter → table de rapport par fichier.
 *
 * Aucune logique métier côté front : filtre/dédup/provenance vivent dans le
 * backend (Phases 1-2). Les identifiants restent en mémoire de session
 * uniquement — jamais écrits sur disque / localStorage / config (décision §6/P3).
 */

import type {
  Conn,
  ImportRemoteReport,
  RemoteEntry,
  WebdavAuth,
  WebdavAuthMode,
} from "../lib/sidecarClient.ts";
import { webdavList, importRemote } from "../lib/sidecarClient.ts";
import type { JobCenter } from "../components/JobCenter.ts";
import { setHtml, appendHtml, raw, safeHtml } from "../lib/safeHtml.ts";
import {
  authIsComplete,
  buildWebdavAuth,
  folderLabel,
  formatRemoteSize,
  normalizeFolderUrl,
  sortRemoteEntries,
  statusBadgeKind,
  statusLabel,
  summarizeReport,
} from "../lib/shareDocs.ts";

const IMPORT_MODES: Array<{ value: string; label: string }> = [
  { value: "docx_numbered_lines", label: "DOCX — lignes numérotées [N]" },
  { value: "txt_numbered_lines", label: "TXT — lignes numérotées [N]" },
  { value: "docx_paragraphs", label: "DOCX — paragraphes" },
  { value: "odt_paragraphs", label: "ODT — paragraphes" },
  { value: "odt_numbered_lines", label: "ODT — lignes numérotées [N]" },
  { value: "tei", label: "TEI (XML)" },
  { value: "conllu", label: "CoNLL-U" },
];

// Static, no user input → safe to embed in the raw() skeleton.
const MODE_OPTIONS = IMPORT_MODES.map(
  (m) => `<option value="${m.value}">${m.label}</option>`,
).join("");

const SHAREDOCS_CSS = `
  .prep-sharedocs-screen .sd-wrap { max-width: 860px; margin: 0 auto; padding: 1rem 1.25rem 3rem; }
  .prep-sharedocs-screen .sd-title { margin: 0 0 0.25rem; }
  .prep-sharedocs-screen .sd-intro { color: var(--color-muted); margin: 0 0 1rem; font-size: 0.9rem; }
  .prep-sharedocs-screen .sd-card { border: 1px solid var(--color-border, #dbe2ec); border-radius: 8px;
    padding: 1rem 1.1rem; margin-bottom: 1rem; background: var(--color-surface, #fff); }
  .prep-sharedocs-screen .sd-card-title { margin: 0 0 0.75rem; font-size: 0.95rem; }
  .prep-sharedocs-screen .sd-field { display: flex; flex-direction: column; gap: 0.25rem;
    margin-bottom: 0.6rem; font-size: 0.82rem; }
  .prep-sharedocs-screen .sd-field > span { color: var(--color-muted); }
  .prep-sharedocs-screen .sd-field input, .prep-sharedocs-screen .sd-field select {
    padding: 0.4rem 0.5rem; border: 1px solid var(--color-border, #ccd4e0); border-radius: 5px; font-size: 0.85rem; }
  .prep-sharedocs-screen .sd-creds { border-left: 2px solid var(--color-border, #e3e8f0);
    padding-left: 0.75rem; margin: 0 0 0.6rem; }
  .prep-sharedocs-screen .sd-note { font-size: 0.74rem; color: var(--color-muted); margin: 0.2rem 0 0.8rem; }
  .prep-sharedocs-screen .sd-btn { padding: 0.45rem 0.9rem; border-radius: 6px; border: 1px solid transparent;
    cursor: pointer; font-size: 0.85rem; font-weight: 600; }
  .prep-sharedocs-screen .sd-btn--primary { background: var(--color-primary, #2f5fd6); color: #fff; }
  .prep-sharedocs-screen .sd-btn--primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .prep-sharedocs-screen .sd-btn--ghost { background: transparent; border-color: var(--color-border, #ccd4e0);
    color: var(--color-text, #223); }
  .prep-sharedocs-screen .sd-crumb { display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.6rem; }
  .prep-sharedocs-screen .sd-current-url { font-size: 0.78rem; color: var(--color-muted); word-break: break-all; }
  .prep-sharedocs-screen .sd-entries { max-height: 320px; overflow: auto; border: 1px solid var(--color-border, #e3e8f0);
    border-radius: 6px; margin-bottom: 0.9rem; }
  .prep-sharedocs-screen .sd-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
  .prep-sharedocs-screen .sd-table th { text-align: left; padding: 0.4rem 0.6rem; color: var(--color-muted);
    font-weight: 600; border-bottom: 1px solid var(--color-border, #e3e8f0); position: sticky; top: 0;
    background: var(--color-surface, #fff); }
  .prep-sharedocs-screen .sd-table td { padding: 0.35rem 0.6rem; border-bottom: 1px solid var(--color-border, #eef2f7); }
  .prep-sharedocs-screen .sd-folder-link { background: none; border: none; color: var(--color-primary, #2f5fd6);
    cursor: pointer; font-size: 0.82rem; padding: 0; }
  .prep-sharedocs-screen .sd-empty { color: var(--color-muted); padding: 0.8rem; font-size: 0.85rem; }
  .prep-sharedocs-screen .sd-import-controls { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: flex-end; }
  .prep-sharedocs-screen .sd-import-controls .sd-field { flex: 1 1 140px; margin-bottom: 0; }
  .prep-sharedocs-screen .sd-summary { font-weight: 600; margin: 0 0 0.6rem; }
  .prep-sharedocs-screen .sd-badge { display: inline-block; padding: 0.1rem 0.45rem; border-radius: 10px;
    font-size: 0.72rem; font-weight: 700; }
  .prep-sharedocs-screen .sd-badge--ok { background: #d4edda; color: #155724; }
  .prep-sharedocs-screen .sd-badge--warn { background: #fff3cd; color: #856404; }
  .prep-sharedocs-screen .sd-badge--error { background: #f8d7da; color: #721c24; }
  .prep-sharedocs-screen .sd-badge--muted { background: #e9ecef; color: #495057; }
`;

function ensureStyles(): void {
  if (document.getElementById("sd-styles")) return;
  const style = document.createElement("style");
  style.id = "sd-styles";
  style.textContent = SHAREDOCS_CSS; // textContent, not a HTML sink
  document.head.appendChild(style);
}

export class ShareDocsImportScreen {
  private _conn: Conn | null = null;
  private _jobCenter: JobCenter | null = null;
  private _showToast: ((msg: string, isError?: boolean) => void) | null = null;
  private _logEl: HTMLElement | null = null;
  private _root: HTMLElement | null = null;

  /** In-memory credentials — never persisted (Phase 3 decision). */
  private _auth: WebdavAuth = { mode: "anonymous" };
  private _currentUrl = "";
  private _history: string[] = [];
  private _entries: RemoteEntry[] = [];
  private _report: ImportRemoteReport | null = null;
  private _busy = false;

  render(): HTMLElement {
    ensureStyles();
    const root = document.createElement("div");
    root.className = "screen prep-sharedocs-screen";
    this._root = root;

    setHtml(
      root,
      raw(`
      <div class="sd-wrap">
        <h2 class="sd-title">Importer depuis ShareDocs (WebDAV)</h2>
        <p class="sd-intro">Parcourez un dépôt WebDAV (ShareDocs Huma-Num…) et ingérez un dossier entier.
          La base reste strictement locale — rien n'est ré-écrit côté serveur.</p>

        <section class="sd-card">
          <h3 class="sd-card-title">1. Connexion</h3>
          <label class="sd-field"><span>URL du dossier</span>
            <input type="text" id="sd-url" autocomplete="off" spellcheck="false"
              placeholder="https://serveur/remote.php/dav/files/utilisateur/dossier/" />
          </label>
          <label class="sd-field"><span>Authentification</span>
            <select id="sd-auth-mode">
              <option value="anonymous">Anonyme</option>
              <option value="basic">Identifiant + mot de passe</option>
              <option value="bearer">Jeton (Bearer)</option>
            </select>
          </label>
          <div id="sd-basic-fields" class="sd-creds" style="display:none">
            <label class="sd-field"><span>Identifiant</span><input type="text" id="sd-user" autocomplete="off" /></label>
            <label class="sd-field"><span>Mot de passe</span><input type="password" id="sd-password" autocomplete="off" /></label>
          </div>
          <div id="sd-bearer-fields" class="sd-creds" style="display:none">
            <label class="sd-field"><span>Jeton</span><input type="password" id="sd-token" autocomplete="off" /></label>
          </div>
          <p class="sd-note">🔒 Les identifiants restent en mémoire pour cette session uniquement — jamais écrits sur le disque.</p>
          <button type="button" id="sd-connect-btn" class="sd-btn sd-btn--primary">Connecter</button>
        </section>

        <section class="sd-card" id="sd-folder-section" style="display:none">
          <h3 class="sd-card-title">2. Dossier</h3>
          <div class="sd-crumb">
            <button type="button" id="sd-up-btn" class="sd-btn sd-btn--ghost" disabled>← Retour</button>
            <code id="sd-current-url" class="sd-current-url"></code>
          </div>
          <div id="sd-entries" class="sd-entries"></div>
          <div class="sd-import-controls">
            <label class="sd-field"><span>Mode d'import</span>
              <select id="sd-mode">${MODE_OPTIONS}</select>
            </label>
            <label class="sd-field"><span>Langue (ISO, optionnel)</span><input type="text" id="sd-language" placeholder="fr" /></label>
            <label class="sd-field"><span>Filtre (glob, optionnel)</span><input type="text" id="sd-include" placeholder="*.docx" /></label>
            <button type="button" id="sd-import-btn" class="sd-btn sd-btn--primary">Importer ce dossier</button>
          </div>
        </section>

        <section class="sd-card" id="sd-report-section" style="display:none">
          <h3 class="sd-card-title">3. Rapport</h3>
          <div id="sd-report"></div>
        </section>
      </div>
    `),
    );

    root.querySelector("#sd-auth-mode")?.addEventListener("change", () => this._onAuthModeChange());
    root.querySelector("#sd-connect-btn")?.addEventListener("click", () => void this._connect());
    root.querySelector("#sd-up-btn")?.addEventListener("click", () => void this._goUp());
    root.querySelector("#sd-import-btn")?.addEventListener("click", () => void this._runImport());
    root.querySelector("#sd-entries")?.addEventListener("click", (ev) => this._onEntryClick(ev));

    this._updateConnectBtn();
    return root;
  }

  // ─── Lifecycle (mirrors the other Prep screens) ─────────────────────────────

  setConn(conn: Conn | null): void {
    this._conn = conn;
    this._updateConnectBtn();
  }

  setJobCenter(jc: JobCenter, showToast: (msg: string, isError?: boolean) => void): void {
    this._jobCenter = jc;
    this._showToast = showToast;
  }

  setLogEl(el: HTMLElement): void {
    this._logEl = el;
  }

  // ─── Connection / browsing ──────────────────────────────────────────────────

  private async _connect(): Promise<void> {
    if (!this._conn) {
      this._showToast?.("Connexion au moteur indisponible", true);
      return;
    }
    const rawUrl = this._root?.querySelector<HTMLInputElement>("#sd-url")?.value ?? "";
    const url = normalizeFolderUrl(rawUrl);
    if (!url) {
      this._showToast?.("Saisissez l'URL d'un dossier WebDAV", true);
      return;
    }
    this._auth = this._readAuthFromForm();
    if (!authIsComplete(this._auth)) {
      this._showToast?.("Identifiants incomplets pour ce mode d'authentification", true);
      return;
    }
    this._history = [];
    await this._browse(url);
  }

  private async _browse(url: string): Promise<void> {
    if (!this._conn || this._busy) return;
    this._setBusy(true);
    try {
      const entries = await webdavList(this._conn, { url, auth: this._auth });
      this._currentUrl = url;
      this._entries = sortRemoteEntries(entries);
      this._renderEntries();
      this._log(`✓ ${entries.length} élément(s) — ${decodeURIComponent(url)}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._showToast?.(`✗ ${msg}`, true);
      this._log(`✗ ${msg}`, true);
    } finally {
      this._setBusy(false);
    }
  }

  private _onEntryClick(ev: Event): void {
    const target = (ev.target as HTMLElement | null)?.closest<HTMLElement>("[data-idx]");
    if (!target) return;
    const entry = this._entries[Number(target.dataset.idx)];
    if (!entry || !entry.is_dir) return;
    this._history.push(this._currentUrl);
    void this._browse(entry.href);
  }

  private _goUp(): void {
    const prev = this._history.pop();
    if (prev) void this._browse(prev);
  }

  // ─── Import ─────────────────────────────────────────────────────────────────

  private async _runImport(): Promise<void> {
    if (!this._conn || !this._currentUrl) return;
    const mode = this._root?.querySelector<HTMLSelectElement>("#sd-mode")?.value ?? "";
    if (!mode) {
      this._showToast?.("Choisissez un mode d'import", true);
      return;
    }
    const language = this._root?.querySelector<HTMLInputElement>("#sd-language")?.value.trim() || undefined;
    const include = this._root?.querySelector<HTMLInputElement>("#sd-include")?.value.trim() || undefined;
    this._auth = this._readAuthFromForm();

    const importBtn = this._root?.querySelector<HTMLButtonElement>("#sd-import-btn");
    if (importBtn) importBtn.disabled = true;
    try {
      const job = await importRemote(this._conn, {
        url: this._currentUrl,
        mode,
        language,
        include,
        auth: this._auth,
      });
      this._report = null;
      this._renderReport();
      this._log(`▶ Import lancé — ${decodeURIComponent(this._currentUrl)} (${mode})`);
      this._jobCenter?.trackJob(job.job_id, `ShareDocs : ${folderLabel(this._currentUrl)}`, (done) => {
        if (importBtn) importBtn.disabled = false;
        if (done.status === "done" && done.result) {
          this._report = done.result as unknown as ImportRemoteReport;
          this._renderReport();
          const summary = summarizeReport(this._report);
          this._showToast?.(`✓ ${summary}`);
          this._log(`✓ ${summary}`);
        } else {
          const msg =
            done.error ||
            (done.status === "done" ? "Import terminé sans rapport" : "Import distant interrompu");
          this._showToast?.(`✗ ${msg}`, true);
          this._log(`✗ ${msg}`, true);
        }
      });
    } catch (err) {
      if (importBtn) importBtn.disabled = false;
      const msg = err instanceof Error ? err.message : String(err);
      this._showToast?.(`✗ ${msg}`, true);
      this._log(`✗ ${msg}`, true);
    }
  }

  // ─── Rendering ──────────────────────────────────────────────────────────────

  private _renderEntries(): void {
    const host = this._root?.querySelector<HTMLElement>("#sd-entries");
    const section = this._root?.querySelector<HTMLElement>("#sd-folder-section");
    if (!host) return;
    if (section) section.style.display = "";

    const crumb = this._root?.querySelector<HTMLElement>("#sd-current-url");
    if (crumb) crumb.textContent = decodeURIComponent(this._currentUrl);
    const upBtn = this._root?.querySelector<HTMLButtonElement>("#sd-up-btn");
    if (upBtn) upBtn.disabled = this._history.length === 0;

    if (this._entries.length === 0) {
      setHtml(host, safeHtml`<p class="sd-empty">Dossier vide.</p>`);
      return;
    }

    const rows = this._entries.map((e, idx) => {
      const icon = e.is_dir ? "📁" : "📄";
      const nameCell = e.is_dir
        ? safeHtml`<button type="button" class="sd-folder-link" data-idx="${idx}">${icon} ${e.name}/</button>`
        : safeHtml`<span>${icon} ${e.name}</span>`;
      const size = e.is_dir ? "" : formatRemoteSize(e.size);
      return safeHtml`<tr>
        <td class="sd-name">${nameCell}</td>
        <td class="sd-size">${size}</td>
        <td class="sd-mod">${e.modified ?? ""}</td>
      </tr>`;
    });

    setHtml(
      host,
      safeHtml`<table class="sd-table">
        <thead><tr><th>Nom</th><th>Taille</th><th>Modifié</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`,
    );
  }

  private _renderReport(): void {
    const host = this._root?.querySelector<HTMLElement>("#sd-report");
    const section = this._root?.querySelector<HTMLElement>("#sd-report-section");
    if (!host) return;
    if (!this._report) {
      if (section) section.style.display = "none";
      setHtml(host, raw(""));
      return;
    }
    if (section) section.style.display = "";

    const r = this._report;
    const rows = (r.files ?? []).map((f) => {
      const kind = statusBadgeKind(f.status);
      const detail =
        f.status === "error" ? (f.error ?? "") : f.doc_id != null ? `doc #${f.doc_id}` : "";
      return safeHtml`<tr>
        <td><span class="sd-badge sd-badge--${kind}">${statusLabel(f.status)}</span></td>
        <td class="sd-name">${f.name}</td>
        <td class="sd-detail">${detail}</td>
      </tr>`;
    });

    setHtml(host, safeHtml`<p class="sd-summary">${summarizeReport(r)}</p>`);
    appendHtml(
      host,
      safeHtml`<table class="sd-table">
        <thead><tr><th>Statut</th><th>Fichier</th><th>Détail</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`,
    );
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private _readAuthFromForm(): WebdavAuth {
    const mode = (this._root?.querySelector<HTMLSelectElement>("#sd-auth-mode")?.value ??
      "anonymous") as WebdavAuthMode;
    return buildWebdavAuth(mode, {
      user: this._root?.querySelector<HTMLInputElement>("#sd-user")?.value,
      password: this._root?.querySelector<HTMLInputElement>("#sd-password")?.value,
      token: this._root?.querySelector<HTMLInputElement>("#sd-token")?.value,
    });
  }

  private _onAuthModeChange(): void {
    const mode = this._root?.querySelector<HTMLSelectElement>("#sd-auth-mode")?.value ?? "anonymous";
    const basic = this._root?.querySelector<HTMLElement>("#sd-basic-fields");
    const bearer = this._root?.querySelector<HTMLElement>("#sd-bearer-fields");
    if (basic) basic.style.display = mode === "basic" ? "" : "none";
    if (bearer) bearer.style.display = mode === "bearer" ? "" : "none";
  }

  private _setBusy(busy: boolean): void {
    this._busy = busy;
    this._updateConnectBtn();
    const upBtn = this._root?.querySelector<HTMLButtonElement>("#sd-up-btn");
    if (upBtn) upBtn.disabled = busy || this._history.length === 0;
  }

  private _updateConnectBtn(): void {
    const btn = this._root?.querySelector<HTMLButtonElement>("#sd-connect-btn");
    if (btn) btn.disabled = !this._conn || this._busy;
  }

  private _log(msg: string, isError = false): void {
    if (!this._logEl) return;
    const ts = new Date().toLocaleTimeString();
    const line = document.createElement("div");
    line.className = isError ? "log-line log-error" : "log-line";
    line.dataset.source = "sharedocs";
    line.textContent = `[${ts}] [ShareDocs] ${msg}`;
    this._logEl.appendChild(line);
    this._logEl.scrollTop = this._logEl.scrollHeight;
  }
}
