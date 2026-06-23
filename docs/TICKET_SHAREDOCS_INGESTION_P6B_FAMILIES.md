# Mission : ShareDocs — Phase 6B (familles à l'import : détection + bannière hybride + câblage)

Tu interviens sur le repo AGRAFES (branche dédiée `feat/sharedocs-p6-families`, basée sur `dev`).

**Prérequis** : **P6A mergé** (`familyDetect.ts` partagé). Lis
[docs/DESIGN_sharedocs_ingestion.md](DESIGN_sharedocs_ingestion.md) **§12** (décisions
figées) et **`tauri-prep/src/screens/ShareDocsImportScreen.ts`** (`_importSelection`,
`_runImport`, `_submitGroups`, `_expandFolders`, `_detectFile`) + **`lib/shareDocs.ts`**
(`groupDetectedFiles`, `dedupeDetectedFiles`, `mergeReports`) + `sidecarClient.ts`
(`setDocRelation`, `RemoteFileResult`).

# Contexte

L'import ShareDocs par lot **ne crée aucune relation**. La Phase 6 le branche : détecter
les familles (radical + langues, via `familyDetect`), proposer le pivot dans une bannière
**hybride**, et **après l'import**, câbler les relations `translation_of` enfant→pivot en
résolvant `nom → doc_id` depuis le rapport agrégé. Réplique le Sprint 8 de l'import local
pour le contexte **lot**. Tout l'aval (segment/align/export/curation famille) est déjà
construit — créer la relation suffit à débloquer la valeur.

# Périmètre

**Front-only, aucun changement moteur/contrat** — réutilise `POST /doc_relations/set`
(`setDocRelation`) et le rapport `import-remote` existant (`files[].{name, source_url,
doc_id, status}`). Pas de `family_root_doc_id` sur `/import-remote` (inutile : câblage
post-import).

**Interdit** : toucher au backend/contrat ; réinventer la détection (réutiliser
`familyDetect` de P6A) ; auto-segmenter / auto-aligner ; créer `excerpt_of`.

# Décisions de design (figées — §12.2)

1. **Pivot — hybride** : bannière pré-import listant les familles détectées ; pivot
   **pré-sélectionné par `pickDefaultPivot`** (heuristique P6A) mais **sélecteur
   modifiable** par groupe ; case par groupe pour **importer sans lier**. Câblage
   automatique après import. Correction toujours possible ensuite dans MetadataScreen.
2. **Type de relation** : `translation_of` **uniquement**.
3. **Portée** : tout le lot, **multi-dossiers**, sur l'ensemble **résolu** (après
   expansion des dossiers cochés — réutiliser le résultat de `_expandFolders`).
4. **Familles partielles** : membre sans `doc_id` (import échoué) → câbler le reste et
   **signaler** au récap ; pivot sans `doc_id` → groupe non liable, signalé. Ne jamais
   abandonner tout le lot pour une famille.
5. **Membres `skipped-duplicate`** : liés normalement (doc_id connu ; `setDocRelation`
   est un **upsert idempotent**).

# Livrables

## L1 — Détection + bannière hybride
Sur l'ensemble résolu de l'import (dossier courant **ou** sélection après `_expandFolders`),
calculer `detectFamilyGroups(noms)`. Rendre une bannière `prep-sd-*` « 🔗 N familles
détectées » au-dessus des boutons d'import (réutiliser le rendu de la bannière locale,
**namespacée**, via `safeHtml`/`setHtml`). Par groupe : sélecteur de pivot (pré-rempli
`pickDefaultPivot`), case « créer les relations ». État conservé jusqu'au lancement.

## L2 — Barrière de complétion dans `_submitGroups`
`_submitGroups` agrège les rapports **au fil** des callbacks `trackJob` ; ajouter une
**barrière** qui déclenche un callback `onAllDone(aggregatedReport)` quand **tous** les
jobs du lot sont terminés (compter terminés == `groups.length`, succès **ou** échec).
Testable indépendamment (faux JobCenter). Pas de changement visible sans L3.

## L3 — Câblage post-lot + récap
Dans le `onAllDone` : pour chaque famille cochée, résoudre `nom → doc_id` via le rapport
agrégé (`files[].{name, doc_id}` ; doc_id présent pour `imported` **et**
`skipped-duplicate`), puis pour chaque membre ≠ pivot ayant un doc_id :
`setDocRelation({doc_id: membre, relation_type: "translation_of", target_doc_id: pivot})`.
Échec d'un appel reporté par groupe, n'interrompt pas les autres. Récap ajouté au rapport :
« N relation(s) créée(s) ; M non liés (import échoué / pivot manquant) ».

## L4 — Tests
Vitest : helper pur de résolution `famille + rapport agrégé → appels setDocRelation`
(pivot exclu, membres sans doc_id exclus, skipped-duplicate inclus) sur fixture mêlant
`imported`/`skipped-duplicate`/`error` ; barrière `_submitGroups` (callback déclenché une
seule fois, après le dernier job, succès et échec) via faux JobCenter.

## L5 — Doc
`CHANGELOG.md` ; cocher Phase 6 dans [DESIGN §12](DESIGN_sharedocs_ingestion.md) (✅ livré).

# Conventions du repo
- `feat(prep): ShareDocs détecte les familles + câble translation_of à l'import`
- `refactor(prep): barrière de complétion de lot dans _submitGroups`
- `test(prep): câblage des familles ShareDocs (résolution nom→doc_id)`
- `docs: documenter les familles à l'import ShareDocs (Phase 6)`
- Pas de migration, pas de bump version, pas de changement de contrat.
- CI : `npm --prefix tauri-prep run build && npm --prefix tauri-prep test` + eslint ;
  `npm --prefix tauri-shell run build` (couplage source).

# Ce qu'il NE FAUT PAS faire
- Réinventer la détection (réutiliser `familyDetect` de P6A).
- Toucher au backend/contrat (relations via `/doc_relations/set` existant).
- Câbler avant la fin des jobs (course sur les doc_id → barrière obligatoire).
- Abandonner tout le lot pour une famille partielle (câbler le liable, signaler le reste).
- Créer `excerpt_of` ou lancer segment/align automatiquement.

# Si tu butes
- Si la barrière de complétion s'avère lourde, livrer d'abord L1 (bannière + détection,
  **affichage seul**) et `// NOTE:` le câblage en sous-étape — mais la valeur réelle est
  dans L3 (la relation créée), donc viser L1+L2+L3 ensemble.
- Familles imbriquées / chaînes (A↔B↔C) : v1 = relations enfant→pivot du **groupe**
  uniquement (pas de transitivité), le calcul des familles côté backend gère l'imbrication.

# Livrable attendu
4-6 commits + résumé : smoke (dossier bilingue `roman_fr`/`roman_en`/`roman_de` →
« Importer la sélection » → bannière pivot → import → 2 relations `translation_of`
visibles dans MetadataScreen), récap des relations, non-régression de l'import (sans
familles détectées, comportement P5 inchangé).
