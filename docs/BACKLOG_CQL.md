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

## Sprint A — Import CoNLL-U ✅

> Objectif : ingérer des fichiers CoNLL-U déjà annotés et peupler la table `tokens`.

### Backend

- [x] Migration `012_tokens.sql` — création de la table `tokens` + index
- [x] Nouvel importeur `importers/conllu.py`
  - Lit le format CoNLL-U (10 colonnes)
  - Crée les `units` (une par bloc de phrase ou par paragraphe vide-séparé selon option)
  - Crée les `tokens` correspondants
  - Gère les multi-tokens (`1-2 du` → tokens `1 de` + `2 le`)
- [x] `sidecar.py` : nouvelle route `POST /jobs/enqueue` mode `"conllu"`
- [x] `sidecar_contract.py` : mise à jour du schéma, bump API version 1.7.0

### Frontend (tauri-prep)

- [x] `ImportScreen.ts` : option `"conllu"` dans le sélecteur de mode d'import
- [ ] Validation : afficher un aperçu des tokens (word / lemma / upos) avant import définitif — **déféré Sprint D**

---

## Sprint B — Annotation automatique (spaCy) ✅

> Objectif : annoter automatiquement un document texte brut déjà importé, en option.

### Backend

- [x] Dépendance optionnelle : `spacy` dans `pyproject.toml` (groupe `[nlp]`)
- [x] `annotator.py` — pipeline spaCy :
  - `annotate_document(conn, doc_id, model_name)` → peuple `tokens` depuis `units.text_norm`
  - Segmentation en phrases → `sent_id`
  - Tokenisation → `position`, `word`, `lemma`, `upos`, `xpos`, `feats`
  - Modèles supportés : `fr_core_news_lg`, `en_core_web_lg`, etc.
- [x] Route `POST /jobs/enqueue kind="annotate"` — job asynchrone
  - Body : `{ doc_id, model }` ou `{ all_docs: true, model }`
  - Suivi via JobCenter
- [x] Sidecar : chargement paresseux du modèle spaCy (première requête seulement)
- [x] API version → 1.7.1

### Frontend (tauri-prep)

- [x] Bouton "Annoter" dans le panneau Métadonnées → déclenche le job `annotate`
- [x] Indicateur de progression (JobCenter) pendant l'annotation
- [x] Badge "🔤 Annoté" sur les documents qui ont des tokens en base (`token_count > 0`)

---

## Sprint C — Requêtes CQL simples + concordancier KWIC ✅

> Objectif : requêtes `[attribut = "valeur"]` et séquences fixes sans wildcards,
> avec un onglet Concordancier dédié et export des résultats.

### Backend

- [x] `cql_parser.py` — parseur de la syntaxe CQL de base :
  - `[lemma = "..."]`, `[word = "..."]`, `[upos = "..."]`, `[feats = "..."]`
  - Regex dans les valeurs (`"lib.*"`)
  - Flag `%c` (insensible à la casse)
  - Opérateurs booléens dans un token : `[upos = "VERB" & lemma = "lib.*"]`
  - Séquences : `[token1][token2][token3]`
- [x] `token_query.py` — traducteur CQL → SQL :
  - Génère des requêtes SQL avec jointures sur `(unit_id, sent_id, position)`
  - Renvoie des hits KWIC : contexte gauche / nœud / contexte droit (tokens)
  - doc_id + unit_id + position dans les résultats
- [x] Route `POST /token_query`
  - Body : `{ cql, window, doc_ids?, limit, offset }`
  - Réponse : `{ hits: [{doc_id, unit_id, left, node, right}], total, has_more, next_offset }`
- [x] Route `POST /export/kwic` — export CSV / TXT / DOCX / ODT via `kwic_export.py`

### Frontend — Onglet Concordancier CQL (nouvel onglet dans tauri-prep)

- [x] `ConcordancierScreen.ts` — écran dédié enregistré dans `app.ts`
- [x] Zone de recherche :
  - Champ CQL (textarea monospace, Ctrl+Enter pour lancer)
  - Sélecteur contexte : ± 3 / 5 / 10 / 20 tokens
  - Sélecteur par page : 50 / 100 / 200
  - Filtre par document (dropdown)
  - Aide syntaxique dépliable `<details>`
  - Bouton **Rechercher** + compteur "N occurrences"
