/**
 * alignMatrixGrid.ts — pure HTML builder for the matrix grid (R3.3 tranches 2c/3b).
 * Turns a `MatrixView` (lib/alignMatrix) into an escaped `<table>`: hub column + one column
 * per translation, each cell tagged by status (ok / empty ∅ / fused ⚠). A fused cell carries
 * a « ✂ Couper » button (`data-cut-row`/`data-cut-col`) that the view wires to the cell-cut
 * picker (lib/alignCellCut). All corpus text is escaped (imported documents are untrusted).
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
        inner = `<span class="prep-matrix-warn" title="Même texte que la ligne du dessus — traduction fusionnée (à couper)">&#9888;</span> ${_esc(c.text)}${cutBtn}`;
      } else {
        inner = _esc(c.text);
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
