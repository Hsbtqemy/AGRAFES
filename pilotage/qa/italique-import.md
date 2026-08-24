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

**Base de référence.** Les items nommant un document portent sur
`corpus_agrafes.WORKCOPY.db`, document **423 — `9-CI-OrEn-Obs-2022_Non Aligné.docx`** (en),
le seul du corpus qui porte du balisage : 4 unités, `n=1` en gras, `n=3`, `n=8` et `n=23`
en italique. Sur une autre base, remplacer par un document importé depuis un `.docx` dont
on a vérifié qu'il contient de l'italique.

**Pour les items « style de caractère »**, importer d'abord
`8-CI-TrEn-2022_A Aligner.docx` en mode *docx_paragraphs* : mesuré à **16 unités balisées
sur 28** après correctif, contre 3 avant. Un import qui n'en donnerait que 3 signale que
la barrière `_run_has_char_style` a cassé.

### Couche Rôles

- [ ] Document 423 : l'unité 1 (« Hypocrisy or a reason for hope?… ») s'affiche en gras
- [ ] Document 423, unité 8 et unité 23 : le mot « Observer » est en italique dans le fil de la phrase
- [ ] Aucune ligne n'affiche `<hi`, `rend=` ni `&lt;hi` en toutes lettres
- [ ] La recherche dans la liste trouve « Observer » sur les unités 8 et 23, malgré le balisage

### Couche Curation

- [ ] Document 423 : le balisage est rendu comme dans Rôles — même gras, même italique
- [ ] Document 423, unité 3 : la ligne affiche « The Observer, 14 Aug 2022 » avec **une seule** espace avant « 14 », et « The Observer » n'est **pas** en italique — la curation a corrigé ce texte, le verbatim d'import n'a plus le droit de s'afficher
- [ ] Un aperçu de curation qui modifierait une ligne italique n'efface pas son italique tant qu'on n'a pas appliqué
- [ ] Après application d'une règle sur une ligne italique, la ligne montre le texte curé, sans italique

### Couche Annotation

- [ ] Sur un document non annoté, l'italique s'affiche comme dans les autres couches
- [ ] Sur une unité annotée, la prose colorée par catégorie remplace le texte : l'italique n'y apparaît pas, et c'est voulu
- [ ] Une unité annotée puis corrigée au stylo porte « ⟳ texte modifié — à réannoter » et montre le texte corrigé

### Couche Segmentation

- [ ] Document 423 : l'italique et le gras sont rendus comme avant les trois lots (aucune régression)
- [ ] Le repli « voir l'original d'import » affiche bien le balisage de l'original, même sur une ligne dont le texte courant a été réécrit

### Stylo de correction

- [ ] Ouvrir ✎ sur l'unité 8 du document 423 : la textarea contient « Observer » en texte nu, sans `<hi rend="italic">`
- [ ] Enregistrer une correction sur cette unité : la ligne affiche le texte corrigé, l'italique disparaît
- [ ] Annuler la correction (undo Mode A) : le texte revient, et l'italique avec lui
- [ ] Corriger une ligne **sans** balisage n'a aucun effet visible sur son voisinage

### Métadonnées — aperçu rapide du contenu

- [ ] Le panneau « Aperçu rapide du contenu » rend l'italique du document 423
- [ ] Le ✎ de l'aperçu sème la textarea avec le texte nu, jamais avec le balisage
- [ ] L'unité 3 y affiche elle aussi le texte corrigé, pas le verbatim à double espace

### Import fraîchement corrigé (style de caractère)

- [ ] Importer `8-CI-TrEn-2022_A Aligner.docx` en *docx_paragraphs* : 16 unités portent du balisage sur les 28 (3 seulement = régression de la barrière)
- [ ] Les citations en italique du corps de l'article s'affichent en italique dans la couche Rôles
- [ ] Le texte cherché est inchangé : une recherche sur un mot situé dans un passage italique le trouve
- [ ] L'import d'un `.docx` sans aucune stylisation ne fait apparaître aucun balisage

### Non-régression sûreté

- [ ] Importer un `.txt` en *txt_numbered_lines* dont une ligne est `[1] <hi rend="italic">x</hi><script>alert(1)</script>` (le marqueur est obligatoire, c'est le seul mode texte) : la ligne s'affiche en toutes lettres, aucune boîte d'alerte, aucun texte en italique
- [ ] Le même fichier passé en couche Curation puis Annotation ne déclenche rien non plus
