/**
 * seqDiff.ts - LCS-based sequence diff on string arrays, extracted verbatim from
 * SegmentationView (U-02). Returns an edit script of eq/del/ins ops. Pure: reads
 * only its two arguments, no this/closure/IO. The tie-break (prefer ins when
 * dp[i][j-1] >= dp[i-1][j]) is preserved exactly — it fixes which valid edit
 * script is produced, which the seg re-segmentation diff UI renders.
 */

export interface SeqDiffOp {
  op: "eq" | "del" | "ins";
  text: string;
}

export function seqDiff(before: string[], after: string[]): SeqDiffOp[] {
  const m = before.length, n = after.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = before[i - 1] === after[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);

  const ops: Array<{ op: "eq" | "del" | "ins"; text: string }> = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && before[i - 1] === after[j - 1]) {
      ops.unshift({ op: "eq",  text: before[i - 1] }); i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.unshift({ op: "ins", text: after[j - 1] }); j--;
    } else {
      ops.unshift({ op: "del", text: before[i - 1] }); i--;
    }
  }
  return ops;
}
