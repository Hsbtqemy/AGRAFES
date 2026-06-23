/**
 * ADR-043 P3 — recover the verbatim import original of a line unit.
 *
 * `text_source` holds the text exactly as imported; `text_raw` holds the
 * current verbatim text, which a destructive op (resegment / merge / split)
 * may have rewritten. A line carries a *recoverable* import original only when
 * the two differ — and they are compared at the **verbatim level** (`text_raw`),
 * never against the normalised `text_norm` (which differs on every curated line
 * and would false-positive).
 *
 * `text_source` is null for lines imported before the column existed and for
 * units that were never touched destructively (it equals `text_raw` at import),
 * so both cases correctly yield `false`.
 */
export interface ImportOriginalLine {
  text_raw?: string | null;
  text_source?: string | null;
}

export function hasImportOriginal(line: ImportOriginalLine): boolean {
  return line.text_source != null && line.text_source !== line.text_raw;
}
