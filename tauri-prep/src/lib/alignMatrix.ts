/**
 * alignMatrix.ts — pure view-model for the source-anchored matrix grid (R3.3 tranche 2,
 * docs/DESIGN_alignment_workspace §2/§6). Turns the raw `/align/matrix` projection
 * (headers/rows/languages + identifier fields) into a per-cell structure that flags the
 * cells "à réparer" (⚠) and computes a completeness metric — so the grid can render
 * « X/Y alignés · Z à réparer » (D-W5) without any DOM or IO here.
 *
 * Cell statuses:
 *   - **empty** : the translation cell is blank → omission / not-yet-aligned (∅).
 *   - **fused** : one target unit is shared, uncut, between this row and the row above
 *     (the 2-1 case). With `cell_links` (A2, sidecar ≥ 1.6.54) this is decided on the
 *     link TOPOLOGY — exact; without it we fall back to the v1 text-equality heuristic
 *     (same non-empty text as the row above), which under- and over-detects (revue 3b
 *     A2) and is kept only for older sidecars.
 * A `non_traduit` *voulu* is not distinguishable from a plain omission yet (D-W8),
 * so both read as `empty` for now. D-W12: the ⚠ statuses prioritize attention, they
 * do NOT gate the gestures — the view offers gestures on any cell.
 *
 * Rows and cells carry their identities (hubUnitId, links) so gesture resolution never
 * indexes parallel raw-payload arrays (revue 3b F6) — what renders is what resolves.
 */

import type { AlignMatrix, MatrixCellLink } from "./sidecarClient.ts";

export type CellStatus = "ok" | "empty" | "fused";

export interface MatrixCellView {
  lang: string;
  text: string;
  status: CellStatus;
  /** Links behind this cell (A2) — [] when the sidecar predates cell_links. */
  links: MatrixCellLink[];
}

export interface MatrixRowView {
  /** Coarse paragraph frame (¶) — may be "" when the hub unit carries no parent_n. */
  paragraph: string;
  /** 1-based hub segment index (the row's `segment` column). */
  segment: number;
  hubText: string;
  /** Hub unit behind this row (3a) — null when the sidecar predates hub_unit_ids. */
  hubUnitId: number | null;
  cells: MatrixCellView[];
  /** True when any translation cell is empty or fused. */
  hasWarning: boolean;
  /** True when this row opens a new paragraph vs the previous row (for visual grouping). */
  paragraphStart: boolean;
}

export interface MatrixStats {
  /** Total translation cells (rows × translation languages). */
  totalCells: number;
  warningCells: number;
  /** Cells that are neither empty nor fused, as a 0-100 %. 100 when there are no cells. */
  completionPct: number;
}

export interface MatrixView {
  hubLang: string;
  /** Translation languages only (hub excluded). */
  translationLangs: string[];
  /** Parallel to translationLangs: their doc_ids ([] when the sidecar predates 3a). */
  translationDocIds: number[];
  /** True when the payload carried cell_links (A2) — gestures can resolve cells. */
  hasCellLinks: boolean;
  rows: MatrixRowView[];
  stats: MatrixStats;
}

function _cellText(value: string | number | undefined): string {
  return value == null ? "" : String(value);
}

/** True when the two cells share an UNCUT target unit — the exact (topological) fused test. */
function _sharesUncutTarget(cur: MatrixCellLink[], above: MatrixCellLink[]): boolean {
  return cur.some((l) =>
    l.char_start == null
    && above.some((a) => a.target_unit_id === l.target_unit_id && a.char_start == null));
}

/** Build the grid view-model from a raw `/align/matrix` payload. Pure. */
export function buildMatrixView(data: AlignMatrix): MatrixView {
  const languages = data.languages ?? [];
  const hubLang = languages[0] ?? "";
  const translationLangs = languages.slice(1);
  const translationDocIds = (data.language_doc_ids ?? []).slice(1);
  const hubUnitIds = data.hub_unit_ids ?? null;
  const cellLinks = data.cell_links ?? null;
  const hasCellLinks = cellLinks !== null;
  // headers = ["paragraphe", "segment", hubLang, ...translationLangs]; translation cells
  // start at column index 3 (after paragraphe, segment, hub).
  const TRANS_COL_OFFSET = 3;

  const rows: MatrixRowView[] = [];
  const prevByLang: string[] = translationLangs.map(() => "");
  let prevParagraph: string | null = null;
  let warningCells = 0;

  (data.rows ?? []).forEach((raw, rowIdx) => {
    const paragraph = _cellText(raw[0]);
    const segment = Number(raw[1]) || 0;
    const hubText = _cellText(raw[2]);

    const cells: MatrixCellView[] = translationLangs.map((lang, i) => {
      const text = _cellText(raw[TRANS_COL_OFFSET + i]);
      const links = cellLinks?.[rowIdx]?.[i] ?? [];
      let status: CellStatus;
      if (text.trim() === "") {
        status = "empty";
      } else if (hasCellLinks) {
        const aboveLinks = rowIdx > 0 ? (cellLinks?.[rowIdx - 1]?.[i] ?? []) : [];
        status = _sharesUncutTarget(links, aboveLinks) ? "fused" : "ok";
      } else {
        // Fallback heuristic (pre-A2 sidecar): repeats the row above's non-empty text.
        status = text === prevByLang[i] ? "fused" : "ok";
      }
      prevByLang[i] = text;
      if (status !== "ok") warningCells++;
      return { lang, text, status, links };
    });

    rows.push({
      paragraph,
      segment,
      hubText,
      hubUnitId: hubUnitIds ? (hubUnitIds[rowIdx] ?? null) : null,
      cells,
      hasWarning: cells.some((c) => c.status !== "ok"),
      paragraphStart: paragraph !== prevParagraph,
    });
    prevParagraph = paragraph;
  });

  const totalCells = rows.length * translationLangs.length;
  const completionPct =
    totalCells === 0 ? 100 : Math.round(((totalCells - warningCells) / totalCells) * 100);

  return {
    hubLang,
    translationLangs,
    translationDocIds,
    hasCellLinks,
    rows,
    stats: { totalCells, warningCells, completionPct },
  };
}

/** One-line completeness summary for the header strip (D-W5 — an aid, not a verdict: D-W12). */
export function matrixSummaryLine(view: MatrixView): string {
  const { totalCells, warningCells, completionPct } = view.stats;
  const ok = totalCells - warningCells;
  return `${ok}/${totalCells} cellules alignées · ${warningCells} à réparer · ${completionPct}%`;
}
