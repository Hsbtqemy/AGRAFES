---
passe: Retour en arrière — le geste
chantier: NAV-01
duree: 12 min
derniere: —
---

# QA — le retour en arrière au bouton de souris

Ce que la passe vérifie : que le bouton latéral « précédent » ramène à l'écran d'où l'on
vient, à travers les quatre niveaux de navigation, et qu'il ne détruit rien en chemin. La
pile elle-même est couverte par 20 tests unitaires (`navHistory.test.ts`) ; ce qui ne peut
pas l'être, c'est l'enchaînement réel — un module qui se remonte, un canvas qui recharge,
une confirmation qui s'affiche au bon endroit.

Toutes les cases ci-dessous doivent pouvoir être cochées. Aucune n'encode un résultat
contraire : c'est une vérification, pas une mesure.

**Lancer.** `npm --prefix tauri-shell run tauri -- dev`, sur une base qui contient au moins
un document segmenté et une famille alignée. Il faut une souris à boutons latéraux — le
glissé du pad ne fait rien, et c'est normal tant que le lot 2b n'est pas posé.

**Le geste** : le bouton latéral « précédent » (celui du pouce, côté arrière). Le bouton
« suivant » refait le chemin en avant. Rien à installer, aucune console à ouvrir.

**Ce qui n'est volontairement pas restauré** : le document ouvert. La pile retient l'écran,
l'onglet, la sous-vue et la couche du canvas — pas quel document était focalisé. Revenir sur
la couche Segmentation ramène donc à la couche, avec le document courant. C'est le périmètre
décidé au cadrage du lot, pas un défaut à signaler.

### Le geste, à travers les quatre niveaux

- [ ] Depuis Constituer, aller dans Explorer puis appuyer sur « précédent » : on revient à Constituer
- [ ] Enchaîner trois onglets de Prep (Importer → Documents → Actions) puis trois appuis : on repasse par chacun, dans l'ordre inverse
- [ ] Dans Actions, ouvrir la matrice puis revenir : on retrouve la sous-vue précédente, pas le hub par défaut
- [ ] Au canvas, passer de Rôles à Curation puis à Annotation, et deux appuis : on retraverse Curation puis Rôles
- [ ] Depuis la matrice, ouvrir la couche Segmentation d'un document par le clic de l'en-tête de langue, puis un appui : on revient à la matrice
- [ ] Le bouton « suivant » refait le chemin en avant, écran par écran

### Le geste involontaire pendant une édition

- [ ] Dans Documents, modifier un champ de métadonnée sans enregistrer, puis appuyer sur « précédent » : une confirmation apparaît et **l'écran ne bouge pas**
- [ ] Répondre « Continuer » à cette confirmation : le retour s'effectue alors
- [ ] Refuser la confirmation : on reste sur Documents, et la saisie en cours est intacte
- [ ] Après un refus, un nouvel appui sur « précédent » repose la question au lieu de partir sans demander

### À l'ouverture et aux bords

- [ ] Rouvrir l'application : elle s'ouvre sur le mode quitté, et un premier appui sur « précédent » ne l'éjecte nulle part
- [ ] Appuyer six ou sept fois d'affilée sur « précédent » : on remonte jusqu'au premier écran de la session et l'application reste vivante — jamais de page blanche ni de fermeture
- [ ] Cliquer dix fois le même onglet déjà actif, puis un appui : on revient à l'écran précédent d'un seul cran, pas après dix appuis

### Ce qui ne doit pas bouger

- [ ] Les raccourcis `Ctrl+1/2/3/0` sautent toujours d'un mode à l'autre, et le geste les remonte comme le reste
- [ ] Le défilement horizontal de la matrice au pad fonctionne normalement et ne déclenche aucun retour
- [ ] Un travail long (import, indexation) lancé puis un retour : le Job Center continue d'afficher sa progression
- [ ] Changer de base pendant la session, puis un appui : rien ne rouvre l'ancienne base
