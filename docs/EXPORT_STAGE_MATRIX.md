# Export — Matrice Étape × Produit × Format

Source de vérité implémentée dans `tauri-prep/src/screens/ExportsScreen.ts` (`_syncV2Ui`).

## Matrice V2

| Étape | Produits | Formats |
|---|---|---|
| `alignment` | `aligned_table`, `tei_xml` | `csv`, `tsv`, `tei_dir` |
| `publication` | `tei_package` | `zip` |
| `segmentation` | `tei_xml`, `readable_text` | `tei_dir`, `txt`, `docx` |
| `curation` | `tei_xml`, `readable_text` | `tei_dir`, `txt`, `docx` |
| `runs` | `run_report` | `jsonl`, `html` |
| `qa` | `qa_report` | `json`, `html` |

## Parcours pilotes « étape → exporter »

### 1) Segmentation → Exporter prérempli

- Point d’entrée: `Actions > Segmentation > "Exporter cette étape…"`
- Préremplissage appliqué:
  - `stage=segmentation`
  - `product=readable_text`
  - `format=txt`
  - `docIds=[doc courant segmenté]`

### 2) Alignement → Exporter prérempli

- Point d’entrée: `Actions > Alignement > "Exporter cette étape…"`
- Préremplissage appliqué:
  - `stage=alignment`
  - `product=aligned_table`
  - `format=csv`
  - `pivotDocId` depuis le sélecteur pivot
  - `targetDocId` + `docIds` depuis les cibles sélectionnées
  - `runId` repris si un run d’alignement est actif

## Écarts encore ouverts

- Export ODT sortant: non implémenté (TXT/DOCX disponibles pour `readable_text`).
- Parité stricte réimport motif `[n]`: non couverte par ce maillage (reste une décision produit/format).
