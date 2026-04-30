"""End-to-end tests for the Mode A prep undo:

For each instrumented action (curation_apply, merge_units, split_unit,
resegment) we run the action, capture the "after" DB state, run undo,
and verify the DB matches the original "before" state.
"""

from __future__ import annotations

import sqlite3

import pytest


def _seed_doc(
    conn: sqlite3.Connection, units: list[str]
) -> tuple[int, list[int]]:
    conn.execute(
        "INSERT INTO documents (title, language, created_at) VALUES (?, ?, ?)",
        ("UndoDoc", "fr", "2026-04-30T00:00:00Z"),
    )
    doc_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    unit_ids: list[int] = []
    for i, txt in enumerate(units, start=1):
        conn.execute(
            "INSERT INTO units (doc_id, unit_type, n, external_id, text_raw, text_norm)"
            " VALUES (?, 'line', ?, ?, ?, ?)",
            (doc_id, i, i, txt, txt),
        )
        unit_ids.append(conn.execute("SELECT last_insert_rowid()").fetchone()[0])
    conn.commit()
    return doc_id, unit_ids


def _snapshot_units(conn: sqlite3.Connection, doc_id: int) -> list[tuple]:
    """Return (n, external_id, text_raw, text_norm, unit_role) for each line unit."""
    return [
        (
            r["n"],
            r["external_id"],
            r["text_raw"],
            r["text_norm"],
            r["unit_role"],
        )
        for r in conn.execute(
            "SELECT n, external_id, text_raw, text_norm, unit_role"
            " FROM units WHERE doc_id=? AND unit_type='line' ORDER BY n",
            (doc_id,),
        )
    ]


# ---------------------------------------------------------------------------
# Eligibility
# ---------------------------------------------------------------------------


def test_eligibility_no_action_when_history_empty(
    db_conn: sqlite3.Connection,
) -> None:
    from multicorpus_engine.undo import compute_eligibility

    doc_id, _ = _seed_doc(db_conn, ["abc"])
    elig = compute_eligibility(db_conn, doc_id)
    assert elig == {"eligible": False, "reason": "no_action"}


def test_eligibility_returns_latest_after_curation(
    db_conn: sqlite3.Connection,
) -> None:
    from multicorpus_engine.action_history import (
        ACTION_CURATION_APPLY,
        insert_unit_snapshots,
        record_prep_action,
    )
    from multicorpus_engine.curation import CurationRule, curate_document
    from multicorpus_engine.undo import compute_eligibility

    doc_id, [u1] = _seed_doc(db_conn, ["Le Sgt. dort."])

    def recorder(d_id, triples):
        action_id = record_prep_action(
            db_conn, doc_id=d_id, action_type=ACTION_CURATION_APPLY,
            description="Apply 1 règle · 1 unité",
        )
        insert_unit_snapshots(
            db_conn, action_id,
            [{"unit_id": uid, "text_norm_before": before}
             for (uid, before, _a) in triples],
        )
        return action_id

    rules = [CurationRule(pattern=r"\bSgt\.", replacement="Sergent")]
    curate_document(db_conn, doc_id, rules, record_action=recorder)
    db_conn.commit()

    elig = compute_eligibility(db_conn, doc_id)
    assert elig["eligible"] is True
    assert elig["action_type"] == "curation_apply"
    assert "Apply" in elig["description"]


# ---------------------------------------------------------------------------
# Round-trip: action then undo restores the prior state
# ---------------------------------------------------------------------------


def test_undo_curation_apply_restores_text_norm(
    db_conn: sqlite3.Connection,
) -> None:
    from multicorpus_engine.action_history import (
        ACTION_CURATION_APPLY,
        insert_unit_snapshots,
        record_prep_action,
    )
    from multicorpus_engine.curation import CurationRule, curate_document
    from multicorpus_engine.undo import execute_undo

    doc_id, _ = _seed_doc(db_conn, ["Le Sgt. dort.", "Pas de match ici."])
    before = _snapshot_units(db_conn, doc_id)

    def recorder(d_id, triples):
        action_id = record_prep_action(
            db_conn, doc_id=d_id, action_type=ACTION_CURATION_APPLY,
            description="Apply 1 règle",
        )
        insert_unit_snapshots(
            db_conn, action_id,
            [{"unit_id": uid, "text_norm_before": b}
             for (uid, b, _a) in triples],
        )
        return action_id

    rules = [CurationRule(pattern=r"\bSgt\.", replacement="Sergent")]
    curate_document(db_conn, doc_id, rules, record_action=recorder)
    db_conn.commit()

    after = _snapshot_units(db_conn, doc_id)
    assert before != after, "curation should have changed at least one unit"

    payload = execute_undo(db_conn, doc_id)
    db_conn.commit()
    assert payload["reverted_action_type"] == "curation_apply"
    assert payload["units_restored"] == 1
    assert payload["fts_stale"] is True

    restored = _snapshot_units(db_conn, doc_id)
    assert restored == before, "undo did not restore original text_norm"

    # The original action is now flagged reverted; eligibility resets to no_action.
    from multicorpus_engine.undo import compute_eligibility
    elig = compute_eligibility(db_conn, doc_id)
    assert elig == {"eligible": False, "reason": "no_action"}


