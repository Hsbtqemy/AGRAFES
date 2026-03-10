# Actions > Curation — CONTROL_MATRIX

| Contrôle / rôle | Sélecteur stable | État(s) d’apparition | Comportement attendu | Listener / méthode branchée | État local impacté | Dépendance backend / sidecar / storage | Effet visible attendu | Effet réel observé | Statut |
|---|---|---|---|---|---|---|---|---|---|
| CTA "Scénario grand texte" | `#act-curate-lt-cta` | Toujours en Curation | Aller en Segmentation mode longtext | `click -> _switchSubViewDOM('segmentation'); _setSegMode('longtext')` | `_activeSubView`, `_segMode` | Storage local | Changement de sous-vue + mode | Conforme | `logic-wired` |
| Liens header vers autres sous-vues | `.acts-hub-head-link[data-nav]` | Toujours | Navigation croisée | `_bindHeadNavLinks()` | `_activeSubView` | Storage local | Vue correspondante ouverte | Conforme | `state-wired` |
| Sélecteur document curation | `#act-curate-doc` | Toujours | Choisir la portée de preview/apply | `change -> _updateCurateCtx(); _schedulePreview(true)` | doc courant implicite | Sidecar pour preview/apply | Contexte + preview recalculés | Conforme | `logic-wired` |
| Label doc curation | `#act-curate-doc-label` | Toujours | Afficher doc courant | **Aucune écriture** | aucune | Aucune | Label contextualisé | Jamais alimenté | `dead` |
| Pill mode curation | `#act-curate-mode-pill` | Toujours | Refléter mode actif | **Aucune écriture** | aucune | Aucune | Pill évolutive | Statique | `dead` |
| Règle Espaces | `#act-rule-spaces` | Toujours | Activer preset spaces dans preview/apply | `change -> _schedulePreview(true)` | règles effectives calculées | Sidecar `curate/preview`, `curate` | Diff/diag changent | Conforme | `logic-wired` |
| Règle Guillemets | `#act-rule-quotes` | Toujours | Activer preset quotes | même wiring | règles effectives | Sidecar | Diff/diag changent | Conforme | `logic-wired` |
| Règle Ponctuation | `#act-rule-punctuation` | Toujours | Activer preset punctuation | même wiring | règles effectives | Sidecar | Diff/diag changent | Conforme | `logic-wired` |
| Règle Invisibles | `#act-rule-invisibles` | Toujours | Activer preset invisibles | même wiring | règles effectives | Sidecar | Diff/diag changent | Conforme | `logic-wired` |
| Règle Numérotation | `#act-rule-numbering` | Toujours | Activer preset numbering | même wiring | règles effectives | Sidecar | Diff/diag changent | Conforme | `logic-wired` |
| Réinitialiser preset | `#act-curate-reset-btn` | Toujours | Vider règles JSON + preset spaces | `click -> _applyCurationPreset('spaces')` | état règles UI | Aucune | Cases recochées + preview relancée | Conforme | `state-wired` |
| Prévisualiser maintenant | `#act-preview-btn` | Always (disabled sans conn) | Appeler preview backend | `click -> _runPreview()` | `_hasPendingPreview`, `_lastErrorMsg`, `_curateLog` | Sidecar `POST /curate/preview` | Tableau diff + diag + minimap + stats | Fonctionnel avec sidecar compatible | `logic-wired` |
| Appliquer curation | `#act-curate-btn` | Always | Soumettre job curation | `click -> _runCurate()` | `_hasPendingPreview`, logs | Sidecar `POST /jobs/enqueue(kind=curate)` | toast/log + bouton reindex si FTS stale | Chaîne branchée; non validée UI stricte ici | `partial` |
| CTA Appliquer après preview | `#act-apply-after-preview-btn` | Visible si preview changed>0 | Raccourci vers apply | `click -> _runCurate()` | idem | idem | Même effet que bouton principal | Conforme | `logic-wired` |
| CTA Re-indexer après curation | `#act-reindex-after-curate-btn` | Visible si `fts_stale` | Lancer reconstruction index | `click -> _runIndex()` | `_isBusy` | Sidecar `jobs/enqueue(index)` | Message de succès/erreur | Validé en probe job index | `logic-wired` |
| Regex rapide pattern | `#act-curate-quick-pattern` | Section avancée | Saisie d’un motif à ajouter | lu par `_addAdvancedCurateRule()` | draft input | Aucune | Valeur injectée dans JSON rules | Conforme | `state-wired` |
| Regex rapide replacement | `#act-curate-quick-replacement` | Section avancée | Saisie remplacement | lu par `_addAdvancedCurateRule()` | draft input | Aucune | Idem | Conforme | `state-wired` |
| Regex rapide flags | `#act-curate-quick-flags` | Section avancée | Définir flags regex | lu par `_addAdvancedCurateRule()` | draft input | Aucune | Idem | Conforme | `state-wired` |
| Ajouter règle rapide | `#act-curate-add-rule-btn` | Section avancée | Ajouter règle JSON puis relancer preview | `click -> _addAdvancedCurateRule()` | textarea rules + log | Aucune | Règle appendée + preview debounce | Conforme | `logic-wired` |
| Règles JSON | `#act-curate-rules` | Section avancée | Éditer règles custom | `input -> _schedulePreview(true)` | règles effectives | Sidecar preview/apply | Diff recalc | Conforme | `logic-wired` |
| Quick actions précédent | `.curate-nav-actions .btn:nth-child(1)` | Toujours | Naviguer dans une file d’actions | **disabled hard + aucun listener** | aucune | Aucune | Navigation revue | Non implémenté | `dead` |
| Quick actions suivant | `.curate-nav-actions .btn:nth-child(2)` | Toujours | Naviguer dans une file d’actions | **disabled hard + aucun listener** | aucune | Aucune | Navigation revue | Non implémenté | `dead` |
| File d’actions | `#act-curate-queue` | Toujours | Afficher des actions en attente | **Aucune alimentation** | aucune | Aucune | Lignes d’actions | Toujours vide placeholder | `dead` |
| Chips preview (Brut/Curé/Diff/Scroll/Contexte) | `.preview-controls .chip` | Toujours | Filtrer/affiner l’affichage preview | Aucun listener | classes statiques | Aucune | Comportement interactif attendu | Purement décoratif | `UI-only` |
| Minimap curation | `#act-curate-minimap` | Après preview | Refléter densité changements | `_renderCurateMinimap()` | dérivé stats preview | Sidecar preview | Marques changées | Conforme | `state-wired` |
| Lien "Voir segmentation" (diag) | `#act-curate-seg-link [data-action="goto-seg"]` | Visible si `_lastSegmentReport` | Naviguer vers Segmentation | délégation click installée | `_activeSubView` | Storage local | Ouverture Segmentation | Conforme | `logic-wired` |
| Validation métadonnées (section curation) | `#act-meta-doc`, `#act-meta-btn` | Section card dédiée | Lancer validation meta ciblée/tous | `click -> _runValidateMeta()` | logs | Sidecar job `validate-meta` | Résultats en log/toast | Validé en probe | `logic-wired` |
| Reconstruire index (section curation) | `#act-index-btn` | Section card dédiée | Lancer job index | `click -> _runIndex()` | `_isBusy` | Sidecar job `index` | logs/toast | Validé en probe | `logic-wired` |

## Vérification C1..C10 (Curation)

- C1/C2/C3: satisfaits pour la majorité des commandes.
- C4/C5/C6: satisfaits pour `preview`, `index`, `validate-meta`; partiels pour `apply curation` (pas de run UI piloté ici).
- C7: état disabled global géré par `_setButtonsEnabled()`.
- C8: stats/diag/minimap/journal recalculés après preview/apply.
- C9: aucun paramètre majeur caché ici; règles JSON bien utilisées.
- C10: éléments maquette partiellement/non branchés explicites: `queue`, `précédent/suivant`, chips preview décoratives, labels/pills statiques.
