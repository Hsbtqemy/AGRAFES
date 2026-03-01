#!/usr/bin/env python3
"""
create_demo_db.py — Generate the AGRAFES demo corpus DB.

Produces tauri-shell/public/demo/agrafes_demo.db with:
  - 2 documents: "Le Prince" excerpt in FR + EN (translation pair)
  - 5 text units per document, aligned by external_id
  - FTS5 index built

Run from the repo root:
    python3 scripts/create_demo_db.py

License: Internal demo only (public-domain source text, Machiavelli).
"""
from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
OUTPUT = REPO_ROOT / "tauri-shell" / "public" / "demo" / "agrafes_demo.db"

sys.path.insert(0, str(REPO_ROOT / "src"))
from multicorpus_engine.db.migrations import apply_migrations


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.unlink(missing_ok=True)

    conn = sqlite3.connect(str(OUTPUT))
    apply_migrations(conn)

    # Seed run (required for alignment_links FK)
    conn.execute(
        "INSERT INTO runs (run_id, kind, params_json, stats_json, created_at) VALUES (?,?,?,?,datetime('now'))",
        ("demo-run-1", "align", json.dumps({}), json.dumps({})),
    )
    conn.commit()

    # ── Documents ──────────────────────────────────────────────────────────────
    conn.execute(
        "INSERT INTO documents (title, language, doc_role, resource_type, created_at)"
        " VALUES (?,?,?,?,datetime('now'))",
        ("Le Prince — extrait (Machiavel)", "fr", "original", "literary"),
    )
    conn.execute(
        "INSERT INTO documents (title, language, doc_role, resource_type, created_at)"
        " VALUES (?,?,?,?,datetime('now'))",
        ("The Prince — excerpt (Machiavelli)", "en", "translation", "literary"),
    )
    conn.commit()

    # ── Text units FR (doc_id=1, unit_ids 1-5) ─────────────────────────────────
    fr_texts = [
        "Tous les États, toutes les dominations qui ont eu et ont empire sur les hommes, "
        "sont des républiques ou des principautés.",
        "Les principautés sont ou héréditaires, longtemps dans la famille de leur prince, "
        "ou elles sont nouvelles.",
        "Les nouvelles sont entièrement nouvelles, comme fut Milan pour Francesco Sforza.",
        "Les États ainsi acquis sont accoutumés à vivre sous un prince, ou à être libres.",
        "La vérité est que lorsqu'on s'empare d'un État, le vainqueur doit peser "
        "toutes les actions nécessaires.",
    ]
    for i, txt in enumerate(fr_texts, start=1):
        conn.execute(
            "INSERT INTO units (doc_id, unit_type, n, external_id, text_raw, text_norm)"
            " VALUES (?,?,?,?,?,?)",
            (1, "line", i, i, txt, txt),
        )

    # ── Text units EN (doc_id=2, unit_ids 6-10) ────────────────────────────────
    en_texts = [
        "All states, all powers, that have held and hold rule over men have been and are "
        "either republics or principalities.",
        "Principalities are either hereditary, in which the family has been long "
        "established; or they are new.",
        "The new ones are entirely new, as was Milan to Francesco Sforza, or they are "
        "additions to established states.",
        "States thus acquired are either accustomed to live under a prince, or to live in freedom.",
        "A man who wants to act virtuously necessarily comes to grief among so many who "
        "are not virtuous.",
    ]
    for i, txt in enumerate(en_texts, start=1):
        conn.execute(
            "INSERT INTO units (doc_id, unit_type, n, external_id, text_raw, text_norm)"
            " VALUES (?,?,?,?,?,?)",
            (2, "line", i, i, txt, txt),
        )
    conn.commit()

    # ── Alignment links (FR pivot → EN target by external_id) ─────────────────
    for ext_id in range(1, 6):
        pivot_uid = ext_id        # FR units: 1-5
        target_uid = ext_id + 5  # EN units: 6-10
        conn.execute(
            "INSERT INTO alignment_links"
            " (run_id, pivot_unit_id, target_unit_id, external_id,"
            "  pivot_doc_id, target_doc_id, created_at)"
            " VALUES (?,?,?,?,1,2,datetime('now'))",
            ("demo-run-1", pivot_uid, target_uid, ext_id),
        )
    conn.commit()

    # ── FTS index ──────────────────────────────────────────────────────────────
    conn.execute('INSERT INTO fts_units(fts_units) VALUES ("rebuild")')
    conn.commit()
    conn.execute("VACUUM")
    conn.commit()
    conn.close()

    size = OUTPUT.stat().st_size
    print(f"Demo DB created: {OUTPUT} ({size:,} bytes / {size / 1024:.1f} KB)")


if __name__ == "__main__":
    main()
