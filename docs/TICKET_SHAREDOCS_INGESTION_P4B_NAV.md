# Mission : ShareDocs — Phase 4B (navigation : préremplissage racine / preset)

Tu interviens sur le repo AGRAFES (branche dédiée `feat/sharedocs-p4b-nav`, basée sur `dev`).

**Prérequis** : Phase 4A mergée (le formulaire de connexion a déjà été clarifié et persiste les
identifiants). Lis [docs/DESIGN_sharedocs_ingestion.md](DESIGN_sharedocs_ingestion.md) **§9.3** et
`tauri-prep/src/screens/ShareDocsImportScreen.ts` (sections « Connexion » et « Dossier »).

# Contexte

Aujourd'hui l'utilisateur doit **coller une URL WebDAV profonde** (`…/remote.php/dav/files/<lui>/<dossier>/`)
pour démarrer — il faut connaître le chemin exact. On réduit cette friction : un bouton qui
**préremplit la racine WebDAV** à partir du serveur + identifiant déjà saisis, puis l'utilisateur
**navigue** (la navigation existe déjà : clic dossier = entrer, « ← Retour », fil d'Ariane).

# Périmètre

Petit, **front-end uniquement**. Lire la zone « Connexion »/`_connect`/`_browse` de
`ShareDocsImportScreen.ts` et `normalizeFolderUrl`/`folderLabel` dans `lib/shareDocs.ts`.

**Interdit** : coupler en dur la logique d'import à Nextcloud ; toucher au backend/contrat ;
auto-lancer des appels réseau au montage sans action utilisateur.

# Décisions de design (figées — cf. §9.3)

1. **Conserver le champ URL** (saisie/collage libre) + ajouter un bouton **« Préremplir
   (ShareDocs Huma-Num) »** qui *template* `https://<hôte>/remote.php/dav/files/<identifiant>/`
   à partir d'un hôte et de l'identifiant saisis. Le champ reste **éditable** ensuite.
2. **Aucun couplage Nextcloud en dur** dans la logique d'import : le template est une simple
   aide de saisie côté UI ; le connecteur reste générique WebDAV.
3. Navigation existante **inchangée** (entrer dans un dossier, retour, fil d'Ariane).
4. Copie : préciser que « Importer ce dossier » ingère **tout** le dossier (filtré par mode +
   glob `include`).

# Livrables

## L1 — Helper pur
`lib/shareDocs.ts` : `buildNextcloudRoot(host, user) -> string` (gère hôte avec/sans schéma,
slash final), testable isolément. Tolérant aux entrées vides (retourne `""`).

## L2 — Écran
Bouton « Préremplir (ShareDocs Huma-Num) » dans la section Connexion (désactivé tant que
hôte/identifiant absents) → remplit `#prep-sd-url`. Ajuster la copie « Importer ce dossier ».
Classes `prep-*`.

## L3 — Tests
Vitest sur `buildNextcloudRoot` (cas hôte nu, hôte avec schéma, identifiant vide, slash).

## L4 — Doc
`CHANGELOG.md` ; cocher P4B dans [DESIGN_sharedocs_ingestion.md](DESIGN_sharedocs_ingestion.md).

# Conventions du repo
- `feat(prep): ShareDocs root-URL prefill (Huma-Num preset)`
- `test(prep): buildNextcloudRoot`
- `docs(prep): document ShareDocs navigation prefill (Phase 4B)`
- Pas de migration, pas de bump version.
- CI : `npm --prefix tauri-prep run build && npm --prefix tauri-prep test`.

# Ce qu'il NE FAUT PAS faire
- Auto-détecter/forcer Nextcloud dans la logique d'import (template UI seulement).
- Lancer un PROPFIND au montage sans clic « Connecter ».

# Si tu butes
- Si l'hôte saisi est ambigu (avec/sans `https://`, avec chemin), normaliser au mieux et
  laisser l'utilisateur corriger le champ éditable ; `// NOTE:` les cas tordus.

# Livrable attendu
2-3 commits + résumé : smoke (préremplir → connecter → naviguer), `// NOTE:`, recommandation P4C.
