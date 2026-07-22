# DESIGN — Périmètre de la curation : rôles & statut de traduction

> Note de cadrage (« figer avant ticket »). Rédigée 2026-07-22.
> **Statut : tranché (D1 = A3, D2 = B1, D3 = toggle) — moteur+UI non codés.**
> Fait suite à la question : *« l'application des règles de curation concerne-t-elle
> aussi le hors-bornes / les segments ayant un rôle ? »*, puis *« y a-t-il deux
> "non traduit", un en curation, un en alignement ? »*

## 0. La question

La curation applique-t-elle ses règles (espaces, ponctuation FR/EN, invisibles,
numérotation…) :

- aux unités marquées **`non_traduit`** (source laissée dans la langue d'origine) ?
- aux unités dont le **rôle est de catégorie `structure`** (titres, chapitres,
  intertitres — les en-têtes) ?

## 1. Comportement actuel (vérifié au code, 2026-07-22)

- **Apply** — `curate_document` ([curation.py:231-240](../src/multicorpus_engine/curation.py#L231-L240)) :
  ```sql
  SELECT unit_id, text_norm FROM units WHERE doc_id = ? AND n >= text_start_n ORDER BY n
  ```
  **Aucun** filtre sur `unit_type`, `unit_role`, `unit_roles.category`, ni `unit_status`.
- **Preview** — `_handle_curate_preview` (sidecar) : même périmètre depuis le fix
  `3d50ddc` (aperçu ↔ apply symétriques ; toute évolution du périmètre doit
  toucher **les deux** sous peine de re-diverger — cf. le bug qui a motivé ce fix).
- **Seule protection par unité** aujourd'hui : l'exception **Ignorer**
  (`curation_exceptions.kind = 'ignore'`, priorité 3), posée à la main.
- **Bornes** : seule la **borne de début** (`documents.text_start_n`, mig 015)
  protège le paratexte de tête. **Pas de borne de fin** (`text_end_n` n'existe pas).
- Rappel modèle : `unit_status ∈ {non_traduit, ajout}` (mig 023, validé au
  service — [cli.py:1553](../src/multicorpus_engine/cli.py#L1553)) ; `unit_role`
  = vocabulaire FK par corpus, avec `category ∈ {structure, text}` (mig 013/014/018).

Autrement dit : **tout ce qui est ≥ `text_start_n` est curé**, quel que soit son
rôle ou son statut, sauf ce que l'utilisateur ignore manuellement.

## 1bis. Un seul « non traduit », trois axes orthogonaux

Clarification issue de la discussion : « non traduit » **n'est pas un rôle** et
**n'est pas un concept d'alignement**. C'est **un seul champ** (`units.unit_status`),
à ne pas confondre avec deux axes voisins :

| Axe | Champ | Valeurs | Ce que ça dit | Lu par |
|---|---|---|---|---|
| **Rôle** (péritexte) | `units.unit_role` (+ `category`) | Titre / Chapitre / Intertitre… ; `category ∈ {structure, text}` | *quel type* de segment (D2) | curation, export, matcher |
| **Statut de traduction** | `units.unit_status` | `non_traduit` \| `ajout` | segment **hors relation de traduction** (D1) | recherche (filtre), marker-lift ; **pas encore l'alignement** |
| **Statut d'alignement** | `alignment_links.status` | accepted / rejected / unreviewed | ce **lien** est-il validé | alignement |

- **`aligner.py` ne référence jamais `unit_status`** (vérifié : 0 occurrence). Il
  n'existe donc **pas** de « non traduit » propre à l'alignement aujourd'hui.
- La refonte de l'espace Alignement **prévoit** de rendre la matrice consciente de
  `non_traduit`/`ajout` (tranche **D-W8**, non codée) : ce sera **le même champ**
  `unit_status` affiché à un 2ᵉ endroit, **pas un second concept**. Cohérence par
  construction : curation (D1) et alignement (D-W8) doivent lire ce même champ.
- **`ajout` n'est pas un risque de curation** : c'est du texte *ajouté par le
  traducteur*, donc dans la **langue cible** → les règles de langue lui vont. Seul
  `non_traduit` (langue source) est à risque. D1 ne concerne donc que `non_traduit`.

## 2. Pourquoi c'est un problème (asymétrique)

- **`non_traduit`** — nuisance **réelle**. Appliquer « Ponctuation française » à
  un passage source resté en anglais (guillemets, espaces insécables…) le
  corrompt. Le statut existe précisément pour distinguer ce contenu ; le laisser
  dans le périmètre de normalisation FR est incohérent.
- **Rôles `structure`** (titres/chapitres) — nuisance **faible**. Normaliser les
  espaces/ponctuation d'un titre est le plus souvent inoffensif, voire souhaité.

> **Nuance (argument pour A3 plutôt que A2)** : toutes les règles ne sont pas
> également dangereuses sur du `non_traduit`. « Ponctuation française/anglaise »
> est spécifique à la langue et corrompt une source étrangère ; « Espaces »,
> « Contrôle invisibles », « Numérotation [n] » sont des nettoyages **neutres**,
> souhaitables quelle que soit la langue. Une exclusion **dure** (A2) prive donc
> le `non_traduit` de ces nettoyages neutres. On ne veut *pas* d'une exclusion
> par-règle (sur-ingénierie) ; le vrai arbitrage est donc : accepter cette perte
> mineure (A2, réversible en retirant le statut) **ou** laisser la main via un
> toggle (A3).

## 3. Options

### Axe A — segments `non_traduit`
- **A1** — statu quo (curés ; protection manuelle via *Ignorer*).
- **A2** — **exclusion dure** : `curate` saute `unit_status = 'non_traduit'`.
- **A3** — **toggle** utilisateur (« curer aussi les segments non traduits »,
  défaut = exclus).

### Axe B — rôles de catégorie `structure`
- **B1** — statu quo.
- **B2** — exclusion dure.
- **B3** — toggle.

## 4. Décision (2026-07-22)

- **`non_traduit` → A3 (toggle, défaut = exclus).** Motivation : l'utilisateur a
  des corpus **multilingues / avec emprunts**, donc des `non_traduit` réguliers.
  Le **vrai moteur du problème est la langue**, pas le statut : une règle comme
  « Ponctuation française » encode une **langue cible** ; un `non_traduit` est dans
  une **autre** langue, et `unit_status` est le **seul signal par-unité** qu'on ait
  (les unités n'ont pas de colonne langue propre). Le toggle **délègue le jugement
  de langue à l'utilisateur, par run** :
  - règles **neutres** (Espaces, Contrôle invisibles, Numérotation) → toggle **ON**,
    on nettoie aussi les emprunts ;
  - règles **de langue** (Ponctuation / Guillemets FR ou EN) → toggle **OFF**
    (défaut), les `non_traduit` sont épargnés.

  On écarte l'exclusion **dure** (A2) précisément parce qu'elle priverait aussi le
  `non_traduit` des nettoyages neutres légitimes. On écarte un modèle **langue
  par-règle** (sur-ingénierie) : l'utilisateur sait ce qu'il coche, le toggle porte
  la décision au bon moment. Défaut = exclus (sûr).

- **Rôles `structure` → B1 (statu quo).** Bénéfice de curation réel, nuisance
  quasi nulle ; ne pas complexifier. Un titre gênant reste couvert par *Ignorer*.

## 5. Coût (A3 retenu)

- **Moteur** : un paramètre `include_non_traduit` (défaut `False`) sur `curate_document`
  **et** `_handle_curate_preview`. Quand `False`, filtre
  `AND (unit_status IS NULL OR unit_status <> 'non_traduit')` ; quand `True`,
  périmètre actuel. Les **deux** chemins doivent le porter (symétrie preview↔apply).
- **Migration** : aucune (colonnes existantes).
- **Contrat** : un champ de requête optionnel s'ajoute à `/curate` et
  `/curate/preview` → **régénérer** `docs/openapi.json` + le snapshot (ajout de
  champ, pas de retrait — cf. gel de contrat). Penser aussi à `SIDECAR_API_CONTRACT.md`
  (les 3 artefacts, cf. discipline de synchro d'endpoint).
- **UI** : une case « curer aussi les segments non traduits » dans le dock de la
  couche Curation (canvas), à passer à `preview` et `apply` ; défaut décoché.
- **Tests** : RED sur un doc contenant une unité `non_traduit` modifiable — décoché,
  l'unité n'est ni comptée ni écrite (aperçu **et** apply) ; coché, elle l'est —
  + preuve que l'ancien code la curait toujours.

## 6. Interactions & pièges

- **Symétrie preview ↔ apply obligatoire** (le fix `3d50ddc` s'est fait sur
  exactement cette classe de divergence).
- **Overrides prioritaires** : une unité `non_traduit` avec une exception
  `override` a un texte explicitement saisi → l'override doit continuer de gagner
  (priorité 1). L'exclusion ne concerne que **l'application automatique des
  règles**, pas les overrides/manuels. À vérifier dans l'ordre de priorité de
  `curate_document`.
- **`exceptions_active`** (dette laissée par le fix point 1) : ce compteur reste
  calculé à l'échelle du doc (JOIN non borné). Si on retouche le périmètre, le
  scoper au passage pour rester cohérent.
- **Résumé canvas** « N à curer / T » : dérivé du preview → se met à jour tout
  seul une fois le périmètre moteur changé.
- **Undo** : inchangé (rejoue un snapshot, pas les règles).
- **Cohérence avec l'alignement (D-W8)** : la matrice d'alignement lira le même
  `unit_status`. Curation (D1) et alignement (D-W8) doivent traiter `non_traduit`
  de façon cohérente — un segment hors relation de traduction n'est ni aligné à
  un vis-à-vis, ni normalisé selon la langue cible (sauf toggle explicite).

## 7. Décisions

- **D1 — `non_traduit` : A3** (toggle, défaut = exclus). Cf. §4.
- **D2 — rôles `structure` : B1** (statu quo, restent curés).
- **D3 — mécanisme : toggle** (pas d'exclusion dure), pour préserver les
  nettoyages neutres sur les emprunts.

Lot à ouvrir quand voulu : paramètre `include_non_traduit` symétrique
(preview+apply) + case dans le dock Curation + régénération de contrat + test RED.
Pas de migration.
