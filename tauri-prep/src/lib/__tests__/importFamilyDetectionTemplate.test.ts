import { describe, it, expect } from "vitest";
import { buildFamilyDetectionBannerHtml } from "../importFamilyDetectionTemplate.ts";
import type { FamilyGroup } from "../familyDetect.ts";

const grp = (stem: string, files: Array<[string, string]>): FamilyGroup =>
  ({ stem, files: files.map(([path, lang]) => ({ path, lang })) });

describe("buildFamilyDetectionBannerHtml", () => {
  it("shows a singular group count for one group", () => {
    const html = buildFamilyDetectionBannerHtml([grp("roman", [["roman_fr.docx", "fr"]])]);
    expect(html).toContain("1 groupe<");
    expect(html).not.toContain("1 groupes");
  });

  it("shows a plural group count for several groups", () => {
    const html = buildFamilyDetectionBannerHtml([
      grp("roman", [["roman_fr.docx", "fr"]]),
      grp("poeme", [["poeme_en.docx", "en"]]),
    ]);
    expect(html).toContain("2 groupes<");
  });

  it("renders the stem in a <code> tag and numbers each group", () => {
    const html = buildFamilyDetectionBannerHtml([grp("roman", [["roman_fr.docx", "fr"]])]);
    expect(html).toContain("Groupe 1");
    expect(html).toContain("<code>roman</code>");
  });

  it("uses the file basename (not the full path) and uppercases the language in the chip", () => {
    // The display chip uses the basename; the full path is kept only in the <option value>.
    const html = buildFamilyDetectionBannerHtml([grp("roman", [["sub/dir/roman_fr.docx", "fr"]])]);
    expect(html).toContain("roman_fr.docx <em>[FR]</em>");
  });

  it("extracts the basename from a Windows backslash path for the chip", () => {
    const html = buildFamilyDetectionBannerHtml([grp("roman", [["C:\\docs\\roman_fr.docx", "fr"]])]);
    expect(html).toContain("roman_fr.docx <em>[FR]</em>");
  });

  it("emits a pivot <select> with one option per file carrying the group index", () => {
    const html = buildFamilyDetectionBannerHtml([
      grp("roman", [["roman_fr.docx", "fr"], ["roman_en.docx", "en"]]),
    ]);
    expect(html).toContain('class="prep-imp-family-pivot-sel" data-group="0"');
    expect(html).toContain('value="roman_fr.docx"');
    expect(html).toContain('value="roman_en.docx"');
  });

  it("HTML-escapes the stem, filename and option value", () => {
    const html = buildFamilyDetectionBannerHtml([grp("<x>", [['a"b<.docx', "fr"]])]);
    expect(html).toContain("&lt;x&gt;");
    expect(html).toContain("&lt;.docx");
    expect(html).toContain("&quot;");
    expect(html).not.toContain("<x>");
  });
});
