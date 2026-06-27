import { describe, it, expect } from "vitest";
import { completionTier } from "../completionTier.ts";

describe("completionTier", () => {
  it("maps boundaries to tiers", () => {
    expect(completionTier(0)).toBe("none");
    expect(completionTier(1)).toBe("low");
    expect(completionTier(39)).toBe("low");
    expect(completionTier(40)).toBe("mid");
    expect(completionTier(79)).toBe("mid");
    expect(completionTier(80)).toBe("high");
    expect(completionTier(99)).toBe("high");
    expect(completionTier(100)).toBe("done");
  });
});
