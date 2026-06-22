/**
 * importDetect.ts — détection PURE du format et de la langue d'import à partir
 * d'un nom de fichier (extension → mode, suffixe de nom → langue).
 *
 * Aucune dépendance DOM/IO : extrait de `screens/ImportScreen.ts` pour être
 * partagé entre l'import local et l'import ShareDocs (Phase 5) et testé en
 * isolation. **Source de vérité unique** de la dérivation — ne pas réinventer
 * une variante côté ShareDocs (cf. DESIGN §11.2).
 */

/**
 * Profil de lot : intention commune DOCX/ODT (style de segmentation). Le *format*
 * vient de l'extension ; ce profil ne tranche que le style numéroté/paragraphes.
 */
export const WP_DEFAULT_PARAGRAPHS = "wp_paragraphs";
export const WP_DEFAULT_NUMBERED = "wp_numbered";

/** Liste exhaustive des modes d'import — fallback pour une extension inconnue. */
const IMPORT_MODE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "docx_numbered_lines", label: "DOCX lignes numérotées [n]" },
  { value: "txt_numbered_lines", label: "TXT lignes numérotées [n]" },
  { value: "docx_paragraphs", label: "DOCX paragraphes" },
  { value: "odt_numbered_lines", label: "ODT lignes numérotées [n]" },
  { value: "odt_paragraphs", label: "ODT paragraphes" },
  { value: "tei", label: "TEI XML" },
  { value: "conllu", label: "CoNLL-U annoté (.conllu)" },
];

/** Extension (minuscule, sans point) du dernier segment d'un chemin / nom de fichier. */
export function extFromFileName(fileName: string): string {
  const base = fileName.split(/[/\\]/u).pop() ?? fileName;
  if (!base.includes(".")) return "";
  return base.split(".").pop()?.toLowerCase() ?? "";
}

/** Modes d'import proposés pour une extension (évite TEI/TXT sur DOCX, etc.). */
export function modeOptionsForExt(ext: string): Array<{ value: string; label: string }> {
  const e = ext.toLowerCase();
  if (e === "docx") {
    return [
      { value: "docx_paragraphs", label: "Paragraphes" },
      { value: "docx_numbered_lines", label: "Lignes numérotées [n]" },
    ];
  }
  if (e === "odt") {
    return [
      { value: "odt_paragraphs", label: "Paragraphes" },
      { value: "odt_numbered_lines", label: "Lignes numérotées [n]" },
    ];
  }
  if (e === "txt") return [{ value: "txt_numbered_lines", label: "TXT lignes numérotées [n]" }];
  if (e === "conllu" || e === "conll") return [{ value: "conllu", label: "CoNLL-U annoté" }];
  if (e === "xml" || e === "tei") return [{ value: "tei", label: "TEI XML" }];
  return IMPORT_MODE_OPTIONS.slice();
}

/**
 * Mode d'import dérivé d'une extension + d'un *profil par défaut* (style numéroté /
 * paragraphes pour DOCX/ODT). Les formats sans choix de style (TEI / TXT / CoNLL-U)
 * ignorent le profil ; une extension inconnue retombe sur le profil tel quel.
 */
export function deriveModeFromExt(ext: string, defaultProfile: string): string {
  const e = ext.toLowerCase();
  if (e === "xml" || e === "tei") return "tei";
  if (e === "txt") return "txt_numbered_lines";
  if (e === "conllu" || e === "conll") return "conllu";
  if (e === "docx") {
    if (defaultProfile === WP_DEFAULT_PARAGRAPHS) return "docx_paragraphs";
    if (defaultProfile === WP_DEFAULT_NUMBERED) return "docx_numbered_lines";
    if (defaultProfile.startsWith("docx_")) return defaultProfile;
    return "docx_numbered_lines";
  }
  if (e === "odt") {
    if (defaultProfile === WP_DEFAULT_PARAGRAPHS) return "odt_paragraphs";
    if (defaultProfile === WP_DEFAULT_NUMBERED) return "odt_numbered_lines";
    if (defaultProfile.startsWith("odt_")) return defaultProfile;
    return "odt_paragraphs";
  }
  return defaultProfile;
}

/** Si le mode stocké ne correspond pas à l'extension (ex. TEI sur .docx), corrige. */
export function normalizeModeForExt(mode: string, ext: string): string {
  const allowed = new Set(modeOptionsForExt(ext).map((o) => o.value));
  if (allowed.has(mode)) return mode;
  return deriveModeFromExt(ext, WP_DEFAULT_NUMBERED);
}

/**
 * Matches a 2-3 letter token preceded by _ - . at the end of a filename (before extension).
 * e.g. roman_FR.docx  roman-en.docx  texte.DE.txt
 */
export const LANG_RE = /[_\-.]([A-Za-z]{2,3})(?:\.[^.]+)?$/u;

/**
 * Whitelist of BCP-47 / ISO 639 codes accepted as language tokens in filenames.
 * Covers ISO 639-1 (2-letter) and common ISO 639-2 (3-letter) codes.
 * Prevents false positives (e.g. _to, _by, _of, _v2…).
 */
export const KNOWN_LANG_CODES = new Set([
  // Romance
  "fr", "fra", "en", "eng", "es", "spa", "it", "ita", "pt", "por",
  "ro", "ron", "rum", "ca", "cat", "oc", "oci", "la", "lat", "gl", "glg",
  // Germanic
  "de", "deu", "ger", "nl", "nld", "dut", "sv", "swe", "da", "dan",
  "no", "nor", "nb", "nob", "nn", "nno", "af", "afr", "fy", "fry",
  // Greek
  "el", "ell", "gre",
  // Slavic
  "pl", "pol", "cs", "ces", "cze", "sk", "slk", "slo", "sl", "slv",
  "ru", "rus", "uk", "ukr", "bg", "bul", "hr", "hrv", "sr", "srp",
  "bs", "bos", "mk", "mkd",
  // Baltic
  "lt", "lit", "lv", "lav",
  // Finno-Ugric
  "fi", "fin", "hu", "hun", "et", "est",
  // Other European
  "eu", "eus", "baq", "is", "isl", "ice", "ga", "gle", "cy", "wel",
  // Semitic
  "ar", "ara", "he", "heb",
  // CJK
  "zh", "zho", "chi", "ja", "jpn", "ko", "kor",
  // South/Southeast Asian
  "hi", "hin", "bn", "ben", "ur", "urd", "fa", "fas", "per",
  "tr", "tur", "vi", "vie", "th", "tha", "id", "ind", "ms", "msa",
  // Other
  "sw", "swa", "und", "mul",
]);

/**
 * Langue déduite du nom de fichier (suffixe `_fr` / `-en` / `.de` …), validée
 * contre {@link KNOWN_LANG_CODES} pour éviter les faux positifs (`_v2`, `_to`…).
 * Retourne *fallback* quand aucun code de langue connu n'est détecté.
 */
export function detectLanguageFromName(name: string, fallback: string): string {
  const raw = LANG_RE.exec(name)?.[1]?.toLowerCase() ?? null;
  return raw && KNOWN_LANG_CODES.has(raw) ? raw : fallback;
}
