# Prep UI Redesign Plan — AGRAFES Constituer vNext

**Created:** 2026-03-01
**Status:** Pilot (P0) implemented. P1/P2 documented.

---

## 1. Inventaire des visuels sources de vérité

| Fichier | Rôle | Écran principal |
|---|---|---|
| `prep-vnext.html` | Hub index des variantes | Hub navigation onglets |
| `prep-curation-preview-vnext.html` | **Variante retenue** | Curation avec preview centrale 3 colonnes |
| `prep-actions-longtext-vnext.html` | Variante | Actions / Segmentation grand texte, preview sticky |
| `prep-segmentation-vo-vnext.html` | Variante | Segmentation pilotée VO, batch multilingue |
| `prep-segmentation-translation-vo-native-layout-vnext.html` | Variante | Segmentation traduction, layout natif + couche VO |

### Composants identifiés par visuel

**prep-curation-preview-vnext.html** (référence primaire implémentée) :
- Header `.top` 54px avec gradient teal `#0c4a46 → #0f766e`, badge DB pill
- Sidebar nav `.nav` 230px : "Sections" heading, tabs (Importer / Documents / Actions / Exporter), `<details>` tree pour sous-actions
- Sidebar collapse : toggle bouton `◀/▶`, left-rail 30px quand masqué
- Workspace 3 colonnes : params (310px) · preview centrale (1fr, sticky) · diagnostics (320px)
- Params card : doc selector, chip-row règles (Espaces / Ponctuation / Guillemets), CTA (Prévisualiser / Appliquer)
- Preview card : header + controls chips + `grid-template-columns: 1fr 1fr 22px` (pane brut · pane curé · minimap)
- Pane brut : `.doc-scroll` avec lignes `[nnnn]`
- Pane curé : diff avec `<mark>` pour surlignage
- Minimap : `.mm` bars (changed = orange, focus = teal)
- Diagnostics card : liste `.diag` (warn/normal)
- Retouches avancées : `<details>` dépliable

**prep-actions-longtext-vnext.html** (P1 candidat) :
- Workspace 2 colonnes : params (360px) · preview sticky (`max-height: 100vh - 100px`)
- Preview : `grid-template-rows: auto auto 1fr auto` (tools · tabs · body · footer)
- Preview body : 3 cols `1fr 1fr 42px` (brut · segmenté · minimap avancé avec `.mm-zone`)
- Footer : stats bar + boutons d'export

**prep-segmentation-vo-vnext.html** (P1 candidat) :
- Mêmes primitives CSS (sidebar, chips, tree)
- Tableau de batch segmentation : doc par ligne, statut, progression
- Résultats par langue avec orphelins

**prep-segmentation-translation-vo-native-layout-vnext.html** (P1 candidat) :
- Layout 3 colonnes : paramètres · preview VO · couche traduction
- Diff side-by-side VO vs traduction

---

## 2. Mapping visuels → fichiers tauri-prep

| Composant vNext | Fichier impl. | Classe/ID |
|---|---|---|
| Header `.top` 54px | `app.ts` `_buildUI()` | `.topbar` (CSS dans JS constant) |
| Sidebar nav | `app.ts` `_buildUI()` | `.prep-shell`, `.prep-nav`, `.prep-nav-tab` |
| Sidebar collapse toggle | `app.ts` `_toggleNav()` | `.prep-nav-collapse-btn`, `.prep-rail` |
| Actions sub-tree | `app.ts` `_buildUI()` | `.prep-nav-tree`, `.prep-nav-tree-link` |
| Curation workspace 3-col | `screens/ActionsScreen.ts` `render()` | `.curate-workspace`, `.curate-col-*` |
| Params card | `screens/ActionsScreen.ts` | `.curate-inner-card`, `#act-curate-doc`, `#act-rule-*` |
| Preview card sticky | `screens/ActionsScreen.ts` | `.curate-preview-card`, `#act-preview-panel` |
| Pane brut | `screens/ActionsScreen.ts` | `#act-preview-raw` |
| Pane curé (diff) | `screens/ActionsScreen.ts` `_renderDiffList()` | `#act-diff-list`, `.diff-table` |
| Minimap | `screens/ActionsScreen.ts` `_renderCurateMinimap()` | `#act-curate-minimap`, `.curate-mm` |
| Diagnostics card | `screens/ActionsScreen.ts` `_renderCurateDiag()` | `#act-curate-diag`, `.curate-diag` |
| CSS design tokens | `src/ui/tokens.css` | `--prep-*` vars |
| CSS sidebar layout | `src/ui/prep-vnext.css` + JS constant | `.prep-shell`, `.prep-nav`, etc. |
| CSS curation workspace | `src/ui/prep-vnext.css` + JS constant | `.curate-*` classes |

