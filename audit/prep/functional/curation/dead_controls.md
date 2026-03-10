# Actions > Curation — dead_controls

## Contrôles morts

1. `#act-curate-doc-label`
- Jamais alimenté en code.

2. `#act-curate-mode-pill`
- Jamais synchronisé avec un état métier.

3. `#act-curate-queue`
- Zone prévue pour "actions rapides" jamais remplie.

4. `.curate-nav-actions` (Précédent / Suivant)
- Boutons hard-disabled sans listener.

## Contrôles cosmétiques (UI-only)

1. `.preview-controls .chip`
- Chips affichés comme options de rendu mais sans logique associée (aucun listener, aucun impact state).
