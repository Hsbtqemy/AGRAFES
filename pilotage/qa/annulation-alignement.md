---
passe: Annulation des gestes d'alignement (D-3)
chantier: R3
duree: 20 min
derniere: 2026-08-20
---

# QA — le bandeau ↶ et ce qu'il défait

Passe de la journée du 20 août : les quatre lots qui rendent les gestes de l'espace
Alignement annulables. Elle ne rejoue pas `alignement-2026-08.md` (campagne d'audit,
toujours valable) ni `shell-v040.md`. Les trois se jouent séparément.

**Ce qui est nouveau, et que seuls les yeux valident.** Le moteur garde une pile bornée
des cinquante derniers gestes ; la matrice offre un bandeau « ↶ Annuler » sur le dernier.
Un geste qui tient en trois requêtes — ⭙ Fusionner fait `create`, `delete`, `set_bead` —
doit se défaire **d'un seul bloc**. Les tests le prouvent sur le fil ; ce qu'ils ne
prouvent pas, c'est que l'écran redevient celui d'avant.

**Contexte d'exécution.** Shell dev (`npm --prefix tauri-shell run tauri -- dev`) avec le
sidecar reconstruit le 2026-08-20 à 18h46. Contrat live attendu **1.6.71**, engine
**0.4.0**. Base servie : une WORKCOPY, jamais le corpus réel.

**Une chose à savoir avant de commencer.** L'annulation est refusée dans deux cas, et
c'est voulu : `404` si l'opération a déjà été défaite ou est sortie de la pile, `409` si
un geste **postérieur** porte sur les mêmes liens. Un refus n'est donc pas forcément un
défaut — le message doit dire lequel des deux.

### Version et contrat

- [ ] Le panneau Diagnostic annonce contrat **1.6.71** et engine **0.4.0**
- [ ] `Tauri runtime : yes` (le rapport du 20 août à 13h27 disait `no`)
- [ ] Aucun message de reprise après crash au démarrage

### Le bandeau apparaît, et seulement quand il le doit

- [ ] Après un ⭙ Fusionner réussi, un bandeau ↶ apparaît au-dessus de la grille
- [ ] Il nomme le geste — « ⭙ Absorber la phrase voisine » — et non un libellé générique
- [ ] Il n'apparaît **pas** après un geste refusé (tenter un ＝ sur une cellule déjà liée)
- [ ] Il n'apparaît pas au simple chargement d'une matrice, ni après un run d'alignement
- [ ] Un second geste **remplace** le bandeau au lieu d'en empiler un deuxième

### Ce que « ↶ Annuler » défait vraiment

- [ ] Après ⭙ puis ↶, la cellule d'origine retrouve sa phrase **et** la voisine la sienne
- [ ] Le message de retour distingue ce qui est rétabli de ce qui est retiré
- [ ] La grille se recharge d'elle-même : aucun rechargement manuel n'est nécessaire
- [ ] Le bandeau disparaît après l'annulation
- [ ] Rejouer le même ⭙ après un ↶ redonne le même résultat qu'au premier passage

### Le geste multi-requêtes — le cœur du lot

- [ ] ✂ Couper à cheval puis ↶ : la coupe part **et** le lien créé chez le voisin part avec
- [ ] Aucun lien orphelin ne subsiste chez le segment voisin après le ↶
- [ ] ＝ Rattacher sur une cellule vide puis ↶ : la cellule redevient vide
- [ ] ＝ sur une cellule déjà liée (re-ciblage) puis ↶ : la cible d'origine revient
- [ ] ↺ Rendre la phrase entière puis ↶ : la coupe précédente est rétablie, bornes comprises

### Les gardes

- [ ] Changer de famille retire le bandeau (il ne doit pas survivre au changement)
- [ ] Changer de corpus retire le bandeau
- [ ] Double-clic rapide sur ↶ : une seule annulation, pas de message d'erreur parasite
- [ ] Après un ↶, cliquer une seconde fois sur un bandeau resté visible est impossible

### Les refus, qui doivent se distinguer

- [ ] Faire un geste, puis un second sur les **mêmes** liens, puis tenter d'annuler le premier :
      le refus mentionne un geste plus récent (409), pas une opération introuvable
- [ ] Le message de refus est lisible sans connaître le vocabulaire interne

### Ce que le lot ne couvre pas — à vérifier comme absences

- [ ] Le stylo ✎ dans la matrice n'offre **pas** de bandeau ↶ (il passe par une autre mécanique)
- [ ] Le geste ¶ n'offre **pas** de bandeau ↶
- [ ] Le panneau Alignement (hors matrice) n'offre pas de bandeau — ses gestes restent muets

### Segmentation et propagation — la trace du dernier site

- [ ] Une propagation de segmentation laisse une action annulable (bouton ↶ dans la couche Brut)
- [ ] Après cette annulation, un intertitre revient bien comme **intertitre**, pas comme ligne
- [ ] Le repli « voir l'original d'import » fonctionne encore sur une unité restaurée

### Performance et cycle de vie

- [ ] Le ↶ répond dans le même ordre de temps qu'un geste ordinaire
- [ ] Fermer l'application ne laisse aucun `multicorpus` dans le gestionnaire des tâches
- [ ] Relancer immédiatement le shell fonctionne (pas de `PermissionDenied` sur le binaire)
