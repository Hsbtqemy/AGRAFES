"""HTTP tests for the units update_text / list adapters (A-01).

set_role / bulk_set_role are already covered by tests/test_sidecar_conventions.py;
this fills the gap for update_text (write) and GET /units (read). Runs in CI; the
service logic is unit-tested in tests/services/test_units_service.py.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest


def _http(method: str, url: str, payload: dict | None = None, token: str | None = None) -> tuple[int, dict]:
    data = None
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


def _wait_health(base_url: str, tries: int = 50) -> None:
    for _ in range(tries):
        try:
            code, body = _http("GET", f"{base_url}/health")
            if code == 200 and body.get("ok") is True:
                return
        except Exception:
            pass
        time.sleep(0.05)
    raise RuntimeError("Sidecar not ready")


@pytest.fixture()
def units_env(tmp_path: Path):
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.db.migrations import apply_migrations
    from multicorpus_engine.sidecar import CorpusServer

    db_path = tmp_path / "units.db"
    conn = get_connection(db_path)
    apply_migrations(conn)
    cur = conn.execute(
        "INSERT INTO documents (title, language, doc_role, created_at)"
        " VALUES ('D', 'fr', 'standalone', datetime('now'))"
    )
    doc_id = cur.lastrowid
    c = conn.execute(
        "INSERT INTO units (doc_id, unit_type, n, text_raw, text_norm) VALUES (?, 'line', 1, 'orig', 'orig')",
        (doc_id,),
    )
    unit_id = c.lastrowid
    conn.commit()
    conn.close()

    token = "units-token"
    server = CorpusServer(db_path=db_path, host="127.0.0.1", port=0, token=token)
    server.start()
    base = f"http://127.0.0.1:{server.actual_port}"
    _wait_health(base)
    try:
        yield {"base": base, "token": token, "doc_id": doc_id, "unit_id": unit_id}
    finally:
        server.shutdown()


def test_units_list_get(units_env: dict) -> None:
    base, doc_id = units_env["base"], units_env["doc_id"]
    code, body = _http("GET", f"{base}/units?doc_id={doc_id}")
    assert code == 200, body
    assert body["doc_id"] == doc_id and body["count"] == 1
    assert body["units"][0]["n"] == 1


def test_units_list_requires_doc_id(units_env: dict) -> None:
    code, body = _http("GET", f"{units_env['base']}/units")
    assert code == 400, body
    assert body["ok"] is False


def test_update_text_success(units_env: dict) -> None:
    base, token, unit_id = units_env["base"], units_env["token"], units_env["unit_id"]
    code, body = _http(
        "POST", f"{base}/units/update_text",
        {"unit_id": unit_id, "text_raw": "Modifié"}, token=token,
    )
    assert code == 200, body
    assert body["text_raw"] == "Modifié" and body["text_norm"] == "Modifié"
    assert body["unit_id"] == unit_id


def test_update_text_unknown_unit_404(units_env: dict) -> None:
    base, token = units_env["base"], units_env["token"]
    code, body = _http(
        "POST", f"{base}/units/update_text",
        {"unit_id": 99999, "text_raw": "x"}, token=token,
    )
    assert code == 404, body


def test_update_text_missing_fields_400(units_env: dict) -> None:
    base, token, unit_id = units_env["base"], units_env["token"], units_env["unit_id"]
    code, body = _http(
        "POST", f"{base}/units/update_text", {"unit_id": unit_id}, token=token,
    )
    assert code == 400, body


def test_update_text_dissolves_the_cut_of_the_corrected_sentence(tmp_path: Path) -> None:
    """D-1 (ALI-01 tranche 2) — corriger une phrase coupée annule sa coupe, sur TOUTES
    les lignes moyeu qui s'en partagent des morceaux.

    Depuis la bascule, les offsets indexent ``text_norm`` : une correction réécrit la
    chaîne sous les bornes. Les deux moitiés d'une coupe se partagent l'unité avec des
    fenêtres complémentaires, donc n'en effacer qu'une créerait un RECOUVREMENT — c'est
    pourquoi la portée est l'unité entière et non la cellule.
    """
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.db.migrations import apply_migrations
    from multicorpus_engine.sidecar import CorpusServer

    db_path = tmp_path / "cut.db"
    conn = get_connection(db_path)
    apply_migrations(conn)
    for title, lang, role in (("P", "fr", "original"), ("T", "en", "translation")):
        conn.execute(
            "INSERT INTO documents (title, language, doc_role, created_at)"
            " VALUES (?,?,?,datetime('now'))", (title, lang, role),
        )
    # Deux segments pivot se partagent UNE phrase cible coupée en deux fenêtres.
    for n in (1, 2):
        conn.execute(
            "INSERT INTO units (doc_id,unit_type,n,text_raw,text_norm)"
            " VALUES (1,'line',?,?,?)", (n, f"Pivot {n}.", f"pivot {n}."),
        )
    conn.execute(
        "INSERT INTO units (doc_id,unit_type,n,text_raw,text_norm)"
        " VALUES (2,'line',1,'morning evening','morning evening')"
    )
    conn.commit()
    tgt = conn.execute("SELECT unit_id FROM units WHERE doc_id=2").fetchone()[0]
    pivots = [r[0] for r in conn.execute("SELECT unit_id FROM units WHERE doc_id=1 ORDER BY n")]
    for piv, (cs, ce) in zip(pivots, ((0, 8), (8, 15))):
        conn.execute(
            "INSERT INTO alignment_links (run_id,pivot_unit_id,target_unit_id,external_id,"
            " pivot_doc_id,target_doc_id,created_at,target_char_start,target_char_end)"
            " VALUES ('r',?,?,1,1,2,datetime('now'),?,?)", (piv, tgt, cs, ce),
        )
    conn.commit()
    conn.close()

    server = CorpusServer(db_path=db_path, host="127.0.0.1", port=0, token="t")
    server.start()
    base = f"http://127.0.0.1:{server.actual_port}"
    _wait_health(base)
    try:
        code, body = _http(
            "POST", f"{base}/units/update_text",
            {"unit_id": tgt, "text_norm": "morning, evening"}, token="t",
        )
        assert code == 200, body
        # Les DEUX liens, portés par deux pivots différents, perdent leur fenêtre.
        assert body["cut_spans_cleared"] == 2, body

        c2 = get_connection(db_path)
        spans = c2.execute(
            "SELECT target_char_start, target_char_end FROM alignment_links"
            " WHERE target_unit_id=?", (tgt,),
        ).fetchall()
        assert [tuple(r) for r in spans] == [(None, None), (None, None)]
        c2.close()
    finally:
        server.shutdown()


def test_update_text_without_a_cut_reports_zero(units_env: dict) -> None:
    """Le cas courant : rien à dissoudre, et le compte le dit — c'est lui qui rend
    le message silencieux côté interface."""
    base, token, unit_id = units_env["base"], units_env["token"], units_env["unit_id"]
    code, body = _http(
        "POST", f"{base}/units/update_text",
        {"unit_id": unit_id, "text_norm": "corrigé"}, token=token,
    )
    assert code == 200, body
    assert body["cut_spans_cleared"] == 0, body
