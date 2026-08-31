"""Sidecar API contract definitions.

Contains:
- versioned contract metadata
- standardized error codes
- response payload helpers
- OpenAPI spec generator
"""

from __future__ import annotations

from typing import Any

from .services.request_schemas import INDEX_SCHEMA, field_schema_to_openapi


CONTRACT_VERSION = "1.6.86"  # semantic versioning for the sidecar API contract
# SID-08 / OPS-03: the API version IS the contract version — derived, never a
# second hand-maintained literal, so the two can no longer drift. /health reports
# the *engine* version under `version` (it predates the sidecar); every other
# endpoint's `version` / `api_version` reports this API/contract version.
API_VERSION = CONTRACT_VERSION
# 1.4.0: added export_tei_package job kind (Sprint 4 — Publication ZIP)
# 1.4.1: ERR_CONFLICT (409) for duplicate run_id; token protection on /align, /curate, /segment
# 1.4.2: document workflow status fields on /documents and metadata update endpoints.
# 1.4.3: POST /db/backup endpoint (token-required DB backup to timestamped .db.bak).
# 1.4.4: add async job kind export_readable_text (TXT/DOCX readable exports).
# 1.4.5: /align supports replace_existing + preserve_accepted (global recalculation mode).
# 1.4.6: GET /documents/preview (mini excerpt endpoint for Prep Documents screen).
# 1.4.7: POST /documents/delete (cascade delete documents with all associated data).
# 1.4.8: GET/POST /corpus/info — corpus-level title, description, meta_json (metadata / qualification).
# 1.4.9: GET /corpus/audit — corpus health audit (missing fields, empty docs, duplicates by hash/filename/title).
# 1.5.0: DocumentRecord gains optional author_lastname, author_firstname, doc_date fields (migration 010).
# 1.5.1: GET /doc_relations/all — returns all relations in corpus for hierarchy view.
# 1.6.0: GET /families — list document families (parent+children) with completion stats.
# 1.6.1: POST /families/{id}/segment — segment whole family; POST /segment gains calibrate_to.
# 1.6.2: POST /families/{id}/align — align all parent↔child pairs in a family.
# 1.6.3: GET /corpus/audit gains `families` section
# 1.6.4: POST /export/tmx (paire ou famille entière), POST /export/bilingual (html|txt, preview_only). (orphans, unsegmented, unaligned, ratio warnings)
#         and optional query param ratio_threshold_pct (default 15).
# 1.6.5: POST /query gains optional family_id (expand to family doc_ids, force include_aligned)
#         and pivot_only (restrict to parent doc only). Response gains family_id, family_doc_ids, pivot_only.
# 1.6.6: Curation propagée — alignment_links gains source_changed_at (migration 011).
#         GET /families/{id}/curation_status — unités à revoir par enfant.
#         POST /align/link/acknowledge_source_change — acquitter le flag de changement.
#         AlignedUnit (in query hits) gains link_id + source_changed_at.
# 1.6.7: Import groupé — POST /import gains optional family_root_doc_id (integer).
#         When provided: creates translation_of relation after import and returns
#         relation_created (bool) + relation_id (int) in ImportResponse.
# 1.6.8: POST /segment/preview — in-memory segmentation (same engine, no DB writes).
# 1.6.9: POST /segment/detect_markers — detect [N] markers in units (read-only).
#         POST /segment/preview mode=markers — preview [N]-based segmentation.
#         POST /jobs/enqueue segment mode=markers — execute marker-based resegmentation.
# 1.6.10: POST /units/merge — merge two adjacent units into one.
#          POST /units/split — split one unit into two.
#         Takes { doc_id, lang?, pack?, limit?, calibrate_to? }, returns segments list + warnings.
# 1.6.11: POST /segment/preview accepts optional calibrate_to and returns
#         optional calibrate_ratio_pct, mirroring /segment ratio warnings.
# 1.6.12: POST /import supports mode=conllu (token rows persisted in `tokens` table).
# 1.6.13: POST /annotate async job endpoint + job kind `annotate`.
#         DocumentRecord gains token_count + annotation_status.
# 1.6.14: POST /token_query endpoint (minimal CQL token search, Sprint C backend).
# 1.6.15: /token_query supports advanced CQL clauses: [] wildcard, {m,n} quantifiers, `within s`.
# 1.6.16: POST /export/conllu endpoint (export token annotations as CoNLL-U).
# 1.6.17: POST /export/token_query_csv endpoint (export CQL hits to CSV/TSV).
# 1.6.18: POST /export/ske endpoint (Sketch Engine-style vertical export).
# 1.6.19: POST /index and async index jobs accept optional incremental mode;
#         incremental index responses include inserted/refreshed/deleted counters.
# 1.6.20: GET /tokens (list token rows for one document/unit);
#         POST /tokens/update (manual token-by-token annotation edits).
# 1.6.21: POST /query gains optional db_paths federation (multi-DB query in one request).
# 1.6.22: POST /token_stats — frequency distribution of a token attribute (lemma/upos/xpos/word/feats)
#         over all hits of a CQL query. No auth token required (read-only).
# 1.6.23: POST /token_query gains optional include_aligned (bool, default false).
#         When true, each hit gains an `aligned` list with partner units from alignment_links.
#         Query hits gain source_db_* provenance when federated; response gains federated metadata.
# 1.6.24: POST /token_collocates — collocation analysis for a CQL query.
#         Returns top-K collocates with PMI and log-likelihood (G²) scores, left/right freq split,
#         and corpus baseline frequency. No auth token required (read-only).
# 1.6.25: Convention/role system (migrations 013–015).
#         GET /conventions — list roles. POST /conventions — create. PUT /conventions/{name} — update.
#         POST /conventions/delete — delete (sets unit_role=NULL on assigned units).
#         POST /units/set_role — assign role to one unit. POST /units/bulk_set_role — batch assign.
#         POST /documents/set_text_start — set paratextual boundary (text_start_n).
# 1.6.26: GET /units?doc_id=N[&unit_type=] — list all units for a document with unit_role field.
# 1.6.27: POST /token_query gains optional include_context_segments (bool, default false).
#         When true, each hit gains prev_segment / next_segment with the adjacent units in the document.
#         Each hit also gains unit_n (position of the unit in the document).
# 1.6.28: ShareDocs / WebDAV ingestion — Phase 2 (sidecar).
#         POST /webdav/list — browse a WebDAV collection (PROPFIND, Depth:1); read-only, no token.
#         POST /import-remote — batch-ingest a WebDAV folder as an async job (token required) → {job}.
#         Credentials (auth object) are body-only on loopback, used to build the Authorization
#         header, and NEVER persisted (DB / runs.params / job params / logs / telemetry).
# 1.6.29: POST /import-remote gains optional `hrefs` (array) — explicit file selection (P4C).
#         Intersected with the folder PROPFIND listing (an unlisted href is ignored, never
#         fetched); bypasses the `include` glob. Omit to import the whole folder.
# 1.6.30: ADR-043 P3 — GET /units items gain `text_raw` + `text_source`; GET /documents/preview
#         lines gain `text_source` (and document the already-emitted `text_raw`/`unit_role`).
#         Raw nullable column values so the UI can reveal the verbatim import original when
#         text_source != text_raw. (export source_field gains 'text_source' — validated inline,
#         not part of the frozen job schema.)
# 1.6.31: POST /token_stats group_by gains 'year' (F2 — diachronic distribution). Year rows are
#         counted per hit, bucketed by the matched document's leading-4-digit doc_date (undated →
#         '(sans date)', sorted chronologically), and gain tokens_in_period + freq_per_10k
#         (normalised occurrences / 10k tokens of that year). Additive nullable row fields.
# 1.6.32: POST /units/merge & POST /units/split responses gain `fts_stale` (boolean, additive) —
#         both mutate indexed text so the client must reindex; merge also prunes the deleted
#         unit's orphan FTS row server-side (ENG-03).
# 1.6.33: spaCy model management (on-demand download) — GET /models (catalog + install status;
#         filesystem-only, lock-free); POST /models/download (async job → {job}, token required;
#         allowlisted model, wheel from Explosion GitHub releases over https); POST /models/remove
#         (token required). Engine logic in services/models_service (Phase 2 of the design note).
# 1.6.34: GET /documents/stats — per-doc stage stats (line/structure/external_id/parent/aligned
#         counts + max/avg text length) for the canvas state strip (refonte R1.2). Read-only,
#         logic in services/documents_service.document_stats.
# 1.6.35: GET /units items gain `parent_n` (integer, nullable) — the coarse paragraph anchor
#         (meta_json.parent_n, populated by resegmentation R2.1) so the canvas can group
#         sentences under their ¶ (refonte R2.3). Additive nullable field; null when the doc
#         was never fine-segmented. Read straight out of meta_json via json_extract.
# 1.6.36: alignment `strategy` enum gains `length_bounded` (Gale–Church by length, bounded by
#         the ¶ anchor — refonte R3.2), accepted by /align + /jobs/enqueue align. AlignLinkRecord
#         (GET /align/audit) gains `bead_id` (integer, nullable) — groups the 1-1 links of one
#         N-M bead; null for plain 1-1 / legacy / manual links. Both additive.
# 1.6.37: translation-status axis (refonte R4.1). POST /units/set_status + /units/bulk_set_status
#         (token required) set units.unit_status ∈ {non_traduit, ajout} (or null to clear) —
#         orthogonal to unit_role. GET /units items gain `unit_status` (string enum, nullable).
#         New routes + additive field.
# 1.6.38: QueryRequest gains optional `unit_status` (enum non_traduit/ajout) — filters hits to
#         units with that translation status (refonte R4.1). Additive param, no new route.
# 1.6.39: POST /lift/markers (token required) — lift a document's inline peritext markers
#         ([T]/[Ch]/[InterT]/[non traduit]/[+]) into unit_role/unit_status, stripping them from
#         text_norm (refonte R4.2). dry_run=true (default) reports without writing. New route.
# 1.6.40: /query hits (and their aligned units) gain unit_role + unit_status so the
#         concordancier can display the peritext role and translation status (refonte R4.3).
#         Additive: the QueryResponse `hits` items schema is intentionally open ({type:object}),
#         so no schema shape changes — version-only bump for traceability. No new route/param.
# 1.6.41: POST /query/facets gains optional `unit_status` (enum non_traduit/ajout) so the
#         facet counts/top-docs honour the R4.1 filter (audit FE-01). Additive param.
# 1.6.42: GET /models items gain `source` (enum bundled/downloaded/absent) so an *embedded*
#         model is shown as available, not "Absent" (Lot 1 of the dual-dist/selection design).
#         POST /models/remove now refuses a bundled model (read-only) with 400. Additive field.
# 1.6.43: GET /models items gain `genre` + `size_class` (parsed from the name); the catalogue
#         is the static extended set (sm/md/lg per language) and GET /models gains optional
#         `?language=` filter (R5.2c-1, Lot 3). Install allowlist = compat.json + name regex.
#         Additive field + additive query param.
# 1.6.44: GET /models items gain `active` (bool — the per-corpus active model for that
#         language); new POST /models/active {language, model} sets it in corpus_info.meta_json
#         (write, token). Annotation honours the active model (R5.2c-2, Lot 4). Additive field
#         + 1 new route.
# 1.6.45: configurable segmentation (R5.4a). POST /segment and POST /segment/preview gain two
#         optional, additive knobs that override the legacy mode/lang/pack path:
#         `preset` (phrases|mots|balises) and `spec` (SegmentSpecInput: kind terminator/
#         whitespace/markers + terminators + require_uppercase_after + protect_abbreviations).
#         Absent → byte-identical to the historical sentence/marker split. The async `segment`
#         job (POST /jobs/enqueue) accepts the same params. Engine logic in segmenter.py
#         (SegmentSpec / split_unit_text / spec_from_dict); no migration (nothing persisted here).
# 1.6.46: coarse regrouping (R5.4c/B). New POST /segment/coarse — an *ascendant*, non-destructive
#         relabel of meta_json.parent_n on a doc's line units by a coarse boundary (`preset`=tours:
#         a leading dialogue dash — or a custom line-start `pattern`). No resegmentation → the fine
#         units, alignment_links and FTS are untouched. Logic in coarse_grain.py
#         (regroup_by_boundary / regroup_document_coarse); no migration (parent_n in meta_json).
# 1.6.47: document notes (R6.1). documents.notes (migration 024) — free-text notes-to-self at the
#         document level (≠ doc_relations.note). Additive `notes` on DocumentRecord (GET /documents)
#         and DocumentUpdateRequest (POST /documents/update, /bulk_update). Not FTS-indexed.
# 1.6.48: filterable document labels (R6.2). New table document_tags (migration 025, namespaced N-N:
#         doc_id, kind, value — both free-text). New GET /tags (?doc_id → a doc's tags, else distinct
#         corpus (kind,value)), POST /documents/tags/add|remove. Additive `tags` filter on POST /query
#         + /query/facets (array of {kind,value}; a doc matches ANY pair — OR). token_query/stats not
#         covered. Logic in services/tags_service.py + query._apply_doc_filters.
# 1.6.49: type-specific / ad-hoc document metadata (R6.3). No migration (documents.meta_json exists).
#         POST /documents/update gains an optional `meta` object — merged into documents.meta_json under
#         the `fields` key, preserving importer provenance keys (TXT encoding, CoNLL-U import stats).
#         DocumentRecord gains parsed `meta_json` (object|null) on GET /documents + the update response
#         so the front can round-trip the fields. Logic in services/documents_service.update_document.
# 1.6.50: source-anchored "couper" (R3.3). AlignBatchAction gains two additive actions —
#         set_target_span (char_start/char_end: record a text_raw sub-span of the link's target
#         unit — a non-destructive cut) and clear_target_span (reset to the whole unit). Migration
#         027 (alignment_links.target_char_start/end, nullable). No new route → snapshot/.md
#         unchanged. Logic in services/align_links_service.
# 1.6.51: GET /align/audit link items gain target_text_raw (verbatim target — the string the cut
#         offsets index) + target_char_start / target_char_end (the link's cut, null = whole unit),
#         so the front can render a source-anchored cut without re-fetching. Additive; no new route.
# 1.6.52: source-anchored matrix export (R3.3 §D7). New POST /export/matrix — the multilingual
#         alignment matrix (one row per hub/parent segment, one column per language; source-anchored
#         cut slices + N-M bead concatenation applied). NEW route → openapi + snapshot + .md all move.
#         Logic in services/matrix_export_service (projection is derived, never stored — D4).
# 1.6.53: source-anchored matrix as JSON (R3.3 tranche 2, DESIGN_alignment_workspace §6). New
#         read-only POST /align/matrix — same projection as /export/matrix but returned in the
#         response (headers / rows / languages / hub_doc_id) for the alignment grid to render,
#         instead of writing a CSV to disk. NEW route → openapi + snapshot + .md all move.
# 1.6.54: revue 3b (F2/A2/F8). AlignLinksBatchUpdateRequest gains optional `atomic` (default
#         false): all-or-nothing batch — on any action error the whole batch rolls back
#         (response gains `rolled_back`). /align/matrix response (non-schematized) gains
#         `cell_links` (per-cell {link_id, target_unit_id, char_start, char_end,
#         target_text_raw}) and now EXCLUDES rejected links from the projection (coherent
#         with ALN-03, revue F8). No new route → snapshot/.md unchanged; openapi moves
#         (schema field). Logic in services/matrix_export_service + the batch handler.
# 1.6.55: D-W13 (coupe itérative + ↺ cellule). AlignLinkCreateRequest gains optional
#         `external_id` (inherit the sibling link's pair number — fixes the stray [§0]
#         row in the audit view). /align/matrix cell_links items (non-schematized) gain
#         `external_id` + `manual` (run_id='manual') so the grid's ↺ can delete the
#         gesture-created links. No new route → snapshot/.md unchanged; openapi moves.
# 1.6.56: statuts matrice (D-W8 résolu / D8 / D-W14). New POST /align/cell_status —
#         per-cell « non traduit » on the (hub unit × target doc) pair (table
#         alignment_cell_statuses, mig 028; status null clears; 409 when the cell has
#         active links). NEW route → openapi + snapshot + .md all move. /align/matrix
#         response (non-schematized) gains hub_unit_statuses / cell_statuses (both
#         status axes), addition_rows (unit_status='ajout' woven as flux rows — also
#         in the CSV export) and uncovered (per-column unlinked units, the « ＋ Ajout »
#         panel), and omitted cells now show the [non traduit] token (D10). Logic in
#         services/align_cell_status_service + matrix_export_service.
# 1.6.57: ⭙ Fusionner + bead de cellule (D-W16). AlignBatchAction.action gains `set_bead`
#         and `clear_bead`: a matrix cell holding several links is ONE bead (1 hub segment ↔
#         N target sentences), not a collision — the bead_uid is DERIVED server-side from the
#         link's (pivot_unit_id, target_doc_id) (services/align_links_service.cell_bead_uid),
#         so the client never invents an identifier. Fixes the phantom collisions the D-W12
#         straddle cut seeded (its manual link had no bead_uid next to the aligner's; migration
#         030 backfills the cells already produced). No new route → snapshot unchanged; openapi
#         moves (enum value) + .md documents the two actions.
# 1.6.58: barre « Aligner » (tranche 5, revue). /align/matrix response (non-schematized) gains
#         `link_count` — EVERY link of the family, rejected ones INCLUDED. The projection excludes
#         rejected links (F8), but the aligner does not: INSERT OR IGNORE dedupes on the unique
#         (pivot_unit_id, target_unit_id) index, which a rejected row still occupies. A family whose
#         links were all rejected therefore re-aligns to NOTHING, and the UI's « déjà aligné ? » gate
#         must be based on this count, not on what the grid displays. Additive field → snapshot/.md
#         unchanged; openapi moves (version).
# 1.6.59: ancrage amont (chantier 1, DESIGN_upstream_anchoring §4). /align/matrix response
#         (non-schematized) gains `anchor_status` — PARALLEL to `languages` (index 0 = hub),
#         each {anchored: bool, kind: "value"|"paragraph"|"position"|null, line_count: int}.
#         A text with no anchor (kind=null) makes the length-bounded aligner drift; the barre
#         « Aligner » warns before running so the user anchors first (re-import numbered /
#         regroup by boundary / extract a blob) instead of hand-repairing the matrix downstream.
#         Read-only, derived (services matrix_export_service + anchoring.anchor_status_for_doc).
#         Additive field → snapshot/.md unchanged; openapi moves (version).
# 1.6.61: IMP-03 (audit import). POST /import/preview → conllu_stats gains `not_utf8`
#         (boolean): the lenient preview decoded a non-UTF-8 file as latin-1, but the strict
#         CoNLL-U import rejects non-UTF-8 → the field lets the UI warn before the user
#         commits (« aperçu OK puis échec à l'import »). Additive field → snapshot/.md
#         unchanged; openapi moves (version). Logic in importers/conllu.preview_conllu.
# 1.6.60: re-anchor (5th verb, RA-D1). AlignBatchAction.action gains `set_pivot` +
#         field `new_pivot_unit_id`: move a link onto a different hub/pivot segment
#         (symmetric to retarget's target move). Only pivot_unit_id changes — status,
#         target and cut span preserved; the derived bead_uid is cleared (RA-D2). New
#         pivot must exist, be a line unit, and belong to the link's hub doc; a
#         duplicate (pivot,target) link is refused. Logic in
#         services/align_links_service.set_pivot. Additive enum+field → no new route →
#         snapshot unchanged; openapi moves (version); .md action list updated.
# 1.6.85: GET /documents gagne `curated_at` et `aligned_count` (additifs) — ACT-01. La
#         page Actions posait une liste de documents inerte au-dessus de quatre cartes
#         d'etapes, sans rien qui circule : impossible de voir depuis la liste ce qui
#         restait a faire, et sur quoi. Les deux etats manquants etaient les seuls non
#         servis. `curated_at` (ISO, nullable) = date du dernier apply de curation NON
#         annule, lu dans `prep_action_history` — la trace existait deja, ecrite par le
#         moteur sur les deux portees (un document, ou tout le corpus, ou
#         `curate_all_documents` rappelle le meme recorder par document). Elle est
#         preferee a `curation_apply_history` (migration 007), dont le `doc_id` est NULL
#         des la portee « tout le corpus » et qui n'est ecrite qu'a la demande du front :
#         mesure sur la base de travail, 1 ligne contre 5. Limite assumee : un apply sans
#         effet n'ecrit rien, donc « le texte a ete modifie par la curation », pas
#         « quelqu'un a clique Appliquer ». `aligned_count` (entier, defaut 0) = liens
#         touchant le document dans un sens comme dans l'autre ; servi ici plutot que
#         deduit de /families, qui ne connait que les documents EN famille et laisse donc
#         muets les isoles (6 sur 58 dans la base de travail). Aucune migration : les deux
#         valeurs sont derivees, mesurees a 0,6 ms et 3,2 ms sur 14 577 liens. Champs
#         additifs sur route existante -> snapshot inchange ; openapi bouge.
# 1.6.86: GET /documents gagne `fts_repairable` (booleen, additif) — FTS-01. Des deux
#         pannes que `fts_readable: false` recouvre, une seule se repare depuis
#         l'application, et 1.6.84 ne permettait pas de les distinguer : le bouton
#         restait donc inactif dans les DEUX cas, alors que la panne « declaration
#         retiree du schema » porte trois des quatre instantanes abimes du corpus et
#         qu'une reindexation la repare vraiment (mesure le 31 aout sur une copie :
#         46 674 lignes, integrity_check ok). L'autre — pages corrompues — n'a aucune
#         voie SQL qui marche : six mesurees le 25 aout, toutes mortes. Le moteur tranche
#         et sert un booleen plutot que la taxonomie : l'ecran a besoin de savoir s'il
#         peut proposer une reparation, pas de connaitre les modes de defaillance de
#         FTS5. La classification interroge le SCHEMA (`fts_units` est-il declare ?) et
#         non le type d'exception : `OperationalError` couvre aussi « database is
#         locked », qui serait sinon annonce reparable. Faux quand l'index se lit —
#         « reparable » ne veut pas dire « a reparer ». Aucune sonde supplementaire :
#         `index_failure` remplace `index_readable` et sert les deux drapeaux d'un seul
#         parcours. Champ additif sur route existante -> snapshot inchange ; openapi bouge.
# 1.6.84: GET /documents gagne `fts_readable` (booleen, additif) — FTS-01. La liste
#         portait deja `fts_stale` par document, derive de units <-> fts_units, mais
#         `stale_doc_ids` avale sqlite3.Error et rend un ensemble vide : un index
#         CASSE etait donc indistinguable d'un index A JOUR, et l'ecran repondait
#         « index a jour » au moment precis ou il fallait alerter. Mesure sur les
#         instantanes du 25 aout : les deux pannes connues (pages corrompues ; table
#         virtuelle retiree du schema, tables d'ombre intactes) rendaient zero document
#         perime. `fts_readable: false` dit « je ne peux pas savoir » la ou l'absence de
#         document perime disait « rien a faire ». Champ additif sur route existante ->
#         snapshot inchange ; openapi bouge.
# 1.6.83: /webdav/probe distingue deux refus que 1.6.81 confondait (SD-01). Un fichier
#         non sonde rendait `skipped-no-probe`, que le format se decrive lui-meme (TEI,
#         CoNLL-U : rien a deduire, mais le document s'importe tres bien) ou que son
#         extension n'ait aucune porte d'entree (.pdf, .jpg : il ne s'importe pas du
#         tout). Sous un statut unique, l'ecran aurait du refaire le tri — ou, plus
#         probablement, propose un PDF a l'import. `skipped-unsupported` separe le second
#         cas, et le rapport gagne `skipped_unsupported`. Trouve en passe adverse avant
#         qu'aucun client ne consomme 1.6.81. Statut + compteur additifs sur route
#         existante -> snapshot inchange ; openapi bouge.
# 1.6.82: modes PAR FICHIER a l'import distant (SD-01). POST /import-remote accepte
#         `modes` (objet href -> mode), qui prime sur `mode` pour les fichiers qu'il
#         nomme : c'est ainsi que ce que la sonde /webdav/probe a deduit de chaque
#         document se rend jusqu'a l'import. `mode` reste requis et sert de repli, donc
#         un appelant qui ignore SD-01 est inchange. Un fichier nomme dans `modes`
#         contourne le filtre d'extension du lot, au meme titre qu'une selection
#         explicite par `hrefs` — son mode a ete choisi pour lui. La garde de langue
#         porte desormais sur TOUS les modes en jeu : un lot en TEI contenant un seul
#         DOCX exige une langue, sans quoi ce fichier echouerait seul et cryptiquement.
#         Chaque ligne du rapport de lot gagne `mode`, le mode reellement utilise pour
#         ce document — le reglage de lot ne le dit plus. Champ optionnel + champ additif
#         sur route existante -> pas de nouvelle route -> snapshot inchange ; openapi bouge.
# 1.6.81: sonde d'import distant (SD-01). POST /webdav/probe lit un dossier WebDAV
#         SANS RIEN ECRIRE et rend, par fichier, la forme de /import/preview (units,
#         units_total, units_line, units_structure, truncated, tables) : de quoi que
#         l'ecran deduise le mode de CHAQUE fichier distant, comme il le fait deja en
#         local. ShareDocs imposait jusqu'ici un mode unique a tout un lot, presetectionne
#         sur « lignes numerotees », defaut mesure faux sur 149 des 273 fichiers reels.
#         Ni `mode` ni `language` requis — la sonde sert a decouvrir le premier et n'ecrit
#         aucun document. Job async ({job}, 202) comme /import-remote, mais dispatche HORS
#         VERROU comme /webdav/list : aucun acces base (JobManager est purement en
#         memoire), donc sonder ne bloque jamais une ecriture. Le double telechargement
#         est paye d'avance — un dossier du corpus pese 3 Mo au pire (mesure 28/08/2026
#         sur 514 fichiers) — ce qui garde la regle de deduction en UN exemplaire, cote
#         front. TEI/CoNLL-U ne sont pas telecharges : ces formats se decrivent eux-memes.
#         Logique dans remote/probe.py, qui appelle le MEME preview_text_units que
#         /import/preview (extrait de sidecar.py vers services/import_service). Route
#         NOUVELLE -> snapshot des chemins ET openapi bougent, et SIDECAR_API_CONTRACT.md
#         doit la nommer (test_contract_docs_sync).
# 1.6.80: comptes par type a l'apercu (IMPO-01). POST /import/preview renvoie
#         `units_line` / `units_structure`, comptes sur TOUTES les unites et non sur les
#         `limit` rapatriees. C'est la seule mesure qui separe deux modes rendant le meme
#         total — un bitexte en tableau rend 48 unites dans les deux modes DOCX, dont 48
#         indexables d'un cote et 0 de l'autre. Sans eux, l'apercu comparatif devait
#         redemander le document ENTIER par mode juste pour compter (~110 Ko de texte sur
#         la boucle locale, deux fois, pour deux entiers). Champs additifs sur route
#         existante -> snapshot inchange ; openapi bouge.
# 1.6.79: forme des tables (IMPO-01). POST /import/preview renvoie `tables`
#         (`[{columns, rows}]` en ordre de lecture, `null` hors modes DOCX) : de quoi
#         dire ce que le fichier CONTIENT avant de lui demander une colonne. Sans elle,
#         le champ « colonne » de l'ecran n'avait de sens que pour qui connaissait deja
#         le document. Ne conclut rien — porter une table ne fait pas d'un document un
#         bitexte (un fichier local porte 7 tables de 5,2,2,2,2,2,2 colonnes, de la mise
#         en page). Champ additif sur route existante -> snapshot inchange ; openapi
#         bouge. Logique dans importers/docx_columns.describe_tables.
# 1.6.78: bitexte en tableau (IMPO-01). POST /import/preview accepte `column_index`, qui
#         manquait pour TOUS les modes : l'aperçu d'une extraction par colonne montrait
#         zéro unité là où l'import en écrivait des centaines. Et `column_index` devient
#         valide pour le mode `docx_paragraphs` (POST /import, job d'import, dispatch CLI),
#         seule porte d'entrée d'un tableau à deux colonnes NON numéroté — le mode numéroté
#         le lisait mais, n'y trouvant pas de `[n]`, en faisait un document entièrement
#         `structure`, donc hors index. Champ optionnel sur routes existantes → pas de
#         nouvelle route → snapshot inchangé ; openapi bouge (version + propriété).
#         Logique dans importers/docx_columns.iter_column_paragraphs, partagée par les deux
#         importeurs DOCX.
# 1.6.62: paragraphes manuels (R6). New POST /segment/paragraph_boundary — toggle one line
#         segment as a paragraph start (or remove it when it already heads a multi-segment
#         block): the coarse grain is relabelled a block at a time (regroupe le run précédent
#         ET absorbe la queue en un geste). Non-destructive (only meta_json.parent_n moves),
#         idempotent, undoable (Mode A, action_type=set_paragraph). No migration (parent_n in
#         meta_json). NEW route → openapi + snapshot + .md all move. Logic in
#         coarse_grain.toggle_paragraph_boundary / set_paragraph_boundary_document.

