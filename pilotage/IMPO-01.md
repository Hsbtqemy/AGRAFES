---
chantier: IMPO-01
statut: à venir
---

# IMPO-01 — la page d'import : elle écrit sans jamais se relire

**Point de départ** — idée soulevée le 26 août 2026, à partir d'un cas mesuré : un ODT en
liste automatique importé en mode « lignes numérotées » produit 1141 unités hors index, et
l'écran affiche une coche verte. Rien n'est commencé.

## Reste

- [ ] Construire l'**aperçu comparatif** décidé le 26 août (voir Contexte) : une ligne par mode applicable, colonnes « unités / trouvables à la recherche / non indexées » + la première ligne extraite, mode pré-sélectionné sur le plus d'unités trouvables
- [ ] Trouver le libellé juste pour la colonne du milieu : « indexables » est du jargon, « trouvables à la recherche » dit ce que l'utilisateur perd s'il se trompe
- [ ] Chiffrer le coût : un appel `/import/preview` **par mode applicable** (2 pour un `.docx`/`.odt`, 1 ailleurs) au lieu d'un seul, donc autant de parses complets — mesurer sur les plus gros fichiers avant de décider si l'aperçu comparatif est calculé à l'ajout ou à la sélection de la ligne
- [ ] Décider comment l'aperçu comparatif traite les **variantes de colonne** d'un bitexte en tableau : une ligne par colonne (2, 3…) ou une seule entrée « extraction par colonne » qui ouvre un second choix
- [ ] Garder malgré tout la sévérité moteur sur `line_unit_count == 0` : l'aperçu comparatif ne protège que l'écran d'import, pas le CLI, `import-remote`, ni un import par lot — ajouter la sévérité manquante sur `line_unit_count == 0` dans `qa_report._check_import_integrity` — ce n'est pas une heuristique : zéro unité indexable n'est jamais un import voulu, quel que soit le mode ou le format
- [ ] Faire relever une sévérité aux **unités longues** : `LONG_LINE_THRESHOLD = 2000` les liste déjà dans `long_unit_ext_ids`, mais aucune règle ne les lit — c'est le signal du blob
- [ ] Afficher `units_line` / `units_structure` à la fin de **chaque** import : les deux champs sont déjà dans la réponse et ne sont journalisés que si `tables_processed > 0` (extraction par colonne), donc jamais pour un import ordinaire
- [ ] **Capacité manquante, mesurée le 26 août** : un bitexte en tableau 2 colonnes dont les cellules ne sont **pas** numérotées n'a aucun mode d'import valide — `column_index` n'existe que pour `docx_numbered_lines` (dit par la docstring de `dispatch.py`), donc colonne + non numéroté donne 48 unités toutes `structure`, et le mode paragraphes ignore `column_index` et saute les tables (0 unité). 26 fichiers du corpus local sont dans ce cas (`CI-OrEnTrFr-2021_Aligné-Tableau`). Reco : ouvrir `column_index` à `docx_paragraphs` en réutilisant `_iter_body_blocks`
- [ ] Élucider les 5 fichiers en zone grise du sondage (ratio ~0,66 de lignes marquées, famille Beigbeder / cullioli) — non localisés au moment du sondage, la forme reste inconnue
- [ ] Renommer ou étoffer le « précontrôle » de l'écran d'import : `_updatePrecheck` ne compte que les fichiers par statut (total / en attente / importés / en erreur), il ne vérifie aucun contenu — le mot promet ce que la fonction ne fait pas
- [ ] Décider du sort de l'aperçu : il reste **volontaire** et n'affiche qu'un fichier à la fois (curseur `_textPreviewCursor`), donc il ne protège que l'utilisateur qui sait déjà quoi regarder

## Contexte

**L'asymétrie est le vrai constat.** L'export possède une machine de contrôle complète —
`qa_report.POLICY_RULES`, 8 dimensions graduées `ok` < `warning` < `blocking`, un mode strict
exposé à l'écran — et **deux de ces dimensions sont `import_error` et `import_warning`**. La
qualité de l'import est donc déjà évaluée, mais seulement quand on exporte, c'est-à-dire bien
après le moment où l'utilisateur aurait pu changer de mode et réimporter.

**Ce qui existe déjà et ne demande qu'à être montré.** `ImportReport` porte `units_total`,
`units_line`, `units_structure`, `duplicates`, `holes`, `non_monotonic`, `warnings` et les
statistiques de table. L'écran n'en journalise que le `doc_id`, les avertissements, et le
détail des tables. `qa_report._check_import_integrity` calcule en plus les trous (avec son
gate à 20 %), les unités vides, les unités longues et l'unicode suspect — mais c'est un
**produit d'export** (`ExportsScreen`, « Rapport QA corpus »), qu'il faut aller chercher.

