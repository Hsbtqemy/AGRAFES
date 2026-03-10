# Audit — Vue Segmentation — Tauri Prep V1.5

**Sprint :** Seg Audit pre-Inc1
**Date :** 2026-03-09
**Mockups :** `prototypes/visual-validation/prep/prep-segmentation-vo-vnext.html`
            `prototypes/visual-validation/prep/prep-segmentation-translation-vo-native-layout-vnext.html`
**Runtime :** `tauri-prep/src/screens/ActionsScreen.ts` + `tauri-prep/src/ui/app.css`
**Viewports :** 1440×900 · 1728×1080
**Artefacts :** `runtime_1440_units.png` · `runtime_1440_longtext.png`
              `runtime_1728_units.png` · `runtime_1728_longtext.png`
              `metrics_1440.json` · `metrics_1728.json`

---

## Statut : ✅ Analyse complète

---

## Métriques runtime mesurées

### Mode Unités (normal_view)

| Élément | 1440px | 1728px |
|---------|--------|--------|
| seg_workspace (w×h) | 1173 × 539 | 1461 × 539 |
| grid-template-columns | `28px 310px 834.8px` | `28px 310px 1122.8px` |
| seg_side (collapsed) | 28 × 539 | 28 × 539 |
| seg_col_left | 310 × 539 | 310 × 539 |
| seg_col_right | 835 × 450 | 1123 × 450 |
| preview_card | 835 × 450 | 1123 × 450 |
| preview_tabs | 833 × 37 | 1121 × 37 |
| preview_body | 833 × 300 | 1121 × 300 |
| preview_body grid | `768.8px 38px` | `1056.8px 38px` |
| doc_scroll_seg | 767 × 254 | 1055 × 254 |
| minimap_units | 38 × 284 | 38 × 284 |
| batch_overview | 309 × 109 | 309 × 109 |
| params_inner_card | 309 × 420 | 309 × 420 |

### Mode Longtext (lt_view)

| Élément | 1440px | 1728px |
|---------|--------|--------|
| lt_view (w×h) | 1175 × 577 | 1463 × 577 |
| lt_workspace (w×h) | 1141 × 480 | 1429 × 480 |
| lt_workspace grid | `360px 780.8px` | `360px 1068.8px` |
| lt_col_left | 360 × 480 | 360 × 480 |
| lt_col_right | 781 × 367 | 1069 × 367 |
| lt_preview | 781 × 367 | 1069 × 367 |
| lt_preview_body grid | `354.4px 354.4px 38px` | `498.4px 498.4px 38px` |
| **lt_minimap (mesuré)** | **354 × 200** | **498 × 200** |
| lt_minimap (attendu) | **38 × ≈200** | **38 × ≈200** |

---

## Problèmes identifiés

---

### SEG-S1 — P1 · BUG CRITIQUE · Longtext minimap mal positionnée dans la CSS Grid

**Symptôme observé :**
Le minimap longtext (`#act-seg-lt-minimap`, `<aside class="minimap">`) occupe 354px à 1440px et 498px à 1728px, alors qu'il devrait occuper la colonne de 38px réservée à cet effet dans la grille `preview-body`.

**Root cause :**
`.acts-seg-lt-sticky-preview .preview-body` est déclaré avec :
```css
grid-template-columns: 1fr 1fr 38px;
```
soit 3 colonnes : `[pane-a] [pane-b] [minimap 38px]`.

En mode longtext, le `preview-body` contient 4 enfants :
1. `#act-seg-lt-seg-scroll` — pane-a (doc VO segmenté)
2. `#act-seg-lt-trad-scroll` — pane-b (doc traduction aligné)
3. `#act-seg-lt-native-scroll` — pane-c (langue native — visible conditionnellement)
4. `<aside class="minimap">` — minimap 38px

Quand `pane-b` ou `pane-c` ont `display:none`, CSS Grid les retire du flux et le comptage automatique de colonnes (auto-placement) change. La grille place le minimap en colonne 2 (1fr = 354-498px) au lieu de la colonne 3 (38px).

**Preuve :**
- `lt_preview_body` grid mesuré : `354.406px 354.406px 38px` → col3 = 38px **vide**
- `lt_minimap` mesuré : 354px (colonne 2)

**Fix :**
Épingler le minimap en colonne 3 explicitement :
```css
.acts-seg-lt-sticky-preview .preview-body > aside.minimap {
  grid-column: 3;
}
```
Aucun impact sur les panes (leur auto-placement couvre les colonnes 1-2 quelle que soit leur combinaison active).

**Impact :** Minimap occupe ~354-498px de largeur inutile, comprime les deux panes de contenu, fausse l'affichage du document dans la vue longtext.

---

### SEG-S2 — P1 · Params col (seg_col_left) trop étroite à 1728px

**Symptôme observé :**
À 1440px comme à 1728px, `seg_col_left = 310px`. La grille est `28px 310px 1fr`.
- À 1440px : col-left=310px, col-right=835px → ratio 1:2.7 — acceptable.
- À 1728px : col-left=310px, col-right=1123px → ratio 1:3.6 — déséquilibré.

**Conséquences :**
- Les 4 boutons d'action de `params_inner_card` (Segmenter, Tout segmenter, …) wrappent sur 2 lignes dans 310px (`.btn-row` avec `flex-wrap:wrap`).
- `batch_overview` (309×109) montre un conteneur étroit à côté d'une colonne droite très large.
- La prévisualisation des unités dispose d'un espace disproportionné par rapport aux paramètres.

