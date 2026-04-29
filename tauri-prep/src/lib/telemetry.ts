/**
 * telemetry.ts — Local-only fire-and-forget telemetry for AGRAFES frontend.
 *
 * Sends structured events to the sidecar's POST /telemetry endpoint, which
 * appends them to a local NDJSON file next to the DB. NO network egress —
 * the sidecar is loopback-only. NO server. Aggregation and visualisation
 * happen offline (or via the Shell diagnostic menu).
 *
 * Contract :
 *   - All emissions are fire-and-forget. Errors are swallowed.
 *   - The endpoint is unauthenticated by design (loopback-only, low risk).
 *   - The 5 documented events are: stage_completed, stage_returned, cap_hit,
 *     error_user_facing, doc_deleted (+ meta sidecar_started). Adding a new
 *     event = explicit decision, not opportunistic.
 *
 * Usage:
 *   import { reportEvent, reportUserError } from "../lib/telemetry.ts";
 *   reportEvent(conn, "cap_hit", { cap_name: "dom_raw_pane_5000", actual_count: 8000, doc_id: 414 });
 *   reportUserError(conn, "SidecarError", { stage: "curate", doc_id: 414 });
 */

import type { Conn } from "./sidecarClient.ts";

/**
 * Send a telemetry event. Fire-and-forget — never throws, never returns
 * a useful value. Caller code must not depend on the outcome.
 */
export function reportEvent(
  conn: Conn | null | undefined,
  eventName: string,
  payload: Record<string, unknown> = {},
): void {
  if (!conn || !eventName) return;
  // Build the body. The sidecar handler strips `event` from payload before
  // appending, so we pass it together as one object.
  const body = { event: eventName, ...payload };
  // We use conn.post but ignore the response (204 No Content). Catch all
  // errors to never propagate. This is THE fire-and-forget contract.
  try {
    void Promise.resolve(conn.post("/telemetry", body)).catch(() => {
      /* swallow: network, sidecar dead, payload malformed — none should
         affect the calling code path */
    });
  } catch {
    /* synchronous throw (impossible with current Conn impl, but defensive) */
  }
}

/**
 * Convenience wrapper for the `error_user_facing` event. Use at every site
 * where we display an error to the user via toast or log (red).
 *
 * NEVER include the error message itself — privacy + signal-to-noise. The
 * `error_class` should be a stable identifier (e.g. "SidecarError",
 * "ValidationError", "TauriDialogError"). `ctx` carries optional context
 * fields like stage and doc_id.
 */
export function reportUserError(
  conn: Conn | null | undefined,
  errorClass: string,
  ctx: { stage?: string; doc_id?: number } = {},
): void {
  reportEvent(conn, "error_user_facing", { error_class: errorClass, ...ctx });
}
