/**
 * ImportScreen — batch import documents + rebuild FTS index.
 *
 * Features:
 *  - File picker (multi-select)
 *  - Per-file: mode, language, title override
 *  - Batch import (2 concurrent) with per-file status
 *  - "Reconstruire l'index" button
 *  - Log pane
 */

import { open } from "@tauri-apps/plugin-dialog";
import type { Conn } from "../lib/sidecarClient.ts";
import { importFile, rebuildIndex, enqueueJob, SidecarError } from "../lib/sidecarClient.ts";
import type { JobCenter } from "../components/JobCenter.ts";

interface FileItem {
  path: string;
  mode: string;
  language: string;
  title: string;
  status: "pending" | "importing" | "done" | "error";
  message: string;
}

export class ImportScreen {
  private _conn: Conn | null = null;
  private _files: FileItem[] = [];
  private _listEl!: HTMLElement;
  private _logEl!: HTMLElement;
  private _importBtn!: HTMLButtonElement;
  private _indexBtn!: HTMLButtonElement;
  private _jobCenter: JobCenter | null = null;
  private _showToast: ((msg: string, isError?: boolean) => void) | null = null;

  render(): HTMLElement {
    const root = document.createElement("div");
    root.className = "screen import-screen";

    root.innerHTML = `
      <h2 class="screen-title">Import &amp; Index</h2>

      <section class="card">
        <h3>Fichiers à importer</h3>
        <div class="btn-row">
          <button id="imp-add-btn" class="btn btn-primary">Ajouter des fichiers…</button>
          <button id="imp-clear-btn" class="btn btn-secondary">Vider la liste</button>
        </div>

        <div class="import-defaults">
          <label>Mode par défaut :
            <select id="imp-default-mode">
              <option value="docx_numbered_lines">DOCX lignes numérotées</option>
              <option value="txt_numbered_lines">TXT lignes numérotées</option>
              <option value="docx_paragraphs">DOCX paragraphes</option>
              <option value="tei">TEI</option>
            </select>
          </label>
          <label>Langue par défaut :
            <input id="imp-default-lang" type="text" value="fr" placeholder="fr, en, …" maxlength="10" />
          </label>
        </div>

        <div id="imp-list" class="import-list">
          <p class="empty-hint">Aucun fichier sélectionné.</p>
        </div>

        <div class="btn-row" style="margin-top:0.75rem">
          <button id="imp-import-btn" class="btn btn-primary" disabled>Importer tout</button>
        </div>
      </section>

      <section class="card">
        <h3>Index FTS</h3>
        <p class="hint">Après avoir importé des documents, reconstruisez l'index pour activer la recherche.</p>
        <div class="btn-row">
          <button id="imp-index-btn" class="btn btn-secondary" disabled>Reconstruire l'index</button>
        </div>
      </section>

      <section class="card">
        <h3>Journal</h3>
        <div id="imp-log" class="log-pane"></div>
      </section>
    `;

    this._listEl = root.querySelector("#imp-list")!;
    this._logEl = root.querySelector("#imp-log")!;
    this._importBtn = root.querySelector("#imp-import-btn")!;
    this._indexBtn = root.querySelector("#imp-index-btn")!;

    root.querySelector("#imp-add-btn")!.addEventListener("click", () => this._addFiles());
    root.querySelector("#imp-clear-btn")!.addEventListener("click", () => this._clearList());
    this._importBtn.addEventListener("click", () => this._runImport());
    this._indexBtn.addEventListener("click", () => this._runIndex());

    return root;
  }

  setConn(conn: Conn | null): void {
    this._conn = conn;
    this._updateButtons();
  }

  setJobCenter(jc: JobCenter, showToast: (msg: string, isError?: boolean) => void): void {
    this._jobCenter = jc;
    this._showToast = showToast;
  }

  private _log(msg: string, isError = false): void {
    const ts = new Date().toLocaleTimeString();
    const line = document.createElement("div");
    line.className = isError ? "log-line log-error" : "log-line";
    line.textContent = `[${ts}] ${msg}`;
    this._logEl.appendChild(line);
    this._logEl.scrollTop = this._logEl.scrollHeight;
  }

  private _updateButtons(): void {
    this._importBtn.disabled = !this._conn || this._files.length === 0;
    this._indexBtn.disabled = !this._conn;
  }

