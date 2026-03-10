# Post-Inc2 Check — Actions > Curation

## Captures
- 1440: `audit/curation/runtime_after_inc2_1440.png`
- 1728: `audit/curation/runtime_after_inc2_1728.png`

## Comparative note (vs post-Inc1, 1440)
- **Largeur utile Curation (`workspace`)**: quasi stable (-0.78 px), le retrait du hack n'a pas recréé de perte significative.
- **Largeur centrale (`col_center`)**: amélioration forte (+71.52 px), la colonne centrale devient dominante.
- **Largeur utile preview (`doc_scroll`)**: amélioration (+35.75 px) avec hauteur conservée (558 px).
- **Densité contrôles preview**: `font-size` passe de `12px` à `13px`, meilleure lisibilité.
- **Head Curation**: titre et sous-titre plus lisibles (`17.6 -> 18.08px`, `13.12 -> 13.6px`).
- **Minimap**: parité conservée (22 px de large, hauteur alignée), pas de régression.

## 1728 (sanity check)
- `workspace.w`: 1475.22 px
- `col_center.w`: 784.28 px
- `preview_controls.h`: 44 px (plus compact qu'à 1440 car moins de retours à la ligne)

## Overflow / sticky
- `preview_card`: `overflow hidden` / `hidden`
- `preview_grid`: `overflow hidden` / `hidden`
- `doc_scroll`: `overflow auto` / `auto`
- `minimap`: `overflow visible` / `visible`

Conclusion: la chaîne overflow/sticky reste saine et n'empêche pas le rendu minimap dans les captures post-Inc2.
