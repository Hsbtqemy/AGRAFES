# Import DOCX/ODT — Unicode QA (A1)

Date: 2026-04-08  
Scope: `tauri-prep` Import + importers `docx_*` / `odt_*` (moteur inchangé côté API)

## 1) Résumé

Objectif A1: finaliser la famille « traitement de texte » sur 3 points:

- aide UI explicite sur le comportement Unicode,
- critères d’acceptation QA sur caractères spéciaux,
- tests automatiques légers de parité DOCX ↔ ODT.

## 2) Comportement Unicode actuel (référence technique)

Les importers DOCX/ODT appellent la même politique `unicode_policy.normalize()` pour produire `text_norm`.

- `normalize()` applique NFC, normalise fins de ligne, supprime certains invisibles, convertit NBSP/NNBSP/`¤` en espace.
- `count_sep()` compte `¤` pour `meta_json.sep_count`.

Importers couverts:

- `docx_numbered_lines.py` / `odt_numbered_lines.py`
- `docx_paragraphs.py` / `odt_paragraphs.py`

## 3) Aide UI (Import)

L’écran Import affiche maintenant une phrase courte dans **Profil de lot**:

- « Texte Unicode: import DOCX/ODT en UTF-8/XML puis normalisation moteur sur `text_norm` (espaces insécables, invisibles, `¤`). »

But: informer sans surcharger le flux.

## 4) Critères d’acceptation QA Unicode

Pour DOCX et ODT, à contenu équivalent:

1. `text_norm` est identique entre formats.
2. NBSP (`U+00A0`) et NNBSP (`U+202F`) deviennent un espace simple.
3. ZWSP (`U+200B`) et contrôles invisibles ciblés sont retirés.
4. `¤` devient un espace dans `text_norm` (conservé côté `text_raw`).
5. Les formes décomposées Unicode (NFD) sont recomposées en NFC.

## 5) QA manuelle rapide (échantillon conseillé)

Préparer un DOCX et un ODT avec des lignes contenant:

- `Voix\u00A0active`
- `fine\u202Fspace`
- `e\u0301nergie`
- `mot\u200bcolle`
- `alpha\u00a4beta`
- guillemets typographiques `« … »`

Vérifier après import (Documents/Actions ou requête DB):

- mêmes unités et mêmes `text_norm` entre DOCX et ODT,
- pas de perte de caractères utiles,
- `¤` absent de `text_norm`.

## 6) Couverture automatisée ajoutée

Nouveaux tests:

- `tests/test_import_word_processing_unicode.py::test_word_processing_paragraphs_unicode_parity`
- `tests/test_import_word_processing_unicode.py::test_word_processing_numbered_unicode_parity`

Commandes:

```bash
pytest -q tests/test_import_word_processing_unicode.py
```

## 7) Hors scope A1

- évolution de la politique Unicode elle-même (`unicode_policy.py`),
- extension aux formats TEI/TXT côté QA dédiée,
- changement de contrat sidecar/CLI.

---

## 8) DOCX `numbered_lines` — extraction de tableau multi-colonnes (post v0.1.43)

### Cas d'usage

Beaucoup de corpus bilingues sont livrés en DOCX où chaque ligne est une
phrase numérotée `[N]` placée dans une table 2-colonnes : col 1 = texte
original, col 2 = traduction. L'importer historique itère uniquement
`document.paragraphs` (qui par construction de `python-docx` exclut les
paragraphes contenus dans des tables), donc ces fichiers retournaient
silencieusement 0 unit ligne.

### Paramètre `column_index`

`import_docx_numbered_lines()` et `POST /import` acceptent désormais un
paramètre optionnel `column_index: int | None = None` :

| Valeur | Comportement |
|---|---|
| `None` (défaut) | Strictement identique à avant — tables ignorées, paragraphes top-level seulement. **Aucune régression** sur les imports existants. |
| `1` | Extrait la cellule de la première colonne de chaque ligne de chaque table, paragraphes aplatis et soumis à la regex `[N]` habituelle. |
| `2`, `3`, … | Idem pour la colonne demandée. |
| `0` ou négatif | `ValueError` au backend, `BAD_REQUEST 400` au sidecar. |

L'extraction se fait en ordre du document : paragraphes top-level et
contenu de tables intercalés selon leur position physique dans le DOCX.

### Côté UI

Dans Prep → Import, quand le mode `Lignes numérotées [n]` est sélectionné
sur un DOCX, un input « col » apparaît dans la ligne du fichier. Vide =
comportement legacy (tables ignorées). Entier ≥ 1 = colonne à extraire.
L'input se masque automatiquement quand on change de mode.

### Décisions de design (figées)

1. **Pas d'auto-création de famille** `translation_of` entre col 1 et col 2.
   L'utilisateur fait deux imports successifs (col 1 puis col 2) et déclare
   la famille à la main via MetadataScreen. L'invariant « familles déclarées
   explicitement » de HANDOFF_PREP § 5 est préservé.

2. **Paragraphes multiples dans une cellule** : aplatis en séquence. Chaque
   paragraphe reste un candidat unit indépendant, soumis à la regex `[N]`.

