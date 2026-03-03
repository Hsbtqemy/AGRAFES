# UX Flow — tauri-prep (navigation & branchements)

Last updated: 2026-03-03

Objectif: fixer les règles de navigation et les actions de fin de flux dans `tauri-prep`, pour éviter les ambiguïtés entre maquettes et implémentation.

## 1) Scope

Ce document couvre:
- la navigation entre onglets de `tauri-prep`,
- les branchements de fin d’action dans les écrans de préparation,
- la distinction entre actions `document courant` et actions `batch`.

Ce document ne décrit pas le contrat sidecar ni les détails API.

## 2) Navigation globale (Prep)

Onglets principaux:
- `Projet`
- `Import`
- `Documents`
- `Actions`
- `Exports`

Règle:
- un seul écran actif à la fois,
- l’utilisateur peut changer d’onglet à tout moment.

## 3) Principe de scope UX

Deux scopes doivent rester explicites dans l’UI:
- `Document courant` (travail local, fin de traitement individuelle),
- `Batch corpus` (actions multi-documents, non obligatoires).

Règle de lisibilité:
- les actions `document courant` sont toujours visibles en fin de zone de travail,
- les actions `batch` sont séparées visuellement et repliées par défaut.

## 3.1) Point de sauvegarde DB (Documents)

Avant des modifications de métadonnées (surtout en lot), l’écran `Documents` doit exposer
une action visible `Sauvegarder la DB`.

Règle UX:
- action disponible sans quitter l’onglet,
- retour d’état immédiat (`sauvegarde en cours` puis `dernière sauvegarde`),
- positionnée dans l’en-tête de l’écran `Documents` pour rester accessible.

## 4) Règle de fin de flux — Segmentation (mode focus / revue)

Action primaire:
- bouton `Valider ce document`.

Comportement cible (implémentation):
1. persister la segmentation courante (incluant retouches manuelles),
2. passer le document en statut `validé` (avec horodatage + run_id),
3. afficher une confirmation utilisateur,
4. rediriger vers l’onglet `Documents` (par défaut).

Motif:
- ne pas imposer un enchaînement automatique sur d’autres documents,
- laisser l’utilisateur décider de la suite.

Implémentation V1.6 (tauri-prep, onglet Actions):
- bouton explicite `Segmenter + valider ce document`,
- à la fin d’un run de segmentation réussi:
  - mise à jour `workflow_status=validated`,
  - branchement piloté par préférence utilisateur `Après validation`:
    - `Documents` (défaut),
    - `Document suivant`,
    - `Rester sur place`.
  - fallback de sécurité: si `Document suivant` n’existe pas, redirection vers `Documents`.

## 5) Règles de panneaux repliables

Dans les écrans à forte densité (curation/segmentation):
- le header entier d’une box repliable ouvre/ferme la box,
- l’icône caret reste active,
- support clavier `Enter`/`Space`,
- `aria-expanded` synchronisé.

## 6) Décision UX validée (2026-03-03)

Décision:
- `Décision batch` (ou équivalent multi-documents) reste repliée par défaut,
- une barre d’action dédiée au document courant est prioritaire en bas du flux.

Conséquence:
- l’utilisateur comprend que la sortie naturelle est la validation du document courant,
- le batch devient une action volontaire, non un piège de navigation.

## 7) Futures options (backlog UX)

- (aucun item prioritaire ouvert sur ce volet — le handoff `agrafes://open-db` est implémenté en V1.6).
