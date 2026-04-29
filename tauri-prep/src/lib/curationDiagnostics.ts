/**
 * curationDiagnostics.ts — Pure helpers for the curation diagnostics journal.
 *
 * Phase 4 of the CurationView decomposition (cf. HANDOFF_PREP § 7 backlog).
 * No DOM manipulation, no I/O. Renders to HTML strings — caller is responsible
 * for assigning to `container.innerHTML`.
 *
 * Note pragmatique : `appendCurateLogEntry` lit `Date.now()` pour estampiller
 * la création — pas strictement pur. `formatCurateLogEntry` reste déterministe
 * en prenant `now` en paramètre (testable sans mock du temps).
 *
 * Invariants protégés par les tests __tests__/curationDiagnostics.test.ts :
 *   1. appendCurateLogEntry : ordre LIFO (newest first via unshift)
 *   2. appendCurateLogEntry : cap respecté (default 10) ; troncature en queue
 *   3. appendCurateLogEntry : immutable — input log non muté
 *   4. formatCurateLogEntry : kind="warn" → classe prep-curate-log-warn
 *   5. formatCurateLogEntry : kind="apply" → classe prep-curate-log-apply
 *   6. formatCurateLogEntry : kind="preview" → pas de classe additionnelle
 *   7. formatCurateLogEntry : age < 60s → "il y a Ns" ; ≥ 60s → hh:mm fr-FR
 *   8. formatCurateLogEntry : escape HTML sur msg
 *   9. formatCurateLogEntry : labels FR (Prévisu / Application / ⚠)
 *  10. formatCurateLog : log vide → empty-hint avec padding inline
 *  11. countCurateWarnings : compte uniquement kind="warn"
 */
import { escHtml } from "./diff.ts";

export type CurateLogKind = "preview" | "apply" | "warn";

export interface CurateLogEntry {
  ts: number;
  kind: CurateLogKind;
  msg: string;
}

/**
 * Append a new entry at the head (LIFO). Returns a new array — input is not
 * mutated. Caps the result at `cap` entries (default 10). Pure.
 *
 * @param log   Current journal (newest first)
 * @param kind  "preview" | "apply" | "warn"
 * @param msg   Free-form message (will be HTML-escaped at format time)
 * @param cap   Max entries kept after append (default 10)
 */
export function appendCurateLogEntry(
  log: readonly CurateLogEntry[],
  kind: CurateLogKind,
  msg: string,
  cap: number = 10,
): CurateLogEntry[] {
  const next: CurateLogEntry[] = [{ ts: Date.now(), kind, msg }, ...log];
  if (next.length > cap) next.length = cap;
  return next;
}

/**
 * Render a single journal entry as an HTML string. Pure.
 *
 * @param entry  Entry to render
 * @param now    Reference timestamp (typically Date.now()) for age computation.
 *               Passed in to keep the function deterministic / testable.
 */
export function formatCurateLogEntry(entry: CurateLogEntry, now: number): string {
  const diffS = Math.round((now - entry.ts) / 1000);
  const age = diffS < 60
    ? `il y a ${diffS} s`
    : new Date(entry.ts).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const kindClass = entry.kind === "warn"
    ? "prep-curate-log-warn"
    : entry.kind === "apply"
      ? "prep-curate-log-apply"
      : "";
  const kindLabel = entry.kind === "preview"
    ? "Prévisu"
    : entry.kind === "apply"
      ? "Application"
      : "⚠";
  return (
    `<div class="prep-curate-qitem ${kindClass}">` +
    `<div class="prep-curate-qmeta"><span>${kindLabel}</span><span>${age}</span></div>` +
    `<div>${escHtml(entry.msg)}</div>` +
    `</div>`
  );
}

/**
 * Render the full journal as an HTML string. Pure.
 * Empty log → empty-hint paragraph with inline padding (matches legacy CSS).
 */
export function formatCurateLog(log: readonly CurateLogEntry[], now: number): string {
  if (log.length === 0) {
    return `<p class="empty-hint" style="padding:10px">Aucune action enregistrée.</p>`;
  }
  return log.map((e) => formatCurateLogEntry(e, now)).join("");
}

/** Count entries of kind="warn" in the log. Used to drive the summary badge. */
export function countCurateWarnings(log: readonly CurateLogEntry[]): number {
  return log.filter((e) => e.kind === "warn").length;
}
