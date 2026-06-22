# Mission : ShareDocs — Phase 4C (sélection multiple accumulative + sélection fichiers)

Tu interviens sur le repo AGRAFES (branche dédiée `feat/sharedocs-p4c-selection`, basée sur `dev`).

**Prérequis** : Phases 4A + 4B mergées. Lis [docs/DESIGN_sharedocs_ingestion.md](DESIGN_sharedocs_ingestion.md)
**§9.1 + §9.4** (décisions figées), [docs/SIDECAR_API_CONTRACT.md](SIDECAR_API_CONTRACT.md),
le bloc « Adding or changing a sidecar endpoint » de [CLAUDE.md](../CLAUDE.md),
`remote/ingest.py`, `sidecar_contract.py`, le handler `import-remote` dans `sidecar.py`, et
`ShareDocsImportScreen.ts`.

# Contexte

La granularité est aujourd'hui « dossier entier ». On ajoute une **sélection multiple
accumulative** (un « panier » qui persiste pendant la navigation) couvrant **dossiers ET
fichiers**, pour piocher précisément ce qu'on importe. Côté moteur, c'est un **petit
incrément** : le `import-remote` accepte une liste d'`hrefs` optionnelle, et l'ingestion filtre
le listing PROPFIND sur ces hrefs (jamais d'URL brute fetchée → la sécurité same-origin tient).

# Périmètre

Le **seul** palier qui touche le moteur + le **contrat gelé**. **Garder le handler `import-remote`
mince** (logique dans `remote/ingest.py`) — le *sidecar growth gate* surveille `sidecar.py`.

**Interdit** : fetch d'une URL brute fournie par le client ; retirer/renommer un endpoint ;
oublier de régénérer le contrat ; faire passer l'`auth` dans `runs.params`.

# Décisions de design (figées — cf. §9.4)

1. **Panier accumulatif inter-dossiers** : `Map` keyée par `href`, persistante pendant la
   navigation. Item = `{href, name, parentUrl, is_dir, size?}`.
2. **UI** : **colonne de cases à cocher distincte** du lien de dossier (clic nom = naviguer ;
   case = (dé)sélectionner). Badge **compteur** + panneau voir/vider le panier. Au re-rendu d'un
   dossier déjà visité, **refléter l'état coché** depuis le panier. Classes `prep-*`.
3. **Deux actions conservées** : « Importer ce dossier entier » (sans `hrefs`) et « Importer la
   sélection (N) ».
4. **Soumission** : grouper le panier **par dossier parent**, puis
   - dossiers cochés → `import-remote(folderUrl)` (sans `hrefs`) ;
   - fichiers cochés → `import-remote(parentUrl, hrefs=[…fichiers de ce parent])` ;
   - **une soumission Job Center par groupe** ; report agrégé à l'écran.
   - **Dédup** : si un dossier ET des fichiers de ce dossier sont cochés, l'import dossier prime
     (fichiers redondants ignorés) — le signaler dans l'UI.
5. **Un seul `mode` + `language` (+ `include`)** pour toute la soumission (v1).
6. **Contrat** : `POST /import-remote` gagne **`hrefs: list[str]` optionnel**.
7. **Backend** : `hrefs` **filtre le listing PROPFIND de confiance**, ne le remplace pas. Les
   `hrefs` explicites **court-circuitent le glob `include`** ; fichier de mode incompatible →
   **erreur per-file reportée** (pas de crash).
8. **CLI** : pas de `--href` en v1.

# Livrables

## L1 — Backend ingestion
`remote/ingest.py` : ajouter `only_hrefs: set[str] | None = None` à `ingest_remote_folder`.
Après `files = [e for e in entries if not e.is_dir]` :
`if only_hrefs is not None: files = [e for e in files if e.href in only_hrefs]`.
(Le filtre glob `_matches` est sauté quand `only_hrefs` est fourni.) Tests unitaires :
sélection d'un sous-ensemble ; href inconnu ignoré ; sécurité (un href hors listing n'est
jamais téléchargé).

## L2 — Contrat + handler
`sidecar_contract.py` : champ `hrefs` (array de strings, optionnel) sur `import-remote`.
**Régénérer** `docs/openapi.json` + `tests/snapshots/openapi_paths.json`
(`python scripts/export_openapi.py`) et **committer**. Handler `import-remote` (`sidecar.py`,
**mince**) : parser `hrefs`, le passer au job runner → `ingest_remote_folder(only_hrefs=set(hrefs))`.
**Ne pas** logguer l'`auth` ; `hrefs` OK dans les params de job.

## L3 — Client API
`sidecarClient.ts` : `importRemote(...)` gagne `hrefs?: string[]` optionnel, typé sur le contrat.

## L4 — Écran (panier)
`ShareDocsImportScreen.ts` : modèle de panier accumulatif, cases à cocher, badge compteur,
panneau panier, bouton « Importer la sélection », groupement par parent + soumissions Job Center,
report agrégé. Helpers purs de groupement/dédup dans `lib/shareDocs.ts` (testables).

## L5 — Tests
Vitest : groupement par parent, dédup dossier-prime-sur-fichiers, état du panier à travers la
navigation. Pytest : `only_hrefs` (filtre + sécurité). Contract-freeze vert après régénération.

## L6 — Doc
`CHANGELOG.md` ; cocher P4C dans [DESIGN_sharedocs_ingestion.md](DESIGN_sharedocs_ingestion.md) ;
mettre à jour [docs/SIDECAR_API_CONTRACT.md](SIDECAR_API_CONTRACT.md) (champ `hrefs`).

# Conventions du repo
- `feat(engine): import-remote accepts explicit hrefs (only_hrefs filter)`
- `feat(prep): ShareDocs multi-select cart (folders + files)`
- `test(engine): only_hrefs filter + same-origin safety`
- `docs: document ShareDocs explicit-selection (Phase 4C) + regenerate contract`
- Pas de migration DB ; bump version uniquement si la politique du repo l'exige (sinon non).
- CI à rejouer (périmètre exact) : `ruff check src tests` + pytest ciblé
  (`-k "ingest or import_remote or webdav"`) + contract-freeze + builds/vitest des fronts.
  **Ne pas** lancer `pytest tests/` en entier en local (les `test_sidecar_*` figent).

# Ce qu'il NE FAUT PAS faire
- Télécharger un `href` qui n'est pas dans le listing PROPFIND du dossier (faille
  SSRF/exfiltration) — `only_hrefs` est un **filtre**, pas une source d'URLs.
- Grossir `sidecar.py` : la logique vit dans `remote/ingest.py`, le handler reste un adaptateur.
- Modifier la signature des importers (la provenance/dédup restent dans `_process_one`).
- Oublier la régénération du contrat (sinon CI rouge).

# Si tu butes
- Si la progression par groupe est confuse avec plusieurs jobs simultanés, soumettre les groupes
  **en série** et `// NOTE:` une éventuelle parallélisation.
- Si le panier inter-dossiers alourdit trop l'écran, livrer d'abord la sélection **dans le
  dossier courant** (toujours `hrefs`) puis l'accumulation en suivi — mais le design vise
  l'accumulation, donc le noter explicitement.

# Livrable attendu
4-6 commits + résumé : smoke (cocher des fichiers dans 2 dossiers → importer la sélection →
report agrégé), preuve que la régénération du contrat est commitée, les `// NOTE:`, et l'état
des gardes de sécurité (filtre `only_hrefs`).
