# Note de design — R4.1 : axe `unit_status` (`non_traduit` / `ajout`) au niveau unité

> Statut : **✅ implémenté** (2026-07-01) — migration 023 + `set_status`/`bulk` + filtre `query`/CLI + filtre concordancier. Commits `9d35f74` (socle moteur) · `e2df6ef` (query) · `19c9f50` (concordancier). Décisions ci-dessous **figées**. Reste hors R4.1 : R4.2 (lift des marqueurs, qui *peuple* l'axe) · R4.3 (affichage concordancier).
> Phase R4.1 de [`ROADMAP_REFONTE.md`](ROADMAP_REFONTE.md) §R4 · implémente le **T1** de [`DESIGN_peritext_conventions.md`](DESIGN_peritext_conventions.md) §8/§9 (« axe statut au niveau unité + filtre »).
> Suite thématique de R3 : R3 **produit** des orphelins (beads 1-0/0-1) ; R4.1 leur **donne un sens** (statut). S'appuie sur le modèle existant, aucune dépendance neuve.

## 0. Périmètre — ce que R4.1 **est** et n'**est pas**

**R4.1 = trois choses, minimales et découplées :** (1) une **colonne** `units.unit_status` (migration), (2) l'**écriture** manuelle/en lot du statut, (3) le **filtre** `query` par statut. Front = un filtre UI.

**R4.1 n'est PAS** (et ne doit pas se coupler à) :
- le **lift** des marqueurs `[non traduit]`/`[+]` → statut : c'est **R4.2** (passe idempotente `marker_lift.py`, hors `sidecar.py`).
- l'**auto-dérivation** depuis les orphelins d'alignement (1-0 → `non_traduit`, 0-1 → `ajout`) : **différée** (couplerait un statut d'unité à un *run* d'alignement mutable — cf. D6).
- le **concordancier qui affiche** le statut : c'est **R4.3** (`query.py` LEFT JOIN + badge `tauri-app`).

Découpler ainsi garde R4.1 petit, sûr, et fidèle à la reco §8 Q1 du péritexte (« le statut est une propriété de l'**unité**, pas seulement du lien »).

## 1. Le besoin

Un corpus multilingue distingue deux faits qui ne sont **ni un rôle ni un lien** :
- **`non_traduit`** — une unité **source** délibérément non rendue dans la traduction (un chapô sauté, une phrase omise).
- **`ajout`** — une unité **cible** ajoutée par le traducteur, sans source correspondante.

Aujourd'hui l'engine n'a **aucun axe** pour ça : ni `unit_role` (type péritextuel : titre/chapô/intertitre — cf. [013](../migrations/013_unit_roles.sql)/[014](../migrations/014_unit_role_field.sql)), ni `alignment_links.status` (`accepted`/`rejected`, sémantique de **révision de lien**, [004](../migrations/004_align_link_status.sql)) ne portent le sens « (non) traduit ». La requête cible « **tous les chapeaux non traduits** » = filtre **rôle + statut** ([`DESIGN_peritext_conventions.md`](DESIGN_peritext_conventions.md) §2, ligne 115) — impossible sans l'axe statut.

## 2. État réel du sous-système (ce sur quoi on branche)

**Tout est en place pour un ajout mécanique — `unit_status` est greenfield** (aucune occurrence dans `src/`).

- **Colonne sœur = `units.unit_role`** ([`migrations/014_unit_role_field.sql`](../migrations/014_unit_role_field.sql)) : `ALTER TABLE units ADD COLUMN unit_role TEXT REFERENCES unit_roles(name) ON DELETE SET NULL` + index partiel `WHERE unit_role IS NOT NULL`. **Template exact** de la migration 023. *Différence clé* : `unit_role` est une **FK** vers un vocabulaire *user-defined* ; `unit_status` est un **enum figé** (pas de FK, pas de table).
- **Surface d'écriture = `services/units_service.py`** : `set_unit_role` ([units_service.py:79](../src/multicorpus_engine/services/units_service.py#L79)) et `bulk_set_unit_role` ([:105](../src/multicorpus_engine/services/units_service.py#L105)) — pures, typées (`BadRequestError`/`NotFoundError`), adaptateurs minces `_handle_units_set_role`/`_handle_units_bulk_set_role` ([sidecar.py:5020/5035](../src/multicorpus_engine/sidecar.py#L5020)) sous `with self._lock()`. Le bulk gère **deux conventions** (`unit_ids`+`role_name` / `doc_id`+`unit_ns`+`role`). **Miroir direct** pour le statut, en remplaçant la validation FK `_role_exists` par une validation d'enum (comme `valid_statuses = {None,'accepted','rejected'}` du batch align, [sidecar.py:7800](../src/multicorpus_engine/sidecar.py#L7800)).
- **Lecture = `list_units`** ([units_service.py:26](../src/multicorpus_engine/services/units_service.py#L26)) émet déjà `unit_role`, `parent_n` (R2.3), `text_source` — ajouter `unit_status` au `_COLS` + au dict est **additif trivial**.
- **Filtre = `query.py`** : `_apply_doc_filters` ([query.py:528](../src/multicorpus_engine/query.py#L528)) empile des clauses `WHERE` doc-level dans `filters`/`params` in-place ; `run_query_page` ([:679](../src/multicorpus_engine/query.py#L679)) et `_run_regex_page` ([:592](../src/multicorpus_engine/query.py#L592)) partent déjà de `filters = ["u.unit_type = 'line'"]` — un filtre **unit-level** `u.unit_status = ?` s'y ajoute au même endroit (ce serait le **premier** filtre unit-level à côté de `unit_type`).
- **Allowlist d'écriture** : `_write_paths` ([sidecar.py:485-494](../src/multicorpus_engine/sidecar.py#L485)) — de nouvelles routes d'écriture s'y déclarent.
- **Migration la plus récente = 022** (`bead_id`) → R4.1 = **023**.

## 3. Le modèle — une colonne, un enum, orthogonal au rôle

`units.unit_status TEXT` nullable :

| valeur | sens | représente |
|---|---|---|
| `NULL` | normal / traduit | le cas par défaut (aucune marque) |
| `non_traduit` | source non rendue | une unité **pivot** sans équivalent voulu |
| `ajout` | ajout du traducteur | une unité **cible** sans source |

**Orthogonal à `unit_role`** : deux axes indépendants sur la même unité — `unit_role` = *type péritextuel* (titre/chapô/…, FK user-defined), `unit_status` = *statut de traduction* (enum figé). Une unité porte `(rôle?, statut?)`. Le §8 Q2 du péritexte (« rôle(1) + statut(1) suffit-il ? ») se **vérifie** sur les marqueurs composés du schéma : `[Ch][+]` = (rôle=chapô, statut=ajout), `[non traduit][P]` = (rôle=phrase, statut=non_traduit) — **deux axes couvrent tout**, aucun multi-rôle requis.

## 4. Décisions (reco par défaut)

- **D1 — Colonne + migration 023, calquée sur 014.** `ALTER TABLE units ADD COLUMN unit_status TEXT` + `CREATE INDEX idx_units_status ON units(unit_status) WHERE unit_status IS NOT NULL`. **Pas de FK** (enum, pas de table), **pas de CHECK DB** → validation **dans le service** (cohérent avec l'enum de statut align validé en Python ; garde l'escape-hatch « ajouter une valeur » gratuit). **Reco : colonne nullable + index partiel, validation service.**
- **D2 — Enum figé : `NULL | non_traduit | ajout`.** Extensible plus tard **par le service seul** (pas de migration). **Reco : ces 2 valeurs + NULL.**
- **D3 — Orthogonal à `unit_role`, jamais fusionné.** Deux colonnes, deux axes. **Reco : indépendance stricte.**
- **D4 — Endpoints : ⚠️ le seul vrai arbitrage.** Deux options :
  - **(a) routes dédiées** `/units/set_status` + `/units/bulk_set_status`, **miroirs exacts** de set_role/bulk (même service, adaptateur ~4 l., validation enum au lieu du FK). *Propre* (axes séparés, filtre propre, UI propre) ; *coût* : 2 routes neuves → **3 artefacts complets** (openapi + snapshot + `.md`).
  - **(b) étendre `set_role`/`bulk_set_role`** avec un champ `status` optionnel. *Moins cher* (champ additif → **snapshot/`.md` inchangés**) ; *piège* : couple deux axes orthogonaux, et impose la sémantique **« clé `status` absente = inchangé, `null` = effacer »** (sinon un `set_role` sans `status` écraserait le statut — le code actuel de `set_unit_role` traite « absent = clear » pour le rôle).
  La roadmap dit « expo **dans** set_role/bulk » → penche (b). Le semantic-cleanliness penche (a). **FIGÉ : (a) routes dédiées** `/units/set_status` + `/units/bulk_set_status` (validées avec l'humain, 2026-07-01). Rationale : le statut *non traduit / ajout* est un **axe analytique de première classe** (le « qu'est-ce qui est omis/ajouté » est une question de recherche première, pas de la plomberie) — il mérite sa validation, son filtre et son UI **propres**, pas d'être passé en douce dans `set_role`. On assume les 3 artefacts de contrat ; la logique vit en `units_service`, l'adaptateur reste mince (growth-gate ok).
- **D5 — Filtre `query` + expo `list_units`.** `run_query_page(..., unit_status=None)` → `filters.append("u.unit_status = ?")` dans les **deux** chemins (FTS + regex `_run_regex_page`) ; CLI `query --unit-status` en parité ; `list_units` ajoute `unit_status` au SELECT + dict. **Reco : filtre unit-level + expo lecture.**
- **D6 — Indépendant de l'alignement (le point sémantique).** Le statut est une **propriété d'unité** (§8 Q1), *pas* dérivée d'un run. L'auto-suggestion « orphelin length_bounded → statut » couplerait le statut à un `run_id` **mutable** (un re-run d'alignement changerait les orphelins) → **hors R4.1**. **Reco : statut posé à la main / en lot / (plus tard) par lift ; jamais auto-lié à un run en R4.1.**
- **D7 — Agnostique aux deux représentations du « non traduit » (cf. §6).** La colonne marque aussi bien une **unité-placeholder** (texte `[non traduit]`, alignée 1-1 — legacy) qu'une future **unité orpheline**. R4.1 ne tranche pas la représentation ; le lift placeholder→statut (+ vidage `text_norm`) est **R4.2**. **Reco : R4.1 pose l'axe, R4.2 le peuple depuis les marqueurs.**
- **D8 — WORKCOPY / réversibilité.** `set_status` mute **une colonne** — ne renumérote pas (≠ merge/split), ne touche pas l'alignement, ne supprime rien. Risque minimal ; undo cohérent avec `set_role` (pas d'undo dédié aujourd'hui). **Reco : même discipline que set_role.**

## 5. Implications contrat / migration / risque

- **Migration : une** — 023 `unit_status` (nullable + index partiel). Zéro autre changement de schéma.
- **Contrat : additif, 3 artefacts** (D4=(a)) — 2 routes neuves (`/units/set_status`, `/units/bulk_set_status`) → `sidecar_contract.py` + `openapi.json` + **snapshot** `openapi_paths.json` + **`SIDECAR_API_CONTRACT.md`** (`test_contract_docs_sync`, cf. [`reference_sidecar_endpoint_doc_sync`]). Plus, additifs sans route neuve : `list_units` gagne `unit_status`, `query` gagne le param `unit_status`. Déclarer les 2 routes dans `_write_paths`.
- **Growth-gate** : toute la logique en `services/units_service.py` (déjà extrait) ; handlers = adaptateurs minces → quasi zéro ligne nette dans `sidecar.py`.
- **Front** : filtre statut (Prep + concordancier), et l'écriture (menu/bulk) — réutilise le pattern set_role existant.
- **Risque** : faible (colonne additive, service isolé). Le seul point de conception ouvert = D4 (forme des endpoints).

## 6. Preuve corpus (2026-07-01) — deux représentations réelles

Le pipeline réel (M-GW Texte 6, cf. [`DESIGN_R3_sentence_alignment.md`](DESIGN_R3_sentence_alignment.md)) montre que « non traduit » existe **déjà** dans les corpus, sous **deux formes distinctes** :

1. **Unité-placeholder** (legacy/manuel) : côté EN, les segments 3/10/27 sont **présents** avec le texte littéral `[non traduit]` (parfois `[non traduit] [Ch]`), alignés 1-1 pour préserver la numérotation. → statut porté par une *unité existante* ; le lift (R4.2) posera `unit_status='non_traduit'` **et** videra `text_norm` (sortie FTS ; cf. table §3 ligne 109 du péritexte).
2. **Orphelin** (auto) : `length_bounded` laisse la source **sans lien** quand rien ne correspond. → statut *dérivable* d'un orphelin, mais couplé à un run (D6) → différé.

Enseignement pour D7 : **R4.1 doit rester agnostique** — la colonne accueille les deux ; c'est R4.2 (marqueurs) et un futur pont (orphelins) qui la **peuplent**, chacun à son rythme.

## 7. Questions ouvertes — tranchées (2026-07-01)

1. **D4 — ✅ tranché : (a) routes dédiées** (cf. D4). Le statut est un axe analytique de première classe → endpoints propres.
2. **D6/D7 — l'auto-pont orphelin→statut : DIFFÉRÉ (peut-être jamais).** Le corpus porte déjà `[non traduit]` explicitement → le **lift des marqueurs (R4.2) suffit** à peupler l'axe ; l'auto-dérivation depuis un run d'alignement (mutable) est un couplage qu'on n'ouvre pas sans besoin démontré. **Défaut : ne pas le faire en R4 ; réévaluer si un corpus arrive *sans* marqueurs mais *avec* des orphelins délibérés.**
3. **Statut sur unité `structure` : autorisé au `set`, filtre limité au `line`.** Un intertitre/chapô peut être non traduit → l'écriture (`set_status`/`bulk`) **n'impose pas** `unit_type='line'`. Le filtre `query` ne voit que `line` (la FTS n'indexe pas `structure`, ENG-04) — cohérent, sans contradiction. **Défaut : set sur toute unité, filtre sur `line`.**
4. **CLI : MVP = sidecar + `query --unit-status` ; `set-status` CLI = suivi optionnel.** La parité Mode A (CLI qui pose le statut) n'est pas nécessaire au MVP (l'UI Prep écrit via le sidecar) ; `query --unit-status` **est** utile en CLI pour l'analyse scriptée. **Défaut : filtre CLI dans R4.1, écriture CLI différée.**

**→ La note est prête-à-ticket** : toutes les décisions figées, contrat/migration cadrés, périmètre découplé de R4.2/R4.3.
