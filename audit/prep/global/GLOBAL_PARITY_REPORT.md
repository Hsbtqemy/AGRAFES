# Audit — Invariants Globaux Tauri Prep V1.5

**Catégorie A** — Éléments présents sur toutes les vues
**Date :** 2026-03-01

---

## A1 — Topbar

| Propriété | Mockup (`prep-vnext.html`) | Runtime (`app.ts` + `tokens.css`) | Delta | Priorité |
|-----------|--------------------------|----------------------------------|-------|----------|
| height | 54px (`--prep-topbar-h: 54px`) | 52px (`height: 52px` dans `app.css`) | −2px | P3 |
| background | `var(--prep-surface-raised)` #f8f9fb | `linear-gradient(135deg,#1e3a5f,#2c5f9e)` | différent | P2 |
| titre | `h1.prep-title` avec `font-size: 1.25rem` | `<span class="prep-title">` `font-size: 1rem` | −4px | P2 |
| boutons action | 5 boutons (⚙ Paramètres, ⛁ BDD, ● Corpus actif, 🔔, ?) | 5 boutons présents | ≈ OK | — |

**Diagnostic :**
- La variable `--prep-topbar-h: 54px` est déclarée dans `tokens.css` mais la règle `.prep-topbar { height: 52px }` dans `app.css` la court-circuite.
- Le gradient bleu runtime est hérité de `tauri-app/`; le mockup utilise un fond clair `#f8f9fb`.

**Fichiers sources :**
- `tauri-prep/src/ui/tokens.css` : `--prep-topbar-h: 54px`
- `tauri-prep/src/ui/app.css` : `.prep-topbar { height: 52px; … background: linear-gradient(135deg,#1e3a5f,#2c5f9e) }`
- `tauri-prep/src/app.ts` : `buildUI()` construit le topbar HTML

---

## A2 — Typographie et titres d'écran

| Propriété | Mockup | Runtime | Delta | Priorité |
|-----------|--------|---------|-------|----------|
| `h1` titre écran | `font-size: 20px; font-weight: 700` | `font-size: 1.15rem ≈ 18.4px; font-weight: 600` | −1.6px / −100 | P2 |
| `h2` sous-titre section | `font-size: 15px` | `font-size: 0.9rem ≈ 14.4px` | −0.6px | P3 |
| `p` / body text | `font-size: 14px` | `font-size: 0.875rem = 14px` | 0 | ✅ |
| `font-family` | `'Inter', system-ui` | `'Inter', system-ui` (via app.css `:root`) | 0 | ✅ |

**Fichiers sources :**
- `tauri-prep/src/ui/app.css` : `:root { font-size: 16px }` base, `.screen-title { font-size: 1.15rem }`

---

## A3 — Cartes (`.card`)

| Propriété | Mockup | Runtime (`app.css`) | Delta | Priorité |
|-----------|--------|---------------------|-------|----------|
| `border-radius` | 12px | 10px | −2px | P3 |
| `padding` (`.card-body`) | 12px | 1rem (16px) | +4px | P3 |
| `box-shadow` | `0 1px 4px rgba(0,0,0,.08)` | `0 2px 8px rgba(0,0,0,.08)` | légèrement plus fort | P3 |
| `border` | `1px solid #e2e8f0` | `1px solid var(--color-border, #dde1e8)` | ≈ OK | — |
| `.card-header` bg | `#f7f8fa` | `#f7f8fa` (via `--color-surface-alt`) | 0 | ✅ |

---

## A4 — Navigation latérale (sidebar)

| Propriété | Mockup | Runtime (`prep-vnext.css`) | Delta | Priorité |
|-----------|--------|---------------------------|-------|----------|
| largeur nav | 230px | `--prep-nav-w: 230px` | 0 | ✅ |
| bg nav | `#1a2332` | `var(--prep-nav-bg, #1a2332)` | 0 | ✅ |
| item actif | bg `#2c5f9e`, `border-left: 3px solid #5b9bd5` | idem via `.prep-nav-item.active` | ≈ OK | — |
| items désactivés | présents (segmentation, alignement, qualité) | présents (`data-disabled`) | OK | ✅ |

---

## A5 — Double système de tokens (dette technique)

**Constat :** Deux systèmes de variables CSS coexistent :

| Système | Déclaré dans | Usage |
|---------|-------------|-------|
| `--color-*` | `tauri-prep/src/ui/app.css` `:root` | Cartes, boutons, texte, borders — ancien système |
| `--prep-*` | `tauri-prep/src/ui/tokens.css` | Shell, topbar, nav, breakpoints — nouveau système |

Certaines valeurs sont dupliquées (ex. `--color-border: #dde1e8` ≈ `--prep-line: #dde1e8`).

**Impact :** Incohérences visuelles potentielles (ex. topbar qui ignore `--prep-topbar-h`), complexité de maintenance.

**Recommandation (Sprint A) :** Unifier en un seul fichier `tokens.css`, déprécier `--color-*` dans `app.css`.

---

## A6 — Boutons

| Propriété | Mockup | Runtime (`app.css`) | Delta | Priorité |
|-----------|--------|---------------------|-------|----------|
| `btn-primary` bg | `#2563eb` | `var(--color-primary, #2563eb)` | 0 | ✅ |
| `btn-warning` bg | `#d97706` | `var(--color-warning, #d97706)` | 0 | ✅ |
| `btn-secondary` bg | `#f1f5f9` border `#cbd5e1` | idem | ≈ OK | — |
| `height` bouton standard | 36px | `padding: .5rem 1rem` ≈ 36px | 0 | ✅ |
| `border-radius` btn | 8px | 8px | 0 | ✅ |

---

## Synthèse globale

| Réf | Élément | Priorité | Sprint suggestion |
|-----|---------|----------|--------------------|
| GA-1 | Topbar height 52px → 54px | P3 | A |
| GA-2 | Topbar background gradient → surface claire | P2 | A |
| GA-3 | Screen title font-size 18px → 20px | P2 | A |
| GA-4 | Card border-radius 10px → 12px | P3 | A |
| GA-5 | Card padding 16px → 12px | P3 | A |
| GA-6 | Unifier double système tokens | P2 (dette technique) | A |

**Total catégorie A :** 2 P1 · 3 P2 · 3 P3
*(Aucun P1 structurel global — les invariants sont des micro-écarts de tokens)*
