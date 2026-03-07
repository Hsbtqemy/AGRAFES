# UX Flow — tauri-prep (navigation & branchements)

Last updated: 2026-03-06

Objectif: fixer les règles de navigation et les actions de fin de flux dans `tauri-prep`, pour éviter les ambiguïtés entre maquettes et implémentation.

## 1) Scope

Ce document couvre:
- la navigation entre onglets de `tauri-prep`,
- les branchements de fin d’action dans les écrans de préparation,
- la distinction entre actions `document courant` et actions `batch`.

Ce document ne décrit pas le contrat sidecar ni les détails API.

## 2) Navigation globale (Prep)

Étapes principales du workflow:
- `Projet`
- `Import`
- `Documents`
- `Actions`
- `Exports`

Tabbar runtime actuelle (`tauri-prep`):
- `Importer`
- `Documents`
- `Actions`
- `Exporter`

Note:
- `Projet` est porté par la topbar et l'écran d'entrée (ouvrir/créer DB, état sidecar, handoff), pas par un onglet dédié.

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

## 8) Checklist de verrouillage (design -> implementation)

Objectif: ne pas lancer l'implementation UI finale tant que ces points ne sont pas explicitement cadres.

- [x] `Definition Done` par onglet:
  - Import: corpus ingere + indexe + log clair.
  - Documents: metadonnees + statut workflow persistes.
  - Actions/Curation: preview diff clair + application explicite.
  - Segmentation: proposition + retouches + validation document.
  - Alignement: run + revue exceptions + corrections locales.
  - Exports: selection docs + format + fichier de sortie confirme.
- [x] Frontiere Alignement vs Audit:
  - Alignement = revue rapide + corrections unitaires.
  - Audit avance = cas lourds/massifs et inspection approfondie.
  - CTA explicite depuis Alignement vers Audit (sans ambiguite).
- [x] Etats de sauvegarde et garde de sortie:
  - `non enregistre` / `enregistre` / `erreur` visible.
  - avertissement de sortie en cas de modifications non enregistrees.
  - confirmation utilisateur apres `Valider ce document`.
- [x] Strategie de recalcul global:
  - politique claire en cas de conflit avec retouches manuelles.
  - segments verrouilles proteges par defaut.
  - mode force disponible avec confirmation explicite.
- [x] Export V2 (scope reel vs backlog):
  - formats disponibles maintenant identifies clairement.
  - formats `a venir` visibles mais non trompeurs.
  - export multilingue (2-4 langues) defini en entree/sortie.
- [x] Etats d'erreur et etats vides:
  - aucun document selectionne.
  - run echoue/interrompu.
  - pas d'alignements trouves.
  - sidecar indisponible/token manquant.
- [x] Accessibilite minimale:
  - pas de dependance couleur seule.
  - focus clavier visible et ordre tab coherent.
  - libelles actionnables explicites (langage utilisateur).
- [x] Validation bout-en-bout:
  - scenario manuel complet sur corpus realiste.
  - check final: import -> curation -> segmentation -> alignement -> export.

## 9) Ordre recommande de fermeture

1. Valider la `Definition Done` de chaque onglet.
2. Verrouiller Alignement vs Audit + politique de recalcul.
3. Verrouiller sauvegarde/guard rails + erreurs/vides.
4. Verrouiller contrat Export V2.
5. Passer la revue accessibilite.
6. Executer le scenario bout-en-bout de validation.

## 10) Definition Done verrouillee par onglet (2026-03-06)

### 10.1 Import

- Entree:
  - fichiers selectionnes + options d'import.
- Sortie attendue:
  - import termine (success/error explicite),
  - index disponible ou action d'index claire,
  - log consultable depuis l'ecran.

### 10.2 Documents

- Entree:
  - corpus deja importe.
- Sortie attendue:
  - metadonnees sauvegardees (single/bulk),
  - statut workflow document visible (`draft/review/validated`),
  - point de sauvegarde DB accessible depuis l'ecran.

### 10.3 Actions / Curation

- Entree:
  - document selectionne.
- Sortie attendue:
  - preview brut vs texte propose visible,
  - application des changements explicite (bouton/action),
  - resultat etat/log lisibles.

