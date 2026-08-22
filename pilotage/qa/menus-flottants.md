---
passe: Menus flottants — ancrage et débordement
chantier: —
duree: 15 min
derniere: 2026-08-21
---

# QA — menus flottants (concordancier, Recherche grammaticale, barre du shell)

Passe transversale sur **tous les menus qui s'ouvrent au-dessus du contenu** : dropdowns
de barre d'outils, popovers d'aide, menus de token. Elle ne couvre ni les modales à fond
sombré (`.prep-*-overlay`, `.shell-about-modal`, la boîte de coupe de la matrice), qui
sont plein cadre et hors sujet, ni les tiroirs latéraux (Journal de Prep, panneau de
métadonnées), déjà bornés en `max-width: 9xvw`.

**Ce que la passe valide, et que seuls les yeux valident.** Un menu ancré uniquement en
CSS statique n'a aucune idée de l'endroit où il s'ouvre. Tant que son déclencheur est
loin des bords, il a l'air correct ; c'est en approchant du bord que le défaut se voit.
Aucun test ne couvre le positionnement d'un menu dans ce dépôt, et aucune passe
antérieure n'a regardé ce point.

**Origine des constats.** Audit du 2026-08-21, déclenché par un signalement sur le bouton
Export du concordancier. Mesures faites en rendu réel (Chrome headless sur le vrai
`buildUI()` et sur la CSS agrégée des trois fronts, 323 513 octets), pas par lecture de
la CSS. Trois familles de défauts en sont sorties, dont deux qui ne sont pas des
débordements :

- `.rech-ctx-menu` — le menu du clic droit dans Recherche grammaticale — **n'a aucune
  règle CSS dans tout le dépôt**. Il se calcule donc en `position: static`, ses `left` /
  `top` sont inertes, il n'a ni fond ni bordure ni ombre, et comme il est ajouté à
  `document.body` derrière un `#app` en `min-height: 100vh`, il atterrit sous la ligne de
  flottaison. Mesuré : demandé à y=538, rendu à y=608 — soit exactement la ligne de
  flottaison pour un viewport de 608 px, pas un pixel de visible — et le document passait
  de 608 à 650 px de haut, d'où une barre de défilement sur toute la page du shell.
- `.rech-tok-popover` — le popover du clic gauche — ne se recadre **qu'à droite**
  (`rechercheModule.ts:1688-1691`). Sur un token à 150 px du bas : 107 px hors cadre, et
  comme il est en `fixed`, aucun défilement ne les rattrape.
- Les trois dropdowns de la barre du concordancier débordent latéralement selon le point
  de retour à la ligne de `.toolbar`. Aux tailles que l'application se donne elle-même
  (`tauri.conf.json` : défaut 1200×760, minimum 800×520) : Export perd 177 px à 800,
  89 px à 1440 ; Hist. perd 204 px à 1440 ; l'aide déborde de 86 px **à la taille par
  défaut**, de 203 px à 1000, et se fait rogner en bas à 800×520.

**État au moment de l'écriture : aucune case ne passe, sauf celles de la dernière zone.**
C'est une passe de recette des correctifs, pas un constat d'état sain. Les trois correctifs
ont été posés le 2026-08-21 — la CSS absente de .rech-ctx-menu, un recadrage partagé
(shared/anchorMenu.ts) branché sur les huit points d'ouverture, et le retrait des
scrollX/scrollY sur les deux éléments fixed. Vérifiés en rendu par clic réel sur les
déclencheurs, mais **en harnais headless, pas dans le shell en marche** : toutes les cases
restent à jouer.

**Préalable — les tailles de fenêtre font la passe.** À 1600 px de large et au-delà, tout
paraît correct : jouer la passe sans redimensionner ne prouve rien.

La fenêtre n'est pas pilotable depuis la console — `withGlobalTauri` est désactivé et la
capability n'accorde pas `window:allow-set-size`. Deux moyens, dans cet ordre :

1. **Émulation d'appareil.** Devtools ouverts (clic droit → *Inspecter*, ou panneau
   Diagnostic → 🔍 Inspecteur), puis Ctrl+Shift+M. Un champ permet de taper les dimensions
   au pixel près. C'est le seul moyen exact, et il agit sur ce qui compte réellement — la
   zone d'affichage, pas le cadre de la fenêtre.
2. **À la souris**, en contrôlant le résultat : coller `innerWidth + " × " + innerHeight`
   dans la console après chaque redimensionnement.

**Piège de la mise à l'échelle — il invalide silencieusement toute la passe.** Les devtools
ne redimensionnent que la page, jamais la fenêtre du système : aucun réglage n'agit sur le
cadre. Et si l'écran est mis à l'échelle, ce que Windows appelle « 1200 » n'en fait pas
autant côté page. Mesuré le 2026-08-22 sur le poste de développement, écran à **125 %** :
une fenêtre de 1536 px système ne donne que **1229 px** à la page. Un testeur qui règle la
fenêtre sur 1200 obtient en réalité 960 — une tout autre bande de largeur, où les menus ne
débordent pas. D'où la règle : **ne jamais faire confiance à la taille de la fenêtre, lire
`innerWidth` dans la console.**

**Les chiffres ci-dessous sont ceux de la zone d'affichage** (`innerWidth`/`innerHeight`),
pas de la fenêtre du système. La largeur est la même dans les deux cas ; la hauteur, non :
le shell consomme 82 px en haut (bandeau 44 + barre de sous-onglets 38), si bien qu'une
fenêtre de 520 px ne laisse que 438 px à l'application. Mesuré à cette hauteur-là aussi.

