/**
 * Unit tests for the REAL telemetry-aggregation functions in diagnostics.ts (T-05).
 *
 * Replaces scripts/test_telemetry_aggregate.mjs, which tested an inline *copy* of
 * parseTelemetryNdjson / aggregateTelemetry / formatTelemetryStats. Here we import
 * the actual exports so the tests track the real source.
 */

import { describe, expect, it } from "vitest";

import {
  aggregateTelemetry,
  formatTelemetryStats,
  parseTelemetryNdjson,
  type TelemetryRecord,
} from "../diagnostics";

/**
 * Cast inline fixtures to TelemetryRecord[]. Some tests deliberately pass records
 * missing `ts` or with wrong-typed payload fields to exercise runtime robustness —
 * exactly the malformed input the parser/aggregator must survive — so the cast is
 * intentional, not a type shortcut.
 */
const recs = (arr: Array<Record<string, unknown>>): TelemetryRecord[] =>
  arr as TelemetryRecord[];

describe("parseTelemetryNdjson", () => {
  it("returns nothing for empty input", () => {
    const { records, parseErrors } = parseTelemetryNdjson("");
    expect(records.length).toBe(0);
    expect(parseErrors).toBe(0);
  });

  it("keeps valid records, skips blank lines, counts malformed ones", () => {
    const ndjson = [
      '{"ts":"2026-04-29T10:00:00.000Z","event":"sidecar_started","version":"0.8.4"}',
      '{"ts":"2026-04-29T10:00:01.500Z","event":"stage_completed","stage":"import","duration_ms":1500,"success":true,"doc_id":1}',
      '{"ts":"2026-04-29T10:00:02.000Z","event":"cap_hit","cap_name":"curate_preview_5000","actual_count":7000}',
      "", // blank — skipped
      "not-json", // malformed → parse error
      '{"event":"no_ts"}', // valid JSON, no ts — accepted (only `event` is required)
    ].join("\n");
    const { records, parseErrors } = parseTelemetryNdjson(ndjson);
    expect(records.length).toBe(4);
    expect(parseErrors).toBe(1);
  });

  it("rejects JSON that is not a record with a string `event`", () => {
    const ndjson = '{"ts":"2026-04-29","foo":"bar"}\n[1,2,3]\n"just a string"';
    const { records, parseErrors } = parseTelemetryNdjson(ndjson);
    expect(records.length).toBe(0);
    expect(parseErrors).toBe(3);
  });
});

describe("aggregateTelemetry", () => {
  it("returns a zeroed shape for no records", () => {
    const s = aggregateTelemetry([], 0);
    expect(s.total_events).toBe(0);
    expect(s.by_event).toEqual({});
    expect(s.by_stage).toEqual({});
    expect(s.caps_hit).toEqual([]);
    expect(s.top_errors).toEqual([]);
    expect(s.first_ts).toBeNull();
    expect(s.last_ts).toBeNull();
  });

  it("aggregates a typical session correctly", () => {
    const records = recs([
      { ts: "2026-04-29T10:00:00.000Z", event: "sidecar_started", version: "0.8.4" },
      { ts: "2026-04-29T10:00:01.500Z", event: "stage_completed", stage: "import", duration_ms: 1500, success: true, doc_id: 1 },
      { ts: "2026-04-29T10:00:05.000Z", event: "stage_completed", stage: "segment", duration_ms: 3500, success: true, doc_id: 1 },
      { ts: "2026-04-29T10:00:10.000Z", event: "stage_completed", stage: "segment", duration_ms: 4500, success: false, doc_id: 2 },
      { ts: "2026-04-29T10:00:15.000Z", event: "cap_hit", cap_name: "curate_preview_5000", actual_count: 7000, doc_id: 1 },
      { ts: "2026-04-29T10:00:20.000Z", event: "cap_hit", cap_name: "curate_preview_5000", actual_count: 8000, doc_id: 2 },
      { ts: "2026-04-29T10:00:25.000Z", event: "cap_hit", cap_name: "dom_raw_pane_5000", actual_count: 6000, doc_id: 1 },
      { ts: "2026-04-29T10:00:30.000Z", event: "error_user_facing", error_class: "SidecarError", stage: "curate", doc_id: 1 },
      { ts: "2026-04-29T10:00:32.000Z", event: "error_user_facing", error_class: "SidecarError", stage: "align", doc_id: 1 },
      { ts: "2026-04-29T10:00:35.000Z", event: "error_user_facing", error_class: "ValidationError", stage: "import" },
      { ts: "2026-04-29T10:00:40.000Z", event: "doc_deleted", doc_id: 5, had_curation: true, had_alignment: false },
      { ts: "2026-04-29T10:00:50.000Z", event: "stage_returned", from_stage: "curate", to_stage: "segment", doc_id: 1 },
    ]);
    const s = aggregateTelemetry(records, 2);

    expect(s.total_events).toBe(12);
    expect(s.by_event.sidecar_started).toBe(1);
    expect(s.by_event.stage_completed).toBe(3);
    expect(s.by_event.cap_hit).toBe(3);
    expect(s.by_event.error_user_facing).toBe(3);
    expect(s.by_event.doc_deleted).toBe(1);
    expect(s.by_event.stage_returned).toBe(1);
    expect(s.parse_errors).toBe(2);
    expect(s.first_ts).toBe("2026-04-29T10:00:00.000Z");
    expect(s.last_ts).toBe("2026-04-29T10:00:50.000Z");

    expect(s.by_stage.import).toEqual({ completed: 1, success: 1, avg_duration_ms: 1500 });
    expect(s.by_stage.segment).toEqual({ completed: 2, success: 1, avg_duration_ms: 4000 });

    expect(s.caps_hit).toEqual([
      { cap_name: "curate_preview_5000", count: 2 },
      { cap_name: "dom_raw_pane_5000", count: 1 },
    ]);

    expect(s.top_errors).toEqual([
      { error_class: "SidecarError", count: 2 },
      { error_class: "ValidationError", count: 1 },
    ]);
  });

  it("caps top_errors at 5", () => {
    const records = recs(
      Array.from({ length: 8 }, (_, i) => ({
        event: "error_user_facing",
        error_class: `Err${i}`,
        ts: `2026-01-01T00:00:0${i}.000Z`,
      })),
    );
    expect(aggregateTelemetry(records).top_errors.length).toBe(5);
  });

  it("averages stage durations and counts all-success runs", () => {
    const s = aggregateTelemetry(
      recs([
        { event: "stage_completed", stage: "curate", duration_ms: 100, success: true },
        { event: "stage_completed", stage: "curate", duration_ms: 200, success: true },
      ]),
    );
    expect(s.by_stage.curate).toEqual({ completed: 2, success: 2, avg_duration_ms: 150 });
  });

  it("survives malformed payloads with fallback names and defaults", () => {
    const s = aggregateTelemetry(
      recs([
        { event: "stage_completed" }, // no stage, no duration → "unknown", 0ms
        { event: "cap_hit" }, // no cap_name → "unknown"
        { event: "error_user_facing" }, // no error_class → "unknown"
        { event: "stage_completed", stage: "x", success: "not-bool", duration_ms: "nope" }, // wrong types
      ]),
    );
    expect(s.by_stage.unknown ?? s.by_stage.x).toBeDefined();
    expect(s.caps_hit.find((c) => c.cap_name === "unknown")).toBeDefined();
    expect(s.top_errors.find((e) => e.error_class === "unknown")).toBeDefined();
  });
});

