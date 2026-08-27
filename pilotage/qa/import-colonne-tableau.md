---
passe: Import — bitexte en tableau, une ligne par colonne
chantier: IMPO-01
duree: 30 min
derniere: 2026-08-27
---

# QA — un tableau à deux colonnes devient deux documents alignés

Passe écrite après le lot du 27 août. Un bitexte en tableau — deux langues en regard dans
les cellules d'un même `.docx` — n'avait **aucun mode d'import qui le lise**. Elle valide la
chaîne entière : l'écran dit ce que le fichier contient, met une ligne par colonne, importe
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
commit `6f913c2`**. Le premier démarrage d'un onefile neuf est lent : lui laisser une minute.
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
tableau, cliquer « Une ligne par colonne », régler mode et langue sur chaque ligne, importer.

### Ce que le fichier contient

- [ ] `2021_Texte1_…Tableau.docx` ajouté à la liste, la carte « Aperçu texte » affiche **« Tableau : 2 colonnes × 1 ligne. »**
- [ ] Un bouton **« Une ligne par colonne »** est proposé à côté de cette phrase
- [ ] `3-M-GW-OrFrTrEn-2010-Aligné Tableau.docx` affiche **« Tableau : 2 colonnes × 22 lignes. »** — la forme diffère, le nombre de colonnes non
- [ ] Un `.docx` ordinaire sans tableau (par exemple `Asimov-Foundation_FR.docx`) n'affiche **aucune** note de tableau, et aucun bouton
- [ ] Sur un fichier sans tableau, tout le reste de l'aperçu se comporte comme avant

### Une ligne par colonne

- [ ] Sur `2021_Texte1_…Tableau.docx`, cliquer « Une ligne par colonne » porte la liste à **deux lignes** pour ce fichier
- [ ] Les deux lignes portent le même nom de fichier, mais des titres distincts finissant par **« — col. 1 »** et **« — col. 2 »**
- [ ] Chaque ligne porte un champ **colonne** renseigné, `1` et `2`
- [ ] Le journal de l'écran affiche **« ↳ … : 2 colonnes mises en file »**
- [ ] Le bouton « Une ligne par colonne » disparaît une fois le fichier éclaté — il n'y a plus rien à éclater
- [ ] Passer une des deux lignes du mode **Paragraphes** au mode **Lignes numérotées** **conserve** la colonne saisie

### L'aperçu suit la colonne

- [ ] La ligne « — col. 1 » en mode **Paragraphes** annonce **48 unités**, colonne Type entièrement **`line`**, ID numérotés **1 → 48**
- [ ] Sa première ligne de texte est **« Texte 1 »**, la deuxième commence par **« The Observer view on the vaccine dispute »**
- [ ] La ligne « — col. 2 » annonce **48 unités**, également toutes `line`, et sa deuxième ligne commence par **« Vaccins »** — c'est bien l'autre langue
- [ ] La même ligne passée en mode **Lignes numérotées** annonce toujours **48 unités**, mais colonne Type entièrement **`structure`** et ID entièrement en tirets : c'est le piège que le mode paragraphes évite
- [ ] Changer la valeur du champ colonne (2 → 1) **rafraîchit** l'aperçu au lieu de laisser la précédente à l'écran
- [ ] Sur `3-M-GW-OrFrTrEn-2010-Aligné Tableau.docx`, chaque colonne annonce **22 unités**, toutes `line`

### L'import des deux colonnes

- [ ] Les deux lignes de `2021_Texte1_…Tableau.docx` s'importent **toutes les deux**, sans qu'aucune passe en erreur « Déjà dans le corpus »
- [ ] Le journal affiche pour chacune **« ↳ 1 table(s) traitée(s), 48 unité(s) extraite(s) »**
- [ ] Aucun avertissement (⚠) n'accompagne ces deux imports
- [ ] Les deux documents apparaissent dans la liste du corpus avec leurs titres distincts
- [ ] Vider la liste, réajouter le même fichier, l'éclater à nouveau et relancer l'import : les **deux** lignes passent en erreur « Déjà dans le corpus » — le moteur distingue les colonnes sans les confondre, et refuse bien deux fois la même
- [ ] Le canvas de chaque document affiche des lignes de la taille d'un paragraphe, pas un pavé unique

### Alignement et recherche

- [ ] Une famille relie les deux documents (à rétablir à la main dans Métadonnées si l'import par lot ne l'a pas fait)
- [ ] L'alignement par ancre `external_id` journalise **48 liens créés**, sans orpheline
- [ ] La matrice affiche deux colonnes peuplées et en regard : la ligne 2 montre « The Observer view… » face à « Vaccins… »
- [ ] Les deux documents apparaissent dans le sélecteur du concordancier
- [ ] En filtrant sur la colonne anglaise, chercher **Observer** rend au moins une ligne — donc le document est bien indexé, ce que le mode numéroté n'aurait pas permis

### Ce que l'application doit montrer sans le taire

- [ ] `2021_Texte6_…Tableau - Copie.docx` éclaté en deux lignes : la colonne 1 annonce **95 unités**, la colonne 2 **96**
- [ ] L'écart se voit donc **avant** l'import, dans l'aperçu, sans avoir à ouvrir le fichier dans Word
- [ ] Après import des deux colonnes, l'alignement par ancre laisse une unité sans correspondance côté colonne 2 — c'est la source qui est irrégulière, pas l'import
- [ ] Un fichier portant **plusieurs** tableaux affiche l'énumération (« N tableaux (…) — vérifiez l'aperçu avant de choisir. ») et non « Tableau : … » au singulier
- [ ] L'audit de corpus (écran **Métadonnées**, panneau d'audit) liste les deux documents sous **« Doublons de nom de fichier »** — c'est exact, et c'est le prix assumé d'un fichier qui produit deux documents ; leurs `source_hash` ne collisionnent pas, eux

### Non-régression

- [ ] Un `.docx` ordinaire s'importe comme avant, sans champ colonne renseigné et sans note de tableau
- [ ] Un `.odt` n'affiche **aucune** note de tableau, même s'il en contient — aucun parcours par colonne n'existe hors DOCX, et l'écran ne doit rien promettre qu'il ne sait tenir
- [ ] Le pré-contrôle refuse toujours un fichier **sans colonne** déjà présent dans le corpus, avec le message « Déjà dans le corpus (doc_id N) »
- [ ] `8-CI-TrEn-2022_A Aligner.docx` annonce toujours **28 unités** en mode paragraphes — le lot ne touche pas aux fichiers sans tableau
