---
passe: Actions — le tri-état
chantier: ACT-01
duree: 25 min
derniere: 2026-09-01
---

# QA — la colonne « À faire », quatre cases à trois états

Le modèle à trois états (`[ ]` rien · `[/]` en cours · `[X]` validé) est couvert par
60 tests — 29 côté moteur, 31 côté écran — et **n'a jamais été vu tourner**. C'est
exactement l'état où « action d'abord » se trouvait avant sa propre passe, qui a trouvé
deux défauts qu'aucun test ne pouvait voir.

Ce que cette passe vérifie : que la case dit la vérité sur le document qu'elle désigne,
qu'une coche se périme quand le travail la dément, que les deux nombres d'une carte
suivent les coches, et que la colonne tient à l'écran. Ce qu'elle ne vérifie pas : le
filtre et la vue hiérarchie pour eux-mêmes — ils ont leur passe,
`qa/actions-action-dabord.md`, dont trois zones restent valables.

**Cette passe écrit dans la base.** Cocher pose une ligne réelle dans `doc_step_status`.
Le dernier bloc les retire ; ne pas le sauter. Attention au cas de sortie : une coche
que le travail de la passe a **périmée** garde sa ligne, et un clic dessus la RE-VALIDE
au lieu de la retirer — il en faut deux. Le nettoyage se juge donc sur les coches
vives, pas sur un `count(*)` à zéro.

## À faire AVANT d'ouvrir l'application

**Reconstruire le sidecar dès que le moteur a bougé depuis la dernière construction.**
Sans ça la passe entière mesure un binaire périmé — et le symptôme, cette fois, est un
bandeau *« Unknown route: /documents/step_status »* au premier clic sur une case :

```
python -c "import json;print(json.load(open('tauri-shell/src-tauri/binaries/sidecar-manifest.json'))['build_time'])"
git log -1 --format=%cI -- src/multicorpus_engine/
python scripts/build_sidecar.py --preset shell --format onefile
```

`--format onefile` n'est pas optionnel : le défaut Windows est `onedir`, que `externalBin`
ignore. Fermer l'application avant de construire — elle tient le fichier ouvert.

**Lancer par le shell**, `tauri-prep` seul ne joint aucun sidecar :

```
npm --prefix tauri-shell run tauri -- dev
```

**Confirmer le contrat servi** avant de regarder quoi que ce soit : lire le port dans
`.agrafes_sidecar.json` à côté de la base, interroger `/health`, comparer à
`grep ^CONTRACT_VERSION src/multicorpus_engine/sidecar_contract.py`. Le tri-état est
arrivé en **1.6.88** ; tout ce qui est inférieur veut dire que le binaire n'a pas été
remplacé — recommencer, ne pas jouer la passe. Compter ~35 s avant que le portfile
apparaisse, c'est la latence normale du onefile, pas un blocage.

## Base et comptes attendus

Base de travail `corpus_agrafes.WORKCOPY.db`, 58 documents, mesurée le 31 août à 17 h 45.
**Re-mesurer avant de jouer**, ce n'est pas une précaution de style : entre deux mesures
du même après-midi, l'annotation est passée de 52·6 à 50·8 parce que deux documents ont
gagné des tokens (`#372`, `#398`). `annotation_status` vaut « a des tokens », rien de
plus. Un item comparé à un nombre périmé ne prouve rien :

```
python -c "import json,urllib.request as u; pf=json.load(open('<db_dir>/.agrafes_sidecar.json')); d=json.load(u.urlopen('http://127.0.0.1:%d/documents?limit=500'%pf['port']))['documents']; T={'curation':lambda x:bool(x.get('curated_at')),'segmentation':lambda x:not(isinstance(x.get('unit_count'),int) and x['unit_count']<=1),'alignement':lambda x:(x.get('aligned_count') or 0)>0,'annotation':lambda x:x.get('annotation_status')=='annotated'}; [print('%-13s %2d a faire, %2d en cours, %d coches'%(s,sum(1 for x in d if not f(x)),sum(1 for x in d if f(x)),sum(1 for x in d if (x.get('step_status') or {}).get(s)))) for s,f in T.items()]"
```

| carte | doit afficher | son bouton de filtre |
|---|---|---|
| Curation | **56 à faire · 2 en cours** | Voir les 58 |
| Segmentation | **58 en cours** — sans « à faire », `none` vaut 0 | Voir les 58 |
| Alignement | **37 à faire · 21 en cours** | Voir les 58 |
| Annotation | **50 à faire · 8 en cours** | Voir les 58 |

