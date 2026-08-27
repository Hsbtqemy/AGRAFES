---
chantier: IMPO-01
statut: interrompu
---

# IMPO-01 — la page d'import : elle écrit sans jamais se relire

**Arrêté sur** — le bitexte en tableau marche de bout en bout, la passe `qa/import-colonne-tableau.md`
attend d'être jouée ; l'aperçu comparatif, lui, n'est toujours pas commencé.

**Trois fois j'ai écrit « livré » une couche trop tôt** le 27 août : moteur fait, puis le champ
d'écran réservé au mauvais mode, puis deux gardes d'écran de plus. Chaque fois, ce qui l'a
révélé est la préparation de la QA — écrire les gestes qu'un utilisateur ferait vraiment, dans
l'ordre. À faire plus tôt la prochaine fois.

**État précédent** — le moteur est fait, le front reste entier. Les deux sévérités manquantes et la
capacité « bitexte en tableau » sont livrées le 27 août 2026 ; l'aperçu comparatif, qui est la
raison d'être de la fiche, n'est pas commencé — mais son prérequis l'est : `/import/preview`
sait enfin prévisualiser une colonne.

**Point de départ** — idée soulevée le 26 août 2026, à partir d'un cas mesuré : un ODT en
liste automatique importé en mode « lignes numérotées » produit 1141 unités hors index, et
l'écran affiche une coche verte.

## Reste

- [ ] Construire l'**aperçu comparatif** décidé le 26 août (voir Contexte) : une ligne par mode applicable, colonnes « unités / trouvables à la recherche / non indexées » + la première ligne extraite, mode pré-sélectionné sur le plus d'unités trouvables
- [ ] Trouver le libellé juste pour la colonne du milieu : « indexables » est du jargon, « trouvables à la recherche » dit ce que l'utilisateur perd s'il se trompe
- [ ] Chiffrer le coût : un appel `/import/preview` **par mode applicable** (2 pour un `.docx`/`.odt`, 1 ailleurs) au lieu d'un seul, donc autant de parses complets — mesurer sur les plus gros fichiers avant de décider si l'aperçu comparatif est calculé à l'ajout ou à la sélection de la ligne
- [x] **Variantes de colonne — tranché le 27 août** : une ligne par colonne, parce que c'est le fichier qui dit combien il y en a. La question ne se posait que faute de savoir la forme du document ; depuis que l'aperçu la rend, elle tombe
- [x] Sévérité moteur sur `line_unit_count == 0` — **faite le 27 août**. Le filet vaut pour le
      CLI, `import-remote` et l'import par lot, que l'écran ne protégera jamais. Posée **en
      dernier** dans l'échelle : c'est le verdict le plus grave, aucun des précédents ne doit
      l'écraser. Portée mesurée avant de coder, sur la base de travail : **1 document sur 58**
      remonte, et c'est le bon — `doc_id` 426, `9_CI-TrFr-2021_Aligné_UTF8.txt`, 48 unités
      **toutes `structure`**, donc le document entier hors index, que le rapport déclarait `ok`.
      Zéro faux positif ; aucun document sans la moindre unité. 3 tests, RED prouvé
- [x] Sévérité sur les **unités longues** — **faite le 27 août**, au rang avertissement : la
      longueur reste un indice, pas une preuve. Elle remonte **0 document** aujourd'hui — les 15
      blobs ont été réimportés le 26 — donc elle ne coûte rien et sert de filet pour la suite.
      Le message de la barrière `import_warning` disait « (holes/duplicates) » : élargi, sinon il
      devenait faux. 2 tests, dont une garde d'ordre qui doit rester verte des deux côtés
- [ ] **La barrière ne barre rien** — constaté le 27 août en vérifiant ce que les deux sévérités
      changeraient pour un export réel : ni le CLI (`cli.py:793`) ni le sidecar
      (`sidecar.py:10341`) ne **refusent** sur `gate_status: "blocking"`, ils le rapportent, et
      `_ok(...)` sort en 0. Le rapport devient véridique, personne n'est arrêté. À trancher :
      est-ce voulu (un rapport, pas une porte) ou est-ce le troisième angle mort ?
