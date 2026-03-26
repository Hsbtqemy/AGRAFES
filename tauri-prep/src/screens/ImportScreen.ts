/**
 * ImportScreen — batch import documents + rebuild FTS index.
 *
 * Features:
 *  - File picker (multi-select) + glisser-déposer (chemins natifs Tauri)
 *  - Per-file: mode, language, title override
 *  - Batch import : jobs async côté sidecar (plusieurs imports peuvent tourner en parallèle)
 *  - "Reconstruire l'index" button
 *  - Log pane
 *  - Sprint 8: post-import family dialog + filename language detection
 */

import { open } from "@tauri-apps/plugin-dialog";
import type { Conn } from "../lib/sidecarClient.ts";
import { importFile, enqueueJob, SidecarError, listDocuments, setDocRelation } from "../lib/sidecarClient.ts";
import type { DocumentRecord } from "../lib/sidecarClient.ts";
import type { JobCenter } from "../components/JobCenter.ts";
import { initCardAccordions } from "../lib/uiAccordions.ts";

/** Normalise un chemin pour détecter les doublons (séparateurs + casse + préfixe long Windows). */
function normalizeImportPath(p: string): string {
  let s = p.replace(/\\/g, "/").replace(/\/+$/u, "").toLowerCase();
  // \\?\C:\... → //?/c:/... après replace
  if (s.startsWith("//?/")) s = s.slice(4);
  return s;
}

