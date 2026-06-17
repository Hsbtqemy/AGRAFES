# Suivi des audits — finding → statut → commit

**But.** Vue *inverse* manquante (finding D-04 de l'audit 2026-06-12). Le CHANGELOG
référence déjà les findings dans le sens **commit → finding** (« C-08→C-13 : XSS
corrigé ») ; ce fichier fournit le sens **finding → statut → commit**, pour savoir
d'un coup d'œil si un item est clos sans avoir à lancer un `git log -S`.

**Légende statut.**
✅ corrigé · 🟦 partiel · 📝 documenté (assumé, sans correctif) · 🔵 connu/assumé (dette) · ⬜ ouvert · 🔎 à vérifier · ❌ réfuté / retiré

**Convention.** Mettre ce fichier à jour **dans le même commit** que le correctif
d'un finding (au même titre que le CHANGELOG). Les priorités (P0/P1/P2) reprennent
le §6 de l'audit 2026-06-12 ; « — » = non priorisé explicitement.

> État des correctifs ci-dessous : commit `ae78207` est sur la branche
> `fix/audit-business-logic` (depuis `development` à `373524b`), **en attente de
> merge** dans `development` à la rédaction de ce fichier.

---

## Audit 2026-06-12 (post-v0.2.6, base `373524b`) — `AUDIT_2026-06-12.md`

### Traités

| ID | Sév | Prio | Statut | Preuve / commit |
|----|-----|------|--------|-----------------|
| N-02 | 🟡 | P1-5 | ✅ corrigé | Re-flag des liens dans `_undo_merge_units`/`_undo_split_unit` + purge FK avant DELETE. Étendu à `_undo_resegment` (même crash FK, trouvé en revue). `ae78207`, tests `test_undo.py` |
| N-03 | 🟡 | P1-5 | ✅ corrigé | `links_created` via `cur.rowcount` aux 4 stratégies d'alignement (était `len(links)`). `ae78207`, test `test_alignment.py::test_align_links_created_excludes_ignored_duplicates` |
| N-05 | 🟡 | P1-5 | 📝 documenté | Race statut de job au shutdown : commentaire `sidecar_jobs.py` (~ligne 152). Fix fidèle = signal de commit côté runner, hors périmètre. `ae78207` |
| N-07 | 🟡 | P1-5 | ✅ corrigé | `bump_version.py` met à jour le `Cargo.toml` du shell (regex ancrée) + resync `0.1.28 → 0.2.6`. `ae78207` |
| Q-01 | 🟠 | P0-2 | ✅ corrigé | `[tool.ruff]` (E4/E7/E9/F, E741 ignoré) + job CI `lint` ; 57 violations résorbées (46 autofix, 5 vars, 1 dead). `1b12520` |
| T-01 | 🔴 | P0-2 | ✅ corrigé | Gate `--cov-fail-under=60` dans le step pytest CI (ratcheté depuis 35 ; couverture réelle CI = 61,94 %). `1b12520` |
| N-01 | 🟠 | P0-2 | ✅ corrigé | `dependabot.yml` étendu à pip/npm/cargo (4 apps + `src-tauri`), groupé hebdo. `1b12520` |
| — | — | — | ✅ bonus | CI déclenchée aussi sur `development` (les gates ne tiraient que sur `main`). `1b12520` |
| D-04 | 🟡 | P1-7 | ✅ corrigé | **Ce fichier** (vue inverse finding→statut→commit) |
| A-05 | — | — | ❌ retiré | Réfuté en passe 2 : les index secondaires existent (`003_alignment.sql`, `012_tokens.sql`) |

### Ouverts

| ID | Sév | Prio | Statut | Constat (résumé) |
|----|-----|------|--------|------------------|
| A-01 | 🔴 | P0-1 | ⬜ ouvert | `sidecar.py` monolithe (9 961 l., 93 handlers, pas de couche services) |
| A-02 | 🟠 | P0-1 | 🟦 partiel | `/import/preview` réimplémente les importers (`sidecar.py:2458`). Le router `dispatch_import` (branche `feat/sharedocs-ingestion-p1`) unifie l'**import** mais pas le **preview** |
| A-03 | 🟠 | P0-1 | ⬜ ouvert | 66 blocs de validation manuelle (pas de validateur de schéma) |
| A-04 | 🟡 | P2-13 | ⬜ ouvert | Attributs dynamiques non typés sur `HTTPServer` |
| Q-02 | 🟠 | P0-1 | ⬜ ouvert | Fonctions géantes ; `_build_hits` vs `_build_hits_regex` (~70 l. dupliquées) |
| Q-03 | 🟡 | — | ⬜ ouvert | `_compute_file_hash` redéfini dans 5 importers ; dup DOCX/ODT |
| Q-04 | 🟡 | P2-13 | ⬜ ouvert | Typage hétérogène ; pas de TypedDict pour les shapes de contrat |
| Q-05 | 🟡 | — | ⬜ ouvert | Matcher CQL : pas de cap global documenté (gardes présentes) |
| T-02 | 🟠 | P0-3 | ⬜ ouvert | Branches cœur `telemetry.py` / `curation.py` sans test direct |
| T-03 | 🟡 | P1-6 | ⬜ ouvert | 11 fichiers de tests versionnés à isoler sous `tests/contracts/` |
| T-04 | 🟡 | — | ⬜ ouvert | Fragilités timing (23 `time.sleep`) ; 8 tests exigent `NO_PROXY` en local |
| T-05 | 🟠 | — | ⬜ ouvert | E2E Tauri quasi inexistant (pas de Playwright/WebDriver) |
| S-01 | 🟡 | P1-8 | ⬜ ouvert | Pas de validation `Host`/`Origin` (DNS rebinding théorique, lecture seule) |
| S-02 | 🟡 | P1-8 | ⬜ ouvert | Race POSIX sur le portfile (`O_EXCL`/umask absents) |
| S-03 | 🟡 | P0-2 | 🟦 partiel | Sink type-safe `setHtml`/`safeHtml\`\`` + ESLint no-unsanitized (prep) ; 3 fichiers migrés, `f858c78`. Aucun vrai XSS trouvé (escapers tous vérifiés). **Reste** : 92 sites des 4 écrans géants + app/shell + job CI bloquant. Décision de reprise en attente (grind complet vs suppressions pour les géants). |
| S-04 | 🟡 | P1-8 | ⬜ ouvert | `exporters/tei.py` importe `xml.etree` non défusé (risque nul aujourd'hui) |
| U-01 | 🟠 | P1-4 | ⬜ ouvert | `sidecarClient.ts` dupliqué/divergent ; le shell importe **les deux** clients |
| U-02 | 🟠 | P2-11 | ⬜ ouvert | Écrans Prep monolithiques (Curation ~3 800 l., Metadata ~3 200 l.) |
| U-03 | 🟡 | P2-11 | ⬜ ouvert | `tauri-app` : 0 test pour 8 112 l. TS |
| U-04 | 🟡 | P2-12 | ⬜ ouvert | Signalisation de statut fragmentée entre READMEs |
| U-05 | 🟡 | — | ⬜ ouvert | i18n absent (chaînes FR en dur) — non bloquant |
| D-01 | 🟠 | P1-7 | ⬜ ouvert | ROADMAP/BACKLOG figés au 20-21 avril (dérive ~29 j) |
| D-02 | 🟠 | P1-7 | ⬜ ouvert | CHANGELOG 1 942 lignes sans archivage |
| D-03 | 🟠 | P2-10 | ⬜ ouvert | 267 artefacts trackés sans index (`audit/`, `artifacts/`) |
| D-05 | 🟡 | P2-12 | ⬜ ouvert | Aucun guide utilisateur final |
| D-06 | 🟡 | P1-7 | ⬜ ouvert | `API_VERSION` (1.6.23) vs `CONTRACT_VERSION` (1.6.27) — distinction non documentée |
| N-04 | 🟡 | P2-14 | 🔵 connu/assumé | Resegmentation écrase `text_raw` + supprime les liens (dette HANDOFF) ; à arbitrer en ADR |
| N-06 | 🟡 | P2-9 | ⬜ ouvert | `tauri-fixture` sans lockfiles ; CI en `npm install` |
| N-08 | 🟢 | — | ⬜ ouvert | Divers mineurs (sémantique reflag cible, lock télémétrie Windows, release-gate 3.12, etc.) |
| DEP-1\* | 🟢 | — | ✅ corrigé | `esbuild`/`vite`/`postcss` (devDeps, non embarqués) soldées par l'upgrade **vite 5→8** (PR #42). vite 8 (rolldown) embarque l'esbuild patché ; `npm audit` = 0 sur les 3 apps. Découvert en câblant N-01. |

\*Item dérivé (pas un finding d'audit), tracé pour ne pas perdre un « high » connu.

---

## Audits antérieurs — échantillon vérifié (pas un ré-audit exhaustif)

Statuts repris du §7 « Suivi des audits précédents » de `AUDIT_2026-06-12.md`
(échantillon contre-vérifié en passe 2). Pour le détail finding-par-finding des
33 findings de 2026-04-19, voir le CHANGELOG (sens commit→finding) et le fichier
d'audit correspondant.

| Finding | Audit | Statut | Preuve / commit |
|---------|-------|--------|-----------------|
| B7 — XSS `innerHTML` ActionsScreen | 2026-04-19 | ✅ corrigé | `td.textContent` (`ActionsScreen.ts`), commit `84e92be`, CHANGELOG « C-08→C-13 » |
| B6 — rollback import | 2026-04-19 | ✅ corrigé | ADR-040, try/except/rollback dans les importers |
| C-01 (AGRAFES-3) — lecture fichier arbitraire côté Rust | 2026-04-19 | ✅ corrigé | `read_sidecar_portfile` whitelisté, commit `0c4dc78` |
| Bloc C-01→C-13 / M-01→M-15 / F-01→F-05 / D-09 (33 findings) | 2026-04-19 | 🔎 voir CHANGELOG | « 33 findings résolus (v0.1.31) » (ROADMAP) — statut individuel à tracer ici au besoin |
| M-01 — zéro test frontend | 2026-03-26 | 🟦 partiel | 18 fichiers Vitest (Prep) ; reste ouvert pour `tauri-app` (→ U-03 2026-06-12) |
| W-01 / W-02 — monolithes | 2026-03-26 | 🟦 partiel | Extractions côté Prep faites ; `sidecar.py` + écrans géants demeurent (→ A-01, U-02) |
| F-03 — épinglage GitHub Actions par SHA | 2026-04-19 | ⬜ ouvert | Non traité (F-04 permissions ✅) — cf. ROADMAP « Next » |
