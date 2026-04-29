/**
 * curationPresets.ts — Pure data and pure helpers for curation rule presets.
 *
 * Extracted from screens/CurationView.ts in the Phase 1 decomposition (cf.
 * HANDOFF_PREP § 7 backlog). No DOM, no side effects, no instance state —
 * testable in isolation via Vitest.
 *
 * The CURATE_PRESETS constant is the source of truth for built-in curation
 * rule sets ; user-supplied custom rules are NOT here (they live in
 * corpus_info.meta_json or in F/R inputs at runtime).
 *
 * Idempotence guarantee : every preset is verified to converge under repeated
 * application (apply 2× = apply 1×). Cf. tests in __tests__/curationPresets.test.ts.
 *
 * Backreference syntax : the patterns and replacements use JavaScript regex
 * conventions (`$1`, `$&`, `$$`). The Python sidecar's `multicorpus_engine.curation`
 * module translates these to `\g<N>` before calling `re.sub`. Frontend authors
 * should write JS-style ; never write `\g<N>` directly here.
 */
import type { CurateRule } from "./sidecarClient.ts";

export interface CuratePreset {
  label: string;
  rules: CurateRule[];
}

/**
 * Built-in curation rule presets. The keys are stable identifiers used by
 * the project preset system ; renaming a key is a breaking change for any
 * stored project preset that references it.
 *
 * Reserved keys with stability guarantees :
 *   - `spaces`            normalisation d'espacement (NBSP préservées)
 *   - `quotes`            normalisation typographique des guillemets
 *   - `punctuation_fr`    espace fine insécable FR
 *   - `punctuation_en`    espacement anglo-saxon
 *   - `invisibles`        suppression caractères invisibles
 *   - `numbering`         normalisation numérotation [n]
 *   - `custom`            placeholder vide pour règles utilisateur
 *   - `punctuation`       deprecated — kept for backward compat
 */
export const CURATE_PRESETS: Record<string, CuratePreset> = {
  spaces: {
    label: "Espaces",
    rules: [
      { pattern: "[ \\t]{2,}", replacement: " ", flags: "g", description: "Espaces multiples → un seul" },
      { pattern: "^\\s+|\\s+$", replacement: "", flags: "gm", description: "Trim lignes" },
    ],
  },
  quotes: {
    label: "Apostrophes et guillemets",
    rules: [
      { pattern: "[‘’ʼ]", replacement: "'", description: "Apostrophes courbes → droites" },
      { pattern: "[“”]", replacement: '"', description: "Guillemets anglais → droits" },
      { pattern: "«[ \\t  ]*", replacement: "« ", flags: "g", description: "Guillemet ouvrant + espace fine insécable" },
      { pattern: "[ \\t  ]*»", replacement: " »", flags: "g", description: "Espace fine insécable + guillemet fermant" },
    ],
  },
  punctuation_fr: {
    label: "Ponctuation française",
    rules: [
      { pattern: "[ \\t ]+([!?;])", replacement: " $1", flags: "g", description: "Espace fine insécable avant ! ? ; (FR)" },
      { pattern: "[ \\t ]+:(?!\\d)", replacement: " :", flags: "g", description: "Espace fine avant : hors timecodes (FR)" },
      { pattern: "«[ \\t  ]*", replacement: "« ", flags: "g", description: "Espace fine après « (FR)" },
      { pattern: "[ \\t  ]*»", replacement: " »", flags: "g", description: "Espace fine avant » (FR)" },
      { pattern: "\\.{4,}", replacement: "…", flags: "g", description: "Points de suspension → … (FR)" },
    ],
  },
  punctuation_en: {
    label: "Ponctuation anglaise",
    rules: [
      { pattern: "\\s+([,;:!?])", replacement: "$1", flags: "g", description: "Supprimer espace avant ponctuation (EN)" },
      { pattern: "([.!?])([A-ZÀ-Ÿ])", replacement: "$1 $2", flags: "g", description: "Espace après ponctuation terminale (EN)" },
      { pattern: "\\.{4,}", replacement: "…", flags: "g", description: "Points de suspension → … (EN)" },
    ],
  },
  /** @deprecated — conservé pour compatibilité presets projets ; utiliser punctuation_en */
  punctuation: {
    label: "Ponctuation",
    rules: [
      { pattern: "\\s+([,;:!?])", replacement: "$1", flags: "g", description: "Supprimer espace avant ponctuation" },
      { pattern: "([.!?])([A-ZÀ-Ÿ])", replacement: "$1 $2", flags: "g", description: "Espace après ponctuation terminale" },
      { pattern: "\\.{4,}", replacement: "…", flags: "g", description: "Points de suspension multiples → …" },
    ],
  },
  invisibles: {
    label: "Contrôle invisibles",
    rules: [
      { pattern: "\\u200B|\\u200C|\\u200D|\\uFEFF", replacement: "", flags: "g", description: "Supprimer espaces de largeur nulle et BOM" },
      { pattern: "\\u00AD", replacement: "", flags: "g", description: "Supprimer tirets conditionnels" },
      { pattern: "[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]", replacement: "", flags: "g", description: "Supprimer caractères de contrôle" },
    ],
  },
  numbering: {
    label: "Numérotation [n]",
    rules: [
      { pattern: "^(\\d+)\\.\\s+", replacement: "[$1] ", flags: "m", description: "Normaliser numérotation décimale [n]" },
      { pattern: "^([ivxlcdmIVXLCDM]+)\\.\\s+", replacement: "[$1] ", flags: "m", description: "Normaliser numérotation romaine [n]" },
    ],
  },
  custom: {
    label: "Règles personnalisées",
    rules: [],
  },
};

/**
 * Parse a JSON-encoded list of advanced curation rules from a textarea string.
 *
 * Tolerant : returns `[]` for blank input, malformed JSON, or non-array
 * structures. Does NOT validate individual rule shapes — the backend
 * `rules_from_list` performs the real validation and raises on invalid
 * patterns. The frontend just forwards what the user typed.
 *
 * @param raw    Raw textarea content (may be empty, whitespace, or invalid JSON)
 * @returns      Array of CurateRule (possibly empty), never throws
 */
export function parseAdvancedCurateRules(raw: string): CurateRule[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? (parsed as CurateRule[]) : [];
  } catch {
    return [];
  }
}

/**
 * Validate and normalise a punctuation language identifier.
 *
 * Used by `_getPunctLang` in CurationView : the DOM stores `<input value>` as
 * a string, this helper turns it into a typed result. Pure — no DOM read.
 *
 * @param value  Raw value from radio input or null/undefined when none selected
 * @returns      "fr" | "en" if recognised, "" otherwise (caller : pas de preset)
 */
export function getPunctLangFromValue(value: string | null | undefined): "fr" | "en" | "" {
  return value === "fr" || value === "en" ? value : "";
}
