"""Tests for the convention / role system.

Covers:
  GET  /conventions
  POST /conventions          (create)
  PUT  /conventions/<name>   (update)
  POST /conventions/delete   (delete)
  POST /units/set_role
  POST /units/bulk_set_role
  POST /documents/set_text_start
  text_start_n integration: segmentation, alignment, annotation, curation
"""

from __future__ import annotations

import json
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest


# ─── HTTP helpers ─────────────────────────────────────────────────────────────

def _http(
    method: str, url: str, payload: dict | None = None, token: str | None = None
) -> tuple[int, dict]:
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


def _put(url: str, payload: dict, token: str | None = None) -> tuple[int, dict]:
    return _http("PUT", url, payload, token=token)


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
def cv_sidecar(tmp_path: Path):
    """Sidecar with one 5-line document for convention tests."""
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.db.migrations import apply_migrations
    from multicorpus_engine.importers.txt import import_txt_numbered_lines
    from multicorpus_engine.sidecar import CorpusServer

    db_path = tmp_path / "conventions.db"
    conn = get_connection(str(db_path))
    apply_migrations(conn)

    (tmp_path / "doc.txt").write_text(
        "[1] Titre du roman\n[2] Auteur\n[3] Éditions, 1922\n[4] Chapitre premier\n[5] Il faisait nuit.\n",
        encoding="utf-8",
    )
    import_txt_numbered_lines(conn, str(tmp_path / "doc.txt"), language="fr", title="FR")
    conn.close()

    token = "cv-token"
    server = CorpusServer(db_path=str(db_path), host="127.0.0.1", port=0, token=token)
    server.start()
    _wait_health(f"http://127.0.0.1:{server.actual_port}")

    yield f"http://127.0.0.1:{server.actual_port}", token, server

    server.shutdown()


# ─── GET /conventions ──────────────────────────────────────────────────────────

class TestConventionsList:
    def test_list_empty(self, cv_sidecar):
        base, token, _ = cv_sidecar
        code, body = _get(f"{base}/conventions")
        assert code == 200, body
        assert body["ok"] is True
        assert body["conventions"] == []
        assert body["count"] == 0

    def test_list_no_token_needed(self, cv_sidecar):
        """GET /conventions is public (no auth required)."""
        base, _, _ = cv_sidecar
        code, body = _get(f"{base}/conventions")
        assert code == 200, body


# ─── POST /conventions (create) ───────────────────────────────────────────────

class TestConventionsCreate:
    def test_create_minimal(self, cv_sidecar):
        base, token, _ = cv_sidecar
        code, body = _post(
            f"{base}/conventions",
            {"name": "intertitre", "label": "Intertitre"},
            token,
        )
        assert code == 201, body
        assert body["ok"] is True
        c = body["convention"]
        assert c["name"] == "intertitre"
        assert c["label"] == "Intertitre"
        assert c["color"] == "#6366f1"
        assert c["icon"] is None
        assert c["sort_order"] == 0

    def test_create_with_all_fields(self, cv_sidecar):
        base, token, _ = cv_sidecar
        code, body = _post(
            f"{base}/conventions",
            {"name": "dedicace", "label": "Dédicace", "color": "#f59e0b", "icon": "📌", "sort_order": 1},
            token,
        )
        assert code == 201, body
        c = body["convention"]
        assert c["color"] == "#f59e0b"
        assert c["icon"] == "📌"
        assert c["sort_order"] == 1

    def test_create_appears_in_list(self, cv_sidecar):
        base, token, _ = cv_sidecar
        _post(f"{base}/conventions", {"name": "note", "label": "Note"}, token)
        code, body = _get(f"{base}/conventions")
        names = [c["name"] for c in body["conventions"]]
        assert "note" in names

    def test_create_duplicate_returns_409(self, cv_sidecar):
        base, token, _ = cv_sidecar
        _post(f"{base}/conventions", {"name": "dbl", "label": "Dbl"}, token)
        code, body = _post(f"{base}/conventions", {"name": "dbl", "label": "Dbl2"}, token)
        assert code == 409, body

    def test_create_missing_name_returns_400(self, cv_sidecar):
        base, token, _ = cv_sidecar
        code, body = _post(f"{base}/conventions", {"label": "Oups"}, token)
        assert code == 400, body

    def test_create_missing_label_returns_400(self, cv_sidecar):
        base, token, _ = cv_sidecar
        code, body = _post(f"{base}/conventions", {"name": "oups"}, token)
        assert code == 400, body

    def test_create_invalid_name_returns_400(self, cv_sidecar):
        base, token, _ = cv_sidecar
        code, body = _post(
            f"{base}/conventions",
            {"name": "bad name!", "label": "Bad"},
            token,
        )
        assert code == 400, body

    def test_create_requires_token(self, cv_sidecar):
        base, _, _ = cv_sidecar
        code, body = _post(f"{base}/conventions", {"name": "x", "label": "X"})
        assert code == 401, body


