# Édition inline / override de curation au canvas (R5.3-3 · parité gap #9)

> Statut : **Lot 1 LIVRÉ (2026-07-19)** — cadrage figé + vérifié au code + passe adverse, puis implémenté. Reloge au canvas
> (`CurationPane`) l'édition inline présente dans le legacy `CurationView`. Dérive de
> [`DESIGN_R5_1_curation_layer.md`](DESIGN_R5_1_curation_layer.md) (hors-scope R5.1),
> [`DESIGN_R5_3_contextual_action_dock.md`](DESIGN_R5_3_contextual_action_dock.md) §3 (« R5.3-3 Curation à
> revisiter »), et [`DESIGN_R6_4_canvas_parity.md`](DESIGN_R6_4_canvas_parity.md) **gap #9 🔴**. Besoin réel
> exprimé (ROADMAP :12). **Front-dominant ; zéro migration** (l'endpoint de stockage existe déjà).

## 0. Ce que ça doit faire

Au canvas, en couche **Curation**, permettre à l'utilisateur de **corriger à la main le texte curé d'une unité**
— soit parce qu'une règle propose un résultat imparfait (*override* de la suggestion), soit pour une correction
ponctuelle indépendante des règles — **puis pouvoir revenir en arrière** (revert). Aujourd'hui c'est possible
dans le legacy `CurationView` mais **absent du canvas** ; le legacy ne peut pas être retiré (T4b) tant que ce
gap subsiste.

## 1. Constat vérifié (2026-07-19)

**Legacy `CurationView` — deux éditeurs inline + une exception :**
- **A. `_enterInlineEdit` (`CurationView.ts:2731`)** — textarea sur la ligne brute ; édite le **`text_norm`** de
  l'unité ; *stage* dans `_allOverrides` (mémoire), **aucun réseau**.
- **B. `_saveManualOverride` (`:2781`)** + `_revertManualOverride` (`:2823`) — édite le **texte curé proposé**
  d'un exemple (`ex.manual_after`, `is_manual_override`), bascule le statut à `accepted` ; *stage* dans le
  review-state localStorage. **C'est le gap parité #9.**
- **C. `_setExceptionOverride` (`:2895`)** — exception de règle **durable** via `POST /curate/exceptions/set`
  (distinct : « ne jamais appliquer cette règle ici », pas une correction ponctuelle). *Hors scope de ce lot.*
- **Persistance A + B** : les deux passent par `_collectManualOverrides` →
  `params.manual_overrides = [{unit_id, text}]` → **`POST /curate`** (job async, `CurationView.ts:1689/1709`,
  `sidecar.py:3530`). **Pas** d'appel à un endpoint texte-direct.

**Endpoint moteur d'édition directe — EXISTE :** `POST /units/update_text` → `update_unit_text`
(`units_service.py:270-325`) ; client `updateUnitText(conn, unitId, text_raw, text_norm?)`
(`sidecarClient.ts:2464`). Requête `{unit_id, text_raw?, text_norm?}` (≥ 1 requis ; `text_raw` seul est
**miroité** vers `text_norm`). **Réindexe FTS en place** (units_service.py:301-316). Déjà câblé UI, mais
**uniquement** dans `UnitInspectorPanel.ts:394` (panneau métadonnées), **pas** en curation.

**Canvas `CurationPane` (R5.1)** : preset → `curatePreview` (marqueur discret) → diff inline à la demande +
toggle global → **Apply `/curate`**. **Aucun** éditeur inline / override (grep `textarea|contenteditable|
updateUnitText` = 0). Greffe : (a) **ligne par unité** via le hook `decorateRow`/`_decorateChanged` (qui
insère déjà le panneau de diff après la ligne, `CurationPane.ts:327`), ou (b) le **dock bas R5.3**
(`dock?: HTMLElement`, self-attach au `mount`, `deactivate()` — réutilisable).

## 2. La prémisse porteuse — deux chemins, deux sémantiques *(vérifié curation.py, 2026-07-19)*

| Chemin | Immédiat ? | Portée | `source_changed_at` | Verbatim ? | Coût moteur |
|---|---|---|---|---|---|
| **α — `manual_overrides → /curate`** (legacy) | non (au run curate) | **toute unité** (pas seulement les « changées ») | ✅ **flague** | ✅ appliqué **verbatim** (bypass règles) | **nul** |
| **β — `/units/update_text`** (direct) | oui | toute unité | 🔴 **ne flague PAS** | ✅ (écrit tel quel) | **écart à combler** |

**Détail vérifié** (`curate_document`, curation.py) : la Priorité 2 (curation.py:286-294) écrit `manual_overrides[unit_id]`
**tel quel** puis `continue` — jamais re-curé par les règles ; et le flag source (curation.py:342-348) porte sur
`modified_unit_ids` = **toutes** les unités écrites (règle **ou** override manuel) → une correction manuelle
signale bien ses traductions « à revoir ». Bonus : l'écriture passe par `record_action` (curation.py:325-333) →
**annulable** via l'undo curate existant.

> **Correction de cadrage (revue adverse).** L'axe n'est PAS « override (B) vs édition directe (A) = α vs β ».
> α applique **verbatim à n'importe quelle unité** et flague la source → **α couvre AUSSI l'édition d'une unité
> non-suggérée** (ce que faisait le legacy `_enterInlineEdit`), front-only, sémantique correcte. Le vrai axe :
> **α = différé (au run curate) mais correct + gratuit** vs **β = immédiat mais silencieux (écart moteur)**.
> « Atteindre toute unité vs seulement les unités suggérées » est une question de **point de greffe UI DANS α**,
> pas un choix α/β ni un besoin moteur. β ne se justifie **que** si l'**immédiateté** (édition qui atterrit sans
> lancer un run curate) est une exigence dure — au prix d'ajouter le flag `source_changed_at` à `update_unit_text`.

