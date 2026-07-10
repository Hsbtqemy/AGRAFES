/**
 * alignMatrix.ts — pure view-model for the source-anchored matrix grid (R3.3 tranche 2,
 * docs/DESIGN_alignment_workspace §2/§6). Turns the raw `/align/matrix` projection
 * (headers/rows/languages + identifier fields) into a per-cell structure that flags the
 * cells "à réparer" (⚠) and computes a completeness metric — so the grid can render
 * « X/Y alignés · Z à réparer » (D-W5) without any DOM or IO here.
 *
 * Cell statuses:
 *   - **empty** : the translation cell is blank → omission / not-yet-aligned (∅).
 *   - **fused** : one target unit is shared between this row and the row above with
 *     IDENTICAL windows (uncut = [0,len]; a partly-partitioned N-1 keeps its ⚠ on the
 *     still-fused tail — D-W13). With `cell_links` (A2, sidecar ≥ 1.6.54) this is
 *     decided on the link TOPOLOGY — exact; without it we fall back to the v1
 *     text-equality heuristic (same non-empty text as the row above), which under-
 *     and over-detects (revue 3b A2) and is kept only for older sidecars.
 *   - **non_traduit** (D-W8, sidecar ≥ 1.6.56) : deliberately untranslated — the
 *     [non traduit] token (D10), read from BOTH axes (per-cell table or the hub
 *     unit's global unit_status). Counts as DONE (D-W5), not as a hole.
 * Flux **addition rows** (D8: a translation unit with unit_status='ajout', no hub
 * segment) are carried with `addition` set and are EXCLUDED from the stats — their
 * other-language cells are not real cells. D-W12: the ⚠ statuses prioritize attention,
 * they do NOT gate the gestures — the view offers gestures on any cell.
 *
 * Rows and cells carry their identities (hubUnitId, links) so gesture resolution never
 * indexes parallel raw-payload arrays (revue 3b F6) — what renders is what resolves.
 */

import type { AlignMatrix, MatrixCellLink, MatrixUncoveredUnit } from "./sidecarClient.ts";
import { cellsShareFusedTarget } from "./alignCellCut.ts";

export type CellStatus = "ok" | "empty" | "fused" | "non_traduit";

export interface MatrixCellView {
  lang: string;
  text: string;
  status: CellStatus;
  /** Links behind this cell (A2) — [] when the sidecar predates cell_links. */
  links: MatrixCellLink[];
  /** Which axis marked the cell non_traduit: "cell" (per-cell table — clearable from
   *  the cell) or "hub" (global unit_status, whole row — managed source-side). */
  nonTraduitAxis: "cell" | "hub" | null;
}

export interface MatrixRowView {
  /** Coarse paragraph frame (¶) — may be "" when the hub unit carries no parent_n. */
  paragraph: string;
  /** 1-based hub segment index (the row's `segment` column); 0 on addition rows. */
  segment: number;
  hubText: string;
  /** Hub unit behind this row (3a) — null when the sidecar predates hub_unit_ids,
   *  and on flux addition rows (D8 — no hub segment). */
  hubUnitId: number | null;
  /** Set on a flux addition row (D8): the translator-added unit behind it. */
  addition: { docId: number; unitId: number; n: number } | null;
  cells: MatrixCellView[];
  /** True when any translation cell is empty or fused. */
  hasWarning: boolean;
  /** True when this row opens a new paragraph vs the previous row (for visual grouping). */
  paragraphStart: boolean;
}

export interface MatrixStats {
  /** Total translation cells (hub rows × translation languages — addition rows excluded). */
  totalCells: number;
  warningCells: number;
  /** Cells that are neither empty nor fused, as a 0-100 %. 100 when there are no cells. */
  completionPct: number;
  /** D-W14 — units invisible in the grid (no active link, no status), all columns. */
  uncoveredUnits: number;
}

export interface MatrixView {
  hubLang: string;
  /** Translation languages only (hub excluded). */
  translationLangs: string[];
  /** Parallel to translationLangs: their doc_ids ([] when the sidecar predates 3a). */
  translationDocIds: number[];
  /** True when the payload carried cell_links (A2) — gestures can resolve cells. */
  hasCellLinks: boolean;
  /** True when the payload carried the status axes (1.6.56) — ∅/＋ gestures available. */
  hasStatuses: boolean;
  /** Parallel to translationLangs (D-W14): uncovered units per column ([] when absent). */
  uncovered: MatrixUncoveredUnit[][];
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
  const translationDocIds = (data.language_doc_ids ?? []).slice(1);
  const hubUnitIds = data.hub_unit_ids ?? null;
  const cellLinks = data.cell_links ?? null;
  const hasCellLinks = cellLinks !== null;
  const cellStatuses = data.cell_statuses ?? null;
  const hubStatuses = data.hub_unit_statuses ?? null;
  const hasStatuses = cellStatuses !== null;
  const uncovered = translationLangs.map((_l, i) => data.uncovered?.[i] ?? []);
  const additionByRow = new Map<number, { docId: number; unitId: number; n: number }>();
  (data.addition_rows ?? []).forEach((a) => {
    additionByRow.set(a.row, { docId: a.doc_id, unitId: a.unit_id, n: a.n });
  });
  // headers = ["paragraphe", "segment", hubLang, ...translationLangs]; translation cells
  // start at column index 3 (after paragraphe, segment, hub).
  const TRANS_COL_OFFSET = 3;

