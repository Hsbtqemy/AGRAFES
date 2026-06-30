# Ancrage technique — Péritexte / conventions / alignement à la phrase

> Compagnon de [`DESIGN_peritext_conventions.md`](DESIGN_peritext_conventions.md). Approfondit **chaque élément** du design en l'appuyant sur le code existant : ce qui existe (fichier:ligne), le trou précis, le point de greffe et le pattern à suivre.
> Statut : ancrage vérifié (6 explorations ciblées du code, 2026-06-30). Cible : `multicorpus-engine` v0.4. Contrat sidecar courant : `CONTRACT_VERSION = 1.6.33`.

Légende : ✅ existe · 🟡 partiel · ❌ à construire.

---

## 0. Découvertes qui changent le plan

Trois choses trouvées dans le code **réduisent le périmètre** annoncé :

1. **Endpoints « section-aware » déjà présents** : `POST /segment/structure_sections` ([sidecar.py:3573](../src/multicorpus_engine/sidecar.py#L3573)), `POST /segment/structure_diff` (L3623), `POST /segment/propagate_preview` (L3805). Ils listent/comparent des **sections structurelles** et font de la segmentation ancrée. → l'idée « blocs dérivés des intertitres » (§4) est **déjà partiellement échafaudée** : à réutiliser, pas à réécrire.
2. **`SEGMENT_RATIO_WARN_THRESHOLD = 0.15`** ([sidecar.py:76](../src/multicorpus_engine/sidecar.py#L76)) : seuil de divergence de comptage déjà défini → base du **pré-vol** (§8).
3. **Coexistence auto/manuel déjà câblée** de bout en bout : `protected_pairs` + `replace_existing`/`preserve_accepted` (§6). Rien à construire côté moteur pour la coexistence.

---

## 1. Import & lift marqueurs → rôles

**Existe ✅**
- Dispatch d'import centralisé : `dispatch_import` ([dispatch.py:43](../src/multicorpus_engine/importers/dispatch.py#L43)), modes `IMPORT_MODES` (L21), `normalize_import_mode` (L32).
- Importer paragraphes : `parse_docx_paragraphs` ([docx_paragraphs.py:29](../src/multicorpus_engine/importers/docx_paragraphs.py#L29)) — ignore les ¶ vides (L59), `external_id = n` (L85), styles `Heading` → `unit_role="intertitre"` auto (L82).
- Normalisation : `normalize` ([unicode_policy.py:46](../src/multicorpus_engine/unicode_policy.py#L46)) — NFC, strip invisibles, NBSP→espace. **Ne retire PAS les crochets** `[T]`/`[Ch]` → c'est au lift de le faire.
- Réécriture de `text_norm` en masse : `curate_document` ([curation.py:195](../src/multicorpus_engine/curation.py#L195)) — UPDATE batch (L335) + propagation `source_changed_at` (L345). **C'est le pattern à copier pour le lift.**
- Détection de marqueurs : `detect_markers_in_units` ([segmenter.py:171](../src/multicorpus_engine/segmenter.py#L171)) — mais cible les `[N]` numériques (segmentation), pas `[T]`/`[Ch]`.

**À construire ❌ — le lift**
- `annotator.py` existe mais fait de l'annotation spaCy (tokens), **pas** le lift de marqueurs → ne pas réutiliser.
- **Greffe recommandée** : passe post-import dédiée, idempotente, découplée (modèle `curate_document`). Nouveau `src/multicorpus_engine/marker_lift.py` :
  ```
  lift_markers_in_document(conn, doc_id, mapping, run_logger) -> {units_lifted, roles_assigned, cleared}
  ```
  Logique : pour chaque unité, extraire `\[[^\]]+\]` en fin de ligne → mapper en (rôle, statut) ; **garder le marqueur dans `text_raw`**, le **retirer de `text_norm`** ; cas placeholder pur (`[non traduit]`/`[+]`) → `text_norm=""`, `text_raw=label`, `unit_role`+`unit_status`. Puis reindex FTS des unités touchées.
- **Pourquoi post-import et pas dans l'importer** : opt-in, réversible, ne couple pas chaque importer aux conventions. (DESIGN §8.5.)
- Route sidecar `POST /lift/markers` (voir contraintes contrat §10).

---

## 2. Annotation (conventions/rôles) & axe statut

**Existe ✅ — toute l'infra conventions/rôles**
- CRUD : `list_conventions` ([conventions_service.py:55](../src/multicorpus_engine/services/conventions_service.py#L55)), `create` (L100, validation `name` alnum+`-_`), `update` (L155), `delete` (L205, met `units.unit_role` à NULL).
- Assignation : `set_unit_role` ([units_service.py:72](../src/multicorpus_engine/services/units_service.py#L72)), `bulk_set_unit_role` (L98, formats `{unit_ids,role_name}` ou `{doc_id,unit_ns,role}`).
- Endpoints : GET `/conventions` ([sidecar.py:798](../src/multicorpus_engine/sidecar.py#L798)), POST `/conventions[/delete]`, `/units/set_role`, `/units/bulk_set_role` (handlers L4947-5032).
- UI : `RolesPane.ts` (catalogue structure/text, recherche, multi-sélection + assignation), `conventionsRoles.ts` (`STRUCTURE_DEFAULTS` L26 : titre, intertitre, dedicace, epigraphe, incipit, colophon, preface, note), intégrée dans `SegmentationView.ts`.
- Rôles structurels pré-semés : `unit_roles.category='structure'` ([018_unit_roles_category.sql](../migrations/018_unit_roles_category.sql)).

**À construire ❌ — l'axe STATUT de traduction**
- `alignment_links.status` ([004](../migrations/004_align_link_status.sql)) existe mais c'est de la **revue de lien** (accepted/rejected), pas le statut du contenu.
- **Greffe** : nouvelle colonne `units.unit_status` (`non_traduit`/`ajout`/NULL), migration `022_unit_status.sql` + `idx_units_status`. Pattern de migration : fichier numéroté appliqué par `apply_migrations` ([db/migrations.py:31](../src/multicorpus_engine/db/migrations.py#L31)), enregistré dans `schema_migrations`. Dernière migration : 021.
- Exposer `unit_status` dans `set_unit_role`/`bulk` + dans les filtres UI (« tous les chapeaux non traduits » = rôle + statut).

> Décision (DESIGN §8.1) confirmée par le code : **statut au niveau unité**, pas sur le lien — le « non traduit » est une propriété de l'unité.

---

## 3. Segmentation phrase & persistance du parent

**Existe ✅**
- `resegment_document` ([segmenter.py:444](../src/multicorpus_engine/segmenter.py#L444)) : découpe `text_norm` en phrases (`segment_text`, packs `fr_strict`/`en_strict`, protection abréviations). Création des unités-phrases L534-536.
- Protection paratexte : `text_start_n` ([segmenter.py:22](../src/multicorpus_engine/segmenter.py#L22)) — unités `n < text_start_n` exclues.
- **Survie des rôles** : `role_map` snapshot (L504) puis ré-application sur le **1ᵉʳ segment** de chaque ligne (L565-580). → un `[InterT]`/`[T]`/`[Ch]` survit à la segmentation (base du §4).
- Undo Mode A : `record_action` capture `units_before` avec **tous les champs dont `meta_json`** ([undo.py] restauration `meta_json_before`).
- Variante marqueurs : `resegment_document_markers` (L258) pose `external_id = numéro de marqueur`.
- Invocation : CLI `cmd_segment` ([cli.py:836](../src/multicorpus_engine/cli.py#L836)), sidecar `POST /segment` ([sidecar.py:5117](../src/multicorpus_engine/sidecar.py#L5117)).

**Trou mesuré ❌**
- À la création des phrases (L534-536), `external_id = NULL` **et** `meta_json = None` → **le paragraphe parent n'est pas tracé**, et les `alignment_links` sont supprimés (L539-542).

**Greffe — persistance du parent (sans migration)**
- Remplir `meta_json` à la création : `{"parent_unit_id": row["unit_id"], "parent_n": row["n"]}` au lieu de `None` (L535). `meta_json` existe déjà (clés actuelles : `sep_count`, `heading_level` — [docx_paragraphs.py:75](../src/multicorpus_engine/importers/docx_paragraphs.py#L75)).
- **Impact undo = nul** : `meta_json_before` est déjà capturé et restauré par le snapshot Mode A → rien à ajouter côté undo.

---

## 4. Ancres de bloc (parent + rôles structurels + endpoints existants)

Deux sources d'ancre `k`, complémentaires :

**(a) Parent ¶ persisté** — §3 (fin, robuste, à construire via `meta_json`).

**(b) Blocs dérivés des rôles structurels** — gratuit, survit à la segmentation :
- Requête : `SELECT n, external_id, unit_role FROM units WHERE doc_id=? AND unit_type='line' AND unit_role IN ('titre','intertitre','chapeau') ORDER BY n`. Les phrases entre deux marqueurs forment une section. `idx_units_role` existe ([014](../migrations/014_unit_role_field.sql)).
- **Réutiliser l'existant** : `POST /segment/structure_sections` ([sidecar.py:3573](../src/multicorpus_engine/sidecar.py#L3573)) liste déjà des sections structurelles ; `POST /segment/structure_diff` (L3623) compare deux structures ; `POST /segment/propagate_preview` (L3805) fait de la segmentation ancrée par section. → **inspecter ces handlers avant de coder** : une partie de la dérivation de blocs y est déjà.

> Nuance : les deux fichiers *Texte 6* n'ont **aucun** `[InterT]` (juste `[T]`/`[Ch]`/`[non traduit]`). Sur ces textes, l'ancre vient du parent ¶ (a) ou du positionnel ; (b) jouera sur les textes à intertitres.

---

## 5. Aligneur de phrases à deux niveaux

**Existe ✅ — tout le squelette réutilisable**
- 4 stratégies, chacune `align_pair_by_*` + wrapper `align_by_*` : `external_id` ([aligner.py:176](../src/multicorpus_engine/aligner.py#L176)), `position` (L578, apparie par `n`), `similarity` (L758, char edit-distance — **inutile FR↔EN**), `external_id_then_position` (L343).
- `AlignmentReport` ([aligner.py:36](../src/multicorpus_engine/aligner.py#L36)) : `matched`, `missing_in_target/pivot`, `duplicates_*`, `links_created`, `coverage_pct`, `warnings` — **réutilisable tel quel**.
- Écriture : `INSERT OR IGNORE INTO alignment_links(run_id,pivot_unit_id,target_unit_id,external_id,pivot_doc_id,target_doc_id,created_at)` (L281 etc.). Contrainte unique `(pivot,target)` ([008](../migrations/008_alignment_links_unique.sql)).
- Chargement : `_load_doc_lines` (L89, filtre `external_id IS NOT NULL`, `n >= text_start_n`), `_load_doc_line_rows` (L120, garde `n`, `external_id` nullable) — **ce dernier convient aux phrases** (external_id NULL).
- Invocation : CLI `cmd_align` ([cli.py:421](../src/multicorpus_engine/cli.py#L421), `--strategy`), sidecar `_handle_align` ([sidecar.py:6030](../src/multicorpus_engine/sidecar.py#L6030)) via dispatch `_run_alignment_strategy` (L373).

**À construire ❌ — `align_pair_by_length` (Gale-Church borné par bloc)**
- **Pattern** : copier la structure de `align_pair_by_position` (L578) comme template ; signature identique (incl. `protected_pairs`, `run_id`, `run_logger`) ; itérer **par bloc `k`** (parent §3 ou section §4) ; DP sur longueurs gérant 1-1/1-2/2-1/1-0/0-1 ; gaps signalés par `unit_status`/marqueurs.
- Wrapper `align_by_length` (modèle `align_by_position` L700).
- Greffes d'intégration : CLI `cmd_align` (ajouter `strategy=="length"`), sidecar `_run_alignment_strategy` (L373), `AlignPanel.ts` (type `AlignStrategy` L51 + `<option>`).
- **Réutilise** : `AlignmentReport`, l'INSERT, `protected_pairs`, `run_id` — **aucune table à modifier**.

---

## 6. Coexistence auto / semi-manuel

**Existe ✅ — entièrement câblé**
- `protected_pairs: set[tuple[int,int]]` sur toutes les stratégies (ex. [aligner.py:182](../src/multicorpus_engine/aligner.py#L182)) : les paires protégées sont marquées « utilisées » avant la boucle → jamais réécrites ; `protected_skipped` reporté.
- Côté sidecar : `_prepare_alignment_replace` ([sidecar.py:321](../src/multicorpus_engine/sidecar.py#L321)) extrait les liens `status='accepted'` quand `replace_existing=True` ET `preserve_accepted=True` (défaut) → **un ré-alignement auto préserve les liens manuels acceptés**.
- Provenance : chaque lien porte son `run_id` (manuel = `'manual'`, [sidecar.py:7479](../src/multicorpus_engine/sidecar.py#L7479)) ; `status` NULL/accepted/rejected ([004](../migrations/004_align_link_status.sql)) ; révision via `POST /align/link/update_status` (L7504) et l'AlignPanel (boutons ✓/✗/?).

**À construire** : rien côté moteur. Reste l'**UX** (choisir la méthode par texte/lot, afficher la provenance d'un lien — DESIGN §8.3). Le corpus historique manuel s'ingère par import positionnel et reste protégé.

---

## 7. Concordancier — afficher rôle + valeur

**Existe ✅**
- Modes recherche `query.py` : segment/kwic (SELECT FTS [query.py:775](../src/multicorpus_engine/query.py#L775)), CQL (`token_query.py:224`). Hits construits `_build_hits_core` (L391).
- Vue parallèle/alignée : `_fetch_aligned_units` ([query.py:264](../src/multicorpus_engine/query.py#L264)) — forward (pivot→targets) + reverse/siblings ; renvoie le dict aligné (L306-316, 374-384).
- FTS : `build_index` n'indexe que `unit_type='line'`, `text_norm` ([indexer.py:100](../src/multicorpus_engine/indexer.py#L100)). **Une unité `text_norm=""` est insérée mais ne matche aucune requête** → un placeholder « non traduit » est invisible *en recherche directe* (correct), mais apparaît *en cellule alignée* en face de l'original (là où on veut le label).
- Front : `QueryHit`/`AlignedUnit` ([sidecarClient.ts:43](../tauri-app/src/lib/sidecarClient.ts#L43)), rendu `renderHit`/`renderParallelHit`/`renderAlignedBlock` ([results.ts:229-437](../tauri-app/src/ui/results.ts#L229)), pattern de badge `appendSourceChangedBadge` (L123).

**Trous ❌ — `unit_role` n'est remonté nulle part**
1. SELECT FTS (query.py:775) et `_fetch_aligned_units` (forward L280, reverse L335) **ne sélectionnent pas** `u.unit_role` ni `JOIN unit_roles`.
2. Dicts de hits/aligned (L306-316, 374-384, 426-463) **n'ont pas** `unit_role`/`role_label`/`role_color`.
3. `QueryHit`/`AlignedUnit` n'ont pas ces champs.
4. `renderParallelHit`/`renderAlignedBlock` affichent `item.text ?? item.text_norm ?? ""` → **cellule blanche** si `text_norm` vide ; aucun badge de rôle ; pas de `appendRoleBadge`.

**Greffe**
- Query : ajouter `u.unit_role, COALESCE(ur.label,'') role_label, COALESCE(ur.color,'#6366f1') role_color` + `LEFT JOIN unit_roles ur ON ur.name=u.unit_role` dans le SELECT FTS et les 2 branches de `_fetch_aligned_units` ; threader ces champs dans tous les dicts.
- Affichage : valeur = `text_norm` sinon **fallback** `text_raw`/`role_label` ; nouvelle fonction `appendRoleBadge(row, role, label, color)` (calquée sur `appendSourceChangedBadge`) ; classe CSS `app-role-label` (préfixe `app-*` obligatoire).
- Contrat : champs ajoutés aux hits → bump contrat (voir §10).

---

## 8. Garde-fous anti-dérive

**Existe ✅**
- `qa_report.py` : `_check_import_integrity` (L36), `_check_metadata_readiness` (L71), `_check_alignment_pairs` ([L122](../src/multicorpus_engine/qa_report.py#L122), coverage/orphans/collisions par paire) ; gates `POLICY_RULES` (L200) + `_apply_policy` (L219) ; `generate_qa_report(conn, doc_ids, policy)` (L237, gate `ok`/`warning`/`blocking`) ; HTML (L343). CLI `qa-report` ([cli.py:755](../src/multicorpus_engine/cli.py#L755)). **Pas d'endpoint sidecar** (CLI-only).
- `AlignmentReport.missing_in_target/pivot` déjà calculés → localisation de divergence gratuite.
- `SEGMENT_RATIO_WARN_THRESHOLD = 0.15` ([sidecar.py:76](../src/multicorpus_engine/sidecar.py#L76)).

**À construire ❌**
- **(8a) Pré-vol compteurs** : avant alignement positionnel, comparer `COUNT(*) line units` pivot/target ; si écart > seuil → **bloquant acquittable** (remonter `missing_in_*` pour localiser). Greffe : soit `_handle_align` (sidecar.py:6030, avant `_run_alignment_strategy`), soit nouveau check `_check_alignment_readiness` dans `qa_report.py`. Réutiliser `SEGMENT_RATIO_WARN_THRESHOLD`.
- **(8b) Post-check d'ancres** : nouveau `_check_anchor_consistency(conn)` dans `qa_report.py` après L195 — `JOIN units` sur `alignment_links`, comparer `unit_role` pivot vs target, grouper par paire, lister incohérences + localisation. Intégrer dans `generate_qa_report` (L269), `POLICY_RULES` (`{"lenient":"warning","strict":"error"}`), summary + section HTML.
- Limite assumée : n'attrape que la dérive qui **traverse une ancre** (cf. note de décision §5b).

---

## 9. Modèle de données — récap migrations

| Besoin | Migration | Détail |
|--------|-----------|--------|
| Statut traduction (A) | **022_unit_status.sql** (neuf) | `ALTER TABLE units ADD COLUMN unit_status TEXT` + `idx_units_status` |
| Parent ¶ (B) | **aucune** | `meta_json["parent_unit_id"]` (colonne existe, undo couvre déjà) |
| Valeur d'affichage (C) | **aucune** | `LEFT JOIN unit_roles` + fallback `text_raw` (code seul) |

Colonnes clés existantes : `units(external_id?, text_raw, text_norm, meta_json?, unit_role?→unit_roles.name, text_source?)` ([001](../migrations/001_initial_schema.sql), [014](../migrations/014_unit_role_field.sql), [020](../migrations/020_unit_text_source.sql)) ; `alignment_links(status?, run_id, …)` ; `documents(text_start_n?, …)` ([015](../migrations/015_text_start.sql)). Pattern migration : fichier `NNN_*.sql` appliqué par `apply_migrations`.

---

## 10. Contraintes transverses & découpage affiné

**Contrat sidecar** (tout nouvel endpoint : `/lift/markers`, champs ajoutés aux hits) : bump `CONTRACT_VERSION` (1.6.33→…) dans `sidecar_contract.py`, MAJ `openapi_spec()`, `python scripts/export_openapi.py`, **commit `docs/openapi.json` + `tests/snapshots/openapi_paths.json`**, et **ajouter au `docs/SIDECAR_API_CONTRACT.md`** (sinon `tests/test_contract_docs_sync.py` casse). Ajouter les write-paths au `_WRITE_PATHS` / predicate ([sidecar.py:498](../src/multicorpus_engine/sidecar.py#L498)), prendre le write-lock `with self._lock()`.

**Growth-gate** : `sidecar.py` ne doit pas croître de > 500 lignes nettes / 90j → handlers **fins**, logique dans `services/` (modèle A-01). `marker_lift`, l'aligneur de longueurs et les checks QA vivent **hors** `sidecar.py`.

**Découpage tickets (ré-ancré)**
- **T1** Migration `022_unit_status` + expo dans set_role/bulk + filtre UI.
- **T2** `marker_lift.py` (passe post-import idempotente) + route `POST /lift/markers` (handler fin).
- **T3** Persistance parent `meta_json` dans `resegment_document` (L535) — sans migration, undo inchangé.
- **T4** Concordancier : query `LEFT JOIN unit_roles` + champs hits + `appendRoleBadge` + fallback cellule vide (engine + tauri-app).
- **T5** Garde-fous : pré-vol (réutilise `SEGMENT_RATIO_WARN_THRESHOLD`) + `_check_anchor_consistency` (extension `qa_report.py`).
- **T6** `align_pair_by_length` + wrapper + dispatch CLI/sidecar/AlignPanel ; **avant** : inspecter `/segment/structure_sections|structure_diff|propagate_preview` pour réutiliser la dérivation de blocs. Dépend de T3.
