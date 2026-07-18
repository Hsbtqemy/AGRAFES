# Tranche 6 — D-P9 : tableau de progression dérivé (« où j'en suis ? »)

> Statut : **LIVRÉ (2026-07-18) — D-P9-1/2a/2b/3 mergés sur `refonte`, passes adverses incluses.** Dérive de
> [`DESIGN_alignment_parity_tranche6.md`](DESIGN_alignment_parity_tranche6.md) §8 (D-P9, D-P11) et de
> `ROADMAP_REFONTE.md` R3.4. **Front-dominant + moteur léger** (agrégat `/families` **additif**),
> **zéro migration, zéro contrat-freeze** (réponse `/families` non schématisée — vérifié `sidecar_contract.py:1928`).

## 0. Ce que D-P9 doit faire

Rendre la **progression du corpus lisible en un coup d'œil**, au grain document/famille, pour répondre à
« **où j'en suis / que reste-t-il ?** ». C'est le *suivi* que l'utilisateur voulait (§8 point C) — mais sous
la bonne forme : **dérivé** (calculé depuis les liens/couverture, jamais périmé), **pas** une signature
stockée. La leçon `workflow_status` (§8.1 : mort *parce qu'il ne pilote rien*) impose une contrainte dure :

> **La conséquence est la feature.** Chaque signal est **cliquable** et mène à l'**exact travail restant**
> (matrice pour un trou de couverture ; Révision fine pour « à réviser » / collisions). Sans ces liens, on
> ne fait qu'ajouter un badge mort de plus.

## 1. Constat vérifié — l'existant à ÉTENDRE (pas un nouvel écran)

Carte du front (2 sous-agents, 2026-07-18) :

- **« Documents » = `MetadataScreen`** (onglet `documents`, `app.ts:56`/`418`). Il porte déjà :
  liste plate `_renderDocList` + **vue hiérarchie** avec un **badge `completion_pct` par racine**
  (`MetadataScreen.ts:508-511`) ; un **panneau famille** `familyView.ts` pour le doc racine ouvert
  (`completion_pct`, `segmented_docs/total_docs`, `aligned_pairs/total_pairs`, `validated_docs`,
  `ratio_warnings` — `familyView.ts:59-74`) ; une **barre KPI** de 4 compteurs (total / validés / à traiter /
  langues) ; un **Audit corpus** à la demande (liste d'anomalies).
- **`GET /families`** calcule déjà, par famille : `completion_pct` (**50 % segmentation + 50 % couverture
  d'alignement**, `sidecar.py:6677-6683`), `aligned_pairs/total_pairs`, `segmented_docs/total_docs`,
  `validated_docs` (= `workflow_status='validated'` — **le mauvais axe**, §8.1), `ratio_warnings`.
- **`GET /align/quality`** a `status_counts {accepted, unreviewed, rejected}` + `collision_count` +
  `coverage_pct` + orphelins — **mais par paire pivot↔cible** (un seul appelant : `AlignPanel.ts:1127`).
- **Antériorité à réutiliser (revue adverse)** : `qa_report._check_alignment_pairs`
  (`qa_report.py:122-202`) fait **déjà**, en un `GROUP BY pivot_doc_id, target_doc_id`, les
  `n_accepted/n_rejected/n_unreviewed` (130-132) **et** le compte de collisions par paire (167-176) ;
  `generate_qa_report` en tire un **total collisions corpus** (`qa_report.py:360`). C'est le **gabarit de
  réutilisation privilégié** pour D-P9-1 (plus direct que le snippet mono-paire de `/align/quality`).
- **Gap central (confirmé) :** aucune de ces sources n'agrège la **vérification + collisions au grain
  FAMILLE** — `qa_report` groupe par paire, `/corpus/audit` (section `families`, `sidecar.py:7723-7730`)
  ne donne qu'orphelins / non-segmentés / paires-non-alignées / ratios (ni statuts, ni collisions). Les
  stats famille ne sont montrées qu'**une famille à la fois**. **Aucune vue d'ensemble.** → D-P9-1 =
  **re-grouper le gabarit `qa_report` au grain famille** (membres = parent ∪ enfants).

## 2. Le modèle — quatre signaux DÉRIVÉS

Par doc/famille, quatre signaux, **tous calculés** (aucun état stocké) :

| Signal | Sens | Source |
|---|---|---|
| **Couverture** | aligné X/Y **paires** (= paires ayant ≥ 1 lien, pas la couverture unité-par-unité) | 🟢 déjà dans `/families` |
| **Vérification** | accepté Z · **N à réviser** (non-révisé) | 🟡 **nouvel agrégat** (statut des liens) |
| **Collisions** | N **pivots** avec ≥ 2 beads/cibles distincts (hors rejetés) | 🟡 **nouvel agrégat** |
| **Cohérence** | ratios ¶ suspects | 🟢 déjà (`ratio_warnings`) |

> ⚠ **Direction de la collision (revue adverse)** : le code compte « un même **pivot** → plusieurs
> beads/cibles » (`sidecar.py:3436-3438` `GROUP BY pivot_unit_id … HAVING > 1`, tooltip `AlignPanel.ts:1144`),
> **pas** « ≥ 2 liens sur une cible ». Le libellé du signal doit suivre cette direction.

**Grain :** famille (rollup) ; par-paire au dépliage si utile. **Jamais périmé** (reflète toujours l'état réel).

**Ce que D-P9 NE fait PAS :** aucun **état stocké** ; aucune **machine à phases** (il *rapporte* chaque axe
indépendamment — « seg : faite · alignement : 90 % · vérif : 12 à réviser » — sans imposer d'ordre, cf.
principe R « capacités indépendantes ») ; aucun **gating** (ne bloque rien — D-P7 rend l'export non bloquant).

## 3. Surface & conséquence

**Étendre l'existant** (bas risque, découvrable là où l'utilisateur gère déjà ses docs) :

- le **panneau `familyView`** devient un mini **tableau de bord famille** (les 4 signaux) ;
- la **vue hiérarchie** porte un **résumé compact** par racine (le badge `completion_pct` actuel s'enrichit
  d'un « ✓ Z · ⚠ N à réviser · ⨯ C collisions »).

**La conséquence — les deep-links (le cœur de D-P9)** : chaque signal ouvre l'endroit du travail restant.
**Asymétrie à assumer (revue adverse) — un côté est gratuit, l'autre est à construire :**
- **« N à réviser » / collisions** → **Révision fine** pré-chargée : **réutilise `AlignPanel.scopeTo` (T6.2)**,
  méthode publique existante (`AlignPanel.ts:202`, `RevisionFineScope {pivotDocId, targetDocId, linkId?}`).
  Reste juste la **plomberie inter-écrans** (naviguer Documents → Alignement puis `scopeTo`).
- **Couverture < 100 %** → **matrice** sur cette famille : **aucun geste réutilisable** — `AlignMatrixView`
  n'a pas d'équivalent public de `scopeTo` (la famille ne se fixe que via le `<select>` `#matrix-family`).
  → **nouvelle méthode publique de pré-sélection de famille à construire** (petite, cf. `scopeTo`).

C'est ce qui distingue D-P9 d'un badge mort : il *fait entrer* dans le bon écran, sur le bon scope.

## 4. Coût

- **Moteur (léger)** : étendre l'agrégat du listing familles (`_handle_families`) avec `status_counts`
  + `collision_count` **par famille** — SQL sur `alignment_links` ⋈ membres de la famille (les collisions se
  comptent déjà par paire dans **`qa_report._check_alignment_pairs` (`qa_report.py:122-202`)** — le
  **gabarit de réutilisation privilégié**, à re-grouper sur les paires parent↔enfant). **Additif ; réponse
  `/families` non schématisée → zéro contrat-freeze ; zéro migration.**
- **Front** : (a) signaux dans `familyView` + vue hiérarchie ; (b) deep-link à-réviser/collisions →
  **réutilise `scopeTo`** ; (c) deep-link couverture → **nouvelle méthode publique de pré-sélection famille
  sur `AlignMatrixView`** (à construire, cf. §3 — pas d'équivalent `scopeTo` côté matrice).
- **Alternative écartée** : agréger côté client via N appels `/align/quality` (chatty — N paires × familles).

## 5. Décisions à figer (reco par défaut)

- **D-P9a — Surface.** Étendre `familyView` + vue hiérarchie **vs** nouvel écran dashboard. **Reco : étendre**
  (découvrable, bas risque, réutilise le scaffolding existant).
- **D-P9b — Agrégation.** Moteur (étendre `/families`) **vs** client. **Reco : moteur** (1 appel, additif, non
  chatty).
- **D-P9c — `completion_pct`.** **Garder = couverture** (seg + align) ; **NE PAS** y fondre la vérification
  (§8 point C : axe séparé). La vérification est un signal **distinct** (« N à réviser »). **Reco : oui.**
- **D-P9d — `validated_docs` (ambigu).** Le stat existant agrège `workflow_status` (= segmentation, §8.1).
  Dans ce tableau : le **remplacer** par l'agrégat dérivé « acceptés / liens » et **sortir** `workflow_status`
  de la progression d'alignement (il reste ce qu'il est ailleurs). **Reco : remplacer** (lève « validé de quoi ? »).
- **D-P9e — Deep-links.** à-réviser/collisions → Révision fine (**`scopeTo`, gratuit**) ; couverture →
  matrice (**nouvelle pré-sélection famille à construire** — asymétrie §3). **Reco : oui — c'est LA
  conséquence** qui empêche le badge mort.

## 6. Découpage en tranches

1. **D-P9-1 [MOTEUR] ✅ (fait)** — agrégat `status_counts` + `collision_count` par famille dans `/families`,
   prédicats de `qa_report._check_alignment_pairs`, **attribués par PAIRE normalisée `(min,max)`
   (sens-agnostique)** et non par `pivot_doc_id` seul : sinon un lien pivot=enfant (crédité en couverture)
   serait ignoré en vérification, et un lien racine→hors-famille sur-compterait (revue adverse D-P9-1).
   Type client `FamilyStats` étendu (champs optionnels). 4 tests (dont orientation inverse + hors-famille).
2. **D-P9-2 [FRONT] ✅ (fait)** — deux parties :
   - **2a — affichage** (`82e0c3b`) : `familyView` montre les signaux dérivés (« ✓ N révisé(s) · M à
     réviser · K rejeté(s) » + « ⨯ C collision(s) »), remplaçant « N validé(s) » (D-P9d), repli sur
     `validated_docs` si sidecar ancien.
   - **2b — deep-links FAMILLE-scopés** : chaque signal ACTIONNABLE est un bouton `.prep-fam-deeplink`
     menant à l'exact travail restant. Chaîne de nav en 5 maillons : `MetadataScreen.setOnOpenAlignment`
     (délégué sur les boutons) → wiring `app.ts` (App orchestre) → `ActionsScreen.openAlignmentOnFamily`
     (bascule sous-vue via `_wfRoot`) → **`AlignMatrixView.selectAndLoadFamily`** (couverture < 100 % →
     matrice, méthode publique construite ici — pas d'équivalent `scopeTo` côté matrice, note §3) **ou**
     **`AlignPanel.reviewFamily`** (« à réviser » / collisions → Révision fine mode famille, famille-scopé
     ≠ `scopeTo` paire-scopé). 4 fichiers de tests (17 cas).
3. **D-P9-3 [FRONT] ✅ (fait)** — la vue hiérarchie porte, par racine, un **cluster compact des signaux
   dérivés** à côté du badge `completion_pct` (`hierFamilySignalsHtml` + `_renderHierarchyList`). Choix de
   compacité (ligne de table dense) : seuls les signaux **actionnables** sont visibles inline — **⚠ N** (à
   réviser) et **⨯ C** (collisions) ; le détail complet (✓ Z révisés · N à réviser · K rejetés · C
   collisions) est dans l'**infobulle**. Non cliquable ici (ouvrir la racine mène au panneau famille qui
   porte les deep-links D-P9-2b). **`validated_docs` (D-P9d) : ambiguïté levée par le vocabulaire** — la
   progression d'alignement parle de « **révisé** » (statut des liens) partout ; « **validé** » reste
   réservé au `workflow_status` du document (KPI « N validés » **inchangé**, axe segmentation « ailleurs »).
   3 tests hiérarchie + 4 tests `hierFamilySignalsHtml`.

**Ordre : moteur d'abord** (le front en dépend).

## 7. Risque & liens

- **Risque faible** : additif, non-destructif, réutilise `scopeTo` (T6.2) + la nav sous-vues. Le seul vrai
  risque — **refaire un badge mort** — est conjuré par les deep-links (D-P9e) : la conséquence *est* la feature.
- **Zéro migration, zéro contrat-freeze** (réponse `/families` non schématisée).
- **Revue adverse de la NOTE (2026-07-18)** : prémisse **saine** (gap réel, freeze nul, `scopeTo`
  réutilisable). 3 corrections intégrées : (1) antériorité `qa_report._check_alignment_pairs` citée comme
  source de réutilisation ; (2) direction de la collision corrigée (par **pivot**, pas par cible) ; (3)
  asymétrie des deep-links explicitée (matrice = pré-sélection à construire, ≠ `scopeTo`).
- **Revue adverse de l'IMPLÉMENTATION D-P9-2b (2026-07-18)** : câblage inter-écrans (classe du bug
  race T6.2). 3 points traités — (1) **chargement concurrent matrice** : `onActivated` lance un
  `_loadFamilies` non attendu que `selectAndLoadFamily` télescope ; converge sans divergence car
  `_loadFamilies` lit `prev` APRÈS son `await` (test dédié) ; (2) **faux succès sans connexion** :
  `selectAndLoadFamily`/`reviewFamily` renvoyaient un `true` silencieux (no-op) → garde conn explicite
  + toast (2 tests) ; (3) **ré-entrance revue famille** : s'appuie sur `_familyLoading` (pas de jeton de
  séquence) — atteignable seulement en repassant par « Documents » (≫ latence audit loopback), double-clic
  idempotent → accepté et documenté. La délégation clic→`onOpenAlignment` est testée sur le VRAI
  `_renderEditPanel` (le maillon dont une faute reproduirait un « badge mort »).
- **Revue adverse de l'IMPLÉMENTATION D-P9-1 (2026-07-18)** : 2 bugs corrigés — l'agrégat filtrait
  `pivot_doc_id = racine` seul ⇒ (Q1) liens **pivot=enfant** ignorés en vérification mais crédités en
  couverture (contradiction inter-axes), (Q3) liens **racine→hors-famille** sur-comptés. Fix = attribution
  par **paire normalisée** (comme `aligned_pairs`). Collision/edge/clés confirmés corrects. Tests étendus.
- **Caveat pré-existant (à gérer en D-P9-2)** : `aligned_pairs`/`completion_pct` ne filtrent pas le statut
  ⇒ une famille dont **tous** les liens sont rejetés compte comme « alignée ». Le front ne doit pas lire
  `completion_pct` seul comme « prêt » — croiser avec `status_counts` (accepté vs rejeté).
- **Notes liées** : périmètre = [`DESIGN_alignment_parity_tranche6.md`](DESIGN_alignment_parity_tranche6.md)
  §8 (D-P9 dérivé, D-P11 « accepté » vivant) ; handoff réutilisé = T6.2 (`AlignPanel.scopeTo`) ; diagnostic
  `workflow_status` = §8.1 + `DECISIONS.md:724`.
