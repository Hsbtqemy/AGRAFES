---
chantier: JOURNAL
statut: interrompu
---

# JOURNAL — journal de bord local

**Arrêté sur** — correctif des ancres imbriquées : la carte n'est plus une `<a>`, le plateau reprend toute la hauteur, commit `cdd43c6`, 19 août 2026.

## Reste

- [ ] Indicateur de collision entre chantiers — retenu à la conception, jamais codé ; les données existent (`git log --name-only` par code), c'est la brique la plus proche du besoin d'origine
- [ ] Seuil de dormance en jours actifs (dormant ≥ 10, fossile ≥ 25) — coupé à la relecture de la maquette, à reposer si le tri seul ne suffit pas
- [ ] `pilotage/qa/smoke-u02.md` porte `chantier: U-02`, qui n'a pas de fiche — la passe n'est rattachée à rien à l'écran
- [ ] Les 9 points de `smoke-u02` sous « À recadrer » visent des écrans supprimés en R6.5 — les recadrer vers le canvas ou les supprimer
- [ ] Élaguer les notes du 16 août dans `pilotage/qa/shell-v040.md` : l'énoncé doit porter le protocole, la preuve va dans le rapport
- [ ] La nappe `.cible::after` couvre la carte : le texte d'une carte n'est plus sélectionnable à la souris — compromis connu du motif, à trancher si la sélection sert
- [x] `journal.mjs` : le compteur `commits` n'applique pas la garde `fourretout` alors que `dernierCommit` le fait — R2 et R4 comptent quelques commits de trop
- [ ] `journal.mjs` : la section `## QA` d'une fiche n'est pas lue — le rattachement est dérivé du `chantier:` de la passe. Le contrat du gabarit décrit une section inerte
- [ ] Aucune fiche pour les 14 findings `QA-01`…`QA-14` de la passe shell du 16 août — décider s'ils méritent des fiches ou un seul chantier de correction

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

Le vocabulaire de `statut:` manque une valeur : R2, R4, U-03, A-01 et cette fiche ont tous
été fermés ou parqués **volontairement**, sans rien d'une interruption accidentelle, mais
`clos` masquerait leur `## Reste`. Ils portent donc `interrompu` par défaut.
