# Backlog — Rollback partiel d'un apply de curation

> Initiative issue de [HANDOFF_PREP.md § 7](../HANDOFF_PREP.md) « Réversibilité partielle ».
> Objectif : permettre d'annuler une entrée `curate_apply_history` donnée et restaurer
> les `text_norm` à leur état pré-apply, quand c'est encore cohérent.
>
> **Pourquoi maintenant** : la friction Tier S #2 (« réimport = perte de l'aval ») est la
> plus coûteuse de la prep, et techniquement la moitié du chemin est déjà faite — la table
> `curation_apply_history` existe et l'apply est centralisé côté backend. Il manque les
> snapshots et le chemin retour.

---

## État de départ (constaté dans le code, 2026-04-30)

- **Mutation réelle** : `multicorpus_engine.curation.curate_document` /
  `curate_all_documents`, appelés par `_handle_curate` ([sidecar.py:3478](../src/multicorpus_engine/sidecar.py)).
  C'est le seul point où `text_norm` change pour cause de curation.
- **Historique** : table `curation_apply_history` stocke uniquement des **compteurs**
  (`units_modified` est un `int`, pas une liste). Endpoint
  `/curate/apply-history/record` ([sidecar.py:2769](../src/multicorpus_engine/sidecar.py))
  est appelé **par le frontend** après l'apply, sans corrélation forte avec le `curate`
  qui vient d'avoir lieu.
- **Aucun snapshot** de `text_norm` n'est conservé nulle part.
- **Conséquence** : aucune des entrées d'historique existantes n'est réversible.
  Toute migration ajoutant des snapshots sera **forward-only** (entrées antérieures
  marquées `not-rollback-able`).

---

## Décisions de cadrage à figer avant de coder

À trancher en Phase 0 (cf. R0.2). Provisionnel :

1. **Périmètre rollback** : annulation possible **uniquement de l'apply le plus récent
   d'un doc** dans le scope V1. Cascade (annuler un apply ancien en réappliquant les
   suivants) → V2 si demande réelle.
2. **Structurel-rupture = blocage** : si depuis l'apply il y a eu resegment / merge /
   split / réimport sur le doc → rollback refusé (les `unit_id` du snapshot ne pointent
   plus vers les mêmes phrases).
3. **Manual override post-apply** : un `curation_exceptions.kind='override'` ajouté
   *après* l'apply doit gagner sur le rollback. Cas explicite à traiter, pas implicite.
4. **`alignment_links.source_changed_at`** : un rollback est un nouveau changement de
   source du point de vue des traducteurs liés → on **reflague** plutôt que d'effacer.
5. **FTS** : rollback = `fts_stale = true`, comme un apply normal. Banner standard.
6. **Trace du rollback** : enregistrer le rollback comme une nouvelle entrée
   `curation_apply_history` avec `kind='rollback'` (champ à ajouter), pointant vers
   l'apply annulé. Pas d'effacement de ligne.

---

## Phase 0 — Cadrage et décisions (½ jour)

### R0.1 — Audit ciblé du chemin apply ✏

**Objectif** : confirmer en lisant `multicorpus_engine.curation` que toute mutation de
`text_norm` pour cause de curation passe bien par `curate_document` / `curate_all_documents`,
et identifier exactement où insérer le snapshot avant écriture.

**Acceptance** :
- [ ] Une note dans le ticket R0.2 listant le ou les `UPDATE units SET text_norm` du
      module et leur point d'appel.
- [ ] Confirmation qu'aucun autre endpoint ne mute `text_norm` au nom d'une règle de
      curation (sinon ils doivent eux aussi snapshotter, ou être exclus du scope).

### R0.2 — ADR : politique de rollback de curation ✏

**Objectif** : figer les 6 décisions ci-dessus dans [docs/DECISIONS.md](DECISIONS.md).

**Acceptance** :
- [ ] Section ADR ajoutée, chaque décision a une justification d'1-2 lignes.
- [ ] Mention explicite du périmètre V1 (latest-only) et de la posture forward-only
      pour les entrées historiques.

---

## Phase 1 — Backend : snapshots à l'apply (1-1,5 jour)

### R1.1 — Migration `curation_apply_unit_snapshots` ✏

**Objectif** : nouvelle table de snapshots par unité, liée à un apply.

```sql
CREATE TABLE curation_apply_unit_snapshots (
  apply_id        INTEGER NOT NULL,
  unit_id         INTEGER NOT NULL,
  text_norm_before TEXT NOT NULL,
  text_norm_after  TEXT NOT NULL,
  PRIMARY KEY (apply_id, unit_id),
  FOREIGN KEY (apply_id) REFERENCES curation_apply_history(id) ON DELETE CASCADE
);
CREATE INDEX idx_curate_snap_unit ON curation_apply_unit_snapshots(unit_id);
```

