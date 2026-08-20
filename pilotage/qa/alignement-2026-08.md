---
passe: Campagne alignement — audit du 18 août
chantier: R3
duree: 25 min
derniere: 2026-08-20
---

# QA — campagne alignement (ALI-01, ALI-03, ALI-10, ALI-17, ALI-19, ALI-22)

Passe de QA visuelle des quinze commits de la campagne d'audit alignement. Elle ne
rejoue pas `shell-v040.md` (lot de juillet), qui reste valable et se joue à part.

**Ce que la campagne a changé, et que seuls les yeux valident.** La matrice projette
désormais `text_norm` et non plus `text_raw` — 33 cellules du corpus de travail changent
d'affichage, dont 236 caractères `¤` qui disparaissent. Le stylo s'amorce sur le texte
qu'il édite. Fusion et scission annoncent les liens qu'elles retirent. Un run
d'alignement s'annule. Une segmentation de famille laisse une trace.

**Contexte d'exécution.** Shell dev (`npm --prefix tauri-shell run tauri -- dev`) avec le
sidecar reconstruit le 2026-08-20 à 18h46. Contrat live attendu **1.6.71**, engine
**0.4.0**. La passe a été écrite quand 1.6.69 était courant ; la campagne a livré deux
contrats depuis (1.6.70 = gestes annulables, 1.6.71 = `apply_propagated` journalisé), et
la version attendue les suit. Corrigé le 2026-08-20 en cours de passe.
Base servie : une WORKCOPY, jamais le corpus réel.

**Préalable** : ouvrir l'inspecteur et le garder ouvert — panneau Diagnostic → bouton
**🔍 Inspecteur**, ou clic droit → *Inspecter*. Une erreur JS silencieuse est le mode de
panne le plus coûteux de cette application.

**Attention à un piège de la passe elle-même** : après un « Compléter » ou un recalcul,
l'offre d'annulation ↺ est portée par la bande d'après-run. Un rechargement de page la
conserve (sessionStorage), un redémarrage non — c'est voulu.

### Version et contrat

- [x] Le panneau Diagnostic annonce contrat **1.6.71** et engine **0.4.0**
- [x] Le panneau Diagnostic ne dit plus « Running : no » alors que l'application dialogue
- [x] Le bouton **🔍 Inspecteur** ouvre bien la console du webview

### Matrice — ce qui est projeté

- [x] Aucune cellule n'affiche de caractère `¤` (famille Modiano, colonnes de traduction)
- [x] Aucune cellule n'affiche de balisage TEI brut du type `<hi rend="bold">`
- [ ] Le texte des cellules est celui que la recherche retrouve (copier une phrase, la chercher dans le concordancier)
- [ ] L'export CSV de la matrice ne contient pas non plus de `¤`

### Matrice — le stylo

- [ ] Le ✎ apparaît au survol d'une cellule propre (un seul lien, non coupé) et sur le segment source
- [ ] Le ✎ **n'apparaît pas** sur une cellule coupée ni sur une cellule à plusieurs liens
- [ ] Corriger une cellule, rouvrir le ✎ sur la même : la zone de saisie montre **la correction**, pas le texte d'origine
- [ ] Après enregistrement, la cellule affiche le texte corrigé
- [ ] Corriger le segment source signale ses traductions comme périmées

### Segmentation — ce qui est détruit, et ce qui revient

- [ ] Fusionner deux segments alignés annonce le nombre de liens retirés
- [ ] Le message ne fait aucune promesse quand aucun lien n'était en jeu (silence)
- [ ] « Annuler » après cette fusion rend l'alignement, pas seulement les unités
- [ ] Scinder un segment aligné annonce de la même façon
- [ ] Une resegmentation annonce si elle est annulable ou **définitive**, et la formulation correspond à ce que l'on peut faire ensuite

### Alignement — annuler un run

- [ ] Après un alignement de famille, la bande propose **↺ Annuler ce run** et annonce le nombre de paires
- [ ] L'offre survit à un rechargement de page (F5)
- [ ] L'offre **n'apparaît pas** après un run qui n'a rien créé ni rien supprimé
- [ ] L'annulation rend le compte exact (retirés / rendus / validés conservés / non rendus)
- [ ] Le libellé du « Compléter » donne l'ordre de grandeur de ce qu'il peut ajouter par-dessus

### Alignement — le ⭙ et son retour

- [ ] Le modal du ⭙ porte une note « Pour revenir » nommant le geste inverse
- [ ] La note dit ce qui ne reviendra pas (le run d'origine, l'état de révision)
- [ ] La note met en garde contre ＝ Rattacher comme réparation
- [ ] Refaire un ⭙ depuis le voisin reprend bien la phrase absorbée

### Performance

- [ ] L'ouverture de la matrice Modiano reste supportable (ANALYZE lancé, ALI-19)
- [ ] Un geste de cellule ne fige pas la grille plus de deux secondes (ALI-18, non corrigé — mesurer, pas corriger)

### Cycle de vie

- [ ] Fermer l'application ne laisse aucun `multicorpus.exe` derrière elle (fuite T-05)
