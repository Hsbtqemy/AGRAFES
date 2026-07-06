/**
 * coarseRegroup.ts — front mirror of the engine's ascendant coarse regrouping
 * (R5.4c/B, coarse_grain.resolve_coarse_boundary / regroup_by_boundary). Lets the
 * canvas preview how the current line units would group into coarse blocks (Tours)
 * *before* POST /segment/coarse persists it. Keep byte-for-byte equivalent to the
 * Python side.
 *
 * Pure: no DOM, no sidecar. The engine matches with Python `re.match` (anchored at the
 * start of the text); JS `RegExp.test` matches anywhere, so we emulate the anchor via
 * `exec().index === 0` — otherwise a custom pattern without `^` would diverge.
 */

/** Built-in coarse boundary presets (mirror of coarse_grain._COARSE_PRESETS). */
const COARSE_PRESETS: Record<string, string> = {
  tours: "^\\s*[—–]", // a dialogue turn opens with an em (—) or en (–) dash
};

/** Cap custom pattern length, mirroring coarse_grain._MAX_PATTERN_LEN (audit QRY-06). */
const MAX_PATTERN_LEN = 500;

/** Resolve a coarse boundary regex from a built-in preset or a custom pattern. A non-empty
 *  `pattern` wins over `preset` (default `tours`). Throws on unknown preset / bad / overlong regex. */
export function resolveCoarseBoundary(
  preset?: string | null,
  pattern?: string | null,
): RegExp {
  if (pattern != null && pattern.trim()) {
    if (pattern.length > MAX_PATTERN_LEN) {
      throw new Error(`Motif trop long (${pattern.length} car., max ${MAX_PATTERN_LEN}).`);
    }
    try {
      return new RegExp(pattern);
    } catch (e) {
      throw new Error(`Motif invalide : ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const name = (preset ?? "tours").trim().toLowerCase();
  const src = COARSE_PRESETS[name];
  if (!src) {
    throw new Error(`Préréglage inconnu : ${name}. Utilisez : ${Object.keys(COARSE_PRESETS).join(", ")}.`);
  }
  return new RegExp(src);
}

/** Python `re.match` semantics (anchored at position 0), not JS `test` (anywhere). */
function matchesAtStart(boundary: RegExp, text: string): boolean {
  const m = boundary.exec(text);
  return m !== null && m.index === 0;
}

export interface CoarseUnit {
  n: number;
  text: string;
  isLine: boolean;
}

export interface CoarseBlock {
  /** parent_n the block's members will receive = the n of its first line. */
  anchorN: number;
  memberNs: number[];
}

/**
 * Group line units into coarse blocks by boundary starts (mirror of regroup_by_boundary).
 * A line whose text matches `boundary` opens a new block; the first line always opens one;
 * structure units are ignored. Returns the ordered blocks (for the preview render).
 */
export function regroupByBoundary(units: CoarseUnit[], boundary: RegExp): CoarseBlock[] {
  const lines = units.filter((u) => u.isLine).slice().sort((a, b) => a.n - b.n);
  const blocks: CoarseBlock[] = [];
  let cur: CoarseBlock | null = null;
  lines.forEach((u, i) => {
    if (i === 0 || cur === null || matchesAtStart(boundary, u.text)) {
      cur = { anchorN: u.n, memberNs: [] };
      blocks.push(cur);
    }
    cur.memberNs.push(u.n);
  });
  return blocks;
}
