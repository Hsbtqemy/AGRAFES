---
passe: Import — bitexte en tableau, un document par colonne
chantier: IMPO-01
duree: 30 min
derniere: 2026-08-27
---

# QA — un tableau à deux colonnes devient deux documents alignés

Passe écrite après le lot du 27 août. Un bitexte en tableau — deux langues en regard dans
les cellules d'un même `.docx` — n'avait **aucun mode d'import qui le lise**. Elle valide la
chaîne entière : l'écran dit ce que le fichier contient, met le fichier une fois par colonne, importe
les deux, et les deux documents s'alignent par ancre sans qu'aucun marqueur figure dans la
source.

Elle ne couvre pas l'ODT en tableau (le moteur n'a pas de parcours par colonne hors DOCX,
c'est délibéré), ni l'import par ShareDocs ou par le CLI, qui n'offrent pas de colonne.

**Lancer l'application.** `tauri-prep` seul ne joint pas le sidecar
(`sidecar_fetch_loopback` n'existe que dans le shell) : passer par
`npm --prefix tauri-shell run tauri -- dev`.

**D'abord : le sidecar doit porter le lot.** C'est un processus Python séparé qui embarque
son propre `src/` figé à la compilation — modifier le dépôt ne l'atteint pas, et
l'application répond l'ancien comportement sans rien signaler. Fermer l'application, puis
`python scripts/build_sidecar.py --preset shell --format onefile` — le défaut Windows
(`onedir`) produit un exe que `externalBin` ignore. Vérifier que
`tauri-shell/src-tauri/binaries/multicorpus-x86_64-pc-windows-msvc.exe` est **postérieur au
commit `d491469`**. Le premier démarrage d'un onefile neuf est lent : lui laisser une minute.
**Un aperçu qui n'annonce aucun tableau sur un fichier de la table ci-dessous ne dit pas que
le lot a échoué — il dit d'abord que le sidecar est périmé.**

**Travailler sur une copie de la base.**

**Les fichiers de référence.** Trois `.docx`, mesurés au parseur le 27 août 2026. Aucun ne
porte de marqueur `[n]` ni de saut de ligne doux : le mode **paragraphes** est le seul qui
les lise.

| fichier | dossier | forme du tableau | col. 1 | col. 2 |
|---|---|---|---|---|
| `2021_Texte1_CI-OrEnTrFr-2021_Aligné-Tableau.docx` | `CI-OrEnTrFr-2021_Aligné-Tableau` | 2 colonnes × 1 ligne | 48 unités | 48 unités |
| `3-M-GW-OrFrTrEn-2010-Aligné Tableau.docx` | `M-GW-OrFrTrEn-2010-Aligné Tableau` | 2 colonnes × 22 lignes | 22 unités | 22 unités |
| `2021_Texte6_CI-OrEnTrFr-2021_Aligné Tableau - Copie.docx` | `CI-OrEnTrFr-2021_Aligné-Tableau` | 2 colonnes × 1 ligne | 95 unités | **96** unités |

Les deux premiers sont les **deux formes** que porte le corpus : tout le texte dans une
cellule unique, ou une ligne de tableau par segment. Le troisième est le seul des 25 dont les
colonnes sont **inégales** — il sert à vérifier que l'application le montre au lieu de le
taire.

**Une précision qui décide de la lecture.** Les deux modes rendent **le même nombre
d'unités** sur ces fichiers. Ce qui les sépare est entièrement dans la colonne **Type** de
l'aperçu : `line` en mode paragraphes (indexable, trouvable à la recherche), `structure` en
mode lignes numérotées (hors index, invisible au concordancier). Compter les unités ne suffit
donc jamais à savoir si l'import est bon.

**Le geste attendu.** Ajouter le fichier, ouvrir la carte « Aperçu texte », lire la note de
tableau, cliquer « Un document par colonne », régler mode et langue sur chaque ligne, importer.

### Ce que le fichier contient

- [x] `2021_Texte1_…Tableau.docx` ajouté à la liste, la carte « Aperçu texte » affiche **« Tableau : 2 colonnes × 1 ligne. »**
- [x] Un bouton **« Un document par colonne »** est proposé à côté de cette phrase
- [x] `3-M-GW-OrFrTrEn-2010-Aligné Tableau.docx` affiche **« Tableau : 2 colonnes × 22 lignes. »** — la forme diffère, le nombre de colonnes non
- [x] Un `.docx` ordinaire sans tableau (par exemple `Asimov-Foundation_FR.docx`) n'affiche **aucune** note de tableau, et aucun bouton
- [x] Sur un fichier sans tableau, tout le reste de l'aperçu se comporte comme avant
- [x] Prévisualiser un fichier à tableau **puis** un fichier illisible fait disparaître la note : elle ne doit jamais rester sur la forme du fichier précédent

### Un document par colonne

- [x] Sur `2021_Texte1_…Tableau.docx`, cliquer « Un document par colonne » porte la liste à **deux lignes** pour ce fichier — le même fichier y figure deux fois, réglé sur deux colonnes différentes
- [x] Les deux lignes portent le même nom de fichier, mais des titres distincts finissant par **« — col. 1 »** et **« — col. 2 »**
- [x] Chaque ligne porte un champ **colonne** renseigné, `1` et `2`
- [x] Les deux lignes portent la **même langue**, celle du profil de lot, signalée comme devinée — c'est attendu : aucun de ces noms de fichier ne porte de code de langue, la détection n'a rien à se mettre sous la dent. Régler `en` sur la colonne 1 et `fr` sur la colonne 2 **avant** d'importer
- [x] Le journal de l'écran affiche **« ↳ … : un document par colonne (2 colonnes) »**
- [x] Le bouton « Un document par colonne » disparaît une fois le fichier éclaté — il n'y a plus rien à éclater
- [x] Après l'import, le bouton ne découpe plus la ligne : le journal dit « n'est plus en attente… » au lieu de réécrire le titre d'un document déjà importé
- [x] Passer une des deux lignes du mode **Paragraphes** au mode **Lignes numérotées** **conserve** la colonne saisie

### L'aperçu suit la colonne

- [x] La ligne « — col. 1 » en mode **Paragraphes** annonce **48 unités**, colonne Type entièrement **`line`**, ID numérotés **1 → 48**
- [x] Sa première ligne de texte est **« Texte 1 »**, la deuxième commence par **« The Observer view on the vaccine dispute »**
- [x] Ce « Texte 1 » s'affiche **sans balise** — il est en gras dans la source, et l'aperçu montrait jusqu'ici `<hi rend="bold">Texte 1</hi>` en toutes lettres
- [x] La ligne « — col. 2 » annonce **48 unités**, également toutes `line`, et sa deuxième ligne commence par **« Vaccins »** — c'est bien l'autre langue
- [x] La même ligne passée en mode **Lignes numérotées** annonce toujours **48 unités**, mais colonne Type entièrement **`structure`** et ID entièrement en tirets : c'est le piège que le mode paragraphes évite
- [x] Changer la valeur du champ colonne (2 → 1) **rafraîchit** l'aperçu au lieu de laisser la précédente à l'écran
- [x] Sur `3-M-GW-OrFrTrEn-2010-Aligné Tableau.docx`, chaque colonne annonce **22 unités**, toutes `line`

### L'import des deux colonnes

- [x] Les deux lignes de `2021_Texte1_…Tableau.docx` s'importent **toutes les deux**, sans qu'aucune passe en erreur « Déjà dans le corpus »
- [x] Le journal affiche pour chacune **« ↳ 1 table(s) traitée(s), 48 unité(s) extraite(s) »**
- [x] Aucun avertissement (⚠) n'accompagne ces deux imports
- [x] Les deux documents apparaissent dans la liste du corpus avec leurs titres distincts
- [ ] Le journal termine chaque import par **« · réindexez pour la recherche. »** — sans ce geste le document existe mais reste introuvable, et rien ne le disait jusqu'ici
- [x] Vider la liste, réajouter le même fichier, l'éclater à nouveau et relancer l'import : les **deux** lignes passent en erreur « Déjà dans le corpus » — le moteur distingue les colonnes sans les confondre, et refuse bien deux fois la même
- [x] Le canvas de chaque document affiche des lignes de la taille d'un paragraphe, pas un pavé unique

### Alignement et recherche

- [x] **Aucune famille n'est proposée à l'import** — c'est attendu et non un défaut : la détection travaille sur le nom de fichier, qui ne porte ici aucun code de langue, et les deux colonnes partagent de toute façon le même nom. Créer la relation source↔traduction à la main dans **Métadonnées**
- [x] L'alignement par ancre `external_id` journalise **48 liens créés**, sans orpheline (mesuré au moteur le 27 août : 48 liens exactement)
- [x] La matrice affiche deux colonnes peuplées et en regard : la ligne 2 montre « The Observer view… » face à « Vaccins… »
- [ ] **Reconstruire l'index avant de chercher** — un document importé n'est jamais trouvable tant que l'index n'a pas été refait : `fts_units` est une table FTS5 **sans trigger**, peuplée par l'indexeur seul (migration 002). Ce n'est pas un défaut du lot, c'est le modèle
- [x] Les deux documents apparaissent dans le sélecteur du concordancier
- [x] En filtrant sur la colonne anglaise, chercher **Observer** rend au moins une ligne — donc le document est bien indexé, ce que le mode numéroté n'aurait pas permis

### Ce que l'application doit montrer sans le taire

- [ ] `2021_Texte6_…Tableau - Copie.docx` éclaté en deux lignes : la colonne 1 annonce **95 unités**, la colonne 2 **96**
- [ ] L'écart se voit donc **avant** l'import, dans l'aperçu, sans avoir à ouvrir le fichier dans Word
- [ ] Après import des deux colonnes, l'alignement par ancre crée **95 liens** et signale **« 1 external_id(s) in target missing from pivot »** — mesuré au moteur le 27 août. L'unité 96 de la colonne 2 reste sans correspondance : c'est la source qui est irrégulière, pas l'import, et l'application le dit au lieu de le taire
- [ ] Un fichier portant des tableaux de **tailles différentes** — par exemple `HDR V7 06 juillet.docx` ou `Conventions-Textes journalistiques…docx` — affiche l'énumération (« N tableaux (…) — vérifiez l'aperçu avant de choisir. ») et **aucun bouton** : « un document par colonne » n'a pas de réponse quand les tableaux se contredisent, et le champ colonne reste saisissable à la main
- [ ] Un fichier portant **plusieurs** tableaux **de même largeur** propose bien le bouton
- [ ] L'audit de corpus (écran **Métadonnées**, panneau d'audit) liste les deux documents sous **« Doublons de nom de fichier »** — c'est exact, et c'est le prix assumé d'un fichier qui produit deux documents ; leurs `source_hash` ne collisionnent pas, eux

### Non-régression

- [ ] Un `.docx` ordinaire s'importe comme avant, sans champ colonne renseigné et sans note de tableau
- [ ] Un `.odt` n'affiche **aucune** note de tableau, même s'il en contient — aucun parcours par colonne n'existe hors DOCX, et l'écran ne doit rien promettre qu'il ne sait tenir
- [ ] Le pré-contrôle refuse toujours un fichier **sans colonne** déjà présent dans le corpus, avec le message « Déjà dans le corpus (doc_id N) »
- [ ] `8-CI-TrEn-2022_A Aligner.docx` annonce toujours **28 unités** en mode paragraphes — le lot ne touche pas aux fichiers sans tableau
