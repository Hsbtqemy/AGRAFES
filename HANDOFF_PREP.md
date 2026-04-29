# AGRAFES Prep — Handoff philosophique et opérationnel

Document compagnon de [HANDOFF_SHELL.md](HANDOFF_SHELL.md) (qui couvre l'orchestration globale). Ici, on parle **du sous-domaine prep** — ce qu'il fait, pourquoi il le fait comme ça, et où il bute. Destiné à comprendre la prep pour l'améliorer, pas à la cartographier.

État au moment de la rédaction : tauri-prep package.json `0.1.28` (interne), Shell qui l'embarque `0.1.40` (post-tag, branche `development` à `fa70312`).

---

## 1. Modèle mental de la prep

### Ce que prep doit faire

Transformer un fichier source (DOCX numéroté, TXT, TEI, CoNLL-U) en **corpus interrogeable** par le concordancier. C'est une **chaîne de raffinage** : import → segmentation → curation → alignement → annotation/métadonnées → export. Chaque étape augmente la qualité et la richesse, sans perdre la traçabilité au source original.

### L'invariant central

**Le `text_norm` final doit être un dérivé déterministe et inspectable du source.** Cela signifie :

1. **Idempotence des transformations** : appliquer un preset deux fois = appliquer une fois. Le pipeline doit converger, pas osciller.
2. **Traçabilité** : à tout moment, on doit pouvoir répondre « quelle règle a produit ce texte ? » (d'où `curate_apply_history`, `rules_matched` dans les reports).
3. **Réversibilité raisonnable** : pas un undo automatique, mais la possibilité de réimporter le source pour repartir propre. La DB n'est jamais un puits sans fond.

### Invariants secondaires (souvent implicites mais fondamentaux)

- **Les NBSP intentionnelles sont sacrées.** La typographie n'est pas du bruit. Un preset qui détruit les NBSP est un bug, pas une feature (cf. fix v0.1.40 du preset `spaces`).
- **`text_raw` = avant curation, `text_norm` = après curation.** En théorie. En pratique l'invariant est violé par la resegmentation (cf. § 4) — ce qui est une dette à reconnaître.
- **Les conventions linguistiques sont langue-aware.** Espace fine insécable en FR, pas en EN. Le moteur sait cela par règles dédiées (presets `punctuation_fr` vs `punctuation_en`), et la détection d'anomalies l'utilise (filtre « ponctuation orpheline » qui inclut `«` `‹` `›` pour DE).
- **Le contrôle reste à l'humain.** L'auto-fix ne décide jamais sans qu'un humain ait regardé. La review locale (accept/ignore/manual override) est ce qui matérialise cette philosophie.

### Tension structurelle reconnue

L'invariant « text_raw immuable » est partiellement violé : la resegmentation **écrase text_raw avec la phrase segmentée**. Donc après resegment, on a perdu l'accès à la version pré-segmentation. C'est un compromis pragmatique (sinon on stockerait deux fois la donnée pour des cas rares), mais ça veut dire :
- Si tu cures un doc, puis tu le resegmente, le texte curé est figé dans `text_raw` du nouveau découpage.
- Le seul vrai moyen de revenir à l'original est de **réimporter depuis le fichier source**.

Cette tension doit être nommée dans toute proposition de refonte.

---

## 2. État de chaque écran

| Écran | LOC | Maturité | Pain points connus | Fréquence usage |
|-------|-----|----------|---------------------|-----------------|
| **ImportScreen** | 1598 | Mature | DOCX en tableaux 2-colonnes non lus (workaround utilisateur). Family dialog v0.1.41 enfin symétrique (parent mode). | Élevée — point d'entrée |
| **SegmentationView** | 2412 | Mature, en évolution | Filtres anomalies récents (segments courts + ponct. orpheline). Pas d'undo merge/split. | Élevée |
| **CurationView** | **3750** | Mature mais **fragile** par taille | Le plus gros écran. Le bug `$1` (v0.1.40), le clipping layout (v0.1.40), le confirm bar mal positionné (v0.1.40) — tous tombés en cascade ce mois-ci. | Élevée |
| **AlignPanel** | 1971 | Mature | Famille review mode rodé. Collisions encore complexes à résoudre pour un débutant. | Moyenne |
| **AnnotationView** | 818 | **Dormant** | Pas de feature work depuis ~3 mois. Annotation lexicale unitaire fonctionne mais limitée. | Faible (utilisée par 0 utilisateur connu ?) |
| **MetadataScreen** | 3106 | Mature | Tous les `confirm()` natifs remplacés par modalConfirm v0.1.41. Bulk update et batch role rodés. | Moyenne |
| **ExportsScreen** | 1723 | Mature, peu touchée | TEI/TMX/CSV/SKE/JSONL stables. QA gate optionnel intégré. | Moyenne (en fin de pipeline) |
| **ActionsScreen** | 917 | Hub/dispatcher post-refactor | A perdu sa logique métier (extraite vers CurationView, SegmentationView, AnnotationView). Reste utile pour reindex FTS. | Faible |

### Le cas CurationView

3750 lignes dans un seul fichier, c'est le candidat refactor le plus évident côté frontend (équivalent du `sidecar.py` côté moteur). Un découpage par responsabilités : `CurationPresets`, `CurationPreview`, `CurationReview`, `CurationExceptions`, `CurationApplyHistory`. Pas urgent mais à faire avant la prochaine grosse feature curation.

---

## 3. Workflows utilisateurs réels

Le workflow nominal (`Import → Segmentation → Curation → Alignement → Export`) est dans le HANDOFF_SHELL. Voici ce qui se passe **réellement** quand un utilisateur travaille :

### Workflow A — Le cas heureux (rare)

1. Import DOCX numéroté en FR → ✓
2. Segmentation auto OK → ✓
3. Curation : applique « Espaces + Ponctuation FR + Apostrophes » → review rapide → apply
4. Métadonnées rapides (auteur, titre)
5. Export TEI

Durée : ~5-10 minutes. Existe surtout pour les docs déjà bien préparés à la main.

### Workflow B — Le cas réaliste (majoritaire)

1. Import DOCX → l'importer rate des contenus en table → 0 line units
2. Segmentation → erreur cryptique « No units found » (avant v0.1.41) ou hint « probable failed import » (depuis v0.1.41)
3. **Boucle de retour** : retour à Import, suppression du doc, préparation manuelle du DOCX (extraction texte, suppression de la table), réimport
4. Segmentation OK → preview phrases vs balises [N] → choix mode
5. Édition merge/split sur quelques segments douteux (filtres anomalies)
6. Curation : applique les presets, **découvre des artefacts dans la preview** (typiquement avant v0.1.40 : `$1` dans le texte) → diagnostique → reimport
7. Re-curation → review locale (accept la majorité, ignore les dialogues internes mal traités, manual override sur 2-3 cas litigieux)
8. Apply curation
9. Métadonnées : remplit auteur/date/œuvre, **propage aux enfants** si famille (auto-assign doc_role)
10. Alignement : run automatique → audit collisions → retarget manuel sur 5-10 cas
11. Réindexation FTS (ou pas, on oublie souvent)
12. Export

Durée : ~30 min à 2h selon la qualité du source. Avec 1 à 3 boucles de retour vers une étape précédente.

### Workflow C — Le cas pathologique (corpus déjà importé qu'on cure pour la 5e fois)

1. Le doc existe en DB, déjà segmenté, déjà partiellement curé
2. On change un preset (ajoute une règle FR plus stricte)
3. Curation preview : ⚠ « 173 modifications affichées sur 173 — preview limitée à 5000 exemples » (avant v0.1.40 c'était limité à 50 silencieusement → l'utilisateur croyait que tout était couvert)
4. Review : 50 acceptées, 5 ignorées
5. Apply → mise à jour des `text_norm` modifiés. `alignment_links.source_changed_at` flagué pour les unités touchées
6. **Discovery oubliée** : les traducteurs liés voient le flag à la prochaine session AlignPanel et doivent acquitter

Durée : 10-15 min. Le piège est qu'on **oublie de communiquer** aux personnes alignées que la source a changé. Le mécanisme `source_changed_at` est en place mais sa visibilité côté UI reste à améliorer.

### Détours et abandons observés

- **Doc avec 0 line units** → 100% d'abandon avant v0.1.41 (le message d'erreur ne pointait nulle part). Depuis v0.1.41 : redirection vers Import, ~70% de récupération espérée.
- **Curation `$1`** → v0.1.40 critical bug, polluait silencieusement `text_norm`. Pré-fix : zéro abandon car invisible. Post-fix : aucune occurrence.
- **Family dialog asymétrique** (avant v0.1.41) → l'utilisateur qui importait l'original APRÈS la traduction ne pouvait pas créer la famille au moment de l'import → devait passer par MetadataScreen. Friction modérée mais non-bloquante.
- **Conventions/rôles d'unités** → la moitié des utilisateurs ne sait pas que ça existe. Visibilité dans Shell tab Conventions, mais pas mis en avant.

---

## 4. Modèle de données détaillé

### Tables actives en prep

```sql
documents        (doc_id, title, language, doc_role, resource_type,
                  source_path, source_hash,           -- traçabilité immuable
                  text_start_n,                       -- frontière paratexte/texte
                  workflow_status,                    -- libre, peu utilisé en pratique
                  validated_at, validated_run_id,     -- workflow validation
                  author_lastname, author_firstname,
                  doc_date, work_title,
                  translator_lastname, translator_firstname,
                  pub_place, publisher,
                  meta_json,                          -- libre
                  created_at)

units            (unit_id, doc_id, unit_type,        -- 'line' ou 'structure'
                  n,                                  -- position globale 1-based
                  external_id,                        -- numéro [N] dans le source
                  text_raw,                           -- voir ci-dessous
                  text_norm,                          -- voir ci-dessous
                  meta_json,                          -- ex. {"sep_count": 2}
                  unit_role)                          -- nom convention ou null

units_fts        FTS5 virtuelle sur text_norm (unicode61 tokenizer)

doc_relations    (id, doc_id, relation_type,         -- 'translation_of' | 'excerpt_of'
                  target_doc_id)

alignment_links  (link_id, run_id,
                  pivot_doc_id, pivot_unit_id,
                  target_doc_id, target_unit_id,
                  status,                             -- 'unreviewed' | 'accepted' | 'rejected'
                  external_id,
                  source_changed_at)                  -- flag de divergence post-curation

curation_exceptions  (unit_id, kind, override_text)  -- 'ignore' ou 'override'
                                                      -- persiste cross-session

unit_role_conventions (name, label, color, icon, description)

curate_apply_history (id, doc_id, applied_at,
                      units_modified, rules_signature) -- log apply, sig = hash

corpus_info      (singleton — title, description, meta_json)
                                                      -- meta_json contient les
                                                      -- presets de projet
```

### Le couple `text_raw` / `text_norm`

C'est **le concept central** de la prep, et l'endroit où les invariants sont les plus subtils :

| Étape | Effet sur `text_raw` | Effet sur `text_norm` |
|-------|----------------------|------------------------|
| Import (numbered_lines, paragraphs, tei...) | = parsed paragraph rich text (peut contenir markers Unicode pour styling) | = `normalize(text_raw)` (NFC, espaces standardisés au minimum, mais NBSP préservés) |
| Resegment | **= sent (la phrase segmentée)** ⚠ | = sent |
| Curate | **inchangé** ✓ | = curated text après application des règles |
| Merge units | concat des deux | concat des deux normalisés |
| Split unit | les deux halves | les deux halves normalisées |
| Manual override (curation exception) | inchangé | = override_text (au moment du apply) |

**Tension** : la resegmentation écrase `text_raw`. Donc :
- Curation puis resegment → la curation est figée dans `text_raw`, on a perdu la version pré-curation.
- C'est ce qui rend la **réimportation depuis le source** la seule réversibilité fiable.

Toute proposition d'amélioration qui suppose « text_raw est l'original immuable » est fausse. C'est l'original **du dernier découpage**, pas du fichier source.

### Stockage des presets de projet

Dans `corpus_info.meta_json` (singleton de la DB). Format approximatif :

```json
{
  "presets": [
    {
      "id": "preset-123",
      "name": "Romans FR — strict",
      "rules": [
        { "pattern": "[ \\t]+([!?;])", "replacement": " $1", "flags": "g", "description": "..." }
      ]
    }
  ],
  "qualifier": "...",
  "tags": ["..."]
}
```

Les presets **built-in** vivent dans le code TS ([CurationView.ts:86-150](tauri-prep/src/screens/CurationView.ts#L86)) et sont compilés au build, jamais persistés. Seuls les presets **custom utilisateur** sont en DB.

C'est ce qui rend [scripts/validate_regex_migration.py](scripts/validate_regex_migration.py) pertinent uniquement pour les DBs où des utilisateurs ont créé des presets custom — sur la DB de référence : 0 patterns custom, donc migration `re`→`regex` PyPI sans risque.

### Exceptions persistantes

`curation_exceptions` stocke des décisions **par unit_id**, pas par règle :

- `kind = 'ignore'` : la curation skippe cette unité, peu importe les règles actives.
- `kind = 'override'` : `text_norm` reçoit `override_text` directement, court-circuite les règles.

**Important** : c'est **par unit, pas par doc**. Si on resegmente, les unit_ids changent (nouvelles lignes en DB), donc les exceptions sont perdues. Pas de migration auto. Conscient.

### `curate_apply_history`

Log de chaque apply réussi : doc_id, timestamp, units_modified, rules_signature (hash des règles appliquées). Sert :
- À l'UI pour afficher « Dernier apply : 173 unités modifiées, 14:32 ».
- À détecter qu'un autre apply a eu lieu entre la preview et l'apply (pas implémenté côté UI mais le hook existe).

Pas utilisé pour l'undo. Pas utilisé pour le rollback. Juste un log informatif.

### Review locale (localStorage, pas DB)

Décisions accept/ignore/manual override avant apply :
- Stockées dans `localStorage` du frontend
- Clé : `agrafes.prep.curate.review.<docId>.<rulesSig>`
- Invalidées par `curationFingerprint` quand le sample d'unités ou les règles changent (`curationFingerprint.ts`)

Avantage : pas de cross-session leakage, l'utilisateur retrouve ses décisions s'il revient.
Limite : un autre utilisateur sur la même DB ne voit pas tes décisions. Délibéré (review = subjective, pas partagée).

---

## 5. Décisions de design héritées

### Idempotence des presets — non-négociable

Validé par discussion explicite en v0.1.40. Tout preset doit converger : appliquer 2× = appliquer 1×. Sinon le pipeline oscille et la curation devient impossible à raisonner.

Conséquence concrète : les classes de matching incluent leurs propres remplacements pour absorber les passages successifs. Exemple : preset FR `«[ \t  ]*` (matche aussi la NNBSP qu'on vient d'insérer) au lieu de `«[ \t ]*` (qui ré-injecterait une NNBSP à chaque pass).

À ne JAMAIS casser. Toute nouvelle règle doit être testée idempotente avant merge.

### NBSP/NNBSP préservés dans le preset `spaces`

L'utilisateur a explicitement protégé les NBSP intentionnelles (« 100 km », « M. Dupont », chevrons français) du preset `spaces`. Décision motivée par un cas réel où le preset détruisait des insécables typographiquement correctes.

Règle : **un preset générique ne touche JAMAIS aux insécables**. Seuls les presets langue-aware (`punctuation_fr`) peuvent en insérer ou en modifier, dans des positions précises.

### Translator JS→Python côté backend (pas côté frontend)

Choix : les presets côté frontend utilisent la syntaxe JS (`$1`, `$&`, `$$`) parce que c'est ce que les développeurs/utilisateurs écrivent naturellement. Le backend Python convertit en `\g<N>` avant `re.sub`.

Alternative refusée : forcer la syntaxe Python côté frontend. Aurait rendu les presets illisibles pour quiconque connaît regex JS.

Limite découverte v0.1.41 : le translator gère le REPLACEMENT, pas le PATTERN. `\p{L}` (JS) n'était pas supporté par stdlib `re`. Migration vers `regex` (PyPI) en v0.1.41 a fermé le trou.

### Review locale, pas serveur

Les décisions accept/ignore/manual override sont en localStorage du frontend, pas dans la DB.

Justification :
- Subjective : un linguiste accepte des choses qu'un éditeur refuserait.
- Volatile : entre deux runs de preset, les sample d'unités changent, donc les décisions devraient s'invalider.
- Cross-user inutile : pas de scénario réel où on veut partager les décisions.

Coût : si l'utilisateur change de machine, perd ses décisions en cours. Acceptable.

### Pas d'undo automatique

Aucune action mutante n'a d'undo intégré. Réversibilité = réimporter depuis le source.

Justification : implémenter un undo serveur cohérent (undo curate, undo apply, undo merge unit, undo split unit, undo retarget align...) est très lourd. Le coût ne se justifie pas tant que la réimport reste praticable.

Limite : plus le corpus avance dans le pipeline (curation + align + annotations + métadonnées), plus la réimport est destructive (perd tout l'aval). À ce stade, c'est une **vraie friction**.

### `doc_role` auto-assigné

Quand l'utilisateur crée une relation `translation_of` ou `excerpt_of`, les `doc_role` des deux docs sont auto-fixés (`original` pour le parent, `translation`/`excerpt` pour l'enfant), sauf si déjà fixés manuellement.

Risque : peut être perçu comme magique si on ne sait pas qu'il existe. Documenté dans le CHANGELOG mais pas en UI.

### Familles via `doc_relations` explicit

Les familles ne sont pas dérivées automatiquement (par radical de filename ou similarité de titre). Elles sont **déclarées explicitement** par l'utilisateur via le family dialog ou MetadataScreen.

Exception : pre-import banner détecte des candidats par radical+suffixe de langue, mais **propose** seulement, ne crée pas la relation sans validation.

Justification : éviter les faux positifs (deux docs avec le même radical mais sans rapport éditorial réel).

---

## 6. Frictions connues, ordonnées par sévérité ressentie

### Tier S — Blocants

1. **DOCX bilingue en tableau 2-colonnes non lu par l'importer** ([docx_numbered_lines.py](src/multicorpus_engine/importers/docx_numbered_lines.py)). 4 fichiers du corpus utilisateur affectés. Décision actuelle : workaround utilisateur (préparer le DOCX en flux unique). Friction réelle si tu as 50 fichiers à traiter.

2. **Réimportation = perte des aval** (segmentation, curation, alignement, annotations, métadonnées). Le seul moyen de revenir à un état propre. Coût croissant avec l'avancement du pipeline. Pas de solution simple — un undo serveur partiel serait possible mais lourd.

### Tier A — Friction quotidienne

3. **Pas de feedback « étape suivante »** entre les écrans. L'utilisateur termine sa curation, puis ne sait pas s'il doit aller à Aligner, à Métadonnées, ou à Reindex FTS. Le workflow nominal n'est pas visualisé en UI.

4. **Reindex FTS oublié**. Après une curation massive, l'index FTS est périmé. Le banner « Mettre à jour l'index » apparaît mais discret. Faudrait un état explicite « index OK / périmé » sur chaque doc.

5. **CurationView 3750 lignes** = friction interne (pour moi) mais aussi pour l'utilisateur car les chargements peuvent être lents quand on bascule sur cet onglet. Pas de virtualization du DOM en place.

6. **Visibilité du flag `source_changed_at`**. Un traducteur qui revient sur AlignPanel après une curation source ne voit pas immédiatement que les unités pivots ont changé. Le mécanisme existe en DB, l'UI le montre dans le panneau audit mais pas en page d'accueil de l'écran.

### Tier B — Annoyances

7. **Conventions/rôles d'unités sous-utilisés**. Beaucoup d'utilisateurs ne savent pas que c'est faisable. Manque d'introduction.

8. **Pas de batch undo / rollback**. Si on apply une mauvaise curation sur 1000 unités, le seul retour en arrière est manual ou réimport.

9. **Modals empilés**. Si une preview curation lance un toast pendant qu'un dialog d'import est ouvert, le z-index peut faire des trucs bizarres. Réglé pour les cas connus (toasts à 9999, dialogs à 9000-9200) mais non systématisé.

10. **Pas d'aide contextuelle** (?) ni de tutoriel intégré. Le menu Diagnostic Shell aide pour le bug-reporting, pas pour l'apprentissage.

### Tier C — Cosmétique / faible impact

11. **AnnotationView dormant** mais toujours dans le menu, peut dérouter.

12. **Filename-based language detection** de l'import a des faux positifs si le filename a des suffixes sémantiques (ex. `_v2`, `_to_review`). Déjà mitigé par whitelist BCP-47 mais imparfait.

13. **Family banner pre-import** parfois propose des regroupements absurdes (ex. tous les docs avec le même radical court). Faux positifs gérés par validation utilisateur, mais pollue.

---

## 7. Backlog prep — vue consolidée

Reconstitué depuis [docs/BACKLOG_PREP_AUDIT.md](docs/BACKLOG_PREP_AUDIT.md), [docs/BACKLOG.md](docs/BACKLOG.md), [docs/BACKLOG_FAMILLES.md](docs/BACKLOG_FAMILLES.md), et la session courante.

### Issues actives (P1-P2)

- **F4 — Index FTS arbitrage** ([BACKLOG.md#F4](docs/BACKLOG.md)) : un seul bouton « Mettre à jour l'index » avec état visible (indexé/à mettre à jour), ou automatisation post-curation. Pas tranché.
- **F5 — Validation regex au boot du sidecar** ([BACKLOG.md#F5](docs/BACKLOG.md)) : invocation passive de `validate_regex_migration.py` au startup, log WARN si pattern flag positif. Défensif, ferme l'angle mort « ma DB ≠ leur DB ».
- **C-1, C-2, C-3 — Tests Vitest** ([BACKLOG_PREP_AUDIT.md](docs/BACKLOG_PREP_AUDIT.md)) : tests unitaires sur fingerprint curation (C-1 fait), import normalisation (C-2 en attente), diff LCS (C-3 en attente).

### Idées non encore en backlog formel

- **Découpage CurationView en sous-modules** (analogue à F1-style refactor) : `CurationPresets`, `CurationPreview`, `CurationReview`, `CurationExceptions`, `CurationApplyHistory`. ~3-5 jours de travail. À faire avant la prochaine grosse feature curation.
- **Workflow visualization** entre écrans : un fil d'Ariane qui montre où on en est dans Import → Segment → Curate → Align → Export, et ce qui reste à faire.
- **Etat « index FTS périmé »** affiché sur chaque doc dans MetadataScreen (chip rouge ou warning).
- **Réversibilité partielle** : permettre de rollback un `curate_apply_history` entry. Faisable techniquement (on a les unités modifiées, on peut restaurer text_norm depuis text_raw + reapply), gain UX significatif.
- **Tutoriel intégré** ou tour guidé au premier lancement.
- **Annotation lexicale richer** (si on décide de réveiller AnnotationView) : lemma, POS, dépendances depuis CoNLL-U import.
- **DOCX-table support** dans `docx_numbered_lines` : itérer `document.tables` cellule par cellule. ~30 lignes d'extension. Décision actuelle : workaround utilisateur, à reconsidérer si pattern récurrent.

### Idées reportées

- Multi-window Tauri pour isolation de pannes JS (Prep crash → Explorer survit) : à mesurer avant d'investir.
- CSS Modules / Shadow DOM : long, pas urgent. Backlog passif.
- AnnotationView deprecation explicite : marquer `@deprecated`, masquer Shell, supprimer en v0.2.0 si zéro plainte.

---

## 8. Ce qui marche bien (à ne pas casser)

### Mécanismes éprouvés

- **Review locale curationFingerprint/curationReview** : l'invalidation par fingerprint des règles est élégante. Tu changes le sample, tes décisions sur l'ancien sample sont oubliées proprement. À garder. Tests Vitest en place.

- **Presets idempotents** : invariant validé en discussion explicite, fix en v0.1.40. Ré-application sans risque. **Garde-fou conceptuel à enseigner aux nouveaux contributeurs** : tout nouveau preset doit être testé idempotent (apply 2× = apply 1×).

- **Family auto-detection au pre-import** : par radical + suffixe de langue. Faux positifs gérés par validation utilisateur. Pratique.

- **Audit QA gate dans Exports** : structure claire (4 catégories : import integrity, métadonnées TEI, alignement %, relations valides), gate status `ok|warning|blocking`. Bon mécanisme.

- **Diff visuel side-by-side de curation** : central à l'expérience review. Bien fait. Le mode Trouver (sans preview) ajouté en v0.1.37 est une bonne extension.

- **Convention roles avec couleur+icône** : badges visuels propres, légère touche éditoriale. Sous-utilisé mais le code est solide.

- **Auto-assign doc_role lors de relation** (v0.1.39) : magie utile à 95%, à condition que l'utilisateur ait conscience du mécanisme.

### Patterns d'architecture à préserver

- **Logique pure dans `lib/`** ([curationFingerprint.ts](tauri-prep/src/lib/curationFingerprint.ts), [diff.ts](tauri-prep/src/lib/diff.ts), [search.ts](tauri-app/src/features/search.ts) côté concordancier) : testables Vitest, pas couplées au DOM ni au sidecar. À étendre quand on extrait des morceaux des grosses vues.

- **Modal helpers** ([modalConfirm.ts](tauri-prep/src/lib/modalConfirm.ts), [inlineConfirm.ts](tauri-prep/src/lib/inlineConfirm.ts)) : remplacent `window.confirm()` non fiable de Tauri 2 ([issue #40](https://github.com/Hsbtqemy/issues/40)). À utiliser systématiquement.

- **CSS namespacing `prep-*`** : empêche fuite vers Shell/App embarqueurs. À maintenir.

- **sidecarClient comme client unique partagé** : prep + app + Shell utilisent la même instance. Lifecycle (spawn, portfile, health, shutdown) centralisé.

### Décisions philosophiques saines

- **Le contrôle reste à l'humain** : auto-fix présenté en preview, jamais appliqué sans accept/ignore/override explicite. Cette posture est ce qui distingue un outil de curation d'un correcteur orthographique.

- **Traçabilité > optimisation** : on stocke `text_raw` + `text_norm` + `curate_apply_history`, on log les `rules_matched`. Coût de stockage modéré, gain en debuggabilité énorme.

- **Réversibilité par réimport, pas par undo** : décision pragmatique. Tant qu'elle reste praticable, ne pas surcomposer le moteur.

---

## Ce qui n'est pas dans ce document

Pour la cartographie structurelle (composants, endpoints, schéma DB exhaustif, build/CI, conventions de release) → [HANDOFF_SHELL.md](HANDOFF_SHELL.md).

Pour les décisions techniques détaillées (ADRs) → [docs/DECISIONS.md](docs/DECISIONS.md).

Pour la procédure release → [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md).

Ce document est volontairement orienté « comprendre la prep pour proposer des transformations sensées ». Si tu y vois quelque chose qui contredit le code actuel, le code gagne et le doc est à corriger.
