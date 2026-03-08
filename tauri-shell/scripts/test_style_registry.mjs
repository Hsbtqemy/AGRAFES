/**
 * test_style_registry.mjs — Node.js unit tests for styleRegistry helpers.
 *
 * Uses a minimal JSDOM-like shim so the module can be tested outside a browser.
 * Run: node tauri-shell/scripts/test_style_registry.mjs
 */

// ─── Minimal DOM shim ────────────────────────────────────────────────────────

function makeElement(tag, idMap) {
  const el = {
    tag,
    id: "",
    rel: "",
    href: "",
    textContent: "",
    _removed: false,
    remove() { this._removed = true; delete idMap[this.id]; },
  };
  // Detect instanceof via constructor name check (shim limitation).
  el._isStyle = tag === "style";
  el._isLink  = tag === "link";
  return el;
}

function makeDom() {
  const idMap = {};   // id → element
  const children = [];

  const head = {
    get children() { return children.filter(e => !e._removed); },
    appendChild(el) {
      if (el.id) idMap[el.id] = el;
      children.push(el);
    },
  };

  const document = {
    head,
    getElementById(id) { return idMap[id] ?? null; },
    createElement(tag) { return makeElement(tag, idMap); },
  };

  // Patch instanceof checks used by styleRegistry.
  globalThis.HTMLStyleElement = { [Symbol.hasInstance](obj) { return obj?._isStyle === true; } };
  globalThis.HTMLLinkElement  = { [Symbol.hasInstance](obj) { return obj?._isLink  === true; } };

  return document;
}

// ─── Inline reimplementation of styleRegistry (mirrors the TS source) ─────────

function makeRegistry(document) {
  function ensureStyleTag(id, cssText) {
    const existing = document.getElementById(id);
    if (existing instanceof HTMLStyleElement) return existing;
    const style = document.createElement("style");
    style.id = id;
    style.textContent = cssText;
    document.head.appendChild(style);
    return style;
  }

  function ensureStylesheetLink(id, href) {
    const existing = document.getElementById(id);
    if (existing instanceof HTMLLinkElement) return existing;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.id = id;
    link.href = href;
    document.head.appendChild(link);
    return link;
  }

  function removeStyleTag(id) {
    document.getElementById(id)?.remove();
  }

  const removeLink = removeStyleTag;

  function countManagedStyles(prefix) {
    let count = 0;
    for (const el of document.head.children) {
      if ((el._isStyle || el._isLink) && el.id.startsWith(prefix)) count++;
    }
    return count;
  }

  return { ensureStyleTag, ensureStylesheetLink, removeStyleTag, removeLink, countManagedStyles };
}

// ─── Test harness ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function assert(label, condition) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
    failures.push(label);
  }
}

// ─── Test suites ──────────────────────────────────────────────────────────────

// Suite 1 — ensureStyleTag idempotency
{
  console.log("\nensureStyleTag:");
  const doc = makeDom();
  const reg = makeRegistry(doc);

  const el1 = reg.ensureStyleTag("agrafes-prep-inline", "body { color: red }");
  const el2 = reg.ensureStyleTag("agrafes-prep-inline", "body { color: blue }");
  const el3 = reg.ensureStyleTag("agrafes-prep-inline", "body { color: green }");

  assert("called 3× → exactly 1 <style> in <head>", doc.head.children.length === 1);
  assert("all 3 calls return the same element", el1 === el2 && el2 === el3);
  assert("cssText preserved from first call", el1.textContent === "body { color: red }");
  assert("element has correct id", el1.id === "agrafes-prep-inline");
  assert("countManagedStyles prefix match → 1", reg.countManagedStyles("agrafes-prep") === 1);
  assert("countManagedStyles wrong prefix → 0", reg.countManagedStyles("other") === 0);
}

// Suite 2 — ensureStylesheetLink idempotency
{
  console.log("\nensureStylesheetLink:");
  const doc = makeDom();
  const reg = makeRegistry(doc);

  const l1 = reg.ensureStylesheetLink("agrafes-prep-css", "/assets/prep.css");
  const l2 = reg.ensureStylesheetLink("agrafes-prep-css", "/assets/other.css");
  const l3 = reg.ensureStylesheetLink("agrafes-prep-css", "/assets/third.css");

  assert("called 3× → exactly 1 <link> in <head>", doc.head.children.length === 1);
  assert("all 3 calls return the same element", l1 === l2 && l2 === l3);
  assert("href preserved from first call", l1.href === "/assets/prep.css");
  assert("rel = stylesheet", l1.rel === "stylesheet");
  assert("countManagedStyles prefix match → 1", reg.countManagedStyles("agrafes-prep") === 1);
}

// Suite 3 — removeStyleTag
{
  console.log("\nremoveStyleTag / removeLink:");
  const doc = makeDom();
  const reg = makeRegistry(doc);

  reg.ensureStyleTag("agrafes-foo", "a { }");
  reg.ensureStylesheetLink("agrafes-bar", "/bar.css");
  assert("2 elements present before remove", doc.head.children.length === 2);

  reg.removeStyleTag("agrafes-foo");
  assert("1 element after removeStyleTag", doc.head.children.length === 1);

  reg.removeLink("agrafes-bar");
  assert("0 elements after removeLink", doc.head.children.length === 0);

  // Removing non-existent id is a no-op (should not throw)
  let threw = false;
  try { reg.removeStyleTag("does-not-exist"); } catch { threw = true; }
  assert("removeStyleTag on absent id does not throw", !threw);
}

// Suite 4 — multiple different ids co-exist
{
  console.log("\nmultiple ids:");
  const doc = makeDom();
  const reg = makeRegistry(doc);

  reg.ensureStyleTag("agrafes-shell-css", "x {}");
  reg.ensureStyleTag("agrafes-prep-inline", "y {}");
  reg.ensureStylesheetLink("agrafes-tokens", "/tokens.css");

  assert("3 distinct elements in <head>", doc.head.children.length === 3);
  assert("countManagedStyles('agrafes') → 3", reg.countManagedStyles("agrafes") === 3);

  // Re-calling each is still a no-op
  reg.ensureStyleTag("agrafes-shell-css", "z {}");
  reg.ensureStyleTag("agrafes-prep-inline", "z {}");
  reg.ensureStylesheetLink("agrafes-tokens", "/other.css");
  assert("6 calls → still only 3 elements", doc.head.children.length === 3);
}

// Suite 5 — navigation simulation (mount × 3)
{
  console.log("\nnavigation simulation (mount ×3):");
  const doc = makeDom();
  const reg = makeRegistry(doc);

  const CSS_TEXT = "body { font-size: 14px }";

  function simulateMount() {
    // This is what constituerModule does after the fix:
    reg.ensureStyleTag("agrafes-prep-inline", CSS_TEXT);
  }

  simulateMount();
  simulateMount();
  simulateMount();

  assert("3 mounts → 1 style tag only", doc.head.children.length === 1);
  assert("countManagedStyles prefix → 1", reg.countManagedStyles("agrafes-prep") === 1);
}

// ─── Summary ─────────────────────────────────────────────────────────────────

const total = passed + failed;
console.log(`\n${total} tests: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.error("\nFailed:");
  failures.forEach(f => console.error(`  - ${f}`));
  process.exit(1);
}
