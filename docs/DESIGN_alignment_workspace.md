# Note de design — Espace Alignement : la matrice éditable

> Statut : **intention de design — figé / ticket-ready (2026-07-08)**. Date : 2026-07-08.
> Contrepartie **front** du modèle figé [`DESIGN_source_anchored_alignment.md`](DESIGN_source_anchored_alignment.md)
> (moyeu · deux formes · matrice = livrable). Le modèle a tranché le *quoi* ; cette note pose le *comment on le manipule*.
> Dépendances / à confronter : [`DESIGN_alignment_curation_model.md`](DESIGN_alignment_curation_model.md)
> (verbes de curation, `bead_uid` K3), [`DESIGN_prep_text_canvas.md`](DESIGN_prep_text_canvas.md)
> (Alignement reste une **vue à part** du canvas), [`ROADMAP_REFONTE.md`](ROADMAP_REFONTE.md) §2.
> Écran actuel à refondre : [`tauri-prep/src/screens/AlignPanel.ts`](../tauri-prep/src/screens/AlignPanel.ts).

## 0. Ce qui a déclenché cette note

QA visuelle du 2026-07-08, retour utilisateur (verbatim) : *« beaucoup d'info et d'options, mais très peu
de praticité : on charge, on autoaligne, mais on doit aller dans les Paramètres pour choisir un autre mode
d'alignement, mais on ne sait pas lequel choisir ; pour confirmer un nouvel alignement… mais on ne peut pas
retarget si on n'a pas la bonne chose. C'est lourd. »*

Quatre irritants qualifiés séance tenante :

