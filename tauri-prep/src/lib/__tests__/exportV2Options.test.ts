import { describe, it, expect } from "vitest";
import {
  PRODUCT_BY_STAGE,
  FORMAT_BY_PRODUCT,
  productsForStage,
  formatsForProduct,
} from "../exportV2Options.ts";

describe("exportV2Options", () => {
  it("maps each known stage to its product values", () => {
    expect(productsForStage("alignment").map(p => p.value)).toEqual(["aligned_table", "tei_xml"]);
    expect(productsForStage("publication").map(p => p.value)).toEqual(["tei_package"]);
    expect(productsForStage("segmentation").map(p => p.value)).toEqual(["tei_xml", "readable_text"]);
    expect(productsForStage("curation").map(p => p.value)).toEqual(["tei_xml", "readable_text"]);
    expect(productsForStage("runs").map(p => p.value)).toEqual(["run_report"]);
    expect(productsForStage("qa").map(p => p.value)).toEqual(["qa_report"]);
  });

  it("falls back to the alignment products for an unknown stage", () => {
    expect(productsForStage("nope")).toBe(PRODUCT_BY_STAGE.alignment);
  });

  it("maps each known product to its format values", () => {
    expect(formatsForProduct("aligned_table").map(f => f.value)).toEqual(["csv", "tsv"]);
    expect(formatsForProduct("tei_xml").map(f => f.value)).toEqual(["tei_dir"]);
    expect(formatsForProduct("tei_package").map(f => f.value)).toEqual(["zip"]);
    expect(formatsForProduct("run_report").map(f => f.value)).toEqual(["jsonl", "html"]);
    expect(formatsForProduct("qa_report").map(f => f.value)).toEqual(["json", "html"]);
    expect(formatsForProduct("readable_text").map(f => f.value)).toEqual(["txt", "docx", "odt"]);
  });

  it("returns empty formats for an unknown product", () => {
    expect(formatsForProduct("nope")).toEqual([]);
  });

  it("every product/format option carries a non-empty label", () => {
    for (const opts of Object.values(PRODUCT_BY_STAGE))
      for (const o of opts) expect(o.label.length).toBeGreaterThan(0);
    for (const opts of Object.values(FORMAT_BY_PRODUCT))
      for (const o of opts) expect(o.label.length).toBeGreaterThan(0);
  });
});
