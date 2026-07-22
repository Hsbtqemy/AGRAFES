# DESIGN — Retrait de `SegmentationView` & décomposition du structure matcher

> Note de cadrage (« figer avant ticket »). Rédigée 2026-07-22.
> **Statut : décomposition + séquence figées (D1-D5 = voie **a**) ; D6 (workflow valider) à trancher.**
> Amont : [`DESIGN_R5_4_segmentation_layer.md`](DESIGN_R5_4_segmentation_layer.md) (modèle segmentation
> configurable, R5.4d = matcher différé), [`DESIGN_R5_4B_segment_canvas_layer.md`](DESIGN_R5_4B_segment_canvas_layer.md)
> (tranches front R5.4b), [`DESIGN_alignment_workspace.md`](DESIGN_alignment_workspace.md) (§2.2/§2.3/§4.1,
> **D-W11 : la maison du matcher est l'Alignement**). Fait suite à « on s'attaque à la segmentation ».

## 0. La question

`SegmentationView` est le **dernier gros écran legacy** de Prep. Peut-on le retirer (comme R6.5-C a
retiré `CurationView`) ? Le blocage nommé partout est le **structure matcher** (R5.4d, « différé »).
L'approfondissement montre que ce n'est **pas** un bloc monolithique à déplacer, mais **trois
capacités séparables** dont le cœur (propagate) est une **primitive de valeur étranglée par la
friction**, pas du legacy à jeter.

## 1. État vérifié (parité inventoriée 2026-07-22)

### 1.1 Fait déterminant : le canvas n'est pas encore primaire
`SegmentationView` est l'écran Segmentation **vivant et primaire** : la nav sidebar « Segmentation »
(`app.ts:389`) monte le legacy (`ActionsScreen.ts:136-138`). La couche canvas `SegmentPane` n'est
atteignable que par le bouton **« 🧪 Canvas Texte (prototype) »** du hub. Donc le retrait = **basculer
la nav vers le canvas** (miroir de `openCurationLayer`) **+ traiter ce que la bascule perdrait** — ce
n'est pas « supprimer un écran mort ».

### 1.2 Parité mono-doc = haute (canvas ⊇ legacy)
Relogé/redondant : surface de découpe (canvas a **en plus Tours**, grain grossier R5.4c), aperçu,
appliquer (confirm conditionnel), **merge/split** (`SegmentPane._merge:462`/`_confirmSplit:483`),
undo Mode A, filtres d'anomalies (courts + ponctuation orpheline), onglet **Rôles** (le **même**
composant `RolesPane`). Abandonnés sciemment : scroll-sync 2 colonnes, onglet Diff, sélecteurs
pack/lang (recadrage « pack = fiction »).

### 1.3 Ce que la bascule perdrait — bloqueurs par effort
| Effort | Bloqueur | Nature |
|---|---|---|
| Petit | re-router les deep-links (`focusSegmentationOnUnit`, Conventions→Rôles) | mécanisme de retrait (miroir R6.5-A) |
| Petit | rendu Brut : badges de rôle + gras/ital. (`richTextToHtml`) + fold « original d'import » | 3 gaps vs table « Enregistré » |
| Petit/opt. | empty-state « DOCX 2-col cassé », bannière proactive « [N] détecté » | confort / découvrabilité |
| Moyen | workflow **valider-et-avancer** + NextStepBanner | la capacité `validated` existe déjà dans Métadonnées → arbitrage (D6) |
| Moyen | `calibrate_to` (écart % vs référence) | déjà différé ; couplé au dropdown de référence du matcher |
| **Gros** | **structure matcher** | §2 — le vrai sujet |

## 2. Le structure matcher = trois capacités séparables

Le panneau `SegStructureMatcherPanel` (~860 l., 7 endpoints) mélange trois choses de foyers différents :

| Capacité | Ce qu'elle fait | Foyer |
|---|---|---|
| **Éditer** la structure | insert/delete/zone d'unités de structure (`/segment/insert_structure_unit`, `/delete_structure_unit`, `/zone_lines`) | **Segmentation** (mono-doc) — cf. Alignement §4.1 : « éditer la structure = round-trip vers Segmentation » |
| **Apparier** les sections | chapitre↔chapitre entre deux docs (`/segment/structure_sections`) | **Alignement** — grain « structure » de la matrice `structure ⊃ ¶ ⊃ phrase` (D-W11 : « maison actée ici, pas Segmentation ») |
| **Propager** | resegmenter la cible pour épouser la structure de la référence (`/segment/propagate_preview` → `apply_propagated`) | **hybride — la couture seg↔align** (§2.1) |

