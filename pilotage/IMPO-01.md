---
chantier: IMPO-01
statut: interrompu
---

# IMPO-01 — la page d'import : elle écrit sans jamais se relire

**Arrêté sur** — l'écran **déduit le mode de chaque fichier et affiche son verdict sur sa
ligne**, et **la page est refaite en maître-détail** (27 août 2026, `5ceb1be` → `8b3dd14`,
poussés). Le profil de lot ne décide plus le mode ; il ne porte plus que la langue, laquelle
a rejoint la zone de dépôt. Quatre cartes sont retirées, 155 lignes de CSS purgées, et les
largeurs ne bougent plus avec le contenu — trois passes de correction menées sur captures.
**Les deux passes de QA n'ont toujours pas été jouées** (`qa/import-apercu-comparatif.md`,
`qa/import-deduction-mode.md`) : elles ont été remises d'aplomb après la refonte, mais rien
de ce lot n'a encore été vérifié à l'écran par un parcours complet.

**Ce que la journée a mesuré, et qu'il ne faut pas re-dériver.** Sur les **273** `.docx`/`.odt`
des deux dossiers de corpus (`00-Hugo-Corpus Multilingues` et `GRAFE-Lit-Aligne`) : le défaut
`[n]` du profil de lot **perd sur 149** fichiers, gagne sur 82, laisse 15 égalités trompeuses
et 26 fichiers que ni l'un ni l'autre ne lit (les bitextes en tableau). Le **signal des
marqueurs** tranche juste sur **272/273**. Sur 514 fichiers tous formats, **292** portent `[n]`
et **48** portent `1.` (45 `.txt`, 3 `.docx`). Cadence réelle d'import, lue sur les 58 documents
de la base de travail : **11 rafales** d'avril à août, tailles 33, 14, 2, 2 puis sept fois 1 —
la **médiane est 1 fichier**, mais **47 documents sur 58** sont entrés dans les deux grosses.
Les gestes sont unitaires, les documents arrivent en masse : ni l'un ni l'autre ne peut être
sacrifié, et la base compte 58 documents pour 514 fichiers sur le disque — le gros est devant.

**La passe n'a rien trouvé, et c'est trompeur.** Tout ce qu'elle aurait dû trouver l'a été
**avant** qu'elle soit jouée — trois fois j'ai écrit « livré » une couche trop tôt (moteur fait,
puis le champ d'écran réservé au mauvais mode, puis deux gardes d'écran de plus), et chaque
fois c'est *l'écriture* de la passe qui l'a révélé : décrire les gestes qu'un utilisateur ferait
vraiment, dans l'ordre, est un test en soi. Trois défauts de plus sont venus des **questions
posées pendant** la QA : un libellé de bouton que son auteur devait expliquer, un journal muet
sur la réindexation, un item citant une chaîne du moteur au lieu de l'écran. La leçon tient en
une phrase : écrire la passe **avant** de déclarer le lot fini.

**État précédent** — le moteur est fait, le front reste entier. Les deux sévérités manquantes et la
capacité « bitexte en tableau » sont livrées le 27 août 2026 ; l'aperçu comparatif, qui est la
raison d'être de la fiche, n'est pas commencé — mais son prérequis l'est : `/import/preview`
sait enfin prévisualiser une colonne.

**Point de départ** — idée soulevée le 26 août 2026, à partir d'un cas mesuré : un ODT en
liste automatique importé en mode « lignes numérotées » produit 1141 unités hors index, et
l'écran affiche une coche verte.

## Reste

- [x] **L'aperçu comparatif est construit** — 27 août. Une ligne par mode comparable,
      colonnes *unités / trouvables à la recherche / non indexées* + la première unité, mode
      recommandé marqué, chaque ligne cliquable pour l'appliquer. Le rendu vit dans
      `importModeComparisonTemplate.ts` (pur, 8 tests) et la décision dans
      `importDetect.pickBestMode` (5 tests). Quand **aucun** mode ne rend d'unité trouvable,
      l'écran le **dit** — « Aucun mode ne lit ce document » — au lieu de pré-sélectionner le
      moins mauvais : c'est ainsi qu'un défaut de capacité devient visible plutôt que caché
      derrière un mauvais choix
