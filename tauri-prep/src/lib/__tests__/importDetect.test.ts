import { describe, it, expect } from "vitest";
import {
  WP_DEFAULT_NUMBERED,
  WP_DEFAULT_PARAGRAPHS,
  extFromFileName,
  modeOptionsForExt,
  deriveModeFromExt,
  normalizeModeForExt,
  isKnownImportExt,
  detectLanguageFromName,
  detectLanguageToken,
  detectLanguageForMode,
  modeAcceptsColumn,
  uniformTableColumns,
  describeTablesLabel,
  LANG_RE,
  KNOWN_LANG_CODES,
} from "../importDetect.ts";

// ─── modeOptionsForExt (migré depuis screens/__tests__/ImportScreen.test.ts) ────

describe("modeOptionsForExt", () => {
  it(".docx → 2 options (paragraphes + lignes numérotées)", () => {
    const opts = modeOptionsForExt("docx");
    expect(opts).toHaveLength(2);
    expect(opts.map(o => o.value)).toContain("docx_paragraphs");
    expect(opts.map(o => o.value)).toContain("docx_numbered_lines");
  });

  it(".odt → 2 options", () => {
    const opts = modeOptionsForExt("odt");
    expect(opts).toHaveLength(2);
    expect(opts.map(o => o.value)).toContain("odt_paragraphs");
    expect(opts.map(o => o.value)).toContain("odt_numbered_lines");
  });

  it(".txt → défaut TXT + échappatoire CoNLL-U/TEI (IMP-09)", () => {
    // Un CoNLL-U ou TEI mal nommé .txt doit pouvoir être re-routé dans le menu.
    const opts = modeOptionsForExt("txt");
    expect(opts[0].value).toBe("txt_numbered_lines"); // défaut détecté en premier
    expect(opts.map(o => o.value)).toContain("conllu");
    expect(opts.map(o => o.value)).toContain("tei");
  });

  it(".conllu → défaut CoNLL-U + échappatoire TXT (IMP-09)", () => {
    const opts = modeOptionsForExt("conllu");
    expect(opts[0].value).toBe("conllu");
    expect(opts.map(o => o.value)).toContain("txt_numbered_lines");
  });

  it(".conll → défaut CoNLL-U (alias) + échappatoire TXT", () => {
    const opts = modeOptionsForExt("conll");
    expect(opts[0].value).toBe("conllu");
    expect(opts.map(o => o.value)).toContain("txt_numbered_lines");
  });

  it(".xml → 1 option TEI", () => {
    const opts = modeOptionsForExt("xml");
    expect(opts).toHaveLength(1);
    expect(opts[0].value).toBe("tei");
  });

  it(".tei → 1 option TEI", () => {
    const opts = modeOptionsForExt("tei");
    expect(opts).toHaveLength(1);
    expect(opts[0].value).toBe("tei");
  });

  it("extension inconnue → toutes les options (> 2)", () => {
    const opts = modeOptionsForExt("pdf");
    expect(opts.length).toBeGreaterThan(2);
  });

  it("casse insensible (.DOCX ≡ .docx)", () => {
    expect(modeOptionsForExt("DOCX")).toEqual(modeOptionsForExt("docx"));
  });

  it("chaque option a value et label non vides", () => {
    for (const ext of ["docx", "odt", "txt", "conllu", "xml", "tei", "pdf"]) {
      for (const opt of modeOptionsForExt(ext)) {
        expect(opt.value).toBeTruthy();
        expect(opt.label).toBeTruthy();
      }
    }
  });
});

// ─── extFromFileName ────────────────────────────────────────────────────────

describe("extFromFileName", () => {
  it("extension simple en minuscule", () => {
    expect(extFromFileName("roman.DOCX")).toBe("docx");
  });

  it("garde le dernier segment d'un chemin (slash et antislash)", () => {
    expect(extFromFileName("path/to/roman.txt")).toBe("txt");
    expect(extFromFileName("C:\\dossier\\roman.odt")).toBe("odt");
  });

  it("multi-point → dernière extension seulement", () => {
    expect(extFromFileName("archive.tar.gz")).toBe("gz");
  });

  it("sans extension → chaîne vide", () => {
    expect(extFromFileName("README")).toBe("");
    expect(extFromFileName("dossier/sans_ext")).toBe("");
  });

  it("chaîne vide → chaîne vide", () => {
    expect(extFromFileName("")).toBe("");
  });
});