**Les deux angles morts du contrôle existant.** `_check_import_integrity` filtre sur
`unit_type='line'` : sur un document 100 % `structure` il ne trouve ni trou, ni doublon, ni
unité vide, et conclut `severity: "ok"` — tout en renvoyant `line_unit_count: 0` dans la même
charge utile. Et les unités longues sont listées sans jamais relever de sévérité.

**Trois producteurs mesurés du même défaut** (le document s'importe et reste introuvable),
tous le 25-26 août : un DOCX à sauts de ligne doux en mode paragraphes (blob) ; un DOCX sans
marqueur `[n]` en mode numéroté (`qa/italique-import.md`, `doc_id` 424) ; un ODT en liste
automatique, où l'écran **affiche** une numérotation de 1 à 1141 que le style calcule au rendu
et qui n'existe pas dans le texte. Le troisième est le plus grave : l'interface conduit
activement au mauvais choix.

**Décision du 26 août — l'aperçu comparatif, plutôt qu'un garde-fou.** Les deux questions
posées (avertir ou refuser ? détecter ou laisser choisir ?) sont **dissoutes** : l'écran
montre ce que **chaque mode applicable** fait du fichier, et l'utilisateur choisit sur pièces.
Plus de refus à justifier, plus d'avertissement à lire, aucune connaissance préalable exigée —
le bon mode est celui qui lit le document. La détection ne sert plus qu'à **ordonner** la
liste et pré-sélectionner ; la justification, c'est la comparaison elle-même. C'est la
décision D1 du cas blob (« détecter et proposer, jamais automatique ») portée à son terme.

Vérifié sur les quatre formes problématiques du corpus local, colonnes *unités / indexables /
structure* :

| fichier | mode | unités | indexables | structure |
|---|---|---|---|---|
| `Coe-House-AL_FR.docx` (blob) | numérotées | 836 | **833** | 3 |
| | paragraphes | 1 | 1 | 0 |
| `Asimov…_réaligné.odt` (liste auto) | numérotées | 1141 | **0** | 1141 |
| | paragraphes | 1141 | **1141** | 0 |
| `8-CI-TrEn-2022_A Aligner.docx` | numérotées | 28 | **0** | 28 |
| | paragraphes | 28 | **28** | 0 |
| `2021_Texte1_…Tableau.docx` | numérotées | 0 | 0 | 0 |
| | numérotées, colonne 1 | 48 | **0** | 48 |
| | paragraphes | 0 | 0 | 0 |

Règle de pré-sélection qui en découle : **le mode rendant le plus d'unités indexables**. Elle
donne le bon résultat sur les trois premiers cas et ne recommande **rien** sur le quatrième —
où l'écran doit dire « aucun mode ne lit ce document » plutôt que laisser choisir le moins
mauvais. Le défaut de capacité devient ainsi visible au lieu de se cacher derrière un mauvais
choix.

**Le sondage du 26 août — la détection par contenu est viable.** Critère testé : la
proportion de lignes extraites qui commencent par `[n]`, sur **374 fichiers `.docx`/`.odt`
uniques** du disque local. Résultat : **145** au-dessus de 0,8 (presque tous à 1,0), **198**
sous 0,2 (presque tous à 0,0), **5** en zone grise autour de 0,66, et **26** rendant zéro
ligne. Soit **92 % de tri sans ambiguïté** par un seuil trivial. Les 26 « zéro ligne » ne sont
pas un échec du détecteur mais la découverte d'une quatrième forme : le bitexte en tableau,
que `Document.paragraphs` ne voit pas.

**Rapport à l'audit d'import** (`docs/AUDIT_IMPORT_2026-07-20.md`, à ne pas confondre : ses
constats portent le préfixe `IMP-`, celui-ci est la fiche d'écran `IMPO-`). Son **IMP-02**
(« import vide silencieux ») a été corrigé par une garde « 0 unité → lever » dans
`parsed.insert_units` ; ce qui est décrit ici en est l'**extension exacte** — 0 unité
*indexable* plutôt que 0 unité tout court. Son **IMP-RT** a par ailleurs tranché contre
l'auto-détection du `resource_type` avec le bon critère : « prémisse vérifiée au code : signal
nul ». Le sondage ci-dessus applique la même méthode à la détection de *mode* et trouve
l'inverse — un signal net. Les deux verdicts ne se contredisent pas, ils appliquent la même
règle à deux signaux différents. À noter : **11 constats de cet audit sont encore ouverts sans
item dans aucune fiche** (relevé par `npm run verifier`).

Voir `pilotage/R2.md` (l'item de filet, qui porte le même constat côté moteur) et
`pilotage/IMP-01.md` (clos — le hang d'`_analyze_external_ids`, sans rapport).
