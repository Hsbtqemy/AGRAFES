---
chantier: ACT-01
statut: interrompu
---

# ACT-01 — la page Actions : une liste de documents qui ne sert à rien

**Arrêté sur** — refonte « action d'abord » écrite et testée, non commitée, 31 août 2026.
Reste la passe de QA à jouer, et trois constats trouvés en chemin.

## Reste

- [x] **Trancher le geste central de la page** — tranché : **action d'abord**. Les quatre
      cartes ne sont plus des étapes mais des filtres ; cliquer une carte réduit la liste
      aux documents que la capacité concerne encore, et on choisit ensuite un document
      dans la liste réduite. Re-cliquer la carte active, ou « Tout afficher », rend la
      liste entière
- [x] **Rendre la liste de documents vivante** — chaque ligne porte désormais son
      `data-doc-id` et une colonne de gestes qui ouvre la capacité **sur ce document**
      (`openCurationLayer(docId)` / `openSegmentLayer` / `openAnnotationLayer`, qui
      acceptaient déjà un `docId`). Hors filtre, les quatre gestes ; sous filtre, le seul
      demandé
- [x] **Ajouter l'état par étape sur chaque ligne** — colonne « À faire », vocabulaire et
      couleurs repris du bandeau d'état du canvas (`.prep-canvas-chip`), pour que les deux
      écrans disent la même chose de la même façon. `fts_stale` y figure comme anomalie,
      pas comme étape
- [x] **La curation est la seule étape sans état par document** — tranché : état créé
      côté moteur, **sans migration**. La trace existait déjà (voir « Ce que la mesure a
      corrigé »). `GET /documents` gagne `curated_at` et `aligned_count`, contrat 1.6.85
- [x] Décider du sort des **deux vues** de la liste — les deux sont gardées et partagent
      le même constructeur de ligne (`_docRow`), donc le même état et les mêmes gestes.
      Sous filtre, l'arbre reste bâti sur **tous** les documents — sinon un parent masqué
      par le filtre serait déclaré « absent du corpus » — et le filtre agit au rendu ; un
      parent hors filtre dont un enfant est retenu reste affiché en contexte, sans geste
- [x] Décider si les cartes gardent leur numérotation « Étape 1 / 2 / 3 / Optionnel » —
      retirée. Le compte de restants a pris sa place et donne son travail à la carte
- [x] Vérifier le doublon d'actualisation — un seul bouton reste, celui qui propage aux
      sous-vues (`setConn`), le plus fort des deux
- [x] Décider ce que devient la carte de tête « Traitement de corpus » — supprimée, avec
      ses trois règles CSS devenues mortes. Son unique bouton a rejoint l'en-tête de la
      carte Documents
- [ ] **Finir la passe `qa/actions-action-dabord.md`** — 71 points en 8 zones, **67 joués**
      au 31 août : cinq zones closes, les trois autres à un ou deux points près. Le
      préambule porte la reconstruction du sidecar, le contrôle `/health`, et depuis ce
      rejeu les **quatre manipulations** de la zone « Tenue à l'écran » — à relire plutôt
      qu'à refaire de mémoire. Le rejeu a payé : **deux vrais défauts**, ci-dessous, que
      les 1328 tests prep ne pouvaient pas voir. **Quatre endroits ont été réécrits en
      cours de passe**, chacun sur une question de l'utilisateur, et chacun demandait
      quelque chose qui ne se voit pas :
      · « le tri accentue et minuscule pareil » — aucune paire de titres, langues ou rôles
      de ce corpus ne collationne égale en différant à l'octet (mesuré), et
      `docSort.test.ts` le prouvait déjà ; remplacé par les trois rangs où le comparateur
      du dépôt diverge d'un `<` naïf sur les 58 vrais titres.
      · « sous filtre, la ligne n'offre plus qu'un bouton » — parenthèse « (ou l'étape
      filtrée) » illisible, et deux items sur `⇄` juste après, une icône qui n'existe
      **pas** sous filtre.
      · « ce refus ne laisse pas la matrice sur la famille consultée juste avant » — se
      vérifiait après coup, or après coup les deux mondes rendent la même image si la
      famille précédente est celle qu'on verrait ; ce qui tranche est **si le clic
      déplace**, donc « l'écran reste sur le hub ».
      · « l'infobulle liste tous les états, séparés par des points médians » — redondante
      par construction sur ce corpus : le maximum est 4 pastilles et `MAX_ROW_BADGES` vaut
      4, donc jamais de `+N` et l'infobulle répète le visible ; reformulée sur ce qui reste
      vérifiable, qu'elle apparaisse en survolant **une pastille**.
      **La cause commune est identifiée** : ces items ont été écrits en relisant les tests,
      pas en regardant ce que le corpus permet de voir — « abricot »/« Abricot » vient
      littéralement d'`actionsHubState.test.ts:139-141`. D'où des items qui décrivent un
      mécanisme interne (un séparateur, une insensibilité de collation) au lieu d'un geste.
      Un item de QA se dérive du corpus, pas de la suite de tests : sinon il ne peut que
      redire ce qui est déjà prouvé, ou demander l'invisible
