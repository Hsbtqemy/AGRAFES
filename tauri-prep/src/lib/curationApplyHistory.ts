/**
 * curationApplyHistory.ts — Pure helpers for the curation apply history panel.
 *
 * Phase 2 of the CurationView decomposition (cf. HANDOFF_PREP § 7 backlog).
 * No DOM manipulation, no I/O. Renders to HTML strings — caller is responsible
 * for assigning to `container.innerHTML`.
 *
 * Invariants protégés par les tests __tests__/curationApplyHistory.test.ts :
 *   1. mergeApplyHistory ne supprime jamais un event session non-présent en DB
 *   2. Dédup par applied_at : si même timestamp en session ET en DB, DB gagne
 *      (event a été persisté → version canonique)
 *   3. Session-first : les events session (id=null) apparaissent avant les
 *      events DB dans la liste mergée — cohérent avec _applyHistory.unshift()
 *   4. Cap respecté : la liste finale ne dépasse jamais le cap demandé
 *   5. Filtrage par scope : "doc"|"all"|"" filtre exactement comme attendu
 *   6. Robuste aux fields manquants : doc_title/applied_at/ignored_count null
 *      → pas de crash, fallbacks visibles ("—")
 *   7. Session marker : event sans id reçoit la classe "apply-hist-row--session"
 */
import type { CurateApplyEvent } from "./sidecarClient.ts";

/** Scope filter values accepted by the UI dropdown. Empty string = no filter. */
export type ApplyHistoryScope = "doc" | "all" | "";

export interface MergeApplyHistoryOptions {
  scope?: ApplyHistoryScope;
  /** Cap on the final merged list. Default 50 (matches the UI display cap). */
  cap?: number;
}

/**
 * Filter events by scope. Pure.
 *
 * @param events  Source events (any order)
 * @param scope   "doc" → only doc-scoped, "all" → only corpus-scoped,
 *                "" → no filter (passthrough)
 */
export function filterApplyHistoryByScope(
  events: CurateApplyEvent[],
  scope: ApplyHistoryScope,
): CurateApplyEvent[] {
  if (scope === "doc") return events.filter((e) => e.scope === "doc");
  if (scope === "all") return events.filter((e) => e.scope === "all");
  return events;
}

/**
 * Merge in-memory session events with events fetched from the DB.
 *
 * Rules :
 *   - Events present in DB (matched by applied_at timestamp) are kept from
 *     the DB version. This handles the race where a session event was
 *     persisted between the unshift and the next list refresh.
 *   - Events session-only (timestamp not in DB) are kept as session events
 *     and appear FIRST in the result (most recent local activity).
 *   - The combined list is then truncated to `cap` entries.
 *
 * @param sessionEvents  Events from the in-memory session (typically prepended
 *                       by the apply flow, may have id=null)
 * @param dbEvents       Events from POST /curate/apply-history (canonical)
 * @param options        scope filter + cap
 * @returns              Merged, deduplicated, capped list
 */
export function mergeApplyHistory(
  sessionEvents: CurateApplyEvent[],
  dbEvents: CurateApplyEvent[],
  options: MergeApplyHistoryOptions = {},
): CurateApplyEvent[] {
  const scope = options.scope ?? "";
  const cap = options.cap ?? 50;
  const filteredDb = filterApplyHistoryByScope(dbEvents, scope);
  const dbTimes = new Set(filteredDb.map((e) => e.applied_at));
  const filteredSession = filterApplyHistoryByScope(sessionEvents, scope);
  const sessionOnly = filteredSession.filter((e) => !dbTimes.has(e.applied_at));
  return [...sessionOnly, ...filteredDb].slice(0, cap);
}

/**
 * Render a single apply event as an HTML string. Pure.
 *
 * The output structure must match the existing CSS in app.css :
 *   - .prep-apply-hist-row[.apply-hist-row--session] container
 *   - .prep-apply-hist-ts (timestamp)
 *   - .prep-apply-hist-scope-badge.apply-hist-scope--{doc|all}
 *   - .prep-apply-hist-doc (title or #id)
 *   - .prep-apply-hist-counts (modified / skipped)
 *   - .prep-apply-hist-extras (ignored / manual override, optional)
 *
 * @param event  Event to render. Tolerant to missing fields (applied_at null,
 *               doc_title null, ignored_count undefined → "—" or omitted)
 */
export function formatApplyHistoryRow(event: CurateApplyEvent): string {
  const ts = event.applied_at
    ? new Date(event.applied_at).toLocaleString("fr-FR", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "—";
  const scopeLabel = event.scope === "doc" ? "Document" : "Corpus";
  const docLbl = event.doc_title
    ? event.doc_title
    : event.doc_id != null
      ? `#${event.doc_id}`
      : "—";
  const modified = event.units_modified ?? 0;
  const skipped = event.units_skipped ?? 0;
  const ignoredPart =
    event.ignored_count != null && event.ignored_count > 0
      ? `${event.ignored_count} ign.`
      : "";
  const manualPart =
    event.manual_override_count != null && event.manual_override_count > 0
      ? `${event.manual_override_count} man.`
      : "";
  const extras = [ignoredPart, manualPart].filter(Boolean).join(" / ");
  const sessionMark = event.id == null ? " apply-hist-row--session" : "";
  return (
    `<div class="prep-apply-hist-row${sessionMark}">` +
    `<span class="prep-apply-hist-ts">${ts}</span>` +
    `<span class="prep-apply-hist-scope-badge apply-hist-scope--${event.scope}">${scopeLabel}</span>` +
    `<span class="prep-apply-hist-doc" title="${event.doc_title ?? ""}">${docLbl}</span>` +
    `<span class="prep-apply-hist-counts">${modified} mod. / ${skipped} saut.</span>` +
    (extras
      ? `<span class="prep-apply-hist-extras">${extras}</span>`
      : "") +
    `</div>`
  );
}

/**
 * Render the full apply history list as an HTML string.
 * If empty, returns an empty-hint paragraph (no rows).
 *
 * Pure — caller is responsible for `container.innerHTML = formatApplyHistoryList(events)`.
 */
export function formatApplyHistoryList(events: CurateApplyEvent[]): string {
  if (!events.length) {
    return `<p class="empty-hint">Aucun apply enregistré.</p>`;
  }
  return events.map(formatApplyHistoryRow).join("");
}