---

## 3. Écarts UI actuelle vs vNext — classement P0/P1/P2

### P0 (implémentés dans ce pilot)

| Écart | Type | Résolution |
|---|---|---|
| Tabbar horizontal → sidebar vertical 230px | Structurel majeur | ✅ Implémenté dans `app.ts` |
| Sidebar collapse (◀/▶) | Interaction | ✅ `.prep-shell.nav-hidden` toggle |
| Actions sub-tree dans sidebar | Nav | ✅ `<details>` + scroll-to-section |
| Curation layout 1-col → 3-col workspace | Structurel majeur | ✅ `.curate-workspace` grid |
| Preview panel toujours visible (pas `display:none`) | UX | ✅ Suppression toggle display |
| Diagnostics panel (colonne droite) | Nouveau composant | ✅ `#act-curate-diag`, `_renderCurateDiag()` |
| Minimap changements | Nouveau composant | ✅ `#act-curate-minimap`, `_renderCurateMinimap()` |
| CSS architecture (tokens/base/components/prep-vnext.css) | Architecture | ✅ 4 fichiers créés, importés dans `main.ts` |
| pane-head labels (Brut / Curé) dans preview | Label | ✅ `.curate-pane-head` |

### P1 (documentés, non implémentés)

| Écart | Type | Fichier cible |
|---|---|---|
| Segmentation longtext : preview sticky 2-col avec tabs Brut/Segmenté | Layout | `ActionsScreen.ts` section seg |
| Segmentation VO : tableau batch multilingue avec statut par langue | Nouveau composant | `ActionsScreen.ts` |
| Segmentation traduction : 3-col VO + traduction côte à côte | Layout | `ActionsScreen.ts` |
| Texte brut dans pane left (curatePreview retourne `before` par exemple) | Data enrichissement | `_runPreview()` : remplir `#act-preview-raw` |
| Scroll synchronisé entre pane brut et pane curé | Interaction | JS event listener sur scroll |
| Navigation sidebar : état actif par section (Curation vs Segmentation vs Alignement) | UX | Sidebar tree-link `.active` tracking |
| Retouches avancées : style `<details>` affiné (caret vNext) | Style | CSS `curation-advanced` override |

### P2 (polish)

| Écart | Type |
|---|---|
| Sidebar collapse état persisté en localStorage | UX |
| Topbar : badge DB avec nom court (format `projet.db`) | Typography |
| Chips règles : visual active state plus marqué (border+bg animé) | Style |
| Minimap : bars proportionnelles à densité des changements par segment | Logique enrichie |
| Responsive breakpoint 1400px : droite → grille 2x1 | CSS |
| Animations de transition (slide sidebar, fade preview) | Polish |
| Dark mode token set | Théming |

---

## 4. Design tokens (Prep vNext)

```css
/* Fond & surfaces */
--prep-bg: #f0f2f5;
--prep-surface: #ffffff;
--prep-surface-alt: #f8f9fa;

/* Bordures */
--prep-line: #dde1e8;
--prep-line-accent: #9fd3cc;        /* vert teal clair */
--prep-line-accent-light: #cfe8e3;

/* Texte */
--prep-text: #1a1a2e;
--prep-muted: #4f5d6d;

/* Accent teal-vert (Constituer) */
--prep-accent: #0f766e;
--prep-accent-dark: #0c4a46;
--prep-accent-soft: #e8f5f3;

/* Variante bleue (actions secondaires) */
--prep-blue: #1e4a80;
--prep-blue-soft: #eaf1fb;
--prep-blue-line: #b7c8df;

/* Statuts */
--prep-ok: #1a7f4e;
--prep-warn: #e6a817;
--prep-warn-soft: #fff7e6;
--prep-warn-line: #edd89e;
--prep-danger: #c0392b;

/* Shape */
--prep-radius: 10px;
--prep-radius-sm: 8px;
--prep-radius-pill: 999px;

/* Layout */
--prep-topbar-h: 54px;
--prep-nav-w: 230px;
```

