# Audit — Vue Exporter — Tauri Prep V1.5

**Sprint :** Export Audit pre-Inc1
**Date :** 2026-03-10
**Mockup analysé :** `prototypes/visual-validation/prep/prep-exporter-vnext.html` (866 lignes)
**Runtime :** `tauri-prep/src/screens/ExportsScreen.ts` (1251 lignes) + `tauri-prep/src/ui/app.css`
**Viewports :** 1440×900 · 1728×1080
**Artefacts :** `runtime_1440.png` · `runtime_1728.png` · `metrics_1440.json` · `metrics_1728.json`

---

## 1. Résumé exécutif

Le runtime Exporter est **fonctionnellement riche** (Flux V2 + 5 exports legacy : TEI, Package ZIP, CSV, Rapport runs, QA) — au-delà du mockup sur certains points. Mais la **structure visuelle diverge** sur 5 points P1 :

1. Pas de head card enrichie (titre plat sans contexte, sans pill de run, sans lien retour).
2. Layout 1-col (formulaire `flex-wrap`) au lieu du **workspace 2-col** : table docs (gauche) + panneau options (droite).
3. Sélection des documents via `<select multiple>` au lieu d'une **table avec checkboxes** (ID · Titre · Langue · Rôle · Statut · filtre).
4. Pas de **grille KPI pré-check** (erreurs bloquantes / warnings / docs validés / alignements actifs).
5. Pas d'**historique des runs export** directement visible (section détails repliée dans legacy caché).

Les écarts P2 concernent la compat-list, la lisibilité du CTA principal, et la statut-backend card.

---

## 2. État de comparabilité

| État runtime | Comparabilité | Note |
|---|---|---|
| **Vide** (aucun corpus ouvert) | Partielle | V2 card visible, sélecteurs vides. Mockup montre état avec docs chargés. |
| **Avec corpus** (`_docs` non vide) | Bonne | Stage selector + options conditionnelles fonctionnels |
| **Après export** (job done) | Bonne | `#v2-summary-hint` mis à jour |
| **Legacy ouvert** | Partielle | 5 sous-cartes TEI/CSV/Report/Package/QA — hors spec mockup vnext |

**Mockup de référence :** `prep-exporter-vnext.html` — titre "Exporter V2 — publication + formats de travail". Le runtime affiche "Exporter" (simple titre).

---

## 3. Métriques runtime mesurées

| Élément | 1440px | 1728px |
|---|---|---|
| v2_doc_sel (multi-select) | 220 × 90 px | 220 × 90 px |
| v2_stage select | 190 × 29 px | 190 × 29 px |
| v2_product select | 248 × 29 px | 248 × 29 px |
| v2_format select | 180 × 29 px | 180 × 29 px |
| v2_run_btn | 184 × **20** px (btn-sm) | 184 × 20 px |
| legacy_toggle_card | 1175 × 71 px | 1463 × 71 px |
| legacy_container | display:none | display:none |
| export_log_card | 1175 × 67 px (collapsed) | 1463 × 67 px |
| scroll_height | **898 px** (≈ viewport) | **1078 px** (≈ viewport) |

**Présences DOM : 13/13** — tous les éléments ExportsScreen présents.

**Observation scroll :** `scroll_height ≈ viewport_h - 2` aux deux viewports — la page tient dans un seul écran, ~240px vides sous la fold à 1440px.

---

## 4. Écarts structurels (P1)

---

### EXP-1 — P1 · Head card absente

**Symptôme runtime :**
`h2.screen-title "Exporter"` — titre plat sans card wrapper, sans description, sans pill de contexte, sans lien de retour vers Alignement.

**Mockup :**
`section.card.head-card` avec :
- `h1 "Exporter V2 — publication + formats de travail"`
- `p "Un même onglet pour 3 besoins: livrer (TEI), partager (CSV/Excel/TXT), archiver (DB + historique run)."`
- Pill "run source: align_2026-03-04_10h14" (contexte run actif)
- Bouton lien "← Retour alignement"

**Root cause :** Non implémenté. Les autres vues (Alignement, Segmentation, Curation) ont toutes une `section.acts-seg-head-card`. Exporter n'a pas cet équivalent.

**Fix Inc 1 minimal :** Ajouter une head card légère avec h2 + desc + pill run source (depuis `_lastRunId` ou `localStorage.getItem(ActionsScreen.LS_WF_RUN_ID)`) + lien "← Alignement".

---

### EXP-2 — P1 · Layout 1-col vs workspace 2-col

**Symptôme runtime :**
Toute la vue Exporter V2 est dans un seul `section.card` avec `div.form-row` (flex, `align-items: flex-end`, `flex-wrap`). Les contrôles (docs, stage, product, format, options) coexistent dans un seul flux horizontal qui wrappe librement.

**Mockup :**
```css
.export-doc-workspace {
  display: grid;
  grid-template-columns: minmax(440px, 1fr) minmax(300px, .85fr);
  gap: 10px;
  align-items: start;
}
```
Colonne gauche : toolbar (search + lang filter + select-all) + `table.doc-grid-table`.
Colonne droite (`aside.export-panel`) : selection meta + stage + options + compat-list + CTA.

