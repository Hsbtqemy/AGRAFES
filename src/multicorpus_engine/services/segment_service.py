"""Segmentation domain service — le recorder d'annulation d'une resegmentation.

Déplacé depuis ``sidecar.py`` sans rien changer d'autre (ACT-01) : la CLI
``multicorpus segment`` était le dernier chemin d'écriture à ne rien enregistrer, et
elle ne pouvait pas importer le module du serveur HTTP pour y accéder. Les deux
chemins sidecar continuent de l'atteindre par ``sidecar.make_resegment_recorder``,
réexporté là-bas — le nom public ne bouge pas.

Pendant de ``curate_service.apply_recorder`` : même rôle, même raison d'être partagé
plutôt que recopié.
"""

from __future__ import annotations

import sqlite3

from ..action_history import (
    ACTION_RESEGMENT,
    insert_unit_snapshots,
    record_prep_action,
)


def make_resegment_recorder(conn: sqlite3.Connection, calibrate_to: object = None):
    """Build the Mode-A recorder that makes a resegmentation undoable.

    Extracted from ``_handle_segment`` (ALI-10 / décision D-2) so the paths that
    resegment WITHOUT recording can stop doing so: family segment, async job, markers.
    Those destroyed a document's units *and* its alignment links with no trace at all —
    on the reference corpus, one ``force=true`` on a family wiped 5 770 links.

    Archiving the LINKS alone would not have been enough: a resegmentation drops the
    units too, and a link restored onto a dead ``unit_id`` is filtered out by the FK
    guard (ALI-03). What makes the revert exact is that ``_undo_resegment`` reinserts the
    units WITH THEIR ORIGINAL unit_id — so the archive recolle. One action per document:
    the preparation history is linear per document, and a family segmentation is simply
    N of those, exactly as a family alignment run is N per-pair runs.
    """
    def _recorder(payload: dict) -> int | None:
        units_before = payload["units_before"]
        if not units_before:
            return None
        d_id      = payload["doc_id"]
        created   = payload["created_unit_ids"]
        new_n     = payload["new_units_n"]
        pack_used = payload["pack"]
        action_id = record_prep_action(
            conn,
            doc_id=d_id,
            action_type=ACTION_RESEGMENT,
            description=(
                f"Resegmentation · {len(units_before)} → "
                f"{len(created)} unités"
            ),
            context={
                "pack":                     pack_used,
                "lang":                     payload["lang"],
                "text_start_n":             payload["text_start_n"],
                "calibrate_to":             calibrate_to,
                "units_deleted_after_ids":  [u["unit_id"] for u in units_before],
                "units_created_after_json": [
                    {"unit_id": uid, "n": n}
                    for uid, n in zip(created, new_n)
                ],
                "units_before":             [
                    {
                        "unit_id":     u["unit_id"],
                        "n":           u["n"],
                        "external_id": u["external_id"],
                        "text_raw":    u["text_raw"],
                        "text_norm":   u["text_norm"],
                        "unit_role":   u["unit_role"],
                        "meta_json":   u["meta_json"],
                        # Absent des chemins qui ne resegmentent que des lignes ;
                        # apply_propagated, lui, embrasse aussi les `structure`.
                        "unit_type":   u.get("unit_type") or "line",
                        # `_undo_resegment` relit text_source depuis ce JSON — il n'a
                        # pas de colonne `_before` dans la table d'instantanés. Ce
                        # mapping l'omettait, donc toute annulation de resegmentation
                        # rendait l'unité avec text_source NULL et perdait sans bruit
                        # la provenance d'import (le repli « voir l'original »). Le
                        # test qui semblait couvrir le cas passe par une doublure de
                        # recorder qui, elle, transmet le payload verbatim.
                        "text_source": u.get("text_source"),
                    }
                    for u in units_before
                ],
            },
        )
        # Instantanés des unités supprimées. `n` et `external_id` n'ont pas de colonne
        # dans cette table : c'est `context_json.units_before` qui les porte, et c'est
        # de là que l'annulation reconstruit les lignes.
        # `text_source_before`, EN REVANCHE, a bien sa colonne (migration 021) — le
        # commentaire qui tenait ici affirmait le contraire et la laissait vide. Deux
        # dépôts pour la même valeur, dont un toujours NULL, est un piège pour qui lira
        # la table : on remplit les deux, ils viennent de la même source.
        insert_unit_snapshots(
            conn,
            action_id,
            [
                {
                    "unit_id":          u["unit_id"],
                    "text_raw_before":  u["text_raw"],
                    "text_norm_before": u["text_norm"] or "",
                    "unit_role_before": u["unit_role"],
                    "meta_json_before": u["meta_json"],
                    "text_source_before": u.get("text_source"),
                }
                for u in units_before
            ],
        )
        return action_id

    return _recorder
