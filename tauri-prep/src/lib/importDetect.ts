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

/**
 * Modes acceptant une extraction par colonne de tableau (IMPO-01).
 *
 * Les deux modes DOCX, et eux seuls : le moteur ne connaît le parcours de table que
 * pour ceux-là (`importers/docx_columns.py`, partagé par les deux importeurs), et
 * l'ignore ailleurs comme il ignore `tei_unit` hors TEI.
 *
 * Le mode **paragraphes** est le seul qui lise un bitexte en tableau dont les cellules
 * ne sont pas numérotées — le mode numéroté n'y trouve aucun `[n]` et en fait un
 * document entièrement `structure`, donc hors index. Réserver le champ « colonne » au
 * mode numéroté, comme c'était le cas, rendait donc la capacité inatteignable
 * exactement là où elle sert.
 */
const COLUMN_CAPABLE_MODES: ReadonlySet<string> = new Set([
  "docx_numbered_lines",
  "docx_paragraphs",
]);

/** True si *mode* honore `column_index` (extraction d'une colonne de tableau). */
export function modeAcceptsColumn(mode: string): boolean {
  return COLUMN_CAPABLE_MODES.has(mode);
}

/** Forme d'une table telle que `/import/preview` la renvoie (IMPO-01). */
export interface TableShape {
  columns: number;
  rows: number;
}

/**
 * Nombre de colonnes du document quand **toutes ses tables s'accordent** ; 0 sinon.
 *
 * Règle tirée de la mesure, pas du raisonnement : sur les **387 `.docx`** du disque
 * local (27 août 2026), 352 ne portent aucune table, **26 en portent une seule de deux
 * colonnes** — c'est exactement la population des bitextes — et **8 portent des tables
 * de tailles différentes**, qui sont toutes des documents de mise en page (deux HDR, un
 * modèle, un fichier de conventions), jamais un bitexte.
 *
 * Prendre le *maximum* proposerait donc **8 colonnes** sur une HDR, ce qui n'a aucun
 * sens. Exiger l'accord couvre les 26 bitextes sans une seule fausse offre. Quand les
 * tables se contredisent, le geste en lot disparaît et le champ « colonne » reste
 * saisissable à la main : on retire une proposition, jamais une capacité.
 */
export function uniformTableColumns(tables: TableShape[] | null | undefined): number {
  if (!tables || tables.length === 0) return 0;
  const first = tables[0].columns || 0;
  return tables.every((t) => (t.columns || 0) === first) ? first : 0;
}

/**
 * Phrase décrivant ce que le fichier contient, ou `null` s'il n'a aucune table.
 *
 * Décrit, ne conclut pas : porter une table ne fait pas d'un document un bitexte
 * (un fichier du corpus local porte sept tables de 5, 2, 2, 2, 2, 2 et 2 colonnes —
 * de la mise en page). L'énoncé reste factuel pour que l'utilisateur tranche.
 */
export function describeTablesLabel(tables: TableShape[] | null | undefined): string | null {
  if (!tables || tables.length === 0) return null;
  if (tables.length === 1) {
    const t = tables[0];
    const cols = `${t.columns} colonne${t.columns > 1 ? "s" : ""}`;
    const rows = `${t.rows} ligne${t.rows > 1 ? "s" : ""}`;
    return `Tableau : ${cols} × ${rows}.`;
  }
  const cols = tables.map((t) => t.columns).join(", ");
  return `${tables.length} tableaux (${cols} colonnes) — vérifiez l'aperçu avant de choisir.`;
}

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
  // Extensions TEXTE : le mode détecté en premier (défaut pré-sélectionné), puis les autres
  // modes texte en ÉCHAPPATOIRE (IMP-09) — un CoNLL-U ou TEI mal nommé `.txt` (ou du texte
  // brut mal nommé `.conllu`) peut être re-routé dans le menu par-fichier au lieu d'être
  // importé en charabia sans recours. Les formats BINAIRES (.docx/.odt = zip) restent
  // spécifiques : leur contenu est non ambigu, aucune échappatoire n'est offerte.
  if (e === "txt") return [
    { value: "txt_numbered_lines", label: "TXT lignes numérotées [n]" },
    { value: "conllu", label: "CoNLL-U annoté" },
    { value: "tei", label: "TEI XML" },
  ];
  if (e === "conllu" || e === "conll") return [
    { value: "conllu", label: "CoNLL-U annoté" },
    { value: "txt_numbered_lines", label: "TXT lignes numérotées [n]" },
  ];
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

/** Extensions qu'un import sait router (celles que {@link deriveModeFromExt} traite). */
const KNOWN_IMPORT_EXTS = new Set(["docx", "odt", "txt", "conllu", "conll", "xml", "tei"]);

/**
 * Vrai si l'extension correspond à un format importable. Source de vérité unique
 * du tri « connu / inconnu » — alignée sur {@link deriveModeFromExt} : un fichier
 * dont l'extension est inconnue est ignoré (ni importé, ni en erreur), cf. Phase 5
 * (DESIGN §11.3). Remplace le `detectFormatFromName(...) === "unknown"` divergent.
 */
export function isKnownImportExt(ext: string): boolean {
  return KNOWN_IMPORT_EXTS.has(ext.toLowerCase());
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
 * Code de langue **explicitement** encodé dans le nom de fichier (suffixe `_fr` /
 * `-en` / `.de` …), validé contre {@link KNOWN_LANG_CODES} pour éviter les faux
 * positifs (`_v2`, `_to`…). Retourne `null` quand aucun code connu n'est présent —
 * au contraire de {@link detectLanguageFromName}, qui retombe sur un défaut. Utile
 * pour les formats auto-descriptifs (TEI/`xml:lang`) où l'absence de token doit
 * laisser le document décider, plutôt que d'imposer une langue par défaut.
 */
export function detectLanguageToken(name: string): string | null {
  const raw = LANG_RE.exec(name)?.[1]?.toLowerCase() ?? null;
  return raw && KNOWN_LANG_CODES.has(raw) ? raw : null;
}

/**
 * Langue déduite du nom de fichier (via {@link detectLanguageToken}), ou *fallback*
 * quand aucun code de langue connu n'est détecté.
 */
export function detectLanguageFromName(name: string, fallback: string): string {
  return detectLanguageToken(name) ?? fallback;
}

/**
 * Langue à affecter à un fichier **selon son mode d'import** — source unique
 * partagée par l'import local et ShareDocs (DESIGN §11.8).
 *
 * - **TEI** : format auto-descriptif (`xml:lang`). On ne renvoie une langue que si le
 *   nom encode un token explicite (`roman_lat.xml` → `lat`, qui prime alors
 *   volontairement) ; sinon `undefined`, et l'importeur **garde le `xml:lang`** du
 *   document plutôt qu'un défaut imposé.
 * - **Autres formats** (DOCX/ODT/TXT/CoNLL-U) : pas de langue intrinsèque → langue
 *   détectée dans le nom **ou** le défaut.
 */
export function detectLanguageForMode(
  mode: string,
  name: string,
  fallback: string,
): string | undefined {
  return mode === "tei" ? (detectLanguageToken(name) ?? undefined) : detectLanguageFromName(name, fallback);
}