1. **Le mode d'alignement est planqué dans les Paramètres**, sans défaut assumé ni explication → choisir sans savoir quoi choisir.
2. **Le panneau est un outil d'*audit de liens*** (accepter/rejeter/statut/retarget/supprimer, ligne par ligne) : surface de révision exhaustive, pas un plan de travail.
3. **Le retarget promet une action qu'il ne peut pas tenir** : ses candidats sont `external_id`-only
   ([`sidecar.py:8253`](../src/multicorpus_engine/sidecar.py#L8253)) et un corpus aligné par longueurs/DP
   n'a **aucun `external_id` sur ses unités** (vérifié `LeCléziotest` : EN 0/7, FR 0/8, RO 0/8) → « Aucun
   candidat trouvé » **systématique**. Une action offerte mais morte érode la confiance dans tout le panneau.
4. **Surcharge** : beaucoup d'information *sur l'état des liens*, peu d'outils *pour produire le livrable*.

**Racine.** Le panneau vient de l'**ère des marqueurs** (aligner par `[N]`, réviser des paires). Le modèle
a basculé **ancré-source** (moyeu + traductions recoupées + matrice = livrable). *L'UI n'a pas suivi le modèle.*

## 1. Principe directeur — l'écran EST la matrice qu'on exporte

Aujourd'hui on **audite des liens abstraits** ; on veut **éditer le résultat**. Le nouvel espace affiche la
**matrice ancrée-source** (une ligne par segment du moyeu, une colonne par traduction, cf. le CSV prototype)
et **c'est cette grille qu'on manipule directement**.

**Invariant crucial (préserve D4 du modèle).** La matrice reste une **projection dérivée, jamais stockée**.
On n'édite pas des cellules « en base » : chaque geste sur une cellule **mappe vers une opération sur les
`alignment_links`** (couper / fusionner / ré-ancrer / marquer), puis **la matrice se re-projette**
(`build_alignment_matrix`). La grille est la *surface d'interaction* ; les liens restent la *source de vérité*.
→ Pas de staleness, pas de double modèle. La vue = le livrable ; les gestes = de la curation d'alignement.

## 1.1 Le point de départ — et ce que le panneau **ne** fait pas

**Entrée :** des **segments par langue, indépendants**. Chaque doc est segmenté selon les règles de *sa* langue
(`SegmentSpec`) — les segmentations ne se correspondent pas forcément (FR 8 phrases ↔ EN 7 parce que l'anglais
en a fusionné deux). Ce **désalignement est le travail**.

**Le panneau construit une couche additive ; il ne re-segmente pas.** Couper / fusionner / ré-ancrer agissent
sur la **couche d'alignement** (spans sur les liens, beads, correspondances), **jamais** sur les unités :
- la **forme documentaire** (les segments réels, indexés FTS pour le concordancier) reste **intacte** ;
- la **forme alignée** (la matrice) est une **projection** par-dessus, non-destructive et réversible.
La vraie re-segmentation *destructive* (`/units/split|merge` : renumérote + **droppe l'alignement** + ré-indexe
la FTS) appartient à la couche **Segmentation**, pas ici.

**Direction asymétrique :** l'original (moyeu) fait autorité (= les lignes) ; on **reshape les traductions**
pour qu'elles s'y collent. On ne recoupe/n'édite **jamais** le moyeu depuis ce panneau.

## 2. L'écran

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Moyeu : [FR — LeClézio ▾]   Traductions : [EN ✓] [RO ✓] [DE ✓]           │
│  [ ⚙ Aligner ]  (défaut intelligent)              12/14 alignés · 2 à voir │  ← barre : source + action + complétude
├────────┬──────────────────────┬──────────────────┬──────────────────┬─────┤
│ ¶ · seg│ FR (moyeu)           │ EN               │ RO               │ DE  │
├────────┼──────────────────────┼──────────────────┼──────────────────┼─────┤
│ 1 · 1  │ Du plus loin…        │ As far back…     │ DIN CELE…        │ …   │  ← ligne propre (1-1 partout)
│ 1 · 3  │ Je l'entends…    ⚠  │ I can hear it…▐  │ îl aud…          │ …   │  ← ⚠ cellule EN fusionnée (couvre seg 3+4)
│ 1 · 4  │ Le bruit lent…   ⚠  │ …breaking ▐(même)│ Zgomotul lent…   │ …   │     → geste inline « ✂ Couper »
│ 2 · 6  │ Je pense à elle…     │ [non traduit]    │ Mă gîndesc…      │ …   │  ← cellule vide → marquer / à réparer
└────────┴──────────────────────┴──────────────────┴──────────────────┴─────┘
```

- **Barre de tête** : (a) le **moyeu** (original) explicite et changeable ; (b) les **traductions** de la
  famille en colonnes cochables ; (c) **un seul bouton « Aligner »** ; (d) **l'indicateur de complétude**.
- **La grille** : lignes = segments du moyeu (`¶ · seg` = grain paragraphe ⊃ phrase), colonnes = langues.
  Chaque cellule = la tranche de traduction alignée à ce segment (coupes appliquées, beads concaténés — la
  projection du §5 du modèle).
- **Les cellules « à réparer » se signalent elles-mêmes** (⚠) : une cellule **partagée entre deux lignes
  moyeu** (traduction fusionnée) ou **vide** (non traduit / trou d'alignement) ou **orpheline** (traduction
  sans ligne moyeu = *ajout*). Le repérage visuel **remplace** la lecture d'un tableau de statuts.

## 2.1 Passage à l'échelle — nombre de langues **non borné**

Le nombre de langues est **ouvert**. Un corpus réel monte déjà à **7** (VO + traductions), et **rien
n'interdit d'en ajouter davantage** — l'outil ne doit **jamais plafonner l'affichage sur un petit N**. Du
**texte plein sur N colonnes** devient vite illisible (largeur ÷ N). La mock du §2 est donc le **mode focus**
(1-3 langues en plein texte), jamais le défaut. Levier : **un geste agit sur une seule cellule (segment ×
langue)** → on n'a jamais besoin des N textes complets simultanément pour éditer. D'où **deux échelles de
lecture, l'une et l'autre insensibles à N** :

- **Vue d'ensemble = *santé*** (défaut, scalable à 7). Moyeu **figé** à gauche + N colonnes **étroites** = un
  **pictogramme d'état par cellule** (✓ 1-1 · ⚠ fusion · ∅ vide · ＋ ajout), pas le texte. On scanne l'état
  des 7 langues d'un coup d'œil et on repère les ⚠. C'est aussi ce qui alimente l'indicateur de complétude.

```
  ¶·seg │ FR (moyeu, texte)         │EN│RO│DE│ES│IT│SV│…│  ← colonnes = état, étroites ; N ouvert (…)
  1 · 1 │ Du plus loin…             │✓ │✓ │✓ │✓ │⚠ │∅ │
  1 · 3 │ Je l'entends…             │⚠ │✓ │✓ │✓ │✓ │✓ │   ← ⚠ EN : clic → détail empilé
  2 · 6 │ Je pense à elle…          │∅ │✓ │＋│✓ │✓ │✓ │
```

- **Détail = *empilé*** (édition, lisible à N). Cliquer une **ligne moyeu** (ou une cellule ⚠) déplie le
  segment : le texte du moyeu + ses **N traductions empilées verticalement** (une langue par ligne, pleine
  largeur), là où se font les gestes. À 7 langues ça descend, ça ne se comprime jamais.

```
  ▼ 1 · 3   FR  Je l'entends maintenant, au plus profond de moi, je l'emporte partout où je vais.
            EN  ⚠ I can hear it now, deep inside me; it will come with me wherever I go: …   [✂ Couper]
            RO  ✓ îl aud şi acum în adîncul fiinţei mele…
            DE  ✓ …
            …
```

- **Un sélecteur de langues** (chips) est **de première classe** dès que N grandit : il choisit quelles
  langues sont **colonnes visibles** (état ou plein texte), les autres restant repliées. À N élevé, l'overview
  ne montre pas mécaniquement N colonnes — moyeu **sticky** + défilement horizontal des colonnes d'état
  étroites, et/ou une **colonne de synthèse** par ligne (`5✓ 1⚠ 1∅`, indépendante de N).
- **Le moyeu (VO) est la colonne d'ancrage figée** (sticky) dans les deux vues. **L'export produit toujours
  les N langues**, quel que soit l'affichage (la matrice complète ≠ ce qu'on affiche).

→ Le « nombre de langues affichables » n'est plus un plafond : l'**overview** encaisse un **N arbitraire**
(état + synthèse + sélecteur + défilement), l'**édition** se fait au **segment** (empilé, vertical) ou à la
**paire** (moyeu × 1 langue) — les deux **insensibles à N**.

## 2.2 La structure dans la matrice — le squelette parallèle

La **structure** (`unit_type='structure'` : titres, chapitres, intertitres — rôles péritextuels T/Ch/InterT ;
**préservée, non indexée FTS**) n'est pas du contenu-ligne, mais elle **encadre** le contenu. Sa place dans la
matrice : des **lignes-section pleine largeur** (le titre de chapitre, l'intertitre) qui **regroupent** les lignes
de contenu en dessous — et qui sont **elles-mêmes multilingues** (un titre a ses traductions).

**Insight unificateur :** la matrice n'est pas que du contenu, c'est le **squelette + le contenu parallèles**.
Deux sortes de lignes, deux mécanismes d'alignement, **une seule grille**, **une seule logique** ⚠/complétude :

| Ligne | Grain | Alignée par | Rendu |
|---|---|---|---|
| **Structure** (T/Ch/InterT) | squelette (chapitre/section) | le **structure matcher** (chapitre ↔ chapitre) | ligne-section pleine largeur, regroupe |
| **Contenu** (phrases) | phrase ⊂ ¶ | l'**aligneur de phrases** (longueurs/DP) | lignes de la matrice |

Une structure non appariée = ⚠, exactement comme une cellule vide.

**Le point qui la range (D-W11).** La structure **n'est pas encore réimplémentée au canvas** (ops
insert/delete/zone/propagate **+ le structure matcher** restent legacy, R5.4d différé). Or **le structure matcher
est un alignement cross-lingue** — il a une affinité naturelle avec **cet** espace, pas avec la couche
Segmentation. Cohérent avec §4.1 : **éditer** la structure (insert/delete) = round-trip vers Segmentation ;
**aligner** la structure entre langues = ici. Reste à trancher le scope v1 (D-W11).

## 2.3 Les grains — une matrice hiérarchique repliable (structure ⊃ ¶ ⊃ phrase)

Le contenu a **deux grains** (¶ ⊃ phrase, modèle 2-grain), et la structure (§2.2) coiffe le tout. La matrice est
donc une **hiérarchie repliable : structure ⊃ paragraphe ⊃ phrase.** Même grille, mêmes gestes, même logique
⚠/complétude **à chaque grain** — seul le mécanisme d'alignement change (structure matcher / aligneur ¶ /
aligneur de phrases). L'« Aligner » de base est **déjà hiérarchique 2 étages** (R3.2, `gale_church.py`) : il
produit les deux grains en une passe, rien de plus à lancer.

**Pourquoi le ¶ compte :** les **paragraphes s'alignent bien plus fiablement que les phrases** (un ¶ FR ↔ un ¶ EN,
même quand les phrases *dedans* fusionnent/éclatent). Le ¶ est donc l'**ancre stable** ; l'essentiel du travail
fin ne concerne que les **quelques** ¶ où la phrase a dérapé.

**Conséquence UX (révise D-W4) :** défaut **replié au ¶**, avec le **⚠ qui remonte** (un ¶ est ⚠ si une phrase
dedans l'est). On **déplie** les ¶ marqués ⚠ pour corriger leurs phrases ; les ¶ propres restent repliés — comme
un arbre de fichiers : compact, l'attention va où il y a du travail (et ça allège aussi le nombre de lignes). Les
**gestes valent à chaque grain** : couper un ¶ que la trad a fusionné, ré-ancrer un ¶, marquer un ¶ non traduit…

## 3. La grammaire de gestes (peu nombreux, tous lisibles)

Chaque geste agit **sur la cellule/traduction**, jamais sur le moyeu (cf. modèle : on ne recoupe pas l'original).

| Geste | Quand | Effet sur les liens | Moteur | État |
|---|---|---|---|---|
| **✂ Couper** | une cellule couvre 2 lignes moyeu (traduction a fusionné) | `set_target_span` ×N (sous-spans) | ✅ existe | **livré** (B1/B2) |
| **⭙ Fusionner** | 2 cellules = éclats d'une même traduction (traduction trop fine) | `set_bead`/`clear_bead` (socle K3 `bead_uid`) | 🔲 socle prêt | à faire |
| **⇲ Ré-ancrer** | une cellule est sur la mauvaise ligne moyeu | retarget du lien, **candidats positionnels** | 🔲 fallback à ajouter | à faire (voir §3.1) |
| **∅ Non traduit** | cellule sans traduction (voulu) | statut **par cellule** `alignment_cell_statuses` (mig 028, D-W8 résolu) | 🔲 table + setter | en cours (§3.3) |
| **＋ Ajout** | traduction sans ligne moyeu (ajout du traducteur) | `unit_status='ajout'` → ligne en flux `[ajout]` (D8) | ✅ axe existe | en cours (§3.3) |

> L'audit **accepter/rejeter/statut par lien** ne disparaît pas : il devient un **mode secondaire**
> (« Révision fine ») pour qui veut valider paire par paire, pas la surface primaire.

### 3.1 Ré-ancrer sans marqueurs (le fix du retarget)

Le retarget doit **cesser d'être `external_id`-only**. Fallback **positionnel** quand les `external_id`
manquent (le cas normal post-refonte) :

- ancrer sur la **position** (`n`, ordre du segment) de la cible actuelle du lien ;
- proposer les cibles **voisines ±fenêtre par ordre** (`ORDER BY n`), score `1/(1+Δpos)` ;
- garder la priorité `external_id` **quand elle existe** (rétro-compatible).

C'est un endpoint de **lecture** (`/align/retarget_candidates`) → **pas de migration ni de contrat**, juste
une meilleure heuristique + tests. Côté front, l'en-tête du picker devient explicite : *« Nouvelle cible {LANG}
pour [§N] »* (aujourd'hui « Recibler : \<texte source\> » n'indique pas qu'on choisit une cible), et un
empty-state utile plutôt que « Aucun candidat trouvé » muet. *(Idéalement, ré-ancrer = **glisser la cellule**
vers la bonne ligne ; les candidats positionnels sont le repli clavier/liste.)*

## 3.2 Présentation du geste **Couper** (tranché 2026-07-08)

Deux panneaux — inspiré de l'outil de segmentation legacy ([`SegmentationView.ts:1044`](../tauri-prep/src/screens/SegmentationView.ts#L1044)),
**mais** ni destructif ni éditable :
- panneau haut = début, panneau bas = fin ; une **suggestion** de coupe pré-remplie qu'on ajuste ; aperçu = les
  **deux tranches** = les deux cellules de la matrice qu'on obtiendra.
- on **déplace** le texte entre les panneaux (couper-coller) ou on clique/glisse le point de coupe — **on ne
  tape jamais**.
- **garde-fou de conservation** : `panneau_haut + panneau_bas == texte d'origine` (rejet si un caractère a été
  ajouté/modifié) → reste **verbatim**, stockable en offsets `set_target_span` (non-destructif, réversible).

**Écarté :** le ✂-entre-chaque-mot (précis mais bruité, ne prévisualise rien) ; et l'**édition libre** (= la
sémantique legacy `text_a/text_b` : casse le verbatim **et** la projection D4 ; ré-indexerait/divergerait de la
source). Corriger *les mots* d'une traduction est un **autre geste** (couche texte/curation), hors alignement.

