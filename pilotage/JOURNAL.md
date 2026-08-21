---
chantier: JOURNAL
statut: interrompu
---

# JOURNAL — journal de bord local

**Arrêté sur** — traînée des cinq derniers commits sous le point de reprise, commit `dd2f2c0` puis celui-ci, 22 août 2026.

## Reste

### Ce qui manque à l'outil

- [ ] Indicateur de collision entre chantiers — retenu à la conception, jamais codé ; les données existent (`git log --name-only` par code), c'est la brique la plus proche du besoin d'origine
- [ ] Seuil de dormance sur le silence d'un chantier (dormant ≥ 10 jours actifs) — coupé à la relecture de la maquette, à reposer si le tri seul ne suffit pas. La moitié « fossile ≥ 25 » est morte : elle visait la dormance des **fichiers**, axe mesuré cassé le 19 août (voir `Contexte`)
- [ ] L'onglet masses ne jalonne que les **retraits** : les plus gros ajouts sont tous des commits de bootstrap de mars (jusqu'à +146 951 lignes), inexploitables. À rouvrir quand février-mars sortira de toute fenêtre utile
- [ ] Le front n'est calculé que pour les fiches — ni le fil ni les passes ne le portent. Coupe volontaire, à rouvrir seulement si le fil devient illisible une fois plusieurs branches vivantes
- [ ] Le contrôleur pourrait signaler mécaniquement l'écart entre le commit cité dans `Arrêté sur` et le dernier commit réel du chantier — la traînée le rend visible, elle ne le compte pas

### Décisions en attente

- [ ] **Treize** des quatorze findings `QA-01`…`QA-14` de la passe shell du 16 août n'ont ni fiche ni item — seul `QA-06` est suivi, dans le `Reste` de R6. Décider s'ils méritent des fiches ou un seul chantier de correction
- [ ] Le front d'intégration contredit le vocabulaire de `statut:` : R6 affiche « livré » et « absent de origin/main, dev ». Décider si `livré` suppose un front, ou si les deux axes restent indépendants
- [ ] La nappe `.cible::after` couvre la carte : le texte d'une carte n'est plus sélectionnable à la souris — compromis connu du motif, à trancher si la sélection sert

### Le dossier à tenir

- [ ] Les 9 points de `smoke-u02` sous « À recadrer » visent des écrans supprimés en R6.5 — les recadrer vers le canvas ou les supprimer
- [ ] Élaguer les notes du 16 août dans `pilotage/qa/shell-v040.md` : l'énoncé doit porter le protocole, la preuve va dans le rapport

### Soldés

- [x] `pilotage/qa/smoke-u02.md` porte `chantier: U-02`, qui n'a pas de fiche — clos : `pilotage/U-02.md` existe, la passe est rattachée
- [x] `journal.mjs` : le compteur `commits` n'applique pas la garde `fourretout` alors que `dernierCommit` le fait — R2 et R4 comptent quelques commits de trop
- [x] `journal.mjs` : la section `## QA` d'une fiche n'est pas lue — clos non par un correctif mais par le gabarit, qui l'écrit désormais en toutes lettres (« le journal ne lit **jamais** `## QA` »). Section inerte assumée, plus un défaut
- [x] Remonter les codes de constat vers leur chantier et exclure du silence les commits qui ne touchent que `pilotage/` — fait le 21 août : `constatsAudit` remonté dans `journal-contrat.mjs`, sortie de `verifier.mjs` prouvée identique au caractère près

## Contexte

Trois tours de reconnaissance (16-17 août) avant d'écrire une ligne, puis la migration et
l'outil. Le problème d'origine était double : les documents de pilotage s'empilent sans se
fermer, et une QA visuelle préparée en session ne revient nulle part entre deux sessions.

**Ce qui a été retenu, parce que dérivable sans discipline nouvelle** : l'accueil = les
chantiers triés par silence en **jours actifs** (un seuil calendaire classait dormant le
fichier touché le dernier jour travaillé) ; le rattachement chantier → audit par **jointure
de contenu** (le code est littéralement dans le fichier d'audit — vérifié 13/14, 8/8, 3/3,
donc zéro heuristique temporelle et zéro champ `from:` à saisir) ; le fil filtré par scope
conventionnel, qui couvre 100 % des commits là où les codes de chantier n'en couvrent que
29 %.

