# Note de design — R3.3 (queue) : éditeur de beads manuel (fusion / scission / ré-attribution)

> Statut : **intention de design — décisions à figer avant ticket**. Date : 2026-07-01.
> Queue différée de R3.3 ([`ROADMAP_REFONTE.md`](ROADMAP_REFONTE.md) §R3.3 · [`DESIGN_R3_sentence_alignment.md`](DESIGN_R3_sentence_alignment.md) **D2**/§6).
> Dépend du modèle `bead_id` (R3.2, **migration 022** livrée) et réutilise la mutation de liens existante (`/align/links/batch_update`, retarget, create/delete).

## 0. Prérequis — ⚠️ besoin non démontré (pas d'intégrité en jeu)

**Avant de coder, ce point tempère.** Contrairement au reste de R3.2/R3.3, un bead est **déjà fidèle en données** sans cet éditeur : un N-M (1-2/2-1/2-2) est matérialisé en liens 1-1 partageant un `bead_id`, et la détection de collision les traite déjà comme *un seul* bead voulu (cf. §2). L'éditeur n'apporte donc **pas** de correction d'intégrité — c'est un **confort de curage** : recomposer à la main un bead que l'aligneur a mal découpé, ou en fabriquer un là où le curateur voit une phrase éclatée.

Conséquence, dans la discipline de la [note blob](DESIGN_R2_3_blob_two_grain.md) §0 : **ne pas coder sans cas réel.** Le préalable au ticket est **un exemple concret** issu du curage d'un vrai corpus (« ici l'aligneur a produit deux 1-1 alors que c'est un 1-2 que je veux grouper », ou l'inverse). Sans ça, l'éditeur résout un problème hypothétique — la [décision figée D2 de R3](DESIGN_R3_sentence_alignment.md) l'a justement sorti du périmètre pour cette raison.

## 1. Le problème

Un **bead** groupe les liens 1-1 qui forment ensemble une correspondance N-M (une phrase VO ↔ deux phrases traduites, etc.). L'aligneur `length_bounded` (R3.2) les pose automatiquement. Le curateur, lui, ne peut aujourd'hui que : accepter / rejeter / supprimer / recibler / ajouter un lien — **jamais toucher au groupement `bead_id`**. Trois gestes manquent :

1. **Fusionner** ≥ 2 liens 1-1 en un bead (leur poser un `bead_id` commun) — « ces deux liens sont en fait un 1-2 ».
2. **Scinder** un bead (retirer le `bead_id` de tout ou partie de ses liens) — « ce 2-1 était deux 1-1 distincts ».
3. **Ré-attribuer** une phrase d'un bead à un autre — cas rare, largement couvert par *scinder puis fusionner* ou par le **retarget existant** (qui change la cible d'un lien, [`AlignPanel` picker](../tauri-prep/src/screens/AlignPanel.ts)).

## 2. État réel du sous-système (ce sur quoi on branche)

**Le socle est là — l'éditeur ne fait que muter une colonne existante.**

