# Post-Inc1 Visual Check — Vue Documents

**Sprint :** Documents Inc 1
**Date :** 2026-03-09
**Viewports mesurés :** 1440×900 · 1728×1080
**Artefacts :** `runtime_after_inc1_1440.png` · `runtime_after_inc1_1728.png`
           `runtime_after_inc1_1440_metrics.json` · `runtime_after_inc1_1728_metrics.json`

---

## Métriques clés

| Indicateur | 1440px | 1728px |
|------------|--------|--------|
| workspace total | 1175px | 1463px |
| col liste (list_card) | **626px** | **782px** |
| col édition (edit_card) | 532px | 665px |
| ratio liste/édition | **1.18:1** | **1.17:1** |
| table docs width | 590px | 746px |
| head card height | 107px | 107px |
| KPI bar width | 287px | 287px |
| state banner | 305px (chip top-right) | 305px (chip top-right) |
| toolbar height | 56px (wrap 2 lignes) | 29px (1 ligne) |
| batch bar au repos | `display:none` ✅ | `display:none` ✅ |

---

## Améliorations objectives

| Critère | Avant Inc 1 | Après Inc 1 | Delta |
|---------|------------|-------------|-------|
| Ratio liste/édition | 0.72:1 (liste étroite) | **1.18:1 (liste dominante)** | ✅ Inversé |
| Structure listing | `<div>` plat 2 lignes | Table 6 colonnes + checkboxes | ✅ Structural |
| Filtres | 1 input texte | Input + statut + reset | ✅ |
| Batch actions | Absente | Bar contextuelle (display:none au repos) | ✅ |
| KPI / résumé | Absent | 4 chips (total/validés/à traiter/langues) | ✅ |
| State banner | Carte collapsible isolée | Chip compact dans head card | ✅ |
| Backup / Validate | Dans carte collapsible | Toujours visibles (head card) | ✅ |
| Présence de tous les composants | — | 10/10 ✅ | ✅ |
| Régressions logique | — | 0 | ✅ |

---

## Liste dominante — verdict

**Oui.** Le ratio est désormais 1.18:1 en faveur de la liste à 1440px et 1728px.
Avant Inc 1, la liste faisait 260px et le panel d'édition 360px — la liste était plus étroite que le formulaire d'édition. C'est corrigé structurellement.

La table occupe 590px à 1440px et 746px à 1728px, ce qui laisse une largeur suffisante pour afficher les 6 colonnes (ID · Titre · Langue · Rôle · Statut · checkbox) sans compression notable.

---

## Colonne droite — verdict

**Bien cadrée.** 532px à 1440px, 665px à 1728px — proportions correctes pour un panel d'édition de formulaire. La carte affiche "Sélectionnez un document" en état vide (138px, sobre). Pas d'overflow visible.

---

## Batch bar — verdict

**Utile, non intrusive.** `display:none` au repos (0×0px dans les métriques) — elle n'occupe aucun espace visuel sans sélection active. S'active proprement (`.active` → `display:flex`) dès qu'une case est cochée. Comportement correct.

---

## Head card — verdict

**Lisible.** 107px de hauteur, contient :
- Titre + description
- State banner chip compact en top-right (305px, positionné à x:1100 à 1440px)
- KPI bar (4 chips) en bas-gauche
- Actions corpus (backup, validate) en bas-droite

L'organisation bi-rangée (head-top + head-bottom) fonctionne. À l'état "sidecar indisponible", le state banner est rouge et visible sans prendre de place disproportionnée.

---

## Problèmes restants (Inc 2)

### ⚠️ P2 — Toolbar : wrap à 1440px

La toolbar mesure **56px à 1440px** (2 lignes) vs **29px à 1728px** (1 ligne).

**Cause** : `.actions-screen select { width: 100% }` (spécificité 0,1,1) prend le dessus sur `.meta-filter-select { width: auto }` (spécificité 0,1,0). Le `<select>` statut passe à 100% de largeur et force un wrapping.

**Fix Inc 2** — 1 règle CSS, renforcer la spécificité :
```css
/* Remplacer dans le bloc MetadataScreen vNext */
.actions-screen .meta-filter-select { width: auto; max-width: none; }
.actions-screen .meta-filter-input  { flex: 1 1 140px; max-width: none; }
```

### ⚠️ P3 — Table height minimale sans données

60px = thead (≈31px) + 1 ligne "Sidecar non connecté" (≈29px).
Comportement attendu sans sidecar — pas un bug. Mais visuellement la table occupe très peu d'espace en état vide, ce qui rend la `.meta-doc-list-wrap` peu imposante.

**Fix optionnel Inc 2** : `min-height: 120px` sur `.meta-doc-list-wrap` pour imposer une hauteur minimale même à vide.

---

## Synthèse

| Critère | Verdict |
|---------|---------|
| Liste dominante | ✅ 626px vs 532px (ratio 1.18:1) |
| Colonne droite bien cadrée | ✅ |
| Batch bar utile / discrète | ✅ |
| Head card lisible | ✅ |
| KPI bar présente | ✅ |
| Toolbar (filtres) | ⚠️ Wrap à 1440px (CSS spécificité) |
| Régressions | 0 |
| Bloquants prod | 0 |

---

## Recommandation

**Commit Inc 1 + Inc 2 léger immédiat.**

Inc 1 est un saut structurel réel : inversion liste/édition, table, filtres, batch, KPI, head card. Aucune régression logique. L'issue residuelle (toolbar wrap à 1440px) est un bug CSS de spécificité pur, corrigeable en 2 lignes. Inc 2 peut être fait dans la foulée sans remaniement.
