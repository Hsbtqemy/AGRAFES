---
passe: Base illisible — le mode dégradé
chantier: DEG-01
duree: 10 min
derniere:
---

# QA — ce que l'application montre quand une base ne s'ouvre pas

Ce que la passe vérifie : qu'un échec d'ouverture se voit, se comprenne, et laisse une trace
une fois le message écarté. Le défaut d'origine n'était pas l'absence de message — la
bannière du shell existait — mais qu'un Échap réflexe l'emportait sans rien laisser derrière,
et qu'un de ses boutons faisait autre chose que ce qu'il promettait.

**Lancer** : `npm --prefix tauri-shell run tauri -- dev`.

**Fabriquer une base illisible**, à faire une fois avant de commencer :

```
echo "ceci n'est pas une base" > %USERPROFILE%\Documents\IGE\pas-une-base.db
```

Le fichier existe, porte la bonne extension, et le moteur échouera à l'ouvrir — c'est le cas
qu'on veut, et non un fichier absent, que le sélecteur refuserait avant même d'essayer.

**Garder une base saine sous la main** pour les points de retour : `corpus_agrafes.WORKCOPY.db`
dans le même dossier.

**Ce qui ne se teste pas ici** : le message d'erreur exact du moteur, qui dépend de la nature
du fichier. Seule compte sa présence, et qu'il soit lisible.

### La bannière

- [ ] Ouvrir `pas-une-base.db` par 🗄 → « Ouvrir… » : une bannière ambre apparaît sous le bandeau, avec « Impossible d'initialiser la DB » et le détail de l'erreur
- [ ] Le détail est lisible et sélectionnable — pas tronqué à un mot
- [ ] Les trois boutons « Réessayer », « Choisir un autre fichier… » et « ✕ » sont lisibles sur le fond ambre
- [ ] La bannière reste visible en passant sur Explorer, puis sur Constituer, puis sur l'accueil — elle ne dépend d'aucun écran
- [ ] « Réessayer » relance une tentative sur le **même** fichier, avec l'indicateur de démarrage du moteur

### Le bouton qui promettait autre chose

- [ ] « Choisir un autre fichier… » ouvre un sélecteur de fichier **existant**, titré « Ouvrir une base de données SQLite »
- [ ] Il n'ouvre PAS un enregistreur titré « Créer une nouvelle base de données AGRAFES » — c'était le défaut, et c'est le point central de cette passe
- [ ] Y désigner `corpus_agrafes.WORKCOPY.db` ouvre la base, fait disparaître la bannière, et l'application redevient utilisable

### La trace qui reste

- [ ] Revenir sur `pas-une-base.db`, puis écarter la bannière par sa ✕ : le déclencheur 🗄 du bandeau reste en rouge
- [ ] Son infobulle dit que le moteur n'a pas pu ouvrir cette base et invite à en choisir une autre
- [ ] Même chose en écartant la bannière par **Échap** — le geste qui ferme aussi le menu de la base
- [ ] Ouvrir ensuite une base saine : le rouge disparaît du déclencheur
- [ ] Le rouge ne se confond pas avec l'ambre de « DB modifiée, cliquer l'onglet actif pour appliquer » — deux états, deux couleurs

### Constituer pendant l'échec

- [ ] Aller dans Constituer avec la base illisible active : aucun second bandeau d'erreur ne s'y affiche, celui du shell suffit
- [ ] Les écrans se rendent vides sans planter — ni écran blanc, ni erreur dans la console autre que le `console.error` attendu du sidecar
- [ ] Le rail de navigation reste utilisable et les onglets se changent sans erreur
- [ ] Aucune entrée « Ouvrir… » ni « Créer… » n'est apparue dans Constituer : le choix de la base reste au shell seul

### Le changement interrompu

- [ ] Cliquer une base **récente** marquée « introuvable » propose de la re-désigner, et n'échoue pas en silence
- [ ] Aucune erreur non rattrapée n'apparaît dans la console lors de ces manipulations (`Uncaught (in promise)`)
