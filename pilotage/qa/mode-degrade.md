---
passe: Base illisible — le mode dégradé
chantier: DEG-01
duree: 20 min
derniere: 2026-09-03
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

**Fabriquer une base ABSENTE**, pour la dernière zone — c'est un autre cas que la base
illisible ci-dessus, et le plus dangereux des deux. Dans la console, on ajoute aux récentes
une entrée qui pointe vers un chemin inexistant, sans toucher au moindre fichier :

```js
const k = 'agrafes.db.recent';
const l = JSON.parse(localStorage.getItem(k) ?? '[]');
l.push({ path: l[0].path + '.envolee', label: 'base-envolee.db', last_opened_at: new Date().toISOString() });
localStorage.setItem(k, JSON.stringify(l));
location.reload();
```

La ✕ au bout de sa ligne la retire ensuite des récentes. **Et vérifier le dossier après chaque
essai** : c'est là que le défaut se voit, pas à l'écran. Si un fichier est apparu, il faut
d'abord repasser sur une base saine — le sidecar le tient ouvert — avant de pouvoir l'effacer.

### La bannière

- [x] Ouvrir `pas-une-base.db` par 🗄 → « Ouvrir… » : une bannière ambre apparaît sous le bandeau, avec « Impossible d'initialiser la DB » et le détail de l'erreur
- [x] Le détail est lisible et sélectionnable — pas tronqué à un mot
- [x] Les trois boutons « Réessayer », « Choisir un autre fichier… » et « ✕ » sont lisibles sur le fond ambre
- [x] La bannière reste visible en passant sur Explorer, puis sur Constituer, puis sur l'accueil — elle ne dépend d'aucun écran
- [x] « Réessayer » relance une tentative sur le **même** fichier, avec l'indicateur de démarrage du moteur
- [x] Pendant l'écran « Démarrage du moteur de recherche… », on peut renoncer — le 3 septembre 2026, non : cet écran n'a ni annulation ni progression, et ne part qu'au règlement d'`ensureRunning`, soit jusqu'à 90 s d'extraction plus 45 s de santé sous Windows. Vérifier aussi que son sous-titre ne promet plus « quelques secondes » là où l'infobulle du déclencheur annonce ~30 s

### Le bouton qui promettait autre chose

- [x] « Choisir un autre fichier… » ouvre un sélecteur de fichier **existant**, titré « Ouvrir une base de données SQLite »
- [x] Il n'ouvre PAS un enregistreur titré « Créer une nouvelle base de données AGRAFES » — c'était le défaut, et c'est le point central de cette passe
- [x] Y désigner `corpus_agrafes.WORKCOPY.db` ouvre la base, fait disparaître la bannière, et l'application redevient utilisable

### La trace qui reste

- [x] Revenir sur `pas-une-base.db`, puis écarter la bannière par sa ✕ : le déclencheur 🗄 du bandeau reste en rouge
- [x] Son infobulle dit que le moteur n'a pas pu ouvrir cette base et invite à en choisir une autre
- [x] Même chose en écartant la bannière par **Échap** — le geste qui ferme aussi le menu de la base
- [x] Ouvrir ensuite une base saine : le rouge disparaît du déclencheur
- [x] Le rouge ne se confond pas avec l'ambre de « DB modifiée, cliquer l'onglet actif pour appliquer » — deux états, deux couleurs

### Constituer pendant l'échec

- [x] Aller dans Constituer avec la base illisible active : aucun second bandeau d'erreur ne s'y affiche, celui du shell suffit
- [x] Les écrans se rendent vides sans planter — ni écran blanc, ni erreur dans la console autre que le `console.error` attendu du sidecar
- [x] Le rail de navigation reste utilisable et les onglets se changent sans erreur
- [x] Aucune entrée « Ouvrir… » ni « Créer… » n'est apparue dans Constituer : le choix de la base reste au shell seul

### Le changement interrompu

- [x] Une récente dont le fichier n'existe plus porte bien le badge « introuvable ». Échoué le 2 septembre 2026, passé le 3 : `_checkMruPaths` s'appuyait sur l'`exists()` du plugin `fs`, qui lève hors de `$APP`/`$APPDATA` — donc sur toute base rangée dans les documents, donc sur toutes. Le badge n'a jamais fonctionné pour personne. Il interroge désormais la commande Rust `path_exists`, hors portée FS
- [x] Cliquer cette récente n'échoue pas en silence. Deux issues, les deux sûres : badge posé → un sélecteur de fichier existant, pré-positionné sur l'ancien chemin ; badge pas encore posé (le contrôle est asynchrone, le menu s'ouvre avant sa réponse) → la bannière ambre « Ce fichier n'existe plus à cet emplacement. »
- [x] **La base en cours reste en place.** Après le refus, le déclencheur 🗄 porte toujours le nom de la base d'avant, ses documents sont là, et l'application est utilisable sans rien rouvrir — le chemin absent n'a pas été adopté. C'est le garde de `_switchDb`, ajouté le 3 septembre : celui de `_initDb` arrivait trop tard, la publication du chemin aux modules ayant déjà eu lieu
- [x] Elle ne doit surtout **pas être créée**. Le 2 septembre, le clic a produit une base vide et migrée au chemin absent, puis l'a rendue active. Le 3, avec le seul garde de `_initDb`, elle l'a été **encore** — refus à 08:50:18 et 08:50:22, fichier créé à 08:50:33 par un module, qui démarre son propre sidecar sur le chemin qu'on lui publie. Vérifier le dossier après le clic, pas seulement l'écran : c'est le seul point de cette passe que l'interface ne peut pas prouver
- [x] Même contrôle au **démarrage**, qui est le cas le plus grave parce qu'il ne demande aucun geste : renommer une base hors de l'application pendant qu'elle est fermée, rouvrir, et vérifier qu'on est averti plutôt que posé devant un corpus vide. Arrivé pour de vrai le 3 septembre. Attendu désormais : la bannière, et le déclencheur qui affiche « (aucune) » — le chemin est lâché plutôt que transmis aux modules
- [x] Aucune erreur non rattrapée n'apparaît dans la console lors de ces manipulations (`Uncaught (in promise)`)
