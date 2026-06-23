import { describe, it, expect } from "vitest";
import { detectFamilyGroups, pickDefaultPivot, type FamilyGroup } from "../familyDetect.ts";

// ─── detectFamilyGroups ───────────────────────────────────────────────────────

describe("detectFamilyGroups", () => {
  it("regroupe un radical commun avec langues différentes (≥2)", () => {
    const groups = detectFamilyGroups(["roman_fr.docx", "roman_en.docx"]);
    expect(groups).toHaveLength(1);
    expect(groups[0].stem).toBe("roman.docx");
    expect(groups[0].files.map((f) => f.lang).sort()).toEqual(["en", "fr"]);
    expect(groups[0].files.map((f) => f.path)).toEqual(["roman_fr.docx", "roman_en.docx"]);
  });

  it("famille à 3 membres (fr/en/de)", () => {
    const groups = detectFamilyGroups(["roman_fr.docx", "roman_en.docx", "roman_de.docx"]);
    expect(groups).toHaveLength(1);
    expect(groups[0].files.map((f) => f.lang).sort()).toEqual(["de", "en", "fr"]);
  });

  it("un seul membre → aucune famille (seuil ≥2)", () => {
    expect(detectFamilyGroups(["roman_fr.docx"])).toEqual([]);
  });

  it("token hors whitelist (_to / _by) → pas de fausse famille", () => {
    // « to » / « by » sont des mots, pas des codes de langue → aucun groupe.
    expect(detectFamilyGroups(["note_to.docx", "note_by.docx"])).toEqual([]);
  });

  it("langue connue + token inconnu → le membre connu reste seul → aucune famille", () => {
    expect(detectFamilyGroups(["roman_fr.docx", "roman_zz.docx"])).toEqual([]);
  });

  it("fichier sans token de langue → ignoré", () => {
    expect(detectFamilyGroups(["plain.docx", "roman_fr.docx"])).toEqual([]);
  });

  it("l'extension fait partie du radical (docx ≠ txt → familles distinctes)", () => {
    // roman_fr.docx → stem roman.docx ; roman_en.txt → stem roman.txt → pas de groupe.
    expect(detectFamilyGroups(["roman_fr.docx", "roman_en.txt"])).toEqual([]);
  });

  it("code ISO 639-2 à 3 lettres (lat) reconnu", () => {
    const groups = detectFamilyGroups(["roman_fr.xml", "roman_lat.xml"]);
    expect(groups).toHaveLength(1);
    expect(groups[0].files.map((f) => f.lang).sort()).toEqual(["fr", "lat"]);
  });

  it("groupement insensible à la casse du radical", () => {
    const groups = detectFamilyGroups(["Roman_fr.docx", "roman_en.docx"]);
    expect(groups).toHaveLength(1);
    expect(groups[0].files).toHaveLength(2);
  });

  it("fonctionne sur des chemins complets (slash et antislash)", () => {
    const groups = detectFamilyGroups(["C:\\docs\\roman_fr.docx", "/srv/dav/roman_en.docx"]);
    expect(groups).toHaveLength(1);
    // path conserve la chaîne d'entrée d'origine (chemin ou nom/href).
    expect(groups[0].files.map((f) => f.path)).toEqual([
      "C:\\docs\\roman_fr.docx",
      "/srv/dav/roman_en.docx",
    ]);
  });

  it("plusieurs familles distinctes, ordre de 1ʳᵉ apparition préservé", () => {
    const groups = detectFamilyGroups([
      "contrat_en.docx", "roman_fr.docx", "contrat_fr.docx", "roman_en.docx",
    ]);
    expect(groups.map((g) => g.stem)).toEqual(["contrat.docx", "roman.docx"]);
  });

  it("liste vide → aucune famille", () => {
    expect(detectFamilyGroups([])).toEqual([]);
  });
});

// ─── pickDefaultPivot ─────────────────────────────────────────────────────────

describe("pickDefaultPivot", () => {
  const group: FamilyGroup = {
    stem: "roman.docx",
    files: [
      { path: "roman_fr.docx", lang: "fr" },
      { path: "roman_en.docx", lang: "en" },
      { path: "roman_de.docx", lang: "de" },
    ],
  };

  it("langue par défaut présente → ce membre", () => {
    expect(pickDefaultPivot(group, "fr").lang).toBe("fr");
  });

  it("langue par défaut absente → 1ʳᵉ langue alphabétique", () => {
    // de < en < fr → "de"
    expect(pickDefaultPivot(group, "it").lang).toBe("de");
  });

  it("langue par défaut vide → 1ʳᵉ langue alphabétique", () => {
    expect(pickDefaultPivot(group, "").lang).toBe("de");
    expect(pickDefaultPivot(group, "   ").lang).toBe("de");
  });

  it("langue par défaut insensible à la casse", () => {
    expect(pickDefaultPivot(group, "FR").lang).toBe("fr");
  });
});