// ─── deriveModeFromExt ──────────────────────────────────────────────────────

describe("deriveModeFromExt", () => {
  it("docx + profil numéroté → docx_numbered_lines", () => {
    expect(deriveModeFromExt("docx", WP_DEFAULT_NUMBERED)).toBe("docx_numbered_lines");
  });

  it("docx + profil paragraphes → docx_paragraphs", () => {
    expect(deriveModeFromExt("docx", WP_DEFAULT_PARAGRAPHS)).toBe("docx_paragraphs");
  });

  it("docx + mode docx_* explicite → conservé", () => {
    expect(deriveModeFromExt("docx", "docx_paragraphs")).toBe("docx_paragraphs");
  });

  it("docx + profil inconnu → défaut numéroté", () => {
    expect(deriveModeFromExt("docx", "profil_bidon")).toBe("docx_numbered_lines");
  });

  it("odt + profil paragraphes → odt_paragraphs", () => {
    expect(deriveModeFromExt("odt", WP_DEFAULT_PARAGRAPHS)).toBe("odt_paragraphs");
  });

  it("odt + profil numéroté → odt_numbered_lines", () => {
    expect(deriveModeFromExt("odt", WP_DEFAULT_NUMBERED)).toBe("odt_numbered_lines");
  });

  it("odt + profil inconnu → défaut paragraphes", () => {
    expect(deriveModeFromExt("odt", "profil_bidon")).toBe("odt_paragraphs");
  });

  it("formats sans style : profil ignoré", () => {
    expect(deriveModeFromExt("txt", WP_DEFAULT_PARAGRAPHS)).toBe("txt_numbered_lines");
    expect(deriveModeFromExt("xml", WP_DEFAULT_PARAGRAPHS)).toBe("tei");
    expect(deriveModeFromExt("tei", WP_DEFAULT_NUMBERED)).toBe("tei");
    expect(deriveModeFromExt("conllu", WP_DEFAULT_NUMBERED)).toBe("conllu");
    expect(deriveModeFromExt("conll", WP_DEFAULT_NUMBERED)).toBe("conllu");
  });

  it("casse insensible sur l'extension", () => {
    expect(deriveModeFromExt("DOCX", WP_DEFAULT_NUMBERED)).toBe("docx_numbered_lines");
  });

  it("extension inconnue → profil tel quel (fallback)", () => {
    expect(deriveModeFromExt("pdf", "tei")).toBe("tei");
  });
});

// ─── normalizeModeForExt ────────────────────────────────────────────────────

describe("normalizeModeForExt", () => {
  it("mode compatible avec l'extension → conservé", () => {
    expect(normalizeModeForExt("docx_paragraphs", "docx")).toBe("docx_paragraphs");
    expect(normalizeModeForExt("tei", "xml")).toBe("tei");
  });

  it("mode incompatible (TEI sur .docx) → corrigé vers le défaut de l'extension", () => {
    expect(normalizeModeForExt("tei", "docx")).toBe("docx_numbered_lines");
  });

  it("mode incompatible sur .txt → txt_numbered_lines", () => {
    expect(normalizeModeForExt("docx_numbered_lines", "txt")).toBe("txt_numbered_lines");
  });
});

// ─── isKnownImportExt ───────────────────────────────────────────────────────

describe("isKnownImportExt", () => {
  it("reconnaît tous les formats importables", () => {
    for (const ext of ["docx", "odt", "txt", "conllu", "conll", "xml", "tei"]) {
      expect(isKnownImportExt(ext)).toBe(true);
    }
  });

  it("casse insensible", () => {
    expect(isKnownImportExt("DOCX")).toBe(true);
    expect(isKnownImportExt("TEI")).toBe(true);
  });

  it("extension inconnue ou vide → false", () => {
    expect(isKnownImportExt("pdf")).toBe(false);
    expect(isKnownImportExt("")).toBe(false);
  });

  it("aligné sur deriveModeFromExt (.conll reconnu des deux côtés)", () => {
    // garde-fou anti-divergence : .conll est routé en mode ET reconnu connu.
    expect(isKnownImportExt("conll")).toBe(true);
    expect(deriveModeFromExt("conll", WP_DEFAULT_NUMBERED)).toBe("conllu");
  });
});

// ─── detectLanguageFromName ─────────────────────────────────────────────────

