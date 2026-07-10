/**
 * alignMatrixGrid.ts — pure HTML builder for the matrix grid (R3.3 tranches 2c/3b/D-W12).
 * Turns a `MatrixView` (lib/alignMatrix) into an escaped `<table>`: hub column + one column
 * per translation, each cell tagged by status (ok / empty ∅ / fused ⚠). A fused cell carries
 * a « ✂ Couper » button; every other non-empty cell carries the on-demand « ✂ » (D-W12 —
 * the ⚠ prioritizes attention, it does not gate the gestures; hover-revealed by CSS).
 * Both buttons address their cell via `data-cut-row`/`data-cut-col` (indices into the
 * SAME view that renders — resolution goes through the view-model, never through parallel
 * raw arrays). All corpus text is escaped (imported documents are untrusted).
 * Injected via the safe `setHtml(raw(...))` sink.
 */

import { escHtml as _esc } from "./diff.ts";
import type { MatrixView } from "./alignMatrix.ts";

export function buildMatrixGridHtml(view: MatrixView): string {
  const thead =
    `<thead><tr>`
    + `<th class="prep-matrix-th prep-matrix-th--meta">&#182;</th>`
    + `<th class="prep-matrix-th prep-matrix-th--meta">seg</th>`
    + `<th class="prep-matrix-th prep-matrix-th--hub">${_esc(view.hubLang)}</th>`
    + view.translationLangs.map((l) => `<th class="prep-matrix-th">${_esc(l)}</th>`).join("")
    + `</tr></thead>`;

  const body = view.rows.map((r, rowIdx) => {
    const cells = r.cells.map((c, colIdx) => {
      // D-W13 — cell ↺ on any cell whose links carry a cut (hover-revealed):
      // « cette traduction redevient entière » (clears + deletes the manual links).
      const uncutBtn = view.hasCellLinks && c.links.some((l) => l.char_start != null)
        ? ` <button type="button" class="prep-matrix-uncut-btn" data-cut-row="${rowIdx}" data-cut-col="${colIdx}"`
          + ` title="Annuler la coupe — cette traduction redevient entière">&#8635;</button>`
        : "";
      let inner: string;
      if (c.status === "empty") {
        inner = `<span class="prep-matrix-empty" title="Aucune traduction alignée">&#8709;</span>`;
      } else if (c.status === "fused") {
        // Tranche 3b — the cut gesture lives on the fused (repeating) cell; its bead
        // pairs this row with the one above, so row 0 (defensive) gets no button.
        const cutBtn = rowIdx > 0
          ? ` <button type="button" class="prep-matrix-cut-btn" data-cut-row="${rowIdx}" data-cut-col="${colIdx}"`
            + ` title="Couper cette traduction fusionnée entre ce segment et le précédent">&#9986; Couper</button>`
          : "";
        inner = `<span class="prep-matrix-warn" title="Traduction fusionnée avec la ligne du dessus (à couper)">&#9888;</span> ${_esc(c.text)}${cutBtn}${uncutBtn}`;
      } else {
        // D-W12 — on-demand straddle cut on any aligned cell (hover-revealed). Only
        // when the payload carries cell_links: the gesture cannot resolve without.
        const anyBtn = view.hasCellLinks && c.links.length > 0
          ? ` <button type="button" class="prep-matrix-cut-any-btn" data-cut-row="${rowIdx}" data-cut-col="${colIdx}"`
            + ` title="Couper à cheval — une partie de cette traduction appartient au segment voisin">&#9986;</button>`
          : "";
        inner = `${_esc(c.text)}${anyBtn}${uncutBtn}`;
      }
      return `<td class="prep-matrix-cell prep-matrix-cell--${c.status}">${inner}</td>`;
    }).join("");

    const rowCls =
      "prep-matrix-row"
      + (r.hasWarning ? " prep-matrix-row--warn" : "")
      + (r.paragraphStart ? " prep-matrix-row--para-start" : "");
    return `<tr class="${rowCls}">`
      + `<td class="prep-matrix-meta">${_esc(String(r.paragraph))}</td>`
      + `<td class="prep-matrix-meta">${r.segment}</td>`
      + `<td class="prep-matrix-hub">${_esc(r.hubText)}</td>`
      + cells
      + `</tr>`;
  }).join("");

  return `<table class="prep-matrix-grid">${thead}<tbody>${body}</tbody></table>`;
}
