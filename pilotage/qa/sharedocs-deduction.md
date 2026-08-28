---
passe: ShareDocs — la déduction de mode par fichier
chantier: SD-01
duree: 20 min
derniere: 2026-08-28
---

# QA — ShareDocs déduit au lieu d'imposer

Passe écrite le 28 août, **avant que rien du lot n'ait été vu tourner** : sonde distante
`POST /webdav/probe`, modes par fichier à l'import, retrait du profil de lot, colonne de
verdicts dans le listing. Tout est vérifié par les tests et les builds, rien par l'écran.

**Il faut un serveur WebDAV joignable** — Huma-Num, Nextcloud ou autre — avec des
identifiants et au moins un dossier contenant des `.docx`/`.txt`. Sans lui la passe est
injouable et il n'y a pas de contournement : la sonde télécharge vraiment les fichiers.
Les blocs « Le verdict dit la même chose que l'import local » et « Après l'import » sont
les plus utiles ; commencer par eux si le temps manque.

**Le sidecar embarqué doit être postérieur au 28 août 2026** (contrat 1.6.83). Vite
recompile le TypeScript à chaque lancement, mais le sidecar est un binaire prébuilt de
224 Mo : `POST /webdav/probe` n'existe pas dans un binaire plus ancien, l'appel répond 404,
et **la colonne reste vide sans autre signe** qu'une ligne `⚠ Sonde impossible` dans le
journal. C'est exactement ce qui est arrivé le jour où la passe a été écrite. En cas de
doute : `python scripts/build_sidecar.py --preset shell --format onefile`, application
fermée, puis `python scripts/smoke_sidecar.py tauri-shell/src-tauri/binaries/sidecar-manifest.json --timeout 150`.

**La mesure de référence est comparative, et c'est délibéré.** Aucun item n'annonce un
compte absolu : je n'ai pas accès au serveur, donc je ne peux pas mesurer ce qu'il porte.
Mais la thèse du lot est précisément que **les deux écrans disent la même chose du même
fichier** — c'est donc l'écran local qui sert d'étalon, en ouvrant le même document depuis
le disque. Un désaccord entre les deux est un échec, quel que soit le chiffre.

**Deux modes d'authentification ne sont pas jouables ici**, faute de jeton et d'accès
anonyme sous la main : le bandeau doit dire « jeton d'accès » et « accès anonyme » sans
jamais montrer le jeton. Ce n'est pas un trou de vérification — c'est couvert par deux
tests unitaires de `connectionSummary`, dont un qui assère que le jeton n'apparaît pas.
Et l'écran n'ajoute aucune branche : il passe le mode en **paramètre** d'une fonction pure
(`ShareDocsImportScreen.ts:614`), le même appel pour les trois modes. Jouer le cas basic
exerce donc le chemin de code entier ; seul le libellé des deux autres reste sur les tests.

**Où ça se passe.** Écran **ShareDocs** (barre de gauche). Le listing d'un dossier a
désormais **cinq colonnes**, la dernière s'intitulant « Ce que l'import en ferait ».

**La mise en page a changé le 28 août** : une fois connecté, la carte « Connexion » se
**replie** en un bandeau d'une ligne et laisse la place au dossier. Les cartes ne sont plus
numérotées — « Connexion / Dossier / Rapport » — puisque ce n'est plus une séquence.

**Ce qui a disparu, et qu'il ne faut pas chercher** : le sélecteur « Profil par défaut
(style) » avec ses options « Lignes numérotées [n] » / « Paragraphes ». Il décidait pour
tout un lot et se trompait sur 149 des 273 fichiers réels mesurés. Le champ « Langue par
défaut (si non détectée) » reste, lui.

### La connexion se replie

- [x] Avant connexion, la carte **« Connexion »** est dépliée et il n'y a aucun bandeau au-dessus
- [x] Après un **« Connecter »** réussi, la carte disparaît et un **bandeau** la remplace : « 🔗 <hôte> · <identifiant> », avec un bouton **« Changer de connexion »** à droite. Le dossier remonte en haut de l'écran
- [x] Le bandeau montre l'**hôte seul**, pas l'URL entière — le chemin vit dans le fil d'Ariane du dossier. Descendre de deux sous-dossiers : le bandeau **ne bouge pas**, le fil d'Ariane suit
- [x] Le bandeau montre l'**identifiant** et **jamais le mot de passe**, alors qu'il vient d'être saisi deux champs plus haut
- [x] Cliquer **« Changer de connexion »** redéplie le formulaire, **sans déconnecter** : le dossier reste affiché et navigable en dessous
- [x] Une connexion **échouée** (mauvaise URL, mauvais mot de passe) laisse la carte dépliée : on ne replie que ce qui a abouti

### La colonne de verdicts apparaît

