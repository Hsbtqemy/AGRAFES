# Conventions Projet — Cadrage C1

Last updated: 2026-04-09

## Objectif

Définir une base commune pour les marqueurs sémantiques de projet
(ex. `[T]`, `[TInter]`) sans casser le contrat sidecar actuel ni
introduire de dette moteur avant cadrage annotation (C2/C4).

Ce document clôt le cadrage **C1** demandé dans `docs/BACKLOG.md`.

## Périmètre

- Concerne les **codes sémantiques** (titres, intertitres, zones métier).
- Ne remplace pas la logique de segmentation numérique `[n]`.
- N’introduit pas de nouveau schéma DB à ce stade.

## Décisions C1 (actées)

1. **`[n]` reste réservé** aux identifiants de segment alignables.
2. Les codes sémantiques (`[T]`, `[TInter]`, etc.) sont traités comme
   **texte brut** dans l’état actuel du moteur.
3. Le flux recommandé à court terme est **outil externe / convention éditoriale**
   puis import dans AGRAFES, avec nettoyage optionnel en curation.
4. Pas d’extraction automatique de ces codes vers métadonnées tant que
   le schéma annotation (C2/C4) n’est pas validé.

## Choix d’intégration (import vs curation vs externe)

### Import

- **Maintenu neutre** pour les codes sémantiques.
- Aucune promotion implicite vers `unit_type` ou `meta_json`.
- Avantage: zéro rupture de contrat.

### Curation

- Utilisée pour nettoyage explicite (ex. retirer certains marqueurs résiduels).
- Pas de règle forcée par défaut.
- Avantage: contrôle utilisateur, traçabilité via workflow Prep.

### Outil externe (recommandé court terme)

- La convention métier est préparée/validée en amont (réf. LingWhistX).
- AGRAFES consomme cette convention sans en imposer le schéma interne.

## Règles de nommage recommandées

- Segment alignable: `[123]` (numérique uniquement).
- Code sémantique: `[CODE]` en majuscules (ex. `[T]`, `[TINTER]`).
- Éviter les collisions: ne pas utiliser de codes alphanumériques qui
  ressemblent à un ID segment (`[12A]`, `[01x]`) dans les flux alignés.

## Référence LingWhistX

- Référence locale (hors repo AGRAFES): `/Users/hsmy/Dev/LingWhistX`
- Usage dans AGRAFES: source d’exemples, pas dépendance runtime.

## Hors scope C1 (renvoyé C2/C4)

- Table d’annotations dédiée (`tokens`, spans, tags normalisés).
- Routes sidecar d’annotation (`/annotate`, filtres query sur tags).
- Exports TEI/CSV enrichis avec catégories de convention.

## Critères de sortie C1

- Conventions documentées.
- Arbitrage import/curation/externe acté.
- Aucun changement moteur imposé à ce stade.