describe("detectLanguageFromName", () => {
  it("suffixe _fr détecté", () => {
    expect(detectLanguageFromName("roman_fr.docx", "en")).toBe("fr");
  });

  it("suffixe -EN détecté et mis en minuscule", () => {
    expect(detectLanguageFromName("roman-EN.docx", "fr")).toBe("en");
  });

  it("suffixe .de (point) détecté", () => {
    expect(detectLanguageFromName("texte.de.txt", "fr")).toBe("de");
  });

  it("code ISO 639-2 à 3 lettres (fra) détecté", () => {
    expect(detectLanguageFromName("roman_fra.docx", "en")).toBe("fra");
  });

  it("token hors whitelist (_xx) → fallback", () => {
    expect(detectLanguageFromName("roman_xx.docx", "fr")).toBe("fr");
  });

  it("faux positif _v2 (chiffre) → fallback", () => {
    expect(detectLanguageFromName("roman_v2.docx", "fr")).toBe("fr");
  });

  it("aucun séparateur de langue → fallback", () => {
    expect(detectLanguageFromName("plainname.docx", "fr")).toBe("fr");
  });
});

// ─── detectLanguageToken ────────────────────────────────────────────────────

describe("detectLanguageToken", () => {
  it("token connu détecté (minuscule)", () => {
    expect(detectLanguageToken("roman_FR.docx")).toBe("fr");
    expect(detectLanguageToken("texte.de.txt")).toBe("de");
    expect(detectLanguageToken("roman_lat.xml")).toBe("lat");
  });

  it("aucun token / hors whitelist / faux positif → null (pas de fallback)", () => {
    expect(detectLanguageToken("plainname.xml")).toBeNull();
    expect(detectLanguageToken("roman_xx.xml")).toBeNull();
    expect(detectLanguageToken("roman_v2.docx")).toBeNull();
  });

  it("detectLanguageFromName en dérive (token ?? fallback)", () => {
    expect(detectLanguageFromName("plainname.xml", "und")).toBe("und");
    expect(detectLanguageFromName("roman_lat.xml", "und")).toBe("lat");
  });
});

// ─── detectLanguageForMode (langue selon le mode — source unique #3) ─────────

describe("detectLanguageForMode", () => {
  it("TEI sans token → undefined (le xml:lang du document fait foi)", () => {
    expect(detectLanguageForMode("tei", "roman.xml", "fr")).toBeUndefined();
    expect(detectLanguageForMode("tei", "plainname.tei", "und")).toBeUndefined();
  });

  it("TEI avec token explicite → ce token (prime volontairement sur le xml:lang)", () => {
    expect(detectLanguageForMode("tei", "roman_lat.xml", "fr")).toBe("lat");
    expect(detectLanguageForMode("tei", "texte.de.xml", "fr")).toBe("de");
  });

  it("TEI : faux positif non promu en langue (reste undefined)", () => {
    expect(detectLanguageForMode("tei", "roman_v2.xml", "fr")).toBeUndefined();
    expect(detectLanguageForMode("tei", "roman_xx.xml", "fr")).toBeUndefined();
  });

  it("format non-TEI sans token → langue par défaut (jamais undefined)", () => {
    expect(detectLanguageForMode("docx_numbered_lines", "roman.docx", "fr")).toBe("fr");
    expect(detectLanguageForMode("txt_numbered_lines", "notes.txt", "en")).toBe("en");
    expect(detectLanguageForMode("conllu", "corpus.conllu", "fr")).toBe("fr");
  });

  it("format non-TEI avec token → token détecté", () => {
    expect(detectLanguageForMode("docx_paragraphs", "roman_en.docx", "fr")).toBe("en");
  });

  it("seul le mode tei active la sémantique xml:lang (pas l'extension .xml d'un autre mode)", () => {
    // garde-fou : un mode non-tei décide toujours d'une langue, même si bizarrement nommé .xml
    expect(detectLanguageForMode("txt_numbered_lines", "data.xml", "fr")).toBe("fr");
  });
});

// ─── exports réutilisés par ShareDocs (Phase 5) ─────────────────────────────

describe("exports partagés", () => {
  it("LANG_RE capture le token de langue", () => {
    expect(LANG_RE.exec("roman_fr.docx")?.[1]).toBe("fr");
  });

  it("KNOWN_LANG_CODES contient les codes courants et exclut le bruit", () => {
    expect(KNOWN_LANG_CODES.has("fr")).toBe(true);
    expect(KNOWN_LANG_CODES.has("eng")).toBe(true);
    expect(KNOWN_LANG_CODES.has("xx")).toBe(false);
  });
});

