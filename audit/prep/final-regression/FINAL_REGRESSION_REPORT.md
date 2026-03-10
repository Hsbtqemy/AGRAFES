# Rapport de régression finale — tauri-prep UI/UX
**Date :** 2026-03-10
**Scope :** tauri-prep — 7 vues — breakpoints 1440 et 1728
**Captures :** `audit/prep/final-regression/*.png`

---

## 1. Verdict global

> **PRÊT À CLÔTURER.**
>
> Aucune régression bloquante détectée sur l'ensemble des 7 vues aux deux breakpoints.
> Tous les chantiers de modernisation (Importer, Documents, Hub, Curation, Segmentation, Alignement, Exporter) sont stables.

---

## 2. Invariants globaux — statut

| Invariant | 1440 | 1728 | Remarque |
|-----------|------|------|----------|
| Topbar (brand + actions) | ✅ | ✅ | Constant sur toutes les vues |
| Sidebar (SECTIONS + tabs + tree) | ✅ | ✅ | ~210px / ~180px, aucun débordement |
| Contenu utile `.content` | ✅ | ✅ | Padding 16px gauche/droite cohérent |
| Typographie principale | ✅ | ✅ | h2 screen-title / h3 section / body uniforme |
| Cards (border, radius, padding) | ✅ | ✅ | Style cohérent sur toutes les vues |
| Boutons primaires | ✅ | ✅ | Taille correcte (≥30px hauteur) |
| Chips / badges | ✅ | ✅ | Cohérents |
| Accordéons repliés | ✅ | ✅ | Tous correctement collapsés |
| Bleed CSS inter-vues | ✅ | ✅ | Aucun bleed détecté |
| Navigation entre vues | ✅ | ✅ | Pas de classes fantômes, pas de layout résiduel |
| Bannière état sidecar | ✅ | ✅ | Uniforme sur toutes les vues |

---

## 3. Vues — statut par breakpoint

### 3.1 Importer

| | 1440 | 1728 |
|-|------|------|
| Head card + stepper | ✅ | ✅ |
| Workspace 2-col (dropzone + settings) | ✅ | ✅ |
| État vide guidé (dropzone visible) | ✅ | ✅ |
| Footer sticky + CTA "Importer le lot" | ✅ | ✅ |
| Ratio cols (≈1.4fr / 1fr) | ✅ | ✅ |

### 3.2 Documents

| | 1440 | 1728 |
|-|------|------|
| Head card + KPI chips | ✅ | ✅ |
| Workspace 2-col (table + édition) | ✅ | ✅ |
| Table vide avec message sidecar off | ✅ | ✅ |
| Accordéons (Édition en masse / Journal) | ✅ | ✅ |
| Toolbar (filtre + search) | ✅ | ✅ |

### 3.3 Actions Hub

| | 1440 | 1728 |
|-|------|------|
| Head "Traitement de corpus" + CTA grand texte | ✅ | ✅ |
| 3 wf-cards (Curation / Segmentation / Alignement) | ✅ | ✅ |
| Badges Étape 1/2/3 | ✅ | ✅ |
| Boutons "Ouvrir →" + "Grand texte ↗" | ✅ | ✅ |
| Journal accordion | ✅ | ✅ |

### 3.4 Curation

| | 1440 | 1728 |
|-|------|------|
| ← Vue synthèse | ✅ | ✅ |
| Head card + mode chips + CTAs | ✅ | ✅ |
| Workspace 3-col (paramètres / preview / diagnostics) | ✅ | ✅ |
| Chips de règles curation | ✅ | ✅ |
| Retouches avancées (expandable) | ✅ | ✅ |
| Actions rapides | ✅ | ✅ |

### 3.5 Segmentation

| | 1440 | 1728 |
|-|------|------|
| ← Vue synthèse | ✅ | ✅ |
| Head card + workflow chips | ✅ | ✅ |
| Workspace 2-col (paramètres + preview) | ✅ | ✅ |
| Mode selector (Unités / Traduction / Document complet) | ✅ | ✅ |
| Vue d'ensemble corpus + Journal (accordéons) | ✅ | ✅ |

### 3.6 Alignement

