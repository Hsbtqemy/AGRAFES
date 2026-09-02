---
passe: Retrait de la barre Constituer
chantier: CHR-01
duree: 30 min
derniere: 2026-09-02
---

# QA — le chrome de Constituer, après le retrait de sa barre

Ce que la passe vérifie : que le retrait de la barre n'a rien emporté au passage. Les gestes
qu'elle portait sont soit devenus inutiles (le menu de la base les fait mieux), soit remontés
d'un cran (Fiche corpus, Journal), soit relogés ailleurs (le garde de sortie d'onglet, le
bandeau d'erreur). Chacun se vérifie ici.

**Lancer** : `npm --prefix tauri-shell run tauri -- dev`. Prep en autonome ne joint pas le
sidecar — `sidecar_fetch_loopback` n'existe que dans le shell — donc la passe ne se joue que
dans l'application unifiée. Ouvrir une base qui a des documents ; `corpus_agrafes.WORKCOPY.db`
convient.

**La sonde des barres de défilement**, à coller dans la console pour l'unique bloc de la zone
« Défilement » — elle rend la liste des éléments qui défilent *réellement*, ce que l'œil ne
départage pas :

```js
[...document.querySelectorAll('*')]
  .filter(e => e.scrollHeight > e.clientHeight + 1
            && /auto|scroll/.test(getComputedStyle(e).overflowY))
  .map(e => `${e.tagName}.${e.className}`.slice(0, 90))
```

Attendu : **rien d'autre que des défileurs volontairement bornés**. Le plus souvent
`DIV.prep-main`, auquel s'ajoutent les bornés de l'écran — `DIV.prep-meta-doc-list-wrap` sur
Documents (`max-height: 440px`), `DIV.prep-acts-hub-doc-list` sur Actions. **Importer fait
exception** : `prep-main` n'y défile pas du tout, une règle `:has(.prep-import-screen.active)`
lui déléguant la colonne, et l'écran rend ses trois défileurs à lui.

Ce qui ne doit PAS apparaître, c'est `DIV.con-subcontent` : il est le filet du shell, et sa
présence signifie que la chaîne de hauteur ne se résout pas au-dessus de `.prep-main`. C'est
le seul attendu qui vaille pour les quatre écrans.

Cet attendu a été écrit faux — « une seule entrée » — puis corrigé par la mesure du
1er septembre, qui a justement trouvé `con-subcontent` en train de défiler : le wrapper de
prep héritait d'un `min-height: 100vh` de la règle `#app` du shell, jamais annulé, et faisait
794px dans un parent de 706. Corrigé dans `constituerModule`. La passe vérifie donc désormais
que le correctif tient.

**Le bandeau d'erreur ne se teste plus ici.** Ce paragraphe disait qu'on ne pouvait pas le
provoquer ; DEG-01 l'a rendu faux le jour même, et dans les deux sens. Celui de prep était un
doublon inatteignable : il a été supprimé, pas réparé. Celui du shell — `_showInitError`,
« Impossible d'initialiser la DB » — est parfaitement atteignable, couvre les quatre modes, et
laisse désormais une trace sur le déclencheur de base une fois écarté.

Tout cela se vérifie dans `qa/mode-degrade.md`, écrite pour ça. Ne pas le refaire ici.

**Ne pas tester** : la Fiche corpus elle-même (son contenu, sa sauvegarde) — elle n'a pas
changé, seul son point d'entrée a bougé.

### Le bandeau du shell

- [x] En mode Constituer, le bandeau du haut fait bien 44px et le contenu de prep commence juste dessous, sans bande vide ni recouvrement
- [x] L'icône 📋 est présente à droite des onglets, entre « Constituer » et ⌨
- [x] En mode Explorer, l'icône 📋 a disparu — pas grisée, absente
- [x] Revenir sur Constituer la fait réapparaître, et elle n'est pas en état « enfoncé »
- [x] Depuis l'accueil (clic sur « AGRAFES »), l'icône 📋 est absente aussi

### Le menu de la base

- [x] Le déclencheur 🗄 en haut à droite ouvre un menu dont la première entrée est « 📄 Fiche corpus… », suivie d'un trait, puis « Ouvrir… », « Créer… », puis « Récents »
- [x] « 📄 Fiche corpus… » ouvre la modale, centrée par-dessus la page et non en bas de celle-ci
- [x] Cliquer hors de la modale la ferme
- [x] Depuis Explorer, « 📄 Fiche corpus… » bascule d'abord sur Constituer, puis ouvre la modale — un seul clic, sans étape intermédiaire
- [x] Base illisible (`pas-une-base.db`, la fixture de `qa/mode-degrade.md`) : « 📄 Fiche corpus… » n'ouvre **aucune modale** et affiche, en bas à droite pendant trois secondes, « Fiche corpus indisponible : le moteur n'a pas pu la lire pour cette base. » Le détail technique reste dans la console, où le client sidecar l'écrit déjà. Attendu corrigé le 2 septembre : il annonçait le garde sur `_conn` nul, qui ne se déclenche PAS ici — prep obtient bien une connexion (le sidecar répond `/health`), c'est `/corpus/info` qui échoue. Le message, lui, était une URL de boucle locale ; c'est ce que la passe a corrigé
- [x] Vraiment aucune base : il n'existe **aucun geste pour fermer une base** — l'état ne s'atteint qu'au tout premier lancement, ou par `localStorage.removeItem('agrafes.lastDbPath')` dans la console puis rechargement. L'entrée affiche alors « Ouvrez ou créez une base pour éditer sa fiche. » — l'autre garde, celui du shell, sur `_currentDbPath` nul

