# Mission : fusionner Conventions dans la Segmentation + recherche de candidats

Repo AGRAFES, branche `development`. Lis [HANDOFF_PREP.md](../HANDOFF_PREP.md)
et [HANDOFF_SHELL.md](../HANDOFF_SHELL.md) avant tout.

## Friction adressée

Les conventions (rôles d'unités) vivent aujourd'hui dans un **module Shell
séparé** (`tauri-shell/src/modules/conventionsModule.ts`, ~1060 lignes), exposé
comme sous-onglet « conventions » de `constituerModule`, frère de toute l'app
prep. C'est **le seul élément du workflow hors du flux prep** — il force un
aller-retour hors de l'app. C'est la cause racine de la friction Tier B #7 de
HANDOFF_PREP (« conventions sous-utilisées ») : pas un manque d'intro, un
problème de placement. Second problème : pour assigner un rôle, l'utilisateur
doit **repérer à la main** les unités concernées (les « Chapter » qui traînent,
les intertitres…) — il n'y a aucun outil de recherche.

## Architecture actuelle

```
Shell : home / explorer / constituer / publish
  └─ constituer (constituerModule.ts) — 2 sous-onglets :
       ├─ « préparer »   → app prep (Import / Documents / Actions / Exports)
       └─ « conventions » → conventionsModule.ts (module Shell)
```

`conventionsModule` : colonne gauche = catalogue des rôles (Structure :
titre/intertitre/dédicace… + Texte : vers/dialogue/citation… — CRUD complet) ;
colonne droite = sélecteur de document → liste d'unités → assignation de rôle +
réglage `text_start_n` (frontière paratexte/texte). Endpoints utilisés :
`listConventions`, `createConvention`, `updateConvention`, `deleteConvention`,
`bulkSetUnitRole`, `setDocumentTextStart`.

`SegmentationView` (`tauri-prep/src/screens/SegmentationView.ts`, ~2412 lignes)
est une sous-vue d'`ActionsScreen` avec une barre d'onglets de contenu
(`prep-seg-content-tab` : `preview` / `saved` / `diff` / `structure`).

## Décisions de design (fixées)

1. **Placement** — Conventions est **fusionné dans la sous-vue Segmentation**,
   pas créé comme 5e sous-vue distincte. Concrètement : un **nouvel onglet de
   contenu « Rôles »** dans la barre `prep-seg-content-tab` de SegmentationView.
   Rationnel : segmenter découpe le doc en unités, les conventions taguent ces
   mêmes unités — même objet, même document sélectionné, contexte partagé.

2. **Recherche** — un champ de recherche dans l'onglet Rôles **filtre la liste
   d'unités du document courant** sur les correspondances textuelles (ex.
   « Chapter »). L'assignation reste **manuelle** : la recherche ne fait que
   réduire la liste aux candidats, l'utilisateur sélectionne puis assigne.
   Pas d'assignation en masse automatique (risque de faux positifs), pas de
   recherche cross-corpus (V1 = document courant uniquement).

3. **Catalogue de rôles vs assignation** : l'**assignation** de rôle (action
   fréquente) est la surface principale de l'onglet Rôles. La **gestion du
   catalogue** (créer/éditer/supprimer un rôle, couleurs, icônes — action rare)
   passe dans un **panneau repliable** (fermé par défaut) en haut de l'onglet
   Rôles, cohérent avec les autres cartes repliables de prep (`data-collapsible`).