- [x] **Le chemin asynchrone de la curation n'enregistre rien** — trouvé en chemin, puis
      **corrigé** (contrat 1.6.87), et il n'était pas seul. En énumérant les appelants
      plutôt qu'en corrigeant celui qu'on regardait : **trois** chemins appliquent la
      curation, `POST /curate` (qui passait un `record_action`), le job
      `POST /jobs kind=curate`, et la CLI `multicorpus curate` — les deux derniers n'en
      passaient aucun. Une curation lancée par la file ou en Mode A n'était donc pas
      annulable et n'entrait pas dans `curated_at`. Le recorder vit désormais dans
      `services/curate_service.apply_recorder` et les trois le construisent à l'identique,
      pour que l'asymétrie ne puisse pas se reformer. Le résultat du job gagne
      `action_ids` / `action_id`, la sortie CLI gagne `action_ids`, et le job lit
      `rules_signature` / `apply_context`, que seul le corps synchrone lisait. Rien ne
      bouge à l'écran (le front n'emprunte que le chemin synchrone) : c'est le trou qui est
      fermé, et il comptait — la note de conception montre que l'angle mort de l'historique
      se referme de lui-même **sauf** par les chemins muets. Trois tests de bout en bout,
      tous vérifiés RED sur l'ancien code
- [ ] **`curated_at` dira « 57 à faire » sur le corpus réel, et c'est exact au sens
      strict** — vérifié en faisant tourner `list_documents` sur la base de travail en
      lecture seule : 1 document sur 58 porte un `curated_at`. Trois raisons cumulées, à
      trancher : `prep_action_history` est **forward-only** (migration 019 — une curation
      antérieure n'a laissé aucune trace) ; le chemin asynchrone n'enregistre rien (item
      ci-dessus) ; un apply sans effet n'écrit pas de ligne. La carte est donc juste sur
      « ce texte a-t-il été modifié par la curation », et trompeuse si on la lit « ce
      document a-t-il été relu ». À décider : garder tel quel, ou ne compter la curation
      que sur les documents importés après la migration 019
- [ ] **L'état par étape n'a qu'une couche, l'automatique** — cadré le 31 août dans
      `docs/DESIGN_step_status_tristate.md`, rien de codé. Une segmentation appliquée mais
      insatisfaisante rend le même écran qu'une réussie : le jugement de l'utilisateur n'a
      nulle part où se poser, et rien ne survit à la fermeture. Modèle proposé : une case
      à trois états par document et par capacité, dont **deux sont dérivés gratuitement**
      (`[ ]` aucune trace, `[/]` une trace mais rien de conclu) et un seul se stocke
      (`[X]`, posé par l'utilisateur seul). La **signature de péremption est tranchée**
      (mesure du 31 août, **une seule base et de travail** — les taux y sont indicatifs,
      seuls les mécanismes tiennent). Ce qui est établi : une resegmentation peut rendre
      le même compte d'unités, donc cette signature-là est aveugle par construction ; et
      36 documents sur 58 n'ont aucun historique, angle mort qui se referme (83 % le
      30 juin, 62 % le 27 août) — mais qui ne pouvait pas se refermer entièrement tant
      qu'un chemin d'écriture restait muet, d'où la correction du chemin asynchrone
      ci-dessus. D'où deux signatures, la seconde transitoire. Restent deux décisions
      avant tout ticket : le sort de `workflow_status`, et si la case absorbe le bouton
      d'ouverture
- [x] **Les colonnes glissaient en passant sur le filtre Segmentation** — premier vrai
      défaut trouvé par la passe, corrigé le 31 août. La boîte de la liste est en
      `overflow: auto` sans gouttière réservée : sous les filtres qui laissent beaucoup de
      lignes (57, 53, 37, ou les 58 sans filtre) elle défile et la barre prend sa largeur
      **dans** la boîte ; sous Segmentation — une seule ligne — il n'y a pas de barre et
      ces ~15 px reviennent au tableau. Comme il est en `table-layout: fixed` avec une
      **seule** colonne élastique (« Titre »), ils lui vont entièrement : Langue, Rôle,
      Unités, À faire et Ouvrir glissent tous vers la droite. « N° » ne bougeant pas, le
      décalage était discret — c'est l'item de la passe qui l'a rendu visible. Correctif :
      `scrollbar-gutter: stable`, une ligne. Gardé par
      `ui/__tests__/actionsHubLayout.test.ts`, qui lit `app.css` faute de pouvoir lire ça
      dans le DOM, et vérifié RED sur l'ancienne feuille
- [x] **`↺ Actualiser` faisait mentir le bouton Hiérarchie** — deuxième défaut trouvé par
      la passe, corrigé le 31 août. Le hub a trois préférences d'affichage — le filtre, le
      tri, la vue hiérarchie — et la troisième seule ne survivait pas au rechargement : le
      bouton passe par `setConn`, qui remettait `_hubHierarchyView` à `false`. Rien ne
      repeignait le bouton, dont le libellé n'était touché que dans la bascule : la liste
      redevenait plate pendant qu'il annonçait `📋 Liste` avec `aria-pressed="true"`, et
      le cliquer renvoyait dans la hiérarchie — l'inverse de sa promesse. Corrigé au bon
      niveau plutôt qu'au symptôme : la vue hiérarchie **survit** au rechargement comme
      ses deux sœurs (ses relations, vidées par `setConn`, sont reprises dans `_loadDocs`,
      avec repli à plat si elles ne se lisent pas), et la peinture du bouton sort dans
      `_paintHierarchyBtn` pour que l'écart ne puisse plus se creuser. Trois tests,
      vérifiés RED. **Le premier passait d'abord sur le code fautif** : `setConn` lance
      `_loadDocs` sans l'attendre, donc guetter « l'arbre est là » juste après observait
      le DOM d'AVANT. Les trois sont désormais ancrés sur un document que seule la seconde
      connexion sert — tant qu'il n'est pas rendu, le rechargement n'a pas eu lieu
- [ ] **`multicorpus segment` reste muet, lui** — dernier chemin d'écriture sans trace,
      trouvé en énumérant les appelants pour le lot ci-dessus. Les deux chemins sidecar de
      la segmentation passent `make_resegment_recorder(conn)` (`sidecar.py:9601` ; le job
      `kind=segment` le passe aussi), la CLI n'en passe aucun (`cli.py:893-899`) : une
      resegmentation en Mode A n'est pas annulable et n'écrit pas la ligne `resegment` sur
      laquelle la signature de péremption du `[X]` Segmentation doit se fonder. Pas corrigé
      ici pour ne pas empiler deux extractions dans le même lot : `make_resegment_recorder`
      est une fermeture de ~60 lignes qui vit dans `sidecar.py` et prend un `calibrate_to`
      — la sortir vers `services/` demande le protocole service/adapter complet et son
      propre test RED, pas un paramètre de plus. Vérifié au passage que `lift-markers`
      n'est **pas** une asymétrie : il n'est un type d'action annulable nulle part
      (`ALLOWED_ACTION_TYPES`, `action_history.py:26`)
- [ ] **`fts_readable` n'est pas documenté dans `SIDECAR_API_CONTRACT.md`** — trouvé en
      ajoutant les deux champs voisins, qui y sont maintenant. Le champ date de 1.6.84
      (FTS-01) ; le test `test_contract_docs_sync` ne l'exige pas, d'où l'oubli. Une ligne
      à ajouter sous `GET /documents`, à porter par FTS-01 plutôt qu'ici

## QA

- qa/actions-action-dabord.md — **en cours**, 67 points sur 71 au 31 août. Elle vérifie ce
  qu'aucun test unitaire ne prouve : que l'état affiché correspond au document en base, que
  le filtre et la vue hiérarchie se composent sans se contredire, et que la colonne de
  gestes tient à l'écran. Ses comptes attendus sont mesurés sur la base de travail, pas
  estimés — 57/1/37/53 sur les cartes, 17 pastilles « Index périmé », une seule ligne
  « Rien à faire » (`#416`), 6 documents dont le geste Alignement doit refuser. La jouer a
  déjà servi : elle a fait tomber un item invérifiable, remplacé par trois rangs de tri
  mesurés sur les vrais titres.

## Contexte

### Ce que la mesure a corrigé dans le cadrage initial

Trois constats, tous mesurés sur `corpus_agrafes.WORKCOPY.db` (58 documents) ou lus au
code, ont changé le chantier avant qu'une ligne soit écrite.

**Le tableau de coût de la fiche était faux sur une ligne.** Il annonçait Segmentation
comme « front pur » via `segmented` de `GET /families`. Mais `segmented` vaut *« le
document a au moins une unité `line` »* (`sidecar.py:7378`) — vrai de tout document
importé : **57 sur 58**. Et `seg_count` est le même compte que `unit_count`, déjà à
l'écran en colonne « Unités ». Ce témoin aurait peint « fait » sur 57 lignes sur 58. Le
segmenteur supprime puis réinsère des unités `line` (`segmenter.py:789-797`) : **rien
n'est persisté** qui sépare un texte brut d'un texte découpé. Le seuil retenu est donc
celui qu'utilise déjà le bandeau du canvas — `unit_count ≤ 1` — et non `segmented`.

**La curation avait déjà son état, dans une table que la fiche ne regardait pas.**
`prep_action_history` (migration 019) porte `doc_id NOT NULL`, `performed_at`,
`action_type='curation_apply'` et `reverted`, avec l'index `idx_prep_action_doc_type` déjà
posé. Elle est écrite **par le moteur**, sur les deux portées : `curate_all_documents`
rappelle le même recorder par document, donc une curation corpus-large crédite chaque
document séparément (`curation.py:400-417`). C'est exactement ce que
`curation_apply_history` (migration 007) ne sait pas faire — son `doc_id` est NULL dès la
portée « tout le corpus » — et elle n'est écrite qu'à la demande du front : **1 ligne**
dans la base de travail, contre **5** dans l'autre. D'où : pas de migration, un champ
dérivé, mesuré à 0,6 ms.

**`GET /families` ne pouvait pas porter l'alignement.** Il ne connaît que les documents en
famille ; **6 sur 58** sont isolés et y seraient simplement absents, donc muets. D'où
`aligned_count` servi par `/documents`, dérivé de `alignment_links` dans les deux sens,
mesuré à 3,2 ms sur 14 577 liens.

Répartition mesurée des états, qui a décidé de ce qui méritait une colonne : brut 1/58,
annoté 5/58, aligné 21/58, validé 31/58, borne posée 6/58, hiérarchie ¶ 6/58 — contre
`segmented` à 57/58.

### Ce qui a été écrit

| fichier | rôle |
|---|---|
| `services/documents_service.py` | `curated_at` + `aligned_count`, dérivés, jamais d'exception si les tables manquent |
| `services/curate_service.py` | `apply_recorder` — le recorder d'undo que les **deux** chemins de curation construisent (1.6.87) |
| `sidecar_contract.py` + `docs/openapi.json` | contrat 1.6.85 (snapshot des chemins inchangé : champs additifs) |
| `docs/SIDECAR_API_CONTRACT.md` | les deux champs documentés sous `GET /documents` |
| `lib/actionsHubState.ts` | **neuf** — le modèle en fonctions pures : `stepState`, `docsForStep`, `stepCounts`, `docBadges` |
| `lib/actionsHubTemplate.ts` | réécrit : carte de tête retirée, cartes-filtres, bandeau de filtre |
| `screens/ActionsScreen.ts` | `_paintHubCards`, `_setHubFilter`, `_docRow`, `_openStepOnDoc`, `_familyRootFor`, `_ensureRelations` |
| `ui/app.css` | pastilles, cartes-filtres, colonne de gestes ; 3 règles mortes retirées |
| tests | `actionsHubState.test.ts` (14), `ActionsScreen.hubFilter.test.ts` (9), `test_documents_service.py` (+7) |

### Coût mesuré, attribué

`GET /documents` sur la base réelle (58 documents) : `_derived_doc_state` (les deux
champs neufs) coûte **3,7 ms**, contre **140 ms** pour `stale_doc_ids`, préexistant. Les
états rendus correspondent exactement aux mesures faites en base avant d'écrire :
1 document curé, 21 alignés, 1 brut, 5 annotés.

### Un point resté ouvert par construction

L'alignement se travaille **par famille**, pas par document : le geste d'une ligne doit
donc remonter du document à sa racine de famille, ce qui demande `getAllDocRelations`.
L'appel est fait **au clic** et non à chaque affichage du hub. Un document isolé n'a
aucune famille à ouvrir : la ligne le dit par un toast plutôt que d'entrer dans la matrice
sur la famille précédemment sélectionnée. C'est le seul des quatre gestes qui puisse
refuser.
