/**
 * curationReviewReport.ts — Pure builders for the curation review-report export.
 *
 * Phase 2 of the CurationView decomposition (cf. HANDOFF_PREP § 7 backlog).
 * No DOM manipulation, no I/O, no clock access. The caller (CurationView via
 * `_runExportReviewReport`) provides a snapshot of the live session state and
 * an `exportedAt` ISO timestamp, then writes the result to disk.
 *
 * Invariants protégés par les tests __tests__/curationReviewReport.test.ts :
 *   1. Le payload reflète l'état session en mémoire uniquement (note explicite).
 *   2. `truncated` est vrai ssi globalChanged > items affichés ; la note de
 *      troncature n'est ajoutée que dans ce cas, en première position.
 *   3. `effective_after` = manual_after (fallback after) si override manuel,
 *      sinon after — identique en JSON et CSV.
 *   4. `matched_rules` mappe chaque index sur son label ; index hors plage →
 *      fallback "règle N+1" (JSON) / "rN+1" (CSV).
 *   5. Une exception persistée n'est jointe que si l'unité en a une (Map.get).
 *   6. Le CSV échappe ,/"/newline par doublage des guillemets ; l'en-tête de
 *      colonnes est stable et précède toujours les lignes.
 *   7. `exported_at` provient de l'appelant (déterminisme/testabilité), jamais
 *      d'un `new Date()` interne.
 */
import type {
  CuratePreviewExample,
  CurateException,
  CurateApplyEvent,
} from "./sidecarClient.ts";

/** Snapshot of the live curation session needed to build a review report. */
export interface ReviewReportContext {
  /** Current curation doc id, or null for the corpus-wide scope. */
  docId: number | null;
  /** Resolved title for `docId` (looked up by the caller), or null. */
  docTitle: string | null;
  /** Preview examples for the current session (the items under review). */
  examples: CuratePreviewExample[];
  /** Real number of changed units in the document (may exceed examples.length). */
  globalChanged: number;
  /** Total units in the document. */
  unitsTotal: number;
  /** Active rule labels, indexed to match `matched_rule_ids`. */
  ruleLabels: string[];
  /** Persistent exceptions keyed by unit_id. */
  exceptions: Map<number, CurateException>;
  /** Last apply result, echoed verbatim into the payload, or null. */
  lastApplyResult: CurateApplyEvent | null;
  /** ISO timestamp for `exported_at` — passed in for determinism/testability. */
  exportedAt: string;
}

/**
 * Build the JSON review-report payload (object, ready for JSON.stringify). Pure.
 */
export function buildReviewReportPayload(ctx: ReviewReportContext): object {
  const items = ctx.examples;
  const pending = items.filter((e) => (e.status ?? "pending") === "pending").length;
  const accepted = items.filter((e) => e.status === "accepted").length;
  const ignored = items.filter((e) => e.status === "ignored").length;
  const manuals = items.filter((e) => e.is_manual_override).length;
  const isTruncated = ctx.globalChanged > items.length;
  const notes: string[] = [];
  if (isTruncated) notes.push(`Preview tronquée : ${items.length} item(s) affichés sur ${ctx.globalChanged} modifications réelles dans le document.`);
  notes.push("Ce rapport reflète uniquement la session courante (en mémoire). Les décisions ne survivent pas à un rechargement sans restauration localStorage.");
  return {
    exported_at: ctx.exportedAt,
    report_type: "curation_review_session",
    doc_id: ctx.docId, doc_title: ctx.docTitle,
    sample: { displayed: items.length, units_changed: ctx.globalChanged, units_total: ctx.unitsTotal, truncated: isTruncated },
    summary: { pending, accepted, ignored, manual_overrides: manuals },
    rules: [...ctx.ruleLabels],
    items: items.map((ex) => {
      const persistentExc = ex.unit_id !== undefined ? (ctx.exceptions.get(ex.unit_id) ?? null) : null;
      return {
        unit_id: ex.unit_id ?? null, unit_index: ex.unit_index ?? null,
        status: ex.status ?? "pending", before: ex.before, after: ex.after,
        effective_after: ex.is_manual_override ? (ex.manual_after ?? ex.after) : ex.after,
        is_manual_override: ex.is_manual_override ?? false,
        matched_rules: (ex.matched_rule_ids ?? []).map((idx) => ctx.ruleLabels[idx] ?? `règle ${idx + 1}`),
        preview_reason: ex.preview_reason ?? "standard",
        context_before: ex.context_before ?? null, context_after: ex.context_after ?? null,
        persistent_exception: persistentExc ? { kind: persistentExc.kind, text: persistentExc.override_text ?? null } : null,
      };
    }),
    last_apply_result: ctx.lastApplyResult, notes,
  };
}

/**
 * Build the CSV review-report (one header row + one row per example). Pure.
 * Only `examples`, `exceptions` and `ruleLabels` are consulted.
 */
export function buildReviewReportCsv(
  ctx: Pick<ReviewReportContext, "examples" | "exceptions" | "ruleLabels">,
): string {
  const cols = ["unit_id", "unit_index", "status", "is_manual_override", "before", "after", "effective_after", "matched_rules", "preview_reason", "context_before", "context_after", "persistent_exception_kind"];
  const escape = (v: unknown): string => {
    const s = v == null ? "" : String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows: string[] = [cols.join(",")];
  for (const ex of ctx.examples) {
    const persistentExc = ex.unit_id !== undefined ? (ctx.exceptions.get(ex.unit_id) ?? null) : null;
    rows.push([
      ex.unit_id ?? "", ex.unit_index ?? "", ex.status ?? "pending",
      ex.is_manual_override ? "true" : "false",
      escape(ex.before), escape(ex.after),
      escape(ex.is_manual_override ? (ex.manual_after ?? ex.after) : ex.after),
      escape((ex.matched_rule_ids ?? []).map((idx) => ctx.ruleLabels[idx] ?? `r${idx + 1}`).join("; ")),
      ex.preview_reason ?? "standard",
      escape(ex.context_before ?? ""), escape(ex.context_after ?? ""),
      persistentExc?.kind ?? "",
    ].join(","));
  }
  return rows.join("\n");
}
