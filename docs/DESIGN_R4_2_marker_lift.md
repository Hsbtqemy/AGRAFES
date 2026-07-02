# Note de design — R4.2 : lift des marqueurs inline → rôle / statut

> Statut : **décisions figées — prête-à-ticket** (2026-07-02). Table de correspondance figée (data-backed) ; mécanisme idempotent/non-clobber tranché avec l'humain (déclencheur = marqueur encore dans `text_norm`).
> Phase R4.2 de [`ROADMAP_REFONTE.md`](ROADMAP_REFONTE.md) §R4 · implémente le **T2** de [`DESIGN_peritext_conventions.md`](DESIGN_peritext_conventions.md) §3/§8.
> Dépend de **R4.1** (axe `unit_status` livré) + `unit_role` (014). C'est la passe qui **peuple** l'axe posé par R4.1 → rend le filtre concordancier démontrable sur les corpus réels.

## 0. Périmètre

**R4.2 = une passe post-import idempotente** qui transforme les marqueurs inline (`[T]`, `[Ch]`, `[InterT]`, `[non traduit]`, `[+]`…) en **`unit_role`** (type péritextuel) + **`unit_status`** (traduction), **retire les marqueurs de `text_norm`** (recherche propre) et les **garde dans `text_raw`** (affichage verbatim). Moteur pur `marker_lift.py` (hors `sidecar.py`) + route `POST /lift/markers` (dry-run + apply) + front (bouton + aperçu).

**Hors R4.2** : l'affichage du rôle/statut au concordancier = **R4.3** ; l'écriture manuelle du statut (UI de curation) ; le lift *à l'import* (on fait une passe dédiée, cf. D6).

## 1. Le problème

Les corpus livrés encodent le péritexte et le statut de traduction **en texte inline** — `[T]`, `[Ch]`, `[InterT]` en fin de ligne, `[non traduit]`/`[+]` comme placeholder. Aujourd'hui ces marqueurs :
- **polluent la FTS** : le tokenizer `unicode61` ([002_fts5_index.sql](../migrations/002_fts5_index.sql)) indexe `[non traduit]` comme `non`+`traduit` → bruit de recherche ;
- **sont opaques** : pas de filtre « chapeaux non traduits » (rôle+statut), l'info est prisonnière du texte.

R4.1 a posé les **axes** (`unit_role`, `unit_status`) ; R4.2 les **remplit** depuis les marqueurs et **nettoie** le texte.

## 2. État réel (ce sur quoi on branche)