**Ce qui a été écarté après mesure, à ne pas rouvrir** : les phases dérivées des tags (58
intervalles, médiane 2 commits, 49 % des commits dans 2 buckets) ; la fresque Gantt
(informativement redondante avec la liste triée) ; l'extraction d'un journal depuis les
palimpsestes (18 marqueurs seulement, et les dates manuscrites égalent 8/8 la date du
commit qui les introduit — donc à supprimer, pas à migrer) ; les en-têtes de corps de
commit comme axe de filtrage (5 commits sur 1030) ; le badge poussé/local (toujours 0) ;
les embranchements dérivés de la topologie git (une seule divergence en 5,5 mois).

**Le piège à retenir.** L'heuristique « dernier commit ≠ `docs:` ⇒ interrompu » **trie mais
ne conclut pas** : elle s'est trompée 4 fois sur 8 dans un sens (IMP-01, FE-02, T-03, E-2
sont clos malgré un dernier commit `fix`/`test`/`feat`) et 3 fois sur 8 dans l'autre (R2,
R4, U-03 sont « clos sauf X » derrière un `docs:`). Toute fiche doit être confrontée au
tracker `docs/AUDIT_FOLLOW_UP.md` et au corps du commit, jamais posée sur le seul type.

**Hypothèse non établie.** Après plus de 7 jours d'absence, les 3 reprises observées
portent sur autre chose que le chantier interrompu — mais ces 3 observations sont
antérieures au régime de travail actuel, et un chantier simplement *déplacé* par un autre
revient après 12-13 jours (R5, R6). À traiter comme plausible, pas comme acquis.

**Méthode de vérification visuelle, acquise le 19 août.** Chrome et Edge sont installés
sur la machine : `chrome --headless=new --screenshot` et `--dump-dom` permettent de
capturer la page servie et d'inspecter le DOM rendu, sans quitter la session. C'est ce qui
a trouvé le bug des ancres imbriquées — invisible en lisant le CSS, qui était correct.
Deux pièges rencontrés dans la même passe : échantillonner une colonne de pixels qui
traverse les glyphes fait compter le texte comme du fond manquant (premier diagnostic
faux, qui allait faire « corriger » un `space-between` innocent) ; et `journal.mjs` ne se
recharge pas à chaud, `pkill` n'atteint pas le processus Windows, donc une vérification
après édition du serveur mesure l'ancien code tant qu'on n'a pas tué le PID.

**Le dépôt n'a pas de fourche, il a une droite** (mesuré le 19 août). Commits présents
quelque part mais absents de `refonte` : 12, et ce sont ceux de mars que retient le tag
`archive/shell-split`. Tout le reste s'emboîte : `origin/main` ⊂ `dev` (+16) ⊂ `refonte`
(+219). Il n'y a donc rien à dessiner — l'axe utile n'est pas la topologie mais le **front
d'intégration**, un mot par fiche. Il est dérivé de `git rev-list` sur les refs passées en
`--refs` (défaut `origin/main,dev`), donc aussi frais que le dernier `git fetch` : un front
`dev` peut être en retard sur le vrai dev distant si on n'a pas fetché.

**Danger identifié, à ne pas oublier au merge de refonte.** `dernierCommit` teste `c.sujet`,
jamais `c.corps` : un squash pousse les 219 sujets dans un corps que le journal ne lit pas.
Si la branche est ensuite supprimée, 8 fiches sur 13 perdent leur ancre le même jour (R3 59
commits, R5 34, R6 25, R4 14, R2 7, JOURNAL 5, IMP-01 3, FE-02 1). Or la pratique récente du
dépôt est le squash (43 commits à un parent en `… (#NNN)`, le dernier le 20 juillet ; les
merge commits se sont arrêtés le 30 juin). Deux parades : `dev` étant ancêtre de `refonte`,
un `git merge` est un fast-forward qui préserve tout ; sinon `git tag archive/refonte` avant
le squash — le dépôt le fait déjà, `archive/shell-split` retient à lui seul 12 commits
qu'aucune branche ne contient, et `git log --all` les lit.

