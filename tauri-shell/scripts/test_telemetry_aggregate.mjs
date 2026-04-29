/**
 * test_telemetry_aggregate.mjs
 * Standalone Node.js ESM tests for telemetry NDJSON aggregation pure functions.
 * Run: node tauri-shell/scripts/test_telemetry_aggregate.mjs
 *
 * Mirror le contenu de tauri-shell/src/diagnostics.ts § Telemetry aggregation.
 * Suit le pattern test_diagnostics.mjs (Node.js pur, pas de Vitest pour Shell).
 */

// ─── Replicate pure logic (mirror of diagnostics.ts) ──────────────────────────

function parseTelemetryNdjson(content) {
  const records = [];
  let parseErrors = 0;
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const obj = JSON.parse(line);
      if (obj && typeof obj === "object" && typeof obj.event === "string") {
        records.push(obj);
      } else {
        parseErrors++;
      }
    } catch {
      parseErrors++;
    }
  }
  return { records, parseErrors };
}

function aggregateTelemetry(records, parseErrors = 0) {
  const stats = {
    total_events: records.length,
    by_event: {},
    by_stage: {},
    caps_hit: [],
    top_errors: [],
    parse_errors: parseErrors,
    first_ts: null,
    last_ts: null,
  };

  const stageDurations = {};
  const stageSuccess = {};
  const capsCount = {};
  const errorsCount = {};

  for (const rec of records) {
    stats.by_event[rec.event] = (stats.by_event[rec.event] || 0) + 1;
    if (typeof rec.ts === "string") {
      if (stats.first_ts === null || rec.ts < stats.first_ts) stats.first_ts = rec.ts;
      if (stats.last_ts === null || rec.ts > stats.last_ts) stats.last_ts = rec.ts;
    }
    if (rec.event === "stage_completed") {
      const stage = String(rec.stage ?? "unknown");
      const dur = typeof rec.duration_ms === "number" ? rec.duration_ms : 0;
      const success = rec.success === true;
      if (!stageDurations[stage]) stageDurations[stage] = [];
      stageDurations[stage].push(dur);
      if (success) stageSuccess[stage] = (stageSuccess[stage] || 0) + 1;
    } else if (rec.event === "cap_hit") {
      const cap = String(rec.cap_name ?? "unknown");
      capsCount[cap] = (capsCount[cap] || 0) + 1;
    } else if (rec.event === "error_user_facing") {
      const cls = String(rec.error_class ?? "unknown");
      errorsCount[cls] = (errorsCount[cls] || 0) + 1;
    }
  }

  for (const stage of Object.keys(stageDurations)) {
    const durs = stageDurations[stage];
    const completed = durs.length;
    const success = stageSuccess[stage] || 0;
    const avg = completed > 0 ? Math.round(durs.reduce((a, b) => a + b, 0) / completed) : 0;
    stats.by_stage[stage] = { completed, success, avg_duration_ms: avg };
  }

  stats.caps_hit = Object.entries(capsCount)
    .map(([cap_name, count]) => ({ cap_name, count }))
    .sort((a, b) => b.count - a.count);

  stats.top_errors = Object.entries(errorsCount)
    .map(([error_class, count]) => ({ error_class, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return stats;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error(`  ✗ ${msg}`); }
}
function eq(a, b, msg) { assert(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }

console.log("─── parseTelemetryNdjson ───");
{
  const { records, parseErrors } = parseTelemetryNdjson("");
  eq(records.length, 0, "empty input → 0 records");
  eq(parseErrors, 0, "empty input → 0 parse errors");
}
{
  const ndjson = [
    '{"ts":"2026-04-29T10:00:00.000Z","event":"sidecar_started","version":"0.8.4"}',
    '{"ts":"2026-04-29T10:00:01.500Z","event":"stage_completed","stage":"import","duration_ms":1500,"success":true,"doc_id":1}',
    '{"ts":"2026-04-29T10:00:02.000Z","event":"cap_hit","cap_name":"curate_preview_5000","actual_count":7000}',
    '',  // blank line — should be skipped
    'not-json',  // malformed line → parse error
    '{"event":"no_ts"}',  // valid JSON, no ts — accepted
  ].join("\n");
  const { records, parseErrors } = parseTelemetryNdjson(ndjson);
  eq(records.length, 4, "4 valid records");
  eq(parseErrors, 1, "1 parse error from 'not-json'");
}
{
  // Object without "event" field → not a valid telemetry record
  const ndjson = '{"ts":"2026-04-29","foo":"bar"}\n[1,2,3]\n"just a string"';
  const { records, parseErrors } = parseTelemetryNdjson(ndjson);
  eq(records.length, 0, "no records when 'event' missing or non-object");
  eq(parseErrors, 3, "3 parse errors for non-record shapes");
}

console.log("─── aggregateTelemetry — empty ───");
{
  const s = aggregateTelemetry([], 0);
  eq(s.total_events, 0, "0 events");
  eq(s.by_event, {}, "empty by_event");
  eq(s.by_stage, {}, "empty by_stage");
  eq(s.caps_hit, [], "empty caps_hit");
  eq(s.top_errors, [], "empty top_errors");
  eq(s.first_ts, null, "first_ts null");
  eq(s.last_ts, null, "last_ts null");
}

console.log("─── aggregateTelemetry — typical session ───");
{
  const records = [
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
  ];
  const s = aggregateTelemetry(records, 2);
  eq(s.total_events, 12, "12 events total");
  eq(s.by_event.sidecar_started, 1, "1 sidecar_started");
  eq(s.by_event.stage_completed, 3, "3 stage_completed");
  eq(s.by_event.cap_hit, 3, "3 cap_hit");
  eq(s.by_event.error_user_facing, 3, "3 error_user_facing");
  eq(s.by_event.doc_deleted, 1, "1 doc_deleted");
  eq(s.by_event.stage_returned, 1, "1 stage_returned");
  eq(s.parse_errors, 2, "parse_errors carried through");
  eq(s.first_ts, "2026-04-29T10:00:00.000Z", "first_ts");
  eq(s.last_ts, "2026-04-29T10:00:50.000Z", "last_ts");

  // by_stage
  eq(s.by_stage.import.completed, 1, "import 1 run");
  eq(s.by_stage.import.success, 1, "import 1 success");
  eq(s.by_stage.import.avg_duration_ms, 1500, "import avg 1500 ms");
  eq(s.by_stage.segment.completed, 2, "segment 2 runs");
  eq(s.by_stage.segment.success, 1, "segment 1 success out of 2");
  eq(s.by_stage.segment.avg_duration_ms, 4000, "segment avg (3500+4500)/2");

  // caps_hit sorted desc
  eq(s.caps_hit[0], { cap_name: "curate_preview_5000", count: 2 }, "top cap = curate_preview_5000");
  eq(s.caps_hit[1], { cap_name: "dom_raw_pane_5000", count: 1 }, "second cap");
  eq(s.caps_hit.length, 2, "2 distinct caps");

  // top_errors sorted desc
  eq(s.top_errors[0], { error_class: "SidecarError", count: 2 }, "top error = SidecarError");
  eq(s.top_errors[1], { error_class: "ValidationError", count: 1 }, "second error");
}

console.log("─── aggregateTelemetry — top_errors limited to 5 ───");
{
  const records = [];
  for (let i = 0; i < 8; i++) {
    records.push({ event: "error_user_facing", error_class: `Err${i}`, ts: `2026-01-01T00:00:0${i}.000Z` });
  }
  const s = aggregateTelemetry(records);
  eq(s.top_errors.length, 5, "top_errors capped at 5");
}

console.log("─── aggregateTelemetry — stage with all-success ───");
{
  const records = [
    { event: "stage_completed", stage: "curate", duration_ms: 100, success: true },
    { event: "stage_completed", stage: "curate", duration_ms: 200, success: true },
  ];
  const s = aggregateTelemetry(records);
  eq(s.by_stage.curate.success, 2, "2/2 success");
  eq(s.by_stage.curate.avg_duration_ms, 150, "avg of [100,200]");
}

console.log("─── aggregateTelemetry — malformed payloads survive ───");
{
  // missing fields shouldn't crash
  const records = [
    { event: "stage_completed" },                    // no stage, no duration
    { event: "cap_hit" },                              // no cap_name
    { event: "error_user_facing" },                    // no error_class
    { event: "stage_completed", stage: "x", success: "not-bool", duration_ms: "nope" },  // wrong types
  ];
  const s = aggregateTelemetry(records);
  // Doesn't throw; defaults applied
  assert(s.by_stage.unknown !== undefined || s.by_stage.x !== undefined, "stages bucketed under fallback names");
  assert(s.caps_hit.find(c => c.cap_name === "unknown"), "unknown cap_name handled");
  assert(s.top_errors.find(e => e.error_class === "unknown"), "unknown error_class handled");
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(50)}`);
console.log(`Tests passed: ${passed}, failed: ${failed}`);
if (failed > 0) {
  console.error(`✗ ${failed} test(s) failed`);
  process.exit(1);
} else {
  console.log("✓ All telemetry aggregation tests passed");
}
