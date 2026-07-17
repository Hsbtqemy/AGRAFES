/**
 * Pure tests for anchorWarn (chantier 1 + revue M1, DESIGN_upstream_anchoring §4/§5): the
 * STRATEGY-AWARE at-risk detection, the oriented remedies, and the notice/gate HTML.
 */
import { describe, it, expect } from "vitest";
import {
  anchorWarnings, anchorRemedy, buildAnchorNoticeHtml, buildAnchorGateHtml,
} from "../anchorWarn.ts";
import type { AlignMatrix, AnchorStatus } from "../sidecarClient.ts";

type MatrixSlice = Pick<AlignMatrix, "languages" | "anchor_status">;
const S = (kind: AnchorStatus["kind"], line_count: number): AnchorStatus =>
  ({ anchored: kind !== null, kind, line_count });

describe("anchorWarnings — length/similarity strategy (the default)", () => {
  it("flags an UNANCHORED translation (kind null) — drifts under any strategy", () => {
    const m: MatrixSlice = { languages: ["fr", "en"], anchor_status: [S("paragraph", 10), S(null, 1270)] };
    const w = anchorWarnings(m, "length_bounded");
    expect(w.map((x) => [x.lang, x.reason])).toEqual([["en", "unanchored"]]);
  });

  it("RED-on-old: a value/[N]-anchored translation is now flagged 'unused-anchor' under length", () => {
    // Pre-M1 this was silent (anchored=true). length_bounded never consumes external_id → drift.
    const m: MatrixSlice = { languages: ["fr", "en"], anchor_status: [S("paragraph", 10), S("value", 12)] };
    const w = anchorWarnings(m, "length_bounded");
    expect(w).toHaveLength(1);
    expect([w[0].lang, w[0].reason, w[0].kind]).toEqual(["en", "unused-anchor", "value"]);
  });

  it("flags a position-anchored pair whose segment counts DIFFER (not parallel)", () => {
    const m: MatrixSlice = { languages: ["fr", "en"], anchor_status: [S("position", 10), S("position", 12)] };
    expect(anchorWarnings(m, "length_bounded").map((x) => x.reason)).toEqual(["unused-anchor"]);
  });

  it("stays SILENT on a parallel position pair (equal segment counts → length aligns 1-1)", () => {
    const m: MatrixSlice = { languages: ["fr", "en"], anchor_status: [S("position", 10), S("position", 10)] };
    expect(anchorWarnings(m, "length_bounded")).toEqual([]);
  });

  it("RED-on-fix: equal counts do NOT silence a value/[N] pair (markers may be shifted)", () => {
    // FR [11..15] vs EN [12..16] — same count, shifted numbering (the canonical value case).
    // length_bounded ignores external_id → diagonal drift; equal-count must NOT silence it
    // (revue du fix M1, risque 1). Pre-fix this returned [].
    const m: MatrixSlice = { languages: ["fr", "en"], anchor_status: [S("value", 5), S("value", 5)] };
    expect(anchorWarnings(m, "length_bounded").map((x) => x.reason)).toEqual(["unused-anchor"]);
  });

  it("stays SILENT when both hub and translation are ¶-anchored (parent_n bounds drift)", () => {
    const m: MatrixSlice = { languages: ["fr", "en"], anchor_status: [S("paragraph", 10), S("paragraph", 12)] };
    expect(anchorWarnings(m, "length_bounded")).toEqual([]);
  });

  it("an UNANCHORED hub warns globally and does NOT double-warn every column", () => {
    const m: MatrixSlice = { languages: ["fr", "en", "ro"], anchor_status: [S(null, 5), S("value", 6), S(null, 7)] };
    const w = anchorWarnings(m, "length_bounded");
    // hub null → 'unanchored' isHub ; ro null → 'unanchored' ; en value is NOT piled on
    // ('unused-anchor' suppressed because the hub itself already explains the drift).
    expect(w.map((x) => [x.lang, x.reason, x.isHub])).toEqual([
      ["fr", "unanchored", true],
      ["ro", "unanchored", false],
    ]);
  });

  it("treats `similarity` like `length_bounded` (also parent_n-only)", () => {
    const m: MatrixSlice = { languages: ["fr", "en"], anchor_status: [S("paragraph", 10), S("value", 12)] };
    expect(anchorWarnings(m, "similarity").map((x) => x.reason)).toEqual(["unused-anchor"]);
  });
});

