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
- [ ] **Jouer la passe `qa/actions-action-dabord.md`** — écrite le 31 août (50 points,
      7 zones), pas encore jouée. Rien n'a été VU tourner : tout est vérifié par tests
      (1295 vitest prep, 79 shell, 34 pytest du service) et par mesure en base, pas à
      l'œil. **Le sidecar doit être reconstruit avant** — celui en place date du 28 août
      et ignore les deux champs neufs ; sans ça la passe mesure un binaire périmé et
      annonce « 58 à faire » partout. Le préambule de la passe porte la commande et le
      contrôle `/health` (`contract_version` = 1.6.85)
- [ ] **Le chemin asynchrone de la curation n'enregistre rien** — trouvé en chemin, hors
      périmètre, non corrigé. `POST /jobs/enqueue kind=curate` appelle `curate_document` /
      `curate_all_documents` **sans** `record_action` (`sidecar.py:9998-10009`), là où
      `POST /curate` le passe (`sidecar.py:4100-4110`). Conséquence double : une curation
      lancée par ce chemin n'est **pas annulable** (Mode A) et n'apparaîtra pas dans
      `curated_at`. Le front vivant n'emprunte que le chemin synchrone (`CurationPane`
      appelle `curate()`), donc l'écran est juste aujourd'hui — mais le trou est réel
- [ ] **`curated_at` dira « 57 à faire » sur le corpus réel, et c'est exact au sens
      strict** — vérifié en faisant tourner `list_documents` sur la base de travail en
      lecture seule : 1 document sur 58 porte un `curated_at`. Trois raisons cumulées, à
      trancher : `prep_action_history` est **forward-only** (migration 019 — une curation
      antérieure n'a laissé aucune trace) ; le chemin asynchrone n'enregistre rien (item
      ci-dessus) ; un apply sans effet n'écrit pas de ligne. La carte est donc juste sur
      « ce texte a-t-il été modifié par la curation », et trompeuse si on la lit « ce
      document a-t-il été relu ». À décider : garder tel quel, ou ne compter la curation
      que sur les documents importés après la migration 019
- [ ] **`fts_readable` n'est pas documenté dans `SIDECAR_API_CONTRACT.md`** — trouvé en
      ajoutant les deux champs voisins, qui y sont maintenant. Le champ date de 1.6.84
      (FTS-01) ; le test `test_contract_docs_sync` ne l'exige pas, d'où l'oubli. Une ligne
      à ajouter sous `GET /documents`, à porter par FTS-01 plutôt qu'ici

## QA

- qa/actions-action-dabord.md — écrite, **jamais jouée**. Elle vérifie ce qu'aucun test
  unitaire ne prouve : que l'état affiché correspond au document en base, que le filtre et
  la vue hiérarchie se composent sans se contredire, et que la colonne de gestes tient à
  l'écran. Ses comptes attendus sont mesurés sur la base de travail, pas estimés —
  57/1/37/53 sur les cartes, 17 pastilles « Index périmé », une seule ligne « Rien à
  faire » (`#416`), 6 documents dont le geste Alignement doit refuser.

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