- [x] Libellé de la colonne du milieu — **« Trouvables »**. « Indexables » est du jargon ;
      celui-ci dit ce que l'utilisateur perd s'il se trompe. D'abord posé en « Trouvables à
      la recherche », raccourci le 27 août sur sa demande : le qualificatif tient dans
      l'infobulle, et son absence laisse la largeur à l'extrait de la première unité
- [x] **Coût chiffré, et il tranche la question** — mesuré le 27 août : les deux modes
      ensemble coûtent **32 à 251 ms** sur un DOCX du corpus et **59 ms** sur l'ODT médian.
      Un seul `.odt` sur douze dépasse 200 Ko (1,9 s) et ce n'est pas un document de corpus.
      Mais ajouter 25 fichiers en paierait ~4 s : la comparaison se calcule donc **à la
      sélection**, jamais à l'ajout — l'aperçu n'en montre de toute façon qu'un à la fois.
      Le premier jet redemandait en plus le document **entier** par mode juste pour compter
      ses unités indexables (~110 Ko sur la boucle locale, deux fois, pour deux entiers) :
      corrigé en faisant remonter `units_line` / `units_structure` par l'endpoint
      (contrat **1.6.80**), comptés sur *toutes* les unités. Le front refuse de conclure si
      ces champs manquent — un sidecar antérieur ferait sinon afficher « aucun mode ne lit ce
      document » sur **tous** les fichiers, un faux verdict étant pire que pas de tableau
- [x] **Variantes de colonne — tranché le 27 août** : un document par colonne, parce que c'est le fichier qui dit combien il y en a. La question ne se posait que faute de savoir la forme du document ; depuis que l'aperçu la rend, elle tombe
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
- [ ] **L'index n'a rien à faire sur l'écran d'import — c'est un quatrième point d'entrée.**
      Rectifié le 27 août : l'item précédent affirmait qu'« aucun front ne consomme `fts_stale` »,
      ce qui est **faux**. `MetadataScreen` le lit en trois endroits — le libellé de son bouton
      unique (`indexButtonState`, « ✓ Index à jour » quand rien n'est périmé) et une pastille
      cliquable « ⚠ Index » sur **chaque document périmé** de ses deux listes — et
      `TextCanvasView`, `CurationPane`, `SegmentPane` et `prepUndo` le lisent aussi. C'est
      seulement le sélecteur du **concordancier** qui l'ignore (le champ n'est qu'une déclaration
      de type dans son `sidecarClient`). L'écran d'état + bouton de recours que je proposais de
      bâtir **existe déjà**, mieux fait, avec en prime une case « Auto après curation ».
      L'écran d'import en est donc le **quatrième** point d'entrée — après la barre du
      concordancier, le bouton de MetadataScreen et ses pastilles par document — et le seul qui
      ne sache rien de l'état de l'index. Sa carte « Index FTS » est à retirer.
      **La prémisse de départ était un artefact de test** : l'utilisateur ne réindexe pas après
      un import, mais après un travail de segmentation ou de curation, et le plus souvent depuis
      le concordancier ; les réindexations manuelles observées venaient de bases montées pour
      tester. Ce qui invalide aussi l'idée d'indexer automatiquement à l'import : le document
      sera de toute façon repéri après la suite du travail
- [ ] **Les deux applications ne sont pas d'accord sur l'indexation après import.**
      `tauri-app/src/features/importFlow.ts:54` appelle `rebuildIndex` juste après l'import et
      affiche « Import + indexation réussis » ; l'import de Prep, lui, n'indexe rien. Le
      comportement que je croyais devoir arbitrer existe donc déjà d'un côté. À trancher dans un
      sens ou dans l'autre, mais pas à laisser divergent
- [ ] **Le journal d'import dit « · réindexez pour la recherche » à un moment où ça ne sert pas.**
      Ajouté le 27 août sur une prémisse depuis corrigée. La phrase est vraie — le document
      n'est pas trouvable — mais elle pousse un geste que l'utilisateur ne fera qu'après la
      segmentation et la curation. À reformuler en constat plutôt qu'en consigne
