# Curation Parity Audit — Mockup vnext vs Runtime

## 1) Résumé
- Audit réalisé avec viewport identique **1440×900** sur mockup et runtime.
- Les écarts majeurs sont **structurels (P0)** sur la preview centrale: hauteurs/overflow/grille et minimap.
- La colonne gauche est proche fonctionnellement, mais conserve une densité/runtime différente du mockup.
- La colonne droite diverge fortement dans cette capture parce que le runtime est en **état vide** (pas de run/diagnostics simulés).
- Le shell global (head + content) n'est pas pixel-identique: largeur utile, marges et sous-structure diffèrent du prototype HTML.
- Total diffs mesurés: **278** (P0: 122 / P1: 140 / P2: 16).
- Livrables machine: `mockup_metrics.json`, `runtime_metrics.json`, `diff_rows.json`, `_diff_table.md` et screenshots.

## 2) Carte des composants (mockup vs runtime)

### 2.1 Head-card
- Mockup: `.head-card`, `.head-tools`, `.pill`, `.head-link`
- Runtime: `.acts-seg-head-card`, `.acts-hub-head-tools`, `#act-curate-mode-pill`, `#act-curate-lt-cta`

### 2.2 Workspace 3 colonnes
- Mockup: `.workspace` (310px / minmax(640px,1fr) / 320px)
- Runtime: `#act-curate-card .curate-workspace` (310px / minmax(680px,1fr) / 320px)

### 2.3 Colonne gauche — Paramètres curation
- Mockup: `.row`, `.f`, `.chip-row .chip`, `.btn/.btn.alt/.btn.pri`, `.queue .qitem`
- Runtime: `#act-curate-ctx`, `.curation-quick-rules .curation-chip`, `.curate-primary-actions`, `#act-curate-advanced`, `#act-curate-quick-actions`

### 2.4 Colonne centre — Preview synchronisée
- Mockup: `.preview-card`, `.preview-controls`, `.preview-grid`, `.pane`, `.doc-scroll`, `.minimap`, `.mm`
- Runtime: `#act-preview-panel`, `.preview-controls`, `.preview-grid`, `.pane`, `.doc-scroll`, `#act-curate-minimap`, `.mm`

### 2.5 Colonne droite — Diagnostics / Journal
- Mockup: `.diag-list .diag`, `.queue .qitem`
- Runtime: `#act-curate-diag .curate-diag` (actuellement vide), `#act-curate-review-log .curate-qitem` (actuellement vide)

### 2.6 États audités
- Runtime capturé en **sidecar off / aucun document sélectionné / preview vide**.
- Mockup est en **état illustratif rempli** (texte + diagnostics + journal).
- Impact: plusieurs écarts de hauteur/présence en colonne droite proviennent de l'état, pas seulement du style.

## 3) Table exhaustive des écarts (canonique, 1 entrée par selector key)

