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
  - Panneau famille dans l'éditeur quand un parent est sélectionné :
    - Récapitulatif des paires `parent ↔ enfant` avec état segmenté/aligné/validé
    - Boutons "Segmenter la famille" et "Aligner la famille" fonctionnels
- [x] CSS : badges de complétion, tableau de statut famille

---

## Sprint 2 — Segmentation calibrée par famille

> Objectif : segmenter l'original puis propager la structure aux enfants.

### Backend

- [x] `POST /segment` : paramètre optionnel `calibrate_to=doc_id`
- [x] `POST /families/{family_root_id}/segment`
- [x] API version → `1.6.1`

### Frontend

- [x] Bouton **"Segmenter la famille"** dans le panneau famille
- [x] Dialog de confirmation si enfants déjà segmentés
- [x] Indicateurs en temps réel pendant le traitement

---

## Sprint 3 — Alignement guidé par les relations

> Objectif : aligner automatiquement toutes les paires d'une famille.

### Backend

- [ ] `POST /align` : paramètre `from_relations=true` — déféré, `POST /families/{id}/align` couvre le besoin
- [x] `POST /families/{family_root_id}/align`
- [x] API version → `1.6.2`

### Frontend

- [x] Bouton **"Aligner la famille"** dans le panneau famille
- [x] Récapitulatif des paires avant lancement
- [x] Suivi des jobs d'alignement inline dans le panneau famille

---

## Sprint 4 — Audit enrichi par famille

> Objectif : étendre `/corpus/audit` avec des checks au niveau famille.

### Backend

- [x] `GET /corpus/audit` — nouvelle section `families[]`
- [x] API version → `1.6.3`

### Frontend

- [x] Section "Familles" dans le panneau audit existant
- [x] Actions directes depuis l'audit : segmenter, aligner
- [x] Seuil de ratio configurable via `ratio_threshold_pct` (défaut 15 %)

---

## Sprint 5 — Export TMX et bilingue

> Objectif : exporter une paire ou une famille dans des formats d'échange standard.

### Backend

- [x] `POST /export/tmx` (`pivot_doc_id` / `target_doc_id` / `family_id`)
- [x] `POST /export/bilingual` (`format` html | txt, `preview_only`)
- [ ] TEI enrichi automatiquement : `<teiHeader>` des enfants complété depuis le parent — déféré
- [x] API version → `1.6.4`

### Frontend

- [x] Interfaces TypeScript `ExportTmxOptions`, `ExportBilingualOptions` dans sidecarClient.ts
- [ ] UI Export : sélecteur famille → choix paire → format → export — déféré (surface ExportsScreen)

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
Sprint 1  ████████████████████  Familles/statut      ← TERMINÉ
Sprint 2  ████████████████████  Segmentation calibrée ← TERMINÉ
Sprint 3  ███████████████░░░░░  Alignement guidé     ← TERMINÉ (from_relations param déféré — POST /families/{id}/align couvre le besoin)
Sprint 4  ████████████████████  Audit famille        ← TERMINÉ
Sprint 5  ████████████████████  Export TMX/bilingue  ← TERMINÉ
Sprint 6  ████████████████████  Concordancier cross-famille ← TERMINÉ
Sprint 7  ████████████████████  Curation propagée    ← TERMINÉ
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
