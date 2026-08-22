"""Auto-terminaison d'un sidecar que personne n'a réclamé (audit T-05).

**Pourquoi un second étage.** Le front ne peut tuer que ce dont il tient le pid.
Il l'a dans le cas courant — le verrou de spawn le lui donne, et
``shared/sidecarCore.ts`` tue désormais le processus qu'il désavoue. Mais un
plantage du webview entre le spawn et l'écriture du verrou ne laisse le pid
**nulle part**, et le sidecar tourne en ``--port 0`` : plus personne ne peut ni
le trouver, ni le nommer, ni le tuer. Cette veille est le seul étage qui survive
à la mort de celui qui a spawné.

**La règle est « aucune requête, jamais », pas « inactif depuis N ».** La
distinction porte tout le dispositif. Un sidecar dont l'utilisateur s'éloigne
une heure doit vivre : il a un propriétaire, qui reviendra. Un sidecar que
personne n'a *jamais* interrogé n'en a pas et n'en aura pas — la séquence
d'adoption du front est portfile puis ``/health``, donc **une** requête, quelle
qu'elle soit, prouve qu'il a été trouvé. Dès la première, la veille est désarmée
définitivement.

**Opt-in.** Sans ``--exit-if-unclaimed``, rien ne change : un ``multicorpus
serve`` lancé à la main, ou piloté par un script, garde son comportement
d'origine — il attend indéfiniment, ce qui est exactement ce qu'on lui demande.
Seul le shell passe le drapeau, parce que seul le shell spawne des sidecars
qu'il peut perdre.

Mesuré le 2026-08-22 : un ``multicorpus.exe`` trouvé six heures après sa
naissance, écoutant pour personne, dont le port n'apparaissait pas une fois dans
le journal du shell. Voir ``pilotage/T-05.md``.
"""

from __future__ import annotations

import logging
import os
import threading
from collections.abc import Callable

logger = logging.getLogger(__name__)

ENV_VAR = "AGRAFES_EXIT_IF_UNCLAIMED"

__all__ = ["ENV_VAR", "arm_unclaimed_watchdog", "resolve_unclaimed_delay"]


def resolve_unclaimed_delay(flag_value: float | None = None) -> float:
    """Délai effectif, du drapeau CLI **ou** de l'environnement. 0 = désactivé.

    **Pourquoi deux canaux, et pourquoi le shell utilise l'environnement.** Un
    argument que le binaire ne connaît pas le TUE : argparse rend
    ``unrecognized arguments`` et sort en 1. Vérifié le 2026-08-22 sur le binaire
    du 21 — passer ``--exit-if-unclaimed`` à un sidecar antérieur empêche
    l'application de démarrer, tout simplement. Or le shell et son sidecar ne
    sont solidaires qu'en release : en développement, ``binaries/`` peut dater
    d'avant le TypeScript qu'on vient d'écrire.

    Une variable d'environnement inconnue, elle, est **ignorée**. C'est le seul
    canal qui laisse un shell neuf parler à un sidecar ancien sans négociation de
    version. Le drapeau reste, parce qu'il est explicite, documenté et testable à
    la main — il gagne quand les deux sont donnés.

    Une valeur illisible est traitée comme absente et JOURNALISÉE : une veille
    silencieusement inactive se chercherait pendant des heures.
    """
    if flag_value:
        return float(flag_value)
    raw = os.environ.get(ENV_VAR, "").strip()
    if not raw:
        return 0.0
    try:
        delay = float(raw)
    except ValueError:
        logger.warning("%s=%r illisible — veille de non-réclamation inactive", ENV_VAR, raw)
        return 0.0
    return delay if delay > 0 else 0.0


def arm_unclaimed_watchdog(
    delay_s: float,
    is_claimed: Callable[[], bool],
    shutdown: Callable[[], None],
) -> threading.Timer | None:
    """Arme la veille. Rend le minuteur, ou ``None`` si elle est désactivée.

    ``delay_s`` doit couvrir confortablement la séquence d'adoption du front
    (délai de démarrage puis sondage de santé), sinon la veille tuerait un
    sidecar sain qui n'a pas encore été trouvé — c'est le seul risque du
    dispositif, et il est entièrement dans le choix de cette valeur.

    ``is_claimed`` est relu **à l'échéance**, jamais mémorisé : c'est ce qui rend
    la veille inoffensive pour un sidecar adopté entre-temps.

    Le minuteur est ``daemon`` : il ne doit jamais retenir un processus qui veut
    sortir. Toute exception de ``shutdown`` est absorbée — une veille qui plante
    ne doit pas être pire que pas de veille du tout.
    """
    if delay_s <= 0:
        return None

    def _verdict() -> None:
        try:
            if is_claimed():
                logger.debug("veille : sidecar réclamé, rien à faire")
                return
            logger.warning(
                "Aucune requête reçue en %.0f s — sidecar jamais réclamé, arrêt "
                "(il écouterait pour personne, cf. T-05)",
                delay_s,
            )
            shutdown()
        except Exception:  # noqa: BLE001
            logger.exception("veille de non-réclamation : échec de l'arrêt")

    timer = threading.Timer(delay_s, _verdict)
    timer.daemon = True
    timer.name = "SidecarUnclaimedWatchdog"
    timer.start()
    logger.info("veille de non-réclamation armée (%.0f s)", delay_s)
    return timer
