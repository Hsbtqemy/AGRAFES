# Mission : R5.4a — `SegmentSpec` (segmentation configurable, greffe moteur)

Tu interviens sur le repo AGRAFES (branche `refonte`).

**Lis d'abord** la note de design figée
[docs/DESIGN_R5_4_segmentation_layer.md](DESIGN_R5_4_segmentation_layer.md) (surtout §2 modèle,
§4 différé, §5 esquisse moteur). Cette mission = **la greffe moteur uniquement** (R5.4a). Le
front (`SegmentPane`) est R5.4b, **hors périmètre**.

# Contexte

Le découpage de segmentation est aujourd'hui **codé en dur** : une règle phrase unique
`_SPLIT_RE` ([segmenter.py:51](../src/multicorpus_engine/segmenter.py#L51)) + une liste
d'abréviations par « pack » (`_PACK_EXTRA_ABBREVIATIONS`,
[segmenter.py:54](../src/multicorpus_engine/segmenter.py#L54)), et un chemin marqueurs `[N]`
séparé. **Recadrage vérifié** : la « langue » ne pilote presque rien (règle unique ; la langue
ne bascule qu'entre 3 mini-jeux d'abréviations `default`/`fr_strict`/`en_strict` via
`resolve_segment_pack`, [segmenter.py:79](../src/multicorpus_engine/segmenter.py#L79)). Pour un
outil d'analyse, le bon modèle = **« définis ta segmentation »**.

**Objectif R5.4a** : généraliser le découpage en un **`SegmentSpec`** (frontière = *terminateur
en flux* ou *motif de ligne* ou *marqueurs `[N]`*), passé aux fonctions moteur et aux endpoints
`/segment(/preview)` en **paramètre additif**, avec des **préréglages built-in**. **Le
comportement actuel doit rester byte-identique** quand aucun `spec` n'est fourni (ou quand le
préréglage « Phrases » / « Balises » est utilisé).

Deux chemins moteur existent aujourd'hui, à **unifier** derrière le spec :
- `resegment_document(conn, doc_id, lang, pack, …)` (phrases) → appelle `segment_text`
  ([segmenter.py:103](../src/multicorpus_engine/segmenter.py#L103), :545).
- `resegment_document_markers(conn, doc_id, …)` (marqueurs `[N]`, external_id)
  ([segmenter.py:259](../src/multicorpus_engine/segmenter.py#L259)).

Endpoints : `POST /segment` (job/direct), `POST /segment/preview` (en mémoire,
[sidecar.py:968](../src/multicorpus_engine/sidecar.py#L968)) — déjà `{doc_id, mode?, lang?,
pack?, limit?, calibrate_to?}`.

# Périmètre

Fichiers **modifiés** :
- `src/multicorpus_engine/segmenter.py` — `SegmentSpec` + registre de préréglages + unification
  des deux chemins de resegmentation + `segment_text` accepte un spec.
- `src/multicorpus_engine/sidecar.py` — les handlers `/segment` et `/segment/preview` acceptent
  un `spec`/`preset` **additif** (handlers fins ; **toute la logique reste dans `segmenter.py`**,
  growth-gate).
- `src/multicorpus_engine/sidecar_contract.py` + `docs/openapi.json` +
  `tests/snapshots/openapi_paths.json` + `docs/SIDECAR_API_CONTRACT.md` — **contrat = 3 artefacts
  + snapshot** (params additifs).
- `tests/` — équivalence des préréglages + nouveaux modes + **preuve RED-sur-ancien**.

**Interdit** : frontend (`tauri-*`, R5.4b) ; **migration DB** (tout en `meta_json`) ; toucher au
**structure matcher** (`/segment/structure_*`, `SegStructureMatcherPanel`) ; toucher au grain
**grossier**/`parent_n` au-delà de ce que fait déjà la resegmentation (les Tours = R5.4c) ;
nouvelle dépendance runtime.

# Décisions de design (figées)

1. **`SegmentSpec`** (dataclass gelée, dans `segmenter.py`), `kind ∈ {terminator, pattern, markers}` :
   - `terminator` : `terminators: str` = **ensemble cumulable** de caractères de coupe (défaut
     `.!?` ; on peut ajouter `;` `:` `,` `…` etc. → coupe après *n'importe lequel*).
     `require_uppercase_after: bool` — exige une majuscule après le séparateur (rend `.!?` robuste
     contre `M.`/`3.14`/`etc.`) ; **à désactiver** dès qu'on ajoute des séparateurs de *proposition*
     (`;:`, presque toujours suivis d'une **minuscule**) ou de *mot* (espace), sinon ils ne coupent
     jamais. `protect_abbreviations: tuple[str, ...]`. Coupe *après* le motif. Cas « Mots » = `\s+`,
     `require_uppercase_after=False`, `protect=()`. *(Raffinement différé, hors R5.4a : une règle de
     suite **par séparateur** — `.!?` exigent la majuscule, `;:` non — ; le toggle global suffit ici.)*
   - `pattern` : `boundary_pattern: str` (regex, ancrée début de ligne). Coupe *avant* une ligne
     qui matche. Cas « Vers » = saut de ligne.
   - `markers` : le chemin `[N]` existant (sémantique **external_id** = numéro du marqueur).
2. **Registre de préréglages built-in** (constantes code) : au minimum **`phrases`**, **`mots`**,
   **`vers`**, **`balises`**. `resolve_preset(name, lang)` → `SegmentSpec` ; **`phrases` doit
   reproduire l'actuel** (terminateur `.!?` + majuscule + abréviations issues de
   `resolve_segment_pack(pack, lang)`). *(Tours = préréglage `pattern` de grain grossier → R5.4c,
   PAS ici.)*
3. **Unifier les deux resegmentations** derrière une étape « découper le texte d'une unité » :
   `split_unit_text(text, spec) -> list[tuple[int | None, str]]` (external_id `None` sauf pour
   `markers`). Le *scaffold* commun (borne `text_start_n`, effacement de l'alignement, écriture
   des unités + `parent_n`, FTS) est factorisé et **inchangé**. `resegment_document(…, lang, pack)`
   et `resegment_document_markers(…)` deviennent des **wrappers** construisant le spec `phrases` /
   `balises` → **sortie byte-identique** (c'est le cœur du test RED-sur-ancien).
4. **Endpoints additifs** : `/segment` et `/segment/preview` acceptent un **`spec`** (objet
   `SegmentSpec` JSON) **ou** `preset` (nom + overrides optionnels). Si absent → **chemin actuel
   `mode/lang/pack` inchangé** (mappé en interne : `sentences`+lang+pack → `phrases` ;
   `markers` → `balises`). Anciens clients non affectés.
5. **Persistance = `meta_json`, zéro migration** : à la resegmentation, enregistrer le spec
   **résolu** dans le `meta_json` du doc (clé `segment_spec`) pour repro + défaut UI (R5.4b lira).
   *(Emplacement : si `documents` n'a pas de colonne `meta_json`, écrire dans
   `corpus_info.meta_json` keyé par `doc_id`, comme `active_models` — vérifier au code et choisir
   le plus cohérent, le noter.)* **Pas** de préréglages nommés custom ici (→ R5.4b/corpus_info).
6. **Destructif inchangé** : la resegmentation efface toujours l'alignement (ADR-017). Le
   **garde-fou conditionnel** (confirm seulement si alignement) et l'absence de WORKCOPY imposée
   sont **côté front (R5.4b)** — cette mission ne change pas le comportement moteur destructif.

# Livrables

## L1 — `SegmentSpec` + registre (segmenter.py)
Dataclass gelée + `resolve_preset(name, lang)` + `_BUILTIN_PRESETS` (`phrases/mots/vers/balises`).
`phrases` réutilise `resolve_segment_pack` pour les abréviations (back-compat).

## L2 — Unification du découpage
`split_unit_text(text, spec)` couvrant les 3 `kind` (terminator réutilise la mécanique actuelle
de `segment_text` : protéger abréviations → split → restaurer ; markers réutilise le split `[N]`
existant ; pattern = split ligne). `segment_text(text, lang=…, pack=…)` conservé en **wrapper**
(spec `phrases`). Factoriser le scaffold commun des deux `resegment_document*` et les transformer
en wrappers.

## L3 — Endpoints additifs
`/segment` et `/segment/preview` : parser `spec`/`preset` optionnel, le passer au moteur ;
sinon chemin `mode/lang/pack` inchangé. Handlers **fins** (logique en `segmenter.py`).
`/segment/preview` renvoie toujours `segments` + `warnings` (+ `mode`/`segment_pack` cohérents ;
pour un spec custom, un libellé de spec).

## L4 — Contrat (3 artefacts + snapshot)
`sidecar_contract.py` : ajouter le param `spec`/`preset` (objet ; **schéma écrit à la main** si
imbriqué — cf. précédent ShareDocs D5) aux 2 routes, **bump de version** (ligne d'historique).
Régénérer `python scripts/export_openapi.py` → commit `docs/openapi.json` **+**
`tests/snapshots/openapi_paths.json` **+** documenter dans `docs/SIDECAR_API_CONTRACT.md`. (Aucun
*path* nouveau → le snapshot ne change pas de clés ; seule la version bouge — vérifier que
`test_contract_docs_sync` passe.)

## L5 — Tests (dont RED-sur-ancien)
- **Équivalence back-compat (le test central)** : `resegment_document` (phrases) et
  `resegment_document_markers` produisent un résultat **identique** avant/après refactor sur des
  cas fr/en/décimaux/abréviations/`[N]`. **Prouver que le test échoue sur l'ancien code** en
  restaurant l'ancien `segmenter.py` (`git checkout dev -- …`) uniquement pour la fonction unifiée
  n'a pas de sens ici → à la place : figer des **golden outputs** (listes de segments) et vérifier
  qu'ils sont inchangés (byte-identiques) après refactor.
- **Nouveaux modes + accumulation de séparateurs** : `mots` (espaces), `vers` (lignes) ;
  terminateurs cumulés — les **3 cas canoniques** de l'interaction : (1) `.!?` + majuscule exigée
  = comportement actuel ; (2) `.!?;:` + `require_uppercase_after=False` → **coupe** bien sur `;`/`:` ;
  (3) le **même** `.!?;:` **avec** majuscule exigée → ne coupe **pas** sur `;`/`:` (prouve que le
  toggle gouverne l'accumulation).
- **Endpoints** : `/segment/preview` avec `preset=mots` → segments attendus ; sans `spec` →
  identique à aujourd'hui ; `markers` inchangé.
- **Persistance** : après resegmentation, `meta_json.segment_spec` contient le spec résolu.

## L6 — Doc
`CHANGELOG.md` `[Unreleased]/Added` ; cocher R5.4a dans
[docs/DESIGN_R5_4_segmentation_layer.md](DESIGN_R5_4_segmentation_layer.md) §6.

# Conventions du repo

- Commits : `feat(engine): SegmentSpec — segmentation configurable (terminateur/motif/marqueurs)`,
  `feat(engine): /segment(/preview) accept spec/preset (additif)`,
  `docs(engine): contrat + openapi pour SegmentSpec`, `test(engine): équivalence préréglages + nouveaux modes`.
- **Pas de migration DB.** Bump de version via `sidecar_contract.py` (ligne d'historique) — **pas**
  d'édition manuelle de numéro ailleurs.
- **CI à rejouer avant commit** : `python -m ruff check src tests` (les DEUX) + `python -m pytest`
  ciblé (`-k segment or contract`) ; **ne pas** lancer toute la suite `tests/` (les
  `test_sidecar_*` figent en local — laisser la CI).

# Ordre d'exécution
1. Lire `segmenter.py` (les 2 `resegment_document*`, `segment_text`, `_MARKER_SPLIT_RE`) +
   `_handle_segment_preview` + le chemin `/segment` (job/direct). 2. Figer des **golden outputs**
   de l'ancien comportement (L5) — le filet. 3. L1 `SegmentSpec`+presets. 4. L2 unification +
   wrappers. 5. Vérifier golden = inchangé. 6. L3 endpoints additifs. 7. L4 contrat+openapi+snapshot.
   8. L5 tests restants. 9. L6 doc.

# Ce qu'il NE FAUT PAS faire
- Pas de front, pas de migration, pas de nouvelle dépendance.
- **Ne pas casser le back-compat** : sans `spec`, tout doit être identique (golden).
- **Logique hors `sidecar.py`** (growth-gate) — handlers fins.
- Pas de Tours/grossier (R5.4c), pas de structure matcher, pas de préréglages custom nommés.
- Pas de garde-fou WORKCOPY / confirm (c'est du front R5.4b).

# Si tu butes
- Si factoriser le scaffold commun des deux `resegment_document*` est trop intriqué, garde deux
  fonctions mais fais-les **toutes deux** passer par `split_unit_text(text, spec)` pour l'étape de
  découpe (l'essentiel du gain), et `// NOTE:` le reste.
- Si `documents` n'a pas de `meta_json`, écris le `segment_spec` dans `corpus_info.meta_json` keyé
  par `doc_id` (comme `active_models`) et note-le — **jamais** de migration pour ça.
- Si le schéma `spec` imbriqué est lourd côté générateur de contrat, écris le schéma **à la main**
  (précédent ShareDocs D5), `additionalProperties` au choix.

# Livrable attendu
3-4 commits + résumé : préréglages livrés, **preuve que le golden back-compat est inchangé**,
version de contrat, `// NOTE:` éventuels, et l'état exact laissé pour **R5.4b** (front `SegmentPane`
qui consommera `spec`/`preset` + lira `meta_json.segment_spec`).
