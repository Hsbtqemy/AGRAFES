/**
 * segmentBadge.ts — quel numéro un lien d'alignement affiche (ALI-24, contrat 1.6.76).
 *
 * Le badge `[§N]` doit nommer le segment comme la MATRICE le nomme. `external_id` ne le
 * fait pas : ce n'est pas un numéro de segment mais **la clé qui a apparié**, le marqueur
 * `[N]` du pivot ou sa position `n` selon la stratégie — et un même run mélange les deux.
 * Le moteur calcule donc le vrai rang et le rend dans `pivot_segment`.
 *
 * La règle de repli a **trois** cas, et c'est pourquoi elle vit ici plutôt que recopiée
 * dans chaque écran :
 *
 * - `pivot_segment` présent → on l'affiche, toujours ;
 * - `pivot_segment` ABSENT → sidecar antérieur à 1.6.76 : il n'y a que l'ancien champ, et
 *   un numéro parfois faux vaut mieux qu'une liste sans numéros ;
 * - `pivot_segment` à `null` → le moteur répond « ce pivot n'a pas de rang » (il n'est pas
 *   une ligne). Retomber alors sur `external_id` afficherait un numéro qu'on SAIT faux.
 *
 * Un `??` confondrait les deux derniers cas.
 */

export interface SegmentNumbered {
  pivot_segment?: number | null;
  external_id?: number | null;
}

/** Le numéro à afficher, ou `null` s'il n'y en a pas. */
export function segmentOf(lk: SegmentNumbered): number | null {
  if (lk.pivot_segment !== undefined) return lk.pivot_segment;
  return lk.external_id ?? null;
}

/** `[§N]`, ou `""` quand le lien n'a pas de numéro. Le texte est déjà sûr : le numéro
 *  est passé par `Number`, donc aucune chaîne d'origine serveur n'atteint le HTML. */
export function segmentBadge(lk: SegmentNumbered): string {
  const n = segmentOf(lk);
  return n == null ? "" : `[§${Number(n)}]`;
}
