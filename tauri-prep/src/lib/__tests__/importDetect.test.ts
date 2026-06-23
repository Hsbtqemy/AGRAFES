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

  it(".txt → 1 option TXT lignes numérotées", () => {
    const opts = modeOptionsForExt("txt");
    expect(opts).toHaveLength(1);
    expect(opts[0].value).toBe("txt_numbered_lines");
  });

  it(".conllu → 1 option CoNLL-U", () => {
    const opts = modeOptionsForExt("conllu");
    expect(opts).toHaveLength(1);
    expect(opts[0].value).toBe("conllu");
  });

  it(".conll → 1 option CoNLL-U (alias)", () => {
    const opts = modeOptionsForExt("conll");
    expect(opts).toHaveLength(1);
    expect(opts[0].value).toBe("conllu");
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
