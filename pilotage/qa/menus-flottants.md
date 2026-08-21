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
  flottaison. Mesuré : demandé à y=538, rendu à y=653, viewport 608.
- `.rech-tok-popover` — le popover du clic gauche — ne se recadre **qu'à droite**
  (`rechercheModule.ts:1688-1691`). Sur un token à 150 px du bas : 107 px hors cadre, et
  comme il est en `fixed`, aucun défilement ne les rattrape.
- Les trois dropdowns de la barre du concordancier débordent latéralement selon le point
  de retour à la ligne de `.toolbar`. Aux tailles que l'application se donne elle-même
  (`tauri.conf.json` : défaut 1200×760, minimum 800×520) : Export perd 177 px à 800,
  89 px à 1440 ; Hist. perd 204 px à 1440 ; l'aide déborde de 86 px **à la taille par
  défaut**, de 203 px à 1000, et se fait rogner en bas à 800×520.

**État au moment de l'écriture : aucune case ne passe, sauf celles de la dernière zone.**
C'est une passe de recette du correctif à venir, pas un constat d'état sain.

**Préalable — les tailles de fenêtre font la passe.** À 1600 px de large et au-delà, tout
paraît correct : jouer la passe sans redimensionner ne prouve rien. Ouvrir les devtools,
activer la barre d'outils d'appareil (Ctrl+Shift+M) et fixer successivement **800×520**
(minimum autorisé), **1200×760** (défaut) et **1440** de large. Garder la console ouverte
pendant toute la passe.

**Préalable — le corpus.** Recherche grammaticale ne porte que sur les documents annotés.
Prendre une requête CQL qui ramène assez de lignes pour remplir la fenêtre, sinon la
« dernière ligne visible » n'existe pas et les cases de bord bas ne sont pas jouables.

### Recherche grammaticale — clic droit sur un token

- [ ] Le clic droit sur un token pivot ouvre un menu **visible**, sur fond opaque, avec bordure et ombre
- [ ] Le menu s'ouvre au contact du token cliqué, et pas ailleurs dans la page
- [ ] « ✏ Modifier ce token dans Prep » ouvre bien Prep sur le document et le segment attendus
- [ ] Le clic droit sur un token de la **dernière ligne visible** ouvre le menu entièrement dans la fenêtre
- [ ] Le clic droit sur un token du bord **droit** ouvre le menu entièrement dans la fenêtre
- [ ] Ouvrir puis fermer ce menu ne fait pas apparaître de barre de défilement verticale sur la page du shell
- [ ] Échap et le clic à l'extérieur referment le menu

### Recherche grammaticale — clic gauche sur un token

- [ ] Le popover « Nouvelle recherche » s'ouvre entièrement dans la fenêtre sur un token de la **dernière ligne visible**
- [ ] Il s'ouvre entièrement dans la fenêtre sur un token du bord **droit**
- [ ] Après avoir fait défiler la liste des résultats, il s'ouvre toujours au contact du token cliqué
- [ ] Chaque entrée lance bien la recherche CQL annoncée par son infobulle

### Concordancier — la barre d'outils

- [ ] À **800×520**, le menu ⬇ Export est entièrement lisible, première entrée comprise
- [ ] À **1440** de large, le menu ⬇ Export est entièrement lisible
- [ ] À **1440** de large, le panneau 🕒 Hist. est entièrement lisible, colonne de gauche comprise
- [ ] À **1200×760**, le popover ? (aide) tient entièrement dans la fenêtre
- [ ] À **1000** de large, le popover ? tient entièrement dans la fenêtre
- [ ] À **800×520**, le popover ? n'est rogné ni à droite ni en bas
- [ ] Aucun de ces trois menus ne fait apparaître de barre de défilement horizontale
- [ ] Le dropdown Langue du tiroir de filtres reste correct aux trois tailles

### Barre du shell

- [ ] À **800** de large, le menu de la zone 🗄 DB s'ouvre entièrement dans la fenêtre
- [ ] À **800** de large, le menu ? (Aide & Support) s'ouvre entièrement dans la fenêtre
      *(Correct aujourd'hui, mais sans borne : il tient tant que le groupe d'onglets de
      modules dépasse 200 px. Renommer ou retirer un onglet le casserait — d'où la case.)*

### Non-régression — le menu déjà correct

- [ ] À **800×520**, le sélecteur de document du canvas de Prep s'ouvre borné et défilant, sans déborder
      *(C'est le seul menu ancré du dépôt qui soit correctement borné — `max-width`,
      `max-height` et `overflow-y`. Il sert de référence : si le correctif le casse,
      c'est le correctif qui a tort.)*
