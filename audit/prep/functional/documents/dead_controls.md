# Documents — dead_controls

## Contrôles morts / non branchés

1. `#meta-batch-role-btn` (barre "N sélectionnés")
- Symptôme: le bouton devient enabled à partir de 2 sélections mais aucun `addEventListener` ne lui est attaché.
- Impact: fonctionnalité batch ciblée annoncée mais inexistante.
- Preuve code: rendu du bouton + logique `disabled` dans `_renderBatchBar()`, sans handler d’exécution.
- Classification: `dead`.

## Contrôles partiels (dépendance externe)

1. `#meta-preview-panel`
- Symptôme: dépend de `GET /documents/preview`.
- Impact: fonctionne avec sidecar API 1.4.6; échoue avec le sidecar embarqué actuel API 1.4.1 (`Unknown route: /documents/preview`).
- Classification: `partial`.
