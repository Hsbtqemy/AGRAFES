"""Les deux routes du statut par étape, par HTTP (ACT-01, contrat 1.6.88).

Les tests de service couvrent la logique, y compris la péremption. Ce qu'ils ne peuvent
pas couvrir, c'est le **routage** : une faute de frappe dans le `elif path == …` du
sidecar les laisserait tous verts et rendrait la route introuvable. D'où un aller-retour
réel, plus la lecture par `GET /documents` — le seul chemin par lequel le front verra
jamais ces coches.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest


def _http_json(method: str, url: str, payload: dict | None = None) -> tuple[int, dict]:
    data = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json; charset=utf-8"
    req = Request(url, method=method, data=data, headers=headers)
    try:
        with urlopen(req, timeout=10.0) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except HTTPError as exc:
        return exc.code, json.loads(exc.read().decode("utf-8"))


@pytest.fixture()
def step_env(tmp_path: Path) -> dict:
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.db.migrations import apply_migrations
    from multicorpus_engine.importers.txt import import_txt_numbered_lines
    from multicorpus_engine.sidecar import CorpusServer

    db_path = tmp_path / "step.db"
    conn = get_connection(db_path)
    apply_migrations(conn)
    txt = tmp_path / "doc.txt"
    txt.write_text("[1] Une ligne.\n[2] Une autre.\n", encoding="utf-8")
    report = import_txt_numbered_lines(conn=conn, path=txt, language="fr", title="Step")
    conn.close()

    server = CorpusServer(db_path=db_path, host="127.0.0.1", port=0)
    server.start()
    base = f"http://127.0.0.1:{server.actual_port}"
    for _ in range(50):
        code, payload = _http_json("GET", f"{base}/health")
        if code == 200 and payload.get("ok") is True:
            break
        time.sleep(0.05)
    try:
        yield {"base_url": base, "doc_id": report.doc_id, "db_path": db_path}
    finally:
        server.shutdown()


def _step_status(base: str, doc_id: int) -> dict:
    code, payload = _http_json("GET", f"{base}/documents")
    assert code == 200
    row = next(d for d in payload["documents"] if d["doc_id"] == doc_id)
    return row["step_status"]


def test_poser_puis_retirer_une_coche(step_env: dict) -> None:
    base, doc_id = step_env["base_url"], step_env["doc_id"]

    assert _step_status(base, doc_id) == {}, "aucune coche au départ"

    code, out = _http_json("POST", f"{base}/documents/step_status",
                           {"doc_id": doc_id, "step": "segmentation"})
    assert code == 200, out
    assert out["step"] == "segmentation"
    assert out["basis"] == "derived"     # aucun historique sur un document fraîchement importé

    etat = _step_status(base, doc_id)["segmentation"]
    assert etat["stale"] is False
    assert etat["validated_at"] == out["validated_at"]

    code, out = _http_json("POST", f"{base}/documents/step_status/clear",
                           {"doc_id": doc_id, "step": "segmentation"})
    assert code == 200 and out["cleared"] is True
    assert _step_status(base, doc_id) == {}


def test_la_coche_perime_quand_le_document_change(step_env: dict) -> None:
    """Le tout du modèle : une coche que le travail suivant dément retombe à `[/]`."""
    import sqlite3

    base, doc_id = step_env["base_url"], step_env["doc_id"]
    code, _ = _http_json("POST", f"{base}/documents/step_status",
                         {"doc_id": doc_id, "step": "segmentation"})
    assert code == 200
    assert _step_status(base, doc_id)["segmentation"]["stale"] is False

    # Une unité de plus, sans passer par l'historique : c'est le signal dérivé qui doit
    # rattraper — le cas des 36 documents sur 58 que l'historique ignore.
    conn = sqlite3.connect(str(step_env["db_path"]))
    conn.execute(
        "INSERT INTO units (doc_id, unit_type, n, text_raw, text_norm)"
        " VALUES (?, 'line', 99, 'z', 'z')", (doc_id,)
    )
    conn.commit()
    conn.close()

    etat = _step_status(base, doc_id)["segmentation"]
    assert etat["stale"] is True
    assert etat["stale_reason"] == "derived:unit_count"


def test_capacite_inconnue_refusee(step_env: dict) -> None:
    code, out = _http_json("POST", f"{step_env['base_url']}/documents/step_status",
                           {"doc_id": step_env["doc_id"], "step": "relecture"})
    assert code == 400
    assert out["error_code"] == "BAD_REQUEST"


def test_document_inconnu_refuse(step_env: dict) -> None:
    code, out = _http_json("POST", f"{step_env['base_url']}/documents/step_status",
                           {"doc_id": 99999, "step": "curation"})
    assert code == 404
    assert out["error_code"] == "NOT_FOUND"


def test_supprimer_le_document_emporte_ses_coches(step_env: dict) -> None:
    """La cascade, éprouvée par le chemin réel plutôt que par un PRAGMA.

    Sans `ON DELETE CASCADE`, avec `foreign_keys=ON`, la suppression lève l'erreur APRÈS
    avoir détruit des lignes, sans rollback : c'est ce que la migration 028 avait fait
    tomber. Le test passe donc par `POST /documents/delete`, pas par un DELETE à la main.
    """
    base, doc_id = step_env["base_url"], step_env["doc_id"]
    _http_json("POST", f"{base}/documents/step_status", {"doc_id": doc_id, "step": "curation"})

    code, out = _http_json("POST", f"{base}/documents/delete", {"doc_ids": [doc_id]})
    assert code == 200, out

    import sqlite3
    conn = sqlite3.connect(str(step_env["db_path"]))
    try:
        n = conn.execute("SELECT COUNT(*) FROM doc_step_status").fetchone()[0]
    finally:
        conn.close()
    assert n == 0, "les coches d'un document supprimé doivent partir avec lui"
