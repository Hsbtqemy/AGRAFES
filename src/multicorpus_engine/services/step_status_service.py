"""Statut par étape et par document — la couche manuelle (ACT-01).

Modèle : ``docs/DESIGN_step_status_tristate.md``. Trois états par (document, capacité).
Les deux premiers sont dérivés et ne coûtent rien — ``[ ]`` aucune trace, ``[/]`` une
trace mais rien de conclu ; seul ``[X]`` se stocke, dans ``doc_step_status``
(migration 038), et seul l'utilisateur le pose. Le moteur n'a pas qualité à déclarer
qu'un travail est fini.

Ce module ne rend jamais ``[X]`` pour une coche périmée : il rend ``[/]`` et dit ce qui
l'a périmée. Une coche qui survit à ce qui la dément est un mensonge silencieux, et la
mesure du 31 août estime qu'une coche sur trois finirait dans ce cas.
"""

from __future__ import annotations

import json
import sqlite3
from typing import Any, Optional

from ..runs import utcnow_iso
from .errors import BadRequestError, NotFoundError

# Les quatre capacités. Volontairement ici et non dans un CHECK SQL (comme les
# migrations 023 et 028) : en ajouter une reste un changement de service.
STEPS: tuple[str, ...] = ("curation", "segmentation", "alignement", "annotation")

# --- La correspondance action → capacité ------------------------------------------
#
# C'est la pièce structurelle du modèle, pas un réglage. Une règle naïve — « toute
# action postérieure périme la coche » — sur-déclenche : `set_role` compte 11 actions
# sur la base de travail et ne concerne AUCUNE des quatre capacités. Sous cette règle,
# renommer un rôle annulerait tout ce qui était validé sur le document.
#
# Lecture de chaque ligne :
#   curation      le texte a été nettoyé. Une nouvelle passe le change ; une retouche
#                 manuelle au stylo aussi.
#   segmentation  le découpage est bon. Tout ce qui redécoupe le dément — y compris la
#                 frontière de paragraphe, qui est un geste de découpage.
#   alignement    les liens sont bons. Ce qui détruit ou crée des unités casse
#                 l'appariement ; une retouche de texte ne change pas l'identité des
#                 unités et est déjà signalée par `alignment_links.source_changed_at`,
#                 donc elle ne figure pas ici — c'est le signal dérivé
#                 (`aligned_count`) qui rattrape un ré-alignement.
#   annotation    les tokens sont bons. Tout ce qui touche au texte ou au découpage les
#                 périme — l'écran de l'Annotation les garde mais les dit « périmés ».
#
# `set_role` n'apparaît nulle part, c'est le point. `undo` non plus : une action annulée
# est filtrée par `reverted = 0`, pas par son type.
ACTIONS_BY_STEP: dict[str, frozenset[str]] = {
    "curation":     frozenset({"curation_apply", "update_text"}),
    "segmentation": frozenset({"resegment", "merge_units", "split_unit", "set_paragraph"}),
    "alignement":   frozenset({"resegment", "merge_units", "split_unit"}),
    "annotation":   frozenset({"resegment", "merge_units", "split_unit", "update_text"}),
}

# L'état dérivé d'un document, tel qu'il sera comparé plus tard. Les quatre valeurs sont
# celles que `GET /documents` sert déjà (contrat 1.6.85 pour les deux dernières).
_DERIVED_SQL = """
    SELECT
      (SELECT COUNT(*) FROM units WHERE doc_id = :d AND unit_type = 'line'),
      (SELECT COUNT(*) FROM tokens t JOIN units u ON u.unit_id = t.unit_id
        WHERE u.doc_id = :d),
      (SELECT COALESCE(SUM(n), 0) FROM (
          SELECT COUNT(*) AS n FROM alignment_links WHERE pivot_doc_id = :d
          UNION ALL
          SELECT COUNT(*) AS n FROM alignment_links WHERE target_doc_id = :d)),
      (SELECT MAX(performed_at) FROM prep_action_history
        WHERE doc_id = :d AND action_type = 'curation_apply' AND reverted = 0)
"""


def _req_int(value: object, field: str) -> int:
    try:
        return int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        raise BadRequestError(f"{field} must be an integer") from None


def _req_step(value: object) -> str:
    step = str(value or "")
    if step not in STEPS:
        raise BadRequestError(f"step must be one of {', '.join(STEPS)}")
    return step


def derived_state(conn: sqlite3.Connection, doc_id: int) -> dict[str, Any]:
    """L'état dérivé observable d'un document, à cet instant.

    Sert deux fois : figé au moment de la coche (``derived_json``), puis recalculé à
    chaque lecture pour être comparé. Sa cécité est connue et mesurée — une
    resegmentation peut rendre exactement le même nombre d'unités — d'où le second
    signal, l'historique. Aucun des deux ne couvre seul.
    """
    row = conn.execute(_DERIVED_SQL, {"d": int(doc_id)}).fetchone()
    return {
        "unit_count":   int(row[0] or 0),
        "token_count":  int(row[1] or 0),
        "aligned_count": int(row[2] or 0),
        "curated_at":   row[3],
    }


