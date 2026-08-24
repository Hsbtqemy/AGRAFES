"""Le Contrôle nomme le segment comme la matrice le nomme.

**Le défaut, trouvé à l'usage le 2026-08-23.** Couper la cible d'un segment fait
apparaître, dans le Contrôle, un numéro qui n'est pas celui du canvas — « le segment 2
devient 3 ». Le tri (ALI-23) était la moitié visible du problème ; l'autre moitié est
le numéro lui-même.

**La cause.** Le badge ``[§N]`` affichait ``alignment_links.external_id``, qui n'est pas
un numéro de segment mais **la clé qui a apparié**. Selon la stratégie elle vaut le
marqueur ``[N]`` du pivot (``align_by_external_id``, phase 1 de
``external_id_then_position``) ou sa position ``n`` (``position``, ``similarity``,
``length_bounded``, phase 2) — un même run mélange donc les deux. Et même quand elle
vaut ``n``, ``n`` compte **toutes** les unités du document, structure comprise, là où la
matrice numérote les seules lignes.

D'où deux façons de mentir, indépendantes, qu'aucune règle d'attribution ne ferme :

* le geste, qui n'apparie sur rien et doit bien écrire *quelque chose* — mesuré le
  2026-08-24 sur le corpus de travail, 6 des 7 liens créés au geste portaient un numéro
  faux (l'ancien repli ``[§0]``, le marqueur du pivot, ou le numéro du frère hérité de
  D-W13), contre 0 des 14 568 liens créés par un run ;
* la présence d'unités de structure, qui décale ``n`` du rang **sans qu'aucun lien soit
  en cause**. Ce cas-là ne s'était pas encore produit — 0 document pivot à unités de
  structure dans le corpus de travail — et c'est précisément pourquoi il est ici : la
  correction doit valoir « pour tout ce qui pourrait arriver par la suite ».

Le numéro affiché se **calcule** donc, il ne se stocke pas. Ces tests l'assertent contre
``build_alignment_matrix`` — la matrice elle-même, et non une reformulation de sa
formule : sinon ils ne prouveraient que leur propre copie.
"""

from __future__ import annotations

import datetime as dt
import json
import sqlite3
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import ProxyHandler, Request, build_opener

import pytest

# Jamais de proxy sur du loopback (cause racine du 2026-07-09).
_OPENER = build_opener(ProxyHandler({}))


def _post(url: str, payload: dict, token: str | None = None) -> tuple[int, dict]:
    headers = {"Accept": "application/json", "Content-Type": "application/json; charset=utf-8"}
    if token:
        headers["X-Agrafes-Token"] = token
    req = Request(url, method="POST", data=json.dumps(payload).encode("utf-8"), headers=headers)
    try:
        with _OPENER.open(req, timeout=10.0) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except HTTPError as exc:
        return exc.code, json.loads(exc.read().decode("utf-8"))


