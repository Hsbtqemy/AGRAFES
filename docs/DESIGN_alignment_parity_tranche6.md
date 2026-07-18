# Tranche 6 — « Révision fine » : parité matrice ↔ `AlignPanel` (cadrage)

> Statut : **cadrage figé + revu (2026-07-18) — ticket-ready**. Décisions tranchées : **D-P3 = famille-only**
> (utilisateur) ; D-P1/D-P2/D-P4/D-P5/D-P6 = par reco (§3). Passe adverse §6.
> Dernier item du plan alignement ([`DESIGN_alignment_workspace.md`](DESIGN_alignment_workspace.md) §6-6).
> Miroir méthodo de [`DESIGN_R6_4_canvas_parity.md`](DESIGN_R6_4_canvas_parity.md) (le retrait legacy est **gaté sur parité**).
> Ancrage : inventaire code des deux surfaces (2 sous-agents, 2026-07-18). Légende : 🟢 sûr · 🟡 à faire · 🔴 décision.

## 0. Ce que tranche 6 doit faire

La matrice (`AlignMatrixView`, 1686 l.) et l'ancien `AlignPanel` (1809 l.) sont aujourd'hui **deux
onglets frères** dans `ActionsScreen` (`« matrice »` et `« alignement »`), à égalité. La tranche 6 =
faire de la **matrice la surface primaire** et reléguer `AlignPanel` en **mode secondaire « Révision
fine »** (D-W1). **Pur front.** Ce document cadre la parité *avant* de reléguer — pour ne perdre
aucune capacité utile (leçon AnnotationView : ne pas déprécier un écran encore utile).

## 1. Constat central — surfaces **complémentaires**, pas concurrentes

Contrairement au canvas (24 écarts de *recouvrement*), la matrice et `AlignPanel` font des choses
**différentes par conception**, ce que prouve la **partition de leurs endpoints** :

| Endpoint | Matrice | `AlignPanel` | Nature |
|---|:---:|:---:|---|
| `/align/matrix` | ✅ | — | projection famille (matrice) |
| `/align/cell_status`, `/units/bulk_set_status` | ✅ | — | statuts de cellule (∅ / ajout) |
| `/families/{id}/align` | ✅ | ✅ | run famille |
| `/align/links/batch_update` (span/bead/status/delete) | ✅ | ✅ | mutation de liens |
| `/align/link/create` · `/delete` · `/retarget` · `/retarget_candidates` | ✅ | ✅ | gestes de lien |
| `/align/collisions/resolve` | ✅ (primitif *delete* du ✕) | ✅ | résolution |
| `/jobs/enqueue` (`kind:align`) | — | ✅ | **run paire ad-hoc async** |
| `/align/audit` (limit/offset) | — | ✅ | **audit paginé lien-par-lien** |
| `/align/link/update_status` | — | ✅ | **statut accepté/rejeté/non-révisé par lien** |
| `/align/collisions` (liste) | — | ✅ | **panneau Collisions** |
| `/align/quality` | — | ✅ | **panneau Qualité** |
| `/align/source_changed_summary` | — | ✅ | **bannière « source modifiée »** |
| `/units` (liste orphelins pivot) | — | ✅ | **orphelins pivot** |

Les endpoints **propres à `AlignPanel`** sont *exactement* la boucle d'audit statut/qualité. Et la
matrice **délègue déjà explicitement** à « Révision fine » (chaque 409, chaque vraie collision ≥ 2
liens aligneur, chaque lien rejeté → message « passer par la Révision fine »). **`AlignPanel`-en-
Révision-fine est donc le foyer PRÉVU de ces fonctions. Reléguer ≠ perdre.**

## 2. Table de parité — quatre sacs

### 2.1 🟢 Redondant → **retirer** (la matrice fait mieux)