## 3. Décisions à figer (reco par défaut)

- **D1 — Un seul éditeur inline par unité, staged en `manual_override` — couvre B ET A d'un coup.** Puisque α
  applique verbatim à *toute* unité, un unique affordance « éditer le texte curé de cette unité » sert à la
  fois d'**override** (unité avec suggestion — édite le « après » : gap parité #9) **et** d'**édition directe**
  (unité sans suggestion — édite `text_norm` : l'écart R5.3 « édition directe du texte »). **Reco : les deux
  dans le même lot** — c'est le même geste, le même chemin (α), et ça solde les DEUX flags legacy en une fois.
  Hors scope : l'exception de règle **durable** (C, `/curate/exceptions/set` — concept distinct).
- **D2 — Chemin = α (`manual_overrides → /curate`).** Vérifié verbatim + flague `source_changed_at` +
  annulable (§2). **Zéro moteur, zéro migration, zéro contrat.** « Mécanisme moteur déjà là → à reloger »
  (ROADMAP :12). **Reco : oui.** β (`/units/update_text`) **écarté** : son seul gain est l'immédiateté (édition
  hors run curate), au prix d'un écart moteur (`source_changed_at` non flaggé) — non requis ici.
- **D3 — Greffe = affordance inline par-ligne d'unité** (pas le dock R5.3). Pour atteindre *toute* unité (D1),
  l'éditeur ne peut pas vivre seulement dans le panneau de diff (celui-ci n'existe que pour les unités
  changées, `decorateRow`/`_decorateChanged`). **Reco : un bouton/edit discret par ligne** ouvrant une textarea
  sur le `text_norm` courant (ou le « après » proposé si diff) + Enregistrer / Annuler / **Revenir** ; pour une
  unité changée, la box s'ancre avec son diff. Pas le dock bas R5.3 (réservé aux éditeurs par-position volatils
  token/borne) — l'override est lié à une **unité précise**, pas à une position transitoire.
- **D4 — `source_changed_at` : rien à faire** (α le flague déjà, y compris pour les overrides manuels — vérifié
  curation.py:342-348). *Uniquement* si un futur lot d'immédiateté passe par β, ajouter le flag à
  `update_unit_text` (miroir curation.py:342-348) devient **obligatoire**.
- **D5 — Revert = miroir legacy** : retour à l'`after` automatique (unité changée) ou au `text_norm` d'origine
  (unité non-changée) ; état *staged* (mémoire + review-state comme R5.1), appliqué au run `/curate`. **Reco : oui.**

## 4. Coût

- **Front (dominant)** : dans `CurationPane` — (a) éditeur inline (textarea) dans le panneau de diff par-unité ;
  (b) collecte `manual_overrides` à l'Apply (réutiliser `lib/curationApplyInputs.collectManualOverrides` +
  `lib/curationContextDetail`, déjà écrits pour le legacy) ; (c) marqueur « édité manuellement » + revert.
  Réutilise `curatePreview`/`curate` (inchangés).
