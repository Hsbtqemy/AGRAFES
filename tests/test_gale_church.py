"""R3.2 (refonte deux-grains) — the pure Gale–Church DP core.

`gale_church_beads` aligns two sequences of character lengths into beads
(1-1, 1-0, 0-1, 1-2, 2-1, 2-2). These tests pin the unambiguous cases and a
structural partition invariant that holds regardless of the exact cost tuning.
"""
from __future__ import annotations

import pytest

from multicorpus_engine.gale_church import _MAX_LENGTHS, gale_church_beads


def test_oversized_input_raises_before_allocation() -> None:
    """ALN-01 — the O(n·m) DP is capped: either sequence over _MAX_LENGTHS raises."""
    big = [1] * (_MAX_LENGTHS + 1)
    small = [1, 2, 3]
    with pytest.raises(ValueError, match="too long"):
        gale_church_beads(big, small)
    with pytest.raises(ValueError, match="too long"):
        gale_church_beads(small, big)


def test_at_cap_still_runs() -> None:
    """Boundary: exactly _MAX_LENGTHS on one side is allowed (no raise)."""
    beads = gale_church_beads([1] * _MAX_LENGTHS, [1])
    assert beads  # partitions both inputs; the cap is inclusive


def test_perfect_one_to_one() -> None:
    a = [10, 20, 30]
    b = [10, 20, 30]
    beads = gale_church_beads(a, b)
    assert beads == [
        {"a": [0], "b": [0]},
        {"a": [1], "b": [1]},
        {"a": [2], "b": [2]},
    ]


def test_expansion_one_to_two() -> None:
    # One source sentence split into two target sentences of equal total length.
    beads = gale_church_beads([30], [15, 15])
    assert beads == [{"a": [0], "b": [0, 1]}]


def test_contraction_two_to_one() -> None:
    beads = gale_church_beads([15, 15], [30])
    assert beads == [{"a": [0, 1], "b": [0]}]


def test_short_internal_extra_is_absorbed_not_gapped() -> None:
    # Length-based alignment absorbs a short internal extra into a 2-1/1-2 bead
    # rather than emitting a pure deletion — a known, accepted trait of Gale–Church
    # (the gap prior 0.0099 is far worse than the contraction prior 0.089). Pure
    # 1-0/0-1 beads surface mainly at the extremities / when one side is empty.
    beads = gale_church_beads([50, 8, 50], [50, 50])
    assert all(bead["a"] and bead["b"] for bead in beads)   # no gap beads
    flat_a = [i for bead in beads for i in bead["a"]]
    assert flat_a == [0, 1, 2]                               # full, monotonic coverage


def test_empty_sides() -> None:
    assert gale_church_beads([], []) == []
    assert gale_church_beads([], [10, 20]) == [{"a": [], "b": [0]}, {"a": [], "b": [1]}]
    assert gale_church_beads([10], []) == [{"a": [0], "b": []}]


def test_beads_partition_every_index_in_order() -> None:
    # Structural invariant, independent of cost tuning: the beads cover all indices
    # of both sides exactly once, monotonically.
    a = [12, 8, 25, 5, 40, 17]
    b = [10, 30, 6, 44, 20]
    beads = gale_church_beads(a, b)
    flat_a = [i for bead in beads for i in bead["a"]]
    flat_b = [j for bead in beads for j in bead["b"]]
    assert flat_a == list(range(len(a)))
    assert flat_b == list(range(len(b)))
    # every bead is one of the permitted types
    for bead in beads:
        assert (len(bead["a"]), len(bead["b"])) in {(1, 1), (1, 0), (0, 1), (2, 1), (1, 2), (2, 2)}
