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

// --- QA-06: garde-fou + aperçu à blanc de « Pré-remplir » --------------------
//
// Un seul calcul sert les deux correctifs. Rejouer ici le regroupement que
// `regroup_document_coarse` persistera, le comparer aux paragraphes en place, et rendre
// le compte de ce qui serait défait : ce compte EST l'aperçu à blanc, et il conditionne
// le modalConfirm (même patron que `needsAlignmentConfirm` — on ne demande rien quand il
// n'y a rien à perdre).
//
// Ces fonctions ne bornent RIEN, exactement comme leur miroir Python : c'est l'appelant
// qui passe les unités en portée de texte (`n >= documents.text_start_n`). Le lui laisser
// est délibéré — mais c'est aussi le piège que la divergence aperçu↔apply de septembre a
// refermé, donc : appelant non borné = aperçu faux.

/** A line unit plus its **stored** `meta_json.parent_n` (null = no explicit anchor). */
export interface CoarseAnchoredUnit extends CoarseUnit {
  parentN: number | null;
}

/** What a regrouping would do to the document. */
export interface CoarseRegroupPreview {
  /** Coarse blocks the boundary yields (mirror of the response's `blocks`). */
  blocks: number;
  /** Line units the regrouping covers (mirror of `units_grouped`). */
  unitsGrouped: number;
  /** Line units whose stored `parent_n` would be written (mirror of `units_changed`). */
  unitsChanged: number;
  /** Multi-segment paragraphs currently in place — the work that exists. */
  paragraphsTotal: number;
  /** Those the regrouping would not reproduce — the boundaries actually lost. */
  paragraphsLost: number;
  /** Segments living in those lost paragraphs — the span of text affected. */
  segmentsAffected: number;
}

/**
 * The document's paragraphs as they stand: effective anchor (`parentN ?? n`) → its members.
 *
 * **A lone segment is not a paragraph.** Same `size > 1` rule the engine applies twice — in
 * `toggle_paragraph_boundary` ("a paragraph boundary is the start of a multi-segment block;
 * a lone segment is not one") and in `_blocks_anchored`, which demotes a one-member
 * `sentence-grouped` block back to a plain `line`.
 *
 * Measured on the live base, this rule is what separates paragraph work from its absence:
 * `Beigbeder-Francs_EN` carries a `parent_n` on all 1267 of its units, every one equal to
 * the unit's own `n` — 1267 anchors, **zero** paragraphs. Counting anchors instead would
 * announce 1266 segments lost where nothing is grouped with anything.
 *
 * Inherits the engine's documented v1 limit: a deliberate ONE-segment paragraph is
 * indistinguishable from an ungrouped singleton, so it does not count here either.
 */
export function currentParagraphs(units: CoarseAnchoredUnit[]): Map<number, number[]> {
  const byAnchor = new Map<number, number[]>();
  for (const u of units.filter((x) => x.isLine).slice().sort((a, b) => a.n - b.n)) {
    const anchor = u.parentN != null ? u.parentN : u.n;
    const members = byAnchor.get(anchor);
    if (members) members.push(u.n);
    else byAnchor.set(anchor, [u.n]);
  }
  for (const [anchor, members] of byAnchor) {
    if (members.length < 2) byAnchor.delete(anchor);
  }
  return byAnchor;
}

/**
 * Replay the engine's regrouping and diff it against the paragraphs in place.
 *
 * `unitsChanged` mirrors the engine's own write count: `regroup_document_coarse` skips a
 * unit whose stored `parent_n` already **equals** the target (raw comparison, not the
 * effective-anchor one `set_paragraph_boundary_document` uses). It is what the engine will
 * write — not what the user loses, which is `paragraphsLost`.
 *
 * A paragraph **survives** iff some new block holds exactly its members. Absorbed into a
 * larger block, or split, it is gone either way: what is lost is the boundary.
 */
