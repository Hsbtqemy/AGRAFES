# Plan d'évolution — Curation review locale
**Date** : 2026-03-13  
**Base** : audit `CURATION_REVIEW_AUDIT.md`  
**Principe** : incréments autonomes, régressabilité faible, sans refonte de l'architecture de données sidecar

---

## Lecture du plan

| Niveau | Nature | Complexité JS | Complexité CSS | Dépendance sidecar |
|---|---|---|---|---|
| 1 — Micro-ajustements | UI câblage + CSS | Faible | Faible | Aucune |
| 2 — Amélioration intermédiaire | État JS + interactions | Moyenne | Faible | Légère (attribut rule_id dans la réponse) |
| 3 — Mode review local | Objet diff en mémoire + flux d'action | Élevée | Moyenne | Oui (API patch local ou exceptions) |

---

## Niveau 1 — Micro-ajustements

> Objectif : éliminer les frictions les plus visibles sans changer la logique métier.  
> Condition : aucune modification de l'API sidecar. Travail purement frontend.

### 1.1 Câbler les boutons Précédent/Suivant

**Symptôme** : `.curate-nav-actions .btn` hard-disabled, `_navigateCurateDoc()` existe mais n'est jamais appelée.  
**Correctif** : attacher les listeners aux boutons, activer/désactiver selon la position dans `_docs[]`.  
**Bénéfice** : navigation doc sans quitter la sous-vue.  
**Coût** : faible (< 10 lignes).  
**Risque** : nul — la logique de nav est déjà implémentée.  
**Ordre** : priorité 1, premier à faire.

### 1.2 Câbler le label doc (`#act-curate-doc-label`)

**Symptôme** : `_refreshCurateHeaderState()` met à jour `#act-curate-mode-pill` et `#act-curate-doc-label` — mais ces éléments ne sont jamais alimentés (dead).  
**Correctif** : s'assurer que `_refreshCurateHeaderState()` est appelée après chaque `_currentCurateDocId()` et après la navigation.  
**Bénéfice** : l'utilisateur sait quel document est actif sans regarder le select.  
**Coût** : faible.  
**Risque** : nul.  
**Ordre** : priorité 1.

### 1.3 Supprimer ou remplacer les chips preview non fonctionnelles

**Symptôme** : `.preview-controls` contient `Brut`, `Diff`, `Côte à côte`, `+contexte` sans listener.  
**Option A** : supprimer les chips (moins de confusion).  
**Option B** : implémenter `Brut` (masquer diff, afficher raw seul) et `Diff` (masquer raw, afficher diff seul) — les deux états sont réalisables avec un toggle CSS sur la `.preview-grid`.  
**Bénéfice** : éliminer la fausse affordance (option A) ou apporter de la valeur réelle (option B).  
**Coût** : option A = faible ; option B = moyen.  
**Risque** : faible dans les deux cas.  
**Ordre** : priorité 2.

### 1.4 Hiérarchie Diagnostics : summary sticky + journal secondaire scrollable

**Symptôme** : la colonne Diagnostics n'est pas scrollable de façon explicite ; si le nombre de règles est élevé ou si le journal est long, le contenu est masqué.  
**Correctif** :  
- Passer `#act-curate-diag` en `overflow-y: auto; max-height: Xpx` avec un scroll interne.  
- Séparer visuellement la section "résumé" (nb modifications, nb règles) — la rendre **sticky** en haut de la colonne — du détail des règles.  
- Passer `#act-curate-review-log` en `overflow-y: auto; max-height: Xpx` indépendant.  
**Bénéfice** : le résumé reste visible quelle que soit la longueur du journal.  
**Coût** : faible (CSS + 2–3 lignes TS).  
**Risque** : nul.  
**Ordre** : priorité 2.

### 1.5 Rééquilibrage des colonnes

**Symptôme** : colonne gauche 310px, centre min 580px, droite 300px. La colonne droite (Diagnostics) est trop étroite pour des règles regex longues.  
**Correctif** : passer la grille à `280px minmax(600px,1fr) 320px` ou `260px minmax(580px,1fr) 340px`. Éventuellement permettre à la colonne droite de se réduire plus doucement.  
**Bénéfice** : Diagnostics plus lisible, labels non tronqués.  
**Coût** : faible (1 règle CSS).  
**Risque** : possible impact layout responsive (tester à 1400px).  
**Ordre** : priorité 3.

### 1.6 Mise en évidence du premier diff visible au chargement de la preview

