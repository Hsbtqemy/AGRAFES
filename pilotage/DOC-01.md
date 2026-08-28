---
chantier: DOC-01
statut: à venir
---

# DOC-01 — la page Documents et l'affichage des métadonnées

**Ouvert le 28 août 2026**, en jouant la passe ShareDocs : l'item qui demandait de
vérifier la provenance d'un document importé n'était pas jouable. `source_path` existait
en base et dans l'API, mais n'était rendu **nulle part** — son seul usage côté front était
le pré-contrôle des doublons de l'écran d'import. Il s'affiche depuis, en pied du panneau
d'édition. Le geste a surtout montré que la question dépassait ce champ.

## Reste

- [ ] **Trois colonnes de `documents` ne sont nommées nulle part dans l'écran** — mesuré
      le 28 août en confrontant les 22 colonnes de la table au code de `MetadataScreen` :
      `created_at`, `text_start_n`, `source_hash`. `source_path` était la quatrième,
      corrigée le jour même. La **date d'entrée dans le corpus** n'est donc pas
      consultable, et la **borne de début de texte** — qui dit où s'arrête le paratexte,
      que la curation et le canvas manipulent — ne se lit que dans les écrans qui
      l'écrivent. Trancher pour chacune : à afficher, ou délibérément interne.
      `source_hash` appartient plausiblement au second groupe, mais alors « pourquoi ce
      fichier est-il un doublon ? » reste sans réponse à l'écran
- [ ] **Le panneau est une suite plate de champs** — titre, langue, rôle, type, champs
      hérités, statut de workflow, run de validation, notes, date de validation,
      provenance, six boutons, puis le panneau de familles et les relations
      documentaires. Rien n'y sépare ce qui **identifie l'œuvre**, ce qui **décrit le
      fichier** et ce qui relève du **suivi de travail**. À reprendre comme une
      hiérarchie, pas comme un formulaire qui s'allonge
- [ ] **Ce que la table doit porter, et ce qui appartient au panneau** — la table est le
      seul endroit qui montre plusieurs documents à la fois ; c'est donc là que se
      comparent langue, rôle, avancement. Le partage entre les deux n'a jamais été
      décidé : il s'est sédimenté au fil des ajouts
- [ ] **Reprendre `U-02` là où il s'est arrêté** — `MetadataScreen.ts` a perdu 32 % dans
      la campagne #125-128, mais deux troncs entrelacés ont été laissés, dont
      « Exceptions Admin » qui mute l'état cœur. Toute refonte de l'affichage les
      rencontrera

## Contexte

**Ce qui a déclenché.** Un corpus qui mélange des documents venus du disque et de
ShareDocs ne permettait pas de savoir lequel était lequel — alors que c'est la distinction
dont dépend le geste que l'écran d'import conseille lui-même : « importez ce fichier
localement » suppose qu'on sache d'où vient ce qu'on regarde. Voir `SD-01` et `IMPU-01`.

**La méthode qui a trouvé le trou est réutilisable**, et c'est elle qu'il faut rejouer au
début du chantier plutôt que de partir d'une intention : confronter les colonnes de la
table `documents` à ce que le code de l'écran nomme. Quatre silences sur vingt-deux
colonnes, dont aucun n'était connu avant la mesure.
