# Mission (future) : Étendre `column_index` aux autres importers DOCX/ODT

Suite directe de `TICKET_DOCX_TABLES.md` (livré post v0.1.43). Ce ticket
documente le chantier pour étendre le paramètre `column_index` aux 3
importers laissés hors scope V1 :

- `docx_paragraphs`
- `odt_numbered_lines`
- `odt_paragraphs`

**Pré-requis** : un utilisateur a signalé la friction sur un de ces 3
modes (sinon, on n'investit pas — cf. memory `feedback_design_notes_before_ticket`).

# Frictions actuelles (résumé)

| Importer | Comportement sur bilingue 2-col | Friction observée |
|---|---|---|
| `docx_paragraphs` | `Document.paragraphs` ignore les tables → 0 paragraphe importé. | Silencieux, identique à `docx_numbered_lines` avant fix. |
| `odt_numbered_lines` | `tree.iter()` walke tous les `text:p` / `text:h` → cellules importées en ordre row-major. | **Texte interleavé** : `[1] orig`, `[1] trad`, `[2] orig`, `[2] trad`, … dans un même doc. Pire que silencieux : faux contenu sans erreur. |
| `odt_paragraphs` | Idem ODT numbered_lines. | Idem. |

# Décisions de design (à trancher avant d'écrire le code)

## D1 — Modes concernés

Implémenter `column_index` pour quels modes ?

**A.** Les 3 : `docx_paragraphs`, `odt_numbered_lines`, `odt_paragraphs`.
**B.** Seulement `odt_numbered_lines` (le cas le plus courant en pratique).
**C.** Aussi étendre à un nouvel ODT « docx_paragraphs-équivalent » si demandé.

Reco par défaut : **A**. L'infra `column_index` est conçue pour s'étendre,
le coût supplémentaire des 2 autres modes est modeste une fois le walker
ODT écrit.

## D2 — Walker ODT

ODT utilise un schéma XML différent de DOCX. Le walker actuel d'ODT
(`read_odt_paragraph_rich_lines` dans [odt_common.py](../src/multicorpus_engine/importers/odt_common.py)) utilise `tree.iter()` qui ne distingue pas les blocs top-level
des cellules. Il faut un nouveau walker `iter_odt_body_blocks` qui itère
**uniquement** les enfants directs de `office:body/office:text`, et qui
distingue :

- `text:p`, `text:h` → paragraphe top-level
- `table:table` → table (à descendre)
- autres (`text:list`, `text:section`, …) → décider cas par cas

Reco : émuler le pattern de `_iter_body_blocks` du DOCX importer.

## D3 — Cellules fusionnées ODT

ODT utilise un modèle différent du DOCX pour les fusions :

- **Horizontal merge** : la cellule a `table:number-columns-spanned="N"`. Les positions suivantes sont représentées par `<table:covered-table-cell/>` (élément distinct, vide).
- **Vertical merge** : `table:number-rows-spanned="N"`. Les rows suivantes ont `<table:covered-table-cell/>` à cette position.

Stratégie cohérente avec le DOCX :

- **`<table:covered-table-cell/>`** → skip (équivalent à « cellule continuation » en DOCX).
- **`table:number-columns-spanned > 1`** sur la cellule située à column_index : ambigu. Si cette cellule couvre la colonne demandée *depuis une colonne inférieure*, on devrait skip. Si elle EST à column_index avec un span vers les colonnes suivantes, on l'extrait normalement.

Reco : itérer les enfants de `table:table-row` séquentiellement en gardant un curseur de position (incrémenté de `number-columns-spanned` ou 1), et n'extraire que quand le curseur == column_index - 1 ET que l'élément n'est pas `<table:covered-table-cell/>`.

## D4 — Cas docx_paragraphs

Cet importer n'utilise pas la regex `[N]`. Que produit-il à partir d'une
cellule de table ?

Reco : strictement le même comportement qu'un paragraphe top-level — un
paragraphe = une unit, type décidé par la logique existante de l'importer.

## D5 — UX

Faut-il afficher l'input « col » de ImportScreen pour ces 3 modes en plus ?

Reco : oui, conditionner l'affichage sur **`f.mode.includes("_paragraphs")` OR `f.mode === "odt_numbered_lines"` OR `f.mode === "docx_numbered_lines"`** plutôt que sur le seul nom. Plus extensible.

## D6 — Validation sidecar

`_handle_import` valide aujourd'hui `column_index` puis le passe uniquement à `docx_numbered_lines`. Pour étendre, il faut le passer aux 4 importers concernés (les 3 nouveaux + l'existant).

Reco : factoriser un set `_TABLE_AWARE_MODES = {"docx_numbered_lines", "docx_paragraphs", "odt_numbered_lines", "odt_paragraphs"}` et forwarder le paramètre à tous.

# Livrables prévus

## L1 — Walker ODT

Nouveau helper `iter_odt_body_blocks` dans `odt_common.py` ou un nouveau
module. Tests dédiés couvrant : body avec paragraphes seuls, body avec
table seule, body mixte, ordre du document préservé.

## L2 — Refactor `docx_paragraphs`

Mêmes 5 cas pathologiques qu'on a vus pour `docx_numbered_lines`, mais
sans la régex `[N]`. Réutiliser `_iter_body_blocks`, `_is_vmerge_continuation`,
le dedup `id(cell._tc)` du module `docx_numbered_lines` (extraire en
helper partagé `_docx_tables_common.py` si la duplication devient lourde).

## L3 — Implémenter `column_index` dans ODT

Branche le walker + cell extraction + covered-cell skip + dedup via
`number-rows-spanned`. Étendre les 2 importers `odt_numbered_lines` et
`odt_paragraphs` (l'un avec regex `[N]`, l'autre sans, mais infra commune).

## L4 — Sidecar + UI

Factoriser `_TABLE_AWARE_MODES`, étendre la condition d'affichage dans
ImportScreen.

## L5 — Tests

- `tests/test_odt_tables.py` (nouveau) — mêmes cas que DOCX adaptés à ODT (table 2-col, covered cells, merge horizontal/vertical via number-spanned, table imbriquée).
- Étendre `tests/test_docx_numbered_lines_tables.py` avec un cas docx_paragraphs.
- Régression sur les tests ODT existants (`test_odt_*.py`) — pas de drift.

## L6 — Doc

- Mettre à jour `docs/IMPORT_DOCX_ODT_UNICODE_QA.md` § 8 (lever la section « Périmètre V1 — limites connues » qui devient obsolète).
- `HANDOFF_PREP.md` § 6 — entrée historique à barrer si on retire complètement la limite.
- `CHANGELOG.md` sous `[Unreleased]` / Added.

# Estimation

- Walker ODT : ~2-3h (le schéma XML est plus complexe que DOCX).
- Refactor docx_paragraphs : ~1h.
- Branche ODT (incluant merges, covered cells) : ~3-4h avec tests.
- Sidecar + UI : ~1h.
- Doc : ~30 min.

**Total : 1 à 1,5 journée d'agent focalisé.**

# Quand déclencher

Pas avant un signal explicite (utilisateur qui dépose un ODT bilingue
ou docx_paragraphs et signale du contenu mixte / vide). Sinon : YAGNI.

L'infra côté DOCX numbered_lines est déjà extensible — quand la demande
tombe, ce ticket aide à démarrer rapidement avec les décisions
pré-tranchées.
