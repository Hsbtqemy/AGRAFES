# Importer — CONTROL_MATRIX

| Contrôle / rôle | Sélecteur stable | État(s) d’apparition | Comportement attendu | Listener / méthode branchée | État local impacté | Dépendance backend / sidecar / storage | Effet visible attendu | Effet réel observé | Statut |
|---|---|---|---|---|---|---|---|---|---|
| Ajouter des fichiers | `#imp-add-btn` | Toujours visible | Ouvrir sélecteur multi-fichiers et ajouter des lignes importables | `click -> _addFiles()` | `_files[]` | Plugin Tauri dialog (`open`) | Nouvelles lignes dans la liste + KPI mis à jour | Branché; dépend de la disponibilité dialog natif | `partial` |
| Vider la liste | `#imp-clear-btn` | Toujours visible | Réinitialiser la sélection en cours | `click -> _clearList()` | `_files[]` | Aucune | Liste vide + boutons désactivés | Conforme | `state-wired` |
| Dropzone glisser-déposer | `#imp-dropzone` | Toujours visible | Accepter un drop et ajouter des fichiers | `dragover/dragleave/drop` inline | aucune (sur `drop`) | N/A | Le drop devrait remplir la liste | Le `drop` ne fait qu'enlever la classe CSS; aucun fichier ajouté | `dead` |
| Mode par défaut | `#imp-default-mode` | Toujours visible | Définir le mode proposé aux nouveaux fichiers / application en masse | Lu dans `_addFiles()` et `_applyDefaultsToPending()` | `_files[].mode` | Aucune | Modes préremplis cohérents | Conforme | `state-wired` |
| Langue par défaut | `#imp-default-lang` | Toujours visible | Définir la langue proposée aux nouveaux fichiers / application en masse | Lu dans `_addFiles()` et `_applyDefaultsToPending()` | `_files[].language` | Aucune | Langue préremplie | Conforme | `state-wired` |
| Appliquer aux fichiers en attente | `#imp-apply-defaults-btn` | Toujours visible | Appliquer mode/langue aux items `pending` | `click -> _applyDefaultsToPending()` | `_files[]`, `_log` | Aucune | Lignes mises à jour + log de confirmation | Conforme | `logic-wired` |
| Mode par fichier | `.imp-mode-sel[data-i]` | Après ajout de fichiers | Surcharger le mode d’un item | `change` délégué dans `_renderList()` | `_files[i].mode` | Aucune | Valeur persistée dans la ligne | Conforme | `state-wired` |
| Langue par fichier | `.imp-lang-inp[data-i]` | Après ajout de fichiers | Surcharger la langue d’un item | `input` délégué dans `_renderList()` | `_files[i].language` | Aucune | Valeur persistée | Conforme | `state-wired` |
| Titre par fichier | `.imp-title-inp[data-i]` | Après ajout de fichiers | Surcharger le titre d’un item | `input` délégué dans `_renderList()` | `_files[i].title` | Aucune | Valeur persistée | Conforme | `state-wired` |
| Retirer un fichier | `.imp-remove-btn[data-i]` | Après ajout de fichiers | Supprimer une ligne du lot | `click` délégué dans `_renderList()` | `_files[]` | Aucune | Ligne supprimée + KPI recalculés | Conforme | `state-wired` |
| Importer le lot | `#imp-import-btn` | Toujours visible (disabled si invalide) | Soumettre des jobs d’import pour chaque item `pending` | `click -> _runImport()` | `_files[].status`, `_isBusy`, `_lastErrorMsg` | Sidecar `/jobs/enqueue(kind=import)` + `JobCenter` | Progression, statuts par ligne, logs/toasts | Chaîne complète branchée; non validable E2E UI ici sans chemins fichiers réels + dialog natif | `partial` |
| Reconstruire l’index | `#imp-index-btn` | Toujours visible (disabled sans sidecar) | Soumettre un job `index` | `click -> _runIndex()` | `_isBusy`, `_lastErrorMsg` | Sidecar `/jobs/enqueue(kind=index)` + `JobCenter` | Log de succès/erreur + toast | Validé en probe sidecar (job `index` `done`) | `logic-wired` |
| Accordéons (Journal / Index FTS) | `section.card[data-collapsible='true'] > h3` | Toujours visible | Ouvrir/fermer les sections secondaires | `initCardAccordions()` | classes DOM uniquement | Aucune | Collapse/expand | Conforme | `UI-only` |
| Badge pré-vérification | `#imp-precheck-badge` | Toujours visible | Refléter pending/done/error | recalcul via `_updatePrecheck()` | dérivé de `_files[]` | Aucune | Badge `warn/error/ok` dynamique | Conforme | `state-wired` |
| Bannière d’état runtime | `#imp-state-banner` | Toujours visible | Afficher état sidecar/busy/erreur/prêt | `_refreshRuntimeState()` | `_isBusy`, `_lastErrorMsg`, `_files[]`, `_conn` | Sidecar requis pour état `ok` opérationnel | Message et couleur cohérents | Conforme | `state-wired` |

## Vérification C1..C10 (Importer)

- C1/C2/C3: satisfaits pour tous les contrôles `state-wired` listés.
- C4/C5/C6: satisfaits pour `#imp-index-btn`; partiels pour `#imp-import-btn` (non validable UI sans sélection de fichiers réelle).
- C7: logique disabled/enabled présente dans `_updateButtons()`.
- C8: KPI/badges précheck recalculés systématiquement.
- C9: aucun paramètre métier affiché mais totalement ignoré côté import (hors dropzone).
- C10: élément maquette partiellement branché identifié: dropzone visuelle sans ingestion réelle.
