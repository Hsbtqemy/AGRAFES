# TICKET — Export texte de l'alignement : découvrabilité dans le flux Export V2

**Statut** : ouvert (scoping). **Type** : UX / front-end. **Backend** : déjà livré (0 travail moteur).
**Origine** : trouvé en smoke (vague U-02, 2026-06-28). Question utilisateur : « pour l'alignement, on n'a pas d'export en format texte ? que du CSV/TSV ou du TEI ? »

## TL;DR

L'export **texte bilingue** d'un alignement **existe déjà** (TXT, HTML, TMX) et est **câblé** dans deux UIs. Le problème n'est **pas** une absence de fonctionnalité, mais sa **découvrabilité** : il n'apparaît pas dans la liste déroulante Export V2 (« stage → produit → format ») où l'utilisateur le cherche pour le stage *alignement*. Ce ticket = surfacer/consolider l'existant, sans toucher au backend.

## État actuel (vérifié)

### Backend — complet
- `POST /export/bilingual` ([sidecar.py:6754](../src/multicorpus_engine/sidecar.py#L6754)) : export **bilingue entrelacé** (`format: "html" | "txt"`, défaut html), `pivot_doc_id` + `target_doc_id`, `out_path` ou `preview_only` (renvoie les N premières paires). Dans le contrat ([openapi.json:5094](openapi.json#L5094)).
- `POST /export/tmx` ([sidecar.py:6648](../src/multicorpus_engine/sidecar.py#L6648)) : export **TMX** (translation memory). Dans le contrat ([openapi.json:5241](openapi.json#L5241)).
- Front client : `exportBilingual` ([sidecarClient.ts:1664](../tauri-prep/src/lib/sidecarClient.ts#L1664)) + `exportTmx` ([:1657](../tauri-prep/src/lib/sidecarClient.ts#L1657)).

### Front — déjà atteignable à 2 endroits
1. **ExportsScreen — section « Bilingue »** : sélecteurs pivot (`_bilPivotSelEl`) + cible (`_bilTargetSelEl`) + format `_bilFmtEl` (**txt / html / tmx**), boutons preview/export ([ExportsScreen.ts:1154](../tauri-prep/src/screens/ExportsScreen.ts#L1154), `_runBilPreview` [:1162](../tauri-prep/src/screens/ExportsScreen.ts#L1162), appels `/export/bilingual` [:1171](../tauri-prep/src/screens/ExportsScreen.ts#L1171)/[:1235](../tauri-prep/src/screens/ExportsScreen.ts#L1235)). Auto-sélection pivot=parent / cible=1er enfant quand une famille est choisie ([:1143](../tauri-prep/src/screens/ExportsScreen.ts#L1143)).
2. **MetadataScreen — panneau famille** : bouton « export pair » (`.prep-fam-export-pair-btn`, [MetadataScreen.ts:851](../tauri-prep/src/screens/MetadataScreen.ts#L851)) → `openExportPairDialog` ([ExportPairDialog.ts](../tauri-prep/src/components/ExportPairDialog.ts)) → mêmes endpoints TXT/HTML/TMX.

### Le trou
La matrice V2 `exportV2Options.ts` ([ici](../tauri-prep/src/lib/exportV2Options.ts)) pour le stage **alignement** ne propose que :

| Produit | Formats |
|---|---|
| Tableau segments alignés | CSV, TSV |
| TEI XML | Dossier TEI |

→ Le **texte parallèle** (TXT/HTML/TMX) n'est **pas** dans ce dropdown. L'utilisateur qui parcourt « stage=alignement → produit → format » conclut (à tort) qu'il n'y a pas d'export texte, alors que la section « Bilingue » juste à côté le fait.

## Pourquoi le texte parallèle n'est pas (encore) un « produit V2 »

Friction de modèle de sélection : le flux V2 opère sur une **sélection multi-documents** (le tableau de docs cochés → CSV/TEI sur l'ensemble). L'export bilingue, lui, exige une **paire pivot + cible** précise. Les deux modèles ne se mappent pas directement — d'où la section « Bilingue » séparée avec ses propres sélecteurs pivot/cible.

## Options

### A — Découvrabilité minimale (S, recommandée en premier)
Dans le panneau V2, quand `stage = alignment`, ajouter un **renvoi visible** vers la section « Bilingue » (texte/aligné lisible), ou regrouper visuellement les deux sous un même titre « Alignement ». Zéro nouveau chemin de données ; juste un libellé/ancre. **Lève l'incompréhension immédiate.**

### B — Produit V2 « Texte parallèle bilingue » (M)
Ajouter à `PRODUCT_BY_STAGE.alignment` un produit `bilingual_text` → formats `txt` / `html` (+ option `tmx`). Quand il est sélectionné, le panneau V2 **bascule** d'une sélection multi-docs vers des **sélecteurs pivot/cible** (réutiliser la mécanique existante `_bilPivotSelEl`/`_bilTargetSelEl` ou `ExportPairDialog`), puis appelle `/export/bilingual` (déjà là). Consolide tout l'export alignement dans un seul flux. Plus de travail UI (gestion de l'état de sélection conditionnel au produit).

### C — Statu quo + doc
Documenter la section « Bilingue » (infobulle/aide) sans la déplacer. Le moins de code, mais ne résout pas la découvrabilité dans le dropdown.

**Recommandation** : **A maintenant** (petit, supprime la confusion signalée), **B** ensuite si on veut un flux d'export alignement unifié.

## Non-objectifs
- Aucun changement backend (les endpoints + le contrat sont figés et suffisants).
- Pas de nouveau format de rendu (entrelacé existe ; un mode « 2 colonnes côte à côte » serait un ticket distinct côté exporteur si désiré).

## Critères d'acceptation (option A)
- [ ] Depuis le stage *alignement* de l'écran Exports, l'utilisateur voit clairement qu'un export **texte parallèle (TXT/HTML/TMX)** est disponible et y accède en ≤1 clic.
- [ ] Aucun changement de comportement de l'export CSV/TSV/TEI existant ni de la section « Bilingue ».
- [ ] (option B) Choisir le produit « Texte parallèle » bascule la sélection en pivot/cible et produit le même fichier que la section « Bilingue » actuelle.

## Plan de test
- Front (Vitest) : si option B, test pur sur la matrice étendue `productsForStage("alignment")`/`formatsForProduct("bilingual_text")` (comme `exportV2Options` actuel). Le rendu/è­tat conditionnel = test de caractérisation happy-dom.
- Pas de test backend (inchangé) ; les endpoints ont déjà leur couverture (`test_export_*`).

## Effort
- Option A : ~S (libellé/ancre + éventuel petit regroupement DOM).
- Option B : ~M (état de sélection conditionnel au produit + branchement endpoint + tests).
