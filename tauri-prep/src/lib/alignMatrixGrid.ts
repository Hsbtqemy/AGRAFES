/**
 * alignMatrixGrid.ts — pure HTML builder for the matrix grid (R3.3 tranches 2c/3b/D-W12/
 * D-W8·D8·D-W14). Turns a `MatrixView` (lib/alignMatrix) into an escaped `<table>`: hub
 * column + one column per translation, each cell tagged by status (ok / empty ∅ / fused ⚠ /
 * non_traduit). A fused cell carries a « ✂ Couper » button; every other non-empty cell
 * carries the on-demand « ✂ » (D-W12 — the ⚠ prioritizes attention, it does not gate the
 * gestures; hover-revealed by CSS). With the status axes (sidecar ≥ 1.6.56): an empty cell
 * offers « ∅ » (mark non traduit), a per-cell mark offers its undo, a flux addition row
 * (D8) renders `[ajout]` with its « ↺ », and each column header carries the « N hors
 * matrice » badge opening the uncovered-units panel (D-W14). T6.2 (D-P2) — every linked
 * cell also carries a « 🔎 » that hands its link off to the « Révision fine » (pair-scoped
 * status/collision/quality review), pre-loaded on hub ↔ column and scrolled to the link.
 * Buttons address their cell via `data-cut-row`/`data-cut-col` (indices into the SAME view
 * that renders — resolution goes through the view-model, never through parallel raw
 * arrays). All corpus text is escaped (imported documents are untrusted).
 * Injected via the safe `setHtml(raw(...))` sink.
 */

import { escHtml as _esc } from "./diff.ts";
import type { MatrixView } from "./alignMatrix.ts";

