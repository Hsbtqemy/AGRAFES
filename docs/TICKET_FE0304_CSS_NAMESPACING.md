# FE-03/04 : namespacing CSS — résoudre les collisions de classes dans le shell

> **Statut : ⬜ ouvert (cadrage figé, à implémenter avec QA visuelle).** Suite
> directe des findings **FE-03/FE-04** (`docs/AUDIT_FOLLOW_UP.md`) et de la 4ᵉ passe
> d'investigation (2026-06-28). P0/P1/P2 de l'audit sont livrés ; ce volet a été
> **délibérément différé** car sa seule vérification est le **rendu visuel du shell**,
> que `tsc`/`vitest` ne couvrent pas (les classes CSS sont des chaînes, jamais rendues
> en test). Cette note est la référence de design et donne le périmètre exact.

Note de cadrage figée **avant** ouverture du ticket.

---

## 1. Le bug réel (vérifié, pas théorique)

Le shell (`tauri-shell`) embarque **prep + app dans une seule webview** et bundle
donc **les deux feuilles de style**. Toute classe définie dans les deux avec un
style **différent** entre en collision : la dernière règle chargée gagne, cassant le
rendu d'une des deux apps.

Collision **confirmée et visible** sur `.btn` :

| | `tauri-app` (`ui/dom.ts`) | `tauri-prep` (`ui/app.css`) |
|---|---|---|
| `.btn` | `padding: 8px 14px; border: 1.5px solid transparent;` | `padding: .35rem .9rem; border: none;` |

→ dans le shell, les boutons d'une des deux apps prennent le mauvais padding/bordure.

## 2. Périmètre exact : 9 classes, pas 277

L'audit estimait « ~30 (app) + ~90 (prep) classes non préfixées ». **Faux périmètre.**
L'intersection réelle des classes définies dans **app ET prep** (calcul :
`comm -12 <classes app> <classes prep>`, hors préfixes `app-`/`prep-`/`shell-`) =
**9 classes seulement** :

```
active  btn  btn-ghost  btn-primary  btn-secondary  chip  error  open  visible
```

**Décision : ne renommer QUE ces 9, et UNIQUEMENT côté `tauri-app` → `app-*`.**
Cela suffit à supprimer **toutes** les collisions app↔prep (les classes app
deviennent uniques), sans toucher aux 7 fichiers CSS de prep ni aux 268 autres
classes app (qui ne collisionnent avec personne). Le « tout préfixer » est hors
sujet : c'est de la dette de convention, pas un bug.

- CSS de `tauri-app` : **centralisée** dans `tauri-app/src/ui/dom.ts`, `const CSS`
  (≈ lignes 31→1781), injectée par `injectStyles()`.
- Usages des classes : attributs `class:"…"` dans les appels `elt(…)` et
  `classList.add/remove/toggle("…")` à travers `tauri-app/src/**`.

## 3. Pourquoi PAS un sed aveugle (les pièges)

Un remplacement de token naïf casse le style **sans que `tsc`/`vitest` ne le voient** :

1. **Piège suffixe `-btn`** : ~21 classes app finissent par `-btn` et **ne sont pas**
   la collision `btn` (`source-changed-btn`, `case-sensitive-btn`, `search-btn`,
   `load-more-btn`, `card-action-btn`, `meta-nav-btn`, …). Un `s/btn/app-btn/`
   les corromprait.
2. **Piège préfixe `error-*`** : `.error-banner` (app-only) ≠ collision `error`. Un
   `\.error\b` l'attraperait.
3. **Mots-état génériques** : `active`/`open`/`visible`/`error` apparaissent aussi en
   chaînes non-classe (mesuré : **2** occurrences ambiguës en TS app — gérable mais à
   traiter à la main).
4. **Sélecteurs globaux** : la CSS app a `:root`, `* {…}`, `body {…}` — l'approche
   alternative « scoper toute la CSS sous `.app-root` » casserait le fond/police en
   **standalone** (le `body` n'est plus stylé) → **écartée**.

## 4. Plan d'implémentation (lockstep CSS ↔ TS, patterns à frontière exacte)

Le renommage doit être **simultané** dans la CSS (définitions) et le TS (usages),
classe par classe, avec des patterns qui évitent les pièges du §3.

**Famille `btn` (5 classes : `btn`, `btn-ghost`, `btn-primary`, `btn-secondary`, `chip`)** —
sûres, contextes non ambigus :
- CSS (`dom.ts`) : `\.btn\b` → `.app-btn` (matche `.btn`, `.btn-primary`, `.btn:hover`,
  `.btn.active` ; **ne matche pas** `.card-action-btn` car le `btn` y est précédé de
  `-`, pas de `.`). Idem `\.chip\b` → `.app-chip`.
- TS (attributs/classList) : `([\s"'\`])btn\b` → `$1app-btn` (matche le **token**
  `btn`/`btn-primary` en début de token ; **ne matche pas** `source-changed-btn`).
  Idem `chip`.

**Mots-état (4 classes : `active`, `open`, `visible`, `error`)** — exiger un token
exact (pas de suffixe `-`) :
- CSS : `\.active\b(?!-)` → `.app-active`, idem `error`/`open`/`visible` (le `(?!-)`
  protège `.error-banner`, `.active-x`, …).
- TS : remplacer **uniquement** dans les contextes de classe (`classList.*("active")`,
  `class:"… active …"`, `className`), **à la main** pour les ~2 sites ambigus repérés.

## 5. Vérification (critères d'acceptation)

1. **Complétude (automatisable)** : après renommage, dans `tauri-app/src`,
   `grep` des **tokens bruts** en contexte de classe = **0** pour les 9
   (seuls les `app-*` subsistent). Aucune classe `*-btn`/`error-*` modifiée par
   erreur (diff relu).
2. **Build/tests** : `tsc --noEmit` + `vitest run` verts sur **app** (et `shell` :
   `tsc`), `eslint` clean. *(Nécessaire mais NON suffisant — ne valide pas le rendu.)*
3. **QA visuelle du shell (BLOQUANT, le vrai gate)** : lancer `tauri-shell`, ouvrir
   les modules **Constituer (prep)** et **Concordancier (app)** côte à côte, et
   vérifier que **les boutons des deux** (et les états `active`/`open`/`visible`,
   bannières `error`, `chip`) s'affichent correctement — c'est le seul test qui
   prouve la disparition de la collision sans régression.

## 6. FE-04 (prep) — réduit à de la convention après ce ticket

Une fois `tauri-app` namespacé, **plus aucune collision app↔prep** ne subsiste (les
9 partagées disparaissent côté app). Les classes non préfixées **internes** à prep
(`col-*`, `annot-*`, `family-dialog-*`, `jc-*`, …) ne collisionnent qu'entre elles
au sein de prep (pas de doublon de style) → **dette de convention, pas un bug**. À
traiter séparément/opportunément, sans urgence, et toujours avec QA visuelle.

---

**Réf.** `docs/AUDIT_2026-06-28.md` (FE-03/FE-04), `docs/AUDIT_FOLLOW_UP.md`
(ligne FE-03/04, investigation passe 4). CSS app : `tauri-app/src/ui/dom.ts`
`const CSS`. CSS prep : `tauri-prep/src/ui/*.css` (7 fichiers).
