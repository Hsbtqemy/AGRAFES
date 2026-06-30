# Notes de design — Prep : canvas texte unifié (Segmentation / Curation / Annotation)

> Statut : **intention de design — à valider**. Date : 2026-06-30. Cible : `tauri-prep` (front-end uniquement ; **moteur Python et contrat sidecar inchangés**).
> Ancrage : inventaire code des 4 vues (exploration ciblée, 2026-06-30). Légende : ✅ existe · 🟡 partiel · ❌ à construire.
> Notes liées : [`DESIGN_peritext_conventions.md`](DESIGN_peritext_conventions.md) (features) · [`DESIGN_metadata_templates_filtering.md`](DESIGN_metadata_templates_filtering.md) · modèle d'état/workflow (cf. §6).

## 1. Cadre & périmètre

**But.** Refondre la présentation des trois vues qui opèrent sur **le même objet — le texte/les unités d'un document** : **Segmentation, Curation, Annotation**. Les fusionner en **un canvas « Texte » unique**, le texte au centre, où segmentation / rôles / curation / annotation deviennent des **couches** activables, plutôt que des écrans denses à panneaux empilés.

**Hors périmètre.**
- **L'alignement reste sa propre vue** — il est *bi-textuel* (original ↔ traduction), donc un autre objet, et il est **déjà plat** (modèle à imiter, §3). On n'y touche pas.
- **Le moteur, le modèle de données, le contrat sidecar ne changent pas.** C'est une refonte **front-end pure** : zéro migration, zéro endpoint nouveau. Risque contenu.
- **Pas de big-bang.** On construit le canvas **à côté** des écrans existants et on migre par tranches (§7).

**Pourquoi maintenant.** Deux douleurs convergentes, mesurées : (a) **densité** — « boîtes dans des boîtes avec scrolls internes » ; (b) **confusion d'état** entre écrans (cf. §6). Un canvas unique à scroll central + bandeau d'état les traite **ensemble**.

## 2. État des lieux mesuré

### 2.1 Densité comparée

| Vue | Panneaux | Scrolls indép. | Contrôles | Imbrication max | Breakpoints |
|-----|----------|----------------|-----------|-----------------|-------------|
| **Curation** | 5 + 2 sous-panneaux extraits | **8+** | 30+ boutons / 20+ inputs | **9 niveaux** | 4 (@1400/1300/1050/800) |
| **Segmentation** | 5 onglets | ~5 | ~35-40 | profond | @900 seul |
| **Annotation** | 3 colonnes **fixes** | 5 | ~20 | moyen | **aucun @media** |
| **AlignPanel** (réf.) | plat, sections *toggle* | **1 principal** | modéré | **3-4** | flex-wrap + container query |

