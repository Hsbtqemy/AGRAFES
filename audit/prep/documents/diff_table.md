# Diff Table — Vue Documents (Métadonnées)

| # | Élément | Mockup | Runtime | Delta | Priorité |
|---|---------|--------|---------|-------|----------|
| 1 | Type liste | `<table>` avec colonnes | `<div class="doc-item">` par doc | Structural | **P1** |
| 2 | Checkboxes sélection | Par ligne + "tout sélectionner" | Absent | Missing | **P1** |
| 3 | Barre KPI en tête | N docs · N langues · N pivots · N cibles | Absent | Missing | **P1** |
| 4 | Filtre statut | Dropdown Tous / Pivot / Cible | Absent | Missing | **P1** |
| 5 | Barre actions batch | "N sélectionnés" + Modifier/Supprimer | Absent | Missing | **P1** |
| 6 | Onglets preview | Aperçu + Métadonnées JSON | Absent | Missing | **P2** |
| 7 | Colonnes Nb unités + Type | Affichées dans table | Absentes du div-list | Missing | **P2** |
| 8 | Filtre par langue | Dropdown | Absent | Missing | **P2** |
| 9 | Tri par colonne | En-têtes cliquables | Absent | Missing | **P2** |
| 10 | Ratio colonnes | ~60/40 (liste plus large) | 50/50 | −10% | P3 |
| 11 | Compteur unités | Dans panneau édition | Absent | Missing | P3 |
| 12 | Highlight ligne active | bg #eff6ff + border-left bleue | `.active` class basique | Partial | P3 |
| 13 | Champs édition (titre, langue, rôle…) | Tous présents | Tous présents | ✅ | — |
| 14 | Boutons Enregistrer / Annuler | Présents | Présents | ✅ | — |
| 15 | Toast erreur save | Toast rouge | `showToast()` présent | ✅ | — |
| 16 | État vide "aucun doc sélectionné" | Placeholder dans panneau droit | Formulaire vide | Partial | P3 |
