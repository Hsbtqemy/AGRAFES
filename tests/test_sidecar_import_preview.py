"""Tests for POST /import/preview — read-only CoNLL-U parse endpoint."""

from __future__ import annotations

import json
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest

from tests.conftest import make_docx
from tests.support_odt import make_odt_bytes


# ─── HTTP helpers ─────────────────────────────────────────────────────────────

def _post(url: str, payload: dict) -> tuple[int, dict]:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = Request(
        url,
        method="POST",
        data=data,
        headers={"Content-Type": "application/json; charset=utf-8", "Accept": "application/json"},
    )
    try:
        with urlopen(req, timeout=10.0) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except HTTPError as exc:
        return exc.code, json.loads(exc.read().decode("utf-8"))


def _wait_health(base_url: str, tries: int = 50) -> None:
    import time
    from urllib.request import urlopen
    for _ in range(tries):
        try:
            with urlopen(f"{base_url}/health", timeout=1.0) as r:
                body = json.loads(r.read())
                if body.get("ok"):
                    return
        except Exception:
            pass
        time.sleep(0.05)
    raise RuntimeError("Sidecar not ready")


# ─── Fixture ──────────────────────────────────────────────────────────────────

@pytest.fixture()
def preview_sidecar(tmp_path: Path):
    """Minimal sidecar fixture — no documents imported, just an empty DB."""
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.db.migrations import apply_migrations
    from multicorpus_engine.sidecar import CorpusServer

    db_path = tmp_path / "preview.db"
    conn = get_connection(db_path)
    apply_migrations(conn)
    conn.close()

    server = CorpusServer(db_path=db_path, host="127.0.0.1", port=0)
    server.start()
    base_url = f"http://127.0.0.1:{server.actual_port}"
    _wait_health(base_url)
    try:
        yield base_url, tmp_path
    finally:
        server.shutdown()


# ─── CoNLL-U fixture text ──────────────────────────────────────────────────────

_CONLLU_SAMPLE = """\
# sent_id = 1
# text = Du calme.
1-2\tDu\t_\t_\t_\t_\t_\t_\t_\t_
1\tDe\tde\tADP\t_\t_\t0\troot\t_\t_
2\tle\tle\tDET\t_\t_\t1\tdet\t_\t_
3\tcalme\tcalme\tNOUN\t_\t_\t1\tobj\t_\t_

# sent_id = 2
# text = Il vient.
1\tIl\til\tPRON\t_\t_\t0\tnsubj\t_\t_
2\tvient\tvenir\tVERB\t_\t_\t0\troot\t_\t_

# sent_id = 3
# text = Vide.
1.1\tvide\t_\t_\t_\t_\t_\t_\t_\t_
bad line without 10 cols
3\tfin\tfin\tNOUN\t_\t_\t0\troot\t_\t_

"""


# ─── Tests ────────────────────────────────────────────────────────────────────

def test_conllu_preview_counts(preview_sidecar):
    """Sentence/token/skip counts match expected values for the sample file."""
    base_url, tmp_path = preview_sidecar
    conllu_file = tmp_path / "sample.conllu"
    conllu_file.write_text(_CONLLU_SAMPLE, encoding="utf-8")

    code, body = _post(f"{base_url}/import/preview", {
        "path": str(conllu_file),
        "mode": "conllu",
        "limit": 60,
    })

    assert code == 200, body
    assert body["ok"] is True
    s = body["conllu_stats"]
    assert s is not None
    assert s["sentences"] == 3          # 3 blank-line-separated blocks
    assert s["tokens"] == 6             # 3 + 2 + 1 regular tokens (no ranges/empties)
    assert s["skipped_ranges"] == 1     # 1-2 range
    assert s["skipped_empty_nodes"] == 1  # 1.1 empty node
    assert s["malformed_lines"] == 1    # "bad line without 10 cols"


def test_conllu_preview_sample_rows(preview_sidecar):
    """sample_rows contains correct token data up to limit."""
    base_url, tmp_path = preview_sidecar
    conllu_file = tmp_path / "rows.conllu"
    conllu_file.write_text(_CONLLU_SAMPLE, encoding="utf-8")

    code, body = _post(f"{base_url}/import/preview", {
        "path": str(conllu_file),
        "mode": "conllu",
        "limit": 3,
    })

    assert code == 200
    rows = body["conllu_stats"]["sample_rows"]
    assert len(rows) == 3
    # First token of sentence 1: "De" / "de" / ADP
    first = rows[0]
    assert first["form"] == "De"
    assert first["lemma"] == "de"
    assert first["upos"] == "ADP"
    assert first["id"] == "1"


def test_conllu_preview_empty_file(preview_sidecar):
    """Empty file → 0 sentences, 0 tokens, empty sample_rows."""
    base_url, tmp_path = preview_sidecar
    empty = tmp_path / "empty.conllu"
    empty.write_text("", encoding="utf-8")

    code, body = _post(f"{base_url}/import/preview", {
        "path": str(empty),
        "mode": "conllu",
    })

    assert code == 200
    s = body["conllu_stats"]
    assert s["sentences"] == 0
    assert s["tokens"] == 0
    assert s["sample_rows"] == []


def test_preview_missing_path_returns_400(preview_sidecar):
    """Missing path field → 400 validation error."""
    base_url, _ = preview_sidecar
    code, body = _post(f"{base_url}/import/preview", {"mode": "conllu"})
    assert code == 400
    assert body["ok"] is False


