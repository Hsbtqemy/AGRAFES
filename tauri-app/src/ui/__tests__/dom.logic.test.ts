/**
 * Tests for ui/dom.ts (FE-06 / U-03). The file is ~99% a static CSS string;
 * its logic is two helpers, both security-relevant and previously untested:
 *   - escapeHtml — the primitive behind every XSS-safe render (e.g. the
 *     results.ts highlight path). Escapes & < > and ", & first (no double-escape).
 *   - elt — element builder whose **string children are text nodes**, so they are
 *     never parsed as HTML.
 * happy-dom is the package-global env (vite.config).
 */
import { describe, expect, it } from "vitest";
import { elt, escapeHtml } from "../dom";

describe("escapeHtml", () => {
  it("escapes &, <, > and the double quote", () => {
    expect(escapeHtml('&<>"')).toBe("&amp;&lt;&gt;&quot;");
  });

  it("escapes & first, so generated entities are not double-escaped", () => {
    expect(escapeHtml("a&b<c")).toBe("a&amp;b&lt;c");
    expect(escapeHtml("<")).toBe("&lt;"); // not &amp;lt;
  });

  it("leaves the single quote unescaped (documented limitation)", () => {
    expect(escapeHtml("it's a <test>")).toBe("it's a &lt;test&gt;");
  });

  it("neutralises an HTML/JS payload", () => {
    const out = escapeHtml('<img src=x onerror="alert(1)">');
    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
    expect(out).toContain("&lt;img");
    expect(out).toContain("&quot;");
  });
});

describe("elt", () => {
  it("creates an element of the given tag", () => {
    expect(elt("div").tagName).toBe("DIV");
  });

  it("sets attributes from the map", () => {
    const el = elt("span", { class: "x", title: "t" });
    expect(el.getAttribute("class")).toBe("x");
    expect(el.getAttribute("title")).toBe("t");
  });

  it("appends string children as text and element children in order", () => {
    const child = elt("b", {}, "B");
    const el = elt("div", {}, "before ", child, " after");
    expect(el.childNodes.length).toBe(3);
    expect(el.textContent).toBe("before B after");
    expect(el.querySelector("b")).toBe(child);
  });

  it("treats a string child as text, never as HTML (XSS-safe)", () => {
    const el = elt("div", {}, "<img src=x onerror=alert(1)>");
    expect(el.querySelector("img")).toBeNull(); // not a live element
    expect(el.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(el.innerHTML).toContain("&lt;img"); // serialised escaped
  });
});
