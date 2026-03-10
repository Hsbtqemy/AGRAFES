# Actions > Alignement — runtime_notes

## Contexte de test

- Analyse statique exhaustive des handlers.
- Probe backend exécuté sur sidecar API 1.4.6 (corpus démo).

## États couverts

- Sidecar off:
  - actions non exécutables (messages d’erreur/disabled global).
- Sidecar on + corpus avec données:
  - `align` (run + recalc) validé,
  - `align/audit` validé,
  - `align/quality` validé,
  - `align/link/update_status`, `align/link/retarget`, `align/links/batch_update`, `align/link/delete` validés,
  - `export_run_report` validé.
- Sidecar on + corpus vide:
  - align possible mais retourne 0 liens (comportement backend "empty result", pas crash).
- Erreur / absence sélection:
  - garde-fous présents dans `_runAlign`, `_runAlignQuality`, `_loadAuditPage`.

## État dense

- Collisions réelles non obtenues sur corpus probe; opérations de résolution non validées en condition dense.

## Non validable dans cet état

- E2E UI strict de toutes les interactions tableau/run/focus sous shell Tauri.
- Validation empirique de l’ergonomie run-view longue session (risque d’accumulation listeners identifié statiquement).