**Root cause :** L'architecture choisie (formulaire unifié V2 avec stage selector) est orthogonale au workspace 2-col du mockup. Le `form-row` n'a aucun équivalent de l'`export-doc-workspace`.

**Impact :** Espace utilisé ≈ 40% du viewport. `scroll_height ≈ viewport` = la page tient dans un seul écran, laissant ~240px vides sous la fold. L'export panel mockup est dense et lisible ; le runtime est plat et peu hiérarchisé.

**Fix Inc 1 :** Restructurer `render()` en `div.exp-workspace` (grid 2-col) : colonne gauche = doc selection, colonne droite = options + CTA.

---

### EXP-3 — P1 · Sélection docs : multi-select vs table checkboxes

**Symptôme runtime :**
```html
<select id="v2-doc-sel" multiple style="height:90px;min-width:220px">
  <option value="__all__" selected>— Tous les documents —</option>
</select>
```
220×90px, sélection native HTML. Aucune visibilité sur titre, langue, rôle, statut par document.

**Mockup :**
```html
<table class="doc-grid-table">
  <thead>
    <tr><th></th><th>ID</th><th>Titre</th><th>Langue</th><th>Rôle</th><th>Statut</th></tr>
  </thead>
  <tbody> <!-- lignes avec checkboxes + pills statut --> </tbody>
</table>
```
Toolbar au-dessus : search input + filtre langue + "Tout sélectionner".

**Root cause :** Le `<select multiple>` est fonctionnellement équivalent pour passer les IDs à l'API, mais visuellement appauvri. La table du mockup montre le rôle (pivot/traduction), le statut (validé/aligné/à vérifier), et le titre complet.

**Fix Inc 1 :** Remplacer `#v2-doc-sel` par une `div.exp-doc-table-wrap` avec `table.exp-doc-grid` (checkbox + ID + titre tronqué + langue + rôle + statut pill). Maintenir l'état interne de sélection via les checkboxes.

---

### EXP-4 — P1 · Grille KPI pré-check absente

**Symptôme runtime :** Pas de section KPI pré-export. L'utilisateur lance l'export sans voir les indicateurs de qualité (erreurs bloquantes, warnings, docs validés, alignements actifs).

**Mockup :**
```html
<section class="card">
  <div class="card-head">
    <h3>Pré-check avant export</h3>
    <span class="pill warn">bloquant si erreurs</span>
  </div>
  <div class="body">
    <div class="check-grid">
      <div class="check ok"><div class="k">Erreurs bloquantes</div><div class="v">0</div></div>
      <div class="check warn"><div class="k">Warnings</div><div class="v">3</div></div>
      <div class="check ok"><div class="k">Docs validés</div><div class="v">12 / 12</div></div>
      <div class="check ok"><div class="k">Alignements actifs</div><div class="v">98.4%</div></div>
    </div>
    <div class="btns">
      <a class="btn alt">Ouvrir audit avancé</a>
      <button class="btn">Prévisualiser rapport QA</button>
    </div>
  </div>
</section>
```

