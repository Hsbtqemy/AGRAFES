/**
 * prepIndexStatus.ts — Helpers pour l'arbitrage de l'index FTS (HANDOFF F4).
 *
 * F4 : un point unique pour voir l'état de l'index FTS et le mettre à jour.
 * MetadataScreen (vue Documents) expose un bouton « Mettre à jour l'index »
 * dont le libellé et l'état dépendent du nombre de documents périmés ; le
 * réglage opt-in « réindexer automatiquement après curation » est persisté
 * en localStorage et lu par CurationView au moment de l'apply.
 *
 * Invariants protégés
 *  1. `indexButtonState` est pur (pas de DOM, pas d'IO) — testable Vitest.
 *  2. Aucune réindexation n'est jamais bloquante : le bouton enclenche un job
 *     asynchrone, l'auto opt-in aussi.
 */

/** Clé localStorage du réglage opt-in « réindexer auto après curation ». */
export const AUTO_REINDEX_LS_KEY = "agrafes.prep.autoReindexAfterCuration";

export interface IndexButtonState {
  /** Libellé du bouton. */
  label: string;
  /** Tooltip du bouton. */
  title: string;
  /** true quand il n'y a rien à réindexer → bouton inactif. */
  disabled: boolean;
  /** true quand au moins un document est périmé → styliser en avertissement. */
  stale: boolean;
}

/**
 * État du bouton unique « Mettre à jour l'index » à partir du nombre de
 * documents dont l'index FTS est périmé. Pur.
 */
export function indexButtonState(
  staleCount: number,
  ftsReadable: boolean | null = true,
  ftsRepairable: boolean = false,
): IndexButtonState {
  // `null` = on n'a pas pu demander (liste des documents en échec, sidecar injoignable).
  // Ne rien savoir n'autorise pas à rassurer : sans ce cas, un chargement raté laissait
  // « ✓ Index à jour » à l'écran, sous un bandeau rouge annonçant l'erreur.
  if (ftsReadable === null) {
    return {
      label: "Index — état inconnu",
      title: "La liste des documents n'a pas pu être lue : l'état de l'index est inconnu.",
      disabled: true,
      stale: false,
    };
  }
  // **Avant tout le reste.** `staleCount` vient de `fts_stale`, dérivé d'une requête
  // qui échoue en silence quand l'index est cassé : sur une base abîmée il vaut zéro,
  // exactement comme sur une base à jour. Sans ce garde, l'écran affichait « ✓ Index à
  // jour » sur les deux instantanés corrompus du corpus (FTS-01, mesuré le 28 août).
  //
  // Des deux pannes que `ftsReadable: false` recouvre, **une seule se répare d'ici**, et
  // c'est le moteur qui tranche (`fts_repairable`, contrat 1.6.86) : l'écran n'a pas à
  // connaître les modes de défaillance de FTS5. Déclaration disparue du schéma → une
  // réindexation la reconstruit vraiment, mesuré le 31 août sur une copie d'un des
  // instantanés abîmés — 46 674 lignes, `integrity_check` à `ok`. Pages corrompues → les
  // six voies SQL mesurées le 25 août échouent toutes, y compris `POST /index`, qui passe
  // par DELETE/INSERT sur la table même qu'on ne peut plus toucher.
  //
  // C'est la panne réparable qui portait trois des quatre bases abîmées du corpus : la
  // laisser inactive, comme jusqu'au 31 août, mettait le remède hors de portée depuis
  // l'application alors qu'il tenait en un clic (FTS-01).
  if (!ftsReadable && ftsRepairable) {
    return {
      label: "⚠ Réparer l'index",
      title:
        "L'index de recherche a disparu du schéma de la base. La recherche est hors "
        + "service, mais AUCUN texte n'est perdu : l'index se refabrique intégralement "
        + "depuis les unités. Cliquez pour le reconstruire (job asynchrone).",
      disabled: false,
      stale: true,
    };
  }
  if (!ftsReadable) {
    return {
      label: "⚠ Index illisible",
      title:
        "L'index de recherche ne peut pas être lu : ses pages sont abîmées. La recherche "
        + "est hors service, mais AUCUN texte n'est perdu — l'index se refabrique "
        + "intégralement depuis les unités. Reconstruire depuis ici ne suffirait pas : "
        + "toutes les voies passent par la table endommagée, et la base doit être "
        + "réparée hors ligne.",
      disabled: true,
      stale: true,
    };
  }
  if (staleCount <= 0) {
    return {
      label: "✓ Index à jour",
      title: "L'index de recherche est à jour pour tous les documents.",
      disabled: true,
      stale: false,
    };
  }
  const docWord = staleCount > 1 ? "documents" : "document";
  return {
    label: `⚠ Mettre à jour l'index (${staleCount} ${docWord})`,
    title:
      `${staleCount} ${docWord} ont un index de recherche périmé. ` +
      "Cliquez pour reconstruire l'index FTS (job asynchrone, non bloquant).",
    disabled: false,
    stale: true,
  };
}

/** Lit le réglage opt-in « réindexer auto après curation ». Best-effort. */
export function isAutoReindexEnabled(): boolean {
  try {
    return localStorage.getItem(AUTO_REINDEX_LS_KEY) === "1";
  } catch {
    return false;
  }
}

/** Persiste le réglage opt-in « réindexer auto après curation ». Best-effort. */
export function setAutoReindexEnabled(on: boolean): void {
  try {
    localStorage.setItem(AUTO_REINDEX_LS_KEY, on ? "1" : "0");
  } catch {
    /* ignore — best-effort */
  }
}
