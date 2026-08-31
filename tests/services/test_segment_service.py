"""Le recorder d'annulation d'une resegmentation vit dans services/ (ACT-01).

Il y a été déplacé pour que la CLI puisse l'atteindre : `multicorpus segment` était le
dernier chemin d'écriture à ne rien enregistrer, et importer le module du serveur HTTP
depuis la CLI aurait été prendre le problème à l'envers.

Ce fichier ne garde pas le COMPORTEMENT du recorder — `test_undo.py` s'en charge, en
particulier `test_the_production_recorder_writes_everything_the_undo_reads`. Il garde
son UNICITÉ. Deux fois dans ce chantier, un chemin d'écriture s'est retrouvé muet parce
qu'une logique avait été recopiée au lieu d'être partagée : le job de curation et la CLI
de curation ignoraient tous deux le `record_action` que `POST /curate` passait. Un second
`def make_resegment_recorder` dans `sidecar.py` rouvrirait exactement ce trou-là sans
casser aucun test de comportement — d'où une assertion d'identité, la seule qu'une
recopie ne puisse pas satisfaire.

Que la CLI enregistre pour de bon est prouvé de bout en bout par
`tests/test_cli_contract.py::test_cli_segment_records_an_undoable_action`.
"""

from __future__ import annotations


def test_le_sidecar_reexporte_le_recorder_du_service_sans_le_recopier() -> None:
    from multicorpus_engine import sidecar
    from multicorpus_engine.services import segment_service

    assert sidecar.make_resegment_recorder is segment_service.make_resegment_recorder, (
        "sidecar.make_resegment_recorder n'est plus le réexport du service : "
        "une copie a été réintroduite, et les chemins vont diverger en silence"
    )