Ajouter aussi à `curation_apply_history` :
- `kind TEXT NOT NULL DEFAULT 'apply'` — `'apply' | 'rollback'`
- `rolled_back_apply_id INTEGER NULL` — pointe vers l'apply annulé quand `kind='rollback'`
- `rollback_state TEXT NULL` — `'active' | 'reverted'` sur les apply qui ont été annulés

**Acceptance** :
- [ ] Migration ajoutée + idempotente (création conditionnelle).
- [ ] Les entrées existantes restent valides (`kind` défaut = `'apply'`,
      `rolled_back_apply_id` NULL).
- [ ] Pytest dédié migration up/no-op replay.

### R1.2 — Capture des snapshots dans le chemin apply ✏

**Objectif** : `curate_document` / `curate_all_documents` doivent retourner ou exposer
les triplets `(unit_id, text_norm_before, text_norm_after)` pour les unités effectivement
modifiées, et `_handle_curate` doit les persister **dans la même transaction** que
l'écriture des `text_norm`.

**Tension à résoudre** : aujourd'hui c'est le frontend qui crée l'entrée
`curation_apply_history` après coup. Trois options, à trancher :

- **A**. Backend crée l'entrée `curation_apply_history` *et* les snapshots dans la même
  transaction que l'apply, retourne `apply_id`. Frontend ne fait plus que consommer.
  → Plus propre, casse le contrat actuel `/curate` (ajoute champ retour) et rend
  `/curate/apply-history/record` redondant pour les apply produits par `/curate`.
- **B**. Backend ne fait que les snapshots (sans `apply_id` puisqu'il n'existe pas
  encore), frontend fait `/curate/apply-history/record`, puis backend doit faire un
  second appel pour rattacher les snapshots à l'`apply_id`. → Two-phase, fragile.
- **C**. Frontend appelle d'abord `/curate/apply-history/record` (avec compteurs
  estimés depuis le preview), reçoit `apply_id`, puis appelle `/curate` qui prend
  `apply_id` en paramètre. → Inverse le flux mais préserve les contrats. Risque
  d'incohérence si `/curate` échoue après l'enregistrement de l'entrée.

**Recommandation** : **option A**. C'est l'occasion de remettre le centre de gravité
côté backend, où il aurait dû être. Le contrat `/curate/apply-history/record` reste
disponible pour les apply hors-`/curate` (manual overrides batch ?) si nécessaire.

**Acceptance** :
- [ ] `_handle_curate` ouvre une transaction, applique, écrit les snapshots, écrit
      l'entrée `curation_apply_history`, commit. Tout dans le même `with self._lock()`.
- [ ] Réponse `/curate` enrichie d'un champ `apply_id` (et `apply_history_entry`
      complète, pour éviter un round-trip frontend).
- [ ] Frontend mis à jour : si `apply_id` présent dans la réponse, ne pas réappeler
      `/curate/apply-history/record`.
- [ ] Le `curate/apply-history/record` legacy reste accepté pour rétro-compat.
- [ ] Pytest : un apply de N règles sur M unités produit M snapshots avec before≠after.

### R1.3 — Endpoint `/curate/rollback-eligibility` ✏

**Objectif** : le frontend doit pouvoir interroger « cette entrée est-elle annulable ?
sinon pourquoi pas ? » sans tenter le rollback.

**Body** : `{ apply_id }`. **Réponse** :
```json
{
  "eligible": false,
  "reason": "structural_change",
  "details": "Doc resegmenté le 2026-04-28T10:12:33Z (X unit_ids absents du snapshot)"
}
```

**Reasons** (au minimum) :
- `not_latest` — un apply plus récent existe sur le doc
- `no_snapshots` — entrée antérieure à la migration R1.1
- `structural_change` — unit_ids du snapshot absents de `units` (resegment/merge/split)
- `text_norm_diverged` — pour ≥ 1 unité, `text_norm` actuel ≠ `text_norm_after`
  snapshoté (qqn a touché le texte hors curation)
- `already_reverted` — `rollback_state = 'reverted'`
- `is_rollback_entry` — on n'annule pas une annulation depuis cet endpoint
- `eligible` — annulation possible

**Acceptance** :
- [ ] Endpoint pur lecture, pas de mutation.
- [ ] Pytest couvrant chaque `reason` avec un fixture minimal.

### R1.4 — Endpoint `/curate/rollback` ✏

**Objectif** : exécuter le rollback dans une transaction.

**Body** : `{ apply_id }`. Refait en interne la check d'éligibilité (R1.3) — pas de
fenêtre TOCTOU.

**Effets** :
1. `UPDATE units SET text_norm = text_norm_before WHERE unit_id IN (snapshot.unit_ids)`
2. `UPDATE curation_apply_history SET rollback_state = 'reverted' WHERE id = apply_id`
3. `INSERT INTO curation_apply_history (kind='rollback', rolled_back_apply_id=apply_id, …)`
4. Pour chaque unit_id concerné, `UPDATE alignment_links SET source_changed_at = now()`
   pour les liens où l'unité est `pivot_unit_id` ou `target_unit_id`.
5. Renvoyer `{ rollback_apply_id, units_restored, alignments_reflagged, fts_stale: true }`.