- [ ] **La barrière ne barre rien** — constaté le 27 août en vérifiant ce que les deux sévérités
      changeraient pour un export réel : ni le CLI (`cli.py:793`) ni le sidecar
      (`sidecar.py:10341`) ne **refusent** sur `gate_status: "blocking"`, ils le rapportent, et
      `_ok(...)` sort en 0. Le rapport devient véridique, personne n'est arrêté. À trancher :
      est-ce voulu (un rapport, pas une porte) ou est-ce le troisième angle mort ?
- [x] **Le mode ne se décrète plus par lot, il se déduit du fichier** — 27 août, `5ceb1be`.
      Le sélecteur « Format par défaut » du profil de lot est retiré ; le profil ne porte plus
      que la **langue**. À l'ajout, chaque fichier reçoit un aperçu en mode paragraphes — celui
      qui ne retire rien, donc le seul où les marqueurs sont encore visibles — dont on lit la
      numérotation (`detectNumbering`), puis son mode et son motif (`planImport`). **Un seul
      appel par fichier** : il répond du même coup à la question de sûreté, puisque des
      marqueurs `[n]` garantissent que le mode numéroté rendra des unités, et qu'en leur absence
      le `units_line` de cet appel *est* le compte du mode paragraphes. En série, pas en
      parallèle : 32 à 251 ms par DOCX, donc quelques secondes pour la plus grosse rafale réelle
      (33 fichiers), chaque ligne se mettant à jour dès que la sienne tombe
- [x] **Le comptage d'unités abandonné comme critère de mode** — 27 août. `pickBestMode` ne
      répond plus qu'à la seule question où il ne peut pas se tromper (« quelque chose lit-il ce
      document ? ») et `recommendedMode` fait suivre au tableau comparatif le mode que la
      déduction a posé, sinon l'écran se contredirait — la carte posant un mode et le tableau
      juste en dessous en recommandant un autre
- [x] **Seuil tiré de la distribution, pas du raisonnement** — mesuré le 27 août dans la
      fenêtre de 50 unités de l'aperçu : pour `[n]`, **149 fichiers à exactement 0** et **98
      au-dessus de 0,95** ; pour `1.`, 243 à 0 et 3 au-dessus de 0,95. **Zéro fichier entre 0,2
      et 0,95** — n'importe quel seuil de cet intervalle trie à l'identique, 0,5 laisse la plus
      grande marge. Et le premier marqueur vit à l'unité **#0** sur les 101 fichiers numérotés,
      donc la fenêtre de l'aperçu suffit très largement
- [x] **Le verdict voyage avec le fichier** — 27 août. Mode déduit, **motif**, et combien
      d'unités seront trouvables, sur la ligne même. Le motif compte autant que le mode : sans
      lui la déduction est un oracle qu'on ne peut pas contredire. La file annonce avant
      d'importer combien de fichiers n'auraient rien de trouvable, attendent une colonne, ou
      perdraient leur numérotation comme ancre. Rendu pur dans `importVerdictTemplate.ts`
      (17 tests). Le compte n'est affiché que lorsqu'il est **exact** — sur un document numéroté
      l'analyse sait *qu'il* sera trouvable sans savoir combien, et un chiffre pris à l'autre
      mode serait faux
- [x] Afficher `units_line` / `units_structure` à la fin de **chaque** import — 27 août. Les
      deux champs étaient dans la réponse depuis toujours mais n'étaient journalisés que si
      `tables_processed > 0`, donc jamais pour un import ordinaire. Un import à zéro unité
      trouvable sort désormais en ligne d'**erreur**, avec « ⚠ AUCUNE unité trouvable à la
      recherche »
