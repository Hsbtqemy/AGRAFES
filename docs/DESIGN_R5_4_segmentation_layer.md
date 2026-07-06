# Note de design — R5.4 : couche « Segmentation » au canvas (segmentation configurable)

> Statut : **modèle figé** (issu de la discussion 2026-07-06). Date : 2026-07-06.
> Cible : `tauri-prep` / `tauri-shell` **+ greffe moteur** (le découpage devient paramétrable).
> **N'est PLUS front-pur** : **contrat** à prévoir, mais **sans migration** (persistance en
> `meta_json`, cf. §5). Alignement des nouveaux types de segments = **explicitement différé** (§4).
> Amont : [`DESIGN_prep_text_canvas.md`](DESIGN_prep_text_canvas.md) §9-§10 (modèle de couches),
> [`ROADMAP_REFONTE.md`](ROADMAP_REFONTE.md) (R2 = modèle 2-grain livré),
> [`DESIGN_peritext_conventions_grounding.md`](DESIGN_peritext_conventions_grounding.md) §3.

## 0. Cadrage & recadrage

R2 a livré le **modèle** 2-grain (parent `meta_json.parent_n` au resegment) et son **affichage**
au canvas (bandeau d'état + regroupement ¶). Manque : **agir** (segmenter depuis le canvas).

**Recadrage décisif (vérifié au code, cf. §1).** L'idée d'un « pack/langue » est **quasi une
fiction** : la règle de découpage est *unique et sans langue* ; la « langue » ne bascule qu'entre
3 mini-jeux d'abréviations. Pour un **outil d'analyse**, le bon modèle n'est pas « choisis ta
langue » mais **« définis ta segmentation »** — l'unité d'analyse (paragraphe / phrase / **mot** /
vers / **tour de parole**) est un *choix de l'analyste*. La couche Segmentation est donc conçue
autour d'une **configuration de segmentation**, pas de packs-langue.

## 1. État du code (vérifié)

- **Le découpage phrase est universel** : un seul `_SPLIT_RE`
  (`(?<=[.!?])\s+(?=[A-ZÀ-Ÿ"'…(])`, `segmenter.py:51`) — couper après `.!?` + espace + majuscule.
  **Identique pour toutes les langues.**
- **Un « pack » = juste une liste d'abréviations protégées** (`_PACK_EXTRA_ABBREVIATIONS`,
  `segmenter.py:54`) : `default` (rien), `fr_strict` (5), `en_strict` (4), + un `_BASE_ABBREV`
  partagé (titres, mois, biblio, décimaux). `resolve_segment_pack` : `fr*→fr_strict`,
  `en*→en_strict`, **tout le reste → default**. → la langue ne pilote presque rien.
- **Séparateur explicite existant** : mode **balises `[N]`** (`_MARKER_SPLIT_RE`) — le *seul*
  vrai contrôle utilisateur aujourd'hui.
- **Endpoints** : `POST /segment` (écrit, **efface l'alignement**), `POST /segment/preview`
  (en mémoire), `POST /segment/detect_markers` (`mode: "sentences" | "markers"`).
- **Canvas** : `CanvasMode = "roles" | "curation" | "annoter"` (pas de segmentation) ; base
  `CanvasUnitList` ; bandeau d'état (stade/grain).
- **Structure matcher** (`SegStructureMatcherPanel`) : appariement de sections **inter-doc**,
  lourd, autonome → **hors périmètre** (§4).
- **WORKCOPY** = **discipline, pas fonctionnalité** (aucune mécanique code ; nom `…WORKCOPY.db`).

## 2. Modèle cible : configuration de segmentation

Une **frontière** de segment se définit par l'une de **deux natures** (le point structurant) :

| Nature | Coupe… | Exemples de préréglages |
|---|---|---|
| **Terminateur en flux** | *après* un caractère/motif dans le texte | **Phrases** (`.!?` + majuscule + abréviations), **Mots** (espace) |
| **Motif de ligne/bloc** | *avant* une ligne correspondant à un motif | **Tours** (`—`/`NOM :`), **Vers** (saut de ligne), **Paragraphes** (ligne vide), **Balises `[N]`** |

- **Surface UI = `Phrases | Balises [N] | Personnalisé`** : **Phrases** et **Balises** restent
  les deux modes dominants (le chemin courant, de loin les plus utilisés), en avant ;
  **Personnalisé** ouvre toute la machinerie (terminateurs + motifs de ligne) avec des **points
  de départ rapides** (Mots / Vers / Tours). Sous le capot, Phrases et Balises **sont** deux
  préréglages du même mécanisme général. Les abréviations FR/EN deviennent une **option** de
  Phrases (cases à cocher), **plus** un gating par langue.
- **Par grain** : la config s'applique au grain **fin** (qu'est-ce qu'une unité : phrase / mot /
  vers) et, pour le grossier, une frontière de **motif** définit le parent (tour / paragraphe) —
  réutilise `parent_n`. Un **tour de parole = une unité de grain grossier** (« tour ⊃ phrase »),
  exactement le slot du paragraphe, avec une frontière « début de locuteur ».

## 3. Décisions figées

1. **Segmentation = 4ᵉ couche du canvas** (`CanvasMode "segment"`), pas une vue à part
   (la segmentation est mono-document, comme le canvas ; contrairement à Alignement, inter-doc).
   Découvrabilité : le bandeau d'état pointe vers la couche.
2. **Surface = `Phrases | Balises [N] | Personnalisé`** : deux modes dominants + Personnalisé
   (qui porte terminateurs/motifs + points de départ Mots/Vers/Tours). Sous le capot = un seul
   mécanisme configurable (§2), **pas** de packs-langue.