def _last_action_id(conn: sqlite3.Connection, doc_id: int, step: str) -> Optional[int]:
    """Le plus grand `action_id` de CETTE capacité sur ce document, ou None.

    None n'est pas un défaut : il dit qu'aucun historique n'existait pour cette
    capacité quand la coche a été posée — 36 documents sur 58 sont dans ce cas, la
    table étant *forward-only* depuis le 7 mai 2026. La coche repose alors sur le seul
    signal dérivé, et l'écran doit pouvoir le dire.
    """
    kinds = ACTIONS_BY_STEP[step]
    placeholders = ", ".join("?" * len(kinds))
    row = conn.execute(
        "SELECT MAX(action_id) FROM prep_action_history"
        f" WHERE doc_id = ? AND reverted = 0 AND action_type IN ({placeholders})",
        (int(doc_id), *sorted(kinds)),
    ).fetchone()
    return int(row[0]) if row and row[0] is not None else None


def set_step_status(conn: sqlite3.Connection, body: dict) -> dict[str, Any]:
    """POST /documents/step_status — poser un `[X]` sur (document, capacité).

    Enregistre les deux signaux de péremption au moment de la pose. Idempotent : re-poser
    une coche déjà présente la rafraîchit, ce qui est le geste « je reconfirme après
    avoir retravaillé ».
    """
    doc_id = _req_int(body.get("doc_id"), "doc_id")
    step = _req_step(body.get("step"))
    if conn.execute("SELECT 1 FROM documents WHERE doc_id = ?", (doc_id,)).fetchone() is None:
        raise NotFoundError(f"Document not found: {doc_id}")

    derived = derived_state(conn, doc_id)
    last_action = _last_action_id(conn, doc_id, step)
    validated_at = utcnow_iso()
    conn.execute(
        "INSERT INTO doc_step_status (doc_id, step, validated_at, last_action_id, derived_json)"
        " VALUES (?, ?, ?, ?, ?)"
        " ON CONFLICT(doc_id, step) DO UPDATE SET"
        "   validated_at = excluded.validated_at,"
        "   last_action_id = excluded.last_action_id,"
        "   derived_json = excluded.derived_json",
        (doc_id, step, validated_at, last_action, json.dumps(derived, ensure_ascii=False)),
    )
    conn.commit()
    return {
        "doc_id": doc_id,
        "step": step,
        "validated_at": validated_at,
        # Ce sur quoi la coche se fonde. « derived » veut dire qu'aucun historique
        # n'existait : la coche est plus faible, et l'écran le dit.
        "basis": "history" if last_action is not None else "derived",
    }


def clear_step_status(conn: sqlite3.Connection, body: dict) -> dict[str, Any]:
    """POST /documents/step_status/clear — retirer un `[X]`.

    Le document redevient `[ ]` ou `[/]` selon ce que le moteur observe. Retirer une
    coche absente n'est pas une erreur : le geste est « qu'elle ne soit pas là ».
    """
    doc_id = _req_int(body.get("doc_id"), "doc_id")
    step = _req_step(body.get("step"))
    cur = conn.execute(
        "DELETE FROM doc_step_status WHERE doc_id = ? AND step = ?", (doc_id, step)
    )
    conn.commit()
    return {"doc_id": doc_id, "step": step, "cleared": cur.rowcount > 0}


def _derived_state_all(conn: sqlite3.Connection) -> dict[int, dict[str, Any]]:
    """L'état dérivé de TOUS les documents, en un balayage.

    Pendant de `derived_state` pour le chemin de lecture. La première écriture appelait
    `derived_state` par coche : sur la base de travail, 232 coches faisaient passer
    `GET /documents` de 152 ms à 404 ms. Quatre agrégats en une passe rendent la lecture
    indépendante du nombre de coches.
    """
    out: dict[int, dict[str, Any]] = {}
    try:
        rows = conn.execute(
            """
            SELECT d.doc_id,
                   COALESCE(u.n, 0),
                   COALESCE(t.n, 0),
                   COALESCE(ap.n, 0) + COALESCE(at_.n, 0),
                   c.last
            FROM documents d
            LEFT JOIN (SELECT doc_id, COUNT(*) AS n FROM units
                        WHERE unit_type = 'line' GROUP BY doc_id) u ON u.doc_id = d.doc_id
            LEFT JOIN (SELECT un.doc_id, COUNT(tk.token_id) AS n FROM units un
                        JOIN tokens tk ON tk.unit_id = un.unit_id
                        GROUP BY un.doc_id) t ON t.doc_id = d.doc_id
            LEFT JOIN (SELECT pivot_doc_id AS doc_id, COUNT(*) AS n FROM alignment_links
                        GROUP BY pivot_doc_id) ap ON ap.doc_id = d.doc_id
            LEFT JOIN (SELECT target_doc_id AS doc_id, COUNT(*) AS n FROM alignment_links
                        GROUP BY target_doc_id) at_ ON at_.doc_id = d.doc_id
            LEFT JOIN (SELECT doc_id, MAX(performed_at) AS last FROM prep_action_history
                        WHERE action_type = 'curation_apply' AND reverted = 0
                        GROUP BY doc_id) c ON c.doc_id = d.doc_id
            """
        ).fetchall()
    except sqlite3.Error:
        return out
    for r in rows:
        out[int(r[0])] = {
            "unit_count": int(r[1] or 0),
            "token_count": int(r[2] or 0),
            "aligned_count": int(r[3] or 0),
            "curated_at": r[4],
        }
    return out


