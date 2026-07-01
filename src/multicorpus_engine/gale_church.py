"""Gale–Church length-based alignment — the pure DP core (R3.2, refonte deux-grains).

Given two sequences of segment **lengths** (characters), compute the lowest-cost
alignment as a sequence of **beads** — 1-1, 1-0, 0-1, 1-2, 2-1, 2-2 — following
Gale & Church (1993): a bead's cost combines a length-discrepancy term (a normal
model on the length ratio) with a per-bead-type prior. **Stdlib only** (no numpy,
no dependency), per the no-new-dependency rule.

Pure: operates on lists of ints, returns index groupings — no DB, no IO, no units.
The two-tier aligner (`aligner.py`, R3.2 step 3) calls this at the **paragraph**
grain then at the **sentence** grain, mapping the returned indices back to units.
See docs/DESIGN_R3_sentence_alignment.md §3.
"""
from __future__ import annotations

import math

# Gale–Church parameters (1993): _C = expected target/source char ratio (≈1 for
# languages of similar length), _S2 = variance of the length ratio.
_C = 1.0
_S2 = 6.8
_LOG2 = math.log(2.0)

# Per-bead-type priors (probabilities, Gale & Church) → additive penalty −100·log(p).
_PRIORS = {
    (1, 1): 0.89,
    (1, 0): 0.0099, (0, 1): 0.0099,
    (2, 1): 0.089, (1, 2): 0.089,
    (2, 2): 0.011,
}
_PENALTY = {steps: -100.0 * math.log(p) for steps, p in _PRIORS.items()}

# Candidate transitions (steps_a, steps_b); the DP keeps the cheapest reaching each cell.
_STEPS = ((1, 1), (1, 0), (0, 1), (2, 1), (1, 2), (2, 2))


def _norm_cdf(z: float) -> float:
    """Standard normal CDF via ``math.erf`` (stdlib)."""
    return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))


def _length_cost(len_a: int, len_b: int) -> float:
    """Length-discrepancy cost of a bead totalling ``len_a`` / ``len_b`` characters.

    0 when the lengths match the expected ratio exactly; grows as they diverge.
    """
    if len_a == 0 and len_b == 0:
        return 0.0
    mean = (len_a + len_b / _C) / 2.0
    if mean <= 0.0:
        mean = 1e-9
    z = (len_a * _C - len_b) / math.sqrt(mean * _S2)
    survival = 1.0 - _norm_cdf(abs(z))
    if survival < 1e-12:               # floor to keep the cost finite for huge |z|
        survival = 1e-12
    return -100.0 * (_LOG2 + math.log(survival))


def gale_church_beads(lengths_a: list[int], lengths_b: list[int]) -> list[dict]:
    """Align two length sequences into beads by Gale–Church dynamic programming.

    Returns beads in reading order, each ``{"a": [i…], "b": [j…]}`` where the values
    are 0-based indices into ``lengths_a`` / ``lengths_b``. A gap bead has one empty
    side (``a == []`` = insertion, ``b == []`` = deletion). The beads exactly
    partition every index of both inputs, in order. Deterministic; O(len_a · len_b).
    """
    n, m = len(lengths_a), len(lengths_b)
    inf = float("inf")
    # cost[i][j] = min cost to align lengths_a[:i] with lengths_b[:j]; back = predecessor.
    cost = [[inf] * (m + 1) for _ in range(n + 1)]
    back: list[list[tuple[int, int, int, int] | None]] = [[None] * (m + 1) for _ in range(n + 1)]
    cost[0][0] = 0.0
    for i in range(n + 1):
        for j in range(m + 1):
            base = cost[i][j]
            if base == inf:
                continue
            for da, db in _STEPS:
                ni, nj = i + da, j + db
                if ni > n or nj > m:
                    continue
                c = base + _length_cost(sum(lengths_a[i:ni]), sum(lengths_b[j:nj])) + _PENALTY[(da, db)]
                if c < cost[ni][nj]:
                    cost[ni][nj] = c
                    back[ni][nj] = (i, j, da, db)

    beads: list[dict] = []
    i, j = n, m
    while (i, j) != (0, 0):
        step = back[i][j]
        assert step is not None  # (0,0) is reachable from any (i,j) via the full step set
        pi, pj, da, db = step
        beads.append({"a": list(range(pi, pi + da)), "b": list(range(pj, pj + db))})
        i, j = pi, pj
    beads.reverse()
    return beads