3. **Tables imbriquées** : sub-table dans une cellule cible → warning +
   skip. Pas de récursion en V1.

4. **Cellule sans `[N]`** : devient une `unit_type='structure'` non
   indexée, comme un paragraphe top-level qui ne match pas la regex.

### Diagnostics ajoutés à `ImportReport`

Trois nouveaux compteurs et 5 warnings actionnables couvrent les cas où
l'utilisateur s'est trompé de colonne, ou la table est mal structurée :

| Compteur | Signification |
|---|---|
| `tables_processed` | Total des tables top-level walkées. |
| `rows_skipped_short` | Lignes ignorées : la colonne demandée n'existe pas (table plus étroite OU cellule fusionnée venant d'une colonne précédente). |
| `nested_tables_skipped` | Sous-tables imbriquées ignorées. |

Warnings (concaténés dans `ImportReport.warnings`) :

- « N ligne(s) sur M table(s) ignorée(s) : colonne K absente »
- « N sous-table(s) imbriquée(s) ignorée(s) — leur contenu n'a pas été importé. »
- « 0 unité ligne extraite de M table(s) à la colonne K. Vérifier : la colonne contient-elle bien des paragraphes numérotés `[N]` ? »
- « X% des paragraphes de la colonne K ne portent pas de numérotation `[N]`. Êtes-vous sûr d'avoir choisi la bonne colonne ? » (seuil 50%, taille d'échantillon ≥ 5)
- Et les warnings classiques (duplicates, holes, non-monotonic) sur les `external_id` extraits.

### Comment choisir `column_index`

1. Si le DOCX est en flux unique (paragraphes top-level numérotés) → laisser vide.
2. Si le DOCX a une table 2-col bilingue → ouvrir le fichier dans Word/LibreOffice
   pour confirmer quelle colonne contient la langue souhaitée, puis :
   - **Original** → `column_index=1` (en général à gauche).
   - **Traduction** → `column_index=2`.
3. Si le rapport renvoie 0 unit ligne, ou si > 50% des paragraphes sont
   `structure` au lieu de `line`, le warning te le signale : revérifier
   la colonne ou inspecter le DOCX.
4. Pour constituer une famille `translation_of` : faire deux imports
   (col 1 puis col 2), puis déclarer la relation depuis MetadataScreen.

### Tests

`tests/test_docx_numbered_lines_tables.py` (10 cas) couvre :
- extraction col 1 et col 2 d'une table 2-col,
- `column_index=2` sur table 1-col (rows_skipped_short),
- cellule fusionnée horizontalement (dedup par identité d'objet `Cell`),
- cellule fusionnée verticalement (dedup par `id(cell._tc)` + détection
  XML du marqueur `<w:vMerge>` en défense secondaire),
- table imbriquée ignorée avec warning,
- colonne majoritairement sans `[N]` (warning),
- `column_index=None` régression (comportement legacy intact),
- paragraphes top-level + tables intercalés en ordre document,
- `column_index < 1` → `ValueError`.

### Périmètre V1 — limites connues à flagger

Le paramètre `column_index` n'est implémenté que pour **`mode=docx_numbered_lines`**.
Les autres importers de la même famille ont chacun un comportement différent
face à un fichier où le texte est dans une table multi-colonnes :

| Importer | Comportement actuel sur table 2-col bilingue | Friction |
|---|---|---|
| `docx_numbered_lines` | ✅ Géré via `column_index` (cette session) | — |
| `docx_paragraphs` | ⚠ Même bug que `docx_numbered_lines` avant ce fix : `document.paragraphs` ignore les tables → 0 paragraphes importés silencieusement. | Tier S potentiel si quelqu'un l'utilise pour du bilingue (rare en pratique car cet importer cible des paragraphes non numérotés). |
| `odt_numbered_lines` | ⚠ Comportement différent : `tree.iter()` walke TOUT, donc les paragraphes des cellules sont importés — mais **interleavés** (row 1 col 1, row 1 col 2, row 2 col 1…). Sur un ODT bilingue 2-col, l'utilisateur obtient un doc mixte avec les deux langues mélangées. | Friction silencieuse : pas d'erreur, mais texte incohérent. |
| `odt_paragraphs` | Idem ODT numbered_lines — walke tout, interleave. | Idem. |
| `tei` | Pas concerné (TEI a sa propre structure XML). | — |
| `txt`, `conllu` | Pas de notion de table. | — |

**Décision V1** : on documente, on n'étend pas. Raisons :
- `docx_paragraphs` est rarement utilisé sur du bilingue (les corpus
  bilingues sont numérotés).
- ODT bilingues 2-col sont moins fréquents que DOCX dans le pipeline actuel.
- Étendre demanderait : helper de walk équivalent à `_iter_body_blocks` pour
  ODT (à base de namespaces `text:p` / `table:table`), validation par
  importer, tests dédiés.

À reprendre dans une future session si un utilisateur signale la friction
sur ODT ou `docx_paragraphs`. L'infra est extensible — `column_index`
peut s'ajouter aux autres importers avec le même contrat (1-based, null =
legacy).
