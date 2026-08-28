# Import unifié — une liste, deux sources

**Statut : note de conception, rien n'est codé.** Écrite le 28 août 2026, à la fin du lot
SD-01, alors que le contexte des deux écrans est frais. Elle ne demande pas de décision
immédiate ; elle fixe les faits mesurés et nomme ce qu'il faudra trancher, pour qu'un
ticket puisse s'y référer au lieu de re-dériver.

## 1. Le constat

L'application a **deux écrans d'import** : `ImportScreen` (fichiers locaux, 1759 lignes)
et `ShareDocsImportScreen` (WebDAV, 1350 lignes). Ils importent la même chose dans le même
corpus, et divergent sur presque tout le reste.

**La journée du 28 août est l'argument.** Elle a consisté à porter vers ShareDocs ce que
l'écran local avait acquis la veille : `planImport`, `detectNumbering`, le verdict, son
rendu, la règle de repli, les styles CSS. Deux passes adverses y ont trouvé **huit
défauts**. Le plus parlant : la bulle verte qui transporte un avertissement, corrigée sur
l'écran local le matin, **réintroduite sur ShareDocs trois heures plus tard**. Ce n'est
pas de l'inattention — c'est ce que produit mécaniquement une seconde implémentation.

**Et la divergence coûte des capacités, pas seulement des lignes.** 26 fichiers du corpus
(sur 514 sondables, mesuré le 28 août) sont des bitextes en tableau à 2 colonnes qu'on ne
sait pas importer depuis ShareDocs. Ce n'est **pas** une limite du moteur : `/import`
accepte `column_index`, et l'écran local offre le champ. C'est que l'écran distant ne l'a
pas.

## 2. Ce que chaque écran sait faire — inventaire mesuré

**L'écran local seul** : panneau de détail par fichier (mode, colonne, langue, titre) ·
tableau comparatif de ce que chaque mode ferait du document · aperçu des unités et des
tokens · note de tables et **éclatement par colonne** · bandeau de file avant import ·
« ↺ Remettre en attente » · langue par défaut applicable au lot · compteurs de
précontrôle.

**ShareDocs seul** : connexion WebDAV, authentification, trousseau système, préréglages
d'URL · navigation dans les collections · panier multi-dossiers qui survit à la navigation
· expansion des dossiers cochés · **annulation d'un import de lot** · rapport de lot.

**Les deux, séparément** : le journal, la déduction de mode, le verdict et son rendu, la
soumission d'import — et **le rattachement aux familles**, sous deux formes opposées
(§ 3.4).

## 3. Ce qui résiste

### 3.1 Le modèle de fichier est un chemin

`FileItem.path` est un chemin de système de fichiers dans tout `ImportScreen`, et
`_analyzeFile` appelle `/import/preview` avec ce chemin. Un fichier distant n'a qu'un
`href`. Il faut donc que `FileItem` porte une **origine**, et que l'analyse route vers
`/import/preview` ou vers `POST /webdav/probe` selon elle.