**Zéro coche au départ.** Les quatre boutons annoncent donc le corpus entier : tant que
rien n'est validé, aucune capacité ne retire de ligne. Ce n'est pas un défaut
d'affichage, c'est la conséquence directe du modèle — et l'une des choses à juger à
l'œil ici.

## Les documents sur lesquels s'appuyer

Choisis parce qu'ils produisent le cas voulu, vérifié en base et non déduit des tests.

| document | ce qu'il permet |
|---|---|
| `#375 Nothomb-Hygiene_FR.docx` | Curation vide, Segmentation `/` — aucun geste de découpage |
| `#377 Nothomb-Stupeur_FR.docx` | aucun geste de segmentation → coche **faible** (`basis: derived`) |
| `#368 Houellebecq-Plateforme_FR.docx` | 12 gestes de segmentation → coche **forte** (`basis: history`) |
| `#364 Beigbeder-Francs_EN.docx` | curé le 31 août, 20 346 tokens — le mieux placé pour périmer une coche |
| `#416 Beigbeder-Francs_FR.docx` | 91 gestes, curé, annoté — le plus chargé du corpus |

**Fabriquer une coche périmée** : cocher Curation sur `#364`, ouvrir le canvas, corriger
une phrase au stylo (`update_text`), revenir. Pour la segmentation, cocher sur `#368`
puis fusionner deux unités (`merge_units`). Ce sont les deux chemins les plus courts.

**Deux « rôles » cohabitent, ne pas les confondre.** `set_role` est le rôle d'une
**unité** (couche « Rôles » du canvas : intertitre, paratexte — routes
`/units/set_role`, `/units/bulk_set_role`). Le rôle du **document**
(`standalone` · `original` · `translation`) est `documents.doc_role`, changé depuis
Métadonnées, et il n'écrit aucune action. Ni l'un ni l'autre ne périme une coche, mais
seul le premier le démontre : une action est bien enregistrée, et `ACTIONS_BY_STEP` la
laisse passer. La règle naïve « toute action postérieure périme » aurait fait
qu'étiqueter un intertitre annule une segmentation validée — 11 actions `set_role` en
base l'auraient déclenché.

**Lire les coches en base**, à tout moment :

```
sqlite3 "file:<chemin>?mode=ro" "select doc_id, step, validated_at from doc_step_status"
```

### Les quatre cases

- [x] Chaque ligne porte exactement quatre cases — jamais trois, jamais cinq
- [x] L'ordre Curation · Segmentation · Alignement · Annotation est identique sur les 58 lignes : la deuxième case se suit du regard de haut en bas sans la chercher
- [x] Une case « rien » est vide, « en cours » porte `/`, « validé » porte `✕`
- [x] Les trois états se distinguent au coup d'œil sans lire l'infobulle — au fond ou au cadre, pas au seul glyphe
- [x] Sur `#375 Nothomb-Hygiene_FR.docx` : première case vide, deuxième à `/`
- [x] `Index périmé` reste une pastille à part, jamais une cinquième case
- [x] Un titre très long ne décale pas les cases : la colonne garde la même largeur d'une ligne à l'autre
- [x] L'en-tête « À faire » porte le rappel `Cur Seg Ali Ann`, hors infobulle
- [x] Chaque étiquette du rappel tombe bien sur sa case, sans décalage d'un demi-pas
- [x] Le rappel se lit comme une légende, jamais comme un cinquième état

### Cocher et décocher

- [x] Cliquer une case vide la fait passer à `✕`
- [x] Cliquer une case `/` la fait passer à `✕` — les deux états mènent à la coche
- [x] Cliquer une case `✕` la ramène à ce que le moteur observe
- [x] Sur `#375`, cocher puis décocher Segmentation la ramène à `/`, pas à vide
- [x] Sur `#375`, cocher puis décocher Curation la ramène à vide
- [x] Cocher ne change pas d'écran, n'ouvre aucun panneau, ne déplace pas la liste
- [x] Le compteur de la carte correspondante bouge dans la foulée, sans avoir à rafraîchir
- [x] Cocher une ligne ne modifie aucune autre ligne

### Ce que la coche vaut

- [x] L'infobulle d'une case vide dit « rien de fait »
- [x] Celle d'une case `/` dit « commencé, jamais validé »
- [x] Coche Segmentation sur `#377 Nothomb-Stupeur_FR.docx` : l'infobulle dit « validé le …, **avant que l'historique existe** »
- [x] Coche Segmentation sur `#368 Houellebecq-Plateforme_FR.docx` : elle dit « validé le …, **aucune modification enregistrée depuis** »
- [x] Les deux formulations se distinguent bien : la première annonce une coche plus faible, et cela doit s'entendre
- [x] Chaque infobulle nomme le document, pas seulement la capacité

