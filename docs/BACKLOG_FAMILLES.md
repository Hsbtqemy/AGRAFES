# Backlog — Familles documentaires

> Une **famille** = un document original + ses traductions et extraits liés via `doc_relations`.
> Toutes les opérations (segmentation, alignement, export, curation) peuvent être cadrées
> par ce périmètre, évitant de croiser des paires non déclarées.

---

## Sprint 1 — Concept de famille et statut (fondation)

> Objectif : exposer les familles comme ressource API et afficher leur statut dans l'UI.

### Backend

- [x] `GET /doc_relations/all` — toutes les relations (déjà fait, base du calcul des familles)
- [x] `GET /families` — liste toutes les familles avec stats
  - Champs par famille : `family_id`, `parent` (doc), `children[]` (doc + relation_type)
  - Stats : `total_docs`, `segmented_docs`, `aligned_pairs`, `total_pairs`, `validated_docs`, `completion_pct`
  - API version → `1.6.0`
- [x] Snapshot `openapi_paths.json` + `docs/SIDECAR_API_CONTRACT.md`

### Frontend

- [x] `sidecarClient.ts` : interface `FamilyRecord` + `getFamilies(conn)`
- [x] `MetadataScreen.ts` — vue hiérarchique :
  - Badge statut sur chaque racine de famille (% complétion coloré)
  - Panneau famille dans l'éditeur quand un parent est sélectionné
- [x] CSS : badges de complétion, tableau de statut famille
- [x] `ActionsScreen` hub — vue hiérarchie documents (bouton 🌿 Hiérarchie, v0.1.33)

---

## Sprint 2 — Segmentation calibrée par famille

> Objectif : segmenter l'original puis propager la structure aux enfants.

### Backend

- [ ] `POST /segment` : paramètre optionnel `calibrate_to=doc_id`
  - Segmente en calant le nombre d'unités sur le doc de référence
  - Retourne `warning` si l'enfant est déjà segmenté différemment
- [ ] `POST /families/{family_root_id}/segment`
  - Segmente l'original en premier (si non segmenté)
  - Puis propage aux enfants (`calibrate_to` = parent)
  - Retourne un rapport par doc : `segmented | skipped | warning`
- [ ] API version → `1.6.1`

### Frontend

- [ ] Bouton **"Segmenter la famille"** dans le panneau famille (Sprint 1)
- [ ] Dialog de confirmation si enfants déjà segmentés : liste les conflits doc par doc
- [ ] Indicateurs en temps réel pendant le traitement (polling job ou progression inline)

---

## Sprint 3 — Alignement guidé par les relations ✅

> Objectif : aligner automatiquement toutes les paires d'une famille.

### Backend

- [x] `POST /families/{family_root_id}/align`
  - Aligne toutes les paires `parent↔enfant` en séquence (jobs asynchrones)
  - Retourne la liste des jobs créés
- [x] API version → `1.6.x`

### Frontend

- [x] Bouton **"⚡ Aligner la famille"** dans `AlignPanel`
- [x] Récapitulatif des paires avant lancement
- [x] Suivi des jobs d'alignement inline
- [x] Mode **"✎ Réviser famille"** — vue tabulaire multi-paires avec retarget/add/orphelins

---

## Sprint 4 — Audit enrichi par famille

> Objectif : étendre `/corpus/audit` avec des checks au niveau famille.

### Backend

- [ ] `GET /corpus/audit` — nouvelle section `families[]` :
  - Paires sans alignement (`unaligned_pairs`)
  - Docs avec relation mais non segmentés (`unsegmented_children`)
  - Ratios segments hors seuil > 15 % (`ratio_warnings`)
  - Docs orphelins (parent absent du corpus)
- [ ] API version → `1.6.3`

### Frontend

- [ ] Section "Familles" dans le panneau audit existant
- [ ] Actions directes depuis l'audit : naviguer, segmenter, aligner
- [ ] Seuil de ratio configurable dans l'UI (15 % par défaut)

---

## Sprint 5 — Export TMX et bilingue ✅

> Objectif : exporter une paire ou une famille dans des formats d'échange standard.

### Backend

- [x] `POST /export/tmx`
  - Params : `pivot_doc_id`, `target_doc_id` (ou `family_id` pour multi-langues)
  - Génère un fichier `.tmx` (Translation Memory eXchange)
  - Retourne le chemin du fichier généré
- [x] `POST /export/bilingual`
  - Params : `pivot_doc_id`, `target_doc_id`, `format` (`html` | `txt`)
  - Texte entrelacé : unité originale / unité traduite en alternance
- [ ] TEI enrichi automatiquement : `<teiHeader>` des enfants complété depuis le parent
- [x] API version → `1.6.4`

### Frontend

- [x] Onglet Export : sélecteur famille → choix de la paire → format → export
- [x] Bouton "Exporter cette paire" dans le panneau famille (Sprint 1)
- [x] Prévisualisation du bilingue inline avant export

