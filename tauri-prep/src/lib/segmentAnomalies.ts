/**
 * segmentAnomalies.ts — pure detection of segmentation anomalies for the canvas
 * "Segmentation" layer's Brut view (R5.4b-3). Relogs the legacy SegmentationView
 * saved-table filters (short segments + orphan closing punctuation) as testable,
 * DOM-free logic.
 *
 * Two anomalies, both artefacts of imperfect cuts the user fixes by hand (merge/split):
 *  - short segment: a line unit of ≤ SHORT_SEGMENT_MAX_LEN chars (often a stray fragment);
 *  - orphan punctuation: a line unit starting with a closing mark (»)]}”’…), typically a
 *    closing quote/paren left on the next line by a bad numbered-line import. The closer
 *    set is language-aware: German additionally uses the reversed guillemets « ‹ › as closers.
 *
 * Only `line` units are ever flagged (structure units — headings — are never anomalies).
 * Legacy literals preserved verbatim (SegmentationView.ts:920-966): ≤ 5 chars, ±1 neighbour
 * context, orphan class takes precedence over short when a unit is both.
 */

/** A line unit of this many characters or fewer is "short" (legacy: text.length <= 5). */
export const SHORT_SEGMENT_MAX_LEN = 5;

/** Closing marks that, leading a segment, signal a bad cut. Typographic (not straight
 *  quotes), mirroring the legacy set: » ) ] } ” ’ */
const ORPHAN_CLOSERS = "»)]}”’";
/** German additionally uses reversed guillemets as closers → also flag « ‹ › */
const ORPHAN_CLOSERS_DE_EXTRA = "«‹›";

/** Escape the characters that are special inside a regex character class ( ] \ ^ - ). */
function escapeCharClass(chars: string): string {
  return chars.replace(/[\]\\^-]/g, (c) => `\\${c}`);
}

/** Orphan-punctuation regex for a document language. German gets the extra reversed
 *  guillemets; every other language (including French) uses the base closer set. */
export function orphanRegexForLang(lang: string | null | undefined): RegExp {
  const isDe = (lang ?? "").toLowerCase().startsWith("de");
  const chars = isDe ? ORPHAN_CLOSERS + ORPHAN_CLOSERS_DE_EXTRA : ORPHAN_CLOSERS;
  return new RegExp(`^\\s*[${escapeCharClass(chars)}]+`);
}

export function isShortText(text: string): boolean {
  return text.length <= SHORT_SEGMENT_MAX_LEN;
}

export function isOrphanText(text: string, lang: string | null | undefined): boolean {
  return orphanRegexForLang(lang).test(text);
}

export interface AnomalyFilters {
  short: boolean;
  orphan: boolean;
}

/** Per-unit rendering class. `null` = not involved. Orphan wins over short when both. */
export type AnomalyClass = "orphan" | "short" | "context" | null;

export interface AnomalyRow {
  /** Rendering class (orphan takes precedence over short when both & both filters active). */
  cls: AnomalyClass;
  /** Whether the row is shown when a filter is active (targets + their ±1 neighbours). */
  visible: boolean;
}

export interface AnomalyView {
  /** One entry per input unit, in order. */
  rows: AnomalyRow[];
  /** Count of short line units (independent of the active filters — drives the chip). */
  shortCount: number;
  /** Count of orphan line units (independent of the active filters — drives the chip). */
  orphanCount: number;
  /** True when at least one filter is active (so non-kept rows are collapsed). */
  anyFilterActive: boolean;
}

export interface AnomalyInput {
  text: string;
  /** Only line units are candidates; structure units are never flagged. */
  isLine: boolean;
}

/**
 * Classify units for the Brut view given the active filters and document language.
 * Targets = line units matching an *active* filter; each target plus its immediate ±1
 * neighbours stay visible (context) so the user can decide to merge; everything else
 * is hidden while a filter is active. Counts are over all line units, filter-independent.
 */
export function computeAnomalyView(
  units: AnomalyInput[],
  filters: AnomalyFilters,
  lang: string | null | undefined,
): AnomalyView {
  const regex = orphanRegexForLang(lang);
  const shortFlags = units.map((u) => u.isLine && u.text.length <= SHORT_SEGMENT_MAX_LEN);
  const orphanFlags = units.map((u) => u.isLine && regex.test(u.text));
  const shortCount = shortFlags.filter(Boolean).length;
  const orphanCount = orphanFlags.filter(Boolean).length;

  const isTarget = units.map(
    (_, i) => (filters.orphan && orphanFlags[i]) || (filters.short && shortFlags[i]),
  );
  const keep = new Set<number>();
  isTarget.forEach((t, i) => {
    if (!t) return;
    keep.add(i);
    if (i > 0) keep.add(i - 1);
    if (i < units.length - 1) keep.add(i + 1);
  });
  const anyFilterActive = filters.short || filters.orphan;

  const rows: AnomalyRow[] = units.map((_, i) => {
    let cls: AnomalyClass = null;
    if (isTarget[i]) {
      cls = filters.orphan && orphanFlags[i] ? "orphan" : "short";
    } else if (keep.has(i)) {
      cls = "context";
    }
    return { cls, visible: !anyFilterActive || keep.has(i) };
  });

  return { rows, shortCount, orphanCount, anyFilterActive };
}
