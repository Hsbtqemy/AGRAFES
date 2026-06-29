/**
 * ModelManager.ts — reusable spaCy model list with per-model download / remove and
 * live progress, talking to the Phase 2 sidecar endpoints. Mounted in the Paramètres
 * screen (Phase 3); the in-context AnnotationView band (Phase 4) shares the same
 * client methods.
 */

import type { Conn } from "../lib/sidecarClient.ts";
import { downloadModel, getJob, listModels, removeModel } from "../lib/sidecarClient.ts";
import { describeModel, type ModelInfo } from "../lib/models.ts";

export class ModelManager {
  private _conn: Conn | null = null;
  private _root: HTMLElement | null = null;
  private readonly _polls = new Map<string, ReturnType<typeof setInterval>>();

  render(): HTMLElement {
    const root = document.createElement("div");
    root.className = "prep-models";
    root.textContent = "Connexion en cours…";
    this._root = root;
    return root;
  }

  setConn(conn: Conn | null): void {
    this._conn = conn;
    if (conn) {
      void this.refresh();
    } else {
      // Disconnect (incl. App.dispose on shell re-mount) → stop any in-flight polls
      // so a dead instance isn't pinned by a live interval (FE-08 class).
      for (const id of this._polls.values()) clearInterval(id);
      this._polls.clear();
      if (this._root) {
        this._root.replaceChildren();
        this._root.textContent = "Non connecté.";
      }
    }
  }

  dispose(): void {
    for (const id of this._polls.values()) clearInterval(id);
    this._polls.clear();
    this._root = null;
  }

  async refresh(): Promise<void> {
    const conn = this._conn;
    const root = this._root;
    if (!conn || !root) return;
    let models: ModelInfo[];
    try {
      models = await listModels(conn);
    } catch (err) {
      if (this._root === root) {
        root.replaceChildren();
        root.textContent = `Erreur : ${String(err)}`;
      }
      return;
    }
    if (this._root !== root) return; // disposed / re-rendered while loading
    root.replaceChildren();
    for (const model of models) root.appendChild(this._row(model));
  }

  private _row(model: ModelInfo): HTMLElement {
    const row = describeModel(model);
    const el = document.createElement("div");
    el.className = "prep-models-row";
    el.dataset.model = model.name;

    const info = document.createElement("div");
    info.className = "prep-models-info";
    const name = document.createElement("span");
    name.className = "prep-models-name";
    name.textContent = model.name;
    const meta = document.createElement("span");
    meta.className = "prep-models-meta";
    meta.textContent = `${model.language} · ${row.sizeLabel}`;
    info.appendChild(name);
    info.appendChild(meta);

    const status = document.createElement("span");
    status.className = "prep-models-status" + (model.installed ? " is-installed" : "");
    status.textContent = row.statusLabel;

    const action = document.createElement("button");
    if (model.installed) {
      action.className = "btn btn-secondary btn-sm";
      action.textContent = "Supprimer";
      action.addEventListener("click", () => void this._remove(model.name, action));
    } else {
      action.className = "btn btn-primary btn-sm";
      action.textContent = "↓ Télécharger";
      action.addEventListener("click", () => void this._download(model.name, el, action));
    }

    el.appendChild(info);
    el.appendChild(status);
    el.appendChild(action);
    return el;
  }

  private async _download(name: string, row: HTMLElement, btn: HTMLButtonElement): Promise<void> {
    const conn = this._conn;
    if (!conn || this._polls.has(name)) return;
    btn.disabled = true;
    btn.textContent = "Téléchargement…";
    try {
      const job = await downloadModel(conn, name);
      const jobId = job.job_id;
      if (!jobId) throw new Error("Pas de job_id dans la réponse");
      this._polls.set(name, setInterval(() => { void this._poll(name, jobId, row, btn); }, 1000));
    } catch (err) {
      btn.disabled = false;
      btn.textContent = "↓ Réessayer";
      this._setRowStatus(row, `✗ ${String(err)}`);
    }
  }

  private async _poll(name: string, jobId: string, row: HTMLElement, btn: HTMLButtonElement): Promise<void> {
    const conn = this._conn;
    if (!conn) return;
    try {
      const job = await getJob(conn, jobId);
      if (job.status === "running" && job.progress_message) {
        btn.textContent = job.progress_message;
      } else if (job.status === "done") {
        this._stopPoll(name);
        void this.refresh();
      } else if (job.status === "error" || job.status === "canceled") {
        this._stopPoll(name);
        btn.disabled = false;
        btn.textContent = "↓ Réessayer";
        this._setRowStatus(row, `✗ ${job.error ?? "Échec du téléchargement"}`);
      }
    } catch {
      // transient — keep polling
    }
  }

  private async _remove(name: string, btn: HTMLButtonElement): Promise<void> {
    const conn = this._conn;
    if (!conn) return;
    btn.disabled = true;
    btn.textContent = "Suppression…";
    try {
      await removeModel(conn, name);
      void this.refresh();
    } catch {
      btn.disabled = false;
      btn.textContent = "Supprimer";
    }
  }

  private _stopPoll(name: string): void {
    const id = this._polls.get(name);
    if (id !== undefined) {
      clearInterval(id);
      this._polls.delete(name);
    }
  }

  private _setRowStatus(row: HTMLElement, text: string): void {
    const status = row.querySelector<HTMLElement>(".prep-models-status");
    if (status) status.textContent = text;
  }
}
