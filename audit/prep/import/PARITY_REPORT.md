# Audit — Vue Import — Tauri Prep V1.5

**Mockup :** `prototypes/visual-validation/prep/prep-import-vnext.html`
**Runtime :** `tauri-prep/src/screens/ImportScreen.ts` + `tauri-prep/src/ui/app.css`
**Date :** 2026-03-01

---

## Résumé exécutif

La vue Import actuelle est une implémentation **v1 minimaliste** : une colonne de cartes empilées.
Le mockup vnext prévoit un **workspace 2-colonnes** avec un flux d'import guidé par étapes.
L'écart est **structurel** (P1) sur le layout et plusieurs composants absents.

---

## B1 — Layout général

| Élément | Mockup | Runtime | Delta | Priorité |
|---------|--------|---------|-------|----------|
| Structure globale | 2 colonnes : panneau gauche (dropzone + fichiers) + panneau droit (settings + résultats) | 1 colonne : cartes empilées verticalement | Manque colonne droite | **P1** |
| Dropzone principale | Composant dédié centré avec icône, texte "Glissez vos fichiers" + bouton Parcourir | Absent — liste de fichiers directement | Manque dropzone | **P1** |
| Colonne gauche | `flex: 1.4` avec liste de fichiers + dropzone | Toute la largeur | — | **P1** |
| Colonne droite | `flex: 1` avec carte settings + carte pré-vérification | Absent | — | **P1** |

**Source runtime :**
```typescript
// ImportScreen.ts — structure produite
<div class="screen-content">
  <div class="card mb-3">                     // carte "Ajouter des fichiers"
    <div class="file-list" id="import-files"> // liste fichiers directement
  <div class="card mb-3">                     // carte "Paramètres d'import"
    <div class="collapse-content" …>          // settings collapsible
```

**Source mockup :**
```html
<!-- prep-import-vnext.html -->
<div class="import-workspace">               <!-- grid 2-col -->
  <div class="import-left">
    <div class="dropzone">…</div>
    <div class="file-queue">…</div>
  </div>
  <div class="import-right">
    <div class="settings-card">…</div>
    <div class="precheck-card">…</div>
  </div>
</div>
```

---

## B2 — Indicateurs d'étapes

| Élément | Mockup | Runtime | Delta | Priorité |
|---------|--------|---------|-------|----------|
| Stepper horizontal | 3 étapes : "① Fichiers" → "② Paramètres" → "③ Import" avec état actif/complété | Absent | Manque | **P1** |
| Progression visuelle | Barre de progression entre étapes | Absent | Manque | **P2** |

---

## B3 — Dropzone

| Élément | Mockup | Runtime | Delta | Priorité |
|---------|--------|---------|-------|----------|
| Zone de dépôt (drag & drop) | Rectangle tirets, icône document, texte d'invite, bouton "Parcourir" | Absent (bouton "Ajouter fichiers" seul) | Manque | **P1** |
| Formats acceptés | Badge indiquant ".docx .txt .tei .xml" | Absent | Manque | **P2** |
| États drag-over | Bordure bleue + fond bleu pâle au survol | Non implémenté | Manque | **P2** |

---

## B4 — File queue / liste de fichiers

| Élément | Mockup | Runtime | Delta | Priorité |
|---------|--------|---------|-------|----------|
| Icône type fichier | Icône spécifique par format (.docx, .txt, .tei) | Absent | Manque | **P2** |
| Statut par fichier | Badge "En attente" / "✓ Importé" / "⚠ Erreur" | Absent | Manque | **P2** |
| Bouton supprimer | × par ligne de fichier | × présent via `import-file-remove` | ≈ OK | P3 |
| Taille fichier | Affiché (ex. "234 KB") | Absent | Manque | P3 |

---

## B5 — Paramètres d'import

| Élément | Mockup | Runtime | Delta | Priorité |
|---------|--------|---------|-------|----------|
| Langue source | Dropdown dans panneau droit | Dropdown `import-lang` présent | ≈ OK | — |
| Role du document | Dropdown (pivot/target) | Select `import-role` présent | ≈ OK | — |
| Resource type | Dropdown | Select `import-resource-type` présent | ≈ OK | — |
| Encodage | Champ auto-détecté avec info | Absent | Manque | **P2** |
| Collapsible settings | Section collapsible avec toggle | `<details>` collapsible présent | ≈ OK | — |

---

## B6 — Carte pré-vérification (pre-check)

| Élément | Mockup | Runtime | Delta | Priorité |
|---------|--------|---------|-------|----------|
| Grille KPI pré-import | Lignes : "Fichiers sélectionnés: N", "Format détecté", "Langue: XX", "Duplicats: N" | Absent | Manque entier | **P1** |
| Bouton "Vérifier" | Bouton pré-check avant import | Absent | Manque | **P1** |

---

## B7 — Pied de page sticky

| Élément | Mockup | Runtime | Delta | Priorité |
|---------|--------|---------|-------|----------|
| Footer sticky | Barre fixe en bas : "N fichier(s) sélectionné(s)" + bouton "Importer" primaire | Absent — bouton import dans carte | Manque | **P1** |
| Compteur fichiers | Indiqué dans footer | Absent | Manque | **P2** |

---

## C — États vides et erreurs

| État | Mockup | Runtime | Priorité |
|------|--------|---------|----------|
| État vide (aucun fichier) | Message "Glissez des fichiers pour commencer" dans dropzone | `<p>Aucun fichier</p>` | P3 |
| Erreur format non supporté | Toast + badge rouge par fichier | Non implémenté | P2 |
| Erreur réseau (sidecar) | Toast d'erreur | Toast présent via `showToast()` | ✅ |

---

## D — Breakpoints

| Breakpoint | Mockup | Runtime | Priorité |
|------------|--------|---------|----------|
| 1440px | Layout 2-col, colonne gauche plus large | Layout 1-col identique | P1 (hérite de B1) |
| 1728px | Colonne gauche encore plus large, dropzone agrandie | Layout 1-col identique | P1 (hérite de B1) |
| <900px (responsive) | Stack en 1-col | Non pertinent (app desktop) | — |

---

## Synthèse vue Import

| Réf | Élément | Priorité |
|-----|---------|----------|
| IMP-1 | Layout 2-col workspace (dropzone + settings) | **P1** |
| IMP-2 | Stepper d'étapes | **P1** |
| IMP-3 | Dropzone drag & drop | **P1** |
| IMP-4 | Carte pré-vérification (KPI pré-import + bouton Vérifier) | **P1** |
| IMP-5 | Footer sticky (compteur + bouton Importer) | **P1** |
| IMP-6 | Badges statut fichier (En attente / Importé / Erreur) | **P2** |
| IMP-7 | Barre progression stepper | **P2** |
| IMP-8 | Icônes type fichier | **P2** |
| IMP-9 | Champ encodage auto-détecté | **P2** |
| IMP-10 | États drag-over | **P2** |
| IMP-11 | Taille fichier dans liste | P3 |

**Total vue Import : 5 P1 · 5 P2 · 1 P3**
