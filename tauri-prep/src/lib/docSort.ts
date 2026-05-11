/**
 * docSort.ts — Comparateur pur pour trier des documents par titre.
 *
 * Convention unique pour tout le repo tauri-prep : locale FR, insensible
 * casse + accents, tri secondaire sur doc_id pour la stabilité. Évite la
 * dérive entre call sites (avant : 3 variantes coexistaient — sans options,
 * avec undefined, avec "fr").
 *
 * Aucune dépendance DOM ni I/O. Tests Vitest dans
 * `__tests__/docSort.test.ts`.
 *
 * Invariants protégés par les tests :
 *   1. Insensible casse — "abc" === "ABC" pour le tri primaire.
 *   2. Insensible accents — "élève" === "eleve".
 *   3. Titre null/undefined → comparé comme chaîne vide (vient en tête).
 *   4. Égalité de titre → ordre stable sur doc_id ascendant.
 *   5. numeric:true — "Doc 2" vient avant "Doc 10" pour les fallbacks
 *      générés type `Doc #N`.
 */

export interface DocLike {
  doc_id: number;
  title?: string | null;
}

// Un seul Collator partagé — plus rapide que de recréer une comparaison
// localeCompare à chaque appel sur un sort de N éléments (~N² comparaisons).
const _COLLATOR = new Intl.Collator("fr", {
  sensitivity: "base",
  numeric: true,
});

/**
 * Compare deux docs par titre, locale FR, insensible casse+accents.
 * Tie-breaker stable : doc_id ascendant.
 */
export function compareDocsByTitle<T extends DocLike>(a: T, b: T): number {
  const ta = a.title ?? "";
  const tb = b.title ?? "";
  const cmp = _COLLATOR.compare(ta, tb);
  return cmp !== 0 ? cmp : a.doc_id - b.doc_id;
}

/**
 * Compare deux chaînes via le même Collator (locale FR, sensitivity base,
 * numeric:true). Utilisable pour trier n'importe quel champ string —
 * notamment lang/role/status d'un doc dans une table column-sortable.
 *
 * Null/undefined comparé comme chaîne vide.
 */
export function compareLocale(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  return _COLLATOR.compare(a ?? "", b ?? "");
}
