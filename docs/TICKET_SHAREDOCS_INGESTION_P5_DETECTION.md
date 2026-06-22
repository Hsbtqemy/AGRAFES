# Mission : ShareDocs — Phase 5 (détection par fichier : format + langue)

Tu interviens sur le repo AGRAFES (branche dédiée `feat/sharedocs-p5-detection`, basée sur `dev`).

**Prérequis** : Phases 2-4 (A/B/C/D) mergées dans `dev`. Lis
[docs/DESIGN_sharedocs_ingestion.md](DESIGN_sharedocs_ingestion.md) **§11** (décisions
figées) et **`tauri-prep/src/screens/ImportScreen.ts`** (la détection à réutiliser :
`_deriveModeFromExt`, `_normalizeModeForExt`, `modeOptionsForExt`, `_LANG_RE`,
`_KNOWN_LANG_CODES`, `WP_DEFAULT_*`, `_extFromFileName`).

# Contexte

Un import ShareDocs par lot doit se comporter comme le **menu Import local** : chaque
fichier importé avec **son** format (extension) et **sa** langue (nom de fichier),
plutôt qu'un mode + une langue uniques pour tout le lot. Débloque notamment les
**dossiers bilingues** (texte + traduction). On **réutilise** la détection existante
de `ImportScreen` (une seule source de vérité) — interdit de réinventer une variante.

# Périmètre

**Front-only, aucun changement moteur/contrat** (réutilise `hrefs` + `mode`/`language`
par appel `import-remote`, contrat 1.6.29 inchangé). Forks tranchés : **familles
différées**, **dossiers cochés étendus + routés** (PROPFIND).

**Interdit** : toucher au backend/contrat ; réinventer la détection (réutiliser
`importDetect`) ; auto-détecter le style numéroté/paragraphes ou `resource_type`.

# Décisions de design (figées — §11)

1. **Module partagé** `tauri-prep/src/lib/importDetect.ts` (pur, testable) : extraire
   `extFromFileName`, `deriveModeFromExt(ext, defaultProfile)`, `normalizeModeForExt`,
   `modeOptionsForExt`, `detectLanguageFromName(name, fallback)` (+ `LANG_RE` +
   `KNOWN_LANG_CODES`), `WP_DEFAULT_NUMBERED`/`WP_DEFAULT_PARAGRAPHS`. **Refactorer
   `ImportScreen` pour l'utiliser sans changement de comportement.**
2. **ShareDocs formulaire** : « Mode d'import » → **« Profil par défaut »** (style :
   numéroté / paragraphes) ; « Langue » → **« Langue par défaut (si non détectée) »**.
3. **Aplatissement** : « Importer ce dossier » = fichiers de `_entries` ; « Importer
   la sélection » = fichiers cochés **+** chaque **dossier coché → `webdavList`**
   (Depth:1) pour ses fichiers. Erreur PROPFIND d'un dossier → reportée, n'interrompt
   pas le reste.
4. **Extensions non reconnues ignorées** (`detectFormatFromName === "unknown"`),
   comptées dans le récap (ni import ni erreur).
5. Par fichier : `mode = normalizeModeForExt(deriveModeFromExt(ext, profil), ext)`,
   `language = detectLanguageFromName(name, langueDéfaut)`.
6. **Grouper par `(parentUrl, mode, language)`** → un `import-remote` par groupe ;
   suivi Job Center, rapports agrégés (réutilise P4C/P4D).
7. **UI** : le panier affiche le **(mode, langue) détectés** par fichier (remplace le
   drapeau ⚠ format de P4D). **Récap + `inlineConfirm`** si fichiers ignorés ou
   dossiers à étendre. **Annulation de lot** (P4D) conservée.
8. **Hors périmètre** : familles/`translation_of` (différé) ; grille d'édition
   (mode, langue) par fichier avant import (différé — détection erronée rattrapée en
   post-import ou via l'annulation) ; style non détecté ; `resource_type`/`doc_role`.

# Livrables

## L1 — Module partagé + refactor ImportScreen
`importDetect.ts` (pur) + `ImportScreen` consomme le module. **Tests Vitest** sur les
fonctions pures (déjà couvertes implicitement — ajouter des cas directs) ; non-régression
de l'import local (build + suite vitest verte).

## L2 — ShareDocs : détection + groupement
Formulaire (profil/langue par défaut), aplatissement (avec expansion PROPFIND des
dossiers cochés), filtrage des extensions inconnues, dérivation (mode, langue) par
fichier, groupement `(parentUrl, mode, language)`, un `import-remote` par groupe.
Helpers purs de groupement testables dans `lib/shareDocs.ts`.

## L3 — UI
Panier : (mode, langue) détectés par fichier (retirer le drapeau ⚠ format). Récap +
`inlineConfirm` (ignorés / expansion). Réutiliser `_guardedRun`.

## L4 — Tests
Vitest : `importDetect` (mode par extension, langue par nom, fallback) ; groupement
ShareDocs par (parent, mode, langue) ; non-régression import local.

## L5 — Doc
`CHANGELOG.md` ; cocher Phase 5 dans [DESIGN](DESIGN_sharedocs_ingestion.md).

# Conventions du repo
- `refactor(prep): extraire la détection format/langue d'import dans importDetect`
- `feat(prep): ShareDocs détecte format + langue par fichier (réutilise importDetect)`
- `test(prep): importDetect + groupement ShareDocs par (mode, langue)`
- `docs: documenter la détection par fichier ShareDocs (Phase 5)`
- Pas de migration, pas de bump version, pas de changement de contrat.
- CI : `npm --prefix tauri-prep run build && npm --prefix tauri-prep test` + eslint ;
  `npm --prefix tauri-shell run build` (couplage source).

# Ce qu'il NE FAUT PAS faire
- Réinventer la détection (réutiliser `importDetect`, sinon dérive avec l'import local).
- Toucher au backend/contrat (tout est front via `hrefs` + `mode`/`language`).
- Écarter en silence des fichiers (les inconnus sont **comptés** au récap).
- Casser le comportement de l'import local lors de l'extraction (tests de non-régression).

# Si tu butes
- Si l'expansion PROPFIND des dossiers cochés alourdit trop, livrer d'abord la
  détection sur le **dossier courant** (« Importer ce dossier ») + fichiers cochés,
  et `// NOTE:` l'expansion des dossiers cochés en suivi.

# Livrable attendu
4-6 commits + résumé : smoke (un dossier bilingue `*_fr` / `*_en` → « Importer ce
dossier » → chaque fichier avec sa langue/son format), non-régression import local,
les `// NOTE:`, recommandation pour les familles (Phase 6).
