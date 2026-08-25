---
passe: Langues affichées et multisegments (1.6.77)
chantier: R3
duree: 30 min
derniere: 2026-08-25
---

# QA — travailler une langue à la fois

Passe du lot qui clôt **ALI-15** et **ALI-25**, livre le correctif 2 d'**ALI-18** et la
moitié d'**ALI-16**. Elle ne rejoue ni `alignement-2026-08.md` (campagne d'audit) ni
`annulation-alignement.md` (bandeau ↶) ni `shell-v040.md` : les trois restent valables et
se jouent à part.

**Ce que le lot change, et que seuls les yeux valident.** La matrice porte une barre de
langues : masquer une colonne la retire de l'affichage **et** du périmètre des gestes
destructifs — c'est le même ensemble qui sert de `target_doc_ids` à la projection et de
borne au recalcul. Un « ⇄ » par en-tête relance une colonne seule. Et les deux formes de
multisegment changent d'aspect : le 2-1 est peint une fois à cheval sur ses lignes au lieu
d'être dupliqué avec un ⚠, la cellule à plusieurs phrases porte enfin une marque.

**Contexte d'exécution.** Shell dev (`npm --prefix tauri-shell run tauri -- dev`) avec un
sidecar **reconstruit après ce lot** — contrat live attendu **1.6.77**, engine **0.4.0**.
Le rebuild Windows se fait en `--format onefile` (le défaut `onedir` est ignoré par
`externalBin`), et le premier lancement d'un binaire onefile est lent : smoke avec
`--timeout 150`. Base servie : une **WORKCOPY**, jamais le corpus réel.

**Sans rebuild, la passe teste autre chose.** Un sidecar antérieur à 1.6.77 ignore
`target_doc_ids` ; c'est précisément le cas que la zone « Sidecar antérieur » vérifie, mais
tout le reste échouera alors pour une raison qui n'est pas un défaut. Vérifier le numéro de
contrat **avant** de commencer.

**Les chiffres ci-dessous sont mesurés sur la WORKCOPY du 2026-08-25**, pas estimés. S'ils
ne tombent pas, c'est soit un défaut, soit une base qui a bougé — trancher en relisant la
base avant de consigner. Les deux familles de référence :

| famille | moyeu | colonnes | lignes moyeu |
|---|---|---|---|
| **Modiano** (`Modiano-Rue_FR.docx`, root 373) | fr | en · es · ro | 1 913 |
| **Lodge** (`Lodge-Small_EN.docx`, root 396) | en | es · fr | 1 372 |

**Un piège de la passe elle-même** : la préférence d'affichage vit en `sessionStorage`,
par corpus **et par famille**. Elle survit à un rechargement de page, pas à un
redémarrage de l'application — un retour à « toutes les langues » après relance est voulu.

### Version et contrat

- [ ] Le panneau Diagnostic annonce contrat **1.6.77** et engine **0.4.0**
- [ ] Aucune erreur JS dans l'inspecteur au chargement de la matrice (le garder ouvert toute la passe)

### La barre des langues

- [ ] Sélectionner la famille **Modiano** : la barre « Langues » affiche **3 chips** — `en`, `es`, `ro` — avant même d'avoir cliqué « Charger la matrice »
- [ ] Les 3 chips sont allumés : le défaut est bien « toutes les langues »
- [ ] Après « Charger la matrice », les chips portent leur effectif : **en 1925**, **es 1924**, **ro 1921**
- [ ] Sur **Lodge**, les chips portent **es 1763** et **fr 1378**
- [ ] Éteindre `es` et `ro` : la grille ne montre plus que **fr** et **en**, et la mention « **2 masquées : es et ro** » apparaît
- [ ] Le bouton « **Toutes (3)** » n'apparaît QUE lorsqu'une colonne est masquée
- [ ] « Toutes (3) » rétablit les trois colonnes et fait disparaître la mention
- [ ] L'infobulle d'un chip allumé dit que la colonne « ne sera plus ni chargée, ni affichée, ni touchée par « Aligner » »
- [ ] Masquer puis réafficher `es` : la colonne revient **à sa place** (fr · en · es · ro), pas à la fin
- [ ] Tout masquer : le bouton « ⇄ Aligner » s'éteint et son infobulle dit « Aucune langue affichée — afficher au moins une traduction pour aligner »
- [ ] Tout masquer laisse une grille lisible : le moyeu seul, sans colonne de traduction

