/**
 * test_buildFtsQuery.mjs
 * Standalone Node.js ESM tests for buildFtsQuery + isSimpleInput logic.
 * Run: node tauri-app/scripts/test_buildFtsQuery.mjs
 */

// ─── Replicate pure logic from app.ts (no DOM) ────────────────────────────────

let _builderMode = "simple";
let _nearN = 5;

function isSimpleInput(raw) {
  return /\b(AND|OR|NOT|NEAR)\b|"/.test(raw.trim());
}

function buildFtsQuery(raw, { builderMode = _builderMode, nearN = _nearN } = {}) {
  const trimmed = raw.trim();
  if (builderMode === "simple") return trimmed;

  if (isSimpleInput(trimmed)) {
    // Guard: bypass transformation, return as-is
    return trimmed;
  }

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return "";

  if (builderMode === "phrase") {
    const escaped = trimmed.replace(/"/g, "'");
    return `"${escaped}"`;
  }
  if (builderMode === "and") return tokens.join(" AND ");
  if (builderMode === "or") return tokens.join(" OR ");
  if (builderMode === "near") {
    if (tokens.length < 2) return tokens[0] ?? "";
    return `NEAR(${tokens.join(" ")}, ${nearN})`;
  }
  return trimmed;
}

// ─── Test runner ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label, actual, expected) {
  if (actual === expected) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    console.error(`      expected: ${JSON.stringify(expected)}`);
    console.error(`      actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

function assertTrue(label, value) {
  if (value) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}: expected truthy, got ${JSON.stringify(value)}`);
    failed++;
  }
}

function assertFalse(label, value) {
  if (!value) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}: expected falsy, got ${JSON.stringify(value)}`);
    failed++;
  }
}

// ─── isSimpleInput ────────────────────────────────────────────────────────────

console.log("\nisSimpleInput:");
assertTrue("detects AND", isSimpleInput("foo AND bar"));
assertTrue("detects OR", isSimpleInput("foo OR bar"));
assertTrue("detects NOT", isSimpleInput("NOT foo"));
assertTrue("detects NEAR", isSimpleInput("NEAR(foo bar, 5)"));
assertTrue("detects quote", isSimpleInput('"expression exacte"'));
assertFalse("plain word is not FTS", isSimpleInput("chat"));
assertFalse("two plain words are not FTS", isSimpleInput("chat chien"));
assertFalse("lowercase and is not operator", isSimpleInput("black and white"));

// ─── simple mode ─────────────────────────────────────────────────────────────

console.log("\nbuildFtsQuery — simple:");
assert("passthrough", buildFtsQuery("chat", { builderMode: "simple" }), "chat");
assert("trims whitespace", buildFtsQuery("  chat  ", { builderMode: "simple" }), "chat");
assert("FTS passthrough in simple", buildFtsQuery("foo AND bar", { builderMode: "simple" }), "foo AND bar");

// ─── phrase mode ─────────────────────────────────────────────────────────────

console.log("\nbuildFtsQuery — phrase:");
assert("wraps in quotes", buildFtsQuery("le chat", { builderMode: "phrase" }), '"le chat"');
assert("single word", buildFtsQuery("chat", { builderMode: "phrase" }), '"chat"');
assert("escapes internal quote", buildFtsQuery("l'avion", { builderMode: "phrase" }), '"l\'avion"');
// Guard: if input already has FTS operators, bypass
assert("bypass on FTS operator", buildFtsQuery("foo AND bar", { builderMode: "phrase" }), "foo AND bar");

// ─── and mode ────────────────────────────────────────────────────────────────

console.log("\nbuildFtsQuery — and:");
assert("two tokens", buildFtsQuery("chat chien", { builderMode: "and" }), "chat AND chien");
assert("three tokens", buildFtsQuery("a b c", { builderMode: "and" }), "a AND b AND c");
assert("single token", buildFtsQuery("chat", { builderMode: "and" }), "chat");
assert("bypass on FTS", buildFtsQuery("foo OR bar", { builderMode: "and" }), "foo OR bar");

// ─── or mode ─────────────────────────────────────────────────────────────────

console.log("\nbuildFtsQuery — or:");
assert("two tokens", buildFtsQuery("chat chien", { builderMode: "or" }), "chat OR chien");
assert("bypass on FTS", buildFtsQuery("foo AND bar", { builderMode: "or" }), "foo AND bar");

// ─── near mode ───────────────────────────────────────────────────────────────

console.log("\nbuildFtsQuery — near:");
assert("two tokens", buildFtsQuery("chat chien", { builderMode: "near", nearN: 5 }), "NEAR(chat chien, 5)");
assert("three tokens", buildFtsQuery("a b c", { builderMode: "near", nearN: 3 }), "NEAR(a b c, 3)");
assert("single token fallback (no NEAR)", buildFtsQuery("chat", { builderMode: "near", nearN: 5 }), "chat");
assert("bypass on FTS", buildFtsQuery("NEAR(a b, 3)", { builderMode: "near", nearN: 5 }), "NEAR(a b, 3)");
assert("empty string", buildFtsQuery("", { builderMode: "near", nearN: 5 }), "");

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
