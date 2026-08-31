---
passe: Actions — le tri-état
chantier: ACT-01
duree: 25 min
derniere: —
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
Le dernier bloc les retire ; ne pas le sauter.

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

Base de travail `corpus_agrafes.WORKCOPY.db`, 58 documents, mesurée le 31 août.
**Re-mesurer avant de jouer** — la base bouge, et un item comparé à un nombre périmé ne
prouve rien :

```
python -c "import json,urllib.request as u; pf=json.load(open('<db_dir>/.agrafes_sidecar.json')); d=json.load(u.urlopen('http://127.0.0.1:%d/documents?limit=500'%pf['port']))['documents']; T={'curation':lambda x:bool(x.get('curated_at')),'segmentation':lambda x:not(isinstance(x.get('unit_count'),int) and x['unit_count']<=1),'alignement':lambda x:(x.get('aligned_count') or 0)>0,'annotation':lambda x:x.get('annotation_status')=='annotated'}; [print('%-13s %2d a faire, %2d en cours, %d coches'%(s,sum(1 for x in d if not f(x)),sum(1 for x in d if f(x)),sum(1 for x in d if (x.get('step_status') or {}).get(s)))) for s,f in T.items()]"
```

| carte | doit afficher | son bouton de filtre |
|---|---|---|
| Curation | **56 à faire · 2 en cours** | Voir les 58 |
| Segmentation | **58 en cours** — sans « à faire », `none` vaut 0 | Voir les 58 |
| Alignement | **37 à faire · 21 en cours** | Voir les 58 |
| Annotation | **52 à faire · 6 en cours** | Voir les 58 |

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
puis fusionner deux unités (`merge_units`). Ce sont les deux chemins les plus courts ;
changer un rôle n'en est pas un, et c'est délibéré.

**Lire les coches en base**, à tout moment :

```
sqlite3 "file:<chemin>?mode=ro" "select doc_id, step, validated_at from doc_step_status"
```

### Les quatre cases

- [ ] Chaque ligne porte exactement quatre cases — jamais trois, jamais cinq
- [ ] L'ordre Curation · Segmentation · Alignement · Annotation est identique sur les 58 lignes : la deuxième case se suit du regard de haut en bas sans la chercher
- [ ] Une case « rien » est vide, « en cours » porte `/`, « validé » porte `✕`
- [ ] Les trois états se distinguent au coup d'œil sans lire l'infobulle — au fond ou au cadre, pas au seul glyphe
- [ ] Sur `#375 Nothomb-Hygiene_FR.docx` : première case vide, deuxième à `/`
- [ ] `Index périmé` reste une pastille à part, jamais une cinquième case
- [ ] Un titre très long ne décale pas les cases : la colonne garde la même largeur d'une ligne à l'autre

### Cocher et décocher

- [ ] Cliquer une case vide la fait passer à `✕`
- [ ] Cliquer une case `/` la fait passer à `✕` — les deux états mènent à la coche
- [ ] Cliquer une case `✕` la ramène à ce que le moteur observe
- [ ] Sur `#375`, cocher puis décocher Segmentation la ramène à `/`, pas à vide
- [ ] Sur `#375`, cocher puis décocher Curation la ramène à vide
- [ ] Cocher ne change pas d'écran, n'ouvre aucun panneau, ne déplace pas la liste
- [ ] Le compteur de la carte correspondante bouge dans la foulée, sans avoir à rafraîchir
- [ ] Cocher une ligne ne modifie aucune autre ligne

### Ce que la coche vaut

- [ ] L'infobulle d'une case vide dit « rien de fait »
- [ ] Celle d'une case `/` dit « commencé, jamais validé »
- [ ] Coche Segmentation sur `#377 Nothomb-Stupeur_FR.docx` : l'infobulle dit « validé le …, **avant que l'historique existe** »
- [ ] Coche Segmentation sur `#368 Houellebecq-Plateforme_FR.docx` : elle dit « validé le …, **aucune modification enregistrée depuis** »
- [ ] Les deux formulations se distinguent bien : la première annonce une coche plus faible, et cela doit s'entendre
- [ ] Chaque infobulle nomme le document, pas seulement la capacité

### La péremption

- [ ] Coche Curation sur `#364 Beigbeder-Francs_EN.docx`, puis corriger une phrase au stylo : la case retombe à `/`
- [ ] Son infobulle dit « validé le …, puis modifié » et nomme `update_text`
- [ ] Re-cliquer la case périmée la re-valide — elle ne se décoche pas
- [ ] Coche Segmentation sur `#368`, puis fusionner deux unités : retombe à `/`, raison `merge_units`
- [ ] Une coche périmée compte comme « en cours » dans sa carte, jamais comme validée
- [ ] Changer le rôle d'un document coché ne périme aucune de ses quatre cases
- [ ] Annuler l'action qui a périmé la coche lui rend son `✕`

### Les deux nombres des cartes

- [ ] Curation affiche « 56 à faire · 2 en cours »
- [ ] Segmentation affiche « 58 en cours », sans « à faire » — et non « 0 à faire · 58 en cours »
- [ ] Alignement affiche « 37 à faire · 21 en cours »
- [ ] Annotation affiche « 52 à faire · 6 en cours »
- [ ] Cocher un document fait baisser un seul des deux nombres, jamais les deux
- [ ] Décocher le remet exactement là où il était
- [ ] Valider les 58 documents d'une capacité fait dire « tout à jour » à sa carte

### Le filtre, tant que rien n'est validé

- [ ] Les quatre boutons annoncent « Voir les 58 » : aucune capacité ne discrimine
- [ ] Filtrer sur une capacité ne retire donc aucune ligne — juger si la page reste utile dans cet état, c'est le premier écran de quelqu'un qui n'a jamais coché
- [ ] Cocher Segmentation sur cinq documents fait descendre le bouton à « Voir les 53 », et la liste à 53 lignes
- [ ] Le bouton d'une capacité entièrement validée dit « Rien à faire » et devient inactif
- [ ] Sous filtre, la ligne n'offre qu'un bouton d'ouverture, et les quatre cases y restent cliquables
- [ ] Cocher la dernière ligne d'une liste filtrée la fait disparaître sans casser l'affichage

### Tenue à l'écran

- [ ] Les colonnes ne bougent pas d'un filtre à l'autre — seule la hauteur du contenu change
- [ ] La colonne « À faire » garde la même largeur avec 5 lignes et avec 58
- [ ] Cocher ne fait pas sauter la liste ni perdre la position de défilement
- [ ] À 375 px de large, les quatre cases restent sur une seule ligne
- [ ] Les cases s'atteignent au clavier, dans l'ordre de lecture
- [ ] Un lecteur d'écran annonce bien trois états, dont « partiellement coché » pour `/`

### Les cas creux

- [ ] Sidecar coupé, cliquer une case : le bandeau d'erreur nomme la capacité **et** le document, et la case ne bouge pas
- [ ] Les compteurs des cartes ne se remettent pas à zéro en silence pendant la panne
- [ ] Sidecar relancé puis ↺ Actualiser : les cases retrouvent leur état sans recharger la page
- [ ] Sur une base sans aucun document, les cartes disent « aucun document » et les boutons « Aucun document »
- [ ] **Après la passe** : décocher toutes les coches posées, et vérifier que les quatre cartes retrouvent 56·2 / 58 / 37·21 / 52·6
- [ ] `select count(*) from doc_step_status` rend bien 0 à la fin
