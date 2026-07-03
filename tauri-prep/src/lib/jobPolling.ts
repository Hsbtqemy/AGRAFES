/**
 * jobPolling.ts — a small DOM-free controller for the sidecar's enqueue → poll job
 * pattern (annotation, model download, …). Extracted from AnnotationView's two twin
 * machineries (R5.2c-4a) so the canvas annotation dock and the legacy screen share one
 * source of truth for progress reporting and clean stop.
 */
import type { Conn, JobRecord } from "./sidecarClient.ts";
import { getJob } from "./sidecarClient.ts";

export interface JobHandle {
  /** Stop polling; any further callback is suppressed. Idempotent. */
  cancel(): void;
}

export interface RunJobOptions {
  /** Enqueue the job and resolve its job_id. Throwing or an empty id → onError. */
  enqueue: () => Promise<string>;
  /** Fired on each running tick that carries a progress message. */
  onProgress?: (message: string, pct?: number) => void;
  /** Fired once when the job reaches "done". */
  onDone: (job: JobRecord) => void | Promise<void>;
  /** Fired on enqueue failure or a terminal error/canceled job. */
  onError: (message: string) => void;
  /** Poll interval; defaults to 1000ms. */
  intervalMs?: number;
  /** Injectable for tests; defaults to sidecarClient.getJob. */
  getJobFn?: (conn: Conn, jobId: string) => Promise<JobRecord>;
}

/**
 * Enqueue a job and poll it to completion, dispatching progress/done/error callbacks.
 * Transient poll errors are swallowed (keep polling). Returns a handle whose cancel()
 * stops polling and suppresses further callbacks — call it on dispose.
 */
export function runJobWithPolling(conn: Conn, opts: RunJobOptions): JobHandle {
  let timer: ReturnType<typeof setInterval> | null = null;
  let jobId: string | null = null;
  let stopped = false;
  const fetchJob = opts.getJobFn ?? getJob;

  const stopTimer = (): void => {
    if (timer !== null) { clearInterval(timer); timer = null; }
  };
  const handle: JobHandle = {
    cancel: () => { stopped = true; stopTimer(); },
  };

  const tick = async (): Promise<void> => {
    if (stopped || jobId === null) return;
    let job: JobRecord;
    try {
      job = await fetchJob(conn, jobId);
    } catch {
      return; // transient — keep polling
    }
    if (stopped) return;
    const status: string = job.status;
    // Guard the callbacks: a throwing onDone/onError must not surface as an unhandled
    // rejection from the interval (matches the swallow-behaviour of the code this
    // replaced). For terminal states the timer is already stopped before the callback.
    try {
      if (status === "running") {
        if (job.progress_message) opts.onProgress?.(job.progress_message, job.progress_pct);
      } else if (status === "done") {
        stopTimer();
        await opts.onDone(job);
      } else if (status === "error" || status === "canceled" || status === "cancelled") {
        stopTimer();
        opts.onError(job.error ?? status);
      }
    } catch {
      // A callback threw — swallow (the run is already terminal / progress is best-effort).
    }
  };

  void (async () => {
    try {
      jobId = await opts.enqueue();
      if (!jobId) throw new Error("Pas de job_id dans la réponse");
    } catch (err) {
      if (!stopped) opts.onError(err instanceof Error ? err.message : String(err));
      return;
    }
    if (stopped) return;
    timer = setInterval(() => { void tick(); }, opts.intervalMs ?? 1000);
  })();

  return handle;
}