def test_preview_missing_mode_returns_400(preview_sidecar):
    """Missing mode field → 400 validation error."""
    base_url, tmp_path = preview_sidecar
    f = tmp_path / "x.conllu"
    f.write_text("", encoding="utf-8")
    code, body = _post(f"{base_url}/import/preview", {"path": str(f)})
    assert code == 400
    assert body["ok"] is False


def test_preview_nonexistent_file_returns_404(preview_sidecar):
    """Non-existent file path → 404."""
    base_url, tmp_path = preview_sidecar
    code, body = _post(f"{base_url}/import/preview", {
        "path": str(tmp_path / "ghost.conllu"),
        "mode": "conllu",
    })
    assert code == 404
    assert body["ok"] is False


def test_preview_non_conllu_mode_returns_null_stats(preview_sidecar):
    """Non-conllu mode → ok=True, conllu_stats=None, and a units payload (A-02)."""
    base_url, tmp_path = preview_sidecar
    f = tmp_path / "doc.txt"
    f.write_text("Hello world\n", encoding="utf-8")
    code, body = _post(f"{base_url}/import/preview", {
        "path": str(f),
        "mode": "txt",
    })
    assert code == 200
    assert body["ok"] is True
    assert body["conllu_stats"] is None
    # A non-numbered line is a structure unit (not a line) — the preview now
    # surfaces that, exactly like the import.
    assert body["units"] == [
        {"n": 1, "external_id": None, "unit_type": "structure", "text_raw": "Hello world"},
    ]
    assert body["units_total"] == 1
    assert body["truncated"] is False


# ─── A-02: text-mode preview goes through parse_<mode> over HTTP ────────────────
# These exercise the sidecar dispatch wiring per mode (the parse output itself is
# pinned in tests/importers/test_parse_layer.py). Expected payloads are what
# parse_<mode>() produces, so preview MUST equal import.

def test_txt_preview_units(preview_sidecar):
    base_url, tmp_path = preview_sidecar
    f = tmp_path / "d.txt"
    f.write_text("[1] alpha\nTitre\n[2] beta\n", encoding="utf-8")
    code, body = _post(f"{base_url}/import/preview", {"path": str(f), "mode": "txt", "limit": 2})
    assert code == 200, body
    assert body["units"] == [
        {"n": 1, "external_id": 1, "unit_type": "line", "text_raw": "alpha"},
        {"n": 2, "external_id": None, "unit_type": "structure", "text_raw": "Titre"},
    ]
    assert body["units_total"] == 3
    assert body["truncated"] is True   # 3 > limit 2


def test_docx_preview_units_labels_structure(preview_sidecar):
    # Pins the A-02 fix: a non-numbered docx paragraph is "structure"/None
    # (the old preview wrongly reported it as "line"/external_id=n).
    base_url, tmp_path = preview_sidecar
    f = tmp_path / "d.docx"
    f.write_bytes(make_docx(["Intro", "[1] Bonjour.", "[2] Le chat¤le chien."]))
    code, body = _post(f"{base_url}/import/preview", {"path": str(f), "mode": "docx_numbered_lines"})
    assert code == 200, body
    assert body["units"] == [
        {"n": 1, "external_id": None, "unit_type": "structure", "text_raw": "Intro"},
        {"n": 2, "external_id": 1, "unit_type": "line", "text_raw": "Bonjour."},
        {"n": 3, "external_id": 2, "unit_type": "line", "text_raw": "Le chat¤le chien."},
    ]


def test_odt_preview_units_not_broken(preview_sidecar):
    # Pins the A-02 fix: the old ODT preview iterated (rich, level) tuples into
    # normalize() and 500'd. Going through parse_odt_numbered_lines fixes it.
    base_url, tmp_path = preview_sidecar
    f = tmp_path / "d.odt"
    f.write_bytes(make_odt_bytes(["Intro", "[1] Bonjour.", "[2] Le monde."]))
    code, body = _post(f"{base_url}/import/preview", {"path": str(f), "mode": "odt_numbered_lines"})
    assert code == 200, body
    assert body["units"] == [
        {"n": 1, "external_id": None, "unit_type": "structure", "text_raw": "Intro"},
        {"n": 2, "external_id": 1, "unit_type": "line", "text_raw": "Bonjour."},
        {"n": 3, "external_id": 2, "unit_type": "line", "text_raw": "Le monde."},
    ]


def test_tei_preview_units_xmlid_fallback(preview_sidecar):
    # Pins the A-02 fix: external_id falls back to n when xml:id has no trailing
    # digit (the old preview left it None).
    base_url, tmp_path = preview_sidecar
    f = tmp_path / "d.xml"
    f.write_bytes(
        b'<?xml version="1.0" encoding="UTF-8"?>\n'
        b'<TEI xmlns="http://www.tei-c.org/ns/1.0">\n'
        b"  <teiHeader><fileDesc><titleStmt><title>T</title></titleStmt></fileDesc></teiHeader>\n"
        b'  <text xml:lang="fr"><body>\n'
        b'    <p xml:id="p5">Premier.</p>\n'
        b"    <p>Deuxieme.</p>\n"
        b"  </body></text>\n"
        b"</TEI>\n"
    )
    code, body = _post(f"{base_url}/import/preview", {"path": str(f), "mode": "tei"})
    assert code == 200, body
    assert body["units"] == [
        {"n": 1, "external_id": 5, "unit_type": "line", "text_raw": "Premier."},
        {"n": 2, "external_id": 2, "unit_type": "line", "text_raw": "Deuxieme."},
    ]
