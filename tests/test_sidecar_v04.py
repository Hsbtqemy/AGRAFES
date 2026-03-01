"""V0.4 contract tests — metadata panel, exports, align link editing."""

from __future__ import annotations

import json
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import pytest


# ─── HTTP helpers ──────────────────────────────────────────────────────────────

def _http(method: str, url: str, payload: dict | None = None, token: str | None = None) -> tuple[int, dict]:
    data: bytes | None = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json; charset=utf-8"
    if token:
        headers["X-Agrafes-Token"] = token
    req = Request(url, method=method, data=data, headers=headers)
    try:
        with urlopen(req, timeout=10.0) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except HTTPError as exc:
        return exc.code, json.loads(exc.read().decode("utf-8"))


def _get(url: str, token: str | None = None) -> tuple[int, dict]:
    return _http("GET", url, token=token)


def _post(url: str, payload: dict, token: str | None = None) -> tuple[int, dict]:
    return _http("POST", url, payload, token=token)


def _wait_health(base_url: str, tries: int = 50) -> None:
    import time
    for _ in range(tries):
        code, payload = _get(f"{base_url}/health")
        if code == 200 and payload.get("ok") is True:
            return
        time.sleep(0.05)
    raise RuntimeError("Sidecar not ready")


# ─── Shared fixture ────────────────────────────────────────────────────────────

@pytest.fixture()
def v04_sidecar(tmp_path: Path):
    """Sidecar with pivot + target docs imported, aligned, and FTS built."""
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.db.migrations import apply_migrations
    from multicorpus_engine.importers.txt import import_txt_numbered_lines
    from multicorpus_engine.aligner import align_by_external_id
    from multicorpus_engine.indexer import build_index
    from multicorpus_engine.sidecar import CorpusServer

    db_path = tmp_path / "v04.db"
    conn = get_connection(db_path)
    apply_migrations(conn)

    pivot_txt = tmp_path / "pivot.txt"
    pivot_txt.write_text(
        "[1] Bonjour monde. Voici le texte un.\n"
        "[2] Au revoir monde. Le texte deux.\n"
        "[3] Un troisième exemple ici.\n",
        encoding="utf-8",
    )
    pivot = import_txt_numbered_lines(conn=conn, path=pivot_txt, language="fr", title="Pivot FR")

    target_txt = tmp_path / "target.txt"
    target_txt.write_text(
        "[1] Hello world. Here is text one.\n"
        "[2] Goodbye world. The text two.\n"
        "[3] A third example here.\n",
        encoding="utf-8",
    )
    target = import_txt_numbered_lines(conn=conn, path=target_txt, language="en", title="Target EN")

    align_by_external_id(
        conn=conn,
        pivot_doc_id=pivot.doc_id,
        target_doc_ids=[target.doc_id],
        run_id="v04-test",
    )
    build_index(conn)
    conn.close()

    server = CorpusServer(db_path=db_path, host="127.0.0.1", port=0, token="testtoken")
    server.start()
    base_url = f"http://127.0.0.1:{server.actual_port}"
    _wait_health(base_url)
    try:
        yield {
            "base_url": base_url,
            "token": "testtoken",
            "pivot_doc_id": pivot.doc_id,
            "target_doc_id": target.doc_id,
            "tmp_path": tmp_path,
        }
    finally:
        server.shutdown()


# ═══════════════════════════════════════════════════════════════════════════════
# V0.4A — Metadata panel
# ═══════════════════════════════════════════════════════════════════════════════

def test_documents_update_fields(v04_sidecar) -> None:
    base_url = v04_sidecar["base_url"]
    token = v04_sidecar["token"]
    doc_id = v04_sidecar["pivot_doc_id"]

    code, payload = _post(f"{base_url}/documents/update", {
        "doc_id": doc_id,
        "title": "Pivot FR (updated)",
        "doc_role": "original",
        "resource_type": "literary",
    }, token=token)
    assert code == 200, payload
    assert payload["ok"] is True
    assert payload["updated"] == 1
    assert payload["doc"]["title"] == "Pivot FR (updated)"
    assert payload["doc"]["doc_role"] == "original"
    assert payload["doc"]["resource_type"] == "literary"


def test_documents_update_no_doc_id_is_400(v04_sidecar) -> None:
    from multicorpus_engine.sidecar_contract import ERR_BAD_REQUEST
    code, payload = _post(f"{v04_sidecar['base_url']}/documents/update", {"title": "x"}, token=v04_sidecar["token"])
    assert code == 400
    assert payload["error"]["type"] == ERR_BAD_REQUEST


