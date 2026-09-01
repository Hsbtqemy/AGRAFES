---
passe: Retrait de la barre Constituer
chantier: CHR-01
duree: 15 min
derniere:
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

Attendu : `DIV.prep-main`, **et rien d'autre que des défileurs volontairement bornés** —
sur Documents, `DIV.prep-meta-doc-list-wrap` s'y ajoute légitimement (`max-height: 440px`).
Ce qui ne doit PAS apparaître, c'est `DIV.con-subcontent` : il est le filet du shell, et sa
présence signifie que la chaîne de hauteur ne se résout pas au-dessus de `.prep-main`.

Cet attendu a été écrit faux — « une seule entrée » — puis corrigé par la mesure du
1er septembre, qui a justement trouvé `con-subcontent` en train de défiler : le wrapper de
prep héritait d'un `min-height: 100vh` de la règle `#app` du shell, jamais annulé, et faisait
794px dans un parent de 706. Corrigé dans `constituerModule`. La passe vérifie donc désormais
que le correctif tient.

**Provoquer le bandeau d'erreur** : on ne peut pas. C'est un constat du chantier, pas un
oubli de la passe — le bandeau « Impossible d'initialiser la DB » n'a plus d'entrée depuis
que « Créer… » a quitté prep, et le vrai chemin d'échec (`_onDbChanged`) ne fait qu'un
`console.error`. La zone correspondante ne demande donc que ce qui est observable : que le
mode dégradé se voie, d'une manière ou d'une autre.

**Ne pas tester** : la Fiche corpus elle-même (son contenu, sa sauvegarde) — elle n'a pas
changé, seul son point d'entrée a bougé.

### Le bandeau du shell

- [ ] En mode Constituer, le bandeau du haut fait bien 44px et le contenu de prep commence juste dessous, sans bande vide ni recouvrement
- [ ] L'icône 📋 est présente à droite des onglets, entre « Constituer » et ⌨
- [ ] En mode Explorer, l'icône 📋 a disparu — pas grisée, absente
- [ ] Revenir sur Constituer la fait réapparaître, et elle n'est pas en état « enfoncé »
- [ ] Depuis l'accueil (clic sur « AGRAFES »), l'icône 📋 est absente aussi

### Le menu de la base

- [ ] Le déclencheur 🗄 en haut à droite ouvre un menu dont la première entrée est « 📄 Fiche corpus… », suivie d'un trait, puis « Ouvrir… », « Créer… », puis « Récents »
- [ ] « 📄 Fiche corpus… » ouvre la modale, centrée par-dessus la page et non en bas de celle-ci
- [ ] Cliquer hors de la modale la ferme
- [ ] Depuis Explorer, « 📄 Fiche corpus… » bascule d'abord sur Constituer, puis ouvre la modale — un seul clic, sans étape intermédiaire
- [ ] Sans base ouverte, l'entrée affiche un message plutôt que d'ouvrir une modale vide

### Le Journal

- [ ] L'icône 📋 ouvre le tiroir sur la droite, et l'icône passe en état enfoncé
- [ ] Le tiroir commence **sous** le bandeau du shell : aucun contenu ne passe derrière le bandeau, et il n'y a pas de bande vide entre les deux
- [ ] Un second clic sur 📋 le referme, et l'icône se dépeint
- [ ] Après fermeture par l'icône, la touche Tab poursuit depuis le bandeau et ne repart pas du haut de la page
- [ ] Fermer par la ✕ du tiroir marche aussi — le retour de focus, lui, est un point ouvert de QAS-01, ne pas le compter ici
- [ ] Lancer un import : les lignes s'écrivent bien dans le tiroir, et il défile jusqu'en bas à l'ouverture
- [ ] Basculer sur Explorer pendant que le tiroir est ouvert, puis revenir : le tiroir est refermé et l'icône n'est pas enfoncée

### Les trois réancrages

- [ ] Modifier une métadonnée dans Documents sans enregistrer, puis cliquer un autre onglet du rail : la question « modifications non enregistrées » apparaît
- [ ] Elle s'affiche en haut à droite de la zone de contenu, lisible, sans recouvrir un bouton dont on a besoin pour répondre
- [ ] « Continuer » quitte l'onglet, « Annuler » y reste — les deux boutons répondent
- [ ] La même question sur une fenêtre étroite (~900px) reste entièrement lisible et ne pousse rien d'autre
- [ ] Aucune trace de l'ancienne barre : ni titre « Constituer », ni chemin de base, ni boutons en pastille en haut du contenu

### Défilement et hauteurs

- [ ] La sonde de la console (voir en tête) ne fait PAS apparaître `DIV.con-subcontent` sur l'écran Documents
- [ ] Idem sur Importer, sur Actions (vue hub) et sur Exporter — noter les écrans où `con-subcontent` reparaît
- [ ] Le rail de navigation de gauche reste fixe quand le contenu défile ; il ne défile pas avec lui
- [ ] Le bas du dernier élément de la liste des documents est atteignable — rien n'est coupé sous la fenêtre
- [ ] Sur une fenêtre réduite en hauteur (~600px), le contenu reste atteignable et le rail ne se tronque pas

### Ce qui a disparu

- [ ] Le titre du corpus n'est plus affiché nulle part hors de la Fiche corpus — le confirmer, et dire si le nom de fichier seul suffit à l'usage
- [ ] Aucun bouton ne propose plus d'« ouvrir dans le Shell » depuis Constituer
- [ ] Aucune entrée « Presets » nulle part : ni dans Constituer, ni dans le bandeau du shell
- [ ] Le mode dégradé se voit : ouvrir une base pendant que le sidecar est arrêté, et dire ce que l'écran montre — un message, des listes vides, ou rien du tout
