# Catégories Grammaticales (POS) — Cadrage C4

Last updated: 2026-04-09

## Objectif C4

Fixer le cadre produit/technique minimal des catégories grammaticales
pour éviter une implémentation token/POS ambiguë.

Ce cadrage complète `docs/cadrage/MODE_ANNOTATION.md` (C2) et pilote l’exécution
technique de `docs/BACKLOG_CQL.md`.

## Décisions C4 (actées)

1. **Granularité cible**
   - POS au niveau **token** (pas segment-only comme cible principale).
2. **Jeu d’étiquettes**
   - Référence primaire: **Universal Dependencies** (`upos`).
   - `xpos` autorisé en complément (langue/projet), non obligatoire.
3. **Traits morphologiques**
   - Stockage initial en chaîne CoNLL-U (`feats` texte), parsable à la demande.
4. **Origines supportées (ordre de priorité)**
   - V1: import CoNLL-U.
   - V1.5: annotation auto (spaCy) optionnelle.
   - Édition manuelle fine: phase ultérieure.
5. **Surface produit**
   - Prep: import/lancement annotation + statut.
   - Concordancier: filtres/requêtes/lecture des annotations.
6. **Cohérence avec segmentation**
   - Resegmentation => annotation token marquée `stale` pour le document.

## Ce que C4 n’ouvre pas tout de suite

- Pas de POS “segment-only” comme modèle final.
- Pas de schéma multi-taxonomies simultanées complexes en V1.
- Pas de CQL avancé complet sans fondation tokens stable.

## Implications d’implémentation (résumé)

1. Migration tokens + index.
2. Ingestion CoNLL-U.
3. Exposition read API (présence/stats annotations).
4. Job `annotate` optionnel.
5. Requêtes CQL progressives.
6. Exports annotés.

## Critères de sortie C4

- Schéma POS de référence explicite (`upos` + `xpos` optionnel).
- Origine des tags tranchée (import d’abord, auto ensuite).
- Règle de stabilité segmentation/annotation formalisée.
- Alignement explicite avec `docs/BACKLOG_CQL.md`.

