/**
 * shellSidecar.ts — Thin adapter over tauri-app and tauri-prep sidecar clients.
 *
 * Centralises the cross-package imports so shell.ts never references
 * ../../tauri-app/... or ../../tauri-prep/... directly.
 * Dynamic-import wrappers preserve code-splitting behaviour.
 */

/** Ensure the sidecar is running for the given DB path. Returns a Conn. */
export async function ensureRunning(dbPath: string): Promise<unknown> {
  const { ensureRunning: fn } = await import("../../tauri-app/src/lib/sidecarClient.ts");
  return fn(dbPath);
}

/** List documents from the explorer sidecar. */
export async function listDocuments(conn: unknown): Promise<unknown[]> {
  const { listDocuments: fn } = await import("../../tauri-app/src/lib/sidecarClient.ts");
  return fn(conn as never);
}

/** Enqueue a job via the prep sidecar. */
export async function enqueueJob(
  conn: unknown,
  jobType: string,
  params: Record<string, unknown>,
): Promise<{ job_id: string }> {
  const { enqueueJob: fn } = await import("../../tauri-prep/src/lib/sidecarClient.ts");
  return fn(conn as never, jobType, params) as Promise<{ job_id: string }>;
}

/** Poll a job status via the prep sidecar. */
export async function getJob(
  conn: unknown,
  jobId: string,
): Promise<{ status: string; result?: unknown; error?: string }> {
  const { getJob: fn } = await import("../../tauri-prep/src/lib/sidecarClient.ts");
  return fn(conn as never, jobId) as Promise<{ status: string; result?: unknown; error?: string }>;
}