**Granularité :** coupe **contiguë** (un point) = le cas à 90 %, couvert par le modèle offset actuel. Coupe
**non-contiguë** (trad réordonnée : déplacer un morceau du milieu) = plusieurs plages par cellule → petit
surcoût moteur (stocker une **liste** de spans, pas juste `[start,end]`) → **à confirmer si besoin réel (D-W9)**.

## 3.3 Lignes blanches — **non traduit** & **ajout**

Deux formes d'asymétrie, toutes deux portées par l'axe `unit_status` (mig 023 : `NULL`=traduit ·
`non_traduit`=**unité source** non traduite · `ajout`=**unité cible** ajoutée) :

- **∅ Non traduit** — un segment moyeu sans traduction *voulue* (pas un trou à réparer). La cellule affiche
  **`[non traduit]`** (grisé), **distinct** d'une cellule « pas encore alignée », et **compte comme fini** dans
  la complétude.
- **＋ Ajout** — du contenu de traduction **sans source moyeu** (ajout du traducteur) → une **ligne `[ajout]`
  en flux** dans la matrice, rattachée là où elle survient.

**Comment on le pose.** Aujourd'hui : marqueurs inline `[non traduit]`/`[+]` dans le texte source → **lift**
(`lift-markers`, [`marker_lift.py`](../src/multicorpus_engine/marker_lift.py)) → `unit_status`, ou CLI
`curate --unit-status`. Dans le nouvel espace : un **geste sur la cellule/ligne** (« ∅ Non traduit » / « ＋
Ajout ») qui pose le statut — réutilise l'axe existant, juste un petit **setter**.

