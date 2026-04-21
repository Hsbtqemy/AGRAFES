# Backlog — Module "Recherche grammaticale"

> **Objectif** : exposer le moteur CQL token-level (`POST /token_query`) dans une interface
> dédiée dans AGRAFES Shell — requête par attributs linguistiques (lemme, POS, traits),
> résultats en KWIC interlinéaire coloré, stats distributionnelles, pivot bilingue.
>
> **Date** : 2026-04-10
>
> **Prérequis accomplis** :
> - `POST /token_query` + moteur CQL + parser (`token_query.py`, `cql_parser.py`) : ✅ complets
> - `POST /export/token_query_csv` : ✅ prêt
> - Vue interlinéaire (rendu token / UPOS / lemme) : ✅ faite dans ActionsScreen (réutilisable)
> - Annotation spaCy + table `tokens` : ✅ opérationnels
> - Shell : 3 modes top-level — `recherche` intégré comme sous-onglet d'Explorer (RFT-1/RFT-2 ✅)
>
> **Ajout 2026-04-20 — feat #39** :
> - Segments adjacents opt-in (`include_context_segments`) : ✅ livré v0.1.31
>   - `prev_segment` / `next_segment` dans chaque hit ; checkbox "contexte seg." dans toolbar
>   - ADR-041 dans `docs/DECISIONS.md`

---

## Dépendances et ordre d'exécution

```
EP-1 (Shell mode + CQL UI)
  └─▶ EP-2 (KWIC interlinéaire)
        └─▶ EP-3 (Stats distributionnelles)   ← backend à créer
        └─▶ EP-4 (Pivot bilingue)             ← logique à écrire
              └─▶ EP-5 (Export)               ← wiring UI seulement
```

---

## EP-1 — Mode `recherche` dans AGRAFES Shell

> Nouveau module Shell, 5e onglet. Entrée CQL + filtres + résultats paginés.

### SP-1.1 — Nouveau mode Shell `recherche`

**Fichiers** : `tauri-shell/src/shell.ts`

- Ajouter `"recherche"` à `type Mode`
- Ajouter le tab dans la barre (`⌘4`, label "Recherche")
- Ajouter `body[data-mode="recherche"]` au CSS de base
- Ajouter la card "Recherche grammaticale" sur l'écran Home
- Lazy-importer `./modules/rechercheModule.ts` dans `_setMode`
- Persister le mode dans `LS_MODE`

**Critères d'acceptation** :
- Tab visible et actif; mode persisté au reload
- Build TS propre
- Pas de régression sur les 4 modes existants

---

### SP-1.2 — Champ CQL avec aide contextuelle

**Fichier** : `tauri-shell/src/modules/rechercheModule.ts` (à créer)

Structure du module :

```
┌─ toolbar ────────────────────────────────────────────────────────┐
│  [Requête CQL _________________________] [Chercher]  [? Aide]   │
│  Filtres : Langue [auto▾]  Documents [tous▾]  □ within sentence │
└──────────────────────────────────────────────────────────────────┘
┌─ résultats ───────────────────────────────────────────┐ ┌─ stats ┐
│  N occurrences — Charger plus                         │ │        │
│  KWIC interlinéaire (EP-2)                            │ │  EP-3  │
└───────────────────────────────────────────────────────┘ └────────┘
```

Champ CQL :
- `<textarea>` mono-ligne extensible, police monospace
- Exemples cliquables en dessous (injectent dans le champ) :
  - `[upos="VERB"]` — tous les verbes
  - `[lemma="être"]` — toutes les formes de "être"
  - `[upos="DET"][upos="NOUN"]` — det + nom
  - `[upos="ADJ"]{1,2}[upos="NOUN"]` — groupe nominal
  - `[upos="VERB"][] [upos="NOUN"] within s` — séquence intraphrase
- Panel d'aide repliable : tableau des attributs (`word`, `lemma`, `upos`, `xpos`, `feats`),
  syntaxe des quantificateurs `{m,n}`, opérateurs `& |`, flag `%c`