### Ce que la projection charge vraiment

- [ ] Sur Modiano, ne garder que `ro` : la grille se peint **nettement plus vite** qu'en 4 colonnes (mesuré côté moteur : 22 ms contre 72, et 1,28 Mo sur le fil contre 3,04)
- [ ] Dans l'inspecteur (onglet Réseau), le `POST /align/matrix` scopé porte bien `target_doc_ids` et sa réponse ne contient que **2 langues**
- [ ] Toutes les colonnes visibles : la requête **ne porte pas** `target_doc_ids` (chemin historique)
- [ ] Le badge « N hors matrice » ne s'affiche que pour les colonnes visibles — sur **Lodge**, `es` en porte **6**, `fr` aucun
- [ ] L'avertissement d'ancrage au-dessus de la grille ne parle que des langues affichées

### Un run ne touche jamais une colonne masquée

- [ ] Sur Modiano, masquer `es` et `ro`, cliquer « ⇄ Aligner » : la bande annonce **1925** liens (l'effectif de `en`), **pas 5770** (celui de la famille)
- [ ] La bande nomme le périmètre : « Le recalcul ne portera que sur **en** »
- [ ] La bande nomme les épargnées : « **es, ro** sont épargnées — masquées, donc hors du run »
- [ ] Le bouton destructif s'intitule « **Recalculer en** », pas « Recalcul global »
- [ ] Toutes les colonnes visibles : le bouton redit « **Recalcul global** » et la bande ne nomme aucune épargnée
- [ ] Sur **Lodge**, masquer `fr` et lancer « Aligner » : la bande signale que **1 de ces liens a été posé à la main et sera supprimé**
- [ ] Lancer le recalcul scopé sur `en` (Modiano), puis réafficher `es` : ses **1924** liens sont intacts
- [ ] Après ce recalcul, l'offre « ↺ Annuler ce run » apparaît et ne concerne **qu'une paire**
- [ ] Armer la bande de confirmation, puis cliquer « Toutes » : la bande **disparaît** et aucun run ne part

### Le ⇄ par colonne

- [ ] Chaque en-tête de traduction porte un « **⇄** » à côté du « ↗ Segmenter », **visible au repos** (pas seulement au survol)
- [ ] Les deux boutons de l'en-tête ont le **même aspect** (même bordure, même teinte) — ils n'ont pas deux styles différents côte à côte
- [ ] L'infobulle du ⇄ dit « Réaligner cette colonne seule — les autres langues ne sont pas touchées »
- [ ] Cliquer le ⇄ de `ro` alors que les 3 colonnes sont visibles : la bande annonce « Recalculer **ro** » et **1921** liens
- [ ] Après ce run, les **3 chips restent allumés** : le ⇄ ne change pas l'affichage
- [ ] Le moyeu n'a pas de ⇄ (on n'aligne pas la source contre elle-même)

### Multisegments — le groupe 2-1

- [ ] Sur Modiano, colonne `ro` : trouver une cellule marquée « **1 trad ↔ 2 segments** » (il y en a **71** dans cette colonne, **39** en `en`, **66** en `es`)
- [ ] Le texte de la traduction n'apparaît **qu'une seule fois**, la cellule est à cheval sur les **deux** lignes source
- [ ] La cellule est sur fond d'**information** (bleuté), pas sur fond d'**alerte** (ambre)
- [ ] Aucune des deux lignes d'un groupe ne porte la barre ambre de « ligne à réparer »
- [ ] La cellule groupée porte « ✂ **Répartir** », dont l'infobulle nomme le nombre de segments couverts
- [ ] « ✂ Répartir » ouvre le même sélecteur à deux panneaux qu'avant, et la coupe aboutit
- [ ] Après la coupe, le groupe a disparu : deux cellules distinctes, chacune sa tranche
- [ ] Le segment `fr n=1902` « Mon nom. » et `fr n=1903` « Ou celui du jockey, par exemple. » forment bien un groupe en `ro` — et sa lecture montre qu'il est **légitime** (rien à réparer)
- [ ] Le segment `fr n=1909` « Pedro… » et `fr n=1910` « Nous restions debout au bord du talus. » forment aussi un groupe en `ro` — et sa lecture montre qu'il est **faux** (le roumain ne traduit que le second)
- [ ] Le ¶ d'un groupe qui enjambe une frontière de paragraphe reste lisible (le trait de séparation ne coupe pas la cellule en deux)

