# R6.5-B — Parité Curation au canvas (cadrage figé)

> **But de cette note.** Figer, **avant tout ticket**, le port de la Curation legacy
> (`CurationView.ts`, 3087 l.) vers la pane canvas (`CurationPane.ts`, 380 l.) — dernier
> prérequis avant **R6.5-C** (retrait de `CurationView`). Établie **contre le code réel**
> (branche `refonte`, 2026-07-21) : engine (`curation.py`, `services/curate_service.py`) +
> front (legacy + canvas). Trois décisions structurantes tranchées avec l'utilisateur
> (2026-07-21) sont enregistrées en §2. Cette note **supersède** la §7.3 « R6.5-B » de
> [`DESIGN_R6_4_canvas_parity.md`](DESIGN_R6_4_canvas_parity.md) (datée du 20/07, **avant** le
> stylo) sur l'ordre des chantiers et le modèle de revue.

## 1. Constat : chantier **entièrement front**, zéro contrat / zéro migration

Vérifié au code : **tous les endpoints nécessaires sont déjà en service**, et l'apply honore
déjà l'état persistant. Rien à ajouter côté moteur.

| Capacité | Endpoint | État |
|---|---|---|
| Aperçu exhaustif (marqueurs + diff) | `POST /curate/preview` | live (canvas l'utilise déjà) |
| Appliquer | `POST /curate` (synchrone) | live (canvas l'utilise déjà) |
| Exceptions par unité (ignore/override) | `POST /curate/exceptions{,/set,/delete}` | live |
| Undo doc-scopé | `POST /prep/undo{,/eligibility}` | live (câblé en Segmentation) |
| Apply-history / export exceptions | `POST /curate/apply-history*`, `/curate/exceptions/export` | live (panneaux autonomes) |

**Fait moteur décisif** — `curate_document` ([curation.py:209-213](../src/multicorpus_engine/curation.py#L209-L213))
applique un **ordre de priorité** par unité, indépendamment de ce que passe l'appelant :

1. `curation_exceptions.kind='override'` → force `override_text` (persistant) ;
2. `manual_overrides` de session (le canvas n'en envoie pas — le **stylo β** l'a remplacé) ;
3. `curation_exceptions.kind='ignore'` → saute l'unité (persistant) ;
4. `skip_unit_ids` de session ;
5. application automatique des règles.

Donc l'appel `/curate` **règles-seules** du canvas honore **déjà** toute exception persistée.
Corollaire structurant : **sur le canvas, « poser une exception » EST le mécanisme de revue** —
il n'y a pas de modèle de statut parallèle à rebâtir. La table `curation_exceptions` a une ligne
**unique par `unit_id`** (`ON CONFLICT(unit_id)`), `kind ∈ {ignore, override}` + `override_text`
+ `note` ([curate_service.py:71-107](../src/multicorpus_engine/services/curate_service.py#L71-L107)).

## 2. Décisions figées (2026-07-21)

### D1 — Modèle de revue **canvas-native** (exceptions = statut)

La « Revue » du legacy (`_curateExamples[].status` : pending/accepted/ignored, en mémoire +
localStorage) est un artefact du modèle **par échantillon** (`CURATE_PREVIEW_LIMIT=5000`, tirage +
3 fingerprints de péremption). Le canvas a un aperçu **exhaustif** rejoué à chaud → **on ne porte
pas ce modèle**. À la place :

- **Statut dérivé, pas stocké.** Une unité changée est *ignorée* si elle a une exception `ignore`,
  *épinglée* si exception `override`, sinon *à revoir* / *relue* (marqueur, D2).
- **⚠ Asymétrie de l'aperçu (vérifiée au moteur, 2026-07-21).** Le canvas **ne peut pas** dériver les
  badges du seul `/curate/preview` : une unité `ignore` est **retirée des `examples`** par design
  ([sidecar.py:3095-3122](../src/multicorpus_engine/sidecar.py#L3095) — « the user explicitly never
  wants to see it again » ; elle n'est comptée que dans `stats.units_exception_ignored`), alors qu'une
  unité `override` **reste** dans `examples` (`is_exception_override: true`, `preview_reason:standard`).
  Sans force_unit_id, une unité ignorée serait donc invisible → **impossible de la dé-ignorer depuis la
  liste**. → **Le canvas charge les exceptions indépendamment via `listCurateExceptions(conn, docId)`**
  (Map = source de vérité pour badges + Rétablir), découplé du preview. Les flags `is_exception_*` de
  l'aperçu ne servent que de confirmation redondante.
- **Les 3 fingerprints tombent** : `sampleFingerprint` (structurel) et l'usage échantillon de
  `sampleTextFingerprint` sont **sans objet** (exhaustif, pas de tirage). `rulesSignature` **survit**
  — réutilisé en D2. Les helpers restent en lib partagée
  ([`curationFingerprint.ts`](../tauri-prep/src/lib/curationFingerprint.ts)), simplement non appelés
  par le canvas pour les deux premiers.

### D2 — Persistance des marqueurs « relu » (localStorage, garde minimal)

Workflow réel confirmé : **une grosse passe, mais on y revient plusieurs sessions** → on persiste
la *progression de lecture*. Mais **aucune décision affectant l'apply n'en dépend** (ignore/override
= exceptions DB, durables par construction) : on ne persiste **que** le marqueur « j'ai regardé
cette unité changée, je laisse la règle s'appliquer ». Forme :

```
clé  agrafes.prep.curate.review.<docId>
val  { version, docId, rulesSignature, relu: { <unitId>: <beforeHash> } }
```

- **Garde global** : `rulesSignature(currentRules)` — changer les presets déplace l'ensemble des
  unités changées → on drope tout le set. (Réutilise
  [`rulesSignature`](../tauri-prep/src/lib/curationFingerprint.ts#L36), FNV-1a ordre-indépendant.)
- **Staleness par-unité** : à l'aperçu, un marqueur n'est valide que si `hash(before courant) ===
  beforeHash` stocké. Une édition **stylo** entre deux sessions périme *ce seul* marqueur (elle
  change `before`), pas les autres. (Hash = FNV-1a sur `before` ; exporter `fnv1a` ou appeler
  `sampleTextFingerprint([{unit_id, before}])` par unité.)

C'est la garde « vérifier au réel » appliquée à l'envers : on ne persiste que ce dont le workflow
multi-passes a besoin, et le garde reste à **une** signature + un hash par unité — pas les 3 couches
legacy.

### D3 — Règles avancées = **Find/Replace + Trouver** (pas la textarea JSON brute)

Le dock gagne :

- un **formulaire Find/Replace** (motif → remplacement, cases `regex` / `casse`) → produit **une**
  règle `CurateRule {pattern, replacement, flags, description}` ajoutée à `_currentRules()`.
  Échappement sûr quand `regex` est décoché (`pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")`), `flags
  = "g" + (nocase?"i":"")` — port direct de la logique legacy (`#act-fr-apply-btn`).
- le scan **« Trouver »** client-only : compte + navigation ◄► des occurrences sur `text_norm` des
  unités chargées, surlignage — **n'écrit rien, n'ajoute aucune règle** (passe de vérif avant
  d'appliquer).

**Abandonné** : la textarea JSON brute du legacy (`#act-curate-rules`, `JSON.parse` silencieux sur
tableau, error-prone) — surface d'erreur sans gain ergonomique.

### D4 — Actions par-unité (sur la ligne changée) — **deux gestes + le stylo** *(révisé 2026-07-21)*

Sur une unité marquée changée :

- **Laisser** (défaut : la règle s'applique à l'apply) + bascule **✓ relu** (D2).
- **Ignorer** → exception `ignore` (`/curate/exceptions/set`) : la règle ne touchera pas cette unité.
- Le **stylo** (`CanvasUnitList.onEditText`, β immédiat) reste disponible **transversalement** pour
  *corriger le texte lui-même*.

**« Épingler » (override) retiré du bandeau (2026-07-21).** Analyse au réel : sur le canvas, override
est **redondant**. Le legacy en avait besoin car il portait un *champ de saisie manuelle* (texte Z ≠
original ≠ sortie de règle) → ce rôle est passé au **stylo** (β). Ce qui restait à override — « figer
une chaîne exacte contre les runs futurs » — est couvert par **Ignorer** (la règle saute l'unité, le
texte survit). Le seul comportement propre à override (forcer-réécrire un texte qui aurait *dérivé*
seul) n'a **pas de déclencheur** dans un outil local mono-utilisateur (le texte ne bouge que par le
stylo — qui resynchronise déjà le verrou — ou une ré-import qui crée de *nouvelles* unit_ids).
→ **Modèle net : Ignorer = exclure de la curation · Stylo = corriger le texte.** On **garde** le rendu
d'un badge 🔒✏ + Rétablir si une exception `override` **existe déjà** (données legacy / futur panneau
Avancé, qui reste le lieu pour en créer une si besoin), + l'anti-revert. Les `manual_overrides` de
session du legacy (2 canaux) ne sont pas portés.

### D5 — Undo Apply : **branchement mécanique** (port de Segmentation)

Le bouton undo est **déjà générique et honnête** : `formatUndoActionLabel(elig)` étiquette
dynamiquement la dernière action. `UPDATE_TEXT` (stylo) y apparaît naturellement. Port = recopier le
patron `SegmentPane._undoBtnHtml()` ([SegmentPane.ts:360-366](../tauri-prep/src/components/SegmentPane.ts#L360-L366))
→ `#prep-cur-canvas-undo`, `prepUndoEligibility`/`prepUndo`, helpers
[`lib/prepUndo.ts`](../tauri-prep/src/lib/prepUndo.ts). **Désactivé en mode corpus/all** (undo
doc-scopé). Plus une question de sémantique — un branchement.

### D6 — Tiroir « Avancé » (T3) : reloger, pas réécrire

`<details class="prep-cur-advanced">` repliable hébergeant les **2 composants autonomes** quasi tels
quels (fichiers dédiés + objets de deps) :

- [`CurateExceptionsAdminPanel.ts`](../tauri-prep/src/components/CurateExceptionsAdminPanel.ts) (#7)
  — deps `{getConn, log, toast, pushLog, onExceptionDeleted, onExceptionUpdated, openInCuration}` ;
- [`CurateApplyHistoryPanel.ts`](../tauri-prep/src/components/CurateApplyHistoryPanel.ts) (#8) — deps
  `{getConn, getSessionEvents, log}`.

Plus, portés comme méthodes lisant la colonne canvas : **diagnostics** compacts (#5, chips par règle
→ filtre), **export rapport JSON/CSV** (#6, via plugin-dialog/fs), **bouton réindex-après-apply**
(#20, `onReindex` callback — remplace le hint texte actuel [CurationPane:308-309](../tauri-prep/src/components/CurationPane.ts#L308-L309)).
Pour alimenter le panneau history au canvas : appeler `recordApplyHistory` après chaque apply
synchrone (le panneau fusionne DB + événements de session).

## 3. Modèle de données front (canvas)

La colonne vertébrale legacy `_curateExamples[]` **ne se porte pas** ; l'équivalent canvas est déjà
`_changed: Map<unitId, {before, after}>` (aperçu exhaustif). On l'enrichit :

```
_changed:   Map<unitId, { before, after, matched_rule_ids? }>   // aperçu (existant, + rule ids)
_exceptions: Map<unitId, { kind: 'ignore'|'override', override_text? }>  // /curate/exceptions
_relu:       Set<unitId>                                          // marqueur, persisté (D2)
```

- **Statut** d'une unité = pur *dérivé* de ces trois structures (pas de champ `status`).
- **Sink de persistance unique** `_persistReview()` (l'analogue du `_saveCurateReviewState` legacy,
  mais qui n'écrit **que** `_relu` + `rulesSignature`) — appelé sur bascule relu et à l'apply.
- **Résumé de session** (#4) = compteurs dérivés : *N changées · R relues · I ignorées · E épinglées
  / T total*.
- **Filtre par règle** (#14) = chips depuis `matched_rule_ids` (déjà dans les exemples d'aperçu) ×
  labels de règles ; + filtre de statut (à revoir / relues / ignorées).

## 4. Séquence de livraison (lots front, indépendants, chacun testable)

L'ordre découle du fait moteur §1 (Exceptions = colonne vertébrale), pas de l'ordre déclaré au §7.3
de la note de parité :

1. **Lot A — Exceptions par unité (#10)** ✅ *(livré 2026-07-21)* : `_exceptions` Map chargée par
   `listCurateExceptions` (indépendante du preview, cf. asymétrie D1). Sur une **ligne changée sans
   exception** : bouton compact **Ignorer** (garde l'original). Sur une **ligne avec exception**
   (toujours visible, même hors set changé) : badge 🔒 *ignorée* / 🔒✏ *épinglée* + **Rétablir** (delete).
   Le marqueur « serait curée » est **supprimé** dès qu'une unité est ignorée. **« Épingler » retiré du
   bandeau (D4 révisé)** — redondant ; le rendu 🔒✏ + Rétablir + anti-revert restent pour les overrides
   existants. *Cœur.* *(Révise P1 : actions compactes toujours visibles sur les lignes changées.)*
2. **Lot B — Surcouche Revue (#2 dérivé + #4 résumé + #14 filtre) + persistance relu (D2)** ✅
   *(livré 2026-07-21)*. Toggle « ✓ relu » par ligne changée ; résumé dérivé « N à curer (R relues) ·
   I ignorées · E épinglées / T » (exclut les ignorées de « à curer », résout P4) ; barre de filtres
   (chips statut à revoir/relues/ignorées/épinglées + chips par preset #14 + bulk « tout marquer relu »)
   via un hook `rowFilter` ajouté à `CanvasUnitList` (ANDé avec la recherche). **Persistance D2** :
   `fnv1a` exporté de `curationFingerprint.ts` ; garde double = `rulesSignature` (global) + `fnv1a(before)`
   par unité (une édition stylo ou un changement de règles périme les marqueurs au re-aperçu). **Écart
   assumé vs D2** : clé localStorage **`agrafes.prep.curate.review.canvas.<docId>`** (suffixe `canvas`)
   — évite de clobberer le blob legacy (`statuses`/`overrides`, même préfixe) tant que `CurationView`
   coexiste. +7 tests (staleness ×2, statut, règle, bulk).
3. **Lot C — Règles avancées (#1)** ✅ *(livré 2026-07-21)* : sous-section repliable `<details>` dans
   le dock (Chercher / Remplacer + cases regex/casse). **Activer** → `_frRule` (une `CurateRule`
   `{pattern, replacement, flags, description:"R/R:…"}`) ajoutée en fin de `_rulesWithLabels()` : elle
   traverse **automatiquement** aperçu/apply/`rulesSignature`/filtre-par-règle (label « Règle F/R »),
   invalide le preview comme un preset. Échappement sûr si regex décoché
   (`[.*+?^${}()|[\]\\]→\\$&`), try/catch sur regex invalide. **Trouver** : count des occurrences sur
   `_units[].text_norm` + nav unité-par-unité (◄►/pos, surlignage `--found`/`--found-active`,
   `scrollIntoView`) — **révèle toutes les unités** (reset filtres/recherche) pour que chaque hit soit
   atteignable. **⚠ Divergence acceptée** : Trouver utilise `RegExp` **JS** (aperçu best-effort),
   l'apply utilise le `regex.V0` **Python** — un motif avancé (`\p{L}`, POSIX) peut différer/échouer en
   JS. +6 tests. **Abandonné** : la textarea JSON brute (D3).
4. **Lot D — Undo Apply (D5)** ✅ *(livré 2026-07-22)* : **prémisse vérifiée au moteur** — `/curate`
   enregistre bien une action `curation_apply` annulable avec snapshots (sidecar `_recorder_for` →
   `record_action`), et `undo.py` sait l'annuler (`_undo_curation_apply`) → **front pur, aucun
   changement moteur**. Bouton `#prep-cur-undo-btn` dans le dock, label dynamique honnête
   (`formatUndoActionLabel` : « ↶ Annuler : <description backend> » — Apply *ou* édition stylo),
   `prepUndoEligibility`/`prepUndo` + helpers `lib/prepUndo.ts`, désactivé sans doc (doc-scopé). Éligibilité
   rafraîchie sur setDocument / après apply / après stylo / après undo. `_undo` invalide le preview +
   recharge units/exceptions (garde les presets/F/R staged). **Passe adverse** : 2 bugs corrigés —
   (a) **course async** dans `_refreshUndo` (résultat d'un doc quitté écrasait le nouveau ; garde
   `docId === this._docId` post-await, à la SegmentPane) ; (b) **clobber** — `_undo` re-render effaçait
   le message d'erreur si le rechargement échouait (garde sur le booléen `_loadUnits`, RED prouvé) ;
   (c) *2ᵉ passe* — `_undo` rechargeait sans la même garde de changement de doc (capture `docId` +
   bail si `docId !== this._docId` post-`prepUndo`). +5 tests.
5. **Lot E — Tiroir Avancé (T3) — DISSOUS (2026-07-22)**, après confrontation au réel : les 🟠 sont
   soit **absorbés** par A/B, soit **hors-curation**, soit **redondants**. Dispositions :
   - **#7 admin cross-doc des exceptions** → **non porté au canvas** : la curation est mono-doc, Lot A
     couvre déjà les exceptions *par-unité en contexte* (badges 🔒 + Rétablir), et le geste central du
     panneau (`openInCuration`) est une **navigation cross-doc** — profil « corpus », pas curation. Son
     foyer naturel = l'onglet **Documents** (`MetadataScreen`, déjà cross-doc) *si le besoin se confirme*
     (chantier séparé).
   - **#5 diagnostics** → **abandonné** : redondant avec Lot B (résumé + chips **par règle** = le
     breakdown ; troncature = sans objet car aperçu exhaustif).
   - **#20 réindex** → **hors curation** : corpus-level (curation/segmentation/stylo/import salissent
     l'index, pas annotation/alignement). Doit devenir un **contrôle global** dans le header
     « Constituer » → note [`DESIGN_global_reindex_and_constituer_bar.md`](DESIGN_global_reindex_and_constituer_bar.md).
   - **#8 historique des apply** + **#6 export rapport** → autonomes mais **audit/niche, faible valeur
     dans la curation** ; **notés « à reloger si un besoin réel émerge »**, non portés pour ne pas
     traîner du code peu utilisé avant le retrait.

   → **R6.5-B est complet (A·B·C·D livrés+poussés ; E dissous).** Prochain = **R6.5-C** (retrait du
   legacy `CurationView`).

Aucun lot ne touche le contrat ni une migration → discipline contrat non déclenchée ; CI = ruff +
pytest inchangés, vitest + build pour le front.

## 5. Abandonné explicitement (documenté, non porté)

- **Modèle de statut in-memory 3-états** + les **2 fingerprints** échantillon (structurel/textuel) —
  sans objet en exhaustif (D1).
- **`manual_overrides` de session** (2 canaux legacy) — remplacés par stylo (β) + épinglage (D4).
- **Textarea JSON brute** de règles (D3).
- Confort déjà tranché **abandonné** en note de parité §7.2 : #13 queue, #15 minimap, #17 bannière
  d'échantillon (l'aperçu canvas ne tronque pas), #18 carte contexte-détail, #19 télémétrie soak,
  #24 sidebar annotation.
- **Apply asynchrone (job)** : le canvas garde son `/curate` **synchrone** — pas de régression, plus
  simple ; l'historique est alimenté par `recordApplyHistory` (D6).

## 6. Couplage à surveiller au port (leçon du map legacy)

- Le legacy fusionnait tout via **un** sink `_saveCurateReviewState` (statut + override + exception)
  et **un** résumé `_updateSessionSummary` (3 workstreams). Au canvas, le découplage est **naturel** :
  exceptions = DB (source de vérité), relu = localStorage (dérivé), résumé = pur calcul. Ne **pas**
  réintroduire un sink fourre-tout.
- L'aperçu est l'**orchestrateur** (`_runPreview` legacy chargeait exceptions + labels + revue). Au
  canvas, `_runPreview` doit, après un aperçu : (re)charger `_exceptions`, reconstruire les labels de
  règles, et **réconcilier `_relu`** contre la nouvelle `rulesSignature` + les `beforeHash` (D2).
- **Nouvelle table = auditer la suppression** (garde projet) : ici pas de nouvelle table, et
  **vérifié** — `curation_exceptions.unit_id` porte `ON DELETE CASCADE`
  ([006_curation_exceptions.sql:15](../migrations/006_curation_exceptions.sql#L15), confirmé par le
  commentaire de la migration 029). Supprimer une unité (segment/merge/undo) nettoie ses exceptions,
  zéro orphelin. **Pas de garde à ajouter au Lot A.**

## 7. Points laissés ouverts (à trancher au fil des lots, non bloquants)

- **P1 — Placement des actions par-unité** : dans le panneau diff révélé (cohérent R5.1c) vs une
  bande d'action toujours visible sur la ligne. Reco : panneau diff (moins de bruit visuel). *Lot A.*
- **P2 — Export rapport (#6)** : garder les 2 formats JSON+CSV du legacy, ou JSON seul d'abord ?
  *Lot E.*
- ~~**P3 — FK des exceptions**~~ : **résolu 2026-07-21** — `ON DELETE CASCADE` présent (§6), pas de
  garde à ajouter.
- **P4 — Résumé : les ignorées comptent encore dans « N modifiées »** (le stat vient de l'aperçu, qui
  compte l'ignorée-qui-serait-changée). Suffixe « · I ignorées » disambigue, mais le compte « à
  appliquer » n'exclut pas encore les ignorées. → **Lot B** (breakdown N/R/I/E dérivé). Idem
  `hasPendingEdits` reste vrai si tous les changements sont ignorés (apply inoffensif côté serveur).
- **Passe adverse Lot A (2026-07-21)** : 1 régression corrigée (un `render()` final de `setDocument`
  écrasait le message d'erreur de `_loadUnits` → `_loadUnits` renvoie un booléen, re-render gardé ;
  test RED-sur-buggé prouvé) ; 1 footgun corrigé (boutons d'exception masqués en CSS pendant l'édition
  stylo pour ne pas jeter l'édition en cours) ; anti-revert épingler-puis-stylo (sync override).
- **Passe adverse Lot B (2026-07-21)** : 1 bug corrigé (`CanvasUnitList.onStats` n'affichait
  `matched/total` que sur recherche texte → la ligne de stats **mentait sous un filtre de revue** ;
  corrigé à la source `summary.matched !== summary.total`, bénéficie à tout consommateur du `rowFilter` ;
  RED prouvé) ; 1 raffinement (chips « À revoir (0) »/« Relues (0) » masqués hors aperçu) ; +2 tests
  (stats-sous-filtre, persistance cross-instance). Mineurs différés non-bugs : bouton bulk visible même
  si un filtre masque tous les « à revoir » ; `_bulkMarkRelu` en O(C·N) (find par unité) ; ancre
  shift-clic non réinitialisée au changement de filtre (sans effet en curation, pas de sélection).
- **Diff des invisibles (2026-07-21, QA)** : le panneau `▸ diff` de curation utilisait
  `highlightChangesWordLevel`, qui `split(/\s+/)` et **jette tous les blancs** → un changement d'espaces
  seul (double→simple, ou espace → **fine insécable**, le cœur du preset ponctuation FR) n'affichait
  **rien**. → switch en **char-à-char** (`highlightChanges`, déjà existant, préserve les blancs) +
  `renderSpecialChars` gagne `showSpace` (espace U+0020 → glyphe `·`, **scopé aux zones changées** mark/del)
  + CSS `.prep-cur-diff-panel` : espace ordinaire **gris**, insécable/fine/tab **ambre** (distingue les
  deux). Front pur, +6 tests. **Limite connue** : au-delà de 600 car., `highlightChanges` retombe en
  mot-à-mot (perf) → les blancs y restent invisibles (unités-pavé ; à améliorer si un cas réel le réclame).
- **Passe adverse Lot C (2026-07-21)** : 1 piège UX corrigé — une règle F/R **active** dans un
  `<details>` **replié** n'avait aucun indicateur visible (le badge « règle active » est dedans) → un
  Aperçu pouvait subir une règle cachée. Fix : `_frSetActiveUI` toggle `.prep-cur-fr--active` sur le
  `<details>`, dont le `<summary>` (toujours visible) affiche « — règle active » en `::after`. +1 test.
  Pas de bug franc par ailleurs (la règle F/R traverse bien aperçu/apply/signature/filtre ; le pattern
  n'atteint jamais le DOM en HTML → pas d'XSS ; nav bornée).
- **Bug d'alignement LCS corrigé (2026-07-21, révélé par la QA du diff)** : dans `highlightChanges`
  **et** `highlightChangesWordLevel`, la branche insertion/suppression était **inversée** — sous
  `dp[i+1][j] >= dp[i][j+1]` (supprimer `bChars[i]` est le bon choix) le code **insérait** `aChars[j]`.
  Effet : tout changement au **milieu** d'une chaîne avec texte commun après (typiquement un espace
  supprimé) rendait « insérer-toute-la-fin + supprimer-toute-la-fin » → duplication illisible (vue en
  QA sur un `bug préexistant`, le legacy l'avait aussi). Fix = échanger les deux branches
  (`i < m && (j >= n || dp[i+1][j] >= dp[i][j+1])` ⇒ suppression). +2 tests de minimalité (RED prouvé :
  `"a.  b c"→"a. b c"` produisait `<mark>b</mark><mark>c</mark><del>b</del><del>·</del><del>c</del>`).