Filtres :
- `language` : select vide = tous, sinon liste des langues présentes dans la DB (`GET /documents` → dédupliquer)
- `doc_ids` : multiselect des documents (optionnel — texte de recherche dans la liste)
- `within_sentence` : checkbox (injecte `within s` dans la requête ou paramètre séparé)

**Critères d'acceptation** :
- Soumettre `[upos="VERB"]` retourne des résultats sur le corpus démo Machiavel
- Les exemples cliquables injectent correctement la syntaxe
- Erreur de parsing CQL remontée clairement (message du sidecar)
- Filtres langue / doc_ids transmis dans le payload

---

## EP-2 — KWIC interlinéaire

> Affichage des hits en concordance, chaque occurrence affichant le contexte
> gauche / pivot / droit en vue interlinéaire (mot / UPOS / lemme).

### SP-2.1 — Rendu KWIC interlinéaire

**Fichier** : `tauri-shell/src/modules/rechercheModule.ts`

Structure d'un hit :

```
┌──────────────────────────────────────────────────────────────────────┐
│ Doc: Prince (fr) — §12                                               │
│                                                                      │
│  Sogliono   el    più   ┃ delle  volte ┃  coloro   che   desider…   │
│  PROPN      PROPN ADV   ┃ ADP    NOUN  ┃  PRON     PRON  VERB       │
│                         ┃ di     volta ┃                             │
│  ◄── contexte gauche ──►┃◄─ pivot ─►  ┃◄── contexte droit ────────► │
└──────────────────────────────────────────────────────────────────────┘
```

- Contexte gauche : tokens grisés, interlinéaire discret
- Pivot (le match) : fond coloré doux, UPOS en couleur pleine, lemme visible
- Contexte droit : même traitement que gauche
- Séparateurs visuels `┃` entre les trois zones
- Tokens du pivot cliquables → ouvre le doc dans Explorer (deep link `unit_id`)

Réutiliser la palette UPOS et le rendu cellule déjà écrits dans `ActionsScreen`.

**Critères d'acceptation** :
- Pivot clairement distinct du contexte
- UPOS colorés selon la même palette que l'annotation
- Taille de contexte `window` configurable dans les filtres (5 / 10 / 20 tokens)
- Affichage correct pour les séquences multi-tokens (ex. `[DET][NOUN]`)

---

### SP-2.2 — Pagination load-more

**Fichier** : `tauri-shell/src/modules/rechercheModule.ts`

