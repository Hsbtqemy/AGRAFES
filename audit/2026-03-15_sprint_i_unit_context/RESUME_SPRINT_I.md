# Sprint I — Résumé

**Date :** 2026-03-15  
**Portée :** tauri-app Concordancier — contexte documentaire local dans le meta panel

---

## Objectif

Enrichir le meta panel avec le voisinage immédiat (±1 unité) de l'unité affichée, et permettre la navigation dans le document sans être contraint aux hits chargés.

---

## Livrables réalisés

| Livrable | Fichier | Statut |
|---|---|---|
| Backend GET `/unit/context` | `src/multicorpus_engine/sidecar.py` | ✓ |
| Types TS + `getUnitContext()` | `tauri-app/src/lib/sidecarClient.ts` | ✓ |
| Section "Contexte local" meta panel | `tauri-app/src/features/metaPanel.ts` | ✓ |
| Navigation `← Unité préc.` / `Unité suiv. →` | `tauri-app/src/features/metaPanel.ts` | ✓ |
| Styles `.meta-context-*` | `tauri-app/src/ui/dom.ts` | ✓ |
| Build/typecheck OK | — | ✓ |

---

## Ce qui a changé

### Backend (`sidecar.py`)

- Route `GET /unit/context` dans `do_GET` → `_handle_unit_context(qs)`
- `_handle_unit_context` : validation `unit_id`, 4 requêtes SQL ciblées, réponse JSON avec `unit_index` (1-based), `total_units`, `prev` / `current` / `next` (ou `null` en début/fin de document)
- Read-only, sans token requis

### Client TS (`sidecarClient.ts`)

- `UnitContextItem` : `{ unit_id, text }`
- `UnitContextResponse` : `{ doc_id, unit_id, unit_index, total_units, prev, current, next }`
- `getUnitContext(conn, unitId)` → `conn.get("/unit/context?unit_id=...")`

### Meta panel (`metaPanel.ts`)

- Section "Contexte local (voisinage documentaire)" affichée sous l'extrait
- `loadUnitContext(unitId, body)` : appel async à `getUnitContext`, mise à jour en place
- `renderLocalContext(body, ctx)` :
  - Ligne de position `§ unit_index / total_units`
  - Bloc prev (si disponible) / bloc current (mis en avant) / bloc next (si disponible)
  - Boutons `← Unité préc.` / `Unité suiv. →` (désactivés en début/fin de doc)
- `_navigateToUnit(docId, unitId, text, body)` : construit un hit synthétique, recharge le panel, refetch le contexte — fonctionne hors des hits chargés

### CSS (`dom.ts`)

- `.meta-context-wrap`, `.meta-context-loading`, `.meta-context-error`
- `.meta-context-block`, `.meta-context-current` (bordure + fond brand)
- `.meta-context-label`, `.meta-context-text`
- `.meta-context-pos-line`, `.meta-context-pos`
- `.meta-context-nav-line`, `.meta-context-nav-btn`

---

## Comportements à valider manuellement

- [ ] Ouvrir un hit → section "Contexte local" se remplit (prev / courante / suivante, §index/total)
- [ ] Unité courante visuellement mise en avant (bordure brand)
- [ ] Début de document → pas de bloc prev, bouton `← Unité préc.` désactivé
- [ ] Fin de document → pas de bloc next, bouton `Unité suiv. →` désactivé
- [ ] Clic `← Unité préc.` → panel rechargé sur l'unité précédente (même hors résultats)
- [ ] Clic `Unité suiv. →` → panel rechargé sur l'unité suivante (même hors résultats)
- [ ] Navigation Précédent/Suivant (entre hits chargés, pied de panel) inchangée
- [ ] Si `/unit/context` échoue → message "Contexte indisponible."

---

## Limites connues

- Fenêtre fixe ±1 unité (pas de ±2, ±3) — suffisant pour la navigation légère
- L'index `unit_index` est 1-based parmi les `unit_type = 'line'` uniquement
- Hit synthétique lors de la navigation hors résultats : `external_id = null`, position §N absente (récupérée via le nouveau contexte au rechargement)

---

## Pistes Sprint J

- Fenêtre configurable (±2, ±3) via paramètre `window` sur `/unit/context`
- Mise en évidence du terme de recherche dans les blocs prev/next
- Navigation clavier dans le contexte (←→ flèches)