describe("anchorWarnings — identity strategies consume [N]/position", () => {
  it("external_id: a value/position-anchored translation is SAFE (no warning)", () => {
    const m: MatrixSlice = { languages: ["fr", "en"], anchor_status: [S("value", 10), S("value", 12)] };
    expect(anchorWarnings(m, "external_id")).toEqual([]);
  });

  it("external_id: an UNANCHORED translation is still flagged", () => {
    const m: MatrixSlice = { languages: ["fr", "en"], anchor_status: [S("value", 10), S(null, 12)] };
    expect(anchorWarnings(m, "external_id").map((x) => x.reason)).toEqual(["unanchored"]);
  });

  it("position strategy does not flag a [N]/position mismatch as unused", () => {
    const m: MatrixSlice = { languages: ["fr", "en"], anchor_status: [S("position", 10), S("position", 12)] };
    expect(anchorWarnings(m, "position")).toEqual([]);
  });
});

describe("anchorWarnings — fail-open", () => {
  it("returns [] when anchor_status is absent (sidecar < 1.6.59)", () => {
    expect(anchorWarnings({ languages: ["fr", "en"] }, "length_bounded")).toEqual([]);
  });
});

describe("anchorRemedy by shape (§5, m2/m3)", () => {
  it("0 lines → the re-segment remedy, NOT the blob one", () => {
    expect(anchorRemedy(0)).toContain("que de la structure");
    expect(anchorRemedy(0)).not.toContain("un seul bloc");
  });
  it("a blob (1 line) → the re-import remedy, WITHOUT the vaporware « extraire »", () => {
    expect(anchorRemedy(1)).toContain("un seul bloc");
    expect(anchorRemedy(1)).not.toContain("extraire");
  });
  it("multi-line → the number/regroup remedy", () => {
    expect(anchorRemedy(1270)).toContain("regrouper");
  });
});

describe("HTML builders", () => {
  it("notice is empty when there is nothing to warn", () => {
    expect(buildAnchorNoticeHtml([])).toBe("");
  });

  it("an unanchored hub reads as a global drift", () => {
    const html = buildAnchorNoticeHtml([
      { lang: "en", isHub: true, kind: null, lineCount: 3, reason: "unanchored", remedy: "REMEDY" },
    ]);
    expect(html).toContain("Le moyeu");
    expect(html).toContain("tout l'alignement dérivera");
    expect(html).toContain("REMEDY");
  });

  it("an unused-anchor line names the anchor and the strategy blind spot", () => {
    const html = buildAnchorNoticeHtml([
      { lang: "en", isHub: false, kind: "value", lineCount: 12, reason: "unused-anchor", remedy: "R" },
    ]);
    expect(html).toContain("des numéros [N]");
    expect(html).toContain("ne l'exploite pas");
  });

  it("escapes the language label (imported documents are untrusted)", () => {
    const html = buildAnchorNoticeHtml([
      { lang: "<img src=x onerror=alert(1)>", isHub: false, kind: null, lineCount: 2, reason: "unanchored", remedy: "r" },
    ]);
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });

  it("gate wraps the notice with proceed + cancel buttons", () => {
    const html = buildAnchorGateHtml([
      { lang: "en", isHub: false, kind: null, lineCount: 2, reason: "unanchored", remedy: "r" },
    ]);
    expect(html).toContain('id="matrix-anchor-proceed"');
    expect(html).toContain('id="matrix-anchor-cancel"');
    expect(html).toContain("prep-matrix-anchor-notice");
  });
});