| Capacité `AlignPanel` | Réf. | Verdict |
|---|---|---|
| « Réviser famille » (mini-matrice **côté client**, `/align/audit` en boucle par enfant) | `#align-family-review-btn` → `#align-family-bitext` | 🟡 **LAYOUT** repris par la matrice, **PAS la revue statut/rejet multi-cibles** — la matrice n'importe pas `updateAlignLinkStatus` et **cache les liens rejetés** (F8, `AlignMatrixView.ts:333`) ; retombe sur l'audit **paire-scopé** (§2.2) → **retrait conditionné à T6.2** *(revue adverse R2)* |
| Aligner-famille + stats famille inline | `#align-family-run-btn` / `#align-family-stats` | 🟡 run/stats portés par la matrice, **mais pas le handoff post-run** (`run_id`, étape-suivante) → §2.5 ; retrait conditionné à T6.2b |

### 2.2 🟢 Reste **tel quel en Révision fine** (c'est *ça*, la Révision fine)

Aucun équivalent dans la matrice ; elle y renvoie. **Conservé.**

| Capacité | Endpoint |
|---|---|
| accepter / rejeter / non-révisé **par lien** (tri-état) | `/align/link/update_status` |
| panneau **Collisions** (liste paginée + keep/reject/delete + « tout supprimer » un groupe) | `/align/collisions` (+ `/resolve`) |
| panneau **Qualité** (couverture %, orphelins pivot **et** cible, collisions, statuts, échantillons) | `/align/quality` |
| **audit paginé** lien-par-lien (limit/offset, « Charger plus ») | `/align/audit` |
| filtres statut (chips Tout/Acceptés/Rejetés/Non-révisés) + **recherche texte** | client |
| « **Suivant** » — saut au prochain non-révisé (revue séquentielle) | DOM |
| **actions en lot** (multi-sélection + tout sélectionner + accept/reject/unreview/delete) | `/align/links/batch_update` |
| orphelins **pivot** (segments VO jamais liés → créer un lien) | `/units` + create |
| résumé de run + avertissements consultatifs par cible (D4 « % ¶ non appariés », D7 « grain ¶ ») | résultat de job |

> ⚠ **Exception (revue adverse R3) — la bannière « source modifiée » ne « reste PAS sans coût ».** C'est
> une alerte **niveau-écran non sollicitée** (`getAlignSourceChangedSummary`, sans paire — `AlignPanel.ts:186-190` :
> « le traducteur voit immédiatement, sans ouvrir une paire »). La matrice (future primaire) **n'appelle
> jamais** cet endpoint et n'a aucune bannière → reléguée en secondaire, l'alerte est **enfouie derrière une
> bascule que l'utilisateur n'ouvrira pas** (auto-défaite). → **la hisser sur la matrice**, ou **élargir le
> badge D-P5** au compteur `source_changed` (endpoint distinct du badge audit/collisions).

### 2.3 🔴 Le vrai trou à trancher — **run paire ad-hoc**

`AlignPanel` aligne une **paire pivot↔cible arbitraire** (hors famille) via **file de jobs async**
(`/jobs/enqueue kind:align`, suivi `JobCenter`). La matrice n'aligne **que des familles**, en
**synchrone** (`/families/{id}/align`). → **D-P3** : le modèle source-ancré est-il *famille-only*
désormais (on crée une famille puis on aligne → le run paire devient obsolète), ou Révision fine
garde-t-elle le run paire (+ le suivi async utile aux gros docs) ?

### 2.4 🟠 Colle d'intégration — **le vrai travail neuf**

| # | À construire | Pourquoi |
|---|---|---|
| a | **Point d'entrée « Révision fine »** (bascule mode secondaire depuis la matrice) + retrait de l'onglet `« alignement »` du premier plan | la matrice cite « Révision fine » mais rien ne l'ouvre |
| b | **Handoff scopé** : une cellule matrice → Révision fine **pré-chargée** sur la paire `moyeu ↔ doc-colonne` + scroll au lien | `AlignPanel` est **paire-scopé** (sélecteurs pivot/cible), la matrice **famille-scopée** — la jointure est la pièce d'ingénierie |
| c | **Badge de découvrabilité** « N à réviser · N collisions » sur l'accès Révision fine | en secondaire, la boucle statut ne doit pas devenir introuvable (leçon AnnotationView) |

