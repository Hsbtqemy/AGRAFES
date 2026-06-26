/**
 * curationSessionSummary.ts — Pure builder for the curation session-summary bar.
 *
 * Phase 2 of the CurationView decomposition (cf. HANDOFF_PREP § 7 backlog).
 * No DOM, no I/O. Returns the inner HTML string for #act-curate-session-summary;
 * the caller (CurationView._updateSessionSummary) owns the empty-guard, the
 * display toggle and the listener wiring on the resulting DOM.
 *
 * Invariants protégés par les tests __tests__/curationSessionSummary.test.ts :
 *   1. Trois chips pending/accepted/ignored avec leurs compteurs et libellés.
 *   2. Le filtre statut actif marque sa chip (prep-session-chip-active) et bascule
 *      son title sur "Effacer ce filtre" ; la note de filtre n'apparaît que si un
 *      filtre est actif.
 *   3. Note corrections manuelles / exceptions : uniquement si le compteur > 0.
 *   4. restoredCount > 0 → bandeau de restauration (avec "sur N sauvegardé(s)"
 *      seulement si savedCount > restoredCount) ; sinon → ligne de reset.
 *   5. isAllMode ajoute la mention de portée globale (em dans le bandeau de
 *      restauration, badge dans la ligne de reset).
 */

export interface SessionSummaryInput {
  /** Status counts for the current session. */
  counts: { pending: number; accepted: number; ignored: number };
  /** Active status filter, or null. */
  activeStatusFilter: "pending" | "accepted" | "ignored" | null;
  /** Status display labels (CurationView._STATUS_LABEL). */
  statusLabels: Record<string, string>;
  /** True for corpus-wide scope (no specific doc selected). */
  isAllMode: boolean;
  /** Number of statuses restored from a previous session. */
  restoredCount: number;
  /** Number of statuses that had been saved. */
  savedCount: number;
  /** Number of manual overrides in the session. */
  manualOverrideCount: number;
  /** Number of persistent exceptions. */
  exceptionCount: number;
}

/**
 * Build the inner HTML of the session-summary bar. Pure.
 */
export function formatSessionSummary(input: SessionSummaryInput): string {
  const { counts: c, activeStatusFilter: af, statusLabels: sl, isAllMode, restoredCount, savedCount, manualOverrideCount, exceptionCount } = input;
  const chip = (key: "pending" | "accepted" | "ignored", icon: string, label: string, count: number) =>
    `<span class="prep-session-chip prep-session-${key}${af === key ? " prep-session-chip-active" : ""}"` +
    ` data-sf="${key}" role="button" tabindex="0" title="${af === key ? "Effacer ce filtre" : `Filtrer : ${label}`}">` +
    `${icon}&#160;<strong>${count}</strong>&#160;<span class="prep-session-chip-label">${label}</span></span>`;
  let restoreNotice: string;
  if (restoredCount > 0) {
    const countText = savedCount > restoredCount
      ? `${restoredCount} statut(s) restauré(s) sur ${savedCount} sauvegardé(s)`
      : `${restoredCount} statut(s) restauré(s)`;
    const modeNote = isAllMode ? ` <em>(sélection modifiée depuis la preview)</em>` : "";
    restoreNotice = `<div class="prep-session-restore-notice" title="Statuts restaurés depuis la session précédente">&#8635; ${countText}${modeNote} &#8212; <button class="prep-btn-inline-link" id="act-reset-review">Réinitialiser</button></div>`;
  } else {
    const modeNote = isAllMode ? `<span class="prep-session-all-note" title="Portée globale">&#9432; Portée globale</span> &#8212; ` : "";
    restoreNotice = `<div class="prep-session-reset-row">${modeNote}<button class="prep-btn-inline-link" id="act-reset-review">Effacer la review sauvegardée</button></div>`;
  }
  return (
    `<div class="prep-session-counts">${chip("pending","&#9632;",sl.pending,c.pending)}${chip("accepted","&#10003;",sl.accepted,c.accepted)}${chip("ignored","&#215;",sl.ignored,c.ignored)}</div>` +
    (af ? `<div class="prep-session-filter-note">Filtre statut actif &#8212; <button class="prep-btn-inline-link" id="act-clear-sf">Afficher tout</button></div>` : "") +
    (manualOverrideCount > 0 ? `<div class="prep-session-override-note">&#9998;&#160;${manualOverrideCount} correction(s) manuelle(s)</div>` : "") +
    (exceptionCount > 0 ? `<div class="prep-session-exception-note">🔒&#160;${exceptionCount} exception(s) persistée(s)</div>` : "") +
    restoreNotice
  );
}
