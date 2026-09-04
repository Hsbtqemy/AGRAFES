---
passe: Identité de la base — titre, fichier, copies
chantier: CHR-01
duree: 15 min
derniere: 2026-09-04
---

# QA — reconnaître la base ouverte, et ne pas confondre deux copies

Ce que la passe vérifie tient en une phrase : le **titre de corpus** est une étiquette, le
**nom de fichier** est l'identité. Dupliquer un fichier de base recopie le titre à
l'identique — deux copies portent donc le même. Le nom de fichier ne doit alors jamais
céder sa place, à aucun des endroits où l'on peut se tromper de base.

Elle couvre aussi les deux lots vus par personne : le raccourci « Fiche corpus » dans
Documents, et la purge de 25 classes CSS mortes.

**Lancer** : `npm --prefix tauri-shell run tauri -- dev`. Le premier démarrage du moteur
prend ~20 s même machine au repos (extraction du binaire *onefile*), et bien plus si la
machine travaille — ne pas conclure à un blocage avant la temporisation de 90 s.

**Redémarrer complètement `tauri dev` si une session tournait déjà.** Le point du titre de
fenêtre repose sur une permission ajoutée à `src-tauri/capabilities/default.json`, et les
capacités sont compilées dans le binaire Rust : le rechargement à chaud du webview ne la
prend pas. Sans ce redémarrage, ce point échoue pour une raison qui n'a rien à voir avec lui.

**Les bases utilisées, et pourquoi celles-là** (mesuré le 4 septembre 2026) :

| Base | Titre en base | Rôle dans la passe |
|---|---|---|
| `corpus_agrafes.WORKCOPY.db` | `Agrafes workcopy` | le cas avec titre |
| `nouveau_corpus2.db` | *(vide)* | le cas sans titre — 200 Ko, ouverture rapide |
| `pas-une-base.db` | — | échec d'ouverture (fichier de 31 octets) |

Elles sont toutes dans `%USERPROFILE%\Documents\IGE`.

**Les deux blocs qui suivent se tapent dans un terminal PowerShell** — pas dans la console
de l'application, qui n'attend que du JavaScript et répondra `Uncaught SyntaxError`.

Si `pas-une-base.db` n'existe plus :

```powershell
Set-Content -Path "$env:USERPROFILE\Documents\IGE\pas-une-base.db" `
            -Value "ceci n'est pas une base" -Encoding utf8
