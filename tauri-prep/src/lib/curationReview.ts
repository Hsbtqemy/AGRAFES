/**
 * curationReview.ts — Fonctions pures pour la persistance de l'état de révision de curation.
 *
 * Extraites de CurationView pour être testables sans DOM/instance.
 */

export interface StoredCurateReviewState {
  version: 1 | 2 | 3 | 4 | 5;
  docId: number | null;
  rulesSignature: string;
  updatedAt: number;
  unitsTotal?: number;
  unitsChanged?: number;
  sampleFingerprint?: string;
  sampleSize?: number;
  sampleTextFingerprint?: string;
  statuses: Record<string, "accepted" | "ignored">;
  overrides?: Record<string, string>;
}

const VALID_VERSIONS: ReadonlyArray<number> = [1, 2, 3, 4, 5];

/**
 * Charge l'état de révision depuis localStorage.
 * Retourne null si absent, malformé, version inconnue, ou signature différente.
 */
export function loadCurateReviewState(
  key: string,
  rulesSignature: string,
  storage: Pick<Storage, "getItem"> = localStorage,
): StoredCurateReviewState | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredCurateReviewState;
    if (!VALID_VERSIONS.includes(parsed.version)) return null;
    if (parsed.rulesSignature !== rulesSignature) return null;
    if (typeof parsed.statuses !== "object" || parsed.statuses === null) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Sauvegarde l'état de révision dans localStorage.
 * No-op silencieux si quota dépassé.
 */
export function saveCurateReviewState(
  key: string,
  state: StoredCurateReviewState,
  storage: Pick<Storage, "setItem" | "removeItem"> = localStorage,
): void {
  const hasContent =
    Object.keys(state.statuses).length > 0 ||
    Object.keys(state.overrides ?? {}).length > 0;
  if (!hasContent) {
    try { storage.removeItem(key); } catch { /* */ }
    return;
  }
  try { storage.setItem(key, JSON.stringify(state)); } catch { /* quota */ }
}
