import { describe, it, expect } from "vitest";
import { seqDiff, type SeqDiffOp } from "../seqDiff.ts";

// An edit script is valid iff dropping its insertions reconstructs `before`
// and dropping its deletions reconstructs `after`. These invariants hold for
// ANY correct LCS diff, independent of tie-break, so they pin the contract
// without coupling the test to the algorithm's internal choices.
const rebuildBefore = (ops: SeqDiffOp[]): string[] => ops.filter(o => o.op !== "ins").map(o => o.text);
const rebuildAfter = (ops: SeqDiffOp[]): string[] => ops.filter(o => o.op !== "del").map(o => o.text);

describe("seqDiff", () => {
  it("returns no ops for two empty arrays", () => {
    expect(seqDiff([], [])).toEqual([]);
  });

  it("marks identical arrays entirely as eq (the caller's no-difference signal)", () => {
    const ops = seqDiff(["a", "b", "c"], ["a", "b", "c"]);
    expect(ops.every(o => o.op === "eq")).toBe(true);
    expect(ops.map(o => o.text)).toEqual(["a", "b", "c"]);
  });

  it("emits only insertions when before is empty", () => {
    expect(seqDiff([], ["x", "y"])).toEqual([
      { op: "ins", text: "x" },
      { op: "ins", text: "y" },
    ]);
  });

  it("emits only deletions when after is empty", () => {
    expect(seqDiff(["x", "y"], [])).toEqual([
      { op: "del", text: "x" },
      { op: "del", text: "y" },
    ]);
  });

  it("keeps the longest common subsequence as the eq ops", () => {
    const ops = seqDiff(["the", "quick", "brown", "fox"], ["the", "slow", "brown", "fox"]);
    expect(ops.filter(o => o.op === "eq").map(o => o.text)).toEqual(["the", "brown", "fox"]);
  });

  it("produces an edit script that reconstructs both inputs", () => {
    const cases: Array<[string[], string[]]> = [
      [["a", "b", "c"], ["a", "x", "c"]],
      [["1", "2", "3", "4"], ["2", "4", "5"]],
      [["same"], ["same"]],
      [[], ["only", "after"]],
      [["only", "before"], []],
      [["a", "a", "b"], ["a", "b", "b"]],
      [["repeat", "repeat"], ["repeat"]],
    ];
    for (const [before, after] of cases) {
      const ops = seqDiff(before, after);
      expect(rebuildBefore(ops)).toEqual(before);
      expect(rebuildAfter(ops)).toEqual(after);
    }
  });
});
