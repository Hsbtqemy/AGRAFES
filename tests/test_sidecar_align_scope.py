"""Relance d'alignement scopée à une colonne — POST /families/{id}/align + /align/matrix
avec `target_doc_ids` (contrat 1.6.77, ALI-15 / ALI-18).

Ce que ces tests protègent est destructeur : avant 1.6.77, « Recalcul global » purgeait
TOUTES les paires de la famille, et `preserve_accepted` ne sauve que `status='accepted'`.
Réparer une langue détruisait donc le travail manuel fait sur les autres. Le test central
est celui-là : un run scopé sur EN laisse la colonne ES bit pour bit — link_id compris.
"""

from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest


def _http_json(method: str, url: str, payload: dict | None = None) -> tuple[int, dict]:
    data: bytes | None = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json; charset=utf-8"
    req = Request(url, method=method, data=data, headers=headers)
    try:
        with urlopen(req, timeout=15.0) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except HTTPError as exc:
        return exc.code, json.loads(exc.read().decode("utf-8"))


def _wait_health(base_url: str, tries: int = 80) -> None:
    for _ in range(tries):
        code, payload = _http_json("GET", f"{base_url}/health")
        if code == 200 and payload.get("ok") is True:
            return
        time.sleep(0.05)
    raise RuntimeError("Sidecar not ready")


@pytest.fixture()
def family_server(tmp_path: Path):
    """Un sidecar servant une famille fr (moyeu) + en + es, chaque texte à 4 lignes
    numérotées — donc alignable par `external_id` sans dépendre du grain de ¶."""
    from multicorpus_engine.sidecar import CorpusServer

    db_path = tmp_path / "align_scope.db"
    texts = {
        "fr": "[1] Le matin.\n[2] Le soir.\n[3] La nuit.\n[4] Le jour.\n",
        "en": "[1] Morning.\n[2] Evening.\n[3] Night.\n[4] Day.\n",
        "es": "[1] Manana.\n[2] Tarde.\n[3] Noche.\n[4] Dia.\n",
    }
    server = CorpusServer(db_path=db_path, host="127.0.0.1", port=0)
    server.start()
    base = f"http://127.0.0.1:{server.actual_port}"
    try:
        _wait_health(base)
        docs: dict[str, int] = {}
        for lang, body in texts.items():
            src = tmp_path / f"{lang}.txt"
            src.write_text(body, encoding="utf-8")
            code, res = _http_json("POST", f"{base}/import", {
                "mode": "txt_numbered_lines", "path": str(src),
                "language": lang, "title": lang.upper(),
            })
            assert code == 200, res
            docs[lang] = res["doc_id"]
        for lang in ("en", "es"):
            code, res = _http_json("POST", f"{base}/doc_relations/set", {
                "doc_id": docs[lang], "relation_type": "translation_of",
                "target_doc_id": docs["fr"],
            })
            assert code == 200, res
        yield base, docs, db_path
    finally:
        server.shutdown()


def _links(db_path: Path, pivot: int, target: int) -> list[tuple]:
    conn = sqlite3.connect(str(db_path))
    try:
        return conn.execute(
            "SELECT link_id, pivot_unit_id, target_unit_id, run_id FROM alignment_links"
            " WHERE pivot_doc_id=? AND target_doc_id=? ORDER BY link_id",
            (pivot, target),
        ).fetchall()
    finally:
        conn.close()


def test_scoped_recalc_leaves_the_other_column_untouched(family_server) -> None:
    """Le cœur d'ALI-15 : un « Recalcul global » scopé sur EN ne doit rien réécrire dans
    la colonne ES — pas même un link_id, puisque la purge est par paire exacte."""
    base, docs, db_path = family_server
    code, res = _http_json("POST", f"{base}/families/{docs['fr']}/align",
                           {"strategy": "external_id"})
    assert code == 200, res
    assert res["summary"]["total_pairs"] == 2

    es_before = _links(db_path, docs["fr"], docs["es"])
    en_before = _links(db_path, docs["fr"], docs["en"])
    assert es_before and en_before

    code, res = _http_json("POST", f"{base}/families/{docs['fr']}/align", {
        "strategy": "external_id", "replace_existing": True,
        "target_doc_ids": [docs["en"]],
    })
    assert code == 200, res
    # Le run ne connaît qu'une paire : la colonne hors périmètre n'est même pas
    # rapportée « ignorée » — elle n'entre pas dans le run.
    assert res["summary"]["total_pairs"] == 1
    assert [r["target_doc_id"] for r in res["results"]] == [docs["en"]]

    assert _links(db_path, docs["fr"], docs["es"]) == es_before, "la colonne ES a bougé"
    en_after = _links(db_path, docs["fr"], docs["en"])
    assert [r[0] for r in en_after] != [r[0] for r in en_before], "EN n'a pas été recalculé"


