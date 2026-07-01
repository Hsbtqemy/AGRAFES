# Roadmap « Refonte » — canvas UI + capacités corpus

> Statut : **plan consolidé — à dérouler par tranches**. Date : 2026-06-30.
> Consolide trois notes de design : [`DESIGN_prep_text_canvas.md`](DESIGN_prep_text_canvas.md) (refonte UI, **colonne vertébrale**), [`DESIGN_peritext_conventions.md`](DESIGN_peritext_conventions.md) (+ [grounding](DESIGN_peritext_conventions_grounding.md)) (segmentation 2-grain & alignement), [`DESIGN_metadata_templates_filtering.md`](DESIGN_metadata_templates_filtering.md) (métadonnées).
> Complète, sans la remplacer, [`ROADMAP.md`](ROADMAP.md) (tracker moteur/gouvernance, historique livré). Ici = le **plan produit/UX à venir**.
>
> **Avancement (2026-07-01).** **R1 et R2 livrés** ; **R3.1 + R3.2 livrés** (branche `refonte`, PR #195). R3.2 = aligneur hiérarchique 2 étages `length_bounded` (DP `gale_church.py`), migration 022 `bead_id`, contrat 1.6.36, exclusion collision same-bead, front (option + marqueur de bead). Prochain = **R3.3** (méthode par lot + éditeur de beads ; l'option de stratégie et la provenance `explain` sont déjà là). Queues différées : R2.2 *contrôles front*, R2.3 *cas blob 2-grains* (attend `source_path`). L'**éditeur de beads manuel** est volontairement différé.

## 1. Principe directeur

- **Colonne vertébrale = le canvas.** Chaque **couche** est une tranche verticale *capacité moteur → surface UI*. Alignement et Métadonnées restent des **vues à part** (déjà plat / objet différent).
- **Front-pur d'abord** (bas risque) → moteur/destructif ensuite, **toujours prototypé sur une WORKCOPY** (jamais le corpus réel — la resegmentation supprime l'alignement, ADR-017).
- **Frontière moteur ↔ front gérée explicitement** (cf. §4) : chaque item est tagué et porte ses implications contrat/migration. C'est le garde-fou de risque n°1.
- **Numérotation unifiée.** Les labels locaux qui se télescopaient (canvas `T0-T4`, segmentation `A0-A3`, péritexte `T1-T6`, métadonnées `M1-M3`) sont remappés en phases **R1…R6** (table de correspondance §5).

## 2. Carte des couches

| Couche / vue | État | Capacité moteur requise | Dominante |
|---|---|---|---|
| **Rôles** | ✅ dans le canvas | — (CRUD conventions déjà là) | front |
| **Segmentation 2-grain** | ✅ persist + dérivé + ¶ (R2) | parent persist · établir grossier · stats/doc | mixte |
| **Alignement** (vue séparée) | ✅ par-clé/position | garde-fous · aligneur longueurs (par-algo) | moteur |
| **Curation** (surimpression) | ❌ couche | — (`lib/curation*` déjà extraits) | front |
| **Annotation** (tokens) | ❌ couche | — (spaCy déjà câblé ; friction amont) | front |
| **Concordancier** (tauri-app) | ❌ rôle+valeur | query `JOIN unit_roles` | mixte |
| **Métadonnées** (écran) | 🟡 plat | notes · tags · templates | mixte |

## 3. Séquence R1 → R6

Légende des tags : **[FRONT]** = TypeScript/Tauri, contrat inchangé · **[MOTEUR]** = Python engine/sidecar · **[MIXTE]** = les deux. Tout `[MOTEUR]`/`[MIXTE]` touchant un endpoint déclenche la **discipline contrat** (§4).

### R1 — Canvas pilotable *(bas risque, front-dominant)*