**Acceptance** :
- [ ] Transaction unique : tout ou rien.
- [ ] `curation_exceptions.kind='override'` créées **après** `apply_id` ne sont **pas**
      écrasées (cf. décision §3) — l'`UPDATE` les exclut via WHERE clause sur
      `unit_id NOT IN (overrides post-apply)`.
- [ ] Pytest end-to-end : apply → rollback → text_norm == état initial pré-apply.
- [ ] Pytest : rollback refuse si `eligible=false` (test pour chaque reason).

---

## Phase 2 — Frontend : module pur + UI (1 jour)

### R2.1 — Module pur `curationRollback.ts` ✏

**Objectif** : suivre le pattern `lib/curation*.ts` (cf. § 2 HANDOFF_PREP). Fonctions
pures, testées Vitest, pas de DOM ni de fetch.

**Surface** :
- `formatRollbackReason(reason: RollbackReason, details?: string): string` —
  message FR pour tooltip / banner.
- `summarizeRollbackImpact(eligibility, history): { unitsToRestore, alignmentsImpacted, willReflag }` —
  pour le confirm modal.

**Acceptance** :
- [ ] Header `Invariants protégés` comme les autres modules.
- [ ] Tests Vitest numérotés par invariant (~10 tests visés).

### R2.2 — Bouton « Annuler ce apply » dans le panneau historique ✏

**Localisation** : panneau apply-history dans CurationView (déjà rendu via
`curationApplyHistory` module).

**Comportement** :
- Bouton par ligne, désactivé si `eligible=false`, tooltip avec
  `formatRollbackReason`.
- Au clic : appelle `/curate/rollback-eligibility` (refresh juste avant), affiche
  modal de confirmation via `modalConfirm` ([tauri-prep/src/lib/modalConfirm.ts](../tauri-prep/src/lib/modalConfirm.ts))
  avec le summary R2.1.
- Sur confirm : `/curate/rollback`, toast succès, refresh historique + flag FTS-stale.

**Acceptance** :
- [ ] Aucun `window.confirm()` (cf. HANDOFF_PREP § 8 patterns à préserver).
- [ ] Pas de spinner global qui bloque l'écran > 200ms — opération courte attendue.
- [ ] Banner FTS-stale réapparaît si nécessaire.

### R2.3 — Indicateur visuel sur entrées annulées ✏

**Objectif** : une entrée `curation_apply_history` dont `rollback_state='reverted'`
doit être visuellement distinguable (barré ou badge gris « Annulé »), et l'entrée
de type `kind='rollback'` doit elle-même apparaître avec un style propre et
mentionner l'apply qu'elle annule.

**Acceptance** :
- [ ] CSS dans `prep-*` namespace.
- [ ] Test visuel manuel documenté dans le PR.

---

## Phase 3 — Documentation et release (½ jour)

### R3.1 — Mettre à jour HANDOFF_PREP § 5 ✏

**Objectif** : nuancer la décision « Pas d'undo automatique » (§5 ligne 281). Le
rollback partiel d'un apply existe désormais ; les autres mutations (merge/split/
resegment/retarget) restent sans undo.

**Acceptance** :
- [ ] Paragraphe ajouté avec lien vers cet ADR (R0.2).
- [ ] Section « Frictions Tier S #2 » (§6) annotée — la friction est *réduite* mais
      pas éliminée (réimport reste nécessaire si rupture structurelle).

### R3.2 — HANDOFF_SHELL : nouveaux endpoints ✏

**Acceptance** :
- [ ] `/curate/rollback-eligibility` et `/curate/rollback` listés dans la surface API.
- [ ] Snapshot `openapi_paths.json` régénéré.
- [ ] `docs/SIDECAR_API_CONTRACT.md` mis à jour.

### R3.3 — CHANGELOG + release notes ✏

**Acceptance** :
- [ ] Entrée CHANGELOG sous le prochain tag.
- [ ] Note explicite : forward-only (les apply antérieurs ne sont pas annulables).

---

## Out of scope V1 (à reverser dans le backlog général si demande réelle)

- Rollback en cascade d'un apply ancien (réappliquer les suivants après).
- Rollback de mutations non-curation (merge/split/resegment/retarget).
- Bulk rollback de plusieurs apply simultanés.
- Conservation des reviews localStorage à travers le rollback (la `rules_signature`
  change de toute façon — les décisions seront naturellement réinvalidées).
- Undo du rollback lui-même (méta-rollback).

---

## Estimation totale

~3 à 4 jours dev focalisé. Phase 0 : ½j · Phase 1 : 1,5-2j · Phase 2 : 1j · Phase 3 : ½j.

Ordre de mérite si on doit s'arrêter en route :
- Après Phase 1 : le backend est prêt, les snapshots se construisent. Aucune UX visible
  mais la dette zero-snapshots est purgée pour les nouvelles applies.
- Après Phase 2 : feature complète et utilisable, doc à rattraper.
- Phase 3 est non négociable avant tag.
