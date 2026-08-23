"""L'ordre d'un alignement rendu est celui du TEXTE, pas celui de l'aligneur.

**Le défaut, trouvé à l'usage le 2026-08-23.** Couper la cible d'un segment et en
donner la première tranche au segment précédent fait apparaître les deux dans le
Contrôle **dans l'ordre inverse** de la matrice : le segment 2 s'affiche après le 3.

La cause est une décision, pas un oubli. D-W13 / contrat 1.6.55 fait hériter à un lien
créé par un geste le `external_id` de son frère, « pour que la Révision fine le trie à
côté de sa famille ». Il y est — mais à `external_id` égal le départage tombe sur
`link_id`, c'est-à-dire l'ordre de **création**, qui est l'inverse de l'ordre du texte
quand la coupe donne la tranche initiale au segment antérieur.

**Pourquoi c'est plus qu'une gêne d'affichage.** L'ordre d'un bitexte porte du sens :
il dit la linéarité du texte. Une séquence rendue dans le désordre affirme quelque chose
de faux sur l'œuvre, et pas seulement sur l'outil. C'est pourquoi la règle vaut pour
toutes les surfaces qui émettent une séquence — Contrôle, TEI, TMX, CSV — et pas
seulement pour celle où le défaut a été vu.

**Ce que le correctif ne fait pas** : il ne touche pas à `external_id`. Trier
correctement répare les liens DÉJÀ en base (2 paires du corpus de travail, mesurées) ;
changer l'attribution ne les réparerait pas et demanderait de décider ce que vaut le
numéro de paire d'une tranche. Voir `docs/AUDIT_ALIGNEMENT_2026-08-18.md`, ALI-23.
"""

from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, build_opener, ProxyHandler

import pytest

# Jamais de proxy sur du loopback — un opener dédié ne dépend d'aucune variable
# d'environnement (cause racine du 2026-07-09).
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


@pytest.fixture()
def aligned_pair(tmp_path: Path):
    """Deux documents de 5 lignes, alignés par external_id — puis UNE coupe simulée."""
    from multicorpus_engine.aligner import align_by_external_id
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.db.migrations import apply_migrations
    from multicorpus_engine.importers.txt import import_txt_numbered_lines
    from multicorpus_engine.sidecar import CorpusServer

    db_path = tmp_path / "ordre.db"
    conn = get_connection(str(db_path))
    apply_migrations(conn)

    (tmp_path / "p.txt").write_text("[1] Un.\n[2] Deux.\n[3] Trois.\n[4] Quatre.\n[5] Cinq.\n", encoding="utf-8")
    import_txt_numbered_lines(conn, str(tmp_path / "p.txt"), language="fr", title="Pivot")
    (tmp_path / "t.txt").write_text("[1] One.\n[2] Two.\n[3] Three.\n[4] Four.\n[5] Five.\n", encoding="utf-8")
    import_txt_numbered_lines(conn, str(tmp_path / "t.txt"), language="en", title="Target")

    align_by_external_id(conn, pivot_doc_id=1, target_doc_ids=[2], run_id="run-ordre")
    conn.close()

    token = "tok-ordre"
    server = CorpusServer(db_path=str(db_path), host="127.0.0.1", port=0, token=token)
    server.start()
    base = f"http://127.0.0.1:{server.actual_port}"
    _wait_health(base)
    yield base, token, db_path
    server.shutdown()


def _pivot_positions(db_path: Path, links: list[dict]) -> list[int]:
    """La position `n` du pivot de chaque lien, dans l'ordre rendu."""
    c = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        pos = {r[0]: r[1] for r in c.execute("SELECT unit_id, n FROM units")}
    finally:
        c.close()
    return [pos[lk["pivot_unit_id"]] for lk in links]


def test_le_controle_suit_l_ordre_du_texte(aligned_pair) -> None:
    """RED sans le correctif : le lien hérité s'affiche après son frère, donc à l'envers.

    On reproduit exactement le geste de l'utilisateur — un lien neuf sur un pivot
    ANTÉRIEUR, portant l'`external_id` d'un frère POSTÉRIEUR (ce que fait la coupe via
    D-W13). L'ordre rendu doit rester celui du texte.
    """
    base, token, db_path = aligned_pair

    # pivot n=2 → cible n=4, avec le numéro de paire du frère n=4 : l'inversion.
    c = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    pivot2 = c.execute("SELECT unit_id FROM units WHERE doc_id=1 AND n=2").fetchone()[0]
    target4 = c.execute("SELECT unit_id FROM units WHERE doc_id=2 AND n=4").fetchone()[0]
    c.close()

    code, body = _post(f"{base}/align/link/create",
                       {"pivot_unit_id": pivot2, "target_unit_id": target4, "external_id": 4}, token)
    assert code == 200, body

    code, audit = _post(f"{base}/align/audit", {"pivot_doc_id": 1, "target_doc_id": 2, "limit": 50}, token)
    assert code == 200, audit

    positions = _pivot_positions(db_path, audit["links"])
    assert positions == sorted(positions), (
        f"le Contrôle rend les pivots dans l'ordre {positions} — "
        "un lien hérité doit se placer selon SON pivot, pas selon le numéro de paire emprunté"
    )


def test_les_exports_suivent_aussi(aligned_pair, tmp_path) -> None:
    """La règle vaut pour toute surface qui émet une SÉQUENCE, pas pour le seul écran.

    On passe par le VRAI export bilingue (`POST /export/bilingual`, qui appelle
    `_fetch_aligned_pairs`) plutôt que de rejouer la requête corrigée — sans quoi le test
    ne prouverait que sa propre copie. Un bitexte dont les segments sortent dans le
    désordre affirme une fausse linéarité : c'est la donnée qui est atteinte, pas
    l'affichage.
    """
    base, token, db_path = aligned_pair

    c = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    pivot2 = c.execute("SELECT unit_id FROM units WHERE doc_id=1 AND n=2").fetchone()[0]
    target4 = c.execute("SELECT unit_id FROM units WHERE doc_id=2 AND n=4").fetchone()[0]
    c.close()
    code, body = _post(f"{base}/align/link/create",
                       {"pivot_unit_id": pivot2, "target_unit_id": target4, "external_id": 4}, token)
    assert code == 200, body

    out = tmp_path / "bitexte.txt"
    code, body = _post(f"{base}/export/bilingual",
                       {"pivot_doc_id": 1, "target_doc_id": 2, "out_path": str(out)}, token)
    assert code == 200, body

    texte = out.read_text(encoding="utf-8")
    # La SÉQUENCE complète, pas la première occurrence de chaque mot : le pivot « Deux. »
    # apparaît DEUX fois (son lien d'origine et le lien hérité), et c'est précisément la
    # seconde qui sortait au mauvais endroit. Chercher un premier index aurait laissé
    # passer le défaut.
    rang = {"Un.": 1, "Deux.": 2, "Trois.": 3, "Quatre.": 4, "Cinq.": 5}
    sequence = [rang[m] for ligne in texte.splitlines() for m in rang if m in ligne]
    assert sequence.count(2) == 2, f"le lien hérité manque : {sequence} — {texte[:200]!r}"
    assert sequence == sorted(sequence), (
        f"bitexte émis dans l'ordre {sequence} au lieu de {sorted(sequence)}"
    )
