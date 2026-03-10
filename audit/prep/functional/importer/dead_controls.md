# Importer — dead_controls

## Contrôles morts / non branchés

1. `#imp-dropzone`
- Symptôme: la zone promet un drop de fichiers, mais l’événement `drop` ne fait qu’annuler le comportement navigateur (`preventDefault`) et retirer la classe `dragover`.
- Impact: UX trompeuse; aucun ajout de fichiers via drag-and-drop.
- Preuve code: `ImportScreen.ts` — handlers `dragover/dragleave/drop` sans lecture de payload.
- Classification: `dead`.

## Contrôles à risque (non morts mais validation incomplète)

1. `#imp-import-btn`
- Raison: chaîne branchée vers job `import`, mais validation UI E2E impossible ici sans interaction dialog natif + fichiers de test compatibles.
- Classification: `partial`.
