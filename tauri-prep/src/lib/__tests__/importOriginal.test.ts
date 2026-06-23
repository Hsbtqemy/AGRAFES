import { describe, it, expect } from "vitest";
import { hasImportOriginal } from "../importOriginal.ts";

describe("hasImportOriginal (ADR-043 P3)", () => {
  it("is true when text_source differs from text_raw (destructive rewrite)", () => {
    expect(hasImportOriginal({ text_raw: "segment", text_source: "phrase originale" })).toBe(true);
  });

  it("is false when text_source equals text_raw (pristine / untouched)", () => {
    expect(hasImportOriginal({ text_raw: "ligne", text_source: "ligne" })).toBe(false);
  });

  it("is false when text_source is null (legacy line, never destructively touched)", () => {
    expect(hasImportOriginal({ text_raw: "ligne", text_source: null })).toBe(false);
  });

  it("is false when text_source is undefined (field absent)", () => {
    expect(hasImportOriginal({ text_raw: "ligne" })).toBe(false);
  });

  it("compares against text_raw, not the normalised display text", () => {
    // A merged unit whose verbatim text equals its source must not offer recovery,
    // even though a normalised form would differ.
    expect(hasImportOriginal({ text_raw: "A B", text_source: "A B" })).toBe(false);
  });

  it("treats a null text_raw with a set text_source as recoverable", () => {
    expect(hasImportOriginal({ text_raw: null, text_source: "orig" })).toBe(true);
  });
});
