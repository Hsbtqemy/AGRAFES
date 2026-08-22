"""Veille de non-réclamation du sidecar (audit T-05, second étage).

Le premier étage — `shared/sidecarCore.ts` tue le processus qu'un renoncement de
verrou désavoue — ne couvre que les cas où quelqu'un tient encore le pid. Si le
lanceur meurt entre le spawn et l'écriture du verrou, le pid n'est nulle part et
le sidecar tourne en `--port 0` : introuvable, innommable, intuable. Ces tests
pinnent le seul garde-fou qui survive à cette mort-là.

La distinction que tout le dispositif repose dessus : **« aucune requête, jamais »
et non « inactif depuis N »**. Le test `survit_a_une_seule_requete` est celui qui
la garde — sans lui, une régression en « idle timeout » tuerait le sidecar d'un
utilisateur parti déjeuner, et aucun autre test ne le verrait.

Les sondes HTTP passent par un opener à `ProxyHandler({})` plutôt que par
`NO_PROXY` : le proxy de l'université intercepte les requêtes loopback d'urllib
(cause racine du 2026-07-09), et un opener dédié ne dépend d'aucune variable
d'environnement — c'est aussi le correctif recommandé pour `smoke_sidecar.py`,
dont le `NO_PROXY` part au sidecar au lieu des sondes.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
import urllib.request

import pytest

from multicorpus_engine.sidecar import CorpusServer
from multicorpus_engine.sidecar_watchdog import (
    ENV_VAR,
    arm_unclaimed_watchdog,
    resolve_unclaimed_delay,
)

# Sans proxy, quel que soit l'environnement.
_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def _get_json(url: str, timeout: float = 5.0) -> dict:
    with _OPENER.open(url, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


# ── les deux canaux de réglage ───────────────────────────────────────────────


def test_env_seule(monkeypatch) -> None:
    """Le canal du shell. Il existe parce qu'un ARGUMENT inconnu tue le sidecar —
    argparse rend « unrecognized arguments » et sort en 1 (vérifié le 2026-08-22 sur
    le binaire du 21) — là où une VARIABLE inconnue est ignorée. C'est ce qui permet
    à un shell neuf de parler à un sidecar ancien sans négociation de version."""
    monkeypatch.setenv(ENV_VAR, "300")
    assert resolve_unclaimed_delay(0.0) == 300.0
    assert resolve_unclaimed_delay(None) == 300.0


def test_le_drapeau_gagne_sur_l_env(monkeypatch) -> None:
    monkeypatch.setenv(ENV_VAR, "300")
    assert resolve_unclaimed_delay(120.0) == 120.0


def test_env_illisible_vaut_desactive(monkeypatch) -> None:
    """Traitée comme absente — et journalisée : une veille silencieusement inactive
    se chercherait pendant des heures."""
    monkeypatch.setenv(ENV_VAR, "pouet")
    assert resolve_unclaimed_delay(0.0) == 0.0
    monkeypatch.setenv(ENV_VAR, "-5")
    assert resolve_unclaimed_delay(0.0) == 0.0
    monkeypatch.setenv(ENV_VAR, "   ")
    assert resolve_unclaimed_delay(0.0) == 0.0


def test_rien_du_tout(monkeypatch) -> None:
    monkeypatch.delenv(ENV_VAR, raising=False)
    assert resolve_unclaimed_delay(0.0) == 0.0


# ── la veille elle-même, sans serveur ────────────────────────────────────────


def test_desactivee_a_zero() -> None:
    """0 = jamais. C'est le défaut, et c'est ce qui garde `multicorpus serve` intact."""
    appels: list[int] = []
    assert arm_unclaimed_watchdog(0, lambda: False, lambda: appels.append(1)) is None
    assert arm_unclaimed_watchdog(-1, lambda: False, lambda: appels.append(1)) is None
    time.sleep(0.2)
    assert appels == []


def test_arrete_ce_que_personne_ne_reclame() -> None:
    arrets: list[int] = []
    timer = arm_unclaimed_watchdog(0.15, lambda: False, lambda: arrets.append(1))
    assert timer is not None
    time.sleep(0.6)
    assert arrets == [1]


def test_ne_touche_pas_a_ce_qui_a_ete_reclame() -> None:
    """`is_claimed` est relu À L'ÉCHÉANCE, jamais mémorisé à l'armement."""
    reclame = False
    arrets: list[int] = []
    arm_unclaimed_watchdog(0.3, lambda: reclame, lambda: arrets.append(1))
    reclame = True  # adopté APRÈS l'armement — le cas courant
    time.sleep(0.7)
    assert arrets == []


def test_un_arret_qui_leve_ne_propage_pas() -> None:
    """Une veille qui plante ne doit pas être pire que pas de veille du tout."""
    def _boom() -> None:
        raise RuntimeError("shutdown cassé")

    arm_unclaimed_watchdog(0.15, lambda: False, _boom)
    time.sleep(0.5)  # l'exception est absorbée dans le thread du minuteur


def test_le_minuteur_ne_retient_pas_le_processus() -> None:
    timer = arm_unclaimed_watchdog(30.0, lambda: False, lambda: None)
    assert timer is not None
    assert timer.daemon is True
    timer.cancel()


# ── bout en bout, sur un vrai CorpusServer ───────────────────────────────────


@pytest.fixture()
def db(tmp_path):
    p = tmp_path / "corpus.db"
    sqlite3.connect(str(p)).close()
    return p


def _attendre(predicat, limite: float = 6.0) -> bool:
    fin = time.time() + limite
    while time.time() < fin:
        if predicat():
            return True
        time.sleep(0.1)
    return False


def test_sidecar_non_reclame_s_arrete_seul(db) -> None:
    """Le cas mesuré le 2026-08-22 : personne ne vient, jamais."""
    server = CorpusServer(db_path=db, port=0, token=None, exit_if_unclaimed=0.4)
    server.start()
    try:
        vivant = [t for t in threading.enumerate() if t.name == "CorpusServer"]
        assert vivant, "le serveur doit être parti avant qu'on teste son arrêt"
        assert _attendre(
            lambda: not any(t.name == "CorpusServer" and t.is_alive() for t in threading.enumerate())
        ), "le sidecar non réclamé aurait dû s'arrêter"
    finally:
        server.shutdown()


def test_survit_a_une_seule_requete(db) -> None:
    """Une requête, n'importe laquelle, désarme la veille DÉFINITIVEMENT.

    C'est la garde contre la dérive en « idle timeout » : ici le sidecar est
    interrogé une fois, puis laissé tranquille bien au-delà du délai. Il doit
    vivre — un utilisateur parti déjeuner ne perd pas sa session.
    """
    server = CorpusServer(db_path=db, port=0, token=None, exit_if_unclaimed=0.4)
    server.start()
    try:
        sante = _get_json(f"http://127.0.0.1:{server.actual_port}/health")
        assert sante["ok"] is True

        time.sleep(1.2)  # trois fois le délai, sans plus aucun trafic

        encore = _get_json(f"http://127.0.0.1:{server.actual_port}/health")
        assert encore["ok"] is True
    finally:
        server.shutdown()


def test_desactivee_par_defaut(db) -> None:
    """Sans le drapeau, rien ne change — `multicorpus serve` attend indéfiniment."""
    server = CorpusServer(db_path=db, port=0, token=None)
    server.start()
    try:
        time.sleep(0.6)
        assert _get_json(f"http://127.0.0.1:{server.actual_port}/health")["ok"] is True
    finally:
        server.shutdown()