- [x] **Passe adverse du lot — trois défauts dans ce que je venais d'écrire.** (1) L'éclatement
      par colonne recopiait le verdict du fichier **entier**, où rien n'est lisible hors tableau :
      chaque colonne issue du découpage réclamait donc la colonne qu'on venait de lui donner.
      (2) Choisir l'autre mode dans le tableau comparatif affichait ce mode-là **avec le motif de
      celui qu'on écartait** — « Paragraphes · marqueurs [n] détectés », qui justifie exactement
      le choix contraire ; `verdictForChoice` dit maintenant « choisi à la main » et retire le
      compte, mesuré sur l'autre mode. (3) Une chute du sidecar en cours d'analyse faisait
      **boucler la file à l'infini** : `_analyzeFile` rendait la main sans poser de verdict et le
      même fichier ressortait à chaque tour
- [x] **Éprouvé sur les charges utiles réelles du binaire empaqueté**, pas seulement sur des cas
      écrits à la main : sept fichiers capturés depuis l'exe, dont le blob à 833 marqueurs dans
      une **unique** unité (qui piégeait la première sonde de mesure, laquelle comptait par unité
      et non par ligne), l'ODT dont la numérotation est calculée au rendu, et le bitexte en
      tableau avec et sans colonne. Les sept rendent le verdict attendu
- [x] **Seconde passe adverse — un `.txt` correctement numéroté était déclaré introuvable.**
      27 août, `cde32e0`. La sonde d'un `.txt` est `txt_numbered_lines`, le seul mode TXT — et
      ce mode **consomme** le marqueur, qui devient l'`external_id` et disparaît du texte.
      `detectNumbering` n'y voyait donc aucune numérotation sur un fichier qui en porte une, et
      le verdict tombait sur « rien ne serait trouvable » — sur `Asimov-Foundation_EN.txt`, qui
      rend **1683 unités toutes indexables**, et sur **195 autres `.txt`** du disque. Corrigé
      par le compte du mode de sonde, qui est la preuve restante : la consommation du marqueur
      atteste qu'il existait. `searchableAsParagraphs` renommé `searchableInProbe`, son nom
      mentant sur ce qu'il porte hors DOCX. **La première vérification sur charges réelles
      n'avait capturé que le `.txt` numéroté « 1. »** — le seul cas où le verdict était juste par
      accident : un jeu de vérification qui ne contient pas le cas où la réponse serait fausse
      ne vérifie rien
- [x] **Deux autres corrections de la même passe** — 27 août. Le motif d'origine ne survivait
      pas à un choix manuel : un fichier attendant une colonne cessait de le dire dès qu'on
      changeait son mode, et le verdict restait orange sans qu'on sache pourquoi. Et l'ordre des
      verdicts est inversé pour que **le plus grave gagne**, même échelle que la sévérité du
      moteur et pour la même raison — inerte sur les fichiers mesurés, mais vrai par
      construction plutôt que par chance
- [x] **L'écran passe en maître-détail** — 27 août, `d688efe`. La page était encore
      organisée selon l'ancien modèle (fichiers à gauche, « profil et aperçus » à droite)
      alors que le modèle est devenu *par fichier* : le tableau comparatif d'un fichier
      vivait trois écrans plus bas, dans l'autre colonne, avec une pastille « 1/1 » et un
      bouton « Suivant » désactivé. La liste choisit, le panneau montre. La ligne ne porte
      plus que nom, statut et verdict ; les commandes descendent dans le panneau du fichier
      sélectionné. **La sélection remplace les deux curseurs** — ils n'existaient que parce
      que l'aperçu était global et n'avait aucun moyen de savoir de quel fichier on parlait
- [x] **Quatre cartes retirées, chacune sur une mesure** — 27 août. La carte **CoNLL-U**,
      dépliée en permanence pour annoncer qu'aucun `.conllu` n'était sélectionné : il n'en
      existe **aucun** sur le disque ni dans le corpus, et le panneau rend désormais
      l'évidence du fichier sélectionné quel qu'il soit (unités ou tokens) — la capacité
      reste entière, c'est la carte permanente qui tombe. La carte **Index FTS** (voir
      l'item dédié). Le **fil d'Ariane**, dont la classe `active` était écrite en dur sur la
      première étape et dont l'étape ② nommait un profil de lot disparu. Et la **case de
      doublons en double**, recopiée en JS entre le profil et le pied de page. La **langue
      par défaut** rejoint la zone de dépôt, puisque son étiquette disait « appliquée aux
      nouveaux fichiers » ; elle travaille vraiment — sur 514 fichiers réels, 58 % portent
      leur langue dans leur nom, **42 % prennent le défaut**
