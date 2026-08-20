# Constat de corpus — les traits d'union espacés du corpus GRAFE (2026-08-20)

> Statut : **observation confrontée aux sources**, aucun code écrit. Découvert en QA, à
> partir d'une recherche qui échouait dans le concordancier (`Mi - ar face plăcere.`).
> Le correctif de recherche est parti à part (contrat 1.6.72) : il rend ces lignes
> **trouvables**, il ne les rend pas **correctes**. Ce document traite ce qui reste.

## Ce que c'est

Les textes portent une espace de part et d'autre du trait d'union dans les composés et
les clitiques, là où l'orthographe n'en veut aucune :

```
est - ce        peut - être      dit - il       au - dessus
lui - même      après - midi     a - t - il     demanda - t - elle
Mi - ar         să - i           L - am              (roumain)
```

## L'ampleur, mesurée

| Portée | Mesure |
|---|---|
| Documents touchés | **48 sur 50** |
| Lignes concernées | **6 838 / 46 644** (14,7 %) |
| Par langue | fr 21,5 % · ro 29,8 % · en 9,0 % · es 7,9 % |
| Formes correctes coexistantes | **0** — `est-ce` n'apparaît **nulle part** dans le corpus |

Les deux documents épargnés (`Pratchett-Guards_ES`, `9-CI-OrEn-Obs-2022`) le sont parce
que leur langue ou leur genre emploie peu ces formes, pas parce qu'ils ont été traités
autrement.

## Ce n'est PAS un défaut d'AGRAFES — vérifié à la source

C'est la conclusion que j'allais écrire, et elle était fausse. Ouvrir le `.docx` d'origine
(`Modiano-Rue_FR.docx`, `word/document.xml`) donne :

```
'est - ce'    dans le .docx SOURCE : 11        'est-ce'    : 0
'peut - être' dans le .docx SOURCE :  8        'peut-être' : 0
'dit - il'    dans le .docx SOURCE : 26        'dit-il'    : 0
```

**Le défaut est en amont**, dans les bitextes GRAFE tels qu'ils ont été produits —
vraisemblablement un artefact de la chaîne d'océrisation ou de l'outil d'alignement qui
les a fabriqués. L'importeur d'AGRAFES est fidèle : `text_raw` reproduit la source, ce
qui est exactement son contrat.

## Ce que ça coûte, capacité par capacité

- **Tokenisation** — `est - ce` fait deux tokens là où `est-ce` en ferait un (ou deux,
  selon le modèle, mais avec une relation morphologique). L'annotation spaCy travaille
  donc sur une segmentation fausse.
- **Statistiques lexicales** — les fréquences de `est`, `ce`, `il`, `t` sont gonflées par
  des morceaux de clitiques. Toute comparaison de distributions entre un document GRAFE
  et un document proprement saisi est biaisée.
- **Alignement** — `length_bounded` et Gale–Church comptent des tokens ou des caractères.
  Un corpus où 20 % des lignes portent des tokens surnuméraires décale les longueurs, et
  le décalage n'est pas uniforme entre langues (ro 29,8 % contre en 9,0 %) — donc il
  affecte le rapport de longueurs sur lequel l'aligneur décide.
- **Recherche** — c'était le symptôme d'entrée. Réglé autrement (1.6.72) : la requête est
  assainie, donc `peut-être` retrouve `peut - être`. Le seul point déjà refermé.

## Ce qu'il faudrait décider

**Corriger, ou vivre avec ?** La correction est mécanique et sans ambiguïté sur les
clitiques (`\w - \w` → `\w-\w` pour une liste fermée de formes), mais elle réécrit
`text_raw`, c'est-à-dire la copie fidèle de la source. Deux voies opposées :

1. *Curation* — une convention regex appliquée par la Curation. Le stylo et l'historique
   Mode A rendent le geste annulable, et `source_changed_at` marque les liens dont la
   source a bougé. C'est le chemin prévu par l'outil pour ce genre de reprise.
2. *Laisser `text_raw` intact et corriger `text_norm`* — la normalisation existe
   précisément pour porter ce que le calcul doit voir sans toucher au verbatim. La FTS,
   l'aligneur et la curation travaillent déjà sur ce plan (ALI-01 tranche 2). C'est la
   voie qui préserve la provenance.

La seconde paraît plus juste au vu de la discipline établie ailleurs dans le projet —
mais elle demande de trancher si la normalisation a le droit de **fusionner des tokens**,
ce qu'elle ne fait aujourd'hui pour aucun autre motif. C'est une décision de modèle, pas
une correction de bug, et elle n'est pas prise ici.

**Un préalable à ne pas sauter** : vérifier si les autres corpus destinés à l'outil
portent le même artefact. S'il est propre à GRAFE, c'est une reprise ponctuelle ; s'il
est propre à une chaîne d'océrisation répandue, c'est une capacité à prévoir à l'import.
