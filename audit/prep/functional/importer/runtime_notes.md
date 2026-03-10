# Importer — runtime_notes

## Contexte de test

- Audit principal: statique (wiring UI/state/logique).
- Probe runtime backend: sidecar lancé en CLI, jobs `index` validés.
- Limite: absence d’automatisation UI Tauri (dialogs natifs `open/save` non pilotés ici).

## États couverts

- Sidecar off:
  - attendu/observé: `#imp-state-banner` bascule en erreur, boutons d’action désactivés via `_updateButtons()`.
- Sidecar on + corpus vide:
  - `index` exécutable (0 unité indexée), état affiché cohérent.
- Sidecar on + corpus avec données:
  - non requis pour `index`; import non validé UI faute sélection de fichiers via dialog natif.
- Erreur / absence sélection:
  - bouton import reste disabled si aucun `pending`.

## Points non validables dans cet état

- E2E strict du bouton `Importer le lot` (dialog natif + fichiers réels + feedback UI complet).
- Vérification visuelle de progression multi-jobs dans la liste sans session UI pilotée.
