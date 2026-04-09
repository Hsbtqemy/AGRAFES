# Normalisation des espaces — audit import → `text_norm` → FTS → UI

Date: 2026-04-09  
Portée: A3 (fondations entrée/sortie) — audit + décision produit.

## Résumé exécutable

- Le moteur normalise déjà les espaces Unicode problématiques (`NBSP`, `NNBSP`, `figure/thin space`, `¤`) vers un espace ASCII dans `text_norm`.
- Il ne fait pas de collapse global des espaces consécutifs dans `text_norm` (comportement volontaire).
- Les importers principaux font un `strip()` des lignes/paragraphes avant insertion, donc les espaces de bord sont en pratique supprimés à l’import.
- La recherche FTS indexe `text_norm`; la curation agit sur `text_norm`; les exports “texte lisible” peuvent sortir `text_norm` ou `text_raw`.
- Décision A3: **conserver le contrat actuel** (pas de collapse global moteur), documenter clairement, et orienter le nettoyage volontaire via presets curation “espaces”.

## Chaîne technique auditée

## 1) Import

- `DOCX/TXT/ODT/TEI` produisent `text_raw` puis `text_norm = normalize(text_raw)`.
- Les importers exécutent majoritairement un `strip()` amont sur les unités lues (lignes/paragraphes), ce qui retire les espaces de début/fin avant même la normalisation Unicode.

Références:
- `src/multicorpus_engine/importers/docx_paragraphs.py`
- `src/multicorpus_engine/importers/docx_numbered_lines.py`
- `src/multicorpus_engine/importers/txt.py`
- `src/multicorpus_engine/importers/odt_common.py`
- `src/multicorpus_engine/importers/odt_numbered_lines.py`
- `src/multicorpus_engine/importers/tei_importer.py`

## 2) Normalisation (`unicode_policy`)

`normalize()` applique:
- NFC
- unification des fins de ligne (`CRLF/CR` → `LF`)
- suppression d’invisibles (`ZWSP`, `ZWNJ`, `ZWJ`, `WORD JOINER`, `BOM`, `SOFT HYPHEN`)
- conversion vers espace ASCII: `U+00A0`, `U+202F`, `U+2007`, `U+2009`, `U+00A4`
- suppression des contrôles ASCII (hors tabulation/saut de ligne)

Point clé:
- **pas de collapse des séquences d’espaces** (ex: double espace conservé).

Référence:
- `src/multicorpus_engine/unicode_policy.py`

## 3) Stockage / curation

- `text_norm` est le champ de travail pour curation (`/curate`, `/curate/preview`).
- Les règles curation peuvent faire un collapse et trim explicites (preset `spaces` dans Prep).
- Une curation qui modifie `text_norm` marque `fts_stale=true` (réindexation requise).

Références:
- `src/multicorpus_engine/curation.py`
- `src/multicorpus_engine/sidecar.py` (`_handle_curate`, `_handle_curate_preview`)
- `tauri-prep/src/screens/ActionsScreen.ts` (`CURATE_PRESETS.spaces`)

## 4) FTS / Query

- L’index FTS (`fts_units`) est construit depuis `units.text_norm` uniquement.
- Les hits de query renvoient `text_norm` (et `text_raw` disponible selon mode/usage).
- Le mode case-sensitive applique un post-filtre sur `text_raw` (sans changer l’index).

Références:
- `src/multicorpus_engine/indexer.py`
- `src/multicorpus_engine/query.py`

## 5) UI / Export

- Import UI explicite déjà la normalisation Unicode (DOCX/ODT).
- Exports “texte lisible” exposent `source_field = text_norm | text_raw`, ce qui rend explicite le choix fonctionnel.

Références:
- `tauri-prep/src/screens/ImportScreen.ts`
- `tauri-prep/src/screens/ExportsScreen.ts`
- `src/multicorpus_engine/sidecar.py` (`export_readable_text`)

## Cas A3 (attendus vs observés)

| Cas | Observé | Statut |
|---|---|---|
| `U+00A0` NBSP | converti en espace ASCII dans `text_norm` | OK |
| `U+202F` NNBSP | converti en espace ASCII dans `text_norm` | OK |
| `U+00A4` `¤` | converti en espace ASCII dans `text_norm` | OK |
| Invisibles (`ZWSP`, `BOM`, `SHY`) | supprimés de `text_norm` | OK |
| Espaces de bord | majoritairement supprimés par `strip()` importers | OK (comportement de fait) |
| Espaces multiples internes | conservés dans `text_norm` (pas de collapse global) | Conforme contrat actuel |

## Couverture de tests existante

- `tests/test_unicode_policy.py` couvre NFC, NBSP, suppression invisibles, contrôles, fins de ligne.
- `tests/test_import_word_processing_unicode.py` valide la parité DOCX/ODT (paragraphes + lignes numérotées).

## Décision produit A3

Décision: **ne pas modifier le contrat moteur `text_norm`** pour y ajouter un collapse global des espaces.

Rationale:
- évite un changement transversal de contrat (import, query, export, snapshots, éventuels scripts aval),
- évite une migration implicite du sens de `text_norm`,
- préserve les usages où la multiplicité d’espaces est significative (édition/critique, traces OCR),
- laisse le nettoyage “fort” à une action explicite utilisateur via curation (preset spaces).

## Conséquences

- La normalisation Unicode reste stable (ADR-003 inchangé).
- Les besoins de “nettoyage visuel” passent par:
  - curation preset `spaces`,
  - ou choix de `source_field=text_raw` / `text_norm` à l’export selon besoin.
- Toute évolution future “collapse global” devra être traitée comme changement de contrat (décision ADR + plan de migration/réindexation).

## Recommandations non bloquantes

1. Ajouter dans la doc utilisateur Prep une phrase explicite:
   - “Le moteur normalise les espaces Unicode, mais ne fusionne pas automatiquement tous les doubles espaces.”
2. Conserver le preset curation “Espaces incohérents” comme chemin recommandé pour un corpus “propre publication”.
3. Si besoin futur: introduire une option explicite (opt-in) de collapse dans un job dédié, pas dans `unicode_policy.normalize`.
