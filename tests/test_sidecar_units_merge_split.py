"""Tests for POST /units/merge and POST /units/split.

Regression coverage for the `no such column: pivot_unit_n` bug —
the DELETE of alignment_links must use pivot_unit_id / target_unit_id,
not the non-existent pivot_unit_n / target_unit_n columns.
"""

from __future__ import annotations

import json
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest


# ─── HTTP helpers ─────────────────────────────────────────────────────────────

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


def _post(url: str, payload: dict, token: str | None = None) -> tuple[int, dict]:
    return _http("POST", url, payload, token=token)


def _wait_health(base_url: str, tries: int = 50) -> None:
    import time
    for _ in range(tries):
        code, payload = _http("GET", f"{base_url}/health")
        if code == 200 and payload.get("ok") is True:
            return
        time.sleep(0.05)
    raise RuntimeError("Sidecar not ready")


# ─── Fixture ──────────────────────────────────────────────────────────────────

@pytest.fixture()
def ms_sidecar(tmp_path: Path):
    """Sidecar with two aligned docs (5 pivot lines ↔ 5 target lines)."""
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.db.migrations import apply_migrations
    from multicorpus_engine.importers.txt import import_txt_numbered_lines
    from multicorpus_engine.aligner import align_by_external_id
    from multicorpus_engine.indexer import build_index
    from multicorpus_engine.sidecar import CorpusServer

    db_path = tmp_path / "merge_split.db"
    conn = get_connection(str(db_path))
    apply_migrations(conn)

    (tmp_path / "pivot.txt").write_text(
        "[1] Un.\n[2] Deux.\n[3] Trois.\n[4] Quatre.\n[5] Cinq.\n",
        encoding="utf-8",
    )
    import_txt_numbered_lines(conn, str(tmp_path / "pivot.txt"), language="fr", title="FR")

    (tmp_path / "target.txt").write_text(
        "[1] One.\n[2] Two.\n[3] Three.\n[4] Four.\n[5] Five.\n",
        encoding="utf-8",
    )
    import_txt_numbered_lines(conn, str(tmp_path / "target.txt"), language="en", title="EN")

    align_by_external_id(conn, pivot_doc_id=1, target_doc_ids=[2], run_id="ms-run")
    build_index(conn)
    conn.close()

    token = "ms-token"
    server = CorpusServer(db_path=str(db_path), host="127.0.0.1", port=0, token=token)
    server.start()
    _wait_health(f"http://127.0.0.1:{server.actual_port}")

    yield f"http://127.0.0.1:{server.actual_port}", token, server

    server.shutdown()


# ─── /units/merge tests ────────────────────────────────────────────────────────

class TestUnitsMerge:
    def test_merge_succeeds(self, ms_sidecar):
        base, token, _ = ms_sidecar
        code, body = _post(f"{base}/units/merge", {"doc_id": 1, "n1": 1, "n2": 2}, token)
        assert code == 200, body
        assert body["ok"] is True
        assert body["merged_n"] == 1
        assert body["deleted_n"] == 2

    def test_merge_concatenates_text(self, ms_sidecar):
        base, token, _ = ms_sidecar
        code, body = _post(f"{base}/units/merge", {"doc_id": 1, "n1": 2, "n2": 3}, token)
        assert code == 200, body
        assert "Deux" in body["text"] and "Trois" in body["text"]

    def test_merge_deletes_alignment_links(self, ms_sidecar):
        """Regression: used to fail with 'no such column: pivot_unit_n'."""
        base, token, _ = ms_sidecar
        # n1=1, n2=2 are linked to EN doc
        code, body = _post(f"{base}/units/merge", {"doc_id": 1, "n1": 1, "n2": 2}, token)
        assert code == 200, body

    def test_merge_non_adjacent_returns_400(self, ms_sidecar):
        base, token, _ = ms_sidecar
        code, body = _post(f"{base}/units/merge", {"doc_id": 1, "n1": 1, "n2": 3}, token)
        assert code == 400

    def test_merge_missing_params_returns_400(self, ms_sidecar):
        base, token, _ = ms_sidecar
        code, body = _post(f"{base}/units/merge", {"doc_id": 1}, token)
        assert code == 400

    def test_merge_nonexistent_unit_returns_404(self, ms_sidecar):
        base, token, _ = ms_sidecar
        code, body = _post(f"{base}/units/merge", {"doc_id": 1, "n1": 99, "n2": 100}, token)
        assert code == 404

    def test_merge_requires_token(self, ms_sidecar):
        base, _, _ = ms_sidecar
        code, body = _post(f"{base}/units/merge", {"doc_id": 1, "n1": 1, "n2": 2})
        assert code == 401


# ─── /units/split tests ───────────────────────────────────────────────────────

