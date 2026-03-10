# Audit UI — Tauri Prep V1.5 — INDEX

**Date :** 2026-03-01
**Périmètre :** `tauri-prep/**` (aucune modification applicative)
**Référence mockups :** `prototypes/visual-validation/prep/`
**Version runtime auditée :** Tauri Prep V1.5 (build `npm --prefix tauri-prep run build`)

---

## Méthodologie

Pour chaque vue, comparaison systématique :
- Source runtime : `tauri-prep/src/screens/*.ts` + `tauri-prep/src/ui/*.css`
- Source mockup : fichiers HTML `prototypes/visual-validation/prep/prep-<vue>-vnext.html`
- Catégories : **A** Invariants globaux · **B** Vues fonctionnelles · **C** États vides/erreur · **D** Breakpoints (1440 / 1728)
- Priorités : **P1** Écart structurel · **P2** Écart visuel majeur · **P3** Écart mineur (≤4px)

---

## Tableau récapitulatif des écarts

| Vue | P1 | P2 | P3 | Statut |
|-----|----|----|----|----|
| Global (invariants) | 2 | 2 | 3 | ⚠ Pending |
| Import | 4 | 3 | 1 | ⚠ Pending |
| Documents | 4 | 2 | 2 | ⚠ Pending |
| Actions Hub | 3 | 1 | 1 | ⚠ Pending |
| Curation | 0 | 0 | 0 | ✅ Régression OK (P22–P25) |
| Segmentation | — | — | — | 🔲 Non analysé (stub) |
| Alignement | — | — | — | 🔲 Non analysé (stub) |
| Exporter | 3 | 2 | 1 | ⚠ Pending |
| **TOTAL** | **16** | **10** | **8** | |

---

## Fichiers de l'audit

| Fichier | Description |
|---------|-------------|
| [global/GLOBAL_PARITY_REPORT.md](global/GLOBAL_PARITY_REPORT.md) | Invariants globaux (topbar, typographie, cartes, tokens) |
| [import/PARITY_REPORT.md](import/PARITY_REPORT.md) | Vue Import |
| [import/diff_table.md](import/diff_table.md) | Table diff Import |
| [documents/PARITY_REPORT.md](documents/PARITY_REPORT.md) | Vue Documents |
| [documents/diff_table.md](documents/diff_table.md) | Table diff Documents |
| [actions-hub/PARITY_REPORT.md](actions-hub/PARITY_REPORT.md) | Vue Actions Hub |
| [actions-hub/diff_table.md](actions-hub/diff_table.md) | Table diff Actions Hub |
| [curation/REGRESSION_REPORT.md](curation/REGRESSION_REPORT.md) | Rapport de régression Curation (P22–P25) |
| [exporter/PARITY_REPORT.md](exporter/PARITY_REPORT.md) | Vue Exporter |
| [exporter/diff_table.md](exporter/diff_table.md) | Table diff Exporter |
| [segmentation/PARITY_REPORT.md](segmentation/PARITY_REPORT.md) | Vue Segmentation (stub — mockup non analysé) |
| [alignement/PARITY_REPORT.md](alignement/PARITY_REPORT.md) | Vue Alignement (stub — mockup non analysé) |

---

## Plan de correction (suggestion)

### Sprint A — Invariants globaux (faible risque, fort impact)
1. **GA-1** : `topbar height` 52px → 54px (token `--prep-topbar-h` déjà défini, appliquer en CSS)
2. **GA-2** : `screen-title font-size` 1.15rem → 1.25rem (~20px)
3. **GA-3** : `card border-radius` 10px → 12px
4. **GA-4** : Unifier les deux systèmes de tokens (`--color-*` + `--prep-*` → un seul)

### Sprint B — Vues haute priorité P1 (refactor structurel)
5. **IMP-1** : Import — layout 1-col → 2-col workspace (dropzone + panel)
6. **IMP-2** : Import — indicateurs d'étapes + pied de page sticky
7. **DOC-1** : Documents — liste div → table avec checkboxes batch
8. **DOC-2** : Documents — barre KPI en tête + filtre statut
9. **ACT-1** : Actions Hub — cards nav → workspace 2-col (1.4fr + 1fr)
10. **EXP-1** : Exporter — form plate → table docs + panneau export 2-col
11. **EXP-2** : Exporter — grille KPI pré-vérification
12. **EXP-3** : Exporter — historique d'exports (section collapsible)

### Sprint C — Vues P2 et états vides
13. **DOC-3** : Documents — onglets preview (aperçu / métadonnées)
14. **IMP-3** : Import — carte pré-vérification
15. **ACT-2** : Actions Hub — cartes d'état système (vide / warning / erreur)
16. **EXP-4** : Exporter — confirmation modale export

### Sprint D — Segmentation / Alignement (analyse à compléter)
17. Lire mockups `prep-segmentation-vo-vnext.html` + `prep-alignement-vnext.html` en détail
18. Produire `segmentation/PARITY_REPORT.md` + `alignement/PARITY_REPORT.md` complets

---

## Invariants de build

```
npm --prefix tauri-prep run build   # doit être ✅ vert
git diff --name-only                # doit lister uniquement audit/prep/**
```

*Dernière vérification : cf. fin de session (section « Build invariant »)*
