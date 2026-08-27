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

/**
 * Modes à **comparer** dans l'aperçu, pour une extension donnée (IMPO-01).
 *
 * Ce sont les modes de *style* du format — ceux entre lesquels l'utilisateur doit
 * trancher et qui produisent tous des unités de texte comparables. Pas les
 * échappatoires de `modeOptionsForExt` : un `.txt` peut être re-routé en CoNLL-U ou en
 * TEI quand il est mal nommé, mais ces deux-là répondent une charge d'une autre forme
 * (`conllu_stats`, pas des unités) et ne se rangent pas dans le même tableau.
 *
 * Coût mesuré le 27 août 2026 : un parse complet par mode, soit 32 à 251 ms pour un
 * DOCX du corpus, 59 ms pour l'ODT médian. C'est ce qui autorise à comparer **à la
 * sélection** d'un fichier — ajouter 25 fichiers coûterait ~4 s si on comparait à
 * l'ajout, alors que l'aperçu n'en montre de toute façon qu'un à la fois.
 */
export function comparableModesForExt(ext: string): string[] {
  const e = ext.toLowerCase();
  if (e === "docx") return ["docx_paragraphs", "docx_numbered_lines"];
  if (e === "odt") return ["odt_paragraphs", "odt_numbered_lines"];
  if (e === "txt") return ["txt_numbered_lines"];
  if (e === "xml" || e === "tei") return ["tei"];
  return [];
}

/* ------------------------------------------------------------------------- *
 * Déduction du mode par fichier (IMPO-01, lot « l'écran décide et le dit »)
 * ------------------------------------------------------------------------- */

/**
 * Forme de numérotation portée par un document.
 *
 * `bracket` = `[12]`, la convention ADR-001, que les importeurs consomment (le
 * marqueur devient l'`external_id` et disparaît du texte). `dot` = `1.`, que
 * **aucun** mode ne consomme aujourd'hui : le numéro reste collé dans le texte et
 * l'`external_id` redevient positionnel, donc l'ancre d'alignement est perdue.
 */
export type NumberingForm = "bracket" | "dot";

const NUMBERING_PATTERNS: ReadonlyArray<[NumberingForm, RegExp]> = [
  // `[n]` d'abord : une prose numérotée `[12]` peut contenir des « 1. » en cours de
  // texte, l'inverse n'arrive pas. La convention du moteur gagne les ex æquo.
  ["bracket", /^[ \t]*\[\d+\]/u],
  ["dot", /^[ \t]*\d+\.[ \t]/u],
];

/**
 * Part minimale de lignes marquées pour conclure à une numérotation.
 *
 * **Posé au milieu du vide, pas au jugé.** Mesuré le 27 août 2026 sur les 273
 * `.docx`/`.odt` des deux dossiers de corpus, en simulant la fenêtre de l'aperçu
 * (50 unités) : pour `[n]`, 149 fichiers à exactement 0 et 98 au-dessus de 0,95 ;
 * pour `1.`, 243 à 0 et 3 au-dessus de 0,95. **Aucun fichier entre 0,2 et 0,95.**
 * N'importe quelle valeur de cet intervalle trie donc à l'identique ; 0,5 laisse la
 * marge la plus large des deux côtés, et tolère qu'un titre ou deux ne soient pas
 * numérotés.
 */
export const NUMBERING_MIN_RATIO = 0.5;

/** Ce que la lecture d'un échantillon apprend de la numérotation d'un document. */
export interface NumberingEvidence {
  form: NumberingForm | null;
  /** Part des lignes portant le marqueur de la forme retenue. */
  ratio: number;
  /** Lignes non vides examinées. */
  lines: number;
}

/**
 * La numérotation d'un document, lue sur un échantillon de ses unités.
 *
 * **Compte les lignes, pas les unités.** Un document « blob » (R2.3) tient tout
 * entier dans **une** unité dont les centaines de marqueurs vivent après des sauts de
 * ligne doux : compter par unité n'en verrait qu'un seul, et le fichier passerait pour
 * non numéroté. C'est exactement le piège dans lequel la première sonde de mesure est
 * tombée.
 *
 * L'échantillon doit venir d'un aperçu en mode **paragraphes**, qui ne retire rien —
 * le mode numéroté, lui, consomme les marqueurs et les rendrait invisibles.
 * La fenêtre de 50 unités de l'aperçu suffit très largement : sur les 101 fichiers
 * numérotés du corpus, le premier marqueur vit à l'unité **#0**, sans exception.
 */