# Toutes les actions qui peuvent périmer quoi que ce soit, pour les seuls documents qui
# portent une coche. Bornée par l'historique de ces documents-là, pas par la table
# entière : `set_role` et consorts ne sont même pas chargés.
_ACTIONS_SINCE_SQL = """
    SELECT h.doc_id, h.action_id, h.action_type
    FROM prep_action_history h
    JOIN (SELECT DISTINCT doc_id FROM doc_step_status) m ON m.doc_id = h.doc_id
    WHERE h.reverted = 0 AND h.action_type IN ({placeholders})
    ORDER BY h.action_id
"""


def step_status_map(
    conn: sqlite3.Connection,
    derived: Optional[dict[int, dict[str, Any]]] = None,
) -> dict[int, dict[str, dict[str, Any]]]:
    """Toutes les coches du corpus, chacune avec son verdict de péremption.

    Rendu par document puis par capacité. Une coche périmée n'est PAS rendue comme un
    `[X]` : l'appelant lit ``stale`` et retombe sur `[/]`. Le champ ``stale_reason``
    nomme ce qui l'a démentie — un type d'action, ou le champ dérivé qui a bougé.

    Deux requêtes, quel que soit le nombre de coches — la comparaison se fait en mémoire
    et porte sur au plus quatre valeurs par coche.

    ``derived`` évite la troisième : `GET /documents` tient déjà les quatre valeurs de
    chaque document (`unit_count` et `token_count` dans sa requête de liste,
    `aligned_count` et `curated_at` dans `_derived_doc_state`) et les passe plutôt que de
    les faire recalculer. Sans ce passage, la lecture les reprenait pour rien, avec
    quatre LEFT JOIN dont un sur les 14 577 liens du corpus de travail.
    """
    out: dict[int, dict[str, dict[str, Any]]] = {}
    try:
        marks = conn.execute(
            "SELECT doc_id, step, last_action_id, derived_json, validated_at"
            " FROM doc_step_status"
        ).fetchall()
    except sqlite3.Error:
        return out  # table absente (base antérieure à la migration 038)
    if not marks:
        return out

    kinds = sorted({k for ks in ACTIONS_BY_STEP.values() for k in ks})
    actions_par_doc: dict[int, list[tuple[int, str]]] = {}
    for r in conn.execute(
        _ACTIONS_SINCE_SQL.format(placeholders=", ".join("?" * len(kinds))), kinds
    ):
        actions_par_doc.setdefault(int(r[0]), []).append((int(r[1]), str(r[2])))
    derives = derived if derived is not None else _derived_state_all(conn)

    for doc_id, step, last_action_id, derived_json, validated_at in marks:
        doc_id, step = int(doc_id), str(step)
        if step not in ACTIONS_BY_STEP:
            continue  # capacité retirée depuis : la ligne dort, on ne la rend pas
        reason: Optional[str] = None
        # 1. L'historique d'abord : il NOMME ce qui s'est passé.
        seuil = int(last_action_id or 0)
        for action_id, action_type in actions_par_doc.get(doc_id, ()):
            if action_id > seuil and action_type in ACTIONS_BY_STEP[step]:
                reason = action_type
                break
        # 2. L'état dérivé ensuite, qui rattrape les documents que l'historique ignore.
        if reason is None:
            try:
                avant = json.loads(derived_json)
            except (TypeError, ValueError):
                avant = None
            if isinstance(avant, dict):
                for key, value in derives.get(doc_id, {}).items():
                    if avant.get(key) != value:
                        reason = f"derived:{key}"
                        break
        out.setdefault(doc_id, {})[step] = {
            "validated_at": validated_at,
            "stale": reason is not None,
            "stale_reason": reason,
            "basis": "history" if last_action_id is not None else "derived",
        }
    return out