- [ ] Afficher `units_line` / `units_structure` à la fin de **chaque** import : les deux champs sont déjà dans la réponse et ne sont journalisés que si `tables_processed > 0` (extraction par colonne), donc jamais pour un import ordinaire
- [x] **Capacité manquante — livrée le 27 août.** `column_index` vaut désormais pour
      `docx_paragraphs`, et le parcours de table vit dans `importers/docx_columns.py`, partagé
      par les deux importeurs DOCX plutôt que recopié. Vérifié sur le vrai fichier
      (`2021_Texte1_…Tableau.docx`) : **48 unités indexables par colonne**, `external_id` 1..48
      contigus **des deux côtés**, donc alignables par ancre dès l'import. La forme réelle est
      plus simple que prévu et plus favorable : **une seule ligne** de tableau, deux colonnes,
      chaque cellule portant les 48 mêmes paragraphes en regard. 25 fichiers `.docx` dans les
      trois dossiers « Tableau » du disque, soit une cinquantaine de documents qui n'avaient
      aucune porte d'entrée. Trois choses trouvées en chemin, chacune son item ci-dessous
- [x] **`/import/preview` ne prenait pas de `column_index` — pour aucun mode** (27 août).
      L'aperçu d'une extraction par colonne montrait donc zéro unité là où l'import en écrivait
      des centaines, y compris en mode numéroté. Corrigé : paramètre optionnel, validé à l'entrée
      (400 lisible plutôt que 500 générique). **La tranche « aperçu comparatif » en dépendait
      directement** — sans lui, aucune ligne « colonne » n'est affichable. Contrat 1.6.78, zéro
      route ajoutée (112 avant, 112 après), snapshot inchangé
- [x] **On ne pouvait pas importer les deux colonnes d'un même fichier** (27 août) — donc pas un
      bitexte, qui est justement *un* fichier pour *deux* documents.
      `assert_not_duplicate_import` compare le hash du fichier **entier** et son chemin, tous deux
      identiques d'une colonne à l'autre. Défaut partagé par le mode numéroté depuis toujours,
      invisible en test parce que ses deux cas de colonne utilisaient chacun une base neuve.
      Corrigé : l'identité d'un document extrait est `(fichier, colonne)` —
      `column_scoped_source_hash`, et les contrôles par chemin et par nom écartés quand une
      colonne est demandée. Réimporter la **même** colonne reste refusé. Inerte sur l'existant,
      mesuré avant de coder : **1141 runs d'import, 0 avec un `column_index`**
- [x] Câbler le job d'import **asynchrone** du sidecar (27 août), qui porte sa propre copie du
      dispatch par mode (`sidecar.py:10069`) : c'est le chemin de l'import par lot du front, et
      sans lui la capacité n'aurait existé que pour l'import synchrone
- [x] **Trouvé par la passe adverse : j'avais rendu la perte de données muette.** Le mode
      numéroté émet deux avertissements — lignes ignorées faute de colonne, sous-tables sautées —
      et le commentaire du parcours dit qu'ils existent pour qu'il n'y ait *« jamais de perte
      silencieuse »*. En donnant le parcours au mode paragraphes sans eux, une ligne ou une
      sous-table y disparaissait sans un mot, le compteur montant seul. **Mon propre test passait
      pendant ce temps** : il vérifiait le compteur, pas l'avertissement. Corrigé par
      `column_walk_warnings`, partagé par les deux modes, libellés inchangés au mot près (les 11
      tests de table du mode numéroté le prouvent). 3 tests, RED prouvé sur les deux qui portent
      l'avertissement
