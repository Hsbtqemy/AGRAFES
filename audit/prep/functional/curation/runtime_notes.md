# Actions > Curation — runtime_notes

## Contexte de test

- Audit statique complet listeners/méthodes.
- Probe runtime backend effectué avec sidecar API 1.4.6 (`.venv/bin/multicorpus`).

## États couverts

- Sidecar off:
  - boutons métier désactivés via `_setButtonsEnabled(false)`.
- Sidecar on + corpus avec données:
  - `POST /curate/preview` validé,
  - `POST /validate-meta` validé,
  - `jobs/enqueue(kind=index)` validé.
- Absence de sélection document:
  - `_runPreview()` remonte une erreur explicite (document requis).

## Non validable dans cet état

- E2E UI strict de `Appliquer curation` (confirmation modale + suivi visuel job en interface).
- Validation UI des interactions "Actions rapides" (feature non implémentée).
