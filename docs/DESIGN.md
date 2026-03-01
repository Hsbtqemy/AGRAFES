# Design — AGRAFES

Document de référence pour le design de l’application AGRAFES (shell + modules Explorer, Constituer, Publier). À utiliser avant toute évolution visuelle ou refonte de disposition.

L’analyse détaillée du design actuel (padding, onglets, scroll, inventaire des zones) est dans **DESIGN_ANALYSIS.md**.

---

## 1. Principes

- **Cohérence** : une même logique visuelle pour le shell et tous les modules (Explorer, Constituer, Publier). Tokens partagés (couleurs, espacements, typo).
- **Lisibilité** : hiérarchie claire (titres, corps, légendes), contraste suffisant, pas de surcharge.
- **Accessibilité de base** : focus visible, modals accessibles (role, focus trap), contraste accent/fond, `prefers-reduced-motion` pour les transitions.
- **Pas de modification layout/scroll** sans présentation visuelle (mockup, wireframe ou maquette) validée au préalable.

---

## 2. Palette

**Thème par défaut : clair.** Extension possible vers un thème sombre plus tard via variables CSS.

### Neutres

| Usage        | Variable suggérée | Valeur actuelle / cible |
|-------------|-------------------|--------------------------|
| Fond global | `--bg`            | `#f0f2f5`               |
| Panneau / carte | `--surface`    | `#ffffff`               |
| Surface secondaire | `--surface-2` | `#f8f9fa`          |
| Texte       | `--text`          | `#1a1a2e`               |
| Texte secondaire | `--text-muted` | `#6c757d`           |
| Bordure     | `--border`        | `#dde1e8` / `#dee2e6`   |

### Sémantiques

| Usage     | Variable | Valeur   |
|----------|----------|----------|
| Succès   | `--ok`   | `#2dc653` / `#1a7f4e` |
| Avertissement | `--warn` | `#f4a261` / `#e6a817` |
| Erreur   | `--err`  | `#e63946` / `#c0392b`  |

### Accents (par mode)

Les accents dépendent du mode courant (`body[data-mode]`). Le shell gère déjà ce mécanisme.

| Mode        | Accent principal | Fond header     |
|------------|------------------|-----------------|
| Défaut     | `--accent`       | `--accent-header-bg` |
| Explorer   | `#2c5f9e`        | `#1e4a80`       |
| Constituer | `#0f766e` (teal) | `#0c4a46` (teal sombre) |
| Home       | `#1a1a2e` | `#1a1a2e` |
| Publier    | `#9c8b6e` (beige/sable) | `#6b5d4a` (sable sombre) |

Pour Home, header et titre utilisent la même teinte `#1a1a2e` (fond header = barre sombre, accent/titre = même valeur pour cohérence).

---

## 3. Espacements

Échelle commune pour padding, margin, gap. À exprimer en **variables CSS** (ex. `ui/tokens.css`).

| Token   | Valeur | Usage typique                    |
|---------|--------|-----------------------------------|
| `--sp-1`| 4px    | Micro-espace (icône–texte, chips)|
| `--sp-2`| 8px    | Petit (boutons, champs)          |
| `--sp-3`| 12px   | Moyen (sections, listes)         |
| `--sp-4`| 16px   | Standard (padding panneaux)      |
| `--sp-5`| 20px   | —                                |
| `--sp-6`| 24px   | Grand (sections, modals)          |
| `--sp-8`| 32px   | Très grand (blocs principaux)    |

Objectif : remplacer progressivement les valeurs en dur (1rem, 0.75rem, 1.15rem, etc.) par ces tokens pour un rendu cohérent.

---

## 4. Typographie

- **Famille** : `--font-sans` = `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`.
- **Tailles suggérées** :
  - `--fs-0` : 11–12px (badges, légendes, statusbar)
  - `--fs-1` : 12px
  - `--fs-2` : 14px (corps)
  - `--fs-3` : 16px (sous-titres)
  - `--fs-4` : 18px (titres de section)
  - `--fs-5` : 1.1–1.3rem (titres de page)
