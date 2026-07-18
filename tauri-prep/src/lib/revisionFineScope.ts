/**
 * revisionFineScope.ts — contrat du handoff scopé matrice → « Révision fine »
 * (tranche 6 T6.2 ; docs/DESIGN_alignment_parity_tranche6 §2.4b / D-P2).
 *
 * La matrice (`AlignMatrixView`) est FAMILLE-scopée ; l'ancien `AlignPanel`
 * (désormais « Révision fine ») est PAIRE-scopé (sélecteurs pivot/cible). Ce
 * type est la jointure : une cellule (moyeu ↔ doc-colonne, + un lien) devient
 * une paire pré-chargée dans la Révision fine, scrollée sur le lien.
 *
 * Pur (aucun DOM) — le partager ici, plutôt que dans l'un des deux écrans,
 * évite un import croisé screen→screen et le garde testable.
 */
export interface RevisionFineScope {
  /** Document moyeu (pivot) de la famille — = `family_id`
   *  (cf. `AlignPanel._renderFamilyBitext` : `pivotDoc.doc_id === fam.family_id`). */
  pivotDocId: number;
  /** Document de la colonne cible de la cellule. */
  targetDocId: number;
  /** Lien à mettre en évidence (scroll + surbrillance) après chargement de
   *  l'audit de la paire ; absent/null = charger la paire sans cibler de lien
   *  (p. ex. la bascule de barre, qui n'a pas de cellule d'origine). */
  linkId?: number | null;
}
