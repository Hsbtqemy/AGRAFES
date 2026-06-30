# Notes de design — Métadonnées par type, labels filtrables & notes

> Statut : **intention de design — à valider**. Date : 2026-06-30. Cible : `multicorpus-engine` v0.4 + `tauri-prep` (MetadataScreen) / `tauri-app` (concordancier).
> Ancrage vérifié au code (exploration ciblée, 2026-06-30). Légende : ✅ existe · 🟡 partiel · ❌ à construire.

## 1. Cadre & périmètre

Trois besoins de peaufinement du modèle de métadonnées, distincts mais cohérents :

- **(A) Notices par type de document** — la notice à remplir dépend du *type* (un article journalistique ≠ un roman ≠ un essai). Templates de formulaire par `resource_type`.
- **(B) Labels filtrables dans le concordancier** — étiquettes multi-valuées (genre littéraire, thématiques…) pour filtrer les résultats de recherche.
- **(C) Note / « notes to self »** — clarifier le champ « note » actuel et, si besoin, ajouter une note libre au niveau document.

**Contexte mesuré.** Les métadonnées sont déjà **riches mais plates** : un seul formulaire pour tous les types.

## 2. État de l'existant (ancré)

**Colonnes `documents`** (par migration) : `title`, `language`, `doc_role`, `resource_type`, `meta_json`, `source_path`, `source_hash`, `created_at` ([001](../migrations/001_initial_schema.sql)) ; `workflow_status`, `validated_at`, `validated_run_id` ([005](../migrations/005_document_workflow_status.sql)) ; `author_lastname/firstname`, `doc_date` ([010](../migrations/010_document_author_date.sql)) ; `text_start_n` ([015](../migrations/015_text_start.sql)) ; `translator_lastname/firstname` ([016](../migrations/016_document_translator.sql)) ; `work_title`, `pub_place`, `publisher` ([017](../migrations/017_document_biblio.sql)).