- [x] **155 lignes de CSS purgées** — 27 août. 31 règles dont plus aucun sélecteur n'a de
      classe vivante, vérifiées une à une : une règle mêlant mort et vivant est **conservée**,
      on laisse du mort plutôt que de retirer du vif. Feuille 6024 → 5869 lignes
- [x] **Les largeurs cessent de bouger avec le contenu** — 27 août, `d6bc499` + `81d2550` +
      `c274f83`, en trois passes signalées par l'utilisateur sur captures. (1) La grille de
      l'écran : un `1fr` nu vaut `minmax(auto, 1fr)`, dont le minimum *auto* laisse le
      contenu pousser la colonne ; la liste passe à une largeur fixe, les deux colonnes
      reçoivent `min-width: 0` (un enfant flex vaut `min-width: auto` par défaut).
      (2) La ligne de commandes passe d'un flex à une **grille**, chaque champ épinglé à sa
      colonne : « Titre » prenait près de 700 px, et « Colonne » masqué faisait glisser ses
      voisins — il est désormais grisé et désactivé, ce qui dit en outre que la capacité
      existe. (3) Les trois tables passent en `table-layout: fixed` : en `auto`, l'extrait de
      la première unité — d'« Afghanistan. » à une phrase entière — décalait « Unités » de
      65 px d'un fichier à l'autre. Trouvé en chemin : une règle `[hidden]` écrite plus tôt
      dans la même session en **annulait** une autre en la suivant dans la feuille
- [x] **« Indexables » remplace « Trouvables à la recherche »** — 27 août, `8b3dd14`, sur
      proposition de l'utilisateur. Raccourci d'abord pour la place, puis changé de mot sur
      une raison plus forte : « trouvables » **affirme quelque chose de faux**, puisque les
      unités ne le deviennent qu'à la réindexation, laquelle vient après la segmentation et
      la curation. Et le reste de l'application parle déjà d'index (« ✓ Index à jour »,
      « ⚠ Index », « ⟳ Réindexer ») : deux mots pour une même chose obligeaient l'utilisateur
      à faire le lien. Le mot bascule partout où il était vu ; le qualificatif survit dans
      l'infobulle, qui dit aussi que l'indexation vient plus tard
- [ ] **Les deux passes de QA sont à rejouer, pas seulement à relire.** Elles ont été
      remises d'aplomb le 27 août — libellés et gestes disparus (déplier « Aperçu texte »,
      bouton « Suivant », champ « col » sur la ligne, carte « Langue par défaut ») — mais
      **aucune n'a encore été jouée**, et l'écran a changé de forme entre-temps. Elles
      restent le seul filet sur ce lot
- [ ] **`segment` répond `ok` en ne faisant rien** — trouvé le 28 août en cherchant un
      rattrapage pour un document 100 % `structure`. La commande rend `status: "ok"` sur un
      document qu'elle ne peut pas traiter (aucune unité `line` à lire), sans un mot. Même
      famille que le défaut de la fiche : une opération qui se déclare réussie en n'ayant
      rien fait. À vérifier aussi côté sidecar (`POST /segment`) avant de trancher le remède
- [ ] **Le bandeau des familles propose un choix sans effet.** Trouvé le 28 août en jouant
      la passe. Son `<select>` « Original : » (`prep-imp-family-pivot-sel`,
      `importFamilyDetectionTemplate.ts:37`) n'existe **que** dans le gabarit : aucun
      gestionnaire, aucune lecture, nulle part dans les fronts. La note du bandeau dit
      elle-même que la décision se prend « dans la dialog post-import de chaque fichier
      enfant » — le sélecteur invite donc à un choix qui sera ignoré. Appartient au lot
      familles (P6), pas à IMPO-01 : signalé, pas corrigé
