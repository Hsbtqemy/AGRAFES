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

export type SegSurface = "brut" | "phrases" | "balises" | "custom";

/** State of the "Personnalisé" controls (R5.4b-2). Kept here so buildSegmentParams
 *  is total over every surface even though b-1 only wires phrases/balises. */
export interface CustomSpecState {
  /** Selected terminator chunks, e.g. [".!?", ";:"] — joined into the spec's char set. */
  terminators: string[];
  requireUppercase: boolean;
  /** "Mots" quick start → whitespace kind (terminators ignored). */
  wordMode: boolean;
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
  if (surface === "brut") return {}; // "Brut" is the current state — no segmentation is requested.
  if (surface === "phrases") return { preset: "phrases" };
  if (surface === "balises") return { preset: "balises" };
  const c = custom ?? { terminators: [".!?"], requireUppercase: true, wordMode: false };
  if (c.wordMode) return { spec: { kind: "whitespace", label: "mots" } };
  return {
    spec: {
      kind: "terminator",
      terminators: c.terminators.join(""),
      require_uppercase_after: c.requireUppercase,
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
  return "Terminateurs et mots au choix.";
}