- [x] **Décision assumée, elle aussi trouvée par la passe : le garde a été relâché.** Pour qu'un
      fichier rende plusieurs documents, le contrôle par **chemin** doit céder quand une colonne
      est demandée — les deux colonnes ont le même chemin. Effet de bord : importer le fichier
      **entier puis une colonne** devient permis, là où c'était refusé. C'est l'échappatoire utile
      (reprendre colonne par colonne un tableau d'abord importé en bloc, sans le supprimer), le
      doublon restant visible dans `GET /corpus/audit`. Épinglé par un test pour que ce soit une
      décision et non un accident. Mesuré : **aucun document du corpus ne vient d'un fichier
      « Tableau »**, donc ce choix n'engage que la suite
- [ ] **L'aperçu ne rend pas les avertissements** — `/import/preview` ne renvoie que des unités
      (`units`, `units_total`, `truncated`). Prévisualiser la colonne 2 d'un fichier dont des
      lignes seront ignorées ne montre donc rien de cette perte, alors que l'import, lui,
      l'écrira dans son rapport. À trancher avec l'aperçu comparatif : c'est exactement le genre
      de fait que la comparaison est censée mettre sous les yeux
- [ ] **Conséquence à surveiller de la capacité : l'audit de corpus va crier.** `GET /corpus/audit`
      groupe les documents par **nom de fichier** et par **titre** (`sidecar.py:8370`) et signale
      les collisions. Deux colonnes d'un même bitexte partagent l'un et l'autre — donc importer
      les 25 fichiers « Tableau » ferait remonter 25 doublons de nom, et autant de titres si
      l'utilisateur laisse le titre par défaut (`path.stem`). Ce n'est pas faux — deux documents
      viennent bien du même fichier — mais ça se lira comme du bruit. Le hash, lui, ne collisionne
      plus. Remède possible : que l'audit connaisse la colonne, ce qui suppose de la ranger
      ailleurs que dans le suffixe du hash (`meta_json` du document). À ne coder que quand le bruit
      se constate, pas avant
- [x] **Dire ce que le fichier contient, avant de lui demander une colonne** — fait le
      27 août, sur votre recadrage : la vraie question n'était pas « comment ajouter deux fois
      un fichier » mais « qu'y a-t-il dedans ». `POST /import/preview` renvoie `tables`
      (`[{columns, rows}]`, `null` hors DOCX, `[]` quand il n'y en a pas), l'écran l'affiche
      — « Tableau : 2 colonnes × 1 ligne. » — et propose **« Une ligne par colonne »**, qui
      éclate le fichier prévisualisé en autant de lignes d'import, titres suffixés. Ça tranche
      du même coup l'item qui hésitait entre « une ligne par colonne » et « une entrée qui
      ouvre un second choix » : c'est le fichier qui décide. **Décrit, ne conclut pas** —
      porter un tableau ne fait pas d'un document un bitexte : `Conventions-Textes
      journalistiques` en porte **sept**, de 5, 2, 2, 2, 2, 2 et 2 colonnes, qui sont de la
      mise en page. Coût mesuré avant de coder : 8 ms par fichier, le document étant déjà
      ouvert par le parseur. Contrat 1.6.79, 112 routes inchangées. 6 tests
- [x] **Deux gardes d'écran de plus interdisaient le geste**, tous deux bâtis sur « un fichier
      = un document » : `_addFile` refusait le même chemin deux fois dans la liste, et le
      pré-contrôle passait le fichier en **erreur** si son `source_path` était déjà dans le
      corpus — donc refusait la seconde colonne **côté client**, avant même que la requête
      parte. Le premier est contourné par le geste d'éclatement, qui clone la ligne (donc reste
      explicite : pas d'empilement par inadvertance) ; le second cède quand une colonne est
      demandée, le moteur restant le garde-fou. Trouvés en préparant la passe de QA, qui aurait
      échoué au deuxième point
- [x] **L'écran d'import réservait le champ « colonne » au mode numéroté** — donc la capacité
      était **inatteignable depuis l'application**, exactement là où elle sert : un bitexte en
      tableau non numéroté ne se lit qu'en mode paragraphes. Trouvé le 27 août en préparant la
      passe de QA, qui aurait été injouable au premier point. Six sites dans `ImportScreen.ts`,
      pas un : le rendu du champ, l'effacement au changement de mode (qui **conserve** désormais
      la valeur en passant d'un mode DOCX à l'autre — c'est le geste même de comparer), l'envoi
      du job, la charge de l'aperçu, le commentaire du type, et le rafraîchissement de l'aperçu
      à la saisie — ce dernier manquait aussi : le garde de cache tient sur le **chemin** du
      fichier, qui ne bouge pas d'une colonne à l'autre, si bien que changer de colonne laissait
      l'aperçu sur la précédente. Le prédicat vit dans `importDetect.modeAcceptsColumn`, où la
      connaissance des modes est déjà, plutôt qu'en six conditions recopiées. 3 tests
- [ ] **Ni le CLI ni ShareDocs ne savent extraire une colonne — pour aucun mode.** Constaté le
      27 août : `dispatch_import` accepte `column_index`, mais `cmd_import` n'expose aucune option
      `--column-index` et l'écran ShareDocs n'offre aucun champ. L'extraction par colonne n'est
      donc atteignable que par l'import **local** de l'application. Trois lignes d'`add_argument`
      côté CLI ; côté ShareDocs c'est une décision d'écran, un fichier distant en tableau devant
      alors se voir proposer la colonne comme en local
- [ ] **Un `.txt` numéroté « 1. » n'a lui non plus aucun mode qui le lise** — c'est le cas du
      `doc_id` 426, et c'est la **cinquième forme**, jumelle du bitexte en tableau. `IMPORT_MODES`
      ne connaît que `txt_numbered_lines` pour le `.txt` : pas de `txt_paragraphs`. L'aperçu
      comparatif y affichera donc une seule ligne, à 0 indexable, sans rien à proposer. À trancher
      avec la tranche 3 : ouvrir un mode paragraphes au `.txt`, ou assumer que l'écran dise
      « aucun mode ne lit ce document »
- [ ] Élucider les 5 fichiers en zone grise du sondage (ratio ~0,66 de lignes marquées, famille Beigbeder / cullioli) — non localisés au moment du sondage, la forme reste inconnue
- [ ] Renommer ou étoffer le « précontrôle » de l'écran d'import : `_updatePrecheck` ne compte que les fichiers par statut (total / en attente / importés / en erreur), il ne vérifie aucun contenu — le mot promet ce que la fonction ne fait pas
- [ ] Décider du sort de l'aperçu : il reste **volontaire** et n'affiche qu'un fichier à la fois (curseur `_textPreviewCursor`), donc il ne protège que l'utilisateur qui sait déjà quoi regarder

## QA

- qa/import-colonne-tableau.md

## Contexte

**L'asymétrie est le vrai constat.** L'export possède une machine de contrôle complète —
`qa_report.POLICY_RULES`, 8 dimensions graduées `ok` < `warning` < `blocking`, un mode strict
exposé à l'écran — et **deux de ces dimensions sont `import_error` et `import_warning`**. La
qualité de l'import est donc déjà évaluée, mais seulement quand on exporte, c'est-à-dire bien
après le moment où l'utilisateur aurait pu changer de mode et réimporter.

**Ce qui existe déjà et ne demande qu'à être montré.** `ImportReport` porte `units_total`,
`units_line`, `units_structure`, `duplicates`, `holes`, `non_monotonic`, `warnings` et les
statistiques de table. L'écran n'en journalise que le `doc_id`, les avertissements, et le
détail des tables. `qa_report._check_import_integrity` calcule en plus les trous (avec son
gate à 20 %), les unités vides, les unités longues et l'unicode suspect — mais c'est un
**produit d'export** (`ExportsScreen`, « Rapport QA corpus »), qu'il faut aller chercher.

**Les deux angles morts du contrôle existant** — *comblés le 27 août.* `_check_import_integrity`
filtrait sur `unit_type='line'` : sur un document 100 % `structure` il ne trouvait ni trou, ni
doublon, ni unité vide, et concluait `severity: "ok"` — tout en renvoyant `line_unit_count: 0`
dans la même charge utile. Et les unités longues étaient listées sans jamais relever de
sévérité. Aucun champ nouveau n'a été nécessaire : le rendu HTML affichait déjà
`line_unit_count` et le compte d'unités longues à côté de la pastille, la raison du verdict est
donc lisible telle quelle.

**Trois producteurs mesurés du même défaut** (le document s'importe et reste introuvable),
tous le 25-26 août : un DOCX à sauts de ligne doux en mode paragraphes (blob) ; un DOCX sans
marqueur `[n]` en mode numéroté (`qa/italique-import.md`, `doc_id` 424) ; un ODT en liste
automatique, où l'écran **affiche** une numérotation de 1 à 1141 que le style calcule au rendu
et qui n'existe pas dans le texte. Le troisième est le plus grave : l'interface conduit
activement au mauvais choix.

**Décision du 26 août — l'aperçu comparatif, plutôt qu'un garde-fou.** Les deux questions
posées (avertir ou refuser ? détecter ou laisser choisir ?) sont **dissoutes** : l'écran
montre ce que **chaque mode applicable** fait du fichier, et l'utilisateur choisit sur pièces.
Plus de refus à justifier, plus d'avertissement à lire, aucune connaissance préalable exigée —
le bon mode est celui qui lit le document. La détection ne sert plus qu'à **ordonner** la
liste et pré-sélectionner ; la justification, c'est la comparaison elle-même. C'est la
décision D1 du cas blob (« détecter et proposer, jamais automatique ») portée à son terme.

Vérifié sur les quatre formes problématiques du corpus local, colonnes *unités / indexables /
structure* :

| fichier | mode | unités | indexables | structure |
|---|---|---|---|---|
| `Coe-House-AL_FR.docx` (blob) | numérotées | 836 | **833** | 3 |
| | paragraphes | 1 | 1 | 0 |
| `Asimov…_réaligné.odt` (liste auto) | numérotées | 1141 | **0** | 1141 |
| | paragraphes | 1141 | **1141** | 0 |
| `8-CI-TrEn-2022_A Aligner.docx` | numérotées | 28 | **0** | 28 |
| | paragraphes | 28 | **28** | 0 |
| `2021_Texte1_…Tableau.docx` | numérotées | 0 | 0 | 0 |
| | numérotées, colonne 1 | 48 | **0** | 48 |
| | paragraphes | 0 | 0 | 0 |
| | **paragraphes, colonne 1** *(27 août)* | 48 | **48** | 0 |
| | **paragraphes, colonne 2** *(27 août)* | 48 | **48** | 0 |

Règle de pré-sélection qui en découle : **le mode rendant le plus d'unités indexables**. Elle
donne le bon résultat sur les trois premiers cas, et sur le quatrième **depuis que la capacité
existe** — les deux dernières lignes du tableau sont le correctif du 27 août. Le cas « aucun
mode ne lit ce document » n'a pas disparu pour autant : il s'est déplacé sur le `.txt` numéroté
« 1. » (`doc_id` 426), pour lequel il n'existe qu'un seul mode. Le défaut de capacité devient
ainsi visible au lieu de se cacher derrière un mauvais choix.

**La forme réelle des 25 fichiers en tableau, mesurée le 27 août.** Tous font deux colonnes, et
aucun ne porte le moindre marqueur `[n]` ni le moindre saut de ligne doux — le mode paragraphes
par colonne est le seul qui les lise, sans exception. Mais il y a **deux formes**, pas une : la
famille `M-GW-2010` met **une ligne de tableau par segment** (66, 38, 22, 44, 34, 20, 36, 25, 27
lignes), les autres mettent tout le texte dans **une seule cellule** (jusqu'à 98 paragraphes).
Le parcours lit les deux. Point à connaître avant d'espérer l'alignement automatique :
**24 paires sur 25 ont des colonnes de taille égale**, une seule est décalée d'un paragraphe
(95 contre 96, sur `2021_Texte6…Tableau - Copie.docx`, une variante « Copie »). L'import rend donc
l'alignement par ancre **possible**, il ne le garantit pas — c'est la régularité de la source qui
décide. À noter aussi que les 25 comptent des variantes « - Corr. », « - Corrigé » et « - Copie »
du même texte : le compte de documents importables sera inférieur à 50.

**Le sondage du 26 août — la détection par contenu est viable.** Critère testé : la
proportion de lignes extraites qui commencent par `[n]`, sur **374 fichiers `.docx`/`.odt`
uniques** du disque local. Résultat : **145** au-dessus de 0,8 (presque tous à 1,0), **198**
sous 0,2 (presque tous à 0,0), **5** en zone grise autour de 0,66, et **26** rendant zéro
ligne. Soit **92 % de tri sans ambiguïté** par un seuil trivial. Les 26 « zéro ligne » ne sont
pas un échec du détecteur mais la découverte d'une quatrième forme : le bitexte en tableau,
que `Document.paragraphs` ne voit pas.

**Rapport à l'audit d'import** (`docs/AUDIT_IMPORT_2026-07-20.md`, à ne pas confondre : ses
constats portent le préfixe `IMP-`, celui-ci est la fiche d'écran `IMPO-`). Son **IMP-02**
(« import vide silencieux ») a été corrigé par une garde « 0 unité → lever » dans
`parsed.insert_units` ; ce qui est décrit ici en est l'**extension exacte** — 0 unité
*indexable* plutôt que 0 unité tout court. Son **IMP-RT** a par ailleurs tranché contre
l'auto-détection du `resource_type` avec le bon critère : « prémisse vérifiée au code : signal
nul ». Le sondage ci-dessus applique la même méthode à la détection de *mode* et trouve
l'inverse — un signal net. Les deux verdicts ne se contredisent pas, ils appliquent la même
règle à deux signaux différents. À noter : **11 constats de cet audit sont encore ouverts sans
item dans aucune fiche** (relevé par `npm run verifier`).

Voir `pilotage/R2.md` (l'item de filet, qui porte le même constat côté moteur) et
`pilotage/IMP-01.md` (clos — le hang d'`_analyze_external_ids`, sans rapport).
