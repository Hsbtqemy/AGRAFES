# Audit — Vue Alignement — Tauri Prep V1.5

**Sprint :** Align Audit pre-Inc1
**Date :** 2026-03-09
**Mockups analysés :**
  - `prototypes/visual-validation/prep/prep-alignement-vnext.html` (1471 lignes) — "mode focus segment"
  - `prototypes/visual-validation/prep/prep-alignement-run-vnext.html` (1800 lignes) — "vue run globale"
**Runtime :** `tauri-prep/src/screens/ActionsScreen.ts` (l.1204–1514) + `tauri-prep/src/ui/app.css`
**Viewports :** 1440×900 · 1728×1080
**Artefacts :** `runtime_1440.png` · `runtime_1728.png` · `metrics_1440.json` · `metrics_1728.json`

---

## 1. Résumé exécutif

Le runtime Alignement est **fonctionnellement riche** (audit + batch + retarget + collisions + qualité, V1.2–V1.5) — bien au-delà des deux mockups. Mais la **structure visuelle diverge** sur 3 points P1 exploitables dès Inc 1 :

1. La section "Texte complet aligné" (table audit + run-rows) est cachée derrière une interaction explicite, alors que les mockups la rendent immédiatement accessible après un run.
2. L'`aside.align-focus` (correction ciblée, 320px fixe) s'effondre à 117px en état vide — déséquilibre visuel important dans la grille 2-col.
3. Aucune bande de contexte corpus n'est visible en tête de vue (VO active, doc cible, statut run) — information que les deux mockups mettent en avant.

Les écarts P2–P3 concernent la proportion de la sidebar à 1728px et le style des champs du launcher.

---

## 2. État de comparabilité

| État runtime | Comparabilité avec mockup | Note |
|-------------|--------------------------|------|
| **Vide** (pas de run) | Partielle | Mockups affichent du contenu post-run. Launcher visible OK. |
| **Après run** (`#act-align-results` visible) | Bonne | KPIs, synthèse — structure comparable |
| **Audit chargé** (`#act-audit-panel` visible) | Bonne | Run-toolbar, table — structure comparable |
| **Run-row view** (toggle "⊙ Run") | Bonne | `.run-row` CSS conforme au mockup 2 (3-col 1fr/72px/1fr) |

**Mockup principal de référence :** `prep-alignement-run-vnext.html` — le titre runtime "Alignement — vue run globale" est identique à ce mockup. Les captures sont en état **vide** (pas de run actif).

---

## 3. Métriques runtime mesurées

| Élément | 1440px | 1728px |
|---------|--------|--------|
| align_card (w×h) | 1175 × 343 | 1463 × 343 |
| align_layout (w×h) | 1141 × 269 | 1429 × 269 |
| align_layout grid | `808.8px 320px` | `1096.8px 320px` |
| align_main (w) | 809 px | 1097 px |
| align_focus (w×h) | 320 × **117** px | 320 × **117** px |
| align_setup_row grid | `251.6px 251.6px 251.6px` | `341.6px 341.6px 341.6px` |
| wf_section (h, collapsed) | 73 px | 73 px |
| quality_card (h, collapsed) | 71 px | 71 px |
| collision_card (h, collapsed) | 71 px | 71 px |
| report_card (h, collapsed) | 71 px | 71 px |
| scroll_height total | **1147 px** | **1147 px** |
| align_results | display:none | display:none |
| audit_panel | display:none | display:none |

**Présences DOM : 18/18 éléments présents.**

---

## 4. Écarts structurels (P1)

---

### ALIGN-1 — P1 · `audit_panel` et `align_results` cachés au chargement

**Symptôme :**
`#act-audit-panel` (`display:none`) et `#act-align-results` (`display:none`) sont invisibles au chargement. L'utilisateur voit seulement le launcher (config du run). La table d'audit et la synthèse n'apparaissent qu'après interactions explicites (lancer un run, puis cliquer "Charger les liens").

**Mockup 2 :**
Le mockup `prep-alignement-run-vnext.html` structure la page en 3 cartes toujours visibles :
1. Card "Lancer un run" (setup)
2. Card "Synthèse du run" (5 KPIs + boutons, visibles post-run)
3. Card "Texte complet aligné" (run-layout height:64vh, toujours visible)

Dans le mockup, la "Synthèse" et le "Texte complet aligné" sont des cartes permanentes, pas des zones cachées à l'intérieur d'une unique `align-layout`.

**Root cause :**
Le runtime place les 3 états (launcher + results + audit) à l'intérieur d'un seul `.align-main` en stack vertical, avec des toggle `display:none/block`. Le mockup les traite comme des cartes séparées de premier niveau.

