# Mission : ShareDocs — Phase 6A (extraire la détection de familles en module partagé)

Tu interviens sur le repo AGRAFES (branche dédiée `feat/sharedocs-p6-families`, basée sur `dev`).

**Prérequis** : Phase 5 + suivi P5 mergés dans `dev` (#106). Lis
[docs/DESIGN_sharedocs_ingestion.md](DESIGN_sharedocs_ingestion.md) **§12** (décisions
figées) et **`tauri-prep/src/screens/ImportScreen.ts`** : la détection à réutiliser
(`detectFamilyGroups`, `LANG_RE`) et la bannière locale (`_renderFamilyDetectionBanner`).

# Contexte

La détection de familles (radical commun + tokens de langue distincts) vit aujourd'hui
en **méthode statique** `ImportScreen.detectFamilyGroups(paths)` — non partageable. La
Phase 6 ShareDocs doit la **réutiliser** (une seule source de vérité, même protocole que
`importDetect` extrait en §11.2). Ce ticket fait **uniquement l'extraction**, sans
changement de comportement, pour que P6B branche dessus.

# Périmètre

**Front-only, aucun changement moteur/contrat, aucun changement de comportement
visible.** Pur refactor + tests + délégation locale.

**Interdit** : modifier la logique de détection ; toucher au backend/contrat ; toucher à
ShareDocs (c'est P6B).

# Décisions de design (figées — §12.1)

1. **Module partagé** `tauri-prep/src/lib/familyDetect.ts` (pur, testable, sans DOM/IO) :
   y déplacer `detectFamilyGroups(names: string[])` (regroupe par radical = nom sans le
   token de langue ; retient les groupes de **≥2** fichiers même radical / langues
   différentes ; renvoie `Array<{ stem, files: Array<{ path|name, lang }> }>`). Réutilise
   `LANG_RE`/`KNOWN_LANG_CODES` d'`importDetect` (ne pas dupliquer la regex).
2. **Helper d'heuristique de pivot** `pickDefaultPivot(group, defaultLang)` : retourne le
   membre dont la langue == `defaultLang` si présent dans le groupe, sinon le membre de
   1ʳᵉ langue par ordre alphabétique. Pur, testable (servira la bannière P6B).
3. **`ImportScreen` délègue** : `ImportScreen.detectFamilyGroups` devient un mince
   wrapper (ou les appels internes pointent vers `familyDetect`), **sans changement de
   comportement** (la bannière locale et le dialogue post-import restent identiques).

# Livrables

## L1 — Module partagé
`familyDetect.ts` : `detectFamilyGroups`, `pickDefaultPivot` (purs). Réutilise
`LANG_RE`/`KNOWN_LANG_CODES` depuis `importDetect`.

## L2 — Délégation locale
`ImportScreen` consomme `familyDetect` ; retirer la logique dupliquée. Non-régression de
la bannière de détection + du dialogue post-import (build + suite vitest verte).

## L3 — Tests
Vitest `lib/__tests__/familyDetect.test.ts` : groupement (radical/token, seuil ≥2,
multi-langues, faux-positifs hors whitelist écartés) ; `pickDefaultPivot` (langue défaut
présente / absente → 1ʳᵉ alphabétique).

## L4 — Doc
`CHANGELOG.md` (entrée refactor) ; pas de changement de contrat.

# Conventions du repo
- `refactor(prep): extraire la détection de familles dans familyDetect (partagé)`
- `test(prep): familyDetect — groupement + heuristique de pivot`
- Pas de migration, pas de bump version, pas de changement de contrat.
- CI : `npm --prefix tauri-prep run build && npm --prefix tauri-prep test` + eslint ;
  `npm --prefix tauri-shell run build` (couplage source).

# Ce qu'il NE FAUT PAS faire
- Changer la logique de détection (extraction iso-comportement).
- Dupliquer `LANG_RE`/`KNOWN_LANG_CODES` (réutiliser `importDetect`).
- Toucher à ShareDocs (réservé P6B).

# Livrable attendu
2-3 commits + résumé : module pur + tests, délégation locale, non-régression import local
(bannière familles inchangée).