export function previewCoarseRegroup(
  units: CoarseAnchoredUnit[],
  boundary: RegExp,
): CoarseRegroupPreview {
  const blocks = regroupByBoundary(units, boundary);
  const assign = new Map<number, number>();
  for (const b of blocks) for (const n of b.memberNs) assign.set(n, b.anchorN);

  let unitsChanged = 0;
  for (const u of units) {
    if (!u.isLine) continue;
    const target = assign.get(u.n);
    if (target === undefined || u.parentN === target) continue; // idempotent, comme le moteur
    unitsChanged++;
  }

  const survivors = new Set(blocks.map((b) => b.memberNs.join(",")));
  let paragraphsLost = 0;
  let segmentsAffected = 0;
  const paragraphs = currentParagraphs(units);
  for (const members of paragraphs.values()) {
    if (survivors.has(members.join(","))) continue;
    paragraphsLost++;
    segmentsAffected += members.length;
  }

  return {
    blocks: blocks.length,
    unitsGrouped: assign.size,
    unitsChanged,
    paragraphsTotal: paragraphs.size,
    paragraphsLost,
    segmentsAffected,
  };
}

/** Decision of the guard: whether to ask, and the blank preview to show while asking. */
export interface CoarseRegroupGuard {
  /** Open a `modalConfirm` before POSTing? */
  confirm: boolean;
  /** The message to show — the counted preview itself. Empty when `confirm` is false. */
  message: string;
  /** The counts, or null when the boundary could not be resolved here. */
  preview: CoarseRegroupPreview | null;
}

const plural = (n: number): string => (n > 1 ? "s" : "");

/** Closing lines shared by both branches: the gesture is undoable (Mode A, `set_paragraph`
 *  — the route records a snapshot before writing), then the question itself. */
const UNDO_LINE = "« Annuler » (↶) rend le geste.\nContinuer ?";

/**
 * Should « Pré-remplir » ask first, and what should it say?
 *
 * Fires only when a paragraph **actually in place** would be undone: on a document with no
 * paragraph work there is nothing to lose, and asking would be noise (the conditional-guard
 * rule this codebase applies to resegmentation and propagation). Measured on the live base:
 * 5 of 58 documents would ask.
 *
 * Failing to compile the pattern here is **not** a reason to stay silent: the engine's regex
 * flavour is not this one (`(?P<x>…)` compiles in Python, not in JS), so a pattern we cannot
 * read may still write. We then fall back to the one thing that needs no regex — how many
 * paragraphs are in place — and ask if there are any. The engine stays the authority on
 * whether the pattern is valid; it answers 400 if it is not.
 */
export function coarseRegroupGuard(
  units: CoarseAnchoredUnit[],
  opts: { preset?: string | null; pattern?: string | null } = {},
): CoarseRegroupGuard {
  let preview: CoarseRegroupPreview | null = null;
  try {
    preview = previewCoarseRegroup(units, resolveCoarseBoundary(opts.preset, opts.pattern));
  } catch {
    preview = null; // motif illisible ici — le moteur tranchera
  }

  if (preview === null) {
    const total = currentParagraphs(units).size;
    if (total === 0) return { confirm: false, message: "", preview: null };
    return {
      confirm: true,
      preview: null,
      message:
        `Ce motif ne peut pas être vérifié ici, et ce document a ${total} paragraphe${plural(total)} `
        + `déjà en place : impossible de dire lesquels « Pré-remplir » déferait.\n`
        + UNDO_LINE,
    };
  }

  if (preview.paragraphsLost === 0) return { confirm: false, message: "", preview };

  const { paragraphsLost: lost, paragraphsTotal: total, segmentsAffected: seg, blocks } = preview;
  return {
    confirm: true,
    preview,
    message:
      `« Pré-remplir » redécouperait ce document en ${blocks} tour${plural(blocks)}.\n`
      + `Il déferait ${lost} paragraphe${plural(lost)} sur ${total} — ${seg} segment${plural(seg)} `
      + `concerné${plural(seg)}, dont les frontières ¶ seront perdues.\n`
      + UNDO_LINE,
  };
}