- [x] Se connecter et ouvrir un dossier contenant des `.docx` ou des `.txt` : la table du dossier a bien **cinq** colonnes, la dernière intitulée **« Ce que l'import en ferait »**
- [x] Pendant que la sonde travaille, les lignes de fichiers portent **« analyse… »** en italique gris ; elles se remplissent ensuite, d'un coup, quand le job rend son rapport
- [x] Le **journal** (📋 Journal, barre du haut) porte une ligne `✓ Sonde <dossier> — N lu(s), N sans déduction, N non importable(s)`
- [x] Un **bandeau bleu pâle** se déplie en haut de la zone de contenu, titré **« Jobs actifs »** — il est invisible quand rien ne tourne. Il porte une ligne **« Sonde — <dossier> »**, de type **`webdav-probe`**, avec sa barre de progression et un bouton « Annuler ». Il vit **au sommet de la zone défilante** : seul l'écran d'import l'épingle, donc si vous avez descendu dans la liste des fichiers, remontez avant de conclure qu'il manque
- [x] Ce type `webdav-probe` la distingue des jobs d'import, qui sont de type `import-remote`. Une fois finie, la sonde passe sous **« Terminés (N) »**, en gardant son libellé de dossier — deux sondes de dossiers différents ne doivent pas rendre deux lignes identiques
- [x] Quelques secondes après le dernier job, le bandeau **disparaît de lui-même**. Il ne doit pas rester au sommet des écrans pour le reste de la session : c'est le journal qui garde la trace durable
- [x] Les lignes de **dossiers** (📁) n'ont **aucun** verdict : la colonne reste vide pour elles
- [x] Un fichier lisible affiche un verdict de la même forme qu'à l'import local : le **mode en gras**, puis son compte d'indexables, puis le **motif** (« marqueurs [n] détectés », « aucun marqueur — un paragraphe par unité »…)

### Le verdict dit la même chose que l'import local

- [x] Choisir un fichier présent **à la fois** sur le serveur et sur le disque. Noter son verdict ShareDocs **mot pour mot**
- [x] Ouvrir l'écran **Importer**, y déposer le même fichier depuis le disque, et comparer : **mode identique, motif identique, compte identique**. C'est la thèse du lot — un désaccord est un échec, même si les deux verdicts semblent plausibles
- [ ] Refaire la comparaison sur un fichier de l'autre famille : si le premier était numéroté `[n]`, en prendre un sans marqueur, et inversement

### Les fichiers que la sonde ne lit pas

- [ ] Un `.pdf`, `.jpg` ou tout autre format non importable affiche **« format non importable »**, en gris neutre — ni alarme ni promesse
- [ ] Un `.xml`/`.tei` ou un `.conllu` affiche **« importé tel quel · le format porte lui-même sa structure »**, en vert : il n'y a rien à déduire, mais il **s'importe**
- [ ] Ces deux-là ne se ressemblent pas à l'écran, et c'est le point : le premier ne s'importe pas du tout, le second oui
- [ ] Le compte du journal les sépare aussi — « N sans déduction » d'un côté, « N non importable(s) » de l'autre

### La navigation et le panier

- [ ] Naviguer vers un sous-dossier : les verdicts de l'ancien dossier ne suivent pas, et une nouvelle sonde part pour le nouveau
- [ ] Cocher un **fichier**, naviguer ailleurs, puis regarder le détail du panier sous la liste : son **mode** y est toujours affiché, et c'est le mode déduit — pas un repli
- [ ] Cocher un **dossier** : le journal sort une seconde ligne `✓ Sonde <ce dossier> — …` alors qu'on ne l'a pas ouvert. C'est voulu — il sera développé à l'import et ses fichiers doivent avoir été lus
- [ ] Décocher puis recocher ce dossier après avoir navigué : une sonde repart (elle avait été oubliée exprès au décochage)
- [ ] Le listing affiché **ne bouge pas** pendant qu'un dossier non affiché est sondé

### Après l'import

- [ ] Importer une petite sélection (2 ou 3 fichiers de modes différents si possible) : le **rapport** liste chaque fichier avec `doc #N · X indexables`
- [ ] Un fichier importé **sans aucune unité indexable** porte `⚠ rien d'indexable` et une pastille **orange**, pas verte
- [ ] Dans ce cas le **résumé du lot** finit par « — ⚠ N sans unité indexable », et la bulle qui l'annonce est **rouge**, pas le ✓ vert habituel
- [ ] Quand tout est indexable, ni le résumé ni la bulle ne mentionnent quoi que ce soit : le bandeau se tait
- [ ] Le journal porte, par lot, une ligne préfixée `⚠` au lieu de `✓` quand ce lot a produit des documents vides

### Le mode déduit est bien celui qui est employé

- [ ] Importer un `.docx` **sans marqueur [n]** dont le verdict annonçait « Paragraphes ». Vérifier dans **Métadonnées** que le document a des unités, et dans le **concordancier** (après réindexation) qu'on le trouve. Avant ce lot, il serait entré en 100 % `structure` et resterait introuvable
- [ ] Vérifier la **provenance** du document importé : son chemin source est l'**URL distante**, pas un chemin temporaire

### Quand la sonde échoue

- [ ] Couper la connexion au serveur (ou saisir une mauvaise URL) après avoir ouvert un dossier, puis y revenir : le journal dit `⚠ Sonde indisponible` ou `⚠ Sonde impossible`, l'écran reste utilisable, et les fichiers restent importables
- [ ] Dans ce cas les verdicts sont absents — la colonne est vide — mais **aucune ligne ne reste bloquée sur « analyse… »**
