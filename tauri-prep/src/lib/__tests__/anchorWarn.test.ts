/**
 * Pure tests for anchorWarn (chantier 1, DESIGN_upstream_anchoring §4/§5): reading the
 * matrix payload's `anchor_status` into non-blocking warnings + the oriented remedy, and
 * the notice/gate HTML builders (escaping, hub wording).
 */
import { describe, it, expect } from "vitest";
import {
  anchorWarnings, anchorRemedy, buildAnchorNoticeHtml, buildAnchorGateHtml,
} from "../anchorWarn.ts";
import type { AlignMatrix } from "../sidecarClient.ts";

type MatrixSlice = Pick<AlignMatrix, "languages" | "anchor_status">;

describe("anchorWarnings", () => {
  it("flags only the unanchored languages; skips the anchored ones", () => {
    const m: MatrixSlice = {
      languages: ["fr", "en", "ro"],
      anchor_status: [
        { anchored: true, kind: "paragraph", line_count: 10 },  // fr hub OK
        { anchored: false, kind: null, line_count: 1270 },      // en drifts
        { anchored: true, kind: "value", line_count: 12 },      // ro OK
      ],
    };
    const w = anchorWarnings(m);
    expect(w.map((x) => x.lang)).toEqual(["en"]);
    expect(w[0].isHub).toBe(false);
    expect(w[0].lineCount).toBe(1270);
  });

  it("marks an unanchored HUB (index 0) with isHub=true", () => {
    const m: MatrixSlice = {
      languages: ["fr", "en"],
      anchor_status: [
        { anchored: false, kind: null, line_count: 1 },
        { anchored: true, kind: "position", line_count: 5 },
      ],
    };
    const w = anchorWarnings(m);
    expect(w).toHaveLength(1);
    expect(w[0].isHub).toBe(true);
  });

  it("returns [] when anchor_status is absent (sidecar < 1.6.59 — fail-open)", () => {
    expect(anchorWarnings({ languages: ["fr", "en"] })).toEqual([]);
  });
});

describe("anchorRemedy by shape (§5)", () => {
  it("a blob (≤ 1 line) → the extract/re-import remedy", () => {
    expect(anchorRemedy(1)).toContain("un seul bloc");
  });
  it("a multi-line text → the number/regroup remedy", () => {
    expect(anchorRemedy(1270)).toContain("regrouper");
  });
});

describe("HTML builders", () => {
  it("notice is empty when there is nothing to warn", () => {
    expect(buildAnchorNoticeHtml([])).toBe("");
  });

  it("notice lists each warning + remedy; the hub reads as a global drift", () => {
    const html = buildAnchorNoticeHtml([
      { lang: "en", isHub: true, lineCount: 3, remedy: "REMEDY-TEXT" },
    ]);
    expect(html).toContain("Le moyeu");
    expect(html).toContain("tout l'alignement dérivera");
    expect(html).toContain("REMEDY-TEXT");
    expect(html).toContain("prep-matrix-anchor-list");
  });

  it("escapes the language label (imported documents are untrusted)", () => {
    const html = buildAnchorNoticeHtml([
      { lang: "<img src=x onerror=alert(1)>", isHub: false, lineCount: 2, remedy: "r" },
    ]);
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });

  it("gate wraps the notice with proceed + cancel buttons", () => {
    const html = buildAnchorGateHtml([{ lang: "en", isHub: false, lineCount: 2, remedy: "r" }]);
    expect(html).toContain('id="matrix-anchor-proceed"');
    expect(html).toContain('id="matrix-anchor-cancel"');
    expect(html).toContain("prep-matrix-anchor-notice");
  });
});