export function buildMatrixGridHtml(view: MatrixView): string {
  const transTh = view.translationLangs.map((l, i) => {
    const orphans = view.uncovered[i]?.length ?? 0;
    // D-W14 — the only surface where an unlinked unit is visible/actionable.
    const badge = view.hasStatuses && orphans > 0
      ? ` <button type="button" class="prep-matrix-uncovered-btn" data-uncovered-col="${i}"`
        + ` title="${orphans} unité(s) de cette traduction ne sont couvertes par aucun lien — ouvrir la liste">`
        + `${orphans} hors matrice</button>`
      : "";
    return `<th class="prep-matrix-th">${_esc(l)}${badge}</th>`;
  }).join("");
  const thead =
    `<thead><tr>`
    + `<th class="prep-matrix-th prep-matrix-th--meta">&#182;</th>`
    + `<th class="prep-matrix-th prep-matrix-th--meta">seg</th>`
    + `<th class="prep-matrix-th prep-matrix-th--hub">${_esc(view.hubLang)}</th>`
    + transTh
    + `</tr></thead>`;

  const body = view.rows.map((r, rowIdx) => {
    if (r.addition) {
      // Flux addition row (D8): translator-added unit, no hub segment. The ↺ lives in
      // the addition's OWN column, resolved by doc_id — never by "the cell that has
      // text": an ajout unit whose text is empty would then render a row with no undo
      // at all, making the gesture irreversible from the grid (revue R6b).
      const addCol = view.translationDocIds.indexOf(r.addition.docId);
      const cells = r.cells.map((c, colIdx) => {
        if (colIdx !== addCol) return `<td class="prep-matrix-cell prep-matrix-cell--blank"></td>`;
        const undoBtn =
          ` <button type="button" class="prep-matrix-unadd-btn" data-add-row="${rowIdx}"`
          + ` title="Retirer la marque d&#39;ajout — l&#39;unité redevient non couverte">&#8635;</button>`;
        return `<td class="prep-matrix-cell prep-matrix-cell--addition">${_esc(c.text)}${undoBtn}</td>`;
      }).join("");
      return `<tr class="prep-matrix-row prep-matrix-row--addition">`
        + `<td class="prep-matrix-meta"></td>`
        + `<td class="prep-matrix-meta">&#65291;</td>`
        + `<td class="prep-matrix-hub"><span class="prep-matrix-ajout" title="Ajout du traducteur — pas de segment source (D8)">[ajout]</span></td>`
        + cells
        + `</tr>`;
    }

    const cells = r.cells.map((c, colIdx) => {
      // D-W13 — cell ↺ on any cell whose links carry a cut (hover-revealed):
      // « cette traduction redevient entière » (clears + deletes the manual links).
      const uncutBtn = view.hasCellLinks && c.links.some((l) => l.char_start != null)
        ? ` <button type="button" class="prep-matrix-uncut-btn" data-cut-row="${rowIdx}" data-cut-col="${colIdx}"`
          + ` title="Annuler la coupe — cette traduction redevient entière">&#8635;</button>`
        : "";
      // D-W18 — ✕ retirer une traduction parasite de la cellule (rejet réversible), le
      // primitif qu'aucun autre geste ne couvre (partage ⚠ faux, lien en trop).
      const removeBtn = view.hasCellLinks && c.links.length > 0
        ? ` <button type="button" class="prep-matrix-remove-btn" data-cut-row="${rowIdx}" data-cut-col="${colIdx}"`
          + ` title="Retirer une traduction de cette cellule (rejet réversible)">&#10005;</button>`
        : "";
      // T6.2 (D-P2) — « → Révision fine » : renvoyer le lien de cette cellule vers l'ancien
      // AlignPanel (mode secondaire), pré-chargé sur la paire moyeu ↔ doc-colonne et scrollé
      // sur ce lien. La matrice délègue déjà par MESSAGE (collision ≥ 2, rejet, 409) ; ici le
      // lien devient CLIQUABLE — la revue statut/collisions/qualité vit là-bas, pas ici.
      const reviewBtn = view.hasCellLinks && c.links.length > 0
        ? ` <button type="button" class="prep-matrix-review-btn" data-cut-row="${rowIdx}" data-cut-col="${colIdx}"`
          + ` title="Réviser ce lien dans le Contrôle (statut, collisions, qualité)">&#128269;</button>`
        : "";
      // D-W19 — ＝ rattacher / re-cibler : le geste CONSTRUCTIF (inverse de ✕). Sur une
      // cellule vide → créer un lien ; sur un lien unique ENTIER → le re-cibler. Un lien COUPÉ
      // est exclu (revue G4 : le retarget garderait la fenêtre périmée → mauvaise tranche ; ↺
      // d'abord) ; une cellule à ≥ 2 liens aussi (la machinerie retarget suppose un lien).
      const attachBtn = view.hasCellLinks && r.hubUnitId != null
        && c.links.length <= 1 && c.links.every((l) => l.char_start == null)
        ? ` <button type="button" class="prep-matrix-attach-btn" data-cut-row="${rowIdx}" data-cut-col="${colIdx}"`
          + ` title="Rattacher / re-cibler — poser la bonne traduction pour ce segment">&#61;</button>`
        : "";
      let inner: string;
      let statusCls: string = c.status;
      if (c.status === "non_traduit") {
        // D10 — the deliberate omission token; per-cell marks (D-W8) undo from the
        // cell, a hub-global mark (marker-lift) is managed source-side.
        const clearBtn = c.nonTraduitAxis === "cell"
          ? ` <button type="button" class="prep-matrix-nt-btn" data-nt-action="clear" data-cut-row="${rowIdx}" data-cut-col="${colIdx}"`
            + ` title="Retirer la marque « non traduit » de cette cellule">&#8635;</button>`
          : "";
        const axisTitle = c.nonTraduitAxis === "hub"
          ? "Non traduit (voulu) — posé globalement sur le segment source (marqueurs)"
          : "Non traduit (voulu) — posé sur cette cellule";
        inner = `<span class="prep-matrix-nt" title="${axisTitle}">[non traduit]</span>${clearBtn}`;
        statusCls = "non-traduit";
      } else if (c.status === "empty") {
        // ∅ gesture (D-W8): mark this pair as deliberately untranslated — only when
        // the sidecar carries the status axes and the row resolves to a hub unit.
        // A cell can read « empty » while HOLDING links (a cut window that slices to
        // nothing): the server 409s such a mark, so do not offer it (revue R6a).
        const ntBtn = view.hasStatuses && r.hubUnitId != null && c.links.length === 0
          ? ` <button type="button" class="prep-matrix-nt-btn" data-nt-action="set" data-cut-row="${rowIdx}" data-cut-col="${colIdx}"`
            + ` title="Marquer « non traduit » (voulu) — la cellule compte comme faite">&#8709; non traduit</button>`
          : "";
        // An EMPTY cell must keep the ⭙ too (revue T3): a merge empties the neighbour,
        // and « réversible — ⭙ dans l'autre sens » is only true if the emptied cell can
        // absorb the sentence back. resolveCellMerge already tolerates an empty cell.
        const mergeBackBtn = view.hasCellLinks && r.hubUnitId != null
          ? ` <button type="button" class="prep-matrix-merge-btn" data-cut-row="${rowIdx}" data-cut-col="${colIdx}"`
            + ` title="Fusionner — reprendre la phrase du segment voisin dans CE segment">&#8857;</button>`
          : "";
        // Revue G5 — une cellule « empty » peut PORTER un lien (fenêtre coupée qui tranche à
        // vide) : sans ↺/✕ ici, ce lien serait inannulable et irretirable (uncutBtn/removeBtn
        // se gardent seuls sur les liens, donc no-op sur une cellule réellement vide).
        inner = `<span class="prep-matrix-empty" title="Aucune traduction alignée">&#8709;</span>${ntBtn}${mergeBackBtn}${attachBtn}${uncutBtn}${removeBtn}`;
      } else if (c.status === "fused") {
        // Tranche 3b — the cut gesture lives on the fused (repeating) cell; its bead
        // pairs this row with the one above, so row 0 (defensive) gets no button.
        const cutBtn = rowIdx > 0
          ? ` <button type="button" class="prep-matrix-cut-btn" data-cut-row="${rowIdx}" data-cut-col="${colIdx}"`
            + ` title="Couper cette traduction fusionnée entre ce segment et le précédent">&#9986; Couper</button>`
          : "";
        inner = `<span class="prep-matrix-warn" title="Traduction fusionnée avec la ligne du dessus (à couper)">&#9888;</span> ${_esc(c.text)}${cutBtn}${uncutBtn}${removeBtn}${reviewBtn}`;
      } else {
        // D-W12 — on-demand straddle cut on any aligned cell (hover-revealed). Only
        // when the payload carries cell_links: the gesture cannot resolve without.
        const anyBtn = view.hasCellLinks && c.links.length > 0
          ? ` <button type="button" class="prep-matrix-cut-any-btn" data-cut-row="${rowIdx}" data-cut-col="${colIdx}"`
            + ` title="Couper à cheval — une partie de cette traduction appartient au segment voisin">&#9986;</button>`
          : "";
        // D-W16 — ⭙ Fusionner: pull the neighbour's sentence into this cell (the
        // inverse of ✂, for a translation segmented more finely than the source).
        const mergeBtn = view.hasCellLinks && r.hubUnitId != null && c.links.length > 0
          ? ` <button type="button" class="prep-matrix-merge-btn" data-cut-row="${rowIdx}" data-cut-col="${colIdx}"`
            + ` title="Fusionner — la phrase du segment voisin appartient à CE segment">&#8857;</button>`
          : "";
        inner = `${_esc(c.text)}${anyBtn}${mergeBtn}${uncutBtn}${removeBtn}${attachBtn}${reviewBtn}`;
      }
      return `<td class="prep-matrix-cell prep-matrix-cell--${statusCls}">${inner}</td>`;
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