Parité déjà acquise (faible risque) : ré-ancrer/retarget, créer/supprimer un lien, couper/annuler un
bead, résoudre une collision, aligner une famille, **choix de stratégie/Avancé** (les deux surfaces
l'exposent).

### 2.5 🟠 Handoff post-run — **oublié de l'inventaire (revue adverse R4)**

`AlignPanel` porte une couche de **chaînage post-run** que la matrice n'a PAS (construite avec
`{ toast }` seul, `AlignMatrixCallbacks`) :

| Capacité | Réf. | Enjeu |
|---|---|---|
| bandeau « étape suivante → Exporter » après un run réussi | `NextStepBanner` / `_navigateNextStep` | découvrabilité (leçon AnnotationView) |
| `onRunDone` → **persistance du `run_id`** (`_alignRunId` + localStorage) | `ActionsScreen:445-450` | **load-bearing** : `prefill.runId` de l'Export d'alignement (`ActionsScreen:822`) |
| `onNav` / `onOpenExporter` (deep-link + Exporter prérempli) | `AlignPanelCallbacks` | chaînage aval |

Si la matrice devient la surface de run primaire (§2.1 retire aligner-famille), **deux régressions
silencieuses** : (a) aucune guidance « → Exporter » après un run matrice ; (b) `prefill.runId` reste
**périmé** → l'Export d'alignement référence le **mauvais run**. → **D-P6**.

## 3. Décisions à figer (reco par défaut, à confirmer avant ticket)

- **D-P1 — Point d'entrée.** Bascule de barre depuis la matrice **et** action contextuelle « renvoyer
  ce lien en Révision fine » depuis une cellule. **Reco : les deux** (la matrice a déjà les *messages*,
  il manque le *lien cliquable*).
