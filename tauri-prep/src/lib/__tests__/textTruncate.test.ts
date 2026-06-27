import { describe, it, expect } from "vitest";
import { truncateMid } from "../textTruncate.ts";

const ELL = String.fromCharCode(0x2026); // …

describe("truncateMid", () => {
  it("returns short text unchanged", () => {
    expect(truncateMid("hello", 42)).toBe("hello");
  });

  it("returns text at the length boundary unchanged", () => {
    const s = "x".repeat(42);
    expect(truncateMid(s, 42)).toBe(s);
  });

  it("returns empty string unchanged", () => {
    expect(truncateMid("", 42)).toBe("");
  });

  it("middle-truncates long text with an ellipsis, preserving head and tail", () => {
    const s = "START" + "x".repeat(100) + "END";
    const out = truncateMid(s, 42);
    expect(out).toContain(ELL);
    expect(out.startsWith("START")).toBe(true);
    expect(out.endsWith("END")).toBe(true);
    expect(out.length).toBeLessThan(s.length);
  });

  it("defaults maxChars to 42", () => {
    const s = "y".repeat(100);
    expect(truncateMid(s)).toBe(truncateMid(s, 42));
  });
});