def test_documents_update_unknown_doc_is_404(v04_sidecar) -> None:
    from multicorpus_engine.sidecar_contract import ERR_NOT_FOUND
    code, payload = _post(f"{v04_sidecar['base_url']}/documents/update", {"doc_id": 9999, "title": "x"}, token=v04_sidecar["token"])
    assert code == 404
    assert payload["error"]["type"] == ERR_NOT_FOUND


def test_documents_update_requires_token(v04_sidecar) -> None:
    from multicorpus_engine.sidecar_contract import ERR_UNAUTHORIZED
    code, payload = _post(f"{v04_sidecar['base_url']}/documents/update", {"doc_id": 1, "title": "x"})
    assert code == 401
    assert payload["error"]["type"] == ERR_UNAUTHORIZED


def test_documents_bulk_update(v04_sidecar) -> None:
    base_url = v04_sidecar["base_url"]
    token = v04_sidecar["token"]
    pivot_id = v04_sidecar["pivot_doc_id"]
    target_id = v04_sidecar["target_doc_id"]

    code, payload = _post(f"{base_url}/documents/bulk_update", {
        "updates": [
            {"doc_id": pivot_id, "resource_type": "prose"},
            {"doc_id": target_id, "resource_type": "prose"},
        ]
    }, token=token)
    assert code == 200, payload
    assert payload["ok"] is True
    assert payload["updated"] == 2


def test_doc_relations_set_and_get(v04_sidecar) -> None:
    base_url = v04_sidecar["base_url"]
    token = v04_sidecar["token"]
    pivot_id = v04_sidecar["pivot_doc_id"]
    target_id = v04_sidecar["target_doc_id"]

    # Set relation
    code, payload = _post(f"{base_url}/doc_relations/set", {
        "doc_id": pivot_id,
        "relation_type": "translation_of",
        "target_doc_id": target_id,
        "note": "test relation",
    }, token=token)
    assert code == 200, payload
    assert payload["ok"] is True
    assert payload["action"] in ("created", "updated")
    rel_id = payload["id"]

    # Get relations
    code2, payload2 = _get(f"{base_url}/doc_relations?doc_id={pivot_id}")
    assert code2 == 200
    assert payload2["ok"] is True
    assert payload2["count"] >= 1
    assert any(r["id"] == rel_id for r in payload2["relations"])


def test_doc_relations_set_upserts(v04_sidecar) -> None:
    base_url = v04_sidecar["base_url"]
    token = v04_sidecar["token"]
    pivot_id = v04_sidecar["pivot_doc_id"]
    target_id = v04_sidecar["target_doc_id"]

    _post(f"{base_url}/doc_relations/set", {"doc_id": pivot_id, "relation_type": "excerpt_of", "target_doc_id": target_id}, token=token)
    code2, payload2 = _post(f"{base_url}/doc_relations/set", {"doc_id": pivot_id, "relation_type": "excerpt_of", "target_doc_id": target_id, "note": "updated"}, token=token)
    assert code2 == 200
    assert payload2["action"] == "updated"


def test_doc_relations_delete(v04_sidecar) -> None:
    base_url = v04_sidecar["base_url"]
    token = v04_sidecar["token"]
    pivot_id = v04_sidecar["pivot_doc_id"]
    target_id = v04_sidecar["target_doc_id"]

    _, set_payload = _post(f"{base_url}/doc_relations/set", {"doc_id": pivot_id, "relation_type": "excerpt_of", "target_doc_id": target_id}, token=token)
    rel_id = set_payload["id"]

    code, payload = _post(f"{base_url}/doc_relations/delete", {"id": rel_id}, token=token)
    assert code == 200
    assert payload["deleted"] >= 1


def test_doc_relations_get_missing_param_is_400(v04_sidecar) -> None:
    from multicorpus_engine.sidecar_contract import ERR_BAD_REQUEST
    code, payload = _get(f"{v04_sidecar['base_url']}/doc_relations")
    assert code == 400
    assert payload["error"]["type"] == ERR_BAD_REQUEST


# ═══════════════════════════════════════════════════════════════════════════════
# V0.4B — Exports
# ═══════════════════════════════════════════════════════════════════════════════

