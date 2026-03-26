# Backlog — Familles documentaires

> Une **famille** = un document original + ses traductions et extraits liés via `doc_relations`.
> Toutes les opérations (segmentation, alignement, export, curation) peuvent être cadrées
> par ce périmètre, évitant de croiser des paires non déclarées.

---

## Sprint 1 — Concept de famille et statut (fondation)

> Objectif : exposer les familles comme ressource API et afficher leur statut dans l'UI.

### Backend

- [x] `GET /doc_relations/all` — toutes les relations (déjà fait, base du calcul des familles)
- [ ] `GET /families` — liste toutes les familles avec stats
  - Champs par famille : `family_id`, `parent` (doc), `children[]` (doc + relation_type)
  - Stats : `total_docs`, `segmented_docs`, `aligned_pairs`, `total_pairs`, `validated_docs`, `completion_pct`
  - API version → `1.6.0`
- [ ] Snapshot `openapi_paths.json` + `docs/SIDECAR_API_CONTRACT.md`

### Frontend

- [ ] `sidecarClient.ts` : interface `FamilyRecord` + `getFamilies(conn)`
- [ ] `MetadataScreen.ts` — vue hiérarchique :
  - Badge statut sur chaque racine de famille (% complétion coloré)
  - Panneau famille dans l'éditeur quand un parent est sélectionné :
    - Récapitulatif des paires `parent ↔ enfant` avec état segmenté/aligné/validé
    - Boutons placeholder pour Sprint 2 (`Segmenter`) et Sprint 3 (`Aligner`) — désactivés
- [ ] CSS : badges de complétion, tableau de statut famille

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

## Sprint 3 — Alignement guidé par les relations

> Objectif : aligner automatiquement toutes les paires d'une famille.

### Backend

- [ ] `POST /align` : paramètre `from_relations=true`
  - Déduit les paires `pivot↔target` depuis `doc_relations` (translation_of / excerpt_of)
  - Refuse d'aligner deux enfants entre eux (garde-fou)
- [ ] `POST /families/{family_root_id}/align`
  - Aligne toutes les paires `parent↔enfant` en séquence (jobs asynchrones)
  - Retourne la liste des jobs créés
- [ ] API version → `1.6.2`

### Frontend

- [ ] Bouton **"Aligner la famille"** dans le panneau famille
- [ ] Récapitulatif des paires avant lancement : `#5 FR ↔ #7 EN`, `#5 FR ↔ #9 ES`…
- [ ] Suivi des jobs d'alignement inline dans le panneau famille

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

## Sprint 5 — Export TMX et bilingue

> Objectif : exporter une paire ou une famille dans des formats d'échange standard.

### Backend

- [ ] `POST /export/tmx`
  - Params : `pivot_doc_id`, `target_doc_id` (ou `family_id` pour multi-langues)
  - Génère un fichier `.tmx` (Translation Memory eXchange)
  - Retourne le chemin du fichier généré
- [ ] `POST /export/bilingual`
  - Params : `pivot_doc_id`, `target_doc_id`, `format` (`html` | `txt`)
  - Texte entrelacé : unité originale / unité traduite en alternance
- [ ] TEI enrichi automatiquement : `<teiHeader>` des enfants complété depuis le parent
- [ ] API version → `1.6.4`

### Frontend

- [ ] Onglet Export : sélecteur famille → choix de la paire → format → export
- [ ] Bouton "Exporter cette paire" dans le panneau famille (Sprint 1)
- [ ] Prévisualisation du bilingue inline avant export

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

## Sprint 7 — Curation propagée

> Objectif : signaler les unités des traductions dont l'original a changé depuis la validation.

### Backend

- [ ] Nouveau champ sur les liens d'alignement ou les unités : `source_changed_at`
- [ ] Quand une unité de l'original est modifiée/revalidée : marquer les unités alignées
  comme `source_changed` dans les traductions
- [ ] `GET /families/{family_root_id}/curation_status` — unités à revoir par enfant
- [ ] API version → `1.6.6`

### Frontend

- [ ] Badge "source modifiée ⚠" sur les unités des traductions concernées
- [ ] Vue de curation filtrée : "Montrer uniquement les unités dont la source a changé"
- [ ] Action "Marquer comme relu" pour acquitter le flag

---

## Sprint 8 — Import groupé par famille

> Objectif : rattacher un import à une famille existante ou créer une famille à l'import.

### Backend

- [ ] `POST /import` : paramètre optionnel `family_root_doc_id`
  - Crée automatiquement la relation `translation_of` après import
  - Retourne `relation_created: true` dans la réponse
- [ ] API version → `1.6.7`

### Frontend

- [ ] ImportScreen : dialog post-import "Ce document est-il la traduction d'un existant ?"
  - Sélecteur du parent → relation créée automatiquement
  - Option "Ne plus demander" par session
- [ ] Import par dossier : détection de langue dans le nom de fichier
  - Ex. `roman_FR.docx`, `roman_EN.docx` → proposition de famille automatique

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
Sprint 8  ░░░░░░░░░░░░░░░░░░░░  Import groupé
```

---

## Notes techniques transversales

- Les familles sont **calculées à la volée** depuis `doc_relations` — pas de table dédiée,
  ce qui évite toute désynchronisation.
- Une famille est identifiée par son `family_id` = `doc_id` du document racine.
- Un document peut être racine d'une famille ET enfant d'une autre (familles imbriquées) :
  le calcul gère ce cas en traitant chaque `target_doc_id` comme racine potentielle.
- Les guards anti-croisement (pas d'alignement enfant↔enfant) sont imposés côté backend.