// ─── IMPO-01 : quels modes acceptent une colonne de tableau ──────────────────
//
// Le champ « colonne » de l'écran d'import était réservé à `docx_numbered_lines`,
// ce qui rendait la capacité inatteignable exactement là où elle sert : un bitexte
// en tableau NON numéroté ne se lit qu'en mode paragraphes.

describe("modeAcceptsColumn", () => {
  it("accepte les deux modes DOCX", () => {
    expect(modeAcceptsColumn("docx_numbered_lines")).toBe(true);
    expect(modeAcceptsColumn("docx_paragraphs")).toBe(true);
  });

  it("refuse tous les autres modes", () => {
    for (const mode of [
      "txt_numbered_lines",
      "odt_paragraphs",
      "odt_numbered_lines",
      "tei",
      "conllu",
      "",
    ]) {
      expect(modeAcceptsColumn(mode)).toBe(false);
    }
  });

  it("couvre exactement les modes proposés pour un .docx", () => {
    // Garde de cohérence : si le menu du .docx gagne un mode, il doit être
    // tranché ici explicitement plutôt que refusé par omission.
    const docxModes = modeOptionsForExt("docx").map((o) => o.value);
    expect(docxModes.every((m) => modeAcceptsColumn(m))).toBe(true);
  });
});

// ─── IMPO-01 : dire ce que le fichier contient ───────────────────────────────

describe("uniformTableColumns", () => {
  it("rend 0 sans table", () => {
    expect(uniformTableColumns(null)).toBe(0);
    expect(uniformTableColumns(undefined)).toBe(0);
    expect(uniformTableColumns([])).toBe(0);
  });

  it("rend le nombre de colonnes d'un bitexte", () => {
    // La forme de 26 des 387 .docx du disque : une table, deux colonnes.
    expect(uniformTableColumns([{ columns: 2, rows: 1 }])).toBe(2);
    expect(uniformTableColumns([{ columns: 2, rows: 46 }])).toBe(2);
  });

  it("rend le nombre commun quand plusieurs tables s'accordent", () => {
    expect(uniformTableColumns([
      { columns: 2, rows: 1 }, { columns: 2, rows: 3 }, { columns: 2, rows: 1 },
    ])).toBe(2);
  });

  it("rend 0 quand les tables se contredisent — jamais un bitexte", () => {
    // Cas réels du disque : une HDR et un fichier de conventions. Prendre le MAXIMUM
    // proposerait 8 colonnes sur la première, ce qui n'a aucun sens.
    const hdr = [4, 4, 2, 2, 2, 6, 6, 2, 3, 3, 2, 3, 3, 8].map((c) => ({ columns: c, rows: 1 }));
    expect(uniformTableColumns(hdr)).toBe(0);
    const conventions = [5, 2, 2, 2, 2, 2, 2].map((c) => ({ columns: c, rows: 1 }));
    expect(uniformTableColumns(conventions)).toBe(0);
  });

  it("rend 1 sur des tables d'une seule colonne — l'appelant exige >= 2", () => {
    expect(uniformTableColumns([{ columns: 1, rows: 5 }, { columns: 1, rows: 2 }])).toBe(1);
  });
});

describe("describeTablesLabel", () => {
  it("rend null quand il n'y a aucune table", () => {
    expect(describeTablesLabel(null)).toBeNull();
    expect(describeTablesLabel([])).toBeNull();
  });

  it("décrit une table unique avec ses colonnes et ses lignes", () => {
    expect(describeTablesLabel([{ columns: 2, rows: 1 }])).toBe("Tableau : 2 colonnes × 1 ligne.");
    expect(describeTablesLabel([{ columns: 1, rows: 46 }])).toBe("Tableau : 1 colonne × 46 lignes.");
  });

  it("énumère les colonnes quand il y a plusieurs tables, sans conclure", () => {
    // Cas réel du disque local : sept tables de mise en page, pas un bitexte.
    const sept = [
      { columns: 5, rows: 6 }, { columns: 2, rows: 1 }, { columns: 2, rows: 1 },
      { columns: 2, rows: 2 }, { columns: 2, rows: 1 }, { columns: 2, rows: 1 },
      { columns: 2, rows: 1 },
    ];
    const label = describeTablesLabel(sept)!;
    expect(label).toContain("7 tableaux");
    expect(label).toContain("5, 2, 2, 2, 2, 2, 2");
    expect(label).toContain("aperçu");
  });
});