| Bloc | Selector mockup | Selector runtime | Propriété pivot | Mockup | Runtime | Impact | Cause probable | Fichier cible |
|---|---|---|---|---|---|---|---|---|
| head | `.head-card` | `.acts-seg-head-card` | `css.minHeight` | `auto` | `0px` | P0 | Head runtime utilise la variante acts-* et spacing différent. | ActionsScreen.ts + app.css |
| head | `.head-tools a[href*='prep-actions-longtext-vnext.html']` | `#act-curate-lt-cta` | `rect.w` | `163.17` | `160.22` | P0 | Head runtime utilise la variante acts-* et spacing différent. | ActionsScreen.ts + app.css |
| head | `.head-tools .pill` | `#act-curate-mode-pill` | `rect.w` | `123.80` | `90.42` | P0 | Head runtime utilise la variante acts-* et spacing différent. | ActionsScreen.ts + app.css |
| head | `.head-card p` | `.acts-seg-head-card p` | `rect.h` | `30` | `18.55` | P0 | Head runtime utilise la variante acts-* et spacing différent. | ActionsScreen.ts + app.css |
| head | `.head-card h1` | `.acts-seg-head-card h1` | `rect.w` | `632.31` | `571.84` | P0 | Head runtime utilise la variante acts-* et spacing différent. | ActionsScreen.ts + app.css |
| head | `.head-tools` | `.acts-hub-head-tools` | `css.minHeight` | `auto` | `0px` | P0 | Head runtime utilise la variante acts-* et spacing différent. | ActionsScreen.ts + app.css |
| workspace | `.workspace .col.center` | `#act-curate-card .curate-col-center` | `css.gridTemplateColumns` | `640px` | `none` | P0 | Paramètres de grille runtime différents du mockup (640→680 + hauteur). | app.css |
| workspace | `.workspace .col.left` | `#act-curate-card .curate-col-left` | `css.gridTemplateColumns` | `310px` | `none` | P0 | Paramètres de grille runtime différents du mockup (640→680 + hauteur). | app.css |
| workspace | `.workspace .col.right` | `#act-curate-card .curate-col-right` | `css.gridTemplateColumns` | `320px` | `none` | P0 | Paramètres de grille runtime différents du mockup (640→680 + hauteur). | app.css |
| workspace | `.workspace` | `#act-curate-card .curate-workspace` | `css.gridTemplateColumns` | `310px 640px 320px` | `310px 680px 320px` | P0 | Paramètres de grille runtime différents du mockup (640→680 + hauteur). | app.css |
| left | `.workspace .col.left > article:first-child .btns` | `#act-curate-card .curate-primary-actions` | `rect.h` | `74` | `68` | P0 | Densité/structure colonne gauche adaptée runtime, pas strictement mockup. | ActionsScreen.ts + app.css |
| left | `.workspace .col.left > article:first-child + article details` | `#act-curate-advanced` | `presence` | `missing` | `present` | P0 | Éléments présents côté runtime mais absents de la maquette de référence. | ActionsScreen.ts |
| left | `.workspace .col.left > article:first-child .btns .btn.pri` | `#act-curate-btn` | `rect.h` | `33` | `31` | P0 | Densité/structure colonne gauche adaptée runtime, pas strictement mockup. | ActionsScreen.ts + app.css |
| left | `.workspace .col.left > article:first-child .btns .btn.alt` | `#act-preview-btn` | `rect.h` | `33` | `31` | P0 | Densité/structure colonne gauche adaptée runtime, pas strictement mockup. | ActionsScreen.ts + app.css |
| left | `.workspace .col.left > article:first-child .btns .btn:not(.alt):not(.pri)` | `#act-curate-reset-btn` | `rect.h` | `33` | `31` | P0 | Densité/structure colonne gauche adaptée runtime, pas strictement mockup. | ActionsScreen.ts + app.css |
| left | `.workspace .col.left > article:first-child .row .f` | `#act-curate-ctx .f` | `rect.h` | `50` | `52` | P0 | Densité/structure colonne gauche adaptée runtime, pas strictement mockup. | ActionsScreen.ts + app.css |
| left | `.workspace .col.left > article:first-child .row` | `#act-curate-ctx` | `css.gridTemplateColumns` | `138px 138px` | `141.5px 141.5px` | P0 | Densité/structure colonne gauche adaptée runtime, pas strictement mockup. | ActionsScreen.ts + app.css |
| left | `.workspace .col.left > article:first-child select` | `#act-curate-doc` | `presence` | `missing` | `present` | P0 | Éléments présents côté runtime mais absents de la maquette de référence. | ActionsScreen.ts |
| left | `.workspace .col.left > article:first-child` | `#act-curate-card .curate-col-left > article:first-child` | `css.minHeight` | `auto` | `0px` | P0 | Densité/structure colonne gauche adaptée runtime, pas strictement mockup. | ActionsScreen.ts + app.css |
| left | `.workspace .col.left > article:first-child .card-head` | `#act-curate-card .curate-col-left > article:first-child .card-head` | `rect.h` | `37` | `34` | P0 | Densité/structure colonne gauche adaptée runtime, pas strictement mockup. | ActionsScreen.ts + app.css |
| left | `.workspace .col.left > article:nth-child(2)` | `#act-curate-quick-actions` | `css.minHeight` | `auto` | `0px` | P0 | État runtime sans données de preview/revue (mockup illustratif rempli). | ActionsScreen.ts (jeu d'état de démonstration) |
| left | `.workspace .col.left > article:first-child .chip-row .chip` | `#act-curate-card .curation-quick-rules .curation-chip` | `rect.w` | `128.06` | `138.09` | P0 | Densité/structure colonne gauche adaptée runtime, pas strictement mockup. | ActionsScreen.ts + app.css |
| left | `.workspace .col.left > article:first-child .chip-row` | `#act-curate-card .curation-quick-rules` | `css.position` | `static` | `relative` | P0 | Densité/structure colonne gauche adaptée runtime, pas strictement mockup. | ActionsScreen.ts + app.css |
| center | `.workspace .col.center .doc-scroll` | `#act-preview-panel .doc-scroll` | `css.minHeight` | `0px` | `400px` | P0 | Overrides CSS #act-curate-card divergents (hauteurs, overflow, grille). | app.css |
| center | `.workspace .col.center .minimap` | `#act-curate-minimap` | `css.gridTemplateColumns` | `10px` | `14px` | P0 | Overrides CSS #act-curate-card divergents (hauteurs, overflow, grille). | app.css |
| center | `.workspace .col.center .minimap .mm` | `#act-curate-minimap .mm` | `rect.w` | `10` | `14` | P0 | Overrides CSS #act-curate-card divergents (hauteurs, overflow, grille). | app.css |
| center | `.workspace .col.center .preview-grid .pane:nth-child(2)` | `#act-preview-panel .preview-grid .pane:nth-child(2)` | `css.gridTemplateRows` | `none` | `auto 1fr` | P0 | Overrides CSS #act-curate-card divergents (hauteurs, overflow, grille). | app.css |
| center | `.workspace .col.center .pane-head` | `#act-preview-panel .pane-head` | `rect.h` | `31` | `28` | P0 | Overrides CSS #act-curate-card divergents (hauteurs, overflow, grille). | app.css |
| center | `.workspace .col.center .preview-grid .pane:nth-child(1)` | `#act-preview-panel .preview-grid .pane:nth-child(1)` | `css.gridTemplateRows` | `none` | `auto 1fr` | P0 | Overrides CSS #act-curate-card divergents (hauteurs, overflow, grille). | app.css |
| center | `.workspace .col.center .preview-card` | `#act-preview-panel` | `css.minHeight` | `auto` | `0px` | P0 | Overrides CSS #act-curate-card divergents (hauteurs, overflow, grille). | app.css |
| center | `.workspace .col.center .preview-controls` | `#act-preview-panel .preview-controls` | `rect.h` | `42` | `38` | P0 | Overrides CSS #act-curate-card divergents (hauteurs, overflow, grille). | app.css |
| center | `.workspace .col.center .preview-grid` | `#act-preview-panel .preview-grid` | `css.gridTemplateColumns` | `288px 288px 22px` | `306.5px 306.5px 26px` | P0 | Overrides CSS #act-curate-card divergents (hauteurs, overflow, grille). | app.css |
| center | `.workspace .col.center .preview-card .card-head` | `#act-preview-panel .card-head` | `rect.w` | `638` | `679` | P0 | Overrides CSS #act-curate-card divergents (hauteurs, overflow, grille). | app.css |
| right | `.workspace .col.right > article:first-child` | `#act-curate-card .curate-col-right > article:first-child` | `css.minHeight` | `auto` | `0px` | P0 | État runtime sans données de preview/revue (mockup illustratif rempli). | ActionsScreen.ts (jeu d'état de démonstration) |
| right | `.workspace .col.right .diag` | `#act-curate-diag .curate-diag` | `presence` | `present` | `missing` | P0 | État runtime sans données de preview/revue (mockup illustratif rempli). | ActionsScreen.ts (jeu d'état de démonstration) |
| right | `.workspace .col.right .diag-list` | `#act-curate-diag` | `css.gridTemplateColumns` | `294px` | `296px` | P0 | État runtime sans données de preview/revue (mockup illustratif rempli). | ActionsScreen.ts (jeu d'état de démonstration) |
| right | `.workspace .col.right > article:nth-child(2)` | `#act-curate-card .curate-col-right > article:nth-child(2)` | `css.minHeight` | `auto` | `0px` | P0 | État runtime sans données de preview/revue (mockup illustratif rempli). | ActionsScreen.ts (jeu d'état de démonstration) |
| right | `.workspace .col.right > article:nth-child(2) .qitem` | `#act-curate-review-log .curate-qitem, #act-curate-review-log .qitem` | `presence` | `present` | `missing` | P0 | État runtime sans données de preview/revue (mockup illustratif rempli). | ActionsScreen.ts (jeu d'état de démonstration) |
| right | `.workspace .col.right > article:nth-child(2) .queue` | `#act-curate-review-log` | `css.gridTemplateColumns` | `294px` | `320px` | P0 | État runtime sans données de preview/revue (mockup illustratif rempli). | ActionsScreen.ts (jeu d'état de démonstration) |
| shell | `main.content` | `#prep-main-content > .content` | `css.gridTemplateColumns` | `1294px` | `none` | P0 | Cadre shell/runtime différent du prototype (topbar/nav + largeur utile). | app.css (+ app.ts pour état nav si besoin) |
| shell | `#sectionsNav` | `#prep-nav` | `css.overflow` | `visible` | `auto` | P0 | Cadre shell/runtime différent du prototype (topbar/nav + largeur utile). | app.css (+ app.ts pour état nav si besoin) |
| shell | `#shellMain` | `#prep-shell-main` | `css.gridTemplateColumns` | `230px 1322px` | `230px 1210px` | P0 | Cadre shell/runtime différent du prototype (topbar/nav + largeur utile). | app.css (+ app.ts pour état nav si besoin) |

> Détail property-by-property complet: `audit/curation/_diff_table.md` (278 lignes).

## 4) Top 10 écarts P0 (actionnables)

| # | Key | Propriété | Mockup | Runtime |
|---|---|---|---|---|
| 1 | `doc_scroll` | `css.minHeight` | `0px` | `400px` |
| 2 | `doc_scroll` | `rect.h` | `560` | `400` |
| 3 | `doc_scroll` | `rect.w` | `286` | `304.50` |
| 4 | `minimap` | `css.gridTemplateColumns` | `10px` | `14px` |
| 5 | `minimap` | `css.gridTemplateRows` | `12px 12px 12px 12px 12px 12px 12px 12px 12px 12px 12px 12px` | `12px 12px 12px` |
| 6 | `minimap` | `css.minHeight` | `auto` | `0px` |
| 7 | `minimap` | `css.overflow` | `visible` | `hidden` |
| 8 | `minimap` | `css.overflowY` | `visible` | `hidden` |
| 9 | `minimap` | `rect.h` | `593` | `430` |
| 10 | `minimap` | `rect.w` | `22` | `26` |

## 5) Causes racines (3–5)

1. **Overrides Curation dédiés trop agressifs** dans `#act-curate-card` (preview/panes/minimap): min-height, overflow, grille et tailles divergentes du mockup.
2. **Mélange de variantes de design system** (`head-card` mockup vs `acts-seg-head-card` runtime) qui change les hauteurs/espacements du header.
3. **État fonctionnel non aligné** (mockup rempli vs runtime vide): diagnostics/journal/queues produisent des écarts de hauteur et de présence.
4. **Largeur shell/content différente** (runtime cap élargi + nav/topbar réelles), ce qui déplace l'ensemble du canevas par rapport au prototype statique.
5. **Structure runtime enrichie** (select document + retouches avancées) absente du mockup strict, créant des écarts de présence légitimes mais à décider UX.

## 6) Plan de fix priorisé (sans implémentation)

### P0 — layout breakers
- Recaler `#act-preview-panel` / `.preview-grid` / `.pane` / `.doc-scroll` / `#act-curate-minimap` sur les mêmes contraintes que le mockup (hauteurs, overflow, colonnes).
- Aligner `#act-curate-card .curate-workspace` sur `310 / minmax(640,1fr) / 320` tant que la parité est l'objectif.
- Définir un état d'audit runtime “mocked filled” (diagnostics + journal) pour comparer à iso-contenu.

### P1 — densité / hiérarchie
- Uniformiser la densité des boutons/chips (`font-weight`, padding vertical, gaps) avec le mockup vnext.
- Harmoniser le head-card runtime avec la hiérarchie mockup (title/subtitle/tools).
- Revoir les boxes `.row/.f` de contexte pour minimiser les écarts de dimensions sans casser la sémantique runtime.

### P2 — cosmétique
- Ajuster radius/shadows résiduels (preview card, pane, diag cards) pour une finition visuelle 1:1.
- Stabiliser la largeur visuelle de la pill mode et des CTA head-link.

## 7) Méthode / traçabilité
- Script capture: `scripts/audit_curation_capture.mjs` (Chrome CDP, headless, viewport 1440×900).
- Script diff: `scripts/audit_curate_diff.py` (classification P0/P1/P2).
- Artefacts:
  - `audit/curation/mockup_metrics.json`
  - `audit/curation/runtime_metrics.json`
  - `audit/curation/mockup.png`
  - `audit/curation/runtime.png`
  - `audit/curation/diff_notes.md`
  - `audit/curation/_diff_table.md`