- **Stockage** ([`migrations/022_alignment_bead.sql`](../migrations/022_alignment_bead.sql)) : `alignment_links.bead_id INTEGER` **nullable** ; index partiel `idx_alinks_bead (run_id, bead_id) WHERE bead_id IS NOT NULL`. **NULL = bead singleton** (1-1 legacy/manuel/plain). Un bead est identifié par le couple **`(run_id, bead_id)`** — *pas* par `bead_id` seul.
- **Attribution auto** ([`aligner.py:460-475`](../src/multicorpus_engine/aligner.py#L460)) : compteur par run `bead_counter` (1, 2, …), posé **uniquement** sur un bead multi-unités (`multi = len(p_units) > 1 or len(t_units) > 1`). Les liens auto portent le `run_id` du run d'alignement.
- **Liens manuels** ([`_handle_align_link_create`, sidecar.py:7512](../src/multicorpus_engine/sidecar.py#L7512)) : insérés avec **`run_id = 'manual'`** (littéral) et `bead_id` NULL. `UNIQUE(pivot_unit_id, target_unit_id)`.
- **Invariant de collision** — **le point à ne jamais casser** : un pivot lié à plusieurs cibles n'est une collision que si ce sont plusieurs *beads distincts*. La clé, identique sur **3 sites**, est
  `COUNT(DISTINCT COALESCE(run_id || '#' || bead_id, 'L' || link_id)) > 1` :
  [`qa_report.py:171`](../src/multicorpus_engine/qa_report.py#L171) · audit [`sidecar.py:3339`](../src/multicorpus_engine/sidecar.py#L3339) · `_coll_having` [`sidecar.py:7978`](../src/multicorpus_engine/sidecar.py#L7978) (partagé `/align/collisions` + `/align/quality`). Les liens de **même `(run_id, bead_id)`** s'effondrent en une entrée → pas de collision.
- **Surface de mutation** : `_handle_align_links_batch_update` ([sidecar.py:7788](../src/multicorpus_engine/sidecar.py#L7788)), actions `set_status` / `delete`, **inline** (pas encore extrait en service), token requis, sous `with self._lock()`. Type front `AlignBatchAction` ([sidecarClient.ts:1829](../tauri-prep/src/lib/sidecarClient.ts#L1829)).
- **Rendu déjà en place** (R3.3) : le marqueur de bead (accent violet + chip 🔗) existe en **vue paire** (`prep-align-row--bead`) *et* **vue famille** (`prep-fam-link--bead`). L'éditeur se greffe dessus, aucun rendu neuf du bead.

## 3. Le modèle — muter `bead_id`, réutiliser la sélection existante

Deux opérations élémentaires, exprimées comme des mutations `bead_id` groupées :

1. **Fusion** — poser un `bead_id` **frais** (nouveau dans le run concerné) sur l'ensemble des liens sélectionnés.
2. **Scission** — mettre `bead_id = NULL` sur les liens visés (chacun redevient un bead singleton).

La **ré-attribution** n'a pas d'opération propre : *scinder puis fusionner autrement*, ou le retarget existant. Pas de 3ᵉ verbe.

**UX** : réutiliser la **sélection multi-liens déjà là** (cases à cocher + `#align-batch-bar`, [`AlignPanel._batchAction`](../tauri-prep/src/screens/AlignPanel.ts)) plutôt qu'un éditeur dédié. Deux boutons conditionnels dans la barre de lot : **« Grouper en bead »** (actif quand ≥ 2 liens du **même pivot et même run** sont cochés), **« Dégrouper »** (actif quand la sélection contient ≥ 1 lien porteur d'un `bead_id`). Zéro nouvel écran.

## 4. Le point dur — la fusion est bornée au même `run_id`

La clé de collision `run_id || '#' || bead_id` **exige un `run_id` commun** pour que deux liens comptent comme un bead. Or :

- fusionner deux liens **d'un même run auto** → OK, ils partagent déjà le `run_id` ; il suffit d'un `bead_id` frais.
- fusionner un lien **manuel** (`run_id='manual'`) avec un lien **auto** (`run_id=<uuid>`) → **la clé les garderait distincts** même avec le même `bead_id` : le groupement serait invisible à la détection de collision (donc re-signalé comme collision). Piège silencieux.

Trois issues, par coût croissant :
- **(a) MVP — n'autoriser la fusion qu'entre liens de même `run_id`** ; sinon désactiver le bouton + info-bulle « liens de runs différents, non groupables ». Zéro changement de schéma/clé. **Reco.**
- **(b)** Normaliser le `run_id` des liens fusionnés (les réécrire sur un `run_id` commun, p.ex. `'manual'`) — perd la provenance du run auto.
- **(c)** Changer la **clé de collision** pour un identifiant de bead indépendant du run (nouvelle colonne `bead_uid` TEXT globale) — refonte des 3 sites + migration. Hors MVP.

## 5. Décisions à figer (reco par défaut)

- **D1 — Deux verbes seulement : Grouper / Dégrouper.** La ré-attribution passe par scinder+regrouper ou le retarget existant. **Reco : pas de 3ᵉ opération.**
- **D2 — API : étendre `/align/links/batch_update`, pas de route neuve.** Ajouter deux `action` additifs à l'enum — `set_bead` (poser un `bead_id`) / `clear_bead` (NULL) — à côté de `set_status`/`delete`. Contrat **additif** (enum de champ, pas de route → **snapshot/`.md` inchangés**, seul `openapi.json` + `sidecar_contract.py` bougent ; cf. [`reference_sidecar_endpoint_doc_sync`]). **Reco : action additive.**
- **D3 — Numérotation du `bead_id` de fusion : `MAX(bead_id)+1` scopé au `run_id` visé.** Calculé côté serveur dans la transaction, jamais fourni par le front (évite les courses). **Reco : serveur, scopé run.**
- **D4 — Fusion bornée au même `run_id` (le point dur §4).** MVP = issue (a) : refuser/ désactiver la fusion inter-runs, la signaler. **Reco : (a).**
- **D5 — Invariant de collision préservé, testé sur les 3 sites.** Tout test de l'éditeur vérifie qu'un bead fusionné **n'apparaît plus** comme collision (`/align/collisions`, `/align/quality`, `qa-report`) et qu'un dégroupage **réapparaît** comme collision si les cibles divergent. **Reco : test des 3 sites.**
- **D6 — Logique hors `sidecar.py` (growth-gate).** La validation « même run + même pivot + bead frais » vit dans un petit service (`services/align_links_service.py` à créer, ou l'extension de la future extraction du batch handler) ; le handler reste adaptateur. **Reco : service.**
- **D7 — Migration : aucune.** `bead_id` existe. **Reco : zéro migration.**
- **D8 — Statut d'un bead : inchangé (par lien).** Accepter/rejeter reste au grain du lien 1-1 ; pas de « statut de bead » agrégé en MVP (le batch `set_status` couvre déjà « accepter les N liens d'un bead » via la sélection). **Reco : pas de statut de bead.**
- **D9 — WORKCOPY / réversibilité.** Grouper/dégrouper mute des liens existants sans supprimer d'alignement (moins destructif qu'une resegmentation) ; cohérent avec les autres mutations de liens, qui n'ont pas d'undo dédié aujourd'hui. **Reco : même discipline que `batch_update`.**

## 6. Implications & risque

- **Moteur** : petit service de validation + 2 branches (`set_bead`/`clear_bead`) dans le batch handler. **Aucune** logique lourde.
- **Contrat** : **additif** (2 valeurs d'enum d'action + le champ `bead_id` optionnel dans l'action) → bump `sidecar_contract.py` + `openapi.json` ; **snapshot `openapi_paths.json` et `SIDECAR_API_CONTRACT.md` inchangés** (pas de route neuve — mais relire `test_contract_docs_sync`). **Migration : aucune.**
- **Front** : 2 boutons conditionnels dans `#align-batch-bar` + le type `AlignBatchAction` étendu (`set_bead`/`clear_bead`). Réutilise la sélection, le lock, le rendu de bead existants.
- **Growth-gate** : logique en `services/`, handler mince → quelques lignes nettes dans `sidecar.py`.
- **Risque principal** : le piège inter-runs (§4). Mitigé par D4(a) + D5.

## 7. Questions ouvertes (à trancher avant ticket)

1. **§0** — a-t-on un **cas de curage réel** qui justifie l'éditeur, ou reste-t-il hypothétique ? (préalable au ticket, comme le producteur du blob).
2. **D4** — la fusion **inter-runs** est-elle un besoin réel (fusionner du manuel avec de l'auto) ? Si oui, (b) ou (c) — trancher le coût.
3. **D8** — veut-on à terme un **statut de bead** (accepter/rejeter le groupe d'un geste, distinct de la sélection multiple) ?
4. Un dégroupage doit-il **supprimer** les liens redondants d'un 2-2 (les paires positionnelles p2↔t2) ou seulement retirer le `bead_id` ? (le MVP retire le `bead_id`, ne supprime rien.)
