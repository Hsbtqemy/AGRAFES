# Post-Inc1 Visual Check — Vue Import

**Sprint :** Import Inc 1
**Date :** 2026-03-09
**Viewports mesurés :** 1440×900 · 1728×1080
**Artefacts :** `runtime_after_inc1_1440.png` · `runtime_after_inc1_1728.png` · `post-inc1-check.json`

---

## Améliorations objectives

| Indicateur | Avant Inc 1 | Après Inc 1 | Delta |
|------------|------------|-------------|-------|
| Layout | 4 cartes empilées (1 col) | 2 colonnes workspace | ✅ Structural |
| Workspace 1440px | — | 1175px (678 + 485) | ✅ |
| Workspace 1728px | — | 1463px (846 + 605) | ✅ |
| Ratio col_main/col_side | — | 1.40:1 (conforme cible) | ✅ |
| Stepper progression | Absent | 4 étapes (① Sources › ④ Exécution) | ✅ |
| Dropzone dédiée | Absent | Présente (644×145px) | ✅ |
| Pré-vérification (col droite) | Absent | Card avec 4 compteurs live | ✅ |
| Profil de lot (col droite) | Card top-level | `<details>` collapsible dans col droite | ✅ |
| Footer action sticky | Absent | Sticky bottom, z-index 10 | ✅ |
| State banner | Carte "État de session" pleine largeur | Chip compact dans head-card | ✅ |
| Index FTS (col droite) | Card top-level | Carte collapsible col droite | ✅ |

---

## Hiérarchie 2 colonnes — verdict

**Convaincante.** À 1440px et 1728px, la proportion 1.4:1 est perceptible visuellement sans déséquilibre.
La colonne gauche (sources + journal) prend naturellement le rôle principal ; la colonne droite (profil
+ vérification + index) joue un rôle contextuel lisible. Conforme à l'intention mockup.

---

## Dropzone — verdict

**Fonctionnelle mais pas encore dominante.**

- Hauteur actuelle : **145px** (padding 20px + icône + texte + boutons)
- Cible mockup : ~200px (plus d'espace vide + icône plus grande)
- La dropzone reste plus étroite que prévu parce que `padding` est contenu par le texte courts

Elle est correctement positionnée (haut de col_main, avant la file list) et répond au dragover.
L'impression visuelle est "présente" mais pas "dominante". Inc 2 peut augmenter le padding vertical.

---

## Colonne droite — verdict

**Bien proportionnée.**

- 485px (1440px) / 605px (1728px) — proportion honnête, contenu non trop étriqué
- 3 cartes (Profil · Pré-vérification · Index FTS) s'emboîtent proprement
- La carte Pré-vérification avec 4 compteurs remplit visuellement l'espace disponible
- Seul bémol : le caret `::after` du `<details>` profil de lot n'est pas clairement visible dans la capture

---

## Footer sticky — verdict

**Utile, présence acceptable.**

- `position:sticky; bottom:0; z-index:10; border-top; box-shadow` — structure correcte
- Visible et distincte du contenu (filet + ombre légère)
- Bouton "Importer le lot" centré à droite, logique pour une action finale
- Pas envahissante (53px de hauteur), ne masque pas de contenu actif

---

## Problèmes restants (Inc 2)

### ❌ P1 — Journal des imports non replié

`data-collapsed-default="true"` n'est pas appliqué à la carte journal.
Le log-pane est visible (~155px) et occupe de l'espace dans col_main.
Cause probable : `initCardAccordions()` est appelé avant que le nouveau innerHTML soit dans le DOM,
ou la carte journal est rendue différemment dans le nouveau layout.
**Action :** diagnostiquer l'ordre `initCardAccordions(root)` → innerHTML dans `render()`.

### ❌ P2 — Background sombre du log-pane

Le `#imp-log.log-pane` hérite d'une règle CSS globale avec `background` sombre (noir ou gris foncé).
Même replié, quand le journal s'ouvre c'est visuellement agressif.
**Action :** scoper `.import-screen .log-pane { background: #f8fafc; color: inherit; }` dans le CSS Inc 1.

### ⚠️ P3 — Hauteur dropzone insuffisante

145px vs ~200px mockup. Cosmétique.
**Action :** augmenter `padding-top/padding-bottom` de la dropzone à ~36px et taille icône à 36px.

### ⚠️ P3 — Caret settings card peu visible

Le `::after "▾"` du `<details>` Profil de lot n'est pas nettement visible dans la capture.
Peut être masqué par le layout flex ou une couleur trop proche.
**Action :** vérifier rendu DevTools ; augmenter contraste ou taille du caret.

---

## Synthèse

| Critère | Verdict |
|---------|---------|
| Layout 2-col convaincant | ✅ Oui |
| Dropzone dominante | ⚠️ Partiellement (145px, cible 200px) |
| Colonne droite proportionnée | ✅ Oui |
| Footer sticky utile | ✅ Oui |
| Régressions | 0 |
| Bloquants prod | 0 |
| Issues cosmétiques | 4 (journal, bg, dropzone h, caret) |

---

## Recommandation

**Commit Inc 1 + Inc 2 léger immédiat.**

Inc 1 est un saut structurel réel et convaincant. Les 4 issues restantes sont toutes cosmétiques
(aucune ne casse la logique métier). Inc 2 peut être limité à 3 corrections CSS ciblées :

1. Fixer `initCardAccordions` pour journal (ordre DOM/init)
2. Scoper `.log-pane` background dans `.import-screen`
3. Augmenter padding dropzone (cosmétique pur)

Estimé < 30 lignes de diff. Pas de nouveau remaniement structural nécessaire.
