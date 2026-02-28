# Charte Agent IDE v1 — Core Engine corpus multilingue + Concordancier

## 0) But
Développer un **core engine Python** (sans UI) pour :
- importer des corpus (TXT/DOCX/TEI),
- produire des unités (blocs/phrases ou lignes numérotées),
- indexer et interroger (KWIC/segment),
- (option) aligner via `external_id`,
- exporter (CSV/JSONL/HTML + TEI "analyse"),
avec une architecture compatible **Tauri** (pilotage par CLI/sidecar).

---

## 1) Règles absolues (non négociables)
1) Repo source HIMYC **lecture seule** : aucune modification, aucune PR, aucune migration.
2) Tout travail se fait dans un **repo cible** séparé.
3) Le core engine est **indépendant de toute UI** (pas de dépendances Tauri/Qt/web).
4) Toute transformation est un **run** : paramétré, journalisé, rejouable.
5) **Encodage & Unicode** : politique obligatoire (section 6).
6) Sorties et erreurs doivent être **déterministes et testables**.
7) À la fin de chaque incrément : tests verts + mise à jour Roadmap/Backlog/Decisions/Changelog.

---

## 2) Artefacts obligatoires (gestion de projet)
Créer/maintenir :
- `docs/ROADMAP.md` — Now / Next / Later, phases (V1/V1.1/V2), daté
- `docs/BACKLOG.md` — items priorisés, statut, critères d'acceptation
- `docs/DECISIONS.md` — mini ADR (contexte→décision→conséquences)
- `CHANGELOG.md` — notes par incrément/version
- `docs/INTEGRATION_TAURI.md` — contrat d'intégration (CLI/sidecar)

### Règle de clôture d'incrément
À la fin de chaque incrément :
- Roadmap mise à jour (Now→Done, Next ajusté)
- Backlog enrichi (5–15 items)
- Decisions (1–3 entrées si décision structurante)
- Changelog incrémenté

---

## 3) Architecture cible (Tauri-ready)
### 3.1 Frontière d'intégration
Le core expose :
- **API Python** (fonctions stables)
- **CLI** (contrat stable, JSON en sortie)

Tauri pourra :
- V1 : lancer la **CLI** (spawn + JSON)
- V2 : lancer un **sidecar** API (option)

### 3.2 Convention I/O
- Chaque commande CLI renvoie :
  - un **JSON résumé** sur stdout (statut, ids, warnings, chemins outputs)
  - logs détaillés dans un fichier de run (`runs/<run_id>/run.log`)

---

## 4) Modèle de données (minimum V1)
### 4.1 Tables essentielles (SQLite)
- `documents`
  - `doc_id`, `title`, `language`, `doc_role`, `resource_type`
  - `meta_json`
  - `source_path`, `source_hash`, `created_at`
- `doc_relations` (optionnel V1)
  - `doc_id`, `relation_type` (`translation_of|excerpt_of`), `target_doc_id`, `note`
- `units`
  - `unit_id`, `doc_id`
  - `unit_type` (`block|sentence|line|structure`)
  - `n` (ordre), `external_id` (nullable)
  - `text_raw`, `text_norm`
  - `meta_json` (TEI anchors, sep_count, etc.)
- `runs`
  - `run_id`, `kind` (`import|curation|segment|align|index|export`)
  - `params_json`, `stats_json`, `created_at`
- `fts_units` (FTS5)
  - index sur `text_norm` + colonnes de filtrage (doc_id/lang) selon implémentation

### 4.2 Champs V1 (métadonnées)
- `doc_role` (enum strict) : `original|translation|excerpt|standalone|unknown`
- `resource_type` (semi-contrôlé) : suggestions + valeur libre possible

---

## 5) Importers V1 (minimum)
### 5.1 TXT
- lecture binaire, détection encodage (policy), normalisation Unicode
- unités par paragraphe par défaut, option phrases plus tard

### 5.2 DOCX "paragraphs"
- extraction paragraphes `python-docx`
- conversion en `block` + éventuellement `sentence`

