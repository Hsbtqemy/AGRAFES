---
passe: Italique et stylisation inline
chantier: RICH-01
duree: 20 min
derniere: 2026-08-24
---

# QA — l'italique de l'import à l'écran

Passe écrite après les trois lots du 24 août (`0806c66`, `b5491e5`, `4d21d69`). Elle
couvre ce qui se **voit** : le balisage rendu là où il doit l'être, le texte corrigé qui
prime sur le verbatim périmé, et l'absence de balises en toutes lettres.

Elle ne couvre pas l'aller-retour TEI, qui est un reste de chantier et non un défaut de
rendu.

**Le document de référence** — `9-CI-OrEn-Obs-2022_Non Aligné.docx` (anglais), à choisir
par ce nom dans le sélecteur de documents. C'est le seul du corpus de travail qui porte du
balisage : 4 unités, la **n° 1** en gras, les **n° 3, 8 et 23** en italique. Le numéro
d'unité est celui affiché en tête de ligne dans le canvas. Sur une autre base, remplacer
par un document importé depuis un `.docx` dont on a vérifié qu'il contient de l'italique.

*(Pour une requête en base plutôt qu'à l'écran : `doc_id` 423 de
`corpus_agrafes.WORKCOPY.db`, unités 245580, 245582, 245587 et 245602.)*

**Le document d'import** — `8-CI-TrEn-2022_A Aligner.docx`, pour les items « style de
caractère » : importé en **DOCX paragraphes**, il donne **16 unités balisées sur 28**
après correctif, contre 3 avant. Un import qui n'en donnerait que 3 signale que la
barrière `_run_has_char_style` a cassé.

**Choisir le mode à la main.** Pour un `.docx`, le mode proposé par défaut est *lignes
numérotées [n]* ; ce fichier n'a aucun marqueur, donc ce mode range ses 28 paragraphes
en unités `structure`, qui ne sont **pas indexées** en FTS. Le balisage, lui, survit —
les 16 unités sont bien là — mais le document est invisible au concordancier, et rien
à l'import ne le signale (constaté le 25 août 2026 sur le `doc_id` 424).

### Couche Rôles

- [x] L'unité n° 1 (« Hypocrisy or a reason for hope?… ») s'affiche en gras
- [x] Unités n° 8 et n° 23 : le mot « Observer » est en italique dans le fil de la phrase
- [x] Aucune ligne n'affiche `<hi`, `rend=` ni `&lt;hi` en toutes lettres
- [x] La recherche dans la liste trouve « Observer » sur les unités n° 8 et n° 23, malgré le balisage

### Couche Curation

- [x] Le balisage est rendu comme dans Rôles — même gras, même italique
- [x] Unité n° 3 : la ligne affiche « The Observer, 14 Aug 2022 » avec **une seule** espace avant « 14 », et « The Observer » n'est **pas** en italique — la curation a corrigé ce texte, le verbatim d'import n'a plus le droit de s'afficher
- [x] Un aperçu de curation qui modifierait une ligne italique n'efface pas son italique tant qu'on n'a pas appliqué
- [x] Après application d'une règle sur une ligne italique, la ligne montre le texte curé, sans italique

### Couche Annotation

- [ ] Sur un document non annoté, l'italique s'affiche comme dans les autres couches
- [x] Sur une unité annotée, la prose colorée par catégorie remplace le texte : l'italique n'y apparaît pas, et c'est voulu
- [x] Une unité annotée puis corrigée au stylo porte « ⟳ texte modifié — à réannoter » et montre le texte corrigé

### Couche Segmentation

- [x] L'italique et le gras sont rendus comme avant les trois lots (aucune régression)
- [x] Le repli « voir l'original d'import » affiche bien le balisage de l'original, même sur une ligne dont le texte courant a été réécrit

### Stylo de correction

- [x] Ouvrir ✎ sur l'unité n° 8 : la textarea contient « Observer » en texte nu, sans `<hi rend="italic">`
- [x] Enregistrer une correction sur cette unité : la ligne affiche le texte corrigé, l'italique disparaît
- [x] Annuler la correction (undo Mode A) : le texte revient, et l'italique avec lui
- [x] Corriger une ligne **sans** balisage n'a aucun effet visible sur son voisinage

### Métadonnées — aperçu rapide du contenu

- [x] Le panneau « Aperçu rapide du contenu » rend l'italique du document de référence
- [x] Le ✎ de l'aperçu sème la textarea avec le texte nu, jamais avec le balisage
- [x] L'unité n° 3 y affiche elle aussi le texte corrigé, pas le verbatim à double espace

### Import fraîchement corrigé (style de caractère)

- [x] `8-CI-TrEn-2022_A Aligner.docx` importé en *docx_paragraphs* : 16 unités portent du balisage sur les 28 (3 seulement = régression de la barrière)
- [x] Les citations en italique du corps de l'article s'affichent en italique dans la couche Rôles
- [x] Le texte cherché est inchangé : dans la recherche de la couche, un mot situé dans un passage italique retrouve son unité
- [x] L'import d'un `.docx` sans aucune stylisation ne fait apparaître aucun balisage
- [ ] Les 28 unités sont de type `line` — toutes en `structure` = l'import s'est fait en *lignes numérotées*, refaire en *DOCX paragraphes*
- [ ] Dans le concordancier, une recherche sur un mot d'un passage italique trouve l'unité — suppose des unités `line`, les `structure` ne sont pas indexées

### Non-régression sûreté

- [ ] Importer un `.txt` en *txt_numbered_lines* dont une ligne est `[1] <hi rend="italic">x</hi><script>alert(1)</script>` (le marqueur est obligatoire, c'est le seul mode texte) : la ligne s'affiche en toutes lettres, aucune boîte d'alerte, aucun texte en italique
- [ ] Le même fichier passé en couche Curation puis Annotation ne déclenche rien non plus