**D-W8 résolu (2026-07-10) : par cellule, direct — l'étalement « global d'abord » est abandonné.** Les familles
réelles sont N-langues (FR + EN + RO) : « EN omet, RO non » est le cas normal, un geste qui marquerait toute la
ligne serait un piège, et les écritures globales intermédiaires resteraient ambiguës après coup. Mécanique :
une petite table **`alignment_cell_statuses (pivot_unit_id, target_doc_id, status)`** (mig 028 ; enum validé au
service comme mig 023, v1 = `non_traduit` seul) + un setter **`POST /align/cell_status`** (`status: null` =
effacer ; **garde** : refus si la cellule a des liens actifs — marquer « non traduit » une cellule traduite est
contradictoire). Le `unit_status` **global** existant (marker-lift, unité moyeu) n'est **pas** réécrit : la
projection lit **les deux axes** — global ⇒ toute la ligne `[non traduit]`, par-cellule ⇒ la cellule seule.
Dans les deux cas la cellule affiche le **token `[non traduit]`** (D10, jamais vide) et **compte comme faite**
(D-W5).

**Les unités non couvertes deviennent visibles (D-W14, tranché 2026-07-10).** Une unité de traduction sans
lien n'apparaît aujourd'hui **nulle part** dans la matrice : impossible d'invoquer « ＋ Ajout » sur de
l'invisible, et la complétude ment tant que ces unités restent cachées. La projection expose donc, **par
colonne de traduction**, la liste des unités `line` sans lien actif et sans statut (`uncovered`, champ additif) ;
la grille affiche un **compteur par en-tête de colonne** qui ouvre un **panneau** listant ces unités — c'est de
là qu'on invoque « ＋ Ajout » (pose `unit_status='ajout'` via `/units/bulk_set_status`, la ligne `[ajout]`
apparaît en flux, ↺ sur la ligne pour l'effacer). Une unité marquée `ajout` ou `non_traduit` sort du compteur.