- **Les marqueurs survivent à l'import, dans `text_raw`/`text_norm`.** Le mode numéroté consomme `[N]` comme `external_id` ([txt.py:30](../src/multicorpus_engine/importers/txt.py#L30)) mais **laisse le reste** — donc `text_raw = "David Goldblatt… [T]"`. Le lift opère sur `text_raw`.
- **`unit_role`** ([014](../migrations/014_unit_role_field.sql), FK `unit_roles(name)`) + **`unit_status`** ([023](../migrations/023_unit_status.sql), enum R4.1). Deux axes orthogonaux — le lift écrit les deux.
- **Rôles seedés : seulement `intertitre`.** Les importers auto-créent `intertitre` (category `structure`, [docx_paragraphs.py:142](../src/multicorpus_engine/importers/docx_paragraphs.py#L142) / [txt.py:187](../src/multicorpus_engine/importers/txt.py#L187)). **`titre`/`chapeau` n'existent pas** → le lift doit les créer (`INSERT OR IGNORE`, comme les importers).
- **`text_start_n`** ([segmenter.py:22](../src/multicorpus_engine/segmenter.py#L22)) sépare paratexte / corps (titre & chapô en deçà, protégés de la segmentation).
- **`marker_lift.py` est greenfield** ; `resegment_document_markers` (segmenter) ne gère que `[N]` (orthogonal).
- **FTS à réindexer** après lift (text_norm change) — pattern best-effort per-unité comme `update_unit_text` ([units_service.py:198](../src/multicorpus_engine/services/units_service.py#L198)).

## 3. Le modèle — allowlist, fin de ligne, strip `text_norm`, idempotent

Le lift **n'agit que sur une unité `line` dont le `text_norm` contient encore un marqueur de l'allowlist** (= pas encore liftée). Pour une telle unité :
1. repérer les marqueurs **de l'allowlist** (D1) en **fin de ligne** (répétés : `… [non traduit] [Ch]`) et le cas **placeholder** (la ligne entière = marqueurs) ;
2. appliquer chacun à son axe → `unit_role` (dernier rôle vu) / `unit_status` ;
3. recalculer `text_norm` = texte **sans** les marqueurs liftés (placeholder pur → `""`) ; `text_raw` **inchangé** ;
4. réindexer la FTS de l'unité.

**Idempotent ET non-destructif du manuel (D4)** : une fois liftée, l'unité a un `text_norm` **nettoyé** (sans marqueur) → un re-run la **saute**. Chaque unité est donc traitée **une seule fois** ; re-jouer ne change rien, et une correction manuelle de rôle/statut faite après coup n'est **jamais** réécrite.

## 4. Décisions (reco par défaut)

- **D1 — Allowlist fixe, jamais un `\[…\]` glouton (LE point, forcé par le réel).** Le corpus contient une **longue traîne de gloses éditoriales entre crochets *au milieu* du texte** (`[the biro manufacturer]`, `[la ville du péché…]`, `[benefits]`…) : un regex `\[[^\]]+\]` (celui esquissé dans la note péritexte §3) les **corromprait**. Le lift matche **uniquement** un ensemble allowlisté, et seulement en **position de marqueur** (fin de ligne / placeholder). **Reco : allowlist stricte.**
  Table figée (data-backed) :
  | Marqueur (insensible à la casse) | Axe | Valeur |
  |---|---|---|
  | `[T]` | `unit_role` | `titre` |
  | `[Ch]` | `unit_role` | `chapeau` |
  | `[InterT]` | `unit_role` | `intertitre` |
  | `[non traduit]` / `[Non traduit]` | `unit_status` | `non_traduit` |
  | `[+]` | `unit_status` | `ajout` |
  `[P]`/`[S]` (note péritexte) : **réservés, mapping non figé** — 0 occurrence dans ce corpus, on ne devine pas de rôle (même discipline que l'escape-hatch 1-3 : caler sur du réel). `[]` (11×) et toute glose hors-allowlist : **ignorés**.
- **D2 — Casse insensible pour le statut.** `[Non traduit]` (40×) ≠ `[non traduit]` (167×) en octets → matcher en *casefold*. Les rôles (`[T]`/`[Ch]`/`[InterT]`) aussi, par cohérence. **Reco : match insensible à la casse.**
- **D3 — `text_norm` nettoyé, `text_raw` verbatim.** Strip des marqueurs liftés de `text_norm` ; placeholder pur → `text_norm=""` (sort de la FTS). `text_raw` jamais modifié (ADR-043 : l'original reste révélable). **Reco : oui.**
- **D4 — Idempotence + préservation du manuel, via le déclencheur « marqueur encore dans `text_norm` ».** ✅ *tranché avec l'humain (2026-07-02)*. Le lift n'agit que sur une unité **pas encore nettoyée** (son `text_norm` porte encore un marqueur) ; une unité déjà liftée est **sautée** au re-run. Donc : traité **une seule fois**, **idempotent**, et **jamais** de réécriture d'un rôle/statut corrigé à la main (« la main humaine gagne » par construction — meilleur que le « seulement si NULL » envisagé, sans sa fragilité). **Limite documentée** : ré-éditer un marqueur dans `text_raw` *après* lift n'est pas repris (text_norm déjà propre) → nécessiterait un « re-lift (forcer) », hors MVP. **Figé.**
- **D5 — Dry-run par défaut + apply + undo.** `POST /lift/markers` avec **`dry_run=true` par défaut** : rapporte le diff (n unités, rôles/statuts posés, strips) **sans écrire**, et **signale explicitement** tout conflit (une unité dont le rôle/statut manuel existant diffère de ce que dicterait le marqueur). `dry_run=false` applique. Undo via le **snapshot prep existant** (callback `record_action`, comme `resegment_document`, cf. [`feedback_undo_snapshot_design`]). **Figé : aperçu-d'abord + avertissement de conflit + undo prep.**
- **D6 — Passe dédiée post-import, pas à l'import.** Les corpus déjà importés (M-GW…) doivent pouvoir être liftés a posteriori ; l'idempotence rend le re-run sûr. Logique en `marker_lift.py` (pur, hors `sidecar.py` — growth-gate), handler mince. **Reco : passe dédiée + route.**
- **D7 — Rôles auto-créés.** Le lift fait `INSERT OR IGNORE` sur `titre`/`chapeau`/`intertitre` (category `structure`) avant d'assigner — `intertitre` déjà seedé, `titre`/`chapeau` neufs. **Reco : oui, category `structure`.**
- **D8 — `text_start_n` : différé.** Poser la borne paratexte/corps à partir des rôles titre/chapô est utile mais séparable ; R4.2 core = marqueurs→(rôle,statut)+nettoyage. **Reco : hors R4.2, à réévaluer avec R4.3.**
- **D9 — Contrat : une route neuve** `POST /lift/markers` (dry_run/apply) → 3 artefacts. **Migration : aucune** (`unit_role`/`unit_status` existent). **Reco : route additive.**
- **D10 — WORKCOPY / destructif.** Le lift réécrit `text_norm` (pas `text_raw`) + rôle/statut ; idempotent + re-dérivable → moins risqué qu'une resegmentation. Undo prep. Essais sur copie. **Reco : discipline resegmentation.**

## 5. Implications contrat / migration / risque

- **Migration : aucune.** Réutilise `unit_role` (014) + `unit_status` (023).
- **Contrat : additif** — 1 route neuve `POST /lift/markers` → `sidecar_contract.py` + `openapi.json` + **snapshot** + **`.md`** (`test_contract_docs_sync`). `_write_paths` gagne la route (apply mute).
- **Growth-gate** : tout dans `marker_lift.py` (+ éventuel `services/`), handler adaptateur mince.
- **Front** : bouton « Lifter les marqueurs » + aperçu du diff (Prep) — réutilise le pattern job/preview existant.
- **Risque principal** : la corruption de gloses éditoriales — **neutralisé par D1 (allowlist)**. Secondaire : la réindexation FTS (best-effort, comme update_text).

## 6. Preuve corpus (2026-07-02) — 65 fichiers .txt (M-GW + GRAFE FrEn)

Marqueurs non-numériques, par fréquence : **`[non traduit]` 167 + `[Non traduit]` 40** · **`[InterT]` 163** · **`[+]` 121** · **`[Ch]` 47** · **`[T]` 45** · `[]` 11 (bruit) · puis une **traîne de gloses** (`[the biro manufacturer]`, `[la ville du péché…]`, `[benefits]`, `[du 29 novembre]`… 1-2× chacune).

Enseignements → décisions : (a) l'allowlist **D1** (les gloses interdisent le regex glouton) ; (b) la casse **D2** (`[Non traduit]` vs `[non traduit]`) ; (c) `[P]`/`[S]` **absents** → réservés, non devinés. Le corpus est **un parmi de nombreux à venir** — l'allowlist reste **extensible** (ajouter un marqueur = éditer la table `marker_lift`, pas de migration).

## 7. Questions — tranchées (2026-07-02)

1. **D4 — réécriture au re-run : ✅ résolu autrement.** Ni « écrase » ni « seulement si NULL » : le lift **ne re-touche pas** une unité déjà nettoyée (déclencheur = marqueur encore dans `text_norm`) → la main humaine gagne par construction (cf. D4).
2. **D5 — `dry_run` par défaut : ✅ `true`** (aperçu-d'abord). Un appelant qui veut appliquer passe `dry_run=false` explicitement.
3. **D8 — `text_start_n` : ✅ différé** (hors R4.2 ; à réévaluer avec R4.3).
4. **Portée : ✅ par document** (comme segment/align).

**→ La note est prête-à-ticket** : allowlist figée, mécanisme idempotent/non-clobber tranché, contrat/portée cadrés.
