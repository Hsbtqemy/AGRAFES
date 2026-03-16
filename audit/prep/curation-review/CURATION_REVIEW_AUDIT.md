# Audit UX — Vue Curation (tauri-prep / Actions)
**Date** : 2026-03-13  
**Portée** : `ActionsScreen.ts` (sous-vue `curation`), `app.css` (classes `.curate-*`), audits fonctionnels existants  
**Méthode** : lecture exhaustive du code + croisement avec `audit/prep/functional/curation/CONTROL_MATRIX.md` et `dead_controls.md`

---

## 1. Résumé exécutif

La vue Curation est aujourd'hui **un moteur de normalisation assistée par règles**, avec une preview différentielle en lecture seule. Elle n'est **pas encore** un espace de correction éditoriale locale.

**Ce qu'elle fait bien** : applique des règles prédéfinies ou custom sur un document entier, visualise le diff global, déclenche un job de curation confirmé.

**Ce qu'elle fait mal** : présenter les modifications de manière navigable, permettre d'agir sur une modification individuelle, rendre le panneau Diagnostics actionnable.

**Ce qui est absent** : tout concept de "modification active", de file de revue, d'actions locales (accepter / ignorer / éditer), et de synchronisation entre les trois zones (Diagnostics ↔ diff ↔ raw).

---

## 2. Ce que l'interface permet bien aujourd'hui

| Capacité | Observation |
|---|---|
| Sélection de règles via chips | 5 presets câblés, checkboxes fonctionnels (`_currentRules()`) |
| Règles custom JSON | Textarea + parsing JSON, injection dans `_addAdvancedCurateRule()` |
| Preview debounce | 260 ms, silencieuse sur changement de doc, explicite sur clic |
| Diff Avant/Après | `#act-diff-list` via `_renderDiffList()`, table `.before`/`.after` par ligne modifiée |
| Minimap densité | 12 buckets `.mm.changed`, proportionnels au % de lignes modifiées |
| Stats globales | `#act-preview-stats` : `X lignes modifiées / Y total` |
| Diagnostics synthétiques | `_renderCurateDiag()` liste les types de règles actives avec leur compte d'applications |
| Journal de revue | `_pushCurateLog()` / `_renderCurateLog()` : trace des actions (max 10 entrées) |
| Soumission de job | `_runCurate()` → `enqueueJob("curate", …)` → suivi JobCenter |
| Navigation inter-document | `_navigateCurateDoc(dir)` implémentée, `_docs[]` alimenté |

---

## 3. Ce qu'elle permet mal

### 3.1 Lisibilité du diff sur passages longs

- **Observé** : `#act-diff-list` affiche toutes les modifications d'un document dans un seul conteneur scrollable, sans séparation visuelle entre les règles, sans regroupement par type.
- **Inféré** : sur un document de 500+ lignes avec plusieurs règles actives, le diff devient une liste dense où repérer une modification précise est difficile sans chercher visuellement.
- **Impact** : l'utilisateur ne sait pas où commencer à regarder, ni quelle modification est "intéressante" vs banale.

### 3.2 Absence de "modification active"

- **Observé** : aucun état `_activeDiffItem`, aucun surlignage d'une ligne de diff sélectionnée, aucun scroll synchronisé entre `#act-preview-raw` et `#act-diff-list`.
- **Inféré** : quand l'utilisateur clique sur une ligne du diff, rien ne se passe. Le `#act-preview-raw` ne scroll pas vers la ligne correspondante.
- **Impact** : la double vue raw/diff n'est pas synchro — c'est deux lectures parallèles indépendantes plutôt qu'une vue coordonnée.

### 3.3 Chips preview non fonctionnelles

- **Observé** : `.preview-controls` contient des chips décoratifs (`Brut`, `Diff`, `Côte à côte`, `+contexte`) sans listener (`UI-only` dans `CONTROL_MATRIX.md`).
- **Impact** : l'utilisateur peut cliquer dessus sans effet, créant une fausse affordance.

### 3.4 Navigation doc Précédent/Suivant morte

- **Observé** : `.curate-nav-actions .btn` sont `hard-disabled`, `_navigateCurateDoc()` est implémentée mais jamais appelée par ces boutons (aucun listener attaché).
- **Impact** : l'utilisateur ne peut pas passer d'un document à l'autre depuis la Curation sans revenir au select.

---

## 4. Ce qu'elle ne permet pas encore

| Besoin éditorial | Statut |
|---|---|
| Accepter une modification individuelle | Absent — pas de granularité sous le niveau "document entier" |
| Ignorer une modification individuelle | Absent |
| Éditer une modification individuelle | Absent |
| Naviguer d'une modification à la suivante | Absent (Previous/Next dans la file = dead) |
| Voir le contexte d'une modification (lignes environnantes) | Absent — raw pane et diff pane indépendants |
| Créer une exception locale à une règle globale | Absent |
| Filtrer le diff par type de règle | Absent |
| Voir quelles règles ont produit quelle modification | Absent — le diff ne porte pas l'étiquette de la règle source |
| File de revue actionnable | `#act-curate-queue` présent dans le DOM mais toujours vide (placeholder `dead`) |

---

## 5. Analyse spécifique — Preview centrale

**Structure actuelle** : grille `1fr 1fr 22px` — pane raw gauche | pane diff droite | minimap.