def test_export_tei_creates_file(v04_sidecar, tmp_path: Path) -> None:
    base_url = v04_sidecar["base_url"]
    token = v04_sidecar["token"]
    out_dir = tmp_path / "tei_out"

    code, payload = _post(f"{base_url}/export/tei", {
        "doc_ids": [v04_sidecar["pivot_doc_id"]],
        "out_dir": str(out_dir),
    }, token=token)
    assert code == 200, payload
    assert payload["ok"] is True
    assert payload["count"] == 1
    assert len(payload["files_created"]) == 1
    out_file = Path(payload["files_created"][0])
    assert out_file.exists()
    content = out_file.read_text(encoding="utf-8")
    assert "<TEI" in content


def test_export_tei_all_docs(v04_sidecar, tmp_path: Path) -> None:
    base_url = v04_sidecar["base_url"]
    token = v04_sidecar["token"]
    out_dir = tmp_path / "tei_all"

    code, payload = _post(f"{base_url}/export/tei", {
        "out_dir": str(out_dir),
    }, token=token)
    assert code == 200, payload
    assert payload["count"] == 2  # pivot + target


def test_export_tei_requires_token(v04_sidecar, tmp_path: Path) -> None:
    from multicorpus_engine.sidecar_contract import ERR_UNAUTHORIZED
    code, payload = _post(f"{v04_sidecar['base_url']}/export/tei", {"out_dir": str(tmp_path)})
    assert code == 401
    assert payload["error"]["type"] == ERR_UNAUTHORIZED


def test_export_tei_missing_out_dir_is_400(v04_sidecar) -> None:
    from multicorpus_engine.sidecar_contract import ERR_BAD_REQUEST
    code, payload = _post(f"{v04_sidecar['base_url']}/export/tei", {}, token=v04_sidecar["token"])
    assert code == 400
    assert payload["error"]["type"] == ERR_BAD_REQUEST


def test_export_align_csv_creates_file(v04_sidecar, tmp_path: Path) -> None:
    base_url = v04_sidecar["base_url"]
    token = v04_sidecar["token"]
    out_path = tmp_path / "align.csv"

    code, payload = _post(f"{base_url}/export/align_csv", {
        "pivot_doc_id": v04_sidecar["pivot_doc_id"],
        "target_doc_id": v04_sidecar["target_doc_id"],
        "out_path": str(out_path),
    }, token=token)
    assert code == 200, payload
    assert payload["ok"] is True
    assert payload["rows_written"] == 3  # 3 aligned pairs
    assert out_path.exists()
    lines = out_path.read_text(encoding="utf-8").splitlines()
    assert lines[0].startswith("link_id,")  # header
    assert len(lines) == 4  # header + 3 data rows


def test_export_align_csv_tsv(v04_sidecar, tmp_path: Path) -> None:
    base_url = v04_sidecar["base_url"]
    token = v04_sidecar["token"]
    out_path = tmp_path / "align.tsv"

    code, payload = _post(f"{base_url}/export/align_csv", {
        "out_path": str(out_path),
        "delimiter": "\t",
    }, token=token)
    assert code == 200, payload
    lines = out_path.read_text(encoding="utf-8").splitlines()
    assert "\t" in lines[0]


def test_export_align_csv_requires_token(v04_sidecar, tmp_path: Path) -> None:
    from multicorpus_engine.sidecar_contract import ERR_UNAUTHORIZED
    code, payload = _post(f"{v04_sidecar['base_url']}/export/align_csv", {"out_path": str(tmp_path / "x.csv")})
    assert code == 401
    assert payload["error"]["type"] == ERR_UNAUTHORIZED


def test_export_run_report_jsonl(v04_sidecar, tmp_path: Path) -> None:
    base_url = v04_sidecar["base_url"]
    token = v04_sidecar["token"]
    out_path = tmp_path / "report.jsonl"

    code, payload = _post(f"{base_url}/export/run_report", {
        "out_path": str(out_path),
        "format": "jsonl",
    }, token=token)
    assert code == 200, payload
    assert payload["ok"] is True
    assert out_path.exists()
    # File may be empty if fixture uses direct Python API (no sidecar run logging)
    lines = [l for l in out_path.read_text(encoding="utf-8").splitlines() if l.strip()]
    for line in lines:
        record = json.loads(line)
        assert "run_id" in record and "kind" in record