**Symptôme** : après une preview, `#act-diff-list` se remplit mais aucune modification n'est mise en avant. L'utilisateur voit une liste sans point d'entrée.  
**Correctif** : après `_renderDiffList()`, ajouter la classe `.diff-item-first` sur le premier item `.diff-item`. En CSS : `border-left: 3px solid var(--color-accent)` ou highlight léger.  
**Bénéfice** : ancre visuelle immédiate.  
**Coût** : très faible.  
**Risque** : nul.  
**Ordre** : priorité 2.

---

## Niveau 2 — Amélioration intermédiaire

> Objectif : introduire la notion de "modification active" et une synchronisation entre les zones.  
> Condition : les diff items doivent porter un index ou un identifiant interne. Si `curatePreview()` renvoie des exemples avec un index de ligne, c'est suffisant.

### 2.1 Notion de modification active

**Description** :  
- Ajouter un état `_activeDiffIndex: number | null = null` dans le scope de la Curation.  
- Chaque `.diff-item` dans `#act-diff-list` est cliquable → met à jour `_activeDiffIndex`.  
- La modification active reçoit une classe `.diff-active` avec surlignage.  
- La navigation Précédent/Suivant (1.1) pilote aussi `_activeDiffIndex` en mode "modification" plutôt que "document" (deux modes possibles).  
**Bénéfice** : passage de "preview globale" à "revue d'une modification".  
**Coût** : moyen (état + re-render partiel + scroll).  
**Risque** : faible si le diff index correspond à la ligne dans le raw.  
**Dépendance sidecar** : nécessite que chaque exemple de `curatePreview` porte un `line_index` ou équivalent (à vérifier dans la réponse API actuelle).  
**Ordre** : priorité 1 du niveau 2.

### 2.2 Synchronisation diff → raw (scroll)

**Description** :  
- Quand `_activeDiffIndex` change, `#act-preview-raw` scrolle vers la ligne correspondante (si `line_index` disponible).  
- Réciproquement, si l'utilisateur scroll dans le raw, un listener `scroll` peut mettre à jour l'item actif dans le diff (optionnel, plus complexe).  
**Bénéfice** : les deux panes deviennent une vue coordonnée.  
**Coût** : moyen.  
**Risque** : faible si les indices sont fiables.  
**Ordre** : priorité 2 du niveau 2.

### 2.3 Diagnostics cliquables → filtre diff par règle

**Description** :  
- Chaque item `.curate-diag` devient cliquable.  
- Cliquer sur "guillemets : 14 applications" filtre `#act-diff-list` pour n'afficher que les modifications issues de la règle `quotes`.  
- Nécessite que `_renderDiffList()` stocke le `rule_id` sur chaque `.diff-item` (attribut `data-rule`).  
- Un bouton "Tout afficher" efface le filtre.  
**Bénéfice** : Diagnostics devient un panneau d'action de filtrage — transformation fondamentale de son rôle.  
**Coût** : moyen (attributs data + filtre + toggle CSS).  
**Risque** : nécessite que la réponse `curatePreview` expose le `rule_id` par modification (à confirmer).  
**Ordre** : priorité 2 du niveau 2.

### 2.4 Actions locales minimales : Ignorer cette modification

