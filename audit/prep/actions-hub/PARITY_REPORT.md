# Audit — Vue Actions Hub — Tauri Prep V1.5

**Mockup :** `prototypes/visual-validation/prep/prep-actions-vnext.html`
**Runtime :** `tauri-prep/src/screens/ActionsScreen.ts` (`_renderHubPanel`) + `tauri-prep/src/ui/app.css`
**Date :** 2026-03-01

---

## Résumé exécutif

L'Actions Hub est la page d'accueil de l'onglet Actions. Dans le runtime (V1.5), il s'agit d'un **écran de navigation**
avec 3 cartes cliquables (Curation, Segmentation, Alignement). Le mockup vnext prévoit un **workspace opérationnel
2-colonnes** affichant simultanément les paramètres d'action et une prévisualisation du diff résultat — une approche
radicalement différente.

---

## B1 — Layout général

| Élément | Mockup | Runtime | Delta | Priorité |
|---------|--------|---------|-------|----------|
| Structure | 2-col : `1.4fr` (params + actions) + `1fr` (diff preview sticky) | 1-col : carte d'en-tête + 3 nav-cards | Structural | **P1** |
| Colonne gauche | Cartes de paramètres (sélecteur doc, options curation, règles…) | Absent (nav vers sous-écrans) | Manque | **P1** |
| Colonne droite | Prévisualisation diff sticky (scroll indépendant) | Absent | Manque | **P1** |
| Persistance entre actions | Docs/paramètres conservés en mémoire lors du switch Curation↔Seg↔Align | Non implémenté | Manque | **P2** |

**Source runtime (`_renderHubPanel`) :**
```typescript
// ActionsScreen.ts — hub panel
<div class="head-card">                    // carte en-tête titre + stats
  <h2>Actions</h2>
  <p class="text-muted">…</p>
</div>
<div class="nav-cards-grid">
  <div class="nav-card" data-action="curation">…</div>    // card → navigate
  <div class="nav-card" data-action="segmentation">…</div>
  <div class="nav-card" data-action="alignement">…</div>
</div>
```

**Source mockup :**
```html
<!-- prep-actions-vnext.html -->
<div class="actions-workspace">           <!-- grid 1.4fr + 1fr -->
  <div class="actions-params-col">
    <div class="doc-selector-card">…</div>
    <div class="action-tabs">…</div>      <!-- Curation / Segmentation / Alignement tabs -->
    <div class="action-params-card">…</div>
  </div>
  <div class="actions-preview-col">
    <div class="diff-preview sticky">…</div>
    <div class="state-cards">…</div>
  </div>
</div>
```

---

## B2 — Carte d'en-tête (head-card)

| Élément | Mockup | Runtime | Delta | Priorité |
|---------|--------|---------|-------|----------|
| Titre | "Traitement de corpus" | `<h2>Actions</h2>` | Wording diff | P3 |
| Compteurs | N documents · N unités · N liens d'alignement | `<p class="text-muted">…</p>` partiel | Partiel | **P2** |
| Statut système | Badge vert/orange/rouge (état du corpus) | Absent | Manque | **P2** |

---

## B3 — Navigation (3 actions)

| Élément | Mockup | Runtime | Delta | Priorité |
|---------|--------|---------|-------|----------|
| Tabs Curation / Seg / Align | Onglets horizontaux dans workspace | Cartes cliquables (nav) | Diff paradigme | **P1** |
| Icônes d'action | Icônes spécifiques (scissors, layers, link) | Emojis (✂ / ¶ / ⇄) | OK approximatif | P3 |
| Description action | Texte court sous chaque tab | Texte présent dans nav-card | ≈ OK | — |
| Sous-titre "Prochaine étape" | Suggestion contextuelle | Absent | Manque | P3 |

---

## B4 — Cartes d'état système

| Élément | Mockup | Runtime | Delta | Priorité |
|---------|--------|---------|-------|----------|
| Carte état "Corpus vide" | Illustration + message + CTA "Importer" | Absent | Manque | **P2** |
| Carte état "Avertissement" | Alerte orange (ex. FTS stale) | Absent | Manque | **P2** |
| Carte état "Erreur critique" | Alerte rouge avec détail | Absent | Manque | **P2** |
| Journal d'activité récente | Liste 3–5 dernières opérations avec date | Absent | Manque | P3 |

*Note : Le journal de bord (log buffer) a été ajouté en P23 dans les sous-écrans Curation/Segmentation/Alignement mais pas dans le hub.*

---

## B5 — Prévisualisation diff (colonne droite)

| Élément | Mockup | Runtime | Delta | Priorité |
|---------|--------|---------|-------|----------|
| Zone prévisualisation sticky | Colonne droite défilant indépendamment | Absent dans hub | Manque | **P1** |
| Diff coloré (avant/après) | Fond vert/rouge pour les changements | Implémenté dans le sous-écran Curation | Pas dans hub | **P1** |
| Label document actif | "Document : [titre]" en tête preview | Présent dans sous-écrans | Pas dans hub | — |

---

## C — États vides et erreurs

| État | Mockup | Runtime | Priorité |
|------|--------|---------|----------|
| Corpus vide | Carte spéciale + CTA | Absent | P2 |
| FTS stale | Alerte orange | Absent | P2 |
| Aucune action en cours | Placeholder diff vide | Absent | P3 |

---

## D — Breakpoints

| Breakpoint | Mockup | Runtime | Priorité |
|------------|--------|---------|----------|
| 1440px | 2-col workspace (1.4fr + 1fr) | Nav cards 3-col grid | P1 (hérite de B1) |
| 1728px | Colonnes plus larges | Idem | P1 (hérite de B1) |

---

## Synthèse vue Actions Hub

| Réf | Élément | Priorité |
|-----|---------|----------|
| ACT-1 | Layout 2-col workspace (params + preview sticky) | **P1** |
| ACT-2 | Tabs horizontaux Curation/Seg/Align (vs nav-cards) | **P1** |
| ACT-3 | Prévisualisation diff sticky (colonne droite) | **P1** |
| ACT-4 | Compteurs corpus (docs · unités · liens) complets | **P2** |
| ACT-5 | Badge statut système dans head-card | **P2** |
| ACT-6 | Carte état "Corpus vide" + CTA | **P2** |
| ACT-7 | Cartes alertes (warning FTS stale, erreur) | **P2** |
| ACT-8 | Titre écran "Actions" → "Traitement de corpus" | P3 |
| ACT-9 | Icônes SVG (vs emojis) | P3 |
| ACT-10 | Journal d'activité récente | P3 |

**Total vue Actions Hub : 3 P1 · 4 P2 · 3 P3**