describe("formatTelemetryStats", () => {
  it("reports the empty case", () => {
    const txt = formatTelemetryStats(aggregateTelemetry([], 0));
    expect(txt).toContain("Aucun événement");
    expect(txt).not.toContain("Total :");
  });

  it("mentions parse errors even when there are no events", () => {
    const txt = formatTelemetryStats(aggregateTelemetry([], 3));
    expect(txt).toContain("3 ligne(s) malformée");
  });

  it("renders every populated section", () => {
    const s = aggregateTelemetry(
      recs([
        { ts: "2026-04-29T10:00:00.000Z", event: "stage_completed", stage: "import", duration_ms: 1500, success: true },
        { ts: "2026-04-29T10:00:05.000Z", event: "stage_completed", stage: "curate", duration_ms: 800, success: false },
        { ts: "2026-04-29T10:00:10.000Z", event: "cap_hit", cap_name: "curate_preview_5000", actual_count: 7000 },
        { ts: "2026-04-29T10:00:15.000Z", event: "error_user_facing", error_class: "SidecarError" },
      ]),
      0,
    );
    const txt = formatTelemetryStats(s);
    expect(txt).toContain("Total : 4 événement");
    expect(txt).toContain("Période :");
    expect(txt).toContain("Répartition par event");
    expect(txt).toContain("stage_completed");
    expect(txt).toContain("Stages (durée moyenne");
    expect(txt).toContain("import");
    expect(txt).toContain("1500 ms");
    expect(txt).toContain("curate");
    expect(txt).toContain("0/1");
    expect(txt).toContain("Caps atteints");
    expect(txt).toContain("curate_preview_5000");
    expect(txt).toContain("Top erreurs");
    expect(txt).toContain("SidecarError");
  });

  it("omits sections that have no data", () => {
    const s = aggregateTelemetry(
      recs([
        { ts: "2026-04-29T10:00:00.000Z", event: "doc_deleted", doc_id: 1, had_curation: false, had_alignment: false },
      ]),
      0,
    );
    const txt = formatTelemetryStats(s);
    expect(txt).toContain("doc_deleted");
    expect(txt).not.toContain("Stages");
    expect(txt).not.toContain("Caps atteints");
    expect(txt).not.toContain("Top erreurs");
  });

  it("orders the by_event breakdown descending by count", () => {
    const s = aggregateTelemetry(
      recs([
        { event: "a", ts: "2026-01-01T00:00:00.000Z" },
        { event: "b", ts: "2026-01-01T00:00:00.000Z" },
        { event: "b", ts: "2026-01-01T00:00:00.000Z" },
        { event: "c", ts: "2026-01-01T00:00:00.000Z" },
        { event: "c", ts: "2026-01-01T00:00:00.000Z" },
        { event: "c", ts: "2026-01-01T00:00:00.000Z" },
      ]),
      0,
    );
    const txt = formatTelemetryStats(s);
    const cPos = txt.indexOf("\n  c ");
    const bPos = txt.indexOf("\n  b ");
    const aPos = txt.indexOf("\n  a ");
    expect(cPos).toBeLessThan(bPos);
    expect(bPos).toBeLessThan(aPos);
  });
});
