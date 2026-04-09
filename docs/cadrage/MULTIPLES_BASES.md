# Multiples Bases — Cadrage C3

Last updated: 2026-04-09

## Objectif C3

Trancher la stratégie produit pour l’usage de plusieurs bases SQLite dans
AGRAFES, sans introduire de complexité serveur prématurée.

## Décision C3 (actée)

1. **Court terme (V1)**: modèle **A + B**
   - **A**: bascule explicite d’une base active (récents/favoris).
   - **B**: multi-fenêtre shell (une fenêtre = une base).
2. **Moyen terme**: pas de requête fédérée unique dans `/query`.
3. **Long terme**: modèle **C** (fédération multi-DB) reste P3+, soumis à
   besoin métier démontré.

## Pourquoi ce choix

- Le sidecar actuel est monobase par instance (`db_path` unique).
- La fédération impose une rupture de contrat:
  - collisions `doc_id`,
  - provenance obligatoire de chaque hit,
  - budget mémoire/latence plus élevé,
  - complexité API/UX significative.
- Le besoin utilisateur principal est couvert par A/B:
  - changer de corpus rapidement,
  - comparer deux corpus en parallèle.

## Implications produit

### A — Base active unique (renforcée)

- Affichage explicite de la DB active dans l’UI.
- Historique “bases récentes” + favoris.
- Bascule sûre avec remount contrôlé (comportement déjà proche de l’existant).

### B — Multi-fenêtre (shell)

- Ouverture de plusieurs fenêtres Tauri, chacune liée à une DB.
- Pas de mélange des résultats entre fenêtres.
- Aligné avec l’item shell P9 (multi-fenêtre).

### C — Fédération (report)

- Pas de `POST /query` multi-DB dans ce cycle.
- Réservé à une phase ultérieure avec contrat dédié (`db_id`, provenance,
  pagination fédérée, tri inter-corpus).

## Critères de sortie C3

- Décision A/B/C documentée.
- Priorité de réalisation fixée: A/B avant C.
- Alignement explicite avec le backlog shell P9.

## Hors scope C3

- Implémentation immédiate de la multi-fenêtre.
- Refonte sidecar pour interroger plusieurs DB à la fois.
- Fusion offline automatique de plusieurs DB.