3. **Aperçu en contexte** : `/segment/preview` (aucune écriture) rend la segmentation *proposée*
   dans le texte ; « Appliquer » écrit (`/segment`) puis **recharge** la base.
4. **Garde-fou = confirm CONDITIONNEL, pas de WORKCOPY imposée.** La segmentation *est* le travail
   constitutif de la DB → on ne force ni ne nag une copie. Le `modalConfirm` ne se déclenche que
   **s'il y a un alignement à perdre** (le bandeau de stade porte le signal « aligné ou non ») ;
   pas encore aligné → resegmentation **libre**, sans friction. La WORKCOPY reste à la *discrétion*
   de l'utilisateur. Invalidation = reload post-apply (rôles/curation/annotation par-document se
   rechargent ; alignement effacé côté moteur → chip « aligné » → « non aligné »).

## 4. Explicitement différé / hors périmètre

- **Alignement des nouveaux types de segments** (tours, mots…) — **différé, décision reportée**
  (unité-mot vs token ; positionnel vs longueurs). *C'est une question d'alignement, pas de
  segmentation* ; on segmente d'abord, on rediscutera l'alignement à sa place. **Ne pas trancher
  ici.**
- **Mot = unité vs token** : lié au point ci-dessus, non tranché.
- **3 niveaux** (« tour ⊃ phrase ⊃ mot ») : le modèle reste **2 grains** (grossier ⊃ fin) ; on
  choisit **deux** niveaux à la fois. Borne notée, pas d'empilement à 3 pour l'instant.
- **Structure matcher** (inter-doc) : reste legacy → **R6.4 corrigé** : retirer **Cur/Annot**
  (relogés R5.1/R5.2), **garder l'écran Seg legacy** tant que le structure matcher n'est pas
  relogé (tranche ultérieure conditionnée).
- **Caveat linguistique** (noté, non bloquant) : aligner *par position* est crude entre langues à
  ordre différent — l'outil doit le *permettre*, pas l'imposer.

## 5. Esquisse moteur (à préciser au ticket)

Le `_SPLIT_RE` fixe devient un **`SegmentSpec`** passé à `segment_text` / `resegment_document`
et aux endpoints `/segment(/preview)` :

- **terminateur** : caractères de coupe (défaut `.!?`), exigence majuscule-après (bool),
  abréviations à protéger (liste optionnelle) — cas « espace » = terminateur `\s+`, sans majuscule.
- **motif** : regex de début-de-segment (tours/vers/¶/`[N]`), ancrée ligne.
- **grain** : la spec cible le grain fin ; une spec de motif peut cibler le grossier (parent).
- **persistance (tranchée) — `meta_json`, zéro migration** : la spec utilisée sur un doc → son
  `meta_json` (repro, comme `parent_n`) ; les **préréglages custom nommés** (réutilisables) →
  `corpus_info.meta_json` (exactement comme `active_models`) ; built-in Phrases/Balises =
  constantes code. (Emplacement doc-niveau à confirmer au ticket : `documents.meta_json` s'il
  existe, sinon `corpus_info.meta_json` keyé par `doc_id`.)
- **contrat** : params additifs sur `/segment(/preview)` → 3 artefacts + snapshot ; **aucune
  migration** (tout en `meta_json`).
- **garde-fou growth-gate** : la logique de spec vit **hors `sidecar.py`** (dans `segmenter.py` /
  un module dédié), handler fin.

## 6. Tranches (esquisse, à ordonnancer au ticket)

- **R5.4a — Moteur : `SegmentSpec`.** 🟡 *cœur livré (endpoints/contrat à suivre)* —
  `SegmentSpec` (kinds `terminator` / `whitespace` / `markers`) + `split_unit_text` unifiant les
  deux resegmentations ; préréglages **phrases / mots / balises** ; `segment_text` /
  `resegment_document` généralisés **byte-identiques** (spec=None → phrases). Terminateurs =
  ensemble cumulable + `require_uppercase_after`. **Vers/Tours (motif de ligne) → R5.4c** (besoin
  de la structure de ligne d'origine, pas de `text_norm`). *Reste R5.4a* : endpoints
  `/segment(/preview)` additifs + contrat. (Le destructif se teste sur une base jetable, sans
  l'imposer à l'utilisateur.)
- **R5.4b — Front : couche Segmentation au canvas** (`SegmentPane` sur le modèle Roles/Curation/
  Annotation) : surface **`Phrases | Balises | Personnalisé`**, **aperçu en contexte**, resegmenter
  (confirm *conditionnel* + reload). 4ᵉ bouton de mode `TextCanvasView`.
- **R5.4c — Grain grossier configurable (Tours / Paragraphes)** : frontière de motif → `parent_n`.
- **R5.4d — (différé/conditionnel) structure matcher relogé** (pour permettre le retrait du Seg
  legacy en R6.4).
- **Piste séparée (différée) — alignement des nouveaux segments** (tours/mots) : ré-ouvrir §4.

## 7. Risques

- **Destructif** : `/segment` efface l'alignement → **confirm conditionnel** (seulement si un
  alignement existe ; le bandeau de stade porte le signal). Pas de WORKCOPY imposée — c'est le
  travail constitutif de la DB.
- **Sur-scope** : le piège est de tout rendre configurable d'un coup. Livrer par préréglages
  (Phrases/Mots/Vers/Balises d'abord), custom ensuite ; grossier (Tours) en tranche à part.
- **État périmé** : bien recharger après apply (réutiliser le re-focus doc du canvas).
