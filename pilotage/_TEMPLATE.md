# Gabarits `pilotage/`

Deux natures différentes, à ne pas mélanger.

- **Le chantier** (`pilotage/<CODE>.md`) porte un **état** : ce qui reste à faire. On coche
  une fois, l'item disparaît.
- **La passe de QA** (`pilotage/qa/<nom>.md`) porte une **procédure rejouable** : on la
  relance à chaque fois qu'on veut revérifier. On la décoche et on recommence.

C'est la même distinction qui rend `docs/RELEASE_CHECKLIST.md` incochable en place : un
gabarit n'est pas un état.

---

## Gabarit 1 — le chantier

Un fichier par chantier interrompu, nommé d'après son code : `pilotage/R6.md`.

```markdown
---
chantier: R6
statut: interrompu
audit: docs/AUDIT_2026-06-28.md
---

# R6 — paragraphes manuels

**Arrêté sur** — geste ¶ par-segment (matrice + Tours), commit `be36385`, 23 juillet.

## Reste

- [ ] R3.4 endgame — trancher le sort du microscope optionnel
- [ ] Vérifier la propagation ¶ sur les segments hérités (D-P10)
- [x] Bump engine + shell 0.3.3 → 0.4.0

## QA

- qa/parag-manuels.md
- qa/a11y-ecrans-prep.md

## Contexte

Prose libre. Ce que je me raconterai dans trois semaines. Rien ici n'est lu par
l'outil — écris ce que tu veux, aussi long que nécessaire.

Décisions applicables : D-P10, D-W13 (voir DESIGN_alignment_workspace.md).
Collision connue : R5 partage 25 fichiers, dont sidecar.py et coarse_grain.py.
```

La section `## QA` ne contient pas les points : elle **pointe** vers les passes. Un
chantier peut en avoir plusieurs, et une même passe peut servir plusieurs chantiers.

---

## Gabarit 2 — la passe de QA

Un fichier par passe, dans `pilotage/qa/`.

```markdown
---
passe: Paragraphes manuels
chantier: R6
duree: 8 min
derniere: 2026-08-17
---

# QA — geste ¶ par-segment

Contexte de la passe, ce qu'elle couvre, ce qu'elle ne couvre pas. Prose libre.

### Matrice

- [ ] Le geste ¶ apparaît au survol d'un segment, pas au clic
- [ ] Un ¶ posé survit à un changement d'onglet
- [ ] Retirer un ¶ ne casse pas l'ancrage amont

### Tours

- [ ] Le ¶ se propage aux segments hérités
- [ ] L'indicateur de paragraphe reste lisible en mode compact

### Responsive

- [ ] Sur 375px, la barre de segment ne masque pas le geste
```

`chantier:` vaut le code du chantier, ou `—` pour une passe transversale (une passe
d'accessibilité sur tous les écrans, par exemple). Les passes transversales apparaissent
à part sur l'écran d'accueil, sous leur propre entrée.

**Les H3 sont le seul niveau de regroupement.** Une zone, un écran, un thème — un seul
niveau, et par titre plutôt que par indentation. Une sous-liste indentée est ambiguë :
cocher le parent coche-t-il les enfants ? Un titre ne pose pas la question.

---

## Rejouer une passe

1. Cocher au fur et à mesure ; la page réécrit le markdown.
2. Commiter le résultat — **la passe est archivée**, le commit porte la date et le score.
3. Passe suivante : le bouton *réinitialiser* décoche tout et met à jour `derniere:`.

L'historique des passes est donc `git log -- pilotage/qa/<nom>.md`. Rien à archiver à la
main, et le gabarit n'est jamais détruit puisqu'il se régénère à chaque réinitialisation.

---

## Le contrat de parsing

Ce que l'outil lit, et rien d'autre.

**Fichier de chantier**

| Élément | Règle | Si absent |
|---|---|---|
| `chantier:` | Le code, tel qu'il apparaît dans les sujets de commit | Fichier ignoré |
| `statut:` | `interrompu` · `clos` · `livré` | Traité comme `interrompu` |
| `audit:` | Chemin d'un `AUDIT_*.md` ou `REVIEW_*.md` | Pas de lien vers l'audit |
| `# Titre` | Premier H1 | Le code sert de titre |
| `**Arrêté sur**` | La ligne entière après le tiret | Ligne omise à l'écran |
| `## Reste` | Cases à cocher, une par ligne | Section absente de l'écran |
| `## QA` | Chemins de passes, un par ligne | Aucune passe rattachée |

**Fichier de passe**

| Élément | Règle | Si absent |
|---|---|---|
| `passe:` | Nom affiché | Le nom de fichier sert de nom |
| `chantier:` | Un code, ou `—` pour transversale | Traitée comme transversale |
| `duree:` | Indicatif, affiché tel quel | Non affiché |
| `derniere:` | Date de la dernière réinitialisation | Non affiché |
| `### Zone` | Regroupe les cases qui suivent | Cases regroupées sous « Général » |

**Quatre règles strictes :**

1. Les noms de section sont exactement `## Reste`, `## QA`, et les H3 de zone. Pas de
   variante, pas d'emoji, pas de compteur dans le titre.
2. Les cases à cocher n'existent que sous `## Reste` (fichier de chantier) et sous un H3
   (fichier de passe). Ailleurs, elles ne sont ni comptées ni cochables.
3. Une case = une ligne = une affirmation vérifiable. Pas d'indentation.
4. Tout le reste est libre et ne sera jamais interprété.