const IMPORT_MODE_OPTIONS: Array<{ value: FileItem["mode"]; label: string }> = [
  { value: "docx_numbered_lines", label: "DOCX lignes numérotées [n]" },
  { value: "txt_numbered_lines", label: "TXT lignes numérotées [n]" },
  { value: "docx_paragraphs", label: "DOCX paragraphes" },
  { value: "odt_numbered_lines", label: "ODT lignes numérotées [n]" },
  { value: "odt_paragraphs", label: "ODT paragraphes" },
  { value: "tei", label: "TEI XML" },
];

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
  private _root!: HTMLElement;
  private _listEl!: HTMLElement;
  private _logEl!: HTMLElement;
  private _summaryEl!: HTMLElement;
  private _stateEl!: HTMLElement;
  private _importBtn!: HTMLButtonElement;
  private _indexBtn!: HTMLButtonElement;
  private _jobCenter: JobCenter | null = null;
  private _showToast: ((msg: string, isError?: boolean) => void) | null = null;
  private _isBusy = false;
  private _lastErrorMsg: string | null = null;

  // Sprint 8 — family dialog
  private _skipFamilyDialog = false;        // "Ne plus demander" flag (session)
  private _corpusDocs: DocumentRecord[] = []; // cached corpus list for family dialog

  render(): HTMLElement {
    const root = document.createElement("div");
    root.className = "screen import-screen import-screen--layout";
    this._root = root;

    root.innerHTML = `
      <div class="imp-scroll">
      <!-- Head card + stepper -->
      <div class="card imp-head-card">
        <div class="imp-head-top">
          <div>
            <h2 class="screen-title" style="margin:0 0 4px">Importer des fichiers</h2>
            <p class="imp-head-desc">Ajoutez vos fichiers source, configurez le profil de lot, puis lancez l'import.</p>
          </div>
          <div id="imp-state-banner" class="runtime-state state-info" aria-live="polite">
            En attente de connexion sidecar…
          </div>
        </div>
        <div class="imp-steps">
          <span class="imp-step active">① Sources</span>
          <span class="imp-step-sep">›</span>
          <span class="imp-step">② Profil</span>
          <span class="imp-step-sep">›</span>
          <span class="imp-step">③ Validation</span>
          <span class="imp-step-sep">›</span>
          <span class="imp-step">④ Exécution</span>
        </div>
      </div>

      <!-- 2-col workspace -->
      <div class="imp-workspace">

        <!-- Left column: files -->
        <div class="imp-col-main">
          <div class="card">
            <div class="imp-file-card-head">
              <h3 style="margin:0">Fichiers source</h3>
              <span id="imp-summary" class="chip">0 fichier</span>
            </div>
            <div class="imp-dropzone" id="imp-dropzone">
              <div class="imp-dropzone-icon">📂</div>
              <div class="imp-dropzone-text">Glissez vos fichiers ici</div>
              <div class="imp-dropzone-sub">.docx &middot; .odt &middot; .txt &middot; .tei &middot; .xml</div>
              <div class="btn-row" style="justify-content:center;margin-top:8px">
                <button id="imp-add-btn" class="btn btn-primary btn-sm">Ajouter des fichiers…</button>
                <button id="imp-clear-btn" class="btn btn-secondary btn-sm">Vider</button>
              </div>
            </div>
            <div id="imp-list" class="imp-file-list">
              <p class="empty-hint">Aucun fichier sélectionné.</p>
            </div>
          </div>

          <section class="card" data-collapsible="true" data-collapsed-default="true">
            <h3>Journal des imports</h3>
            <div id="imp-log" class="log-pane"></div>
          </section>
        </div>

        <!-- Right column: settings + pre-check + index -->
        <div class="imp-col-side">
          <details class="card imp-settings-card" open>
            <summary class="imp-settings-summary">
              <span class="imp-settings-title" id="imp-settings-title">Profil de lot</span>
              <span class="chip">par défaut</span>
            </summary>
            <div class="imp-settings-body" role="region" aria-labelledby="imp-settings-title">
              <div class="imp-settings-grid">
                <div class="imp-settings-field">
                  <label for="imp-default-mode">Format par défaut</label>
                  <select id="imp-default-mode" aria-describedby="imp-settings-hint-apply">
                    ${IMPORT_MODE_OPTIONS.map((opt) => `<option value="${opt.value}">${opt.label}</option>`).join("")}
                  </select>
                </div>
                <div class="imp-settings-field">
                  <label for="imp-default-lang">Langue par défaut</label>
                  <input
                    id="imp-default-lang"
                    type="text"
                    value="fr"
                    placeholder="fr, en, …"
                    maxlength="10"
                    autocomplete="off"
                    spellcheck="false"
                    inputmode="text"
                    aria-describedby="imp-settings-hint-apply"
                  />
                </div>
              </div>
              <label class="imp-settings-filename-check" title="Si coché : refuse l’import lorsqu’un document avec le même nom de fichier existe déjà dans le corpus (chemins différents inclus).">
                <input type="checkbox" id="imp-check-filename" />
                <span>Bloquer les doublons par nom de fichier</span>
              </label>
              <div class="imp-settings-actions btn-row">
                <button type="button" id="imp-apply-defaults-btn" class="btn btn-secondary btn-sm">
                  Appliquer aux fichiers en attente
                </button>
                <p id="imp-settings-hint-apply" class="hint imp-settings-hint">
                  Réapplique le format (selon l’extension de chaque fichier) et la langue ci-dessus aux lignes encore en attente.
                </p>
              </div>
            </div>
          </details>

          <div class="card imp-precheck-card">
            <div class="imp-precheck-head">
              <h3 style="margin:0">Pré-vérification</h3>
              <span id="imp-precheck-badge" class="chip">—</span>
            </div>
            <div class="imp-precheck-body">
              <div class="imp-diag">
                <span class="imp-diag-label">Fichiers sélectionnés</span>
                <span class="imp-diag-value" id="imp-diag-total">0</span>
              </div>
              <div class="imp-diag">
                <span class="imp-diag-label">En attente</span>
                <span class="imp-diag-value" id="imp-diag-pending">0</span>
              </div>
              <div class="imp-diag">
                <span class="imp-diag-label">Importés</span>
                <span class="imp-diag-value" id="imp-diag-done">0</span>
              </div>
              <div class="imp-diag">
                <span class="imp-diag-label">Erreurs</span>
                <span class="imp-diag-value" id="imp-diag-errors">0</span>
              </div>
            </div>
          </div>

          <section class="card" data-collapsible="true" data-collapsed-default="true">
            <h3>Index FTS</h3>
            <p class="hint">Après avoir importé des documents, reconstruisez l'index pour activer la recherche.</p>
            <div class="btn-row">
              <button id="imp-index-btn" class="btn btn-secondary" disabled>Reconstruire l'index</button>
            </div>
          </section>
        </div>
      </div>
      </div>

      <!-- Footer docked at bottom of main pane (above scrolling content) -->
      <div class="imp-footer-bar">
        <div class="imp-footer-meta">
          <span class="hint" style="margin:0">Importe tous les fichiers en attente (profil + options ci-dessus).</span>
        </div>
        <label class="imp-footer-check" title="Si coché : refuse l'import lorsqu'un document avec le même nom de fichier existe déjà dans le corpus (chemins différents inclus).">
          <input type="checkbox" id="imp-check-filename-footer" />
          Bloquer doublons par nom
        </label>
        <div class="btn-row">
          <button id="imp-import-btn" class="btn btn-primary" title="Importer tous les fichiers en attente" aria-label="Importer tous les fichiers en attente" disabled>⬆ Importer</button>
        </div>
      </div>
    `;

    this._listEl = root.querySelector("#imp-list")!;
    this._logEl = root.querySelector("#imp-log")!;
    this._summaryEl = root.querySelector("#imp-summary")!;
    this._stateEl = root.querySelector("#imp-state-banner")!;
    this._importBtn = root.querySelector("#imp-import-btn")!;
    this._indexBtn = root.querySelector("#imp-index-btn")!;

    root.querySelector("#imp-add-btn")!.addEventListener("click", () => this._addFiles());
    root.querySelector("#imp-clear-btn")!.addEventListener("click", () => this._clearList());
    this._importBtn.addEventListener("click", () => this._runImport());
    this._indexBtn.addEventListener("click", () => this._runIndex());
    root.querySelector("#imp-apply-defaults-btn")!.addEventListener("click", () => this._applyDefaultsToPending());

    // Sync the two check_filename checkboxes (footer ↔ settings)
    const ckFooter = root.querySelector<HTMLInputElement>("#imp-check-filename-footer")!;
    const ckSettings = root.querySelector<HTMLInputElement>("#imp-check-filename")!;
    ckFooter.addEventListener("change", () => { ckSettings.checked = ckFooter.checked; });
    ckSettings.addEventListener("change", () => { ckFooter.checked = ckSettings.checked; });

    const dz = root.querySelector<HTMLElement>("#imp-dropzone");
    if (dz) {
      dz.addEventListener("dragover",  e => { e.preventDefault(); dz.classList.add("dragover"); });
      dz.addEventListener("dragleave", ()  => dz.classList.remove("dragover"));
      dz.addEventListener("drop", e => {
        e.preventDefault();
        dz.classList.remove("dragover");
        const files = e.dataTransfer?.files;
        if (!files || files.length === 0) return;
        const defaultMode = (this._root.querySelector<HTMLSelectElement>("#imp-default-mode"))!.value;
        const defaultLang = (this._root.querySelector<HTMLInputElement>("#imp-default-lang"))!.value.trim() || "fr";
        let added = 0;
        let skippedDup = 0;
        for (const file of Array.from(files)) {
          // Tauri WebView exposes native path via non-standard File.path property
          const path = (file as File & { path?: string }).path;
          if (!path) continue;
          const name = file.name;
          const r = this._tryAddSingle(path, name, defaultMode, defaultLang);
          if (r === "added") added++;
          else skippedDup++;
        }
        if (added > 0) {
          this._renderList();
          this._updateButtons();
          this._detectAndShowFamilyBanner();
        }
        if (skippedDup > 0) {
          this._showToast?.(
            `${skippedDup} fichier${skippedDup > 1 ? "s" : ""} ignoré${skippedDup > 1 ? "s" : ""} (déjà dans la liste).`,
          );
        }
      });
    }

    initCardAccordions(root);
    this._refreshRuntimeState();

    return root;
  }

  setConn(conn: Conn | null): void {
    this._conn = conn;
    this._updateButtons();
    this._refreshRuntimeState();
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
    if (isError) {
      this._lastErrorMsg = msg;
    } else if (this._lastErrorMsg && msg.startsWith("✓")) {
      this._lastErrorMsg = null;
    }
    this._refreshRuntimeState();
  }

  private _updateButtons(): void {
    const pendingCount = this._files.filter((f) => f.status === "pending").length;
    this._importBtn.disabled = !this._conn || pendingCount === 0;
    this._indexBtn.disabled = !this._conn;
    this._summaryEl.textContent = `${this._files.length} fichier${this._files.length > 1 ? "s" : ""}`;
    this._refreshRuntimeState();
  }

  private _deriveModeFromExt(ext: string, defaultMode: string): string {
    if (ext === "xml" || ext === "tei") return "tei";
    if (ext === "txt") return "txt_numbered_lines";
    if (ext === "docx") return defaultMode.startsWith("docx") ? defaultMode : "docx_numbered_lines";
    if (ext === "odt") return defaultMode.startsWith("odt") ? defaultMode : "odt_paragraphs";
    return defaultMode;
  }

  /**
   * Ajoute un fichier à la file s'il n'y est pas déjà (même chemin normalisé).
   * @returns "added" | "dup_queue"
   */
  private _tryAddSingle(
    path: string,
    fileName: string,
    defaultMode: string,
    defaultLang: string,
  ): "added" | "dup_queue" {
    const norm = normalizeImportPath(path);
    if (this._files.some((f) => normalizeImportPath(f.path) === norm)) {
      return "dup_queue";
    }
    const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
    const mode = this._deriveModeFromExt(ext, defaultMode);
    this._files.push({
      path,
      mode,
      language: defaultLang,
      title: fileName,
      status: "pending",
      message: "",
    });
    return "added";
  }

  private async _addFiles(): Promise<void> {
    const selected = await open({
      title: "Sélectionner des fichiers",
      filters: [
        { name: "Corpus", extensions: ["docx", "odt", "txt", "xml", "tei"] },
      ],
      multiple: true,
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    const defaultMode = (this._root.querySelector("#imp-default-mode") as HTMLSelectElement).value;
    const defaultLang = (this._root.querySelector("#imp-default-lang") as HTMLInputElement).value.trim() || "fr";

    let added = 0;
    let skippedDup = 0;
    for (const p of paths) {
      const name = p.split("/").pop()?.split("\\").pop() ?? p;
      const r = this._tryAddSingle(p, name, defaultMode, defaultLang);
      if (r === "added") added++;
      else skippedDup++;
    }
    if (added > 0) {
      this._renderList();
      this._updateButtons();
      this._detectAndShowFamilyBanner();
    }
    if (skippedDup > 0) {
      this._showToast?.(
        `${skippedDup} fichier${skippedDup > 1 ? "s" : ""} ignoré${skippedDup > 1 ? "s" : ""} (déjà dans la liste).`,
      );
    }
  }

  private _clearList(): void {
    this._files = [];
    this._renderList();
    this._updateButtons();
  }

  private _applyDefaultsToPending(): void {
    if (!this._root) return;
    if (this._files.length === 0) {
      this._showToast?.(
        "Aucun fichier dans la liste — ajoutez des sources ou glissez-déposez des fichiers.",
        false
      );
      return;
    }
    const defaultMode = (this._root.querySelector("#imp-default-mode") as HTMLSelectElement).value;
    const defaultLang = (this._root.querySelector("#imp-default-lang") as HTMLInputElement).value.trim() || "fr";
    let touched = 0;
    for (const file of this._files) {
      if (file.status !== "pending") continue;
      const base = file.path.split(/[/\\]/u).pop() ?? "";
      const ext = base.includes(".") ? base.split(".").pop()?.toLowerCase() ?? "" : "";
      file.mode = this._deriveModeFromExt(ext, defaultMode);
      file.language = defaultLang;
      touched += 1;
    }
    this._renderList();
    this._updateButtons();
    if (touched > 0) {
      this._log(`✓ Profil de lot appliqué à ${touched} fichier(s) en attente.`);
    } else {
      this._showToast?.("Aucun fichier en attente — ajoutez des fichiers ou réinitialisez une ligne en erreur.", false);
    }
  }

  private _chipClass(status: FileItem["status"]): string {
    if (status === "done") return "ok";
    if (status === "importing") return "warn";
    if (status === "error") return "error";
    return "";
  }

  private _renderList(): void {
    this._updateButtons();
    if (this._files.length === 0) {
      this._listEl.innerHTML = '<p class="empty-hint">Aucun fichier sélectionné.</p>';
      this._updatePrecheck();
      return;
    }
    this._listEl.innerHTML = "";
    this._files.forEach((f, i) => {
      const row = document.createElement("div");
      row.className = `imp-file-item imp-file-item-${f.status}`;
      row.dataset.index = String(i);
      const chipCls = this._chipClass(f.status);
      row.innerHTML = `
        <div class="imp-file-main">
          <span class="imp-file-name" title="${f.path}">${f.title}</span>
          <span class="chip${chipCls ? " " + chipCls : ""}">${this._statusLabel(f)}</span>
        </div>
        <div class="imp-file-controls">
          <select class="imp-mode-sel" data-i="${i}">
            ${IMPORT_MODE_OPTIONS
              .map((opt) => `<option value="${opt.value}"${f.mode===opt.value?" selected":""}>${opt.label}</option>`)
              .join("")}
          </select>
          <input class="imp-lang-inp" type="text" value="${f.language}" maxlength="10" placeholder="lang" data-i="${i}" />
          <input class="imp-title-inp" type="text" value="${f.title}" placeholder="titre" data-i="${i}" />
          <button class="btn btn-sm imp-remove-btn" data-i="${i}" aria-label="Retirer ce fichier de la liste" title="Retirer ce fichier de la liste">✕</button>
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

    this._updatePrecheck();
  }

  private _updatePrecheck(): void {
    const total   = this._files.length;
    const pending = this._files.filter(f => f.status === "pending").length;
    const done    = this._files.filter(f => f.status === "done").length;
    const errors  = this._files.filter(f => f.status === "error").length;
    const set = (id: string, v: number) => {
      const el = this._root?.querySelector(`#${id}`);
      if (el) el.textContent = String(v);
    };
    set("imp-diag-total", total);
    set("imp-diag-pending", pending);
    set("imp-diag-done", done);
    set("imp-diag-errors", errors);
    const badge = this._root?.querySelector("#imp-precheck-badge");
    if (!badge) return;
    if (errors > 0)       { badge.textContent = `${errors} erreur${errors > 1 ? "s" : ""}`; badge.className = "chip error"; }
    else if (pending > 0) { badge.textContent = `${pending} en attente`;                    badge.className = "chip warn"; }
    else if (done > 0)    { badge.textContent = "Tout importé";                             badge.className = "chip ok"; }
    else                  { badge.textContent = "—";                                        badge.className = "chip"; }
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
    this._isBusy = true;
    this._refreshRuntimeState();

    const pending = this._files.filter(f => f.status === "pending");
    if (pending.length === 0) {
      this._importBtn.disabled = false;
      this._isBusy = false;
      this._refreshRuntimeState();
      return;
    }

    this._log(`Envoi de ${pending.length} import(s) en job asynchrone…`);

    let submitted = 0;
    let finished = 0;

    const onAllDone = () => {
      this._importBtn.disabled = false;
      this._isBusy = false;
      this._updateButtons();
    };

    const corpusByPath = new Map<string, number>();
    const corpusByFilename = new Map<string, number>(); // nom de fichier → doc_id
    try {
      const docs = await listDocuments(this._conn);
      for (const d of docs) {
        const sp = d.source_path;
        if (typeof sp === "string" && sp.length > 0) {
          corpusByPath.set(normalizeImportPath(sp), d.doc_id);
          const fname = sp.replace(/\\/g, "/").split("/").pop()?.toLowerCase();
          if (fname) corpusByFilename.set(fname, d.doc_id);
        }
      }
    } catch (err) {
      this._log(
        `Liste documents indisponible pour pré-contrôle doublons : ${err instanceof Error ? err.message : String(err)}`,
        true
      );
      this._showToast?.(
        "Impossible de charger les documents existants — le serveur bloquera tout de même les doublons (hash / chemin).",
        true
      );
    }

    const checkFilename = (this._root?.querySelector<HTMLInputElement>("#imp-check-filename-footer"))?.checked
      ?? (this._root?.querySelector<HTMLInputElement>("#imp-check-filename"))?.checked
      ?? false;

    for (const f of pending) {
      const existingId = corpusByPath.get(normalizeImportPath(f.path));
      if (existingId !== undefined) {
        f.status = "error";
        f.message = `Déjà dans le corpus (doc_id ${existingId})`;
        this._log(`⊘ "${f.title}": ${f.message}`, true);
        this._showToast?.(`⊘ ${f.title} — déjà importé (doc_id ${existingId})`, true);
        this._renderList();
        continue;
      }

      if (checkFilename) {
        const fname = f.path.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "";
        const existingByName = corpusByFilename.get(fname);
        if (existingByName !== undefined) {
          f.status = "error";
          f.message = `Nom de fichier déjà présent (doc_id ${existingByName})`;
          this._log(`⊘ "${f.title}": doublon par nom de fichier (doc_id ${existingByName})`, true);
          this._showToast?.(`⊘ ${f.title} — nom déjà importé (doc_id ${existingByName})`, true);
          this._renderList();
          continue;
        }
        // Enregistre aussi les fichiers en cours de batch pour bloquer les doublons intra-lot
        if (fname) corpusByFilename.set(fname, -1);
      }

      f.status = "importing";
      this._renderList();
      try {
        const job = await enqueueJob(this._conn!, "import", {
          mode: f.mode,
          path: f.path,
          language: f.language || "und",
          title: f.title,
          check_filename: checkFilename,
        });
        submitted++;
        this._log(`Job soumis pour "${f.title}" (${job.job_id.slice(0, 8)}…)`);
        const fileLang = f.language || "und";
        const fileTitle = f.title;
        this._jobCenter?.trackJob(job.job_id, `Import: ${f.title}`, (done) => {
          finished++;
          if (done.status === "done") {
            const docId = (done.result as { doc_id?: number } | undefined)?.doc_id;
            f.status = "done";
            f.message = String(docId ?? "?");
            this._log(`✓ "${fileTitle}" → doc_id ${docId ?? "?"}`);
            this._showToast?.(`✓ Importé: ${fileTitle}`);
            // Sprint 8: propose family link
            if (typeof docId === "number" && !this._skipFamilyDialog) {
              this._showFamilyDialog(docId, fileTitle, fileLang);
            }
          } else {
            f.status = "error";
            f.message = done.error ?? done.status;
            this._log(`✗ "${fileTitle}": ${f.message}`, true);
            this._showToast?.(`✗ Erreur: ${fileTitle}`, true);
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

    if (submitted === 0) {
      onAllDone();
    }
  }

  // ---------------------------------------------------------------------------
  // Sprint 8 — family dialog
  // ---------------------------------------------------------------------------

  /** Show a modal dialog after a successful import to optionally attach the
   *  new document to an existing family (creates a translation_of relation). */
  private async _showFamilyDialog(newDocId: number, newDocTitle: string, newDocLang: string): Promise<void> {
    if (!this._conn) return;

    // Refresh corpus docs list (lazy, refreshed each time dialog opens)
    try {
      this._corpusDocs = await listDocuments(this._conn);
    } catch {
      // ignore — list will be empty, dialog still shows
    }

    // Filter out the newly imported doc itself and sort by title
    const candidates = this._corpusDocs
      .filter(d => d.doc_id !== newDocId)
      .sort((a, b) => (a.title ?? "").localeCompare(b.title ?? ""));

    const overlay = document.createElement("div");
    overlay.className = "family-dialog-overlay";
    overlay.innerHTML = `
      <div class="family-dialog">
        <div class="family-dialog-header">
          <span class="family-dialog-icon">🔗</span>
          <div>
            <div class="family-dialog-title">Rattacher à une famille ?</div>
            <div class="family-dialog-subtitle">« ${newDocTitle} » vient d'être importé (doc #${newDocId})</div>
          </div>
        </div>
        <p class="family-dialog-desc">
          Ce document est-il la traduction ou l'extrait d'un document existant&nbsp;?<br>
          Si oui, sélectionnez le document original ci-dessous.
        </p>
        <div class="family-dialog-field">
          <label for="fam-dlg-parent-sel">Document original (parent)</label>
          <select id="fam-dlg-parent-sel" class="family-dialog-select">
            <option value="">— Aucun —</option>
            ${candidates.map(d => {
              const label = [d.title ?? `#${d.doc_id}`, d.language ? `[${d.language}]` : ""].filter(Boolean).join(" ");
              return `<option value="${d.doc_id}">${label}</option>`;
            }).join("")}
          </select>
        </div>
        <div class="family-dialog-field">
          <label for="fam-dlg-relation-type">Type de relation</label>
          <select id="fam-dlg-relation-type" class="family-dialog-select">
            <option value="translation_of">Traduction de</option>
            <option value="excerpt_of">Extrait de</option>
          </select>
        </div>
        <div class="family-dialog-actions">
          <label class="family-dialog-skip-label">
            <input type="checkbox" id="fam-dlg-skip-session" />
            Ne plus demander dans cette session
          </label>
          <div class="family-dialog-btns">
            <button id="fam-dlg-cancel-btn" class="btn btn-secondary btn-sm">Non merci</button>
            <button id="fam-dlg-confirm-btn" class="btn btn-primary btn-sm" disabled>Créer la relation</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const sel = overlay.querySelector<HTMLSelectElement>("#fam-dlg-parent-sel")!;
    const relSel = overlay.querySelector<HTMLSelectElement>("#fam-dlg-relation-type")!;
    const confirmBtn = overlay.querySelector<HTMLButtonElement>("#fam-dlg-confirm-btn")!;
    const cancelBtn = overlay.querySelector<HTMLButtonElement>("#fam-dlg-cancel-btn")!;
    const skipChk = overlay.querySelector<HTMLInputElement>("#fam-dlg-skip-session")!;

    sel.addEventListener("change", () => {
      confirmBtn.disabled = !sel.value;
    });

    const close = () => {
      if (skipChk.checked) this._skipFamilyDialog = true;
      overlay.remove();
    };

    cancelBtn.addEventListener("click", close);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

    confirmBtn.addEventListener("click", async () => {
      const parentId = parseInt(sel.value, 10);
      const relType = relSel.value as "translation_of" | "excerpt_of";
      if (!parentId || !this._conn) { close(); return; }
      confirmBtn.disabled = true;
      confirmBtn.textContent = "En cours…";
      try {
        const res = await setDocRelation(this._conn, {
          doc_id: newDocId,
          relation_type: relType,
          target_doc_id: parentId,
        });
        const parentTitle = candidates.find(d => d.doc_id === parentId)?.title ?? `#${parentId}`;
        this._log(`✓ Relation « ${relType} » créée : doc #${newDocId} → doc #${parentId} « ${parentTitle} » (id=${res.id})`);
        this._showToast?.(`✓ Rattaché à la famille de « ${parentTitle} »`);
      } catch (err) {
        this._log(`✗ Erreur création relation: ${err instanceof Error ? err.message : String(err)}`, true);
        this._showToast?.("✗ Impossible de créer la relation", true);
      }
      close();
    });
  }

  // ---------------------------------------------------------------------------
  // Sprint 8 — filename language detection
  // ---------------------------------------------------------------------------

  /**
   * Common language codes / abbreviations that can appear in filenames.
   * Matches patterns like: roman_FR.docx  roman-en.docx  texte.DE.txt
   */
  private static readonly _LANG_RE =
    /[_\-.]([A-Za-z]{2,3})(?:\.[^.]+)?$/u;

  /** Groups files by common stem when they differ only in the language token.
   *  Returns an array of groups (≥2 files) that share the same stem + extension. */
  static detectFamilyGroups(paths: string[]): Array<{ stem: string; files: Array<{ path: string; lang: string }> }> {
    const byNorm = new Map<string, Array<{ path: string; lang: string }>>();

    for (const p of paths) {
      const fname = p.replace(/\\/g, "/").split("/").pop() ?? p;
      const m = fname.match(ImportScreen._LANG_RE);
      if (!m) continue;
      const lang = m[1].toLowerCase();
      const ext = fname.split(".").pop()?.toLowerCase() ?? "";
      // Stem = everything before the language token
      const stem = fname.slice(0, fname.length - m[0].length) + "." + ext;
      const key = stem.toLowerCase();
      if (!byNorm.has(key)) byNorm.set(key, []);
      byNorm.get(key)!.push({ path: p, lang });
    }

    const groups: Array<{ stem: string; files: Array<{ path: string; lang: string }> }> = [];
    for (const [stem, files] of byNorm) {
      if (files.length >= 2) groups.push({ stem, files });
    }
    return groups;
  }

  /** Render the family-proposal banner inside the screen root when groups are detected. */
  private _renderFamilyDetectionBanner(groups: ReturnType<typeof ImportScreen.detectFamilyGroups>): void {
    const existing = this._root?.querySelector("#imp-family-detect-banner");
    if (existing) existing.remove();
    if (groups.length === 0) return;

    const banner = document.createElement("div");
    banner.id = "imp-family-detect-banner";
    banner.className = "card imp-family-banner";
    banner.innerHTML = `
      <div class="imp-family-banner-head">
        <span class="imp-family-banner-icon">🔗</span>
        <div>
          <strong>Familles détectées automatiquement</strong>
          <span class="chip">${groups.length} groupe${groups.length > 1 ? "s" : ""}</span>
        </div>
      </div>
      <p class="imp-family-banner-desc">
        Des fichiers partagent le même radical avec des suffixes de langue.
        Après l'import, ils pourront être rattachés en famille automatiquement.
      </p>
      ${groups.map((g, gi) => `
        <div class="imp-family-group">
          <div class="imp-family-group-head">
            Groupe ${gi + 1} — <code>${g.stem}</code>
          </div>
          <div class="imp-family-group-files">
            ${g.files.map(f => {
              const fname = f.path.replace(/\\/g, "/").split("/").pop() ?? f.path;
              return `<span class="chip">${fname} <em>[${f.lang.toUpperCase()}]</em></span>`;
            }).join("")}
          </div>
          <div class="imp-family-group-action">
            <label>Original&nbsp;:&nbsp;
              <select class="imp-family-pivot-sel" data-group="${gi}">
                ${g.files.map(f => {
                  const fname = f.path.replace(/\\/g, "/").split("/").pop() ?? f.path;
                  return `<option value="${f.path}">${fname} [${f.lang.toUpperCase()}]</option>`;
                }).join("")}
              </select>
            </label>
          </div>
        </div>
      `).join("")}
      <p class="imp-family-banner-note">
        Les relations seront proposées dans la dialog post-import de chaque fichier enfant.
      </p>
    `;

    const workspace = this._root?.querySelector(".imp-workspace");
    if (workspace) workspace.insertAdjacentElement("beforebegin", banner);
  }

  /** Run detection on current file list and update the banner. */
  private _detectAndShowFamilyBanner(): void {
    const paths = this._files
      .filter(f => f.status === "pending")
      .map(f => f.path);
    const groups = ImportScreen.detectFamilyGroups(paths);
    this._renderFamilyDetectionBanner(groups);
  }

  private async _runIndex(): Promise<void> {
    if (!this._conn) return;
    this._indexBtn.disabled = true;
    this._isBusy = true;
    this._refreshRuntimeState();
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
          const errMsg = done.error ?? done.status;
          this._log(`✗ Erreur index : ${errMsg}`, true);
          const short = typeof errMsg === "string" && errMsg.length > 60 ? errMsg.slice(0, 57) + "…" : errMsg;
          this._showToast?.(`✗ Erreur index FTS${short ? `: ${short}` : ""}`, true);
        }
        this._isBusy = false;
        this._indexBtn.disabled = !this._conn;
        this._refreshRuntimeState();
      });
    } catch (err) {
      this._log(
        `✗ Erreur index : ${err instanceof SidecarError ? err.message : String(err)}`,
        true
      );
      this._isBusy = false;
      this._indexBtn.disabled = !this._conn;
      this._refreshRuntimeState();
    }
  }

  private _setRuntimeState(kind: "ok" | "info" | "warn" | "error", text: string): void {
    if (!this._stateEl) return;
    this._stateEl.className = `runtime-state state-${kind}`;
    this._stateEl.textContent = text;
  }

  private _refreshRuntimeState(): void {
    if (!this._stateEl) return;
    if (!this._conn) {
      this._setRuntimeState("error", "Sidecar indisponible. Ouvrez ou créez un corpus.");
      return;
    }
    if (this._isBusy) {
      this._setRuntimeState("info", "Opération en cours…");
      return;
    }
    if (this._lastErrorMsg) {
      this._setRuntimeState("error", `Dernière erreur: ${this._lastErrorMsg}`);
      return;
    }
    const pendingCount = this._files.filter((f) => f.status === "pending").length;
    if (pendingCount > 0) {
      this._setRuntimeState("warn", `${pendingCount} fichier(s) en attente d'import.`);
      return;
    }
    if (this._files.length === 0) {
      this._setRuntimeState("info", "Aucun fichier sélectionné.");
      return;
    }
    this._setRuntimeState("ok", "Prêt: vous pouvez lancer un import ou reconstruire l'index.");
  }
}

// Re-export type for inline use
type ImportOptions = Parameters<typeof importFile>[1];