- Afficher `N occurrences trouvées` (champ `total` de la réponse)
- Bouton "Charger plus" si `has_more = true`
- Spinner pendant le chargement
- Réinitialiser la liste à chaque nouvelle requête (pas d'accumulation inter-requêtes)
- Limite par page : 50 (par défaut), configurable 20 / 50 / 100

**Critères d'acceptation** :
- `total` affiché dès la 1ère page
- "Charger plus" absent si `has_more = false`
- Double-clic "Chercher" ne produit pas de doublons

---

## EP-3 — Stats distributionnelles

> Panneau latéral droit affichant les fréquences calculées sur les hits courants.

### SP-3.1 — Backend `POST /token_stats`

**Fichier** : `src/multicorpus_engine/sidecar.py` + nouveau `token_stats.py`

Payload :

```json
{
  "cql": "[upos=\"VERB\"]",
  "doc_ids": [1, 2],
  "language": "fr",
  "group_by": "lemma",
  "limit": 30
}
```

Réponse :

```json
{
  "total_hits": 847,
  "group_by": "lemma",
  "rows": [
    { "value": "être",   "count": 124, "pct": 14.6 },
    { "value": "avoir",  "count": 98,  "pct": 11.6 },
    …
  ]
}
```

- `group_by` accepte : `lemma`, `upos`, `xpos`, `word`
- Calcul in-process sur les hits (pas de stockage)
- Pas de token d'auth requis (lecture seule)
- Ajouter à l'OpenAPI snapshot + `SIDECAR_API_CONTRACT.md`

**Critères d'acceptation** :
- Test unitaire : corpus mini → fréquences correctes pour `group_by=lemma` et `group_by=upos`
- Contrat OpenAPI mis à jour (`python scripts/export_openapi.py`)
- Endpoint listé dans SIDECAR_API_CONTRACT.md

---

### SP-3.2 — UI stats ✅

**Fichier** : `tauri-shell/src/modules/rechercheModule.ts`

Panneau droit (220 px) :

```
┌─ Distribution ──────────────────┐
│ Grouper par : [Lemme ▾]         │
│                                 │
│ être      ████████ 14.6%  (124) │
│ avoir     ██████   11.6%   (98) │
│ faire     █████     9.2%   (78) │
│ …                               │
│                                 │
│ Distribution UPOS :             │
│ VERB  ██████████ 100%           │
│ (filtré sur pivot uniquement)   │
└─────────────────────────────────┘
```

- Barres proportionnelles en CSS (pas de lib)
- Clic sur une ligne → filtre les résultats KWIC sur cette valeur (client-side)
- Se met à jour automatiquement quand les résultats changent
- Deux blocs : distribution du pivot (lemme/word) + distribution UPOS contexte gauche + droit

**Critères d'acceptation** :
- Barres lisibles, labels tronqués proprement
- Clic filtre = sous-ensemble des hits déjà chargés (pas un nouvel appel réseau)
- "Tout afficher" réinitialise le filtre

---

## EP-4 — Pivot bilingue

> Pour chaque hit, afficher la phrase correspondante dans la langue partenaire
> via la table `alignment_links`.

### SP-4.1 — Enrichissement hits côté backend ✅

**Option A** (préférable) : nouveau paramètre `include_aligned: true` dans `POST /token_query`
— le sidecar joint `alignment_links` + `units` pour ajouter à chaque hit :

```json
"aligned": [
  {
    "doc_id": 2,
    "title": "Le Prince (fr)",
    "language": "fr",
    "unit_id": 145,
    "text_norm": "Ceux qui désirent acquérir…",
    "status": "accepted"
  }
]
```

**Option B** : appel client-side `GET /alignment_links?unit_id=…` pour chaque hit (N+1,
acceptable si liste courte, sinon trop lent).

→ **Implémenter Option A**.

**Fichiers** : `src/multicorpus_engine/token_query.py`, `sidecar.py`

**Critères d'acceptation** :
- `include_aligned=true` retourne les champs `aligned` pour les hits qui ont des liens
- `aligned` vide (`[]`) pour les hits sans lien — pas d'erreur
- Pas de régression sur les appels sans `include_aligned`
- Test : corpus bilingue mini avec liens → aligned non vide

---

### SP-4.2 — UI hit bilingue ✅

**Fichier** : `tauri-shell/src/modules/rechercheModule.ts`

Chaque hit s'étend pour afficher la phrase partenaire :

```
┌──────────────────────────────────────────────────────┐
│ it → Sogliono… delle volte… desiderano…              │
│      PROPN PROPN ADV  ADP NOUN  VERB                 │
│                                                      │
│ fr → Ceux qui désirent acquérir…    [accepté]        │
└──────────────────────────────────────────────────────┘
```

- Langue partenaire affichée avec drapeau/code langue
- Statut du lien (`accepted` / `rejected` / non-révisé) en badge discret
- Toggle "Afficher / Masquer les traductions" global dans la toolbar
- Si plusieurs liens (cas collision) : afficher tous, séparés

**Critères d'acceptation** :
- Phrase partenaire visible sous chaque hit quand toggle actif
- Toggle mémorisé dans localStorage
- Aucun hit sans lien ne plante l'affichage

---

## EP-5 — Export

> Wiring de l'export CSV déjà disponible côté backend.

### SP-5.1 — Bouton "Exporter CSV" ✅

**Fichier** : `tauri-shell/src/modules/rechercheModule.ts`

- Bouton dans la toolbar, actif uniquement si des résultats sont chargés
- Appelle `POST /export/token_query_csv` avec les mêmes paramètres que la dernière requête
- Déclenche le téléchargement via `dialog.save()` Tauri ou fallback blob
- Nom de fichier suggéré : `token_query_YYYY-MM-DD.csv`

**Critères d'acceptation** :
- CSV téléchargé contient les mêmes hits que l'affichage
- Bouton désactivé si aucun résultat
- Pas d'appel réseau si `total = 0`

---

---

## RFT — Refactoring : intégration dans Explorer

> **Décision architecturale (2026-04-10)** : le module "Recherche grammaticale" est intégré
> comme sous-onglet d'**Explorer** plutôt que comme mode Shell de niveau 1.
> Rationnel : Explorer est un outil de corpus autonome ; la recherche grammaticale (CQL)
> est une forme de recherche dans le corpus au même titre que le concordancier (FTS).

### RFT-1 — Supprimer le mode Shell `recherche` (top-level) ✅

**Fichier** : `tauri-shell/src/shell.ts`

- Retirer `"recherche"` de `type Mode`
- Supprimer le tab "Recherche" dans la barre (`⌘3` → libéré; Publier passe en `⌘3`)
- Supprimer `body[data-mode="recherche"]` et les CSS `.shell-card-recherche`
- Supprimer la card "Recherche grammaticale" de l'écran Home
- Supprimer la branche `else if (mode === "recherche")` dans `_setMode`
- Mettre à jour `_loadPersisted`, `_normalizeMode`, `_MODE_TITLES`
- Raccourci clavier : `⌘3` = Publier (précédemment `⌘4`)

**Critères d'acceptation** :
- Build propre, 3 modes top-level (Explorer ⌘1, Constituer ⌘2, Publier ⌘3)
- Pas de régression sur les modes existants

---

### RFT-2 — Sous-onglets "Concordancier" / "Recherche grammaticale" dans Explorer ✅

**Fichier** : `tauri-shell/src/modules/explorerModule.ts`

Structure :

```
Explorer (mode top-level, accent bleu)
  ┌─ sous-onglet-bar ──────────────────────────────┐
  │  [Concordancier ⌘]   [Recherche grammaticale]  │
  └────────────────────────────────────────────────┘
  ┌─ sous-contenu ─────────────────────────────────┐
  │  tauri-app (initApp)   OU   rechercheModule    │
  └────────────────────────────────────────────────┘
```

- Barre de sous-onglets (36 px) : style cohérent avec l'accent Explorer (#1e4a80)
- Sous-onglet actif persisté dans `localStorage("agrafes.explorer.subtab")`
- Montage/démontage propre du sous-module actif (cycle `mount/dispose`)
- Welcome hint préservé pour le Concordancier

**Critères d'acceptation** :
- Passage Concordancier ↔ Recherche sans régression
- Sous-onglet mémorisé au reload
- `dispose()` nettoie le sous-module actif

---

## Ordre d'implémentation recommandé

| Sprint | Stories | Livrable visible |
|--------|---------|-----------------|
| 1 | SP-1.1 + SP-1.2 + SP-2.1 | Onglet Recherche avec CQL et KWIC basique |
| 2 | SP-2.2 + SP-3.1 + SP-3.2 | Pagination + stats distributionnelles |
| 3 | SP-4.1 + SP-4.2 | Pivot bilingue |
| 4 | SP-5.1 | Export CSV |

---

## Ce qui ne nécessite PAS de développement backend

| Fonctionnalité | Raison |
|---------------|--------|
| Champ CQL + exemples | Purement UI |
| Rendu KWIC interlinéaire | Données dans la réponse `token_query` |
| Pagination load-more | `has_more` / `next_offset` déjà dans la réponse |
| Filtre client-side stats | Sous-ensemble des hits chargés |
| Export CSV | Endpoint `/export/token_query_csv` déjà prêt |
| Toggle traductions | Affichage conditionnel du champ `aligned` |

## Ce qui nécessite un développement backend

| Story | Effort estimé |
|-------|--------------|
| SP-3.1 `POST /token_stats` | Moyen — nouveau endpoint, calcul in-process |
| SP-4.1 `include_aligned` dans token_query | Moyen — JOIN supplémentaire dans `_stream_groups` |