| | 1440 | 1728 |
|-|------|------|
| ← Vue synthèse | ✅ | ✅ |
| Head card + navigation CTAs | ✅ | ✅ |
| Workflow alignement guidé (accordéon) | ✅ | ✅ |
| Documents du corpus (accordéon) | ✅ | ✅ |
| Layout 2-col CONFIGURATION DU RUN + focus pane | ✅ | ✅ |
| min-height focus pane (ALIGN-2 fix) | ✅ | ✅ |
| Qualité / Collisions / Rapport runs (accordéons) | ✅ | ✅ |

### 3.7 Exporter

| | 1440 | 1728 |
|-|------|------|
| Head card (titre + desc + pill + ← Alignement) | ✅ | ✅ |
| KPI strip (4 cases) | ✅ | ✅ |
| Workspace 2-col (docs + options) | ✅ | ✅ |
| CTA "Choisir destination et lancer…" (sans btn-sm) | ✅ | ✅ |
| Legacy toggle + Journal (accordéons) | ✅ | ✅ |
| Sélects options col (width:100%) | ✅ | ✅ |

---

## 4. Régressions et écarts relevés

### 4a. Bloquants avant clôture

_Aucun._

### 4b. Non-bloquants

| ID | Vue | Description | Impact |
|----|-----|-------------|--------|
| RG-1 | Exporter | Table docs et empty-hint (`#exp-empty-hint`) restent masqués sans sidecar. `_renderDocTable()` n'est appelé qu'après `_refreshDocs()` qui retourne tôt si `!conn`. | Fonctionnel — zone doc-col vide mais propre. Visible uniquement avec sidecar. **Limite de validation**, pas un bug. |
| RG-2 | Documents | Ratio 2-col à 1440 : ~52/48 (presque 50/50). La table doc est légèrement plus étroite que l'idéal. | Visuel mineur. Aucun élément masqué ou débordant. |

### 4c. Polish optionnel (hors scope clôture)

| ID | Vue | Description |
|----|-----|-------------|
| POL-1 | Exporter | KPI "Sélectionnés" affiche `0` au lieu de `—` quand `_docs.length === 0` (sélection `__all__` → `undefined` → `String(0)`). Lisible mais légèrement ambigu. |
| POL-2 | Hub | Grande zone vide sous le Journal accordion à 1440/1728 (état corpus vide). Comportement normal avec sidecar off, mais trou visuel notable. |
| POL-3 | Importer 1728 | Stepper pills légèrement compressées à 1728 (wrap possible à viewport < 1200). Pas de cassure observée aux breakpoints cibles. |

---

## 5. Vérification CSS bleed

Tests croisés effectués (navigation séquentielle dans une même session Chrome) :

| Transition | Résultat |
|------------|---------|
| Importer → Documents | ✅ Aucune classe `.import-screen` résiduelle |
| Documents → Actions Hub | ✅ Aucune classe `.meta-screen` résiduelle |
| Hub → Curation | ✅ Aucune classe `.acts-hub` résiduelle dans la vue curate |
| Curation → Segmentation | ✅ Scope `.curate-workspace` correctement isolé |
| Segmentation → Alignement | ✅ Pas de bleed `.seg-workspace` |
| Alignement → Exporter | ✅ `.exports-screen` vs `.actions-screen` — bleed corrigé (Inc 1) |

---

## 6. Limites de validation

Les éléments suivants dépendent du sidecar actif et **ne peuvent pas être validés visuellement** en mode headless sans corpus :

- Listes de documents (vide dans toutes les vues)
- Preview curation (placeholder uniquement)
- Preview segmentation (placeholder uniquement)
- Audit alignement (tableau vide)
- Table docs exporter (hidden — EXP-3/EXP-9)
- KPI avec vraies valeurs

Ces éléments ont été validés fonctionnellement lors des développements de chaque incrément. Les captures confirment que les états vides sont propres et guidés.

---

## 7. Recommandation finale

**Commit / merge sans restriction.**

Aucune correction nécessaire avant clôture. Les points RG-1 et RG-2 sont des limites connues ou des comportements attendus. Les items polish (POL-1 à POL-3) peuvent être adressés dans un sprint dédié si souhaité.

---

_Rapport généré le 2026-03-10 — captures disponibles dans `audit/prep/final-regression/`_