```

**Préparer le cas des homonymes**, à faire une fois avant la zone « Récentes » — sans lui,
ces deux points ne sont pas jouables, aucune base de la machine ne portant aujourd'hui le
même nom qu'une autre :

```powershell
$ige = "$env:USERPROFILE\Documents\IGE"
New-Item -ItemType Directory -Force "$ige\copie" | Out-Null
Copy-Item "$ige\nouveau_corpus2.db" -Destination "$ige\copie\"
```

Le fichier copié doit faire les mêmes 200 704 octets que l'original.

**Écrire dans une fiche** : les points qui enregistrent un titre se jouent sur
`nouveau_corpus2.db`, jamais sur WORKCOPY — inutile de défaire un titre qu'on vient de poser
sur la base de travail.

**Pour la dernière zone** : les 25 classes CSS retirées venaient de deux écrans supprimés
(`curate-*` de CurationView, `prep-seg-*` de SegmentationView). Le risque n'est pas qu'ils
cassent — ils n'existent plus — mais qu'un sélecteur voisin ait été classé mort à tort. Les
surfaces à regarder sont donc celles qui portaient ces familles, pas les écrans disparus.

### Le déclencheur de base, avec titre

- [x] Sur `corpus_agrafes.WORKCOPY.db`, le déclencheur en haut à droite montre **deux
      lignes** : `Agrafes workcopy` au-dessus, `corpus_agrafes.WORKCOPY.db` en dessous, plus
      petit et plus pâle
- [x] Les deux lignes tiennent dans la hauteur du bandeau (44 px) : rien n'est rogné en haut
      ou en bas, et le bandeau ne s'épaissit pas
- [x] Le survol donne une infobulle en deux lignes : le titre, puis le **chemin complet**
- [x] Changer d'onglet (Constituer ↔ Explorer ↔ Accueil) ne fait pas disparaître le titre

### Le déclencheur sans titre, et pendant les transitions

- [x] Ouvrir `nouveau_corpus2.db` : le déclencheur revient à **une seule ligne**, au nom de
      fichier — même taille et même position qu'avant ce lot, pas une ligne vide au-dessus
- [x] Pendant l'ouverture, le déclencheur affiche « Démarrage du moteur… » **sans** garder
      au-dessus le titre de la base qu'on vient de quitter
- [x] Revenir sur WORKCOPY : le titre réapparaît

### Une base qui ne s'ouvre pas

- [x] Ouvrir `pas-une-base.db` : le déclencheur passe au rouge et n'affiche **que le nom de
      fichier**. Pas de ligne de titre — un titre n'est jamais lu pour une base qui échoue,
      et surtout pas celui de la base précédente
- [x] La bannière d'échec s'affiche comme dans `qa/mode-degrade.md` ; l'écarter laisse le
      déclencheur rouge

### La fiche corpus

- [x] Sur WORKCOPY, ouvrir la fiche par le menu 🗄 : son en-tête porte
      `corpus_agrafes.WORKCOPY.db` à droite de « 📄 Fiche corpus », avant « ✕ Fermer », en
      gris et en chasse fixe — un repère, pas un champ
- [x] Le survol de ce repère donne le chemin complet
- [x] Le champ « Titre du corpus » contient `Agrafes workcopy`
- [x] Vider le champ (sans enregistrer) : le texte d'aide qui apparaît parle de l'en-tête et
      **ne mentionne plus « la barre »**, retirée au lot 3. Refermer par « Annuler »
- [x] Sur `nouveau_corpus2.db`, saisir un titre puis « Enregistrer » : le déclencheur
      l'affiche **immédiatement**, sans qu'on ait à changer de base
- [x] Toujours sur `nouveau_corpus2.db`, revenir dans la fiche, effacer le titre et
      enregistrer : le déclencheur retombe à une seule ligne

### Les récentes, la fenêtre

- [x] Après avoir ouvert les deux `nouveau_corpus2.db` (celui de `IGE` et celui de `copie`),
      le menu 🗄 les distingue : `IGE/nouveau_corpus2.db` et `copie/nouveau_corpus2.db`
- [x] Les autres entrées de la liste, elles, gardent leur nom **sans** dossier
- [x] Le titre de la fenêtre (barre de titre, ou survol de l'icône dans la barre des tâches)
      porte le nom de fichier : `AGRAFES — Constituer — corpus_agrafes.WORKCOPY.db`, et il
      suit le changement de base

### Le raccourci dans Documents

- [x] Onglet Documents : « 📄 Fiche corpus… » est le **premier** bouton de la rangée
      d'actions, avant « Sauvegarder la DB » — et visiblement plus léger qu'eux
- [x] Il ouvre la même fiche que le menu 🗄
- [x] Le double-cliquer n'empile pas deux fiches

### Ce que la purge CSS aurait pu emporter

- [x] Actions → l'accueil (le tableau des documents) : colonnes alignées, badges d'état
      lisibles, rien de déplacé
- [x] Actions → Alignement : la barre du haut s'affiche en entier sur une seule ligne —
      sélecteur de famille, « Charger la matrice », « Aligner », « Avancé… », et « Contrôle »
      à droite
- [x] Les trois couches du canvas (Segmentation, Curation, Annotation) s'ouvrent et gardent
      leur mise en page à deux colonnes

### L'espace Alignement, là où une règle d'écran écrase les composants

Zone ajoutée le 4 septembre 2026, après ce que la première lecture de la passe a fait
remonter. Les règles génériques `.prep-actions-screen <élément>` sont en spécificité 0,1,1
et les classes des composants en 0,1,0 : la générique gagne, y compris pour imposer ce que
le composant n'a pas demandé. Trois surfaces en ont souffert, dont deux ici. Ce sont des
défauts qui ne cassent rien — ils déplacent — donc invisibles au build, au lint et aux
tests ; seul l'œil les attrape.

- [ ] Alignement : le sélecteur de famille est sur la même ligne de base que « Charger la
      matrice » — ni plus haut, ni plus bas
- [ ] Ouvrir « Avancé… » : « Mode » est **à côté** de son menu, pas au-dessus ; « Seuil »
      à côté de son champ ; et la case à cocher **devant** « Conserver les liens validés »,
      pas au-dessus. Le panneau tient sur deux lignes
- [ ] Ouvrir le sélecteur de famille **sur l'écran du portable**, fenêtre placée assez bas
      pour qu'il reste moins de 500 px sous lui : la liste s'ouvre **vers le bas**, se borne
      et défile — elle ne se retourne plus au-dessus du bouton. Y taper « h » saute à
      Houellebecq (ce que la liste native ne faisait pas, ses libellés commençant par `#366`)
