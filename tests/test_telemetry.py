"""Direct unit tests for telemetry.py (audit T-02).

telemetry.py was exercised only indirectly (via sidecar handlers). These tests
cover its branches directly: the emit_event contract (reserved-key stripping,
fire-and-forget exception swallowing, str() coercion), the NDJSON wire format
(compact, UTF-8, ISO-8601 ts), and path/locking behaviour.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from multicorpus_engine import telemetry


def _read_lines(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


# ── telemetry_path ────────────────────────────────────────────────────────────


def test_telemetry_path_sits_next_to_db(tmp_path: Path) -> None:
    db = tmp_path / "sub" / "corpus.db"
    assert telemetry.telemetry_path(db) == tmp_path / "sub" / ".agrafes_telemetry.ndjson"


def test_telemetry_path_accepts_str(tmp_path: Path) -> None:
    db = tmp_path / "corpus.db"
    assert telemetry.telemetry_path(str(db)) == tmp_path / ".agrafes_telemetry.ndjson"


# ── emit_event: happy path + wire format ──────────────────────────────────────


def test_emit_event_writes_record_with_ts_event_payload(tmp_path: Path) -> None:
    db = tmp_path / "corpus.db"
    telemetry.emit_event(db, "stage_completed", stage="import", duration_ms=1500, ok=True)

    records = _read_lines(telemetry.telemetry_path(db))
    assert len(records) == 1
    rec = records[0]
    assert rec["event"] == "stage_completed"
    assert rec["stage"] == "import"
    assert rec["duration_ms"] == 1500
    assert rec["ok"] is True
    assert "ts" in rec


def test_emit_event_ts_is_iso8601_millis_utc(tmp_path: Path) -> None:
    db = tmp_path / "corpus.db"
    telemetry.emit_event(db, "ping")
    ts = _read_lines(telemetry.telemetry_path(db))[0]["ts"]
    # e.g. 2026-04-29T12:34:56.789Z
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z", ts), ts


def test_emit_event_appends_one_line_per_event(tmp_path: Path) -> None:
    db = tmp_path / "corpus.db"
    telemetry.emit_event(db, "a", i=1)
    telemetry.emit_event(db, "b", i=2)
    telemetry.emit_event(db, "c", i=3)

    records = _read_lines(telemetry.telemetry_path(db))
    assert [r["event"] for r in records] == ["a", "b", "c"]
    assert [r["i"] for r in records] == [1, 2, 3]


def test_emit_event_line_is_compact(tmp_path: Path) -> None:
    db = tmp_path / "corpus.db"
    telemetry.emit_event(db, "evt", k="v")
    raw = telemetry.telemetry_path(db).read_text(encoding="utf-8")
    # compact separators (",",":") — no ", " or ": " spacing
    assert ", " not in raw
    assert '": "' not in raw  # ":" with no surrounding spaces


def test_emit_event_preserves_unicode(tmp_path: Path) -> None:
    db = tmp_path / "corpus.db"
    telemetry.emit_event(db, "evt", title="Élégie à un être")
    raw = telemetry.telemetry_path(db).read_text(encoding="utf-8")
    # ensure_ascii=False → accents written verbatim, not \uXXXX
    assert "Élégie à un être" in raw
    assert "\\u" not in raw


# ── emit_event: validation + reserved keys ────────────────────────────────────


def test_emit_event_empty_name_writes_nothing(tmp_path: Path) -> None:
    db = tmp_path / "corpus.db"
    telemetry.emit_event(db, "")
    assert not telemetry.telemetry_path(db).exists()


def test_emit_event_non_str_name_writes_nothing(tmp_path: Path) -> None:
    db = tmp_path / "corpus.db"
    telemetry.emit_event(db, None)  # type: ignore[arg-type]
    telemetry.emit_event(db, 123)  # type: ignore[arg-type]
    assert not telemetry.telemetry_path(db).exists()


def test_emit_event_caller_cannot_override_ts_or_event(tmp_path: Path) -> None:
    db = tmp_path / "corpus.db"
    telemetry.emit_event(db, "real_event", ts="1999-01-01T00:00:00.000Z", event="fake")
    rec = _read_lines(telemetry.telemetry_path(db))[0]
    assert rec["event"] == "real_event"            # canonical, not "fake"
    assert rec["ts"] != "1999-01-01T00:00:00.000Z"  # canonical generated ts


# ── emit_event: robustness (fire-and-forget) ──────────────────────────────────


def test_emit_event_coerces_non_serializable_via_str(tmp_path: Path) -> None:
    db = tmp_path / "corpus.db"
    telemetry.emit_event(db, "evt", where=Path("/x/y"), tags={"a", "b"})
    rec = _read_lines(telemetry.telemetry_path(db))[0]
    # default=str turns the Path/set into their str() forms
    assert isinstance(rec["where"], str)
    assert isinstance(rec["tags"], str)


def test_emit_event_swallows_exceptions_and_writes_nothing(tmp_path: Path) -> None:
    class Boom:
        def __str__(self) -> str:  # str() coercion itself fails
            raise RuntimeError("kaboom")

    db = tmp_path / "corpus.db"
    # Must NOT raise — telemetry is fire-and-forget.
    telemetry.emit_event(db, "evt", bad=Boom())
    # json.dumps failed before any write → no file (or no line) created.
    path = telemetry.telemetry_path(db)
    assert not path.exists() or path.read_text(encoding="utf-8") == ""


def test_emit_event_creates_missing_parent_dir(tmp_path: Path) -> None:
    db = tmp_path / "deep" / "nested" / "corpus.db"
    telemetry.emit_event(db, "evt")
    assert telemetry.telemetry_path(db).exists()
