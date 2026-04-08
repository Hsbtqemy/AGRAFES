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
