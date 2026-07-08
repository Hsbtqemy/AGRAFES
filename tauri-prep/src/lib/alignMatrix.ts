/**
 * alignMatrix.ts — pure view-model for the source-anchored matrix grid (R3.3 tranche 2,
 * docs/DESIGN_alignment_workspace §2/§6). Turns the raw `/align/matrix` projection
 * (headers/rows/languages) into a per-cell structure that flags the cells "à réparer" (⚠)
 * and computes a completeness metric — so the read-only grid can render « X/Y alignés · Z à
 * réparer » (D-W5) without any DOM or IO here.
 *
 * v1 warning heuristics (read-only, no engine round-trip):
 *   - **empty**  : the translation cell is blank → omission / not-yet-aligned (∅).
 *   - **fused**  : the cell repeats the *same non-empty text* as the row above in the same
 *                  column → a translation that fused two hub segments (the uncut 2-1 case;
 *                  exactly the duplicated-EN17 shape). Resolvable later by « ✂ Couper ».
 * A `non_traduit` *voulu* is not distinguishable from a plain omission yet (that is D-W8),
 * so both read as `empty` for now.
 */

import type { AlignMatrix } from "./sidecarClient.ts";

export type CellStatus = "ok" | "empty" | "fused";

export interface MatrixCellView {
  lang: string;
  text: string;
  status: CellStatus;
}

export interface MatrixRowView {
  /** Coarse paragraph frame (¶) — may be "" when the hub unit carries no parent_n. */
  paragraph: string;
  /** 1-based hub segment index (the row's `segment` column). */
  segment: number;
  hubText: string;
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
  rows: MatrixRowView[];
  stats: MatrixStats;
}

function _cellText(value: string | number | undefined): string {
  return value == null ? "" : String(value);
}

/** Build the grid view-model from a raw `/align/matrix` payload. Pure. */
export function buildMatrixView(data: AlignMatrix): MatrixView {
  const languages = data.languages ?? [];
  const hubLang = languages[0] ?? "";
  const translationLangs = languages.slice(1);
  // headers = ["paragraphe", "segment", hubLang, ...translationLangs]; translation cells
  // start at column index 3 (after paragraphe, segment, hub).
  const TRANS_COL_OFFSET = 3;

  const rows: MatrixRowView[] = [];
  const prevByLang: string[] = translationLangs.map(() => "");
  let prevParagraph: string | null = null;
  let warningCells = 0;

  for (const raw of data.rows ?? []) {
    const paragraph = _cellText(raw[0]);
    const segment = Number(raw[1]) || 0;
    const hubText = _cellText(raw[2]);

    const cells: MatrixCellView[] = translationLangs.map((lang, i) => {
      const text = _cellText(raw[TRANS_COL_OFFSET + i]);
      let status: CellStatus;
      if (text.trim() === "") {
        status = "empty";
      } else if (text === prevByLang[i]) {
        status = "fused";
      } else {
        status = "ok";
      }
      prevByLang[i] = text;
      if (status !== "ok") warningCells++;
      return { lang, text, status };
    });

    rows.push({
      paragraph,
      segment,
      hubText,
      cells,
      hasWarning: cells.some((c) => c.status !== "ok"),
      paragraphStart: paragraph !== prevParagraph,
    });
    prevParagraph = paragraph;
  }

  const totalCells = rows.length * translationLangs.length;
  const completionPct =
    totalCells === 0 ? 100 : Math.round(((totalCells - warningCells) / totalCells) * 100);

  return {
    hubLang,
    translationLangs,
    rows,
    stats: { totalCells, warningCells, completionPct },
  };
}

/** One-line completeness summary for the header strip (D-W5). */
export function matrixSummaryLine(view: MatrixView): string {
  const { totalCells, warningCells, completionPct } = view.stats;
  const ok = totalCells - warningCells;
  return `${ok}/${totalCells} cellules alignées · ${warningCells} à réparer · ${completionPct}%`;
}
