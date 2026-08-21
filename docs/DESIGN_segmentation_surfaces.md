# Les surfaces de la couche Segmentation — état contre proposition

**Statut :** conception arrêtée, non codée. Décidé le 2026-08-21, en session, à partir
d'une confusion rencontrée à l'écran puis reproduite en lisant le code.

Le chantier porteur est **R5** (couches Curation, Annotation et Segmentation au canvas) —
voir ses items dans `pilotage/R5.md`.

---

## 1. Le constat

La couche Segmentation (`SegmentPane`) présente **cinq onglets alignés dans une même
barre**, comme s'ils étaient de même nature :

    Brut · Phrases · Balises [N] · Personnalisé · Tours

Ils ne le sont pas, et le code le dit déjà :

```ts
// SegmentPane.ts:707
if (!conn || this._docId === null || this._surface === "brut" || this._surface === "tours") return;
// these have their own render path
```

- **Brut** et **Tours** rendent les **unités réelles** du document et portent les gestes
  qui les modifient — ✎ corriger, ⇧⇩ fusionner, ✂ couper pour le premier, les frontières
  ¶ pour le second.
- **Phrases**, **Balises [N]** et **Personnalisé** lancent un **aperçu** de ce que la
  découpe *deviendrait*. Les segments affichés n'existent nulle part :
  `/segment/preview` n'est pas une route d'écriture du sidecar.

Deux surfaces d'état, trois générateurs, une seule barre.

### 1.1 Ce que la confusion coûte, mesuré à l'usage

Le nom « Brut » suggère le texte non découpé ; il désigne en réalité l'état courant du
document. **Deux lecteurs s'y sont trompés le même jour** — l'utilisateur devant l'écran,
qui ne trouvait aucun moyen de modifier ses segments, et l'assistant en lisant le code,
qui a décrit Brut comme « le texte tel qu'importé ».

Le défaut n'est pas seulement cosmétique. **L'onglet actif au chargement est
« Phrases »** (`private _surface: SegSurface = "phrases"`), donc un aperçu. On arrive sur
la couche devant une hypothèse, avec « Appliquer la segmentation » sous la main — un
geste qui **supprime tous les liens d'alignement du document** — sans avoir jamais vu les
segments réels.

---

## 2. Ce qui a été écarté, et pourquoi

### 2.1 Rendre les segments modifiables dans tous les onglets — écarté

Les onglets d'aperçu montrent des segments sans existence : pas d'`unit_id`, rien à quoi
rattacher une annulation, aucun lien d'alignement à compter. Les rendre éditables suppose
l'une de deux voies, mauvaises toutes les deux :

- **matérialiser au premier geste** — un clic anodin réécrirait le document et
  détruirait son alignement, sans que rien ne l'annonce ;
- **bâtir un modèle d'édition parallèle** sur des objets éphémères — soit une seconde
  source de vérité pour la segmentation, ce que le retrait de `SegmentationView`
  (chantier « Retrait Seg », `e43a0f3`, −3 103 lignes) a précisément coûté à effacer.

### 2.2 Un onglet « texte de base » — écarté, sur mesure

L'idée : puisque « Brut » cesserait de désigner l'état, il pourrait désigner le texte
d'origine, non découpé. Trois mesures prises le 2026-08-21 sur le corpus de travail
l'écartent, et chacune suffit.

**a. La segmentation ne perd rien.** En comparant la concaténation des segments à
l'original de leur ligne parente (`text_source`), sur trois documents :

| document | groupes | reconstituent leur source |
|---|---|---|
| Beigbeder-Francs_EN | 1 267 | 1 267 |
| LeClezio-Chercheur_EN | 875 | 875 |
| LeClezio-Chercheur_FR | 875 | 874 |

**3 016 sur 3 017**, à l'espace près. L'onglet d'état contient donc déjà 100 % du texte ;
un onglet « texte de base » n'en montrerait pas un caractère de plus.

**b. L'unique divergence est une correction, et elle est déjà visible là où il faut.**
C'est une correction au stylo faite pendant la session :

    source   : … le plancher vermoulu.
    segments : … le plancher overmoulu.

`text_source` a conservé « vermoulu », et le repli « ⊘ voir l'original d'import »
l'affiche **sur le segment concerné**. Le besoin de récupération est donc couvert, et
mieux qu'il ne le serait par un onglet séparé où il faudrait retrouver le passage à
l'œil.

**c. L'onglet serait vide pour la majorité du corpus.** Sur 47 947 unités ligne, **14 309
(29,8 %) portent un `text_source`**, et seulement 5 005 (10,4 %) l'ont différent de leur
`text_raw` — le seul cas où le repli s'affiche. Les autres ont été importées avant la
migration 020 et n'ont aucun original enregistré.

**Ce que l'onglet apporterait réellement**, une fois ces trois points posés, c'est la
**continuité de lecture** : lire le document comme de la prose plutôt que comme une
liste. C'est un besoin légitime, mais ce n'est pas un besoin de *segmentation* — il
devra être posé pour lui-même, avec sa propre justification, et non glissé dans cette
couche.

---

## 3. Ce qui est retenu

### 3.1 Nommer les surfaces par ce qu'elles sont

« Brut » **disparaît** — il ne devient pas le texte de base, il est remplacé par ce
qu'il était déjà sans le dire :

    [ Segmentation actuelle ]  [ Tours ]  │  Segmenter :  [ Phrases ]  [ Balises [N] ]  [ Personnalisé ]

