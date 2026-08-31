---
passe: Actions — action d'abord
chantier: ACT-01
duree: 25 min
derniere: —
---

# QA — la page Actions, « action d'abord »

Vérifie ce qu'aucun test unitaire ne peut prouver : que l'état affiché **correspond au
document en base**, que le filtre et la vue hiérarchie se composent sans se contredire,
et que la colonne de gestes tient à l'écran. Le code est couvert par 30 tests (14 sur le
module pur, 16 sur l'écran) ; ce qui reste est ce qui ne se voit qu'à l'œil.

## À faire AVANT d'ouvrir l'application

**Reconstruire le sidecar, à chaque rejeu, dès que le moteur a bougé depuis la dernière
construction.** Sans ça la passe entière mesure un binaire périmé. Comparer le
`build_time` de `tauri-shell/src-tauri/binaries/sidecar-manifest.json` à la date du
dernier commit touchant `src/multicorpus_engine/` :

```
python -c "import json;print(json.load(open('tauri-shell/src-tauri/binaries/sidecar-manifest.json'))['build_time'])"
git log -1 --format=%cI -- src/multicorpus_engine/
```

Symptôme si on l'oublie, la première fois que cette passe a été écrite : les cartes
annoncent « 58 à faire » partout et chaque ligne porte les quatre pastilles, parce que le
binaire ignorait `curated_at` et `aligned_count`. Ce n'est **pas** un défaut de l'écran.

```
python scripts/build_sidecar.py --preset shell --format onefile
```

`--format onefile` n'est pas optionnel : sur Windows le défaut est `onedir`
(`scripts/build_sidecar.py`, `DEFAULT_FORMAT_BY_OS`), que `externalBin` ignore. Si
`tauri dev` panique avec `PermissionDenied`, chercher un `multicorpus.exe` orphelin
(sans triple de cible) sous `tauri-shell/src-tauri/binaries/` et le supprimer.

**Lancer par le shell, pas par `tauri-prep` seul** — `sidecar_fetch_loopback` n'existe que
dans le shell, prep standalone ne joindra aucun sidecar :

```
npm --prefix tauri-shell run tauri -- dev
```

**Confirmer que le sidecar servi est bien le neuf**, avant de regarder quoi que ce soit :
lire `.agrafes_sidecar.json` à côté de la base pour le port, puis interroger `/health`.
Le champ `contract_version` doit être **égal à celui du dépôt à la révision construite** —
ne pas le comparer à un numéro écrit ici, il vieillit à chaque lot :

```
grep ^CONTRACT_VERSION src/multicorpus_engine/sidecar_contract.py
```

ACT-01 a livré `1.6.85`, puis `1.6.87` (le job `curate` enregistre son action) ; FTS-01 a
poussé `1.6.86` entre les deux. Tout ce qui est **inférieur à 1.6.85** signifie que le
binaire n'a pas été remplacé : recommencer, ne pas jouer la passe. Entre 1.6.85 et 1.6.87
la passe mesure la même chose — `1.6.87` ne touche pas `GET /documents`.

## Base et comptes attendus

Corpus de référence : `C:\Users\hsemil01\Documents\IGE\corpus_agrafes.WORKCOPY.db`,
**58 documents**. Tout ce qui suit a été mesuré dessus le 31 août, en lecture seule.

| carte | doit afficher | pourquoi |
|---|---|---|
| Curation | **57 à faire** | seul `#416 Beigbeder-Francs_FR.docx` porte un `curated_at` |
| Segmentation | **1 à faire** | seul `#426 9_CI-TrFr-2021_Aligné_UTF8.txt` a ≤ 1 unité (il en a 0) |
| Alignement | **37 à faire** | 21 documents sur 58 sont touchés par un lien |
| Annotation | **53 à faire** | 5 annotés : `#387`, `#395`, `#416`, `#422`, `#423` |

Autres comptes : **17** lignes doivent porter la pastille « Index périmé » ; **une seule**
ligne doit afficher « Rien à faire », `#416`. Les **6** documents hors famille — `#422`,
`#423`, `#425`, `#426`, `#427`, `#428` — sont les seuls dont le geste Alignement doit
refuser. `#364 Beigbeder-Francs_EN.docx` est un enfant : son geste Alignement doit ouvrir
la matrice sur la **racine `#416`**, pas sur lui-même.