Trois réglages à parcourir : **800** de large (minimum autorisé), **1200** (défaut), et
**1440**. La largeur décide de tout sauf d'un cas ; seul le popover d'aide dépend aussi de
la hauteur, à jouer une fois en fenêtre 800×520. Garder la console ouverte toute la passe.

**Préalable — le corpus.** Recherche grammaticale ne porte que sur les documents annotés.
Prendre une requête CQL qui ramène assez de lignes pour remplir la fenêtre, sinon la
« dernière ligne visible » n'existe pas et les cases de bord bas ne sont pas jouables.

### Recherche grammaticale — clic droit sur un token

**Attention au mot « KWIC », qui désigne deux choses.** Le Concordancier a un mode nommé
*KWIC* — un badge le dit à l'écran — et il affiche du texte courant. Ce n'est pas de lui
qu'il s'agit ici : ses tokens ne portent aucun geste. Cette zone concerne l'onglet **Recherche
grammaticale**, dont l'affichage est lui aussi du KWIC mais **interlinéaire** : chaque token y
est une petite colonne de trois lignes — mot, POS, lemme. C'est à ça qu'on reconnaît le bon
écran. Dans la suite, « rangée de tokens » désigne cette ligne-là.

**Seuls les tokens du pivot réagissent** — les contextes gauche et droite ne portent aucun
geste. On les reconnaît à leur cadre violet, et leur infobulle se termine par « Clic :
rechercher · Clic droit : options ».

Le menu s'ouvre **sous** le token et s'étend vers la **droite** : les deux seuls endroits où
il peut sortir du cadre sont donc le bas et le bord droit de la fenêtre. Et il est en
`position: fixed` — ce qui sort n'est rattrapable par aucun défilement, c'est perdu, pas
seulement caché.

**Comment amener un pivot contre le bord droit**, puisqu'on ne choisit pas librement le token :
le pivot n'est pas centré. La rangée de tokens va `gauche → pivot → droite` et elle est calée à
gauche, en `overflow-x: auto`. La position du pivot dépend donc de la longueur du contexte
gauche, et surtout la ligne **défile horizontalement** quand elle est plus large que le
panneau. Prendre un résultat au contexte fourni, faire défiler sa ligne vers la droite
jusqu'à ce que le groupe pivot arrive contre le bord — et cliquer là.

- [x] Le clic droit sur un token pivot ouvre un menu **visible**, sur fond opaque, avec bordure et ombre
- [x] Le menu s'ouvre au contact du token cliqué, et pas ailleurs dans la page
- [x] « ✏ Modifier ce token dans Prep » ouvre bien Prep sur le document et le segment attendus
- [x] **Bord bas** : faire défiler les résultats jusqu'à ce qu'une ligne touche le bas de la fenêtre, puis clic droit sur un de ses tokens — la dernière entrée du menu reste lisible, rien n'est coupé sous le bord
- [x] **Bord droit** : faire défiler une rangée de tokens pour amener son groupe pivot contre le bord droit, puis clic droit — le menu se décale vers la gauche au lieu de sortir
- [x] Ouvrir puis fermer ce menu ne fait pas apparaître de barre de défilement verticale sur la page du shell
- [x] Échap et le clic à l'extérieur referment le menu

### Recherche grammaticale — clic gauche sur un token

Même géométrie, sur un panneau plus grand — « Nouvelle recherche » et jusqu'à cinq
propositions CQL. Il sort donc du cadre plus tôt que le menu du clic droit : un token qui
passe pour le menu contextuel peut ne pas passer ici.

- [x] **Bord bas** : même geste que ci-dessus, ligne collée au bas de la fenêtre — la dernière proposition reste lisible
- [x] **Bord droit** : même défilement de rangée que ci-dessus, pivot contre le bord droit — le panneau se décale vers la gauche au lieu de sortir
- [x] Après avoir fait défiler la liste des résultats, il s'ouvre toujours au contact du token cliqué
- [x] Chaque entrée lance bien la recherche CQL annoncée par son infobulle

### Concordancier — la barre d'outils

- [x] À **800×520**, le menu ⬇ Export est entièrement lisible, première entrée comprise
- [x] À **1440** de large, le menu ⬇ Export est entièrement lisible
- [x] À **1440** de large, le panneau 🕒 Hist. est entièrement lisible, colonne de gauche comprise
- [x] À **1200×760**, le popover ? (aide) tient entièrement dans la fenêtre
- [x] À **1000** de large, le popover ? tient entièrement dans la fenêtre
- [x] À **800×520**, le popover ? n'est rogné ni à droite ni en bas
- [x] Aucun de ces trois menus ne fait apparaître de barre de défilement horizontale
- [x] Le dropdown Langue du tiroir de filtres reste correct aux trois tailles

### Barre du shell

- [x] À **800** de large, le menu de la zone 🗄 DB s'ouvre entièrement dans la fenêtre
- [x] À **800** de large, le menu ? (Aide & Support) s'ouvre entièrement dans la fenêtre
      *(Correct aujourd'hui, mais sans borne : il tient tant que le groupe d'onglets de
      modules dépasse 200 px. Renommer ou retirer un onglet le casserait — d'où la case.)*

### Non-régression — le menu déjà correct

- [x] À **800×520**, le sélecteur de document du canvas de Prep s'ouvre borné et défilant, sans déborder
      *(C'est le seul menu ancré du dépôt qui soit correctement borné — `max-width`,
      `max-height` et `overflow-y`. Il sert de référence : si le correctif le casse,
      c'est le correctif qui a tort.)*
