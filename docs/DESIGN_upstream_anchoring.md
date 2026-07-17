# Note de design — Ancrage amont : empêcher la dérive d'alignement à la source (tous types de brut)

> Statut : **chantier 1 (validation d'ancrage) BÂTI + revu (2026-07-18) — voir §10** ; chantiers 2-3 restent une intention de design. Carte figée 2026-07-17.
> **Pendant *prévention*** de [`DESIGN_alignment_workspace.md`](DESIGN_alignment_workspace.md) (la *réparation* aval : ✂·⭙·✕·＝, gestes D-W*).
> S'appuie sur le modèle [`DESIGN_source_anchored_alignment.md`](DESIGN_source_anchored_alignment.md) (le moyeu) et le modèle deux-grains (¶ ⊃ phrase).
> Consolide et cadre trois chantiers existants : [`DESIGN_R2_3_blob_two_grain.md`](DESIGN_R2_3_blob_two_grain.md) (blob → 2-grain), la resegmentation ascendante R5.4c ([`coarse_grain.py`](../src/multicorpus_engine/coarse_grain.py) `regroup_document_coarse`), et l'import TEI ([`tei_importer.py`](../src/multicorpus_engine/importers/tei_importer.py)).

## 0. Ce qui déclenche cette note

La refonte R3.3 a bâti une **matrice éditable** et un quartet de gestes de *réparation* (✂ couper, ⭙ fusionner, ✕ retirer, ＝ rattacher, D-W16→19) : corriger à la main un alignement qui a **dérivé**. Mais la dérive observée (corpus Beigbeder, EN) n'est pas un accident réparable par la source — elle est **structurelle** : l'aligneur de longueur (R3.2 `align_pair_by_length`) n'a **aucune ancre** pour se caler, donc il glisse de façon déterministe. Réparer 1 200 cellules à la main n'est pas la réponse ; **empêcher la dérive à l'import** l'est.

Ce document fige le **modèle d'ancrage amont** : *quelle propriété un texte doit-il porter pour être alignable sans dériver*, et *comment la garantir pour chaque type de brut* que l'utilisateur importe (docx/odt à paragraphes, fichier texte / blob, copié-collé hétérogène, TEI/XML balisé — ce dernier étant aussi une **forme d'export**, donc un aller-retour).

## 1. Le principe — pas d'alignement robuste sans ancre

`align_pair_by_length` (Gale-Church borné, R3.2) apparie **par longueur** dans une **fenêtre**. Sans point d'appui commun aux deux textes, une seule erreur de groupage se **propage** : tout ce qui suit décale d'un cran (la « dérive »). Une **ancre** = une correspondance *certaine* entre source et traduction, qui **re-cale** l'aligneur périodiquement et **borne** la propagation à l'intervalle entre deux ancres.

> **Invariant visé :** *tout texte destiné à être aligné doit finir porteur d'au moins une famille d'ancres.* Un texte qui n'en porte aucune n'est pas « à aligner puis réparer » — il est **« à ancrer d'abord »**.

## 2. Le modèle d'ancre — trois familles, classées

De la plus forte (recale exactement) à la plus faible (recale si parallèle), avec sa provenance dans le code :

| Rang | Ancre | Porteur en base | Produite par | Force |
|---|---|---|---|---|
| 1 | **`[N]` — valeur** | `units.external_id` (numéro du marqueur) | `docx_numbered_lines`, `txt_numbered_lines`, `odt_numbered_lines` ; TEI `xml:id` (suffixe entier) | **Exacte** — les numéros s'apparient quel que soit l'ordre/la fusion. |
| 2 | **¶ — `parent_n`** | `units.meta_json.parent_n` | `resegment_document` (R2.1), `regroup_document_coarse` (R5.4c ascendant), split blob (R2.3, à créer) | **Borne la dérive dans le ¶** — l'aligneur two-tier (R3.2) se recale à chaque frontière de paragraphe. |
| 3 | **position** | `units.external_id = position` (ADR-012) | `docx_paragraphs`, `odt_paragraphs` | **Bonne si parallèle** — ¶ n° k ↔ ¶ n° k ; casse si un côté a un ¶ de plus/de moins. |
| — | **aucune** | — | blob mono-unité ; texte multi-lignes sans `[N]` ni `parent_n` (Beigbeder EN) | **Dérive déterministe.** |

> **⚠ La force d'une ancre est *relative à la stratégie* (revue M1, §10).** L'aligneur **par défaut** (`length_bounded`, et `similarity`) ne se recale que sur `parent_n` — il **n'exploite jamais `external_id`**. Donc `[N]`/position (rangs 1 et 3) ne protègent **que** les stratégies *identité* (`external_id`, `external_id_then_position`, `position`) ; sous la stratégie par défaut, **seul `parent_n` (rang 2) borne la dérive**. Un texte `[N]`/position-ancré est « protégé » ou « à découvert » **selon la stratégie choisie**, pas dans l'absolu.

Le **classifieur existe déjà** : `coarse_grain.derive_coarse_blocks` distingue le régime **`anchored`** (au moins une ligne porte un `parent_n` non-nul) du régime **`derived`** (aucun → 1 ligne = 1 bloc). C'est la **primitive de validation** (§4) — pas de code neuf pour *détecter* l'ancre ¶. Pour l'ancre `[N]`/position il suffit d'un `has_external_id` (présence d'`external_id` non-nul sur les lignes).

## 3. Par régime de brut — ce qui est bâti, l'ancre obtenue, le trou

| Régime de brut | Import aujourd'hui | Ancre obtenue | Trou |
|---|---|---|---|
| **docx / odt à paragraphes** | `docx_paragraphs`, `odt_paragraphs` | **position** (external_id=pos) ; + `resegment_document` → **`parent_n`** | — *marche ; reste à **l'utiliser** (resegmenter avant d'aligner).* |
| **fichier texte / blob** (1 unité, ¶ perdus) | **aucun mode ne le produit** (R2.3 §0) | **aucune** → dérive | **mode brut + `split_paragraphs`** (moteur ; conçu R2.3, §0 débloqué — cf. §7). |
| **copié-collé hétérogène** | selon le collage (souvent blob, parfois lignes vides survivantes) | **imprévisible** | idem blob ; **couvert par le filet de validation** (§4) qui refuse d'aligner un texte non-ancré. |
| **TEI / XML balisé** | `tei_importer` : `<p>` **ou** `<s>` → lignes plates, `xml:id`→external_id | **`[N]`/position** (external_id), mais **plat** (pas de `parent_n`) | pour un **aller-retour** export→TEI→réimport qui **retient le 2-grain** : `<p> ⊃ <s>` imbriqué + `parent_n` (cf. §7 chantier 3). |

**Lecture (corrigée par la revue M1, §10) :** le brut *à paragraphes* (docx/odt) n'est couvert **sous la stratégie par défaut (`length_bounded`) que s'il est resegmenté** (`parent_n`). L'ancre *position* seule (external_id=pos) **ne protège pas** un run de longueur — deux docx de 10 vs 12 ¶ non resegmentés dérivent en silence, exactement comme Beigbeder. La position ne protège que sous une stratégie *identité* (`position`/`external_id`). Le seul brut *réellement à découvert quelle que soit la stratégie* est le **blob / copié-collé sans structure**. Le TEI est ancré à l'import (external_id) mais **plat** : alignable sous une stratégie identité, à découvert sous longueur tant qu'il n'est pas resegmenté ; insuffisant pour un round-trip 2-grain.

## 4. Le levier unificateur — valider l'ancrage (le filet)

Un seul mécanisme couvre **tous** les régimes, balisés comme bruts : **avant d'aligner, vérifier que chaque texte est ancré** ; sinon, **le signaler et proposer le remède** (§5) plutôt que de lancer un alignement voué à dériver.

- **Détection — réutilise l'existant, zéro heuristique neuve.** `anchored = derive_coarse_blocks(...)` (régime ancré ¶) **ou** `has_external_id` (ancre `[N]`/position). Un texte pour lequel **les deux sont faux** est « non ancré ».
- **Où le surfacer.** (a) **À l'import** — un badge/stat « ce texte n'est ancré par rien » sur le document. (b) **Dans la barre Aligner** (R3.3) — avant de lancer, si un des deux textes du bitexte est non-ancré : bandeau *« l'alignement dérivera — ce texte n'a ni numéros [N] ni paragraphes ; l'ancrer d'abord »* + bouton vers le remède.
- **Jamais bloquant.** On **prévient**, on ne **refuse** pas (un utilisateur averti peut aligner un court texte non-ancré sans risque). Cohérent avec D1 de R2.3 (« signalé, action explicite, pas d'auto-magie »).

C'est le chantier **le plus rentable** : il réutilise `derive_coarse_blocks` (déjà là, déjà testé, déjà mirroré côté TS `coarseGrain.ts`), couvre **toute** entrée, et transforme une dérive silencieuse-puis-réparée-à-la-main en une **décision informée à l'import**.

## 5. Les remèdes vers lesquels la validation oriente

Signaler ne suffit pas — le bandeau doit pointer le **bon** remède selon ce que le texte porte :

1. **Ré-importer numéroté** — si la source a des numéros de ligne/verset : mode `*_numbered_lines` → ancre `[N]` (rang 1). Le plus fort quand c'est possible.
2. **Regrouper par frontière (R5.4c — déjà livré)** — si le texte est **multi-lignes** avec un **indice de frontière** en base (tirets de tour de parole `tours`, ou motif custom) : `regroup_document_coarse(conn, doc_id, preset|pattern)` **synthétise `parent_n`** sur les lignes existantes, **sans resegmenter**, sans toucher FTS/alignement. Transforme un régime `derived` en `anchored` **à coût quasi nul**. *Limite : exige un indice fiable ; un texte sans frontière détectable n'en bénéficie pas.*
3. **Extraire 2-grain d'un blob (R2.3 — à créer)** — si le texte est **une seule grosse unité** : `split_paragraphs` + resegment (mode `two_grain`). Voir §7 chantier 2.
4. **Re-segmenter (docx/odt à ¶)** — si l'ancre position est là mais pas encore l'ancre ¶ : `resegment_document` pose `parent_n`. Déjà disponible.

Le bandeau de validation **choisit** parmi 1-4 d'après `has_external_id`, le régime `derived`, le `line_count`/`max_text_len` (blob) et la présence d'un indice de frontière.

## 6. Décisions à figer (reco par défaut)

- **D-U1 — Invariant « ancrer avant d'aligner », non bloquant.** La barre Aligner *prévient* si un texte est non-ancré ; elle ne *refuse* pas. **Reco : prévenir + orienter, jamais bloquer.**
- **D-U2 — Détection par réutilisation, pas d'heuristique neuve.** `derive_coarse_blocks` (régime) + `has_external_id`. Pas de nouveau détecteur. **Reco : réutiliser le classifieur existant.**
- **D-U3 — Contrat.** La validation est **read-only** : une GET/section de stat sur le document (ou un champ dans la charge matrice déjà servie) exposant `{anchored: bool, anchor_kind: "value"|"paragraph"|"position"|null}`. **Pas de route d'écriture neuve** pour valider. **Reco : additif read-only, dérivé à la volée (comme `coarse_blocks_for_doc`).**
- **D-U4 — Remède prioritaire = R5.4c quand un indice existe.** Le regroupement ascendant est **livré, non destructif, quasi gratuit** : c'est le premier remède proposé pour un texte multi-lignes avec frontière. Le blob-split (R2.3) ne concerne que le **mono-unité**. **Reco : R5.4c d'abord, R2.3 pour le blob vrai.**
- **D-U5 — TEI plat suffit pour aligner ; le 2-grain TEI est un chantier séparé.** L'import TEI actuel (external_id) est **alignable** ; l'aller-retour 2-grain (`<p> ⊃ <s>`) est une **feature d'export/round-trip**, pas un prérequis d'alignement. **Reco : ne pas coupler ; livrer la validation sans attendre le round-trip TEI.**
- **D-U6 — Migration : aucune.** `external_id`, `parent_n` (meta_json) existent ; la validation les *lit*. **Reco : zéro migration.**

## 7. Trois chantiers, par levier/coût — ordre recommandé

1. **Validation d'ancrage (le filet)** — *le plus rentable, couvre tout, réutilise `derive_coarse_blocks` + `has_external_id`.* Read-only, additif, front = un bandeau dans la barre Aligner + un badge à l'import qui **oriente** vers 1-4 (§5). **← commencer ici.**
2. **Producteur blob 2-grain (R2.3)** — pour blob / copié-collé mono-unité. **Design déjà figé** (R2.3 D1-D6) ; **§0 débloqué** : l'utilisateur *a* des bruts, le producteur n'est plus spéculatif → préalable (ii) de R2.3 §0 satisfait. Prérequis : décider le **mode d'import brut/whole-file** qui *crée* le blob (aujourd'hui aucun mode ne le produit). Moteur : `split_paragraphs` + branche `two_grain` de `resegment_document`.
3. **TEI imbriqué + aller-retour** — l'import TEI capte l'external_id mais reste plat ; pour un round-trip export→TEI→réimport qui **retient** le 2-grain, il faut préserver `<p> ⊃ <s>` (import : hiérarchiser au lieu de « p **ou** s » ; export : émettre l'imbrication + les ordinaux). Plus petit, **découplé** de 1-2 (D-U5).

**Ordre : 1 → 2 → 3.** La validation (1) rend visible *où* le problème mord et *quel* remède s'applique — elle guide la priorité réelle des chantiers 2-3 sur le corpus. Le blob (2) est prêt à ticketer dès que le mode d'import brut est tranché. Le round-trip TEI (3) est une commodité d'export, à faire quand l'export TEI existe.

## 8. Implications, risque, liens

- **Moteur (chantier 1)** : une fonction pure `anchor_status(units) -> {anchored, anchor_kind}` (compose `derive_coarse_blocks` + un test `external_id`), exposée par un thin wrapper `conn` (miroir de `coarse_blocks_for_doc`). Aucune écriture, aucune migration.
- **Front (chantier 1)** : bandeau de la barre Aligner (R3.3 `AlignMatrixView`) + badge document (écran Import / stats R1.2). Orientation vers 1-4 selon les signaux déjà disponibles.
- **Risque** : quasi nul en 1 (read-only, réutilisation). Le vrai coût reste le **repli `source_path`** de R2.3 (re-lecture DOCX/TEI) et la **hiérarchisation TEI** (3) — tous deux **hors** du chantier 1.
- **Notes liées** : réparation aval = `DESIGN_alignment_workspace.md` (D-W*) ; modèle du moyeu = `DESIGN_source_anchored_alignment.md` ; blob = `DESIGN_R2_3_blob_two_grain.md` (chantier 2) ; ascendant R5.4c = `coarse_grain.py` / `DESIGN_R5_4_segmentation_layer.md`.

## 9. Questions ouvertes (à trancher avant ticket du chantier 1)

1. **Surface exacte de D-U3** — champ ajouté à la charge matrice déjà servie (le moins de contrat) *vs* GET dédiée `/documents/{id}/anchor_status` (réutilisable ailleurs) ? Reco : commencer par le **champ dans la charge existante**, extraire une route si un 2ᵉ appelant apparaît.
2. **Seuils blob (D1 R2.3)** — `line_count ≤ ?` / `max_text_len ≥ ?` pour classer « mono-unité » — à caler sur le corpus réel (partagé avec R2.3 §7.2).
3. **`external_id` position vs valeur** — distinguer dans `anchor_kind` l'ancre *position* (docx_paragraphs, faible) de l'ancre *valeur* `[N]` (forte) demande de savoir *comment* l'external_id a été posé. Marquer la provenance à l'import (un flag `anchor_kind` sur le run/document), ou l'inférer (external_id == position séquentielle ⇒ position) ? Reco : **inférer** au début (pas de nouveau champ), marquer si l'inférence s'avère ambiguë. → **Tranché : inféré** (`external_id == n` ⇒ position, sinon valeur), cf. `anchoring._external_id_anchor` (§10).

## 10. Chantier 1 — bâti + revue adverse (2026-07-18)

**Livré.** Moteur : `anchoring.py` (`anchor_status(units)` pur — `value`/`paragraph`/`position`/`null` + `line_count` ; `anchor_status_for_doc(conn, id)` thin wrapper ; réutilise `coarse_grain.is_anchored_regime` **extrait**) ; `matrix_export_service` expose `anchor_status` ∥ `languages` (contrat **1.6.59**, additif read-only — D-U3/D-U6 respectés). Front : `anchorWarn.ts` (pur) + bandeau passif (au chargement) et **garde** avant « Aligner » (non bloquante — D-U1) dans `AlignMatrixView`.

**Revue adverse (6 finders → 2 réfutateurs/finding).** 1 majeur + 4 mineurs corrigés ; 1 nit acté acceptable ; 1 réfuté. Détail dans [`REVIEW_upstream_anchoring_2026-07-18.md`](REVIEW_upstream_anchoring_2026-07-18.md).

- **M1 (majeur) — filet rendu conscient de la stratégie.** Le trou : classer l'ancrage *par document* faisait taire l'alerte pour `value`/`position` alors que la stratégie **par défaut** (`length_bounded`) ne les consomme pas → dérive silencieuse (contredisait la « Lecture » d'origine de §3, corrigée ci-dessus). Correctif : `anchorWarnings(matrix, strategy)` sépare **camp longueur** (`length_bounded`/`similarity` : protégé ssi les deux ¶-ancrés, ou comptes de segments égaux = parallèle) du **camp identité** (`external_id*`/`position` : `[N]`/position protègent). Nouveau motif d'alerte `unused-anchor` (« ancré par [N]/position mais la stratégie « longueur » ne l'exploite pas → bascule external_id, ou regroupe en paragraphes »).
- **Mineurs corrigés :** `anchorRemedy(0)` (doc 100 % structure ≠ blob) ; remède blob purgé de « extraire ses paragraphes » (R2.3 non construit) ; bandeau garde/rerun-confirm fermé au changement de famille (plus de bandeau fantôme) ; acquittement de la garde ré-armé à chaque `_loadMatrix` (lié au **contenu chargé**, plus à la famille pour toujours).
- **Nit acté :** `anchor_status` = N+1 lectures `units` par chargement matrice — borné, indexé, motif identique à `coarse_blocks_for_doc` ; **pas de correctif**.
- **Réfuté :** KeyError `_external_id_anchor` — `n` toujours fourni par le SELECT, inatteignable.

**Reste ouvert (hors chantier 1).** Le filet ne *câble* pas encore les remèdes en un clic (il les nomme + pointe la couche). Chantiers 2 (blob R2.3) et 3 (round-trip TEI) inchangés.