export function detectNumbering(texts: string[]): NumberingEvidence {
  const lines: string[] = [];
  for (const t of texts) {
    for (const ln of (t ?? "").split("\n")) {
      if (ln.trim() !== "") lines.push(ln);
    }
  }
  if (lines.length === 0) return { form: null, ratio: 0, lines: 0 };
  for (const [form, rx] of NUMBERING_PATTERNS) {
    const hits = lines.reduce((n, ln) => (rx.test(ln) ? n + 1 : n), 0);
    const ratio = hits / lines.length;
    if (ratio >= NUMBERING_MIN_RATIO) return { form, ratio, lines: lines.length };
  }
  return { form: null, ratio: 0, lines: lines.length };
}

/**
 * Verdict de la déduction — ce que l'écran doit faire de ce fichier.
 *
 * `ok` : le mode déduit lit le document. `column_needed` : le texte est dans un
 * tableau, il manque une information que le fichier ne porte pas. `numbering_lost` :
 * le document s'importera, mais sa numérotation restera dans le texte au lieu de
 * devenir une ancre. `no_mode` : aucun mode ne rend d'unité trouvable.
 */
export type PlanVerdict = "ok" | "column_needed" | "numbering_lost" | "no_mode";

export interface ImportPlan {
  /** Mode à poser sur le fichier — toujours un mode valide pour l'extension. */
  mode: string;
  verdict: PlanVerdict;
  /** Motif en clair, affiché sur la carte du fichier : *pourquoi* ce mode. */
  reason: string;
}

/** Ce qu'on sait du fichier au moment de déduire (un seul aperçu suffit). */
export interface PlanEvidence {
  ext: string;
  /** Numérotation lue sur l'aperçu de sonde. */
  numbering: NumberingForm | null;
  /**
   * Unités trouvables que le **mode de sonde** rendrait — paragraphes pour DOCX/ODT,
   * `txt_numbered_lines` pour un `.txt` (le seul qui existe).
   *
   * Le nom compte : sur un `.txt`, la sonde **consomme** le marqueur `[n]`, qui devient
   * l'`external_id` et disparaît du texte. `detectNumbering` n'y voit donc aucune
   * numérotation là où il y en a une, et ce compte est la seule preuve qui reste
   * qu'elle existait.
   */
  searchableInProbe: number;
  /** Colonnes du document quand ses tables s'accordent (cf. {@link uniformTableColumns}). */
  uniformColumns?: number;
  /** Une colonne est déjà demandée pour ce fichier. */
  hasColumn?: boolean;
}

/**
 * Le mode qu'un fichier demande, et pourquoi — **la décision, en un seul endroit**.
 *
 * Remplace le profil de lot comme source du mode. Le profil décidait une fois pour
 * tous les fichiers, et il était faux : mesuré le 27 août 2026 sur 273 `.docx`/`.odt`
 * réels, son défaut « Lignes numérotées [n] » est le **mauvais** mode sur **149**
 * d'entre eux, et 26 de plus demandent une colonne qu'un profil ne sait pas exprimer.
 * Le signal des marqueurs, lui, tombe juste sur 272 des 273 — le seul écart
 * (`Houellebecq-Carte_FR.docx`) étant un fichier où le *comptage* des unités désigne
 * le mauvais mode pour un écart de 1, là où le signal ne se trompe pas.
 *
 * D'où le renoncement au comptage comme critère : il est aveugle sur les 15 fichiers
 * où les deux modes rendent le **même nombre** d'unités tout en produisant des textes
 * entièrement différents (l'un consomme `[4] `, l'autre le laisse collé au texte).
 */
