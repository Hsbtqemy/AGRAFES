/**
 * JobCenter.ts — V0.5 async job tracking panel.
 *
 * Renders a strip between the tab bar and screen content.
 * Polls active jobs every 500ms; shows progress bars + cancel buttons.
 * Keeps the last few finished jobs, then retires itself once nothing runs.
 */

import type { Conn, JobRecord } from "../lib/sidecarClient.ts";
import { getJob, cancelJob as apiCancelJob } from "../lib/sidecarClient.ts";
import { raw, setHtml } from "../lib/safeHtml.ts";

type DoneCallback = (job: JobRecord) => void;

interface TrackedJob {
  label: string;
  job: JobRecord;
  onDone: DoneCallback;
}

/**
 * Un job terminé garde son libellé. Le `JobRecord` seul ne porte que le `kind` et le
 * message du moteur : cinq sondes de dossiers différents rendaient cinq lignes
 * strictement identiques (`webdav-probe · Probe completed`), qui ne disaient rien.
 */
interface RecentJob {
  job: JobRecord;
  label: string;
}

/** Combien de jobs terminés rester à l'écran, et combien de temps après le dernier. */
const RECENT_MAX = 3;
const RETIRE_MS = 8000;

// ─── Toast helper (static, appended to body) ──────────────────────────────────

let _toastTimer: number | null = null;
let _toastEl: HTMLElement | null = null;

export function showToast(msg: string, isError = false): void {
  if (!_toastEl) {
    _toastEl = document.createElement("div");
    _toastEl.id = "jc-toast";
    _toastEl.setAttribute("role", "alert");
    _toastEl.setAttribute("aria-live", "polite");
    _toastEl.setAttribute("aria-atomic", "true");
    _toastEl.style.cssText = [
      // `pointer-events:none` n'est PAS decoratif : au bout de 3 s le toast ne fait que
      // passer son opacite a 0 — il reste donc dans le DOM, invisible mais cliquable, a
      // `z-index:9999` dans le coin inferieur droit. Il mangeait la quasi-totalite du
      // bouton « Importer » de l'ecran d'import (barre de pied a `z-index:100`), qui ne
      // recevait plus le clic que sur ~7 px le long de son bord bas. Un toast n'a aucun
      // gestionnaire : il n'a rien a intercepter. Meme parti pris que le bandeau
      // d'astuce du shell (`explorerModule.ts:294`).
      "position:fixed", "bottom:1.2rem", "right:1.2rem", "z-index:9999",
      "pointer-events:none",
      "padding:0.5rem 1rem", "border-radius:6px", "font-size:0.85rem",
      "font-weight:500", "box-shadow:0 2px 8px rgba(0,0,0,0.18)",
      "transition:opacity 0.4s", "max-width:400px",
    ].join(";");
    document.body.appendChild(_toastEl);
  }
  if (_toastTimer !== null) clearTimeout(_toastTimer);
  _toastEl.textContent = msg;
  _toastEl.style.opacity = "1";
  _toastEl.style.background = isError ? "#f8d7da" : "#d4edda";
  _toastEl.style.color = isError ? "#721c24" : "#155724";
  _toastTimer = window.setTimeout(() => {
    if (_toastEl) _toastEl.style.opacity = "0";
  }, 3000);
}

// ─── JobCenter class ─────────────────────────────────────────────────────────

export class JobCenter {
  private _conn: Conn | null = null;
  private _active: Map<string, TrackedJob> = new Map();
  private _recent: RecentJob[] = [];
  private _pollTimer: number | null = null;
  private _retireTimer: number | null = null;
  private _panelEl!: HTMLElement;

  render(): HTMLElement {
    const el = document.createElement("div");
    el.className = "job-center";
    this._panelEl = el;
    this._updatePanel();
    return el;
  }

  setConn(conn: Conn | null): void {
    this._conn = conn;
    if (!conn) {
      this._stopPolling();
      this._cancelRetire();
      this._active.clear();
      this._recent = [];
      this._updatePanel();
    }
  }

  /**
   * Le bandeau annonce ce qui **tourne**. Une fois le dernier job fini, il se retire
   * seul : sans ça, ses lignes terminées restaient au sommet de tous les écrans pour le
   * reste de la session. Le journal, lui, garde la trace durable — et il la garde mieux,
   * avec le dossier et les comptes.
   */
  private _scheduleRetire(): void {
    this._cancelRetire();
    this._retireTimer = window.setTimeout(() => {
      this._retireTimer = null;
      this._recent = [];
      this._updatePanel();
    }, RETIRE_MS);
  }

  private _cancelRetire(): void {
    if (this._retireTimer !== null) {
      clearTimeout(this._retireTimer);
      this._retireTimer = null;
    }
  }

  private _pushRecent(job: JobRecord, label: string): void {
    this._recent.unshift({ job, label });
    if (this._recent.length > RECENT_MAX) this._recent.length = RECENT_MAX;
  }

