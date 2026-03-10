# FUNCTIONAL_WIRING_REPORT — tauri-prep

## 1) Résumé exécutif

- Périmètre audité: `Importer`, `Documents`, `Actions Hub`, `Actions > Curation`, `Actions > Segmentation`, `Actions > Alignement`, `Exporter`.
- Contrôles audités: **162**.
- Classement global:
  - `state-wired`: 48
  - `logic-wired`: 78
  - `UI-only`: 11
  - `partial`: 14
  - `dead`: 11
  - `e2e-validated`: **0** (non validable UI stricte dans cet état)
- Conclusion principale: le câblage fonctionnel est majoritairement présent, mais plusieurs éléments issus des maquettes restent partiels/cosmétiques, et un blocage P0 existe sur la compatibilité sidecar embarqué.

## 2) Contrôles totalement validés

- **Aucun contrôle classé `e2e-validated`**.
- Motif: absence de harness UI Tauri pour exécuter un parcours utilisateur complet (dialogs natifs, navigation shell et effets visuels en contexte réel).
- Validation backend réalisée (hors UI) sur sidecar API 1.4.6:
  - `segment`, `align`, `align/audit`, `align/quality`, `validate-meta`, `db/backup`, `export_align_csv`, `export_run_report`, `export_tei`, `export_tei_package`, `export_readable_text`, `qa_report`, `doc_relations set/delete`.

## 3) Contrôles partiellement branchés

| Vue | Contrôle | Problème constaté |
|---|---|---|
| Importer | `#imp-add-btn`, `#imp-import-btn` | Dépendance dialog natif/fichiers réels; non validable UI stricte ici. |
| Documents | `tr.meta-doc-row` / `#meta-preview-panel` | Dépend de `GET /documents/preview`; KO avec sidecar embarqué API 1.4.1. |
| Curation | `#act-curate-btn` | Chaîne job curation branchée mais non validée en run UI strict. |
| Segmentation | `#act-seg-ref-doc` | Preview VO dépend de `/documents/preview` (mismatch sidecar embarqué). |
| Segmentation | `#act-seg-longtext-hint` | Repose sur `char_count` backend non garanti. |
| Alignement | `#act-audit-qf2-*` | Sync visuelle des chips qf2 partiellement robuste selon séquence d’usage. |
| Alignement | `#act-audit-view-run` | Listener `click` run-view réattaché à chaque render (risque duplication). |
| Alignement | `#act-focus-lock-btn/#act-focus-unlock-btn` | Sémantique lock réelle absente (alias statut accepté/non révisé). |
| Alignement | Workflow CTA/progression | Progression compact workflow non entièrement pilotée par résultats métier. |
| Alignement | Résolution collisions | Wiring présent mais non validé sur cas collision réel (corpus probe sans collision). |
| Exporter | `#v2-tei-relation-type` | Paramètre lu mais non transmis au payload backend. |
| Exporter | `#tei-relation-type` | Même limitation en mode legacy. |

## 4) Contrôles morts

| Vue | Contrôle | Diagnostic |
|---|---|---|
| Importer | `#imp-dropzone` | Aucun ingest au `drop`, pure interaction CSS. |
| Documents | `#meta-batch-role-btn` | Aucun listener malgré activation visuelle. |
| Curation | `#act-curate-doc-label` | Jamais alimenté. |
| Curation | `#act-curate-mode-pill` | Jamais synchronisé. |
| Curation | `#act-curate-queue` | Jamais peuplé. |
| Curation | `.curate-nav-actions` (Précédent/Suivant) | Hard-disabled, aucun wiring. |
| Segmentation | `input[name="seg-preset"]` | Aucun impact sur payload. |
| Segmentation | Bloc séparateurs avancés | TODO explicite, non branché. |
| Segmentation | `input[name="seg-scope"]` | Non utilisé. |
| Segmentation | `[data-chip-tr]` (preview traduction) | Boutons visuels sans logique. |
| Exporter | `#v2-align-exceptions-only` | Option affichée, jamais lue. |

## 5) Paramètres affichés mais non exploités

- Exporter V2: `#v2-align-exceptions-only` (aucun effet).
- Exporter V2: `#v2-tei-relation-type` (non propagé au backend).
- Exporter legacy: `#tei-relation-type` (non propagé au backend).
- Segmentation avancée: preset/séparateurs/scope (UI présente, payload inchangé).
- Alignement focus: lock/unlock sans champ lock dédié (réutilisation de `status`).

## 6) Dépendances empêchant la validation complète

1. **Sidecar embarqué incompatible**
- Binaire embarqué testé (`tauri-prep/src-tauri/binaries/multicorpus-aarch64-apple-darwin`) expose API `1.4.1` et ne fournit pas `/documents/preview`.
- `tauri-prep` appelle pourtant `GET /documents/preview` pour Documents et Segmentation VO.
- Conclusion: validation complète impossible tant que binaire sidecar embarqué non aligné.

2. **Absence d’automatisation UI Tauri**
- Dialogs natifs `open/save` non pilotés automatiquement dans ce lot.
- E2E UI stricte non validable dans cet état.

3. **Corpus de test limité**
- Pas de cas collision dense observé.
- Pas de document long naturel pour stress longtext.

## 7) Plan recommandé

### P0 corriger

- Mettre à jour le sidecar embarqué `tauri-prep` vers une version supportant `/documents/preview` (API >= 1.4.6 observée).
- Corriger/supprimer les contrôles morts à fort risque UX:
  - `#meta-batch-role-btn`
  - `#imp-dropzone`
  - `#v2-align-exceptions-only`
- Bloquer explicitement en UI les options non implémentées pour éviter l’ambiguïté (message “non disponible”).

### P1 compléter

- Câbler réellement la sidebar avancée Segmentation (preset/séparateurs/scope) vers le payload backend.
- Câbler la file "Actions rapides" Curation (queue + précédent/suivant) ou la retirer.
- Propager `tei-relation-type` dans les payloads export TEI (V2 + legacy).
- Isoler/cleanup le listener run-view pour éviter les accumulations de handlers.

### P2 laisser comme polish

- Harmoniser la sync visuelle des filtres rapides qf/qf2.
- Clarifier la sémantique lock/unlock (statut vs vrai verrouillage).
- Enrichir états denses longtext/collisions avec jeux de test dédiés et instrumentation d’audit.
