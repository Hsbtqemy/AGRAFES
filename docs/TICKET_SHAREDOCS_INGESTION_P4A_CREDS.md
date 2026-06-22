# Mission : ShareDocs — Phase 4A (persistance des identifiants + clarté du formulaire)

Tu interviens sur le repo AGRAFES (branche dédiée `feat/sharedocs-p4a-creds`, basée sur `dev`).

**Prérequis** : Phases 1-3 mergées (écran `tauri-prep/src/screens/ShareDocsImportScreen.ts`
existe, routes `webdav/list` + `import-remote` opérationnelles). Lis
[docs/DESIGN_sharedocs_ingestion.md](DESIGN_sharedocs_ingestion.md) **§9.1 + §9.2** (décisions
figées), [HANDOFF_PREP.md](../HANDOFF_PREP.md) et [HANDOFF_SHELL.md](../HANDOFF_SHELL.md).

# Contexte

Les identifiants ShareDocs sont aujourd'hui **mémoire-seule** (décision §6 / ticket P3).
Problème réel : le **mot de passe d'application Nextcloud n'est affiché qu'une fois** à sa
création ; en mémoire-seule, l'utilisateur doit en **régénérer un à chaque session** (chemin
long : se connecter à ShareDocs → Réglages → Sécurité → créer une app → copier). On persiste
donc le secret **dans le trousseau OS** (opt-in « Se souvenir »), ce qui ramène ce chemin à
« une fois dans la vie ». En parallèle on rend le formulaire explicite pour lever la confusion
(quelle URL, quel mot de passe).

# Périmètre

Avant de coder, **lire** : `tauri-shell/src-tauri/src/main.rs` (pattern des commandes
`#[tauri::command]` + `generate_handler!`, ex. `read_sidecar_portfile`), `shared/sidecarCore.ts`
(usage de `invoke`), un écran Prep qui persiste dans `localStorage` (ex. `ActionsScreen.ts`),
et `ShareDocsImportScreen.ts` + `lib/shareDocs.ts`.

**Interdit** : écrire un secret en clair sur disque (`localStorage` / config / db) ; toucher au
moteur Python / au contrat sidecar ; ajouter une dépendance front lourde.

# Décisions de design (figées — cf. §9.2)

1. **Stockage secret = trousseau OS** via la crate Rust **`keyring`**. Trois commandes Tauri
   dans `tauri-shell/src-tauri/src/main.rs` : `keyring_get(service, account) -> Option<String>`,
   `keyring_set(service, account, secret)`, `keyring_delete(service, account)`. Enregistrées
   dans `generate_handler!`. Erreurs remontées en `Result<_, String>` (jamais de panic).
2. **Clé** : service `agrafes.sharedocs`, compte `origin|mode|user` (`origin` =
   `scheme://host[:port]`). Plusieurs serveurs/comptes mémorisés sans collision.
3. **Non-secret en `localStorage`** : dernier `{url, mode, user, remember}`. L'**identifiant
   est non-secret** ; **seuls** `password`/`token` vont au trousseau.
4. **Sauvegarde uniquement après un “Connecter” réussi** (PROPFIND 200). Préremplissage du
   dernier au montage (et du secret si `remember` + présent au trousseau). Lien **« Oublier »**
   → purge trousseau + `localStorage`.
5. **Repli gracieux** : si `invoke`/trousseau indisponible (prep standalone, Linux sans
   libsecret) → mémoire-seule + toast informatif, **jamais de crash**.
6. **Périmètre v1 : shell uniquement.** macOS/Linux/prep-standalone = features `keyring`
   ultérieures.

# Livrables

## L1 — Coffre Rust (shell)
`Cargo.toml` : `keyring = { version = "3", features = ["windows-native"] }`. Les 3 commandes
dans `main.rs` + enregistrement. Compile en debug (`tauri dev`).

## L2 — Wrapper JS
`tauri-prep/src/lib/credentialStore.ts` : `secureGet/secureSet/secureDelete` (try/catch →
`null`/no-op sur échec) + helpers `localStorage` pour le non-secret. Pur côté logique testable.

## L3 — Helpers purs
`lib/shareDocs.ts` : `keyringAccount(url, mode, user) -> string` (clé `origin|mode|user`),
testable isolément.

## L4 — Écran
`ShareDocsImportScreen.ts` : case **« Se souvenir de mes identifiants (chiffrés par le
système) »** ; préremplissage au montage ; sauvegarde post-connexion réussie ; lien
« Oublier ». **Clarté** : aide sous l'URL, modes relabellés (« Anonyme — dépôt public » /
« Identifiant + mot de passe » / « Jeton d'accès (Bearer) »), **note sous le mode basic**
(mot de passe d'application Nextcloud / humanID-2FA). Classes CSS préfixées `prep-*`.

## L5 — Tests
Vitest : `keyringAccount`, `credentialStore` avec `invoke` mocké (succès + repli), états du
formulaire. Mocker le seam `invoke` comme dans `__tests__/sidecarCore.connection.test.ts`.

## L6 — Doc
`CHANGELOG.md` `[Unreleased] / Added` ; cocher P4A dans
[DESIGN_sharedocs_ingestion.md](DESIGN_sharedocs_ingestion.md) §5/§9.

# Conventions du repo
- `feat(shell): keyring commands for ShareDocs credential persistence`
- `feat(prep): remember ShareDocs credentials via OS keychain + clearer form`
- `test(prep): credentialStore fallback + keyringAccount`
- `docs(prep): document ShareDocs credential persistence (Phase 4A)`
- Pas de migration DB. Pas de bump version (front + Rust shell uniquement).
- CI à rejouer : `npm --prefix tauri-prep run build && npm --prefix tauri-prep test` +
  `npm --prefix tauri-shell run build` + compilation `tauri dev` (Rust).

# Ce qu'il NE FAUT PAS faire
- Persister un secret en clair (le trousseau, **rien d'autre**, pour le secret).
- Toucher au moteur Python / au contrat (P4A est front + Rust shell).
- Laisser un échec trousseau casser la connexion : **toujours** dégrader en mémoire-seule.

# Si tu butes
- Si la crate `keyring` v3 a une API/feature différente sur Windows, adapter la feature
  (`windows-native`) et `// NOTE:` le détail ; l'important = `get/set/delete` fonctionnels.
- Si l'intégration dans le shell est ambiguë (commandes invoquées depuis le webview prep),
  vérifier que `invoke` résout bien vers les commandes du **shell** à l'exécution.

# Livrable attendu
3-4 commits + résumé : ce qui marche (smoke : se souvenir → fermer → rouvrir → préremplissage),
ce qui dégrade (repli), les `// NOTE:`, et recommandation pour P4B/P4C.
