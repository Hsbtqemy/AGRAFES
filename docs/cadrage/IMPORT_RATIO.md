# Ratio de divergence traduction↔source — Cadrage C6

Last updated: 2026-06-23

## Objectif C6

Figer le **contrôle de ratio** appliqué entre une traduction et son original, et sa
**calibration** — clôt le point **D2** du ROADMAP (« seuil de ratio d'import »).

> ⚠️ **Correction d'une dérive du ROADMAP.** D2 affirmait « ni logique ni doc ».
> Vérification au code : la **logique existe** (avertissement quand le nombre de
> segments/unités d'une traduction diverge de son pivot au-delà d'un seuil) ; seule la
> **doc** manquait — et le seuil était un **magic number `0.15` dupliqué en 7 endroits**.
> Ce cadrage documente l'existant, le centralise, et acte la calibration.

## Concept (acté)

Le ratio mesure la **divergence du nombre de segments/unités** entre un document et sa
**référence** (le pivot/original d'une famille) :

```
ratio = abs(count − ref_count) / ref_count
```

C'est un **contrôle traduction↔source**, **pas** un contrôle au moment de l'**import
brut** : un fichier importé seul n'a aucune référence à laquelle se comparer. Le ratio
n'a de sens qu'une fois la relation `translation_of`/le pivot connus (famille,
calibration de segmentation, alignement).

**Décision** : pas de garde « ratio » à l'import d'un fichier isolé. Le contrôle vit aux
points où une référence existe (ci-dessous). Le terme historique « ratio d'import » est
donc requalifié en **ratio de divergence traduction↔source**.

## Seuil (figé, calibré)

- **Seuil : 15 %** (`SEGMENT_RATIO_WARN_THRESHOLD = 0.15`).
- **Advisory, jamais bloquant** : produit un *warning* dans le rapport, n'interrompt
  jamais la segmentation / l'alignement / l'audit.
- **Rationale de calibration** : valeur pragmatique livrée et éprouvée — un écart de
  segmentation < 15 % entre une traduction et son original est courant (différences
  de ponctuation, phrases fusionnées/scindées) et ne justifie pas d'alerte ; au-delà,
  un problème de segmentation ou d'appariement est probable. Une **re-calibration
  empirique** (sur corpus réels, par paire de langues) est une étude séparée, hors
  périmètre de ce cadrage — le seuil est désormais **centralisé** pour la rendre triviale.

## Source unique (centralisation)

Le seuil était codé en dur (`> 0.15`) dans **7 emplacements** de `sidecar.py`. Tous
remplacés par la constante module **`SEGMENT_RATIO_WARN_THRESHOLD`** (source unique) :

1. Propagation de structure — section « pré-intertitre ».
2. Propagation de structure — section nommée.
3. Segmentation calibrée (`calibrate_to`) — deux chemins.
4. Audit familles (`/corpus/audit` → `ratio_warnings`).
5. Job d'import avec `calibrate_to`.
6. Segmentation de famille (`_add_ratio_warning`).

Changer le défaut = **une ligne**.

## Configurabilité de l'audit (clarification)

L'audit familles expose un **seuil réglable côté UI** (input `#audit-ratio-input`,
15 % par défaut). Ce réglage **filtre l'affichage** côté client ; le moteur, lui, émet
les `ratio_warnings` au seuil canonique `SEGMENT_RATIO_WARN_THRESHOLD`. Les deux ne sont
**pas** fusionnés (l'UI garde sa liberté de filtrage) ; le défaut UI doit rester aligné
sur la constante moteur.

## Non-objectifs (hors périmètre C6)

- **Pas de garde bloquante** : le ratio reste un avertissement.
- **Pas de garde à l'import brut** (rien à comparer pour un fichier isolé).
- **Pas de re-calibration empirique** ici (étude séparée ; le seuil est centralisé pour
  la faciliter).
- **Pas de seuil par paire de langues** (un seul seuil global pour la V1).

## Références

- Implémentation : `src/multicorpus_engine/sidecar.py` (`SEGMENT_RATIO_WARN_THRESHOLD`).
- Cadrage lié : `docs/cadrage/METADONNEES_DOCUMENT.md` (C5).
- ROADMAP : item **D2** (« Dette doc — cadrages manquants »).