**Description** :  
- Sur chaque `.diff-item` actif : bouton `⌫ Ignorer` (ou icône ×).  
- "Ignorer" signifie : retirer la modification de la liste visible + la mémoriser dans `_ignoredDiffs: Set<string>` (clé = `line_index + rule_id`).  
- Lors de `_runCurate()`, les lignes ignorées sont passées en paramètre `exclude_lines` si l'API le supporte, sinon la liste est conservée côté UI uniquement (revue purement locale).  
- Un compteur "N modifications ignorées" apparaît dans Diagnostics.  
**Bénéfice** : première granularité locale réelle.  
**Coût** : moyen (état + UI par item + éventuellement param API).  
**Risque** : si l'API ne supporte pas `exclude_lines`, l'ignore est purement cosmétique (ne protège pas à l'application).  
**Ordre** : priorité 3 du niveau 2.

### 2.5 Transformation de Diagnostics : résumé d'action, pas juste d'information

**Description** : restructurer la colonne droite en deux zones :  
- **Zone A (sticky)** : compteurs clés — `N modifications`, `N ignorées`, `N acceptées`, `règles actives`.  
- **Zone B (scrollable)** : liste des règles cliquables (filtre diff — voir 2.3).  
- **Zone C (secondaire)** : journal de revue (replié par défaut, accessible via un toggle).  
**Bénéfice** : Diagnostics devient un **tableau de bord de la revue** plutôt qu'un rapport post-analyse.  
**Coût** : moyen (restructuration HTML + CSS + état).  
**Risque** : faible si fait proprement en sur-couche.  
**Ordre** : priorité 1 du niveau 2 (en parallèle de 2.1).

---

## Niveau 3 — Vrai mode review/edit local

> Objectif : permettre une correction manuelle ponctuelle et la gestion d'exceptions locales.  
> Condition : sidecar doit exposer un endpoint de patch local ou de liste d'exclusions persistées.

### 3.1 Panneau local de revue — mode "modification par modification"

**Description** :  
- Un mode dédié (bouton "Mode revue" dans la tête de la colonne centrale) remplace la vue côte-à-côte par un panneau focalisé :  
  - **En-tête** : `Modification X / N` + règle source + ligne dans le document.  
  - **Corps** : texte AVANT (lecture) | texte APRÈS (lecture ou édition inline).  
  - **Contexte** : 2–3 lignes avant et après la modification.  
  - **Actions** : `✓ Accepter` | `⌫ Ignorer` | `✎ Éditer` | `→ Suivante`.  
**Bénéfice** : workflow éditorial complet, modification par modification.  
**Coût** : élevé (vue dédiée, état complet, scroll restauration).  
**Risque** : moyen (si l'édition inline est mal gérée, elle peut produire un patch incohérent).  
**Ordre** : dernier.

### 3.2 Édition manuelle ponctuelle (override local)

**Description** :  
- Dans le mode revue (3.1), la cellule APRÈS est un `contenteditable` ou `<textarea>` pré-rempli avec la suggestion.  
- L'utilisateur peut modifier la suggestion avant de l'accepter.  
- Le patch final contient : `{line_index, original, curated_auto, curated_manual}`.  
**Bénéfice** : correction fine impossible avec les règles globales.  
**Coût** : élevé (état par diff + API de patch).  
**Risque** : élevé (cohérence avec le reste du document si les lignes interagissent).  
**Ordre** : après 3.1 stabilisé.

### 3.3 Exceptions locales persistées

**Description** :  
- Certaines ignorances (`_ignoredDiffs`) peuvent être sauvegardées comme exceptions persistantes pour ce document (ou ce corpus).  
- Par exemple : "ne jamais remplacer 'Barnabé' par les guillemets typographiques dans le doc #5".  
- Stockage dans la DB sidecar (nouvelle table `curation_exceptions`) ou dans un fichier `.curation_overrides.json` local.  
**Bénéfice** : les corrections de revue survivent à une nouvelle exécution de la curation.  
**Coût** : élevé (sidecar + migration DB).  
**Risque** : moyen (cohérence avec les règles globales).  
**Ordre** : en dernier, après 3.1 et 3.2.

---

## Tableau de synthèse

| ID | Recommandation | Niveau | Bénéfice | Coût | Risque | Ordre conseillé |
|---|---|---|---|---|---|---|
| 1.1 | Câbler Précédent/Suivant | 1 | Haut | Faible | Nul | 1 |
| 1.2 | Câbler label doc | 1 | Moyen | Faible | Nul | 1 |
| 1.3 | Chips preview : supprimer ou câbler | 1 | Moyen | Faible–Moyen | Faible | 2 |
| 1.4 | Diagnostics : summary sticky + journal scrollable | 1 | Moyen | Faible | Nul | 2 |
| 1.5 | Rééquilibrage colonnes | 1 | Faible | Faible | Faible | 3 |
| 1.6 | Highlight premier diff | 1 | Faible | Très faible | Nul | 2 |
| 2.1 | Modification active (`_activeDiffIndex`) | 2 | Très haut | Moyen | Faible | 1er en niv.2 |
| 2.2 | Sync diff → raw (scroll) | 2 | Haut | Moyen | Faible | 2 |
| 2.3 | Diagnostics cliquables → filtre | 2 | Très haut | Moyen | Moyen | 1er en niv.2 |
| 2.4 | Action locale : Ignorer | 2 | Haut | Moyen | Moyen | 3 |
| 2.5 | Diagnostics → tableau de bord revue | 2 | Très haut | Moyen | Faible | 1er en niv.2 |
| 3.1 | Mode review modification/modification | 3 | Très haut | Élevé | Moyen | Après niv.2 |
| 3.2 | Édition manuelle ponctuelle | 3 | Haut | Élevé | Élevé | Après 3.1 |
| 3.3 | Exceptions locales persistées | 3 | Moyen | Élevé | Moyen | En dernier |
