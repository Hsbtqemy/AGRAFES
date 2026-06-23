# Métadonnées Document — Cadrage C5

Last updated: 2026-06-23

## Objectif C5

Figer le **modèle de métadonnées document** et son **contrat de validation** —
clôt le point **D1** du ROADMAP (« la validation `/validate-meta` est livrée, seule la
note de cadrage manque »). Ce cadrage **documente l'existant** (`metadata.py`,
[ADR-010](../DECISIONS.md)) ; il n'introduit ni dette moteur ni changement de contrat.

## Principe (acté — ADR-010)

La validation des métadonnées est **observable sans bloquer l'ingestion** : elle
retourne des **avertissements structurés**, jamais une erreur dure par défaut. La
qualité du corpus se surveille en continu, de façon non destructive.

- `metadata.validate_document(conn, doc_id)` / `validate_all_documents(conn)` →
  `MetaValidationResult{doc_id, title, is_valid, warnings[]}`. **Ne lève jamais.**
- `is_valid = false` **uniquement** si un champ **obligatoire** manque/est invalide.
- Exposé : **CLI** `multicorpus validate-meta [--doc-id N]` (`status=ok|warnings`,
  pas d'échec dur par défaut) ; **sidecar** `POST /validate-meta` (body `{doc_id?}`).

## Classification des champs (figée)

| Champ | Classe | Règle |
|---|---|---|
| `title` | **Obligatoire** | non vide → sinon `is_valid=false` |
| `language` | **Obligatoire** | non vide **et** code BCP-47 `^[a-z]{2,3}(-…)*$` (ex. `fr`, `en`, `de`, `fr-CA`) → sinon `is_valid=false` |
| `doc_role` | Recommandé | warning si **absent** ; warning si valeur hors vocabulaire. `standalone` (défaut schéma) accepté sans warning |
| `resource_type` | Recommandé | warning si absent ou hors vocabulaire |
| `author_lastname` | Recommandé | warning si absent (citations, F1) |
| `doc_date` | Optionnel | si présent, format `AAAA` / `AAAA-MM` / `AAAA-MM-JJ` → sinon warning |
| `author_firstname` | Optionnel | stocké, non vérifié |
| `source_path`, `source_hash` | Technique | renseignés automatiquement à l'import, non exposés à l'utilisateur |

**Sanity supplémentaire** (non lié à un champ) : warning « Aucune unité indexée » si le
document n'a aucune `unit_type='line'` (import à relancer / fichier source à vérifier).

## Vocabulaires contrôlés (figés)

- **`doc_role`** : `original`, `translation`, `excerpt`, `standalone`, `unknown`.
- **`resource_type`** : `text`, `corpus`, `parallel`, `monolingual`, `reference`, `other`.

Une valeur hors vocabulaire produit un **warning** (non bloquant), pas un rejet — la
colonne reste stockée verbatim (tolérance aux corpus existants / imports externes).

## Non-objectifs (hors périmètre C5)

- **Pas de blocage dur** d'un workflow sur des métadonnées incomplètes (advisory only).
  Un appelant peut décider de traiter `is_valid=false` comme bloquant, mais le moteur
  ne l'impose pas.
- **Pas de migration** ni de nouveau champ : le schéma `documents` actuel fait foi.
- **Pas d'auto-complétion** des métadonnées (déduction d'auteur/date depuis le contenu).
- **Pas d'i18n** des messages de warning (français, comme le reste du moteur).

## Évolutions possibles (non engagées)

- Élargir les vocabulaires `doc_role`/`resource_type` au fil des besoins (additif).
- Exposer un récap qualité agrégé par corpus (déjà partiellement couvert par
  `/corpus/audit`, cf. familles).

## Références

- Implémentation : `src/multicorpus_engine/metadata.py`.
- Décision : `docs/DECISIONS.md` ADR-010.
- ROADMAP : item **D1** (« Dette doc — cadrages manquants »).