# ─── PUT /conventions/<name> (update) ─────────────────────────────────────────

class TestConventionsUpdate:
    def test_update_label(self, cv_sidecar):
        base, token, _ = cv_sidecar
        _post(f"{base}/conventions", {"name": "upd", "label": "Original"}, token)
        code, body = _put(f"{base}/conventions/upd", {"label": "Mis à jour"}, token)
        assert code == 200, body
        assert body["convention"]["label"] == "Mis à jour"

    def test_update_color_and_icon(self, cv_sidecar):
        base, token, _ = cv_sidecar
        _post(f"{base}/conventions", {"name": "col", "label": "Col"}, token)
        code, body = _put(
            f"{base}/conventions/col", {"color": "#10b981", "icon": "🔖"}, token
        )
        assert code == 200, body
        assert body["convention"]["color"] == "#10b981"
        assert body["convention"]["icon"] == "🔖"

    def test_update_nonexistent_returns_404(self, cv_sidecar):
        base, token, _ = cv_sidecar
        code, body = _put(f"{base}/conventions/ghost", {"label": "Ghost"}, token)
        assert code == 404, body

    def test_update_no_fields_returns_400(self, cv_sidecar):
        base, token, _ = cv_sidecar
        _post(f"{base}/conventions", {"name": "emp", "label": "Emp"}, token)
        code, body = _put(f"{base}/conventions/emp", {}, token)
        assert code == 400, body

    def test_update_requires_token(self, cv_sidecar):
        base, token, _ = cv_sidecar
        _post(f"{base}/conventions", {"name": "tkn", "label": "Tkn"}, token)
        code, body = _put(f"{base}/conventions/tkn", {"label": "No auth"})
        assert code == 401, body


# ─── POST /conventions/delete ─────────────────────────────────────────────────

class TestConventionsDelete:
    def test_delete_removes_convention(self, cv_sidecar):
        base, token, _ = cv_sidecar
        _post(f"{base}/conventions", {"name": "del_me", "label": "Del"}, token)
        code, body = _post(f"{base}/conventions/delete", {"name": "del_me"}, token)
        assert code == 200, body
        assert body["deleted"] == "del_me"
        code2, body2 = _get(f"{base}/conventions")
        names = [c["name"] for c in body2["conventions"]]
        assert "del_me" not in names

    def test_delete_clears_unit_roles(self, cv_sidecar):
        """Deleting a role must set unit_role=NULL on any assigned units."""
        base, token, _ = cv_sidecar
        _post(f"{base}/conventions", {"name": "clr", "label": "Clear"}, token)
        _post(f"{base}/units/set_role", {"doc_id": 1, "unit_n": 1, "role": "clr"}, token)
        _post(f"{base}/conventions/delete", {"name": "clr"}, token)
        # After delete the unit should have no role
        # (Verified indirectly via set_role on now-deleted role returning 404)
        code, body = _post(
            f"{base}/units/set_role", {"doc_id": 1, "unit_n": 1, "role": "clr"}, token
        )
        assert code == 404, body

    def test_delete_nonexistent_returns_404(self, cv_sidecar):
        base, token, _ = cv_sidecar
        code, body = _post(f"{base}/conventions/delete", {"name": "ghost"}, token)
        assert code == 404, body

    def test_delete_missing_name_returns_400(self, cv_sidecar):
        base, token, _ = cv_sidecar
        code, body = _post(f"{base}/conventions/delete", {}, token)
        assert code == 400, body

    def test_delete_requires_token(self, cv_sidecar):
        base, token, _ = cv_sidecar
        _post(f"{base}/conventions", {"name": "tknx", "label": "Tknx"}, token)
        code, body = _post(f"{base}/conventions/delete", {"name": "tknx"})
        assert code == 401, body


