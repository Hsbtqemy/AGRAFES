"""Pytest fixtures shared across all test modules.

Creates a minimal in-memory (or temp-file) SQLite DB with migrations applied,
and a minimal fixture DOCX generated programmatically.
"""

from __future__ import annotations

import io
import sqlite3
import tempfile
from pathlib import Path

import pytest

# We need the migrations directory path at test time.
_REPO_ROOT = Path(__file__).parent.parent
_MIGRATIONS_DIR = _REPO_ROOT / "migrations"


@pytest.fixture()
def db_conn(tmp_path: Path) -> sqlite3.Connection:
    """Provide a fresh SQLite connection with all migrations applied."""
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.db.migrations import apply_migrations

    db_path = tmp_path / "test.db"
    conn = get_connection(db_path)
    apply_migrations(conn, migrations_dir=_MIGRATIONS_DIR)
    return conn


def make_docx(paragraphs: list[str]) -> bytes:
    """Create a minimal DOCX in memory from a list of paragraph strings.

    Returns the raw bytes of the DOCX file.
    """
    import docx  # python-docx

    doc = docx.Document()
    for para in paragraphs:
        doc.add_paragraph(para)

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


@pytest.fixture()
def simple_docx(tmp_path: Path) -> Path:
    """A minimal fixture DOCX with numbered lines and structure paragraphs."""
    paragraphs = [
        "Introduction",                             # structure
        "[1] Bonjour le monde.",                    # line 1
        "[2] Il fait beau aujourd'hui.",            # line 2
        "[3] Le chat¤le chien jouent ensemble.",    # line 3, has ¤
        "Section 2",                                # structure
        "[4] Voici une autre phrase.",              # line 4
        "[5] Fin du document.",                     # line 5
    ]
    data = make_docx(paragraphs)
    path = tmp_path / "fixture.docx"
    path.write_bytes(data)
    return path


@pytest.fixture()
def docx_with_holes(tmp_path: Path) -> Path:
    """A DOCX with holes in the external_id sequence (missing 3, 4)."""
    paragraphs = [
        "[1] Premier.",
        "[2] Deuxième.",
        "[5] Cinquième.",  # holes at 3, 4
    ]
    data = make_docx(paragraphs)
    path = tmp_path / "holes.docx"
    path.write_bytes(data)
    return path


@pytest.fixture()
def docx_with_duplicates(tmp_path: Path) -> Path:
    """A DOCX with duplicate external_ids."""
    paragraphs = [
        "[1] Premier.",
        "[2] Deuxième.",
        "[2] Doublon.",   # duplicate external_id=2
    ]
    data = make_docx(paragraphs)
    path = tmp_path / "dupes.docx"
    path.write_bytes(data)
    return path