  private async _addFiles(): Promise<void> {
    const selected = await open({
      title: "Sélectionner des fichiers",
      filters: [
        { name: "Corpus", extensions: ["docx", "txt", "xml"] },
      ],
      multiple: true,
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    const defaultMode = (document.querySelector("#imp-default-mode") as HTMLSelectElement).value;
    const defaultLang = (document.querySelector("#imp-default-lang") as HTMLInputElement).value.trim() || "fr";

    for (const p of paths) {
      const name = p.split("/").pop()?.split("\\").pop() ?? p;
      const ext = name.split(".").pop()?.toLowerCase() ?? "";
      let mode = defaultMode;
      if (ext === "xml") mode = "tei";
      else if (ext === "txt") mode = "txt_numbered_lines";
      else if (ext === "docx") mode = defaultMode.startsWith("docx") ? defaultMode : "docx_numbered_lines";

      this._files.push({
        path: p,
        mode,
        language: defaultLang,
        title: name,
        status: "pending",
        message: "",
      });
    }
    this._renderList();
    this._updateButtons();
  }

  private _clearList(): void {
    this._files = [];
    this._renderList();
    this._updateButtons();
  }

  private _renderList(): void {
    if (this._files.length === 0) {
      this._listEl.innerHTML = '<p class="empty-hint">Aucun fichier sélectionné.</p>';
      return;
    }
    this._listEl.innerHTML = "";
    this._files.forEach((f, i) => {
      const row = document.createElement("div");
      row.className = `import-row import-row-${f.status}`;
      row.dataset.index = String(i);
      row.innerHTML = `
        <div class="import-row-info">
          <span class="import-row-name" title="${f.path}">${f.title}</span>
          <span class="import-row-status">${this._statusLabel(f)}</span>
        </div>
        <div class="import-row-controls">
          <select class="imp-mode-sel" data-i="${i}">
            ${["docx_numbered_lines","txt_numbered_lines","docx_paragraphs","tei"]
              .map(m => `<option value="${m}"${f.mode===m?" selected":""}>${m}</option>`)
              .join("")}
          </select>
          <input class="imp-lang-inp" type="text" value="${f.language}" maxlength="10" placeholder="lang" data-i="${i}" />
          <input class="imp-title-inp" type="text" value="${f.title}" placeholder="titre" data-i="${i}" />
          <button class="btn btn-sm btn-danger imp-remove-btn" data-i="${i}">✕</button>
        </div>
      `;
      this._listEl.appendChild(row);
    });

    this._listEl.querySelectorAll(".imp-mode-sel").forEach(el => {
      (el as HTMLSelectElement).addEventListener("change", (e) => {
        const i = parseInt((e.target as HTMLElement).dataset.i!);
        this._files[i].mode = (e.target as HTMLSelectElement).value;
      });
    });
    this._listEl.querySelectorAll(".imp-lang-inp").forEach(el => {
      (el as HTMLInputElement).addEventListener("input", (e) => {
        const i = parseInt((e.target as HTMLElement).dataset.i!);
        this._files[i].language = (e.target as HTMLInputElement).value;
      });
    });
    this._listEl.querySelectorAll(".imp-title-inp").forEach(el => {
      (el as HTMLInputElement).addEventListener("input", (e) => {
        const i = parseInt((e.target as HTMLElement).dataset.i!);
        this._files[i].title = (e.target as HTMLInputElement).value;
      });
    });
    this._listEl.querySelectorAll(".imp-remove-btn").forEach(el => {
      el.addEventListener("click", (e) => {
        const i = parseInt((e.target as HTMLElement).dataset.i!);
        this._files.splice(i, 1);
        this._renderList();
        this._updateButtons();
      });
    });
  }

  private _statusLabel(f: FileItem): string {
    if (f.status === "pending") return "En attente";
    if (f.status === "importing") return "Importation…";
    if (f.status === "done") return `✓ doc_id=${f.message}`;
    if (f.status === "error") return `✗ ${f.message}`;
    return "";
  }

  private async _runImport(): Promise<void> {
    if (!this._conn) return;
    this._importBtn.disabled = true;

    const pending = this._files.filter(f => f.status === "pending");
    if (pending.length === 0) { this._importBtn.disabled = false; return; }

    this._log(`Envoi de ${pending.length} import(s) en job asynchrone…`);

    let submitted = 0;
    let finished = 0;

    const onAllDone = () => {
      this._importBtn.disabled = false;
      this._updateButtons();
    };

    for (const f of pending) {
      f.status = "importing";
      this._renderList();
      try {
        const job = await enqueueJob(this._conn!, "import", {
          mode: f.mode,
          path: f.path,
          language: f.language || "und",
          title: f.title,
        });
        submitted++;
        this._log(`Job soumis pour "${f.title}" (${job.job_id.slice(0, 8)}…)`);
        this._jobCenter?.trackJob(job.job_id, `Import: ${f.title}`, (done) => {
          finished++;
          if (done.status === "done") {
            const docId = (done.result as { doc_id?: number } | undefined)?.doc_id;
            f.status = "done";
            f.message = String(docId ?? "?");
            this._log(`✓ "${f.title}" → doc_id ${docId ?? "?"}`);
            this._showToast?.(`✓ Importé: ${f.title}`);
          } else {
            f.status = "error";
            f.message = done.error ?? done.status;
            this._log(`✗ "${f.title}": ${f.message}`, true);
            this._showToast?.(`✗ Erreur: ${f.title}`, true);
          }
          this._renderList();
          if (finished === submitted) onAllDone();
        });
      } catch (err) {
        f.status = "error";
        f.message = err instanceof SidecarError ? err.message : String(err);
        this._log(`✗ "${f.title}": ${f.message}`, true);
        this._renderList();
        submitted++;
        finished++;
        if (finished === submitted) onAllDone();
      }
    }
  }

  private async _runIndex(): Promise<void> {
    if (!this._conn) return;
    this._indexBtn.disabled = true;
    this._log("Reconstruction de l'index FTS (job asynchrone)…");
    try {
      const job = await enqueueJob(this._conn, "index", {});
      this._log(`Job index soumis (${job.job_id.slice(0, 8)}…)`);
      this._jobCenter?.trackJob(job.job_id, "Rebuild index FTS", (done) => {
        if (done.status === "done") {
          const n = (done.result as { units_indexed?: number } | undefined)?.units_indexed ?? "?";
          this._log(`✓ Index reconstruit — ${n} unités indexées.`);
          this._showToast?.(`✓ Index reconstruit (${n} unités)`);
        } else {
          this._log(`✗ Erreur index : ${done.error ?? done.status}`, true);
          this._showToast?.("✗ Erreur index FTS", true);
        }
        this._indexBtn.disabled = !this._conn;
      });
    } catch (err) {
      this._log(
        `✗ Erreur index : ${err instanceof SidecarError ? err.message : String(err)}`,
        true
      );
      this._indexBtn.disabled = !this._conn;
    }
  }
}

// Re-export type for inline use
type ImportOptions = Parameters<typeof importFile>[1];
