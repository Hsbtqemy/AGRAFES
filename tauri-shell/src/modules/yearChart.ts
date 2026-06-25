/**
 * Pure helpers for the temporal distribution histogram (F2b).
 *
 * `POST /token_stats` with `group_by="year"` returns chronological rows that
 * carry both a raw `count` and a normalised `freq_per_10k` (occurrences per
 * 10 000 tokens of that year, with `tokens_in_period` as the denominator).
 * These helpers shape those rows into chart data + tooltip text; the DOM /
 * Chart.js wiring lives in rechercheModule.
 */

export interface YearStatsRow {
  value: string;                       // year bucket, e.g. "1850" or "(sans date)"
  count: number;                       // raw occurrences
  pct: number;                         // share of all hits
  tokens_in_period?: number | null;    // denominator (tokens in scope that year)
  freq_per_10k?: number | null;        // normalised frequency
}

export type YearMetric = "count" | "freq";

/** Bar labels (years, in server order = chronological) + the chosen metric's values. */
export function yearChartData(
  rows: YearStatsRow[],
  metric: YearMetric,
): { labels: string[]; data: number[] } {
  return {
    labels: rows.map((r) => r.value),
    data: rows.map((r) =>
      metric === "freq" ? (r.freq_per_10k ?? 0) : r.count,
    ),
  };
}

/** Human label for the y-axis / dataset of the chosen metric. */
export function yearMetricLabel(metric: YearMetric): string {
  return metric === "freq" ? "Fréquence /10k tokens" : "Occurrences";
}

/** Tooltip lines for one year — always shows both metrics so neither is hidden. */
export function yearTooltipLines(row: YearStatsRow): string[] {
  const lines = [`${row.count} occ. (${row.pct}%)`];
  if (row.freq_per_10k != null) {
    lines.push(`${row.freq_per_10k} /10k tokens`);
  }
  if (row.tokens_in_period != null) {
    lines.push(`${row.tokens_in_period} tokens sur la période`);
  }
  return lines;
}
