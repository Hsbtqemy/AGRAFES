# Note de design — R5.2e : vue « Étendue » (interlinéaire) au canvas Annotation

> Statut : **décisions figées** (fork de présentation tranché 2026-07-03 : *inline*).
> Date : 2026-07-03. Cible : `tauri-prep` / `tauri-shell`. **Front pur — aucun impact
> moteur ni contrat.**
> Amont : [`DESIGN_R5_2c_annotation_friction_and_models.md`](DESIGN_R5_2c_annotation_friction_and_models.md)
> (R5.2a→c livrées) et [`DESIGN_prep_text_canvas.md`](DESIGN_prep_text_canvas.md) §7
> (T4 = le canvas **remplace** `AnnotationView`).

## 0. Cadrage

Le canvas Annotation (R5.2b) n'affiche aujourd'hui que **la prose colorée** : chaque mot
est teinté par sa nature (UPOS), la nature et le lemme n'apparaissent qu'au **survol**
(`title`). L'ancien atelier `AnnotationView` possède déjà une **vue interlinéaire** (mode
« annotate ») où chaque token empile **mot / UPOS / lemme** en clair, bascule par un toggle
lecture ↔ grille. Le canvas n'a porté que la prose.

R5.2e apporte cette vue « Étendue » au canvas, **au choix** (toggle Prose ↔ Étendu), pour
afficher natures + lemmes sans survol. Méthode R5.1a/R5.2a : **reloger par extraction, pas
dupliquer** — on sort d'`AnnotationView` le constructeur de grille, canvas **et** legacy le
consomment, T4 retire ensuite le legacy.

## 1. État du code (vérifié)

- **`ui/annotationProse.ts`** (partagé, R5.2a) : `UPOS_COLORS`, `buildProseUnitInline`
  (une unité, inline), `buildProseColored` (bloc). C'est le point d'extraction naturel.
- **`screens/AnnotationView.ts`** `_annotRenderInterlinear` (mode « annotate », lignes
  ~541-614) : groupe par `unit_n` → `sent_id`, rend un **en-tête d'unité** (`§n` + texte
  plat) puis, par phrase, une rangée de **cellules** `annot-token` = `annot-word` /
  `annot-upos` (fond teinté `UPOS_COLORS`) / `annot-lemma` (affiché seulement si ≠ mot).
  Clic cellule → sélection + éditeur.
- **`components/AnnotationPane.ts`** (canvas) : `_decorateAnnotated(u, el)` remplace le
  contenu de `.prep-conv-unit-text` par `buildProseUnitInline(...)`. `_tokensByUnit`
  stocke des `ProseToken[]` **aplatis** (sent_id perdu à la ligne ~216).
- **`ui/annotation.css`** : classes `annot-unit/-sent/-sent-wrapper/-token/-word/-upos/
  -lemma` déjà stylées (namespace partagé `annot-*`, comme `annot-prose-*`).

## 2. Décisions figées

1. **Présentation = inline dans la liste d'unités** (tranché). La couche Annotation garde
   sa liste d'unités canonique (badges de rôles, recherche, sélection du `CanvasUnitList`).
   En mode **Étendu**, `_decorateAnnotated` remplace le texte de chaque unité annotée par la
   **grille interlinéaire** au lieu de la prose. Pas de panneau plein-cadre séparé.
2. **Frontière d'extraction = la grille d'UNE phrase.** On extrait dans `annotationProse.ts`
   un `buildInterlinearSentence(tokens: ProseToken[], opts: ProseOptions)` → le `div.annot-sent`
   de cellules mot/UPOS/lemme, avec `onTokenClick` (même hook que la prose). Le **chrome**
   (en-tête d'unité, libellé de phrase, wrappers) reste **chez chaque consommateur** — exactement
   le partage R5.2a (`buildProseUnitInline` = inline nu ; `buildProseColored` = bloc habillé).
3. **Contenu affiché** : UPOS toujours (fond teinté + code) ; **lemme seulement s'il diffère
   du mot** (insensible à la casse), conforme au legacy. XPOS/Feats/Misc restent à l'éditeur.
4. **Canvas = pas de découpage phrase intra-unité** : `_tokensByUnit` étant aplati, le canvas
   appelle `buildInterlinearSentence` **une fois par unité** (une grille qui *wrappe*). Le
   legacy conserve son découpage par phrase en appelant le même builder **par phrase**. Le
   builder est agnostique (il ne connaît qu'une liste de tokens).
5. **Persistance du mode** : le toggle Prose/Étendu est un état du volet (`_viewMode`), pas
   du document ; défaut = **Prose** (comportement actuel inchangé).

## 3. Tranches

- **R5.2e-1 — extraction (relogement).** Sortir `buildInterlinearSentence` dans
  `annotationProse.ts`. Réécrire `AnnotationView._annotRenderInterlinear` (mode annotate)
  pour l'appeler par phrase → **rendu byte-identique** (preuve : vitest existant + relecture
  diff). Aucun changement visuel legacy.
- **R5.2e-2 — toggle + rendu au canvas.** `AnnotationPane` : bouton Prose ↔ Étendu dans la
  barre ; `_viewMode` ; `_decorateAnnotated` branche prose|grille selon le mode ; re-render
  au basculement. Clic cellule → `_openTokenEditor` (déjà là). CSS : ajuster `annot-sent`
  pour un rendu inline propre dans une ligne d'unité (padding/wrap), sous préfixe existant.
- **Tests** : vitest builder (structure cellules, lemme masqué si == mot, onTokenClick,
  couleur UPOS) ; test canvas (toggle → grille présente, clic → éditeur).

## 4. Hors périmètre

Recherche mot/lemme/UPOS intra-vue (le canvas a déjà sa recherche d'unités) ; sélecteur de
modèle ad hoc ; XPOS/Feats en colonnes. Le retrait de `AnnotationView` reste T4.
