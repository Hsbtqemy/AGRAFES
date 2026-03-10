# Diff Table — Vue Import

| # | Élément | Mockup | Runtime | Delta | Priorité |
|---|---------|--------|---------|-------|----------|
| 1 | Layout principal | 2-col workspace (1.4fr + 1fr) | 1-col stacked cards | Structural | **P1** |
| 2 | Stepper d'étapes | 3 steps (Fichiers → Paramètres → Import) | Absent | Missing | **P1** |
| 3 | Dropzone | Rectangle tirets + icône + bouton Parcourir | Absent | Missing | **P1** |
| 4 | Carte pré-vérification | Grille KPI + bouton Vérifier | Absent | Missing | **P1** |
| 5 | Footer sticky | Compteur + bouton Importer | Absent | Missing | **P1** |
| 6 | Badge statut fichier | "En attente" / "✓ Importé" / "⚠ Erreur" | Absent | Missing | **P2** |
| 7 | Progression stepper | Barre de progression | Absent | Missing | **P2** |
| 8 | Icône type fichier | Icône .docx / .txt / .tei | Absent | Missing | **P2** |
| 9 | Champ encodage | Auto-détecté + info | Absent | Missing | **P2** |
| 10 | États drag-over | Bordure + fond bleu | Non implémenté | Missing | **P2** |
| 11 | Taille fichier | Affichée (ex. "234 KB") | Absent | Missing | P3 |
| 12 | Message état vide | "Glissez des fichiers pour commencer" | `<p>Aucun fichier</p>` | Wording | P3 |
| 13 | Langue source | Dropdown | Select `import-lang` | ≈ OK | — |
| 14 | Role document | Dropdown pivot/target | Select `import-role` | ≈ OK | — |
| 15 | Resource type | Dropdown | Select `import-resource-type` | ≈ OK | — |
| 16 | Bouton supprimer fichier | × par ligne | × via `import-file-remove` | ≈ OK | — |
| 17 | Toast erreur sidecar | Toast d'erreur | `showToast()` présent | ✅ | — |
