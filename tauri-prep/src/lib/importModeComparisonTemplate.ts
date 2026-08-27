/**
 * importModeComparisonTemplate.ts — le tableau comparatif des modes d'import (IMPO-01).
 *
 * Pur : pas de DOM, pas d'IO. Construit le HTML à partir de ce que chaque mode fait du
 * fichier, mesuré par un appel `/import/preview` par mode.
 *
 * **Pourquoi un tableau plutôt qu'un garde-fou.** Les deux questions posées au départ —
 * avertir ou refuser ? détecter ou laisser choisir ? — sont dissoutes : l'écran montre ce
 * que *chaque* mode fait du fichier, et l'utilisateur choisit sur pièces. Plus de refus à
 * justifier, plus d'avertissement à lire, aucune connaissance préalable exigée. La
 * détection ne sert plus qu'à **ordonner** et pré-sélectionner ; la justification, c'est la
 * comparaison elle-même.
 *
 * **La colonne qui compte est celle du milieu.** Sur les cas mesurés, les deux modes
 * rendent souvent le *même nombre d'unités* — 48 contre 48 sur un bitexte en tableau — et
 * ne se séparent que sur combien sont indexées. « Trouvables » plutôt qu'« indexables » :
 * c'est ce que l'utilisateur perd s'il se trompe, dit dans ses mots. Le qualificatif
 * « à la recherche » a été retiré le 27 août — il tient dans l'infobulle, et son
 * absence rend la colonne assez étroite pour laisser la largeur à l'extrait.
 */

import { escHtml } from "./diff.ts";
import type { ModeOutcome } from "./importDetect.ts";

/** Ce qu'une ligne du tableau affiche, au-delà des comptes. */
export interface ModeComparisonRow extends ModeOutcome {
  /** Libellé lisible du mode (« Paragraphes », « Lignes numérotées [n] »). */
  label: string;
  /** Première unité extraite, pour juger sur pièces. Vide si le mode ne rend rien. */
  sample: string;
  /** Le mode n'a pas pu être lu (fichier illisible dans ce mode). */
  failed?: boolean;
}

export interface ModeComparisonInput {
  rows: ModeComparisonRow[];
  /** Mode actuellement retenu pour ce fichier. */
  currentMode: string;
  /** Mode recommandé (`pickBestMode`), ou `null` si aucun ne lit le document. */
  bestMode: string | null;
}

const SAMPLE_MAX = 64;

function sampleCell(row: ModeComparisonRow): string {
  if (row.failed) return '<em class="imp-cmp-none">illisible</em>';
  if (!row.sample) return '<em class="imp-cmp-none">rien</em>';
  const s = row.sample.length > SAMPLE_MAX
    ? row.sample.slice(0, SAMPLE_MAX) + "…"
    : row.sample;
  return `<span title="${escHtml(row.sample)}">${escHtml(s)}</span>`;
}

/**
 * Rend le tableau comparatif. Chaque ligne est un bouton : cliquer applique le mode.
 *
 * Quand aucun mode ne rend d'unité indexable, un bandeau le **dit** au lieu de laisser
 * pré-sélectionner le moins mauvais — c'est ainsi qu'un défaut de capacité devient visible
 * plutôt que de se cacher derrière un mauvais choix (le bitexte en tableau sans colonne,
 * ou le `.txt` numéroté « 1. » qui n'a aucun mode pour le lire).
 */
export function buildModeComparisonHtml(input: ModeComparisonInput): string {
  const { rows, currentMode, bestMode } = input;
  if (rows.length === 0) return "";

  const body = rows.map((r) => {
    const isCurrent = r.mode === currentMode;
    const isBest = r.mode === bestMode;
    const cls = [
      "imp-cmp-row",
      isCurrent ? "imp-cmp-row-current" : "",
      r.searchable === 0 ? "imp-cmp-row-empty" : "",
    ].filter(Boolean).join(" ");
    const marque = isBest
      ? ' <span class="imp-cmp-best" title="Le mode qui rend le plus d\'unités indexables">recommandé</span>'
      : "";
    const coche = isCurrent ? '<span class="imp-cmp-check" aria-hidden="true">✓</span> ' : "";
    return `<tr class="${cls}">
      <td><button type="button" class="imp-cmp-pick" data-mode="${escHtml(r.mode)}"
             ${isCurrent ? 'aria-current="true"' : ""}
             title="Utiliser ce mode pour ce fichier">${coche}${escHtml(r.label)}</button>${marque}</td>
      <td class="imp-cmp-num">${r.units}</td>
      <td class="imp-cmp-num imp-cmp-searchable">${r.searchable}</td>
      <td class="imp-cmp-num">${r.units - r.searchable}</td>
      <td class="imp-cmp-sample">${sampleCell(r)}</td>
    </tr>`;
  }).join("");

  const alerte = bestMode === null
    ? '<p class="imp-cmp-nomode">Aucun mode ne lit ce document — aucune unité ne serait '
      + "indexable. S'il s'agit d'un tableau, indiquez une colonne ; sinon, "
      + "le format n'a pas encore de mode d'import qui lui convienne.</p>"
    : "";

  return `${alerte}<table class="imp-cmp-table" aria-label="Ce que chaque mode ferait de ce fichier">
    <thead><tr>
      <th>Mode</th><th class="imp-cmp-num">Unités</th>
      <th class="imp-cmp-num" title="Unités que l&rsquo;index de recherche prendra. Elles deviennent trouvables à la réindexation, pas à l&rsquo;import.">Indexables</th>
      <th class="imp-cmp-num">Non indexées</th><th>Première unité</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}
