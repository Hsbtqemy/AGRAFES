# Revue — Packs « coupes phrases » (B4)

Date: 2026-04-09  
Scope: audit fonctionnel des packs `default`, `fr_strict`, `en_strict`, `auto` sans changement moteur.

## 1) Référentiel audité

- Moteur: [segmenter.py](/Users/hsmy/Dev/AGRAFES/src/multicorpus_engine/segmenter.py)
  - `resolve_segment_pack(pack, lang)`
  - `segment_text(...)`
  - packs stricts:
    - `fr_strict`: `ann`, `chap`, `env`, `etc`, `par`
    - `en_strict`: `approx`, `dept`, `misc`, `chap`
- Fixtures qualité: `bench/fixtures/segmentation_quality_cases.json` (10 cas FR/EN)
- Script benchmark: `scripts/bench_segmentation_quality.py`
- UI Prep (Segmentation): libellés pack dans `ActionsScreen`.

## 2) Résultats benchmark (run 2026-04-09)

Source: script bench relancé localement (`docs/SEGMENTATION_BENCHMARKS.md` régénéré).

| Pack | Exact | Precision | Recall | F1 |
|---|---:|---:|---:|---:|
| auto | 1.000 | 1.000 | 1.000 | 1.000 |
| default | 0.400 | 0.700 | 1.000 | 0.800 |
| fr_strict | 0.700 | 0.850 | 1.000 | 0.900 |
| en_strict | 0.800 | 0.900 | 1.000 | 0.933 |

Lecture:
- `auto` suit bien la langue (`fr* -> fr_strict`, `en* -> en_strict`) et donne le meilleur score global sur ce dataset.
- `default` reste permissif (rappel élevé) mais sur-segmente sur les abréviations.

## 3) Exemples concrets (lisibles utilisateur)

### FR — `chap.` (cas `fr_chap_anchor`)
- Texte: `Voir chap. Introduction. Suite.`
- `default`:
  - `Voir chap.`
  - `Introduction.`
  - `Suite.`
- `fr_strict`:
  - `Voir chap. Introduction.`
  - `Suite.`

### EN — `Approx.` (cas `en_approx_anchor`)
- Texte: `Approx. Values are listed. End.`
- `default`:
  - `Approx.`
  - `Values are listed.`
  - `End.`
- `en_strict`:
  - `Approx. Values are listed.`
  - `End.`

### Décimaux (FR/EN)
- `3.14` / `2.5` restent correctement protégés dans tous les packs (pas de coupe sur le point décimal).

## 4) Cohérence des libellés (Prep vs moteur)

- UI Prep expose des libellés métiers:
  - `Auto (selon la langue)`
  - `Français — liste longue d’abréviations`
  - `Anglais — liste longue d’abréviations`
  - `Liste courte (moins de protections)`
- Le moteur/logs conserve des clés techniques (`segment_pack`: `auto|default|fr_strict|en_strict`).

Conclusion cohérence:
- Comportement cohérent et compréhensible.
- Pas de divergence bloquante entre UI et réponse sidecar.

## 5) Décision B4

- **Pas de changement moteur** à ce stade.
- Les packs actuels sont conservés tels quels.
- La suite reste dans le backlog P2:
  - extension des fixtures (guillemets, parenthèses, ellipses, cas FR/EN mixtes),
  - seuils cibles par langue sur un dataset enrichi.

Décision alignée avec ADR-026 et ADR-029.
