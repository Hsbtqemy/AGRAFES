---
chantier: NAV-01
statut: interrompu
---

# NAV-01 — aucun retour en arrière, et deux raisons empilées

**Arrêté sur** — lot 1 livré sur `refonte` et validé en QA (18/18) : le geste souris marche dans les deux sens, à travers les quatre niveaux. Restent les gestes du pad et trois arbitrages, 31 août 2026.

## Reste

- [x] Sonde du lot 0 — le bouton latéral émet `button=3`/`button=4` au DOM **et** WebView2 navigue nativement ; le glissé du pad n'émet que des `wheel`, sans jamais naviguer
- [x] Le descripteur et la pile : `tauri-prep/src/lib/navHistory.ts`, un enregistrement plat `{mode, tab, subView, layer}` et des niveaux qui s'enregistrent avec leur `read`/`apply` — **sans** `docId`, décidé au cadrage du lot
- [x] Les quatre points d'accroche alimentent l'historique par `pushState` — une ligne chacun, aucun des 56 sites d'appel touché
- [x] `popstate` applique la destination du plus englobant au plus fin, avec dédoublonnage et un drapeau qui interdit à une restauration de se re-pousser elle-même
- [x] `preventDefault()` sur le `pointerdown` supprime bien la navigation native — deux appuis mesurés, aucun `popstate` derrière, alors qu'il tombait à 6 ms sans le blocage
- [x] Le refus par le veto sur le chemin souris : `setPendingGuard` interroge `hasPendingChanges`, annule le `pointerdown` et pose la question avant de naviguer
- [ ] Traiter le refus sur les autres chemins (clavier, pad rallumé) par la re-poussée : là, `popstate` ne s'annule pas, et un retour refusé oblige à re-pousser l'état qu'on vient de quitter — inutile tant que la souris est le seul geste
- [ ] Le garde ne couvre que le GESTE : cliquer un onglet du bandeau shell pendant une édition démonte toujours le module sans demander (`_setMode` n'a aucun garde). Défaut préexistant, révélé par ce chantier — décider s'il entre dans son périmètre
- [ ] Glissé du pad sous Windows : rallumer `SetIsSwipeNavigationEnabled(true)` par `with_webview()` — un appel COM, et surtout **pas** un détecteur de geste en JS (voir la queue d'inertie mesurée)
- [ ] Glissé du pad sous macOS : `setAllowsBackForwardNavigationGestures(true)` par `objc2`, sachant que ce code ne sera compilé par aucune CI avant un tag `v*`
- [ ] Décider si un retour clavier accompagne le geste : `_installKeyboardShortcuts` (`shell.ts:3622`) tient déjà `Ctrl+1/2/3/0` pour sauter entre modes, et tout ajout doit apparaître dans le panneau `Ctrl+/`
- [x] Écrire la passe de QA du geste — `qa/retour-arriere-geste.md`
- [x] **La jouer** — 18 cases sur 18 dans le shell en marche. Elle n'a rien trouvé sur le geste lui-même, mais deux défauts **préexistants** en chemin : le bandeau de sortie d'onglet qui décalait la topbar, et le Job Center qui filait hors de l'écran au défilement
- [x] Les tests de la pile : 20 cas dans `navHistory.test.ts` (ordre d'application, dédoublonnage, niveau qui refuse, entrée étrangère, garde, cycle de vie)

## QA

- qa/sonde-geste-retour.md
- qa/retour-arriere-geste.md

La sonde du lot 0 est jouée et close : une mesure, pas une vérification — c'est elle qui a
fait tomber le chiffrage de 2,5-3,5 j à 2-3 j pour la souris. La seconde passe vérifie le
geste lui-même et n'a pas encore été jouée ; son point le plus important n'est pas que le
retour marche, c'est qu'un coup de pouce parasite pendant une saisie ne détruise rien.

## Contexte

**Deux raisons empilées, et l'ordre compte.** La première : le geste est éteint à la
source. wry porte bien le réglage mais le laisse à `back_forward_navigation_gestures:
false` en dur (`wry-0.54.2/src/lib.rs:827`), ce qui donne
`setAllowsBackForwardNavigationGestures(false)` sur WKWebView (`wkwebview/mod.rs:498`) et
`SetIsSwipeNavigationEnabled(false)` sur WebView2 (`webview2/mod.rs:590`). Et Tauri ne le
rallume pas : `tauri-runtime-wry-2.10.0` et `tauri-utils-2.8.2` — le schéma de
`tauri.conf.json` — n'y font **aucune référence**, zéro occurrence au grep. Il n'existe donc
ni clé de configuration ni option de builder ; la seule porte est l'échappatoire
`with_webview()` (`tauri-2.10.2/src/webview/mod.rs:1650`), qui rend un
`ICoreWebView2Controller` sur Windows et un pointeur WKWebView brut sur macOS.

La seconde raison survit à la première : **même rallumé, le geste ne trouverait rien**. Il
n'y a pas un seul `pushState` dans les trois fronts, donc l'historique du webview a une
entrée unique. C'est pour ça que le chantier n'est pas « activer un réglage » : il faut
d'abord qu'il y ait quelque chose derrière.

**Ce que la sonde a mesuré**, le 31 août 2026, sur le shell en marche (`qa/sonde-geste-retour.md`) :

- La première raison **ne valait que pour le pad**. Le bouton de souris emprunte un autre chemin et n'a jamais été éteint : il émet `pointerdown`/`mousedown`/`mouseup`/`auxclick` avec `button=3` (précédent) et `button=4` (suivant), **et** WebView2 navigue nativement dans la foulée — `popstate` arrive environ 6 ms après l'`auxclick`.
- Les deux sens marchent. Le bouton « suivant » remonte la pile aussi bien que le « précédent » : l'avance est gratuite, elle n'était pas chiffrée.
- `pushState` fonctionne sous le protocole Tauri (`history.length` passe à 4). L'hypothèse du lot 1 est levée.
- **On ne peut pas sortir de l'application par en dessous** : l'appui qui atteint l'entrée initiale (`state=null`) ne déclenche aucun `beforeunload`. Le pire cas d'un appui parasite est donc un saut d'écran, jamais une sortie.
- **Le veto existe** : avec `preventDefault()` sur le `pointerdown`, l'appui ne navigue plus — deux essais, aucun `popstate` derrière, quand il tombait à 6 ms sans blocage. On peut donc refuser un retour **avant** qu'il ait lieu, au lieu de le défaire après coup.
- Effet de bord à connaître : annuler le `pointerdown` supprime les événements souris de compatibilité — `mousedown` et `mouseup` cessent d'être émis, seul l'`auxclick` survit. C'est le comportement spécifié des Pointer Events. Sans conséquence ici (l'application n'écoute pas le bouton 3), mais c'est le genre de détail qui fait rater un test.
- Le pad, lui, est bien mort : trois glissés horizontaux, **zéro `popstate`**. Il n'émet que des `wheel` en `deltaX` pur (`deltaY=0`).
- Et il ne faut pas essayer de le rattraper en JS : chaque glissé traîne une **queue d'inertie de 1,5 à 2 s**, qui décroît d'environ 130 à 1 sans discontinuité. Un seuil naïf sur `deltaX` déclencherait plusieurs retours pour un seul geste. Pire, ces mêmes `wheel` servent au défilement horizontal légitime — la matrice d'alignement (`app.css:2266`), la bande de tokens de l'annotation (`annotation.css:96`) — qu'un détecteur confondrait avec un geste de retour.

**Ce qui rend le chantier petit.** Les 56 sites d'appel de navigation (26 pour `_setMode`
du shell, 9 pour `_switchTab`, 21 pour les sous-vues et couches) passent tous par quatre
fonctions, une par niveau :

| Niveau | Point d'accroche unique | Destination |
|---|---|---|
| Shell | `_setMode()` — `shell.ts:2625` | `home` / `explorer` / `constituer` / `publish` |
| Prep | `_switchTab()` — `app.ts:505` | onglet |
| Actions | `_switchSubViewDOM()` — `ActionsScreen.ts:243` | `hub` / `texte` / `alignement` / `matrice` |
| Canvas | `_setMode()` — `TextCanvasView.ts:380` | couche + `_docId` |

On instrumente quatre fonctions, pas cinquante-six appels. Attention au troisième :
c'est bien `_switchSubViewDOM` qu'il faut accrocher et non la publique `setSubView`, que
certains chemins court-circuitent (`onOpenRevisionFine` appelle directement le DOM). Et
trois des cinq champs du descripteur sont **déjà** sérialisés en `localStorage` — le mode
shell par `_persist()`, la sous-vue par `LS_ACTIVE_SUB`.

**Le chiffrage, après la sonde.**

| Lot | Contenu | Coût |
|---|---|---|
| 0 — sonde | Faite le 31 août : elle a supprimé un lot et en a déplacé un autre | — |
| 1 — la pile | Descripteur, `pushState` sur les quatre accroches, `popstate`, dédoublonnage | 1,5 à 2 j |
| 2a — bouton souris | **Supprimé** : le webview le fait déjà, la pile du lot 1 suffit | 0 j |
| 2b — pad Windows | `SetIsSwipeNavigationEnabled(true)` par `with_webview()` : un appel COM | 0,5 j |
| 2c — pad macOS | `setAllowsBackForwardNavigationGestures(true)` par `objc2` | 0,5 à 1 j |
| 3 — gardes et tests | Le refus, le garde manquant du shell, les tests vitest | 0,5 à 1 j |

Soit **2 à 3 j pour la souris seule** — le geste que la sonde rend gratuit — **2,5 à 3,5 j
en ajoutant le pad sous Windows**, **3 à 4,5 j avec le pad sur les deux plateformes**.

**Coût hors front, tracé.** Zéro moteur, zéro endpoint, zéro migration, zéro artefact de
contrat : rien ne touche le sidecar. Les lots 2b et 2c touchent `Cargo.toml`, et c'est là
que les deux plateformes divergent : `ci.yml:202` fait `cargo check` sur `ubuntu` **et**
`windows`, donc le lot 2b est couvert ; le 2c ne l'est pas, `macos-sign-notarize` ne se
déclenchant que sur `workflow_dispatch` ou un tag `v*`. Du code
`#[cfg(target_os = "macos")]` ne serait compilé par rien pendant tout le développement.

**Ce qui existe déjà, et qu'il ne faut pas confondre avec un retour.** Des sauts directs au
clavier (`Ctrl+1/2/3/0`), et quatre retours locaux codés en dur, chacun vers une cible fixe
plutôt que vers l'écran précédent : le fil d'Ariane ShareDocs, les étapes du wizard de
publication, le « retour Alignement » d'`ExportsScreen` qui ramène toujours à la matrice, et
la navigation entre unités du panneau méta. Aucun n'est un historique.

**Là où le manque se sent le plus** — les sauts profonds : matrice vers la couche
Segmentation d'un document sur une unité précise (`focusSegmentationOnUnit`), panneau
famille vers la Révision fine scopée, Documents vers la couche Rôles. Ces chemins mènent en
un clic à un point précis d'un autre écran, et il n'existe aucun geste pour revenir à la
cellule dont on est parti.

Pas de champ `audit:` : aucun audit ne porte ce chantier, la lecture des sources de wry et
de Tauri, plus la sonde du 31 août, en sont la seule source.