### 10.4 Segmentation

- Entree:
  - document courant + parametres de segmentation.
- Sortie attendue:
  - proposition segmentee visible,
  - retouches locales possibles,
  - action primaire `Valider ce document` avec branchement post-validation.

### 10.5 Alignement

- Entree:
  - fichier cible + VO + strategie.
- Sortie attendue:
  - run lisible avec statut global,
  - exceptions identifiees,
  - corrections unitaires locales accessibles,
  - bascule explicite vers Audit avance pour cas lourds.

### 10.6 Exports

- Entree:
  - documents selectionnes + source donnees + format.
- Sortie attendue:
  - fichier genere (ou erreur explicite),
  - cible/chemin de sortie connu,
  - etat run export consultable.

## 11) Etats de sauvegarde + garde de sortie (verrouille)

Affichage minimal attendu (barre d'etat ou zone persistante):
- `non enregistre`: des modifications locales existent.
- `enregistre`: derniere sauvegarde appliquee avec succes.
- `erreur`: la derniere tentative de sauvegarde a echoue.

Regles:
- toute action structurante (split/merge/couper/delier, changement metadonnees, actions batch) bascule l'etat a `non enregistre`;
- une sauvegarde reussie repasse a `enregistre` et horodate le statut;
- en cas d'erreur API/IO, l'etat passe a `erreur` + message actionnable.

Garde de sortie:
- si etat = `non enregistre`, afficher une confirmation avant quitter l'ecran/changer d'onglet;
- options: `Quitter sans enregistrer` / `Enregistrer puis quitter` / `Annuler`.

## 12) Politique de recalcul global (verrouillee)

Contexte:
- des retouches locales peuvent coexister avec un recalcul global de run.

Politique:
- par defaut, les segments marques `verrouilles` sont preserves;
- le recalcul global re-evalue d'abord les segments non verrouilles;
- si conflit detecte sur segment retouche manuellement:
  - mode standard: conserver la retouche manuelle et marquer `a revoir`;
  - mode force: autoriser l'ecrasement apres confirmation explicite.

UX attendue:
- bouton `Recalcul global` distinct des actions locales;
- resume de conflit apres run (`conserves`, `ecrases`, `a revoir`).

## 13) Contrat Export V2 (verrouille)

Entrees obligatoires:
- selection de documents (scope explicite),
- source des donnees (`documents`, `alignement`, `runs` selon export),
- format de sortie.

Formats "disponibles maintenant" (selon backend actuel):
- TEI,
- CSV/TSV (notamment alignement),
- JSONL/HTML (rapport run/QA).

Formats "a venir" (visibles mais non actifs):
- DOC/DOCX,
- XLSX.

Export multilingue (2-4 langues):
- entree: pivot + cibles selectionnees;
- sortie attendue: table alignee par segment (colonnes par langue/document) ou equivalent explicite selon format choisi.

## 14) Cloture checklist UX (maquettes) — 2026-03-06

Perimetre de validation:
- maquettes HTML `prototypes/visual-validation/prep/*` (pas de claim runtime Tauri).

Points verifies:
- etats vides/erreurs rendus explicitement dans `prep-actions-vnext.html` (document non selectionne, run interrompu, aucun alignement, sidecar/token indisponible);
- accessibilite de base: focus clavier visible ajoute sur toutes les pages `prep/` (regles `:focus-visible` homogènes);
- parcours bout-en-bout maquette valide via navigation/lien:
  - Importer -> Documents -> Actions -> Curation -> Segmentation -> Alignement -> Exporter.
- hook runtime en place (tauri-prep / Actions): bannière d'état session (`sidecar`, `busy`, `preview en attente`, `audit vide`, `prêt`).
- garde runtime inter-onglets en place:
  - confirmation de sortie si modifications en attente (`Actions` preview, `Documents` edition metadata/relation/bulk)
  - garde close/refresh via `beforeunload` sur l'onglet courant.

Commande de controle utilisee (liens maquettes):

```bash
for f in $(rg --files prototypes/visual-validation -g '*.html'); do \
  rg -o 'href=\"[^\"]+\"' "$f" >/dev/null; \
done
```