---

## Sprint 6 — Concordancier cross-famille ✅

> Objectif : rechercher un terme dans l'original et voir ses équivalents dans toutes les traductions.

### Backend

- [x] `POST /query` : paramètre `family_id` pour restreindre la recherche
- [x] Réponse enrichie : pour chaque hit dans l'original, les unités alignées dans chaque traduction
  - Structure : `{ unit_id, text, aligned: { doc_id, language, unit_id, text }[] }`
- [x] API version → `1.6.5` + paramètre `pivot_only` (original uniquement)

### Frontend

- [x] Vue concordancier : filtre "Famille" dans le tiroir Filtres (tauri-app)
- [x] Sélecteur famille + case "Original uniquement" — active auto `include_aligned`
- [x] Affichage côte-à-côte via le bloc aligné existant (auto-expand en mode famille)
- [x] Export CSV des résultats cross-famille (format colonnes par document)

---

## Sprint 7 — Curation propagée ✅

> Objectif : signaler les unités des traductions dont l'original a changé depuis la validation.

### Backend

- [x] Migration 011 : `source_changed_at TEXT` sur `alignment_links` + index partiel
- [x] `curation.py` : après modification d'unités pivot, `UPDATE alignment_links SET source_changed_at = now()`
       pour toutes les paires dont ces unités sont le pivot
- [x] `query.py` : `_fetch_aligned_units` retourne `link_id` + `source_changed_at` dans chaque unité alignée
- [x] `GET /families/{family_root_id}/curation_status` — unités à revoir par enfant
- [x] `POST /align/link/acknowledge_source_change` — acquitter par link_ids ou target_doc_id
- [x] API version → `1.6.6`

### Frontend

- [x] Badge "⚠ source modifiée" sur les unités alignées dans le concordancier (tauri-app)
- [x] Toggle "⚠ Source modifiée" pour filtrer les lignes sans badge (post-filtre CSS)
- [x] Section "📋 Curation" dans le panel famille (tauri-prep / MetadataScreen)
      — liste les paires pivot/traduction à revoir, avec ✓ Lu (par lien) et ✓ Acquitter tout (par doc)

---

## Sprint 8 — Import groupé par famille ✅

> Objectif : rattacher un import à une famille existante ou créer une famille à l'import.

### Backend

- [x] `POST /import` : paramètre optionnel `family_root_doc_id`
  - Crée automatiquement la relation `translation_of` (ou `excerpt_of` selon le choix UI) après import
  - Retourne `relation_created: true` + `relation_id` dans la réponse
  - Même logique dans le job asynchrone `enqueueJob("import", { family_root_doc_id })`
- [x] API version → `1.6.7` (`pyproject.toml` → `0.6.9`)

### Frontend

- [x] ImportScreen : dialog post-import "Ce document est-il la traduction d'un existant ?"
  - Sélecteur du parent parmi tous les docs du corpus (trié par titre)
  - Sélecteur du type de relation (`translation_of` / `excerpt_of`)
  - Appel direct à `setDocRelation` → relation créée immédiatement
  - Option "Ne plus demander dans cette session" (`_skipFamilyDialog`)
- [x] Détection automatique de langue dans le nom de fichier
  - Regex `[_\-.](LANG)` détecte des codes 2-3 lettres dans les noms
  - Ex. `roman_FR.docx`, `roman_EN.docx` → groupe proposé avec sélecteur du pivot
  - Bannière de proposition affichée dans l'écran d'import (violet)

---

## Ordre d'exécution recommandé

```
Sprint 1  ████████████████████  Familles/statut      ← EN COURS
Sprint 2  ░░░░░░░░░░░░░░░░░░░░  Segmentation calibrée
Sprint 3  ░░░░░░░░░░░░░░░░░░░░  Alignement guidé
Sprint 4  ░░░░░░░░░░░░░░░░░░░░  Audit famille
Sprint 5  ░░░░░░░░░░░░░░░░░░░░  Export TMX/bilingue
Sprint 6  ░░░░░░░░░░░░░░░░░░░░  Concordancier cross-famille
Sprint 7  ░░░░░░░░░░░░░░░░░░░░  Curation propagée
Sprint 8  ████████████████████  Import groupé        ← TERMINÉ
```

---

## Notes techniques transversales

- Les familles sont **calculées à la volée** depuis `doc_relations` — pas de table dédiée,
  ce qui évite toute désynchronisation.
- Une famille est identifiée par son `family_id` = `doc_id` du document racine.
- Un document peut être racine d'une famille ET enfant d'une autre (familles imbriquées) :
  le calcul gère ce cas en traitant chaque `target_doc_id` comme racine potentielle.
- Les guards anti-croisement (pas d'alignement enfant↔enfant) sont imposés côté backend.