### 2.1 Propagate = segmentation famille-pilotée, pré-alignement
`/segment/propagate_preview` (`sidecar.py:3968`) **segmente la cible section par section en visant le
nombre de segments de chaque section de la référence** (ajustements best-effort : trop → fusion des
paires courtes ; trop peu → split sur ponctuation secondaire `; : —`). Donc :

- **Sortie = segmentation** (les segments de la traduction) → c'est *littéralement* « **segmentation
  en fonction des familles** » : la source de la famille pilote la découpe de sa traduction.
- **Effet = alignement fiable** : des structures **parallèles** (mêmes comptes par section) rendent
  l'alignement **positionnel** et robuste. Ça **résout le footgun que la note Alignement redoute**
  (cas Beigbeder FR 416 ↔ EN 364, où l'aligneur de longueurs dérape — `DESIGN_alignment_workspace.md`
  ~§ aligneur de longueurs). Propagate ne *fait* pas l'alignement (il ne crée pas de liens ;
  `apply_propagated` en **efface** même) — il le rend **trivial** ensuite.

C'est **une seule opération assise sur la couture** : entrée = alignement (famille, appariement
coarse), sortie = segmentation. D'où son utilité **des deux côtés**.

### 2.2 Aujourd'hui : de la valeur étranglée par la friction (≠ valeur faible)
Garde-fou [[feedback_pipeline_screens]] (AnnotationView) : ne pas conclure « inutile » d'un faible
usage. Ici l'usage est **indéterminable** (zéro télémétrie, zéro test comportemental sur les 7
endpoints, un seul instanciateur), mais **trois frictions** expliquent un faible usage plausible :
1. **référence choisie à la main** (dropdown « Calibrer sur ») — le matcher **n'utilise pas les
   familles**, alors que le modèle `doc_relations` existe ;
2. enfoui dans un **onglet** d'un écran legacy ;
3. aucune découvrabilité (pas de suggestion « cette famille peut être calée sur son pivot »).

### 2.3 L'upgrade « en fonction des familles » est petit et propre
`doc_relations` (mig 003 : `relation_type ∈ {translation_of, excerpt_of}`, câblé à l'import par
`familyDetect`) + service `get_doc_relations(doc_id)`. → une traduction **connaît sa source** via son
`translation_of`. Propagate peut donc **déduire** `reference_doc_id` de la famille au lieu de l'exiger,
avec override manuel conservé. Lève la friction #1.

## 3. Décisions figées

- **D1 — Décomposer le matcher par capacité** (éditer / apparier / propager), **ne pas** le reloger en
  bloc. Chaque capacité rejoint son foyer (§2 tableau).
