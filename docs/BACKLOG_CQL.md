# Backlog — Recherche CQL (Corpus Query Language)

> Objectif : doter AGRAFES d'un moteur de recherche token par token avec attributs
> linguistiques (lemme, POS, traits morphologiques), compatible avec la syntaxe CQL
> utilisée par NoSketchEngine, IMS CWB et Sketch Engine.
>
> **Prérequis** : le mode regex texte-brut est déjà disponible (commit `079075b`).
> CQL en est l'extension naturelle, mais implique une rupture architecturale :
> passage du niveau *segment* au niveau *token*.

---

## Contexte et exemple cible

Requête CQL typique (pattern d'extraposition en anglais) :

```cql
[enlemma = "it" %c]
[enlemma = "be|seem|appear|become|matter|follow|help"]
[]{0,4}
[enword = "to|that|whether|if|what|when|where|which|who|whom|whose|why|how" %c]
within s;
```

Ce que chaque partie signifie :

| Élément | Sens |
|---------|------|
| `[lemma = "lib.*"]` | Token dont le lemme correspond à l'expression régulière |
| `[pos = "NOM.*"]` | Token dont la catégorie POS correspond |
| `[]{0,4}` | Entre 0 et 4 tokens quelconques |
| `%c` | Insensible à la casse |
| `within s` | Tout doit tenir dans la même phrase |

---

## Architecture cible

```
documents
  └── units          (paragraphes / segments — existant)
        └── tokens   (NOUVEAU — un token par ligne)
```

### Nouvelle table `tokens`

```sql
CREATE TABLE tokens (
    token_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    unit_id    INTEGER NOT NULL REFERENCES units(unit_id),
    sent_id    INTEGER NOT NULL,   -- indice de phrase dans l'unité (pour `within s`)
    position   INTEGER NOT NULL,   -- position du token dans la phrase
    word       TEXT,               -- forme de surface
    lemma      TEXT,
    upos       TEXT,               -- Universal POS (NOUN, VERB, ADJ…)
    xpos       TEXT,               -- POS spécifique à la langue
    feats      TEXT,               -- traits morphologiques (JSON ou conllu string)
    misc       TEXT                -- champ MISC CoNLL-U
);
CREATE INDEX idx_tokens_unit ON tokens (unit_id);
CREATE INDEX idx_tokens_lemma ON tokens (lemma);
CREATE INDEX idx_tokens_upos  ON tokens (upos);
```

---

## Sprint A — Import CoNLL-U

> Objectif : ingérer des fichiers CoNLL-U déjà annotés et peupler la table `tokens`.

### Backend

- [x] Migration `012_tokens.sql` — création de la table `tokens` + index
- [x] Nouvel importeur `importers/conllu.py`
  - Lit le format CoNLL-U (10 colonnes)
  - Crée les `units` (une par bloc de phrase ou par paragraphe vide-séparé selon option)
  - Crée les `tokens` correspondants
  - Gère les multi-tokens (`1-2 du` → tokens `1 de` + `2 le`)
- [x] `sidecar.py` : nouvelle route `POST /import` mode `"conllu"`
- [x] `sidecar_contract.py` : mise à jour du schéma, bump API version
- [x] Snapshot `openapi_paths.json` + `docs/SIDECAR_API_CONTRACT.md`

### Frontend (tauri-prep)

- [x] `ImportScreen.ts` : option `"conllu"` dans le sélecteur de mode d'import
- [x] Validation : afficher un aperçu des tokens (word / lemma / upos) avant import définitif

---

## Sprint B — Annotation automatique (spaCy)

> Objectif : annoter automatiquement un document texte brut déjà importé, en option.

### Backend

- [x] Dépendance optionnelle : `spacy` dans `pyproject.toml` (groupe `[nlp]`)
- [x] `annotator.py` — pipeline spaCy :
  - `annotate_document(conn, doc_id, model_name)` → peuple `tokens` depuis `units.text_norm`
  - Segmentation en phrases → `sent_id`
  - Tokenisation → `position`, `word`, `lemma`, `upos`, `xpos`, `feats`
  - Modèles supportés : `fr_core_news_lg`, `en_core_web_lg`, etc.
- [x] Route `POST /annotate` — lance un job asynchrone (même pattern que `/segment`)
  - Body : `{ doc_id, model }` ou `{ all_docs: true, model }`
  - Répond avec un `job_id` (enveloppe job) ; suivi via `/jobs/{job_id}`
- [x] Sidecar : chargement paresseux du modèle spaCy (première requête seulement)

### Frontend (tauri-prep)

- [x] Bouton "Annoter" dans le panneau Métadonnées → déclenche `POST /annotate`
- [x] Indicateur de progression (JobCenter) pendant l'annotation
- [x] Badge "Annoté" sur les documents qui ont des tokens en base

---

## Sprint C — Requêtes CQL simples

> Objectif : requêtes `[attribut = "valeur"]` et séquences fixes sans wildcards.

### Backend

- [x] `cql_parser.py` — parseur de la syntaxe CQL de base :
  - `[lemma = "..."]`, `[word = "..."]`, `[pos = "..."]`
  - Regex dans les valeurs (`"lib.*"`)
  - Flag `%c` (insensible à la casse)
  - Opérateurs booléens dans un token : `[pos = "NOM" & lemma = "lib.*"]`
  - Séquences : `[token1][token2][token3]`
- [x] `token_query.py` — traducteur CQL → SQL :
  - Génère des requêtes SQL avec fenêtrage sur `(unit_id, sent_id, position)`
  - Renvoie des hits au niveau token + contexte (unité parente + tokens voisins)
- [x] Route `POST /token_query`
  - Body : `{ cql, mode ("kwic"|"segment"), window, language?, doc_ids?, limit, offset }`
  - Réponse : même structure que `/query` mais hits enrichis de `tokens[]`

### Frontend (concordancier)

- [x] Nouveau mode "CQL" dans le builder (distinct de Regex et FTS)
- [x] Champ de saisie CQL avec coloration syntaxique légère
- [x] Affichage des résultats : token pivot surligné + contexte en KWIC
- [x] Indicateur "N tokens analysés" dans l'en-tête des résultats

---

## Sprint D — CQL avancé (`[]{0,N}` et `within s`)

> Objectif : séquences avec répétition et contraintes de frontière de phrase.

### Backend

- [x] Parseur CQL : étendre pour
  - `[]{0,N}` — répétition de tokens quelconques
  - `[token]{m,n}` — répétition d'un token
  - `within s` — contrainte de phrase (tous les tokens dans le même `sent_id`)
  - `within <doc/>` — contrainte de document (implicite dans notre modèle)
- [x] `token_query.py` : algorithme de correspondance par glissement de fenêtre
  - Stratégie : SQL + post-filtre Python pour les cas complexes
  - `within s` : matching par sous-flux `(unit_id, sent_id)` pour garantir la borne phrase

### Frontend

- [x] Aide CQL enrichie dans le popover (syntaxe complète avec exemples)
- [x] Validation de la syntaxe CQL côté client avant envoi (erreur immédiate si mal formé)

---

## Sprint E — Export et interopérabilité

> Objectif : exporter les annotations et résultats de requêtes CQL dans des formats standard.

- [x] Export CoNLL-U depuis AGRAFES (annotations + texte)
- [x] Export des hits CQL en KWIC tabulaire (CSV/TSV)
- [x] Export en format Sketch Engine (`.ske`) si faisabilité confirmée
- [x] Import depuis NoSketchEngine ou CWB (corpus compilé) — étude de faisabilité
  - étude consignée dans `docs/CQL_INTEROP_FEASIBILITY.md` (interop texte/vertical recommandée, binaire compilé non retenu en Sprint E)

---

## Décisions architecturales à prendre

| Question | Options | Recommandation actuelle |
|----------|---------|------------------------|
| Granularité d'une unité CoNLL-U | Phrase / Paragraphe / Fichier entier | Paragraphe (cohérent avec l'existant) |
| Stockage des traits morpho | Colonne TEXT (CoNLL-U string) vs JSON | CoNLL-U string (fidèle, parsable à la demande) |
| Moteur CQL côté serveur | Python pur / SQLite CTE / module Rust | Python pur pour Sprint C, CTE pour D |
| Annotation paresseuse vs systématique | À l'import / Sur demande / Tâche de fond | Sur demande (Sprint B) |
| Modèles spaCy packagés | Bundlés dans l'exécutable / Téléchargés | Téléchargés (trop lourds pour PyInstaller) |