class TestUnitsSplit:
    def test_split_succeeds(self, ms_sidecar):
        base, token, _ = ms_sidecar
        code, body = _post(
            f"{base}/units/split",
            {"doc_id": 1, "unit_n": 3, "text_a": "Trois A.", "text_b": "Trois B."},
            token,
        )
        assert code == 200, body
        assert body["ok"] is True

    def test_split_deletes_alignment_links(self, ms_sidecar):
        """Regression: used to fail with 'no such column: pivot_unit_n'."""
        base, token, _ = ms_sidecar
        code, body = _post(
            f"{base}/units/split",
            {"doc_id": 1, "unit_n": 1, "text_a": "Un A.", "text_b": "Un B."},
            token,
        )
        assert code == 200, body

    def test_split_missing_params_returns_400(self, ms_sidecar):
        base, token, _ = ms_sidecar
        code, body = _post(f"{base}/units/split", {"doc_id": 1}, token)
        assert code == 400

    def test_split_empty_text_returns_400(self, ms_sidecar):
        base, token, _ = ms_sidecar
        code, body = _post(
            f"{base}/units/split",
            {"doc_id": 1, "unit_n": 1, "text_a": "", "text_b": "B."},
            token,
        )
        assert code == 400

    def test_split_nonexistent_unit_returns_404(self, ms_sidecar):
        base, token, _ = ms_sidecar
        code, body = _post(
            f"{base}/units/split",
            {"doc_id": 1, "unit_n": 99, "text_a": "A.", "text_b": "B."},
            token,
        )
        assert code == 404

    def test_split_requires_token(self, ms_sidecar):
        base, _, _ = ms_sidecar
        code, body = _post(
            f"{base}/units/split",
            {"doc_id": 1, "unit_n": 1, "text_a": "A.", "text_b": "B."},
        )
        assert code == 401


class TestLinksArchivedReported:
    """1.6.68 — le geste dit EXACTEMENT ce qu'il a détruit.

    Le reliquat au dossier demandait de câbler needsAlignmentConfirm sur la fusion.
    Ce garde-fou prend l'aligned_count du DOCUMENT, alors qu'une fusion ne touche
    jamais que les liens des deux unités : il aurait annoncé une perte qui n'est pas
    celle qui va avoir lieu. Le compte rendu après coup est exact, lui.
    """

    def test_merge_reports_the_links_it_destroyed(self, ms_sidecar):
        base, token, _ = ms_sidecar
        # La fixture aligne 5 ↔ 5 par external_id : les unités 1 et 2 portent un lien
        # chacune, donc cette fusion en détruit deux — pas les cinq du document.
        code, body = _post(f"{base}/units/merge", {"doc_id": 1, "n1": 1, "n2": 2}, token)
        assert code == 200, body
        assert body["links_archived"] == 2, body

    def test_split_reports_the_links_it_destroyed(self, ms_sidecar):
        base, token, _ = ms_sidecar
        code, body = _post(
            f"{base}/units/split",
            {"doc_id": 1, "unit_n": 3, "text_a": "Trois", "text_b": "bis."},
            token,
        )
        assert code == 200, body
        assert body["links_archived"] == 1, body

    def test_zero_when_the_units_carried_no_alignment(self, ms_sidecar):
        base, token, _ = ms_sidecar
        # Il faut DEUX unités adjacentes sans lien, et la fusion renumérote : après
        # avoir fusionné (1,2), le nouveau n=2 est l'ancien n=3, encore aligné. On
        # libère donc deux voisines avant de mesurer le cas à zéro.
        a = _post(f"{base}/units/merge", {"doc_id": 2, "n1": 1, "n2": 2}, token)[1]
        b = _post(f"{base}/units/merge", {"doc_id": 2, "n1": 2, "n2": 3}, token)[1]
        assert (a["links_archived"], b["links_archived"]) == (2, 2)
        code, body = _post(f"{base}/units/merge", {"doc_id": 2, "n1": 1, "n2": 2}, token)
        assert code == 200, body
        assert body["links_archived"] == 0, body

    def test_the_count_is_what_undo_gives_back(self, ms_sidecar):
        """Le message promet « Annuler les rend » : la promesse est vérifiée ici."""
        base, token, _ = ms_sidecar
        _code, merged = _post(f"{base}/units/merge", {"doc_id": 1, "n1": 1, "n2": 2}, token)
        code, undone = _post(f"{base}/prep/undo", {"doc_id": 1}, token)
        assert code == 200, undone
        assert undone["alignments_restored"] == merged["links_archived"]

    def test_the_promise_holds_for_the_split_too(self, ms_sidecar):
        """La scission affiche le même message : elle doit tenir la même promesse."""
        base, token, _ = ms_sidecar
        _code, sp = _post(
            f"{base}/units/split",
            {"doc_id": 1, "unit_n": 3, "text_a": "Trois", "text_b": "bis."},
            token,
        )
        code, undone = _post(f"{base}/prep/undo", {"doc_id": 1}, token)
        assert code == 200, undone
        assert undone["alignments_restored"] == sp["links_archived"] == 1

    def test_split_reports_zero_on_an_unaligned_unit(self, ms_sidecar):
        """Zéro doit rester zéro : c'est ce qui rend le message silencieux."""
        base, token, _ = ms_sidecar
        # La scission libère l'unité n=3 de son lien ; la moitié créée en n=4 n'en a aucun.
        _post(f"{base}/units/split",
              {"doc_id": 1, "unit_n": 3, "text_a": "Trois", "text_b": "bis."}, token)
        code, body = _post(
            f"{base}/units/split",
            {"doc_id": 1, "unit_n": 4, "text_a": "bis", "text_b": "ter."},
            token,
        )
        assert code == 200, body
        assert body["links_archived"] == 0, body


