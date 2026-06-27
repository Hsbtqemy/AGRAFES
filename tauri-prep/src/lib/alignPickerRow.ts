/**
 * alignPickerRow.ts — pure HTML builder for the retarget candidate-picker row,
 * extracted from AlignPanel._pickerRowHtml (U-02). The impure part (computing the
 * already-linked conflict set from the host's audit/family link arrays) stays in
 * the host wrapper, which passes the precomputed Set + candidates in here.
 *
 * NOTE: AlignPanel._activateRetarget has a SEPARATE inline candidate renderer with
 * a SHORTER conflict tooltip ("Déjà lié à ce pivot" vs this one's longer variant);
 * the two have drifted, so they are deliberately NOT merged here (would change
 * behavior). See AlignPanel for that path.
 */

import { escHtml as _esc } from "./diff.ts";
import type { RetargetCandidate } from "./sidecarClient.ts";

export interface PickerRowOptions {
  pivotUnitId: number;
  pivotText: string;
  asTableRow: boolean;
  /** null = candidates still loading. */
  candidates: RetargetCandidate[] | null;
  /** target_unit_ids already linked to this pivot (conflict set). */
  alreadyLinked: Set<number>;
}

export function buildPickerRowHtml(opts: PickerRowOptions): string {
  const { pivotUnitId, pivotText, asTableRow, candidates, alreadyLinked } = opts;
    let content: string;
    if (candidates === null) {
      content = `<span class="prep-align-picker-loading">&#8230; chargement des candidats</span>`;
    } else if (candidates.length === 0) {
      content = `<span class="prep-align-picker-empty">Aucun candidat trouv&#233;.</span>`;
    } else {
      content = candidates.map(c => {
        const conflict = alreadyLinked.has(c.target_unit_id);
        return `<button class="prep-align-picker-cand${conflict ? " prep-align-picker-cand--conflict" : ""}"
          data-uid="${c.target_unit_id}"
          title="${conflict ? "Déjà lié à ce pivot — sélectionner supprimera le lien existant" : `score ${c.score.toFixed(2)} — ${_esc(c.reason)}`}"
          ${conflict ? 'data-conflict="1"' : ""}>
          <span class="prep-align-picker-cand-ext">[§${_esc(String(c.external_id ?? "?"))}]</span>
          <span class="prep-align-picker-cand-text">${_esc(c.target_text.slice(0, 120))}</span>
          <span class="prep-align-picker-cand-score">${conflict ? "⚠ déjà lié" : `${(c.score * 100).toFixed(0)}%`}</span>
        </button>`;
      }).join("");
    }
    const rowRole = asTableRow ? ' role="row"' : "";
    const cellRole = asTableRow ? ' role="cell"' : "";
    return `<div class="prep-align-picker-row" data-picker-for="${pivotUnitId}"${rowRole}>
      <div class="prep-align-picker-header"${cellRole}>
        <span>&#9997; Recibler : <em>${_esc(pivotText.slice(0, 60))}</em></span>
        <button class="btn btn-ghost btn-sm prep-align-picker-cancel" data-pivot-uid="${pivotUnitId}" title="Annuler">&#10005;</button>
      </div>
      <div class="prep-align-picker-candidates" id="picker-cands-${pivotUnitId}"${cellRole}>${content}</div>
    </div>`;
}
