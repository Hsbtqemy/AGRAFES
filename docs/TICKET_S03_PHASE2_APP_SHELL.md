# TICKET — S-03 phase 2 : garde XSS `no-unsanitized` pour `tauri-app` & `tauri-shell`

> Cadrage (gelé avant ouverture). Suite de S-03 : la phase 1 + le burndown des 4 écrans
> géants ont rendu la garde **bloquante et pleinement stricte sur `tauri-prep`** (baseline
> 89 → 0, `eslint-suppressions.json` supprimé). Reste à étendre la même garde aux deux
> autres front-ends, qui n'ont **aucune** config ESLint aujourd'hui.

## 1. État des lieux (vérifié au code, 2026-06-21)

| Package | Config ESLint | Deps ESLint | Sink `safeHtml` | Sites `innerHTML` dynamiques |
|---|---|---|---|---|
| `tauri-app` | ❌ aucune | ❌ aucune | ❌ aucun | **29** / 9 fichiers (`stats.ts` 9, `buildUI.ts` 9, `query.ts` 3, `results.ts` 2, `filters.ts` 2, +4 : `main`/`bootstrap`/`importFlow`/`search` 1 ch.) |
| `tauri-shell` | ❌ aucune | ❌ aucune | ❌ aucun | **~32** / 3 fichiers (`shell.ts` 24, `rechercheModule.ts` 7, `explorerModule.ts` 1) |

(Comptes = affectations `.innerHTML =`/`+=` hors `= ""`. Le nombre réellement flaggé par
`no-unsanitized` sera ≤ ces bornes — les littéraux constants et interpolations
mono-échappées passent.)

**Escapers existants** (inventaire vérifié au code, 2026-06-21 — à auditer avant whitelist) :
- `tauri-app` :
  - `escapeHtml` (`ui/dom.ts:21`) et `_escHtml` (`features/stats.ts:56`) — **n'échappent PAS `"`** (seulement `& < >`) ; `escCsv` (`features/export.ts`, CSV, hors HTML).
  - ⚠️ **deux escapers `"`-incomplets *inline*** alimentent aussi un sink et **ne sont pas whitelistables par nom** (→ leurs sinks passent par le sink au burndown, pas de whitelist) : `main.ts:10` (replace inline `& < >`) → sink l. 11 ; `search.ts:210` (`esc` local `& < >`, **ré-injecte du `<span>`** après échappement — chemin FTS-preview, cf. §2) → sink l. 225.