### Multisegments — la cellule à plusieurs phrases

- [ ] Sur **Lodge**, colonne `es` : les cellules à plusieurs phrases portent une pastille « **2 phrases** » **visible sans survoler**
- [ ] Il y en a beaucoup — **391 sur 1 372** ; en parcourant la colonne on en croise sans les chercher
- [ ] Ouvrir l'une d'elles : c'est bien une **note du traducteur** avalée dans la cellule voisine (`( N. del T. )`)
- [ ] La colonne `fr` de la même famille n'en porte quasiment aucune (**6**)
- [ ] Aucune cellule **vide** (∅) ne porte de pastille « N phrases »
- [ ] Le ✎ (stylo) n'apparaît **pas** sur une cellule à plusieurs phrases — inchangé

### Le bandeau de complétude

- [ ] Modiano, 3 colonnes visibles : le bandeau annonce **3 à réparer** (et non 179)
- [ ] Le même bandeau annonce **176 groupées** et **34 à plusieurs phrases**, à côté du compte et non dedans
- [ ] Ne garder que `ro` : le bandeau descend à **1 à réparer**, **71 groupées**, **9 à plusieurs phrases** — il décrit ce qui est affiché
- [ ] Sur **Lodge**, 2 colonnes : **0 à réparer**, **41 groupées**, **397 à plusieurs phrases**
- [ ] Les mentions « groupées » et « à plusieurs phrases » disparaissent quand leur compte est nul

### Sidecar antérieur

> Se joue avec le binaire **d'avant le lot** (ou en pointant le shell sur un sidecar plus
> ancien). C'est le seul cas où un défaut serait destructeur : un moteur qui ignore
> `target_doc_ids` purgerait toute la famille sur un recalcul qu'on croit borné.

- [ ] Masquer une colonne : un message signale que « les langues masquées restent chargées et affichées »
- [ ] Cliquer « ⇄ Aligner » avec une colonne masquée : le geste est **refusé**, avec « Sidecar trop ancien pour borner un alignement à une colonne »
- [ ] Aucune bande de confirmation ne s'arme, et **aucun run ne part**
- [ ] Réafficher toutes les langues : « Aligner » redevient possible et se comporte comme avant le lot

### Gardes d'écran

- [ ] Pendant un alignement, les chips sont **grisés** — impossible de basculer une langue en vol
- [ ] Après le run, les chips redeviennent actifs et leurs effectifs sont **à jour**
- [ ] Changer de famille remet la barre à la famille choisie (et non aux colonnes de la précédente)
- [ ] Masquer `ro` sur Modiano, aller sur une autre famille, revenir : `ro` est **toujours masqué**
- [ ] Quitter l'écran Matrice et y revenir : la sélection de langues est **conservée**
- [ ] Recharger la page (F5) : la sélection est **conservée**
- [ ] Fermer puis relancer l'application : la sélection repart de **toutes les langues** (voulu)
- [ ] Changer de corpus : la barre se vide et se reconstruit sur la nouvelle base, sans garder d'ancienne sélection

### Non-régression des gestes existants

- [ ] ✂ couper à cheval, ⭙ fusionner, ✕ retirer, ＝ rattacher : tous encore offerts et fonctionnels sur une cellule d'une colonne visible
- [ ] Le ✎ (stylo) fonctionne toujours sur une cellule propre et sur le segment source
- [ ] Le bandeau « ↶ Annuler » d'un geste de lien s'arme et défait toujours d'un bloc
- [ ] Le geste ¶ de la colonne paragraphe fonctionne toujours
- [ ] Le « ↗ Segmenter » d'en-tête ouvre toujours le bon document
- [ ] L'export CSV de la matrice (`/export/matrix`) contient **toujours toutes les langues**, même avec des colonnes masquées à l'écran
