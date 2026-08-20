/**
 * segmentControls.ts — pure logic for the canvas Segmentation layer (R5.4b).
 *
 * The DOM orchestration lives in components/SegmentPane.ts; this module holds the
 * testable pieces: mapping the surface (Phrases | Balises | Personnalisé) to the
 * additive /segment(/preview) params (R5.4a contract 1.6.45), grouping the preview
 * segments by their source unit for the list rendering, and the small derived
 * strings / predicates. No DOM, no sidecar calls.
 */

import type { SegmentPreviewSegment, SegmentSpecInput } from "./sidecarClient.ts";

export type SegSurface = "brut" | "phrases" | "balises" | "custom" | "tours";

/** State of the "Personnalisé" controls (R5.4b-2). Kept here so buildSegmentParams
 *  is total over every surface even though b-1 only wired phrases/balises. */
export interface CustomSpecState {
  /** Selected terminator chunks, e.g. [".!?", ";:"] — joined into the spec's char set. */
  terminators: string[];
  requireUppercase: boolean;
  /** "Mots" quick start → whitespace kind (terminators ignored). */
  wordMode: boolean;
  /** Extra abbreviations to protect, on top of the always-on base filet (M., p., decimals…). */
  abbreviations: string[];
}

/** Language abbreviation packs — mirrors segmenter._PACK_EXTRA_ABBREVIATIONS so the
 *  Personnalisé field can pre-fill the doc's pack (the base filet is server-side & always on). */
const PACK_ABBREVIATIONS: Record<string, string[]> = {
  fr: ["ann", "chap", "env", "etc", "par"],
  en: ["approx", "dept", "misc", "chap"],
};

/** Extra abbreviations to pre-fill for a document language (empty for unknown languages). */
export function defaultAbbreviations(lang: string | null | undefined): string[] {
  const l = (lang ?? "").toLowerCase();
  if (l.startsWith("fr")) return [...PACK_ABBREVIATIONS.fr];
  if (l.startsWith("en")) return [...PACK_ABBREVIATIONS.en];
  return [];
}

/** Parse a free-text abbreviation field (comma/space separated) into a clean token list. */
export function parseAbbreviations(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((s) => s.trim().replace(/\.+$/, "")) // drop a trailing dot the user may type ("cap." → "cap")
    .filter(Boolean);
}

export interface SegmentParams {
  preset?: "phrases" | "balises";
  spec?: SegmentSpecInput;
}

/**
 * Build the additive segmentation params from the surface. Phrases/Balises resolve
 * to a built-in `preset` (the server adds lang/pack); Personnalisé builds a full
 * `spec`. The caller merges in `doc_id` + `lang`.
 */
export function buildSegmentParams(surface: SegSurface, custom?: CustomSpecState): SegmentParams {
  // "Brut" is the current state and "Tours" is a coarse regroup (its own endpoint) — neither
  // requests a fine split.
  if (surface === "brut" || surface === "tours") return {};
  if (surface === "phrases") return { preset: "phrases" };
  if (surface === "balises") return { preset: "balises" };
  const c = custom ?? { terminators: [".!?"], requireUppercase: false, wordMode: false, abbreviations: [] };
  if (c.wordMode) return { spec: { kind: "whitespace", label: "mots" } };
  return {
    spec: {
      kind: "terminator",
      terminators: c.terminators.join(""),
      require_uppercase_after: c.requireUppercase,
      protect_abbreviations: c.abbreviations,
      label: "custom",
    },
  };
}

export interface SegmentGroup {
  source_unit_n: number;
  segments: SegmentPreviewSegment[];
}

/**
 * Group consecutive preview segments by their originating unit, preserving order.
 * The preview is already ordered by source unit then position, so a single pass
 * that breaks a group whenever source_unit_n changes is sufficient.
 */
export function groupSegmentsBySource(segments: SegmentPreviewSegment[]): SegmentGroup[] {
  const groups: SegmentGroup[] = [];
  let cur: SegmentGroup | null = null;
  for (const s of segments) {
    if (!cur || cur.source_unit_n !== s.source_unit_n) {
      cur = { source_unit_n: s.source_unit_n, segments: [] };
      groups.push(cur);
    }
    cur.segments.push(s);
  }
  return groups;
}

/** "N unités → M segments" (French plural agreement). */
export function segmentSummaryLine(unitsInput: number, unitsOutput: number): string {
  const u = `${unitsInput} unité${unitsInput > 1 ? "s" : ""}`;
  const s = `${unitsOutput} segment${unitsOutput > 1 ? "s" : ""}`;
  return `${u} → ${s}`;
}

/** Applying a resegmentation clears alignment — only confirm when there is one to lose. */
export function needsAlignmentConfirm(alignedCount: number | null | undefined): boolean {
  return (alignedCount ?? 0) > 0;
}

/** Short hint shown under the surface control for the chosen mode. */
export function surfaceHint(surface: SegSurface): string {
  if (surface === "brut") return "Le texte actuel, tel qu'il est découpé aujourd'hui (avant transformation).";
  if (surface === "phrases") return "Découpe en phrases (. ! ?), abréviations protégées.";
  if (surface === "balises") return "Découpe sur les marqueurs [N] présents dans le texte.";
  if (surface === "tours") return "Regroupe les unités en tours de parole (tiret de dialogue) — grain grossier, sans re-découper.";
  return "Terminateurs et mots au choix.";
}

/**
 * Auto-split point for the inline split editor (R5.4b-3): cut near the middle, snapping
 * back to the last space before the midpoint so a word isn't broken (mirrors the legacy
 * SegmentationView heuristic). Both halves are trimmed; the user can still edit them.
 */
export function autoSplitText(text: string): { a: string; b: string } {
  const midPoint = Math.ceil(text.length / 2);
  const lastSpace = text.lastIndexOf(" ", midPoint);
  const splitAt = lastSpace > 0 ? lastSpace : midPoint;
  return { a: text.slice(0, splitAt).trim(), b: text.slice(splitAt).trim() };
}

/** Message announcing what a merge/split just did to the document's alignment.
 *
 *  Reported AFTER the gesture, not confirmed before it. The obvious move was to reuse
 *  `needsAlignmentConfirm` on the merge — but that helper takes the DOCUMENT's
 *  `aligned_count`, and a merge only ever destroys the two units' links: on a family of
 *  5 770 links it would have announced « ce document a 5 770 liens, fusionner les
 *  effacera » before destroying two, or none at all. Announcing the wrong magnitude is
 *  the very defect this audit keeps finding elsewhere (audit §11.16).
 *
 *  Silent on 0 (the common case) and on an older sidecar (`undefined`): nothing happened
 *  to the alignment, so there is nothing to say.
 */
export function alignmentLossNote(linksArchived: number | null | undefined): string {
  if (typeof linksArchived !== "number" || linksArchived <= 0) return "";
  const s = linksArchived > 1 ? "s" : "";
  return ` ${linksArchived} lien${s} d’alignement retiré${s} — « Annuler » les rend.`;
}