Deux groupes visuellement distincts. Tours reste avec l'état : c'est un autre **grain**
sur les mêmes unités réelles, pas un autre découpage.

**Une seule étiquette, et c'est un verbe.** « Segmenter », et non « Re-découper » : le
préfixe présuppose une segmentation antérieure, alors que c'est souvent le **premier**
geste sur un document qui vient d'être importé — l'étiquette mentirait dès la première
utilisation.

Le mot doit aussi rester **léger**, parce qu'à cet endroit on ne fait que regarder : les
trois onglets n'écrivent rien. Le poids appartient au bouton « Appliquer la
segmentation », qui prévient déjà quand il y a quelque chose à perdre (« Ce document a N
liens d'alignement. Resegmenter les effacera. »). L'étiquette décrit une exploration,
l'avertissement tombe au moment de l'écriture — meilleure répartition qu'aujourd'hui, où
l'exploration est muette et la conséquence invisible jusqu'au clic.

Le premier groupe, lui, **n'a pas besoin d'étiquette** : son onglet la porte déjà. Un
verbe d'un côté, un état de l'autre — la frontière se lit sans meuble supplémentaire.

### 3.2 L'onglet par défaut devient l'état

`_surface` initialise à `"phrases"` ; il doit initialiser à l'onglet d'état. On n'arrive
plus sur une hypothèse avec un bouton destructeur sous la main, on arrive sur son
document. C'est la moitié « sûreté » du lot, et elle vaut à elle seule le changement.

### 3.3 Rendre l'aperçu jugeable — les anomalies avant l'application

L'aperçu n'est pas figé : les règles de l'onglet **Personnalisé** sont vivantes, et le
découpage se recalcule à chaque réglage. Ce qu'on ne peut pas faire, c'est intervenir sur
**une coupure précise** — le moteur ne connaît que des règles générales
(`kind`, `terminators`, `require_uppercase_after`, `protect_abbreviations`).
`protect_abbreviations` est bien un mécanisme d'exception, mais de **classe** : on protège
« cap. » partout, jamais cette occurrence-ci.

La réponse actuelle du produit est explicite — appliquer, puis rattraper à la main dans
l'onglet d'état (fusionner / couper), guidé par la détection d'anomalies.

**Cette réponse tient**, pour une raison qui n'est pas évidente : appliquer détruit les
liens d'alignement **quelle que soit la qualité du découpage**. Affiner l'aperçu ne
sauverait donc rien de ce qui coûte cher, et les rattrapages manuels sont peu coûteux et
annulables.

**Elle ne tient pas sur un point :** on juge un candidat à l'aveugle. `segmentAnomalies.ts`
détecte les deux signatures d'un mauvais découpage — segment de ≤ 5 caractères, et
ponctuation fermante orpheline en tête de segment, avec un jeu de fermantes qui dépend de
la langue. Mais cette détection ne tourne que sur la **vue d'état**, c'est-à-dire
seulement **après** l'application. Rien ne dit ce qu'un découpage coûtera avant qu'on s'y
engage.

**Retenu :** afficher ces compteurs sur l'aperçu. `computeAnomalyView` prend une liste de
`{ text, isLine }` — pure, sans DOM — et les segments d'aperçu portent déjà leur texte.
C'est du branchement : aucun changement moteur, aucun concept nouveau. Pendant qu'on règle
les terminateurs, on lit « 3 segments courts, 1 ponctuation orpheline » ; on ajoute
l'abréviation qui manque, le compte tombe, on applique en connaissance de cause. La boucle
*essayer une règle → voir ce qu'elle coûte → ajuster* se referme.

**Écarté pour l'instant — les exceptions au cas par cas.** « Pas ici » / « ici aussi » sur
une coupure donnée viendrait après, si la boucle des règles se montrait insuffisante. Le
coût n'est pas du même ordre : une liste d'exceptions doit être stockée, survivre à une
resegmentation, s'annuler. C'est un modèle de données, pas un branchement — et rien ne
prouve encore qu'il soit nécessaire.

### 3.4 Coût

`SegSurface` (`"brut" | "phrases" | "balises" | "custom" | "tours"`) ne vit que dans
`segmentControls.ts` et `SegmentPane.ts`. **Aucun écran externe ne cible la surface par
son nom** — vérifié : le raccourci « matrice → couche Segmentation » passe par
`TextCanvasView` sans nommer de surface. Le renommage de l'identifiant est donc contenu ;
celui du libellé est trivial.

---

## 4. Question laissée ouverte

Le libellé exact de l'onglet d'état. « Segmentation actuelle » est retenu ici, mais
« Segments » ou « Courant » diraient la même chose plus court. Le critère : le mot doit
opposer *ce document, maintenant* à *une découpe possible* — c'est le cœur du
malentendu, et c'est tout ce que le nom doit porter.

*(Le libellé du second groupe, lui, est tranché : « Segmenter ». Voir §3.1.)*

**Navigation au clavier.** Les cinq boutons forment aujourd'hui un seul groupe d'onglets,
donc les flèches les parcourent tous. Séparés, ils deviennent **deux groupes
indépendants** : si la frontière mérite d'être vue, elle mérite d'être franchie exprès.
Décidé le 2026-08-21, à revoir seulement si l'usage montre le contraire.
