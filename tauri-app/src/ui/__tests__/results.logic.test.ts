/**
 * Tests for ui/results.ts (FE-06 / U-03) — the concordancer result-card
 * renderers, previously untested. Covers the pure helpers (KWIC → CQL, plain
 * text extraction, aligned-group key parse/group/sort, multi-language citation)
 * and a render smoke for renderHit including the **XSS-safe highlight** path
 * (escape-all, then turn only the `<<…>>` sentinels into highlight spans).
 * happy-dom is the package-global env (vite.config); the underscore helpers are
 * exported solely to be testable (same pattern as buildFtsQuery in search.ts).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { state } from "../../state";
import {
  _matchToCql,
  hitPlainText,
  parseAlignedGroupKey,
  groupAlignedUnits,
  sortedAlignedGroupEntries,
  appendSourceChangedBadge,
  buildCitationText,
  renderHit,
} from "../results";
import type { QueryHit, AlignedUnit } from "../../lib/sidecarClient";

function hit(o: Record<string, unknown> = {}): QueryHit {
  return { doc_id: 1, unit_id: 1, external_id: null, language: "fr", title: "Doc", ...o } as unknown as QueryHit;
}
function aligned(o: Record<string, unknown> = {}): AlignedUnit {
  return { doc_id: 2, unit_id: 10, external_id: null, language: "en", title: "T", text: "x", ...o } as unknown as AlignedUnit;
}

// ─── _matchToCql ────────────────────────────────────────────────────────────
describe("_matchToCql", () => {
  it("wraps a single word", () => expect(_matchToCql("cat")).toBe('[word="cat"]'));
  it("concatenates multiple words", () => expect(_matchToCql("cat dog")).toBe('[word="cat"][word="dog"]'));
  it("yields an empty word for blank input", () => expect(_matchToCql("   ")).toBe('[word=""]'));
  it("escapes a double quote", () => expect(_matchToCql('a"b')).toBe('[word="a\\"b"]'));
  it("escapes a backslash", () => expect(_matchToCql("a\\b")).toBe('[word="a\\\\b"]'));
});

// ─── hitPlainText ───────────────────────────────────────────────────────────
describe("hitPlainText", () => {
  it("strips << >> markers and trims", () => {
    expect(hitPlainText(hit({ text: "  <<a>> b <<c>>  " }))).toBe("a b c");
  });
  it("falls back to KWIC left/match/right when no text", () => {
    expect(hitPlainText(hit({ left: "L", match: "M", right: "R" }))).toBe("L M R");
  });
});

// ─── parseAlignedGroupKey ───────────────────────────────────────────────────
describe("parseAlignedGroupKey", () => {
  it("parses a valid key", () => {
    expect(parseAlignedGroupKey(JSON.stringify(["en", 3, "Title"]))).toEqual({ language: "en", doc_id: 3, title: "Title" });
  });
  it("falls back on a malformed key", () => {
    expect(parseAlignedGroupKey("not json")).toEqual({ language: "und", doc_id: 0, title: "" });
  });
});

// ─── groupAlignedUnits + sortedAlignedGroupEntries ──────────────────────────
describe("group + sort aligned units", () => {
  it("groups by (lang, doc, title) and sorts groups then items", () => {
    const units = [
      aligned({ language: "fr", doc_id: 5, title: "B", unit_id: 1, external_id: 2 }),
      aligned({ language: "en", doc_id: 3, title: "A", unit_id: 2, external_id: 1 }),
      aligned({ language: "en", doc_id: 3, title: "A", unit_id: 3, external_id: null }),
      aligned({ language: "en", doc_id: 3, title: "A", unit_id: 4, external_id: 1 }),
    ];
    const groups = groupAlignedUnits(units);
    expect(groups.size).toBe(2); // en/3/A and fr/5/B

    const entries = sortedAlignedGroupEntries(groups);
    expect(entries.map(([k]) => parseAlignedGroupKey(k).language)).toEqual(["en", "fr"]); // groups sorted
    // within en/3/A: external_id asc, nulls last, unit_id tiebreak
    expect(entries[0][1].map(u => u.unit_id)).toEqual([2, 4, 3]);
  });
});

// ─── appendSourceChangedBadge ───────────────────────────────────────────────
describe("appendSourceChangedBadge", () => {
  it("adds a badge with the date sliced to 10 chars when source_changed_at is set", () => {
    const row = document.createElement("div");
    appendSourceChangedBadge(row, aligned({ source_changed_at: "2026-06-29T12:00:00Z" }));
    const badge = row.querySelector(".aligned-source-changed-badge");
    expect(badge).not.toBeNull();
    expect(badge!.getAttribute("title")).toContain("2026-06-29");
    expect(badge!.getAttribute("title")).not.toContain("T12:00"); // sliced to date only
  });
  it("adds nothing when source_changed_at is absent", () => {
    const row = document.createElement("div");
    appendSourceChangedBadge(row, aligned());
    expect(row.querySelector(".aligned-source-changed-badge")).toBeNull();
  });
});

// ─── buildCitationText ──────────────────────────────────────────────────────
describe("buildCitationText", () => {
  it("formats the pivot then each aligned group", () => {
    const cite = buildCitationText(hit({
      language: "fr", title: "Roman", external_id: 7, text: "le texte",
      aligned: [aligned({ language: "en", title: "Novel", external_id: 7, text: "the text" })],
    }));
    expect(cite).toContain("[FR] Roman §7");
    expect(cite).toContain("«le texte»");
    expect(cite).toContain("[EN] Novel §7");
    expect(cite).toContain("«the text»");
  });
});

// ─── renderHit (smoke + XSS) ────────────────────────────────────────────────
describe("renderHit", () => {
  beforeEach(() => { state.showParallel = false; });

  it("renders a KWIC card with left/match/right spans", () => {
    const card = renderHit(hit({ left: "before ", match: "term", right: " after" }), "kwic", false);
    expect(card.querySelector(".kwic-match")?.textContent).toBe("term");
    expect(card.querySelector(".kwic-left")?.textContent).toBe("before ");
  });

  it("escapes HTML and highlights only the << >> sentinels (XSS-safe)", () => {
    const card = renderHit(hit({ text: "<img src=x onerror=alert(1)> <<hit>>" }), "segment", false);
    const html = (card.querySelector(".result-text") as HTMLElement).innerHTML;
    expect(html).toContain("&lt;img");                            // tag neutralised
    expect(html).not.toContain("<img");                           // not a live element
    expect(html).toContain('<span class="highlight">hit</span>'); // sentinel → highlight
  });
});
