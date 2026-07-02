# Note de design — R4.3 : le concordancier affiche rôle + statut

> Statut : **implémenté** (moteur + front, 2026-07-02) — cf. [`ROADMAP_REFONTE.md`](ROADMAP_REFONTE.md) §R4.3. Forks tranchés avec l'humain : labels **sans catalogue** ; portée **pivot + unités alignées**.
> Phase R4.3 de [`ROADMAP_REFONTE.md`](ROADMAP_REFONTE.md) §R4 · rend **visible** l'axe posé par [R4.1](DESIGN_R4_1_unit_status.md) et peuplé par [R4.2](DESIGN_R4_2_marker_lift.md).
> Dépend de R4.1 (`unit_status`) + `unit_role` (014). Aucune migration.

## 0. Périmètre

R4.3 = **afficher** `unit_role` (péritexte : titre/chapeau/intertitre) et `unit_status` (traduction : non_traduit/ajout) **sur les résultats du concordancier** (`tauri-app`), en modes `segment` **et** `kwic`, sur le **hit pivot** et sur les **unités alignées**. Badges affichés **seulement si non-null**.

**Hors R4.3** : `token_query` (CQL, chemin distinct) ; l'écriture du statut au concordancier (lecture seule) ; le catalogue de rôles côté concordancier (cf. D2).

## 1. Le problème — et la correction du roadmap

Le roadmap classait R4.3 en **[FRONT] contrat inchangé**. **Faux, vérifié au code** :

- Le hit `/query` (modes `segment`/`kwic`, chemins FTS **et** regex, via `_build_hits_core`) renvoie `doc_id, unit_id, external_id, language, title, text/left/match/right, text_norm` — **jamais** `unit_role`/`unit_status` ([query.py:643](../src/multicorpus_engine/query.py#L643), [query.py:787](../src/multicorpus_engine/query.py#L787), [query.py:427](../src/multicorpus_engine/query.py#L427)). Idem `_fetch_aligned_units` ([query.py:264](../src/multicorpus_engine/query.py#L264)).
- Donc R4.3 exige un **changement moteur** (petit mais réel) → **[MIXTE léger]**, pas [FRONT].

**Mais** la forme du hit est **volontairement opaque** au contrat : `QueryResponse.hits = {"type":"array","items":{"type":"object"}}` ([sidecar_contract.py:2497](../src/multicorpus_engine/sidecar_contract.py#L2497)). Ajouter deux clés au dict est **rétro-compatible et déjà permis** → **la contract-freeze ne se déclenche pas** sur la forme.

## 2. État réel (ce sur quoi on branche)

- **Moteur.** `run_query` délègue à `run_query_page` ; les deux chemins (FTS `run_query_page`, regex `_run_regex_page`) construisent les hits via `_build_hits_core` (un dict `segment`, un dict `kwic`). Les unités alignées passent par `_fetch_aligned_units` = **4 sites SQL** (forward + siblings en `UNION ALL`) + 2 dicts résultat.
- **Front.** `QueryHit` ([sidecar_client](../tauri-app/src/lib/sidecarClient.ts)) n'a ni `unit_role` ni `unit_status`. Deux renderers : `renderHit` (simple) + `renderParallelHit` (colonnes alignées) — tous deux avec une ligne `.result-meta` (titre · langue · §id · ⓘ). `AlignedUnit` n'a pas les champs non plus.
- **Le concordancier ignore le catalogue de rôles** (0 usage de conventions) — il reçoit `unit_role` comme slug brut.

## 3. Décisions

- **D1 — Surface d'affichage.** Badges dans la ligne `.result-meta` de `renderHit` **et** `renderParallelHit` (pivot), après `§external_id`, avant le ⓘ. Sur les unités alignées : badge de statut/rôle sur la ligne alignée. **Figé.**
- **D2 — Labels sans catalogue.** ✅ *tranché avec l'humain.* Le concordancier reste **découplé du catalogue** (pas de `GET /conventions`, pas de cache, pas d'ambiguïté fédérée multi-DB). Rôle : label humanisé fixe (`titre→Titre`, `chapeau→Chapeau`, `intertitre→Intertitre` ; slug inconnu → brut). Statut : `non_traduit→« non traduit »`, `ajout→« ajout »`. Deux styles de badge fixes (rôle vs statut). **Figé.** *Limite documentée : un rôle custom créé en Prep s'affiche en slug — acceptable ; l'affichage fidèle (couleur/icône) serait une évolution D2-bis (fetch catalogue).*
- **D3 — Moteur additif.** Ajouter `u.unit_role, u.unit_status` aux 2 SELECT de page + aux 2 dicts de `_build_hits_core` ; et aux 4 sites SQL + 2 dicts de `_fetch_aligned_units`. Aucun nouveau endpoint/param. **Figé.**
- **D4 — Portée : pivot + unités alignées.** ✅ *tranché avec l'humain.* Motif : repérer un **trou de traduction en face** (un aligné `non traduit`). Exige l'extension `_fetch_aligned_units` + `AlignedUnit` + le rendu aligné des deux renderers. **Figé.**
- **D5 — Contrat.** Forme du hit **inchangée** (reste opaque) → **bump `CONTRACT_VERSION` 1.6.39 → 1.6.40 + note de changelog** (« query hits gagnent `unit_role`/`unit_status`, R4.3 »), régénérer `openapi.json` (chaîne de version). Snapshot paths inchangé. **Traçabilité sans figer la forme du hit.** **Figé.**
- **D6 — token_query différé.** Chemin CQL distinct ; hors R4.3, évolution possible. **Figé.**

## 4. Implications contrat / migration / risque

- **Migration : aucune.** Réutilise `unit_role` (014) + `unit_status` (023).
- **Contrat : version-only** (forme de hit opaque inchangée) → bump 1.6.40 + regen `openapi.json`. Pas de route neuve, `_write_paths` inchangé.
- **Front :** helpers purs (maps label) testés à part ; badges rendus dans les 2 renderers ; CSS `app-*` namespacé.
- **Risque :** faible. Principal piège = **oublier un des 6 sites moteur** (2 SELECT + `_build_hits_core` ×2 + `_fetch_aligned_units` ×4 SQL) → test moteur qui vérifie role/status sur pivot **et** aligné, FTS **et** regex.

## 5. Plan (2 pas)

1. **Moteur + contrat** : les 6 sites SQL/dict + contrat 1.6.40 + regen + tests moteur (pivot & aligné portent role/status ; FTS & regex).
2. **Front** : `QueryHit`/`AlignedUnit` + helpers purs (label maps) + rendu badges (pivot + aligné, `renderHit` + `renderParallelHit`) + CSS + tests vitest.
