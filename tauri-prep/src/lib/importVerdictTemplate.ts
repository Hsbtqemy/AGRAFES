/**
 * importVerdictTemplate.ts — le verdict d'un fichier, sur sa ligne (IMPO-01).
 *
 * Pur : pas de DOM, pas d'IO.
 *
 * **Pourquoi sur la ligne.** L'aperçu comparatif dit ce que chaque mode ferait du
 * fichier, mais il vit dans une carte repliée par défaut et n'en montre qu'un à la
 * fois : il ne protège que celui qui sait déjà quoi regarder. Le verdict, lui, doit
 * voyager avec le fichier — c'est le seul endroit où il est vu sans qu'on l'ait
 * cherché.
 *
 * **Ce qu'il dit, et dans cet ordre.** Le mode déduit, *son motif*, puis ce que ça
 * donne — combien d'unités seront trouvables à la recherche. Le motif compte autant
 * que le mode : sans lui, la déduction est un oracle qu'on ne peut pas contredire.
 */

import { escHtml } from "./diff.ts";
import type { ImportPlan, PlanVerdict } from "./importDetect.ts";

/** Ce qu'on sait afficher d'un fichier une fois analysé. */
export interface FileVerdict {
  plan: ImportPlan;
  /** Libellé lisible du mode déduit (« Paragraphes »…). */
  modeLabel: string;
  /**
   * Unités trouvables que l'import écrirait, quand le compte est **exact**.
   *
   * `null` quand il ne l'est pas : l'analyse ne lit le fichier qu'une fois, en mode
   * paragraphes. Sur un document numéroté `[n]`, elle sait donc *qu'il* sera trouvable
   * — les marqueurs sont là — sans connaître le compte du mode numéroté. Afficher un
   * nombre pris à l'autre mode serait un chiffre faux ; on préfère n'en donner aucun.
   */
  searchable: number | null;
}

/**
 * Le verdict d'un fichier dont l'utilisateur a choisi le mode lui-même.
 *
 * Sans ça la ligne se contredirait : elle afficherait le mode **choisi** avec le motif
 * du mode **déduit** — « Paragraphes · marqueurs [n] détectés », qui justifie
 * exactement l'autre choix. Et le compte cesse d'être valable, puisqu'il avait été
 * mesuré sur le mode déduit : on le retire plutôt que d'afficher un chiffre d'à côté.
 *
 * La déduction propose et reste visible dans le motif ; elle n'écrase pas le choix.
 */
export function verdictForChoice(
  plan: ImportPlan,
  chosenMode: string,
  chosenLabel: string,
  deducedLabel: string,
  searchable: number | null,
): FileVerdict {
  if (chosenMode === plan.mode) {
    return { plan, modeLabel: chosenLabel, searchable };
  }
  // Le motif d'origine survit quand il portait autre chose qu'un simple accord : un
  // fichier qui attend une colonne cesserait sinon de le dire dès qu'on change son
  // mode, et le verdict resterait orange sans qu'on sache pourquoi.
  const garde = plan.verdict === "ok" ? "" : ` ; ${plan.reason}`;
  return {
    plan: {
      ...plan,
      mode: chosenMode,
      // Un choix contraire à la lecture du fichier n'est pas une erreur, mais il
      // mérite d'être vu : c'est le cas où l'utilisateur sait quelque chose que le
      // fichier ne dit pas — ou se trompe.
      verdict: plan.verdict === "ok" ? "numbering_lost" : plan.verdict,
      reason: `choisi à la main — la lecture du fichier proposait « ${deducedLabel} »${garde}`,
    },
    modeLabel: chosenLabel,
    searchable: null,
  };
}

const CLASSES: Record<PlanVerdict, string> = {
  ok: "imp-verdict-ok",
  numbering_lost: "imp-verdict-warn",
  column_needed: "imp-verdict-warn",
  no_mode: "imp-verdict-bad",
};

/** Vrai si ce verdict demande une intervention avant d'importer. */
export function verdictNeedsAttention(v: PlanVerdict): boolean {
  return v !== "ok";
}

/**
 * Le verdict d'un fichier, prêt à être posé sur sa ligne.
 *
 * `null` en entrée = pas encore analysé : on rend une mention d'attente plutôt que
 * rien, sinon la ligne paraît normale au moment précis où l'on ne sait rien d'elle.
 */
export function buildVerdictHtml(v: FileVerdict | null): string {
  if (v === null) {
    return '<span class="imp-verdict imp-verdict-pending">analyse…</span>';
  }
  const cls = CLASSES[v.plan.verdict] ?? "imp-verdict-ok";
  const compte = v.searchable === null
    ? ""
    : v.searchable === 0
      ? ' · <strong class="imp-verdict-zero">rien de trouvable</strong>'
      : ` · ${v.searchable} trouvable${v.searchable > 1 ? "s" : ""}`;
  const motif = v.plan.reason
    ? ` · <span class="imp-verdict-why">${escHtml(v.plan.reason)}</span>`
    : "";
  return `<span class="imp-verdict ${cls}">`
    + `<strong>${escHtml(v.modeLabel)}</strong>${compte}${motif}`
    + "</span>";
}

/**
 * Ce que le bandeau de la liste annonce avant d'importer, ou `null` si rien ne cloche.
 *
 * Compte les fichiers qui demandent une intervention, pour que le geste d'import ne
 * soit pas le premier endroit où on l'apprend. Un fichier introuvable à la recherche
 * est nommé séparément d'un fichier qui attend une colonne : le premier est une perte,
 * le second une information manquante.
 */
export function buildQueueWarningHtml(verdicts: Array<FileVerdict | null>): string | null {
  let sansRien = 0;
  let colonne = 0;
  let ancre = 0;
  for (const v of verdicts) {
    if (!v) continue;
    if (v.plan.verdict === "no_mode") sansRien++;
    else if (v.plan.verdict === "column_needed") colonne++;
    else if (v.plan.verdict === "numbering_lost") ancre++;
  }
  if (sansRien === 0 && colonne === 0 && ancre === 0) return null;

  const bouts: string[] = [];
  if (sansRien > 0) {
    bouts.push(`<strong>${sansRien} fichier${sansRien > 1 ? "s" : ""}</strong> `
      + `n'aurai${sansRien > 1 ? "ent" : "t"} aucune unité trouvable à la recherche`);
  }
  if (colonne > 0) {
    bouts.push(`<strong>${colonne}</strong> attend${colonne > 1 ? "ent" : ""} une colonne de tableau`);
  }
  if (ancre > 0) {
    bouts.push(`<strong>${ancre}</strong> perdrai${ancre > 1 ? "ent" : "t"} sa numérotation comme ancre`);
  }
  const cls = sansRien > 0 ? "imp-queue-warn imp-queue-warn-bad" : "imp-queue-warn";
  return `<p class="${cls}">${bouts.join(" ; ")}.</p>`;
}
