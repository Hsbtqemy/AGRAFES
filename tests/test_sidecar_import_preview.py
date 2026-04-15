"""Tests for POST /import/preview — read-only CoNLL-U parse endpoint."""

from __future__ import annotations

import json
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest


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
    """Non-conllu mode → ok=True, conllu_stats=None (no text preview implemented)."""
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
