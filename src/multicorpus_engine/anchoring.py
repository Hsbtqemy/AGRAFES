"""Ancrage amont (chantier 1, [`DESIGN_upstream_anchoring.md`](../../docs/DESIGN_upstream_anchoring.md)
§2/§4) — classer *comment un document est ancré* pour l'alignement, afin de **prévenir la
dérive avant** de lancer l'aligneur (au lieu de la réparer cellule par cellule en aval,
gestes D-W* de la matrice).

Trois familles d'ancre, classées (§2), de la plus forte à la plus faible :

* **``value``** — marqueurs ``[N]`` : ``external_id`` ≠ position (docx/txt/odt_numbered_lines,
  TEI ``xml:id``). Exacte : les numéros s'apparient quel que soit l'ordre/la fusion.
* **``paragraph``** — ``meta_json.parent_n`` (resegmentation R2.1 / regroupement R5.4c /
  futur split blob R2.3). Borne la dérive dans le ¶.
* **``position``** — ``external_id`` == n de l'unité (docx/odt_paragraphs, ADR-012).
  Bonne *si* les deux textes sont parallèles.
* **aucune** → dérive déterministe (le cas Beigbeder EN qui a motivé la note).

L'ancre paragraphe réutilise **le classifieur du régime deux-grains**
(:func:`coarse_grain.is_anchored_regime`) — pas d'heuristique neuve de ce côté (D-U2). La
seule inférence propre à ce module est *value vs position* : ``external_id == n`` ⇒ position,
sinon ⇒ marqueur (§9 Q3 — inférer, pas de nouveau champ).

Pur : :func:`anchor_status` ne touche ni DB ni IO. :func:`anchor_status_for_doc` est le
mince aller-retour ``conn`` (miroir de :func:`coarse_grain.coarse_blocks_for_doc`). Read-only,
aucune migration.
"""
from __future__ import annotations

import sqlite3
from typing import Any, Iterable, Optional

from .coarse_grain import is_anchored_regime

#: Ordre de force des ancres (le plus fort d'abord) — sert au *rapport* du ``kind`` quand un
#: document en porte plusieurs (un docx numéroté resegmenté porte ``value`` ET ``paragraph`` ;
#: un docx_paragraphs resegmenté porte ``position`` ET ``paragraph``). On rapporte la plus forte.
ANCHOR_PRECEDENCE: tuple[str, ...] = ("value", "paragraph", "position")


def _external_id_anchor(lines: list[dict[str, Any]]) -> Optional[str]:
    """``"value"`` | ``"position"`` | ``None`` d'après les ``external_id`` des lignes.

    * ``None`` — aucune ligne ne porte d'``external_id`` non-nul.
    * ``"position"`` — **toute** ligne porteuse a ``external_id == n`` (ADR-012, position
      séquentielle). Indistinguable d'un ``[N]`` qui vaudrait 1, 2, 3… — mais de **même
      force** pour un texte parallèle, donc rapporté ``"position"`` (label conservateur).
    * ``"value"`` — au moins une ligne porte ``external_id`` ≠ ``n`` (ou non entier) → un
      marqueur ``[N]`` explicite (numbering), potentiellement à trous / non monotone.
    """
    carriers = [u for u in lines if u.get("external_id") is not None]
    if not carriers:
        return None
    for u in carriers:
        try:
            if int(u["external_id"]) != int(u["n"]):
                return "value"
        except (TypeError, ValueError):
            return "value"  # external_id non entier ⇒ pas une position → marqueur
    return "position"


def anchor_status(units: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """Classer l'ancrage d'un document pour l'alignement (§2). Pur, read-only.

    ``units`` : dicts avec ``unit_type`` ('line'|'structure'), ``external_id`` (int|None),
    ``meta_json`` (str|dict|None), ``n`` (int).

    Renvoie ``{"anchored": bool, "kind": "value"|"paragraph"|"position"|None,
    "line_count": int}`` :

    * ``kind`` — l'ancre **la plus forte** portée (:data:`ANCHOR_PRECEDENCE`) ; ``None`` si
      aucune → l'alignement dérivera.
    * ``anchored`` — ``kind is not None``.
    * ``line_count`` — nombre d'unités-ligne : distingue le **blob** (1, remède = extraire /
      ré-importer découpé) du **multi-lignes non ancré** (remède = numéroter / regrouper), §5.
    """
    rows = list(units)
    lines = [u for u in rows if u.get("unit_type") == "line"]
    ext = _external_id_anchor(lines)
    # Précédence value > paragraph > position (ANCHOR_PRECEDENCE).
    if ext == "value":
        kind: Optional[str] = "value"
    elif is_anchored_regime(rows):
        kind = "paragraph"
    elif ext == "position":
        kind = "position"
    else:
        kind = None
    return {"anchored": kind is not None, "kind": kind, "line_count": len(lines)}


def anchor_status_for_doc(conn: sqlite3.Connection, doc_id: int) -> dict[str, Any]:
    """Aller-retour ``conn`` mince (miroir de :func:`coarse_grain.coarse_blocks_for_doc`).

    Read-only, réutilise le schéma existant — aucune migration, aucun nouvel endpoint (la
    dérivation est exposée à la demande par le service qui en a besoin : aujourd'hui la
    projection matrice, DESIGN_upstream_anchoring §7 chantier 1).
    """
    rows = conn.execute(
        "SELECT n, unit_type, external_id, meta_json FROM units WHERE doc_id=? ORDER BY n",
        (doc_id,),
    ).fetchall()
    units = [
        {
            "n": r["n"], "unit_type": r["unit_type"],
            "external_id": r["external_id"], "meta_json": r["meta_json"],
        }
        for r in rows
    ]
    return anchor_status(units)
