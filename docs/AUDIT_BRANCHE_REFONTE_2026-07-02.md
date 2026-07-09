# Audit de branche — `refonte` (R2.2 → R4.2) — 2026-07-02

> **Périmètre.** La branche `refonte` vs `dev` (merge-base `ec208b9` = R2.1) : 29 commits, 47 fichiers,
> **+3 179/−88 lignes** ; PR **#195** ouverte (base `dev`), CI verte au 2026-07-01 16:56 —
> **2 commits en tête non poussés** (`3f12989` note R4.2, `5b4c26d` socle R4.2) + un WIP front R4.2 non commité.
> **Méthode.** 3 relectures parallèles ligne-à-ligne (aligneur R3 · moteur R4 + contrat · front-ends),
> findings majeurs **contre-vérifiés manuellement** ; suites exécutées localement : pytest ciblé
> **92/92** (nouveaux tests moteur) + **72/72** (contrat), vitest **744/744** (prep) + **131/131** (app),
> `ruff check src tests` propre, `export_openapi.py` → **byte-identique** au `docs/openapi.json` commité (v1.6.39, 101 routes).
> Continuité : [`AUDIT_2026-06-28.md`](AUDIT_2026-06-28.md) + [`AUDIT_FOLLOW_UP.md`](AUDIT_FOLLOW_UP.md).

---

## 1. Synthèse exécutive