# 1.6.63: « Pré-remplir » annulable (QA-06). POST /segment/coarse rewrites parent_n on the WHOLE
#         document and left NO trace at all — neither Mode A undo nor a row in
#         prep_action_history, so a mass mutation was both irreversible and unattributable.
#         The handler now snapshots meta_json for every unit whose parent_n moves and returns
#         the resulting action_id. Reuses action_type='set_paragraph' rather than adding a
#         type: both gestures move only parent_n and revert through the same
#         _undo_set_paragraph, and the user-visible label comes from the action's description
#         (free text), not from the type — so a distinct type would have bought a duplicate
#         dispatch branch and nothing else. Additive response field → no new route → snapshot
#         unchanged; openapi moves (version + schema); .md response line updated. No migration
#         (parent_n in meta_json). Logic in coarse_grain.regroup_document_coarse.

# 1.6.64: doublons de cible mesurés (ALI-22). The three collision counts of the product
#         (qa_report, /align/quality, the family aggregate) all GROUP BY pivot_unit_id:
#         they see a pivot carrying several beads, never a TARGET sentence claimed by
#         several pivot segments. Contrary to what the audit first recorded, the bead is
#         not what hides it — the query never looks that way, and an aligner link with no
#         bead takes part in it too. Measured on the reference corpus: 0 collisions
#         reported, 23 shared targets present, one of them held by THREE pivots.
#         Adds shared_target_count next to collision_count (payloads) and shared_targets
#         to the qa_report rows; raises that pair's severity to warning. Deliberately NOT
#         folded into the gate's blocking align_collisions sum — it reports, it does not
#         change what an export refuses. Additive response fields → no new route →
#         snapshot unchanged; openapi moves (version + schema).

# 1.6.65: l'annulation rend les liens qu'elle avait detruits (ALI-03, migration 035).
#         Mode A undo could restore a unit's text, role and meta_json, never a link:
#         undo.py touched alignment_links only through UPDATE source_changed_at and
#         DELETE — no INSERT anywhere — and prep_action_unit_snapshots carries only
#         unit columns. So « fusionner deux unites puis annuler » gave the units back
#         and lost their alignment for good, silently. New table
#         prep_action_link_snapshots archives every column of a destroyed link,
#         link_id and run_id included, so the restitution is IDENTICAL rather than an
#         approximate re-creation. Wired on /units/merge for now; the restore runs
#         centrally in execute_undo, so the remaining destructive paths only need
#         their archive call. /prep/undo gains alignments_restored and
#         alignments_restore_skipped (a re-align may have re-occupied the unique
#         (pivot,target) pair — those links are left alone and counted, never
#         clobbered). Additive response fields → no new route → snapshot unchanged.

# 1.6.66: un run d'alignement devient reversible (ALI-17 / ALI-10, migration 036).
#         NEW route POST /align/run/undo. Migration 035 could not own this archive:
#         its action_id points at prep_action_history, whose doc_id is a SINGLE
#         document, while an alignment run spans a pivot AND N targets and undo there
#         is linear per document. Hence a second table, align_run_purge, same
#         discipline (all columns archived → identical restitution). Only
#         replace_existing=true destroys anything: 15 destructive runs out of 53 on
#         the reference corpus, the other 38 cost zero storage. The three call sites
#         create their run BEFORE purging, so no reordering was needed. Links the user
#         reviewed after the run (status set) are KEPT and reported rather than
#         blocking the whole revert — measured 2 runs out of 9, over 2 and 1 links out
#         of 1226, which made a blanket refusal disproportionate. A later run on the
#         same pair makes the revert 409 CONFLICT: restoring would superpose a
#         generation, which is precisely the accumulation ALI-17 describes.
#         NEW route → openapi + snapshot + .md all move.

# 1.6.67: le stylo de la matrice repart du texte qu'il édite (ALI-01 tranche 1).
#         /align/matrix response (non-schematized) gains `hub_text_norms` (∥ rows, null on an
#         addition row) and cell_links items gain `target_text_norm`. The grid still PROJECTS
#         text_raw — that is deliberate and unchanged: the cut offsets
#         (target_char_start/end) index text_raw precisely because text_raw is immutable
#         (only merge/split rewrite it, and both delete the links in the same transaction).
#         But the inline stylo WRITES text_norm while it was seeded from the projection, so a
#         second correction reopened the ORIGINAL text and overwrote the first. Measured on
#         the reference corpus: two units of doc 416 lost a correction that way, one of them
#         also gaining a stray « fb » (audit §11.12). Sending both texts is what lets the
#         editor seed from norm without moving the cut anchors — the arbitration « what does a
#         correction do to an existing cut » stays open (tranche 2). Additive
#         non-schematized fields → snapshot/.md unchanged; openapi moves (version only).
#         Logic in services/matrix_export_service.build_alignment_matrix.

# 1.6.69: la surface de controle devient la surface de calcul (ALI-01 tranche 2, decision D-1).
#         /align/matrix now PROJECTS `text_norm`: `rows[i][2]`, the translation cells, the woven
#         addition rows and the cut slices all come from the plane the aligner, the FTS and the
#         curation compute on. `uncovered` items gain `text_norm` (additive; `text_raw` kept).
#         The cut offsets move with it — set_target_span validates against `length(text_norm)`
#         and `alignment_links.target_char_start/end` index that plane. They used to index
#         `text_raw` precisely because it is immutable; the invariant is now held from the other
#         end: POST /units/update_text CLEARS every cut span on the corrected unit and reports
#         `cut_spans_cleared`. Clearing one half alone would make the two complementary windows
#         OVERLAP, so the scope is the unit, not the cell. Measured before switching: 0 existing
#         span would be invalidated (the 6 cut links target units where raw == norm), so NO data
#         migration; and the 33 cells whose display changes differ by 577 non-breaking spaces,
#         236 « ¤ » (import debris the grid used to show) and 5 BOMs — the correct plane is also
#         the cleaner one. /export/matrix follows, sharing `rows` by design. Additive fields +
#         changed projection, no new route -> snapshot unchanged; openapi (version) and .md move.

# 1.6.68: fusion et scission disent ce qu'elles ont détruit (ALI-03, reliquat). POST /units/merge
#         and POST /units/split responses gain `links_archived` (integer): the alignment links the
#         gesture destroyed and archived in migration 035. The reliquat on file asked to wire
#         needsAlignmentConfirm on the merge; that would have LIED. That helper takes the
#         DOCUMENT's aligned_count, while a merge only ever touches the two units' links — on the
#         reference corpus it would announce « ce document a 5 770 liens, fusionner les effacera »
#         before destroying two, or none. An exact figure reported afterwards is both truthful and
#         cheaper than a pre-flight count query, and it is only actionable information now that
#         undo really restores the links (ALI-03, 1.6.65). Additive response fields → no new route
#         → snapshot unchanged; openapi moves (version + schemas); .md response lines added.

# 1.6.70: les gestes de lot de l'Alignement deviennent annulables (decision D-3, ALI-22 (a),
#         ALI-20, une partie d'ALI-07). NEW route POST /align/links/batch_undo -> openapi +
#         snapshot + .md bougent tous les trois. Migration 037 (align_op + align_op_link_snapshots).
#         Ni prep_action_history ni align_run_purge ne pouvaient porter cette archive : un geste de
#         lot touche N liens quelconques SANS toucher une seule unite, donc il n'existe aucune
#         action de preparation a quoi le rattacher, et il n'a pas de run_id. Troisieme proprietaire,
#         meme discipline (link_id archive -> restitution identique et non approchee).
#         Deux ecarts avec les deux archives existantes. (1) De fond : six verbes sur sept ne
#         detruisent rien, ils MUTENT une ligne qui survit ; la restitution est donc
#         UPDATE-si-present / INSERT-si-absent et non l'INSERT OR IGNORE des deux autres chemins,
#         qui laisserait la mutation en place tout en rapportant « restaure ». (2) De forme : la
#         pile est BORNEE (ALIGN_OP_KEEP = 50). Les deux autres n'ecrivent que sur une destruction,
#         qui est rare ; celle-ci ecrit a chaque geste, « accepter » compris, donc elle croitrait
#         avec l'usage normal et non avec les accidents.
#         batch_update accepte un `label` optionnel (aucun artefact : parametre optionnel sur une
#         route existante) et rend `op_id`, null quand il n'y a rien a annuler. /align/collisions/
#         resolve rend `op_id` lui aussi : c'est le HUITIEME verbe de la meme famille, que l'audit
#         n'avait pas compte parmi « les sept », et il etait muet exactement pareil.
#         UNE OPERATION PEUT S'ETENDRE SUR PLUSIEURS REQUETES. Deux gestes de la matrice sont
#         multi-requetes (coupe a cheval, rattachement au voisin) : ils appellent
#         POST /align/link/create PUIS batch_update. Une archive par requete offrirait un
#         « Annuler » qui ressusciterait le lien supprime en laissant le lien cree -- l'etat en
#         doublon d'ALI-22, sous une commande qui a l'air complete. /align/link/create et
#         /align/link/delete acceptent donc `op_id` (+ `label`) et le rendent : le premier appel
#         ouvre l'operation, les suivants la rejoignent. Params optionnels sur routes existantes
#         + champs de reponse additifs -> aucun artefact de contrat en plus.
#         Trois regles qui ne se devinent pas : (1) l'INSERT OR IGNORE sur (op_id, link_id) fait
#         gagner le PREMIER instantane d'un lien, celui d'avant le geste ; (2) l'annulation
#         SUPPRIME les creations AVANT de restituer, sinon un lien a rendre bute sur la paire
#         (pivot, target) qu'une creation de la meme operation occupe encore (migration 008) ;
#         (3) refermer une operation qu'on a seulement REJOINTE emporterait la creation qui la
#         precede -- discard_batch_op prend donc l'op_id recu et s'abstient dans ce cas.
#         QUATRE routes a un lien portent la meme mecanique : create, delete, update_status et
#         retarget. Le bouton « rattacher » a deux branches (create si la cellule est vide,
#         retarget sinon) : n'en archiver qu'une rendrait le meme geste annulable une fois sur
#         deux. Idem pour le statut, reglable par lot depuis la matrice et a l'unite depuis le
#         panneau. Hors pile : /align/cell_status, qui ecrit dans alignment_cell_status et non
#         dans alignment_links -- autre objet, autre archive si le besoin se presente.

# 1.6.71: le dernier site destructeur non journalise (ALI-10, reliquat). POST
#         /segment/apply_propagated enregistre desormais une action Mode A et archive les
#         liens qu'il detruit ; sa reponse gagne `action_id` et `links_archived`. Reponse
#         non schematisee + route existante -> snapshot inchange ; openapi (version) et .md
#         bougent. D-2 ne l'avait pas couvert parce qu'il ne passe par AUCUNE des deux
#         fonctions de resegmentation : il reconstruit le document depuis une liste
#         d'unites fournie, avec son propre DELETE.
#         Deux correctifs hors du handler, sans lesquels la journalisation aurait menti :
#         (1) _undo_resegment reinserait en unit_type='line' EN DUR -- exact tant que seule
#         la resegmentation etait journalisee (elle ne touche que des lignes), faux ici ou
#         les unites `structure` sont detruites aussi : un intertitre serait revenu converti
#         en ligne. Les actions enregistrees avant ce changement n'ont pas la cle et
#         retombent sur 'line', ce qui reste exact pour elles.
#         (2) make_resegment_recorder OMETTAIT text_source de son context_json, alors que
#         _undo_resegment l'y relit (il n'a pas de colonne _before). TOUTE annulation de
#         resegmentation rendait donc l'unite sans sa provenance d'import, silencieusement,
#         y compris sur le chemin interactif /segment -- et ce depuis avant l'extraction du
#         recorder. Le test qui semblait couvrir le cas passe par une DOUBLURE de recorder
#         qui transmet le payload verbatim ; c'est ce qui a masque le trou.

# 1.6.72: la ponctuation d'une requete ne fait plus tomber la recherche. FTS5 recevait la
#         saisie BRUTE, et une partie de la ponctuation y est de la syntaxe : « Mi - ar face
#         placere. » (roumain) rendait `no such column: ar`, FTS5 lisant `- ar` comme un
#         filtre de colonne negatif. Mesure sur le corpus de travail : 14,7 % des lignes
#         portent une sequence de ce genre (21,5 % en francais, 29,8 % en roumain) --
#         autrement dit, copier-coller une ligne du concordancier pour la retrouver echouait
#         une fois sur sept. query.sanitize_fts_query() met entre guillemets les seuls mots
#         qui contiennent de la ponctuation ASCII ; /query et /query/facets l'appliquent tous
#         deux. Aucun changement de forme de reponse -> snapshot inchange ; openapi (version)
#         et .md bougent.
#         PERIMETRE MESURE, et c'est ce qui rend la regle tenable en multilingue : sept
#         caracteres ASCII cassent (' - : . + & /) tandis que TOUS les scripts non latins
#         passent -- arabe, chinois, japonais, coreen, grec, cyrillique, hebreu, devanagari --
#         ponctuation non-ASCII comprise (« », les CJK, le maqaf hebreu, l'apostrophe courbe).
#         La regle ne connait donc aucune langue, et des tests verrouillent qu'elle ne s'y
#         mette pas. Preservees : phrases entre guillemets, `mot*`, `^mot`, NEAR(), AND/OR/NOT.
#         Deux pieges que la mesure a imposes : un token de pure ponctuation est ECARTE et
#         non quote (FTS5 accepte `"-"` mais ne le fait correspondre a rien -- le quoter
#         changerait le plantage en zero resultat silencieux) ; l'ancre et la troncature
#         restent HORS des guillemets (`^"mot"`, `"mot"*`), les enfermer dedans en ferait des
#         caracteres litteraux.
#         AUSSI : une syntaxe FTS5 reellement fautive (NEAR() vide, parenthese orpheline)
#         rendait un 500 avec pile d'appel -- une faute de frappe passait pour une panne.
#         Les deux routes rendent desormais 400 « Requete de recherche invalide ». Les deux
#         codes etaient deja declares, donc aucun schema ne bouge.

# 1.6.77: l'alignement se travaille une langue a la fois. Deux routes gagnent le meme
#         parametre optionnel `target_doc_ids` (liste d'entiers) :
#         - POST /align/matrix ne projette que ces colonnes de traduction. Omis = toutes,
#           comme avant, et comme /export/matrix qui n'expose pas le parametre. La reponse
#           gagne aussi `link_counts` (non schematisee, ∥ aux traductions projetees) :
#           effectif et part manuelle de chaque paire, rejetes compris.
#         - POST /families/{id}/align n'aligne que ces enfants. Omis = toute la famille.
#         POURQUOI. Un corpus reel se travaille par paire (VO + une traduction) : personne
#         n'aligne quatre langues d'un coup. Cote projection, chaque colonne de traduction
#         pese ~0,63 Mo de charge utile sur la famille de reference (2,21 Mo compact pour
#         fr+en/es/ro, dont 71 % de `cell_links`), et le rendu est lineaire en cellules --
#         donc afficher une langue au lieu de trois divise par deux le DOM et enleve 57 %
#         du fil, sur les 21 rechargements que declenchent les gestes (ALI-18).
#         Cote run, c'est plus grave qu'une question de cout : « Recalcul global » purgeait
#         TOUTES les paires de la famille, et `preserve_accepted` ne sauve que
#         `status='accepted'` -- un lien pose a la main (`status IS NULL`) etait donc
#         detruit en reparant une AUTRE langue (ALI-15, cas mesure en base). Le filtre est
#         pose avant le controle de segmentation et avant la boucle : une colonne hors
#         perimetre n'entre pas dans le run. Un id etranger a la famille est un 400 sur les
#         deux routes -- projeter une colonne vide la rendrait indiscernable d'une
#         traduction non alignee.
#         Aucun chemin ne bouge : deux schemas de requete gagnent une propriete optionnelle.

# 1.6.76: le Controle nomme le segment comme la matrice le nomme. `AlignLinkRecord`
#         (POST /align/audit) gagne `pivot_segment` : le rang 1-base du pivot parmi les
#         lignes de son document -- exactement la colonne « segment » de la matrice
#         (matrix_export_service, `row = [para_label, i + 1, ...]`). DERIVE, jamais
#         stocke. Additif et nullable : un sidecar anterieur ne le rend pas, le front
#         retombe sur `external_id`.
#         POURQUOI. Le badge [§N] du Controle affichait `alignment_links.external_id`,
#         qui n'est pas un numero de segment mais LA CLE QUI A APPARIE : le marqueur [N]
#         du pivot pour `external_id` et la phase 1 de `external_id_then_position`, sa
#         position `n` pour `position`, `similarity`, `length_bounded` et la phase 2 --
#         un meme run melange donc les deux. Et meme quand elle vaut `n`, `n` compte
#         toutes les unites du document, structure comprise, la ou la matrice numerote
#         les seules lignes. Deux facons de mentir qu'aucune regle d'attribution ne
#         ferme, d'ou le calcul.
#         Mesure le 2026-08-24 sur le corpus de travail (14 575 liens, 10 runs, 3
#         strategies) : 14 568 liens crees par un run portent la position du pivot, sans
#         exception ; 6 des 7 liens crees au geste portent autre chose -- [§0], le
#         marqueur, ou le numero du frere. L'ecart rang/`n` etait nul, faute de document
#         pivot a unites de structure ; il ne le restera pas.
#         AUSSI, meme version : /align/link/create ecrit desormais la position `n` du
#         pivot quand aucun `external_id` n'est fourni, au lieu du marqueur ou de 0 --
#         ce qu'ecrivent trois des cinq strategies. Le parametre `external_id` reste
#         accepte et honore (1.6.55 / D-W13), mais son objet -- trier le lien a cote de
#         sa famille -- est assure depuis ALI-23 par l'ORDER BY de /align/audit ; notre
#         front ne l'envoie plus. Aucune signature ne change de ce cote.
#         AUSSI : GET /families/{id}/curation_status (reponse NON schematisee) gagne le
#         meme `pivot_segment` sur ses items `pending` -- la liste « traductions a
#         relire » composait le meme badge a partir du meme champ, et l'ecrivait sans
#         repli (litteralement « [§null] » sur un corpus sans marqueurs).

