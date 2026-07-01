/**
 * coarseGrain.ts — Pure grouping of a document's units into coarse-grain blocks
 * (paragraphs) for the canvas, R2.3 of the refonte deux-grains.
 *
 * Front mirror of the engine's `coarse_grain.derive_coarse_blocks` (same regimes,
 * same 2-grain rule). Voie A: the coarse grain IS `parent_n` (the paragraph anchor
 * that resegmentation persists, exposed on UnitRecord since API 1.6.35). When a doc
 * is fine-segmented we group its sentences by that anchor; otherwise one line is one
 * coarse block — classifying heading lines/structure units and detecting composite
 * `¤` lines (ADR-002: `¤` is an intra-paragraph separator, so a `¤`-bearing line is a
 * single composite block whose fine cardinality is already known).
 *
 * Intertitres / structure units delimit *sections*, never merge content lines into a
 * paragraph — doing so would fold several ¶ into one block (a hidden 3rd grain).
 *
 * No DOM, no I/O. Tested by __tests__/coarseGrain.test.ts.
 */
import type { UnitRecord } from "./sidecarClient.ts";

/** Roles that mark a heading line (its own coarse block), vs péritext content roles. */
export const STRUCTURAL_ROLES = new Set<string>(["intertitre"]);

export type CoarseKind = "sentence-grouped" | "composite" | "line" | "heading";

export interface CoarseBlock {
  /** Coarse key: parent_n when fine-segmented, else the line's own n. */
  anchorN: number;
  /** unit_ids of the block's members, in reading order (a render handle). */
  memberUids: number[];
  /** ns of the block's *line* members (structure headings contribute none). */
  memberNs: number[];
  /** Fine units this block resolves to: sentences grouped, or ¤ pieces, or 1. */
  fineCount: number;
  kind: CoarseKind;
  /** Structural role when the block is a heading; null otherwise. */
  role: string | null;
}

const SEP = "¤";

function countSep(text: string | null | undefined): number {
  if (!text) return 0;
  let c = 0;
  for (const ch of text) if (ch === SEP) c++;
  return c;
}

/**
 * Group a document's units into ordered coarse blocks. Input need not be pre-sorted
 * (normalised by `n`). Two regimes, exactly as the engine:
 *  - *anchored* — some line carries `parent_n`: group by it (fallback: own `n`).
 *  - *derived* — none does: one line is one block; classify headings + `¤`.
 */
export function deriveCoarseBlocks(
  units: UnitRecord[],
  structuralRoles: Set<string> = STRUCTURAL_ROLES,
): CoarseBlock[] {
  const rows = [...units].sort((a, b) => a.n - b.n);
  const anchored = rows.some((u) => u.unit_type === "line" && u.parent_n != null);
  return anchored ? blocksAnchored(rows, structuralRoles) : blocksDerived(rows, structuralRoles);
}

function blocksAnchored(rows: UnitRecord[], structuralRoles: Set<string>): CoarseBlock[] {
  const byAnchor = new Map<number, CoarseBlock>();
  const order: number[] = [];
  for (const u of rows) {
    if (u.unit_type !== "line") continue; // structure units carry no fine content here
    const anchor = u.parent_n != null ? u.parent_n : u.n;
    let b = byAnchor.get(anchor);
    if (!b) {
      const isHeading = u.unit_role != null && structuralRoles.has(u.unit_role);
      b = {
        anchorN: anchor, memberUids: [], memberNs: [], fineCount: 0,
        kind: isHeading ? "heading" : "sentence-grouped",
        role: isHeading ? u.unit_role! : null,
      };
      byAnchor.set(anchor, b);
      order.push(anchor);
    }
    b.memberUids.push(u.unit_id);
    b.memberNs.push(u.n);
    b.fineCount++;
  }
  // A "grouped" block holding a single line is really just a plain line.
  for (const b of byAnchor.values()) {
    if (b.kind === "sentence-grouped" && b.fineCount === 1) b.kind = "line";
  }
  return order.map((a) => byAnchor.get(a)!);
}

function blocksDerived(rows: UnitRecord[], structuralRoles: Set<string>): CoarseBlock[] {
  const blocks: CoarseBlock[] = [];
  for (const u of rows) {
    if (u.unit_type === "structure") {
      blocks.push({
        anchorN: u.n, memberUids: [u.unit_id], memberNs: [], fineCount: 1,
        kind: "heading", role: u.unit_role ?? null,
      });
      continue;
    }
    if (u.unit_role != null && structuralRoles.has(u.unit_role)) {
      blocks.push({
        anchorN: u.n, memberUids: [u.unit_id], memberNs: [u.n], fineCount: 1,
        kind: "heading", role: u.unit_role,
      });
      continue;
    }
    const seps = countSep(u.text_raw);
    blocks.push({
      anchorN: u.n, memberUids: [u.unit_id], memberNs: [u.n], fineCount: seps + 1,
      kind: seps > 0 ? "composite" : "line", role: null,
    });
  }
  return blocks;
}

/** Map every member unit_id to the index of its block (O(1) lookup for rendering). */
export function blockIndexByUnitId(blocks: CoarseBlock[]): Map<number, number> {
  const m = new Map<number, number>();
  blocks.forEach((b, i) => b.memberUids.forEach((uid) => m.set(uid, i)));
  return m;
}
