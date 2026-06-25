import { describe, it, expect } from "vitest";
import {
  yearChartData,
  yearMetricLabel,
  yearTooltipLines,
  type YearStatsRow,
} from "../modules/yearChart.ts";

const ROWS: YearStatsRow[] = [
  { value: "1850", count: 2, pct: 50.0, tokens_in_period: 6, freq_per_10k: 3333.33 },
  { value: "1900", count: 1, pct: 25.0, tokens_in_period: 2, freq_per_10k: 5000.0 },
  { value: "(sans date)", count: 1, pct: 25.0, tokens_in_period: 2, freq_per_10k: 5000.0 },
];

describe("yearChartData", () => {
  it("keeps server (chronological) order for labels", () => {
    expect(yearChartData(ROWS, "count").labels).toEqual(["1850", "1900", "(sans date)"]);
  });

  it("uses raw counts for the 'count' metric", () => {
    expect(yearChartData(ROWS, "count").data).toEqual([2, 1, 1]);
  });

  it("uses normalised freq for the 'freq' metric", () => {
    expect(yearChartData(ROWS, "freq").data).toEqual([3333.33, 5000.0, 5000.0]);
  });

  it("falls back to 0 when freq is absent", () => {
    expect(yearChartData([{ value: "1700", count: 3, pct: 100 }], "freq").data).toEqual([0]);
  });
});

describe("yearMetricLabel", () => {
  it("labels each metric", () => {
    expect(yearMetricLabel("count")).toMatch(/occurrences/i);
    expect(yearMetricLabel("freq")).toMatch(/10k/i);
  });
});

describe("yearTooltipLines", () => {
  it("always surfaces both metrics + denominator", () => {
    const lines = yearTooltipLines(ROWS[0]);
    expect(lines[0]).toContain("2 occ.");
    expect(lines.some((l) => l.includes("3333.33"))).toBe(true);
    expect(lines.some((l) => l.includes("6 tokens"))).toBe(true);
  });

  it("omits freq/denominator lines when absent (attribute-shaped row)", () => {
    expect(yearTooltipLines({ value: "x", count: 5, pct: 10 })).toEqual(["5 occ. (10%)"]);
  });
});