**Formulaire** : `MetadataScreen.ts` (panneau doc lignes 691-813). `resource_type` = **input texte libre** ([MetadataScreen.ts:740](../tauri-prep/src/screens/MetadataScreen.ts#L740)), **aucune logique conditionnelle** par type. `doc_role` = select (DOC_ROLES).

**`documents.meta_json`** : colonne JSON déclarée ([001](../migrations/001_initial_schema.sql)) mais **inutilisée pour du métadonnées applicatif** → home naturel pour des champs variables.

**Filtres concordancier déjà en place** ✅ : `_apply_doc_filters` ([query.py:528-590](../src/multicorpus_engine/query.py#L528)) gère `language`, `doc_id(s)`, **`resource_type`**, `doc_role`, `author` (LIKE), `title_search` (LIKE), `doc_date_from/to`, `source_ext`. Params POST `/query` ([sidecar.py:1700](../src/multicorpus_engine/sidecar.py#L1700)) ; résumé front `activeFiltersSummary` ([query.ts:122](../tauri-app/src/features/query.ts#L122)).

**« note »** : c'est `doc_relations.note` ([003_alignment.sql:10](../migrations/003_alignment.sql)) — note libre sur la **relation entre deux documents** (input `rel-note` « optionnel », [MetadataScreen.ts:792](../tauri-prep/src/screens/MetadataScreen.ts#L792)). À distinguer du `unit_role='note'` (rôle structurel d'unité). **Aucun champ note au niveau document.**

**Pas de table de tags/labels.**

## 3. Besoin A — Notices/templates par type de document

**Décisions**
- `resource_type` devient une **valeur d'une liste extensible** (enum applicatif), pas un texte libre. La liste reste éditable (permissif).
- Chaque type porte un **template de formulaire** : champs universels (colonnes existantes) + champs **spécifiques au type**.
- **Champs spécifiques stockés dans `documents.meta_json`** (clé par champ) → **pas une migration par champ**, et la colonne est déjà là.

**Esquisse de templates** (à figer en §8) :

| Type | Champs spécifiques (en plus des universels) |
|------|---------------------------------------------|
| `article_journalistique` | titre de presse, rubrique, n°/date édition, URL, date de consultation |
| `roman` | collection, n° d'édition, année de 1ʳᵉ publication, ISBN |
| `essai` | domaine, collection, édition |
| `poesie`, `discours`, … | à définir |

**Greffe** : `MetadataScreen._renderEditPanel` (691-813) — rendre les champs spécifiques selon `resource_type` (un dictionnaire `TYPE_TEMPLATES` côté front) ; persister les champs spécifiques via `meta_json` dans `/documents/update`. Le service `documents_service.py` doit accepter `meta_json` (aujourd'hui `_UPDATABLE` ne le contient pas — [documents_service.py:26](../src/multicorpus_engine/services/documents_service.py#L26)).

**État** : 🟡 colonne `resource_type` + `meta_json` existent ; ❌ enum, templates, rendu conditionnel, persistance `meta_json` à construire.

## 4. Besoin B — Labels filtrables dans le concordancier

**Pourquoi une table dédiée** : `resource_type` est **mono-valué** (un type/doc) → inadapté à « genre + thématiques » multi-valués.

**Décision** : table **`document_tags`** (N-N), namespacée pour distinguer les axes (genre, thème, …) :
```sql
-- migration NNN_document_tags.sql
CREATE TABLE document_tags (
    doc_id   INTEGER NOT NULL REFERENCES documents(doc_id) ON DELETE CASCADE,
    kind     TEXT NOT NULL,   -- 'genre' | 'theme' | … (axe de label)
    value    TEXT NOT NULL,   -- 'roman', 'exil', …
    PRIMARY KEY (doc_id, kind, value)
);
CREATE INDEX idx_document_tags_kv ON document_tags(kind, value);
```

**Greffe**
- Engine : ajouter un filtre `tags` dans `_apply_doc_filters` ([query.py:528](../src/multicorpus_engine/query.py#L528)) — `JOIN document_tags` / `WHERE (kind,value) IN (…)` ; param `tags` dans `/query` ([sidecar.py:1700](../src/multicorpus_engine/sidecar.py#L1700)).
- CRUD : endpoints `POST /documents/tags/add|remove`, `GET /tags` (handlers fins, logique dans `services/`).
- UI Prep : picker multi-select dans MetadataScreen. UI concordancier : filtre tags (modèle `activeFiltersSummary`).

**État** : ✅ pattern de filtre concordancier réutilisable ; ❌ table, CRUD, filtre `tags`, UI.

## 5. Besoin C — Note de relation vs « notes to self »

**Clarification** : le « note (optionnel) » visible aujourd'hui est la **note de relation** (`doc_relations.note`). Ce n'est **pas** un commentaire libre sur le document.

**Décisions**
- **Ajouter `documents.notes`** (TEXT, textarea libre) = le « notes to self » au niveau document. Migration triviale + champ MetadataScreen + `documents_service._UPDATABLE`.
- **Relibeller** l'input de relation « note sur la relation » (et garder son placeholder « optionnel ») pour lever l'ambiguïté. (Front seul, pas de migration.)
- Décider si `documents.notes` doit être **cherchable/affiché** dans le concordancier (probablement non indexé FTS — méta, pas contenu).

**État** : ❌ champ `documents.notes` + relibellage à faire.

## 6. Modèle de données — migrations

| Besoin | Migration | Détail |
|--------|-----------|--------|
| A — champs spécifiques par type | **aucune** | `documents.meta_json` (existe) + accepter `meta_json` dans `_UPDATABLE` |
| B — labels | **022/023_document_tags.sql** | table N-N + index |
| C — notes-to-self | **023/024_document_notes.sql** | `ALTER TABLE documents ADD COLUMN notes TEXT` |

> Numéros indicatifs — la dernière migration est la **021** ; à coordonner avec la migration `022_unit_status` du design péritexte ([DESIGN_peritext_conventions_grounding.md](DESIGN_peritext_conventions_grounding.md)).

## 7. Contraintes & découpage

**Contrat sidecar** : tout endpoint nouveau (`/documents/tags/*`, champs ajoutés à `/documents/update` ou `/query`) ⇒ bump `CONTRACT_VERSION`, MAJ `openapi_spec()`, `scripts/export_openapi.py`, commit `docs/openapi.json` + snapshot, et `docs/SIDECAR_API_CONTRACT.md` (test `test_contract_docs_sync`). Write-paths → `_WRITE_PATHS` + write-lock.
**Growth-gate** : logique dans `services/`, handlers fins.

**Tickets**
- **M1** — `documents.notes` + relibellage note de relation (petit, isolé).
- **M2** — Labels : table `document_tags` + CRUD + filtre `tags` (engine + UI Prep + UI concordancier).
- **M3** — Templates par type : enum `resource_type` + `TYPE_TEMPLATES` front + rendu conditionnel + persistance `meta_json` (accepter `meta_json` dans `_UPDATABLE`).

## 8. Décisions à figer

1. **Liste des `resource_type`** de référence + leurs templates (champs spécifiques exacts par type).
2. **Axes de labels** (`kind`) : genre, thème, libre ? Vocabulaire contrôlé ou libre ?
3. **`meta_json` par type** : schéma souple (clés libres) vs validé (schéma par type) ?
4. **Notes** cherchables dans le concordancier ou purement méta ?
5. Migration : champs spécifiques en `meta_json` (souple) **ou** colonnes dédiées si un champ devient universel/filtrable (ex. `doc_date` est déjà une colonne filtrable — un champ qu'on voudra filtrer mérite une colonne, pas `meta_json`).
