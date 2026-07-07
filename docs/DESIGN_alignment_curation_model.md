# Note de design — Modèle de curation d'alignement (verbes de liens & beads)

> Statut : **intention de design — décisions à figer avant ticket**. Date : 2026-07-07.
> ⬆️ **Coiffée par** [`DESIGN_source_anchored_alignment.md`](DESIGN_source_anchored_alignment.md)
> (2026-07-07) : le *pourquoi* amont (moyeu source-anchored, deux formes du corpus, matrice multilingue).
> Cette note-ci tient les **mécaniques wire/bead** (verbes, clé de collision, K3) ; la note-modèle y
> **ajoute** les gestes **couper/fusionner** de segment côté traduction. Lire la note-modèle en premier.

> Élargit et **consolide la partie tactique de** [`DESIGN_R3_3_bead_editor.md`](DESIGN_R3_3_bead_editor.md) :
> l'« éditeur de beads » n'y était qu'**un** verbe ; cette note pose le **modèle complet** des
> gestes de curation d'alignement et tranche la décision structurante (identité de bead vs `run_id`)
> dont ce verbe — et tous les autres — dépendent.
> Dépendances : `bead_id` (R3.2, [migration 022](../migrations/022_alignment_bead.sql)) ;
> aligneur `length_bounded` ([`aligner.py`](../src/multicorpus_engine/aligner.py)) ;
> [`DESIGN_R3_sentence_alignment.md`](DESIGN_R3_sentence_alignment.md) (D1bis/D2).

## 0. Pourquoi cette note — le besoin non démontré est maintenant démontré

La note bead-editor concluait (§0) « besoin non démontré, différer » sur la foi d'un raisonnement
*curage de l'auto-aligneur*. **Un cas réel, ouvert et inspecté, renverse ce cadrage** : le trou n'est
pas un confort marginal, c'est que **la curation manuelle d'un alignement asymétrique est aujourd'hui
impossible à mener à bien**, quel que soit le geste. On pose donc le modèle entier, pas un verbe isolé.

### Cas-test de référence — `LeCléziotest.db` (FR original → EN traduction)

FR = 8 phrases (original) ; EN = 7 phrases (l'anglais a **fusionné** deux phrases françaises en une
longue). Auto-alignement réel (run `length_bounded`, beads posés) confronté au sens :

| FR (8) | auto → EN | Réalité |
|---|---|---|
| FR1 *Du plus loin que je me souvienne…* | ↔ EN1 (bead 1) | EN1 est **une longue phrase à `:`** couvrant FR1 **+** FR2 → un **2-1** légitime |
| FR2 *Mêlé au vent dans les aiguilles…* | ↔ EN2 (bead 1) | réordonné (« the sound that cradled my childhood ») |
| **FR3 *Je l'entends maintenant, au plus profond…*** | **— orphelin —** | **↔ EN3 « I can hear it now, deep inside me »** (traduction quasi-littérale) |
| FR4 *Le bruit lent, inlassable, des vagues…* | ↔ **EN3** (bead 2) | **faux** : EN3 appartient à FR3 |
| FR5–8 | ↔ EN4–7 | corrects |

Deux pathologies, **toutes deux irréparables** avec l'outillage actuel :

1. **Mislink côté pivot** — EN3 est accroché à FR4 au lieu de FR3, et **FR3 est orphelin**.
2. **Asymétrie N-M non-déclarable** — EN1 = FR1+FR2 est *voulu*, mais rien ne permet de le **dire** à
   l'outil ; le détecteur de collision continuera à traiter ce groupe comme suspect.