# 1.6.75: le pivot suit le repliement des diacritiques de l'index, et la troncature de
#         locution garde son prefixe. Reliquat de 1.6.74, mesure apres coup : l'index
#         replie les diacritiques a la tokenisation (unicode61), donc « liberation »
#         y range « liberation » et `etre` TROUVE « etre ». Le pivot, lui, travaillait
#         sur le texte accentue. Mesure sur 40 lignes par requete, corpus de travail :
#         `etre` 39 pivots vides sur 40, `annee` 40/40, `francais` 36/36, `deja` 38/40,
#         `elev*` 23/40 -- 245 sur 552, soit 44,4 %. Taper sans accent n'est pas une
#         faute d'utilisateur : c'est precisement ce que le repliement autorise. La note
#         de 1.6.74 qualifiait ce cas de « residu acceptable » ; a 44 % ce n'en est pas
#         un, et cette phrase est corrigee.
#         La table de repliement est DERIVEE DU TOKENISEUR, pas de la decomposition
#         Unicode. `remove_diacritics=1` -- la valeur par defaut, celle de la migration
#         002 -- laisse passer des caracteres que NFD decompose, dont le vietnamien
#         `e-accent-circonflexe-aigu` (U+1EBF) et l'accent grec (U+03AD). Une table NFD
#         aurait donc SUR-APPARIE : pivot pose sur un mot que le moteur n'apparie pas,
#         ce qui est pire qu'un pivot vide. On demande sa table a SQLite -- index
#         unicode61 en memoire, fts5vocab en mode `instance`, qui rend le couple
#         (token, ligne) -- construite a la premiere utilisation et memoisee, 6 ms.
#         819 candidats decomposables dans 0x20-0x3000, 376 reellement replies sous
#         25 bases. Accord verifie sans divergence sur neuf langues (vietnamien, grec,
#         polonais, allemand, espagnol, tcheque, turc compris) : ni la ligature, ni le
#         `o` barre, ni le `l` barre, ni l'eszett ne sont replies -- par FTS comme par
#         nous. FTS5 absent de l'environnement = tables vides, donc comportement
#         d'avant, pas d'erreur d'import.
#         Le repliement porte sur le TERME et non sur le TEXTE : chaque caractere
#         devient sa classe de variantes, ce qui preserve les positions -- replier le
#         texte aurait decale les offsets et ruine le decoupage gauche/pivot/droite.
#         CORRIGE AUSSI la troncature de locution : FTS5 accepte `mot*` mais aussi
#         `"locution"*`, ou l'asterisque prefixe le dernier token. La seconde ressort du
#         balayage en DEUX jetons, et ne pas la reconnaitre perdait la troncature --
#         `liber.*`, assaini en `"liber."*`, donnait un motif exact et 40 pivots vides
#         sur 40. Le mode segment portait le meme trou : `etre` ne surlignait rien.
#         Aucune signature ne change.
#
# 1.6.74: le pivot KWIC retrouve ce que FTS a apparie, et non une chaine litterale.
#         `POST /query` en mode kwic rend (left, match, right). Le pivot etait cherche en
#         decoupant la requete ASSAINIE sur l'espace : il cherchait donc `dit-il` dans un
#         texte qui porte `dit - il`, `libr\*` avec son asterisque, et prenait `AND`, `OR`,
#         `NEAR(` et la distance pour des termes. Mesure sur 25 lignes trouvees par requete :
#         `dit-il` 25 pivots vides sur 25, `peut-etre` 25/25, `c'est-a-dire` 18/18, `libr*`
#         25/25, `NEAR(homme monde, 10)` 3/3 ; `homme AND monde` centrait sur « and » et
#         `homme OR femme` sur le « or » francais. Seul le mot simple marchait -- soit
#         TOUTES les capacites avancees de la recherche sans centre de concordance.
#         Un pivot vide n'etait pas une colonne blanche : la fonction retournait
#         (texte, "", ""), l'unite ENTIERE dans la colonne gauche. Le corpus de travail
#         porte 12 documents stockes en une seule unite, dont un de 110 786 caracteres.
#         Regle retenue : un terme est une SUITE ORDONNEE DE MOTS separes par du non-mot
#         (dit\W+il), ce qui est la semantique meme d'une phrase FTS5, dont les tokens
#         doivent etre adjacents. Le pivot couvre donc la locution entiere -- `dit - il` --
#         ce qu'une concordance doit montrer. Un prefixe reste un prefixe (libr\w*).
#         Effet de bord gratuit : l'apostrophe courbe cesse d'etre un cas a part, `’`
#         n'etant qu'un separateur de plus (13 pivots vides sur 50 pour `l'homme` et
#         `aujourd'hui`, tombes a 0).
#         CORRIGE AUSSI le mode segment, par le meme mecanisme : `\w+` sur « l'homme »
#         produit l'article elide comme terme d'UNE LETTRE, et sans borne de mot
#         l'alternance (l|homme) surlignait TOUS les `l` du texte. L'elision est partout
#         en francais (l', d', qu', n', s'). Le surlignage marque desormais la locution.
#         CORRIGE ENFIN une disparition d'unite : `_all_kwic_windows` rendait une liste
#         VIDE quand rien n'etait retrouve, et le constructeur de hits itere dessus --
#         zero occurrence, zero hit, alors que FTS avait appariee la ligne et que le total
#         la comptait. La variante regex avait ce repli, la variante FTS ne l'avait pas.
#         Le repli est desormais BORNE des deux cotes, et par DEUX bornes : la largeur de
#         contexte demandee et 500 caracteres. La seconde n'est pas redondante -- compter
#         les tokens ne borne rien sur une ecriture sans espaces, ou `\S+` rend un seul
#         token : le meme repli valait 47 caracteres en latin et 80 000 en chinois. Sur les
#         46 648 unites du corpus de travail, la mediane est a 56 caracteres et 0,20 %
#         depassent 500. La branche « requete sans aucun mot » est bornee de meme.
#         CONSEQUENCE FRONT : le pivot pouvant desormais couvrir une locution, la mise en
#         page KWIC de tauri-app le laisse se couper (white-space: nowrap la faisait
#         deborder des 100 caracteres, mesure en mode « Expression exacte »).
#         Aucune signature ne change : `match` cesse simplement d'etre vide.
#
# 1.6.73: la virgule, la parenthese et le mode « proximite ». CORRIGE UNE MESURE FAUSSE de
#         1.6.72 : « sept caracteres ASCII cassent » avait ete mesure sur des tokens
#         decoupes a l'espace, ce qui excluait par construction `,` `(` `)` -- justement les
#         delimiteurs du balayage. Mesure refaite sur des requetes entieres : 47,9 % des
#         lignes du corpus portent une virgule, 48,3 % une virgule ou une parenthese. Coller
#         une ligne du concordancier echouait donc une fois sur DEUX, et non une sur sept.
#         Ces trois caracteres sont ambigus : syntaxe FTS5 et prose a la fois. Deux regles
#         les departagent, sans rien parser. Une VIRGULE n'est syntaxe que dans un NEAR(...),
#         et seulement celle qui porte la distance. Une PARENTHESE ne l'est que si la requete
#         porte un operateur -- FTS5 ne les accepte qu'en CAPITALES, ce qui suffit a separer
#         `(chat OR chien)` d'une parenthese de prose. Personne n'y perd : `(chat)` levait une
#         erreur et rend desormais une recherche litterale.
#         AUSSI, trouve en passe adverse : le front fabrique lui-meme des requetes FTS
#         (tauri-app/src/features/search.ts). Son mode « proximite » construit
#         NEAR(<mots colles a l'espace>, N) sans rien assainir -- donc NEAR(peut-etre bien, 2)
#         ou NEAR(l'homme libre, 2), que FTS5 refuse. Traiter un NEAR(...) en bloc OPAQUE
#         maintenait ce mode casse sur deux des mots francais les plus courants. La regle
#         retenue separe la STRUCTURE du groupe (parentheses, virgule de distance : preservees
#         a l'octet pres) de ses TERMES (assainis comme partout ailleurs). Le front n'a pas eu
#         a changer, et tout autre client en profite.
#         `near` en minuscules redevient un MOT : FTS5 n'accepte ses operateurs qu'en
#         capitales, et les reconnaitre sans tenir compte de la casse faisait tomber
#         « near(the door) » -- le defaut meme qu'on ferme.
#         PRESERVE A DESSEIN : une forme non reconnue (NEAR() vide, NEAR(a (b), 3)) reste une
#         erreur -> 400 lisible. C'est pourquoi on n'a PAS pris la voie du repli-apres-echec,
#         qui aurait fait passer toute syntaxe mal ecrite pour une recherche litterale.
#         Aucun changement de forme de reponse -> snapshot inchange ; openapi (version) et .md.
#         ENFIN, defaut ANTERIEUR trouve dans la meme passe : les operateurs etaient
#         surlignes comme des termes dans les hits. Invisible en francais, criant en anglais
#         -- « cat AND dog » marquait chaque « and » du segment, « NEAR(cat dog, 3) » marquait
#         « near » ET le chiffre 3 partout ou il apparaissait. Le groupe NEAR est desormais
#         reduit a ses termes, sa distance ecartee, les booleens retires -- en CAPITALES
#         uniquement, donc chercher le MOT « or » le surligne toujours. Le CONTENU des
#         marqueurs << >> change sur ces requetes ; la forme de la reponse, non.

# Error code catalog (stable machine-readable values).
ERR_BAD_REQUEST = "BAD_REQUEST"
ERR_NOT_FOUND = "NOT_FOUND"
ERR_VALIDATION = "VALIDATION_ERROR"
ERR_UNAUTHORIZED = "UNAUTHORIZED"
ERR_FORBIDDEN = "FORBIDDEN"
ERR_CONFLICT = "CONFLICT"
ERR_INTERNAL = "INTERNAL_ERROR"


def success_payload(data: dict[str, Any] | None = None, *, status: str = "ok") -> dict[str, Any]:
    """Build a successful sidecar response payload."""
    payload: dict[str, Any] = {
        "ok": True,
        "api_version": API_VERSION,
        "version": API_VERSION,
        "status": status,
    }
    if data:
        payload.update(data)
    return payload


def error_payload(
    message: str,
    *,
    code: str = ERR_INTERNAL,
    details: Any | None = None,
) -> dict[str, Any]:
    """Build a standardized sidecar error payload."""
    err_obj: dict[str, Any] = {
        "type": code,
        "message": message,
    }
    if details is not None:
        err_obj["details"] = details

    payload: dict[str, Any] = {
        "ok": False,
        "api_version": API_VERSION,
        "version": API_VERSION,
        "status": "error",
        "error": err_obj,
        "error_message": message,
        "error_code": code,
    }
    if details is not None:
        payload["error_details"] = details
    return payload


