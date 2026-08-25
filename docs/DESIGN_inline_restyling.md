# Restylisation inline — appliquer, retirer et réappliquer l'italique et le gras

> Statut : **modèle figé (2026-08-25)**, issu de la discussion du 2026-08-25 en marge de la
> passe [`pilotage/qa/italique-import.md`](../pilotage/qa/italique-import.md).
> Prolonge [`DESIGN_inline_text_correction.md`](DESIGN_inline_text_correction.md) — dont la
> décision **D-C1** annonçait ce retournement : « édite `text_norm`, garde `text_raw`,
> *réversible si un besoin « réécrire le verbatim » émerge* ». C'est ce besoin.
> Chantiers rattachés : `RICH-01` (voir la stylisation dans l'outil), `SORT-01` (la publier),
> `ANN-01` (tracer une intervention humaine).

## 0. Ce que c'est — et ce que ce n'est pas

Un geste pour **poser ou retirer un italique ou un gras** sur un passage, et pour
**remettre** la mise en forme qu'une correction a rendue caduque.

Ce n'est **pas** un éditeur de texte enrichi : on ne cherche ni les couleurs, ni les
tailles, ni les alignements. La stylisation ici est philologique — un mot étranger, un
titre d'œuvre, une insistance — et elle sert d'abord à **comparer une source et sa
traduction**, où l'emphase se déplace ou disparaît.

Ce n'est **pas** non plus le stylo de correction. Le stylo change *ce que dit* le texte ;
ce geste change *comment il se présente*. Deux gestes, deux moments.

## 1. Le moteur n'a rien à changer (vérifié)

`POST /units/update_text` accepte **déjà** `text_raw` et `text_norm` dans le même appel.
Envoyer le texte balisé et le texte nu ensemble suffit. Vérifié sur une base jetable, en
appelant le vrai service :

| ce qu'on vérifie | résultat |
|---|---|
| `text_raw` porte le balisage, `text_norm` reste nu | oui |
| invariant de la garde d'affichage (`normalize(raw) == norm`) | **restauré** — l'italique redevient affichable |
| `fts_units` réindexé sur le texte nu | oui, sans balise |
| `text_source` conserve l'original d'import | oui — le repli « voir l'original » s'ouvre alors, puisque `text_source ≠ text_raw` |
| bornes de coupe d'alignement détruites | **0** — un restylage ne touche pas `text_norm` |
| annulable (Mode A) | oui, l'endpoint photographie déjà les deux colonnes |

Conséquence : le chantier est **entièrement front**, plus deux fonctions pures.

## 2. Le modèle — un ensemble de styles par caractère

La représentation canonique est **(texte nu, style par caractère)**, pas une liste de
plages. C'est déjà le modèle de l'encodeur d'import
(`rich_text.py`, `list[tuple[frozenset[str], str]]` avec fusion des runs voisins).

Deux fonctions pures, inverses, testables sans DOM :

- `parse(text_raw) → (texte nu, styles[])`
- `render(texte nu, styles[]) → text_raw`

Appliquer un style à une sélection = ajouter le token à l'ensemble de chaque caractère de
la plage, puis refusionner. **Les chevauchements disparaissent comme problème** : avec deux
styles, il n'existe que quatre ensembles possibles (`{}`, `{italique}`, `{gras}`,
`{gras, italique}`), et `rend="bold italic"` est déjà ce que l'encodeur produit, tokens
triés. Aucune décision de découpage n'est à prendre.

## 3. Les quatre gestes

**Garder.** Acquis, rien à construire : une correction ne détruit pas le balisage, elle le
rend caduc. Reste à en ouvrir la consultation (item `RICH-01`).

**Appliquer.** Sélectionner un passage sur la ligne rendue, cliquer *I* ou *G*.

**Retirer.** Même geste en bascule, plus un « tout retirer » à l'échelle de la ligne.

**Réappliquer après correction.** Chercher chaque fragment stylé d'origine dans le texte
corrigé : occurrence **unique** → le style se repositionne ; occurrence absente ou
ambiguë → **ne rien deviner**, montrer l'original et laisser marquer à la main. Cette
heuristique doit être **mesurée sur de vraies lignes corrigées avant d'être écrite** : deux
automatismes « évidents » du même genre sont déjà morts à la vérification sur ce dépôt.

## 4. Décisions arrêtées

- **D-R1 — deux styles seulement : italique et gras.** L'import sait en produire six ; on
  n'en offre que deux à la main. L'asymétrie est assumée : souligné, barré, exposant et
  indice restent lisibles et exportables, simplement non éditables.
- **D-R2 — modèle par caractère, pas par plage** (§2). Rend la question du chevauchement
  sans objet.
- **D-R3 — deux surfaces : le canvas et la matrice d'alignement.** La matrice parce que
  c'est là qu'on compare une source et sa traduction, donc là que l'emphase se juge.
- **D-R4 — une stylisation posée à la main est tracée.** Sans quoi l'emphase de l'éditeur
  devient indistinguable de celle de l'auteur — inacceptable dans un corpus. Même défaut
  que celui relevé pour les tokens corrigés à la main (`ANN-01`) : c'est une règle, pas un
  détail d'implémentation.

## 5. Les vraies difficultés

**a. Les offsets DOM ne sont pas les offsets du texte cherchable.** La ligne est rendue en
HTML depuis `text_raw`, qui est **XML-échappé** par l'importateur ; `text_norm` hérite de
cet échappement, puisque `normalize()` tourne sur un `text_raw` déjà échappé. Une ligne
contenant `&` porte donc `&amp;` dans son texte cherchable — **24 unités dans la base de
travail** — alors que le DOM affiche un seul caractère. Une sélection lue au DOM et
appliquée telle quelle à `text_norm` se décalerait sur ces lignes. C'est la difficulté
centrale du geste, et elle est **liée à l'item « entités XML dans `text_norm` » de
`RICH-01`** : trancher cette question d'abord simplifie celle-ci.

**b. La réapplication après correction** (§3), qui demande une mesure avant tout code.

**c. La trace de main ne survit pas à l'export.** L'export TEI ne recopie que l'attribut
`rend` (`tei.py:80`) : un `resp` ou un `hand` posé sur le `<hi>` serait silencieusement
perdu. D-R4 implique donc de toucher l'exportateur — sans quoi la traçabilité s'arrête à
la base.

## 6. Ce qui reste ouvert

- La forme exacte de la trace de main (attribut TEI `resp`, `hand`, ou colonne à part) —
  à trancher avec la même question posée dans `ANN-01` pour les tokens, pour ne pas
  inventer deux mécanismes distincts.
- Le sort des styles importés que l'on ne sait pas éditer : les laisse-t-on intacts sur une
  ligne restylée, ou le geste les écrase-t-il ? (Réponse par défaut proposée : intacts —
  le modèle par caractère les transporte sans les comprendre.)
- L'ergonomie du geste dans la matrice, où les cellules sont étroites.

## 7. À vérifier avant d'ouvrir le ticket

- Mesurer, sur les lignes réellement corrigées du corpus, la proportion de fragments stylés
  retrouvables sans ambiguïté (§3).
- Confirmer que le canvas et la matrice peuvent recevoir la même primitive de sélection
  sans dupliquer le code de rendu.
- Vérifier qu'un `<hi>` posé à la main traverse bien l'export TEI **et** l'aller-retour
  d'un réimport — l'import TEI aplatit aujourd'hui les `<hi>` (`RICH-01`).