def test_export_run_report_html(v04_sidecar, tmp_path: Path) -> None:
    base_url = v04_sidecar["base_url"]
    token = v04_sidecar["token"]
    out_path = tmp_path / "report.html"

    code, payload = _post(f"{base_url}/export/run_report", {
        "out_path": str(out_path),
        "format": "html",
    }, token=token)
    assert code == 200, payload
    assert out_path.exists()
    html = out_path.read_text(encoding="utf-8")
    assert "<!DOCTYPE html>" in html
    assert "Run Report" in html


def test_export_run_report_missing_out_path_is_400(v04_sidecar) -> None:
    from multicorpus_engine.sidecar_contract import ERR_BAD_REQUEST
    code, payload = _post(f"{v04_sidecar['base_url']}/export/run_report", {}, token=v04_sidecar["token"])
    assert code == 400
    assert payload["error"]["type"] == ERR_BAD_REQUEST


# ═══════════════════════════════════════════════════════════════════════════════
# V0.4C — Alignment link editing
# ═══════════════════════════════════════════════════════════════════════════════

def _get_first_link_id(v04_sidecar) -> int:
    base_url = v04_sidecar["base_url"]
    code, payload = _post(f"{base_url}/align/audit", {
        "pivot_doc_id": v04_sidecar["pivot_doc_id"],
        "target_doc_id": v04_sidecar["target_doc_id"],
        "limit": 1,
    })
    assert code == 200
    return payload["links"][0]["link_id"]


def test_align_audit_returns_status_field(v04_sidecar) -> None:
    base_url = v04_sidecar["base_url"]
    code, payload = _post(f"{base_url}/align/audit", {
        "pivot_doc_id": v04_sidecar["pivot_doc_id"],
        "target_doc_id": v04_sidecar["target_doc_id"],
    })
    assert code == 200
    assert "status" in payload["links"][0]
    assert payload["links"][0]["status"] is None  # unreviewed


def test_align_link_update_status_accepted(v04_sidecar) -> None:
    base_url = v04_sidecar["base_url"]
    token = v04_sidecar["token"]
    link_id = _get_first_link_id(v04_sidecar)

    code, payload = _post(f"{base_url}/align/link/update_status", {
        "link_id": link_id,
        "status": "accepted",
    }, token=token)
    assert code == 200, payload
    assert payload["ok"] is True
    assert payload["link_id"] == link_id
    assert payload["status"] == "accepted"
    assert payload["updated"] == 1

    # Verify persisted
    _, audit = _post(f"{base_url}/align/audit", {
        "pivot_doc_id": v04_sidecar["pivot_doc_id"],
        "target_doc_id": v04_sidecar["target_doc_id"],
    })
    matching = [l for l in audit["links"] if l["link_id"] == link_id]
    assert matching[0]["status"] == "accepted"


def test_align_link_update_status_rejected(v04_sidecar) -> None:
    base_url = v04_sidecar["base_url"]
    token = v04_sidecar["token"]
    link_id = _get_first_link_id(v04_sidecar)

    code, payload = _post(f"{base_url}/align/link/update_status", {
        "link_id": link_id, "status": "rejected",
    }, token=token)
    assert code == 200
    assert payload["status"] == "rejected"


def test_align_link_update_status_invalid_value_is_400(v04_sidecar) -> None:
    from multicorpus_engine.sidecar_contract import ERR_VALIDATION
    link_id = _get_first_link_id(v04_sidecar)
    code, payload = _post(f"{v04_sidecar['base_url']}/align/link/update_status", {
        "link_id": link_id, "status": "unknown_status",
    }, token=v04_sidecar["token"])
    assert code == 400
    assert payload["error"]["type"] == ERR_VALIDATION


def test_align_link_update_status_requires_token(v04_sidecar) -> None:
    from multicorpus_engine.sidecar_contract import ERR_UNAUTHORIZED
    link_id = _get_first_link_id(v04_sidecar)
    code, payload = _post(f"{v04_sidecar['base_url']}/align/link/update_status", {"link_id": link_id, "status": "accepted"})
    assert code == 401
    assert payload["error"]["type"] == ERR_UNAUTHORIZED


def test_align_link_update_status_missing_params_is_400(v04_sidecar) -> None:
    from multicorpus_engine.sidecar_contract import ERR_BAD_REQUEST
    code, payload = _post(f"{v04_sidecar['base_url']}/align/link/update_status", {"link_id": 1}, token=v04_sidecar["token"])
    assert code == 400
    assert payload["error"]["type"] == ERR_BAD_REQUEST