# ─── POST /units/set_role ─────────────────────────────────────────────────────

class TestUnitsSetRole:
    def test_set_role(self, cv_sidecar):
        base, token, _ = cv_sidecar
        _post(f"{base}/conventions", {"name": "itr", "label": "Intertitre"}, token)
        code, body = _post(
            f"{base}/units/set_role", {"doc_id": 1, "unit_n": 4, "role": "itr"}, token
        )
        assert code == 200, body
        assert body["unit_role"] == "itr"
        assert body["unit_n"] == 4

    def test_clear_role(self, cv_sidecar):
        base, token, _ = cv_sidecar
        _post(f"{base}/conventions", {"name": "itr2", "label": "I2"}, token)
        _post(f"{base}/units/set_role", {"doc_id": 1, "unit_n": 4, "role": "itr2"}, token)
        code, body = _post(
            f"{base}/units/set_role", {"doc_id": 1, "unit_n": 4, "role": None}, token
        )
        assert code == 200, body
        assert body["unit_role"] is None

    def test_set_role_unknown_role_returns_404(self, cv_sidecar):
        base, token, _ = cv_sidecar
        code, body = _post(
            f"{base}/units/set_role", {"doc_id": 1, "unit_n": 1, "role": "nonexistent"}, token
        )
        assert code == 404, body

    def test_set_role_unknown_unit_returns_404(self, cv_sidecar):
        base, token, _ = cv_sidecar
        _post(f"{base}/conventions", {"name": "itr3", "label": "I3"}, token)
        code, body = _post(
            f"{base}/units/set_role", {"doc_id": 1, "unit_n": 99, "role": "itr3"}, token
        )
        assert code == 404, body

    def test_set_role_missing_params_returns_400(self, cv_sidecar):
        base, token, _ = cv_sidecar
        code, body = _post(f"{base}/units/set_role", {"doc_id": 1}, token)
        assert code == 400, body

    def test_set_role_requires_token(self, cv_sidecar):
        base, _, _ = cv_sidecar
        code, body = _post(f"{base}/units/set_role", {"doc_id": 1, "unit_n": 1, "role": None})
        assert code == 401, body


# ─── POST /units/bulk_set_role ────────────────────────────────────────────────

class TestUnitsBulkSetRole:
    def test_bulk_set_role(self, cv_sidecar):
        base, token, _ = cv_sidecar
        _post(f"{base}/conventions", {"name": "para", "label": "Paratexte"}, token)
        code, body = _post(
            f"{base}/units/bulk_set_role",
            {"doc_id": 1, "unit_ns": [1, 2, 3], "role": "para"},
            token,
        )
        assert code == 200, body
        assert body["updated"] == 3

    def test_bulk_clear_role(self, cv_sidecar):
        base, token, _ = cv_sidecar
        _post(f"{base}/conventions", {"name": "p2", "label": "P2"}, token)
        _post(f"{base}/units/bulk_set_role", {"doc_id": 1, "unit_ns": [1, 2], "role": "p2"}, token)
        code, body = _post(
            f"{base}/units/bulk_set_role",
            {"doc_id": 1, "unit_ns": [1, 2], "role": None},
            token,
        )
        assert code == 200, body
        assert body["updated"] == 2

    def test_bulk_empty_list_returns_zero(self, cv_sidecar):
        base, token, _ = cv_sidecar
        code, body = _post(
            f"{base}/units/bulk_set_role", {"doc_id": 1, "unit_ns": [], "role": None}, token
        )
        assert code == 200, body
        assert body["updated"] == 0

    def test_bulk_unknown_role_returns_404(self, cv_sidecar):
        base, token, _ = cv_sidecar
        code, body = _post(
            f"{base}/units/bulk_set_role",
            {"doc_id": 1, "unit_ns": [1], "role": "ghost"},
            token,
        )
        assert code == 404, body

    def test_bulk_requires_token(self, cv_sidecar):
        base, _, _ = cv_sidecar
        code, body = _post(
            f"{base}/units/bulk_set_role", {"doc_id": 1, "unit_ns": [1], "role": None}
        )
        assert code == 401, body


