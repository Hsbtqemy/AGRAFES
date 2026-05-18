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
export function indexButtonState(staleCount: number): IndexButtonState {
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
