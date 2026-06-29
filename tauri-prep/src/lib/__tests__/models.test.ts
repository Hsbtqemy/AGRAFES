import { describe, expect, it } from "vitest";
import { describeModel, modelForLanguage, type ModelInfo } from "../models";

const M = (name: string, language: string, installed = false): ModelInfo => ({
  name,
  language,
  approx_size_mb: 40,
  installed,
  version: null,
});

const MODELS = [
  M("fr_core_news_md", "fr"),
  M("en_core_web_md", "en"),
  M("xx_ent_wiki_sm", "mul"),
];

describe("modelForLanguage", () => {
  it("exact base-language match", () => {
    expect(modelForLanguage("fr", MODELS)?.name).toBe("fr_core_news_md");
  });

  it("region tags reduce to the base code (fr-FR, en_US)", () => {
    expect(modelForLanguage("fr-FR", MODELS)?.name).toBe("fr_core_news_md");
    expect(modelForLanguage("en_US", MODELS)?.name).toBe("en_core_web_md");
    expect(modelForLanguage("FR", MODELS)?.name).toBe("fr_core_news_md"); // case-insensitive
  });

  it("unknown language → multilingual fallback", () => {
    expect(modelForLanguage("zz", MODELS)?.name).toBe("xx_ent_wiki_sm");
  });

  it("null / empty language → multilingual fallback", () => {
    expect(modelForLanguage(null, MODELS)?.name).toBe("xx_ent_wiki_sm");
    expect(modelForLanguage(undefined, MODELS)?.name).toBe("xx_ent_wiki_sm");
    expect(modelForLanguage("  ", MODELS)?.name).toBe("xx_ent_wiki_sm");
  });

  it("no models → null", () => {
    expect(modelForLanguage("fr", [])).toBeNull();
  });

  it("no multilingual model and unknown language → null", () => {
    expect(modelForLanguage("zz", [M("fr_core_news_md", "fr")])).toBeNull();
  });
});

describe("describeModel", () => {
  it("installed with version → 'Installé · <version>'", () => {
    const m: ModelInfo = { ...M("fr_core_news_md", "fr", true), version: "3.8.0" };
    expect(describeModel(m)).toEqual({
      name: "fr_core_news_md",
      sizeLabel: "~40 Mo",
      statusLabel: "Installé · 3.8.0",
      installed: true,
    });
  });

  it("installed without a known version → 'Installé'", () => {
    expect(describeModel(M("en_core_web_md", "en", true)).statusLabel).toBe("Installé");
  });

  it("absent → 'Absent' + size label", () => {
    const r = describeModel(M("de_core_news_md", "de", false));
    expect(r.statusLabel).toBe("Absent");
    expect(r.sizeLabel).toBe("~40 Mo");
    expect(r.installed).toBe(false);
  });
});
