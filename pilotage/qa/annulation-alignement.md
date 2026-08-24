---
passe: Annulation des gestes d'alignement (D-3)
chantier: R3
duree: 20 min
derniere: 2026-08-20
---

# QA — le bandeau ↶ et ce qu'il défait

> **L'onglet « Brut » de la couche Segmentation a été renommé le 2026-08-21**
> en « Segmentation actuelle », et les cinq onglets sont désormais deux groupes
> (l'état à gauche, « Segmenter : » à droite). Les items ci-dessous ont été mis à
> jour ; ils visent la même vue.

Passe de la journée du 20 août : les quatre lots qui rendent les gestes de l'espace
Alignement annulables. Elle ne rejoue pas `alignement-2026-08.md` (campagne d'audit,
toujours valable) ni `shell-v040.md`. Les trois se jouent séparément.

**Ce qui est nouveau, et que seuls les yeux valident.** Le moteur garde une pile bornée
des cinquante derniers gestes ; la matrice offre un bandeau « ↶ Annuler » sur le dernier.
Un geste qui tient en trois requêtes — ⭙ Fusionner fait `create`, `delete`, `set_bead` —
doit se défaire **d'un seul bloc**. Les tests le prouvent sur le fil ; ce qu'ils ne
prouvent pas, c'est que l'écran redevient celui d'avant.

**Contexte d'exécution.** Shell dev (`npm --prefix tauri-shell run tauri -- dev`) avec le
sidecar reconstruit le 2026-08-22 à 20h56. Contrat live attendu **1.6.75**, engine
**0.4.0**. La passe a été écrite sous 1.6.71 ; les quatre contrats suivants — 1.6.72 à
1.6.75, assainisseur de requête puis pivot KWIC — viennent du chantier **recherche** et
**ne touchent rien de ce que cette passe vérifie**. C'est simplement le numéro que le
panneau affichera. Recalé le 2026-08-23.
Base servie : une WORKCOPY, jamais le corpus réel.

**Une chose à savoir avant de commencer.** L'annulation est refusée dans deux cas, et
c'est voulu : `404` si l'opération a déjà été défaite ou est sortie de la pile, `409` si
un geste **postérieur** porte sur les mêmes liens. Un refus n'est donc pas forcément un
défaut — le message doit dire lequel des deux.

### Version et contrat

- [x] Le panneau Diagnostic annonce contrat **1.6.76** et engine **0.4.0**
- [x] `Tauri runtime : yes` (le rapport du 20 août à 13h27 disait `no`)
- [x] Aucun message de reprise après crash au démarrage
      *(Attention : les vérifications du 22 août ont tué le shell de force à plusieurs
      reprises, ce qui laisse une trace de crash légitime. Si le message cite une date
      du 22, ce n'est pas un défaut — relancer une fois de plus et rejouer le point.)*

### Le bandeau apparaît, et seulement quand il le doit

- [x] Après un ⭙ Fusionner réussi, un bandeau ↶ apparaît au-dessus de la grille
- [x] Il nomme le geste — « ⭙ Absorber la phrase voisine » — et non un libellé générique
- [x] Il n'apparaît **pas** après un geste refusé (tenter un ＝ sur une cellule déjà liée)
- [x] Il n'apparaît pas au simple chargement d'une matrice, ni après un run d'alignement
- [x] Un second geste **remplace** le bandeau au lieu d'en empiler un deuxième

### Ce que « ↶ Annuler » défait vraiment

- [x] Après ⭙ puis ↶, la cellule d'origine retrouve sa phrase **et** la voisine la sienne
- [x] Le message de retour distingue ce qui est rétabli de ce qui est retiré
- [x] La grille se recharge d'elle-même : aucun rechargement manuel n'est nécessaire
- [x] Le bandeau disparaît après l'annulation
- [x] Rejouer le même ⭙ après un ↶ redonne le même résultat qu'au premier passage

### Le geste multi-requêtes — le cœur du lot

- [x] ✂ Couper à cheval puis ↶ : la coupe part **et** le lien créé chez le voisin part avec
- [x] Aucun lien orphelin ne subsiste chez le segment voisin après le ↶
- [x] ＝ Rattacher sur une cellule vide puis ↶ : la cellule redevient vide
- [x] ＝ sur une cellule déjà liée (re-ciblage) puis ↶ : la cible d'origine revient
- [x] ↺ Rendre la phrase entière puis ↶ : la coupe revient **au même endroit**
      *(Avant le ↺, relever les derniers mots de la tranche du haut et les premiers de
      celle du bas ; après le ↶ ils doivent être identiques. Le piège : rétablir les liens
      sans leurs bornes afficherait la phrase ENTIÈRE dans chaque cellule — ce qui passe
      pour une coupe rétablie tant qu'on ne lit pas le texte.)*

### Les gardes

- [x] Changer de famille retire le bandeau (il ne doit pas survivre au changement)
- [x] Changer de corpus retire le bandeau
- [x] Double-clic rapide sur ↶ : une seule annulation, pas de message d'erreur parasite

### Les refus, qui doivent se distinguer

- [x] Le bandeau ne propose jamais d'annuler une opération qu'un geste plus récent a doublée
      *(Route : faire un geste dans la matrice, passer au Contrôle, y agir sur les mêmes
      liens — supprimer, accepter —, revenir, cliquer ↶. Deux issues acceptables : le
      bandeau a disparu au retour, ou il refuse en nommant un geste plus récent.
      Inacceptable : « opération introuvable », ou une annulation qui aboutit. Le code de
      retour lui-même est couvert au moteur —
      `test_a_later_gesture_on_the_same_links_blocks_the_undo`.)*
      le refus mentionne un geste plus récent (409), pas une opération introuvable
- [x] Le message de refus est lisible sans connaître le vocabulaire interne

### Ce que le lot ne couvre pas — à vérifier comme absences

- [x] Le stylo ✎ dans la matrice n'offre **pas** de bandeau ↶ (il passe par une autre mécanique)
- [x] Le geste ¶ n'offre **pas** de bandeau ↶
- [x] Le panneau Alignement (hors matrice) n'offre pas de bandeau — ses gestes restent muets

### Segmentation et propagation — la trace du dernier site

- [x] Une propagation de segmentation laisse une action annulable (bouton ↶ dans la couche Segmentation, onglet « Segmentation actuelle » — nommé « Brut » avant le 2026-08-21)
- [x] Après cette annulation, un intertitre revient bien comme **intertitre**, pas comme ligne
- [x] Le repli « voir l'original d'import » fonctionne encore sur une unité restaurée

### Performance et cycle de vie

- [x] Le ↶ répond dans le même ordre de temps qu'un geste ordinaire
- [x] Fermer l'application ne laisse aucun `multicorpus` dans le gestionnaire des tâches
- [x] Relancer immédiatement le shell fonctionne (pas de `PermissionDenied` sur le binaire)