### La péremption

- [x] Coche Curation sur `#364 Beigbeder-Francs_EN.docx`, puis corriger une phrase au stylo : la case retombe à `/`
- [x] Son infobulle dit « validé le …, puis modifié » et nomme `update_text`
- [x] Re-cliquer la case périmée la re-valide — elle ne se décoche pas
- [x] Coche Segmentation sur `#368`, puis fusionner deux unités : retombe à `/`, raison `merge_units`
- [x] Une coche périmée compte comme « en cours » dans sa carte, jamais comme validée
- [x] Sur `#416` (6 actions `set_role`), poser un rôle d'**unité** — couche « Rôles » du canvas, un intertitre par exemple — ne périme aucune des quatre cases, alors que l'action, elle, est bien enregistrée
- [x] Le rôle du **document** (`standalone` · `original` · `translation`, écran Métadonnées) ne périme rien non plus — il n'écrit aucune action, il n'y a rien à voir bouger
- [x] Annuler l'action qui a périmé la coche lui rend son `✕`

### Les deux nombres des cartes

- [x] Curation affiche « 56 à faire · 2 en cours »
- [x] Segmentation affiche « 58 en cours », sans « à faire » — et non « 0 à faire · 58 en cours »
- [x] Alignement affiche « 37 à faire · 21 en cours »
- [x] Annotation affiche « 50 à faire · 8 en cours »
- [x] Cocher un document fait baisser un seul des deux nombres, jamais les deux
- [x] Décocher le remet exactement là où il était
- [x] Valider les 58 documents d'une capacité fait dire « tout à jour » à sa carte

### Le filtre, tant que rien n'est validé

- [x] Les quatre boutons annoncent « Voir les 58 » : aucune capacité ne discrimine
- [x] Filtrer sur une capacité ne retire donc aucune ligne — juger si la page reste utile dans cet état, c'est le premier écran de quelqu'un qui n'a jamais coché
- [x] Cocher Segmentation sur cinq documents fait descendre le bouton à « Voir les 53 », et la liste à 53 lignes
- [x] Le bouton d'une capacité entièrement validée dit « Rien à faire » et devient inactif
- [x] Sous filtre, la ligne n'offre qu'un bouton d'ouverture, et les quatre cases y restent cliquables
- [x] Cocher la dernière ligne d'une liste filtrée la fait disparaître sans casser l'affichage

### Tenue à l'écran

- [x] Les colonnes ne bougent pas d'un filtre à l'autre — seule la hauteur du contenu change
- [x] La colonne « À faire » garde la même largeur avec 5 lignes et avec 58
- [x] Cocher ne fait pas sauter la liste ni perdre la position de défilement
- [x] En rétrécissant la fenêtre, les **cartes** passent de 4 colonnes à 2 sous 1300 px, puis à 1 sous 760 px — jamais 3, qui laisserait une carte orpheline
- [x] Les quatre **cases** d'une ligne (colonne « À faire ») restent côte à côte à toutes ces largeurs, sans jamais passer à la ligne
- [x] Le rappel `Cur Seg Ali Ann` reste aligné sur les cases après ces bascules
- [x] Les cases s'atteignent au clavier, dans l'ordre de lecture
- [x] Un lecteur d'écran annonce bien trois états, dont « partiellement coché » pour `/`

### Les cas creux

- [x] Sidecar coupé, cliquer une case : le bandeau d'erreur nomme la capacité **et** le document, et la case ne bouge pas
- [x] Les compteurs des cartes ne se remettent pas à zéro en silence pendant la panne
- [x] Sidecar relancé puis ↺ Actualiser : les cases retrouvent leur état sans recharger la page
- [x] Sur une base sans aucun document, les cartes disent « aucun document » et les boutons « Aucun document »
- [x] **Après la passe** : décocher toutes les coches posées, et vérifier que les quatre cartes retrouvent les comptes re-mesurés à l'ouverture
- [x] `select count(*) from doc_step_status` ne compte QUE les coches encore vives : une coche **périmée** y laisse sa ligne exprès, et c'est normal — le moteur la garde pour pouvoir dire « validé le …, puis modifié ». Confronter le compte à ce que `step_status_map` déclare `stale`, pas à zéro
