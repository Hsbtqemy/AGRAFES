import { describe, it, expect } from "vitest";
import {
  RESOURCE_TYPE_SUGGESTIONS,
  TYPE_TEMPLATES,
  normalizeType,
  templateForType,
  fieldsOf,
  partitionFields,
} from "../metaTemplates.ts";

describe("normalizeType", () => {
  it("trims and lowercases", () => {
    expect(normalizeType("  Article de Presse ")).toBe("article de presse");
  });
  it("maps nullish to empty string", () => {
    expect(normalizeType(null)).toBe("");
    expect(normalizeType(undefined)).toBe("");
  });
});

describe("templateForType", () => {
  it("returns the template for a known type (case-insensitive)", () => {
    const t = templateForType("Roman");
    expect(t.map((f) => f.key)).toEqual(["collection", "year_first_pub", "isbn"]);
  });
  it("returns empty for an unknown/free type", () => {
    expect(templateForType("chose inventée")).toEqual([]);
    expect(templateForType("")).toEqual([]);
    expect(templateForType(null)).toEqual([]);
  });
  it("every suggested type except 'autre' has a non-empty template", () => {
    for (const type of RESOURCE_TYPE_SUGGESTIONS) {
      if (type === "autre") continue;
      expect(templateForType(type).length, `template for ${type}`).toBeGreaterThan(0);
    }
  });
  it("template keys are ASCII snake_case (safe meta_json keys)", () => {
    for (const fields of Object.values(TYPE_TEMPLATES)) {
      for (const f of fields) expect(f.key).toMatch(/^[a-z0-9_]+$/);
    }
  });
});

describe("fieldsOf", () => {
  it("extracts the fields sub-object as a string map", () => {
    expect(fieldsOf({ fields: { rubrique: "Culture", url: "http://x" } })).toEqual({
      rubrique: "Culture",
      url: "http://x",
    });
  });
  it("ignores sibling provenance keys (encoding, import_mode)", () => {
    expect(fieldsOf({ encoding: "utf-8", fields: { a: "1" } })).toEqual({ a: "1" });
  });
  it("coerces scalar values to strings and skips nested/nullish", () => {
    expect(fieldsOf({ fields: { a: 5, b: null, c: { x: 1 }, d: "ok" } })).toEqual({
      a: "5",
      d: "ok",
    });
  });
  it("returns {} for null / missing / non-object meta", () => {
    expect(fieldsOf(null)).toEqual({});
    expect(fieldsOf(undefined)).toEqual({});
    expect(fieldsOf({})).toEqual({});
  });
});

describe("partitionFields", () => {
  const roman = templateForType("roman");

  it("fills template values in order and empty for unset", () => {
    const { templateValues } = partitionFields({ collection: "Folio" }, roman);
    expect(templateValues.map((tv) => [tv.field.key, tv.value])).toEqual([
      ["collection", "Folio"],
      ["year_first_pub", ""],
      ["isbn", ""],
    ]);
  });

  it("routes keys outside the template into extras", () => {
    const { extras } = partitionFields({ collection: "Folio", tirage: "45000" }, roman);
    expect(extras).toEqual([{ key: "tirage", value: "45000" }]);
  });

  it("with no template, all fields become extras", () => {
    const { templateValues, extras } = partitionFields({ a: "1", b: "2" }, []);
    expect(templateValues).toEqual([]);
    expect(extras).toEqual([
      { key: "a", value: "1" },
      { key: "b", value: "2" },
    ]);
  });

  it("empty/nullish fields yield empty extras and blank template values", () => {
    const { templateValues, extras } = partitionFields(null, roman);
    expect(extras).toEqual([]);
    expect(templateValues.every((tv) => tv.value === "")).toBe(true);
  });
});