Si la base a bougé depuis, re-dériver les comptes plutôt que de faire confiance au tableau :

```
python -c "import sqlite3,sys; sys.path.insert(0,'src'); from multicorpus_engine.services.documents_service import list_documents as L; d=L(sqlite3.connect('file:<chemin>?mode=ro',uri=True))['documents']; n=len(d); print(n, sum(1 for x in d if not x['curated_at']), sum(1 for x in d if x['unit_count']<=1), sum(1 for x in d if not x['aligned_count']), sum(1 for x in d if x['annotation_status']!='annotated'))"
```

Les libellés à retrouver exactement : bandeau `58 documents` hors filtre et
`Curation — 57 documents sur 58` sous filtre (il ne disparaît jamais, seul son bouton
`Tout afficher` s'efface), bouton de carte `Voir les 57` puis `Tout afficher`, en-têtes
`N° · Titre · Langue · Rôle · Unités · À faire · Ouvrir`, boutons de tête `↺ Actualiser`
et `🌿 Hiérarchie` / `📋 Liste`.

Le maximum de pastilles mesuré sur ce corpus est **4** (17 documents) : aucun « +1 » ne
doit apparaître aujourd'hui. Il apparaîtra le jour où un document cumulera les quatre
étapes ET un index périmé — `9_CI-TrFr-2021_Aligné_UTF8.txt` en est à un pas.

### Les quatre cartes

- [x] Les cartes affichent 57 / 1 / 37 / 53 à faire, dans l'ordre Curation · Segmentation · Alignement · Annotation
- [x] Aucune carte ne porte plus « Étape 1 », « Étape 2 », « Étape 3 » ni « Optionnel »
- [x] La carte de tête « Traitement de corpus » a disparu, et la page ne commence plus par elle
- [x] Il n'y a qu'UN bouton d'actualisation sur la page, dans l'en-tête « Documents du corpus »
- [x] `↺ Actualiser` recharge la liste ET rafraîchit les quatre compteurs
- [x] La carte Alignement a bien trois boutons : le filtre, `Ouvrir →`, et `Contrôle`
- [x] `Ouvrir →` d'une carte entre dans l'espace sans présélectionner de document

### Le filtre et la liste

- [x] Cliquer `Voir les 57` sur Curation réduit la liste à 57 lignes et la carte s'entoure d'un liseré
- [x] Le bandeau annonce « Curation — 57 documents sur 58 » et propose « Tout afficher »
- [x] Le bouton de la carte active devient « Tout afficher » ; les trois autres cartes restent cliquables
- [ ] Re-cliquer la carte active rend les 58 lignes ; le bandeau RESTE et repasse à « 58 documents »
- [x] « Tout afficher » du bandeau a le même effet que re-cliquer la carte
- [x] Passer d'un filtre à l'autre sans repasser par « tout » remplace le filtre, ne les cumule pas
- [ ] Sous filtre Segmentation, une seule ligne reste : `9_CI-TrFr-2021_Aligné_UTF8.txt`
- [ ] La numérotation N° repart de 1 sous filtre — c'est le rang affiché, pas le rang dans le corpus

### Le tri

- [ ] Cliquer « Titre » trie de A à Z ; re-cliquer inverse
- [ ] L'indicateur passe de ⇅ à ↑ puis ↓, et les autres colonnes retombent toutes à ⇅
- [ ] « Unités » se trie en nombre : 1518 vient après 897, jamais avant
- [ ] « À faire » en descendant met en tête les documents à quatre pastilles
- [ ] Le tri accentue et minuscule pareil : « abricot » et « Abricot » ne se séparent pas
- [ ] Changer de filtre garde le tri en place
- [ ] En hiérarchie, trier ne sort aucun enfant de sous son parent
- [ ] Le tri s'actionne au clavier : Tab jusqu'à un en-tête, puis Entrée
- [ ] « Ouvrir » n'est pas triable ; « N° » l'est et ramène à l'ordre d'arrivée

### L'état par ligne

- [ ] La colonne « À faire » existe entre « Unités » et « Ouvrir »
- [ ] `#416 Beigbeder-Francs_FR.docx` est la SEULE ligne à afficher « Rien à faire », en vert
- [ ] 17 lignes portent « Index périmé », en ambre, et cette pastille vient toujours en dernier
- [ ] `9_CI-TrFr-2021_Aligné_UTF8.txt` porte les quatre pastilles d'étape
- [ ] Aucune ligne n'affiche « Segmentation » alors que sa colonne « Unités » montre plus de 1
- [ ] Le titre `[1] hi rend=italicxhiscriptalert(1).txt` s'affiche tel quel, sans italique ni fenêtre surgie
- [ ] Choisir trois lignes au hasard et vérifier leurs pastilles contre la base : aucune ne se contredit

### Les gestes de la ligne

- [ ] Hors filtre, chaque ligne offre quatre boutons : ◇ ⌥ ⇄ ◎
- [ ] Le survol de chacun nomme la capacité ET le document (« Curation — « Beigbeder-Francs_FR.docx » »)
- [ ] ◇ ouvre le canvas sur la couche Curation, positionné sur CE document, pas sur le précédent
- [ ] ⌥ ouvre la couche Segmentation sur ce document, ◎ la couche Annotation
- [ ] Revenir au hub après un geste retrouve le filtre tel qu'il était
- [ ] Sous filtre, la ligne n'offre plus qu'un bouton, libellé « Curation → » (ou l'étape filtrée)
- [ ] ⇄ sur `#364 Beigbeder-Francs_EN.docx` ouvre la matrice sur la famille de `#416`, pas sur `#364`
- [ ] ⇄ sur `Hagena_Apfel_AL` refuse par un message parlant de famille, et n'ouvre PAS la matrice
- [ ] Ce refus ne laisse pas la matrice sur la famille consultée juste avant

### La vue hiérarchie sous filtre

- [ ] `🌿 Hiérarchie` bascule le libellé en `📋 Liste` et l'arbre s'indente
- [ ] En hiérarchie, les lignes portent le même état et les mêmes gestes qu'en liste plate
- [ ] Appliquer un filtre en hiérarchie garde l'arbre : les enfants restent sous leur parent
- [ ] Un parent hors filtre dont un enfant est retenu reste affiché, grisé, boutons inertes
- [ ] Un parent grisé n'est pas atteignable à la tabulation
- [ ] Aucune famille entièrement hors filtre ne laisse d'en-tête de section orpheline
- [ ] La section « Parent absent du corpus » ne se met pas à compter des parents simplement masqués
- [ ] Basculer liste ↔ hiérarchie sans changer de filtre montre le même nombre de documents concernés

### Tenue à l'écran

- [ ] La colonne « Ouvrir » ne se replie jamais : les quatre boutons restent sur une ligne
- [ ] Un titre long ne comprime pas les colonnes « À faire » et « Ouvrir »
- [ ] Toutes les lignes ont exactement la même hauteur, y compris celles à quatre pastilles
- [ ] Aucune cellule ne se replie : ni un titre long, ni les pastilles, ni l'en-tête « Langue »
- [ ] Un titre trop long est élidé par des points de suspension, et son infobulle le rend entier
- [ ] L'infobulle de la colonne « À faire » liste tous les états, séparés par des points médians
- [ ] La carte Documents garde la même hauteur d'un filtre à l'autre — c'est son contenu qui défile
- [ ] L'en-tête de colonnes reste visible quand on fait défiler la liste
- [ ] Les colonnes ne bougent pas d'un filtre à l'autre : seule la hauteur du contenu change
- [ ] En réduisant la fenêtre, les cartes passent à 2 puis 1 colonne sans que le tableau déborde horizontalement
- [ ] Le tableau ne provoque aucun défilement horizontal de la page entière

### Les cas creux

- [ ] Sur un corpus vide, les cartes disent « aucun document » et leurs filtres sont inertes
- [ ] Sur un corpus vide, la liste dit « Aucun document importé. »
- [ ] Une carte sans reste affiche « tout à jour » en vert et son bouton « Rien à faire » est inerte
- [ ] Filtrer, puis traiter le dernier document concerné, laisse « Rien à faire ici : aucun document n'attend cette étape. » et un « Tout afficher » toujours cliquable
- [ ] Sidecar coupé puis `↺ Actualiser` : le bandeau d'erreur apparaît et les compteurs ne se remettent pas à zéro en silence
- [ ] Sidecar coupé puis ⇄ sur une ligne : le message parle de relations indisponibles, PAS d'absence de famille