Le moteur est déjà prêt : la sonde rend **exactement la réponse de `/import/preview`**
(décision SD-01, précisément pour que le front n'ait pas de branche). Le routage porte
donc sur l'appel, pas sur le traitement.

### 3.2 Deux chemins de soumission — mais tous deux des jobs

Local : `enqueueJob(conn, "import", …)`, un job par fichier. Distant :
`POST /import-remote`, un job par groupe `(dossier, mode, langue)`. **Les deux sont
asynchrones et suivis par le Job Center** : le chemin de soumission est symétrique, seule
la charge utile diffère.

### 3.3 La provenance distante interdit le raccourci

Le raccourci tentant — télécharger côté client, puis traiter comme un fichier local — est
**à écarter**. L'import distant écrit `source_path = l'URL WebDAV` (choix délibéré du
design ShareDocs) et dédoublonne par **hash de contenu** côté serveur, sur les octets
téléchargés. Un détour par un temporaire local perdrait les deux.

### 3.4 Deux flux de familles opposés

C'est la divergence la plus profonde, et elle n'est écrite nulle part.

- **Local** : `_enqueueFamilyDialog` → une modale **par document**, **après** l'import,
  mises en file une par une.
- **ShareDocs** : `_confirmFamilies` → une bande de confirmation **avant** l'import, en
  **lot**, dérivée des groupes détectés au nom de fichier ; puis `_wireFamilies` crée les
  relations une fois les `doc_id` connus.

Avant/après, un-par-un/lot : ce sont deux conceptions, pas deux implémentations. Fusionner
oblige à en choisir une. Le flux ShareDocs paraît le meilleur — il demande une fois, avant
d'écrire — et `FAM-01` reproche justement au flux local de **redemander ce qu'il vient
d'obtenir**. Mais ce n'est pas tranché ici.

### 3.5 L'annulation de lot n'existe que d'un côté

ShareDocs sait annuler un import (`_undoImport`, les seuls documents effectivement
importés). L'écran local, non. Fusionner rend cette capacité à tout le monde, ou oblige à
dire pourquoi elle ne vaut que pour le distant.

## 4. La forme proposée

**Une liste, deux sources.**

`ShareDocsImportScreen` cesse d'être un écran d'import et devient un **sélecteur de
source** : connexion, navigation, panier. Son geste terminal n'est plus « Importer », c'est
**« Ajouter à la liste »** — le même rôle que joue aujourd'hui le sélecteur de fichiers du
système pour l'import local.

`ImportScreen` devient l'unique écran d'import. Chaque ligne porte son origine ; le
panneau de détail, le tableau comparatif, le verdict, le champ colonne, le ↺ valent pour
toutes les lignes sans distinction.

Ce qui **se dissout** : `planForRemoteFile`, `verdictForRemoteFile`, `_verdictCell`,
`probeKeysToKeep`, `_deducedModes`, la colonne de verdict du listing distant — tout le
front écrit le 28 août pour donner à ShareDocs ce que l'écran local avait déjà.

Ce qui **survit intact** : tout le moteur du même jour. `POST /webdav/probe`, les modes
par fichier de `/import-remote`, la distinction `skipped-no-probe` / `skipped-unsupported`,
`preview_text_units` extrait dans `services/`. C'est exactement ce dont une liste unifiée
a besoin.

## 5. À trancher avant d'ouvrir un ticket

1. **Le flux de familles** — avant/lot (ShareDocs) ou après/par document (local) ? Décision
   couplée à `FAM-01`.
2. **L'annulation de lot** — étendue à l'import local, ou restreinte au distant avec un
   motif écrit ?
3. **Le panier** — reste-t-il dans le sélecteur de source, ou la liste de l'écran d'import
   le remplace-t-elle entièrement ? (Elle en fait déjà presque tout : ajouter, retirer,
   vider, remettre en attente.)
4. **Le groupement à la soumission** — un job par fichier comme en local, ou un job par lot
   comme en distant ? Le champ `modes` de `/import-remote` (contrat 1.6.82) permet le
   second sans grouper ; voir l'item « un seul job » de `SD-01`.
5. **L'écran d'accueil** — deux entrées de navigation ou une seule avec un choix de source ?

## 6. Recommandation

**Oui, mais pas tout de suite.**

La direction est juste et l'argument est mesuré : la duplication produit des défauts, et
elle coûte des capacités réelles (26 fichiers). Chaque semaine où ShareDocs gagne une
fonctionnalité séparément augmente ce qu'il faudra fusionner ensuite.

Mais **rien de ce qui vient d'être livré n'a été vu tourner**. Refactoriser deux écrans de
1759 et 1350 lignes par-dessus du code jamais exécuté, c'est perdre la capacité de
distinguer un bug du refactor d'un bug préexistant. L'ordre qui coûte le moins :

1. voir tourner ShareDocs tel qu'il est — c'est ce qui a trouvé, deux fois le 28 août, ce
   que les passes écrites n'avaient pas vu ;
2. trancher les cinq points du § 5 ;
3. fusionner, en une tranche qui commence par l'origine dans `FileItem` et l'aiguillage de
   l'analyse — le reste en découle.