4. **`text_start_n`** (frontière paratexte/texte) — reste rattaché à la même UI
   (c'est une structure de document), exposé dans l'onglet Rôles.

## Tension reconnue — taille de fichier

SegmentationView fait déjà 2412 lignes. Y verser naïvement ~1000 lignes de
conventions = un fichier de 3400+ lignes — exactement la friction de lisibilité
que HANDOFF_PREP #5 pointe pour CurationView.

**Mandat** : reproduire le pattern de décomposition de CurationView. La logique
pure des conventions (filtrage de la liste d'unités, recherche, calcul des
badges/compteurs, validation du catalogue) va dans des modules **purs et testés
Vitest** sous `tauri-prep/src/lib/conventions*.ts`. SegmentationView ne gagne
que l'orchestration DOM/événements de l'onglet Rôles + le rendu, délégué.
Cible : +400 lignes max dans SegmentationView, le reste en `lib/`.

## Livrables

### Phase 1 — Portage du moteur conventions vers prep
- L1. Porter la logique de `conventionsModule.ts` dans `tauri-prep` : modules
  purs `lib/conventionsRoles.ts` (catalogue : défauts Structure, validation),
  `lib/conventionsUnitList.ts` (filtrage + recherche de la liste d'unités,
  badges, compteurs). Pas de DOM, pas d'IO. Tests Vitest par invariant.
- L2. Renommer le CSS `conv-*` → `prep-conv-*` (namespacing prep, cf. E-1) et
  l'intégrer à `app.css`.

### Phase 2 — Intégration comme onglet « Rôles » de SegmentationView
- L3. Ajouter l'onglet `roles` à `prep-seg-content-tabs` (après `structure`).
  Le panneau réutilise le document déjà sélectionné dans la sous-vue
  Segmentation — pas de second sélecteur de document.
- L4. Rendu de la liste d'unités avec badges de rôle, sélection multiple,
  affordance « cliquer un rôle pour l'assigner à la sélection » (reprise du
  pattern `conv-role-item--assignable`). Câbler `bulkSetUnitRole`,
  `setDocumentTextStart`.
- L5. Catalogue de rôles en surface secondaire (cf. décision 3) : panneau
  repliable ou modale, câblant `createConvention`/`updateConvention`/
  `deleteConvention`.

### Phase 3 — Recherche de candidats
- L6. Champ de recherche dans l'onglet Rôles : filtre la liste d'unités du
  document courant sur la correspondance textuelle (insensible casse/accents,
  réutiliser les helpers existants si disponibles). Indicateur « N/M unités ».
  Helper pur dans `lib/conventionsUnitList.ts`, testé.

### Phase 4 — Nettoyage du Shell
- L7. Retirer le sous-onglet « conventions » de `constituerModule.ts`. Comme
  « préparer » devient le seul sous-onglet, **supprimer entièrement la barre de
  sous-onglets** — `constituer` monte directement l'app prep. Ajuster le calc()
  de hauteur (la barre de 38px disparaît).
- L8. Reporter la navigation entrante : tout `?mode=...`/deep-link ou handler
  qui ciblait le sous-onglet conventions doit désormais ouvrir
  Actions → Segmentation → onglet Rôles. Vérifier `app.ts` (navigation
  Conventions→Prep, ligne ~157) et les call sites de `conventionsModule`.

### Phase 5 — Tests + doc
- L9. Tests Vitest des modules purs (L1, L6). Vérifier que la suite passe
  (`npx vitest run`), `tsc --noEmit` clean, `npm run build` OK.
- L10. Docs : HANDOFF_PREP (clore Tier B #7, mettre à jour l'inventaire des
  écrans § 2 — ActionsScreen/SegmentationView), HANDOFF_SHELL (retrait du
  sous-onglet), CHANGELOG.

## Questions ouvertes (à trancher avant exécution)

- Décision 3 (catalogue en panneau repliable vs modale) — à confirmer.
- Faut-il conserver une redirection/alias temporaire pour les deep-links
  `mode=conventions` existants, ou rupture nette ?
- Le doc sélectionné dans Segmentation et celui de l'onglet Rôles : un seul
  état partagé (recommandé) — confirmer qu'aucun usage ne veut deux docs
  distincts simultanément.

## Hors périmètre V1

- Recherche cross-corpus (décision 2 : document courant uniquement).
- Assignation en masse automatique sur les correspondances de recherche.
- Refonte du modèle de données des rôles (`unit_role_conventions` inchangé).

## État d'exécution (post-v0.2.4)

