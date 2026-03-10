# Post-Inc1 Check — Actions > Segmentation

**Sprint :** Seg Inc 1
**Date :** 2026-03-09
**Viewports :** 1440×900 · 1728×1080
**Artefacts :** `post-inc1/runtime_1440_units.png` · `post-inc1/runtime_1440_longtext.png`
              `post-inc1/runtime_1728_units.png` · `post-inc1/runtime_1728_longtext.png`
              `post-inc1/metrics_1440.json` · `post-inc1/metrics_1728.json`

---

## Métriques ciblées

| Indicateur | Avant (1440) | Après (1440) | Avant (1728) | Après (1728) |
|------------|-------------|-------------|-------------|-------------|
| Minimap longtext (w) | **354 px** ❌ | **38 px** ✅ | **498 px** ❌ | **38 px** ✅ |
| Col params `seg_col_left` | 310 px | **340 px** | 310 px | **340 px** |
| Ratio col-left / col-right | 1 : 2.7 | **1 : 2.4** | 1 : 3.6 | **1 : 3.2** |
| Minimap Unités (non touché) | 38 px ✅ | 38 px ✅ | 38 px ✅ | 38 px ✅ |
| Formulaire longtext | `form-row` | **`form-grid-seg`** | `form-row` | **`form-grid-seg`** |
| Présences DOM (19/19) | ✅ | ✅ | ✅ | ✅ |

---

## Ce qui s'est objectivement amélioré

| Point | Avant Inc 1 | Après Inc 1 |
|-------|------------|-------------|
| Minimap longtext | Écrasait 354-498px de la zone preview — bug CSS Grid display:none | **38px** — épinglée en colonne 3 via `grid-column:3` |
| Zone preview longtext | Comprimée (2 panes partagent ~354px chacun + minimap parasite) | **Panes retrouvent toute leur largeur** (354px / 498px × 2) |
| Colonne paramètres (Unités) | 310px — boutons wrappent à 1728px | **340px** — +30px libèrent les btn-row |
| Formulaire longtext | `form-row` (flex horizontal, labels non alignés) | **`form-grid-seg`** (grille 2-col, cohérent avec mode Unités) |
| Régressions | — | 0 — minimap Unités inchangé, toutes présences stables |

---

## Ce qui reste insuffisant

### ℹ️ P2 — Ratio col-left/col-right encore large à 1728px

À 1728px, `col-left = 340px` vs `col-right = 1093px` → ratio 1:3.2.
Le gain de 30px (310→340) est perceptible mais pas transformateur sur grand écran.
Si l'espace de preview devient un problème lors d'un remplissage réel (beaucoup d'unités), un ajustement à 360px ou une règle `@media (min-width:1600px)` pourrait être envisagé.

**Pas bloquant** — 340px évite le wrap des boutons aux deux viewports testés.

### ℹ️ P3 — Gap bas preview-card (Unités, SEG-S4)

`doc_scroll_seg` : 254px de contenu, `preview_body` : 300px alloués → 46px vides sous le scroll.
Non corrigé (hors scope Inc 1). Invisible sans contenu, non bloquant.

---

## Synthèse

| Critère | Verdict |
|---------|---------|
| Minimap longtext 38px | ✅ Corrigé — 38px aux deux viewports |
| Col params respire | ✅ 340px, boutons ne wrappent plus |
| Formulaire longtext cohérent | ✅ `form-grid-seg` aligné avec mode Unités |
| Pas de régression Unités | ✅ minimap 38px, présences 19/19 |
| Espace preview longtext récupéré | ✅ Panes retrouvent leur 1fr correct |
| Ratio 1728px encore large | ⚠️ 1:3.2 — acceptable, non bloquant |
| SEG-S4 gap bas preview | ℹ️ Différé Inc 2, invisible à vide |
| Bloquants prod | 0 |

---

## Recommandation

**Commit direct.** Les 3 fixes P1/P2 sont vérifiés aux deux viewports. Le bug le plus visible (minimap 354-498px) est résolu. La colonne paramètres ne wrappe plus. Le formulaire est cohérent.

Inc 2 optionnel (si souhaité) : SEG-S4 gap preview + ajustement ratio 1728px.
