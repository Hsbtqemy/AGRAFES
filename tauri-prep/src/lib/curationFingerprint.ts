/**
 * curationFingerprint.ts — Fonctions de signature/empreinte pour la persistence
 * de l'état de revue curation. Extraites de CurationView pour être testables
 * sans DOM ni dépendances Tauri.
 *
 * Algorithme : FNV-1a 32 bits sur une chaîne canonique.
 */

export interface CurateRuleForFingerprint {
  pattern: string;
  replacement?: string;
  flags?: string;
  description?: string;
}

export interface CurateExampleForFingerprint {
  unit_id?: number;
  before?: string;
  matched_rule_ids?: number[];
}

/** FNV-1a 32 bits */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Signature canonique des règles de curation.
 * Indépendante de l'ordre des règles (triées alphabétiquement avant hash).
 */
export function rulesSignature(rules: CurateRuleForFingerprint[]): string {
  const canonical = rules
    .map(r => `${r.pattern}|${r.replacement ?? ""}|${r.flags ?? ""}|${r.description ?? ""}`)
    .sort()
    .join("\x00");
  return fnv1a(canonical);
}

/**
 * Empreinte structurelle d'un échantillon de preview.
 * Encode unit_id + matched_rule_ids (triés) — sensible aux changements de structure
 * mais pas au contenu textuel.
 */
export function sampleFingerprint(examples: CurateExampleForFingerprint[]): string {
  const canonical = examples
    .filter(ex => ex.unit_id !== undefined)
    .map(ex => `${ex.unit_id}:${(ex.matched_rule_ids ?? []).slice().sort((a, b) => a - b).join(",")}`)
    .sort()
    .join("\x00");
  return fnv1a(canonical);
}

/**
 * Empreinte textuelle d'un échantillon de preview.
 * Encode les 64 premiers caractères normalisés de `before` par unit_id.
 * Sensible aux modifications textuelles dans le document.
 */
export function sampleTextFingerprint(examples: CurateExampleForFingerprint[]): string {
  const canonical = examples
    .filter(ex => ex.unit_id !== undefined)
    .map(ex => {
      const norm = (ex.before ?? "").replace(/\s+/g, " ").trim().slice(0, 64);
      return `${ex.unit_id}:${norm}`;
    })
    .sort()
    .join("\x00");
  return fnv1a(canonical);
}