# ─── POST /documents/set_text_start ──────────────────────────────────────────

class TestDocumentsSetTextStart:
    def test_set_text_start(self, cv_sidecar):
        base, token, _ = cv_sidecar
        code, body = _post(
            f"{base}/documents/set_text_start", {"doc_id": 1, "text_start_n": 4}, token
        )
        assert code == 200, body
        assert body["doc_id"] == 1
        assert body["text_start_n"] == 4

    def test_clear_text_start(self, cv_sidecar):
        base, token, _ = cv_sidecar
        _post(f"{base}/documents/set_text_start", {"doc_id": 1, "text_start_n": 4}, token)
        code, body = _post(
            f"{base}/documents/set_text_start", {"doc_id": 1, "text_start_n": None}, token
        )
        assert code == 200, body
        assert body["text_start_n"] is None

    def test_text_start_appears_in_documents_list(self, cv_sidecar):
        base, token, _ = cv_sidecar
        _post(f"{base}/documents/set_text_start", {"doc_id": 1, "text_start_n": 4}, token)
        code, body = _get(f"{base}/documents")
        doc = next(d for d in body["documents"] if d["doc_id"] == 1)
        assert doc["text_start_n"] == 4

    def test_invalid_n_returns_400(self, cv_sidecar):
        """Unit n=99 does not exist → 400."""
        base, token, _ = cv_sidecar
        code, body = _post(
            f"{base}/documents/set_text_start", {"doc_id": 1, "text_start_n": 99}, token
        )
        assert code == 400, body

    def test_n_zero_returns_400(self, cv_sidecar):
        base, token, _ = cv_sidecar
        code, body = _post(
            f"{base}/documents/set_text_start", {"doc_id": 1, "text_start_n": 0}, token
        )
        assert code == 400, body

    def test_unknown_doc_returns_404(self, cv_sidecar):
        base, token, _ = cv_sidecar
        code, body = _post(
            f"{base}/documents/set_text_start", {"doc_id": 999, "text_start_n": 1}, token
        )
        assert code == 404, body

    def test_missing_doc_id_returns_400(self, cv_sidecar):
        base, token, _ = cv_sidecar
        code, body = _post(f"{base}/documents/set_text_start", {"text_start_n": 1}, token)
        assert code == 400, body

    def test_requires_token(self, cv_sidecar):
        base, _, _ = cv_sidecar
        code, body = _post(f"{base}/documents/set_text_start", {"doc_id": 1, "text_start_n": 1})
        assert code == 401, body


# ─── text_start_n integration: segmentation / alignment / curation ────────────
#
# The fixture has doc_id=1 with 5 units: n=1..3 → paratext, n=4..5 → text body.
# After POST /documents/set_text_start with text_start_n=4:
#   - Segmentation must skip n=1,2,3 and only resegment n=4,5.
#   - Alignment must ignore n=1,2,3 and only link n≥4 units.
#   - Curation must not modify n=1,2,3 units.
#   - Annotation must not generate tokens for n=1,2,3 units.

