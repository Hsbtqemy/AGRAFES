# Actions > Segmentation — CONTROL_MATRIX

| Contrôle / rôle | Sélecteur stable | État(s) d’apparition | Comportement attendu | Listener / méthode branchée | État local impacté | Dépendance backend / sidecar / storage | Effet visible attendu | Effet réel observé | Statut |
|---|---|---|---|---|---|---|---|---|---|
| Liens header vers Curation/Alignement | `.acts-hub-head-link[data-nav]` | Toujours | Navigation croisée | `_bindHeadNavLinks()` | `_activeSubView` | Storage local | Ouverture sous-vue cible | Conforme | `state-wired` |
| CTA Scénario grand texte (header) | `#act-seg-head-longtext` | Toujours | Activer mode longtext | `click -> _setSegMode('longtext')` | `_segMode`, `_segLongTextMode` | Aucune | Vue longtext affichée | Conforme | `state-wired` |
| Bouton hint longtext | `#act-seg-switch-longtext` | Hint visible | Basculer vers mode longtext | `click -> _setSegMode('longtext')` | `_segMode` | Aucune | Changement mode | Conforme | `state-wired` |
| Switch mode Units/Traduction/Longtext | `#act-seg-mode-units/#act-seg-mode-traduction/#act-seg-mode-longtext` | Toujours | Changer layout et interactions | `click -> _setSegMode(...)` | `_segMode`, `_segLongTextMode` | Aucune | Panneaux et boutons adaptés | Conforme | `state-wired` |
| Preset global (Strict/Étendu/Custom) | `input[name="seg-preset"]` | Sidebar avancée | Influencer pack/options envoyés au backend | **Aucun listener** | aucune | Aucune | Impact sur payload segmentation | Aucun impact | `dead` |
| Séparateurs actifs (. ? ! / ; :) | `.seg-side input[type="checkbox"]` | Sidebar avancée | Configurer découpe fine | **Aucun listener**, TODO explicite | aucune | Aucune | Paramétrage backend attendu | Purement visuel | `dead` |
| Portée (document/sélection) | `input[name="seg-scope"]` | Sidebar avancée | Limiter l’opération | **Aucun listener** | aucune | Aucune | Scope métier attendu | Aucun impact | `dead` |
| Document cible segmentation | `#act-seg-doc` | Toujours | Choisir doc à segmenter | `change` | sélection courante implicite | Sidecar pour preview/segment | Bannière + preview raw + chips mis à jour | Conforme | `logic-wired` |
| Langue segmentation | `#act-seg-lang` | Toujours | Langue envoyée au job | lu dans `_runSegment()` | payload `lang` | Sidecar `segment` | Valeur utilisée au run | Conforme | `logic-wired` |
| Pack segmentation | `#act-seg-pack` | Toujours | Pack envoyé au job | `change` + lu dans `_runSegment()` | payload `pack` | Sidecar `segment` | Bannière/chip pack mis à jour | Conforme | `logic-wired` |
| Segmenter | `#act-seg-btn` | Enabled avec connexion | Lancer job segment | `click -> _runSegment(false)` | `_lastSegmentReport`, `_segmentPendingValidation` | Sidecar `jobs/enqueue(kind=segment)` + JobCenter | Preview/statuts/méta mis à jour | Validé en probe (`segment done`) | `logic-wired` |
| Seg. + valider | `#act-seg-validate-btn` | Enabled avec connexion | Segmenter puis valider workflow doc | `click -> _runSegment(true)` | idem + validation auto | Sidecar `segment` + `documents/update` | Validation auto + navigation post-validate | Chaîne branchée; validée backend (update endpoint) | `logic-wired` |
| Valider seulement | `#act-seg-validate-only-btn` | Enabled si segmentation pending | Valider doc sans rerun | `click -> _runValidateCurrentSegDoc()` | `_segmentPendingValidation` | Sidecar `documents/update` | Bannière passe en validé | Conforme | `logic-wired` |
| Focus mode | `#act-seg-focus-toggle` | Enabled avec connexion | Basculer classe focus UI | `click -> _toggleSegFocusMode()` | `_segFocusMode` | Aucune | Layout focus | Conforme (UI local) | `UI-only` |
| Destination post-validation | `#act-seg-after-validate` | Toujours | Choisir comportement après validation | `change` + `_postValidateDestination()` | localStorage `LS_SEG_POST_VALIDATE` | Storage local | Redirection Documents / next / stay | Conforme | `logic-wired` |
| Tabs preview units | `#act-seg-preview-card .ptab[data-stab]` | Mode Units | Alterner brut/proposition | listener tab | classes DOM | Aucune | Panneau actif changé | Conforme | `UI-only` |
| Final bar units (Seg+valider / Valider) | `#act-seg-final-seg-btn`, `#act-seg-final-validate-btn` | Affiché après segmentation | Raccourcis d’action finale | listeners dédiés | `_segmentPendingValidation` | Sidecar segment/update | Exécution des mêmes actions que boutons principaux | Conforme | `logic-wired` |
| Document VO (traduction) | `#act-seg-ref-doc` | Mode Traduction | Charger aperçu VO + pagination | `change -> _loadVoSegmentsPreview()` | `_voPreviewLimitByDocId` | Sidecar `GET /documents/preview` | Lignes VO + bouton "Afficher plus" | Partiel: fonctionne avec API 1.4.6, casse avec sidecar embarqué 1.4.1 | `partial` |
| Tabs traduction | `.ptab-tr[data-tab-tr]` | Mode Traduction | Alterner cible/VO/comparaison | listener tab | classes DOM | Aucune | Panneaux cibles/VO visibles | Conforme | `UI-only` |
| Final bar traduction | `#act-seg-tr-final-compare`, `#act-seg-tr-final-validate` | Après segmentation | Aller à comparatif puis valider | listeners dédiés | `_segmentPendingValidation` | Sidecar `documents/update` | Validation finalisée | Conforme | `logic-wired` |
| Paramètres longtext (doc/lang/pack) | `#act-seg-lt-doc/#act-seg-lt-lang/#act-seg-lt-pack` | Mode Longtext | Synchroniser/paramétrer run longtext | listeners `change` + sync | sélection + payload | Sidecar segment | Paramètres cohérents entre vues | Conforme | `logic-wired` |
| Actions longtext | `#act-seg-lt-btn/#act-seg-lt-validate-btn/#act-seg-lt-validate-only-btn` | Mode Longtext | Lancer segment/validation | listeners dédiés | `_lastSegmentReport`, pending flag | Sidecar segment/update | Résultats + barres finales | Conforme | `logic-wired` |
| Chips longtext (hors recherche) | `[data-chip="text_norm"|"text_raw"|"highlight_cuts"|"suspects_only"]` | Mode Longtext | Appliquer des filtres d’affichage | `click` toggle CSS uniquement | classes DOM | Aucune | Filtrage attendu | Pas d’effet métier/rendu réel | `UI-only` |
| Chip recherche + barre | `[data-chip="search"]`, `#act-seg-lt-search-input`, `#act-seg-lt-search-clear` | Mode Longtext | Ouvrir recherche, surligner correspondances | listeners dédiés | `_ltSearchOpen` | Aucune | Highlights dans pane actif | Conforme | `logic-wired` |
| Tabs longtext (raw/seg/diff) | `#act-seg-longtext-view .ptab[data-tab]` | Mode Longtext | Alterner panneaux longtext | listener tab | classes DOM | Aucune | Pane actif affiché | Conforme | `UI-only` |
| Final bar longtext | `#act-seg-lt-final-diff`, `#act-seg-lt-final-apply` | Après segmentation | Aller tab diff puis appliquer validation | listeners dédiés | `_segmentPendingValidation` | Sidecar update workflow | Validation + éventuelle nav vers Curation | Conforme | `logic-wired` |
| Minimap segmentation (click-to-scroll + zone) | `.minimap.minimap-track` | Units/Traduction/Longtext | Navigation rapide dans le contenu | listeners `click` + `_setupMmZone()` | state DOM + RAF zone | Aucune | Scroll synchronisé | Conforme | `logic-wired` |
| Hint "document long" | `#act-seg-longtext-hint` | Si `char_count > 12000` | Recommander mode longtext | `_checkLongtextHint()` | none | nécessite `char_count` dans `DocumentRecord` | Hint contextuel | Partiel: dépend champ `char_count` souvent absent selon backend | `partial` |
| KPI/chips/bannières segmentation | `#act-seg-status-banner`, `#act-seg-chip-*`, `#act-seg-lt-*` | Toujours | Recalculer état de progression et avertissements | `_refreshSegmentationStatusUI()`, `_updateLongtextPreview()`, `_updateTraductionPreview()` | `_lastSegmentReport`, pending | Sidecar segment pour données source | Stats/pills cohérentes | Conforme | `state-wired` |

## Vérification C1..C10 (Segmentation)

- C1/C2/C3: satisfaits sur flux principal (doc/lang/pack -> segment -> UI).
- C4/C5/C6: satisfaits sur `segment` + `documents/update` (probe backend), partiels pour preview VO selon version sidecar.
- C7: états disabled/hidden gérés (bannière + final bars + validate-only).
- C8: KPI/pills recalculés après chaque run.
- C9: paramètres affichés mais non exploités: preset/separators/scope sidebar.
- C10: éléments maquette partiels: chips longtext décoratives, hint longtext dépendant d’un champ backend non garanti.
