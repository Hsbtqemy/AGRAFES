# Mode Annotation — Cadrage C2

Last updated: 2026-04-09

## Objectif C2

Fixer le périmètre produit du **mode annotation** et l’ordre de mise en œuvre,
avant toute implémentation lourde (tokens, CoNLL-U, CQL, POS).

Ce document tranche les points laissés ouverts dans `docs/BACKLOG.md`
et aligne la roadmap technique décrite dans `docs/BACKLOG_CQL.md`.

## Décisions produit (actées)

1. **Strates maintenues**
   - Lecture/exploration (existant).
   - Préparation structurelle (existant).
   - Annotation linguistique/rich (nouveau périmètre).
2. **Périmètre prioritaire**
   - Priorité annotation **linguistique** (tokens, lemma, POS).
   - Les tags métier restent possibles, mais en seconde vague.
3. **Surface d’usage**
   - **Prep** = point d’entrée principal pour lancer/importer annotation.
   - **Concordancier** = consommation/recherche des annotations.
4. **Sources d’annotation**
   - V1: import CoNLL-U + lecture.
   - V1.5: annotation auto (spaCy) optionnelle.
   - Édition manuelle fine: hors scope initial.
5. **Couplage segmentation ↔ annotation**
   - Toute resegmentation invalide la couche token du document.
   - L’annotation devient `stale` tant qu’elle n’est pas régénérée.

## Contrat de progression (ordre recommandé)

1. **Fondation schéma**
   - table `tokens` + index + statut d’annotation par document.
2. **Ingestion**
   - import CoNLL-U vers `tokens`.
3. **Exposition API**
   - endpoints read pour présence/statut/aperçu des annotations.
4. **Annotation automatique (optionnelle)**
   - job asynchrone `annotate` (spaCy), dépendance facultative.
5. **Requête avancée**
   - CQL simple puis CQL avancé (selon `BACKLOG_CQL.md`).
6. **Exports**
   - CoNLL-U + exports de résultats annotés.

## Rôle de BACKLOG_CQL

- `docs/BACKLOG_CQL.md` devient la **feuille technique d’exécution**.
- Ce document C2 fixe les **garde-fous produit**:
  - priorités,
  - séquence,
  - non-régression sur les flux existants.

## Hors scope C2

- Implémentation immédiate de routes `/annotate` ou de parser CQL.
- UI complète d’édition manuelle token par token.
- Schéma POS final exhaustif multi-projets.

## Critères de sortie C2

- Priorités produit explicites (ce qui vient avant/après).
- Ordre d’implémentation validé (schéma → import → API → jobs → CQL → export).
- Règle de cohérence segmentation/annotation formalisée (`stale`).
- Lien explicite et non ambigu avec `docs/BACKLOG_CQL.md`.