Détails saillants (fichier:ligne) :
- **Curation** : grille `310px 1fr 300px` ([app.css:3759](../tauri-prep/src/ui/app.css#L3759)), panneaux raw/diff/minimap/diag/review-log/exceptions/apply-history chacun scrollable ; `#act-preview-raw` + `#act-diff-list` en `.prep-doc-scroll`. ~1500 lignes CSS dédiées.
- **Segmentation** : 5 onglets (Aperçu/Modifier/Diff/Structure/Rôles), matcher en grille `1fr 1fr` sans breakpoint dédié (casse en étroit), `.prep-conv-units-area` capée à 460px.
- **Annotation** : `grid-template-columns: 200px 1fr 220px` **fixe, aucun @media** → non responsive ; grille interlinéaire de tokens à scroll horizontal par phrase.

### 2.2 Le modèle plat — AlignPanel

Structure ([AlignPanel.ts](../tauri-prep/src/screens/AlignPanel.ts), [app.css:1866](../tauri-prep/src/ui/app.css#L1866)) :
- racine en **`container-type: inline-size`** (responsive par *container query*, pas par cascade de @media) ;
- **topbar `display:flex; flex-wrap:wrap`** (les contrôles s'écoulent, pas de grille imposée) ;
- **un seul scroll principal** : `#align-bitext-body` ;
- le secondaire (orphelins, famille, bannières) en **sections `display:none` repliables**, empilées verticalement.

→ 3-4 niveaux d'imbrication, 1 scroll. **C'est le patron cible.**

### 2.3 Conteneur & ce qui est réutilisable

- **Conteneur** : `ActionsScreen` ([ActionsScreen.ts:177](../tauri-prep/src/screens/ActionsScreen.ts#L177)) bascule les sous-vues `hub|curation|segmentation|alignement|annoter` via `[data-panel]` (display toggle), conn/docs/JobCenter/log partagés. Le préfixe `act-*` scope les IDs. → la cible = **remplacer les 3 sous-panneaux denses par UN sous-panneau « Texte »**, garder `alignement`.
- **Logique déjà extraite (dé-risque)** : ~16 fichiers `lib/curation*` purs (`curationDiffList`, `curationPresets`, `curationFiltering`, `curationCounters`, `curationDiagnostics`…), `RolesPane` (« DOM + wiring, no business rules »), segmenter dans le moteur. **Le canvas réutilise ces fonctions** — on refait la surface.

## 3. Modèle cible — le canvas « Texte »

Un sous-panneau unique remplaçant Curation + Segmentation + Annotation :

```
┌ Bandeau d'état (permanent) : segmenté ✓/✗ · index à jour/⚠ périmé · validé/brouillon · N éditions non appliquées ┐
├ Toolbar plate (flex-wrap, façon AlignPanel) : [outils de la couche active] + sélecteur de couche ──────────────┤
│ ┌ Couches (radio) : [Segmentation grain] [Rôles] [Curation] [Annotation tokens] ──────────────────────────────┐ │
│ │                                                                                                              │ │
│ │   ◀── LE TEXTE / LES UNITÉS, scroll central UNIQUE ──▶   (décoré selon la couche active)                     │ │
│ │       · Segmentation : grain phrase/ligne, séparateur de borne, ¤                                            │ │
│ │       · Rôles : badges de convention + grisé paratexte (déjà fait)                                           │ │
│ │       · Curation : diffs en surimpression SUR les unités (plus un pane séparé scrollable)                    │ │
│ │       · Annotation : couche tokens (interlinéaire ou prose colorée) sur l'unité                              │ │
│ └──────────────────────────────────────────────────────────────────────────────────────────────────────────┘ │
├ Rail / docks repliables (≠ scrolls co-égaux) : règles de curation · diag/journal · exceptions · modèles spaCy ─┤
└────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Principes (issus d'AlignPanel) :**
1. **Un scroll central = le texte.** Tout le reste est toolbar / rail latéral / **dock repliable**, jamais une boîte scrollable co-égale.
2. **Couches, pas écrans.** La même liste d'unités est *décorée* différemment selon la couche active. La sélection d'unités est partagée entre couches (un seul modèle de sélection, multi + shift-range — on a déjà ça dans `RolesPane`).
3. **Bandeau d'état permanent** en tête → soigne la confusion d'état (§6).
4. **Secondaire dense → docks repliables.** Les panneaux lourds de curation (exceptions admin, apply history, diagnostics, review-log) deviennent un **tiroir « Avancé »** repliable, pas 8 scrolls.
5. **Responsive par container query + grilles fluides** (`clamp()`, `minmax()`), pas la cascade de @media en px fixes. Tuer le `200px 1fr 220px` figé d'Annotation.

## 4. Couches — ce que chacune apporte au canvas

| Couche | Décor sur le texte | Outils (toolbar) | Réutilise |
|--------|--------------------|------------------|-----------|
| **Segmentation** | grain (ligne/phrase), borne début de texte, structure/intertitres | stratégie, pack/langue, resegmenter, valider | `segmenter`, segDocList, structure matcher |
| **Rôles / conventions** | badges + grisé paratexte (✅ déjà) | catalogue, assigner/retirer, borne | `RolesPane`, `conventionsRoles` |
| **Curation** | diffs **en surimpression** sur les unités (avant/après inline) ; édition inline | presets, regex, Find/Replace, Appliquer | les ~16 `lib/curation*` |
| **Annotation** | tokens (interlinéaire repliable ou prose colorée UPOS) | modèle spaCy, Annoter, éditer token | `AnnotationView` token-logic |

> **Curation en surimpression** est le vrai gain : aujourd'hui le diff vit dans un *2e pane scrollable* à côté du texte ([#act-diff-list](../tauri-prep/src/screens/CurationView.ts)). Le mettre **sur** les unités (badge/halo + survol) supprime un pane entier et garde le fil du texte.

## 5. Responsive — cible

- **Container queries** (`container-type: inline-size`) sur le canvas, comme AlignPanel — l'adaptation suit la largeur *du panneau*, pas de la fenêtre.
- **Grilles fluides** : `minmax()/clamp()` au lieu de largeurs px fixes multi-colonnes.
- **Remplacer** le `200px 1fr 220px` non responsive d'Annotation et le `1fr 1fr` sans breakpoint du matcher.
- Rail latéral → se replie sous le canvas en étroit (flex-direction column), un seul scroll préservé.

## 6. Le bandeau d'état (résout la confusion inter-écrans)

Mesuré (cf. mapping workflow) : l'état est éparpillé et certains se perdent en silence —
- `workflow_status` visible (badge liste Segmentation) ; `fts_stale` seulement en Metadata ; **overrides de curation `_allOverrides` perdus silencieusement** au changement de doc ([CurationView.ts:~1550](../tauri-prep/src/screens/CurationView.ts#L1550)) ; `_segmentPendingValidation` seulement en Segmentation.
- **Distinction à clarifier** : « **Appliquer** » (persiste la curation *staged* → DB) ≠ « **Valider** » (statut workflow, **ne relance jamais de segmentation** — confirmé). Le canvas doit nommer ces deux actions sans ambiguïté.

Le **bandeau permanent** affiche : *grain/segmenté · index à jour ⚠ · validé/brouillon · N éditions non appliquées*, et **garde-fou anti-perte** : confirmer avant de quitter avec des overrides non appliqués (modèle `modalConfirm` existant).

## 7. Découpage en tranches (incrémental, sans big-bang)

Les écrans existants **restent en service** pendant la migration ; on bascule couche par couche.

- **T0 — Tranche verticale (prototype)** : nouveau sous-panneau « Texte » dans ActionsScreen ; **scroll central = unités** ; **couche Segmentation/Rôles** (réutilise `RolesPane`) ; **bandeau d'état**. Sur le doc réel (Houellebecq). But : *sentir* le modèle et le coût.
- **T1** — Couche **Curation en surimpression** (diffs sur les unités) ; docks repliables pour règles/diag ; réutilise `lib/curation*`. Le gros morceau.
- **T2** — Couche **Annotation** (tokens) ; traiter la **friction amont** (annotation = bout de pipeline : tokens requis → import/segmentation → modèle spaCy 30-60s) : la couche doit guider, pas bloquer.
- **T3** — Tiroir « Avancé » : exceptions admin, apply history, review export (repliés par défaut).
- **T4** — Responsive container-query + retrait des écrans legacy une fois la parité atteinte.

## 8. Risques / points durs

- **Curation est riche** (5 dimensions de sélection, 30+ contrôles, exceptions/history). Tout reloger en couche + docks est le vrai travail — d'où la tranche T1 dédiée.
- **Tokens d'annotation** sont intrinsèquement larges (interlinéaire à scroll horizontal). La couche tokens demande un parti-pris (prose colorée par défaut, interlinéaire à la demande).
- **Sélection partagée** entre couches : unifier `_selectedUnitIds`/`_selectedUnitNs` (deux modèles aujourd'hui) en un seul.
- **Double UI transitoire** : tax pendant la migration — limité en gardant les tranches courtes et la parité par couche.
- **Ne pas toucher** au contrat sidecar : tout passe par les endpoints existants.

## 9. Décisions tranchées (2026-06-30)

**Tranché avec l'utilisateur :**
- **Modèle de couches** : **base persistante + 1 mode actif**. Texte + badges de rôles + grain **toujours** visibles (décor de base) ; segmentation / curation / annotation = **un seul mode outil à la fois**.
- **Curation — diffs** : **surimpression sur les unités, mais LÉGÈRE par défaut** (préoccupation « ça peut devenir lourd », justifiée). Une unité modifiée porte un **marqueur discret** (bord/point coloré « modifié »), **pas** le avant/après complet ; le **diff complet se révèle à la demande** (survol/clic de l'unité) + un **toggle global « afficher tous les diffs »** pour une passe de revue. À éprouver en T1.
- **Migration** : **canvas à côté du legacy**, parité par couche, puis retrait des écrans Seg/Cur/Annot. Rien de cassé pendant la transition.

**Tranché par reco (à confirmer en arrivant à la tranche) :**
- **Sélection** : un seul modèle, unité-niveau, multi + shift-range (unifie les deux actuels).
- **Grain** : adaptatif — le canvas montre les **unités existantes** ; la couche Segmentation change le grain (lié à [`DESIGN_peritext_conventions.md`](DESIGN_peritext_conventions.md) §6).
- **Annotation (T2)** : prose colorée par défaut, interlinéaire à la demande ; téléchargement de modèle en dock **non bloquant**.
- **Tiroir « Avancé » (T3)** : exceptions admin + apply history + diagnostics + export review.

## 10. Périmètre A — couche « Segmentation » (instancie le modèle général)

> A = la couche Segmentation du canvas, **instanciation** du modèle général figé dans [`DESIGN_peritext_conventions.md`](DESIGN_peritext_conventions.md) §0 (multi-stade · capacités indépendantes · hiérarchie 2 grains · indices pluggables). Front + **une** petite greffe moteur (persistance du parent). Représentation tranchée : **pointeur parent** `meta_json.parent_*` (sans migration, réversible) — pas d'unités-paragraphe de 1ʳᵉ classe pour l'instant.

**Modèle de données.** Hiérarchie de contenance **paragraphe ⊃ phrase**. La phrase (unité `line`) porte son parent dans `meta_json` (`parent_n` = n du paragraphe). Le paragraphe n'est pas (encore) une unité : il est l'ensemble des phrases partageant `parent_n`. Réversible — promotion en unité-paragraphe possible plus tard si l'analyse au grain paragraphe le réclame.

**Ce que A expose dans le canvas.**

**1) Conscience du stade** (lecture seule, front pur). Le bandeau d'état dérive du data le **stade** du document — *brut* (≈1 unité longue) · *grossier* · *fin (phrases)* · *aligné* —, le **grain courant** et la **présence du parent ¶**. Dérivation : nb d'unités, longueur max, `external_id` peuplé ?, `meta_json.parent_*` présent ?, liens d'alignement ? *Sans cette conscience, pas de bonne action proposable — c'est le socle.*

**2) Visualisation de la hiérarchie** (lecture seule). Quand le parent existe, les phrases sont **groupées sous leur paragraphe** (séparateurs/retraits discrets), le texte restant le scroll central unique.

**3) Capacités de segmentation** (chacune applicable au stade courant ; toute opération destructive ⇒ confirm + WORKCOPY) :

- **Grain fin (phrase)** depuis indices pluggables (balises `[N]`, ponctuation/packs…), **en persistant le parent** au lieu de le jeter (défaut actuel, §0).
- **Grain grossier (paragraphe)** depuis indices pluggables (séparateurs `¤`, lignes vides, rôles structurels, re-lecture `source_path`) — **descendant** (brut) ou **ascendant** (regrouper des phrases déjà là).
- **Blob 2-grains** : extraire fin + grossier **en un seul passage** quand le balisage porte les deux.

**Garde-fous.** Resegmenter **supprime l'alignement** (ADR-017) → confirmation explicite, proto sur la **WORKCOPY**, jamais le corpus réel. La conscience du stade (1) prévient le geste destructeur hors-propos.

**Tranches A** (du plus sûr au plus engageant) :

- **A0 — Conscience du stade** (front pur, 0 risque) : étendre le bandeau → stade + grain + parent. *Prérequis du reste.*
- **A1 — Persistance du parent à la segmentation fine** (petite greffe moteur, WORKCOPY) : `resegment_document` remplit `meta_json.parent_*` au lieu de `None` (grounding §3, `segmenter.py:535` ; undo déjà couvert) + bouton « Resegmenter (phrases) » derrière confirm.
- **A2 — Établir le grossier** depuis indices (ascendant/descendant), persisté en parent.
- **A3 — Visualisation hiérarchique** (groupage sous ¶) + cas blob 2-grains.

**Hors A** (capacités voisines, séparées) : aligneur par longueurs borné (T6) · lift marqueurs `[T]/[Ch]` → rôles · concordancier au 2ᵉ grain. A *prépare* l'ancre que T6 consommera, sans le contenir.

**Ancrage code** : [`DESIGN_peritext_conventions_grounding.md`](DESIGN_peritext_conventions_grounding.md) §3 (parent dans `resegment_document`) & §4 (sections structurelles / endpoints existants) ; coquille canvas `tauri-prep/src/screens/TextCanvasView.ts` (bandeau d'état + RolesPane) à étendre.