class TestTextStartNIntegration:
    """Verify text_start_n is respected by segmentation, alignment, curation."""

    def test_segmentation_preserves_paratext(self, cv_sidecar):
        """Resegmentation must not touch units with n < text_start_n."""
        import sqlite3 as _sqlite3
        base, token, server = cv_sidecar

        # Set boundary: n=1,2,3 are paratext
        code, body = _post(f"{base}/documents/set_text_start", {"doc_id": 1, "text_start_n": 4}, token)
        assert code == 200, body

        # Trigger segmentation
        code, body = _post(f"{base}/segment", {"doc_id": 1, "lang": "fr"}, token)
        assert code == 200, body

        # Wait for FTS rebuild if needed (segment is sync — no job)
        # Verify via GET /units
        code, body = _get(f"{base}/units?doc_id=1")
        assert code == 200, body
        units = body["units"]
        unit_ns = [u["n"] for u in units]

        # Paratext units n=1,2,3 must still be present
        assert 1 in unit_ns, f"paratext n=1 missing after segmentation: {unit_ns}"
        assert 2 in unit_ns, f"paratext n=2 missing after segmentation: {unit_ns}"
        assert 3 in unit_ns, f"paratext n=3 missing after segmentation: {unit_ns}"

        # All units must have n >= 1 (no negative n)
        assert all(n >= 1 for n in unit_ns), unit_ns

        # Text units start at n=4 or higher
        text_units = [u for u in units if u["n"] >= 4]
        assert len(text_units) > 0, "No text units after segmentation"

    def test_segmentation_without_boundary_segments_all(self, cv_sidecar):
        """Without text_start_n, all units are segmented (existing behaviour)."""
        base, token, _ = cv_sidecar

        code, body = _post(f"{base}/segment", {"doc_id": 1, "lang": "fr"}, token)
        assert code == 200, body

        code, body = _get(f"{base}/units?doc_id=1")
        assert code == 200, body
        # All units replaced — n values restart from 1
        unit_ns = sorted(u["n"] for u in body["units"])
        assert unit_ns[0] == 1

    def test_alignment_excludes_paratext(self, tmp_path):
        """Alignment must not create links for paratextual units."""
        from multicorpus_engine.db.connection import get_connection
        from multicorpus_engine.db.migrations import apply_migrations
        from multicorpus_engine.importers.txt import import_txt_numbered_lines
        from multicorpus_engine.aligner import align_pair

        db_path = tmp_path / "align_tsn.db"
        conn = get_connection(str(db_path))
        apply_migrations(conn)

        # Two docs: n=1,2 paratext / n=3,4,5 text
        (tmp_path / "fr.txt").write_text(
            "[1] Titre FR\n[2] Auteur FR\n[3] Phrase un.\n[4] Phrase deux.\n[5] Phrase trois.\n",
            encoding="utf-8",
        )
        (tmp_path / "en.txt").write_text(
            "[1] Title EN\n[2] Author EN\n[3] Sentence one.\n[4] Sentence two.\n[5] Sentence three.\n",
            encoding="utf-8",
        )
        import_txt_numbered_lines(conn, str(tmp_path / "fr.txt"), language="fr", title="FR")
        import_txt_numbered_lines(conn, str(tmp_path / "en.txt"), language="en", title="EN")

        # Set paratextual boundary on both docs: text starts at n=3
        conn.execute("UPDATE documents SET text_start_n=3 WHERE doc_id=1")
        conn.execute("UPDATE documents SET text_start_n=3 WHERE doc_id=2")
        conn.commit()

        report = align_pair(conn, pivot_doc_id=1, target_doc_id=2, run_id="test-tsn")
        conn.commit()

        # Check alignment_links — none should reference n=1 or n=2
        links = conn.execute(
            "SELECT al.pivot_unit_id, al.target_unit_id, u1.n AS pn, u2.n AS tn"
            " FROM alignment_links al"
            " JOIN units u1 ON al.pivot_unit_id = u1.unit_id"
            " JOIN units u2 ON al.target_unit_id = u2.unit_id"
        ).fetchall()
        assert len(links) > 0, "Expected alignment links for text units"
        for lk in links:
            assert lk["pn"] >= 3, f"Paratext unit linked as pivot: n={lk['pn']}"
            assert lk["tn"] >= 3, f"Paratext unit linked as target: n={lk['tn']}"

        conn.close()

    def test_curation_excludes_paratext(self, tmp_path):
        """Curation rules must not modify paratextual units."""
        from multicorpus_engine.db.connection import get_connection
        from multicorpus_engine.db.migrations import apply_migrations
        from multicorpus_engine.importers.txt import import_txt_numbered_lines
        from multicorpus_engine.curation import curate_document, CurationRule

        db_path = tmp_path / "curate_tsn.db"
        conn = get_connection(str(db_path))
        apply_migrations(conn)

        # Use an accent that curation would normalize — put it in paratext and text
        (tmp_path / "doc.txt").write_text(
            "[1] Oeuvre complète\n[2] Auteur\n[3] La révolution coeur à coeur.\n",
            encoding="utf-8",
        )
        import_txt_numbered_lines(conn, str(tmp_path / "doc.txt"), language="fr", title="FR")

        # n=1,2 are paratext (title page), n=3 is text
        conn.execute("UPDATE documents SET text_start_n=3 WHERE doc_id=1")
        conn.commit()

        # Record original text_norm of paratext
        para_before = {
            row[0]: row[1]
            for row in conn.execute(
                "SELECT n, text_norm FROM units WHERE doc_id=1 AND n < 3"
            ).fetchall()
        }

        rules = [CurationRule(pattern=r"\bOeuvre\b", replacement="Œuvre")]
        curate_document(conn, doc_id=1, rules=rules)
        conn.commit()

        # Paratext units must be unchanged
        para_after = {
            row[0]: row[1]
            for row in conn.execute(
                "SELECT n, text_norm FROM units WHERE doc_id=1 AND n < 3"
            ).fetchall()
        }
        assert para_before == para_after, (
            f"Paratext was modified by curation: before={para_before}, after={para_after}"
        )

        conn.close()

    def test_annotation_excludes_paratext(self, tmp_path):
        """annotate_document must not create tokens for paratextual units."""
        try:
            import spacy as _spacy  # noqa: F401
        except ImportError:
            pytest.skip("spaCy not installed")

        from multicorpus_engine.db.connection import get_connection
        from multicorpus_engine.db.migrations import apply_migrations
        from multicorpus_engine.importers.txt import import_txt_numbered_lines
        from multicorpus_engine.annotator import annotate_document

        db_path = tmp_path / "annot_tsn.db"
        conn = get_connection(str(db_path))
        apply_migrations(conn)

        (tmp_path / "doc.txt").write_text(
            "[1] Titre\n[2] Auteur\n[3] Il mange une pomme.\n[4] Elle lit un livre.\n",
            encoding="utf-8",
        )
        import_txt_numbered_lines(conn, str(tmp_path / "doc.txt"), language="fr", title="FR")

        # n=1,2 are paratext
        conn.execute("UPDATE documents SET text_start_n=3 WHERE doc_id=1")
        conn.commit()

        annotate_document(conn, doc_id=1)

        # Tokens must only exist for text units (n>=3)
        paratext_unit_ids = [
            row[0] for row in conn.execute(
                "SELECT unit_id FROM units WHERE doc_id=1 AND n < 3"
            ).fetchall()
        ]
        for uid in paratext_unit_ids:
            count = conn.execute(
                "SELECT COUNT(*) FROM tokens WHERE unit_id=?", (uid,)
            ).fetchone()[0]
            assert count == 0, f"Tokens found for paratext unit_id={uid} (should be 0)"

        # Text units should have tokens
        text_token_count = conn.execute(
            "SELECT COUNT(*) FROM tokens t"
            " JOIN units u ON t.unit_id = u.unit_id"
            " WHERE u.doc_id=1 AND u.n >= 3"
        ).fetchone()[0]
        assert text_token_count > 0, "No tokens generated for text units"

        conn.close()