def test_family_segment_is_undoable_per_document(ms_sidecar) -> None:
    """ALI-10 / D-2 — une segmentation de famille laisse une trace, et se defait.

    Jusqu'ici POST /families/{id}/segment avec force=true bouclait sur tous les
    documents SANS recorder : une requete effacait les unites et l'alignement de la
    famille entiere sans une ligne dans prep_action_history. Sur le corpus de
    reference, 5 770 liens.

    L'archive des liens seule n'aurait rien rendu : la resegmentation detruit aussi
    les unites, et un lien restaure vers un unit_id mort est ecarte par la garde FK
    (ALI-03). Ce qui rend la restitution exacte, c'est que _undo_resegment reinsere
    les unites AVEC LEUR unit_id d'origine — donc l'archive se recolle.
    """
    base, token, _ = ms_sidecar
    _COLS = ("SELECT link_id, run_id, pivot_unit_id, target_unit_id, external_id,"
             " pivot_doc_id, target_doc_id FROM alignment_links ORDER BY link_id")

    code, before = _post(f"{base}/align/audit",
                         {"pivot_doc_id": 1, "target_doc_id": 2, "limit": 100}, token)
    assert code == 200, before
    n_before = len(before["links"])
    assert n_before == 5, before

    # La fixture aligne 1 ↔ 2 sans declarer la parente : /families/{id}/segment la lit
    # dans doc_relations, on la pose donc explicitement (et localement, pour ne pas
    # changer la fixture partagee sous les autres tests).
    code, rel = _post(f"{base}/doc_relations/set",
                      {"doc_id": 2, "relation_type": "translation_of", "target_doc_id": 1},
                      token)
    assert code == 200, rel

    # On force la resegmentation de toute la famille.
    code, res = _post(f"{base}/families/1/segment", {"force": True}, token)
    assert code == 200, res
    assert any(e["status"] == "segmented" for e in res["results"]), res

    code, after = _post(f"{base}/align/audit",
                        {"pivot_doc_id": 1, "target_doc_id": 2, "limit": 100}, token)
    assert code == 200, after
    assert len(after["links"]) == 0, "la segmentation doit bien detruire les liens"

    # …et chaque document a desormais son action annulable.
    for doc_id in (1, 2):
        code, elig = _post(f"{base}/prep/undo/eligibility", {"doc_id": doc_id}, token)
        assert code == 200, elig
        assert elig["eligible"] is True, (doc_id, elig)
        assert elig["action_type"] == "resegment", (doc_id, elig)

    # Annuler EN ORDRE INVERSE de la segmentation (la famille traite le parent d'abord,
    # donc on defait les enfants d'abord). Ce n'est pas une preference de style : les
    # liens sont archives sous l'action du PIVOT, et un lien ne peut renaitre que si ses
    # DEUX unites existent -- la garde FK d'ALI-03. Restaurer le pivot avant sa cible
    # ecarterait les cinq liens, et l'action serait ensuite marquee revertie : perdus.
    for doc_id in (2, 1):
        code, undone = _post(f"{base}/prep/undo", {"doc_id": doc_id}, token)
        assert code == 200, (doc_id, undone)

    code, restored = _post(f"{base}/align/audit",
                           {"pivot_doc_id": 1, "target_doc_id": 2, "limit": 100}, token)
    assert code == 200, restored
    assert len(restored["links"]) == n_before, restored


def test_family_segment_undo_in_the_wrong_order_is_counted_not_silent(ms_sidecar) -> None:
    """Le mauvais ordre coute les liens -- mais il est COMPTE, ce qui permet a
    l'interface de le dire au lieu de le laisser passer (ALI-03, contrat 1.6.65)."""
    base, token, _ = ms_sidecar
    _post(f"{base}/doc_relations/set",
          {"doc_id": 2, "relation_type": "translation_of", "target_doc_id": 1}, token)
    _post(f"{base}/families/1/segment", {"force": True}, token)

    # Le pivot d'abord : ses cibles n'existent pas encore sous leur unit_id d'origine.
    code, undone = _post(f"{base}/prep/undo", {"doc_id": 1}, token)
    assert code == 200, undone
    assert undone["alignments_restored"] == 0, undone
    assert undone["alignments_restore_skipped"] == 5, undone
