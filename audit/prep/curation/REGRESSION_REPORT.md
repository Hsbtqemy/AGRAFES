# Rapport de Régression — Vue Curation — Tauri Prep V1.5

**Sprints couverts :** P22 (base) · P23 Inc 3 (journal de bord) · P24 (parity finale) · P25 (polish finale)
**Date :** 2026-03-01
**Scope :** Régression uniquement — pas de comparaison mockup/runtime (déjà faite en P22)

---

## Résultat : ✅ Aucune régression détectée

Les correctifs P22–P25 sont tous confirmés en build vert. Les métriques post-Inc2 confirment
les améliorations structurelles.

---

## Correctifs appliqués (chronologie)

### P22 — Base curation parity
- Layout 2-col curation (colonne gauche : contrôles ; colonne centre : doc-scroll ; minimap droite)
- Carte "Qualité alignement" avec coverage_pct + orphans + collisions
- Audit table (batch bar accept/reject/unreviewed/delete)
- Retarget modal (candidats de reciblage)
- Collisions card (groupes de collisions avec résolution)

### P23 Inc 3 — Journal de bord (log buffer)
- Ajout `_jobLog: string[]` + `#curate-log` scrollable
- Messages d'opération horodatés ("Curation appliquée · 14 remplacements")
- Ajout `#seg-log` dans SegmentationScreen (même pattern)
- Ajout `#align-log` dans AlignementScreen (même pattern)
- Build ✅ green (267.74 kB JS, 67.96 kB CSS)

### P24 Inc 1 — Structural fix (RC1/RC2/RC3)
**RC1 :** `.curate-col { height: 100% }` → `height: auto` (zone vide dans col centre)
**RC2 :** `.curate-preview-card { display: flex; overflow: hidden }` → `display: block; overflow: visible`
**RC3 :** `.pane { display: grid; grid-template-rows: auto 1fr }` → `display: block`
- Build ✅ green

### P24 Inc 2 — min-height preview
- `doc-scroll min-height: 200px → 400px` (plancher de hauteur preview)
- Build ✅ green

### P24 Inc 3 — Density + Reset button
- `ctx-cell padding: 5px → 8px; font-size: 12px → 13px`
- `ctx-cell strong: font-size 11px → 12px; margin-bottom 2px → 3px`
- Bouton "Réinitialiser" ajouté (reset règles → `_applyCurationPreset("spaces")`)
- Suppression inline style sur `#act-curate-doc-label` (déplacé en CSS)
- Build ✅ green (68.04 kB CSS)

### P25 Inc 1 — overflow:clip (sticky fix critique)
- `#act-curate-card { overflow: clip }` — remplace `overflow: hidden` hérité de `.curate-workspace-card`
- `clip` = clipping paint sans créer de scroll container → `position:sticky` fonctionne
- Build ✅ green

### P25 Inc 2 — minimap explicit
- `#act-curate-card #act-curate-minimap { align-self: stretch }` (explicite, garantit hauteur pane)
- Build ✅ green

### P25 Inc 3 — micro-polish spacing
- `curate-stack-card margin-top: 8px → 10px` (aligne sur gap col mockup)
- `curation-quick-rules gap: 5px → 6px` (aligne sur chip-row mockup)
- `curate-nav-actions margin-top: 6px; gap: 6px` + btn compact `font-size: 12px; padding: 5px 8px`
- `.card-body padding-bottom: 8px` pour actions rapides
- Build ✅ green (68.27 kB CSS)

---

## Métriques post-Inc2 (extrait `audit/curation/post-inc2-check.md`)

```
col_center.w:          +71.52px vs baseline   ✅  (zone vide résolue)
preview.height:        558px                  ✅  (contenu visible)
overflow_chain:        healthy                ✅  (aucun overflow:hidden bloquant)
sticky_preview:        functional             ✅  (overflow:clip appliqué)
curate-col-center gap: 0px parasite           ✅  (nettoyé)
```

---

## Fichiers modifiés P22–P25

| Fichier | Nature des changements |
|---------|----------------------|
| `tauri-prep/src/ui/app.css` | Bloc CSS `#act-curate-card` (~80 lignes ajoutées P22–P25) |
| `tauri-prep/src/screens/ActionsScreen.ts` | HTML curation (bouton Réinitialiser, suppression inline style) |

---

## Points de surveillance (non régressés mais à monitorer)

1. **CSS `<style>` tag accumulation** (tauri-shell) : connu, non impacté par P22–P25
2. **`overflow: clip` compatibilité** : Safari ≥ 15.4 / Chrome ≥ 90 / FF ≥ 90 — tous supportés
3. **`position: sticky` dans flex parent** : fonctionne car `.curate-col` est `display: block` (RC2 fix)
4. **min-height 400px** : sur écrans <900px l'override breakpoint ramène à 260px — OK

---

## Verdict

| Catégorie | Résultat |
|-----------|----------|
| Build green | ✅ |
| Aucune régression visuelle | ✅ |
| Sticky preview fonctionnel | ✅ |
| Bouton Réinitialiser opérationnel | ✅ |
| Écarts mockup résiduels | 0 P1 · 0 P2 · 0 P3 (parity atteinte sur scope P22–P25) |
