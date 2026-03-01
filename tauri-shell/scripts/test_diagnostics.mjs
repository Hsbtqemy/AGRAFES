/**
 * test_diagnostics.mjs
 * Standalone Node.js ESM tests for pure functions in diagnostics.ts.
 * Run: node tauri-shell/scripts/test_diagnostics.mjs
 *
 * Pure functions under test (replicated inline — no Tauri runtime required):
 *   - redactPath(p)
 *   - formatDiagnosticsText(diag)
 */

// ─── Replicate pure logic (no DOM, no Tauri) ──────────────────────────────────

/** Keep last 2 path segments only (mirrored from diagnostics.ts). */
function redactPath(p) {
  if (!p) return "(none)";
  const normalized = p.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  const safe = parts.slice(-2).join("/");
  return safe || "(none)";
}

/** Format a Diag object as human-readable text (mirrored from diagnostics.ts). */
function formatDiagnosticsText(diag) {
  const hr = "─".repeat(48);
  const sec = (title) => `\n${hr}\n## ${title}\n${hr}`;

  const fmtSize = (b) => {
    if (b === null) return "N/A";
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(2)} MB`;
  };

  const lines = [
    "=".repeat(48),
    "  AGRAFES — Diagnostic System Report",
    "=".repeat(48),
    `Collected: ${diag.collected_at}`,
    "",
    sec("Versions"),
    `App version      : v${diag.app_version}`,
    `Engine version   : ${diag.engine_version}`,
    `Contract version : ${diag.contract_version}`,
    `TEI profiles     : ${diag.tei_profiles.join(", ")}`,
    "",
    sec("Sidecar"),
    `Running          : ${diag.sidecar.running ? "yes" : "no"}`,
    ...(diag.sidecar.running ? [
      `Host/Port        : ${diag.sidecar.host ?? "?"}:${diag.sidecar.port ?? "?"}`,
      `Token required   : ${diag.sidecar.token_required ? "yes" : "no"}`,
    ] : []),
    ...(diag.sidecar.error ? [`Error            : ${diag.sidecar.error}`] : []),
    "",
    sec("Environment"),
    `Platform         : ${diag.environment.platform}`,
    `Locale           : ${diag.environment.locale}`,
    `Window size      : ${diag.environment.window_size.w}×${diag.environment.window_size.h}`,
    `Tauri runtime    : ${diag.environment.tauri_available ? "yes" : "no"}`,
    `User-Agent       : ${diag.environment.user_agent}`,
    "",
    sec("Database"),
    `Active DB        : ${diag.db.active_basename ?? "(none)"}`,
    `Size             : ${fmtSize(diag.db.size_bytes)}`,
    `MRU entries      : ${diag.db.mru_count} (${diag.db.pinned_count} pinned)`,
    "",
    sec("Preferences"),
    `QA policy        : ${diag.prefs.last_qa_policy ?? "(not set)"}`,
    `TEI profile      : ${diag.prefs.last_tei_profile ?? "(not set)"}`,
    `Onboarding step  : ${diag.prefs.onboarding_step ?? "(not set)"}`,
    `Global presets   : ${diag.prefs.global_presets_count}`,
    "",
  ];

  if (diag.errors.length > 0) {
    lines.push(sec("Collection Errors"));
    diag.errors.forEach(e => lines.push(`  ! ${e}`));
    lines.push("");
  }

  if (diag.log_tail.length > 0) {
    lines.push(sec(`Session Log (last ${diag.log_tail.length} entries)`));
    diag.log_tail.forEach(l => lines.push(l));
    lines.push("");
  }

  lines.push("=".repeat(48));
  lines.push("  End of diagnostic report");
  lines.push("=".repeat(48));

  return lines.join("\n");
}

// ─── Test harness ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(cond, label) {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    failed++;
  }
}

function assertEq(a, b, label) {
  if (a === b) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    console.error(`    expected: ${JSON.stringify(b)}`);
    console.error(`    received: ${JSON.stringify(a)}`);
    failed++;
  }
}

// ─── redactPath tests ─────────────────────────────────────────────────────────

console.log("\n── redactPath ──────────────────────────────────────────────────");

assertEq(redactPath(null), "(none)", "null → (none)");
assertEq(redactPath(undefined), "(none)", "undefined → (none)");
assertEq(redactPath(""), "(none)", "empty string → (none)");

assertEq(
  redactPath("/Users/alice/Library/Application Support/com.agrafes.app/corpora/mon_corpus.db"),
  "corpora/mon_corpus.db",
  "macOS deep path: last 2 segments only"
);

assertEq(
  redactPath("C:\\Users\\alice\\AppData\\Roaming\\agrafes\\corpora\\test.db"),
  "corpora/test.db",
  "Windows path: last 2 segments, slashes normalized"
);

assertEq(
  redactPath("/home/alice/agrafes/foo.db"),
  "agrafes/foo.db",
  "Linux path: last 2 segments"
);

assertEq(
  redactPath("corpus.db"),
  "corpus.db",
  "Single segment: returned as-is (no slash)"
);

assertEq(
  redactPath("/corpus.db"),
  "corpus.db",
  "Root-level file: only segment"
);

// ─── formatDiagnosticsText tests ─────────────────────────────────────────────

console.log("\n── formatDiagnosticsText ───────────────────────────────────────");

/** Minimal valid Diag fixture */
const BASE_DIAG = {
  collected_at: "2026-03-01T10:00:00.000Z",
  app_version: "1.9.0",
  engine_version: "0.6.1",
  contract_version: "1.4.0",
  tei_profiles: ["generic", "parcolab_like", "parcolab_strict"],
  sidecar: { running: false },
  environment: {
    platform: "MacIntel",
    user_agent: "Mozilla/5.0 (Tauri)",
    tauri_available: true,
    window_size: { w: 1280, h: 800 },
    locale: "fr-FR",
  },
  db: {
    active_basename: "corpora/corpus_test.db",
    size_bytes: 2097152,
    mru_count: 3,
    pinned_count: 1,
  },
  prefs: {
    last_qa_policy: "strict",
    last_tei_profile: "parcolab_strict",
    onboarding_step: 3,
    global_presets_count: 2,
  },
  log_tail: [],
  errors: [],
};

const txt = formatDiagnosticsText(BASE_DIAG);

assert(typeof txt === "string" && txt.length > 200, "output is a non-trivial string");
assert(txt.includes("AGRAFES — Diagnostic System Report"), "header present");
assert(txt.includes("## Versions"), "Versions section present");
assert(txt.includes("v1.9.0"), "app_version correct");
assert(txt.includes("0.6.1"), "engine_version correct");
assert(txt.includes("generic, parcolab_like, parcolab_strict"), "TEI profiles listed");
assert(txt.includes("## Sidecar"), "Sidecar section present");
assert(txt.includes("Running          : no"), "sidecar not running");
assert(!txt.includes("Host/Port"), "no host/port when not running");
assert(txt.includes("## Environment"), "Environment section present");
assert(txt.includes("MacIntel"), "platform shown");
assert(txt.includes("fr-FR"), "locale shown");
assert(txt.includes("1280×800"), "window size formatted");
assert(txt.includes("## Database"), "Database section present");
assert(txt.includes("corpora/corpus_test.db"), "db basename shown");
assert(txt.includes("2.00 MB"), "size_bytes formatted as MB");
assert(txt.includes("3 (1 pinned)"), "MRU count formatted");
assert(txt.includes("## Preferences"), "Preferences section present");
assert(txt.includes("strict"), "qa_policy shown");
assert(!txt.includes("Collection Errors"), "no error section when errors=[]");
assert(!txt.includes("Session Log"), "no log section when log_tail=[]");
assert(txt.includes("End of diagnostic report"), "footer present");

// With sidecar running
const diagRunning = {
  ...BASE_DIAG,
  sidecar: { running: true, host: "127.0.0.1", port: 54321, token_required: false,
             engine_version: "0.6.1", contract_version: "1.4.0" },
};
const txtRunning = formatDiagnosticsText(diagRunning);
assert(txtRunning.includes("Running          : yes"), "sidecar running=yes");
assert(txtRunning.includes("127.0.0.1:54321"), "host:port shown when running");
assert(txtRunning.includes("Token required   : no"), "token_required=false shown");

// With errors
const diagErr = { ...BASE_DIAG, errors: ["sidecar probe failed: timeout"] };
const txtErr = formatDiagnosticsText(diagErr);
assert(txtErr.includes("## Collection Errors"), "error section present when non-empty");
assert(txtErr.includes("sidecar probe failed: timeout"), "error message shown");

// With log tail
const diagLogs = {
  ...BASE_DIAG,
  log_tail: [
    "[10:00:00.000Z] [INFO] [boot] Started in mode: home",
    "[10:01:00.000Z] [INFO] [db_switch] Switched to corpus.db",
  ],
};
const txtLogs = formatDiagnosticsText(diagLogs);
assert(txtLogs.includes("Session Log (last 2 entries)"), "log section title with count");
assert(txtLogs.includes("[boot] Started in mode: home"), "log entry shown");

// Size formatting
const diagKB = { ...BASE_DIAG, db: { ...BASE_DIAG.db, size_bytes: 512 } };
assert(formatDiagnosticsText(diagKB).includes("512 B"), "size < 1024 → bytes");

const diagMB2 = { ...BASE_DIAG, db: { ...BASE_DIAG.db, size_bytes: 51200 } };
assert(formatDiagnosticsText(diagMB2).includes("50.0 KB"), "size < 1MB → KB");

const diagNull = { ...BASE_DIAG, db: { ...BASE_DIAG.db, size_bytes: null } };
assert(formatDiagnosticsText(diagNull).includes("N/A"), "null size → N/A");

// No prefs set
const diagNoPrefs = {
  ...BASE_DIAG,
  prefs: { last_qa_policy: null, last_tei_profile: null, onboarding_step: null, global_presets_count: 0 },
};
const txtNoPrefs = formatDiagnosticsText(diagNoPrefs);
assert(txtNoPrefs.includes("QA policy        : (not set)"), "null qa_policy → (not set)");
assert(txtNoPrefs.includes("TEI profile      : (not set)"), "null tei_profile → (not set)");

// ─── RELEASES_URL + buildReleaseUrl (V1.9.1) ─────────────────────────────────

console.log("\n── RELEASES_URL / buildReleaseUrl ──────────────────────────────");

/**
 * Pure function mirrored from shell.ts.
 * Allows overriding the base URL (useful for testing without Tauri runtime).
 */
function buildReleaseUrl(base, tag) {
  if (tag) return `${base}/tag/${encodeURIComponent(tag)}`;
  return base;
}

const RELEASES_URL = "https://github.com/Hsbtqemy/AGRAFES/releases";

// Shape
assert(typeof RELEASES_URL === "string", "RELEASES_URL is a string");
assert(RELEASES_URL.startsWith("https://"), "RELEASES_URL uses HTTPS");
assert(RELEASES_URL.includes("github.com"), "RELEASES_URL points to GitHub");
assert(RELEASES_URL.endsWith("/releases"), "RELEASES_URL ends with /releases");
assert(!RELEASES_URL.endsWith("/"), "RELEASES_URL has no trailing slash");

// No sensitive data
assert(!RELEASES_URL.includes("token"), "RELEASES_URL contains no token");
assert(!RELEASES_URL.includes("secret"), "RELEASES_URL contains no secret");

// buildReleaseUrl — base (no tag)
assertEq(buildReleaseUrl(RELEASES_URL, null), RELEASES_URL, "no tag → base URL unchanged");
assertEq(buildReleaseUrl(RELEASES_URL, undefined), RELEASES_URL, "undefined tag → base URL unchanged");
assertEq(buildReleaseUrl(RELEASES_URL, ""), RELEASES_URL, "empty tag → base URL unchanged");

// buildReleaseUrl — with tag
assertEq(
  buildReleaseUrl(RELEASES_URL, "v1.9.1"),
  "https://github.com/Hsbtqemy/AGRAFES/releases/tag/v1.9.1",
  "specific tag → /releases/tag/<tag>"
);
assertEq(
  buildReleaseUrl(RELEASES_URL, "v1.9.1+build.42"),
  "https://github.com/Hsbtqemy/AGRAFES/releases/tag/v1.9.1%2Bbuild.42",
  "tag with special chars → percent-encoded"
);

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
