# Exporter — CONTROL_MATRIX

| Contrôle / rôle | Sélecteur stable | État(s) d’apparition | Comportement attendu | Listener / méthode branchée | État local impacté | Dépendance backend / sidecar / storage | Effet visible attendu | Effet réel observé | Statut |
|---|---|---|---|---|---|---|---|---|---|
| Retour vers Alignement | `.exp-back-btn` | Toujours | Naviguer vers sous-vue Alignement | `click -> query .prep-nav-tree-link[data-nav="alignement"].click()` | none | DOM shell nav | Ouverture vue Alignement | Conforme | `logic-wired` |
| Sélection docs V2 (checkbox lignes) | `.exp-doc-check[data-doc-id]` | Docs présents | Piloter la portée export | `change -> _onDocCheckChange()` | sélection `#v2-doc-sel` | Aucune | Résumé portée + KPI `Sélectionnés` | Conforme | `state-wired` |
| Tout sélectionner docs V2 | `#v2-doc-select-all-btn` | Docs présents | Sélectionner tous docs visibles | `click -> _selectAllV2Docs()` | `#v2-doc-sel` | Aucune | Tous cochés | Conforme | `state-wired` |
| Effacer sélection docs V2 | `#v2-doc-clear-btn` | Toujours | Vider la portée doc | `click -> _clearV2DocSelection()` | `#v2-doc-sel` | Aucune | 0 sélectionné | Conforme | `state-wired` |
| Stage V2 | `#v2-stage` | Toujours | Changer famille d’export | `change -> _syncV2Ui()` | options produit/format | Aucune | Produits/format recalculés | Conforme | `state-wired` |
| Produit V2 | `#v2-product` | Toujours | Choisir type de produit | `change -> _syncV2Ui()` | options format + panneaux options | Aucune | Panneaux contextuels affichés | Conforme | `state-wired` |
| Format V2 | `#v2-format` | Toujours | Choisir format de sortie | via `_syncV2Ui()` | résumé/KPI | Aucune | Résumé courant mis à jour | Conforme | `state-wired` |
| Lancer export V2 | `#v2-run-btn` | Enabled si sélection valide | Router vers export correspondant | `click -> _runUnifiedExport()` | disabled state bouton | Sidecar jobs + dialog save/open | log/toast + fichiers produits | Chaîne backend validée (align csv, run report, tei, package, readable, qa) | `logic-wired` |
| Options V2 TEI structure | `#v2-tei-include-structure` | Produit `tei_xml` | Propager include_structure | lu dans `_runUnifiedExport()` | payload export_tei | Sidecar job `export_tei` | impact TEI attendu | Conforme | `logic-wired` |
| Options V2 TEI relation type | `#v2-tei-relation-type` | Produit `tei_xml` | Piloter relation inter-doc à l’export | lu mais non transmis | aucune | N/A (non envoyé backend) | paramètre métier attendu | affiché mais uniquement utilisé dans message log | `partial` |
| Options V2 align pivot/target | `#v2-align-pivot/#v2-align-target` | Produit `aligned_table` | Filtrer export alignements | lus dans `_runUnifiedExport()` | payload export_align_csv | Sidecar job `export_align_csv` | export filtré | Conforme | `logic-wired` |
| Option V2 "Exceptions uniquement" | `#v2-align-exceptions-only` | Produit `aligned_table` | Exporter seulement exceptions | **jamais lue** | aucune | N/A | Filtrage exceptions attendu | Aucun effet | `dead` |
| Options V2 package | `#v2-pkg-include-structure/#v2-pkg-include-alignment/#v2-pkg-tei-profile` | Produit `tei_package` | Paramétrer package ZIP | lus dans `_runUnifiedExport()` | payload export_tei_package | Sidecar job `export_tei_package` | package configuré | Conforme | `logic-wired` |
| Option V2 run_id | `#v2-run-id` | Produit `run_report` | Filtrer rapport sur run | lu dans `_runUnifiedExport()` | payload export_run_report | Sidecar job `export_run_report` | rapport filtré | Conforme | `logic-wired` |
| Option V2 QA strict | `#v2-qa-strict-mode` | Produit `qa_report` | Choisir policy strict/lenient | lu dans `_runUnifiedExport()` | payload qa_report | Sidecar job `qa_report` | gate QA selon policy | Conforme | `logic-wired` |
| Toggle exports avancés | `#exports-toggle-legacy-btn` | Toujours | Ouvrir/fermer bloc legacy | `click -> _toggleLegacyExports()` | état display DOM | Aucune | bloc visible/masqué | Conforme | `UI-only` |
| Legacy TEI portée docs | `#tei-doc-sel` | Legacy ouvert | Choisir docs pour TEI | lu dans `_runTeiExport()` | payload doc_ids | Sidecar job `export_tei` | export scope | Conforme | `logic-wired` |
| Legacy TEI structure | `#tei-include-structure` | Legacy TEI | Include structure | lu dans `_runTeiExport()` | payload | Sidecar `export_tei` | structure incluse | Conforme | `logic-wired` |
| Legacy TEI relation type | `#tei-relation-type` | Legacy TEI | Paramètre relation inter-doc | lu mais non transmis | aucune | N/A | impact backend attendu | uniquement repris dans texte récapitulatif | `partial` |
| Legacy package options | `#pkg-doc-sel/#pkg-include-structure/#pkg-include-alignment/#pkg-tei-profile` | Legacy package | Paramétrer ZIP | lus dans `_runPackageExport()` | payload export_tei_package | Sidecar job `export_tei_package` | package exporté | Conforme | `logic-wired` |
| Notice profil strict | `#pkg-tei-profile` -> `#pkg-strict-notice` | Legacy package | Afficher avertissement strict | listener `change` | DOM notice | Aucune | notice visible/masquée | Conforme | `UI-only` |
| Legacy export alignements | `#align-csv-pivot/#align-csv-target/#align-csv-fmt/#align-csv-btn` | Legacy align CSV | Export CSV/TSV | `click -> _runAlignCsvExport()` | bouton disabled | Sidecar job `export_align_csv` + dialog | fichier exporté | Validé en probe | `logic-wired` |
| Legacy rapport runs | `#report-run-id/#report-fmt/#report-export-btn` | Legacy report | Export runs JSONL/HTML | `click -> _runRunReportExport()` | bouton disabled | Sidecar job `export_run_report` + dialog | fichier exporté | Validé en probe | `logic-wired` |
| Legacy QA report | `#qa-report-fmt/#qa-strict-mode/#qa-report-btn` | Legacy QA | Export QA + gate banner | `click -> _runQaReportExport()` | bannière gate | Sidecar job `qa_report` + poll | bannière gate colorée | Validé en probe | `logic-wired` |
| Bandeau run courant | `#exp-run-pill` | Toujours | Afficher run_id courant | lecture `localStorage` au render | none | localStorage `agrafes.prep.workflow.run_id` | pill `run: ...` | Conforme | `state-wired` |
| KPI strip export | `#exp-kpi-*` | Toujours | Refléter docs/selection/stage/format | `_updateKpiStrip()` | dérivé sélection + options | Aucune | KPI dynamiques | Conforme | `state-wired` |
| État runtime export | `#exp-state-banner` | Toujours | Afficher état sidecar/busy/erreur | `_refreshRuntimeState()` | `_isBusy`, `_lastErrorMsg`, `_conn`, `_v2Product` | Sidecar | info/warn/error cohérent | Conforme | `state-wired` |

## Vérification C1..C10 (Exporter)

- C1/C2/C3: satisfaits sur la quasi-totalité des contrôles.
- C4/C5/C6: satisfaits sur les exports testés en probe backend.
- C7: disabled/enabled géré via `_syncV2Ui()` + refresh docs.
- C8: KPI strip recalculé après modifications de portée/options.
- C9: paramètres affichés mais non exploités: `v2-align-exceptions-only`, `tei-relation-type` (V2 + legacy).
- C10: élément maquette partiellement branché: filtration "exceptions seulement" en export alignements non implémentée.
