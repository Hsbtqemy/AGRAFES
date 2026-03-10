# Diff Table — Alignement Runtime vs Mockup

**Date :** 2026-03-09
**Mockup principal :** `prep-alignement-run-vnext.html`
**Mockup secondaire :** `prep-alignement-vnext.html`

---

## Métriques clés

| Élément | Mockup (run-vnext) | Runtime 1440 | Runtime 1728 | Écart | Sévérité |
|---------|-------------------|-------------|-------------|-------|----------|
| Layout principal | `run-layout: 1.65fr / 0.95fr` (2-col, 64vh) | `align-layout: 1fr / 320px` (2-col) | `align-layout: 1fr / 320px` | Proportion diverge; fixe vs minmax | ⚠️ P2 |
| Focus pane width | `minmax(300px, 0.95fr)` ≈ 39% | 320px fixe (28%) | 320px fixe (22%) | Pane trop étroite à 1728px | ⚠️ P2 |
| **Focus pane height** | `height: 100%` (égale run-list) | **117px** (état vide) | **117px** (état vide) | Effondrement brutal en état vide | 🔴 P1 |
| align-layout align-items | `stretch` | `start` | `start` | Focus pane ne remplit pas | ⚠️ P2 |
| Texte complet aligné | Card toujours visible (64vh) | `display:none` par défaut | `display:none` par défaut | Invisible sans interaction | 🔴 P1 |
| Synthèse du run | Card permanente (post-run) | `display:none` par défaut | `display:none` par défaut | Invisible au rechargement | 🔴 P1 |
| Context card corpus | 4 KPI (VO, traduction, segm., segments) | Absent | Absent | Information manquante | 🔴 P1 |
| Pill run ID | "run: align_2026-03-04_10h14" | "Liens pivot ↔ cible" (statique) | idem | Statique, non mis à jour | 🔴 P1 |
| Champs launcher | `.f` field-card (bordé + strong label) | `<label>` plat dans grid | idem | Densité visuelle réduite | 🟡 P2 |

---

## Table diff zone par zone

| Zone | Symptôme runtime | Mockup attendu | Cause probable | Sélecteur / bloc | Impact | Fix minimal |
|------|-----------------|----------------|----------------|-----------------|--------|-------------|
| `align_focus` min-height | 117px en état vide, espace mort visible | Editor-pane remplit toute la hauteur (64vh) | CSS `.align-focus` sans `min-height` + `align-items:start` | `.align-focus` / `.align-layout` | Grille visuellement déséquilibrée | `min-height:200px` sur `.align-focus` + `align-items:stretch` sur `.align-layout` |
| `align_focus` width 1728px | 320px fixe = 22% de l'espace | `minmax(300px, 0.95fr)` ≈ 38% | CSS `.align-layout { grid-template-columns: minmax(0,1fr) 320px }` — pas de minmax sur la 2e col | `.align-layout` l.833 app.css | Focus pane étroit sur grands écrans | `minmax(0,1fr) minmax(280px, 0.38fr)` |
| `#act-audit-panel` (display:none) | Table audit invisible à l'arrivée | "Texte complet aligné" visible par défaut (post-run) | Logique d'état : panel révélé seulement après clic "Charger les liens" | `#act-audit-panel` style / `_renderAlignementPanel()` | Fonctionnalité principale cachée | Afficher automatiquement si `_lastAuditLinks` non vide |
| `#act-align-results` (display:none) | Synthèse du run invisible au rechargement | Card permanente post-run | `style.display=''` mis seulement lors du retour du job | `#act-align-results` / `_runAlign()` | Perte contexte au rechargement | Rétablir si `_alignRunId` défini |
| `#act-align-run-pill` | "Liens pivot ↔ cible" (statique) | "run: align_2026-03-04_10h14" (run ID actif) | Pill non mise à jour dans `_runAlign()` | `#act-align-run-pill` l.1215 | Contexte run illisible | `pillEl.textContent = this._alignRunId` dans `_runAlign()` |
| Context card corpus | Absent — aucune bande VO+cible+statut | `section.card.context-card` (4 KPI grid) | Non implémenté | — | Pas de contexte corpus visible sans ouvrir "Docs" | Ajouter mini-bande sous head card |
| Launcher fields (setup) | `<label>` plats dans `align-setup-row` | `.f` field-card (bordé, strong label) | Choix implementation | `.align-setup-row label` | Moins lisible mais fonctionnel | Styler `.align-launcher label` avec bordered-field pattern |

---

## Présences DOM (18/18)

| Élément | Runtime | Verdict |
|---------|---------|---------|
| `align_head_card` (`.acts-seg-head-card`) | ✅ (mesuré 0x0 = artefact : query retourne l'élément de la panel seg cachée en premier) | OK (présence confirmée visuellement) |
| `wf_section` | ✅ 73px (collapsed) | OK — surplus utile |
| `doc_list_card` | ✅ (inside collapsed card) | OK |
| `align_card` | ✅ 1175×343 | OK |
| `align_layout` | ✅ `808.8px 320px` | OK |
| `align_focus` | ✅ 320×117 | Bug height |
| `align_launcher` | ✅ 809×269 | OK |
| `align_setup_row` | ✅ 3-col | OK |
| `align_results` | ✅ (display:none) | État vide |
| `align_kpis` | ✅ (display:none) | État vide |
| `audit_panel` | ✅ (display:none) | État vide |
| `run_toolbar` | ✅ (display:none) | État vide |
| `audit_table_wrap` | ✅ (display:none) | État vide |
| `run_view_toggle` | ✅ | OK — toggle Tableau/Run présent |
| `quality_card` | ✅ 71px (collapsed) | Surplus utile |
| `collision_card` | ✅ 71px (collapsed) | Surplus utile |
| `report_card` | ✅ 71px (collapsed) | Surplus utile |
| `align_run_pill` | ✅ (statique) | P1 — contenu non mis à jour |

---

## Synthèse

| P | Count | IDs |
|---|-------|-----|
| **P1** | 4 | ALIGN-1 (`audit_panel` hidden), ALIGN-2 (`align_focus` h=117px), ALIGN-3 (context absent + pill statique) |
| P2 | 3 | ALIGN-4 (focus fixe 320px), ALIGN-5 (align-items:start), ALIGN-6 (launcher fields style) |
| P3 | 2 | ALIGN-7 (wf guide surplus), ALIGN-8 (4 cards collapsées) |