def test_scoped_recalc_spares_a_manual_link_in_another_column(family_server) -> None:
    """`preserve_accepted` ne protège que `status='accepted'` : un lien posé à la main a
    `status IS NULL` et serait détruit par un recalcul famille-entière. Scopé, il survit."""
    base, docs, db_path = family_server
    _http_json("POST", f"{base}/families/{docs['fr']}/align", {"strategy": "external_id"})
    conn = sqlite3.connect(str(db_path))
    fr_u = conn.execute(
        "SELECT unit_id FROM units WHERE doc_id=? AND unit_type='line' ORDER BY n",
        (docs["fr"],),
    ).fetchall()
    es_u = conn.execute(
        "SELECT unit_id FROM units WHERE doc_id=? AND unit_type='line' ORDER BY n",
        (docs["es"],),
    ).fetchall()
    conn.execute(
        "INSERT INTO alignment_links (run_id,pivot_unit_id,target_unit_id,external_id,"
        "pivot_doc_id,target_doc_id,created_at) VALUES ('manual',?,?,99,?,?,datetime('now'))",
        (fr_u[0][0], es_u[3][0], docs["fr"], docs["es"]),
    )
    conn.commit()
    conn.close()
    assert any(r[3] == "manual" for r in _links(db_path, docs["fr"], docs["es"]))

    code, _ = _http_json("POST", f"{base}/families/{docs['fr']}/align", {
        "strategy": "external_id", "replace_existing": True,
        "target_doc_ids": [docs["en"]],
    })
    assert code == 200
    assert any(r[3] == "manual" for r in _links(db_path, docs["fr"], docs["es"])), \
        "le lien manuel d'une colonne hors périmètre a été purgé"


def test_align_scope_rejects_a_doc_outside_the_family(family_server) -> None:
    base, docs, _ = family_server
    # le moyeu n'est pas son propre enfant
    code, res = _http_json("POST", f"{base}/families/{docs['fr']}/align",
                           {"target_doc_ids": [docs["fr"]]})
    assert code == 400
    assert res["error"]["details"]["unknown_doc_ids"] == [docs["fr"]]


def test_align_scope_rejects_an_empty_list(family_server) -> None:
    """Liste vide = rien à aligner. La refuser évite un run vide qui rendrait « 0 paire »
    et se lirait comme « la famille n'a pas d'enfant »."""
    base, docs, _ = family_server
    code, _ = _http_json("POST", f"{base}/families/{docs['fr']}/align",
                         {"target_doc_ids": []})
    assert code == 400


def test_align_scope_rejects_a_non_integer_list(family_server) -> None:
    base, docs, _ = family_server
    code, _ = _http_json("POST", f"{base}/families/{docs['fr']}/align",
                         {"target_doc_ids": ["12"]})
    assert code == 400


def test_matrix_scope_projects_only_the_requested_columns(family_server) -> None:
    base, docs, _ = family_server
    _http_json("POST", f"{base}/families/{docs['fr']}/align", {"strategy": "external_id"})

    code, full = _http_json("POST", f"{base}/align/matrix", {"family_root_id": docs["fr"]})
    assert code == 200
    assert full["languages"] == ["fr", "en", "es"]

    code, scoped = _http_json("POST", f"{base}/align/matrix", {
        "family_root_id": docs["fr"], "target_doc_ids": [docs["es"]],
    })
    assert code == 200
    assert scoped["languages"] == ["fr", "es"]
    assert scoped["language_doc_ids"] == [docs["fr"], docs["es"]]
    assert all(len(r) == 1 for r in scoped["cell_links"])
    # `link_count` reste famille-entière (la barre « Aligner » ouvre sa confirmation
    # dessus) ; `link_counts` suit les colonnes projetées.
    assert scoped["link_count"] == full["link_count"]
    assert [c["target_doc_id"] for c in scoped["link_counts"]] == [docs["es"]]


def test_matrix_scope_rejects_a_doc_outside_the_family(family_server) -> None:
    base, docs, _ = family_server
    code, res = _http_json("POST", f"{base}/align/matrix", {
        "family_root_id": docs["fr"], "target_doc_ids": [docs["fr"]],
    })
    assert code == 400
    assert res["error"]["details"]["unknown_doc_ids"] == [docs["fr"]]