- **D2 — Édition de structure (insert/delete/zone) → canvas Segment** (mono-doc). Round-trip depuis
  l'Alignement quand la découpe elle-même est fausse (Alignement §4.1). Reste destructif → garde-fou
  conditionnel (efface l'alignement).
- **D3 — Appariement + propagate = primitive de couture famille-pilotée.** Maison de l'appariement =
  Alignement (D-W11) ; **surfaçable des deux côtés** (depuis Segmentation : « caler cette trad sur sa
  source » ; depuis Alignement : « aligner la structure de la famille ») — **même moteur**.
- **D4 — Propagate devient famille-pilotée** : `reference_doc_id` déduit du `translation_of` (override
  manuel gardé). Petit, propre, lève la friction principale.

## 4. À trancher (avant ticket)

- **D5 — Séquence : voie (a) « Segmentation d'abord / partiel » — TRANCHÉ (2026-07-22).**
  Canvas Segment **primaire** tout de suite (relog édition D2, bascule nav, petits bloqueurs), sans
  attendre la grosse tranche structure de l'Alignement. La voie (b) « Alignement-structure d'abord »
  est écartée : plus grosse, réordonne la roadmap (saute à une tranche Alignement ultérieure alors que
  la refonte Alignement est déjà en cours).

  **De-risque décisif (vérifié au code)** : `/segment/propagate_preview` prend un `section_mapping`
  **optionnel** — sans lui, l'appariement est **positionnel** par défaut. Donc **propagate famille-pilotée
  marche déjà sans UI d'appariement manuel**. Propagate se scinde :
  - **auto** (positionnel, référence = pivot de la famille) → action **« caler cette trad sur sa source »**
    sur le **canvas Segment** (référence implicite = mono-doc de fait), livrable dans la voie (a) ;
  - **appariement manuel** (relier chapitre↔chapitre quand le positionnel dérape) → l'UI inter-doc qui
    attend l'**Alignement** (tranche ultérieure, D-W11).
  → l'« interim orphelin » qui pesait sur (a) **disparaît** : on ne sort pas de mini-outil bâtard ;
  seule la **réparation manuelle** est différée.

  **Tranches (voie a)** — ordre : bloqueurs relogés *avant* la bascule (sinon la bascule perd des features) :
  1. **Cadeaux indépendants** (§6) : retirer l'orphelin `structure_diff` + corriger les docs périmés. Cheap.
  2. **Relog édition de structure** (insert/delete/zone) dans `SegmentPane` (D2).
  3. **Polish rendu Brut** : badges de rôle + rich-text + fold « original d'import ».
  4. **Auto-propagate famille** sur le canvas (« caler sur la source », référence via `doc_relations`, D4).
  5. **Bascule nav** « Segmentation » → couche canvas + **re-route des deep-links** (miroir R6.5-A/C).
  6. **Retrait de `SegmentationView`** (+ décision D6 réglée d'ici là).
  L'appariement manuel + fold-in Alignement = **hors de cette voie**, à la tranche structure de l'Alignement.
- **D6 — Sort du workflow « valider-et-avancer »** : action « valider » surfacée sur la couche Segment,
  **ou** accepter la perte (valider via Métadonnées, qui porte déjà `workflow_status="validated"`).
  Surtout un arbitrage produit, peu de code. `calibrate_to` : rester différé (faible priorité).
- **Surfaçage exact de la primitive** (Seg seul / Align seul / les deux) et **instrumentation** (poser
  3 events voulu/éligible/bloqué [[feedback_instrumentation_triple_signal]] avant d'investir, pour
  enfin mesurer l'usage réel) : à décider avec D5.

## 5. Coût & contrat (esquisse)

- **D2 (édition structure au canvas)** : front (relog des ops insert/delete/zone dans `SegmentPane`) ;
  endpoints moteur **existent déjà**. Zéro contrat, zéro migration.
- **D4 (propagate famille-pilotée)** : `reference_doc_id` devient **optionnel** sur
  `/segment/propagate_preview` (déduit de `doc_relations`) → **param additif = contrat** (3 artefacts +
  snapshot, cf. [[reference_sidecar_endpoint_doc_sync]] — ici c'est un endpoint *existant*, param
  optionnel : re-checker si le schéma le liste). **Zéro migration** (`doc_relations` existe).
- **Bascule nav + re-route deep-links** : front pur (miroir R6.5-A/C).
- **Rendu Brut (badges/rich-text/fold)** : front pur.

## 6. Cadeaux & dérives (à faire quoi qu'on décide)

- **`/segment/structure_diff` + client `structureDiff()` = ORPHELINS** : aucun appelant, import mort
  (`SegmentationView.ts:21`), maintenus vivants par le **seul gel de contrat** (`openapi_paths.json:95`).
  → suppressibles (endpoint + client + entrée contrat) indépendamment.
- **Docs de statut périmés** : `HANDOFF_PREP.md:47` annonce `SegmentationView` **2667 l.** / « pas
  d'undo merge/split » — faux (**1596 l.** post-U-02, undo Mode A **existe**). À corriger.
- **`DESIGN_peritext_conventions_grounding.md`** présente `structure_diff` comme endpoint vivant à
  réutiliser + réfs de ligne périmées → stale.

## 7. Risques

- **Destructif** : propagate/`apply_propagated` **efface l'alignement** → garde-fou conditionnel (chip
  `Aligné`), comme la resegmentation (§ modèle R5.4).
- **Interim (voie a)** : la primitive vit hors de sa maison Alignement un temps → veiller à ne pas
  créer un mini-legacy qui traîne (la scoper, la documenter, la brancher tôt sur l'Alignement).
- **Sur-conception** : ne pas transformer « caler une trad sur sa source » en assistant global.
  Livrer la primitive famille-pilotée simple d'abord ; le surfaçage double ensuite.
- **Prémisse** : instrumenter avant d'investir lourd dans propagate (mesurer que la friction levée
  débloque bien l'usage) — [[feedback_verify_fix_against_reality_before_building]].