def test_undo_merge_restores_two_units(db_conn: sqlite3.Connection) -> None:
    """Round-trip a merge by directly invoking the same SQL path as the handler."""
    from multicorpus_engine.action_history import (
        ACTION_MERGE_UNITS,
        insert_unit_snapshots,
        record_prep_action,
    )
    from multicorpus_engine.undo import execute_undo

    doc_id, [u1, u2, u3] = _seed_doc(
        db_conn, ["Phrase un.", "Phrase deux.", "Phrase trois."],
    )
    before = _snapshot_units(db_conn, doc_id)

    # Replay the merge of units 1+2 using the same SQL the handler runs.
    n1, n2 = 1, 2
    row1 = db_conn.execute(
        "SELECT unit_id, external_id, text_raw, text_norm, unit_role, meta_json"
        " FROM units WHERE doc_id=? AND n=? AND unit_type='line'",
        (doc_id, n1),
    ).fetchone()
    row2 = db_conn.execute(
        "SELECT unit_id, external_id, text_raw, text_norm, unit_role, meta_json"
        " FROM units WHERE doc_id=? AND n=? AND unit_type='line'",
        (doc_id, n2),
    ).fetchone()
    uid1, uid2 = int(row1["unit_id"]), int(row2["unit_id"])

    action_id = record_prep_action(
        db_conn,
        doc_id=doc_id,
        action_type=ACTION_MERGE_UNITS,
        description=f"Fusion u.{n1} + u.{n2}",
        context={
            "merged_unit_ids":            [uid1, uid2],
            "kept_unit_id":               uid1,
            "deleted_unit_id":            uid2,
            "n1": n1, "n2": n2,
            "kept_external_id_before":    row1["external_id"],
            "deleted_external_id_before": row2["external_id"],
        },
    )
    insert_unit_snapshots(
        db_conn, action_id,
        [
            {"unit_id": uid1, "text_raw_before": row1["text_raw"],
             "text_norm_before": row1["text_norm"], "unit_role_before": row1["unit_role"],
             "meta_json_before": row1["meta_json"]},
            {"unit_id": uid2, "text_raw_before": row2["text_raw"],
             "text_norm_before": row2["text_norm"], "unit_role_before": row2["unit_role"],
             "meta_json_before": row2["meta_json"]},
        ],
    )
    merged_raw  = (row1["text_raw"]  or "").rstrip() + " " + (row2["text_raw"]  or "").lstrip()
    merged_norm = (row1["text_norm"] or "").rstrip() + " " + (row2["text_norm"] or "").lstrip()
    db_conn.execute(
        "UPDATE units SET text_raw=?, text_norm=? WHERE doc_id=? AND n=?",
        (merged_raw, merged_norm, doc_id, n1),
    )
    db_conn.execute("DELETE FROM units WHERE doc_id=? AND n=?", (doc_id, n2))
    db_conn.execute(
        "UPDATE units SET n = n - 1 WHERE doc_id=? AND n > ?", (doc_id, n2),
    )
    db_conn.commit()

    after = _snapshot_units(db_conn, doc_id)
    assert len(after) == 2  # 3 → 2 after merge
    assert after != before

    execute_undo(db_conn, doc_id)
    db_conn.commit()

    restored = _snapshot_units(db_conn, doc_id)
    assert restored == before, f"merge undo failed to restore.\nbefore={before}\nafter={restored}"


def test_undo_split_restores_single_unit(db_conn: sqlite3.Connection) -> None:
    from multicorpus_engine.action_history import (
        ACTION_SPLIT_UNIT,
        insert_unit_snapshots,
        record_prep_action,
    )
    from multicorpus_engine.undo import execute_undo

    doc_id, [u1, u2] = _seed_doc(db_conn, ["Phrase A B C.", "Phrase suivante."])
    before = _snapshot_units(db_conn, doc_id)

    unit_n = 1
    text_a = "Phrase A"
    text_b = "B C."
    row = db_conn.execute(
        "SELECT unit_id, external_id, text_raw, text_norm, unit_role, meta_json"
        " FROM units WHERE doc_id=? AND n=? AND unit_type='line'",
        (doc_id, unit_n),
    ).fetchone()
    uid = int(row["unit_id"])

    db_conn.execute(
        "UPDATE units SET n = n + 1 WHERE doc_id=? AND n > ?", (doc_id, unit_n),
    )
    db_conn.execute(
        "UPDATE units SET text_raw=?, text_norm=?, external_id=NULL WHERE doc_id=? AND n=?",
        (text_a, text_a, doc_id, unit_n),
    )
    cur = db_conn.execute(
        "INSERT INTO units (doc_id, unit_type, n, external_id, text_raw, text_norm, meta_json)"
        " VALUES (?, 'line', ?, NULL, ?, ?, NULL)",
        (doc_id, unit_n + 1, text_b, text_b),
    )
    new_uid = int(cur.lastrowid)

    action_id = record_prep_action(
        db_conn,
        doc_id=doc_id,
        action_type=ACTION_SPLIT_UNIT,
        description=f"Coupure u.{unit_n}",
        context={
            "split_unit_id":      uid,
            "split_unit_n":       unit_n,
            "created_unit_id":    new_uid,
            "created_unit_n":     unit_n + 1,
            "external_id_before": row["external_id"],
        },
    )
    insert_unit_snapshots(
        db_conn, action_id,
        [{"unit_id": uid, "text_raw_before": row["text_raw"],
          "text_norm_before": row["text_norm"],
          "unit_role_before": row["unit_role"],
          "meta_json_before": row["meta_json"]}],
    )
    db_conn.commit()

    after = _snapshot_units(db_conn, doc_id)
    assert len(after) == 3  # 2 → 3 after split
    assert after != before

    execute_undo(db_conn, doc_id)
    db_conn.commit()

    restored = _snapshot_units(db_conn, doc_id)
    assert restored == before, f"split undo failed.\nbefore={before}\nafter={restored}"


