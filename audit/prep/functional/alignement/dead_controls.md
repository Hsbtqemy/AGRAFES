# Actions > Alignement — dead_controls

## Contrôles morts

Aucun bouton totalement non branché détecté dans la vue Alignement.

## Contrôles partiellement branchés (fort risque)

1. `#act-focus-lock-btn` / `#act-focus-unlock-btn`
- Implémentation actuelle: alias de `status=accepted` et `status=null`.
- Effet: pas de notion métier distincte de verrouillage.

2. Vue run (`#act-audit-run-view`)
- `_renderAuditRunView()` ajoute un listener `click` à chaque rendu sans cleanup.
- Risque: accumulation d’handlers, actions dupliquées.

3. Résolution collisions
- Wiring complet, mais non validé sur collision réelle dans le corpus probe (0 collision).