**Le portage sur `dev`, et pourquoi un instantané.** L'outil lit les fiches dans l'arbre
de travail : tant que `pilotage/` ne vivait que sur refonte, un checkout de dev affichait
un journal vide. Rejouer les 8 commits d'origine par cherry-pick a été essayé en worktree
jetable : conflit `add/add` immédiat sur `R3.md` et `R6.md`, parce que le rejeu fige un
contenu que refonte a fait bouger depuis. Un `add/add` n'est pas un conflit de lignes —
sans base commune, git jette le fichier entier. Un commit portant le **contenu actuel** :
zéro conflit. Et l'étape qui n'est pas optionnelle est la suivante — **fusionner `dev`
dans refonte tout de suite**, ce qui rend le commit de portage ancêtre de refonte : la base
des merges suivants contient alors `pilotage/`, et la classe `add/add` disparaît. Vérifié
dans les deux sens : sans réconciliation, une simple ligne ajoutée d'un côté rouvre le
conflit ; avec, une divergence des deux côtés fusionne toute seule.

Effet de bord à ne pas prendre pour un défaut : le front d'intégration de cette fiche
affiche toujours `refonte`. C'est exact — il suit le dernier commit **citant le code**, et
le commit de portage n'en cite aucun. Les fichiers sont sur dev, l'historique de l'outil
non.

**La remontée des constats, et pourquoi le contrat plutôt qu'une copie.** Trois options
étaient sur la table : dupliquer le parseur de tableau d'audit dans `journal.mjs`, le
remonter dans `journal-contrat.mjs`, ou faire consommer au serveur le JSON du contrôleur.
La copie est condamnée par l'en-tête du contrat lui-même — deux lectures divergentes
donneraient des chiffres plausibles et contradictoires, et le mode de divergence était
concret : le contrôleur ne compte que les constats **ouverts**, une copie naïve aurait
attribué à R3 des commits pour des constats soldés. Le JSON du contrôleur a été écarté
parce qu'il **inverse la dépendance** : le silence et le dernier commit dépendraient alors
de la présence d'un script de contrôle, qui disparaît dès qu'on lance avec `--dir` ailleurs.

Trois gardes, imposées par la mesure : le code doit venir du **tableau** et non de la prose
(`AUDIT_ALIGNEMENT` renvoie à `T-05` en texte, pas en tableau) ; l'audit doit n'avoir
**qu'une** fiche propriétaire (`AUDIT_2026-06-12` est cité par quatre, ses orphelins
seraient allés aux quatre) ; le code ne doit pas avoir de fiche à lui. Effet : R3 passe de
57 à 71 commits et son dernier commit devient `b23f05b` (le travail) au lieu de `e955e6d`
(la note *sur* R3). `fourretout` a dû être redéfini au passage — il comptait les codes,
il compte maintenant les **chantiers** touchés, sans quoi un commit citant trois `ALI-*`
aurait été écarté alors qu'il est du R3 pur.

Un seuil reste arbitraire et le restera : une passe armée mais pas jouée sort de « en vol »
après **2 jours actifs** (`ARME` dans `journal.html`). Premier essai à 3 : la passe shell
remise à zéro le 16 août remontait avec les passes du jour. Ce n'est pas dérivé, c'est un
jugement.

**La dérive se fabrique, elle ne s'hérite pas — mesuré le 22 août.** Les douze items
ouverts de cette fiche confrontés au code, un par un : **quatre à corriger sur douze**.
Un périmé (`U-02` a désormais sa fiche), un clos par le gabarit plutôt que par un
correctif (`## QA`), un faux dans son quantificateur (« aucune fiche pour les 14 `QA-*` »
alors que `QA-06` est suivi dans R6), et un qui **contredisait le `Contexte` de sa propre
fiche** — il proposait de reposer un seuil « fossile » que le paragraphe d'en dessous
déclare mort et mesuré comme tel.

**33 % sur une fiche de cinq jours, contre 10 % mesurés sur les items migrés** qui
traînaient depuis des mois. Le reliquat écrit en fin de session est une affirmation que
personne ne rouvre : c'est le moment où l'on fabrique le plus de fiction, pas celui où
l'on en hérite. La contradiction interne est le cas le plus instructif — deux passages du
même fichier peuvent se démentir sans qu'aucun contrôle mécanique ne le voie.

