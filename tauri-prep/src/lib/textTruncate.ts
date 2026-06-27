/**
 * textTruncate.ts — middle-truncate helper, deduped from familyView /
 * UnitInspectorPanel / CorpusAuditPanel / MetadataScreen (U-02). Pure, no DOM.
 */

/** Middle-truncate long titles: "Lorem ipsum…sit amet" — preserves start and end. */
export function truncateMid(text: string, maxChars = 42): string {
  if (!text || text.length <= maxChars) return text;
  const tail = Math.max(8, Math.floor(maxChars * 0.35));
  const head = maxChars - tail - 1; // 1 for the ellipsis
  return text.slice(0, head) + "…" + text.slice(-tail);
}
