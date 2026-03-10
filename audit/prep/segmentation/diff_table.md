# Diff Table — Segmentation Runtime vs Mockup

**Date :** 2026-03-09
**Viewports :** 1440×900 · 1728×1080

---

## Mode Unités

| Élément | Mockup | Runtime 1440 | Runtime 1728 | Écart | Sévérité |
|---------|--------|-------------|-------------|-------|----------|
| Layout workspace | 3 cols : side / params / preview | `28px 310px 835px` | `28px 310px 1123px` | Conforme (side auto → 28) | ✅ |
| Sidebar collapsed | ~28px | 28px | 28px | Exact | ✅ |
| Col params | 310px | 310px | 310px | Conforme 1440, **étroit 1728** (ratio 1:3.6) | ⚠️ SEG-S2 |
| Col preview | `1fr` | 835px | 1123px | Conforme (calc. sur espace disponible) | ✅ |
| Preview sticky | `position:sticky` | `position:sticky` | `position:sticky` | Exact | ✅ |
| Preview height | Adaptatif vh | 450px | 450px | Conforme (max-height:838px/1018px) | ✅ |
| Preview tabs (2 tabs) | Présents | 37px h | 37px h | Conforme | ✅ |
| Preview body grid | `1fr 38px` | `768.8px 38px` | `1056.8px 38px` | Conforme | ✅ |
| Minimap Unités | 38px wide | **38px** | **38px** | **Correct** | ✅ |
| Batch overview | Sous params | 309×109 | 309×109 | Conforme | ✅ |
| Params inner card | Pleine hauteur col | 309×420 | 309×420 | Conforme | ✅ |
| Form layout params | `form-grid-seg` (2-col) | `form-grid-seg` | `form-grid-seg` | Conforme | ✅ |
| Mode bar | 42px height | 42px | 42px | Exact | ✅ |

---

## Mode Longtext

| Élément | Mockup | Runtime 1440 | Runtime 1728 | Écart | Sévérité |
|---------|--------|-------------|-------------|-------|----------|
| Layout lt_workspace | `360px 1fr` | `360px 780.8px` | `360px 1068.8px` | Conforme | ✅ |
| lt_col_left | 360px | 360px | 360px | Exact | ✅ |
| lt_col_right | `1fr` | 781px | 1069px | Conforme | ✅ |
| lt_preview sticky | `position:sticky` | `position:sticky` | `position:sticky` | Exact | ✅ |
| lt_preview_body grid | `1fr 1fr 38px` | `354.4px 354.4px 38px` | `498.4px 498.4px 38px` | Conforme (3 cols) | ✅ |
| **lt_minimap position** | **col 3 = 38px wide** | **354px** ❌ | **498px** ❌ | **Bug : minimap en col 2 au lieu col 3** | 🔴 SEG-S1 |
| lt_minimap height | ~200px | 200px | 200px | Conforme | ✅ |
| lt_preview_body panes | 2 panes visibles | 2 panes | 2 panes | Conforme | ✅ |
| Form layout lt params | `form-grid-seg` | **`form-row`** | **`form-row`** | Classe différente — layout incohérent | 🟡 SEG-S3 |
| Mode bar | 42px | 42px | 42px | Exact | ✅ |

---

## Présences DOM

| Élément | Attendu | Runtime | Verdict |
|---------|---------|---------|---------|
| `head_card` | ✅ | ✅ | OK |
| `mode_bar` | ✅ | ✅ | OK |
| `mode_units` | ✅ | ✅ | OK |
| `mode_traduction` | ✅ | ✅ | OK |
| `mode_longtext` | ✅ | ✅ | OK |
| `longtext_hint` | ✅ | ✅ (display:none) | OK |
| `seg_side` | ✅ | ✅ | OK |
| `seg_col_left` | ✅ | ✅ | OK |
| `seg_col_right` | ✅ | ✅ | OK |
| `batch_overview` | ✅ | ✅ | OK |
| `preview_card` | ✅ | ✅ | OK |
| `preview_tabs` | ✅ | ✅ | OK |
| `preview_tools` | ✅ | ✅ | OK |
| `doc_scroll` | ✅ | ✅ | OK |
| `minimap` | ✅ | ✅ | OK |
| `lt_view` | ✅ | ✅ | OK |
| `lt_preview` | ✅ | ✅ | OK |
| `lt_preview_tools` | ✅ | ✅ | OK |
| `lt_minimap` | ✅ | ✅ | OK |

**Score présences : 19/19**

---

## Synthèse écarts

| ID | Mode | Élément | Mockup | Runtime | Type | Priorité |
|----|------|---------|--------|---------|------|----------|
| SEG-S1 | Longtext | `lt_minimap` width | 38px | 354–498px | Bug CSS Grid (display:none + auto-placement) | **P1** |
| SEG-S2 | Unités | `seg_col_left` ratio | — | 310px fixe @1728 | Density / proportion | **P1** |
| SEG-S3 | Longtext | Form params layout | `form-grid-seg` | `form-row` | Incohérence HTML | P2 |
| SEG-S4 | Unités | `preview_body` gap | — | 46px gap bas scroll | Density mineure | P3 |

**Total P1 : 2 · P2 : 1 · P3 : 1**
