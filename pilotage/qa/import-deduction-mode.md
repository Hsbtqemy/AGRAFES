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
| `Houellebecq-Plateforme_FR.docx` (**FrRo** — voir l'avertissement) | Lignes numérotées [n] | marqueurs [n] détectés | *aucun* |
| `Asimov-Foundation_FR_réaligné.odt` | Paragraphes | aucun marqueur | **1141 indexables** |
| `9_CI-TrFr-2021_Aligné_UTF8.txt` | TXT lignes [n] | seul mode TXT | **rien d’indexable** |
| `Asimov-Foundation_EN.txt` (`…EnEs-Aligné-TXT-utf8`) | TXT lignes [n] | marqueurs [n] détectés | **1683 indexables** |

**Pourquoi certaines lignes n'affichent aucun compte.** L'analyse ne lit le fichier **qu'une
fois**, en mode paragraphes. Quand elle en déduit le mode *numéroté*, elle sait que le document
sera indexable — les marqueurs sont là — sans connaître le compte de ce mode-là. Afficher un
nombre pris à l'autre mode serait un chiffre faux : on n'en donne aucun. C'est voulu, ce n'est
pas un trou.

**Les deux `.txt` sont un couple, et c'est délibéré.** Ils sont là parce que dans les deux
cas **le seul signal des marqueurs induirait en erreur**, en sens inverse l'un de l'autre.

Sur `Asimov-Foundation_EN.txt`, les marqueurs existent mais **ont été mangés** : la sonde d'un
`.txt` est `txt_numbered_lines`, le seul mode TXT, et ce mode consomme le `[n]` pour en faire
l'`external_id`. Le détecteur ne voit donc **aucun** marqueur sur un fichier qui en porte 1683 —
et c'est exactement ce qui l'a fait déclarer « rien ne serait indexable » avant le correctif du
27 août, lui et 195 autres `.txt` du disque. Ce qui le sauve est le **compte** d'unités `line`,
seule preuve restante que les marqueurs existaient.

Sur `9_CI-TrFr-2021_Aligné_UTF8.txt`, c'est l'inverse : le marqueur est **bien visible**
(« 1. Texte 9 »), mais aucun mode ne sait le consommer, donc tout entre en `structure` et rien
n'est indexable. Un marqueur présent n'est pas un marqueur utile.

Les deux lignes doivent donc être jouées ensemble : c'est leur contraste qui prouve que le
verdict suit le compte et non l'apparence du texte.

**⚠ Trois fichiers portent le nom `Houellebecq-Plateforme_FR.docx`, et ils diffèrent.**
Mesuré le 28 août — `GRAFE-Lit-FrRo-Aligné-DOCX` rend **1133 / 1133**, `GRAFE-Lit-FrEn-Aligné-DOCX`
**1129 / 1**, et `Bitextes francais-espagnol/DOCX` **1171 / 1**. Les deux derniers sont des
**blobs** : tout le texte dans un seul paragraphe, marqueurs séparés par des sauts de ligne
doux. La passe veut le **FrRo**, le seul qui mette un paragraphe par ligne. Le *verdict* est le
même sur les trois — les marqueurs sont là — mais seul le FrRo montre l'égalité des totaux.
Même piège que le couple `-utf8` / `-ansi` d'`Asimov-Foundation_EN.txt`.

**Les deux cas qui portent la passe.** `Houellebecq-Plateforme_FR.docx` (**FrRo**) est le
piège : les deux modes y rendent **1133 unités chacun**, et 1133 sur 1133 sont **différentes** —
le mode numéroté consomme `[4] ` et en fait l'ancre, le mode paragraphes le laisse collé au
texte. Aucun compte ne montre cette différence, seul le signal des marqueurs la voit. Et `testparagraphesAgrafes.docx`
est le cas de l'ancien défaut : importé en « Lignes numérotées [n] », il produisait 17 unités,
**0 indexée**, et l'application répondait `ok` sans un mot.

**Emplacement des fichiers.** `testparagraphesAgrafes.docx` est dans `Downloads`. Le bitexte en
tableau et le `.txt` sont sous `Downloads\OneDrive_2026-06-29\00-Hugo-Corpus Multilingues\CI-2021`
(dossiers `…-Tableau` et `…-Aligné`). `Coe-House` et `Houellebecq` sont sous
`Downloads\GRAFE-Lit-Aligne\…\Bitextes anglais-francais` et `…\Bitextes français-roumain` ;
l'`.odt` sous `…\GRAFE-Lit-EnFr-REAligné-DOCX`, et `Asimov-Foundation_EN.txt` sous
`…\Bitextes anglais-espagnol\GRAFE-Lit-EnEs-Aligné-TXT-utf8`.

**⚠ Quatre fichiers portent le nom `Asimov-Foundation_EN.txt`.** Mesuré le 28 août : les deux
du dossier **anglais-espagnol** rendent **1683** unités, les deux du dossier
**anglais-français** en rendent **1304**. C'est cet axe-là qui compte — `-utf8` et `-ansi`
donnent le même compte, l'encodage étant détecté à la lecture. Si vous lisez 1304, vous avez
pris le dossier français.

### Le verdict sur la ligne

- [x] Ajouter `testparagraphesAgrafes.docx` : sa ligne affiche brièvement **« analyse… »**, puis le verdict
- [x] Le panneau de droite **bascule tout seul** sur ce fichier — un ajout unique se sélectionne, parce qu'ajouter un fichier c'est demander ce que l'application en fait
- [x] Le verdict lu est **Paragraphes · 17 indexables · aucun marqueur — un paragraphe par unité**
- [x] Le sélecteur de mode de la ligne montre bien **Paragraphes**, pas « Lignes numérotées [n] »
- [x] Ajouter `Coe-House-AL_FR.docx` : le mode posé est **Lignes numérotées [n]**, motif **marqueurs [n] détectés**
- [x] Le **verdict sur sa ligne**, à gauche, n'affiche **aucun compte** — pas « 1 », pas « 833 », rien. C'est voulu : l'analyse n'a lu le fichier qu'en mode paragraphes, elle ne connaît donc pas le compte du mode numéroté qu'elle vient de poser
- [x] Le **tableau du panneau**, lui, les affiche tous les deux : **836 unités / 833 indexables** en Lignes numérotées, **1 / 1** en Paragraphes. C'est le contraste à vérifier — le verdict se tait là où il ne sait pas, le tableau parle là où il a mesuré
- [x] Ajouter `Houellebecq-Plateforme_FR.docx` **du dossier `GRAFE-Lit-FrRo-Aligné-DOCX`** (trois fichiers portent ce nom, voir l'avertissement) : même verdict, **Lignes numérotées [n]**
- [x] Son tableau du panneau annonce **1133 unités des deux côtés** — 1133 indexables en numéroté, 1133 aussi en paragraphes. C'est le seul fichier de la passe où le total ne sépare rien, et c'est là que le comptage seul choisirait à pile ou face
- [x] Ajouter `Asimov-Foundation_FR_réaligné.odt` : **Paragraphes · 1141 indexables**, alors que le mode numéroté en annoncerait autant d'unités et 0 indexable

### Ce que l'écran refuse de deviner

- [x] Ajouter `2021_Texte1…Tableau.docx` **sans colonne** : le verdict est orange et dit **« le texte est dans un tableau de 2 colonnes — indiquez la colonne à extraire »**
- [x] Il dit aussi **« rien d’indexable »** — les deux informations coexistent, la seconde étant la conséquence de la première
- [x] Saisir **1** dans le champ **Colonne** du panneau : le verdict de la ligne redevient vert, **48 indexables**, et la mention de colonne disparaît
- [x] Effacer la colonne : le verdict redemande la colonne — il ne reste pas sur l'ancien état
- [x] Ajouter `9_CI-TrFr-2021_Aligné_UTF8.txt` : verdict **rouge**, **« rien d’indexable »**, motif disant que c'est le **seul mode TXT**
- [x] Ajouter `Asimov-Foundation_EN.txt` : verdict **vert**, **1683 indexables**, motif **marqueurs [n] détectés**
- [x] Son aperçu est **plein** — c'est normal — mais **aucun `[n]` n'y figure** : le mode les a consommés. La colonne *ID* commence à **4** (puis 5, 6, 7) et la colonne texte démarre directement sur « Isaac Asimov, Foundation and Earth… », sans préfixe
- [x] Comparer les deux `.txt` ligne à ligne dans leur aperçu : sur Asimov la colonne *ID* est remplie (4, 5, 6…), le *Type* est `line`, et le texte n'a pas de marqueur ; sur `9_CI-TrFr` l'*ID* est **—**, le *Type* est `structure`, et le marqueur « 1. » est **bien visible** dans le texte. Deux aperçus qui ne se ressemblent pas, pour deux verdicts opposés
- [x] Les deux `.txt` sont côte à côte dans la liste et portent des verdicts **opposés** : c'est ce contraste qui protège du défaut trouvé le 27 août
- [x] Aucun de ces fichiers n'est passé en statut « erreur » : ils restent **en attente**, importables si on insiste

### Ce que la file annonce avant d'importer

- [x] Avec le `.txt` et le tableau sans colonne dans la liste, un bandeau **au-dessus** des lignes compte ce qui cloche
- [x] Ajouter assez de fichiers pour faire **défiler** la liste, puis défiler : le bandeau **ne bouge pas** — il vit hors de la zone qui défile, sans quoi il disparaîtrait au moment où il sert
- [x] Il nomme **séparément** chaque nature de problème, et **seulement celles qui s'appliquent** — avec les fichiers de cette passe on lit « … attendent une colonne de tableau ; … n'aurait aucune unité indexable », sans mention des catégories vides
- [x] Changer le mode à la main d'un fichier **sans numérotation** (`testparagraphesAgrafes.docx`) : sa ligne passe à l'orange « choisi à la main », mais le bandeau **ne le compte pas** — il rapporte ce que l'application a trouvé, pas ce que vous avez décidé, et surtout il ne prétend pas qu'un fichier sans numérotation perdrait la sienne
- [x] Le bandeau est **rouge** dès qu'un fichier n'aurait rien d’indexable, **orange** s'il n'y a que des colonnes en attente
- [x] Retirer le `.txt` : le bandeau se met à jour, et disparaît quand plus rien ne cloche
- [x] **Vider** la liste : le bandeau de la file **et** celui des familles détectées disparaissent tous les deux — aucun ne doit survivre à la liste qu'il décrit
- [x] Retirer un fichier d'une paire détectée : le bandeau des familles se recalcule au lieu de rester sur l'ancienne paire

### Le choix reste possible, et il se voit

- [x] Sélectionner `Coe-House-AL_FR.docx` et changer son mode pour **Paragraphes** dans le sélecteur **Mode d'import** du panneau
- [x] Le verdict ne dit **plus** « marqueurs [n] détectés » — ce motif justifiait le mode qu'on vient d'écarter — mais **« choisi à la main — la lecture du fichier proposait « Lignes numérotées [n] » »**
- [x] Il n'affiche plus de compte non plus : celui qu'on avait était mesuré sur l'autre mode
- [x] Sur le bitexte en tableau **sans colonne**, changer le mode à la main : le motif dit « choisi à la main » **et** continue de réclamer la colonne — l'information ne disparaît pas parce qu'on a touché au mode
- [x] Revenir sur `Coe-House-AL_FR.docx` (le point précédent a changé de fichier) et descendre au **tableau comparatif** du panneau (« Ce que chaque mode ferait de ce fichier ») : deux marques y coexistent, et **sur deux lignes différentes** — le ✓ est passé devant **Paragraphes**, le mode que vous venez de choisir, tandis que l'étiquette **recommandé** est restée sur **Lignes numérotées [n]**, celui que la lecture du fichier proposait
- [x] Les deux ne disent pas la même chose et n'ont pas à se rejoindre : le ✓ suit le choix, l'étiquette ne bouge pas. Une recommandation qui se réalignerait sur ce qu'on vient de décider donnerait raison à tout choix, et on ne saurait plus vers quoi revenir
- [x] Cliquer **Lignes numérotées [n]** dans le tableau : la ligne suit, et le verdict retrouve son motif d'origine

### Le lot n'impose plus de format

- [x] La **zone de dépôt** porte un champ **« Langue par défaut »** et un bouton **« Appliquer »** ; il n'y a **aucun** sélecteur de format nulle part hors du panneau
- [x] Le survol du bouton **« Appliquer »** dit que le mode d'import, lui, est déduit de chaque fichier
- [x] Mettre `en` en langue par défaut puis **« Appliquer »** : `testparagraphesAgrafes.docx` passe à `en`, son nom ne portant aucun code de langue
- [x] `Coe-House-AL_FR.docx`, lui, **reste à `fr`** — et c'est voulu : un code écrit dans le nom (`_FR`) prime sur le défaut. La règle n'est écrite **nulle part dans l'écran**, seulement dans l'infobulle du bouton
- [x] Conséquence à vérifier sur un lot entièrement issu de `GRAFE-Lit-Aligne` : **aucune** langue ne change, ces 298 fichiers portant tous leur code — et le journal annonce quand même un succès sur tous les fichiers en attente. C'est un défaut connu, consigné dans IMPO-01, pas un échec de la passe
- [x] Dans les deux cas le **mode d'import ne bouge pas**, y compris celui qu'on venait de choisir à la main : le bouton ne touche plus qu'à la langue
- [x] Ajouter plusieurs fichiers d'un coup (une dizaine) : chaque ligne passe par « analyse… » puis reçoit son verdict, l'une après l'autre, sans figer l'écran
- [x] Sur ce lot, la sélection du panneau **ne bouge pas** : sauter au dernier des dix déplacerait l'affichage sous les yeux de quelqu'un qui regardait autre chose

### Après l'import

- [x] **Ouvrir le journal d'abord** : bouton **📋 Journal** dans la barre du haut, qui fait glisser un tiroir depuis la droite. C'est le **seul** endroit où l'import rend ses comptes, et il est **fermé par défaut**
- [x] Importer `testparagraphesAgrafes.docx` tel que l'écran le propose : le journal dit **« ✓ "testparagraphesAgrafes" → doc_id N · 17 unité(s) indexable(s) · réindexez pour la recherche. »** — les 17 sont mesurées, `docx_paragraphs` rend 17 unités `line` sur ce fichier
- [x] Forcer le mode **Lignes numérotées [n]** sur un second exemplaire du même fichier, puis importer : la ligne du journal passe en **rouge** et dit **« · ⚠ AUCUNE unité indexable · réindexez pour la recherche. »** — le même fichier, 17 unités `structure`, aucune indexable
- [x] Pendant ce temps l'écran, lui, dit le contraire : la bulle verte annonce **« ✓ Importé: … »** sans aucun compte, et la ligne du fichier prend une pastille **verte** — les deux **identiques** que le document soit indexable ou vide. Défaut consigné dans IMPO-01, pas un échec de la passe
- [x] Ce second import n'est pas refusé — il est **dit**. Vérifier que le document est bien en base, et que la recherche ne le trouve pas