def _wait_health(base: str, timeout: float = 20.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with _OPENER.open(f"{base}/health", timeout=2.0) as resp:
                if resp.status == 200:
                    return
        except Exception:  # noqa: BLE001
            time.sleep(0.2)
    raise AssertionError("sidecar never became healthy")


def _insert_structure_unit(conn: sqlite3.Connection, doc_id: int, at_n: int) -> None:
    """Glisse une unité de STRUCTURE à la position ``at_n``, en poussant la suite.

    C'est ce que produit un import TEI ou docx structuré. Les lignes cessent alors
    d'avoir ``n == rang`` — le décalage que la matrice absorbe (elle ne numérote que les
    lignes) et que ``external_id`` ne peut pas absorber.
    """
    conn.execute("UPDATE units SET n = n + 1 WHERE doc_id = ? AND n >= ?", (doc_id, at_n))
    conn.execute(
        "INSERT INTO units (doc_id, unit_type, n, external_id, text_raw, text_norm)"
        " VALUES (?, 'structure', ?, NULL, ?, ?)",
        (doc_id, at_n, "<div>", "<div>"),
    )


@pytest.fixture()
def paire(tmp_path: Path):
    """Deux documents de 5 lignes, avec les DEUX pièges de numérotation à la fois.

    * une unité de **structure** au milieu : les lignes portent ``n`` = 1, 2, 4, 5, 6 et
      les rangs 1, 2, 3, 4, 5 — tout numéro pris dans ``n`` diverge du numéro affiché dès
      le 3ᵉ segment ;
    * une borne de **paratexte** (``text_start_n = 2``) : l'aligneur exclut la première
      ligne (`_load_doc_line_rows`), la matrice la **numérote** quand même. Le premier
      lien doit donc s'afficher ``[§2]`` et non ``[§1]`` — une numérotation « 1…N des
      liens », qui serait la correction naïve, raterait précisément ce cas.

    L'alignement se fait *après* ces deux réglages, par position — la stratégie qui écrit
    ``n`` dans ``external_id``, comme ``length_bounded`` et ``similarity``.
    """
    from multicorpus_engine.aligner import align_by_position
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.db.migrations import apply_migrations
    from multicorpus_engine.importers.txt import import_txt_numbered_lines
    from multicorpus_engine.sidecar import CorpusServer

    db_path = tmp_path / "numero.db"
    conn = get_connection(str(db_path))
    apply_migrations(conn)

    (tmp_path / "p.txt").write_text(
        "[1] Un.\n[2] Deux.\n[3] Trois.\n[4] Quatre.\n[5] Cinq.\n", encoding="utf-8")
    import_txt_numbered_lines(conn, str(tmp_path / "p.txt"), language="fr", title="Pivot")
    (tmp_path / "t.txt").write_text(
        "[1] One.\n[2] Two.\n[3] Three.\n[4] Four.\n[5] Five.\n", encoding="utf-8")
    import_txt_numbered_lines(conn, str(tmp_path / "t.txt"), language="en", title="Target")

    _insert_structure_unit(conn, doc_id=1, at_n=3)
    _insert_structure_unit(conn, doc_id=2, at_n=3)
    # Borne de début de texte : la 1re ligne devient du paratexte. L'aligneur la saute,
    # la matrice la compte — c'est ce décalage-là que le badge doit suivre.
    conn.execute("UPDATE documents SET text_start_n = 2 WHERE doc_id IN (1, 2)")
    # La matrice lit la famille dans doc_relations ; sans ce lien elle n'a pas de colonne.
    conn.execute(
        "INSERT INTO doc_relations (doc_id, target_doc_id, relation_type, created_at)"
        " VALUES (?, ?, 'translation_of', ?)",
        (2, 1, dt.datetime.now(dt.timezone.utc).isoformat()),
    )
    conn.commit()

    align_by_position(conn, pivot_doc_id=1, target_doc_ids=[2], run_id="run-numero")
    conn.close()

    token = "tok-numero"
    server = CorpusServer(db_path=str(db_path), host="127.0.0.1", port=0, token=token)
    server.start()
    base = f"http://127.0.0.1:{server.actual_port}"
    _wait_health(base)
    yield base, token, db_path
    server.shutdown()


def _numeros_de_la_matrice(db_path: Path) -> dict[int, int]:
    """``{unit_id du moyeu → numéro de segment que la MATRICE affiche}``.

    On interroge ``build_alignment_matrix`` plutôt que de recalculer ``i + 1`` : le test
    doit prouver l'accord avec la matrice, pas avec une copie de sa formule.
    """
    from multicorpus_engine.services.matrix_export_service import build_alignment_matrix

    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row  # le service indexe ses lignes par nom
    try:
        matrix = build_alignment_matrix(conn, 1)
    finally:
        conn.close()
    hub_ids = matrix["hub_unit_ids"]
    # colonne 1 = « segment » (colonne 0 = « paragraphe »)
    return {
        int(uid): int(row[1])
        for uid, row in zip(hub_ids, matrix["rows"])
        if uid is not None
    }


def test_le_controle_affiche_le_numero_de_la_matrice(paire) -> None:
    """RED sans le correctif : le Contrôle affichait ``n`` (1, 2, 4, 5, 6) là où la
    matrice affiche le rang (1, 2, 3, 4, 5) — deux noms pour le même segment."""
    base, token, db_path = paire

    code, audit = _post(f"{base}/align/audit",
                        {"pivot_doc_id": 1, "target_doc_id": 2, "limit": 50}, token)
    assert code == 200, audit
    liens = audit["links"]
    # 4 et non 5 : la ligne de paratexte n'est pas alignée.
    assert len(liens) == 4, liens

    matrice = _numeros_de_la_matrice(db_path)
    for lk in liens:
        attendu = matrice[lk["pivot_unit_id"]]
        assert lk["pivot_segment"] == attendu, (
            f"le Contrôle nomme [§{lk['pivot_segment']}] le segment que la matrice "
            f"nomme [§{attendu}] (unité {lk['pivot_unit_id']})"
        )

    # Et les gardes qui donnent son sens au test :
    #  - le champ historique ment (il porte `n`, décalé par l'unité de structure) ;
    #  - le bon numéro ne commence PAS à 1, parce que le segment 1 est du paratexte que
    #    l'aligneur n'a pas lié. Numéroter les liens de 1 à N donnerait [1, 2, 3, 4].
    assert [lk["external_id"] for lk in liens] == [2, 4, 5, 6]
    assert [lk["pivot_segment"] for lk in liens] == [2, 3, 4, 5]


def test_un_lien_cree_au_geste_porte_le_meme_numero_que_ses_voisins(paire) -> None:
    """Le geste n'apparie sur rien : le numéro affiché doit malgré tout être le bon.

    On rejoue exactement le geste de l'utilisateur — un lien neuf sur un pivot, sans
    ``external_id`` (notre front n'en envoie plus depuis 1.6.76). Avant le correctif ce
    lien recevait le marqueur du pivot, ou 0, ou le numéro d'un frère.
    """
    base, token, db_path = paire

    c = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    # Le 3ᵉ segment du pivot (rang 3, n=4 — le paratexte occupe le rang 1) vers la
    # 5ᵉ ligne de la cible : un lien supplémentaire, comme en produit une coupe.
    pivot3 = c.execute(
        "SELECT unit_id FROM units WHERE doc_id=1 AND unit_type='line' ORDER BY n LIMIT 1 OFFSET 2"
    ).fetchone()[0]
    cible5 = c.execute(
        "SELECT unit_id FROM units WHERE doc_id=2 AND unit_type='line' ORDER BY n LIMIT 1 OFFSET 4"
    ).fetchone()[0]
    c.close()

    code, body = _post(f"{base}/align/link/create",
                       {"pivot_unit_id": pivot3, "target_unit_id": cible5}, token)
    assert code == 200, body

    # D'ABORD le champ stocké, et par sa VALEUR : sur l'ancien code ce lien recevait le
    # marqueur du pivot (3), pas sa position (4). Assertée en premier, la régression se
    # dit « 3 != 4 » et non « champ absent » — un test qui ne tomberait que sur le nom
    # du nouveau champ ne prouverait pas que l'ancien comportement était faux.
    c = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    stocke, n_pivot, marqueur = c.execute(
        "SELECT al.external_id, pu.n, pu.external_id FROM alignment_links al"
        " JOIN units pu ON pu.unit_id = al.pivot_unit_id WHERE al.link_id = ?",
        (body["link_id"],),
    ).fetchone()
    c.close()
    assert marqueur == 3, "le pivot porte bien un marqueur distinct de sa position"
    assert stocke == n_pivot == 4, (
        f"le geste a écrit [§{stocke}] au lieu de la position {n_pivot} du pivot"
    )

    code, audit = _post(f"{base}/align/audit",
                        {"pivot_doc_id": 1, "target_doc_id": 2, "limit": 50}, token)
    assert code == 200, audit
    neuf = [lk for lk in audit["links"] if lk["link_id"] == body["link_id"]]
    assert neuf, "le lien créé au geste doit figurer dans le Contrôle"

    # Et le numéro AFFICHÉ est celui de la matrice — ni le marqueur (3, par coïncidence
    # juste ici), ni la position stockée (4, qui serait fausse d'une unité de structure).
    matrice = _numeros_de_la_matrice(db_path)
    assert neuf[0]["pivot_segment"] == matrice[pivot3] == 3