**Impact :** L'utilisateur ne voit pas les résultats précédents au rechargement. La vue "vide" sous-utilise l'espace disponible (align_card h=343px seulement).

**Fix Inc 1 :** Afficher `#act-align-results` automatiquement s'il existe un `_alignRunId`, et `#act-audit-panel` si des liens ont été précédemment chargés (persistance de la dernière recherche).

---

### ALIGN-2 — P1 · `align_focus` s'effondre à 117px en état vide

**Symptôme :**
`aside.align-focus` = 320×**117**px en état vide aux deux viewports. La grille `align-layout` (1fr + 320px) est donc déséquilibrée : `.align-main` fait 269px de haut, `.align-focus` seulement 117px.

Le contenu visible de `.align-focus` en état vide : h4 "Correction ciblée" + p "Sélectionnez une ligne..." (hint vide). Hauteur naturelle = 117px.

**Mockup 2 :**
L'`editor-pane` a `height: 100%; min-height: 0` et remplit la hauteur du `run-layout` (`64vh`). L'`inline-audit` est scrollable à l'intérieur.

**Root cause :**
CSS `.align-focus` n'a pas de `min-height`. En état vide, il se réduit à son contenu naturel. CSS actuel :
```css
.align-focus {
  border: 1px solid var(--prep-line, #dde1e8);
  border-radius: 10px;
  padding: 12px;
  position: sticky;
  top: 0;
  align-self: start;
}
```
Aucun `min-height` défini.

**Fix Inc 1 :** `min-height: 200px` sur `.align-focus` pour garantir un état vide visuellement cohérent.

---

### ALIGN-3 — P1 · Context corpus absent en tête de vue

**Symptôme :**
La vue Alignement ne montre aucun contexte corpus en tête : VO active, document cible, statut dernier run, nombre de segments. L'utilisateur ne sait pas, sans naviguer, quel corpus est chargé et quel est l'état de l'alignement.

**Mockup 1 :**
`section.card.context-card` avec `.context-grid` (4 items : VO active, Traduction en cours, Dernière segmentation, Segments VO/TR) + `.context-foot` (mini-chip statut + CTA).

**Mockup 2 :**
Pill dans le head-card "run: align_2026-03-04_10h14" — identifiant du run actif visible.

**Runtime :**
`#act-align-run-pill` = "Liens pivot ↔ cible" (texte statique, non mis à jour). Aucune card de contexte.

**Root cause :**
Non implémenté. La pill est statique au lieu de refléter le run actif (`this._alignRunId`).

**Fix Inc 1 minimal :** Mettre à jour `#act-align-run-pill` avec le run ID quand `_alignRunId` est défini. Fix structurel : ajouter une bande de contexte légère sous le head card (doc pivot + doc cible + statut + timestamp).

---

## 5. Écarts de densité/proportion (P2)

---

### ALIGN-4 — P2 · `align_focus` : 320px fixe, non proportionnel à 1728px

**Symptôme :**
`align_focus` = 320px à 1440px **et** 1728px. À 1728px : align_main = 1097px vs focus = 320px → ratio 3.4:1. Le focus pane représente seulement 22.5% de l'`align_layout`.

**Mockup 2 :**
`run-layout { grid-template-columns: minmax(0, 1.65fr) minmax(300px, 0.95fr) }` — l'editor-pane grandît avec le viewport. À 1728px (contenu ~1429px), l'editor-pane ≈ 543px (38%).

**Fix Inc 1 :** Rendre la sidebar proportionnelle :
```css
.align-layout {
  grid-template-columns: minmax(0, 1fr) minmax(280px, 0.38fr);
}
```
Donne ~324px à 1440px, ~408px à 1728px.

---

### ALIGN-5 — P2 · Alignment-focus 320px fixe + sticky ne remplit pas la grille

**Symptôme :**
Avec `align_focus` à 117px et `align_main` à 269px, il y a 152px de hauteur "flottante" dans la grille en état vide. La grille `align-layout` a `align-items:start` ce qui laisse le focus pane court.

**Mockup 2 :**
`align-items: stretch` sur le `run-layout` → editor-pane remplit toute la hauteur.

**Fix Inc 1 :**
```css
.align-layout { align-items: stretch; }
.align-focus { align-self: stretch; min-height: 200px; }
```

---

### ALIGN-6 — P2 · Champs du launcher : labels plats vs field-cards

**Symptôme :**
L'`align-launcher` utilise `align-setup-row` avec `<label>` plats (grid 3-col). Les fields de stratégie, pivot, cibles ont peu de définition visuelle.