**Root cause :** Non implémenté. La logique métier est disponible via `/align/quality` (déjà utilisée dans `#act-quality-card` d'ActionsScreen) mais non exposée dans ExportsScreen.

**Fix Inc 1 minimal :** Ajouter une mini grille 4-KPI statique ou calculée côté client depuis `_docs` + lien vers vue Alignement pour l'audit complet. Backend non requis pour afficher N docs / N docs chargés.

---

### EXP-5 — P1 · Historique des runs export absent

**Symptôme runtime :** Pas d'historique des exports directement visible. Le `#exports-legacy-container` (hidden par défaut) contient des exports par format mais PAS un tableau historique des runs passés.

**Mockup :**
```html
<details class="history-wrap">
  <summary>Historique des runs export (replié par défaut) <span class="caret">▾</span></summary>
  <div class="history-body">
    <div class="table">
      <div class="trow thead">Date · Run ID · Statut · Sortie</div>
      <div class="trow">2026-03-06 · run_84c9 · OK · agrafes_publication_…zip</div>
    </div>
    <div class="btns">[Ouvrir dossier exports] [Copier run ID]</div>
  </div>
</details>
```

**Root cause :** Requiert une couche de persistance (localStorage ou `/jobs` filtré par type export) non encore implémentée dans ExportsScreen.

**Fix Inc 2 :** Ajouter `details.exp-history-wrap` replié alimenté depuis `GET /jobs?kind=export&limit=10`. Fix Inc 1 léger : mémoriser les 5 derniers exports en localStorage.

---

## 5. Écarts de densité/proportion (P2)

---

### EXP-6 — P2 · CTA export peu visible

**Symptôme :** `button#v2-run-btn.btn.btn-primary.btn-sm` — 184×**20**px. `.btn-sm { padding: 0.2rem 0.55rem; font-size: 0.78rem }` donne une hauteur de seulement 20px. Désactivé par défaut.

**Mockup :** `button.btn.pri "Lancer export"` — padding standard (8px 10px), lisible, bien distinct dans l'export-panel.

**Fix Inc 1 :** Retirer `.btn-sm` sur `v2-run-btn`. Taille visée : ~34px.

---

### EXP-7 — P2 · Compat-list absente du flux V2

**Symptôme :** La compat-list (CSV OK / TEI OK / XLSX todo…) est dans le mockup mais absente du flux V2 runtime. Elle n'est accessible que dans le legacy hidden.

**Fix Inc 2 :** Ajouter `div.exp-compat-list` condensée dans l'export-panel du workspace.

---

### EXP-8 — P2 · Statut backend card absente

**Symptôme :** Pas de card "Statut backend actuel" (grille 2-col Disponible/À implémenter).

**Impact :** Informatif seulement. Non bloquant pour l'usage.

---

### EXP-9 — P2 · État vide sans guidage

**Symptôme :** En état vide (0 docs), la vue montre `"Portée actuelle: tous les documents (0)."` sans message d'orientation vers Import.

**Fix Inc 1 :** Afficher `div.exp-empty-hint "Aucun document importé — allez d'abord dans Importer."` si `_docs.length === 0`.

---

## 6. Faux positifs (état vide / legacy hidden)

| Point | Aspect | Verdict |
|---|---|---|
| `v2_doc_sel` vide (0 options) | Normal en état vide | Faux positif état vide |
| `legacy_container` display:none | Caché par design (toggle) | Comportement voulu |
| `v2_run_btn` disabled | Normal — pas de corpus | Faux positif état vide |
| `export_log_card` 67px collapsed | Collapsé par défaut | OK |
| scroll_height ≈ viewport | Conséquence du manque de sections | Pas un bug isolé |

---

## 7. Éléments surplus runtime (au-delà du mockup)

| Élément | Description | Impact visuel |
|---|---|---|
| `#exports-legacy-container` | 5 exports spécialisés (TEI / Package / CSV / RunReport / QA) | Caché — P3 |
| `section "État de session"` | Banner connexion sidecar (collapsed 71px) | Faible |
| `section "Journal des exports"` | Log textarea (collapsed 67px) | Faible |
| `#v2-summary-hint` | "Sélection courante → Alignement → CSV" | Utile, non dans mockup |
| Stage selector étendu | Options Runs / QA en plus des 4 du mockup | Utile, non dans mockup |
| Options conditionnelles (`v2-align-options` etc.) | Panels par stage | Fonctionnel, mockup plus simple |

---

## 8. Causes racines probables

1. **Formulaire flat V2** : le Flux export V2 a été conçu comme formulaire unifié (stage → options conditionnelles → run). C'est fonctionnel mais paradigme différent du workspace 2-col du mockup.
2. **Table docs non implémentée** : `<select multiple>` = substitut temporaire au `doc-grid-table` — bien moins informatif.
3. **Head card absente** : ExportsScreen n'a pas reçu la refonte head card des autres vues.
4. **Pré-check non câblé** : logique `/align/quality` disponible côté backend mais non exposée dans ExportsScreen.
5. **Historique exports** : requiert persistance (localStorage ou API) non encore implémentée.

---

## 9. Recommandation Inc 1

**Scope minimal — 5 fixes HTML/CSS :**

| Fix | Fichier | Coût estimé |
|---|---|---|
| EXP-1 : head card (h2 + desc + pill run source + lien) | `ExportsScreen.ts` | ~20 lignes HTML |
| EXP-2+3 : workspace 2-col + table docs checkboxes | `ExportsScreen.ts` + `app.css` | ~80 lignes HTML + 25 CSS |
| EXP-4 : mini grille KPI 4-cases | `ExportsScreen.ts` + `app.css` | ~15 lignes HTML + 5 CSS |
| EXP-6 : retirer `.btn-sm` sur v2-run-btn | `ExportsScreen.ts` | 1 mot supprimé |
| EXP-9 : hint état vide "aucun doc" | `ExportsScreen.ts` | ~5 lignes + `_refreshDocs()` |

**EXP-5** (historique exports) et **EXP-7** (compat-list dans panel) → Inc 2.

---

## 10. Niveaux de priorité

| ID | Priorité | Nature | Fix |
|---|---|---|---|
| EXP-1 | **P1** | Head card manquante | head card + pill run |
| EXP-2 | **P1** | Layout structural | workspace 2-col |
| EXP-3 | **P1** | Sélection docs appauvrie | table checkboxes |
| EXP-4 | **P1** | Info manquante | grille KPI pré-check |
| EXP-5 | **P1** | Historique absent | Inc 2 (persistance requise) |
| EXP-6 | P2 | CTA peu visible | retirer btn-sm |
| EXP-7 | P2 | Compat-list absente V2 | Inc 2 |
| EXP-8 | P2 | Info contextuelle | statut backend card |
| EXP-9 | P2 | État vide sans guidage | hint "aucun document" |

**Total : P1 = 5 · P2 = 4**