**Typographie** : `"SF Pro Text", "Segoe UI", Roboto, system-ui, sans-serif` — 14px base, 12px secondary, 13px body text dans panes.

**Ombres** : `0 1px 3px rgba(0,0,0,0.08)` card; `0 8px 22px rgba(15,118,110,0.08)` hover.

---

## 5. Plan en 3 itérations

### Pilot — P0 (✅ Fait)

**Objectif** : Refondation structurelle + vue curation opérationnelle.

1. ✅ CSS architecture : `src/ui/{tokens,base,components,prep-vnext}.css` + `vite-env.d.ts`
2. ✅ `main.ts` : imports CSS pour build standalone
3. ✅ `app.ts` : sidebar layout (`.prep-shell`, `.prep-nav`, toggle, Actions sub-tree)
4. ✅ `ActionsScreen.ts` : curation 3-col workspace (params + preview + diagnostics)
5. ✅ `_runPreview()` : panel toujours visible, update diagnostics + minimap
6. ✅ `_runCurate()` : reset content au lieu de `display:none`

### Extension — P1 (À implémenter)

**Objectif** : Aligner les écrans Segmentation sur les visuels vNext.

1. Segmentation longtext : preview sticky 2 colonnes (Brut vs Segmenté)
   - Fichier : `ActionsScreen.ts` section `#act-seg-card`
   - Visuel ref : `prep-actions-longtext-vnext.html`
2. Segmentation VO batch : tableau multilingue avec statut
   - Visuel ref : `prep-segmentation-vo-vnext.html`
3. Segmentation traduction : vue côte à côte VO / trad
   - Visuel ref : `prep-segmentation-translation-vo-native-layout-vnext.html`
4. Texte brut dans pane gauche : `_runPreview()` remplit `#act-preview-raw` avec `ex.before` lines
5. Sidebar nav : tracking actif par section (Curation / Segmentation / Alignement)

### Polish — P2 (Backlog)

**Objectif** : Raffinements UX et préparation production.

1. Sidebar collapse persisté en localStorage
2. Scroll synchronisé pane brut ↔ pane curé
3. Minimap proportionnelle aux positions dans le document
4. Animations transitions (CSS `transition`)
5. Tokens responsive (font-size fluid, breakpoints documentés)
6. include_explain toggle dans la curation UI (audit avancé, backend V1.2 prêt)

---

## 6. Comment tester en dev

```bash
# Prérequis : sidecar actif sur un corpus de test
cd /Users/hsmy/Dev/AGRAFES

# Build + watch (standalone)
npm --prefix tauri-prep run dev   # port 1421

# Tauri desktop (nécessite le sidecar préparé)
cd tauri-prep && npm run tauri dev

# Via tauri-shell (mode unifié)
npm --prefix tauri-shell run dev  # port 1422, onglet "Constituer"
```

**Points à vérifier manuellement :**
1. Sidebar visible à gauche (230px), onglets Importer / Documents / Actions / Exporter
2. Bouton ◀ masque la sidebar → rail étroit avec ▶ pour ré-ouvrir
3. Onglet Actions → sous-arbre "Actions disponibles" avec liens Curation / Segmentation / Alignement
4. Lien Curation → scroll vers la section curation (3 colonnes)
5. Curation : sélectionner un doc, cocher des règles → "Prévisualiser"
6. Preview centrale toujours visible (pas de `display:none`)
7. Après prévisualisation : stats dans le footer, minimap mise à jour, diagnostics à droite
8. "Appliquer" → confirmation → job soumis → preview reset, message dans journal
