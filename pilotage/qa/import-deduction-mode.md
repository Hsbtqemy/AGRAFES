---
passe: Import — le mode déduit du fichier
chantier: IMPO-01
duree: 30 min
derniere: 2026-08-27
---

# QA — l'écran décide du mode et dit pourquoi

Passe écrite le 27 août, **avant** de déclarer le lot fini. Elle valide le remplacement du
profil de lot par une déduction fichier par fichier : le mode posé, son **motif**, le compte
d’unités indexables, et ce que la file annonce avant qu'on appuie sur Importer.

**Le sidecar doit porter le contrat 1.6.80** (vérifié sur l'exe empaqueté le 27 août). Sans
lui la déduction ne peut pas lire `units_line` et chaque ligne resterait sur « analyse… ».

**Où ça se passe.** Écran **Importer**, désormais en **maître-détail** : à gauche la liste
des fichiers, à droite le panneau du fichier **sélectionné**. Le verdict s'affiche **sur la
ligne de chaque fichier**, sous son nom, dès qu'il est analysé — rien à déplier. Les
commandes du fichier (mode, colonne, langue, titre) vivent dans le panneau de droite. La
**langue par défaut** est passée dans la zone de dépôt, et le sélecteur de format du profil
de lot a disparu.

**Rien n'est à importer**, sauf à la dernière zone, qui le demande explicitement.

**Les huit cas, mesurés le 27 août sur les charges utiles réelles du binaire empaqueté.**
Chaque ligne dit ce que la ligne du fichier doit afficher.

| fichier | mode posé | motif attendu | compte |
|---|---|---|---|
| `testparagraphesAgrafes.docx` | Paragraphes | aucun marqueur | **17 indexables** |
| `2021_Texte1…Tableau.docx` *sans colonne* | Paragraphes | tableau de 2 colonnes | **rien d’indexable** |
| `2021_Texte1…Tableau.docx` *colonne 1* | Paragraphes | aucun marqueur | **48 indexables** |
| `Coe-House-AL_FR.docx` | Lignes numérotées [n] | marqueurs [n] détectés | *aucun* |
| `Houellebecq-Plateforme_FR.docx` | Lignes numérotées [n] | marqueurs [n] détectés | *aucun* |
| `Asimov-Foundation_FR_réaligné.odt` | Paragraphes | aucun marqueur | **1141 indexables** |
| `9_CI-TrFr-2021_Aligné_UTF8.txt` | TXT lignes [n] | seul mode TXT | **rien d’indexable** |
| `Asimov-Foundation_EN.txt` (`…EnEs-Aligné-TXT-utf8`) | TXT lignes [n] | marqueurs [n] détectés | **1683 indexables** |

**Pourquoi certaines lignes n'affichent aucun compte.** L'analyse ne lit le fichier **qu'une
fois**, en mode paragraphes. Quand elle en déduit le mode *numéroté*, elle sait que le document
sera indexable — les marqueurs sont là — sans connaître le compte de ce mode-là. Afficher un
nombre pris à l'autre mode serait un chiffre faux : on n'en donne aucun. C'est voulu, ce n'est
pas un trou.

**Les deux `.txt` sont un couple, et c'est délibéré.** La sonde d'un `.txt` est
`txt_numbered_lines`, le seul mode TXT — et ce mode **consomme** le marqueur, qui devient
l'`external_id` et disparaît du texte. Un `.txt` correctement numéroté n'affiche donc **aucun
marqueur** à la lecture, exactement comme un `.txt` qui n'en a jamais eu. Seul le compte les
sépare. C'est le défaut qu'une seconde passe adverse a trouvé : `Asimov-Foundation_EN.txt`
était déclaré « rien ne serait indexable » alors qu'il rend 1683 unités toutes indexables, et
195 autres `.txt` du disque étaient dans le même cas. Les deux lignes doivent donc être jouées
ensemble, sinon le trou se rouvre sans qu'on le voie.

**Les deux cas qui portent la passe.** `Houellebecq-Plateforme_FR.docx` est le piège : les deux
modes y rendent **1133 unités chacun**, et 1133 sur 1133 sont **différentes** — le mode numéroté
consomme `[4] ` et en fait l'ancre, le mode paragraphes le laisse collé au texte. Aucun compte
ne montre cette différence, seul le signal des marqueurs la voit. Et `testparagraphesAgrafes.docx`
est le cas de l'ancien défaut : importé en « Lignes numérotées [n] », il produisait 17 unités,
**0 indexée**, et l'application répondait `ok` sans un mot.

**Emplacement des fichiers.** `testparagraphesAgrafes.docx` est dans `Downloads`. Le bitexte en
tableau et le `.txt` sont sous `Downloads\OneDrive_2026-06-29\00-Hugo-Corpus Multilingues\CI-2021`
(dossiers `…-Tableau` et `…-Aligné`). `Coe-House` et `Houellebecq` sont sous
`Downloads\GRAFE-Lit-Aligne\…\Bitextes anglais-francais` et `…\Bitextes français-roumain` ;
l'`.odt` sous `…\GRAFE-Lit-EnFr-REAligné-DOCX`, et `Asimov-Foundation_EN.txt` sous
`…\Bitextes anglais-espagnol\GRAFE-Lit-EnEs-Aligné-TXT-utf8` — **pas** la variante `-ansi`
du dossier voisin, qui porte le même nom.

### Le verdict sur la ligne

- [x] Ajouter `testparagraphesAgrafes.docx` : sa ligne affiche brièvement **« analyse… »**, puis le verdict
- [x] Le verdict lu est **Paragraphes · 17 indexables · aucun marqueur — un paragraphe par unité**
- [x] Le sélecteur de mode de la ligne montre bien **Paragraphes**, pas « Lignes numérotées [n] »
- [x] Ajouter `Coe-House-AL_FR.docx` : le mode posé est **Lignes numérotées [n]**, motif **marqueurs [n] détectés**
- [ ] Le **verdict sur sa ligne**, à gauche, n'affiche **aucun compte** — pas « 1 », pas « 833 », rien. C'est voulu : l'analyse n'a lu le fichier qu'en mode paragraphes, elle ne connaît donc pas le compte du mode numéroté qu'elle vient de poser
- [ ] Le **tableau du panneau**, lui, les affiche tous les deux : **836 unités / 833 indexables** en Lignes numérotées, **1 / 1** en Paragraphes. C'est le contraste à vérifier — le verdict se tait là où il ne sait pas, le tableau parle là où il a mesuré
- [ ] Ajouter `Houellebecq-Plateforme_FR.docx` : même verdict, **Lignes numérotées [n]** — c'est le fichier où les deux modes rendent le même nombre d'unités
- [ ] Ajouter `Asimov-Foundation_FR_réaligné.odt` : **Paragraphes · 1141 indexables**, alors que le mode numéroté en annoncerait autant d'unités et 0 indexable

### Ce que l'écran refuse de deviner

- [ ] Ajouter `2021_Texte1…Tableau.docx` **sans colonne** : le verdict est orange et dit **« le texte est dans un tableau de 2 colonnes — indiquez la colonne à extraire »**
- [ ] Il dit aussi **« rien d’indexable »** — les deux informations coexistent, la seconde étant la conséquence de la première
- [ ] Saisir **1** dans le champ **Colonne** du panneau : le verdict de la ligne redevient vert, **48 indexables**, et la mention de colonne disparaît
- [ ] Effacer la colonne : le verdict redemande la colonne — il ne reste pas sur l'ancien état
- [ ] Ajouter `9_CI-TrFr-2021_Aligné_UTF8.txt` : verdict **rouge**, **« rien d’indexable »**, motif disant que c'est le **seul mode TXT**
- [ ] Ajouter `Asimov-Foundation_EN.txt` : verdict **vert**, **1683 indexables**, motif **marqueurs [n] détectés** — alors que son aperçu n'en montre aucun, le mode les ayant consommés
- [ ] Les deux `.txt` sont côte à côte dans la liste et portent des verdicts **opposés** : c'est ce contraste qui protège du défaut trouvé le 27 août
- [ ] Aucun de ces fichiers n'est passé en statut « erreur » : ils restent **en attente**, importables si on insiste

### Ce que la file annonce avant d'importer

- [ ] Avec le `.txt` et le tableau sans colonne dans la liste, un bandeau **au-dessus** des lignes compte ce qui cloche
- [ ] Il nomme **séparément** les fichiers sans unité indexable et ceux qui attendent une colonne
- [ ] Le bandeau est **rouge** dès qu'un fichier n'aurait rien d’indexable, **orange** s'il n'y a que des colonnes en attente
- [ ] Retirer le `.txt` : le bandeau se met à jour, et disparaît quand plus rien ne cloche

### Le choix reste possible, et il se voit

- [ ] Sélectionner `Coe-House-AL_FR.docx` et changer son mode pour **Paragraphes** dans le sélecteur **Mode d'import** du panneau
- [ ] Le verdict ne dit **plus** « marqueurs [n] détectés » — ce motif justifiait le mode qu'on vient d'écarter — mais **« choisi à la main — la lecture du fichier proposait « Lignes numérotées [n] » »**
- [ ] Il n'affiche plus de compte non plus : celui qu'on avait était mesuré sur l'autre mode
- [ ] Sur le bitexte en tableau **sans colonne**, changer le mode à la main : le motif dit « choisi à la main » **et** continue de réclamer la colonne — l'information ne disparaît pas parce qu'on a touché au mode
- [ ] Le tableau comparatif du panneau marque **recommandé** sur **Lignes numérotées [n]**, et le ✓ sur Paragraphes — l'écran montre le désaccord au lieu de le masquer
- [ ] Cliquer **Lignes numérotées [n]** dans le tableau : la ligne suit, et le verdict retrouve son motif d'origine

### Le lot n'impose plus de format

- [ ] La **zone de dépôt** porte un champ **« Langue par défaut »** et un bouton **« Appliquer »** ; il n'y a **aucun** sélecteur de format nulle part hors du panneau
- [ ] Le survol du bouton **« Appliquer »** dit que le mode d'import, lui, est déduit de chaque fichier
- [ ] Changer la langue par défaut puis **« Appliquer »** change la **langue** de chaque fichier en attente et **laisse les modes intacts**
- [ ] Ajouter plusieurs fichiers d'un coup (une dizaine) : chaque ligne passe par « analyse… » puis reçoit son verdict, l'une après l'autre, sans figer l'écran

### Après l'import

- [ ] Importer `testparagraphesAgrafes.docx` tel que l'écran le propose : le journal dit **« ✓ … · 17 unité(s) indexable(s) · réindexez pour la recherche. »**
- [ ] Forcer le mode **Lignes numérotées [n]** sur un second exemplaire du même fichier, puis importer : le journal sort une ligne d'**erreur** disant **« ⚠ AUCUNE unité indexable à la recherche »**
- [ ] Ce second import n'est pas refusé — il est **dit**. Vérifier que le document est bien en base, et que la recherche ne le trouve pas