- [x] Tableau KWIC :
  - Colonnes : Doc | Ligne | ← Contexte | **Nœud** | Contexte →
  - Pagination "Charger plus" avec offset
- [x] Export des résultats :
  - CSV (tabulation : doc_id, unit_id, gauche, nœud, droite)
  - TXT (lignes KWIC brutes)
  - DOCX (tableau Word, nœud en gras)
  - ODT (tableau LibreOffice, nœud en gras)
- [x] `sidecarClient.ts` : `runTokenQuery` + `exportKwic`

### Différé (Sprint F ou plus tard)

- [ ] Liste de fréquences (bascule KWIC ↔ fréquences)
- [ ] Navigation croisée → ouvre l'onglet Documents sur la ligne cliquée
- [ ] Historique des requêtes (dropdown des dernières)
- [ ] Tri sur colonnes KWIC (L1, R1, nœud, doc)
- [ ] Coloration syntaxique CQL (CodeMirror / Prism.js)

---

## Sprint D — CQL avancé (`[]{0,N}` et `within s`)

> Objectif : séquences avec répétition et contraintes de frontière de phrase.

### Backend

- [ ] Parseur CQL : étendre pour
  - `[]{0,N}` — répétition de tokens quelconques
  - `[token]{m,n}` — répétition d'un token
  - `within s` — contrainte de phrase (tous les tokens dans le même `sent_id`)
  - `within <doc/>` — contrainte de document (implicite dans notre modèle)
- [ ] `token_query.py` : algorithme de correspondance par glissement de fenêtre
  - Stratégie : SQL + post-filtre Python pour les cas complexes
  - `within s` : ajout de `GROUP BY sent_id` dans la CTE de correspondance

### Frontend

- [ ] Aide CQL enrichie dans le popover (syntaxe complète avec exemples)
- [ ] Validation de la syntaxe CQL côté client avant envoi (erreur immédiate si mal formé)

---

## Sprint E — Export et interopérabilité

> Objectif : exporter les annotations et résultats de requêtes CQL dans des formats standard.

- [ ] Export CoNLL-U depuis AGRAFES (annotations + texte)
- [x] Export des hits CQL en KWIC tabulaire (CSV/TXT/DOCX/ODT) → Sprint C
- [ ] Export en format Sketch Engine (`.ske`) si faisabilité confirmée
- [ ] Import depuis NoSketchEngine ou CWB (corpus compilé) — étude de faisabilité

---

## Décisions architecturales à prendre

| Question | Options | Recommandation actuelle |
|----------|---------|------------------------|
| Granularité d'une unité CoNLL-U | Phrase / Paragraphe / Fichier entier | Paragraphe (cohérent avec l'existant) |
| Stockage des traits morpho | Colonne TEXT (CoNLL-U string) vs JSON | CoNLL-U string (fidèle, parsable à la demande) |
| Moteur CQL côté serveur | Python pur / SQLite CTE / module Rust | Python pur pour Sprint C, CTE pour D |
| Annotation paresseuse vs systématique | À l'import / Sur demande / Tâche de fond | Sur demande (Sprint B) |
| Modèles spaCy packagés | Bundlés dans l'exécutable / Téléchargés | Téléchargés (trop lourds pour PyInstaller) |

---

## Dépendances et prérequis

- **Python** : `spacy >= 3.7`, `conllu >= 4.5` (parsing CoNLL-U)
- **SQLite** : version ≥ 3.35 pour les CTE récursives (déjà satisfait)
- **Frontend** : CodeMirror ou Prism.js pour la coloration syntaxique CQL (optionnel)
- **Modèles NLP** : à télécharger séparément (`python -m spacy download fr_core_news_lg`)

---

## État des lieux (mars 2026)

| Composant | Statut |
|-----------|--------|
| Regex texte-brut (bypass FTS) | ✅ Implémenté (`079075b`) |
| Table `tokens` | ⬜ À faire (Sprint A) |
| Import CoNLL-U | ⬜ À faire (Sprint A) |
| Annotation spaCy | ⬜ À faire (Sprint B) |
| Parser CQL simple | ⬜ À faire (Sprint C) |
| Séquences + `within s` | ⬜ À faire (Sprint D) |
| Export CoNLL-U | ⬜ À faire (Sprint E) |
