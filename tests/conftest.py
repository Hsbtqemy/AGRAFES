"""Pytest fixtures shared across all test modules.

Creates a minimal in-memory (or temp-file) SQLite DB with migrations applied,
and a minimal fixture DOCX generated programmatically.
"""

from __future__ import annotations

import io
import os
import sqlite3
from pathlib import Path

import pytest

from tests.support_odt import make_odt_bytes

# T-04 — loopback sidecar HTTP must bypass any system proxy. Otherwise urllib
# routes 127.0.0.1/localhost through HTTP(S)_PROXY and the sidecar tests fail
# locally (the documented "needs NO_PROXY=127.0.0.1,localhost" artefact; CI has
# no proxy, so this is a no-op there). Set here — conftest is imported before any
# test module — so no test needs a manual NO_PROXY in its environment. Additive:
# pre-existing no_proxy entries are preserved.
for _proxy_var in ("NO_PROXY", "no_proxy"):
    _entries = [h.strip() for h in os.environ.get(_proxy_var, "").split(",") if h.strip()]
    for _host in ("127.0.0.1", "localhost", "::1"):
        if _host not in _entries:
            _entries.append(_host)
    os.environ[_proxy_var] = ",".join(_entries)

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


@pytest.fixture()
def simple_odt(tmp_path: Path) -> Path:
    """Minimal ODT with numbered lines + structure (mirrors simple_docx intent)."""
    paragraphs = [
        "Introduction",
        "[1] Bonjour le monde.",
        "[2] Il fait beau aujourd'hui.",
        "[3] Le chat¤le chien jouent ensemble.",
        "Section 2",
        "[4] Voici une autre phrase.",
        "[5] Fin du document.",
    ]
    path = tmp_path / "fixture.odt"
    path.write_bytes(make_odt_bytes(paragraphs))
    return path


def corrupt_fts_pages(db_path: Path) -> int | None:
    """Corrupt one deep page of the FTS index; return its page number.

    Reproduces the exact signature of the 25 August incident (FTS-01): the bad
    page sits far into the file, so the FIRST row of ``fts_units`` still reads
    and only a full scan raises ``DatabaseError: database disk image is
    malformed``. That is the case a ``LIMIT 1`` probe misses — and did miss,
    on the very snapshot whose symptom was "internal error" everywhere.

    Pages are searched from the end backwards for one that yields exactly that
    pair (one row ok / full scan raises). Returns ``None`` when no page does,
    leaving the file untouched — callers must ``pytest.skip`` rather than fail,
    since page layout depends on the SQLite build.
    """
    original = db_path.read_bytes()
    page_size = int.from_bytes(original[16:18], "big")
    if page_size == 1:            # header quirk: 1 means 65536
        page_size = 65536
    for page in range(len(original) // page_size, 1, -1):
        attempt = bytearray(original)
        offset = (page - 1) * page_size
        attempt[offset:offset + page_size] = bytes([0xDE, 0xAD, 0xBE, 0xEF]) * (page_size // 4)
        db_path.write_bytes(attempt)
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        try:
            conn.execute("SELECT rowid FROM fts_units LIMIT 1").fetchone()
            first_row_ok = True
        except sqlite3.Error:
            first_row_ok = False
        try:
            conn.execute("SELECT COUNT(*) FROM fts_units").fetchone()
            scan_raises = False
        except sqlite3.DatabaseError:
            scan_raises = True
        conn.close()
        if first_row_ok and scan_raises:
            return page
    db_path.write_bytes(original)
    return None