**Ce qui fonctionne** :
- Le raw pane (`#act-preview-raw`) montre le texte source original.
- Le diff pane (`#act-diff-list`) montre les lignes modifiées avec `.before` / `.after`.
- La minimap donne une vue macro de la densité de changements.

**Ce qui manque** :

1. **Synchronisation de scroll** : raw et diff scrollent indépendamment. Si la modification 47 est dans le diff, il faut trouver manuellement la ligne 47 dans le raw. Aucun ancrage commun.

2. **Identification de la modification active** : aucune ligne du diff n'est "sélectionnée". L'utilisateur ne peut pas cliquer sur une modification pour la mettre en focus.

3. **Attribution de règle** : chaque ligne du diff est affichée comme `AVANT → APRÈS` sans indiquer quelle règle en est responsable (espaces ? guillemets ? regex custom ?). Cela empêche le tri par règle et la compréhension de la cause.

4. **Context lines** : le diff ne montre que les lignes modifiées, sans les lignes de contexte avant/après. On perd la compréhension de la phrase ou du paragraphe.

5. **Chips non fonctionnelles** : `Brut`, `Diff`, `Côte à côte`, `+contexte` sont décoratives. Le mode d'affichage est figé en "côte à côte".

---

## 6. Analyse spécifique — Diagnostics curation

**Structure actuelle** (`_renderCurateDiag()`) :
- Liste de `.curate-diag` items : `règle X : N applications`
- Optionnellement `.warn` si quelque chose cloche
- Lien vers Segmentation en bas

**Ce qui fonctionne** :
- Donne une vue synthétique : "combien de fois chaque règle a été appliquée".
- Fonctionne en colonne droite, lisible sur ~5 règles.

**Ce qui ne fonctionne pas** :

1. **Pas actionnable** : aucun item de diagnostic n'est cliquable. Cliquer sur "guillemets : 14 applications" ne filtre pas le diff, ne navigue pas vers la première occurrence, ne permet rien.

2. **Pas lié au diff** : les diagnostics sont calculés dans `_renderCurateDiag(changed, total, reps)` séparément du rendu du diff. Il n'y a pas de liaison entre un diagnostic et ses occurrences dans `#act-diff-list`.

3. **Densité limitée** : la colonne droite (`300px`) est trop étroite pour afficher des diagnostics détaillés (long texte de règle regex, par exemple) sans overflow ou troncature.

4. **Journal secondaire sous-utilisé** : `#act-curate-review-log` (max 10 entrées) est une trace d'actions passées, pas un panneau d'action futur. Il n'offre aucune interactivité.

5. **Scroll absent** : si les diagnostics dépassent la hauteur de la colonne, ils sont masqués sans scroll visible.

**Verdict** : Diagnostics est aujourd'hui un **panneau d'information récapitulatif**, pas un **panneau d'action**. Il liste des résultats agrégés mais ne permet aucune interaction avec les modifications concrètes.

---

## 7. Analyse spécifique — Correction locale

**Ce qui préfigure une correction locale** :
- `_renderCurateQuickQueue()` : rendu de la file locale (3 docs autour du courant) — existe dans le code, mais `#act-curate-queue` est vide en production.
- `_navigateCurateDoc(dir)` : implémentée, permettrait de passer au document suivant/précédent.
- `_pushCurateLog()` : logique de journal prête à recevoir des événements de revue.
- Le select `#act-curate-doc` permet de cibler un document.

**Ce qui bloque la correction locale** :
- La granularité minimale d'action est le **document entier** : soit on applique tout, soit on n'applique rien.
- Il n'y a pas d'objet "modification individuelle" en mémoire (pas de `_diffs[]`, pas d'état `accepted/ignored/pending` par diff item).
- Les boutons Précédent/Suivant sont dead — la navigation inter-document est cassée à l'UI.
- Le queue (`#act-curate-queue`) est une coquille vide.
- Aucun callback sur les items du diff ne permet de déclencher une action locale.

---

## 8. Conclusion : moteur de règles ou outil de correction éditoriale ?

### Aujourd'hui : moteur de normalisation assistée

La vue Curation est un **pipeline de normalisation batch** avec preview. Le modèle d'interaction dominant est :

```
Choisir des règles → Prévisualiser le résultat global → Appliquer si satisfait
```

C'est un outil **macro** : on règle les paramètres en amont, on valide le résultat en aval, on applique en bloc.

### Ce qui manque pour devenir un outil de correction éditoriale

Un outil de correction éditoriale exige un modèle d'interaction **micro** :

```
Voir une modification → Décider de l'accepter / ignorer / modifier → Passer à la suivante
```

Ce modèle requiert :
- Un objet "modification" en mémoire avec état (pending / accepted / ignored)
- Une vue diff navigable modification par modification
- Des actions locales par modification
- Une synchronisation modification ↔ diagnostic ↔ contexte

**Ces éléments sont absents** de l'implémentation actuelle. Certains embryons existent (queue DOM, nav impl, log), mais ils ne sont pas câblés en une logique cohérente.

### Signal positif

Le code contient des intentions claires de review locale (`_curateQueue`, `_renderCurateQuickQueue`, `_navigateCurateDoc`, `_pushCurateLog`). Ce n'est pas un outil de normalisation pur qui aurait ignoré le sujet — c'est une vue qui a **commencé à préfigurer la review locale** sans avoir encore implémenté le câblage.
