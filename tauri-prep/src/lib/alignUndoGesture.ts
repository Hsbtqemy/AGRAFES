/**
 * alignUndoGesture.ts — Ce que le bandeau d'annulation de l'Alignement doit dire.
 *
 * Logique pure, sans DOM ni I/O. Le rendu est dans `components/AlignUndoBanner.ts`,
 * les tests dans `__tests__/alignUndoGesture.test.ts`.
 *
 * Contexte (ALI-20, décision D-3, contrat 1.6.70). Les gestes de l'espace Alignement
 * ne laissaient aucune trace ; le moteur en garde désormais une pile bornée et rend
 * une poignée `op_id`. Ce module décide **quand le bandeau s'arme**, **ce qu'il
 * affiche**, et **ce qu'il dit quand l'annulation est refusée**.
 *
 * Trois règles, chacune apprise d'un cas concret :
 *
 * 1. *On ne s'arme que sur une poignée réelle.* Un sidecar antérieur à 1.6.70 ne rend
 *    pas `op_id` ; un lot entièrement en erreur, un `rolled_back`, ou un lot dont
 *    aucun lien n'existait rendent `null`. Dans tous ces cas le geste n'a rien changé
 *    ou n'est pas défaisable, et un bouton « Annuler » mentirait.
 * 2. *Le bandeau est lié à une famille.* Un bandeau destructif qui survit à un
 *    changement d'entité décrit la mauvaise chose — c'est la critique qu'avait
 *    récoltée le seul lot de la refonte à l'avoir oublié.
 * 3. *Un refus se dit avec le mot du moteur.* Les messages de `batch_undo` sont
 *    rédigés pour l'utilisateur et nomment la cause (déjà annulé, sorti de la pile,
 *    geste postérieur). Les paraphraser côté client créerait deux vérités qui
 *    dérivent ; on n'ajoute que ce que le client sait et que le moteur ignore.
 */

import type { AlignBatchUndoResponse, AlignBatchUpdateResponse } from "./sidecarClient.ts";

/** Un geste défaisable, tel que le bandeau le retient. */
export interface UndoableGesture {
  /** Poignée rendue par le moteur. */
  readonly opId: number;
  /** Libellé affiché — celui que le geste s'est donné, pas un libellé recalculé. */
  readonly label: string;
  /** La famille où le geste a eu lieu : le bandeau se désarme si elle change. */
  readonly familyId: number | null;
}

/**
 * Arme le bandeau depuis la réponse d'un geste de lot, ou renvoie `null`.
 *
 * `null` couvre quatre cas qu'il ne faut pas distinguer à l'écran, parce qu'ils ont
 * la même conséquence — il n'y a rien à défaire : sidecar trop ancien (champ absent),
 * lot rollbacké, lot sans effet, aucun lien visé n'existait.
 */
export function armFromBatch(
  res: Pick<AlignBatchUpdateResponse, "op_id" | "rolled_back">,
  label: string,
  familyId: number | null,
): UndoableGesture | null {
  if (res.rolled_back) return null;
  if (typeof res.op_id !== "number") return null;
  return { opId: res.op_id, label, familyId };
}

/**
 * Ce que l'annulation a réellement fait, en une phrase.
 *
 * Les trois compteurs ne sont pas interchangeables et le dire importe : `reinserted`
 * rend un lien détruit, `deleted` retire un lien que le geste avait créé (moitié d'un
 * geste multi-requêtes), `updated` rend ses colonnes à un lien qui avait survécu.
 * `skipped` est le seul qui demande une explication, parce qu'il signale que
 * l'annulation est **partielle** — la taire ferait croire à un retour complet.
 */
export function describeUndoOutcome(res: AlignBatchUndoResponse): string {
  const parts: string[] = [];
  const n = (k: number, un: string, plur: string) => `${k} ${k > 1 ? plur : un}`;
  if (res.reinserted) parts.push(`${n(res.reinserted, "lien rétabli", "liens rétablis")}`);
  if (res.deleted) parts.push(`${n(res.deleted, "lien retiré", "liens retirés")}`);
  if (res.updated) parts.push(`${n(res.updated, "lien restauré", "liens restaurés")}`);
  const corps = parts.length ? parts.join(", ") : "rien à rétablir";
  const reste = res.skipped
    ? ` — ${n(res.skipped, "lien n'a pas pu revenir", "liens n'ont pas pu revenir")}`
      + " (unité disparue, ou paire reprise par un lien plus jeune)"
    : "";
  return `↶ ${res.description} annulé : ${corps}${reste}`;
}

/**
 * Ce qu'on dit quand le moteur refuse l'annulation.
 *
 * Le message vient du moteur ; on ne le réécrit pas. Le client n'ajoute qu'une chose,
 * et seulement quand elle est vraie : que le bandeau disparaît, parce que l'utilisateur
 * doit comprendre que le bouton ne reviendra pas.
 */
export function describeUndoFailure(message: string, httpStatus?: number): string {
  const suffixe = httpStatus === 404
    ? " Le bandeau se retire : il n'y a plus rien à défaire."
    : "";
  return `✗ Annulation refusée — ${message}${suffixe}`;
}

/**
 * Le bandeau survit-il à ce geste ?
 *
 * Il se désarme dans les deux cas où il ne décrirait plus rien de vrai : l'opération a
 * été consommée par son annulation, ou le moteur ne la connaît plus (404). Sur un
 * refus 409 — un geste postérieur porte sur les mêmes liens — il se désarme aussi :
 * la poignée qu'il tient est devenue inatteignable, la garder afficherait un bouton
 * qui échouera à chaque clic.
 */
export function shouldDisarmAfterFailure(httpStatus?: number): boolean {
  return httpStatus === 404 || httpStatus === 409;
}
