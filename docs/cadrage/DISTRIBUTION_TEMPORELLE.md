# Cadrage — distribution temporelle (`token_stats` `group_by="year"`) — F2

> Statut : **F2a (backend) livré** ; F2b (rendu front dans le concordancier) à suivre.
> Réf. ROADMAP « Analytics Concordancier — distribution temporelle » (F2 phase 2).

## Besoin

Dans le concordancier, voir comment la fréquence d'un motif CQL **varie dans le
temps** (histogramme diachronique par année). Le volet analytics avait déjà le tri
KWIC + la dispersion (phase 1) et les collocations (`/token_collocates`) ; la
distribution temporelle était la dernière brique manquante.

## Décisions figées

- **Source de date** : `documents.doc_date` (migration 010), seul champ de date
  *sémantique* (≠ `created_at`/`validated_at`, horodatages de traitement). C'est du
  **texte libre nullable** : `"2024"` / `"2024-03"` / `"2024-03-15"` / NULL / arbitraire.
- **Bucket = année**, extraite par l'**année à 4 chiffres en tête** (`^\s*(\d{4})`),
  ce que la convention documentée place toujours en préfixe. Tout ce qui ne commence
  pas par 4 chiffres (texte libre, NULL, vide) → bucket **`(sans date)`**. Pas de
  bucket mois/jour : peu fiable sur des dates hétérogènes.
- **Comptage par hit** (une occurrence par *match*, attribuée à l'année du document),
  **pas par token** : un span CQL multi-token ne doit pas gonfler son année. Pour une
  requête mono-token (cas courant) c'est exactement le compte d'occurrences.
- **Les deux métriques** (décision produit) par ligne d'année :
  - `count` — occurrences brutes.
  - `tokens_in_period` — dénominateur = **tous** les tokens du corpus *dans le
    périmètre* (langue/doc_ids) pour cette année. Obtenu **gratuitement** en sommant
    `len(stream_tokens)` par année dans la même passe (pas de requête supplémentaire).
  - `freq_per_10k` — `count / tokens_in_period * 10000`, fréquence relative
    **comparable entre années** (le vrai signal diachronique, que les comptes bruts
    seuls masquent quand la composition du corpus varie).
- **Tri chronologique** (pas par count) ; `(sans date)` en dernier.
- **Lignes émises** : uniquement les années **avec ≥1 hit** (cohérent avec le
  comportement des autres `group_by`). Les années où le corpus existe mais sans
  occurrence (freq=0) ne sont pas listées — leur affichage en « creux » est un choix
  de rendu, laissé à F2b si besoin (le front connaît la plage d'années).
- **`pct`** = part des occurrences sur cette période (`count / total_hits`), homogène
  avec la sémantique « part du total » des autres `group_by`.

## API / contrat

- `POST /token_stats` : `group_by` gagne la valeur **`"year"`** (enum). Inchangé pour
  les attributs token existants.
- `TokenStatsRow` gagne deux champs **additifs nullable** présents **seulement** pour
  `group_by="year"` : `tokens_in_period` (int) et `freq_per_10k` (number).
- `CONTRACT_VERSION` 1.6.30 → **1.6.31** ; `openapi.json` régénéré.

## Hors périmètre (suites possibles)

- **F2b** : rendu graphe/histogramme temporel dans l'UI stats du concordancier.
- Normalisation par million de mots (pmw) ou unité configurable (ici `/10k` fixe).
- Années « creuses » (corpus présent, 0 occurrence) renvoyées explicitement.
- Granularité décennie / siècle.