Le compte **8 ≠ 7 est structurel** (la traduction a fusionné). Le forcer en 1-1 par re-découpage
**abîmerait** le français. La bonne réponse est le **bead** (« ces N ↔ ces M, c'est correct »).

## 1. État réel du sous-système (vérifié au code, 2026-07-07)

**Modèle de données.** `alignment_links(link_id, run_id, pivot_unit_id, target_unit_id, external_id,
pivot_doc_id, target_doc_id, status, bead_id, …)`. `bead_id INTEGER` **nullable**
([mig 022](../migrations/022_alignment_bead.sql)) ; **NULL = bead singleton**. Un bead est identifié par
le **couple `(run_id, bead_id)`**, jamais par `bead_id` seul.

**Invariant de collision — clé identique sur 3 sites** :
`COUNT(DISTINCT COALESCE(run_id || '#' || bead_id, 'L' || link_id)) > 1`
([`qa_report.py:171`](../src/multicorpus_engine/qa_report.py#L171),
[`sidecar.py:3421`](../src/multicorpus_engine/sidecar.py#L3421),
[`sidecar.py:8247`](../src/multicorpus_engine/sidecar.py#L8247)). Les liens de **même `(run_id, bead_id)`**
s'effondrent en une entrée → pas de collision. **C'est le point à ne jamais casser.**

**Inventaire des verbes existants :**

| Verbe | Endpoint / code | Effet | Provenance écrite |
|---|---|---|---|
| **create** (lien manuel) | [`_handle_align_link_create:7746`](../src/multicorpus_engine/sidecar.py#L7746) | INSERT 1 lien | `run_id='manual'`, **`bead_id` NULL** |
| **retarget** | [`_handle_align_link_retarget:7834`](../src/multicorpus_engine/sidecar.py#L7834) | `UPDATE … SET target_unit_id` | inchangée — **cible seule** |
| **add-target** (➕) | front [`AlignPanel.ts:1437`](../tauri-prep/src/screens/AlignPanel.ts#L1437) → `createAlignLink` | 2ᵉ lien sur le même pivot | `run_id='manual'`, **`bead_id` NULL** |
| **delete** | `/align/link/delete` + batch | DELETE | — |
| **set_status** (accept/reject/∅) | [`_handle_align_links_batch_update:8056`](../src/multicorpus_engine/sidecar.py#L8056) | `UPDATE … SET status` | — |

**Attribution auto du bead** : [`aligner.py:473-488`](../src/multicorpus_engine/aligner.py#L473) —
compteur `bead_counter` par run, posé **uniquement** si `multi = len(p_units) > 1 or len(t_units) > 1`.

**Rendu** : accent violet + chip 🔗 sur les liens beadés ([`AlignPanel.ts:1204`](../tauri-prep/src/screens/AlignPanel.ts#L1204)) ;
barre de lot `#align-batch-bar` + sélection `_selectedLinkIds` ([`:1590`](../tauri-prep/src/screens/AlignPanel.ts#L1590)).
Le type front `AlignLinkRecord` ([`sidecarClient.ts:864`](../tauri-prep/src/lib/sidecarClient.ts#L864))
porte `bead_id` mais **pas `run_id`**.

## 2. Les trois trous structurels

**A — Le lien est *ancré au pivot*, pas de ré-ancrage.** `retarget` ne change que la **cible**. Corriger
une erreur *côté pivot* (le cas FR4↔EN3 → devrait être FR3↔EN3) exige **supprimer + recréer** : deux
gestes pour une correction triviale, et on perd le `status`/l'historique du lien au passage.

**B — Le verbe central *grouper en bead* n'existe nulle part — et son absence produit des collisions
fantômes.** `add-target` laisse *fabriquer* un 1-2 manuel (deux liens `run_id='manual'`, `bead_id` NULL) ;
son propre hint invite à « acceptez les deux liens pour valider l'alignement multiple »
([`AlignPanel.ts:1463`](../tauri-prep/src/screens/AlignPanel.ts#L1463)). Mais sans `bead_id` commun, la clé
§1 les compte comme **deux beads distincts** → **re-signalés en collision**. *L'outil laisse construire un
N-M manuel, puis le dénonce comme une erreur.* Incohérence latente confirmée au code.

**C — Les gestes de réparation sont éclatés sur deux surfaces.** Couper/fusionner des **unités** vit dans
**Segmentation** (`SegmentPane`, R5.4b-3) ; les gestes de **liens** dans **Alignement** (`AlignPanel`) ;
**grouper des liens** n'est nulle part. Réparer un alignement asymétrique = aller-retours entre deux
écrans qui ne se parlent pas, le maillon central manquant.

**Cause racine commune — `run_id` fait deux métiers.** Il porte à la fois la **provenance** (quel run /
`'manual'`) *et* le **périmètre d'identité du bead** (la clé `run_id || '#' || bead_id`). Ce couplage
interdit de grouper à travers deux provenances — or c'est **exactement** le cas réel (FR3 orphelin
`run_id='manual'` ↔ bead auto `run_id=<uuid>`). Tant qu'il tient, **tout** éditeur de beads bute sur ce mur
(le « point dur » §4 de la note bead-editor).

## 3. Modèle cible — un jeu de verbes cohérent

Curer un alignement = composer **cinq** verbes sur un graphe de liens 1-1 regroupables en beads :

| Verbe | Nature | Existe ? |
|---|---|---|
| **create / delete** | ajouter/retirer un lien 1-1 | ✅ |
| **set_status** | accepter / rejeter / dé-réviser | ✅ (batch) |
| **retarget** | ré-accrocher la **cible** d'un lien | ✅ |
| **re-anchor** | ré-accrocher le **pivot** d'un lien | ❌ (aujourd'hui delete+create) |
| **group / ungroup** | poser / retirer un `bead_id` commun sur ≥ 2 liens | ❌ |

**group / ungroup** (les deux verbes de bead) :
- **group** — poser un identifiant de bead **frais** sur les liens sélectionnés (« ces liens sont un seul
  N-M »). Serveur-calculé, jamais fourni par le front (évite les courses).
- **ungroup** — remettre l'identité de bead à NULL sur les liens visés (chacun redevient singleton).
- **ré-attribution** = *ungroup puis group autrement*, ou `retarget`/`re-anchor` — pas de 3ᵉ verbe de bead.

**re-anchor** : optionnel mais peu coûteux (`UPDATE … SET pivot_unit_id`, symétrique de `retarget`) et
il supprime le detour delete+create du cas réel. **À décider** (D2).

Sur le cas-test, la curation cible devient : `re-anchor` EN3 de FR4→FR3 (ou delete+create) ; `group`
{FR1↔EN1, FR2↔EN1} en un 2-1 ; laisser le reste. **Trois clics**, aujourd'hui infaisables.

## 4. La décision structurante — identité de bead vs `run_id` (commande tout le reste)

| Option | Idée | Couvre le cas réel ? | Coût |
|---|---|---|---|
| **K1 — statu quo, fusion intra-run** | `group` refusé si les liens n'ont pas le même `run_id` | ❌ **non** (FR3 manuel ↔ bead auto = inter-run) | nul (0 migration) |
| **K2 — normaliser le `run_id`** | réécrire les liens fusionnés sur un `run_id` commun (`'manual'`) | ✅ | **perd la provenance** du run auto |
| **K3 — identité de bead indépendante de la provenance** | colonne `bead_uid TEXT` globale ; la clé de collision devient `COALESCE(bead_uid, 'L'||link_id)` | ✅ **proprement** | 1 migration additive + backfill + 3 sites de clé |

**K3 en détail (recommandé).**
- **Migration additive** (n° 026) : `ALTER TABLE alignment_links ADD COLUMN bead_uid TEXT` + index partiel.
  **Backfill non-destructif** : `bead_uid = run_id || '#' || bead_id` là où `bead_id IS NOT NULL` (reproduit
  la clé actuelle à l'octet), NULL sinon. → comportement de collision **identique** sur les données
  existantes ; seule la capacité *nouvelle* (grouper à travers les runs) s'ajoute.
- **3 sites de clé** : `COALESCE(run_id || '#' || bead_id, 'L' || link_id)` → `COALESCE(bead_uid, 'L' || link_id)`.
  `run_id` **reste** sur la table (provenance intacte) ; il cesse juste de porter l'identité du bead.
- **Aligneur** : continue d'écrire `bead_id` **et** pose `bead_uid = run_id || '#' || bead_counter` (byte-compat).
- **group manuel** : le serveur pose un `bead_uid` frais (uuid), applicable à des liens **de n'importe quel
  `run_id`** → le cas réel marche. `ungroup` → `bead_uid = NULL`.
- **`bead_id`** : conservé (compat/rendu) ; `bead_uid` devient la **source de vérité** du groupement.

**Reco : K3.** K1 livre un éditeur qui rate le besoin qui l'a motivé ; K2 sacrifie la reproductibilité
(chère à tout le projet). K3 est additif, backfill sûr, et **débloque les trois trous d'un coup** (le
group inter-run répare A/B/C ensemble). Le seul vrai coût est la bascule des 3 sites — mécanique, testée.

## 5. Surface — où vivent ces verbes

**Réutiliser la sélection multi-liens existante** (cases à cocher + `#align-batch-bar`,
[`_batchAction`](../tauri-prep/src/screens/AlignPanel.ts#L1599)) plutôt qu'un écran neuf. Deux boutons
conditionnels dans la barre de lot :
- **« Grouper en bead »** — actif quand ≥ 2 liens sont cochés (K3 : sans condition de run ; K1 : même run).
- **« Dégrouper »** — actif quand la sélection contient ≥ 1 lien porteur d'un bead.

Le front doit alors **connaître le run/bead par lien** → exposer `run_id` (et le `bead_uid`) dans
`AlignLinkRecord` (aujourd'hui absent). Petit ajout additif à la requête d'audit + au type.

**re-anchor** : réutilise le picker de `retarget` (✎) avec un mode « changer la source ». **Couper/fusionner
les unités** reste en Segmentation ; on ajoute au plus un **renvoi contextuel** (« ouvrir la segmentation
de ce segment ») plutôt que dupliquer le geste — trancher au moment de la surface (D6).

## 6. Tranches proposées (après K tranché)

1. **Socle K3** *(moteur)* — migration 026 `bead_uid` + backfill + bascule des 3 sites de collision +
   aligneur pose `bead_uid`. **Aucun** changement de comportement observable (contrat inchangé, tests de
   non-régression collision sur données existantes). Prépare tout le reste.
2. **group / ungroup** *(moteur + front)* — 2 actions additives `set_bead`/`clear_bead` sur
   `/align/links/batch_update` (portant un **groupe** de `link_ids`, cf. §7-D3) ; logique en
   `services/align_links_service.py` (growth-gate) ; 2 boutons dans la barre de lot ; `run_id`/`bead_uid`
   exposés au front. Contrat **additif** (enum + champ → `openapi.json` + `sidecar_contract.py` ; snapshot
   & `.md` inchangés, pas de route neuve — **relire `test_contract_docs_sync`**).
3. **re-anchor** *(moteur + front, optionnel)* — `/align/link/reanchor` (`UPDATE … SET pivot_unit_id`) +
   mode « changer la source » du picker. Supprime le detour delete+create.
4. **Renvoi contextuel Segmentation↔Alignement** *(front)* — le maillon (C), si jugé utile après usage.

## 7. Décisions à figer (reco par défaut)

- **D1 — Identité de bead.** **Reco : K3** (`bead_uid` indépendant du `run_id`). *C'est LA décision ;
  tout le reste en découle.*
- **D2 — re-anchor comme 1ᵉ classe ?** **Reco : oui** (symétrique de retarget, quelques lignes, répare le
  cas réel sans delete+create). Sinon : documenter le delete+create comme voie officielle.
- **D3 — Forme de `group`.** Une action **portant un groupe** : `{action:"set_bead", link_ids:[…]}` — le
  serveur calcule un `bead_uid` frais et l'applique à **tous** (un `set_bead` par-lien donnerait un bead
  *différent* à chacun → aucun groupement). `AlignBatchAction` gagne `link_ids?: number[]`. **Reco : action
  de groupe.**
- **D4 — `add-target` cohérent avec les beads.** Aujourd'hui il crée un 1-2 fantôme (collision). **Reco :**
  après le socle K3, proposer à l'utilisateur de **grouper** les liens qu'`add-target` vient de créer (ou
  un `bead_uid` frais posé d'emblée). À trancher : automatique vs geste explicite.
- **D5 — Invariant de collision préservé, testé sur les 3 sites.** Un bead groupé **n'apparaît plus** en
  collision (`/align/collisions`, `/align/quality`, `qa-report`) ; un dégroupage **réapparaît** si les
  cibles divergent ; backfill K3 **byte-identique** sur l'existant. **Reco : test des 3 sites + test de
  non-régression backfill.**
- **D6 — Surface.** Réutiliser la barre de lot + le picker existants ; renvoi contextuel vers Segmentation
  plutôt que duplication du couper/fusionner. **Reco : zéro écran neuf.**
- **D7 — Migration.** K3 = **une** migration additive (026), backfill non-destructif. (K1 = aucune.)
- **D8 — Statut de bead.** Reste au grain du lien 1-1 (le batch `set_status` couvre « accepter les N liens
  d'un bead » via la sélection). **Reco : pas de statut de bead agrégé en MVP.**
- **D9 — WORKCOPY / réversibilité.** group/ungroup/re-anchor mutent des liens sans supprimer d'alignement
  (moins destructif qu'une resegmentation) ; même discipline que `batch_update` (pas d'undo dédié). **Reco :
  identique à l'existant.**

## 8. Implications & risque

- **Moteur** : migration 026 + backfill ; bascule des 3 sites de clé (mécanique) ; petit service de
  validation + 2 branches (`set_bead`/`clear_bead`) ; éventuel `reanchor`. **Aucune** logique lourde.
- **Contrat** : **additif** (2 valeurs d'enum + champ `link_ids` ; `run_id`/`bead_uid` dans la réponse
  d'audit) → bump `sidecar_contract.py` + `openapi.json` ; **snapshot & `.md` inchangés** (pas de route
  neuve, sauf si `reanchor` retenu → alors +1 route = 3 artefacts). **Migration : 026 (K3).**
- **Front** : 2 boutons conditionnels dans `#align-batch-bar` + `AlignBatchAction` étendu + `run_id`/
  `bead_uid` sur `AlignLinkRecord`. Réutilise sélection, lock, rendu de bead.
- **Growth-gate** : logique en `services/`, handler mince → quelques lignes nettes dans `sidecar.py`.
- **Risque principal** : la bascule des 3 sites de collision. Mitigé par le backfill byte-identique (D5) +
  tests de non-régression sur les beads existants avant d'ouvrir la capacité inter-run.

## 9. Questions ouvertes (à trancher avant ticket)

1. **D1/K3** — valide-t-on le coût migration+bascule pour couvrir le cas réel inter-run, ou accepte-t-on
   un MVP K1 intra-run *sachant* qu'il ne répare pas `LeCléziotest` ?
2. **D2** — re-anchor 1ᵉ classe, ou delete+create documenté ?
3. **D4** — `add-target` groupe-t-il automatiquement, ou laisse-t-on l'utilisateur grouper ensuite ?
4. **D6** — le renvoi contextuel Segmentation↔Alignement (tranche 4) est-il dans le périmètre, ou différé
   jusqu'à preuve d'usage ?