- **Poids** : normal (400), medium (500), semibold (600), bold (700).

---

## 5. Rayons et ombres

- **Rayons** : `--r-1` 4–6px (boutons, chips), `--r-2` 8–10px (cartes, inputs), `--r-3` 12–14px (modals).
- **Ombres** : légères pour cartes et dropdowns (ex. `0 2px 8px rgba(0,0,0,0.08)`), plus marquées pour modals (ex. `0 8px 32px rgba(0,0,0,0.18)`).

---

## 6. Composants (liste de référence)

À implémenter ou à faire évoluer via des classes CSS (et éventuellement des helpers TS minimaux). Définis ou à définir dans `ui/components.css` (ou équivalent).

| Composant | Rôle |
|-----------|------|
| **Bouton** | `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-ghost` — actions principales et secondaires. |
| **Carte** | `.card` — bloc de contenu (accueil, panneaux). |
| **Chip** | `.chip` — filtre actif, tag, avec option de suppression. |
| **Badge** | `.badge` — label court (mode, statut, catégorie). |
| **Modal** | Overlay + boîte centrée, titre, corps, pied (boutons). |
| **Menu dropdown** | Liste d’items sous un déclencheur, avec séparateurs si besoin. |
| **Champ formulaire** | Label + input/select, états focus et erreur. |
| **Table** | En-tête + lignes, bordures légères (audit, listes). |
| **Toast** | Message éphémère (succès, erreur, info). |

Les états (hover, active, disabled, focus) et les variantes (taille, danger) seront détaillés au moment de l’implémentation ou dans une future version de ce document.

---

## 7. Header (shell)

- **Structure cible** : distinguer clairement **navigation** (Explorer, Constituer) et **utilitaires** (Presets, ⌨, ⓘ, ?), avec la **zone DB** à droite.
- **Zones suggérées** :
  1. Brand (AGRAFES) — retour accueil.
  2. Navigation — onglets Explorer / Constituer (visuellement marqués, ex. fond ou séparateur).
  3. Utilitaires — Presets, raccourcis, à propos, menu Support (groupés ou avec espace/trait).
  4. DB — badge + menu (Ouvrir, Créer, MRU).
- **Hauteur** : conserver 44px pour la barre fixe. Utiliser les tokens d’espacement pour padding et gap.

---

## 8. Accessibilité

- **Focus** : `:focus-visible` avec ring visible (couleur accent ou contraste suffisant).
- **Modals** : `role="dialog"`, `aria-modal="true"`, focus trap simple (tab enfermé dans le modal, Echap pour fermer).
- **Contraste** : vérifier texte sur fond (WCAG AA si possible) et accent sur fond panel.
- **Motion** : respecter `prefers-reduced-motion: reduce` pour les transitions et animations (réduire ou désactiver).

---

## 9. Ordre d’application (recommandé)

1. **Tokens** : introduire `ui/tokens.css` (et éventuellement `ui/base.css`) avec couleurs, espacements, typo, rayons. Les importer une fois dans le shell ; les modules en héritent.
2. **Composants** : définir les classes de base (bouton, carte, badge, modal) dans `ui/components.css` ; les réutiliser dans le shell et les modules.
3. **Pilote** : refonte du header et des cartes Home en s’appuyant sur les tokens et composants, sans modifier le scroll ni la disposition du corps.
4. **Dispositions / scroll** : uniquement après **présentation visuelle** validée (voir DESIGN_ANALYSIS.md, section 6 et 7).

---

## 10. Références

- **DESIGN_ANALYSIS.md** : analyse du design actuel (padding, onglets, sidecar, scroll, inventaire des zones), problèmes identifiés et pistes.
- **Shell** : `tauri-shell/src/shell.ts` (CSS et structure du header, home, modals).
- **Explorer** : `tauri-app/src/app.ts` (topbar, toolbar, results, statusbar).
- **Constituer** : `tauri-prep/src/app.ts` (topbar, tabbar, écrans).