> Alignement produit (C4, 2026-04-09) : `upos` est la référence POS,
> `xpos` reste optionnel ; l’ingestion CoNLL-U est prioritaire avant
> annotation automatique. Voir `docs/cadrage/CATEGORIES_GRAMMATICALES.md`.

---

## Dépendances et prérequis

- **Python** : `spacy >= 3.7`, `conllu >= 4.5` (parsing CoNLL-U)
- **SQLite** : version ≥ 3.35 pour les CTE récursives (déjà satisfait)
- **Frontend** : CodeMirror ou Prism.js pour la coloration syntaxique CQL (optionnel)
- **Modèles NLP** : à télécharger séparément (`python -m spacy download fr_core_news_md` ou modèle équivalent)

---

## État des lieux (avril 2026)

| Composant | Statut |
|-----------|--------|
| Regex texte-brut (bypass FTS) | ✅ Implémenté (`079075b`) |
| Table `tokens` | ✅ Implémentée (Sprint A) |
| Import CoNLL-U | ✅ Implémenté (Sprint A) |
| Annotation spaCy | ✅ Implémentée (Sprint B) |
| Parser CQL simple | ✅ Implémenté (Sprint C) |
| Séquences + `within s` | ✅ Implémenté (Sprint D) |
| Export CoNLL-U | ✅ Implémenté (Sprint E) |
| Export hits CQL CSV/TSV | ✅ Implémenté (Sprint E) |
| Export Sketch Engine `.ske` | ✅ Implémenté (Sprint E) |
| Interop NoSketchEngine / CWB (faisabilité) | ✅ Étude terminée (`docs/CQL_INTEROP_FEASIBILITY.md`) |
| Édition manuelle token par token | ✅ Implémentée (API `/tokens` + `/tokens/update`, UI Prep Documents) |
