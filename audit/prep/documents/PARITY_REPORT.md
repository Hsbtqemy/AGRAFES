# Audit — Vue Documents (Métadonnées) — Tauri Prep V1.5

**Mockup :** `prototypes/visual-validation/prep/prep-documents-vnext.html`
**Runtime :** `tauri-prep/src/screens/MetadataScreen.ts` + `tauri-prep/src/ui/app.css`
**Date :** 2026-03-01

---

## Résumé exécutif

La vue Documents (MetadataScreen) implémente un layout **2 colonnes** (liste doc + panneau édition) qui correspond
à la structure générale du mockup. Cependant plusieurs composants de la colonne gauche sont moins riches :
le mockup prévoit une **table HTML** avec checkboxes batch et barre d'actions groupées, et une **barre KPI** en tête
de liste, absentes du runtime.

---

## B1 — Layout général

| Élément | Mockup | Runtime | Delta | Priorité |
|---------|--------|---------|-------|----------|
| Structure globale | 2-col : liste table (gauche) + panneau édition (droite) | `.meta-layout` 2-col grid ≈ OK | ≈ OK | — |
| Ratio colonnes | `1.2fr + 1fr` approx | `grid-template-columns: 1fr 1fr` | Minor | P3 |
| Panneau édition collapsible | Colonne droite fixe | Colonne droite fixe avec `meta-edit-panel` | ≈ OK | — |

**Source runtime :**
```typescript
// MetadataScreen.ts — structure générale
<div class="meta-layout">
  <div class="meta-list-panel">  // colonne gauche
    <div class="doc-list" id="meta-doc-list">  // liste divs
  </div>
  <div class="meta-edit-panel">  // colonne droite
    <form id="meta-edit-form">
```

---

## B2 — Barre KPI en tête de liste

| Élément | Mockup | Runtime | Delta | Priorité |
|---------|--------|---------|-------|----------|
| Barre KPI (totaux) | Row: "N documents" · "N langues" · "N pivots" · "N cibles" | Absent | Manque | **P1** |
| Filtre par statut | Dropdown "Tous / Pivot / Cible / Sans relation" | Absent | Manque | **P1** |
| Filtre par langue | Dropdown langue | Absent | Manque | **P2** |

---

## B3 — Liste de documents

| Élément | Mockup | Runtime | Delta | Priorité |
|---------|--------|---------|-------|----------|
| Type de composant liste | `<table>` avec colonnes (Titre, Langue, Rôle, Type, Unités, Actions) | `<div class="doc-item">` par document | Diff structure | **P1** |
| Checkboxes de sélection | Checkbox par ligne + checkbox "tout sélectionner" en en-tête | Absent | Manque | **P1** |
| Barre d'actions batch | "N sélectionnés" + boutons Modifier/Supprimer en lot | Absent | Manque | **P1** |
| Colonnes visibles | Titre · Langue · Rôle · Type · Nb unités · boutons | Titre · Langue · Rôle (div inline) | Colonnes manquantes | **P2** |
| Tri par colonne | Entêtes cliquables pour trier | Absent | Manque | **P2** |
| Ligne active highlight | `background: #eff6ff; border-left: 3px solid #2563eb` | `.active` class présente (style basique) | Partiel | P3 |
| Item hover | bg `#f8fafc` | hover défini dans CSS | ≈ OK | — |

---

## B4 — Panneau d'édition (colonne droite)

| Élément | Mockup | Runtime | Delta | Priorité |
|---------|--------|---------|-------|----------|
| Titre section | "Modifier les métadonnées" | Présent | ≈ OK | — |
| Champs : titre, langue, rôle, resource_type | Tous présents | Tous présents | ✅ | — |
| Champ notes/description | Textarea dans mockup | `<textarea id="meta-notes">` présent | ✅ | — |
| Boutons Enregistrer / Annuler | Présents | Présents | ✅ | — |
| Onglets preview | 2 onglets : "Aperçu" (texte) + "Métadonnées JSON" | Absent — formulaire seul | Manque | **P2** |
| Compteur unités | "N unités de segmentation" dans panneau | Absent | Manque | P3 |

---

## B5 — États vides et sélection multiple

| État | Mockup | Runtime | Priorité |
|------|--------|---------|----------|
| Aucun document | Message + lien "Importer" | `<p>Aucun document importé</p>` | P3 |
| Aucun doc sélectionné (panneau droit) | Placeholder "Sélectionnez un document" | Affiche formulaire vide | P3 |
| N sélectionnés (batch) | Barre contextuelle activée | Non implémenté | P1 (hérite de B3) |
| Erreur save | Toast rouge + highlight du champ | Toast présent | P3 |

---

## D — Breakpoints

| Breakpoint | Mockup | Runtime | Priorité |
|------------|--------|---------|----------|
| 1440px | Liste table 60% / panneau 40% | grid 50/50 | P3 |
| 1728px | Colonnes plus larges, table affiche plus de colonnes | Idem 50/50 | P2 |

---

## Synthèse vue Documents

| Réf | Élément | Priorité |
|-----|---------|----------|
| DOC-1 | Liste divs → table HTML avec checkboxes | **P1** |
| DOC-2 | Barre KPI (totaux documents) | **P1** |
| DOC-3 | Filtre statut (Pivot / Cible / Tous) | **P1** |
| DOC-4 | Barre actions batch (multi-sélection) | **P1** |
| DOC-5 | Onglets preview (Aperçu / JSON) | **P2** |
| DOC-6 | Colonnes manquantes (Nb unités, Type) | **P2** |
| DOC-7 | Filtre par langue | **P2** |
| DOC-8 | Tri par colonne | **P2** |
| DOC-9 | Ratio colonnes (50/50 → 60/40) | P3 |
| DOC-10 | Compteur unités dans panneau édition | P3 |

**Total vue Documents : 4 P1 · 4 P2 · 2 P3**