### Le Journal

- [x] L'icône 📋 ouvre le tiroir sur la droite, et l'icône passe en état enfoncé
- [x] Le tiroir commence **sous** le bandeau du shell : aucun contenu ne passe derrière le bandeau, et il n'y a pas de bande vide entre les deux
- [x] Un second clic sur 📋 le referme, et l'icône se dépeint
- [x] Après fermeture par l'icône, la touche Tab poursuit depuis le bandeau et ne repart pas du haut de la page
- [x] Fermer par la ✕ du tiroir marche aussi — le retour de focus, lui, est un point ouvert de QAS-01, ne pas le compter ici
- [x] Fermer par la ✕ **dépeint l'icône** et rend le focus sur elle : la ligne au-dessus tenait ce point pour ouvert, il ne l'est plus. C'est le défaut trouvé en jouant cette passe le 2 septembre 2026 — le tiroir se fermait, l'icône restait allumée, et le clic suivant rouvrait ce qu'elle semblait proposer de fermer
- [x] Lancer un import : les lignes s'écrivent bien dans le tiroir, et il défile jusqu'en bas à l'ouverture
- [x] Basculer sur Explorer pendant que le tiroir est ouvert, puis revenir : le tiroir est refermé et l'icône n'est pas enfoncée
- [x] Tiroir ouvert, changer de base par 🗄 → « Ouvrir… », puis « Rafraîchir maintenant » : le tiroir se referme **et** l'icône s'éteint. C'est la seconde porte du même défaut, trouvée à la passe adverse du 2 septembre — le module est remonté sans changer de mode, et le dépeint ne s'y déclenchait pas

### Les trois réancrages

- [x] Modifier une métadonnée dans Documents sans enregistrer, puis cliquer un autre onglet du rail : la question « modifications non enregistrées » apparaît
- [x] Elle s'affiche en haut à droite de la zone de contenu, lisible, sans recouvrir un bouton dont on a besoin pour répondre
- [x] « Continuer » quitte l'onglet, « Annuler » y reste — les deux boutons répondent
- [x] La même question sur une fenêtre étroite (~900px) reste entièrement lisible et ne pousse rien d'autre
- [x] Aucune trace de l'ancienne barre : ni titre « Constituer », ni chemin de base, ni boutons en pastille en haut du contenu

### Défilement et hauteurs

- [x] La sonde de la console (voir en tête) ne fait PAS apparaître `DIV.con-subcontent` sur l'écran Documents
- [x] Idem sur Importer, sur Actions (vue hub) et sur Exporter — noter les écrans où `con-subcontent` reparaît
- [x] Relancer la sonde sur Importer **avec des fichiers dans la file** : la hauteur de cet écran dépend de cette liste, et un écran vide ne prouve rien. Attendu mesuré le 2 septembre — `DIV.imp-scroll`, `DIV.imp-file-list`, et `DIV.imp-conllu-table-wrap` si un aperçu est ouvert : trois défileurs bornés exprès (`flex:1`, `max-height: min(42vh,360px)`, `min(32vh,300px)`). `DIV.prep-main` **ne défile pas** ici, et c'est voulu ; seule compte l'absence de `con-subcontent`
- [x] Le rail de navigation de gauche reste fixe quand le contenu défile ; il ne défile pas avec lui. C'est voulu, et c'est une réparation : le rail était en `100vh`, débordait son conteneur borné et remontait hors champ — au bas d'une longue liste, « Importer » devenait inatteignable. `prep-vnext.css:61` porte l'explication. Un rail qui défilerait ne rendrait d'ailleurs aucun pixel au contenu, les deux étant côte à côte
- [x] Le bas du dernier élément de la liste des documents est atteignable — rien n'est coupé sous la fenêtre
- [x] Sur une fenêtre réduite en hauteur (~600px), le contenu reste atteignable et le rail ne se tronque pas

### Ce qui a disparu

- [x] Le titre du corpus n'est plus affiché nulle part hors de la Fiche corpus — le confirmer, et dire si le nom de fichier seul suffit à l'usage
- [x] Aucun bouton ne propose plus d'« ouvrir dans le Shell » depuis Constituer
- [x] Aucune entrée « Presets » nulle part : ni dans Constituer, ni dans le bandeau du shell
- [x] Aucun bandeau d'erreur propre à prep ne subsiste en haut du contenu — celui du shell est le seul, et se vérifie dans `qa/mode-degrade.md`
