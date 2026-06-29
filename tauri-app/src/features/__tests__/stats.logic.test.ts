/**
 * Tests for features/stats.ts (FE-06 / U-03) — the concordancer's lexical-stats
 * panel, previously untested. Covers the pure render logic (compare-table ratio
 * ∞/—, bar width, HTML escaping), the DOM filter parser (_readSlot: doc-id list,
 * top-N clamp), the select population from the shared state singleton, and the
 * panel build/toggle smoke. happy-dom is the package-global env (vite.config);
 * the underscore helpers are exported solely to be testable (same pattern as
 * buildFtsQuery in search.ts).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { state } from "../../state";
import {
  buildStatsPanel,
  populateStatsSelects,
  toggleStatsPanel,
  _readSlot,
  _barHtml,
  _renderCompareStats,
} from "../stats";
import type { StatsCompareResult } from "../../lib/sidecarClient";

function doc(overrides: Record<string, unknown> = {}) {
  return { doc_id: 1, title: "D", language: "fr", doc_role: null, resource_type: null, ...overrides };
}

beforeEach(() => {
  document.body.innerHTML = "";
  state.docs = [] as never;
  state.families = [] as never;
});

// ─── _barHtml (pure) ────────────────────────────────────────────────────────
describe("_barHtml", () => {
  it("scales 20% to a full bar and caps at 100%", () => {
    expect(_barHtml(10)).toContain("width:50.0%"); // 10*5 = 50
    expect(_barHtml(20)).toContain("width:100.0%"); // 20*5 = 100 (full)
    expect(_barHtml(50)).toContain("width:100.0%"); // capped
  });
  it("uses the supplied bar class", () => {
    expect(_barHtml(1, "stats-bar-b")).toContain('class="stats-bar-b"');
  });
});

// ─── _renderCompareStats (pure render) ──────────────────────────────────────
describe("_renderCompareStats", () => {
  const summary = {
    total_tokens: 10, vocabulary_size: 5, total_units: 2, total_docs: 1, avg_tokens_per_unit: 5,
  };
  const compare = (comparison: unknown[]): StatsCompareResult =>
    ({ label_a: "A", label_b: "B", summary_a: summary, summary_b: summary, comparison }) as unknown as StatsCompareResult;

  it("renders ratio ∞ for null, — for 0, and fixed(2) otherwise", () => {
    const html = _renderCompareStats(compare([
      { word: "x", count_a: 3, freq_a: 1.5, count_b: 0, freq_b: 0, ratio: null },
      { word: "y", count_a: 0, freq_a: 0, count_b: 2, freq_b: 1, ratio: 0 },
      { word: "z", count_a: 4, freq_a: 2, count_b: 2, freq_b: 1, ratio: 2 },
    ]));
    // Target the ratio cell exactly — `toContain("2.00")` alone would false-pass
    // on the freq cell "2.000" (which contains "2.00").
    expect(html).toContain('stats-ratio-inf">∞');
    expect(html).toContain('stats-ratio-b">—');
    expect(html).toContain('stats-ratio-a">2.00<');
  });

  it("escapes HTML in words", () => {
    const html = _renderCompareStats(compare([
      { word: "<b>", count_a: 1, freq_a: 1, count_b: 1, freq_b: 1, ratio: 1 },
    ]));
    expect(html).toContain("&lt;b&gt;");
    expect(html).not.toContain("<b>");
  });
});

// ─── _readSlot (DOM filter parser) ──────────────────────────────────────────
describe("_readSlot", () => {
  beforeEach(() => { document.body.appendChild(buildStatsPanel()); });

  it("parses a comma-separated doc-id list, dropping non-numbers", () => {
    (document.getElementById("stats-a-doc-ids") as HTMLInputElement).value = " 1, 3 , x, 7 ";
    expect(_readSlot("a").doc_ids).toEqual([1, 3, 7]);
  });

  it("returns null doc_ids when the field is empty", () => {
    expect(_readSlot("a").doc_ids).toBeNull();
  });

  it("clamps top_n to [5, 500]", () => {
    const topN = document.getElementById("stats-top-n") as HTMLInputElement;
    topN.value = "9999";
    expect(_readSlot("a").top_n).toBe(500);
    topN.value = "1";
    expect(_readSlot("a").top_n).toBe(5);
  });
});

// ─── populateStatsSelects (state → <option>s) ───────────────────────────────
describe("populateStatsSelects", () => {
  it("fills language options deduped + sorted, with an 'all' default", () => {
    state.docs = [doc({ language: "fr" }), doc({ language: "en" }), doc({ language: "fr" })] as never;
    document.body.appendChild(buildStatsPanel());
    populateStatsSelects();
    const sel = document.getElementById("stats-a-lang") as HTMLSelectElement;
    expect([...sel.options].map(o => o.value)).toEqual(["", "en", "fr"]);
  });
});

// ─── buildStatsPanel + toggleStatsPanel (smoke) ─────────────────────────────
describe("stats panel build + toggle", () => {
  it("builds the key structure (slots, controls, results) hidden by default", () => {
    const panel = buildStatsPanel();
    document.body.appendChild(panel);
    expect(panel.classList.contains("hidden")).toBe(true);
    expect(panel.querySelector("#stats-slot-a")).not.toBeNull();
    expect(panel.querySelector("#stats-slot-b")).not.toBeNull();
    expect(panel.querySelector("#stats-run-btn")).not.toBeNull();
    expect(panel.querySelector("#stats-results")).not.toBeNull();
  });

  it("toggles the panel open and closed", () => {
    document.body.appendChild(buildStatsPanel());
    const panel = document.getElementById("stats-panel")!;
    toggleStatsPanel(true);
    expect(panel.classList.contains("hidden")).toBe(false);
    toggleStatsPanel(false);
    expect(panel.classList.contains("hidden")).toBe(true);
  });
});