- **D-P2 — Handoff scopé (le gros morceau).** Ouvrir Révision fine pré-chargée sur `moyeu-doc ↔
  colonne-doc` + lien ciblé. **Reco : oui** — sans ça, la délégation « passer par la Révision fine »
  reste un cul-de-sac manuel (l'utilisateur doit re-sélectionner la paire à la main).
- **D-P3 — Run paire ad-hoc. → TRANCHÉ (2026-07-18) : famille-only.** La famille est un **élément
  premier du process** : aligner passe par le moyeu, donc « aligner deux docs » = les **constituer en
  famille** puis aligner. Le run paire + jobs async d'`AlignPanel` **disparaît** (T6.4). **Corollaire à
  couvrir** : la création/liaison de famille doit rester **à faible friction** depuis le contexte
  alignement — déjà acquis (`familyDetect` à l'import P6 + `translation_of` dans `MetadataScreen`) ; le
  seul ajout utile est un **guidage** « pas de famille ? en créer une » pour un utilisateur qui arrive sur
  la matrice avec deux docs non liés (à intégrer à T6.4, pas bloquant).
- **D-P4 — Retrait « Réviser famille ».** **Reco : supprimer le LAYOUT, mais seulement APRÈS T6.2**
  (le handoff paire-scopé) — sinon la revue statut/rejet à l'échelle famille devient inatteignable entre
  le retrait et le handoff (revue adverse R2). **Pas « safe » inconditionnellement.**
- **D-P5 — Découvrabilité.** **Reco : badge** « N à réviser · N collisions · **N sources modifiées** »
  sur l'accès Révision fine — **inclure le compteur `source_changed`** (endpoint distinct), sinon l'alerte
  source-modifiée niveau-écran devient auto-défaite (revue adverse R3). Alternative : hisser la bannière
  sur la matrice.
- **D-P6 — Handoff post-run (revue adverse R4).** Avant de retirer le run famille d'`AlignPanel` (D-P4),
  **câbler `onRunDone` (persistance `run_id`) + bandeau étape-suivante + `onOpenExporter` sur
  `AlignMatrixView`** — sinon l'Export d'alignement régresse (`run_id` périmé, plus de guidance).
  **Reco : câbler sur la matrice** (surface de run primaire).

## 4. Découpage en tranches (proposé)

Pur front, incrémental, chaque tranche livrable seule :

1. **T6.1 — Bascule + relégation** (D-P1 partiel, D-P5) : la matrice devient l'entrée primaire
   d'alignement ; l'onglet `« alignement »` quitte le premier plan et devient « Révision fine »
   accessible via bascule + badge de découvrabilité. *(Le plus visible, faible risque.)*
2. **T6.2 — Handoff scopé** (D-P1 complet, D-P2) : action contextuelle sur une cellule/message →
   Révision fine pré-chargée sur la bonne paire + lien. *(Le morceau d'ingénierie — la jointure
   famille-scopé ↔ paire-scopé.)*
3. **T6.2b — Handoff post-run + alerte source-modifiée** (D-P6, D-P5/R3) : câbler `onRunDone`
   (persistance `run_id`) + bandeau « → Exporter » + `onOpenExporter` sur la matrice ; hisser/élargir
   l'alerte « source modifiée ». **Prérequis au retrait** (T6.3) — sinon régression Export + découvrabilité.
4. **T6.3 — Retrait du redondant** (D-P4) : supprimer « Réviser famille » + aligner-famille dupliqué
   d'`AlignPanel` — **seulement après T6.2 (handoff) et T6.2b (post-run)**.
5. **T6.4 — Run paire** (D-P3) : selon la décision, migrer « créer une famille » ou garder le run
   paire en Révision fine.
6. **(Différé, §3.5 de la note alignement)** regroupement visuel « tranches d'un même bead » dans le
   panneau Révision fine.

**Ordre : T6.1 → T6.2 → T6.2b → T6.3 → T6.4.** T6.1 pose la nouvelle IA ; T6.2 rend la délégation
utilisable ; **T6.2b protège l'Export + les alertes (revue adverse) avant tout retrait** ; T6.3/T6.4
nettoient.

## 5. Risque & liens

- **Risque : faible mais pas nul (revue adverse 2026-07-18).** Aucun trou *bloquant* — l'info/fonction
  reste atteignable. MAIS la matrice ne porte PAS trois « colles » d'`AlignPanel` : la **revue statut/rejet
  à l'échelle famille** (R2), l'**alerte source-modifiée niveau-écran** (R3) et le **handoff post-run**
  `run_id`/étape-suivante (R4). Ce n'est pas « tout reste » gratuitement : chacune exige soit un câblage sur
  la matrice (T6.2b), soit un retrait **conditionné** au handoff (T6.2). La **partition d'endpoints (§1)** et
  la **faisabilité de D-P2** sont, elles, **vérifiées exactes** par la passe.
- **Zéro moteur, zéro migration, zéro contrat** — repositionnement UI pur (tous les endpoints existent).
- **Notes liées** : plan alignement = [`DESIGN_alignment_workspace.md`](DESIGN_alignment_workspace.md)
  (§8 « ce qu'on garde/relègue de l'`AlignPanel` ») ; discipline de parité = [`DESIGN_R6_4_canvas_parity.md`](DESIGN_R6_4_canvas_parity.md) ;
  prévention amont = [`DESIGN_upstream_anchoring.md`](DESIGN_upstream_anchoring.md).

## 6. Revue adverse (2026-07-18) — 4 vérificateurs, 3 corrections

Passe adverse sur cette note (vérification des affirmations contre le code réel) :

- **R1 — partition d'endpoints (§1) : EXACTE.** Chaque case ✅/— vérifiée ligne à ligne (imports/appels
  des deux écrans + `sidecarClient.ts`). La complémentarité tient.
- **R2 — « Réviser famille » PAS pleinement redondant** *(minor, corrigé §2.1)* : la matrice reprend le
  layout mais pas la revue statut/rejet par lien (ne pose pas de statut, cache les rejetés F8).
- **R3 — bannière « source modifiée » sous-estimée** *(minor, corrigé §2.2 + D-P5)* : alerte niveau-écran
  auto-défaite si enfouie en secondaire.
- **R4 — handoff post-run oublié** *(minor, ajouté §2.5 + D-P6)* : `onRunDone`/`run_id`/étape-suivante
  absents de la matrice → Export régresserait.
- **Faisabilité D-P2 confirmée** : `AlignPanel` n'a pas d'API publique de scoping, mais l'ajouter est
  faisable (fixer les 2 selects + `_loadAuditPage` + scroll ; pivot = parent famille déjà mappé).

Effet net : le plan reste sain, mais **T6.2b (handoff post-run) devient prérequis au retrait (T6.3)**, et
D-P4 n'est plus « safe » inconditionnel.

## 7. Journal de livraison

- **T6.1 — Bascule + relégation — LIVRÉ (commit `9f1aaf0`).** La matrice devient la surface primaire
  « Alignement » ; l'ancien `AlignPanel` passe en secondaire « Révision fine » (bascule de barre +
  nav dé-emphasée). Fix de routage (revue adverse) : les flux « aller à l'alignement » (dont la CTA
  primaire étape-suivante) routaient encore vers l'ex-`AlignPanel` — corrigés vers la matrice.
