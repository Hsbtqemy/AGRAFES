# Actions > Segmentation — dead_controls

## Contrôles morts / non branchés

1. `input[name="seg-preset"]` (Strict/Étendu/Custom)
- Aucun listener, aucun impact sur payload.

2. Bloc "Séparateurs actifs" (`.seg-side` checkboxes)
- Commentaire TODO explicite côté code; aucun wiring backend.

3. `input[name="seg-scope"]` (Document entier / Sélection active)
- Aucun listener, aucune utilisation.

4. Chips outils preview traduction (`[data-chip-tr]`)
- Boutons visuellement interactifs sans handler.

## Contrôles partiels

1. `#act-seg-ref-doc` + VO preview
- Dépend de `/documents/preview`; fonctionne uniquement avec sidecar API compatible (1.4.6 observé).

2. `#act-seg-longtext-hint`
- Dépend du champ `char_count` non garanti dans les réponses documents.
