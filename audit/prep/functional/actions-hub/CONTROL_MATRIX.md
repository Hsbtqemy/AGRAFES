# Actions Hub — CONTROL_MATRIX

| Contrôle / rôle | Sélecteur stable | État(s) d’apparition | Comportement attendu | Listener / méthode branchée | État local impacté | Dépendance backend / sidecar / storage | Effet visible attendu | Effet réel observé | Statut |
|---|---|---|---|---|---|---|---|---|---|
| Ouvrir Curation | `.acts-hub-wf-btn[data-target="curation"]` | Hub actif | Basculer vers sous-vue Curation | `click -> _switchSubViewDOM(...,'curation')` | `_activeSubView` + `localStorage LS_ACTIVE_SUB` | Storage local (persistance vue) | panneau Curation visible | Conforme | `state-wired` |
| Ouvrir Segmentation | `.acts-hub-wf-btn[data-target="segmentation"]` | Hub actif | Basculer vers Segmentation | `click -> _switchSubViewDOM(...,'segmentation')` | `_activeSubView` | Storage local | panneau Segmentation visible | Conforme | `state-wired` |
| Ouvrir Alignement | `.acts-hub-wf-btn[data-target="alignement"]` | Hub actif | Basculer vers Alignement | `click -> _switchSubViewDOM(...,'alignement')` | `_activeSubView` | Storage local | panneau Alignement visible | Conforme | `state-wired` |
| CTA Scénario grand texte (head) | `.acts-hub-head-link[data-cta="segmentation-longtext"]` | Hub actif | Ouvrir Segmentation + mode longtext | `click -> _switchSubViewDOM(...,'segmentation'); _setSegMode('longtext')` | `_activeSubView`, `_segMode`, `_segLongTextMode` | Storage local | Segmentation mode "Document complet" actif | Conforme | `logic-wired` |
| CTA Grand texte (carte segmentation) | `.acts-hub-wf-link[data-cta="segmentation-longtext"]` | Hub actif | Même comportement que CTA head | même handler | idem | Storage local | idem | Conforme | `logic-wired` |
| Back from subview vers hub | `.acts-view-back-btn` (injecté dans sous-vues) | Sous-vues Curation/Segmentation/Alignement | Retour à la synthèse hub | `click -> _switchSubViewDOM(...,'hub')` | `_activeSubView` | Storage local | Hub réaffiché | Conforme | `state-wired` |
| Marquage navigation active | `[data-nav]` (liens internes) | Selon sous-vue | Synchroniser classe active / aria | `_switchSubViewDOM` | classes DOM | Aucune | style actif cohérent | Conforme | `state-wired` |

## Vérification C1..C10 (Actions Hub)

- C1/C2/C3: satisfaits (navigation interne).
- C4/C5/C6: pas de logique backend attendue sur cette vue.
- C7: N/A (pas de disabled conditionnel métier).
- C8: N/A (pas de KPI run-time).
- C9/C10: pas de paramètre métier affiché sur le hub.
