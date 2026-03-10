# Actions Hub — runtime_notes

## Couverture

- Vue auditée principalement en statique (wiring navigation).
- La vue Hub ne porte pas d’opérations sidecar directes.

## États couverts

- Navigation nominale hub -> sous-vues -> hub: branchée.
- Persistance locale de sous-vue (`LS_ACTIVE_SUB`): branchée.

## Non validable dans cet état

- E2E UI strict (clic réel dans shell Tauri) non automatisé ici.