**`Arrêté sur` est une pile de profondeur un — mesuré le 22 août.** En comparant, pour
chaque fiche, le commit cité dans la ligne de reprise avec le dernier commit réel du
chantier : **4 fiches sur 14 la portent périmée, et ce sont les trois plus actives**
(R3 renvoyait au 19 juillet quand le travail datait du 20 août, R5 pareil, JOURNAL et
U-02 ne citaient aucun hash). Les dix autres sont exactes parce que rien ne s'est passé
depuis qu'on les a écrites. Autrement dit, l'artefact de reprise n'est fiable que là où
on n'en a pas besoin — un défaut invisible sans cette comparaison, puisqu'une ligne
périmée reste une ligne plausible.

La traînée ne remplace pas la ligne écrite : celle-ci porte l'intention, que git ne sait
pas dire. Elle porte les faits à côté, pour que l'écart se voie. `dernier commit` a quitté
le panneau latéral du même coup — la traînée le donne avec son sujet, à l'endroit où on
le lit.

**Le test d'admission du tableau de bord.** Un chiffre n'entre que s'il peut être
mauvais et qu'être mauvais change la suite. Admis : la veille `sidecar.py` (`+410 / 500`,
seuil réel), les points de vérification en file (82), les items jamais confrontés au code
(53), les constats d'audit ouverts (17). Recalés : le silence en jours actifs (on le sait
faussé par la tenue du dossier — afficher en tête une mesure connue pour biaisée est pire
que ne rien afficher), le nombre de fiches non intégrées (constant tant que refonte est
ouverte), le total des restes ouverts (il ne fait que monter et mesure la rigueur
d'enregistrement, pas l'avancement). Un seul de ces chiffres a un seuil, donc un seul
porte une jauge : pas de seuil inventé pour faire joli.

Deux choses apprises en construisant : les 12 avertissements du contrôleur affichés bruts
répétaient huit fois le même message et enterraient les chantiers sous le pli — groupés par
contrôle, ils tiennent en deux lignes. Et le contrôleur se lance en processus fils plutôt
qu'en import, parce qu'il s'exécute au chargement et sort par `process.exit` ; sa sortie
JSON reste bonne même quand il retourne 1. Coût total des deux bandes : 0,79 s par requête
contre 0,60 s, la veille étant mémorisée sur HEAD et le contrôleur laissé vivant puisqu'il
lit des fichiers que les cases modifient.

**L'axe fossile est cassé, mesuré le 19 août — ne pas le rouvrir.** L'idée était de
signaler le code que personne n'a touché depuis longtemps. Au niveau du module, l'échelle
s'effondre : le maximum est de 45 jours actifs (`engine/db`, 4 fichiers), tout le reste
tient entre 0 et 14. Au niveau du fichier, 85 des 503 fichiers datent d'avant mai — mais ce
sont massivement des `tests/` qui passent toujours et des `migrations/` que la convention
du dépôt **interdit** de modifier une fois appliquées. L'axe signalerait donc exactement
les fichiers qui doivent rester immobiles.

**Ce qui marche, à l'inverse : les masses.** La somme cumulée de `git log --numstat` donne
la taille de chaque aire à chaque instant — vérifiée **exacte à la ligne près** sur six
aires (`sidecar.py`, `services/`, `prep/lib|screens|components|ui`) contre un `wc -l`
réel, à condition de passer `--no-renames` (sinon le chemin sort en `{ancien => nouveau}`
et le préfixe ne matche plus). Un seul parcours de l'historique, mémorisé sur le hash de
HEAD : 3,1 s au premier appel, 0,6 s ensuite. Et la décomposition est **obligatoire** —
sur juin, `tauri-prep` agrégé affiche « +6 047 » alors que `screens` perd 2 887 lignes
pendant que `lib` en gagne 5 662 et `components` 3 184. Une seule série ne serait pas
seulement grossière, elle mentirait sur le sens du mouvement.

Le vocabulaire de `statut:` manque une valeur : R2, R4, U-03, A-01 et cette fiche ont tous
été fermés ou parqués **volontairement**, sans rien d'une interruption accidentelle, mais
`clos` masquerait leur `## Reste`. Ils portent donc `interrompu` par défaut.
