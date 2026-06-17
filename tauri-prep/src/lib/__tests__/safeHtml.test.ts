import { describe, it, expect } from "vitest";
import { safeHtml, raw, TrustedHtml } from "../safeHtml.ts";

describe("safeHtml — safeHtml`` tagged template (audit S-03)", () => {
  it("escapes interpolated text (& < > \" ')", () => {
    const evil = `<img src=x onerror="alert('xss')">&'`;
    const out = String(safeHtml`<p>${evil}</p>`);
    expect(out).toBe(
      `<p>&lt;img src=x onerror=&quot;alert(&#39;xss&#39;)&quot;&gt;&amp;&#39;</p>`,
    );
    expect(out).not.toContain("<img");
  });

  it("keeps static parts verbatim", () => {
    expect(String(safeHtml`<div class="x">hi</div>`)).toBe(`<div class="x">hi</div>`);
  });

  it("does NOT re-escape raw() / nested safeHtml`` fragments", () => {
    const child = safeHtml`<b>${"a&b"}</b>`;
    expect(String(safeHtml`<div>${child}</div>`)).toBe(`<div><b>a&amp;b</b></div>`);
    expect(String(safeHtml`<div>${raw("<hr>")}</div>`)).toBe(`<div><hr></div>`);
  });

  it("flattens arrays, escaping each item unless raw", () => {
    const rows = ["a<", "b>"];
    expect(String(safeHtml`<ul>${rows.map((r) => safeHtml`<li>${r}</li>`)}</ul>`)).toBe(
      `<ul><li>a&lt;</li><li>b&gt;</li></ul>`,
    );
  });

  it("renders null/undefined as empty string", () => {
    expect(String(safeHtml`<p>${null}${undefined}</p>`)).toBe(`<p></p>`);
  });

  it("coerces numbers (innerHTML setter calls toString)", () => {
    expect(String(safeHtml`<span>${42}</span>`)).toBe(`<span>42</span>`);
  });

  it("raw() is idempotent on TrustedHtml", () => {
    const t = new TrustedHtml("<x>");
    expect(raw(t)).toBe(t);
  });
});
