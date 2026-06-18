/**
 * Render-smoke tests for the REAL styleRegistry.ts (T-05).
 *
 * Replaces scripts/test_style_registry.mjs, which tested a *copy* of these
 * helpers. Here we import the actual module and run it against a headless DOM
 * (happy-dom, configured in vite.config.ts), asserting the idempotency contract
 * that prevents <style> accumulation across navigations.
 *
 * Scope: the <style> helpers (ensureStyleTag / removeStyleTag / countManagedStyles)
 * — the documented contract. ensureStylesheetLink is left out: it has no production
 * caller (see styleRegistry.ts header) and appending a <link href> makes happy-dom
 * attempt a network fetch (noise unrelated to the idempotency contract under test).
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  countManagedStyles,
  ensureStyleTag,
  removeLink,
  removeStyleTag,
} from "../styleRegistry";

beforeEach(() => {
  document.head.innerHTML = "";
});

describe("ensureStyleTag", () => {
  it("injects one <style> with the id + css", () => {
    const el = ensureStyleTag("mod-css", ".a{color:red}");
    expect(el).toBeInstanceOf(HTMLStyleElement);
    expect(el.id).toBe("mod-css");
    expect(el.textContent).toBe(".a{color:red}");
    expect(document.getElementById("mod-css")).toBe(el);
  });

  it("is idempotent — navigation ×3 yields a single <style>", () => {
    const first = ensureStyleTag("mod-css", ".a{}");
    ensureStyleTag("mod-css", ".a{}");
    const third = ensureStyleTag("mod-css", ".a{}");
    expect(third).toBe(first);                       // same element returned
    expect(countManagedStyles("mod-css")).toBe(1);   // not accumulated
  });
});

describe("removeStyleTag / removeLink", () => {
  it("removes a managed <style>; no-op when absent; removeLink is an alias", () => {
    ensureStyleTag("gone", ".x{}");
    expect(countManagedStyles("gone")).toBe(1);
    removeStyleTag("gone");
    expect(countManagedStyles("gone")).toBe(0);
    expect(() => removeStyleTag("never")).not.toThrow();
    expect(removeLink).toBe(removeStyleTag);
  });
});

describe("countManagedStyles", () => {
  it("counts <style> elements by id prefix only", () => {
    ensureStyleTag("p-1", ".a{}");
    ensureStyleTag("p-2", ".b{}");
    ensureStyleTag("other", ".d{}");
    expect(countManagedStyles("p-")).toBe(2);
    expect(countManagedStyles("other")).toBe(1);
    expect(countManagedStyles("none")).toBe(0);
  });
});