- **Moteur** : **nul** (α). `manual_overrides` est déjà parsé (`sidecar.py:3530`). **Zéro contrat, zéro
  migration.**
- **Tests** : purs (`collectManualOverrides` déjà couvert côté legacy) + rendu `CurationPane` (override staged
  → présent dans les params `/curate` ; revert → absent).

## 5. Découpage

1. **Lot 1 [FRONT] ✅ (fait, 2026-07-19).** Éditeur inline par-ligne dans `CurationPane` : bouton `✎` sur chaque
   ligne (révélé au survol) → textarea seedée (override staged › « après » de règle › `text_norm`) +
   Enregistrer / Annuler / **Revenir** (Ctrl+Entrée / Échap). Override staged en `_overrides` (Map unit_id→texte),
   marqueur indigo `--overridden` + note visible, embarqué à l'Apply comme `manual_overrides` (α). **Empty-rules
   relâché** : un override s'applique même sans preset (vérifié sidecar.py:3595). `CurateOptions.manual_overrides`
   ajouté au client. Gardes : F1 (setDocument) + teardown (dispose) + preview-independent + Apply/summary
   reflètent les overrides. **8 tests** (`CurationPane.test.ts`). Solde gap #9 + « édition directe du texte » R5.3.
2. *(optionnel, seulement si l'immédiateté est exigée)* **Lot β [petit MOTEUR + FRONT]** — édition qui atterrit
   **sans** run curate, via `/units/update_text`, **conditionnée** à l'ajout du flag `source_changed_at` côté
   moteur (D4). À n'ouvrir que si « éditer sans lancer un run » devient un besoin réel — α couvre déjà la
   correction, juste pas en temps réel.

## 6. Risques & garde-fous

- **Écran à état → mêmes gardes que le reste de la refonte** (cf. incidents passés) : l'éditeur inline doit se
  **réinitialiser au changement de doc et de connexion (F1)**, ne pas survivre à un `curatePreview` relancé
  (F5), et être **démonté proprement** (teardown) — sinon un override *staged* fuit vers le mauvais doc.
- **Cohérence du staging** : un override staged doit rester lié à `unit_id` + invalidé si l'unité disparaît
  (re-segmentation entre deux previews).
- **Overrides preview-independent (edge vérifié)** : `manual_overrides` est keyé par `unit_id` et appliqué par
  `curate_document` **quel que soit le preset courant** (curation.py:286 traite toutes les lignes) → un override
  staged s'applique **même si la preview courante ne « change » plus cette unité**. C'est voulu (l'édition
  manuelle doit survivre à un changement de preset) mais doit être **lisible** : marquer l'unité « éditée
  manuellement » indépendamment du diff de règle.
- **Pas de perte silencieuse** : à l'Apply, les overrides staged non appliqués doivent être visibles (le legacy
  gère « éditions non appliquées » — reprendre ce signal). Annulation : couverte par l'undo curate (§2).
- **Principe R « capacités indépendantes »** : l'override est une capacité de la couche Curation, pas une étape
  obligatoire — n'impose aucun ordre.

## 7. Alternatives écartées / notes

- **β (`/units/update_text`)** — écarté pour ce lot : son seul avantage est l'immédiateté (édition hors run
  curate) ; il **ne flague pas `source_changed_at`** → il faudrait l'ajouter au moteur pour la parité
  sémantique. α couvre déjà override **et** édition directe, verbatim, source flaggée, gratuit. β = Lot β futur,
  gated immédiateté (§5).
- **« A exige un ajout moteur » — FAUX (corrigé revue adverse).** L'édition directe d'une unité non-suggérée ne
  requiert PAS β/`/units/update_text` : `manual_overrides` l'applique verbatim à *toute* unité et flague la
  source. A est donc dans le Lot 1 front-only (D1), pas un lot moteur.
- **Dock R5.3 pour l'éditeur** — écarté (D3) : l'override est ancré à une **unité précise**, pas un éditeur
  par-position transitoire (token/borne).
- **Exception durable (C)** — hors scope (concept distinct : rule-exception via `/curate/exceptions/set`).
- **`UnitInspectorPanel` édite déjà** un `text_norm` via β (`updateUnitText`) dans le panneau métadonnées —
  utile à savoir, mais c'est un autre écran (pas la couche Curation) et il **ne flague pas la source** (β).
