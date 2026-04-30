"""Tests for the Mode A undo backbone:

- action_history helpers (record_prep_action, insert_unit_snapshots)
- curate_document's record_action callback wiring
"""

from __future__ import annotations

import json
import sqlite3

import pytest


def _seed_doc_with_units(
    conn: sqlite3.Connection, units: list[str]
) -> tuple[int, list[int]]:
    """Insert one document and a list of line units. Returns (doc_id, [unit_id])."""
    conn.execute(
        "INSERT INTO documents (title, language, created_at) VALUES (?, ?, ?)",
        ("DocTest", "fr", "2026-04-30T00:00:00Z"),
    )
    doc_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    unit_ids: list[int] = []
    for i, txt in enumerate(units, start=1):
        conn.execute(
            "INSERT INTO units (doc_id, unit_type, n, text_raw, text_norm)"
            " VALUES (?, 'line', ?, ?, ?)",
            (doc_id, i, txt, txt),
        )
        unit_ids.append(conn.execute("SELECT last_insert_rowid()").fetchone()[0])
    conn.commit()
    return doc_id, unit_ids


# ---------------------------------------------------------------------------
# action_history helpers
# ---------------------------------------------------------------------------


def test_record_prep_action_inserts_row(db_conn: sqlite3.Connection) -> None:
    from multicorpus_engine.action_history import (
        ACTION_CURATION_APPLY,
        record_prep_action,
    )

    doc_id, _ = _seed_doc_with_units(db_conn, ["abc"])
    action_id = record_prep_action(
        db_conn,
        doc_id=doc_id,
        action_type=ACTION_CURATION_APPLY,
        description="Apply 1 règle · 1 unité modifiée",
        context={"rules_count": 1, "scope": "doc"},
    )
    db_conn.commit()

    row = db_conn.execute(
        "SELECT doc_id, action_type, description, context_json, reverted"
        " FROM prep_action_history WHERE action_id = ?",
        (action_id,),
    ).fetchone()
    assert row["doc_id"] == doc_id
    assert row["action_type"] == "curation_apply"
    assert "Apply" in row["description"]
    assert row["reverted"] == 0
    assert json.loads(row["context_json"]) == {"rules_count": 1, "scope": "doc"}


def test_record_prep_action_rejects_unknown_type(db_conn: sqlite3.Connection) -> None:
    from multicorpus_engine.action_history import record_prep_action

    doc_id, _ = _seed_doc_with_units(db_conn, ["abc"])
    with pytest.raises(ValueError):
        record_prep_action(
            db_conn,
            doc_id=doc_id,
            action_type="not_real",
            description="x",
        )


def test_insert_unit_snapshots_round_trip(db_conn: sqlite3.Connection) -> None:
    from multicorpus_engine.action_history import (
        ACTION_CURATION_APPLY,
        insert_unit_snapshots,
        record_prep_action,
    )

    doc_id, [u1, u2] = _seed_doc_with_units(db_conn, ["one", "two"])
    action_id = record_prep_action(
        db_conn, doc_id=doc_id, action_type=ACTION_CURATION_APPLY,
        description="x",
    )
    n = insert_unit_snapshots(
        db_conn,
        action_id,
        [
            {"unit_id": u1, "text_norm_before": "one"},
            {"unit_id": u2, "text_norm_before": "two", "text_raw_before": "two"},
        ],
    )
    db_conn.commit()
    assert n == 2

    rows = list(
        db_conn.execute(
            "SELECT unit_id, text_norm_before, text_raw_before"
            " FROM prep_action_unit_snapshots WHERE action_id = ?"
            " ORDER BY unit_id",
            (action_id,),
        )
    )
    assert [r["unit_id"] for r in rows] == sorted([u1, u2])
    assert [r["text_norm_before"] for r in rows] == [
        "one" if u1 < u2 else "two",
        "two" if u1 < u2 else "one",
    ]


# ---------------------------------------------------------------------------
# curate_document recorder wiring
# ---------------------------------------------------------------------------


def test_curate_document_records_action_when_units_change(
    db_conn: sqlite3.Connection,
) -> None:
    from multicorpus_engine.action_history import (
        ACTION_CURATION_APPLY,
        insert_unit_snapshots,
        record_prep_action,
    )
    from multicorpus_engine.curation import CurationRule, curate_document

    doc_id, [u1, u2] = _seed_doc_with_units(
        db_conn, ["Le Sgt. dort.", "Pas de match ici."],
    )

    def recorder(d_id: int, triples: list[tuple[int, str, str]]) -> int:
        action_id = record_prep_action(
            db_conn,
            doc_id=d_id,
            action_type=ACTION_CURATION_APPLY,
            description=f"Apply 1 règle · {len(triples)} unité(s)",
        )
        insert_unit_snapshots(
            db_conn,
            action_id,
            [{"unit_id": uid, "text_norm_before": before}
             for (uid, before, _after) in triples],
        )
        return action_id

    rules = [CurationRule(pattern=r"\bSgt\.", replacement="Sergent")]
    report = curate_document(db_conn, doc_id, rules, record_action=recorder)

    assert report.units_modified == 1
    assert report.action_id is not None

    # text_norm was updated in the same tx as the snapshot.
    new_norm = db_conn.execute(
        "SELECT text_norm FROM units WHERE unit_id = ?", (u1,)
    ).fetchone()["text_norm"]
    assert "Sergent" in new_norm

    # Snapshot captured the pre-update value.
    snap = db_conn.execute(
        "SELECT text_norm_before FROM prep_action_unit_snapshots"
        " WHERE action_id = ?",
        (report.action_id,),
    ).fetchall()
    assert len(snap) == 1
    assert snap[0]["text_norm_before"] == "Le Sgt. dort."

    # Untouched unit got no snapshot.
    other = db_conn.execute(
        "SELECT COUNT(*) FROM prep_action_unit_snapshots"
        " WHERE action_id = ? AND unit_id = ?",
        (report.action_id, u2),
    ).fetchone()[0]
    assert other == 0


def test_curate_document_skips_recording_when_no_changes(
    db_conn: sqlite3.Connection,
) -> None:
    from multicorpus_engine.curation import CurationRule, curate_document

    doc_id, _ = _seed_doc_with_units(db_conn, ["Rien à changer ici."])
    calls: list = []

    def recorder(d_id, triples):
        calls.append((d_id, triples))
        return 999

    rules = [CurationRule(pattern=r"impossible_match_zzz", replacement="x")]
    report = curate_document(db_conn, doc_id, rules, record_action=recorder)

    assert report.units_modified == 0
    assert report.action_id is None
    assert calls == [], "recorder must not be called when nothing changed"

    # No history row was written.
    n_rows = db_conn.execute(
        "SELECT COUNT(*) FROM prep_action_history WHERE doc_id = ?", (doc_id,)
    ).fetchone()[0]
    assert n_rows == 0