## 3.4 Gestes **à la demande** sur toute cellule + « couper à cheval » (tranché 2026-07-10, QA 3b — **livré** le jour même : A2 `cell_links`/statut topologique + batch `atomic` 1.6.54 + geste à cheval, commits `4d8de0c`→`c946b08`)

**Constat déclencheur (Le Clézio, QA tranche 3b).** L'aligneur produit un bead 2→2 positionnel
FR§1↔EN1, FR§2↔EN2 alors que la bonne correspondance est FR§1 ↔ *début* d'EN1, FR§2 ↔ *fin* d'EN1 + EN2.
Les deux cellules EN ont des textes différents : **ni l'heuristique texte actuelle, ni la future détection
topologique** (les deux liens sont un plausible 1-1 + 1-1) ne signaleront jamais ce décalage — seul l'humain
qui *lit* la matrice le voit. Attendre le ⚠ pour agir = être pris au dépourvu.

**Décision (D-W12) : les gestes sont invocables à la demande sur n'importe quelle cellule.** Le ⚠ *priorise
l'attention*, il ne *conditionne pas l'accès*. Rationale : la couche d'alignement est une **surcouche non
destructive et réversible** (liens + offsets, projection D4 — l'unité n'est jamais re-segmentée) → le coût
d'une erreur de geste est faible (↺ / `clear_target_span` / delete) → restreindre l'accès à la détection
n'apporte rien et bloque le cas réel. La **segmentation destructive** (`/units/split|merge`), elle, reste
derrière son garde-fou (D-W10). Corollaire sur la complétude (précise D-W5) : « plus de ⚠ » reste le signal
« fini », mais s'affiche comme une *aide*, pas un verdict — un 100 % n'est pas une preuve d'alignement juste.

**Cascade assumée.** Corriger une cellule fait émerger les décalages d'aval qui « semblaient bons » par
appariement positionnel (le décalage se propage jusqu'à ce que la traduction re-synchronise ses frontières).
Le flux de travail à supporter est donc **descendre le texte de proche en proche** : après chaque geste,
re-projection immédiate + curseur conservé (§4.1), la cellule suivante est à un geste de distance. C'est un
argument de plus pour des gestes bon marché et locaux, pas des assistants globaux.

**Nouveau geste : « ✂ Couper à cheval »** (extension du Couper §3.2) — une cellule *non ⚠* contient du
contenu appartenant au segment moyeu voisin (au-dessus ou en-dessous) :

- **Mapping primitives (existantes)** : (1) créer le lien manquant `moyeu_voisin → cible` (create/retarget
  selon l'état), (2) `set_target_span` ×2 sur les deux liens vers cette cible — tête au segment du haut,
  queue au segment du bas. Une éventuelle autre cible du segment d'arrivée reste en place (sa cellule devient
  « queue + autre cible » concaténées — la projection sait déjà rendre ça).
- **Présentation** : le même picker 2 panneaux §3.2, ouvert depuis n'importe quelle cellule via
  « ✂ Couper vers le segment précédent / suivant » ; mêmes contraintes (frontières de mots viables,
  coupe contiguë D-W9, verbatim, réversible).
- **Précondition moteur : A2 (link_ids par cellule dans `/align/matrix`)** — sans quoi le front ne peut pas
  résoudre les liens d'une cellule non signalée de façon fiable (la résolution actuelle dépend de la
  détection). Ordre : **A2 → D-W12**.