La branche déroule le plan [`ROADMAP_REFONTE.md`](ROADMAP_REFONTE.md) avec une discipline
remarquable : **chaque tranche est précédée d'une note de design aux décisions figées et
data-backed** (preuves corpus GRAFE/M-GW), et le code suit ces décisions **quasiment à la
lettre** — vérifié point par point sur R2.2, R3.1–R3.3, R4.1 et le socle R4.2. La discipline
de contrat est **irréprochable** (3 routes neuves × 3 artefacts, changelog 1.6.35→1.6.39 exact,
openapi régénéré vérifié byte-identique) et le growth-gate est respecté **par construction**
(toute la logique neuve vit dans des modules purs — `gale_church.py`, `coarse_grain.py`,
`marker_lift.py` — et `services/` ; `sidecar.py` ne gagne que **+77 lignes nettes** d'adaptateurs).

Trois vrais points durs ressortent, tous **confirmés dans le code** :

1. **ALN-01 (haute)** — la DP Gale-Church n'a **aucun garde-fou de taille** : matrices pleines
   O(n·m) appelées sur les documents entiers à l'étage ¶, pendant que le sidecar tient son
   write-lock. Incohérent avec le précédent M-08 (`_MAX_SIMILARITY_UNITS = 5 000`).
2. **ALN-02 (moyenne)** — `(run_id, bead_id)` n'est **pas unique entre cibles** d'un même run
   multi-cibles : l'invariant documenté de la migration 022 est déjà faux, piège armé pour
   l'éditeur de beads (R3.3+).
3. **FE-01 (moyenne)** — au concordancier, le **filtre `unit_status` ne traverse pas les
   facettes/compteurs** (`/query/facets` n'a pas le paramètre) : liste filtrée, totaux non filtrés.

Le reste est du polissage (rollback défensif à l'apply du lift — réintroduction de la classe
SID-03 sur du code neuf —, undo `record_action` non câblé, enum du `.md` de contrat en retard,
trous de tests ciblés). **Rien ne remet en cause l'architecture** ; les trois points durs sont
des correctifs bornés, à traiter avant merge (ALN-01/02) ou juste après (FE-01).

---

## 2. Ce qui est livré (vérifié au code, pas au tracker)

| Phase | Contenu | État réel |
|---|---|---|
| **R2.2** | `coarse_grain.derive_coarse_blocks` (2 régimes : ancré `parent_n` / dérivé), sections classées jamais fusionnées, `¤` composite | ✅ livré ; contrôles front déclarés *sans objet* (voie A) — décision argumentée, saine |
| **R2.3** | `parent_n` exposé sur `GET /units` (contrat 1.6.35) ; regroupement ¶ dans le canvas (lib miroir `coarseGrain.ts` + RolesPane) ; dropdown docs custom | ✅ livré ; **cas blob différé** avec note de design + prérequis honnête (« pas de producteur actuel ») |
| **R3.1** | Post-check `_check_anchor_consistency` dans `qa_report.py` (gate `anchor_drift`, lenient/strict) | ✅ livré |
| **R3.2** | DP pure `gale_church.py` (96 l., priors canoniques 1993) ; aligneur 2 étages `align_by_length_bounded` ; **migration 022 `bead_id`** ; exclusion collision same-bead aux 3 sites ; dispatch CLI + sidecar (contrat 1.6.36) ; option + marqueur de bead au front | ✅ livré, testé sur prose réelle FR→EN |
| **R3.3** | Sélecteur de stratégie partagé paire⇄famille, provenance `explain`, parité marqueur bead vue famille, warnings D4/D7 remontés au run paire | ✅ livré ; **éditeur de beads différé** sur preuve corpus (le besoin réel = escape-hatch paramétrique de l'aligneur, pas l'éditeur) |
| **R4.1** | **Migration 023 `unit_status`** ; `set_status`/`bulk` (service + routes, contrat 1.6.37) ; filtre `query` FTS **et** regex + CLI `--unit-status` (1.6.38) ; filtre concordancier complet (state→query→chips→history→resets) | ✅ livré, conforme aux 8 décisions de la note |
| **R4.2** | `marker_lift.py` (allowlist stricte casefoldée, trailing-only, idempotent, non-clobber, FTS réindexée inline) ; **route `POST /lift/markers`** (contrat 1.6.39, `_WRITE_PATHS`) ; **CLI `lift-markers`** (dry-run défaut + `--apply`) | ✅ moteur livré **au-delà du « socle » annoncé** ; ❌ undo `record_action` non câblé ; 🚧 front (bouton + aperçu RolesPane + `markerLift.ts`) **en WIP non commité** |

Non-livré assumé et documenté : cas blob 2-grains (note + prérequis), éditeur de beads (note +
preuve que le besoin est ailleurs), auto-pont orphelin→statut (couplage refusé), R4.3, R5, R6.

---

## 3. Forces

- **Pipeline design→code exemplaire.** 5 notes de design aux décisions figées *avant* le code,
  chacune ancrée dans le réel (matrice œuvre×cible sur 13 œuvres GRAFE pour le cap ≤2 ; 65
  fichiers dépouillés pour l'allowlist du lift — c'est la longue traîne de gloses `[the biro
  manufacturer]` qui a interdit le regex glouton). Les décisions « négatives » (différer,
  déclarer sans objet) sont argumentées données à l'appui — l'anti-sur-ingénierie est réelle.
- **Discipline contrat parfaite sur les routes.** 3 routes neuves × 3 artefacts, changelog
  exhaustif, `test_contract_docs_sync` couvert, openapi vérifié byte-identique. Le piège
  documenté (« le snapshot ne fait que warn ») est esquivé.
- **Growth-gate respecté par construction** : +77 nettes dans `sidecar.py` pour 3 handlers
  de 15-17 lignes ; modules purs partout ailleurs.
- **Qualité algorithmique.** DP forward correcte et canonique (priors GC 1993, p-value
  bilatérale, plancher anti-`log(0)`, garde double-zéro, déterminisme), architecture 2 étages
  élégante (une seule DP réutilisée aux deux grains), dégradation D7 propre.
- **Tests qui verrouillent les décisions risquées** : gloses/idempotence/casse du lift, les
  **deux** chemins query (FTS + regex), vrai RED-sur-ancien (`bead ≠ collision` dans qa_report),
  miroir TS/Python testé symétriquement, prose réelle en fixture.
- **Conventions front tenues** : échappement systématique des données DB, namespacing `prep-*`/
  `app-*` des classes neuves, zéro dialogue natif, fil R4.1 complet state→history→resets.

## 4. Faiblesses — findings

**Confirmés manuellement** : ALN-01, ALN-02, ALN-05, LFT-02, PRC-*. Les autres proviennent des
relectures avec référence `fichier:ligne` vérifiable.

| ID | Sév. | Finding | Localisation |
|---|---|---|---|
| **ALN-01** | 🔴 | **DP sans borne de taille** : matrices pleines O(n·m) (`cost` + `back`) sur les longueurs de ¶ des docs entiers ; 2×5 000 ¶ ≈ 25 M cellules → gel/OOM **pendant que le sidecar tient le write-lock**. Garde-fou M-08 (`_MAX_SIMILARITY_UNITS=5000`) non répliqué. Correctif : bande diagonale ou cap dur + erreur explicite. | `gale_church.py:70-85`, appel `aligner.py:446-449` |
| **ALN-02** | 🟠 | **`(run_id, bead_id)` non unique inter-cibles** : `bead_counter` repart à 0 par paire (`align_pair_by_length`) alors que `align_by_length_bounded` partage le `run_id` entre cibles. Invariant de la migration 022 (« one bead *within a run_id* ») déjà faux ; les 3 sites de collision actuels sont scellés par paire (sains), mais l'éditeur de beads R3.3 s'appuierait dessus. | `aligner.py:460` vs `:529-548` ; `migrations/022:5` |
| **ALN-03** | 🟡 | `_check_anchor_consistency` compte les liens `status='rejected'` : une dérive signalée puis *rejetée* par l'humain reste bloquante en policy strict, sans échappatoire. | `qa_report.py:216-227` |
| **ALN-04** | 🟡 | Régime ancré avec `parent_n` partiel : une unité sans meta retombe sur son propre `n`, qui vit dans le même domaine que les old-n → absorption silencieuse dans le mauvais ¶ (nécessite insertion post-resegment ; improbable aujourd'hui). | `coarse_grain.py:98` |
| **ALN-05** | 🟡 | **Drift du 3ᵉ artefact de contrat** : l'enum `strategy` du `.md` ne mentionne pas `length_bounded` (openapi + `sidecar_contract.py` à jour ; le test de sync ne compare que les paths → CI aveugle). | `SIDECAR_API_CONTRACT.md:303, :447` |
| ALN-06 | ⚪ | `coverage_pct` >100 % possible (compte des liens, pas des pivots) ; `_doc_is_fine_segmented` en `LIKE '%"parent_n"%'` sans filtre `text_start_n` (doc dont les seuls parents sont en paratexte → grain ligne **sans warning**) ; `text_norm` aliasé dans le champ `text_raw` des tuples de blocs (`¤` jamais vu — sans effet aujourd'hui, piège demain) ; bead amputé sous protection = `bead_id` orphelin non documenté. | `aligner.py:69-73, 392-397, 377-384, 479-487` |
| **LFT-01** | 🟠 | **Apply du lift sans rollback** : une exception mi-boucle (le try/except ne couvre que la FTS) remonte au `except` générique de `do_POST` → 500 sans `rollback()` sur la **connexion partagée** ; le prochain commit d'un autre handler persisterait un lift partiel. Réintroduction de la **classe SID-03** (corrigée le 28/06 pour `documents_service`) sur la plus grosse écriture multi-étapes neuve. | `marker_lift.py:191-228` ; `sidecar.py:1101-1107` |
| **LFT-02** | 🟡 | **Undo non câblé** : le hook `record_action` existe dans la signature de `marker_lift` mais ni le handler sidecar ni le CLI ne le passent (contrairement à `_resegment_recorder`). D5 de la note (« undo prep ») non tenu — le vrai reste-à-faire R4.2 avec le front. | `marker_lift.py:117,126` ; `sidecar.py:5104-5107` |
| LFT-03 | ⚪ | `fts_stale: true` renvoyé alors que la FTS est réindexée inline (un front qui s'y fie réindexera pour rien) ; statut non-string → `AttributeError` → 500 au lieu de 400 (défaut miroir hérité de `set_role`) ; `unit_status` non validé sur `/query` (valeur inconnue → 0 hits silencieux au lieu de 400 ; CLI, lui, valide) ; deux marqueurs du même axe en fin de ligne → le plus à droite gagne, l'autre strippé **sans conflit signalé** (non attesté dans le corpus). | `sidecar.py:5108, 1728` ; `units_service.py:33` ; `marker_lift.py:73-78` |
| **FE-01** | 🟠 | **Facettes/compteurs ignorent `unit_status`** : `_fetchAndApplyFacets` et `_enrichDocCount` n'envoient pas le filtre et `run_query_facets` n'a pas le paramètre → « N résultats / total », top-docs et panneau méta comptent tous les statuts quand le filtre est actif. Fix propre = étendre `/query/facets` (contrat additif). | `query.ts:190-202` ; `metaPanel.ts:508-515` ; `query.py:863-877` |
| FE-02 | 🟡 | **Drift latent du miroir** `coarseGrain.ts` ↔ `coarse_grain.py` : détection du régime ancré par *présence de clé* (Python) vs *valeur non nulle* (TS) — un `"parent_n": null` explicite donnerait ancré/méga-bloc côté Python, dérivé/singletons côté TS (aucun producteur actuel ; le TS est le plus sain). + `STRUCTURAL_ROLES` exporté mutable côté TS. À figer par un test miroir du cas `null` **des deux côtés**. | `coarse_grain.py:81,98` vs `coarseGrain.ts:59,68,21` |
| FE-03 | ⚪ | Mode CQL : chip « Statut » affichée mais requête token non filtrée (étend un pattern hérité rôle/type) ; selects du tiroir non resynchronisés à la restauration d'historique (hérité) ; libellé brut `statut:non_traduit` dans le panneau historique vs libellé humain dans la chips bar ; `TextCanvasView` sans `dispose()` (listener `document` survit au démontage, auto-réparé au clic suivant) ; doc disparu → bandeau « aucun doc » mais RolesPane affiche l'ancien. | `sidecarClient.ts:153-163` ; `history.ts:154,166-215` ; `TextCanvasView.ts:207,136-138` |

### Trous de tests ciblés

- Les **2 sites sidecar** de l'exclusion same-bead (`sidecar.py:3349`, `:8036-8038`) ne sont
  testés nulle part (le fix `ce4d7e1` n'est prouvé que via `qa_report`).
- Aucun test de matérialisation **2-1 / 2-2** (l'appariement positionnel « répéter le dernier du
  côté court » n'est verrouillé par rien) ; warning **D4** non testé ; pas de test
  `text_start_n`×`length_bounded` ; pas de smoke de taille (aurait révélé ALN-01).
- Lift : réinsertion FTS du texte nettoyé non testée ; conflit `unit_status` non testé (seulement
  `unit_role`) ; unités `structure` non testées (décision §7.3 non verrouillée).
- Front : pas de round-trip historique avec `unitStatus` ; cas `parent_n:null` du miroir non testé.

## 5. Risques (au-delà des findings)

1. **Perf en usage réel** (ALN-01) : le premier `length_bounded` sur un couple de romans peut
   figer le shell (write-lock) — c'est le seul finding susceptible d'un incident visible.
2. **Fondations de R3.3+** (ALN-02) : construire l'éditeur de beads sur un identifiant non
   unique produirait des fusions/scissions fantômes. À corriger *avant* d'ouvrir ce chantier.
3. **Coût récurrent des miroirs dupliqués** : `coarseGrain.ts` ↔ `coarse_grain.py` (drift déjà
   mesurable, FE-02) et `markerLift.ts` (labels) ↔ allowlist Python. Choix assumé (lib pure
   testée des deux côtés) mais chaque évolution devra toucher 2 codebases + 2 suites.
4. **Process** : les 2 commits de tête ne sont pas poussés (CI non passée sur R4.2 — *mitigé* :
   contrat, tests et lint vérifiés localement dans cet audit) ; le WIP front R4.2 traîne dans le
   working tree avec un fichier de test référencé mais inexistant (`lib/__tests__/markerLift.test.ts`) ;
   **2 .docx de corpus non suivis dans `docs/`** (matériau tiers — à déplacer hors repo ou gitignorer
   avant un `git add -A` malheureux) ; `Cargo.toml` shell modifié (fins de ligne uniquement).
5. **Gouvernance growth-gate** : le gate est **informatif** depuis A-01 (OPS-01, choix documenté)
   alors que `CLAUDE.md` le décrit encore comme bloquant ; fenêtre 90 j à ~+2 884 nettes (seuil
   500). La branche est vertueuse (+77) mais le filet, lui, ne retient plus rien.
6. **Dérive documentaire** (classe D-01, mineure ici) : `ROADMAP_REFONTE.md` §R4.2 dit encore
   « 🟢 décisions figées / à coder » alors que moteur+route+CLI sont commités — un commit de sync
   en retard, cohérent avec l'habitude du repo.

## 6. Recommandations

**Avant merge de la PR #195 (P0)**
1. **ALN-01** : cap dur (à la M-08) *ou* bande diagonale sur `gale_church_beads` — quelques lignes,
   testables par un smoke de taille.
2. **ALN-02** : rendre `bead_id` unique par run (compteur partagé entre paires, ou scoper la clé
   par `(run_id, target_doc_id)` et le documenter dans 022).
3. **ALN-05** : compléter l'enum `strategy` aux 2 lignes du `.md` (2 min, classe de drift connue).
4. Pousser la branche → CI sur R4.2 ; ranger les 2 `.docx` hors de `docs/`.

**Avec la fin de R4.2 (P1)**
5. **LFT-01** : `conn.rollback()` défensif autour de l'apply ; **LFT-02** : câbler `record_action`
   (le front WIP affiche déjà « idempotente » — l'undo est l'autre moitié de la promesse D5).
6. **FE-01** : param `unit_status` sur `/query/facets` (contrat additif) — sinon le filtre R4.1
   ment sur les totaux.
7. LFT-03 : 400 sur statut non-string et sur `unit_status` inconnu au `/query` ; clarifier `fts_stale`.

**Fond de sac (P2)**
8. Tests : sites sidecar same-bead, 2-1/2-2, warning D4, miroir `parent_n:null` (2 côtés),
   round-trip historique `unitStatus`, réinsertion FTS post-lift.
9. **ALN-03** : exclure `rejected` du check d'ancre ; ALN-04/06 : commentaires/garde-fous.
10. Sync `ROADMAP_REFONTE.md` (R4.2 socle livré) ; corriger la description du growth-gate dans
    `CLAUDE.md` (il est informatif) ; décider d'une date de re-durcissement.

---

## 7. Addendum — vérification des correctifs (2026-07-02 soir, branche à `5b9fb47`)

15 commits depuis l'audit ; **tous les findings P0/P1 sont traités et vérifiés dans le diff** :

| Finding | Commit | Verdict |
| --- | --- | --- |
| ALN-01 | `9d7e82c` | ✅ Cap dur `_MAX_LENGTHS=5000` + `ValueError` explicite (parité M-08) + tests oversized/boundary. **Résiduel** : cap *par dimension* — le pire cas autorisé (5 000×5 000 = 25 M cellules) reste lourd ; un cap sur le produit n·m serait plus fidèle à l'intention. Non bloquant (docs réels ≈ 1-3 k ¶). |
| ALN-02 | `9d7e82c` | ✅ Compteur threadé entre paires (`bead_start` → `report.sentence_bead_count`, hors `to_dict()` — wire inchangé) ; invariant 022 vrai run-wide ; test multi-cibles `isdisjoint`, RED-sur-ancien prouvé. |
| ALN-05 | `9d7e82c` | ✅ Enum `strategy` complétée aux 2 sites du `.md`. |
| LFT-01 | `4e38e0e` | ✅ Apply entier sous try/except → `rollback()` + raise ; test « record_action qui lève → unité restaurée ». |
| LFT-03 | `4e38e0e` | ✅ 400 sur statut non-string (garde de type `_norm_status`) ; enum `unit_status` validé sur `/query` ; `fts_stale=false`. |
| LFT-02 | `b691fc0` | ✅ **Différé, décision documentée et fondée** : le CHECK de `prep_action_history` (migration 019) n'admet pas de type « marker_lift » — l'undo du lift = migration + `undo.py` + contrat + front, mini-feature dédiée. Note de design §D5 mise à jour. |
| FE-01 | `74106fc` | ✅ Bout en bout : `run_query_facets(unit_status)` + validation enum sidecar + **contrat 1.6.41** (additif, openapi régénéré) + les 2 appelants front + test « total 3 → 1 filtré ». |
| FE-02 | `dfa73ed` | ✅ Miroir aligné **value-based des deux côtés** (Python rejoint TS) + tests `parent_n:null` des deux côtés. |
| ALN-03 | `1f49676` | ✅ `WHERE al.status IS NULL OR al.status <> 'rejected'` + tests. |
| ALN-04/06 + CLAUDE.md | `1f49676` | ✅ Quick wins + description du growth-gate corrigée (informatif). |
| Tests P2 | `abd9261` | ✅ 2-1/2-2 verrouillés, warning D4 testé, conflit `unit_status` du lift testé. |

**Validation rejouée** : pytest moteur+contrat **182/182**, `ruff` propre, `export_openapi` →
**byte-identique** (v1.6.41, 101 routes), vitest **763/763** (prep) + **140/140** (app) ; branche
poussée, CI en cours (8 checks verts, 2 jobs pytest pending au moment de la vérification).

**Restes** : les 2 `.docx` de corpus toujours non suivis dans `docs/` (reco P0-4b) ; `Cargo.toml`
shell modifié (fins de ligne). **Nouvelle surface non auditée** : 8 commits de features livrés en
parallèle des fixes — R4.2 pas 2 (front lift), **R4.3** (badges rôle/statut, contrat 1.6.40),
**R5.1a-d** (couche Curation au canvas, ~1,5 k lignes). Smell-test conventions OK (`modalConfirm`,
DOM via `elt()`, labels via allowlist `STATUS_MODIFIER` — jamais de classe CSS dérivée d'une valeur
DB) mais **pas de relecture profonde** équivalente à celle de R2-R4.

*Audit réalisé le 2026-07-02 (branche à `5b4c26d`), correctifs vérifiés le soir même (branche à
`5b9fb47`) — 3 relectures parallèles + contre-vérification manuelle des findings majeurs + exécution
locale des suites (pytest ciblé, vitest, ruff, export openapi).*
