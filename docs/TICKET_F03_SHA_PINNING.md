# F-03 : épingler les GitHub Actions au SHA (supply-chain)

> **Statut : ✅ complet (Option B PR #166 + Option A empilée).** Finding **F-03** de
> l'audit (`docs/AUDIT_FOLLOW_UP.md`). Lot **indépendant** des PR P0–P3 (ne touche que
> `.github/workflows/`), **sans QA visuelle**.
>
> **Option B** (PR #166) : `dtolnay/rust-toolchain` (×3, + `with: toolchain: stable`),
> `softprops/action-gh-release` (×2), `Swatinem/rust-cache` (×2) — 7 occurrences tierces
> (le gros du risque), dans des workflows **tag/dispatch-only** (non exercés par la CI PR).
>
> **Option A** (ce lot) : les 6 actions first-party `actions/*` — **77 occurrences** —
> épinglées au SHA. Contrairement à B, elles vivent surtout dans `ci.yml`/`smoke.yml`
> (**PR-déclenchés**) → **réellement exécutées et validées par la CI de ce PR**.

Note de cadrage figée **avant** ouverture du ticket.

---

## 1. Le risque (réel, pas théorique)

Une action référencée par **tag mutable** (`@v4`) ou pire par **branche** (`@stable`)
peut être **réécrite** par son mainteneur (ou un attaquant ayant compromis le compte) :
le tag/branche pointe alors vers du code malveillant qui s'exécute **dans nos runners
CI**, y compris dans `release.yml` / `*-sign-*.yml` qui détiennent les **secrets de
signature/notarisation** et le `GITHUB_TOKEN` de publication. Épingler au **SHA de
commit** (40 hex) rend la référence **immuable** : le code exécuté ne peut plus changer
sous nos pieds.

Dependabot (déjà configuré, `.github/dependabot.yml`, écosystème `github-actions` à `/`)
**comprend les pins SHA** et ouvrira des PR de bump hebdomadaires — donc pinner ne fige
pas les mises à jour, il les rend **revues une par une** au lieu d'automatiques.

## 2. Inventaire (14 workflows, 9 actions distinctes)

| Action | Occur. | Pin actuel | Type | Priorité |
|---|---|---|---|---|
| `dtolnay/rust-toolchain` | 3 | `@stable` (**branche**) | tiers | 🔴 **haute** (branche mouvante + ⚠️ piège §4) |
| `softprops/action-gh-release` | 2 | `@v2` | tiers | 🔴 haute (tourne dans `release.yml`, secrets) |
| `Swatinem/rust-cache` | 2 | `@v2` | tiers | 🟠 moyenne |
| `actions/checkout` | 27 | `@v4` | first-party GitHub | 🟡 best-practice |
| `actions/setup-python` | 16 | `@v5` | first-party | 🟡 |
| `actions/upload-artifact` | 15 | `@v4` | first-party | 🟡 |
| `actions/setup-node` | 8 | `@v4` | first-party | 🟡 |
| `actions/download-artifact` | 7 | `@v4` | first-party | 🟡 |
| `actions/cache` | 4 | `@v4` | first-party | 🟡 |

Les **3 tiers** sont la vraie valeur sécurité ; les `actions/*` (first-party GitHub)
sont du best-practice. **Décision : tout pinner** (le coût marginal est nul, c'est
mécanique) pour fermer le finding en entier — mais traiter les 3 tiers d'abord si on
veut un sous-lot minimal.

## 3. SHA résolus (2026-06-28 — re-vérifier si exécution > quelques semaines)

Convention : `uses: owner/repo@<sha>  # <version>` (le commentaire garde la lisibilité
et sert de cible à Dependabot).

```
actions/checkout            @34e114876b0b11c390a56381ad16ebd13914f8d5  # v4.3.1
actions/setup-python        @a26af69be951a213d495a4c3e4e4022e16d87065  # v5.6.0
actions/upload-artifact     @ea165f8d65b6e75b540449e92b4886f43607fa02  # v4.6.2
actions/setup-node          @49933ea5288caeca8642d1e84afbd3f7d6820020  # v4.4.0
actions/download-artifact   @d3f86a106a0bac45b974a628896c90dbdf5c8093  # v4.3.0
actions/cache               @0057852bfaa89a56745cba8c7296529d2fc39830  # v4.3.0
softprops/action-gh-release @3bb12739c298aeb8a4eeaf626c5b8d85266b0e65  # v2.6.2
Swatinem/rust-cache         @e18b497796c12c097a38f9edb9d0641fb99eee32  # v2
dtolnay/rust-toolchain      @29eef336d9b2848a0b548edc03f92a220660cdb8  # stable (voir §4)
```

Re-résoudre avant d'exécuter : `gh api repos/<owner>/<repo>/commits/<tag> --jq .sha`.

## 4. Le piège `dtolnay/rust-toolchain` (pourquoi PAS un sed aveugle)

Cette action **sélectionne le canal Rust via le ref git** : `@stable` n'est pas une
version de l'action, c'est la **branche** dont l'`action.yml` met `toolchain: stable`
par défaut. Pinner `@<sha>` fige le code de l'action **et** ce défaut — mais s'appuyer
sur un défaut implicite au commit pinné est fragile.

**Les 3 usages** (`tauri-shell-build.yml:60`, `macos-sign-notarize.yml:115`,
`tauri-e2e-fixture.yml:137`) appellent `@stable` **sans** `with: toolchain:`. En pinnant
au SHA, il **faut ajouter l'input explicite** :

```yaml
      - uses: dtolnay/rust-toolchain@29eef336d9b2848a0b548edc03f92a220660cdb8  # stable
        with:
          toolchain: stable
```

Sans ça, le canal installé dépendrait silencieusement du défaut du commit pinné.

> **Limite connue (Dependabot)** : la dtolnay est commentée `# stable` (une *branche*,
> pas un semver) → Dependabot ne sait **pas** la bumper automatiquement, contrairement
> aux pins commentés `# vX.Y.Z`. Conséquence : le *code de l'action* reste figé au SHA
> jusqu'à une mise à jour manuelle, mais le **canal Rust reste à jour** (sélectionné par
> `toolchain: stable` au runtime). Compromis assumé : pinner (immuable, sûr) prime sur
> l'auto-bump pour cette action à faible churn. Re-pinner à la main périodiquement via
> `gh api repos/dtolnay/rust-toolchain/commits/stable --jq .sha`.