Toutes les phases sont livrées. Vérifications : `tsc --noEmit` clean (prep + shell),
`vitest run` 387/387 (dont 28 nouveaux tests conventions), `npm run build` OK
(prep + shell).

- [x] **L1** — modules purs `lib/conventionsRoles.ts` (défauts Structure,
  partition par catégorie, validation formulaire, couleurs sûres) et
  `lib/conventionsUnitList.ts` (foldText, filterUnits, isParatext,
  resolveRoleBadge, summarizeUnits). Tests : `__tests__/conventionsRoles.test.ts`
  + `__tests__/conventionsUnitList.test.ts` (28 tests).
- [x] **L2** — CSS `conv-*` → `prep-conv-*`, intégré à `app.css`.
- [x] **L3** — onglet `roles` ajouté à `prep-seg-content-tabs` (après
  `structure`). Document partagé avec la sous-vue Segmentation, pas de second
  sélecteur.
- [x] **L4** — liste d'unités avec badges de rôle, sélection multiple
  (clic / shift+clic), affordance `prep-conv-role-item--assignable`.
  `bulkSetUnitRole` + `setDocumentTextStart` câblés.
- [x] **L5** — catalogue de rôles en panneau repliable fermé par défaut
  (décision 3), CRUD via `createConvention`/`updateConvention`/`deleteConvention`.
- [x] **L6** — champ de recherche filtrant les unités candidates du doc courant
  (insensible casse/accents), indicateur « N/M unités ».
- [x] **L7** — sous-onglet « conventions » retiré de `constituerModule.ts` ;
  barre de sous-onglets entièrement supprimée, `constituer` monte directement
  l'app prep ; `calc()` de hauteur ajusté (−38 px). `conventionsModule.ts`
  supprimé.
- [x] **L8** — navigation entrante reportée : `app.ts` route les clés
  `agrafes:prep-roles-doc` / `agrafes:prep-curation-doc` vers
  Actions → Segmentation → onglet « Rôles » (`ActionsScreen.segFocusDocRoles`).
- [x] **L9** — tests Vitest des modules purs, suite verte, `tsc` clean, builds OK.
- [x] **L10** — docs : HANDOFF_PREP (Tier B #7 clos, inventaire écrans § 2),
  HANDOFF_SHELL (retrait du sous-onglet), CHANGELOG [Unreleased].

### Réponses aux questions ouvertes

- **Catalogue : panneau repliable** retenu (cohérent avec les autres cartes
  `data-collapsible` de prep ; pas de modale supplémentaire).
- **Deep-links** : pas d'alias temporaire — `app.ts` consomme l'ancienne clé
  `agrafes:prep-curation-doc` *et* la nouvelle `agrafes:prep-roles-doc` vers la
  même destination (rupture nette côté Shell, mais aucun deep-link orphelin).
- **Doc partagé** : un seul état (le doc sélectionné dans Segmentation) — aucun
  usage ne réclamait deux documents distincts.

### Écart par rapport au ticket

- Le ticket suggérait que SegmentationView « ne gagne que l'orchestration DOM ».
  L'orchestration DOM de l'onglet Rôles (~570 lignes) a été placée dans un
  composant dédié `components/RolesPane.ts` plutôt que dans SegmentationView :
  cela respecte mieux la cible « +400 lignes max » (SegmentationView ne gagne
  que +255 lignes) et isole un widget réutilisable. La logique *pure* reste bien
  en `lib/conventions*.ts` testée, conformément au mandat.
- Côté API sidecar : `tauri-prep/lib/sidecarClient.ts` exposait `bulkSetRole`
  (par `doc_id`+`unit_ns`) mais pas la variante par `unit_id` qu'utilisait le
  module Shell. Ajout de `bulkSetUnitRole` (format `unit_ids`, accepté par le
  handler sidecar) et `setDocumentTextStart` (alias de `setTextStart`), plus un
  champ optionnel `category` sur `ConventionRole` / `createConvention` /
  `updateConvention` — le sidecar le renvoyait déjà, l'interface prep ne le
  déclarait pas.