  const rows: MatrixRowView[] = [];
  const prevByLang: string[] = translationLangs.map(() => "");
  // Fused compares against the previous HUB row's links — an addition row woven
  // between two hub rows must not break the bead detection.
  const prevHubLinks: MatrixCellLink[][] = translationLangs.map(() => []);
  let prevParagraph: string | null = null;
  let warningCells = 0;
  let hubRowCount = 0;

  (data.rows ?? []).forEach((raw, rowIdx) => {
    const paragraph = _cellText(raw[0]);
    const segment = Number(raw[1]) || 0;
    const hubText = _cellText(raw[2]);
    const addition = additionByRow.get(rowIdx) ?? null;

    if (addition) {
      // Flux addition row (D8): only its own-language cell carries content; the
      // other columns are not real cells (no hub segment) — excluded from stats.
      const cells: MatrixCellView[] = translationLangs.map((lang, i) => ({
        lang,
        text: _cellText(raw[TRANS_COL_OFFSET + i]),
        status: "ok" as CellStatus,
        links: [],
        nonTraduitAxis: null,
      }));
      rows.push({
        paragraph,
        segment,
        hubText,
        hubUnitId: null,
        addition,
        cells,
        hasWarning: false,
        paragraphStart: false,
      });
      return;
    }

    hubRowCount++;
    const hubNonTraduit = hubStatuses?.[rowIdx] === "non_traduit";
    const cells: MatrixCellView[] = translationLangs.map((lang, i) => {
      const text = _cellText(raw[TRANS_COL_OFFSET + i]);
      const links = cellLinks?.[rowIdx]?.[i] ?? [];
      const perCell = cellStatuses?.[rowIdx]?.[i] ?? null;
      const nonTraduitAxis: "cell" | "hub" | null =
        links.length > 0 ? null : perCell === "non_traduit" ? "cell" : hubNonTraduit ? "hub" : null;
      let status: CellStatus;
      if (nonTraduitAxis) {
        // D10/D-W5: a deliberate omission displays the token and counts as done.
        status = "non_traduit";
      } else if (text.trim() === "") {
        status = "empty";
      } else if (hasCellLinks) {
        // D-W13: fused = shared target with IDENTICAL windows (uncut being [0,len]) —
        // a partly-partitioned N-1 keeps its ⚠ on the still-fused tail.
        status = cellsShareFusedTarget(links, prevHubLinks[i]) ? "fused" : "ok";
      } else {
        // Fallback heuristic (pre-A2 sidecar): repeats the row above's non-empty text.
        status = text === prevByLang[i] ? "fused" : "ok";
      }
      prevByLang[i] = text;
      prevHubLinks[i] = links;
      if (status === "empty" || status === "fused") warningCells++;
      return { lang, text, status, links, nonTraduitAxis };
    });

    rows.push({
      paragraph,
      segment,
      hubText,
      hubUnitId: hubUnitIds ? (hubUnitIds[rowIdx] ?? null) : null,
      addition: null,
      cells,
      hasWarning: cells.some((c) => c.status === "empty" || c.status === "fused"),
      paragraphStart: paragraph !== prevParagraph,
    });
    prevParagraph = paragraph;
  });

  const totalCells = hubRowCount * translationLangs.length;
  const completionPct =
    totalCells === 0 ? 100 : Math.round(((totalCells - warningCells) / totalCells) * 100);
  const uncoveredUnits = uncovered.reduce((acc, list) => acc + list.length, 0);

  return {
    hubLang,
    translationLangs,
    translationDocIds,
    hasCellLinks,
    hasStatuses,
    uncovered,
    rows,
    stats: { totalCells, warningCells, completionPct, uncoveredUnits },
  };
}

/** One-line completeness summary for the header strip (D-W5 — an aid, not a verdict: D-W12). */
export function matrixSummaryLine(view: MatrixView): string {
  const { totalCells, warningCells, completionPct, uncoveredUnits } = view.stats;
  const ok = totalCells - warningCells;
  const base = `${ok}/${totalCells} cellules alignées · ${warningCells} à réparer · ${completionPct}%`;
  // D-W14 — the completeness line must not lie: surface what the grid cannot show.
  return uncoveredUnits > 0 ? `${base} · ${uncoveredUnits} hors matrice` : base;
}