### 5.3 DOCX "numbered_lines" (contrat validé)
Règles (résumé) :
- détecter `^\[\s*(\d+)\s*\]\s*(.+)$`
- créer unités `unit_type="line"`, `external_id=int(...)`
- conserver `¤` en `text_raw`, remplacer `¤` par espace dans `text_norm`
- paragraphes non numérotés : `unit_type="structure"` (non indexé V1)
- diagnostics : doublons, trous, désordre + `import_report`

### 5.4 TEI basic
- extraction unités :
  - si `<s>` : unités sentence
  - sinon `<p>` : unités block
- capturer `xml:id` et chemin logique en `meta_json`

---

## 6) Politique Encodage & Unicode (obligatoire)
1) Interne : `str` Unicode partout.
2) Import TXT :
   - lire bytes + hash
   - décoder BOM → déclaration → charset-normalizer → fallback cp1252/latin-1 (warning)
3) Normalisation :
   - NFC
   - normaliser fins de ligne
   - supprimer/normaliser invisibles (ZWSP, NBSP/NNBSP…) dans `text_norm`
4) `¤` :
   - `text_raw` conserve
   - `text_norm` remplace par espace
   - `text_display` (UI) remplace par ` | ` ou `⏎`
5) Export TEI :
   - UTF-8 + déclaration XML
   - échappement XML systématique
   - filtrage caractères invalides XML 1.0

---

## 7) Curation V1 (minimal, rejouable)
- moteur de règles appliquées sur `text_raw → text_norm` (ou `text_norm → text_norm2`)
- règles minimales "safe" :
  - espaces multiples, trim
  - normalisation quotes/dashes basique
  - suppression ZWSP / contrôles
  - politique NBSP (à décider en DECISIONS si besoin)
- curation = `curation_run` (params + stats + exemples)

---

## 8) Segmentation V1
- V1 minimum : block → sentence (rule-based), si demandé
- édition split/merge : backlog (V1.1) sauf nécessité immédiate

---

## 9) Alignement V1
- `align_by_external_id`
  - pivot (FR) + cibles
  - crée liens 1–1 quand `external_id` commun
  - rapport : couverture, ids manquants, doublons

*(fallback monotone+similarité = backlog V1.1)*

---

## 10) Recherche / KWIC (cœur Explorer)
- Requête FTS (mot/phrase) + filtres (langue/doc/resource_type)
- Deux sorties :
  - **Segment** : unité entière avec surlignage
  - **KWIC** : left/match/right (fenêtre N mots)
- Syntaxe avancée (regex/booléens complets) = backlog

---

## 11) Exports V1
- CSV/TSV : résultats KWIC/segment
- JSONL : hits rejouables
- HTML : rapport simple
- TEI "analyse" :
  - `teiHeader` depuis métadonnées
  - `text/body` avec `<p><s>` si phrases, sinon `<p>`
  - UTF-8 + échappement + ids stables

---

## 12) CLI V1 (contrat stable, Tauri-ready)
Commandes minimales :
1) `init-project`
2) `import` (txt/docx/tei + mode docx_numbered_lines)
3) `index` (FTS rebuild/update)
4) `query` (segment/KWIC + filtres + export optionnel)
5) `align` (by_external_id)
6) `export` (tei_analysis/csv/jsonl/html)

Chaque commande :
- écrit un `run`
- renvoie JSON résumé
- écrit logs détaillés

---

## 13) Tests minimum (DoD technique)
- migrations OK
- import DOCX numbered_lines : `external_id` extrait + `¤` absent de `text_norm`
- align_by_external_id : lien créé si `external_id` commun
- query FTS : retourne hits attendus
- export TEI : UTF-8 + échappement + pas de chars invalides

---

# Plan d'incréments (proposé)

## Incrément 1 — "Explorer minimal"
- DB + migrations + `init-project`
- import DOCX numbered_lines + index FTS
- `query` (segment + KWIC basique)
- tests import + FTS

## Incrément 2 — "Alignement par ancres"
- `align_by_external_id` + rapport couverture
- vue query "parallèle" (API) = backlog si UI absente
- tests alignement

## Incrément 3 — "Export TEI analyse + métadonnées"
- panel meta côté core (schema + validation warnings)
- export TEI analyse profilé
- docs `INTEGRATION_TAURI.md` étoffée
