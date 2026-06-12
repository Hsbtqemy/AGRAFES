# Mission : Connecteur d'ingestion ShareDocs — Phase 3 (UI Prep)

Tu interviens sur le repo AGRAFES (branche `development`).

**Prérequis : les Phases 1 et 2 sont mergées** — les endpoints
`POST /webdav/list` et `POST /import-remote` existent et renvoient le report batch.
Lis [docs/DESIGN_sharedocs_ingestion.md](DESIGN_sharedocs_ingestion.md) (§5 phase 3),
[docs/SIDECAR_API_CONTRACT.md](SIDECAR_API_CONTRACT.md) (les 2 routes) et
[HANDOFF_PREP.md](../HANDOFF_PREP.md).

# Contexte

Donner aux utilisateurs non-CLI un écran Prep pour parcourir un dépôt ShareDocs et
ingérer un dossier d'un coup, avec progression et report. Réutiliser intégralement
les endpoints de Phase 2 (aucune logique métier nouvelle côté front).

# Périmètre

Avant de coder, **lire un écran existant** pour calquer la structure, les
conventions de style et le câblage sidecar : `tauri-prep/src/screens/ImportScreen.ts`
(le plus proche fonctionnellement) + le flux `tauri-prep/src/lib/prepNextStep.ts` /
`tauri-prep/src/components/NextStepBanner.ts` pour l'intégration dans le parcours.

Fichiers **créés/modifiés** (à ajuster selon ce que tu observes) :
- `tauri-prep/src/screens/ShareDocsImportScreen.ts` (nouveau).
- Enregistrement de l'écran dans le routeur/app (`tauri-prep/src/app.ts`).
- Client API sidecar : ajouter les appels `webdavList` / `importRemote`.
- Tests Vitest si la logique de filtrage/affichage le justifie.

**Interdit** : modifier la logique backend (Phases 1-2), ajouter une dépendance front
lourde, persister des credentials sur disque.

# Décisions de design (figées)

1. **Flux écran** :
   - Formulaire connexion : URL de base + mode d'auth (anonymous / basic / bearer)
     + champs creds conditionnels.
   - « Connecter » → `POST /webdav/list` → liste navigable (nom, type, taille,
     modifié) ; clic sur un dossier → re-`list` ce dossier.
   - Sur un dossier : choisir `mode` (mêmes valeurs que l'import classique) +
     `language` + filtre `include` optionnel → « Importer ce dossier ».
   - `POST /import-remote` → **barre de progression** (events `JobManager`, même
     mécanisme que l'écran d'import classique) → **table de report** par fichier
     (status, doc, taille, erreur).
2. **Credentials** : saisis dans le formulaire, envoyés au sidecar à chaque appel,
   gardés **en mémoire de session uniquement** (état du composant). **Jamais**
   écrits sur disque / `localStorage` / config. Re-saisie à la session suivante.
   (Compromis UX assumé ; keychain OS = évolution ultérieure, hors périmètre.)
3. **Report** : réutiliser le rendu de report d'import existant si possible ;
   sinon une table simple. Coloration par `status` (`imported` vs `skipped-*` vs
   `error`).
4. **Pas de re-décision métier côté front** : extensions filtrées, dédup, provenance
   sont gérées par le backend. Le front affiche ce que le report dit.

# Livrables

## L1 — Client API
Ajouter au client sidecar : `webdavList({url, auth})` et
`importRemote({url, mode, language, include, auth, docRole, resourceType, maxFileMb})`,
typés sur le contrat de Phase 2.

## L2 — Écran ShareDocs
`ShareDocsImportScreen.ts` : formulaire connexion, navigation dossier, sélection
mode/langue/filtre, déclenchement import, progression, report. Calquer les
conventions de `ImportScreen.ts`.

## L3 — Intégration parcours
Rendre l'écran accessible (entrée de navigation Prep). Si pertinent, le relier au
`NextStepBanner` (« importer depuis ShareDocs » comme alternative à l'import local).

## L4 — Tests
Vitest sur la logique purement front si elle existe (formatage du report, états du
formulaire d'auth selon le mode). Pas de test e2e réseau réel.

## L5 — Doc
`CHANGELOG.md` `[Unreleased] / Added` ; cocher Phase 3 dans
[docs/DESIGN_sharedocs_ingestion.md](DESIGN_sharedocs_ingestion.md) ; mettre à jour
[docs/UX_FLOW_PREP.md](UX_FLOW_PREP.md) avec le nouveau point d'entrée.

# Conventions du repo
- `feat(prep): ShareDocs import screen (browse + batch ingest)`
- `feat(prep): sidecar client bindings for webdav/list + import-remote`
- `test(prep): ShareDocs screen report rendering + auth form states`
- `docs(prep): document ShareDocs import flow`
- Pas de migration DB, pas de bump de version.

# Ordre d'exécution
1. Lire `ImportScreen.ts` + le flux existant. 2. L1 client API. 3. L2 écran
   (connexion → navigation → import → progression → report). 4. L3 intégration.
   5. L4 tests. 6. L5 doc. 7. Smoke test manuel contre un vrai dépôt ShareDocs.

# Ce qu'il NE FAUT PAS faire
- Persister des credentials (disque / `localStorage` / config). Mémoire de session
  seulement.
- Dupliquer la logique métier (filtre/dédup/provenance vit dans le backend).
- Modifier les Phases 1-2 hors correctif mineur (et alors le noter).
- Ajouter une dépendance front lourde pour un picker de fichiers — la liste
  `/webdav/list` suffit.

# Si tu butes
- Si la progression par fichier n'est pas exposée assez finement par
  `/import-remote`, afficher une progression indéterminée + le report final, et
  `// NOTE:` le raffinement.
- Si l'intégration `NextStepBanner` est ambiguë, livrer d'abord l'écran autonome
  accessible via la navigation, et traiter le banner en follow-up.

# Livrable attendu
3-4 commits + résumé : ce qui marche (smoke test ShareDocs), ce qui manque, les
`// NOTE:`, recommandation (ex. persistance creds via keychain, progression fine).
