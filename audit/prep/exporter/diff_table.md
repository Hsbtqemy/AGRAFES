# Diff Table — Alignement Runtime vs Mockup — Exporter

**Date :** 2026-03-10
**Mockup :** `prep-exporter-vnext.html`
**Runtime :** `ExportsScreen.ts` (V0.4B) + `app.css`

---

## Métriques clés

| Élément | Mockup | Runtime 1440 | Runtime 1728 | Écart | Sévérité |
|---|---|---|---|---|---|
| Layout principal | `export-doc-workspace` grid `minmax(440px,1fr) minmax(300px,.85fr)` | `form-row` flex-wrap 1-col | idem | Paradigme divergent | 🔴 P1 |
| Sélection docs | `table.doc-grid-table` (checkbox+ID+Titre+Langue+Rôle+Statut) | `<select multiple>` 220×90px | idem | Perte info doc | 🔴 P1 |
| Head card | `section.card.head-card` (h1+desc+pill run+lien retour) | `h2.screen-title "Exporter"` | idem | Pas de contexte | 🔴 P1 |
| Pré-check KPI | `section.card` avec `check-grid` 4 cases | Absent | Absent | Info manquante | 🔴 P1 |
| Historique exports | `details.history-wrap` (Date/Run ID/Statut/Sortie) | Absent (legacy caché) | Absent | Info manquante | 🔴 P1 |
| CTA "Lancer export" | `button.btn.pri` standard | `button.btn-primary.btn-sm` 184×**20**px | idem | Peu visible | ⚠️ P2 |
| Compat-list | 7 items (CSV OK / XLSX todo…) | Absent flux V2 (legacy seul) | idem | Info manquante | ⚠️ P2 |
| Statut backend card | `section.card` grid 2-col Disponible/À impl. | Absent | Absent | Info contextuelle | ⚠️ P2 |
| État vide | (non spécifié dans mockup) | `"tous les documents (0)."` hint | idem | Pas de guidage | ⚠️ P2 |

---

## Table diff zone par zone

| Zone | Symptôme runtime | Mockup attendu | Cause probable | Sélecteur / bloc | Impact | Fix minimal |
|---|---|---|---|---|---|---|
| Head card | `h2.screen-title "Exporter"` plat, sans desc, sans pill | `section.card.head-card` (h1+desc+pill run source+lien) | Non implémenté (autres vues ont `acts-seg-head-card`) | `ExportsScreen.render()` l.69-77 | Pas de contexte corpus visible | Ajouter head card avec pill `localStorage.getItem(LS_WF_RUN_ID)` |
| Layout workspace | `div.form-row` flex-wrap 1-col — tous contrôles dans un seul flux | `div.export-doc-workspace` grid `minmax(440px,1fr) minmax(300px,.85fr)` | Architecture formulaire unifié V2 ≠ workspace 2-col mockup | `ExportsScreen.render()` l.83-180 | Espace sous-utilisé (~240px libres sous fold) | Restructurer en `div.exp-workspace` grid 2-col |
| Sélection docs | `<select multiple style="height:90px;min-width:220px">` — nom doc uniquement | `table.doc-grid-table` checkbox + ID + Titre + Langue + Rôle + Statut + toolbar search/filter | `<select multiple>` = substitut temporaire non remplacé | `#v2-doc-sel` l.85-87 + `_refreshDocs()` | Aucune visibilité titre/langue/rôle/statut doc | Remplacer par table checkboxes dans colonne gauche |
| Pré-check KPI | Absent | `section.card` avec `check-grid` 4 KPIs (0 erreurs, N warnings, N/N docs validés, alignements actifs%) + btns audit + QA | Non implémenté | — (à ajouter entre head card et workspace) | L'utilisateur exporte sans indication de qualité | Ajouter mini `div.exp-check-grid` 4-cases calculé depuis `_docs` |
| Historique exports | Absent | `details.history-wrap` replié (Date/Run ID/Statut/Sortie) | Requiert persistance exports terminés | — (à ajouter après workspace) | Aucun accès historique sans legacy toggle | Inc 2 : `/jobs?kind=export` ou localStorage 5 derniers |
| CTA "Lancer export" | `button.btn-primary.btn-sm` 184×20px (disabled) | `button.btn.pri` padding standard | `.btn-sm { padding: 0.2rem }` → 20px hauteur | `#v2-run-btn` l.179 | Bouton principal quasi invisible | Supprimer `.btn-sm` → taille ~34px |
| Compat-list | Absente du flux V2 | `div.compat-list` (7 items CSV/TXT/DOCX/TEI/XLSX-todo/DOC-todo/Snapshot-todo) | Non ajoutée au panel V2 | — (à ajouter dans export-panel droite) | L'utilisateur ne sait pas quel format est prêt | Inc 2 : ajouter `div.exp-compat-list` condensée |
| Statut backend card | Absente | `section.card "Statut backend actuel"` grid 2-col (Disponible / À implémenter) | Non implémenté (informatif) | — | Absence d'info sur formats disponibles | Non prioritaire (compat-list suffit) |
| État vide | `"Portée actuelle: tous les documents (0)."` hint discret | Non spécifié dans mockup — inféré | Pas de condition `_docs.length === 0` | `_refreshDocs()` | Légèrement déroutant | `if (_docs.length === 0) show exp-empty-hint` |

---

## Présences DOM (13/13)

| Élément | Runtime | Verdict |
|---|---|---|
| `.screen-title` | ✅ "Exporter" | OK — titre plat (P1 : manque head card enrichie) |
| `#exp-state-banner` | ✅ (collapsed) | OK |
| `#v2-doc-sel` | ✅ 220×90px | P1 — multi-select au lieu de table |
| `#v2-stage` | ✅ 190×29px | OK — fonctionnel |
| `#v2-product` | ✅ 248×29px | OK — fonctionnel |
| `#v2-format` | ✅ 180×29px | OK — fonctionnel |
| `#v2-run-btn` | ✅ 184×20px (disabled) | P2 — btn-sm trop petit |
| `#v2-align-options` | ✅ (hidden / stage conditonnel) | OK |
| `#v2-tei-options` | ✅ (hidden) | OK |
| `#v2-package-options` | ✅ (hidden) | OK |
| `.export-legacy-toggle-card` | ✅ 1175×71px | OK |
| `#exports-legacy-container` | ✅ display:none | OK (toggle) |
| `#export-log` | ✅ (collapsed) | OK |

---

## Synthèse

| P | Count | IDs |
|---|---|---|
| **P1** | 5 | EXP-1 (head), EXP-2 (layout), EXP-3 (docs table), EXP-4 (précheck), EXP-5 (historique) |
| P2 | 4 | EXP-6 (btn-sm), EXP-7 (compat-list), EXP-8 (statut card), EXP-9 (état vide) |
