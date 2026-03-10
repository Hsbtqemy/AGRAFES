# Documents — CONTROL_MATRIX

| Contrôle / rôle | Sélecteur stable | État(s) d’apparition | Comportement attendu | Listener / méthode branchée | État local impacté | Dépendance backend / sidecar / storage | Effet visible attendu | Effet réel observé | Statut |
|---|---|---|---|---|---|---|---|---|---|
| Rafraîchir liste | `#refresh-docs-btn` | Toujours | Recharger le corpus | `click -> _refreshDocList()` | `_docs[]`, `_isBusy` | Sidecar `GET /documents` | Table et KPI actualisés | Conforme | `logic-wired` |
| Filtre texte | `#meta-doc-filter` | Toujours | Filtrer la table docs | `input` | `_docFilter` | Aucune | Réduction instantanée des lignes | Conforme | `state-wired` |
| Filtre statut | `#meta-status-filter` | Toujours | Filtrer `validated/review/draft` | `change` | `_statusFilter` | Aucune | Lignes filtrées + compteur `shown/total` | Conforme | `state-wired` |
| Reset filtres | `#meta-reset-filter` | Toujours | Réinitialiser filtres | `click` | `_docFilter`, `_statusFilter` | Aucune | Table complète restaurée | Conforme | `state-wired` |
| Sélectionner tout | `#meta-select-all` | Docs visibles | Cocher/décocher docs filtrés | `change` | `_selectedDocIds` | Aucune | Checkboxes cohérentes + barre batch | Conforme | `state-wired` |
| Checkbox ligne | `.meta-row-check[data-id]` | Docs visibles | Sélection unitaire | `click` (stop propagation) | `_selectedDocIds` | Aucune | Barre batch mise à jour | Conforme | `state-wired` |
| Clic ligne document | `tr.meta-doc-row` | Docs visibles | Charger panneau d’édition + relations + aperçu | `click -> _selectDoc(doc)` | `_selectedDoc`, `_relations`, `_preview*` | Sidecar `GET /doc_relations`, `GET /documents/preview` | Panneau droit rempli | Partiel: OK avec sidecar API 1.4.6; en échec avec sidecar embarqué 1.4.1 (`/documents/preview` absent) | `partial` |
| Barre batch compteur | `#meta-batch-meta` | Toujours | Afficher nombre sélectionné | `_renderBatchBar()` | `_selectedDocIds` | Aucune | `0/1/N sélectionné(s)` | Conforme | `state-wired` |
| Bouton batch "Définir rôle" | `#meta-batch-role-btn` | Visible si >=2 sélectionnés (enabled) | Appliquer un rôle aux docs sélectionnés | **Aucun listener** | aucun | Aucune | Action batch ciblée attendue | Bouton activable visuellement mais non-opérant | `dead` |
| Bulk rôle | `#bulk-role` | Section "Édition en masse" | Préparer valeur de bulk update | `change` (active bouton) | draft formulaire | Aucune | Bouton bulk activé | Conforme | `state-wired` |
| Bulk resource type | `#bulk-restype` | Section "Édition en masse" | Préparer valeur de bulk update | `input` (active bouton) | draft formulaire | Aucune | Bouton bulk activé | Conforme | `state-wired` |
| Appliquer à tous | `#bulk-apply-btn` | Enabled si draft bulk non vide | Envoyer mise à jour massive | `click -> _runBulkUpdate()` | `_docs[]` via refresh | Sidecar `POST /documents/bulk_update` | Log succès + table rafraîchie | Conforme (chaîne branchée) | `logic-wired` |
| Sauvegarder DB | `#db-backup-btn` | Toujours | Créer backup base | `click -> _runDbBackup()` | état visuel status | Sidecar `POST /db/backup` | Nom de backup affiché | Validé en probe (`db/backup`) | `logic-wired` |
| Valider métadonnées | `#validate-btn` | Toujours | Lancer validation metadata | `click -> _runValidate()` | log seulement | Sidecar `POST /validate-meta` | Logs warnings/invalides | Validé en probe | `logic-wired` |
| Champs édition document | `#edit-title/#edit-lang/#edit-role/#edit-restype/#edit-workflow-status/#edit-validated-run-id` | Document sélectionné | Modifier brouillon local + détection dirty | lecture via `_isSelectedDocDirty()` / `_saveDoc()` | dirty state implicite | Aucune (saisie locale) | Bannière "modifs non enregistrées" | Conforme | `state-wired` |
| Enregistrer doc | `#save-doc-btn` | Document sélectionné | Persister modifications | `click -> _saveDoc()` | `_docs[]`, `_selectedDoc` | Sidecar `POST /documents/update` | Données mises à jour + log | Validé partiellement (endpoint OK en probe) | `logic-wired` |
| Marquer à revoir | `#mark-review-btn` | Document sélectionné | Mettre `workflow_status=review` | `click -> _setWorkflowStatus('review')` | `_docs[]`, `_selectedDoc` | Sidecar `POST /documents/update` | Pill statut change | Endpoint validé | `logic-wired` |
| Valider document | `#mark-validated-btn` | Document sélectionné | Mettre `workflow_status=validated` | `click -> _setWorkflowStatus('validated')` | `_docs[]`, `_selectedDoc` | Sidecar `POST /documents/update` | Pill statut + date validation | Endpoint validé | `logic-wired` |
| Ajouter relation | `#rel-type/#rel-target-sel/#rel-note/#add-rel-btn` | Document sélectionné | Créer relation inter-docs | `click -> _addRelation()` | `_relations[]` | Sidecar `POST /doc_relations/set`, puis `GET /doc_relations` | Relation apparaît en liste | Validé en probe (`set/delete`) | `logic-wired` |
| Supprimer relation | `.del-rel-btn[data-id]` | Relation existante | Supprimer relation | `click -> _deleteRelation(id)` | `_relations[]` | Sidecar `POST /doc_relations/delete` | Ligne supprimée | Validé en probe | `logic-wired` |
| Panneau aperçu document | `#meta-preview-panel` | Document sélectionné | Afficher extrait contenu | `_loadDocPreview()` puis `_renderPreviewPanel()` | `_preview*` | Sidecar `GET /documents/preview` | Extrait texte + marqueurs | Fonctionnel avec API 1.4.6; cassé avec sidecar embarqué 1.4.1 | `partial` |
| KPI + bannière runtime | `#meta-kpi-*`, `#meta-state-banner` | Toujours | Recalculer volumétrie et état | `_updateDocCount()`, `_refreshRuntimeState()` | dérivé de `_docs`, `_isBusy`, dirty state | Aucune | KPI dynamiques + statut warning/ok | Conforme | `state-wired` |

## Vérification C1..C10 (Documents)

- C1/C2/C3: globalement satisfaits.
- C4/C5/C6: satisfaits pour update/bulk/validate/backup/relations; **partiels** pour l’aperçu à cause de la compatibilité sidecar.
- C7: états disabled/enabled présents (bulk, backup, sélection globale).
- C8: KPI recalculés dans `_updateDocCount()`.
- C9: paramètre de sélection batch (`_selectedDocIds`) partiellement exploité (compteur + UI) mais non consommé par une action métier dédiée.
- C10: contrôle maquette partiellement branché: bouton `Définir rôle` sans effet.
