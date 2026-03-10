# Post-Inc1 Visual Check — Actions Hub

**Sprint :** Hub Inc 1
**Date :** 2026-03-09
**Viewports :** 1440×900 · 1728×1080
**Artefacts :** `runtime_after_inc1_1440.png` · `runtime_after_inc1_1728.png`
           `runtime_after_inc1_1440_metrics.json` · `runtime_after_inc1_1728_metrics.json`

---

## Métriques ciblées

| Indicateur | 1440px | 1728px |
|------------|--------|--------|
| Workspace hub (grid) | 1175 × 201 px | 1463 × 181 px |
| Card Curation | 381 × 201 px | 477 × 181 px |
| Card Segmentation | 381 × 201 px | 477 × 181 px |
| Card Alignement | 381 × 201 px | 477 × 181 px |
| Hauteur moyenne des cards | **201 px** | **181 px** |
| Head card | 1175 × 78 px | 1463 × 78 px |
| Head équilibre (titre / CTA) | Titre gauche · CTA droite | Identique |
| grid-template-columns | 380.9px × 3 | 476.9px × 3 |
| CTA "Ouvrir →" (count) | 3 (filled teal) | 3 (filled teal) |
| CTA "Grand texte" (count) | 2 (head + seg card) | 2 (head + seg card) |

---

## Ce qui s'est objectivement amélioré

| Point | Avant Inc 1 | Après Inc 1 |
|-------|------------|-------------|
| Layout | `flex-direction:column` — 3 boutons-lignes empilés, full-width | **CSS Grid `1fr 1fr 1fr`** — 3 colonnes égales |
| Exploitation horizontale | ~15% de l'espace (un bouton 800px de large sur 1175px, padding inutile) | **100%** — 381px × 3 à 1440px, 477px × 3 à 1728px |
| Séquençage workflow | Aucun — 3 cards visuellement équivalentes | **Badge "Étape 1/2/3"** teal pill, top-right de chaque card |
| Contenu des cards | 1 emoji + h3 court + flèche `→` | Emoji + step badge + h3 bold + **description 3 lignes** + bouton CTA |
| CTA distinction | Clic sur la card entière (mauvais feedback) | **Bouton dédié `Ouvrir →`** filled teal — inequivoque |
| Hiérarchie head | `<h1>` utilitaire "Actions — vue synthèse" | `<h2>` "Traitement de corpus" + desc "Curation · Segmentation · Alignement" |
| CTAs head | 4 boutons-liens redondants (toutes les sous-vues) | **1 CTA accent unique** "Scénario grand texte ↗" |
| Logique navigation | Inchangée | Inchangée, 0 régression |

---

## Le hub est-il devenu un écran d'orchestration crédible ?

**Oui — structurellement.** Le changement de paradigme est acquis : ce n'est plus 3 boutons de navigation visuellement indifférenciés, c'est 3 cards-scénarios ordonnées Étape 1/2/3 avec contenu et CTAs distincts. Un utilisateur qui arrive sur ce hub comprend immédiatement la séquence et l'entrée à chaque étape.

**Nuance visuelle.** L'écran occupe ~35% de la hauteur viewport à 1440px (hub content ≈ 318px / 900px dispo) et ~30% à 1728px. Le bas de la page est vide. Ce n'est pas un défaut fonctionnel — c'est l'état attendu sans données corpus — mais ça donne un rendu "léger" qui nuance l'impression de "tableau de bord".

---

## Les scénarios sont-ils bien hiérarchisés ?

**Oui.** Les badges "Étape 1/2/3" (pill teal, top-right de chaque card) établissent clairement la séquence. La lecture de gauche à droite est naturelle. Le contenu de chaque card différencie bien les trois opérations : Curation (nettoyage texte), Segmentation (découpage + grand texte), Alignement (liens + collisions).

---

## Les CTA sont-ils assez évidents ?

**Oui.** Les boutons `Ouvrir →` (fond teal foncé, texte blanc, border-radius 6px) sont les éléments les plus saillants visuellement dans chaque card — plus saillants que le titre h3, ce qui est correct pour un écran de navigation. Le bouton `Grand texte ↗` en outline sur la card Segmentation est bien différencié (secondaire, contextuel). Le CTA `Scénario grand texte ↗` dans le head est visuellement dominant côté droit.

**Légère redondance.** Le CTA "Scénario grand texte ↗" apparaît deux fois : head-tools (droit de la head card) et card Segmentation. C'est voulu (accès direct depuis le head + accès contextuel depuis la card), mais visuellement la présence dans le head est suffisante. La version head-tools est la plus visible et la plus accessible. Pas un bug.

---

## Cohérence du Journal sous les cards

**Correct.** La section Journal (`.acts-log-card`, section collapsible) est positionnée immédiatement sous les 3 cards, avec `▶ Journal` comme titre et le bouton de déploiement à droite. Elle n'est pas trop présente et ne pollue pas la hiérarchie. Comportement identique aux autres vues (collapsed par défaut).

---

## Ce qui reste insuffisant

### ⚠️ P2 — Espace vide sous le hub (absence de KPIs)

La head card (78px) ne porte aucun compteur corpus. Associé à l'espace vide sous les cards, le hub communique peu sur l'**état du corpus**. Un utilisateur ne sait pas combien de documents il a, combien sont segmentés, combien sont alignés — sans ouvrir un sous-écran.

**Fix Inc 2 léger (optionnel)** : ajouter une ligne de 3-4 chips KPI statiques dans le head (alimentés depuis `/documents` au chargement du hub) :

```
[ 0 docs ]  [ 0 unités ]  [ 0 liens d'alignement ]
```

même vides (zéro), ils renforcent l'impression de pilotage sans changer la structure.

### ℹ️ P3 — Redondance "Scénario grand texte"

CTA présent deux fois (head-tools + card Segmentation). Pas bloquant.

---

## Synthèse

| Critère | Verdict |
|---------|---------|
| Exploitation horizontale | ✅ Grid 3-colonnes, 100% largeur |
| Hauteur cards (équilibre) | ✅ 201px (1440) / 181px (1728) — harmonieux |
| Séquençage Étape 1/2/3 | ✅ Badges clairs, lecture gauche-droite naturelle |
| CTA lisibles | ✅ Filled teal "Ouvrir →" dominant dans chaque card |
| Head équilibré | ✅ Titre + desc gauche · CTA accent droite |
| Journal sous les cards | ✅ Collapsible, non intrusif |
| Hub = écran d'orchestration | ✅ Structurellement oui |
| Espace vide bas de page | ⚠️ ~65% viewport vide sans KPIs |
| Régressions | 0 |
| Bloquants prod | 0 |

---

## Recommandation

**Commit direct.** Le saut structurel est réel et vérifiable sur les captures : grid 3-col, step badges, descriptions enrichies, CTAs dédiés et explicites. La page est fonctionnellement correcte et nettement au-dessus de l'état précédent.

L'espace vide (manque de KPIs) est un problème de **contenu**, pas de structure. Un Inc 2 "mini-KPIs dans le head" est envisageable en 30 lignes mais dépend de la disponibilité des données au chargement du hub — c'est un arbitrage produit indépendant.