## 5. Vérification (critères d'acceptation)

1. **Complétude** : `grep -rE "uses:\s*[^ ]+@(v[0-9]|stable|main|master)" .github/workflows/`
   ne retourne **plus rien** (tous les `uses:` sont `@<sha40>  # comment`).
2. **YAML valide** : GitHub **parse** tout workflow modifié à l'ouverture du PR (un YAML
   cassé apparaît en erreur de workflow), donc la syntaxe est validée même sans exécution.
   Pour les actions présentes dans des workflows **PR-déclenchés** (`ci.yml`, `smoke.yml` —
   c'est-à-dire surtout les `actions/*` de l'**Option A**), la CI de PR **exécute**
   réellement les jobs → un mauvais SHA y casse immédiatement.
3. **⚠️ Angle mort des actions tierces (Option B)** : les 7 occurrences tierces vivent
   **uniquement** dans des workflows **`tag`/`workflow_dispatch`-only** —
   `tauri-shell-build.yml`, `tauri-e2e-fixture.yml`, `release.yml`, `macos-sign-notarize.yml`.
   **Aucun ne tourne sur une PR `dev`** → la CI de PR ne les **exécute pas**. Relire leurs
   SHA **à la main** (fait) ; validation réelle au **prochain push de tag** (release) ou via
   un `workflow_dispatch`. ⚠️ Ne **pas** dispatcher `tauri-shell-build` sur une branche : son
   step `softprops` utilise `tag_name: github.ref_name` **sans garde de tag** → release bidon.
4. **Dependabot** : aucune modif requise (`github-actions` déjà couvert). Vérifier après
   coup qu'un éventuel PR Dependabot cible bien le commentaire de version.

## 6. Découpage suggéré

- **Option A (complet, recommandé)** : pinner les 9 en un PR. Diff mécanique large mais
  homogène ; ferme F-03 d'un coup.
- **Option B (minimal)** : pinner d'abord les **3 tiers** (`dtolnay`, `softprops`,
  `Swatinem`) — 80 % du risque pour 7 occurrences — puis les `actions/*` dans un second
  temps.

**Réf.** `docs/AUDIT_FOLLOW_UP.md` (F-03), `.github/dependabot.yml`,
`.github/workflows/*.yml`. SHA résolus via `gh api repos/<o>/<r>/commits/<tag>`.
