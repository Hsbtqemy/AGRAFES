# Audit Fonctionnel — INDEX

> Note méthodologique: `e2e-validated` = validation UI stricte bout-en-bout. Dans ce lot, **non validable dans cet état** (pas de harness UI Tauri), donc `0` partout.

| Vue | Contrôles audités | Validés E2E | Partiels | Morts | Synthèse |
|---|---:|---:|---:|---:|---|
| Importer | 15 | 0 | 2 | 1 | Flux principal câblé; dropzone visuelle non fonctionnelle et import lot non validable UI sans dialog/fichiers. |
| Documents | 22 | 0 | 2 | 1 | Édition/relations/validation bien branchées; bouton batch "Définir rôle" mort; aperçu dépend d’une route absente sur sidecar embarqué. |
| Actions Hub | 7 | 0 | 0 | 0 | Navigation des sous-vues correctement branchée (state + persistance locale). |
| Actions > Curation | 28 | 0 | 1 | 5 | Preview/apply/index/validate branchés; plusieurs éléments maquette restent cosmétiques ou non implémentés. |
| Actions > Segmentation | 29 | 0 | 2 | 3 | Segment/validation robustes; réglages avancés non câblés; preview VO dépend de `/documents/preview`. |
| Actions > Alignement | 34 | 0 | 5 | 0 | Cœur align/audit/quality/report bien branché; sémantique lock/unlock partielle, run-view et workflow à fiabiliser. |
| Exporter | 27 | 0 | 2 | 1 | Routeur d’exports V2/legacy majoritairement opérationnel; quelques options affichées non exploitées. |

## Totaux

- Contrôles audités: **162**
- Validés E2E strict: **0**
- Partiels: **14**
- Morts: **11**
