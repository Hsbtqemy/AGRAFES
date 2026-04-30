"""Tests for scripts/analyze_undo_soak.py."""

from __future__ import annotations

import importlib.util
import sys
from datetime import datetime, timezone
from pathlib import Path
from textwrap import dedent

import pytest

_SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "analyze_undo_soak.py"


def _load_script_module():
    """Import the standalone script as a module so we can call its helpers."""
    spec = importlib.util.spec_from_file_location("analyze_undo_soak", _SCRIPT)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    sys.modules["analyze_undo_soak"] = mod
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture()
def m():
    return _load_script_module()


def _write_ndjson(tmp_path: Path, lines: list[str]) -> Path:
    """Write a .agrafes_telemetry.ndjson and return its parent directory."""
    db_dir = tmp_path / "db"
    db_dir.mkdir()
    f = db_dir / ".agrafes_telemetry.ndjson"
    f.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return db_dir


# ─── aggregate() ───────────────────────────────────────────────────────────


def test_aggregate_counts_each_event_in_window(m, tmp_path: Path) -> None:
    db_dir = _write_ndjson(tmp_path, [
        # In window
        '{"ts":"2026-05-01T10:00:00.000Z","event":"prep_undo_eligible_view","screen":"curation","action_type":"curation_apply","action_id":1,"doc_id":7}',
        '{"ts":"2026-05-02T10:00:00.000Z","event":"prep_undo_eligible_view","screen":"segmentation","action_type":"merge_units","action_id":2,"doc_id":7}',
        '{"ts":"2026-05-03T10:00:00.000Z","event":"prep_undo_unavailable_view","reason":"no_action","screen":"curation"}',
        '{"ts":"2026-05-04T10:00:00.000Z","event":"stage_returned","from_stage":"undo","to_stage":"curation_apply","doc_id":7}',
        # stage_returned NOT from undo — must not count
        '{"ts":"2026-05-05T10:00:00.000Z","event":"stage_returned","from_stage":"segment","to_stage":"import"}',
        # Out of window
        '{"ts":"2025-01-01T10:00:00.000Z","event":"prep_undo_eligible_view","screen":"curation","action_type":"curation_apply","action_id":99}',
    ])
    since = datetime(2026, 5, 1, tzinfo=timezone.utc)
    until_excl = datetime(2026, 5, 8, tzinfo=timezone.utc)
    stats = m.aggregate(db_dir / ".agrafes_telemetry.ndjson", since, until_excl, verbose=False)

    assert stats["eligible_count"]    == 2
    assert stats["unavailable_count"] == 1
    assert stats["undo_click_count"]  == 1
    assert stats["eligible_by_screen"]    == {"curation": 1, "segmentation": 1}
    assert stats["unavailable_by_reason"] == {"no_action": 1}
    assert stats["undo_by_action_type"]   == {"curation_apply": 1}
    assert stats["malformed_lines"]       == 0
    assert stats["in_window_events"]      == 5  # the 6th is out of window


def test_aggregate_skips_malformed_lines(m, tmp_path: Path) -> None:
    db_dir = _write_ndjson(tmp_path, [
        '{"ts":"2026-05-01T10:00:00.000Z","event":"prep_undo_eligible_view","action_type":"merge_units","action_id":1}',
        "this is not json",
        "",  # blank
        '{"ts":"2026-05-02T10:00:00.000Z"',  # truncated json
    ])
    since = datetime(2026, 5, 1, tzinfo=timezone.utc)
    until_excl = datetime(2026, 5, 8, tzinfo=timezone.utc)
    stats = m.aggregate(db_dir / ".agrafes_telemetry.ndjson", since, until_excl, verbose=False)

    assert stats["eligible_count"] == 1
    assert stats["malformed_lines"] == 2  # truncated json + 'this is not json'


# ─── recommend() ───────────────────────────────────────────────────────────


def test_recommend_used_when_thresholds_met(m) -> None:
    stats = {
        "undo_click_count":  10,
        "eligible_count":    50,
        "unavailable_count": 0,
    }
    rec = m.recommend(stats, soak_days=14)
    assert "Mode A est utilisé" in rec


def test_recommend_low_when_few_clicks_and_soak_long(m) -> None:
    stats = {
        "undo_click_count":  1,
        "eligible_count":    3,
        "unavailable_count": 0,
    }
    rec = m.recommend(stats, soak_days=14)
    assert "peu utilisé" in rec


def test_recommend_ambiguous_otherwise(m) -> None:
    stats = {
        "undo_click_count":  3,
        "eligible_count":    10,
        "unavailable_count": 0,
    }
    rec = m.recommend(stats, soak_days=14)
    assert "ambigu" in rec.lower() or "prolonger" in rec.lower()


def test_recommend_frustration_when_unavailable_dominates(m) -> None:
    stats = {
        "undo_click_count":  1,
        "eligible_count":    10,
        "unavailable_count": 12,  # > 5 AND > clicks
    }
    rec = m.recommend(stats, soak_days=14)
    assert "FRUSTRATION" in rec


# ─── main() ────────────────────────────────────────────────────────────────


def test_main_exits_1_when_ndjson_missing(m, tmp_path: Path, capsys) -> None:
    empty = tmp_path / "empty"
    empty.mkdir()
    rc = m.main(["--db-dir", str(empty), "--since", "2026-05-01", "--until", "2026-05-14"])
    assert rc == 1
    captured = capsys.readouterr()
    assert "introuvable" in captured.err.lower()


def test_main_renders_report_on_real_ndjson(m, tmp_path: Path, capsys) -> None:
    db_dir = _write_ndjson(tmp_path, [
        '{"ts":"2026-05-01T10:00:00.000Z","event":"prep_undo_eligible_view","screen":"curation","action_type":"curation_apply","action_id":1}',
        '{"ts":"2026-05-02T10:00:00.000Z","event":"stage_returned","from_stage":"undo","to_stage":"curation_apply"}',
    ])
    rc = m.main([
        "--db-dir", str(db_dir),
        "--since", "2026-05-01",
        "--until", "2026-05-14",
    ])
    assert rc == 0
    out = capsys.readouterr().out
    assert "Mode A soak report" in out
    assert "prep_undo_eligible_view" in out
    assert "stage_returned (undo)" in out
    assert "Recommandation" in out


def test_main_clamps_since_to_release_date(m, tmp_path: Path, capsys) -> None:
    """--since before MODE_A_RELEASE_DATE should be clamped silently."""
    db_dir = _write_ndjson(tmp_path, [
        '{"ts":"2025-01-01T10:00:00.000Z","event":"prep_undo_eligible_view","action_type":"curation_apply","action_id":1}',
    ])
    rc = m.main([
        "--db-dir", str(db_dir),
        "--since", "2024-01-01",  # well before release
        "--until", "2026-05-14",
    ])
    assert rc == 0
    out = capsys.readouterr().out
    # The 2025-01-01 event must NOT be counted because since was clamped.
    assert "prep_undo_eligible_view    : 0 occurrences" in out
