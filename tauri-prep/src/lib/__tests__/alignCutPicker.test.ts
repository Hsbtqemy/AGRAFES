import { describe, it, expect } from "vitest";
import { buildCutPickerHtml } from "../alignCutPicker.ts";

describe("buildCutPickerHtml", () => {
  it("places a cut marker (code-point offset) at each word boundary", () => {
    const html = buildCutPickerHtml("hello world");
    expect(html).toContain('data-cut-offset="6"');           // boundary before "world"
    expect(html).toContain("hello");
    expect(html).toContain("world");
    // exactly one marker for a two-word string
    expect(html.match(/prep-align-cut-gap/g)).toHaveLength(1);
  });

  it("has no marker for a single word", () => {
    expect(buildCutPickerHtml("single")).not.toContain("prep-align-cut-gap");
  });

  it("escapes the target text (no raw HTML injection)", () => {
    const html = buildCutPickerHtml("<b>x</b> y");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;b&gt;");
    expect(html).toContain('data-cut-offset='); // still offers the boundary before "y"
  });
});
