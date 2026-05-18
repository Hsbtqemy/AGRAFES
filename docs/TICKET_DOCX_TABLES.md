# Mission : Support DOCX bilingue 2-colonnes dans `docx_numbered_lines`

> ✅ **LIVRÉ (post-v0.1.43)** — le paramètre `column_index` est implémenté dans
> `src/multicorpus_engine/importers/docx_numbered_lines.py` : walker en ordre
> document `_iter_body_blocks`, extraction par colonne, dedup des fusions H/V,
> sous-tables ignorées, warning « >50 % non numérotées », compteurs dédiés dans
> `ImportReport`. Tier S #1 de HANDOFF_PREP clos. Ticket conservé pour archive.

Tu interviens sur le repo AGRAFES (branche `development`, post v0.1.43).

Lis [HANDOFF_SHELL.md](../HANDOFF_SHELL.md) et [HANDOFF_PREP.md](../HANDOFF_PREP.md)
avant tout. La friction adressée est documentée Tier S #1 de HANDOFF_PREP § 6
(« DOCX bilingue en tableau 2-colonnes non lu par l'importer »).

# Contexte

L'importer `docx_numbered_lines` itère `document.paragraphs`, ce qui **exclut
par construction** les paragraphes contenus dans des tables (`python-docx`
ne les remonte pas dans `Document.paragraphs`). Conséquence : un DOCX où
le texte numéroté `[N]` vit dans une table 2-colonnes (très commun en corpus
bilingue) retourne 0 unit ligne sans erreur claire.

Le workaround utilisateur actuel : préparer le DOCX en flux unique
manuellement avant import. Coûteux à grande échelle.

Cette mission étend l'importer pour lire le contenu d'une **colonne donnée**
des tables, avec gestion explicite des cas pathologiques pour ne plus
perdre de données silencieusement.

# Périmètre

**Un seul fichier importer modifié** : [src/multicorpus_engine/importers/docx_numbered_lines.py](../src/multicorpus_engine/importers/docx_numbered_lines.py).

Le sidecar et le frontend sont touchés à minima pour exposer le nouveau
paramètre. Pas de refacto opportuniste, pas de migration DB, pas de
nouveau modèle de données.

# Décisions de design (figées — ne pas re-débattre dans le code)

1. **Stratégie d'extraction par colonne** : nouveau paramètre
   `column_index: int | None = None`. Quand `None` (défaut), comportement
   strictement identique à aujourd'hui — itération sur `document.paragraphs`
   uniquement, tables ignorées. Quand entier `>= 1`, on lit l'intégralité du
   document dans l'ordre (paragraphes top-level + tables), et pour chaque
   table on n'extrait que les cellules situées à l'index `column_index` (1-based).

2. **Cellule multi-paragraphes** : les paragraphes d'une cellule sont
   **aplatis** dans la séquence globale (comme s'ils étaient top-level). Chaque
   paragraphe reste un candidat unit indépendant, soumis à la regex `[N]`
   habituelle. Pas de concaténation.

3. **Tables imbriquées** : warning + skip. On ne récurse pas dans les sous-tables.
   Le warning dans `ImportReport.warnings` mentionne la position
   (ligne, colonne) où l'imbrication a été détectée.

4. **Paragraphes sans `[N]`** : strictement le même traitement qu'aujourd'hui —
   `unit_type="structure"`, `external_id=NULL`, non indexés. Cohérence avec
   les paragraphes top-level.

5. **Pas d'auto-création de famille** : si l'utilisateur veut importer
   les deux colonnes pour constituer une famille `translation_of`, il fait
   deux imports successifs (col 1 puis col 2) et déclare la famille à la main.
   L'invariant « familles déclarées explicitement » (cf. HANDOFF_PREP § 5)
   est préservé.

## Cas pathologiques à gérer

| Cas | Comportement attendu |
|---|---|
| Table avec moins de colonnes que `column_index` (ex. table 1-col et `column_index=2`) | Skip la ligne, incrémenter un compteur `rows_skipped_short`. Warning agrégé en fin d'import : « N lignes de M tables ignorées car la colonne demandée n'existe pas ». |
| Cellules fusionnées (merged cells) | `python-docx` retourne le même objet `Cell` pour les positions couvertes par le merge horizontal. Dedup par `id(cell)` dans chaque ligne avant aplatissement. Sinon : doublons silencieux. |
| Cellule vide à la colonne demandée | Skip silencieusement (cohérent avec `if not plain: continue` existant pour les paragraphes top-level vides). |
| Colonne demandée sans `[N]` dominante | Si **>50%** des paragraphes non-vides de la colonne demandée ne matchent pas la regex `[N]`, ajouter un warning : « X% des paragraphes de la colonne demandée n'ont pas de numérotation `[N]` — vérifier `column_index`. ». Seuil 50% est figé en constante en tête de module. |
| 0 unit ligne extraite après scan | Si `column_index` est défini et qu'aucune unité ligne n'est créée, warning : « 0 unit ligne extraite de N tables (column_index=K). La colonne est-elle correcte ? Le DOCX contient-il des numérotations `[N]` ? ». Remplace le « 0 line units » cryptique actuel. |

# Livrables

## L1 — Importer

**Modifier `import_docx_numbered_lines`** ([docx_numbered_lines.py](../src/multicorpus_engine/importers/docx_numbered_lines.py)) :

- Nouveau paramètre `column_index: int | None = None`.
- Validation : si fourni, doit être `>= 1`. Sinon `ValueError`.
- Si `None` : conserver strictement la boucle actuelle `for para in document.paragraphs`. Aucun changement.
- Si entier : utiliser un générateur qui itère `document.element.body` en ordre du document via `iter_block_items` (helper à créer dans le même fichier, ~15 lignes — pattern documenté dans python-docx FAQ). Pour chaque bloc :
  - Si paragraphe top-level : traiter comme aujourd'hui.
  - Si table top-level : pour chaque ligne, dedup les cellules par `id(cell)`, sélectionner celle à l'index `column_index - 1` (1-based externe → 0-based interne), aplatir ses paragraphes en candidats unit. Si la ligne n'a pas la cellule demandée, incrémenter `rows_skipped_short`.
  - Si table imbriquée détectée dans une cellule (parcourir `cell.tables` ou équivalent) : warning + skip.

**Étendre `ImportReport`** :
- `rows_skipped_short: int = 0` — lignes ignorées car colonne inexistante.
- `tables_processed: int = 0` — total des tables traitées.
- `nested_tables_skipped: int = 0` — sous-tables ignorées.
- Pas de changement de signature de `to_dict()` au-delà de ces nouveaux champs.

**Constantes en tête de module** :
```python
# Si >50% des paragraphes d'une colonne demandée ne matchent pas [N], émettre un warning
COLUMN_UNNUMBERED_RATIO_THRESHOLD = 0.5
```

## L2 — Endpoint sidecar

**Étendre `_handle_import`** ([sidecar.py](../src/multicorpus_engine/sidecar.py)) pour accepter `column_index` dans le payload :
- Validation : entier `>= 1` ou null. Si invalide, `BAD_REQUEST 400`.
- Forwarder à `import_docx_numbered_lines` uniquement quand la stratégie d'import est `numbered_lines` ET le format est `docx`.
- Pour les autres importers (TEI, TXT, CoNLL-U, ODT, paragraphs), ignorer silencieusement (le paramètre n'a pas de sens hors DOCX-tables).

**Réponse `/import` enrichie** : ajouter les nouveaux champs de `ImportReport`.

## L3 — Frontend

**ImportScreen** ([tauri-prep/src/screens/ImportScreen.ts](../tauri-prep/src/screens/ImportScreen.ts)) :
- Quand l'utilisateur sélectionne un DOCX et la stratégie `numbered_lines`, afficher un **champ optionnel** « Colonne de tableau » (input number, min=1) avec un label explicatif court :
  > « Si le DOCX contient les textes dans une table multi-colonnes, indiquer la colonne à extraire (1 = première colonne). Laisser vide pour ignorer les tables. »
- Forwarder la valeur au payload `/import` quand non vide.
- Afficher dans le rapport d'import les nouveaux champs (`rows_skipped_short`, `tables_processed`, `nested_tables_skipped`) quand au moins une table a été traitée.

## L4 — Tests

**Pytest** (`tests/test_docx_numbered_lines_tables.py`, nouveau fichier) :
- Fixture utilitaire `_make_docx_with_table(rows: list[list[str]])` qui crée un DOCX synthétique avec une table à partir d'une liste de listes de paragraphes. Réutiliser `python-docx` directement pour la fabrication.
- Cas couverts :
  1. DOCX avec table 2-col `[[("[1] orig"), ("[1] trad")], [("[2] orig"), ("[2] trad")]]` → import avec `column_index=1` retourne 2 line units (`[1]`, `[2]`) avec le texte de col 1. `column_index=2` retourne les traductions.
  2. DOCX avec table 1-col et `column_index=2` → 0 line units, `rows_skipped_short == nb_rows`.
  3. DOCX avec cellule fusionnée horizontalement sur 2 colonnes → la dedup empêche le doublon (1 unit, pas 2).
  4. DOCX avec table imbriquée → warning ajouté, `nested_tables_skipped == 1`, contenu de la sous-table non-importé.
  5. DOCX avec colonne demandée majoritairement sans `[N]` → warning de seuil 50%.
  6. DOCX avec `column_index=None` → comportement identique aux tests existants (régression).
  7. DOCX mixte (paragraphes top-level + une table) → les deux contenus sont aplatis en ordre.
  8. `column_index < 1` → `ValueError`.

## L5 — Documentation

- **`docs/IMPORT_DOCX_ODT_UNICODE_QA.md`** — ajouter une section « Tables multi-colonnes » qui décrit le paramètre, le cas d'usage corpus bilingue, et l'arbre de décision pour choisir `column_index`.
- **`HANDOFF_PREP.md` § 6 Tier S #1** — barrer comme « ✅ Fait » avec lien vers le commit.
- **`CHANGELOG.md`** — entrée sous `[Unreleased]` section `Added`.
- **`docs/SIDECAR_API_CONTRACT.md`** — ajouter `column_index?` au body de `POST /import`.
- **`docs/openapi.json`** — regénérer via `python scripts/export_openapi.py` après avoir mis à jour `sidecar_contract.py` (paramètre dans la requête du `/import`).

# Conventions du repo

- Commits Conventional par phase :
  - `feat(prep): support 2-column DOCX tables via column_index parameter`
  - `feat(prep): expose column_index in /import endpoint + ImportScreen`
  - `test(prep): pytest fixtures for DOCX table extraction edge cases`
  - `docs(prep): document DOCX column_index parameter + close Tier S #1`
- Pas de migration DB.
- Tests : pytest pour le backend. Vitest **non requis** (le frontend ajoute juste un input).

# Ordre d'exécution

1. Lire l'importer actuel et la note Tier S #1 dans HANDOFF_PREP § 6.
2. Implémenter L1 (importer) + tests L4. Vérifier que les 7 tests passent avant d'aller plus loin.
3. Implémenter L2 (sidecar) avec validation du paramètre + propagation à l'importer.
4. Implémenter L3 (frontend) — champ optionnel + affichage des nouveaux champs du report.
5. Smoke test manuel : importer un vrai DOCX bilingue 2-col, vérifier qu'on récupère bien les unités attendues.
6. L5 documentation.

# Ce qu'il NE FAUT PAS faire

- Pas d'auto-création de famille `translation_of` (cf. Décision 5).
- Pas de récursion dans les tables imbriquées (cf. Décision 3).
- Pas de modification des autres importers (ODT paragraphs/numbered_lines, TEI, TXT, CoNLL-U). Le paramètre `column_index` est spécifique à DOCX numbered_lines.
- Pas de bump de version (le ticket sera agrégé dans un `v0.1.44` ultérieur avec d'autres fixes).
- Pas de bypass de la regex `_NUMBERED_RE` — elle reste l'unique source de vérité pour détecter `[N]`.

# Si tu butes

- Si `python-docx`'s `iter_block_items` n'existe pas en helper public, copier l'implémentation de référence depuis [la FAQ python-docx](https://python-docx.readthedocs.io/en/latest/user/inline-shapes.html) (15 lignes via `lxml`).
- Si tu rencontres des merged cells verticaux (vMerge) en plus des horizontaux, dedup pareil par `id(cell)`. Si le comportement diffère trop, traiter dans un follow-up.
- Si une décision ambiguë te bloque, choisis la **moins invasive** et commente avec `// NOTE:`. Comme pour Mode A.

# Livrable attendu

3-4 commits, fichiers modifiés/créés, court résumé final avec :
- ce qui marche (scénarios testés manuellement avec un vrai DOCX 2-col)
- ce qui n'a pas pu être fait et pourquoi
- les `// NOTE:` laissés
- bugs pré-existants découverts en chemin
- recommandation pour la session suivante (cas pathologiques encore non couverts, ex. vMerge si peu commun)