- [ ] **ShareDocs garde le défaut qu'on vient de retirer en local.** `#prep-sd-profile`
      (`shareDocsImportTemplate.ts:77`) propose toujours `WP_DEFAULT_NUMBERED` en `selected`, et
      `shareDocs.ts:242` en dérive le mode. Les deux écrans sont donc désormais en désaccord sur
      ce qu'est un DOCX par défaut, ce qui est pire que l'un ou l'autre choix seul. La déduction
      complète y est possible — `remote/ingest.py:175` télécharge chaque fichier dans un
      temporaire avant de l'importer — mais **après** téléchargement, donc c'est une décision
      d'écran, pas un simple portage. Palier immédiat sans coût : basculer son défaut sur
      paragraphes, qui ne produit jamais un document 100 % `structure`
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
- [x] **L'aperçu d'import affichait le balisage en toutes lettres** — trouvé le 27 août en
      interrogeant le **binaire empaqueté** après reconstruction, pas les sources : la première
      unité d'un bitexte en tableau sort en `<hi rend="bold">Texte 1</hi>`, et l'écran la
      rendait telle quelle. Le défaut aurait fait échouer un point de la passe de QA à peine
      écrite. Dépouillé par `stripHiTags` — l'aperçu répond « ce qui sera importé et où ça
      coupe », pas « à quoi ça ressemble » — ce qui corrige du même coup la troncature à 120
      caractères, qui comptait les balises et montrait donc moins de texte sur une ligne stylée
      que sur les autres. **C'est le premier item du `Reste` de `RICH-01`** : le correctif y est
      décrit et l'approche y était déjà tranchée ; sa fiche appartient à une autre session, je ne
      la modifie pas
- [x] **Passe adverse du 27 août — trois défauts dans le geste que je venais d'écrire.**
      (1) Le `catch` de l'aperçu ne remettait ni la forme ni la note : prévisualiser un
      fichier à tableau puis un fichier illisible laissait à l'écran la forme du **premier**,
      et le bouton proposait de découper le second selon les colonnes d'un autre document.
      (2) Une ligne **déjà importée** restait découpable : le geste réécrivait son titre en
      « — col. 1 » alors qu'elle avait été importée *sans* colonne — un titre qui ment. Gardé
      des deux côtés (bouton masqué **et** geste refusé), avec un message plutôt qu'un refus
      muet, l'aperçu ne se rafraîchissant pas de lui-même après un import.
      (3) La règle du nombre de colonnes proposé était le **maximum** sur les tables, ce qui
      aurait offert **8 colonnes** sur une HDR. Remplacée par une règle **tirée de la
      distribution réelle** — mesurée sur les **387 `.docx`** du disque : 352 sans table,
      **26 avec une seule table de 2 colonnes** (exactement la population des bitextes), **8
      avec des tables de tailles différentes**, toutes des documents de mise en page (deux
      HDR, un modèle, les conventions), jamais un bitexte. Le geste en lot n'est donc proposé
      que si les tables **s'accordent** ; sinon le champ colonne reste saisissable à la main.
      On retire une proposition, jamais une capacité. 5 tests