- **Atomicité** : le geste composé (création de lien + 2 spans) **exige un batch tout-ou-rien** — le commit
  partiel actuel de `/align/links/batch_update` (finding F2 de la revue 3b) devient inacceptable ici ;
  trancher F2-fond (transaction moteur) *avant* ou *avec* ce geste, et l'undo doit défaire les deux
  opérations ensemble.

## 3.5 D-W13 — Coupe **itérative** (fenêtrée) + ↺ depuis la cellule (tranché 2026-07-10, QA D-W12)

**Constat déclencheur.** (a) Une phrase cible couvrant 3+ segments moyeu est inexprimable par gestes : le
garde « déjà coupée » interdit de re-couper une tranche, et la fusion N-1 est refusée (« 2-1 seulement »).
(b) L'annulation d'une coupe à cheval réussie n'a pas de geste : le ↺ de la Révision fine ne défait que les
tranches du bead d'origine et **ignore le lien manuel créé** (état incohérent si on l'utilise seul). (c) Le
lien créé arrive avec `external_id=0` → il s'affiche « [§0] » en tête de la Révision fine, hors de l'ordre
de lecture, comme si le geste n'avait pas été intégré.

**Décisions :**

- **Couper opère toujours dans la FENÊTRE courante du lien** (`[target_char_start, target_char_end]`,
  le texte entier n'étant que le cas `[0, len]`). Le garde « déjà coupée » disparaît ; les coupes
  s'itèrent (une phrase en 3 morceaux = 2 gestes). Offsets viables et picker sont fenêtrés (les mots de
  la tranche seulement, offsets absolus).
- **Fusion N-1 par partitions successives.** ⚠ *fused* devient : cible partagée à fenêtres **identiques**
  (le non-coupé `[null,null]` en est un cas). Couper depuis une cellule ⚠ = poser la frontière **entre
  cette ligne et la précédente** : les lignes du groupe au-dessus prennent `[ws,x]`, la ligne cliquée et
  celles d'en dessous `[x,we]` — le bas reste fusionné (fenêtres identiques) et se re-coupe au geste
  suivant. Le geste par paire reste le seul primitif ; N-1 = N-1 gestes.
- **↺ depuis la cellule = « cette traduction redevient entière »** : sur toute cellule dont les liens
  portent une tranche, un ↺ efface les tranches de **tous** les liens de cette cible (toute la colonne)
  et **supprime ceux créés par geste** (`run_id='manual'`) — l'inverse exact de la séquence de coupes,
  en un batch atomique (`clear_target_span` ×N + `delete` ×M). Sémantique volontairement globale à la
  cible : pas de « défaire juste la dernière frontière » en v1. **Cellule à plusieurs coupes** (amendé
  2026-07-10, QA : forme mixte queue+tête) : un **mini-choix** sur place liste les traductions coupées
  de la cellule (extrait de tranche) et l'utilisateur désigne laquelle annuler — pas de devinette.
- **Le lien créé hérite de l'`external_id` du lien qu'on coupe** (paramètre optionnel additif sur
  `/align/link/create`) → il se range à côté de son frère dans la Révision fine. Le *regroupement*
  visuel « tranches d'une même cible » dans le panneau est différé à la refonte Révision fine (tranche 6).
