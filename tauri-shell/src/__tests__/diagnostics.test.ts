/**
 * Unit tests for the REAL diagnostics.ts pure functions (T-05).
 *
 * Replaces scripts/test_diagnostics.mjs, which tested a *copy* of redactPath /
 * formatDiagnosticsText replicated inline. Here we import the actual exports so
 * the tests track the real source.
 *
 * Dropped from the .mjs: the RELEASES_URL / buildReleaseUrl block. buildReleaseUrl
 * has no production counterpart (shell.ts uses opts.releaseUrl directly and never
 * builds /tag/<tag>), and RELEASES_URL is an unexported const inside the
 * side-effectful shell.ts module — not importable in isolation. Testing a mirrored
 * fiction gives false confidence; see the Phase 2 lesson (test real code, not copies).
 */

import { describe, expect, it } from "vitest";

import { type Diag, formatDiagnosticsText, redactPath } from "../diagnostics";

describe("redactPath", () => {
  it("returns (none) for empty inputs", () => {
    expect(redactPath(null)).toBe("(none)");
    expect(redactPath(undefined)).toBe("(none)");
    expect(redactPath("")).toBe("(none)");
  });

  it("keeps only the last 2 segments of a deep macOS path", () => {
    expect(
      redactPath(
        "/Users/alice/Library/Application Support/com.agrafes.app/corpora/mon_corpus.db",
      ),
    ).toBe("corpora/mon_corpus.db");
  });

  it("normalizes Windows backslashes and keeps the last 2 segments", () => {
    expect(
      redactPath("C:\\Users\\alice\\AppData\\Roaming\\agrafes\\corpora\\test.db"),
    ).toBe("corpora/test.db");
  });

  it("keeps the last 2 segments of a Linux path", () => {
    expect(redactPath("/home/alice/agrafes/foo.db")).toBe("agrafes/foo.db");
  });

  it("returns a single-segment name as-is", () => {
    expect(redactPath("corpus.db")).toBe("corpus.db");
    expect(redactPath("/corpus.db")).toBe("corpus.db");
  });
});

/** Minimal valid Diag fixture (sidecar not running, no errors, no logs). */
const BASE_DIAG: Diag = {
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

describe("formatDiagnosticsText", () => {
  it("renders all base sections from a typical Diag", () => {
    const txt = formatDiagnosticsText(BASE_DIAG);
    expect(typeof txt).toBe("string");
    expect(txt.length).toBeGreaterThan(200);
    expect(txt).toContain("AGRAFES — Diagnostic System Report");
    expect(txt).toContain("## Versions");
    expect(txt).toContain("v1.9.0");
    expect(txt).toContain("0.6.1");
    expect(txt).toContain("generic, parcolab_like, parcolab_strict");
    expect(txt).toContain("## Sidecar");
    expect(txt).toContain("Running          : no");
    expect(txt).not.toContain("Host/Port");
    expect(txt).toContain("## Environment");
    expect(txt).toContain("MacIntel");
    expect(txt).toContain("fr-FR");
    expect(txt).toContain("1280×800");
    expect(txt).toContain("## Database");
    expect(txt).toContain("corpora/corpus_test.db");
    expect(txt).toContain("2.00 MB");
    expect(txt).toContain("3 (1 pinned)");
    expect(txt).toContain("## Preferences");
    expect(txt).toContain("strict");
    expect(txt).not.toContain("Collection Errors");
    expect(txt).not.toContain("Session Log");
    expect(txt).toContain("End of diagnostic report");
  });

  it("shows host/port and token state when the sidecar is running", () => {
    const txt = formatDiagnosticsText({
      ...BASE_DIAG,
      sidecar: {
        running: true,
        host: "127.0.0.1",
        port: 54321,
        token_required: false,
        engine_version: "0.6.1",
        contract_version: "1.4.0",
      },
    });
    expect(txt).toContain("Running          : yes");
    expect(txt).toContain("127.0.0.1:54321");
    expect(txt).toContain("Token required   : no");
  });

  it("adds a Collection Errors section only when errors are present", () => {
    const txt = formatDiagnosticsText({
      ...BASE_DIAG,
      errors: ["sidecar probe failed: timeout"],
    });
    expect(txt).toContain("## Collection Errors");
    expect(txt).toContain("sidecar probe failed: timeout");
  });

  it("adds a Session Log section with the entry count", () => {
    const txt = formatDiagnosticsText({
      ...BASE_DIAG,
      log_tail: [
        "[10:00:00.000Z] [INFO] [boot] Started in mode: home",
        "[10:01:00.000Z] [INFO] [db_switch] Switched to corpus.db",
      ],
    });
    expect(txt).toContain("Session Log (last 2 entries)");
    expect(txt).toContain("[boot] Started in mode: home");
  });

  it("formats db size across units (B / KB / MB / N/A)", () => {
    const withSize = (size_bytes: number | null) =>
      formatDiagnosticsText({ ...BASE_DIAG, db: { ...BASE_DIAG.db, size_bytes } });
    expect(withSize(512)).toContain("512 B");
    expect(withSize(51200)).toContain("50.0 KB");
    expect(withSize(2097152)).toContain("2.00 MB");
    expect(withSize(null)).toContain("N/A");
  });

  it("shows (not set) for null preferences", () => {
    const txt = formatDiagnosticsText({
      ...BASE_DIAG,
      prefs: {
        last_qa_policy: null,
        last_tei_profile: null,
        onboarding_step: null,
        global_presets_count: 0,
      },
    });
    expect(txt).toContain("QA policy        : (not set)");
    expect(txt).toContain("TEI profile      : (not set)");
  });
});