**Fix recommandé :**
```css
.seg-workspace {
  grid-template-columns: auto 340px 1fr;  /* +30px sur la col params */
}
```
+30px laisse respirer les boutons sans déborder sur la prévisualisation.

Variante : responsive uniquement au-dessus de 1600px :
```css
@media (min-width:1600px) {
  .seg-workspace { grid-template-columns: auto 340px 1fr; }
}
```

**Impact :** Cosmétique P1 mais affecte la lisibilité du panel de paramètres sur grands écrans.

---

### SEG-S3 — P2 · Incohérence de layout de formulaire Unités vs Longtext

**Symptôme observé :**
En mode Unités, `params_inner_card` utilise `div.form-grid-seg` (grille 2 colonnes : label + input côte à côte).
En mode Longtext, le même type de champ `Modèle` utilise `div.form-row` (flex horizontal, label + input inline).

**Code source :**
- Unités (ActionsScreen.ts ~line 786) : `<div class="form-grid-seg">…</div>`
- Longtext (ActionsScreen.ts ~line 958) : `<div class="form-row">…</div>`

**CSS :**
```css
.form-grid-seg { display:grid; grid-template-columns:90px 1fr; gap:6px 10px; }
.form-row { display:flex; gap:8px; align-items:center; }
```

Les deux sont fonctionnels mais visuellement différents. En mode longtext, les labels manquent d'alignement vertical constant quand plusieurs form-rows sont empilées.

**Fix :**
Remplacer `<div class="form-row">` par `<div class="form-grid-seg">` dans les params longtext. Aucun impact CSS additionnel requis.

**Impact :** Incohérence visuelle uniquement — non bloquant.

---

### SEG-S4 — P3 · Ratio `preview_body height` vs `preview_card height` (Unités)

**Symptôme observé :**
- `preview_card` : h=450px
- `preview_tabs` : h=37px (y=377 → 377+37=414)
- `preview_body` : h=300px (y=414 → 414+300=714) → dépasse preview_card (287+450=737)
- `doc_scroll_seg` : h=254px (dans preview_body h=300)

Le `preview_body` fait 300px de haut mais `doc_scroll_seg` seulement 254px, ce qui crée un gap de 46px non utilisé sous le scroll.

**Cause probable :** `preview_body` reçoit une hauteur auto calculée par le flex parent `preview_card`, mais `doc_scroll_seg` a un `max-height` ou `height` fixe inférieur (confirmé par CSS : `max-height:560px` sur doc-scroll — mais à 1440px le contenu réel est 254px, donc aucune troncation visible).

**Impact :** Visuel mineur. L'espace mort de 46px entre le bas du scroll et le bas du preview-card est peu perceptible mais réel. P3.

---

## Tableau récapitulatif

| ID | Priorité | Mode | Composant | Problème | Fix |
|----|----------|------|-----------|----------|-----|
| SEG-S1 | **P1** | Longtext | `lt_minimap` | Minimap 354-498px (col 2) au lieu de 38px (col 3) — bug CSS Grid display:none | `grid-column:3` sur `.acts-seg-lt-sticky-preview .preview-body > aside.minimap` |
| SEG-S2 | **P1** | Unités | `seg_col_left` | Params 310px trop étroit à 1728px — ratio 1:3.6, boutons wrappent | `.seg-workspace { grid-template-columns: auto 340px 1fr }` |
| SEG-S3 | P2 | Longtext | Formulaire params | `form-row` vs `form-grid-seg` — incohérence layout formulaire | Remplacer `form-row` par `form-grid-seg` en mode lt |
| SEG-S4 | P3 | Unités | `preview_body` | Gap 46px entre doc_scroll et bas preview_card | Ajuster `min-height` ou `flex-grow` sur doc_scroll_seg |

---

## Ce qui est correct (faux positifs écartés)

| Point | Verdict |
|-------|---------|
| Minimap Unités (`minimap_units`) | ✅ 38×284 — position correcte col 2 dans `preview_body` (`768px 38px`) |
| Sticky preview (`position:sticky`) | ✅ Confirmé sur `preview_card` et `lt_preview` |
| `seg_side` collapsed = 28px | ✅ Exact — grid `auto` résout à 28px |
| `seg_col_right` align-self:start | ✅ Non mesuré directement mais col-right h=450 < workspace h=539 → overflow correct |
| Longtext workspace 2-col | ✅ `360px 1fr` — lt_col_left=360 constant aux deux viewports |
| Mode bar présente (42px) | ✅ Aux deux viewports |
| Présences DOM (all) | ✅ 19/19 éléments présents |
| Responsive 1-col ≤1100px | Non testé (pas de capture 900px) — mais règle CSS confirmée |

---

## Recommandation

**Inc 1 scope recommandé :**

1. **SEG-S1 (P1)** — 1 ligne CSS. Fix immédiat, impact visuel majeur en mode longtext.
2. **SEG-S2 (P1)** — 1 ligne CSS. Fix `340px` ou media query ≥1600px.
3. **SEG-S3 (P2)** — 1 changement HTML dans `_renderLongtextView()`. Cohérence formelle.

SEG-S4 (P3) : optionnel, différable à Inc 2.

Les fixes P1+P2 sont 2 lignes CSS + 1 changement HTML — typiquement un micro-Inc 1 (30 min).

**Build attendu après Inc 1 :**
```bash
git diff --name-only
# tauri-prep/src/screens/ActionsScreen.ts  (SEG-S3 form-grid-seg)
# tauri-prep/src/ui/app.css               (SEG-S1 grid-column:3, SEG-S2 340px)
```
