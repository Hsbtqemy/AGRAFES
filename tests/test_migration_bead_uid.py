"""Migration 026 — bead_uid backfill (K3, docs/DESIGN_alignment_curation_model.md).

Proves that applying 026 on a pre-existing (through-025) corpus backfills
bead_uid = run_id||'#'||bead_id on beaded rows byte-identically, and leaves
singleton (bead_id NULL) rows NULL — so collision detection is unchanged on
existing data (the D5 non-regression claim). RED before 026 existed.
"""
from __future__ import annotations

import shutil
from pathlib import Path

from multicorpus_engine.db.connection import get_connection
from multicorpus_engine.db.migrations import _find_migrations, apply_migrations

_MIGRATIONS_DIR = Path(__file__).parent.parent / "migrations"


def _subset_dir(tmp_path: Path, max_version: int) -> Path:
    """A migrations dir holding only files up to and including ``max_version``."""
    d = tmp_path / "mig_subset"
    d.mkdir()
    for version, path in _find_migrations(_MIGRATIONS_DIR):
        if version <= max_version:
            shutil.copyfile(path, d / path.name)
    return d


def test_026_backfills_bead_uid_byte_compatible(tmp_path: Path) -> None:
    conn = get_connection(tmp_path / "corpus.db")

    # 1. Bring the schema to the pre-026 state (through 025 — no bead_uid column yet).
    apply_migrations(conn, migrations_dir=_subset_dir(tmp_path, 25))
    cols = {r[1] for r in conn.execute("PRAGMA table_info(alignment_links)")}
    assert "bead_uid" not in cols

    # 2. Seed rows as R3.2 left them: a 1-2 bead (bead_id set) + a singleton (bead_id NULL).
    for title, lang, sp, sh in (("P", "fr", "p.txt", "h1"), ("T", "en", "t.txt", "h2")):
        conn.execute(
            "INSERT INTO documents (title, language, source_path, source_hash, created_at)"
            " VALUES (?,?,?,?,'2024-01-01T00:00:00')",
            (title, lang, sp, sh),
        )
    for doc_id, n in ((1, 1), (2, 1), (2, 2)):  # unit_ids 1 (P/1), 2 (T/1), 3 (T/2)
        conn.execute(
            "INSERT INTO units (doc_id, unit_type, n, text_raw, text_norm) VALUES (?,'line',?,'x','x')",
            (doc_id, n),
        )
    conn.commit()
    conn.execute(
        "INSERT INTO alignment_links (run_id, pivot_unit_id, target_unit_id, external_id,"
        " pivot_doc_id, target_doc_id, created_at, bead_id)"
        " VALUES ('run-x', 1, 2, 1, 1, 2, '2024-01-01T00:00:00', 7)"   # beaded
    )
    conn.execute(
        "INSERT INTO alignment_links (run_id, pivot_unit_id, target_unit_id, external_id,"
        " pivot_doc_id, target_doc_id, created_at, bead_id)"
        " VALUES ('run-x', 1, 3, 2, 1, 2, '2024-01-01T00:00:00', NULL)"  # singleton
    )
    conn.commit()

    # 3. Apply the remaining migration(s) — only 026 is pending.
    applied = apply_migrations(conn, migrations_dir=_MIGRATIONS_DIR)
    assert applied == 1

    rows = conn.execute(
        "SELECT bead_id, bead_uid FROM alignment_links ORDER BY external_id"
    ).fetchall()
    assert (rows[0]["bead_id"], rows[0]["bead_uid"]) == (7, "run-x#7")  # backfilled byte-compat
    assert (rows[1]["bead_id"], rows[1]["bead_uid"]) == (None, None)    # singleton stays NULL
