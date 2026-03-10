# Exporter — runtime_notes

## Contexte de test

- Audit statique complet du routeur d’export V2 + legacy.
- Probe backend exécuté avec sidecar API 1.4.6.

## États couverts

- Sidecar off:
  - actions export désactivées.
- Sidecar on + corpus avec données:
  - `export_align_csv`, `export_run_report`, `export_tei`, `export_tei_package`, `export_readable_text`, `qa_report` validés (jobs `done`).
- Sidecar on + corpus vide:
  - UI prévue pour état vide documents; certaines sorties (run_report) restent exportables.
- Erreur / absence sélection:
  - V2 bloque `run` si sélection vide explicite.

## Non validable dans cet état

- E2E UI strict autour des dialogs natifs `open/save` (Tauri plugin dialog).
- Vérification visuelle exhaustive des fichiers exportés depuis l’interface (les jobs backend sont validés via API).