**Mockup 2 :**
Champs dans `.f` (field-card) : `border:1px solid var(--line); border-radius:9px; background:#fff; padding:8px` avec `<strong>` label en haut et `<select>` en dessous. Visuellement bien distincts.

**Impact :** Densité informationnelle réduite pour la configuration du run. P2 uniquement — fonctionnel.

---

## 6. Faux positifs (liés à l'état vide)

| Point | Aspect | Verdict |
|-------|--------|---------|
| `align_results` (0×0) | hidden — pas de run lancé | Faux positif état vide |
| `audit_panel` (0×0) | hidden — audit non chargé | Faux positif état vide |
| `run_toolbar` (0×0) | hidden dans `audit_panel` | Faux positif état vide |
| `align_kpis` (0×0) | hidden dans `align_results` | Faux positif état vide |
| `doc_list_card` (0×0) | card "Docs du corpus" collapsée | Faux positif (collapsed) |
| Pill statique "Liens pivot ↔ cible" | Run ID non affiché | Vrai P1 (non état vide) |

---

## 7. Éléments surplus runtime (au-delà des mockups)

| Élément | Description | Impact visuel |
|---------|-------------|---------------|
| `section.card.workflow-section` | Guide 5-étapes (Alignement → Rapport) | Collapsed 73px — faible |
| `#act-quality-card` | Qualité : coverage, orphelins, collisions (V1.2) | Collapsed 71px — faible |
| `#act-collision-card` | Résolution collisions (V1.5) | Collapsed 71px — faible |
| `#act-report-card` | Rapport de runs (export HTML/JSONL) | Collapsed 71px — faible |
| `#act-align-debug-panel` | Explainability JSON (debug) | Hidden — invisible |
| `run-view-toggle` | Bascule Tableau / Run-row | Utile, aligné mockup |
| `audit-batch-bar` | Actions batch sur sélection | Aligne V1.3 |
| `.align-focus` retarget btn | Bouton "⇄ Retarget" (V1.4) | Utile, non dans mockup |

Les 4 cartes collapsées sous `#act-align-card` amènent `scroll_height = 1147px` (viewport 900px à 1440px). L'utilisateur doit scroller 247px pour voir la zone sous le launcher. Elles ne sont pas dans les mockups mais correspondent à des fonctionnalités métier validées.

---

## 8. Causes racines probables

1. **Hiérarchie d'états cachés** : Toute la logique de révélation progressive (`display:none → block`) est fonctionnelle mais la structure HTML est unique-card-avec-sous-états. Le mockup a des cartes distinctes par état.
2. **`align-focus` sans min-height** : Une règle CSS triviale manquante.
3. **Pill statique** : `#act-align-run-pill` n'est pas mise à jour par `_runAlign()`.
4. **align-focus width fixe** : Hardcoded 320px sans media query ni minmax.

---

## 9. Recommandation Inc 1

**Scope minimal — 3 fixes CSS/TS :**

| Fix | Fichier | Coût |
|-----|---------|------|
| ALIGN-2 : `min-height` sur `.align-focus` + `align-items:stretch` sur `.align-layout` | app.css | 2 lignes CSS |
| ALIGN-4 : `align-focus` proportionnel à 1728px (`minmax(280px, 0.38fr)`) | app.css | 1 ligne CSS |
| ALIGN-3 minimal : mise à jour `#act-align-run-pill` avec run ID dans `_runAlign()` | ActionsScreen.ts | ~3 lignes TS |

**ALIGN-1** (audit_panel caché) et la context-card (ALIGN-3 structurel) sont des Inc 2 — ils impliquent une restructuration du HTML de `_renderAlignementPanel()` ou une logique de persistance.

---

## 10. Niveaux de priorité

| ID | Priorité | Nature | Fix |
|----|----------|--------|-----|
| ALIGN-1 | **P1** | Structural state | `audit_panel` visible automatiquement si liens précédents |
| ALIGN-2 | **P1** | CSS gap | `min-height:200px` + `align-items:stretch` sur `.align-focus` |
| ALIGN-3 | **P1** | Info manquante | Pill run ID + context-card (Inc 2 pour la card) |
| ALIGN-4 | P2 | Proportion | `minmax(280px, 0.38fr)` sur `align-focus` |
| ALIGN-5 | P2 | Density | `align-items:stretch` sur `align-layout` |
| ALIGN-6 | P2 | Visual polish | Field-card style pour les champs du launcher |
| ALIGN-7 | P3 | Surplus | Workflow guide (utile, acceptable) |
| ALIGN-8 | P3 | Surplus | 4 cards collapsées (utiles, acceptables) |

**Total : P1 = 3 · P2 = 3 · P3 = 2**