- **T6.2 — Handoff scopé — LIVRÉ (non committé au moment de l'écriture).** Bouton `🔎` par cellule liée
  (`prep-matrix-review-btn`, branches `ok`/`fused`) → `AlignMatrixView._onReviewClick` résout la cellule
  en `RevisionFineScope {pivotDocId = moyeu = family_id, targetDocId = doc-colonne, linkId}` (nouveau
  `lib/revisionFineScope.ts`, pur) → `ActionsScreen` bascule la sous-vue puis appelle la **nouvelle API
  publique** `AlignPanel.scopeTo` (fixe les 2 selects, remet les filtres à « tout », `_loadAuditPage`,
  scroll + surbrillance du lien). Garde F1 (connexion changée) sur le handoff. Tests : grille
  (`prep-matrix-review-btn`), résolution matrice (happy + F1), `scopeTo` (paire/filtres/paire-introuvable/
  lien-hors-page/**course**). **Revue adverse (2 vérificateurs)** : résolution cellule→scope **correcte**
  (preuve moteur `family_id == pivot_doc_id`) ; câblage inter-écrans **sain** ; **1 finding corrigé** —
  `_loadAuditPage` sans garde de réentrance → jeton de séquence `_auditSeq` (deux handoffs `🔎` rapides
  sur des paires différentes, résolus hors-ordre, laissaient grille/offset désynchronisés des selects ;
  test RED-sur-ancien). vitest 1071 · tsc · eslint.
  - *Reste connu (mineur, non bloquant)* : une cellule `empty` PORTANT un lien (coupe à vide, cas G5)
    n'offre pas `🔎` (choix : réviser où une traduction s'affiche) ; un lien au-delà de la 1re page
    d'audit (50) n'est pas scrollé mais signalé ; le regroupement visuel « tranches d'un même bead »
    reste différé (§4.6).

## 8. Périmètre validation & suivi — conclusion (2026-07-18, vérifiée au code)

Discussion produit approfondie (après QA de T6.1/T6.2) : *pourquoi* entrerait-on dans la « Révision
fine », et la matrice ne peut-elle pas tout gérer ? La vérif contre le code a **éliminé la moitié du
travail envisagé** (T6.2b/validation-dans-la-matrice) au profit d'**un seul geste net**.

### 8.1 Constats vérifiés

- **La matrice suffit au travail structurel.** Créer / couper / fusionner / rattacher / **✕ retirer** /
  aligner une famille : tout est dans la matrice. Le `✕` est un **delete** (`resolveCollisions
  {action:"delete"}`, `AlignMatrixView:1311`), **pas** un statut rejeté — la matrice ne pose **aucun
  statut**.
- **Deux axes de validation coexistent sans se parler** : (a) `alignment_links.status`
  (accepté/rejeté/non-révisé) au grain **lien**, dans la Révision fine ; (b) `documents.workflow_status`
  (`draft`/`review`/`validated` + `validated_at`/`validated_run_id`, **migration 005**) au grain
  **document/famille**, dans MetadataScreen. **Marquer un doc « validated » n'accepte aucun lien.**
- **Piège de l'export vide (vivant, latent).** L'aligneur insère ses liens **sans statut** → `NULL` =
  non-révisé (`aligner.py:298`, pas de colonne `status` au `VALUES`). L'export TEI filtre par défaut sur
  **`status_filter=["accepted"]`** (`exporters/tei.py:405`, `tei_package.py:91`, `sidecar.py:9354`), et
  l'UI Prep **ne passe jamais** de `status_filter` (`ExportsScreen.ts:736-741` = `include_structure /
  include_alignment / tei_profile` seulement). → une famille tout juste alignée, non validée, exporte une
  **section alignement vide** (derrière la case « inclure l'alignement »).
- **Pourquoi `workflow_status` est mort** (diagnostic — *ne pas le relancer à l'aveugle*) : (1) **déjà pris
  par la segmentation** — valider la segmentation écrit `workflow_status="validated"`
  (`SegmentationView.ts:1346`) → « validé de quoi ? » ; (2) **ne pilote rien de porteur** — des badges
  (liste seg, TextCanvas, doc-table) + **une** stat famille (`validated_docs`, `sidecar.py:6648`) ; l'export
  **l'ignore**, aucun filtrage, aucun gating. `DECISIONS.md:724` l'avait **prédit** : « sans piloter
  navigation / filtrage / automatisation, ça reste purement visuel » ; (3) **enterré** dans le panneau
  d'édition Metadata (`MetadataScreen.ts:791-792`).
- **« accepté » a une conséquence VIVANTE hors export** (contrairement à `workflow_status`) : au recalcul
  global (`preserve_accepted`, activé par défaut sur « Aligner »), les liens `accepted` sont **préservés**
  et tout le reste effacé/recomputé (`_prepare_alignment_replace`, `sidecar.py:339-357`). C'est un statut
  **load-bearing**, pas décoratif — le sémantique réel est « épingler : l'aligneur ne clobber pas ce que
  j'ai vérifié ».
- **Le TEI filtre, il n'annote pas** : chaque `<link>` ne porte que `@target` (`tei.py:552`) ; `al.status`
  est *sélectionné* (ligne 147) mais **jamais émis** → la provenance (humain-vérifié vs machine) est
  **perdue à l'export**. Et `JobEnqueueRequest.params` est **opaque** (`additionalProperties: True`,
  `sidecar_contract.py:4641`) → ajouter un `status_filter` a **zéro impact contract-freeze**.

### 8.2 Décisions figées *(affinées par la passe A→D, 2026-07-18)*

- **D-P7 — Export = « non rejeté » par défaut *(point A tranché : forme 3)*.** Basculer le défaut des
  exporters TEI de `["accepted"]` vers **« tout sauf rejeté »**. **Sûr par monotonie** : « non rejeté »
  ⊇ « accepté » → on ne retire jamais un lien accepté, on ajoute le non-révisé (sortie brute de
  l'aligneur) ; le seul cas restrictif (spécialiste voulant *seulement* son sous-ensemble validé) est
  couvert par l'option. **Forme retenue : défaut + interrupteur VISIBLE** dans l'UI export (« tous sauf
  rejetés ▾ / seulement validés ») + **décompte** (« N liens, dont M non-révisés ») — transparent *et*
  sans friction, pas de flip silencieux. **Contract-freeze : nul** (params opaque, §8.1). On **écarte**
  l'alternative « l'aligneur crée les liens en `accepted` » (tautologie, tuerait l'axe). *Coût : ~2
  exporters + 1 contrôle UI (deux surfaces d'export `v2-*`/legacy — câbler la vivante).* **Prochain lot
  concret, à la place de T6.2b.**
- **D-P8 — Pas de validation dans la matrice.** Elle porte déjà ✂ ⭙ ↺ ✕ ＝ 🔎 par cellule ; y greffer un
  statut par lien l'alourdirait, et D-P7 rend la validation-pour-export inutile. La matrice reste
  **structure + rejet**.
- **D-P9 — Suivi doc/famille = tableau DÉRIVÉ, pas résurrection de `workflow_status` *(point C tranché)*.**
  Deux sortes de suivi : *signature explicite stockée* (`workflow_status` — action humaine, peut mentir,
  déjà mort/pris par la segmentation) vs *progression dérivée* (calculée depuis les liens/couverture,
  jamais périmée). **Le suivi voulu est le dérivé** : par doc/famille, agréger les signaux **vivants** —
  couverture (aligné X/Y) + **acceptés Z/Y** (l'axe gardé en D-P11) + N collisions — affiché dans
  **Documents**. Zéro état stocké, zéro migration, jamais périmé ; **respecte « capacités indépendantes »**
  (rapporte chaque capacité sans imposer d'ordre → évite la machine à phases). Largement **déjà calculé**
  (`aligned_count`/`total_pairs`/`segmented_docs`, `sidecar.py:6656`) ; il « manque » l'agrégat *vérifiés*
  + la surface. Corollaire : la stat `validated_docs` agrège le **mauvais axe** (`workflow_status` de
  segmentation) → à réagréger. **Sort de pause, séquencé APRÈS D-P7.**
- **D-P10 — « Révision fine » → microscope optionnel.** Une fois D-P7 en place, elle ne retient **aucune
  étape obligatoire** : accept/reject fin *pour le spécialiste* + collisions + qualité + orphelins +
  source-modifiée. **Reléguer devient enfin cohérent.** Renommage (« Contrôle / Audit ») différé avec le
  reste de l'endgame.
- **D-P11 — Garder « accepté » *(point B tranché)*.** Ce n'est **pas** un statut mort : il est *load-bearing*
  via `preserve_accepted` (protège du recalcul, §8.1). Post-D-P7 son identité se recentre sur **« épinglé /
  vérifié / survit au ré-alignement »** (+ provenance + marqueur de progression), **plus** « valider-pour-
  export ». **Garder** (asymétrie : gratuit à garder, destructif à retirer), **ne pas exiger**, **scope UI
  au microscope** (matrice légère, D-P8). *Corollaire noté, non décidé* : la matrice peut déclencher un
  recalcul mais ne permet pas de voir/poser un accepté → le sens matrice-pertinent serait « épingler avant
  de re-aligner » ; affordance remontable plus tard (touche D-P8).
- **D-P12 — Parcolab : filtrer vs annoter → DIFFÉRÉ *(point D, info indisponible)*.** Le TEI *filtre* mais
  n'*annote* pas le statut (§8.1). Fork : **filtrer** (sous-ensemble curé, provenance perdue — actuel) vs
  **annoter** (émettre tout-sauf-rejeté taggé `@cert`, le consommateur filtre). **Déclencheur pour trancher :**
  savoir si **Parcolab lit un `@cert`/statut** (→ annoter, + le défaut D-P7 suffit) ou **traite chaque
  `<link>` comme vérité** (→ filtrer est le seul levier qualité, + prévoir un **profil `parcolab`** défaut
  « accepté seulement » ; le mécanisme `tei_profile` existe déjà). *Info attendue « bien plus tard » — ne
  bloque pas D-P7.*

### 8.3 Effet sur le plan §4

- **Prochain lot = D-P7 (export « non rejeté », forme 3)** — remplace T6.2b comme prochaine action.
- **T6.2b / T6.3 / T6.4** restent valides mais **descendent en priorité** : la validation n'étant plus une
  étape requise, le retrait du redondant (T6.3) n'est plus bloqué par un handoff post-run critique.
- **Suivi (D-P9)** sort de pause **reformulé en tableau dérivé** (post-D-P7), hors résurrection de
  `workflow_status`.
- **D-P12 (Parcolab)** reste ouvert jusqu'à l'info aval ; sans effet sur D-P7.