  /** Submit a job and start tracking it. Polls until terminal state. */
  trackJob(jobId: string, label: string, onDone: DoneCallback): void {
    if (!this._conn) return;
    // Fetch initial job state then register
    getJob(this._conn, jobId).then((job) => {
      if (job.status === "done" || job.status === "error" || job.status === "canceled") {
        this._pushRecent(job, label);
        onDone(job);
        this._updatePanel();
        this._scheduleRetire();
        return;
      }
      this._cancelRetire();
      this._active.set(jobId, { label, job, onDone });
      this._updatePanel();
      this._startPolling();
    }).catch(() => {
      // job fetch failed, still register with placeholder
      const placeholder: JobRecord = {
        job_id: jobId, kind: "unknown", status: "queued",
        progress_pct: 0, created_at: new Date().toISOString(),
      };
      this._cancelRetire();
      this._active.set(jobId, { label, job: placeholder, onDone });
      this._updatePanel();
      this._startPolling();
    });
  }

  private _startPolling(): void {
    if (this._pollTimer !== null) return;
    this._pollTimer = window.setInterval(() => { void this._poll(); }, 500);
  }

  private _stopPolling(): void {
    if (this._pollTimer !== null) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  private async _poll(): Promise<void> {
    if (!this._conn || this._active.size === 0) {
      this._stopPolling();
      this._updatePanel();
      return;
    }
    for (const [jobId, entry] of [...this._active.entries()]) {
      try {
        const job = await getJob(this._conn, jobId);
        entry.job = job;
        if (job.status === "done" || job.status === "error" || job.status === "canceled") {
          this._active.delete(jobId);
          this._pushRecent(job, entry.label);
          entry.onDone(job);
        }
      } catch {
        // network hiccup — ignore
      }
    }
    this._updatePanel();
    if (this._active.size === 0) {
      this._stopPolling();
      this._scheduleRetire();
    }
  }

  private async _doCancel(jobId: string): Promise<void> {
    if (!this._conn) return;
    try {
      await apiCancelJob(this._conn, jobId);
    } catch {
      // best-effort
    }
  }

  private _updatePanel(): void {
    if (!this._panelEl) return;
    if (this._active.size === 0 && this._recent.length === 0) {
      this._panelEl.style.display = "none";
      return;
    }
    // Valeur EXPLICITE, et non `""`. Vider le style inline ne rend pas l'élément
    // visible : ça rend la main à la feuille de style, qui dit
    // `.job-center { display: none }` (job-center.css:1). Le bandeau se peignait donc
    // correctement puis se cachait dans le même geste — invisible depuis son origine
    // (5808736), pour tous les jobs et tous les écrans. Personne ne l'a vu manquer :
    // le toast et les journaux d'écran couvraient le même besoin.
    this._panelEl.style.display = "block";

    let html = `<div class="jc-inner">`;

    if (this._active.size > 0) {
      html += `<div class="jc-section-title">Jobs actifs</div>`;
      for (const [jobId, entry] of this._active.entries()) {
        const j = entry.job;
        const pct = j.progress_pct ?? 0;
        html += `
          <div class="jc-job jc-job-active" data-id="${_esc(jobId)}">
            <div class="jc-job-head">
              <span class="jc-job-label">${_esc(entry.label)}</span>
              <span class="jc-job-kind">${_esc(j.kind)}</span>
              <span class="jc-job-pct">${pct}%</span>
              <button class="btn btn-sm btn-danger jc-cancel-btn" data-id="${_esc(jobId)}" style="margin-left:auto">Annuler</button>
            </div>
            <div class="jc-progress-bar"><div class="jc-progress-fill" style="width:${pct}%"></div></div>
            ${j.progress_message ? `<div class="jc-msg">${_esc(j.progress_message)}</div>` : ""}
          </div>`;
      }
    }

    if (this._recent.length > 0) {
      html += `<div class="jc-section-title">Terminés (${this._recent.length})</div>`;
      for (const { job: j, label } of this._recent) {
        const icon = j.status === "done" ? "✓" : j.status === "canceled" ? "↩" : "✗";
        const cls = j.status === "done" ? "jc-job-done" : j.status === "canceled" ? "jc-job-cancel" : "jc-job-err";
        const msg = j.progress_message ?? j.status;
        html += `
          <div class="jc-job ${cls} jc-recent-row">
            <span class="jc-icon">${icon}</span>
            <span class="jc-job-label">${_esc(label)}</span>
            <span class="jc-job-kind">${_esc(j.kind)}</span>
            <span class="jc-msg">${_esc(msg)}</span>
          </div>`;
      }
    }

    html += `</div>`;
    setHtml(this._panelEl, raw(html));  // built above; all dynamic parts via _esc

    this._panelEl.querySelectorAll<HTMLButtonElement>(".jc-cancel-btn").forEach(btn => {
      btn.addEventListener("click", () => { void this._doCancel(btn.dataset.id!); });
    });
  }
}

function _esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
