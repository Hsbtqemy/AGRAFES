# Exporter — dead_controls

## Contrôles morts / non branchés

1. `#v2-align-exceptions-only`
- Affiché dans les options V2 alignements mais jamais lu dans le code.
- Aucun impact sur payload export.
- Classification: `dead`.

## Paramètres partiels

1. `#v2-tei-relation-type`
- Valeur lue mais non transmise au backend (utilisée uniquement dans le texte de log).

2. `#tei-relation-type` (legacy)
- Même constat: non propagé au payload réel.