def openapi_spec() -> dict[str, Any]:
    """Return the stable OpenAPI spec for the sidecar HTTP API."""
    return {
        "openapi": "3.0.3",
        "info": {
            "title": "multicorpus_engine sidecar API",
            "version": API_VERSION,
            "x-contract-version": CONTRACT_VERSION,
            "description": "Localhost HTTP API for persistent corpus operations (query/index/import/etc.).",
        },
        "servers": [{"url": "http://127.0.0.1:8765"}],
        "paths": {
            "/health": {
                "get": {
                    "summary": "Health check",
                    "responses": {
                        "200": {
                            "description": "Server is healthy",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/HealthResponse"},
                                }
                            },
                        }
                    },
                }
            },
            "/openapi.json": {
                "get": {
                    "summary": "OpenAPI contract",
                    "responses": {
                        "200": {
                            "description": "OpenAPI specification document",
                            "content": {
                                "application/json": {
                                    "schema": {"type": "object"},
                                }
                            },
                        }
                    },
                }
            },
            "/query": {
                "post": {
                    "summary": "Run query",
                    "requestBody": {
                        "required": True,
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/QueryRequest"},
                            }
                        },
                    },
                    "responses": {
                        "200": {
                            "description": "Query result",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/QueryResponse"},
                                }
                            },
                        },
                        "400": {
                            "description": "Bad request",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                        "500": {
                            "description": "Internal error",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                    },
                }
            },
            "/token_query": {
                "post": {
                    "summary": "Run token-level CQL query",
                    "requestBody": {
                        "required": True,
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/TokenQueryRequest"},
                            }
                        },
                    },
                    "responses": {
                        "200": {
                            "description": "Token query result",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/TokenQueryResponse"},
                                }
                            },
                        },
                        "400": {
                            "description": "Bad request",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                        "500": {
                            "description": "Internal error",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                    },
                }
            },
            "/token_collocates": {
                "post": {
                    "summary": "Collocation analysis for a CQL query (PMI + log-likelihood)",
                    "requestBody": {
                        "required": True,
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/TokenCollocatesRequest"},
                            }
                        },
                    },
                    "responses": {
                        "200": {
                            "description": "Ranked collocates with association scores",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/TokenCollocatesResponse"},
                                }
                            },
                        },
                        "400": {
                            "description": "Bad request (invalid CQL or parameters)",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                    },
                }
            },
            "/token_stats": {
                "post": {
                    "summary": "Token attribute frequency distribution over CQL hits",
                    "requestBody": {
                        "required": True,
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/TokenStatsRequest"},
                            }
                        },
                    },
                    "responses": {
                        "200": {
                            "description": "Frequency distribution result",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/TokenStatsResponse"},
                                }
                            },
                        },
                        "400": {
                            "description": "Bad request (invalid CQL or group_by)",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                    },
                }
            },
            "/index": {
                "post": {
                    "summary": "Rebuild FTS index",
                    "requestBody": {
                        "required": False,
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/IndexRequest"},
                            }
                        },
                    },
                    "responses": {
                        "200": {
                            "description": "Index rebuilt",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/IndexResponse"},
                                }
                            },
                        },
                        "401": {
                            "description": "Unauthorized (missing/invalid token)",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                        "500": {
                            "description": "Internal error",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                    },
                }
            },
            "/import": {
                "post": {
                    "summary": "Import a document into corpus DB",
                    "requestBody": {
                        "required": True,
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/ImportRequest"},
                            }
                        },
                    },
                    "responses": {
                        "200": {
                            "description": "Import result",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ImportResponse"},
                                }
                            },
                        },
                        "400": {
                            "description": "Bad request",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                        "401": {
                            "description": "Unauthorized (missing/invalid token)",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                        "500": {
                            "description": "Internal error",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                    },
                }
            },
            "/import/preview": {
                "post": {
                    "summary": "Read-only parse preview of a file (no DB write)",
                    "requestBody": {
                        "required": True,
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "required": ["path", "mode"],
                                    "properties": {
                                        "path": {"type": "string"},
                                        "mode": {"type": "string"},
                                        "limit": {"type": "integer", "default": 100},
                                        "column_index": {
                                            "type": "integer",
                                            "minimum": 1,
                                            "nullable": True,
                                        },
                                    },
                                }
                            }
                        },
                    },
                    "responses": {
                        "200": {
                            "description": "Preview result",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "ok": {"type": "boolean"},
                                            "mode": {"type": "string"},
                                            "conllu_stats": {
                                                "nullable": True,
                                                "type": "object",
                                                "properties": {
                                                    "sentences": {"type": "integer"},
                                                    "tokens": {"type": "integer"},
                                                    "skipped_ranges": {"type": "integer"},
                                                    "skipped_empty_nodes": {"type": "integer"},
                                                    "malformed_lines": {"type": "integer"},
                                                    "sample_rows": {"type": "array", "items": {"type": "object"}},
                                                    "not_utf8": {"type": "boolean", "description": "IMP-03: file is not UTF-8 (lenient preview decoded it as latin-1); the strict import will reject it."},
                                                },
                                            },
                                            "units": {
                                                "type": "array",
                                                "nullable": True,
                                                "items": {"type": "object"},
                                                "description": "Text modes: the first `limit` units the import would write.",
                                            },
                                            "units_total": {"type": "integer", "nullable": True},
                                            "units_line": {
                                                "type": "integer",
                                                "nullable": True,
                                                "description": "IMPO-01: units the import would index (unit_type='line'), counted over ALL units — the only measure that separates two modes yielding the same total.",
                                            },
                                            "units_structure": {"type": "integer", "nullable": True},
                                            "truncated": {"type": "boolean", "nullable": True},
                                            "tables": {
                                                "type": "array",
                                                "nullable": True,
                                                "items": {
                                                    "type": "object",
                                                    "properties": {
                                                        "columns": {"type": "integer"},
                                                        "rows": {"type": "integer"},
                                                    },
                                                },
                                                "description": "IMPO-01: shape of the document's top-level tables, in reading order — what the file CONTAINS, before asking it for a column. DOCX modes only; null elsewhere. Carrying a table does not make a document a bitext: the screen shows the shape, the user decides.",
                                            },
                                        },
                                    }
                                }
                            },
                        },
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "404": {"description": "File not found", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "500": {"description": "Internal error", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/curate": {
                "post": {
                    "summary": "Apply curation rules",
                    "requestBody": {
                        "required": True,
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/CurateRequest"},
                            }
                        },
                    },
                    "responses": {
                        "200": {
                            "description": "Curation applied",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/CurateResponse"},
                                }
                            },
                        },
                        "400": {
                            "description": "Bad request",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                        "500": {
                            "description": "Internal error",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                    },
                }
            },
            "/validate-meta": {
                "post": {
                    "summary": "Validate metadata",
                    "requestBody": {
                        "required": False,
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/ValidateMetaRequest"},
                            }
                        },
                    },
                    "responses": {
                        "200": {
                            "description": "Validation report",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ValidateMetaResponse"},
                                }
                            },
                        },
                        "500": {
                            "description": "Internal error",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                    },
                }
            },
            "/annotate": {
                "post": {
                    "summary": "Enqueue automatic annotation job(s) with spaCy",
                    "security": [{"token": []}],
                    "requestBody": {
                        "required": True,
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/AnnotateRequest"},
                            }
                        },
                    },
                    "responses": {
                        "202": {
                            "description": "Annotation job accepted",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/JobAcceptedResponse"},
                                }
                            },
                        },
                        "400": {
                            "description": "Bad request",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                        "401": {
                            "description": "Unauthorized",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                    },
                }
            },
            "/segment/preview": {
                "post": {
                    "summary": "Preview segmentation in-memory (no DB writes)",
                    "requestBody": {
                        "required": True,
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/SegmentPreviewRequest"},
                            }
                        },
                    },
                    "responses": {
                        "200": {
                            "description": "Preview result with segments list",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/SegmentPreviewResponse"},
                                }
                            },
                        },
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "404": {"description": "Document not found", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/segment/detect_markers": {
                "post": {
                    "summary": "Detect [N] markers in existing units (read-only)",
                    "requestBody": {
                        "required": True,
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/SegmentDetectMarkersRequest"},
                            }
                        },
                    },
                    "responses": {
                        "200": {
                            "description": "Marker detection report",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/SegmentDetectMarkersResponse"},
                                }
                            },
                        },
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "404": {"description": "Document not found", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/segment/structure_sections": {
                "post": {
                    "summary": "Return structure section lists for two documents",
                    "requestBody": {
                        "required": True,
                        "content": {"application/json": {"schema": {"type": "object", "properties": {
                            "doc_id": {"type": "integer"},
                            "reference_doc_id": {"type": "integer"},
                        }, "required": ["doc_id", "reference_doc_id"]}}},
                    },
                    "responses": {
                        "200": {"description": "Ref and target section lists"},
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/segment/structure_diff": {
                "post": {
                    "summary": "Compare structure units between two documents",
                    "requestBody": {
                        "required": True,
                        "content": {"application/json": {"schema": {"type": "object", "properties": {
                            "doc_id": {"type": "integer"},
                            "reference_doc_id": {"type": "integer"},
                        }, "required": ["doc_id", "reference_doc_id"]}}},
                    },
                    "responses": {
                        "200": {"description": "Structure diff with matched/missing/extra sections"},
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/segment/propagate_preview": {
                "post": {
                    "summary": "Section-aware segmentation preview (no DB writes)",
                    "requestBody": {
                        "required": True,
                        "content": {"application/json": {"schema": {"type": "object", "properties": {
                            "doc_id": {"type": "integer"},
                            "reference_doc_id": {"type": "integer"},
                            "lang": {"type": "string"},
                            "pack": {"type": "string"},
                            "section_mapping": {"type": "array", "items": {"type": "array", "items": {"type": "integer"}}},
                        }, "required": ["doc_id", "reference_doc_id"]}}},
                    },
                    "responses": {
                        "200": {"description": "Propagated segmentation preview with per-section results"},
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/segment/zone_lines": {
                "post": {
                    "summary": "Return raw line units in a zone bounded by n values",
                    "requestBody": {
                        "required": True,
                        "content": {"application/json": {"schema": {"type": "object", "properties": {
                            "doc_id": {"type": "integer"},
                            "from_n": {"type": "integer"},
                            "to_n": {"type": "integer"},
                        }, "required": ["doc_id"]}}},
                    },
                    "responses": {
                        "200": {"description": "List of line units in the zone"},
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/segment/insert_structure_unit": {
                "post": {
                    "summary": "Insert a structure unit before a given n (token required)",
                    "requestBody": {
                        "required": True,
                        "content": {"application/json": {"schema": {"type": "object", "properties": {
                            "doc_id": {"type": "integer"},
                            "before_n": {"type": "integer"},
                            "text": {"type": "string"},
                            "role": {"type": "string"},
                        }, "required": ["doc_id", "before_n", "text"]}}},
                    },
                    "responses": {
                        "200": {"description": "Inserted unit info"},
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "404": {"description": "Document not found", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/segment/apply_propagated": {
                "post": {
                    "summary": "Write pre-computed propagated segmentation to DB (token required)",
                    "requestBody": {
                        "required": True,
                        "content": {"application/json": {"schema": {"type": "object", "properties": {
                            "doc_id": {"type": "integer"},
                            "units": {"type": "array", "items": {"type": "object", "properties": {
                                "type": {"type": "string", "enum": ["line", "structure"]},
                                "text": {"type": "string"},
                                "role": {"type": "string"},
                            }, "required": ["type", "text"]}},
                        }, "required": ["doc_id", "units"]}}},
                    },
                    "responses": {
                        "200": {"description": "Units written count"},
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "404": {"description": "Document not found", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/units/merge": {
                "post": {
                    "summary": "Merge two adjacent units into one",
                    "requestBody": {
                        "required": True,
                        "content": {"application/json": {"schema": {"$ref": "#/components/schemas/UnitsMergeRequest"}}},
                    },
                    "responses": {
                        "200": {"description": "Merged unit info", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/UnitsMergeResponse"}}}},
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "404": {"description": "Unit not found", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/units/split": {
                "post": {
                    "summary": "Split one unit into two",
                    "requestBody": {
                        "required": True,
                        "content": {"application/json": {"schema": {"$ref": "#/components/schemas/UnitsSplitRequest"}}},
                    },
                    "responses": {
                        "200": {"description": "Split result", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/UnitsSplitResponse"}}}},
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "404": {"description": "Unit not found", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/prep/undo/eligibility": {
                "post": {
                    "summary": "Check whether the latest undo-able action of a doc can be reverted (Mode A)",
                    "requestBody": {
                        "required": True,
                        "content": {"application/json": {"schema": {"type": "object", "properties": {
                            "doc_id": {"type": "integer"},
                        }, "required": ["doc_id"]}}},
                    },
                    "responses": {
                        "200": {"description": "Eligibility payload", "content": {"application/json": {"schema": {"type": "object", "properties": {
                            "eligible":     {"type": "boolean"},
                            "reason":       {"type": "string", "description": "no_action | no_snapshots | structural_dependency | unit_diverged | latest_already_reverted"},
                            "action_id":    {"type": "integer"},
                            "action_type":  {"type": "string", "description": "curation_apply | merge_units | split_unit | resegment"},
                            "description": {"type": "string"},
                            "performed_at": {"type": "string"},
                            "warnings":     {"type": "array", "items": {"type": "string"}},
                        }}}}},
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/prep/undo": {
                "post": {
                    "summary": "Atomically revert the latest undo-able action of a doc (Mode A, token required)",
                    "requestBody": {
                        "required": True,
                        "content": {"application/json": {"schema": {"type": "object", "properties": {
                            "doc_id": {"type": "integer"},
                        }, "required": ["doc_id"]}}},
                    },
                    "responses": {
                        "200": {"description": "Undo outcome", "content": {"application/json": {"schema": {"type": "object", "properties": {
                            "undo_action_id":       {"type": "integer"},
                            "reverted_action_id":   {"type": "integer"},
                            "reverted_action_type": {"type": "string"},
                            "units_restored":       {"type": "integer"},
                            "alignments_reflagged": {"type": "integer"},
                            "alignments_restored": {"type": "integer", "description": "alignment links put back from the action archive (migration 035)"},
                            "alignments_restore_skipped": {"type": "integer", "description": "archived links whose (pivot,target) pair was re-occupied since — left alone, newer work is not clobbered"},
                            "fts_stale":            {"type": "boolean"},
                        }}}}},
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "409": {"description": "Undo not eligible at execution time", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/units/set_role": {
                "post": {
                    "summary": "Assign a convention role to a unit (token required)",
                    "requestBody": {
                        "required": True,
                        "content": {"application/json": {"schema": {"type": "object", "properties": {
                            "doc_id": {"type": "integer"}, "unit_n": {"type": "integer"},
                            "role": {"type": "string", "description": "Role name, or null to clear"},
                        }, "required": ["doc_id", "unit_n"]}}},
                    },
                    "responses": {
                        "200": {"description": "Role assigned", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/OkResponse"}}}},
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "404": {"description": "Unit or role not found", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/units/bulk_set_role": {
                "post": {
                    "summary": "Assign a convention role to multiple units at once (token required)",
                    "requestBody": {
                        "required": True,
                        "content": {"application/json": {"schema": {"type": "object", "properties": {
                            "doc_id": {"type": "integer"},
                            "unit_ns": {"type": "array", "items": {"type": "integer"}},
                            "role": {"type": "string", "description": "Role name, or null to clear"},
                        }, "required": ["doc_id", "unit_ns"]}}},
                    },
                    "responses": {
                        "200": {"description": "Roles assigned", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/OkResponse"}}}},
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "404": {"description": "Role not found", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/units/set_status": {
                "post": {
                    "summary": "Set the translation status of a unit (token required)",
                    "requestBody": {
                        "required": True,
                        "content": {"application/json": {"schema": {"type": "object", "properties": {
                            "doc_id": {"type": "integer"}, "unit_n": {"type": "integer"},
                            "status": {"type": "string", "enum": ["non_traduit", "ajout"], "nullable": True,
                                       "description": "Translation status, or null to clear"},
                        }, "required": ["doc_id", "unit_n"]}}},
                    },
                    "responses": {
                        "200": {"description": "Status set", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/OkResponse"}}}},
                        "400": {"description": "Bad request (unknown status value)", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "404": {"description": "Unit not found", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/units/bulk_set_status": {
                "post": {
                    "summary": "Set the translation status of multiple units at once (token required)",
                    "requestBody": {
                        "required": True,
                        "content": {"application/json": {"schema": {"type": "object", "properties": {
                            "doc_id": {"type": "integer"},
                            "unit_ns": {"type": "array", "items": {"type": "integer"}},
                            "unit_ids": {"type": "array", "items": {"type": "integer"},
                                         "description": "Alternative to doc_id+unit_ns: units by primary key"},
                            "status": {"type": "string", "enum": ["non_traduit", "ajout"], "nullable": True,
                                       "description": "Translation status, or null to clear"},
                        }}}},
                    },
                    "responses": {
                        "200": {"description": "Statuses set", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/OkResponse"}}}},
                        "400": {"description": "Bad request (unknown status value)", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/lift/markers": {
                "post": {
                    "summary": "Lift inline peritext markers of a document into unit_role/unit_status (token required)",
                    "requestBody": {
                        "required": True,
                        "content": {"application/json": {"schema": {"type": "object", "properties": {
                            "doc_id": {"type": "integer"},
                            "dry_run": {"type": "boolean", "default": True,
                                        "description": "Report changes without writing (default true)"},
                        }, "required": ["doc_id"]}}},
                    },
                    "responses": {
                        "200": {"description": "Lift report (dry-run or applied)", "content": {"application/json": {"schema": {"type": "object", "properties": {
                            "doc_id": {"type": "integer"}, "dry_run": {"type": "boolean"},
                            "units_scanned": {"type": "integer"}, "units_affected": {"type": "integer"},
                            "roles_set": {"type": "integer"}, "statuses_set": {"type": "integer"}, "cleaned": {"type": "integer"},
                            "roles_created": {"type": "array", "items": {"type": "string"}},
                            "conflicts": {"type": "array", "items": {"type": "object"}},
                            "changes": {"type": "array", "items": {"type": "object"}},
                        }}}}},
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/units/update_text": {
                "post": {
                    "summary": "Update text_raw and/or text_norm for one unit (token required)",
                    "requestBody": {
                        "required": True,
                        "content": {"application/json": {"schema": {"type": "object", "properties": {
                            "unit_id": {"type": "integer"},
                            "text_raw": {"type": "string", "description": "New raw text (if omitted, unchanged)"},
                            "text_norm": {"type": "string", "description": "New normalised text (if omitted, mirrored from text_raw)"},
                        }, "required": ["unit_id"]}}},
                    },
                    "responses": {
                        "200": {"description": "Unit updated", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/OkResponse"}}}},
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "404": {"description": "Unit not found", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/tags": {
                "get": {
                    "summary": "List document tags (R6.2); ?doc_id=N → that document's tags, else distinct (kind,value) across the corpus",
                    "responses": {"200": {"description": "Tags",
                        "content": {"application/json": {"schema": {"$ref": "#/components/schemas/OkResponse"}}}}},
                },
            },
            "/documents/tags/add": {
                "post": {
                    "summary": "Attach a (kind,value) tag to a document (token required, idempotent)",
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"type": "object",
                        "properties": {"doc_id": {"type": "integer"}, "kind": {"type": "string"}, "value": {"type": "string"}},
                        "required": ["doc_id", "kind", "value"]}}}},
                    "responses": {
                        "200": {"description": "Tag added", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/OkResponse"}}}},
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "404": {"description": "Document not found", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                },
            },
            "/documents/tags/remove": {
                "post": {
                    "summary": "Remove a (kind,value) tag from a document (token required)",
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"type": "object",
                        "properties": {"doc_id": {"type": "integer"}, "kind": {"type": "string"}, "value": {"type": "string"}},
                        "required": ["doc_id", "kind", "value"]}}}},
                    "responses": {
                        "200": {"description": "Tag removed", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/OkResponse"}}}},
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                },
            },
            "/conventions": {
                "get": {
                    "summary": "List all convention roles defined for this corpus",
                    "responses": {
                        "200": {"description": "List of roles", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/OkResponse"}}}},
                    },
                },
                "post": {
                    "summary": "Create a new convention role (token required)",
                    "requestBody": {
                        "required": True,
                        "content": {"application/json": {"schema": {"type": "object", "properties": {
                            "name": {"type": "string"}, "label": {"type": "string"},
                            "color": {"type": "string"}, "icon": {"type": "string"},
                            "sort_order": {"type": "integer"},
                        }, "required": ["name", "label"]}}},
                    },
                    "responses": {
                        "201": {"description": "Role created", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/OkResponse"}}}},
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "409": {"description": "Name already exists", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                },
            },
            "/conventions/{name}": {
                "put": {
                    "summary": "Update a convention role (token required)",
                    "parameters": [{"in": "path", "name": "name", "required": True, "schema": {"type": "string"}}],
                    "requestBody": {
                        "required": True,
                        "content": {"application/json": {"schema": {"type": "object", "properties": {
                            "label": {"type": "string"}, "color": {"type": "string"},
                            "icon": {"type": "string"}, "sort_order": {"type": "integer"},
                        }}}},
                    },
                    "responses": {
                        "200": {"description": "Role updated", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/OkResponse"}}}},
                        "400": {"description": "No fields to update", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "404": {"description": "Role not found", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/conventions/delete": {
                "post": {
                    "summary": "Delete a convention role; assigned units become NULL (token required)",
                    "requestBody": {
                        "required": True,
                        "content": {"application/json": {"schema": {"type": "object", "properties": {
                            "name": {"type": "string"},
                        }, "required": ["name"]}}},
                    },
                    "responses": {
                        "200": {"description": "Role deleted", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/OkResponse"}}}},
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "404": {"description": "Role not found", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/documents/set_text_start": {
                "post": {
                    "summary": "Set the paratextual boundary (text_start_n) for a document (token required)",
                    "requestBody": {
                        "required": True,
                        "content": {"application/json": {"schema": {"type": "object", "properties": {
                            "doc_id": {"type": "integer"},
                            "text_start_n": {"type": "integer", "nullable": True,
                                            "description": "1-based unit n where real text begins; null to clear"},
                        }, "required": ["doc_id"]}}},
                    },
                    "responses": {
                        "200": {"description": "text_start_n updated", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/OkResponse"}}}},
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "404": {"description": "Document not found", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/segment/coarse": {
                "post": {
                    "summary": "Ascendant coarse regrouping (R5.4c) — non-destructive parent_n relabel",
                    "requestBody": {
                        "required": True,
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/SegmentCoarseRequest"},
                            }
                        },
                    },
                    "responses": {
                        "200": {
                            "description": "Coarse regrouping report",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/SegmentCoarseResponse"},
                                }
                            },
                        },
                        "400": {
                            "description": "Bad request",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                    },
                }
            },
            "/segment/paragraph_boundary": {
                "post": {
                    "summary": "Toggle a manual paragraph boundary (R6) — non-destructive parent_n relabel, undoable",
                    "requestBody": {
                        "required": True,
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/SegmentParagraphBoundaryRequest"},
                            }
                        },
                    },
                    "responses": {
                        "200": {
                            "description": "Paragraph boundary toggle report",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/SegmentParagraphBoundaryResponse"},
                                }
                            },
                        },
                        "400": {
                            "description": "Bad request",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                    },
                }
            },
            "/segment": {
                "post": {
                    "summary": "Resegment document",
                    "requestBody": {
                        "required": True,
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/SegmentRequest"},
                            }
                        },
                    },
                    "responses": {
                        "200": {
                            "description": "Segmentation report",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/SegmentResponse"},
                                }
                            },
                        },
                        "400": {
                            "description": "Bad request",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                        "500": {
                            "description": "Internal error",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                    },
                }
            },
            "/curate/preview": {
                "post": {
                    "summary": "Preview curation rules without writing to DB (dry-run)",
                    "requestBody": {
                        "required": True,
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/CuratePreviewRequest"},
                            }
                        },
                    },
                    "responses": {
                        "200": {
                            "description": "Preview result with stats and examples",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/CuratePreviewResponse"},
                                }
                            },
                        },
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "500": {"description": "Internal error", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/align/matrix": {
                "post": {
                    "summary": "Source-anchored multilingual alignment matrix as JSON (read-only projection)",
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/AlignMatrixRequest"}}}},
                    "responses": {
                        "200": {"description": "Matrix (headers, rows, languages, hub_doc_id)"},
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "404": {"description": "Family root not found", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/align/audit": {
                "post": {
                    "summary": "Paginated read-only audit of alignment links for a pivot/target pair",
                    "requestBody": {
                        "required": True,
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/AlignAuditRequest"},
                            }
                        },
                    },
                    "responses": {
                        "200": {
                            "description": "Alignment link audit page",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/AlignAuditResponse"},
                                }
                            },
                        },
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "500": {"description": "Internal error", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/align/run/undo": {
                "post": {
                    "summary": "Revert one alignment run — drop what it created, restore what it purged (ALI-17)",
                    "requestBody": {
                        "required": True,
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/AlignRunUndoRequest"},
                            }
                        },
                    },
                    "responses": {
                        "200": {
                            "description": "Revert report",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/AlignRunUndoResponse"},
                                }
                            },
                        },
                        "400": {"description": "Bad request / nothing to revert", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "404": {"description": "Unknown run", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "409": {"description": "Superseded by a later run", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/align/links/batch_undo": {
                "post": {
                    "summary": "Undo one archived batch gesture on alignment links (D-3)",
                    "requestBody": {
                        "required": True,
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/AlignBatchUndoRequest"},
                            }
                        },
                    },
                    "responses": {
                        "200": {
                            "description": "Undo report",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/AlignBatchUndoResponse"},
                                }
                            },
                        },
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "404": {"description": "Unknown op_id: already undone, or aged out of the bounded stack", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "409": {"description": "A later gesture touches the same links", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/align/quality": {
                "post": {
                    "summary": "Read-only alignment quality metrics for a pivot/target pair",
                    "requestBody": {
                        "required": True,
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/AlignQualityRequest"},
                            }
                        },
                    },
                    "responses": {
                        "200": {
                            "description": "Alignment quality report",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/AlignQualityResponse"},
                                }
                            },
                        },
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "500": {"description": "Internal error", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/documents": {
                "get": {
                    "summary": "List all documents in corpus",
                    "responses": {
                        "200": {
                            "description": "Document list",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/DocumentsResponse"},
                                }
                            },
                        },
                        "500": {
                            "description": "Internal error",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                    },
                }
            },
            "/documents/preview": {
                "get": {
                    "summary": "Get mini content preview for one document",
                    "parameters": [
                        {
                            "name": "doc_id",
                            "in": "query",
                            "required": True,
                            "schema": {"type": "integer"},
                            "description": "Document identifier",
                        },
                        {
                            "name": "limit",
                            "in": "query",
                            "required": False,
                            "schema": {"type": "integer", "minimum": 1, "maximum": 5000, "default": 6},
                            "description": "Maximum number of preview lines (aligned on v0.1.40 preview cap convention)",
                        },
                    ],
                    "responses": {
                        "200": {
                            "description": "Document preview",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/DocumentPreviewResponse"},
                                }
                            },
                        },
                        "400": {
                            "description": "Bad request",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                        "404": {
                            "description": "Document not found",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                        "500": {
                            "description": "Internal error",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                    },
                }
            },
            "/documents/stats": {
                "get": {
                    "summary": "Per-document stage stats for the canvas state strip",
                    "parameters": [
                        {
                            "name": "doc_id",
                            "in": "query",
                            "required": True,
                            "schema": {"type": "integer"},
                            "description": "Document identifier",
                        },
                    ],
                    "responses": {
                        "200": {
                            "description": "Document stage stats",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "ok": {"type": "boolean"},
                                            "doc_id": {"type": "integer"},
                                            "line_count": {"type": "integer"},
                                            "structure_count": {"type": "integer"},
                                            "external_id_count": {"type": "integer"},
                                            "parent_count": {"type": "integer"},
                                            "aligned_count": {"type": "integer"},
                                            "max_text_len": {"type": "integer"},
                                            "avg_text_len": {"type": "integer"},
                                        },
                                    },
                                }
                            },
                        },
                        "400": {
                            "description": "Bad request",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                        "404": {
                            "description": "Document not found",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                        "500": {
                            "description": "Internal error",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                    },
                }
            },
            "/units": {
                "get": {
                    "summary": "List units for a document with their role",
                    "parameters": [
                        {
                            "name": "doc_id",
                            "in": "query",
                            "required": True,
                            "schema": {"type": "integer"},
                            "description": "Document identifier",
                        },
                        {
                            "name": "unit_type",
                            "in": "query",
                            "required": False,
                            "schema": {"type": "string"},
                            "description": "Optional unit type filter (e.g. 'line')",
                        },
                    ],
                    "responses": {
                        "200": {
                            "description": "Unit list",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "ok": {"type": "boolean"},
                                            "doc_id": {"type": "integer"},
                                            "units": {
                                                "type": "array",
                                                "items": {
                                                    "type": "object",
                                                    "properties": {
                                                        "unit_id": {"type": "integer"},
                                                        "n": {"type": "integer"},
                                                        "text_norm": {"type": "string", "nullable": True},
                                                        "unit_type": {"type": "string"},
                                                        "unit_role": {"type": "string", "nullable": True},
                                                        "unit_status": {"type": "string", "enum": ["non_traduit", "ajout"], "nullable": True, "description": "Translation status axis (R4.1), orthogonal to unit_role; null = normal/translated"},
                                                        "text_raw": {"type": "string", "nullable": True},
                                                        "text_source": {"type": "string", "nullable": True},
                                                        "parent_n": {"type": "integer", "nullable": True, "description": "Coarse paragraph anchor (meta_json.parent_n, R2.3); null when not fine-segmented"},
                                                    },
                                                },
                                            },
                                            "count": {"type": "integer"},
                                        },
                                    }
                                }
                            },
                        },
                        "400": {
                            "description": "Bad request",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                    },
                }
            },
            "/tokens": {
                "get": {
                    "summary": "List token rows for a document (optionally one unit)",
                    "parameters": [
                        {
                            "name": "doc_id",
                            "in": "query",
                            "required": True,
                            "schema": {"type": "integer"},
                            "description": "Document identifier",
                        },
                        {
                            "name": "unit_id",
                            "in": "query",
                            "required": False,
                            "schema": {"type": "integer"},
                            "description": "Optional unit identifier to restrict token list",
                        },
                        {
                            "name": "limit",
                            "in": "query",
                            "required": False,
                            "schema": {"type": "integer", "minimum": 1, "maximum": 1000, "default": 200},
                        },
                        {
                            "name": "offset",
                            "in": "query",
                            "required": False,
                            "schema": {"type": "integer", "minimum": 0, "default": 0},
                        },
                    ],
                    "responses": {
                        "200": {
                            "description": "Token list",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/TokensResponse"},
                                }
                            },
                        },
                        "400": {
                            "description": "Bad request",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                        "500": {
                            "description": "Internal error",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                    },
                }
            },
            "/tokens/update": {
                "post": {
                    "summary": "Update a token row (manual annotation edit)",
                    "requestBody": {
                        "required": True,
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/TokenUpdateRequest"},
                            }
                        },
                    },
                    "responses": {
                        "200": {
                            "description": "Token updated",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/TokenUpdateResponse"},
                                }
                            },
                        },
                        "400": {
                            "description": "Bad request",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                        "401": {
                            "description": "Unauthorized (missing/invalid token)",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                        "404": {
                            "description": "Token row not found",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                        "500": {
                            "description": "Internal error",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                    },
                }
            },
            "/align": {
                "post": {
                    "summary": "Align documents by external_id, position, or similarity",
                    "requestBody": {
                        "required": True,
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/AlignRequest"},
                            }
                        },
                    },
                    "responses": {
                        "200": {
                            "description": "Alignment reports",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/AlignResponse"},
                                }
                            },
                        },
                        "400": {
                            "description": "Bad request",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                        "500": {
                            "description": "Internal error",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                    },
                }
            },
            "/shutdown": {
                "post": {
                    "summary": "Gracefully stop sidecar process",
                    "responses": {
                        "200": {
                            "description": "Shutdown accepted",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ShutdownResponse"},
                                }
                            },
                        },
                        "401": {
                            "description": "Unauthorized (missing/invalid token)",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                        "500": {
                            "description": "Internal error",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                    },
                }
            },
            "/telemetry": {
                "post": {
                    "summary": "Append a telemetry event to the local NDJSON (fire-and-forget, no auth)",
                    "description": (
                        "Local-only telemetry. Events are appended to "
                        "<db_dir>/.agrafes_telemetry.ndjson. No network egress, "
                        "no token required (loopback-only sidecar). Body must "
                        "include `event` (string); any other fields are "
                        "forwarded as payload. Always returns 204."
                    ),
                    "requestBody": {
                        "required": True,
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/TelemetryRequest"},
                            }
                        },
                    },
                    "responses": {
                        "204": {"description": "Event accepted (or silently dropped on bad input)"},
                    },
                }
            },
            "/jobs": {
                "get": {
                    "summary": "List async jobs",
                    "responses": {
                        "200": {
                            "description": "Job list",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/JobsListResponse"},
                                }
                            },
                        },
                    },
                },
                "post": {
                    "summary": "Submit async job",
                    "requestBody": {
                        "required": True,
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/JobSubmitRequest"},
                            }
                        },
                    },
                    "responses": {
                        "202": {
                            "description": "Accepted job",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/JobAcceptedResponse"},
                                }
                            },
                        },
                        "400": {
                            "description": "Bad request",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                    },
                },
            },
            "/runs": {
                "get": {
                    "summary": "List persisted runs (SQLite runs: import, align, index, …)",
                    "parameters": [
                        {
                            "name": "kind",
                            "in": "query",
                            "required": False,
                            "schema": {"type": "string"},
                            "description": "Filter by run kind (e.g. align, import)",
                        },
                        {
                            "name": "limit",
                            "in": "query",
                            "required": False,
                            "schema": {"type": "integer", "minimum": 1, "maximum": 200, "default": 50},
                            "description": "Maximum rows, newest first",
                        },
                    ],
                    "responses": {
                        "200": {
                            "description": "Run history",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/RunsListResponse"},
                                }
                            },
                        },
                    },
                }
            },
            "/jobs/{job_id}": {
                "get": {
                    "summary": "Get async job status",
                    "parameters": [
                        {
                            "name": "job_id",
                            "in": "path",
                            "required": True,
                            "schema": {"type": "string"},
                        }
                    ],
                    "responses": {
                        "200": {
                            "description": "Job status",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/JobAcceptedResponse"},
                                }
                            },
                        },
                        "404": {
                            "description": "Job not found",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                    },
                }
            },
            # ── V0.5 — Job enqueue + cancel ───────────────────────────────
            "/jobs/enqueue": {
                "post": {
                    "summary": "Enqueue an async job (token required; supports all kinds including import/align/exports)",
                    "security": [{"token": []}],
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/JobEnqueueRequest"}}}},
                    "responses": {
                        "202": {"description": "Job accepted", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/JobAcceptedResponse"}}}},
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "401": {"description": "Unauthorized", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/jobs/{job_id}/cancel": {
                "post": {
                    "summary": "Cancel a queued or running job (best-effort; idempotent)",
                    "security": [{"token": []}],
                    "parameters": [{"name": "job_id", "in": "path", "required": True, "schema": {"type": "string"}}],
                    "responses": {
                        "200": {"description": "Job canceled", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/JobCancelResponse"}}}},
                        "401": {"description": "Unauthorized", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "404": {"description": "Job not found", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            # ── V0.4A — Metadata panel ────────────────────────────────────
            "/documents/update": {
                "post": {
                    "summary": "Update document metadata",
                    "security": [{"token": []}],
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/DocumentUpdateRequest"}}}},
                    "responses": {"200": {"description": "Updated"}, "400": {"description": "Bad request"}, "401": {"description": "Unauthorized"}, "404": {"description": "Not found"}},
                }
            },
            "/documents/bulk_update": {
                "post": {
                    "summary": "Bulk update document metadata",
                    "security": [{"token": []}],
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/DocumentBulkUpdateRequest"}}}},
                    "responses": {"200": {"description": "Updated"}, "400": {"description": "Bad request"}, "401": {"description": "Unauthorized"}},
                }
            },
            "/documents/delete": {
                "post": {
                    "summary": "Delete documents and all associated data (units, alignment links, relations)",
                    "security": [{"token": []}],
                    "requestBody": {
                        "required": True,
                        "content": {"application/json": {"schema": {
                            "type": "object",
                            "required": ["doc_ids"],
                            "properties": {
                                "doc_ids": {"type": "array", "items": {"type": "integer"}, "minItems": 1},
                            },
                        }}},
                    },
                    "responses": {
                        "200": {"description": "Deleted", "content": {"application/json": {"schema": {
                            "type": "object", "properties": {
                                "ok": {"type": "boolean"},
                                "deleted": {"type": "integer"},
                                "doc_ids": {"type": "array", "items": {"type": "integer"}},
                            },
                        }}}},
                        "400": {"description": "Bad request"},
                        "401": {"description": "Unauthorized"},
                    },
                }
            },
            "/doc_relations": {
                "get": {
                    "summary": "List doc_relations for a document",
                    "parameters": [{"name": "doc_id", "in": "query", "required": True, "schema": {"type": "integer"}}],
                    "responses": {"200": {"description": "Relations"}, "400": {"description": "Bad request"}},
                }
            },
            "/doc_relations/all": {
                "get": {
                    "summary": "All doc_relations in the corpus (for hierarchy view)",
                    "responses": {"200": {"description": "All relations"}},
                }
            },
            "/families": {
                "get": {
                    "summary": "List document families (parent + children + completion stats)",
                    "responses": {"200": {"description": "Families with stats"}},
                }
            },
            "/align/source_changed_summary": {
                "get": {
                    "summary": (
                        "Global summary of alignment links whose pivot source "
                        "changed since alignment (source_changed_at not null)"
                    ),
                    "responses": {
                        "200": {
                            "description": (
                                "{ total: int, docs: [{target_doc_id, "
                                "target_title, count}] } — drives the AlignPanel "
                                "landing banner"
                            ),
                        },
                    },
                }
            },
            "/families/{family_root_id}/segment": {
                "post": {
                    "summary": "Segment all documents in a family (parent first, then children)",
                    "parameters": [{"name": "family_root_id", "in": "path", "required": True,
                                    "schema": {"type": "integer"}}],
                    "requestBody": {"required": False, "content": {"application/json": {
                        "schema": {"$ref": "#/components/schemas/FamilySegmentRequest"}}}},
                    "responses": {
                        "200": {"description": "Per-doc segmentation results"},
                        "400": {"description": "Bad request"},
                        "404": {"description": "Family root not found"},
                    },
                }
            },
            "/families/{family_root_id}/align": {
                "post": {
                    "summary": "Align all parent↔child pairs in a family",
                    "parameters": [{"name": "family_root_id", "in": "path", "required": True,
                                    "schema": {"type": "integer"}}],
                    "requestBody": {"required": False, "content": {"application/json": {
                        "schema": {"$ref": "#/components/schemas/FamilyAlignRequest"}}}},
                    "responses": {
                        "200": {"description": "Per-pair alignment results"},
                        "400": {"description": "Bad request (unready children, bad strategy…)"},
                        "404": {"description": "Family root not found"},
                    },
                }
            },
            "/families/{family_root_id}/curation_status": {
                "get": {
                    "summary": "List alignment links with source_changed_at set for a family",
                    "parameters": [{"name": "family_root_id", "in": "path", "required": True,
                                    "schema": {"type": "integer"}}],
                    "responses": {
                        "200": {"description": "Per-child list of pending curation reviews"},
                        "404": {"description": "Family root not found"},
                    },
                }
            },
            "/align/link/acknowledge_source_change": {
                "post": {
                    "summary": "Clear source_changed_at flag on alignment links (mark as reviewed)",
                    "security": [{"token": []}],
                    "requestBody": {"required": True, "content": {"application/json": {
                        "schema": {"$ref": "#/components/schemas/AcknowledgeSourceChangeRequest"}}}},
                    "responses": {
                        "200": {"description": "Number of links acknowledged"},
                        "400": {"description": "Bad request"},
                        "401": {"description": "Unauthorized"},
                    },
                }
            },
            "/doc_relations/set": {
                "post": {
                    "summary": "Upsert a doc_relation",
                    "security": [{"token": []}],
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/DocRelationSetRequest"}}}},
                    "responses": {"200": {"description": "Created or updated"}, "400": {"description": "Bad request"}, "401": {"description": "Unauthorized"}},
                }
            },
            "/doc_relations/delete": {
                "post": {
                    "summary": "Delete a doc_relation by id",
                    "security": [{"token": []}],
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"type": "object", "required": ["id"], "properties": {"id": {"type": "integer"}}}}}},
                    "responses": {"200": {"description": "Deleted"}, "400": {"description": "Bad request"}, "401": {"description": "Unauthorized"}},
                }
            },
            # ── V0.4B — Exports ───────────────────────────────────────────
            "/export/tmx": {
                "post": {
                    "summary": "Export aligned pairs to TMX 1.4 format (single pair or whole family)",
                    "requestBody": {"required": True, "content": {"application/json": {
                        "schema": {"$ref": "#/components/schemas/ExportTmxRequest"}}}},
                    "responses": {
                        "200": {"description": "TMX file path and TU count"},
                        "400": {"description": "Bad request"},
                    },
                }
            },
            "/export/bilingual": {
                "post": {
                    "summary": "Export interleaved bilingual text (HTML or TXT) or return inline preview",
                    "requestBody": {"required": True, "content": {"application/json": {
                        "schema": {"$ref": "#/components/schemas/ExportBilingualRequest"}}}},
                    "responses": {
                        "200": {"description": "File path + pair_count, or preview payload"},
                        "400": {"description": "Bad request"},
                    },
                }
            },
            "/export/tei": {
                "post": {
                    "summary": "Export documents as TEI XML",
                    "security": [{"token": []}],
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ExportTeiRequest"}}}},
                    "responses": {"200": {"description": "Files created"}, "400": {"description": "Bad request"}, "401": {"description": "Unauthorized"}},
                }
            },
            "/export/conllu": {
                "post": {
                    "summary": "Export token annotations as CoNLL-U",
                    "security": [{"token": []}],
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ExportConlluRequest"}}}},
                    "responses": {"200": {"description": "File written"}, "400": {"description": "Bad request"}, "401": {"description": "Unauthorized"}},
                }
            },
            "/export/token_query_csv": {
                "post": {
                    "summary": "Export token_query hits to CSV/TSV",
                    "security": [{"token": []}],
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ExportTokenQueryCsvRequest"}}}},
                    "responses": {"200": {"description": "File written"}, "400": {"description": "Bad request"}, "401": {"description": "Unauthorized"}},
                }
            },
            "/export/ske": {
                "post": {
                    "summary": "Export token annotations as Sketch Engine-style vertical file",
                    "security": [{"token": []}],
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ExportSkeRequest"}}}},
                    "responses": {"200": {"description": "File written"}, "400": {"description": "Bad request"}, "401": {"description": "Unauthorized"}},
                }
            },
            "/export/align_csv": {
                "post": {
                    "summary": "Export alignment links as CSV/TSV",
                    "security": [{"token": []}],
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ExportAlignCsvRequest"}}}},
                    "responses": {"200": {"description": "File written"}, "400": {"description": "Bad request"}, "401": {"description": "Unauthorized"}},
                }
            },
            "/export/matrix": {
                "post": {
                    "summary": "Export the source-anchored multilingual alignment matrix (CSV)",
                    "security": [{"token": []}],
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ExportMatrixRequest"}}}},
                    "responses": {"200": {"description": "Matrix written"}, "400": {"description": "Bad request"}, "401": {"description": "Unauthorized"}, "404": {"description": "Family root not found"}},
                }
            },
            "/export/run_report": {
                "post": {
                    "summary": "Export run history as JSONL or HTML",
                    "security": [{"token": []}],
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ExportRunReportRequest"}}}},
                    "responses": {"200": {"description": "Report written"}, "400": {"description": "Bad request"}, "401": {"description": "Unauthorized"}},
                }
            },
            "/db/backup": {
                "post": {
                    "summary": "Create a SQLite backup file (timestamped .db.bak or named via out_path)",
                    "security": [{"token": []}],
                    "requestBody": {"required": False, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/DbBackupRequest"}}}},
                    "responses": {
                        "200": {"description": "Backup created", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/DbBackupResponse"}}}},
                        "400": {"description": "Bad request"},
                        "401": {"description": "Unauthorized"},
                        "404": {"description": "DB file not found"},
                        "409": {"description": "out_path already exists"},
                    },
                }
            },
            "/corpus/audit": {
                "get": {
                    "summary": "Corpus health audit: missing fields, empty documents, duplicates (hash/filename/title)",
                    "responses": {
                        "200": {
                            "description": "Audit result",
                            "content": {"application/json": {"schema": {"$ref": "#/components/schemas/CorpusAuditResponse"}}},
                        },
                    },
                },
            },
            "/corpus/info": {
                "get": {
                    "summary": "Read corpus-level metadata (title, description, flexible meta object)",
                    "responses": {
                        "200": {
                            "description": "Corpus info",
                            "content": {"application/json": {"schema": {"$ref": "#/components/schemas/CorpusInfoResponse"}}},
                        },
                    },
                },
                "post": {
                    "summary": "Update corpus metadata (partial JSON body; token required when enabled)",
                    "security": [{"token": []}],
                    "requestBody": {
                        "required": False,
                        "content": {"application/json": {"schema": {"$ref": "#/components/schemas/CorpusInfoPatchRequest"}}},
                    },
                    "responses": {
                        "200": {
                            "description": "Updated corpus info",
                            "content": {"application/json": {"schema": {"$ref": "#/components/schemas/CorpusInfoResponse"}}},
                        },
                        "400": {"description": "Bad request"},
                        "401": {"description": "Unauthorized"},
                    },
                },
            },
            # ── V0.4C — Align link editing ────────────────────────────────
            "/align/link/create": {
                "post": {
                    "summary": "Manually create an alignment link between two units",
                    "security": [{"token": []}],
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/AlignLinkCreateRequest"}}}},
                    "responses": {"200": {"description": "Created"}, "400": {"description": "Bad request"}, "401": {"description": "Unauthorized"}, "404": {"description": "Not found"}, "409": {"description": "Conflict — link already exists"}},
                }
            },
            "/align/link/update_status": {
                "post": {
                    "summary": "Update status of an alignment link",
                    "security": [{"token": []}],
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/AlignLinkUpdateStatusRequest"}}}},
                    "responses": {"200": {"description": "Updated"}, "400": {"description": "Bad request"}, "401": {"description": "Unauthorized"}, "404": {"description": "Not found"}},
                }
            },
            "/align/link/delete": {
                "post": {
                    "summary": "Delete an alignment link",
                    "security": [{"token": []}],
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/AlignLinkDeleteRequest"}}}},
                    "responses": {"200": {"description": "Deleted"}, "400": {"description": "Bad request"}, "401": {"description": "Unauthorized"}},
                }
            },
            "/align/link/retarget": {
                "post": {
                    "summary": "Change target unit of an alignment link",
                    "security": [{"token": []}],
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/AlignLinkRetargetRequest"}}}},
                    "responses": {"200": {"description": "Retargeted"}, "400": {"description": "Bad request"}, "401": {"description": "Unauthorized"}, "404": {"description": "Not found"}},
                }
            },
            # ── V1.3 — Batch align link operations ───────────────────────────
            "/align/links/batch_update": {
                "post": {
                    "summary": "Apply a batch of set_status/delete operations on alignment links",
                    "security": [{"token": []}],
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/AlignLinksBatchUpdateRequest"}}}},
                    "responses": {
                        "200": {"description": "Batch result"},
                        "400": {"description": "Bad request"},
                        "401": {"description": "Unauthorized"},
                    },
                }
            },
            # ── 1.6.56 — Per-cell status (matrix « ∅ non traduit », D-W8) ─────
            "/align/cell_status": {
                "post": {
                    "summary": "Set or clear the per-cell « non traduit » status on a (hub unit × target doc) pair",
                    "description": (
                        "Matrix gesture « ∅ Non traduit » (D-W8 résolu): marks the pair as "
                        "deliberately untranslated in THAT language (table alignment_cell_statuses, "
                        "mig 028). status null clears. Distinct from the global units.unit_status "
                        "axis (marker-lift, whole row) — the matrix projection reads both."
                    ),
                    "security": [{"token": []}],
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/AlignCellStatusRequest"}}}},
                    "responses": {
                        "200": {"description": "Cell status set/cleared"},
                        "400": {"description": "Validation error"},
                        "401": {"description": "Unauthorized"},
                        "404": {"description": "Pivot unit or target doc not found"},
                        "409": {"description": "Conflict — the cell has active links (un-align first)"},
                    },
                }
            },
            # ── V1.4 — Retarget candidates (read-only) ───────────────────────
            "/align/retarget_candidates": {
                "post": {
                    "summary": "Suggest candidate target units for retargeting an alignment link",
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/RetargetCandidatesRequest"}}}},
                    "responses": {
                        "200": {"description": "Pivot info + candidates list"},
                        "400": {"description": "Bad request"},
                        "404": {"description": "Not found"},
                    },
                }
            },
            # ── V1.5 — Collision resolver ─────────────────────────────────────
            "/align/collisions": {
                "post": {
                    "summary": "List pivot units with multiple alignment links to the same target doc (collisions)",
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/AlignCollisionsRequest"}}}},
                    "responses": {
                        "200": {"description": "Paginated collision groups"},
                        "400": {"description": "Bad request"},
                    },
                }
            },
            "/align/collisions/resolve": {
                "post": {
                    "summary": "Batch-resolve collision links (keep/delete/reject/unreviewed) — token required",
                    "security": [{"token": []}],
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/CollisionResolveRequest"}}}},
                    "responses": {
                        "200": {"description": "Batch result"},
                        "400": {"description": "Bad request"},
                        "401": {"description": "Unauthorized"},
                    },
                }
            },
            # ── ShareDocs / WebDAV ingestion — Phase 2 ───────────────────────
            "/webdav/list": {
                "post": {
                    "summary": "Browse a WebDAV collection (PROPFIND, Depth:1) — read-only, no token",
                    "description": (
                        "Lists the immediate children of a WebDAV folder. Read-only network "
                        "operation (no DB) → dispatched lock-free, never blocks db writes. "
                        "Credentials in the body are loopback-only and never persisted."
                    ),
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/WebdavListRequest"}}}},
                    "responses": {
                        "200": {"description": "Folder entries", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/WebdavListResponse"}}}},
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "401": {"description": "WebDAV authentication failed", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "404": {"description": "Folder not found", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "502": {"description": "Upstream WebDAV network/protocol error", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/webdav/probe": {
                "post": {
                    "summary": "Probe a WebDAV folder without writing anything (async job)",
                    "description": (
                        "Reads each probeable file of the collection — download to a temp "
                        "file, parse with the SAME preview code as /import/preview, delete "
                        "the temp — and returns per file what that preview returns, so the "
                        "UI can deduce the import mode of every REMOTE file exactly as it "
                        "does for local ones. Writes nothing: no document, no unit, no run, "
                        "no DB access at all (dispatched lock-free like /webdav/list). "
                        "Neither `mode` nor `language` is required — the probe exists to "
                        "discover the former and never imports. Nothing is downloaded for a "
                        "file that is not probed, and the two reasons are kept apart: "
                        "`skipped-no-probe` = self-describing but importable (TEI/CoNLL-U — "
                        "nothing to deduce), `skipped-unsupported` = no import route at all "
                        "(.pdf, .jpg…). Returns {job}; poll /jobs/<id> for "
                        "per-file progress and the report. Credentials (auth) are NEVER "
                        "placed in the job params and are not persisted anywhere."
                    ),
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/WebdavProbeRequest"}}}},
                    "responses": {
                        "202": {"description": "Probe job accepted", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/JobAcceptedResponse"}}}},
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/import-remote": {
                "post": {
                    "summary": "Batch-ingest a WebDAV folder as an async job (token required)",
                    "description": (
                        "Enqueues a JobManager job that browses the folder and imports every "
                        "matching file (dedup by content hash, provenance = remote URL). Returns "
                        "{job}; poll /jobs/<id> for per-file progress and the batch report. "
                        "Credentials (auth) are NEVER placed in the job params and are not "
                        "persisted anywhere — only used in-memory to reach the server."
                    ),
                    "security": [{"token": []}],
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ImportRemoteRequest"}}}},
                    "responses": {
                        "202": {"description": "Import job accepted", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/JobAcceptedResponse"}}}},
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "401": {"description": "Unauthorized (missing/invalid token)", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            # ── spaCy model management (on-demand download) ──────────────────
            "/models": {
                "get": {
                    "summary": "List known spaCy models with install status",
                    "description": (
                        "Catalog of supported spaCy models with install state (filesystem-only, "
                        "no DB) → dispatched lock-free, never blocks db writes. Optional "
                        "?language= filters to one base language code."
                    ),
                    "parameters": [
                        {"name": "language", "in": "query", "required": False, "schema": {"type": "string"},
                         "description": "Filter to one base language code (e.g. fr)"},
                    ],
                    "responses": {
                        "200": {"description": "Model list", "content": {"application/json": {"schema": {"type": "object", "properties": {
                            "models": {"type": "array", "items": {"type": "object", "properties": {
                                "name": {"type": "string"}, "language": {"type": "string"},
                                "genre": {"type": "string"}, "size_class": {"type": "string"},
                                "approx_size_mb": {"type": "integer"}, "installed": {"type": "boolean"},
                                "source": {"type": "string", "enum": ["bundled", "downloaded", "absent"]},
                                "active": {"type": "boolean"},
                                "version": {"type": "string", "nullable": True}}}}}}}}},
                    },
                }
            },
            "/models/download": {
                "post": {
                    "summary": "Download + install a spaCy model as an async job (token required)",
                    "description": (
                        "Enqueues a JobManager job that downloads the model wheel from the official "
                        "Explosion GitHub releases (https) and installs it into the user models dir. "
                        "Returns {job}; poll /jobs/<id> for progress. Model name is restricted to a "
                        "fixed allowlist."
                    ),
                    "security": [{"token": []}],
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {
                        "type": "object", "required": ["model"], "properties": {
                            "model": {"type": "string", "description": "Model name, e.g. fr_core_news_md"}}}}}},
                    "responses": {
                        "202": {"description": "Download job accepted", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/JobAcceptedResponse"}}}},
                        "400": {"description": "Bad request (unknown/blank model)", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "401": {"description": "Unauthorized (missing/invalid token)", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/models/remove": {
                "post": {
                    "summary": "Remove an installed spaCy model (token required)",
                    "security": [{"token": []}],
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {
                        "type": "object", "required": ["model"], "properties": {"model": {"type": "string"}}}}}},
                    "responses": {
                        "200": {"description": "Model removed", "content": {"application/json": {"schema": {"type": "object", "properties": {"name": {"type": "string"}}}}}},
                        "400": {"description": "Bad request (unknown/blank model, or a bundled read-only model)", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "404": {"description": "Model not installed", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/models/active": {
                "post": {
                    "summary": "Set the active spaCy model for a language in this corpus (token required)",
                    "description": (
                        "Persists the active model for a base language in corpus_info.meta_json "
                        "(active_models). The model must be for that language (or multilingual xx) "
                        "and available (bundled or downloaded). Annotation uses it unless a model is "
                        "passed explicitly to /annotate."
                    ),
                    "security": [{"token": []}],
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {
                        "type": "object", "required": ["language", "model"], "properties": {
                            "language": {"type": "string", "description": "Base language code, e.g. fr"},
                            "model": {"type": "string", "description": "Model name, e.g. fr_core_news_lg"}}}}}},
                    "responses": {
                        "200": {"description": "Active model set", "content": {"application/json": {"schema": {"type": "object", "properties": {
                            "language": {"type": "string"}, "model": {"type": "string"}}}}}},
                        "400": {"description": "Bad request (blank/unknown model, wrong language, or not available)", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "401": {"description": "Unauthorized (missing/invalid token)", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            # ── SID-06 — routes servies jusque-là absentes de l'OpenAPI ──────
            "/unit/context": {
                "get": {
                    "summary": "Reading window of line units centred on a unit (each tagged is_current)",
                    "parameters": [
                        {"name": "unit_id", "in": "query", "required": True, "schema": {"type": "integer"}},
                        {"name": "window", "in": "query", "required": False, "schema": {"type": "integer", "default": 3, "minimum": 1, "maximum": 10}},
                    ],
                    "responses": {
                        "200": {"description": "Context window", "content": {"application/json": {"schema": {"type": "object", "properties": {
                            "doc_id": {"type": "integer"}, "unit_id": {"type": "integer"}, "unit_index": {"type": "integer"},
                            "total_units": {"type": "integer"}, "window_before": {"type": "integer"}, "window_after": {"type": "integer"},
                            "items": {"type": "array", "items": {"type": "object", "properties": {"unit_id": {"type": "integer"}, "text": {"type": "string"}, "is_current": {"type": "boolean"}}}},
                        }}}}},
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "404": {"description": "Unit not found", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/curate/exceptions": {
                "get": {
                    "summary": "List curation exceptions (optionally filtered by doc_id)",
                    "parameters": [{"name": "doc_id", "in": "query", "required": False, "schema": {"type": "integer"}}],
                    "responses": {"200": {"description": "Exceptions list", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/CurateExceptionsListResponse"}}}}},
                },
                "post": {
                    "summary": "List curation exceptions (body variant; optionally filtered by doc_id)",
                    "requestBody": {"required": False, "content": {"application/json": {"schema": {"type": "object", "properties": {"doc_id": {"type": "integer"}}}}}},
                    "responses": {"200": {"description": "Exceptions list", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/CurateExceptionsListResponse"}}}}},
                },
            },
            "/curate/exceptions/set": {
                "post": {
                    "summary": "Create or replace (upsert) a curation exception for a unit — token required",
                    "security": [{"token": []}],
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {
                        "type": "object", "required": ["unit_id", "kind"], "properties": {
                            "unit_id": {"type": "integer"}, "kind": {"type": "string", "enum": ["ignore", "override"]},
                            "override_text": {"type": "string", "description": "Required when kind=override"}, "note": {"type": "string"}}}}}},
                    "responses": {
                        "200": {"description": "Exception set", "content": {"application/json": {"schema": {"type": "object", "properties": {
                            "unit_id": {"type": "integer"}, "kind": {"type": "string"}, "override_text": {"type": "string", "nullable": True},
                            "note": {"type": "string", "nullable": True}, "action": {"type": "string"}}}}}},
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "404": {"description": "Unit not found", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/curate/exceptions/delete": {
                "post": {
                    "summary": "Delete the curation exception for a unit — token required",
                    "security": [{"token": []}],
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"type": "object", "required": ["unit_id"], "properties": {"unit_id": {"type": "integer"}}}}}},
                    "responses": {
                        "200": {"description": "Deletion result", "content": {"application/json": {"schema": {"type": "object", "properties": {"unit_id": {"type": "integer"}, "deleted": {"type": "boolean"}}}}}},
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/curate/exceptions/export": {
                "post": {
                    "summary": "Export curation exceptions to a JSON/CSV file (whole corpus or one doc) — token required",
                    "security": [{"token": []}],
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {
                        "type": "object", "required": ["out_path"], "properties": {
                            "out_path": {"type": "string"}, "format": {"type": "string", "enum": ["json", "csv"], "default": "json"}, "doc_id": {"type": "integer"}}}}}},
                    "responses": {
                        "200": {"description": "Export result", "content": {"application/json": {"schema": {"type": "object", "properties": {"out_path": {"type": "string"}, "count": {"type": "integer"}, "format": {"type": "string"}}}}}},
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "500": {"description": "Could not write export file", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/curate/apply-history": {
                "get": {
                    "summary": "List recent curation apply-history events (optionally filtered by doc_id)",
                    "parameters": [
                        {"name": "doc_id", "in": "query", "required": False, "schema": {"type": "integer"}},
                        {"name": "limit", "in": "query", "required": False, "schema": {"type": "integer", "default": 50}},
                    ],
                    "responses": {"200": {"description": "Apply-history events", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/CurateApplyHistoryListResponse"}}}}},
                },
                "post": {
                    "summary": "List recent curation apply-history events (body variant)",
                    "requestBody": {"required": False, "content": {"application/json": {"schema": {"type": "object", "properties": {
                        "doc_id": {"type": "integer"}, "scope": {"type": "string", "enum": ["doc", "all"]}, "limit": {"type": "integer", "default": 50, "maximum": 200}}}}}},
                    "responses": {"200": {"description": "Apply-history events", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/CurateApplyHistoryListResponse"}}}}},
                },
            },
            "/curate/apply-history/record": {
                "post": {
                    "summary": "Insert one curation apply event into apply-history — token required",
                    "security": [{"token": []}],
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"type": "object", "properties": {
                        "scope": {"type": "string", "enum": ["doc", "all"], "default": "all"}, "doc_id": {"type": "integer"}, "doc_title": {"type": "string"},
                        "applied_at": {"type": "string"}, "docs_curated": {"type": "integer"}, "units_modified": {"type": "integer"}, "units_skipped": {"type": "integer"},
                        "ignored_count": {"type": "integer", "nullable": True}, "manual_override_count": {"type": "integer", "nullable": True},
                        "preview_displayed_count": {"type": "integer", "nullable": True}, "preview_units_changed": {"type": "integer", "nullable": True},
                        "preview_truncated": {"type": "boolean"}}}}}},
                    "responses": {"200": {"description": "Recorded", "content": {"application/json": {"schema": {"type": "object", "properties": {"id": {"type": "integer"}}}}}}},
                }
            },
            "/curate/apply-history/export": {
                "post": {
                    "summary": "Export apply-history (<=1000 most recent) to a JSON/CSV file — token required",
                    "security": [{"token": []}],
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {
                        "type": "object", "required": ["out_path"], "properties": {
                            "out_path": {"type": "string"}, "format": {"type": "string", "enum": ["json", "csv"], "default": "json"}, "doc_id": {"type": "integer"}}}}}},
                    "responses": {
                        "200": {"description": "Export result", "content": {"application/json": {"schema": {"type": "object", "properties": {"out_path": {"type": "string"}, "count": {"type": "integer"}, "format": {"type": "string"}}}}}},
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "500": {"description": "Could not write export file", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/query/facets": {
                "post": {
                    "summary": "Lightweight facet summary for a query (counts + top docs, no hit content)",
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"type": "object", "properties": {
                        "q": {"type": "string"}, "language": {"type": "string"}, "doc_id": {"type": "integer"}, "doc_ids": {"type": "array", "items": {"type": "integer"}},
                        "resource_type": {"type": "string"}, "doc_role": {"type": "string"}, "author": {"type": "string"}, "title_search": {"type": "string"},
                        "doc_date_from": {"type": "string"}, "doc_date_to": {"type": "string"}, "source_ext": {"type": "string"},
                        "tags": {"type": "array", "items": {"type": "object", "properties": {"kind": {"type": "string"}, "value": {"type": "string"}}, "required": ["kind", "value"]}, "description": "R6.2 — filter by labels (OR over (kind,value))."},
                        "unit_status": {"type": "string", "enum": ["non_traduit", "ajout"], "nullable": True, "description": "R4.1/FE-01 — restrict facet counts to units of this translation status."},
                        "top_docs_limit": {"type": "integer", "default": 10, "minimum": 1, "maximum": 50}}}}}},
                    "responses": {
                        "200": {"description": "Facet summary", "content": {"application/json": {"schema": {"type": "object", "properties": {
                            "total_hits": {"type": "integer"}, "distinct_docs": {"type": "integer"}, "distinct_langs": {"type": "integer"},
                            "top_docs": {"type": "array", "items": {"type": "object", "properties": {"doc_id": {"type": "integer"}, "title": {"type": "string"}, "language": {"type": "string", "nullable": True}, "count": {"type": "integer"}}}}}}}}},
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/stats/lexical": {
                "post": {
                    "summary": "Lexical frequency stats for one slot (filter set)",
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"type": "object", "properties": {
                        "slot": {"$ref": "#/components/schemas/StatsSlot"}, "label": {"type": "string"}}}}}},
                    "responses": {"200": {"description": "Lexical stats", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/LexicalStatsResult"}}}}},
                }
            },
            "/stats/compare": {
                "post": {
                    "summary": "Compare lexical frequency distributions of two slots A and B",
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"type": "object", "properties": {
                        "a": {"$ref": "#/components/schemas/StatsSlot"}, "b": {"$ref": "#/components/schemas/StatsSlot"},
                        "label_a": {"type": "string", "default": "A"}, "label_b": {"type": "string", "default": "B"}}}}}},
                    "responses": {"200": {"description": "Comparison", "content": {"application/json": {"schema": {"type": "object", "properties": {
                        "label_a": {"type": "string"}, "label_b": {"type": "string"},
                        "summary_a": {"$ref": "#/components/schemas/LexicalStatsResult"}, "summary_b": {"$ref": "#/components/schemas/LexicalStatsResult"},
                        "comparison": {"type": "array", "items": {"type": "object", "properties": {
                            "word": {"type": "string"}, "count_a": {"type": "integer"}, "count_b": {"type": "integer"},
                            "freq_a": {"type": "number"}, "freq_b": {"type": "number"}, "ratio": {"type": "number", "nullable": True}}}}}}}}}},
                }
            },
            "/segment/delete_structure_unit": {
                "post": {
                    "summary": "Delete the structure unit at position n and shift later units down — token required",
                    "security": [{"token": []}],
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"type": "object", "required": ["doc_id", "n"], "properties": {"doc_id": {"type": "integer"}, "n": {"type": "integer"}}}}}},
                    "responses": {
                        "200": {"description": "Deletion result", "content": {"application/json": {"schema": {"type": "object", "properties": {"doc_id": {"type": "integer"}, "deleted_n": {"type": "integer"}, "text": {"type": "string"}}}}}},
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "404": {"description": "Structure unit not found", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
        },
        "components": {
            "securitySchemes": {
                # SID-13: define the scheme every `security: [{"token": []}]` refers
                # to, otherwise those references dangle. Write endpoints require the
                # loopback write token in the X-Agrafes-Token header (--token auto).
                "token": {
                    "type": "apiKey",
                    "in": "header",
                    "name": "X-Agrafes-Token",
                    "description": (
                        "Write-operation token. Required by mutating endpoints when the "
                        "sidecar is started with --token auto; sent in the X-Agrafes-Token header."
                    ),
                },
            },
            "schemas": {
                # ── SID-06 — schémas partagés des routes nouvellement documentées ──
                "StatsSlot": {
                    "type": "object",
                    "description": "Filter set selecting the units a lexical-stats slot is computed over.",
                    "properties": {
                        "doc_ids": {"type": "array", "items": {"type": "integer"}},
                        "language": {"type": "string"},
                        "doc_role": {"type": "string"},
                        "resource_type": {"type": "string"},
                        "family_id": {"type": "integer"},
                        "top_n": {"type": "integer", "default": 50, "minimum": 1, "maximum": 500},
                        "min_length": {"type": "integer", "default": 2, "minimum": 1},
                    },
                },
                "LexicalStatsResult": {
                    "type": "object",
                    "properties": {
                        "label": {"type": "string"},
                        "total_tokens": {"type": "integer"},
                        "vocabulary_size": {"type": "integer"},
                        "total_units": {"type": "integer"},
                        "total_docs": {"type": "integer"},
                        "avg_tokens_per_unit": {"type": "number"},
                        "top_words": {"type": "array", "items": {"type": "object", "properties": {
                            "word": {"type": "string"}, "count": {"type": "integer"}, "freq_pct": {"type": "number"}}}},
                        "rare_words": {"type": "array", "items": {"type": "object", "properties": {
                            "word": {"type": "string"}, "count": {"type": "integer"}, "freq_pct": {"type": "number"}}}},
                    },
                },
                "CurateExceptionsListResponse": {
                    "type": "object",
                    "required": ["exceptions", "count"],
                    "properties": {
                        "count": {"type": "integer"},
                        "exceptions": {"type": "array", "items": {"type": "object", "properties": {
                            "id": {"type": "integer"}, "unit_id": {"type": "integer"}, "kind": {"type": "string"},
                            "override_text": {"type": "string", "nullable": True}, "note": {"type": "string", "nullable": True},
                            "created_at": {"type": "string"}, "doc_id": {"type": "integer"},
                            "doc_title": {"type": "string", "nullable": True}, "unit_text": {"type": "string", "nullable": True}}}},
                    },
                },
                "CurateApplyHistoryListResponse": {
                    "type": "object",
                    "required": ["events", "count"],
                    "properties": {
                        "count": {"type": "integer"},
                        "events": {"type": "array", "items": {"type": "object", "properties": {
                            "id": {"type": "integer"}, "applied_at": {"type": "string"}, "scope": {"type": "string"},
                            "doc_id": {"type": "integer", "nullable": True}, "doc_title": {"type": "string", "nullable": True},
                            "docs_curated": {"type": "integer"}, "units_modified": {"type": "integer"}, "units_skipped": {"type": "integer"},
                            "ignored_count": {"type": "integer", "nullable": True}, "manual_override_count": {"type": "integer", "nullable": True},
                            "preview_displayed_count": {"type": "integer", "nullable": True}, "preview_units_changed": {"type": "integer", "nullable": True},
                            "preview_truncated": {"type": "boolean"}}}},
                    },
                },
                # Pre-existing dangling $refs (même classe que SID-13) — définis ici
                # à l'occasion de SID-06 : `OkResponse` (8 réfs : conventions/roles,
                # set_role, set_text_start…) et `AlignLinkCreateRequest` (1 réf).
                "OkResponse": {
                    "allOf": [{"$ref": "#/components/schemas/BaseResponse"}],
                    "description": "Generic success envelope (ok + api_version + version + status, plus endpoint-specific data).",
                },
                "AlignCellStatusRequest": {
                    "type": "object",
                    "required": ["pivot_unit_id", "target_doc_id"],
                    "properties": {
                        "pivot_unit_id": {"type": "integer", "description": "Hub (matrix row) line unit."},
                        "target_doc_id": {"type": "integer", "description": "Translation document (matrix column); must be a translation/excerpt of the pivot's document."},
                        "status": {
                            "type": "string",
                            "enum": ["non_traduit"],
                            "nullable": True,
                            "description": "1.6.56 (D-W8): 'non_traduit' marks the cell (token [non traduit], counts as done); null/absent clears the mark.",
                        },
                    },
                },
                "AlignLinkCreateRequest": {
                    "type": "object",
                    "required": ["pivot_unit_id", "target_unit_id"],
                    "properties": {
                        "pivot_unit_id": {"type": "integer"},
                        "target_unit_id": {"type": "integer"},
                        "status": {"type": "string", "enum": ["accepted", "rejected"], "nullable": True},
                        "external_id": {
                            "type": "integer",
                            "minimum": 0,
                            "description": "1.6.55 (D-W13): pair number to inherit (a gesture-created link passes its sibling's, so audit views sort it next to its family). Default: the pivot unit's external_id, else 0.",
                        },
                    },
                },
                "BaseResponse": {
                    "type": "object",
                    "required": ["ok", "api_version", "version", "status"],
                    "properties": {
                        "ok": {"type": "boolean"},
                        "api_version": {"type": "string"},
                        "version": {"type": "string"},
                        "status": {"type": "string"},
                    },
                    "additionalProperties": True,
                },
                "ErrorResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["error", "error_code"],
                            "properties": {
                                "error": {
                                    "type": "object",
                                    "required": ["type", "message"],
                                    "properties": {
                                        "type": {"type": "string"},
                                        "message": {"type": "string"},
                                        "details": {},
                                    },
                                },
                                "error_message": {"type": "string"},
                                "error_code": {"type": "string"},
                                "error_details": {},
                            },
                        },
                    ]
                },
                "HealthResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["version", "pid", "started_at"],
                            "properties": {
                                "pid": {"type": "integer"},
                                "started_at": {"type": "string"},
                                "host": {"type": "string"},
                                "port": {"type": "integer"},
                                "portfile": {"type": "string"},
                            },
                        },
                    ]
                },
                "QueryRequest": {
                    "type": "object",
                    "required": ["q"],
                    "properties": {
                        "q": {"type": "string"},
                        "mode": {"type": "string", "enum": ["segment", "kwic"], "default": "segment"},
                        "window": {"type": "integer", "default": 10},
                        "language": {"type": "string"},
                        "doc_id": {"type": "integer"},
                        "doc_ids": {"type": "array", "items": {"type": "integer"}},
                        "resource_type": {"type": "string"},
                        "doc_role": {"type": "string"},
                        "tags": {
                            "type": "array",
                            "description": "R6.2 — filter by namespaced labels; a doc matches ANY (kind,value) pair (OR).",
                            "items": {"type": "object", "properties": {"kind": {"type": "string"}, "value": {"type": "string"}}, "required": ["kind", "value"]},
                        },
                        "db_paths": {
                            "type": "array",
                            "items": {"type": "string"},
                            "nullable": True,
                            "description": "Optional absolute/relative database paths for federated multi-DB query.",
                        },
                        "include_aligned": {"type": "boolean", "default": False},
                        "aligned_limit": {"type": "integer", "minimum": 1, "default": 20, "nullable": True},
                        "all_occurrences": {"type": "boolean", "default": False},
                        "case_sensitive": {"type": "boolean", "default": False},
                        "limit": {"type": "integer", "minimum": 1, "maximum": 200, "default": 50},
                        "offset": {"type": "integer", "minimum": 0, "default": 0},
                        "family_id": {
                            "type": "integer",
                            "nullable": True,
                            "description": "When set, expands the query to all docs in the family (parent + children) and forces include_aligned=true.",
                        },
                        "pivot_only": {
                            "type": "boolean",
                            "default": False,
                            "description": "When family_id is set, restrict the search to the pivot (parent) document only.",
                        },
                        "unit_status": {
                            "type": "string",
                            "enum": ["non_traduit", "ajout"],
                            "nullable": True,
                            "description": "R4.1 — restrict hits to units with this translation status; omit for all.",
                        },
                    },
                    "additionalProperties": False,
                },
                "QueryResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": [
                                "run_id",
                                "count",
                                "hits",
                                "limit",
                                "offset",
                                "next_offset",
                                "has_more",
                                "total",
                            ],
                            "properties": {
                                "run_id": {"type": "string"},
                                "count": {"type": "integer"},
                                "hits": {"type": "array", "items": {"type": "object"}},
                                "limit": {"type": "integer"},
                                "offset": {"type": "integer"},
                                "next_offset": {"type": "integer", "nullable": True},
                                "has_more": {"type": "boolean"},
                                "total": {"type": "integer", "nullable": True},
                                "family_id": {"type": "integer", "nullable": True},
                                "family_doc_ids": {"type": "array", "items": {"type": "integer"}, "nullable": True},
                                "pivot_only": {"type": "boolean", "nullable": True},
                                "federated": {"type": "boolean", "nullable": True},
                                "db_paths": {"type": "array", "items": {"type": "string"}, "nullable": True},
                                "db_count": {"type": "integer", "nullable": True},
                            },
                        },
                    ]
                },
                "TokenQueryRequest": {
                    "type": "object",
                    "required": ["cql"],
                    "properties": {
                        "cql": {"type": "string"},
                        "mode": {"type": "string", "enum": ["segment", "kwic"], "default": "kwic"},
                        "window": {"type": "integer", "minimum": 0, "default": 10},
                        "language": {"type": "string"},
                        "doc_ids": {"type": "array", "items": {"type": "integer"}},
                        "limit": {"type": "integer", "minimum": 1, "maximum": 200, "default": 50},
                        "offset": {"type": "integer", "minimum": 0, "default": 0},
                        "include_aligned": {
                            "type": "boolean",
                            "default": False,
                            "description": "When true, each hit gains an `aligned` list with partner units from alignment_links.",
                        },
                        "include_context_segments": {
                            "type": "boolean",
                            "default": False,
                            "description": "When true, each hit gains `prev_segment` and `next_segment` fields with the adjacent units in the document (null if none).",
                        },
                    },
                    "additionalProperties": False,
                },
                "AlignedUnit": {
                    "type": "object",
                    "required": ["unit_id", "doc_id", "title", "language", "text_norm"],
                    "properties": {
                        "unit_id": {"type": "integer"},
                        "doc_id": {"type": "integer"},
                        "title": {"type": "string"},
                        "language": {"type": "string"},
                        "text_norm": {"type": "string"},
                        "status": {"type": "string", "nullable": True, "description": "accepted | rejected | null"},
                    },
                },
                "TokenQueryToken": {
                    "type": "object",
                    "required": ["token_id", "position"],
                    "properties": {
                        "token_id": {"type": "integer"},
                        "position": {"type": "integer"},
                        "word": {"type": "string", "nullable": True},
                        "lemma": {"type": "string", "nullable": True},
                        "upos": {"type": "string", "nullable": True},
                        "xpos": {"type": "string", "nullable": True},
                        "feats": {"type": "string", "nullable": True},
                    },
                },
                "TokenQueryHit": {
                    "type": "object",
                    "required": [
                        "doc_id",
                        "unit_id",
                        "external_id",
                        "language",
                        "title",
                        "sent_id",
                        "start_position",
                        "end_position",
                        "tokens",
                        "context_tokens",
                    ],
                    "properties": {
                        "doc_id": {"type": "integer"},
                        "unit_id": {"type": "integer"},
                        "external_id": {"type": "integer", "nullable": True},
                        "language": {"type": "string"},
                        "title": {"type": "string"},
                        "text": {"type": "string"},
                        "text_norm": {"type": "string"},
                        "left": {"type": "string"},
                        "match": {"type": "string"},
                        "right": {"type": "string"},
                        "sent_id": {"type": "integer"},
                        "start_position": {"type": "integer"},
                        "end_position": {"type": "integer"},
                        "tokens": {
                            "type": "array",
                            "items": {"$ref": "#/components/schemas/TokenQueryToken"},
                        },
                        "context_tokens": {
                            "type": "array",
                            "items": {"$ref": "#/components/schemas/TokenQueryToken"},
                        },
                        "unit_n": {"type": "integer", "description": "Position (n) of the unit in the document."},
                        "aligned": {
                            "type": "array",
                            "items": {"$ref": "#/components/schemas/AlignedUnit"},
                            "description": "Partner units from alignment_links (only present when include_aligned=true).",
                        },
                        "prev_segment": {
                            "nullable": True,
                            "description": "Segment immediately before the hit unit (only present when include_context_segments=true).",
                            "properties": {
                                "unit_id": {"type": "integer"},
                                "external_id": {"type": "integer", "nullable": True},
                                "text_norm": {"type": "string"},
                            },
                        },
                        "next_segment": {
                            "nullable": True,
                            "description": "Segment immediately after the hit unit (only present when include_context_segments=true).",
                            "properties": {
                                "unit_id": {"type": "integer"},
                                "external_id": {"type": "integer", "nullable": True},
                                "text_norm": {"type": "string"},
                            },
                        },
                    },
                },
                "TokenQueryResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": [
                                "run_id",
                                "count",
                                "hits",
                                "limit",
                                "offset",
                                "next_offset",
                                "has_more",
                                "total",
                            ],
                            "properties": {
                                "run_id": {"type": "string"},
                                "count": {"type": "integer"},
                                "hits": {"type": "array", "items": {"$ref": "#/components/schemas/TokenQueryHit"}},
                                "limit": {"type": "integer"},
                                "offset": {"type": "integer"},
                                "next_offset": {"type": "integer", "nullable": True},
                                "has_more": {"type": "boolean"},
                                "total": {"type": "integer"},
                            },
                        },
                    ]
                },
                "TokenStatsRequest": {
                    "type": "object",
                    "required": ["cql"],
                    "properties": {
                        "cql": {"type": "string", "description": "CQL query string"},
                        "group_by": {
                            "type": "string",
                            "enum": ["lemma", "upos", "xpos", "word", "feats", "year"],
                            "default": "lemma",
                        },
                        "language": {"type": "string", "nullable": True},
                        "doc_ids": {
                            "type": "array",
                            "items": {"type": "integer"},
                            "nullable": True,
                        },
                        "limit": {"type": "integer", "default": 50, "minimum": 1, "maximum": 200},
                    },
                    "additionalProperties": False,
                },
                "TokenStatsRow": {
                    "type": "object",
                    "required": ["value", "count", "pct"],
                    "properties": {
                        "value": {"type": "string"},
                        "count": {"type": "integer"},
                        "pct": {"type": "number"},
                        # group_by="year" only: per-period denominator + normalised freq.
                        "tokens_in_period": {"type": "integer", "nullable": True},
                        "freq_per_10k": {"type": "number", "nullable": True},
                    },
                },
                "TokenStatsResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["total_hits", "total_pivot_tokens", "group_by", "rows"],
                            "properties": {
                                "total_hits": {"type": "integer"},
                                "total_pivot_tokens": {"type": "integer"},
                                "group_by": {"type": "string"},
                                "rows": {
                                    "type": "array",
                                    "items": {"$ref": "#/components/schemas/TokenStatsRow"},
                                },
                            },
                        },
                    ]
                },
                "TokenCollocatesRequest": {
                    "type": "object",
                    "required": ["cql"],
                    "properties": {
                        "cql": {"type": "string", "description": "CQL query string"},
                        "window": {"type": "integer", "default": 5, "minimum": 1, "maximum": 20},
                        "by": {
                            "type": "string",
                            "enum": ["lemma", "word", "upos", "xpos"],
                            "default": "lemma",
                        },
                        "language": {"type": "string", "nullable": True},
                        "doc_ids": {
                            "type": "array",
                            "items": {"type": "integer"},
                            "nullable": True,
                        },
                        "limit": {"type": "integer", "default": 50, "minimum": 1, "maximum": 200},
                        "min_freq": {"type": "integer", "default": 2, "minimum": 1},
                        "sort_by": {
                            "type": "string",
                            "enum": ["pmi", "ll", "freq"],
                            "default": "pmi",
                        },
                    },
                    "additionalProperties": False,
                },
                "TokenCollocateRow": {
                    "type": "object",
                    "required": ["value", "freq", "left_freq", "right_freq", "corpus_freq", "pmi", "ll"],
                    "properties": {
                        "value": {"type": "string"},
                        "freq": {"type": "integer"},
                        "left_freq": {"type": "integer"},
                        "right_freq": {"type": "integer"},
                        "corpus_freq": {"type": "integer"},
                        "pmi": {"type": "number"},
                        "ll": {"type": "number"},
                    },
                },
                "TokenCollocatesResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": [
                                "total_hits", "total_window_tokens",
                                "corpus_size", "window", "by", "rows",
                            ],
                            "properties": {
                                "total_hits": {"type": "integer"},
                                "total_window_tokens": {"type": "integer"},
                                "corpus_size": {"type": "integer"},
                                "window": {"type": "integer"},
                                "by": {"type": "string"},
                                "rows": {
                                    "type": "array",
                                    "items": {"$ref": "#/components/schemas/TokenCollocateRow"},
                                },
                            },
                        },
                    ]
                },
                "IndexResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["run_id", "units_indexed"],
                            "properties": {
                                "run_id": {"type": "string"},
                                "units_indexed": {"type": "integer"},
                                "incremental": {"type": "boolean"},
                                "inserted": {"type": "integer"},
                                "refreshed": {"type": "integer"},
                                "deleted": {"type": "integer"},
                            },
                        },
                    ]
                },
                # A-03B pilot: derived from the canonical INDEX_SCHEMA (single
                # source shared with _handle_index). Byte-identical to the former
                # hand-written schema — see services/request_schemas.py.
                "IndexRequest": field_schema_to_openapi(
                    INDEX_SCHEMA, additional_properties=False, include_default=False
                ),
                "ImportRequest": {
                    "type": "object",
                    "required": ["mode", "path"],
                    "properties": {
                        "mode": {
                            "type": "string",
                            "enum": [
                                "docx_numbered_lines",
                                "txt_numbered_lines",
                                "docx_paragraphs",
                                "odt_paragraphs",
                                "odt_numbered_lines",
                                "tei",
                                "conllu",
                            ],
                        },
                        "path": {"type": "string"},
                        "language": {"type": "string"},
                        "title": {"type": "string"},
                        "doc_role": {"type": "string"},
                        "resource_type": {"type": "string"},
                        "tei_unit": {"type": "string", "enum": ["p", "s"]},
                        "check_filename": {"type": "boolean"},
                        "family_root_doc_id": {
                            "type": "integer",
                            "nullable": True,
                            "description": (
                                "If provided, a 'translation_of' relation is created from the "
                                "newly imported document to this parent document id."
                            ),
                        },
                        "column_index": {
                            "type": "integer",
                            "nullable": True,
                            "minimum": 1,
                            "description": (
                                "For mode=docx_numbered_lines ONLY. 1-based index of the "
                                "table column to extract (e.g., 1 for original column or 2 "
                                "for the translation column in a 2-col bilingual DOCX). "
                                "Default null = legacy behavior (tables ignored, paragraphs "
                                "only). Ignored silently by other import modes."
                            ),
                        },
                    },
                    "additionalProperties": False,
                },
                "ImportResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["run_id", "mode", "doc_id"],
                            "properties": {
                                "run_id": {"type": "string"},
                                "mode": {"type": "string"},
                                "doc_id": {"type": "integer"},
                                "relation_created": {
                                    "type": "boolean",
                                    "description": "True when a translation_of relation was inserted.",
                                },
                                "relation_id": {
                                    "type": "integer",
                                    "nullable": True,
                                    "description": "Id of the doc_relations row (new or pre-existing).",
                                },
                            },
                        },
                    ]
                },
                "CurateRequest": {
                    "type": "object",
                    "required": ["rules"],
                    "properties": {
                        "rules": {"type": "array", "items": {"type": "object"}},
                        "doc_id": {"type": "integer"},
                    },
                    "additionalProperties": False,
                },
                "CurateResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["docs_curated", "units_modified", "fts_stale", "results"],
                            "properties": {
                                "docs_curated": {"type": "integer"},
                                "units_modified": {"type": "integer"},
                                "fts_stale": {"type": "boolean"},
                                "results": {"type": "array", "items": {"type": "object"}},
                            },
                        },
                    ]
                },
                "ValidateMetaRequest": {
                    "type": "object",
                    "properties": {"doc_id": {"type": "integer"}},
                    "additionalProperties": False,
                },
                "ValidateMetaResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["docs_validated", "results"],
                            "properties": {
                                "docs_validated": {"type": "integer"},
                                "results": {"type": "array", "items": {"type": "object"}},
                            },
                        },
                    ]
                },
                "SegmentSpecInput": {
                    "type": "object",
                    "description": (
                        "R5.4a configurable segmentation boundary. When present on "
                        "/segment(/preview), overrides the legacy mode/lang/pack path."
                    ),
                    "properties": {
                        "kind": {
                            "type": "string",
                            "default": "terminator",
                            "enum": ["terminator", "whitespace", "markers"],
                            "description": (
                                "terminator = split after any `terminators` char; "
                                "whitespace = split into words; markers = split on [N] markers."
                            ),
                        },
                        "terminators": {
                            "type": "string",
                            "default": ".!?",
                            "description": "Cumulable set of boundary characters (terminator kind).",
                        },
                        "require_uppercase_after": {
                            "type": "boolean",
                            "default": True,
                            "description": (
                                "Require a capital/quote after the boundary (terminator kind). "
                                "Turn OFF for clause `;:` or word splitting."
                            ),
                        },
                        "protect_abbreviations": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Abbreviations shielded from false breaks (terminator kind).",
                        },
                        "label": {"type": "string", "description": "Free label echoed back as segment_pack."},
                    },
                    "additionalProperties": False,
                },
                "SegmentPreviewRequest": {
                    "type": "object",
                    "required": ["doc_id"],
                    "properties": {
                        "doc_id": {"type": "integer"},
                        "mode": {
                            "type": "string",
                            "default": "sentences",
                            "enum": ["sentences", "markers"],
                            "description": "'sentences' = rule-based split; 'markers' = split on [N] markers",
                        },
                        "preset": {
                            "type": "string",
                            "enum": ["phrases", "mots", "balises"],
                            "description": "R5.4a — resolve a built-in preset (overrides mode/lang/pack); `spec` wins over `preset`.",
                        },
                        "spec": {"$ref": "#/components/schemas/SegmentSpecInput"},
                        "lang": {"type": "string", "default": "und"},
                        "pack": {
                            "type": "string",
                            "default": "auto",
                            "enum": ["auto", "default", "fr_strict", "en_strict"],
                        },
                        "limit": {
                            "type": "integer",
                            "default": 5000,
                            "minimum": 1,
                            "maximum": 5000,
                            "description": "Maximum number of segments returned.",
                        },
                        "calibrate_to": {
                            "type": "integer",
                            "nullable": True,
                            "description": "doc_id of reference document; adds a ratio warning if segment counts differ by > 15 %",
                        },
                    },
                    "additionalProperties": False,
                },
                "UnitsMergeRequest": {
                    "type": "object",
                    "required": ["doc_id", "n1", "n2"],
                    "properties": {
                        "doc_id": {"type": "integer"},
                        "n1": {"type": "integer", "description": "n of the first (kept) unit"},
                        "n2": {"type": "integer", "description": "n of the second (deleted) unit; must be n1+1"},
                    },
                    "additionalProperties": False,
                },
                "UnitsMergeResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["doc_id", "merged_n", "deleted_n", "text"],
                            "properties": {
                                "doc_id": {"type": "integer"},
                                "merged_n": {"type": "integer"},
                                "deleted_n": {"type": "integer"},
                                "text": {"type": "string"},
                                "fts_stale": {"type": "boolean"},
                                "links_archived": {"type": "integer", "description": "1.6.68 — alignment links this gesture destroyed AND archived (migration 035): 0 when the unit(s) carried none. Reported after the fact rather than pre-confirmed, because a confirmation built on the document's aligned_count would announce a loss that is not the one about to happen."},
                            },
                        },
                    ]
                },
                "UnitsSplitRequest": {
                    "type": "object",
                    "required": ["doc_id", "unit_n", "text_a", "text_b"],
                    "properties": {
                        "doc_id": {"type": "integer"},
                        "unit_n": {"type": "integer"},
                        "text_a": {"type": "string", "description": "Text for the first (existing) unit"},
                        "text_b": {"type": "string", "description": "Text for the new unit inserted at unit_n+1"},
                    },
                    "additionalProperties": False,
                },
                "UnitsSplitResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["doc_id", "unit_n", "new_unit_n", "text_a", "text_b"],
                            "properties": {
                                "doc_id": {"type": "integer"},
                                "unit_n": {"type": "integer"},
                                "new_unit_n": {"type": "integer"},
                                "text_a": {"type": "string"},
                                "text_b": {"type": "string"},
                                "fts_stale": {"type": "boolean"},
                                "links_archived": {"type": "integer", "description": "1.6.68 — alignment links this gesture destroyed AND archived (migration 035): 0 when the unit(s) carried none. Reported after the fact rather than pre-confirmed, because a confirmation built on the document's aligned_count would announce a loss that is not the one about to happen."},
                            },
                        },
                    ]
                },
                "SegmentDetectMarkersRequest": {
                    "type": "object",
                    "required": ["doc_id"],
                    "properties": {
                        "doc_id": {"type": "integer"},
                    },
                    "additionalProperties": False,
                },
                "SegmentDetectMarkersResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["doc_id", "detected", "total_units", "marked_units", "marker_ratio"],
                            "properties": {
                                "doc_id": {"type": "integer"},
                                "detected": {"type": "boolean"},
                                "total_units": {"type": "integer"},
                                "marked_units": {"type": "integer"},
                                "marker_ratio": {"type": "number"},
                                "sample": {"type": "array", "items": {"type": "object"}},
                                "first_markers": {"type": "array", "items": {"type": "integer"}},
                            },
                        },
                    ]
                },
                "SegmentPreviewSegment": {
                    "type": "object",
                    "required": ["n", "text", "source_unit_n"],
                    "properties": {
                        "n": {"type": "integer"},
                        "text": {"type": "string"},
                        "source_unit_n": {"type": "integer", "description": "n of the original unit this segment was produced from"},
                        "external_id": {"type": "integer", "nullable": True, "description": "Marker number if mode=markers"},
                    },
                },
                "SegmentPreviewResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["doc_id", "mode", "units_input", "units_output", "segment_pack", "segments"],
                            "properties": {
                                "doc_id": {"type": "integer"},
                                "mode": {"type": "string", "enum": ["sentences", "markers"]},
                                "units_input": {"type": "integer"},
                                "units_output": {"type": "integer"},
                                "segment_pack": {"type": "string"},
                                "segments": {
                                    "type": "array",
                                    "items": {"$ref": "#/components/schemas/SegmentPreviewSegment"},
                                },
                                "warnings": {"type": "array", "items": {"type": "string"}},
                                "calibrate_to": {"type": "integer", "nullable": True},
                                "calibrate_ratio_pct": {"type": "integer", "nullable": True},
                            },
                        },
                    ]
                },
                "SegmentRequest": {
                    "type": "object",
                    "required": ["doc_id"],
                    "properties": {
                        "doc_id": {"type": "integer"},
                        "preset": {
                            "type": "string",
                            "enum": ["phrases", "mots", "balises"],
                            "description": "R5.4a — resolve a built-in preset (overrides lang/pack); `spec` wins over `preset`.",
                        },
                        "spec": {"$ref": "#/components/schemas/SegmentSpecInput"},
                        "lang": {"type": "string", "default": "und"},
                        "pack": {
                            "type": "string",
                            "default": "auto",
                            "enum": ["auto", "default", "fr_strict", "en_strict"],
                        },
                        "calibrate_to": {
                            "type": "integer",
                            "nullable": True,
                            "description": "doc_id of reference document; adds a ratio warning if segment counts differ by > 15 %",
                        },
                    },
                    "additionalProperties": False,
                },
                "SegmentCoarseRequest": {
                    "type": "object",
                    "required": ["doc_id"],
                    "properties": {
                        "doc_id": {"type": "integer"},
                        "preset": {
                            "type": "string",
                            "enum": ["tours"],
                            "description": "R5.4c — built-in coarse boundary; `tours` opens a block on a leading dialogue dash (— / –). `pattern` wins over `preset`.",
                        },
                        "pattern": {
                            "type": "string",
                            "description": "R5.4c — custom line-start regex that opens a coarse block (e.g. a speaker label). Overrides `preset`.",
                        },
                    },
                    "additionalProperties": False,
                },
                "SegmentParagraphBoundaryRequest": {
                    "type": "object",
                    "required": ["doc_id", "unit_id"],
                    "properties": {
                        "doc_id": {"type": "integer"},
                        "unit_id": {
                            "type": "integer",
                            "description": "R6 — unit_id of the line segment designated as a paragraph start (or, if it already heads a multi-segment block, removed as a boundary). Toggles meta_json.parent_n a block at a time; non-destructive and undoable (Mode A).",
                        },
                    },
                    "additionalProperties": False,
                },
                "FamilySegmentRequest": {
                    "type": "object",
                    "properties": {
                        "pack": {"type": "string", "default": "auto",
                                 "enum": ["auto", "default", "fr_strict", "en_strict"]},
                        "force": {"type": "boolean", "default": False,
                                  "description": "Re-segment even already-segmented documents"},
                        "lang_map": {"type": "object",
                                     "description": "Per-doc language override {doc_id: lang}",
                                     "additionalProperties": {"type": "string"}},
                    },
                    "additionalProperties": False,
                },
                "FamilySegmentDocResult": {
                    "type": "object",
                    "required": ["doc_id", "status", "units_input", "units_output", "warnings"],
                    "properties": {
                        "doc_id": {"type": "integer"},
                        "status": {"type": "string", "enum": ["segmented", "skipped", "error"]},
                        "units_input": {"type": "integer"},
                        "units_output": {"type": "integer"},
                        "segment_pack": {"type": "string", "nullable": True},
                        "warnings": {"type": "array", "items": {"type": "string"}},
                        "calibrate_ratio_pct": {"type": "integer", "nullable": True},
                    },
                },
                "FamilyAlignRequest": {
                    "type": "object",
                    "properties": {
                        "strategy": {
                            "type": "string", "default": "position",
                            "enum": ["external_id", "position", "similarity", "external_id_then_position", "length_bounded"],
                        },
                        "sim_threshold": {"type": "number", "minimum": 0.0, "maximum": 1.0, "default": 0.8},
                        "replace_existing": {"type": "boolean", "default": False,
                                             "description": "Delete previous links before aligning"},
                        "preserve_accepted": {"type": "boolean", "default": True,
                                              "description": "Keep accepted links when replace_existing=true"},
                        "skip_unready": {"type": "boolean", "default": False,
                                         "description": "Skip pairs where child is not segmented (vs. error)"},
                        "target_doc_ids": {
                            "type": "array", "items": {"type": "integer"},
                            "description": "Optional (1.6.77) — align only these children. Omitted = the whole family. An out-of-scope column is neither purged nor realigned nor reported skipped.",
                        },
                    },
                    "additionalProperties": False,
                },
                "FamilyAlignPairResult": {
                    "type": "object",
                    "required": ["pivot_doc_id", "target_doc_id", "status", "links_created", "warnings"],
                    "properties": {
                        "pivot_doc_id": {"type": "integer"},
                        "target_doc_id": {"type": "integer"},
                        "target_lang": {"type": "string"},
                        "relation_type": {"type": "string"},
                        "run_id": {"type": "string", "nullable": True},
                        "status": {"type": "string", "enum": ["aligned", "skipped", "conflict", "error"]},
                        "links_created": {"type": "integer"},
                        "deleted_before": {"type": "integer"},
                        "preserved_before": {"type": "integer"},
                        "warnings": {"type": "array", "items": {"type": "string"}},
                    },
                },
                "ExportTmxRequest": {
                    "type": "object",
                    "properties": {
                        "pivot_doc_id":  {"type": "integer", "nullable": True,
                                          "description": "Required unless family_id is set"},
                        "target_doc_id": {"type": "integer", "nullable": True,
                                          "description": "Required for single-pair export"},
                        "family_id":     {"type": "integer", "nullable": True,
                                          "description": "Export all parent↔child pairs in one TMX"},
                        "out_path":      {"type": "string", "description": "Absolute path for the .tmx file"},
                        "out_dir":       {"type": "string", "description": "Directory; file named automatically"},
                    },
                    "additionalProperties": False,
                },
                "ExportBilingualRequest": {
                    "type": "object",
                    "required": ["pivot_doc_id", "target_doc_id"],
                    "properties": {
                        "pivot_doc_id":   {"type": "integer"},
                        "target_doc_id":  {"type": "integer"},
                        "format":         {"type": "string", "enum": ["html", "txt"], "default": "html"},
                        "out_path":       {"type": "string", "description": "Required unless preview_only=true"},
                        "preview_only":   {"type": "boolean", "default": False,
                                           "description": "Return pairs as JSON without writing a file"},
                        "preview_limit":  {"type": "integer", "default": 20, "minimum": 1, "maximum": 200},
                    },
                    "additionalProperties": False,
                },
                "AcknowledgeSourceChangeRequest": {
                    "type": "object",
                    "properties": {
                        "link_ids": {
                            "type": "array",
                            "items": {"type": "integer"},
                            "description": "Explicit list of link_ids to acknowledge.",
                        },
                        "target_doc_id": {
                            "type": "integer",
                            "description": "Acknowledge all pending links for this target document (bulk).",
                        },
                    },
                    "additionalProperties": False,
                },
                "FamilyCurationStatusResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["family_root_id", "total_pending", "children"],
                            "properties": {
                                "family_root_id": {"type": "integer"},
                                "total_pending": {"type": "integer"},
                                "children": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "required": ["doc_id", "pending_count", "pending"],
                                        "properties": {
                                            "doc_id": {"type": "integer"},
                                            "title": {"type": "string", "nullable": True},
                                            "language": {"type": "string", "nullable": True},
                                            "pending_count": {"type": "integer"},
                                            "pending": {
                                                "type": "array",
                                                "items": {
                                                    "type": "object",
                                                    "properties": {
                                                        "link_id": {"type": "integer"},
                                                        "external_id": {"type": "integer"},
                                                        "pivot_unit_id": {"type": "integer"},
                                                        "pivot_text": {"type": "string"},
                                                        "target_unit_id": {"type": "integer"},
                                                        "target_text": {"type": "string"},
                                                        "source_changed_at": {"type": "string"},
                                                    },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    ]
                },
                "SegmentResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["fts_stale", "doc_id", "units_input", "units_output", "segment_pack", "warnings"],
                            "properties": {
                                "fts_stale": {"type": "boolean"},
                                "doc_id": {"type": "integer"},
                                "units_input": {"type": "integer"},
                                "units_output": {"type": "integer"},
                                "segment_pack": {
                                    "type": "string",
                                    "enum": ["default", "fr_strict", "en_strict"],
                                },
                                "warnings": {"type": "array", "items": {"type": "string"}},
                            },
                        },
                    ]
                },
                "SegmentCoarseResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["doc_id", "blocks", "units_grouped", "units_changed"],
                            "properties": {
                                "doc_id": {"type": "integer"},
                                "blocks": {"type": "integer", "description": "distinct coarse blocks after regrouping"},
                                "units_grouped": {"type": "integer", "description": "line units assigned a parent_n"},
                                "units_changed": {"type": "integer", "description": "line units whose parent_n actually changed"},
                                "action_id": {"type": "integer", "nullable": True, "description": "Mode A undo entry id, or null when nothing changed"},
                            },
                        },
                    ]
                },
                "SegmentParagraphBoundaryResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["doc_id", "unit_id", "unit_n", "units_changed", "blocks"],
                            "properties": {
                                "doc_id": {"type": "integer"},
                                "unit_id": {"type": "integer"},
                                "unit_n": {"type": "integer", "description": "the target's resolved position-independent n"},
                                "units_changed": {"type": "integer", "description": "line units whose parent_n actually moved"},
                                "blocks": {"type": "integer", "description": "distinct coarse blocks after the toggle"},
                                "action_id": {"type": "integer", "nullable": True, "description": "Mode A undo entry id, or null when nothing changed"},
                            },
                        },
                    ]
                },
                "ShutdownResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["shutting_down"],
                            "properties": {
                                "shutting_down": {"type": "boolean"},
                                "message": {"type": "string"},
                            },
                        },
                    ]
                },
                "TelemetryRequest": {
                    "type": "object",
                    "additionalProperties": True,
                    "required": ["event"],
                    "properties": {
                        "event": {
                            "type": "string",
                            "minLength": 1,
                            "description": "Event name (e.g. stage_completed, cap_hit, error_user_facing).",
                        },
                    },
                    "description": (
                        "Free-form telemetry event payload. `event` is the only required "
                        "field; any additional fields (doc_id, stage, duration_ms, etc.) "
                        "are appended verbatim to the NDJSON record."
                    ),
                },
                "JobRecord": {
                    "type": "object",
                    "required": [
                        "job_id",
                        "kind",
                        "status",
                        "progress_pct",
                        "created_at",
                    ],
                    "properties": {
                        "job_id": {"type": "string"},
                        "kind": {"type": "string"},
                        "status": {
                            "type": "string",
                            "enum": ["queued", "running", "done", "error"],
                        },
                        "progress_pct": {"type": "integer", "minimum": 0, "maximum": 100},
                        "progress_message": {"type": "string"},
                        "params": {"type": "object"},
                        "result": {"type": "object"},
                        "error": {"type": "string"},
                        "error_code": {"type": "string"},
                        "created_at": {"type": "string"},
                        "started_at": {"type": "string"},
                        "finished_at": {"type": "string"},
                    },
                    "additionalProperties": False,
                },
                "JobSubmitRequest": {
                    "type": "object",
                    "required": ["kind"],
                    "properties": {
                        "kind": {
                            "type": "string",
                            "enum": ["index", "curate", "validate-meta", "segment"],
                        },
                        "params": {"type": "object"},
                    },
                    "additionalProperties": False,
                },
                "JobAcceptedResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["job"],
                            "properties": {
                                "job": {"$ref": "#/components/schemas/JobRecord"},
                            },
                        },
                    ]
                },
                "JobsListResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["jobs"],
                            "properties": {
                                "jobs": {
                                    "type": "array",
                                    "items": {"$ref": "#/components/schemas/JobRecord"},
                                },
                            },
                        },
                    ]
                },
                "RunRecord": {
                    "type": "object",
                    "required": ["run_id", "kind", "created_at"],
                    "properties": {
                        "run_id": {"type": "string"},
                        "kind": {"type": "string"},
                        "created_at": {"type": "string"},
                        "params": {"type": "object", "nullable": True},
                        "stats": {"type": "object", "nullable": True},
                    },
                },
                # ── ShareDocs / WebDAV ingestion — Phase 2 ───────────────────
                "WebdavAuth": {
                    "type": "object",
                    "description": (
                        "WebDAV credentials. Sent in the request body on loopback only and used "
                        "solely to build the outbound Authorization header. NEVER persisted: not in "
                        "the DB, runs.params, job params (/jobs/<id>), request logs, or telemetry."
                    ),
                    "properties": {
                        "mode": {"type": "string", "enum": ["anonymous", "basic", "bearer"], "default": "anonymous"},
                        "user": {"type": "string", "description": "Username (mode=basic)"},
                        "password": {"type": "string", "description": "Password (mode=basic)"},
                        "token": {"type": "string", "description": "Bearer token (mode=bearer)"},
                    },
                },
                "RemoteEntry": {
                    "type": "object",
                    "required": ["name", "href", "is_dir"],
                    "properties": {
                        "name": {"type": "string"},
                        "href": {"type": "string", "description": "Absolute URL of the entry (same-origin with the request)"},
                        "is_dir": {"type": "boolean"},
                        "size": {"type": "integer", "nullable": True},
                        "modified": {"type": "string", "nullable": True},
                        "content_type": {"type": "string", "nullable": True},
                    },
                },
                "WebdavListRequest": {
                    "type": "object",
                    "required": ["url"],
                    "properties": {
                        "url": {"type": "string", "description": "WebDAV collection (folder) URL"},
                        "auth": {"$ref": "#/components/schemas/WebdavAuth"},
                    },
                },
                "WebdavListResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["entries"],
                            "properties": {
                                "entries": {
                                    "type": "array",
                                    "items": {"$ref": "#/components/schemas/RemoteEntry"},
                                },
                            },
                        },
                    ]
                },
                "WebdavProbeRequest": {
                    "type": "object",
                    "required": ["url"],
                    "properties": {
                        "url": {"type": "string", "description": "WebDAV folder (collection) URL"},
                        "hrefs": {
                            "type": "array",
                            "items": {"type": "string"},
                            "nullable": True,
                            "description": "Explicit file hrefs to probe. Intersected with the folder listing (an unlisted href is ignored, never fetched), bypasses the include glob. Omit to probe the whole folder.",
                        },
                        "include": {
                            "type": "string",
                            "description": "Optional glob (e.g. '*.docx') restricting which files are probed.",
                        },
                        "auth": {"$ref": "#/components/schemas/WebdavAuth"},
                        "max_file_mb": {
                            "type": "number",
                            "description": "Per-file size cap in MB (default 200). Oversize files are reported, never downloaded.",
                        },
                        "limit": {
                            "type": "integer",
                            "description": "Units returned per file (default 50, max 500). The counts (units_total / units_line / units_structure) always cover the WHOLE file.",
                        },
                    },
                },
                "ImportRemoteRequest": {
                    "type": "object",
                    "required": ["url", "mode"],
                    "properties": {
                        "url": {"type": "string", "description": "WebDAV folder (collection) URL"},
                        "mode": {
                            "type": "string",
                            "enum": [
                                "docx_numbered_lines",
                                "txt_numbered_lines",
                                "docx_paragraphs",
                                "odt_paragraphs",
                                "odt_numbered_lines",
                                "tei",
                                "conllu",
                            ],
                        },
                        "language": {"type": "string"},
                        "include": {
                            "type": "string",
                            "description": "Optional glob (e.g. '*.docx') overriding the mode's default extension filter",
                        },
                        "hrefs": {
                            "type": "array",
                            "items": {"type": "string"},
                            "nullable": True,
                            "description": "Explicit file hrefs to import (P4C). Intersected with the folder listing (an unlisted href is ignored), bypasses the include glob. Omit to import the whole folder.",
                        },
                        "modes": {
                            "type": "object",
                            "nullable": True,
                            "additionalProperties": {"type": "string"},
                            "description": "Per-file import mode (SD-01), keyed by href — typically what POST /webdav/probe deduced for each document. Overrides `mode` for the files it names, which then also bypass the batch extension filter; files absent from the map fall back to `mode`. Each value must be a supported import mode.",
                        },
                        "auth": {"$ref": "#/components/schemas/WebdavAuth"},
                        "doc_role": {"type": "string"},
                        "resource_type": {"type": "string"},
                        "max_file_mb": {
                            "type": "number",
                            "default": 200,
                            "description": "Per-file size cap (MiB); files above are reported skipped-oversize",
                        },
                    },
                },
                "RunsListResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["runs", "limit"],
                            "properties": {
                                "runs": {
                                    "type": "array",
                                    "items": {"$ref": "#/components/schemas/RunRecord"},
                                },
                                "limit": {"type": "integer"},
                            },
                        },
                    ]
                },
                "AnnotateRequest": {
                    "type": "object",
                    "properties": {
                        "doc_id": {"type": "integer"},
                        "all_docs": {"type": "boolean", "default": False},
                        "model": {"type": "string", "nullable": True},
                    },
                    "additionalProperties": False,
                },
                "DocumentRecord": {
                    "type": "object",
                    "required": ["doc_id", "title", "language", "unit_count"],
                    "properties": {
                        "doc_id": {"type": "integer"},
                        "title": {"type": "string"},
                        "language": {"type": "string"},
                        "doc_role": {"type": "string", "nullable": True},
                        "resource_type": {"type": "string", "nullable": True},
                        "workflow_status": {
                            "type": "string",
                            "enum": ["draft", "review", "validated"],
                            "default": "draft",
                        },
                        "validated_at": {"type": "string", "nullable": True},
                        "validated_run_id": {"type": "string", "nullable": True},
                        "source_path": {"type": "string", "nullable": True},
                        "source_hash": {"type": "string", "nullable": True},
                        "author_lastname": {"type": "string", "nullable": True},
                        "author_firstname": {"type": "string", "nullable": True},
                        "doc_date": {"type": "string", "nullable": True},
                        "notes": {"type": "string", "nullable": True, "description": "Free-text document-level notes-to-self (R6.1); ≠ doc_relations.note"},
                        "meta_json": {"type": "object", "nullable": True, "description": "Parsed documents.meta_json (R6.3): importer provenance keys alongside user-entered type-specific / ad-hoc fields under the `fields` key", "additionalProperties": True},
                        "unit_count": {"type": "integer"},
                        "token_count": {"type": "integer"},
                        "annotation_status": {
                            "type": "string",
                            "enum": ["missing", "annotated"],
                        },
                        "fts_stale": {
                            "type": "boolean",
                            "description": (
                                "True when the FTS index is stale for this doc "
                                "(>= 1 line unit absent/divergent in fts_units). "
                                "Derived live, not a persisted flag."
                            ),
                        },
                        "curated_at": {
                            "type": "string",
                            "nullable": True,
                            "description": (
                                "ISO timestamp of the latest non-reverted curation apply "
                                "that modified this document's text (prep_action_history, "
                                "action_type='curation_apply'). Null when curation never "
                                "changed anything here. Derived live, not a persisted column "
                                "(ACT-01)."
                            ),
                        },
                        "aligned_count": {
                            "type": "integer",
                            "description": (
                                "Number of alignment_links touching this document, as pivot "
                                "or as target. 0 = never aligned. Derived live; unlike "
                                "/families it also covers documents outside any family "
                                "(ACT-01)."
                            ),
                        },
                    },
                    "additionalProperties": False,
                },
                "DocumentsResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["documents", "count"],
                            "properties": {
                                "documents": {
                                    "type": "array",
                                    "items": {"$ref": "#/components/schemas/DocumentRecord"},
                                },
                                "count": {"type": "integer"},
                                "fts_readable": {"type": "boolean", "description": "false when the FTS index cannot be read at all (corrupted pages, or virtual table dropped from the schema) — distinct from zero stale documents (FTS-01)"},
                                "fts_repairable": {"type": "boolean", "description": "true when the unreadable index can be rebuilt from inside the app (declaration dropped from the schema); false for corrupted pages, which need an offline rebuild, and false whenever the index reads (FTS-01)"},
                            },
                        },
                    ]
                },
                "DocumentPreviewLine": {
                    "type": "object",
                    "required": ["unit_id", "n", "text"],
                    "properties": {
                        "unit_id": {"type": "integer"},
                        "n": {"type": "integer"},
                        "external_id": {"type": "integer", "nullable": True},
                        "text": {"type": "string"},
                        "unit_role": {"type": "string", "nullable": True},
                        "text_raw": {"type": "string", "nullable": True},
                        "text_source": {"type": "string", "nullable": True},
                    },
                    "additionalProperties": False,
                },
                "DocumentPreviewResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["doc", "lines", "count", "total_lines", "limit"],
                            "properties": {
                                "doc": {"$ref": "#/components/schemas/DocumentRecord"},
                                "lines": {
                                    "type": "array",
                                    "items": {"$ref": "#/components/schemas/DocumentPreviewLine"},
                                },
                                "count": {"type": "integer"},
                                "total_lines": {"type": "integer"},
                                "limit": {"type": "integer"},
                            },
                        },
                    ]
                },
                "TokenRecord": {
                    "type": "object",
                    "required": [
                        "token_id",
                        "doc_id",
                        "unit_id",
                        "unit_n",
                        "external_id",
                        "sent_id",
                        "position",
                    ],
                    "properties": {
                        "token_id": {"type": "integer"},
                        "doc_id": {"type": "integer"},
                        "unit_id": {"type": "integer"},
                        "unit_n": {"type": "integer"},
                        "external_id": {"type": "integer", "nullable": True},
                        "sent_id": {"type": "integer"},
                        "position": {"type": "integer"},
                        "word": {"type": "string", "nullable": True},
                        "lemma": {"type": "string", "nullable": True},
                        "upos": {"type": "string", "nullable": True},
                        "xpos": {"type": "string", "nullable": True},
                        "feats": {"type": "string", "nullable": True},
                        "misc": {"type": "string", "nullable": True},
                    },
                    "additionalProperties": False,
                },
                "TokensResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": [
                                "doc_id",
                                "tokens",
                                "count",
                                "total",
                                "limit",
                                "offset",
                                "next_offset",
                                "has_more",
                            ],
                            "properties": {
                                "doc_id": {"type": "integer"},
                                "unit_id": {"type": "integer", "nullable": True},
                                "tokens": {"type": "array", "items": {"$ref": "#/components/schemas/TokenRecord"}},
                                "count": {"type": "integer"},
                                "total": {"type": "integer"},
                                "limit": {"type": "integer"},
                                "offset": {"type": "integer"},
                                "next_offset": {"type": "integer", "nullable": True},
                                "has_more": {"type": "boolean"},
                            },
                        },
                    ]
                },
                "TokenUpdateRequest": {
                    "type": "object",
                    "required": ["token_id"],
                    "properties": {
                        "token_id": {"type": "integer"},
                        "word": {"type": "string", "nullable": True},
                        "lemma": {"type": "string", "nullable": True},
                        "upos": {"type": "string", "nullable": True},
                        "xpos": {"type": "string", "nullable": True},
                        "feats": {"type": "string", "nullable": True},
                        "misc": {"type": "string", "nullable": True},
                    },
                    "additionalProperties": False,
                },
                "TokenUpdateResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["updated", "token"],
                            "properties": {
                                "updated": {"type": "integer"},
                                "token": {"$ref": "#/components/schemas/TokenRecord"},
                            },
                        },
                    ]
                },
                "AlignRequest": {
                    "type": "object",
                    "required": ["pivot_doc_id", "target_doc_ids"],
                    "properties": {
                        "pivot_doc_id": {"type": "integer"},
                        "target_doc_ids": {
                            "type": "array",
                            "items": {"type": "integer"},
                            "minItems": 1,
                        },
                        "strategy": {
                            "type": "string",
                            "enum": ["external_id", "position", "similarity", "external_id_then_position", "length_bounded"],
                            "default": "external_id",
                        },
                        "relation_type": {
                            "type": "string",
                            "default": "translation",
                            "description": (
                                "Stored in run params for traceability. "
                                "Not yet applied functionally to alignment_links — "
                                "tracked as known drift (ADR-009, v1.4.1)."
                            ),
                        },
                        "sim_threshold": {"type": "number", "minimum": 0.0, "maximum": 1.0, "default": 0.8},
                        "debug_align": {"type": "boolean", "default": False},
                        "replace_existing": {
                            "type": "boolean",
                            "default": False,
                            "description": (
                                "If true, remove previous links for the pivot/target scope "
                                "before creating a new alignment run."
                            ),
                        },
                        "preserve_accepted": {
                            "type": "boolean",
                            "default": True,
                            "description": (
                                "When replace_existing=true, keep links with status='accepted' "
                                "and treat them as protected anchors."
                            ),
                        },
                        "run_id": {"type": "string"},
                    },
                    "additionalProperties": False,
                },
                "AlignResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["run_id", "strategy", "pivot_doc_id", "reports"],
                            "properties": {
                                "run_id": {"type": "string"},
                                "strategy": {"type": "string"},
                                "pivot_doc_id": {"type": "integer"},
                                "debug_align": {"type": "boolean"},
                                "replace_existing": {"type": "boolean"},
                                "preserve_accepted": {"type": "boolean"},
                                "deleted_before": {"type": "integer"},
                                "preserved_before": {"type": "integer"},
                                "total_links_created": {"type": "integer"},
                                "total_effective_links": {"type": "integer"},
                                "reports": {"type": "array", "items": {"type": "object"}},
                            },
                        },
                    ]
                },
                "CuratePreviewRequest": {
                    "type": "object",
                    "required": ["doc_id", "rules"],
                    "properties": {
                        "doc_id": {"type": "integer"},
                        "rules": {"type": "array", "items": {"type": "object"}},
                        "limit_examples": {"type": "integer", "minimum": 1, "maximum": 5000, "default": 10},
                    },
                    "additionalProperties": False,
                },
                "CuratePreviewExample": {
                    "type": "object",
                    "required": ["unit_id", "before", "after"],
                    "properties": {
                        "unit_id": {"type": "integer"},
                        "external_id": {"type": "integer", "nullable": True},
                        "before": {"type": "string"},
                        "after": {"type": "string"},
                    },
                    "additionalProperties": False,
                },
                "CuratePreviewResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["doc_id", "stats", "examples"],
                            "properties": {
                                "doc_id": {"type": "integer"},
                                "stats": {
                                    "type": "object",
                                    "required": ["units_total", "units_changed", "replacements_total"],
                                    "properties": {
                                        "units_total": {"type": "integer"},
                                        "units_changed": {"type": "integer"},
                                        "replacements_total": {"type": "integer"},
                                    },
                                },
                                "examples": {
                                    "type": "array",
                                    "items": {"$ref": "#/components/schemas/CuratePreviewExample"},
                                },
                                "fts_stale": {"type": "boolean"},
                            },
                        },
                    ]
                },
                "AlignRunUndoRequest": {
                    "type": "object",
                    "required": ["run_id"],
                    "properties": {"run_id": {"type": "string", "description": "the alignment run to revert"}},
                },
                "AlignRunUndoResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["run_id", "links_deleted", "links_kept", "links_restored", "links_not_restored"],
                            "properties": {
                                "run_id": {"type": "string"},
                                "links_deleted": {"type": "integer", "description": "links the run had created, now removed"},
                                "links_kept": {"type": "integer", "description": "links the run created but a human reviewed since — kept, not deleted"},
                                "links_restored": {"type": "integer", "description": "purged links put back from the archive, identical (link_id and src_run_id included)"},
                                "links_not_restored": {"type": "integer", "description": "archived links skipped: pair re-occupied, or one of their units no longer exists"},
                                "reason": {"type": "string", "nullable": True},
                            },
                        },
                    ]
                },
                "AlignBatchUndoRequest": {
                    "type": "object",
                    "required": ["op_id"],
                    "properties": {"op_id": {"type": "integer", "description": "the batch operation to undo, as returned by batch_update / collisions.resolve"}},
                },
                "AlignBatchUndoResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["op_id", "description", "updated", "reinserted", "deleted", "skipped"],
                            "properties": {
                                "op_id": {"type": "integer"},
                                "description": {"type": "string", "description": "the archived gesture's label, as the banner displayed it"},
                                "updated": {"type": "integer", "description": "links that survived the gesture and got their columns back"},
                                "reinserted": {"type": "integer", "description": "links the gesture had deleted, put back with their original link_id"},
                                "deleted": {"type": "integer", "description": "links the gesture had CREATED: undoing it removes them (multi-request gestures)"},
                                "skipped": {"type": "integer", "description": "links that could not come back: a unit is gone, or the pair is re-occupied"},
                            },
                        },
                    ]
                },
                "AlignQualityRequest": {
                    "type": "object",
                    "required": ["pivot_doc_id", "target_doc_id"],
                    "properties": {
                        "pivot_doc_id": {"type": "integer"},
                        "target_doc_id": {"type": "integer"},
                        "run_id": {"type": "string", "nullable": True},
                    },
                    "additionalProperties": False,
                },
                "AlignQualityResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["pivot_doc_id", "target_doc_id", "stats"],
                            "properties": {
                                "pivot_doc_id": {"type": "integer"},
                                "target_doc_id": {"type": "integer"},
                                "run_id": {"type": "string", "nullable": True},
                                "stats": {
                                    "type": "object",
                                    "required": [
                                        "total_pivot_units", "total_target_units",
                                        "total_links", "covered_pivot_units", "covered_target_units",
                                        "coverage_pct", "orphan_pivot_count", "orphan_target_count",
                                        "collision_count", "status_counts",
                                    ],
                                    "properties": {
                                        "total_pivot_units": {"type": "integer"},
                                        "total_target_units": {"type": "integer"},
                                        "total_links": {"type": "integer"},
                                        "covered_pivot_units": {"type": "integer"},
                                        "covered_target_units": {"type": "integer"},
                                        "coverage_pct": {"type": "number"},
                                        "orphan_pivot_count": {"type": "integer"},
                                        "orphan_target_count": {"type": "integer"},
                                        "collision_count": {"type": "integer", "description": "pivot segments carrying more than one bead"},
                                        "shared_target_count": {"type": "integer", "description": "target sentences claimed by more than one pivot segment (the other axis — ALI-22)"},
                                        "status_counts": {
                                            "type": "object",
                                            "properties": {
                                                "unreviewed": {"type": "integer"},
                                                "accepted": {"type": "integer"},
                                                "rejected": {"type": "integer"},
                                            },
                                        },
                                    },
                                },
                                "sample_orphan_pivot": {"type": "array", "items": {"type": "object"}},
                                "sample_orphan_target": {"type": "array", "items": {"type": "object"}},
                            },
                        },
                    ]
                },
                "AlignAuditRequest": {
                    "type": "object",
                    "required": ["pivot_doc_id", "target_doc_id"],
                    "properties": {
                        "pivot_doc_id": {"type": "integer"},
                        "target_doc_id": {"type": "integer"},
                        "limit": {"type": "integer", "minimum": 1, "maximum": 200, "default": 50},
                        "offset": {"type": "integer", "minimum": 0, "default": 0},
                        "external_id": {"type": "integer"},
                        "status": {
                            "type": "string",
                            "enum": ["accepted", "rejected", "unreviewed"],
                            "nullable": True,
                        },
                        "include_explain": {
                            "type": "boolean",
                            "default": False,
                            "description": "Attach explain object to each link (strategy + notes). Default false (no-op).",
                        },
                    },
                    "additionalProperties": False,
                },
                "AlignLinkRecord": {
                    "type": "object",
                    "required": ["link_id", "pivot_unit_id", "target_unit_id", "pivot_text", "target_text"],
                    "properties": {
                        "link_id": {"type": "integer"},
                        "external_id": {"type": "integer", "nullable": True, "description": "The key that MATCHED, not a segment number: the pivot's [N] marker (external_id strategies) or its position n (position/similarity/length_bounded). Display pivot_segment instead."},
                        "pivot_segment": {"type": "integer", "nullable": True, "description": "1-based rank of the pivot among its document's line units — the very number the matrix shows in its `segment` column. Derived, never stored (1.6.76). Null on a pre-1.6.76 sidecar."},
                        "pivot_unit_id": {"type": "integer"},
                        "target_unit_id": {"type": "integer"},
                        "pivot_text": {"type": "string"},
                        "target_text": {"type": "string"},
                        "status": {"type": "string", "nullable": True, "enum": ["accepted", "rejected"]},
                        "bead_id": {"type": "integer", "nullable": True, "description": "Groups the 1-1 links of one N-M bead (length_bounded strategy, R3.2); null for plain 1-1 / legacy / manual links."},
                        "target_text_raw": {"type": "string", "description": "Verbatim target text (units.text_raw) — the string the source-anchored cut offsets index."},
                        "target_char_start": {"type": "integer", "nullable": True, "description": "Source-anchored cut (R3.3): start offset into target_text_raw; null = whole unit."},
                        "target_char_end": {"type": "integer", "nullable": True, "description": "Source-anchored cut (R3.3): end offset (exclusive) into target_text_raw; null = whole unit."},
                        "explain": {
                            "type": "object",
                            "nullable": True,
                            "description": "Present when include_explain=true.",
                            "properties": {
                                "strategy": {"type": "string"},
                                "notes": {"type": "array", "items": {"type": "string"}},
                            },
                        },
                    },
                    "additionalProperties": False,
                },
                "AlignAuditResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": [
                                "pivot_doc_id", "target_doc_id",
                                "limit", "offset", "has_more", "next_offset", "stats", "links",
                            ],
                            "properties": {
                                "pivot_doc_id": {"type": "integer"},
                                "target_doc_id": {"type": "integer"},
                                "limit": {"type": "integer"},
                                "offset": {"type": "integer"},
                                "has_more": {"type": "boolean"},
                                "next_offset": {"type": "integer", "nullable": True},
                                "stats": {
                                    "type": "object",
                                    "properties": {
                                        "links_returned": {"type": "integer"},
                                    },
                                },
                                "links": {
                                    "type": "array",
                                    "items": {"$ref": "#/components/schemas/AlignLinkRecord"},
                                },
                            },
                        },
                    ]
                },
                # ── V0.4A — Metadata ─────────────────────────────────────────
                "DocumentUpdateRequest": {
                    "type": "object",
                    "required": ["doc_id"],
                    "properties": {
                        "doc_id": {"type": "integer"},
                        "title": {"type": "string"},
                        "language": {"type": "string"},
                        "doc_role": {"type": "string"},
                        "resource_type": {"type": "string"},
                        "workflow_status": {
                            "type": "string",
                            "enum": ["draft", "review", "validated"],
                        },
                        "validated_run_id": {"type": "string", "nullable": True},
                        "author_lastname": {"type": "string", "nullable": True},
                        "author_firstname": {"type": "string", "nullable": True},
                        "doc_date": {"type": "string", "nullable": True},
                        "notes": {"type": "string", "nullable": True},
                        "meta": {"type": "object", "nullable": True, "description": "R6.3 type-specific / ad-hoc metadata fields; merged into documents.meta_json under the `fields` key (importer provenance keys preserved). Empty values drop the field.", "additionalProperties": True},
                    },
                },
                "DocumentBulkUpdateRequest": {
                    "type": "object",
                    "required": ["updates"],
                    "properties": {
                        "updates": {
                            "type": "array",
                            "items": {"$ref": "#/components/schemas/DocumentUpdateRequest"},
                        },
                    },
                },
                "DocRelationRecord": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "integer"},
                        "doc_id": {"type": "integer"},
                        "relation_type": {"type": "string"},
                        "target_doc_id": {"type": "integer"},
                        "note": {"type": "string", "nullable": True},
                        "created_at": {"type": "string"},
                    },
                },
                "DocRelationSetRequest": {
                    "type": "object",
                    "required": ["doc_id", "relation_type", "target_doc_id"],
                    "properties": {
                        "doc_id": {"type": "integer"},
                        "relation_type": {"type": "string"},
                        "target_doc_id": {"type": "integer"},
                        "note": {"type": "string", "nullable": True},
                    },
                },
                # ── V0.4B — Exports ───────────────────────────────────────────
                "ExportTeiRequest": {
                    "type": "object",
                    "required": ["out_dir"],
                    "properties": {
                        "doc_ids": {"type": "array", "items": {"type": "integer"}, "nullable": True},
                        "out_dir": {"type": "string"},
                        "include_structure": {
                            "type": "boolean",
                            "default": False,
                            "description": "Emit <head> elements for structure units in addition to body units.",
                        },
                        "relation_type": {
                            "type": "string",
                            "enum": ["none", "translation_of", "excerpt_of", "all"],
                            "default": "none",
                            "description": "Relation filter for TEI listRelation (none disables relation export).",
                        },
                    },
                },
                "ExportConlluRequest": {
                    "type": "object",
                    "required": ["out_path"],
                    "properties": {
                        "doc_ids": {"type": "array", "items": {"type": "integer"}, "nullable": True},
                        "out_path": {"type": "string"},
                    },
                },
                "ExportTokenQueryCsvRequest": {
                    "type": "object",
                    "required": ["out_path", "cql"],
                    "properties": {
                        "out_path": {"type": "string"},
                        "cql": {"type": "string"},
                        "mode": {"type": "string", "enum": ["segment", "kwic"], "default": "kwic"},
                        "window": {"type": "integer", "minimum": 0, "default": 10},
                        "language": {"type": "string", "nullable": True},
                        "doc_ids": {"type": "array", "items": {"type": "integer"}, "nullable": True},
                        "delimiter": {"type": "string", "enum": [",", "\t"], "default": ","},
                        "max_hits": {"type": "integer", "minimum": 1, "maximum": 100000, "default": 10000},
                    },
                },
                "ExportSkeRequest": {
                    "type": "object",
                    "required": ["out_path"],
                    "properties": {
                        "out_path": {"type": "string"},
                        "doc_ids": {"type": "array", "items": {"type": "integer"}, "nullable": True},
                    },
                },
                "ExportAlignCsvRequest": {
                    "type": "object",
                    "required": ["out_path"],
                    "properties": {
                        "pivot_doc_id": {"type": "integer", "nullable": True},
                        "target_doc_id": {"type": "integer", "nullable": True},
                        "out_path": {"type": "string"},
                        "delimiter": {"type": "string", "default": ","},
                    },
                },
                "AlignMatrixRequest": {
                    "type": "object",
                    "required": ["family_root_id"],
                    "properties": {
                        "family_root_id": {"type": "integer", "description": "The hub (parent/original) doc — rows = its segments, columns = it + its translations."},
                        "target_doc_ids": {
                            "type": "array", "items": {"type": "integer"},
                            "description": "Optional (1.6.77) — project only these translation columns. Omitted = all of them (historical behaviour). A doc that is not a translation of this family is a 400.",
                        },
                    },
                },
                "ExportMatrixRequest": {
                    "type": "object",
                    "required": ["family_root_id", "out_path"],
                    "properties": {
                        "family_root_id": {"type": "integer", "description": "The hub (parent/original) doc — rows = its segments, columns = it + its translations."},
                        "out_path": {"type": "string"},
                        "delimiter": {"type": "string", "default": ","},
                    },
                },
                "ExportRunReportRequest": {
                    "type": "object",
                    "required": ["out_path"],
                    "properties": {
                        "run_id": {"type": "string", "nullable": True},
                        "out_path": {"type": "string"},
                        "format": {"type": "string", "enum": ["jsonl", "html"], "default": "jsonl"},
                    },
                },
                "DbBackupRequest": {
                    "type": "object",
                    "properties": {
                        "out_dir": {"type": "string", "description": "Optional destination directory. Default: DB directory. Mutually exclusive with out_path."},
                        "out_path": {"type": "string", "description": "Exact destination file path (e.g. /path/to/corpus.db). Mutually exclusive with out_dir. Returns 409 if file exists."},
                    },
                    "additionalProperties": False,
                },
                "DbBackupResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["source_db_path", "backup_path", "file_size_bytes", "created_at"],
                            "properties": {
                                "source_db_path": {"type": "string"},
                                "backup_path": {"type": "string"},
                                "file_size_bytes": {"type": "integer"},
                                "created_at": {"type": "string"},
                            },
                        },
                    ],
                },
                "CorpusInfoRecord": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string", "nullable": True},
                        "description": {"type": "string", "nullable": True},
                        "meta": {"type": "object", "additionalProperties": True},
                        "updated_at": {"type": "string", "nullable": True},
                    },
                },
                "CorpusInfoPatchRequest": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string", "nullable": True},
                        "description": {"type": "string", "nullable": True},
                        "meta": {"type": "object", "nullable": True, "additionalProperties": True},
                    },
                    "additionalProperties": False,
                },
                "CorpusInfoResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["corpus"],
                            "properties": {
                                "corpus": {"$ref": "#/components/schemas/CorpusInfoRecord"},
                            },
                        },
                    ],
                },
                # ── V1.4.9 — Corpus audit ────────────────────────────────────
                "CorpusAuditResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["total_docs", "total_issues", "missing_fields",
                                         "empty_documents", "duplicate_hashes",
                                         "duplicate_filenames", "duplicate_titles", "families"],
                            "properties": {
                                "total_docs":   {"type": "integer"},
                                "total_issues": {"type": "integer"},
                                "missing_fields": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "doc_id":  {"type": "integer"},
                                            "title":   {"type": "string"},
                                            "missing": {"type": "array", "items": {"type": "string"}},
                                        },
                                    },
                                },
                                "empty_documents": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "doc_id": {"type": "integer"},
                                            "title":  {"type": "string"},
                                        },
                                    },
                                },
                                "duplicate_hashes": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "hash_prefix": {"type": "string"},
                                            "doc_ids": {"type": "array", "items": {"type": "integer"}},
                                        },
                                    },
                                },
                                "duplicate_filenames": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "filename": {"type": "string"},
                                            "doc_ids": {"type": "array", "items": {"type": "integer"}},
                                        },
                                    },
                                },
                                "duplicate_titles": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "title": {"type": "string"},
                                            "doc_ids": {"type": "array", "items": {"type": "integer"}},
                                        },
                                    },
                                },
                                "families": {
                                    "type": "object",
                                    "description": "Family-level audit checks (Sprint 4)",
                                    "properties": {
                                        "ratio_threshold_pct": {"type": "integer"},
                                        "total_family_issues": {"type": "integer"},
                                        "orphan_docs": {
                                            "type": "array",
                                            "items": {"type": "object"},
                                            "description": "Children whose parent doc is absent from the corpus",
                                        },
                                        "unsegmented_children": {
                                            "type": "array",
                                            "items": {"type": "object"},
                                            "description": "Children (or their parents) with 0 line units",
                                        },
                                        "unaligned_pairs": {
                                            "type": "array",
                                            "items": {"type": "object"},
                                            "description": "Segmented pairs with no alignment links",
                                        },
                                        "ratio_warnings": {
                                            "type": "array",
                                            "items": {"type": "object"},
                                            "description": "Pairs where |child_segs - parent_segs| / parent_segs > threshold",
                                        },
                                    },
                                },
                            },
                        },
                    ],
                },
                # ── V0.4C — Align link editing ───────────────────────────────
                "AlignLinkUpdateStatusRequest": {
                    "type": "object",
                    "required": ["link_id", "status"],
                    "properties": {
                        "link_id": {"type": "integer"},
                        "status": {"type": "string", "enum": ["accepted", "rejected"], "nullable": True},
                    },
                },
                "AlignLinkDeleteRequest": {
                    "type": "object",
                    "required": ["link_id"],
                    "properties": {
                        "link_id": {"type": "integer"},
                    },
                },
                "AlignLinkRetargetRequest": {
                    "type": "object",
                    "required": ["link_id", "new_target_unit_id"],
                    "properties": {
                        "link_id": {"type": "integer"},
                        "new_target_unit_id": {"type": "integer"},
                    },
                },
                # ── V1.3 — Batch align link operations ──────────────────────
                "AlignBatchAction": {
                    "type": "object",
                    "required": ["action", "link_id"],
                    "properties": {
                        "action": {"type": "string", "enum": ["set_status", "delete", "set_target_span", "clear_target_span", "set_bead", "clear_bead", "set_pivot"]},
                        "link_id": {"type": "integer"},
                        "status": {"type": "string", "enum": ["accepted", "rejected"], "nullable": True},
                        "char_start": {"type": "integer", "description": "set_target_span: start offset into the target unit's text_raw (0-based)."},
                        "char_end": {"type": "integer", "description": "set_target_span: end offset (exclusive) into text_raw; 0 <= char_start <= char_end <= len(text_raw)."},
                        # 1.6.57 (D-W16): set_bead / clear_bead take no extra field — the
                        # bead_uid is DERIVED server-side from the link's own (pivot_unit_id,
                        # target_doc_id), so a cell holding several links is one bead (1 hub ↔
                        # N targets) instead of a phantom collision. clear_bead sets it back to
                        # NULL (singleton).
                        # 1.6.60 (RA-D1): set_pivot re-anchors the link onto a different
                        # hub/pivot segment — symmetric to retarget's target move. Only
                        # pivot_unit_id changes (status/target/span preserved, bead_uid cleared).
                        "new_pivot_unit_id": {"type": "integer", "description": "set_pivot: the hub/pivot unit to re-anchor the link onto; must be a line unit of the link's own hub document."},
                    },
                },
                "AlignLinksBatchUpdateRequest": {
                    "type": "object",
                    "required": ["actions"],
                    "properties": {
                        "actions": {
                            "type": "array",
                            "minItems": 1,
                            "items": {"$ref": "#/components/schemas/AlignBatchAction"},
                        },
                        "atomic": {
                            "type": "boolean",
                            "default": False,
                            "description": "All-or-nothing (1.6.54): on any action error the whole batch is rolled back (applied/deleted=0, rolled_back=true). Default false = historical independent-actions semantics.",
                        },
                    },
                },
                # ── V1.4 — Retarget candidates ───────────────────────────────
                "RetargetCandidatesRequest": {
                    "type": "object",
                    "required": ["pivot_unit_id", "target_doc_id"],
                    "properties": {
                        "pivot_unit_id": {"type": "integer"},
                        "target_doc_id": {"type": "integer"},
                        "limit": {"type": "integer", "minimum": 1, "maximum": 50, "default": 10},
                        "window": {"type": "integer", "minimum": 1, "maximum": 20, "default": 5},
                    },
                },
                "RetargetCandidate": {
                    "type": "object",
                    "required": ["target_unit_id", "target_text", "score", "reason"],
                    "properties": {
                        "target_unit_id": {"type": "integer"},
                        "external_id": {"type": "integer", "nullable": True},
                        "target_text": {"type": "string"},
                        "score": {"type": "number"},
                        "reason": {"type": "string"},
                    },
                },
                # ── V1.5 — Collision resolver ─────────────────────────────────
                "AlignCollisionsRequest": {
                    "type": "object",
                    "required": ["pivot_doc_id", "target_doc_id"],
                    "properties": {
                        "pivot_doc_id": {"type": "integer"},
                        "target_doc_id": {"type": "integer"},
                        "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 20},
                        "offset": {"type": "integer", "minimum": 0, "default": 0},
                    },
                },
                "CollisionLink": {
                    "type": "object",
                    "required": ["link_id", "target_unit_id", "target_text"],
                    "properties": {
                        "link_id": {"type": "integer"},
                        "target_unit_id": {"type": "integer"},
                        "target_external_id": {"type": "integer", "nullable": True},
                        "target_text": {"type": "string"},
                        "status": {"type": "string", "nullable": True, "enum": ["accepted", "rejected"]},
                    },
                },
                "CollisionGroup": {
                    "type": "object",
                    "required": ["pivot_unit_id", "pivot_text", "links"],
                    "properties": {
                        "pivot_unit_id": {"type": "integer"},
                        "pivot_external_id": {"type": "integer", "nullable": True},
                        "pivot_text": {"type": "string"},
                        "links": {"type": "array", "items": {"$ref": "#/components/schemas/CollisionLink"}},
                    },
                },
                "CollisionResolveAction": {
                    "type": "object",
                    "required": ["action", "link_id"],
                    "properties": {
                        "action": {"type": "string", "enum": ["keep", "delete", "reject", "unreviewed"]},
                        "link_id": {"type": "integer"},
                    },
                },
                "CollisionResolveRequest": {
                    "type": "object",
                    "required": ["actions"],
                    "properties": {
                        "actions": {
                            "type": "array",
                            "items": {"$ref": "#/components/schemas/CollisionResolveAction"},
                            "minItems": 1,
                        },
                    },
                },
                # ── V0.5 — Job enqueue + cancel ──────────────────────────────
                "JobEnqueueRequest": {
                    "type": "object",
                    "required": ["kind"],
                    "properties": {
                        "kind": {
                            "type": "string",
                            "enum": [
                                "index", "curate", "validate-meta", "segment",
                                "import", "align", "export_tei", "export_align_csv", "export_run_report",
                                "export_tei_package", "export_readable_text", "qa_report",
                                "annotate",
                            ],
                        },
                        "params": {"type": "object", "additionalProperties": True},
                    },
                },
                "JobCancelResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["job_id", "status"],
                            "properties": {
                                "job_id": {"type": "string"},
                                "status": {"type": "string"},
                            },
                        },
                    ]
                },
            }
        },
    }