def test_undo_resegment_restores_all_units(db_conn: sqlite3.Connection) -> None:
    from multicorpus_engine.action_history import (
        ACTION_RESEGMENT,
        insert_unit_snapshots,
        record_prep_action,
    )
    from multicorpus_engine.segmenter import resegment_document
    from multicorpus_engine.undo import execute_undo

    doc_id, _ = _seed_doc(db_conn, ["Phrase un. Phrase deux.", "Et trois ?"])
    before = _snapshot_units(db_conn, doc_id)

    def recorder(payload):
        units_before = payload["units_before"]
        if not units_before:
            return None
        action_id = record_prep_action(
            db_conn, doc_id=payload["doc_id"], action_type=ACTION_RESEGMENT,
            description=f"Reseg {len(units_before)} → {len(payload['created_unit_ids'])}",
            context={
                "pack":                     payload["pack"],
                "lang":                     payload["lang"],
                "text_start_n":             payload["text_start_n"],
                "units_deleted_after_ids":  [u["unit_id"] for u in units_before],
                "units_created_after_json": [
                    {"unit_id": uid, "n": n}
                    for uid, n in zip(
                        payload["created_unit_ids"], payload["new_units_n"]
                    )
                ],
                "units_before":             units_before,
            },
        )
        insert_unit_snapshots(
            db_conn, action_id,
            [
                {"unit_id": u["unit_id"], "text_raw_before": u["text_raw"],
                 "text_norm_before": u["text_norm"] or "",
                 "unit_role_before": u["unit_role"],
                 "meta_json_before": u["meta_json"]}
                for u in units_before
            ],
        )
        return action_id

    resegment_document(
        db_conn, doc_id=doc_id, lang="fr", pack="auto", record_action=recorder,
    )

    after = _snapshot_units(db_conn, doc_id)
    assert len(after) >= len(before), "resegment should have produced ≥ same count"
    assert after != before

    execute_undo(db_conn, doc_id)
    db_conn.commit()

    restored = _snapshot_units(db_conn, doc_id)
    assert restored == before, f"resegment undo failed.\nbefore={before}\nrestored={restored}"


# ---------------------------------------------------------------------------
# Negative cases
# ---------------------------------------------------------------------------


def test_undo_refuses_when_no_action(db_conn: sqlite3.Connection) -> None:
    from multicorpus_engine.undo import UndoError, execute_undo

    doc_id, _ = _seed_doc(db_conn, ["abc"])
    with pytest.raises(UndoError) as exc_info:
        execute_undo(db_conn, doc_id)
    assert exc_info.value.reason == "no_action"


def test_undo_marks_action_reverted_and_inserts_undo_entry(
    db_conn: sqlite3.Connection,
) -> None:
    from multicorpus_engine.action_history import (
        ACTION_CURATION_APPLY,
        insert_unit_snapshots,
        record_prep_action,
    )
    from multicorpus_engine.curation import CurationRule, curate_document
    from multicorpus_engine.undo import execute_undo

    doc_id, _ = _seed_doc(db_conn, ["Le Sgt. dort."])

    def recorder(d_id, triples):
        action_id = record_prep_action(
            db_conn, doc_id=d_id, action_type=ACTION_CURATION_APPLY,
            description="Apply",
        )
        insert_unit_snapshots(
            db_conn, action_id,
            [{"unit_id": uid, "text_norm_before": b}
             for (uid, b, _a) in triples],
        )
        return action_id

    curate_document(
        db_conn, doc_id,
        [CurationRule(pattern=r"\bSgt\.", replacement="Sergent")],
        record_action=recorder,
    )
    db_conn.commit()

    payload = execute_undo(db_conn, doc_id)
    db_conn.commit()

    history = list(
        db_conn.execute(
            "SELECT action_type, reverted, reverted_by_id"
            " FROM prep_action_history WHERE doc_id=? ORDER BY action_id",
            (doc_id,),
        )
    )
    assert len(history) == 2
    assert history[0]["action_type"] == "curation_apply"
    assert history[0]["reverted"] == 1
    assert history[0]["reverted_by_id"] == payload["undo_action_id"]
    assert history[1]["action_type"] == "undo"
    assert history[1]["reverted"] == 0