def test_align_audit_status_filter_unreviewed(v04_sidecar) -> None:
    base_url = v04_sidecar["base_url"]
    token = v04_sidecar["token"]
    link_id = _get_first_link_id(v04_sidecar)
    # Accept first link
    _post(f"{base_url}/align/link/update_status", {"link_id": link_id, "status": "accepted"}, token=token)
    # Unreviewed filter should return 2 (not the accepted one)
    code, payload = _post(f"{base_url}/align/audit", {
        "pivot_doc_id": v04_sidecar["pivot_doc_id"],
        "target_doc_id": v04_sidecar["target_doc_id"],
        "status": "unreviewed",
    })
    assert code == 200
    assert len(payload["links"]) == 2
    assert all(l["status"] is None for l in payload["links"])


def test_align_audit_status_filter_accepted(v04_sidecar) -> None:
    base_url = v04_sidecar["base_url"]
    token = v04_sidecar["token"]
    link_id = _get_first_link_id(v04_sidecar)
    _post(f"{base_url}/align/link/update_status", {"link_id": link_id, "status": "accepted"}, token=token)
    code, payload = _post(f"{base_url}/align/audit", {
        "pivot_doc_id": v04_sidecar["pivot_doc_id"],
        "target_doc_id": v04_sidecar["target_doc_id"],
        "status": "accepted",
    })
    assert code == 200
    assert len(payload["links"]) == 1
    assert payload["links"][0]["link_id"] == link_id


def test_align_link_retarget(v04_sidecar) -> None:
    """Retarget changes target_unit_id to another valid unit."""
    base_url = v04_sidecar["base_url"]
    token = v04_sidecar["token"]

    # Get all audit links
    _, audit = _post(f"{base_url}/align/audit", {
        "pivot_doc_id": v04_sidecar["pivot_doc_id"],
        "target_doc_id": v04_sidecar["target_doc_id"],
    })
    link = audit["links"][0]
    link_id = link["link_id"]
    other_target_unit_id = audit["links"][1]["target_unit_id"]  # swap to another valid unit

    code, payload = _post(f"{base_url}/align/link/retarget", {
        "link_id": link_id,
        "new_target_unit_id": other_target_unit_id,
    }, token=token)
    assert code == 200, payload
    assert payload["ok"] is True
    assert payload["new_target_unit_id"] == other_target_unit_id


def test_align_link_retarget_nonexistent_unit_is_404(v04_sidecar) -> None:
    from multicorpus_engine.sidecar_contract import ERR_NOT_FOUND
    link_id = _get_first_link_id(v04_sidecar)
    code, payload = _post(f"{v04_sidecar['base_url']}/align/link/retarget", {
        "link_id": link_id,
        "new_target_unit_id": 99999,
    }, token=v04_sidecar["token"])
    assert code == 404
    assert payload["error"]["type"] == ERR_NOT_FOUND


def test_align_link_delete(v04_sidecar) -> None:
    base_url = v04_sidecar["base_url"]
    token = v04_sidecar["token"]
    link_id = _get_first_link_id(v04_sidecar)

    code, payload = _post(f"{base_url}/align/link/delete", {"link_id": link_id}, token=token)
    assert code == 200, payload
    assert payload["ok"] is True
    assert payload["deleted"] == 1

    # Verify gone
    _, audit = _post(f"{base_url}/align/audit", {
        "pivot_doc_id": v04_sidecar["pivot_doc_id"],
        "target_doc_id": v04_sidecar["target_doc_id"],
    })
    assert all(l["link_id"] != link_id for l in audit["links"])


def test_align_link_delete_requires_token(v04_sidecar) -> None:
    from multicorpus_engine.sidecar_contract import ERR_UNAUTHORIZED
    code, payload = _post(f"{v04_sidecar['base_url']}/align/link/delete", {"link_id": 1})
    assert code == 401
    assert payload["error"]["type"] == ERR_UNAUTHORIZED


def test_align_link_delete_missing_param_is_400(v04_sidecar) -> None:
    from multicorpus_engine.sidecar_contract import ERR_BAD_REQUEST
    code, payload = _post(f"{v04_sidecar['base_url']}/align/link/delete", {}, token=v04_sidecar["token"])
    assert code == 400
    assert payload["error"]["type"] == ERR_BAD_REQUEST