- `tauri-shell` :
  - **Deux** `_esc` HTML *vivants*, identiques, échappant **`& < > "`** ✅ : `shell.ts:2801` (**18 sites** — c'est lui que `escape.methods` doit lister, omis du cadrage initial) et `modules/rechercheModule.ts:1900` ; `_escCqlVal` (`rechercheModule.ts:431`, CQL, hors HTML).
  - ⚠️ `shell.ts:2330` définit un `_escHtml` (`& < >`, **n'échappe PAS `"`**) **mais c'est du code mort** (0 appel) → **à supprimer** à l'amorce shell, et à **ne pas** whitelister.
  - Conséquence : shell ne nécessite **pas** de hardening `"` (ses escapers HTML vivants échappent déjà `"`) — mais pour cette raison-là, pas parce qu'il n'aurait qu'un seul escaper.

**Couplage shell → prep/app** : `tauri-shell` importe prep et app **au niveau source**
(`import … from "../../../tauri-prep/src/…"`, idem app). Conséquences :
- Le code prep/app que shell bundle est **déjà ganté** dans ses packages d'origine → le
  lint de shell ne doit couvrir que **son propre `src/`** (`shell.ts`, `modules/*`).
- shell peut **réutiliser `tauri-prep/src/lib/safeHtml.ts`** par import relatif (déjà la
  mécanique en place) — pas besoin d'un nouveau sink côté shell.

## 2. Enjeu sécurité (≠ prep)

`tauri-app` est le **concordancier** : il rend du **KWIC / texte de documents** et surligne
les **termes de requête utilisateur**. La surface XSS y est **plus réelle** que sur les
écrans de métadonnées de prep (qui rendaient surtout des champs courts). L'audit
d'échappement de `results.ts`/`query.ts`/`buildUI.ts` est donc le plus sensible de tout
le chantier S-03 — priorité à la vérification du rendu des résultats de recherche.

## 3. Décisions de cadrage

1. **Sink** :
   - `tauri-shell` → importe `setHtml`/`appendHtml`/`raw` depuis `../../../tauri-prep/src/lib/safeHtml.ts` (zéro nouveau fichier).
   - `tauri-app` → **copie autonome** `tauri-app/src/lib/safeHtml.ts` (≈65 l., identique à prep). Raison : app est un front-end **standalone** (build Explorer seul) ; le faire dépendre de prep au source le couplerait à tort (cf. séparation app/prep dans `CLAUDE.md`). Alternative écartée : sink partagé sous `shared/` (surdimensionné pour ~65 l. ; à reconsidérer seulement si app+shell divergent).
2. **Config ESLint** par package : ajouter les deps (`eslint`, `eslint-plugin-no-unsanitized`, `typescript-eslint`) + `eslint.config.mjs` calqué sur prep, avec un `escape.methods` ne listant que des escapers **vérifiés**.
   - **app** — whitelist : `escapeHtml` + `_escHtml` (les deux escapers **nommés**, après hardening `"`). Les deux escapers inline (`main.ts:10`, `search.ts` `esc`) ne sont **pas** listables par nom → leurs 2 sinks (`main.ts:11`, `search.ts:225`) passent par le sink au burndown.
   - **shell** — whitelist : `_esc` (un seul nom couvre `shell.ts` **et** `rechercheModule.ts`, mêmes 4 caractères `& < > "`). **Ne pas** lister `_escHtml` (`"`-incomplet) ; le supprimer car mort (cf. §1).
   - **Hardening préalable** : faire échapper `"` à `escapeHtml` et `_escHtml` de `tauri-app` (comme `_esc` d'AlignPanel) avant de les whitelister — sinon trou en contexte d'attribut. **Shell n'a pas besoin de hardening** : ses escapers HTML vivants échappent déjà `"` ; le seul `"`-incomplet (`shell.ts:2330 _escHtml`) est mort → suppression plutôt que durcissement.
3. **Baseline + burndown** : `eslint --suppress-all` → baseline par package, puis résorption **par fichier** avec l'audit d'échappement complet (méthode consignée : grep accès-propriété **non-ancré**, détecteur de templates imbriqués, audit des builders, classement non-sinks `textContent`/`value`/`setProperty`/`log`/`toast`). Voir mémoire `s03-xss-burndown-method`.
4. **CI** : scripts `lint`/`lint:prune` dans chaque `package.json` + steps bloquants `Lint tauri-app` (job `build-ts`) et `Lint tauri-shell` (job `build-shell`). Le lint shell pointe `src/**/*.ts` → ne lint **pas** les imports `../../../tauri-prep` (hors de son arbre `src/`).

## 4. Séquencement proposé (PR séparées, modèle des géants)

1. **app — amorce** : sink (copie) + hardening escapers + config + deps + baseline + step CI. (≈ phase 1 de prep, en une PR.)
2. **app — burndown** : 29 sites, audit d'échappement, baseline → 0. Priorité `results.ts`/`query.ts`/`buildUI.ts` (KWIC/requête).
3. **shell — amorce** : config + deps + import du sink prep + baseline + step CI.
4. **shell — burndown** : 32 sites (`shell.ts` 24 d'abord), baseline → 0.

(app et shell peuvent éventuellement fusionner amorce+burndown si le volume réel flaggé
est faible après baseline.)

## 5. Définition de fini

- `npm run lint` exit 0 sur app **et** shell, **sans** `eslint-suppressions.json` (baseline vidée).
- Steps CI `Lint tauri-app` + `Lint tauri-shell` verts et bloquants.
- Builds tsc+vite + vitest verts (app + shell).
- Tout `innerHTML` dynamique passe par le sink ; escapers whitelistés vérifiés (`"` inclus).
- Audit du concordancier (KWIC/requête) documenté dans la PR de burndown app.