export function planImport(ev: PlanEvidence): ImportPlan {
  const e = ev.ext.toLowerCase();
  const wp = e === "docx" || e === "odt";

  if (wp) {
    const numbered = e === "docx" ? "docx_numbered_lines" : "odt_numbered_lines";
    const paragraphs = e === "docx" ? "docx_paragraphs" : "odt_paragraphs";

    // **Le verdict le plus grave d'abord.** Même échelle que la sévérité du moteur,
    // posée pour la même raison : « rien n'est trouvable » ne doit être écrasé par
    // aucun diagnostic plus doux. Inerte sur les fichiers mesurés — une numérotation
    // détectée implique qu'il y avait du texte à lire — mais vrai par construction
    // plutôt que par chance.
    //
    // Rien à lire hors tableau, alors que le document en porte un : c'est le bitexte
    // en tableau, et la colonne est la seule chose qui manque.
    if (ev.searchableInProbe === 0 && !ev.hasColumn && (ev.uniformColumns ?? 0) >= 2) {
      return {
        mode: paragraphs,
        verdict: "column_needed",
        reason: `le texte est dans un tableau de ${ev.uniformColumns} colonnes — indiquez la colonne à extraire`,
      };
    }
    if (ev.searchableInProbe === 0 && ev.numbering === null) {
      return { mode: paragraphs, verdict: "no_mode", reason: "aucun mode ne rend d'unité trouvable" };
    }
    if (ev.numbering === "bracket") {
      return { mode: numbered, verdict: "ok", reason: "marqueurs [n] détectés" };
    }
    if (ev.numbering === "dot") {
      return {
        mode: paragraphs,
        verdict: "numbering_lost",
        reason: "numéroté « 1. » — l'import ne sait pas consommer cette forme : "
          + "le numéro restera dans le texte et ne servira pas d'ancre",
      };
    }
    return { mode: paragraphs, verdict: "ok", reason: "aucun marqueur — un paragraphe par unité" };
  }

  if (e === "txt") {
    // `txt_numbered_lines` est le SEUL mode TXT (`dispatch.py`) : un `.txt` qui ne
    // porte pas de `[n]` n'a aucune porte d'entrée, et l'écran doit le dire plutôt que
    // de l'importer en 100 % `structure`. 45 fichiers du corpus sont dans ce cas.
    // `searchableInProbe > 0` prime sur la détection : le mode TXT numéroté a mangé
    // les marqueurs pour en faire des `external_id`, donc `detectNumbering` n'en voit
    // aucun sur un fichier qui en porte. Le compte est la preuve qui reste — sans lui
    // on déclarait « rien ne serait trouvable » sur `Asimov-Foundation_EN.txt`, qui
    // rend 1683 unités toutes indexables, et sur 195 autres `.txt` du disque.
    if (ev.numbering === "bracket" || ev.searchableInProbe > 0) {
      return { mode: "txt_numbered_lines", verdict: "ok", reason: "marqueurs [n] détectés" };
    }
    return {
      mode: "txt_numbered_lines",
      verdict: "no_mode",
      reason: ev.numbering === "dot"
        ? "numéroté « 1. », forme qu'aucun mode TXT ne lit — rien ne serait trouvable"
        : "texte sans marqueurs [n], et c'est le seul mode TXT — rien ne serait trouvable",
    };
  }

  if (e === "xml" || e === "tei") {
    return { mode: "tei", verdict: "ok", reason: "TEI XML" };
  }
  if (e === "conllu" || e === "conll") {
    return { mode: "conllu", verdict: "ok", reason: "CoNLL-U annoté" };
  }
  return { mode: deriveModeFromExt(e, WP_DEFAULT_PARAGRAPHS), verdict: "ok", reason: "" };
}

/** Une ligne du tableau comparatif : ce qu'un mode fait du fichier. */
export interface ModeOutcome {
  mode: string;
  /** Unités totales que l'import écrirait. */
  units: number;
  /** Unités indexées, donc trouvables à la recherche (`unit_type = 'line'`). */
  searchable: number;
}

/**
 * Le mode qui rend le plus d'unités trouvables, ou `null` si aucun n'en rend une seule.
 *
 * `null` est un verdict, pas un échec de la règle : sur un bitexte en tableau sans
 * colonne, ou sur un `.txt` numéroté « 1. », **aucun** mode ne lit le document, et
 * l'écran doit le dire au lieu de laisser choisir le moins mauvais. C'est ce qui rend
 * le défaut de capacité visible plutôt que caché derrière un mauvais choix.
 *
 * **Ce comptage ne décide plus du mode** — voir {@link recommendedMode}. Il est
 * aveugle sur les 15 fichiers du corpus où les deux modes rendent le *même nombre*
 * d'unités en produisant des textes entièrement différents, et il désigne le mauvais
 * mode sur `Houellebecq-Carte_FR.docx` pour un écart de 1 (724 contre 725). Il ne
 * répond plus qu'à une question, celle où il ne peut pas se tromper : **quelque chose
 * lit-il ce document ?**
 */
export function pickBestMode(outcomes: ModeOutcome[]): string | null {
  let best: ModeOutcome | null = null;
  for (const o of outcomes) {
    if (o.searchable > 0 && (best === null || o.searchable > best.searchable)) best = o;
  }
  return best ? best.mode : null;
}

/**
 * Le mode marqué **recommandé** dans le tableau comparatif.
 *
 * Deux règles, chacune sur la question qu'elle sait trancher : le *comptage* dit si
 * quoi que ce soit lit le document (`null` sinon, et l'écran le dit) ; le *signal des
 * marqueurs*, lui, dit **lequel** — parce qu'un mode peut rendre autant d'unités qu'un
 * autre en perdant l'ancre d'alignement, ce qu'aucun compte ne montre.
 *
 * Sans cela l'écran se contredirait : la carte du fichier poserait le mode déduit et le
 * tableau juste en dessous en recommanderait un autre.
 */
export function recommendedMode(
  outcomes: ModeOutcome[],
  planMode: string | null | undefined,
): string | null {
  const anyReadable = pickBestMode(outcomes);
  if (anyReadable === null) return null;
  if (planMode && outcomes.some((o) => o.mode === planMode)) return planMode;
  return anyReadable;
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
