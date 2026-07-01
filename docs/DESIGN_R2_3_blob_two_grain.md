# Note de design — R2.3 (queue) : extraction 2-grain d'un document « blob »

> Statut : **intention de design — décisions à figer avant ticket**. Date : 2026-07-01.
> Queue différée de R2.3 ([`ROADMAP_REFONTE.md`](ROADMAP_REFONTE.md) §R2.3 · [`DESIGN_prep_text_canvas.md`](DESIGN_prep_text_canvas.md) §148/§157).
> Dépend du modèle 2-grain (R2.1 `parent_n` livré) et réutilise `resegment_document` / `coarse_grain`.

## 1. Le problème

Un document **« blob »** = importé en **une seule unité** (ou en unités beaucoup plus grosses que le paragraphe) alors que sa source portait **deux niveaux de structure** (paragraphes ⊃ phrases). C'est un stade réel : les corpus coexistent à *tous* les stades, dont « brut (1 unité-blob) » ([`DESIGN_peritext_conventions.md`](DESIGN_peritext_conventions.md) §13). Le but (DESIGN_prep_text_canvas §148) : **« extraire fin + grossier en un seul passage quand le balisage porte les deux »**.

**Pourquoi ce n'est pas du front** (contrairement au tag `[FRONT]` initial) : le canvas sait déjà *afficher* un 2-grain existant (R2.3 ✅, groupage par `parent_n`). Mais un blob **n'a pas** de 2-grain à afficher — il faut d'abord le **produire**. C'est donc une capacité **moteur/import**.

## 2. Pourquoi R2.1 ne suffit pas

`resegment_document` (R2.1) découpe **chaque ligne existante** en phrases et pose `parent_n = n de la ligne source`. Sur un blob = **une** ligne (n=1), toutes les phrases héritent `parent_n=1` → **un seul paragraphe**. On obtient le grain fin mais **un grain grossier faux** (tout dans un ¶). Il manque le **découpage en paragraphes** *avant* le découpage en phrases.

## 3. Le modèle — deux découpages, une passe

Extraire, pour un blob, **d'abord les bornes de paragraphe, puis les phrases dans chaque ¶** :

1. **Découpage ¶** — segmenter le blob en paragraphes selon la **source de structure** (voir D2).
2. **Découpage phrase** — dans chaque ¶, réutiliser `segment_text` (le segmenteur de R2.1) ; chaque phrase pose `parent_n = n du ¶` (l'ordinal du paragraphe produit à l'étape 1).

Résultat : des unités-phrases avec un `parent_n` **réellement paragraphique** → `coarse_grain` regroupe correctement, l'aligneur `length_bounded` (R3.2) borne correctement. Aucun 3ᵉ grain, cohérent avec la voie A.

## 4. D'où vient la structure ¶ ? (le point dur)

Deux sources, selon le format d'origine :

- **(a) En base, sans IO** — le texte du blob porte encore des marqueurs de frontière : lignes vides, `¤` (ADR-002), marqueurs `[N]`. Et surtout **`text_source`** (ADR-043) conserve *verbatim* l'original d'import par unité — pour un blob, c'est tout le texte source. On peut donc **re-parser `text_source` en base**, zéro fichier.
- **(b) Re-lecture `source_path`** — quand la structure vivait dans un **balisage perdu à l'import** (styles de paragraphe DOCX, `<p>`/`<s>` TEI) : il faut rouvrir le fichier d'origine (`documents.source_path`) et le re-parser avec l'extracteur du format. Coûteux, dépend du fichier encore présent.

→ **(a) d'abord** (bon marché, sans dépendance au fichier) ; **(b)** en repli quand (a) ne trouve aucune borne.

## 5. Décisions à figer (reco par défaut)

- **D1 — Détection : signalée, action explicite (pas d'auto-magie).** Un blob se repère aux **stats R1.2** (`line_count` très petit **et** `max_text_len` très grand, p.ex. 1 unité > N k caractères). Le canvas *signale* « document blob — extraire 2 grains ? » ; l'utilisateur déclenche. Pas de ré-extraction silencieuse. **Reco : détecter + proposer, jamais automatique.**
- **D2 — Source de structure ¶ : `text_source`/texte en base d'abord, `source_path` en repli.** Bornes ¶ dérivées, dans l'ordre : lignes vides → `¤`/`sep_count` → marqueurs `[N]` → (repli) re-lecture `source_path` format-aware. **Reco : (a) puis (b).**
- **D3 — Réutilisation : étendre `resegment_document`, ne pas coder neuf.** Ajouter une étape « split ¶ » **en amont** du split phrase existant (le cœur SQL + la pose de `parent_n` + la suppression d'alignement + l'undo sont déjà là). L'extracteur ¶ est une fonction pure `split_paragraphs(text, source) -> list[str]` (mirroir de `segment_text`). **Reco : une passe, dans le segmenteur.**
- **D4 — Contrat : une variante de segmentation, pas une route neuve.** Réutiliser `POST /segment` / `POST /jobs/enqueue segment` avec un **mode `two_grain`** (additif à l'enum de mode) plutôt qu'un endpoint dédié. Le split ¶ vit **hors `sidecar.py`** (segmenteur), handler = adaptateur mince. **Reco : mode additif → contrat additif, pas de route.**
- **D5 — Migration : aucune.** `parent_n` (meta_json) et `text_source` existent déjà ; on réécrit des unités comme une resegmentation normale. **Reco : zéro migration.**
- **D6 — WORKCOPY + destructif.** Comme toute resegmentation, ça **supprime l'alignement** (ADR-017) et réécrit les unités : undo déjà couvert, essais sur copie. **Reco : même discipline que R2.1.**

## 6. Implications & risque

- **Moteur** : nouvelle fonction pure `split_paragraphs` (per-source, stdlib) + branchement dans `resegment_document` (mode 2-grain) + détection format-aware pour le repli (b).
- **Import/IO** : le repli `source_path` touche la couche importers (re-parser DOCX/TEI) — c'est **le vrai coût** ; à ne faire que si (a) échoue et le fichier est présent.
- **Contrat** : mode `two_grain` additif (3 artefacts). **Migration** : aucune.
- **Front** : bannière « blob détecté » (stats R1.2) + bouton de déclenchement (petit).

## 7. Questions ouvertes (à trancher avant ticket)

1. **D2/(b)** — jusqu'où pousser le repli `source_path` per-format ? MVP = **(a) en base seulement** (lignes vides/`¤`/`[N]`), et *signaler* « structure non retrouvée, ré-importer » quand (a) échoue — la re-lecture DOCX/TEI en vraie feature ultérieure ?
2. **D1** — seuils de détection du blob (`line_count` ≤ ? · `max_text_len` ≥ ?) — à caler sur le corpus réel.
3. Faut-il gérer le blob **partiel** (quelques grosses unités, pas une seule) ? Le split ¶ s'applique unité par unité, donc oui *gratuitement* si on l'exécute sur chaque unité trop longue — mais définir « trop longue ».
