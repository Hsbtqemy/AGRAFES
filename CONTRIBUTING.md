# Contributing to AGRAFES

Bienvenue. Ce document trace les règles d'engagement du projet — branches, commits, releases, et quelques gates spécifiques (croissance code, etc.).

## Branches & workflow

- **Une seule branche active** : `development`. Pas de `main`/`master` séparés.
- Commits directs sur `development` autorisés pour les fixes mineurs et le travail en cours.
- PRs recommandées pour les features non-triviales et les refactors structurants.
- Tags `v0.1.X` lightweight signés (`git tag -s`) depuis commits `chore(release): vX.Y.Z`.

## Conventional commits

Préfixes acceptés :

- `feat(scope):` — nouvelle fonctionnalité
- `fix(scope):` — correction de bug
- `chore(release):` — bump de version
- `docs:` — documentation
- `refactor(scope):` — refactor sans changement de comportement
- `test(scope):` — tests
- `ci:` — workflows CI

Le `scope` désigne typiquement le composant : `prep`, `shell`, `app`, `engine`, `curation`, `segmentation`, etc.

Les commits Co-authored avec Claude doivent inclure le footer :

```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

## Versionnage

```bash
python scripts/bump_version.py --engine X.Y.Z --shell X.Y.Z
```

Synchronise `pyproject.toml`, `src/multicorpus_engine/__init__.py`, `tauri-shell/src-tauri/tauri.conf.json`, `tauri-shell/src/shell.ts:APP_VERSION`, et `tauri-shell/package.json`.

Voir [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md) pour la procédure complète.

## Tests

- **Engine** : `pytest -q` à la racine. Smoke E2E : `python scripts/ci_smoke_sidecar.py`.
- **tauri-prep** : `npm --prefix tauri-prep run test` (Vitest).
- **tauri-app** : `node tauri-app/scripts/test_buildFtsQuery.mjs` (tests purs Node).
- **tauri-shell** : `node tauri-shell/scripts/test_diagnostics.mjs` (idem).

Les PRs ne sont mergées que si les workflows CI sont verts.

---

## Sidecar growth gate

Le fichier `src/multicorpus_engine/sidecar.py` est aujourd'hui à ~9400 lignes et 178 handlers HTTP. Pour éviter qu'il continue à grossir indéfiniment via des PRs incrémentales sous le radar, un workflow CI vérifie la **croissance nette sur fenêtre glissante 90 jours**.

### Règle

- **Métrique** : `git log --numstat --since="90 days ago" -- src/multicorpus_engine/sidecar.py` → somme `add - del`.
- **Seuil** : 500 lignes nettes ajoutées sur 90 jours.
- **Si dépassement** : la PR est bloquée. Un refactor de découpage par domaines (routers : imports, curation, alignement, query, exports, jobs) est requis avant de fusionner toute nouvelle feature.

### Pourquoi cette règle ?

Le seuil par-PR (« max +300 lignes par PR ») est gameable : on découpe en deux PRs et le seuil disparaît. La fenêtre glissante force un check à un rythme régulier indépendamment du découpage des PRs. L'incitation est alignée avec l'objectif : limiter la croissance globale, pas une métrique cosmétique.

`add - del` (croissance nette) plutôt que `add + del` (churn) — on veut décourager la croissance, pas pénaliser les vrais refactors qui suppriment plus qu'ils n'ajoutent.

### Override d'urgence

Pour un fix sécurité critique qui ne peut pas attendre le refactor (CVE, faille exploitable), ajouter un trailer dans le **dernier commit de la PR** :

```
fix(security): patch CVE-2026-XXXX dans curate handler

Description du fix.

Sidecar-Growth-Override: CVE-2026-XXXX requires immediate fix,
refactor scheduled in v0.2.0
Co-Authored-By: ...
```

Le workflow grep le trailer dans le head commit, accepte la PR avec un warning visible. Le motif est tracé pour toujours dans l'historique git (auditable, pas de secret).

**L'override n'efface pas la dette** : le refactor reste obligatoire dès que la pression critique est levée. Documentation explicite dans la PR de suivi.

### Workflow

[.github/workflows/sidecar-growth-gate.yml](.github/workflows/sidecar-growth-gate.yml) — déclenché sur toute PR qui touche `src/multicorpus_engine/sidecar.py`.

---

## Curation regex (depuis v0.1.41)

Le module `curation.py` utilise désormais le package `regex` (PyPI) au lieu de la stdlib `re`, pour supporter les classes Unicode (`\p{L}`, `\X`, POSIX `[[:alpha:]]`).

**Avant toute migration future** ou modification massive de la grammaire des patterns acceptés, lancer :

```bash
python scripts/validate_regex_migration.py path/to/corpus.db [...autres.db]
```

Le script flag les patterns persistés en DB qui ont un comportement différent entre `re` (stdlib) et `regex.V0` (PyPI), ainsi que ceux qui utilisent des syntaxes POSIX/Unicode dont la sémantique change. Exit 0 = safe, exit 1 = audit humain requis.

`regex.V0` est forcé dans `curation.py` pour éviter le silent V1 auto-switch.

---

## Modal & dialog dans le frontend

**Ne jamais utiliser** `window.confirm()`, `window.alert()`, `window.prompt()` natifs — non fiables cross-platform sur Tauri 2 (cf. [docs/TAURI_UPSTREAM_ISSUE_DRAFT.md](docs/TAURI_UPSTREAM_ISSUE_DRAFT.md)).

À la place :

- [tauri-prep/src/lib/modalConfirm.ts](tauri-prep/src/lib/modalConfirm.ts) — modal centré générique avec backdrop, Échap, focus auto sur Cancel pour `danger: true`.
- [tauri-prep/src/lib/inlineConfirm.ts](tauri-prep/src/lib/inlineConfirm.ts) — confirmation inline strip dans un container existant.

---

## CSS namespacing

- `tauri-prep` : namespace `prep-*`
- `tauri-app` : namespace `app-*`
- `tauri-shell` : namespace `shell-*`

Pas de classe sans préfixe — Shell embarque les CSS de prep+app au build, les conflits sont possibles. Migration vers CSS Modules en backlog.

---

## Pointeurs

- [HANDOFF_SHELL.md](HANDOFF_SHELL.md) — briefing complet pour nouvel intervenant
- [docs/DECISIONS.md](docs/DECISIONS.md) — ADRs
- [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md) — procédure release
- [docs/SIDECAR_API_CONTRACT.md](docs/SIDECAR_API_CONTRACT.md) — référence API
