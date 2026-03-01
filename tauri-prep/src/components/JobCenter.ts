/**
 * JobCenter.ts — V0.5 async job tracking panel.
 *
 * Renders a strip between the tab bar and screen content.
 * Polls active jobs every 500ms; shows progress bars + cancel buttons.
 * Keeps the last 5 finished jobs in a "recent" list.
 */

import type { Conn, JobRecord } from "../lib/sidecarClient.ts";
import { getJob, cancelJob as apiCancelJob } from "../lib/sidecarClient.ts";

type DoneCallback = (job: JobRecord) => void;

interface TrackedJob {
  label: string;
  job: JobRecord;
  onDone: DoneCallback;
}

// CSS injected once by App
export const JOB_CENTER_CSS = `
  .job-center { background: #f0f5ff; border-bottom: 1px solid #c8d8f5; display: none; }
  .jc-inner { max-width: 900px; margin: 0 auto; padding: 0.35rem 1.25rem; display: flex;
    flex-direction: column; gap: 0.25rem; }
  .jc-section-title { font-size: 0.68rem; text-transform: uppercase; color: var(--color-muted);
    letter-spacing: 0.07em; margin: 0.15rem 0 0; }
  .jc-job { display: flex; align-items: center; gap: 0.5rem; font-size: 0.8rem; }
  .jc-job-active { flex-direction: column; align-items: flex-start; gap: 0.15rem; }
  .jc-job-head { display: flex; align-items: center; gap: 0.5rem; width: 100%; }
  .jc-job-label { font-weight: 600; }
  .jc-job-kind { color: var(--color-muted); font-size: 0.72rem; font-family: monospace; }
  .jc-job-pct { margin-left: auto; font-weight: 600; color: var(--color-primary); font-size: 0.8rem; }
  .jc-progress-bar { width: 100%; height: 3px; background: #c8d8f5; border-radius: 2px; }
  .jc-progress-fill { height: 100%; background: var(--color-primary); border-radius: 2px;
    transition: width 0.4s ease; }
  .jc-msg { font-size: 0.72rem; color: var(--color-muted); }
  .jc-job-done .jc-icon { color: var(--color-ok); font-weight: 700; }
  .jc-job-err .jc-icon  { color: var(--color-danger); font-weight: 700; }
  .jc-job-cancel .jc-icon { color: var(--color-secondary); }
  .jc-recent-row { display: flex; align-items: center; gap: 0.4rem; }
`;

// ─── Toast helper (static, appended to body) ──────────────────────────────────

let _toastTimer: number | null = null;
let _toastEl: HTMLElement | null = null;

export function showToast(msg: string, isError = false): void {
  if (!_toastEl) {
    _toastEl = document.createElement("div");
    _toastEl.id = "jc-toast";
    _toastEl.style.cssText = [
      "position:fixed", "bottom:1.2rem", "right:1.2rem", "z-index:9999",
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
  private _recent: JobRecord[] = [];
  private _pollTimer: number | null = null;
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
      this._active.clear();
      this._updatePanel();
    }
  }

  /** Submit a job and start tracking it. Polls until terminal state. */
  trackJob(jobId: string, label: string, onDone: DoneCallback): void {
    if (!this._conn) return;
    // Fetch initial job state then register
    getJob(this._conn, jobId).then((job) => {
      if (job.status === "done" || job.status === "error" || job.status === "canceled") {
        this._recent.unshift(job);
        if (this._recent.length > 5) this._recent.length = 5;
        onDone(job);
        this._updatePanel();
        return;
      }
      this._active.set(jobId, { label, job, onDone });
      this._updatePanel();
      this._startPolling();
    }).catch(() => {
      // job fetch failed, still register with placeholder
      const placeholder: JobRecord = {
        job_id: jobId, kind: "unknown", status: "queued",
        progress_pct: 0, created_at: new Date().toISOString(),
      };
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
          this._recent.unshift(job);
          if (this._recent.length > 5) this._recent.length = 5;
          entry.onDone(job);
        }
      } catch {
        // network hiccup — ignore
      }
    }
    this._updatePanel();
    if (this._active.size === 0) this._stopPolling();
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
    this._panelEl.style.display = "";

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
      html += `<div class="jc-section-title">Récents (5)</div>`;
      for (const j of this._recent) {
        const icon = j.status === "done" ? "✓" : j.status === "canceled" ? "↩" : "✗";
        const cls = j.status === "done" ? "jc-job-done" : j.status === "canceled" ? "jc-job-cancel" : "jc-job-err";
        const msg = j.progress_message ?? j.status;
        html += `
          <div class="jc-job ${cls} jc-recent-row">
            <span class="jc-icon">${icon}</span>
            <span class="jc-job-kind">${_esc(j.kind)}</span>
            <span class="jc-msg">${_esc(msg)}</span>
          </div>`;
      }
    }

    html += `</div>`;
    this._panelEl.innerHTML = html;

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