But : le canvas devient un vrai poste de travail (conscience d'état + Rôles soignés).

- **R1.1** Chip de stade minimal (Brut vs Segmenté · N) — **[FRONT]** ✅ *fait* (dérive `unit_count`).
- **R1.2** Stade complet : grossier/fin · parent ¶ · aligné — **[MOTEUR]** *(lecture seule)* : exposer des **stats par doc** (`has_external_id`, `has_parent`, `n_aligned`, `max_len`). Endpoint read-only → **contrat** (§4). Logique en `services/`. ✅ *fait* — `GET /documents/stats` (`documents_service.document_stats`, contrat 1.6.34).
- **R1.3** Rendu des chips enrichis + bandeau d'état permanent — **[FRONT]** (étend `TextCanvasView._renderStateStrip`). ✅ *fait*.
- **R1.4** Polish couche Rôles dans le canvas — **[FRONT]**. ✅ *fait* (couche Rôles opérationnelle dans le canvas).

> Stat de R1.2 est **partagée avec R2** (visualisation hiérarchique) → la livrer une fois, l'exploiter deux fois.

### R2 — Segmentation 2-grain *(le nouveau modèle ; WORKCOPY)*

But : matérialiser la hiérarchie **paragraphe ⊃ phrase** (représentation = pointeur parent `meta_json.parent_*`, sans migration).

- **R2.1** Persister le parent à la segmentation fine — **[MOTEUR]** : `resegment_document` remplit `meta_json.parent_*` au lieu de `None` ([grounding §3](DESIGN_peritext_conventions_grounding.md), `segmenter.py:535`). **Pas de migration, pas de contrat** (écriture interne) ; undo déjà couvert. ✅ *fait* — `segmenter.py:544`/`:328` écrivent `{"parent_n": …}` (clé *logique* : `parent_n` seul, **pas** `parent_unit_id`, l'unité source étant supprimée).
- **R2.2** Établir le grain grossier depuis **indices pluggables** (séparateurs présents `¤`, lignes vides, rôles structurels, re-lecture `source_path`) — **[MIXTE]** : dérivation moteur (réutiliser `/segment/structure_sections` avant de coder neuf) + contrôles front. Endpoint éventuel → contrat. ✅ *fait (voie A)* — `coarse_grain.derive_coarse_blocks` (pur, hors sidecar.py). **Décision figée** : sections ≠ paragraphes → intertitres/structure *classés*, jamais fusionnés (le seul indice qui regroupe est `parent_n`) ; `¤` = intra-¶ (bloc composite, `fine_count`). **Différés** : les *contrôles front* (ordre des indices figé en dur) et la re-lecture `source_path` (hors DB).
- **R2.3** Visualisation hiérarchique (phrases groupées sous ¶) + cas blob 2-grains — **[FRONT]** (consomme le parent exposé en R1.2). ✅ *fait* — lib pure `coarseGrain` (miroir moteur) + regroupement ¶ dans RolesPane. **Correction vs plan** : le parent n'est pas lu via `structure_sections` mais exposé comme champ `parent_n` sur `GET /units` (**contrat 1.6.35** — additif, read-only). **Différé** : le *cas blob 2-grains* (attend `source_path`).

### R3 — Alignement à la phrase *(livrable contrastif ; dépend R2)*

But : des liens phrase↔phrase fiables, par-clé **ou** par-algorithme.

- **R3.1** Garde-fous anti-dérive — **[MOTEUR]**. ✅ *fait* — post-check `_check_anchor_consistency` (`qa_report.py`, gate `anchor_drift`). Le *pré-vol* a fondu en **avertissement post-alignement** porté par l'étage ¶ de R3.2 (décision C — l'aligneur hiérarchique absorbe l'écart de cardinalité).
- **R3.2** Aligneur par longueurs borné par ancre + dispatch — **[MIXTE]**. ✅ *fait* — aligneur **hiérarchique 2 étages** `align_by_length_bounded` (DP pure `gale_church.py`) ; beads N-M persistés (**migration 022 `bead_id`**) ; dispatch `length_bounded` (`_run_alignment_strategy` + CLI, **contrat 1.6.36**) ; exclusion collision same-bead ; front (option `<select>` + marqueur de bead). **Dépend de R2.1** (ancre `parent_n`).
- **R3.3** UX choix de méthode par texte/lot + affichage de la provenance d'un lien — **[FRONT]** (coexistence auto/manuel déjà câblée : `protected_pairs`). 🟡 *partiel* : l'option de stratégie et la provenance (`explain`) sont là ; reste **méthode par lot** + **éditeur de beads manuel** (différé).

### R4 — Conventions / péritexte propres

But : axe statut + lift des marqueurs + concordancier qui affiche les rôles.

- **R4.1** `units.unit_status` (`non_traduit`/`ajout`) — **[MOTEUR]** : **migration 022** + expo dans `set_role`/`bulk` + filtre `query` → **contrat** ; **[FRONT]** filtre UI.
- **R4.2** Lift marqueurs `[T]/[Ch]/…` → rôles (passe post-import idempotente) — **[MIXTE]** : `marker_lift.py` (hors `sidecar.py`, growth-gate) + `POST /lift/markers` → **contrat** ; front = bouton + aperçu.
- **R4.3** Concordancier affiche rôle + valeur — **[MIXTE]** : `query.py` `LEFT JOIN unit_roles` + champs hits → **contrat** ; `tauri-app` `results.ts` (`appendRoleBadge`, fallback cellule vide).

### R5 — Couches Curation + Annotation *(front-dominant ; la refonte UI ressentie)*

But : ramener curation et annotation **dans le canvas**, en surimpression.

- **R5.1** Couche **Curation** surimpression légère (marqueur discret + diff à la demande + toggle global) — **[FRONT]** (réutilise les ~16 `lib/curation*` + endpoints existants ; **contrat inchangé**).
- **R5.2** Couche **Annotation** tokens (prose colorée par défaut, interlinéaire à la demande) + traiter la friction amont (modèle spaCy non bloquant) — **[FRONT]** (réutilise `AnnotationView` ; endpoints spaCy déjà là).

### R6 — Métadonnées + finitions UI

But : enrichir les notices et **retirer le legacy** une fois la parité atteinte.

- **R6.1** `documents.notes` (notes-to-self) + relibeller la note de relation — **[MIXTE]** : **migration** triviale + `_UPDATABLE` → contrat ; front = champ MetadataScreen.
- **R6.2** Labels filtrables (`document_tags` N-N) + CRUD + filtre `tags` — **[MIXTE]** : **migration** + endpoints (`services/`) → contrat ; front = picker (Prep) + filtre (concordancier).
- **R6.3** Templates par `resource_type` (enum + `TYPE_TEMPLATES` front + persistance `meta_json`) — **[MIXTE]** : front-dominant + accepter `meta_json` dans `_UPDATABLE` (petit moteur + contrat).
- **R6.4** Tiroir « Avancé » (exceptions/history/diag) · responsive container-query · **retrait des écrans legacy** Seg/Cur/Annot — **[FRONT]**.

## 4. Moteur vs front — la frontière, gérée

**Répartition par phase** (dominante) :

| Phase | Front | Moteur | Contrat ? | Migration ? | WORKCOPY ? |
|---|---|---|---|---|---|
| R1 ✅ | R1.1·R1.3·R1.4 | R1.2 (read) | oui (read-only, 1.6.34) | non | non |
| R2 ✅ | R2.3 | R2.1·R2.2 | oui (R2.3 : `parent_n` /units, 1.6.35) | non | **oui** |
| R3 🟡 | R3.3 (partiel) | R3.1·R3.2 ✅ | oui (1.6.36) | **022 (bead_id)** | **oui** |
| R4 | filtres/aperçus | R4.1·R4.2·R4.3 | oui (×3) | **022 (R4.1)** | oui |
| R5 | R5.1·R5.2 | — | **non** | non | non |
| R6 | R6.4 | R6.1·R6.2·R6.3 | oui | **R6.1·R6.2** | non |

**Lecture** : R1 et R5 sont **front-dominants** (itération rapide, risque bas) ; R3 et R4 sont **moteur-dominants** (discipline contrat, migration, tests WORKCOPY) ; R2 et R6 sont mixtes.

**Discipline moteur** (rappel, à appliquer dès qu'un endpoint bouge) :

- **Contrat = 3 artefacts** : `sidecar_contract.py` → `scripts/export_openapi.py` → commit `docs/openapi.json` **+** `tests/snapshots/openapi_paths.json` **+** `docs/SIDECAR_API_CONTRACT.md` (sinon `test_contract_docs_sync` casse ; le snapshot ne fait que *warn* sur un ajout).
- **Write-path** : ajouter la route au predicate `_WRITE_PATHS` + prendre `with self._lock()`.
- **Growth-gate** : `sidecar.py` ne doit pas croître de > 500 l. nettes/90 j → **logique en `services/`**, handlers fins (modèle A-01). `marker_lift`, l'aligneur, les checks QA vivent **hors** `sidecar.py`.
- **Migrations** : fichier `NNN_*.sql` neuf (dernière = 021), jamais éditer un appliqué.
- **CI** : rejouer le scope exact avant commit — `ruff check src tests` (pas juste `src`) + pytest pertinent.

**Front** : ESLint + `no-unsanitized` (sink `safeHtml`), CSS namespacée (`prep-*`/`app-*`/`shell-*`), pas de dialogue natif (`modalConfirm`/`inlineConfirm`), build = `tsc + vite` + vitest.

## 5. Correspondance des anciens labels → R

| Ancien | Source | Devient |
|---|---|---|
| canvas T0 (coquille + Rôles) | prep_text_canvas | **R1** (socle, fait) |
| segmentation A0 (stade) | prep_text_canvas §10 | **R1.1** (fait) |
| segmentation A1 (parent) **=** péritexte « parent persist » | doublon | **R2.1** (un seul item, fait) |
| segmentation A2/A3 | prep_text_canvas §10 | **R2.2 / R2.3** (faits ; blob 2-grains différé) |
| péritexte T4 (garde-fous) / T6 (aligneur) | peritext | **R3.1 / R3.2** (faits) |
| péritexte T1 (statut) / T2 (lift) / T3 (concordancier) | peritext | **R4.1 / R4.2 / R4.3** |
| canvas T1 (curation) / T2 (annotation) | prep_text_canvas §7 | **R5.1 / R5.2** |
| métadonnées M1 / M2 / M3 | metadata | **R6.1 / R6.2 / R6.3** |
| canvas T3 (tiroir) / T4 (responsive+retrait) | prep_text_canvas §7 | **R6.4** |

## 6. Jalons de valeur

- **R2** = le double grain *réel* dans les données (hiérarchie ¶ ⊃ phrase persistée).
- **R3** = l'alignement phrase automatique borné = **le cœur contrastif**.
- **R1 + R5** = la refonte UI *ressentie* (canvas pilotable + curation/annotation en couches).