- **Cellule à plusieurs traductions : le sens désigne le lien de bord** (amendé 2026-07-10, QA D-W13 —
  la forme mixte « queue + phrase propre » est la norme, pas l'exception). « Vers le suivant » coupe le
  **dernier** lien de la cellule (ordre de lecture), « vers le précédent » le **premier** — seul un lien
  au bord peut déborder la frontière. Pousser un lien *par-dessus* un autre = réordonnancement
  (non-contigu, D-W9) → hors v1, Révision fine.
- **Moteur, additif** : `cell_links` expose en plus `external_id` et `manual` (bool, `run_id='manual'`) ;
  contrat **1.6.55** (champ de schéma sur AlignLinkCreateRequest). Le reste est front.

## 4. Les quatre douleurs → réponses

| Douleur | Réponse dans cet espace |
|---|---|
| **Choix du mode** planqué/opaque | Bouton **« Aligner »** à **défaut assumé** (longueurs/DP, 90% des cas) ; le mode = repli **« Avancé »** dépliable, pas un prérequis. Un lien « pourquoi/quel mode ? » documente le choix. |
| **Réparer un mauvais appariement** | Geste **Ré-ancrer** avec **candidats positionnels** (§3.1) — l'action redevient tenable sans marqueurs. |
| **Savoir quand j'ai fini** | **Indicateur de complétude** en tête : `X/Y segments moyeu alignés 1-1 · Z à réparer` ; les Z sont exactement les cellules ⚠. « Fini » = plus de ⚠. |
| **Surcharge d'options** | La grille **montre le résultat** ; les gestes sont **contextuels** à la cellule (⚠ → propose le bon geste). L'audit par lien recule en mode secondaire. |

## 4.1 Navigation inter-couches — round-trip vers Segmentation / Curation

Pendant l'alignement on repère parfois un problème qui **n'est pas** un problème d'alignement. **Trois cas,
trois réponses de coût croissant** — et c'est le modèle (§1.1) qui dicte lequel :

1. **Problème d'alignement** (fusionné / éclaté / mal apparié) → **geste sur place** (Couper / Fusionner /
   Ré-ancrer). On ne quitte pas le panneau. *(édite la couche d'alignement)*
2. **Problème de texte** (artefact d'import, mauvais caractère, `<hi>` résiduel) → **édition inline** de la
   cellule, qui écrit dans **l'unité** (forme documentaire, [`/units/update_text`](../src/multicorpus_engine/sidecar.py)) :
   l'`unit_id` reste **stable** → **l'alignement survit**, la matrice **se re-projette** avec le texte corrigé.
   Léger, **sans quitter l'écran**. *(édite la forme documentaire, pas l'alignement)*
3. **Problème de segmentation** (la découpe elle-même est fausse, y compris pour la recherche) → **round-trip**
   vers la couche Segmentation. Seul cas **destructif** : re-segmenter **droppe l'alignement** du doc
   (`/units/split|merge`). Donc **garde-fou** (« cette correction re-segmente et redéfait l'alignement de ce
   segment — continuer ? »), **saut avec contexte** (Segmentation focalisée sur cette unité), **retour au même
   endroit** avec ré-alignement/re-projection de la portion touchée (**D-W10**).

**Invariant (les 3 cas) — préservation du contexte.** On mémorise le **curseur d'alignement** (segment moyeu
courant, scroll, langue sélectionnée) avant tout saut/refresh, et on y **revient** après, **données actualisées**
(re-fetch de l'audit / re-projection de la matrice). « Revenir là où on en était » n'est pas une option, c'est
une **garantie**. → C'est aussi ce qui relègue le besoin d'« éditeur inline de curation » (queue R5.3) **dans**
le flux d'alignement, au bon moment.

## 5. Frontière moteur ↔ front + coûts

Suivant la discipline §4 de la roadmap (chaque item tagué, contrat/migration porté).

- **Déjà en place (réutilisé tel quel).** `build_alignment_matrix` (projection, C1) · `set_target_span`/
  `clear_target_span` (Couper) · `unit_status` non_traduit/ajout (mig 023) · `bead_uid` K3 (socle fusion) ·
  aligneur longueurs + `replace_existing` (garde-fou du footgun §0 du modèle).
- **Moteur neuf, additif.** (a) **Ré-ancrer positionnel** — heuristique dans `/align/retarget_candidates`,
  *lecture, pas de contrat/migration*. (b) **Fusionner** — action `set_bead`/`clear_bead` sur
  `/align/links/batch_update` (réutilise le socle K3), *additif au contrat*. (c) éventuel **endpoint de
  complétude** (ou calcul front à partir de l'audit + `unit_status`).
- **Front (le gros).** Le rendu grille-matrice éditable (nouvel écran ou refonte profonde d'`AlignPanel`),
  les gestes contextuels, la barre moyeu/traductions/Aligner/complétude, le repli « Avancé » du mode, le
  mode « Révision fine » secondaire. **Pur front**, mais volumineux → tranches (§6).

## 6. Ordre de livraison (proposé)

Front-pur et bas risque d'abord, additif ensuite ; jamais sur le corpus réel (WORKCOPY).

1. **Fix ré-ancrer** *(moteur lecture + front picker)* — candidats positionnels + en-tête/empty-state clairs.
   Débloque une douleur **sans** attendre la refonte. *(Petit, autonome.)*
2. **Grille-matrice en lecture** *(front)* — afficher la matrice éditable-à-venir en **lecture seule** (réutilise
   `build_alignment_matrix`), avec le repérage ⚠ des cellules à réparer + l'indicateur de complétude. *(Voir sans risque.)*
3. **Gestes inline sur la grille** *(front, moteur déjà là)* — Couper (déjà livré) branché **depuis la cellule** ;
   Non traduit / Ajout câblés sur `unit_status`.
4. **Fusionner** *(moteur `set_bead` + front)* — le geste manquant du modèle.
5. **Barre Aligner à défaut assumé + mode « Avancé »** *(front)* — sortir le mode des Paramètres.
6. **Mode « Révision fine » secondaire** *(front)* — reléguer l'audit par lien actuel.

## 7. Décisions tranchées (2026-07-08)

Toutes validées ; la note est **ticket-ready**. (Rationale : voir les § référencés.)

- **D-W1 → Nouvel écran.** Grille-matrice trop différente du bitexte pour muter proprement `AlignPanel`, qui
  devient le mode **« Révision fine »** (§8). Isole le risque.
- **D-W2 → Unité d'interaction = la cellule** (moyeu × langue). C'est ce qui rend l'écran insensible à N.
- **D-W3 → Ré-ancrer : liste de candidats *positionnels* en v1** ; glisser-déposer = amélioration ultérieure. *(= tranche 1)*
- **D-W4 → Défaut replié au ¶**, ⚠ qui remonte ; hiérarchie **structure ⊃ ¶ ⊃ phrase** repliable, gestes à chaque grain (§2.3).
- **D-W5 → Complétude = cellules non-⚠ / total** ; un `non_traduit` *voulu* compté **comme fait** (pas un trou). « Fini » = plus de ⚠.
- **D-W6 → Alignement reste une vue à part** (cross-lingue, pas mono-doc ; hors canvas texte).
- **D-W7 → Défaut = overview *santé*** (pictogrammes + synthèse, insensible à N) ; **édition = détail empilé** (segment × N) ; **sélecteur de langues première classe** ; la paire reste un focus (§2.1).
- **D-W8 → « Non traduit » par cellule** (moyeu × doc cible), via un marqueur sur la paire. *Résolu 2026-07-10 :* **par-cellule direct** (table `alignment_cell_statuses`, mig 028 + `POST /align/cell_status`), l'étalement « global d'abord » est abandonné ; la projection lit les deux axes (§3.3).
- **D-W9 → Coupe contiguë en v1** (un point, modèle offset actuel) ; non-contiguë = extension différée si un cas réel l'exige (§3.2).
- **D-W10 → Round-trip en overlay/tiroir** (garde l'alignement visible) ; après re-segmentation, **marquer les lignes « à ré-aligner »** (pas de re-align silencieux) (§4.1).
- **D-W11 → Structure en scaffolding lecture seule en v1** ; **structure matcher folded-in en tranche ultérieure** — mais sa maison est **actée ici** (pas Segmentation) (§2.2).
- **D-W12 → Gestes à la demande sur toute cellule** (tranché 2026-07-10, QA 3b) : le ⚠ priorise, il ne conditionne pas l'accès — la couche d'alignement est une surcouche réversible, la main est donnée partout ; + geste « ✂ couper à cheval » sur le segment voisin. Précondition A2 (link_ids par cellule) et batch tout-ou-rien (F2-fond). Cascade de corrections assumée (§3.4).
- **D-W13 → Coupe itérative fenêtrée + ↺ cellule** (tranché 2026-07-10, QA D-W12) : couper opère dans la fenêtre courante du lien (itérable, N-1 par partitions successives, ⚠ = fenêtres identiques) ; ↺ cellule = la cible redevient entière (tranches effacées + liens `manual` supprimés, atomique) ; le lien créé hérite de l'`external_id` du lien coupé (§3.5).
- **D-W14 → Unités non couvertes visibles** (tranché 2026-07-10) : la projection expose par colonne les unités cible sans lien actif ni statut (`uncovered`) ; compteur en en-tête de colonne → panneau → geste « ＋ Ajout ». Sans cette surface, ＋ est ininvocable et la complétude ment (§3.3).

**Prochain :** cf. §6. **Tranche 1 = D-W3 (ré-ancrer positionnel)** — autonome, endpoint de *lecture*, sans contrat ni migration.

## 8. Ce qu'on garde / relègue de l'`AlignPanel` actuel

- **On garde (déplacé en « Révision fine ») :** accepter/rejeter/statut par lien, panneau **Collisions**,
  **Qualité**, audit incrémental (`audit-more`).
- **On refond :** la surface primaire (tableau de liens → grille-matrice), le retarget (candidats positionnels
  + libellé), l'accès au mode (Paramètres → barre « Aligner/Avancé »).
- **On ajoute :** indicateur de complétude, repérage ⚠ des cellules, gestes Fusionner / Non traduit / Ajout inline.