- [x] **Dire ce que le fichier contient, avant de lui demander une colonne** — fait le
      27 août, sur votre recadrage : la vraie question n'était pas « comment ajouter deux fois
      un fichier » mais « qu'y a-t-il dedans ». `POST /import/preview` renvoie `tables`
      (`[{columns, rows}]`, `null` hors DOCX, `[]` quand il n'y en a pas), l'écran l'affiche
      — « Tableau : 2 colonnes × 1 ligne. » — et propose **« Un document par colonne »**, qui
      éclate le fichier prévisualisé en autant de lignes d'import, titres suffixés. Ça tranche
      du même coup l'item qui hésitait entre « un document par colonne » et « une entrée qui
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
- [ ] **La numérotation « 1. » n'a aucun mode qui la consomme — 48 fichiers, mesurés.**
      45 `.txt` et 3 `.docx`, tous de la famille `CI-2021_Aligné`, où les paires `OrEn`/`TrFr` de
      même indice sont appariées **par la numérotation** : la perdre n'est pas cosmétique. Les 45
      `.txt` sortent à **0 unité trouvable** (tout en `structure`), et c'est structurel :
      `txt_numbered_lines` est le **seul** mode TXT (`dispatch.py:85`), donc un `.txt` non
      numéroté `[n]` n'a aucune porte d'entrée. Les 3 `.docx` passent en paragraphes et rendent
      46 unités trouvables, mais avec `1. Texte 11` **collé dans le texte** et un `external_id`
      positionnel. L'écran le **dit** désormais (verdict `no_mode` / `numbering_lost`) au lieu de
      l'importer en silence — reste à décider s'il doit aussi savoir le **lire**.
      **Et il n'y a aucun rattrapage en aval, vérifié le 28 août en base.** `unit_type` est
      écrit **une fois**, à l'insertion par l'importeur : les quatorze `UPDATE units` du
      moteur touchent `meta_json`, `text_norm`, `text_raw`, `unit_role` et `unit_status`, et
      **aucun** le type. Les *rôles* sont un axe distinct — une unité `structure` peut porter
      le rôle « titre » et rester hors index. Le segmenteur filtre `unit_type = 'line'` à ses
      treize accès, l'indexeur l'annonce dès son en-tête (« structure units excluded »), et
      la curation peut bien éditer le texte : l'index ne le prendra pas. Mesuré de bout en
      bout — import `ok` 48 unités / 0 ligne, resegmentation **sans effet**, index 0. La seule
      issue est de supprimer le document et de le réimporter, ce qui suppose un mode qui sache
      le lire. Le défaut n'est donc pas « une ancre perdue » mais **un document définitivement
      inutilisable** Le motif `[n]`
      est recopié à l'identique dans **trois** importeurs (`docx_numbered_lines.py:42`,
      `odt_numbered_lines.py:23`, `txt.py:30`) : il faut le centraliser avant d'y toucher. Et
      **ne pas élargir `[n]` à `1.`** — une prose contenant une liste numérotée se ferait
      déchiqueter, le numéro avalé en `external_id` ; ce doit être un mode distinct, choisi par
      la détection. C'est un **amendement à ADR-001**, donc une décision, pas seulement du code
- [ ] Élucider les 5 fichiers en zone grise du sondage (ratio ~0,66 de lignes marquées, famille Beigbeder / cullioli) — non localisés au moment du sondage, la forme reste inconnue
- [ ] Renommer ou étoffer le « précontrôle » de l'écran d'import : `_updatePrecheck` ne compte que les fichiers par statut (total / en attente / importés / en erreur), il ne vérifie aucun contenu — le mot promet ce que la fonction ne fait pas
- [x] **Le sort de l'aperçu — dissous le 27 août, pas tranché.** Il reste volontaire et un
      fichier à la fois, mais ce n'est plus lui qui protège : le verdict vit désormais sur la
      ligne de chaque fichier, où il est vu sans qu'on l'ait cherché. L'aperçu comparatif devient
      le **recours** — « pourquoi ce mode ? » — ce qui rend la déduction contestable sans la
      rendre obligatoire
- [ ] **Un mode TXT sans numérotation n'existe pas** — conséquence mesurée du point ci-dessus,
      mais plus large que cette fiche : `dispatch.py` ne connaît que `txt_numbered_lines`, donc
      un `.txt` de prose ordinaire est **inimportable** en l'état. Capacité manquante, pas défaut
      de la page d'import ; à traiter ailleurs
- [ ] **Le geste d'import par fichier n'est pas offert** — le bouton Importer reste global sur
      les fichiers en attente. La cadence réelle (médiane 1 fichier, mais 47 documents sur 58
      entrés en deux rafales de 33 et 14) demande que les deux tiennent : un bouton par carte
      pour le geste unitaire, sans retirer l'import du lot en attente

## QA

- qa/import-colonne-tableau.md — close 45/45 le 27 août 2026
- qa/import-apercu-comparatif.md — à jouer (sidecar ≥ contrat 1.6.80 requis)
- qa/import-deduction-mode.md — à jouer (écrite avant la fin du lot, 27 août)

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
