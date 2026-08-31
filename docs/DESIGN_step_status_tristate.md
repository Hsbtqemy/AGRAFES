# Statut par étape et par document — la case à trois états

> Statut : **modèle proposé, rien de codé** (2026-08-31), issu de la discussion ACT-01
> du 2026-08-31. Rattache à [`pilotage/ACT-01.md`](../pilotage/ACT-01.md) (la page Actions,
> livrée sans ce modèle) et à [`DESIGN_peritext_conventions.md`](DESIGN_peritext_conventions.md)
> §0 (les capacités sont indépendantes, les documents arrivent à n'importe quel stade).
> **Les trois décisions de la §6 sont tranchées** (31 août) : la signature de péremption
> par la mesure de la §5 ; le sort de `workflow_status` par une mesure en base et une règle
> de code ; et la case **n'absorbe pas** le bouton d'ouverture, parce qu'une case énonce un
> état et ne désigne pas une destination. Le préalable moteur est levé : les chemins
> d'écriture des quatre capacités enregistrent tous (§5). **Un ticket peut être ouvert.**

## 0. Le défaut que ça corrige

La page Actions livrée le 31 août affiche, par document, ce qu'il reste à faire. Cet
état est **entièrement dérivé** : des unités existent ⇒ segmenté ⇒ silence ; des liens
existent ⇒ aligné ⇒ silence.

Ce modèle ne sait pas représenter le cas le plus banal du travail réel :

> « Je lance une segmentation, elle ne me convient pas vraiment, mais je dois quitter le
> programme et revenir plus tard. Il faut que le label Segmentation reste lisible, alors
> qu'elle a été appliquée. »

Aujourd'hui, une segmentation appliquée mais insatisfaisante rend **exactement le même
écran** qu'une segmentation réussie : les deux ont des unités, les deux se taisent. Le
jugement de l'utilisateur n'a nulle part où se poser, et rien ne survit à la fermeture
de l'application.

Ce n'est pas un problème d'affichage. C'est une couche manquante.

## 1. Ce que le dépôt sait déjà faire de cette distinction

Le modèle proposé n'invente rien : il applique à la préparation ce que l'alignement fait
déjà.

| précédent | forme | ce qu'il établit |
|---|---|---|
| `alignment_links.status` ([migration 004](../migrations/004_align_link_status.sql)) | `NULL` \| `accepted` \| `rejected` | Le moteur fabrique, l'humain juge, **dans deux champs séparés**. `NULL` = non revu est un état lisible en soi, distinct de « accepté » et de « rejeté » |
| `alignment_links.source_changed_at` ([migration 011](../migrations/011_source_changed.sql)) | horodatage | Une validation **peut périmer** : quand la curation modifie l'unité pivot, chaque lien posé dessus est estampillé pour que l'humain sache que ce qu'il avait revu a bougé |
| `units.unit_status` ([migration 023](../migrations/023_unit_status.sql)) | texte, vocabulaire côté service, pas de CHECK | Un statut manuel par unité, dont le vocabulaire peut s'étendre sans migration |
| `documents.workflow_status` | `draft` \| `review` \| `validated` + `validated_at` + `validated_run_id` | Statut **purement manuel** — vérifié : aucun code moteur ne l'écrit, seul `update_document` le fait ([documents_service.py:274-292](../src/multicorpus_engine/services/documents_service.py#L274-L292)). Mais au grain du **document entier** : il ne sait pas dire *quelle* étape est en cause |

La réponse du dépôt à « suivi automatique ou manuel ? » est donc déjà écrite : **les
deux, jamais confondus**. La page Actions est l'exception, et c'est un oubli, pas un choix.

## 2. Le modèle

Une case à trois états, **par document et par capacité** :

| | qui le pose | ce que ça veut dire |
|---|---|---|
| `[ ]` | le moteur, dérivé | aucune trace : pas d'unités, pas de liens, pas de tokens, pas de curation enregistrée |
| `[/]` | le moteur, dérivé | il y a une trace, **personne n'a dit que c'était fini** |
| `[X]` | **l'utilisateur seul** | c'est réglé |

Ce découpage a trois propriétés qui décident du coût et de l'ergonomie.

**Deux états sur trois sont gratuits.** `[ ]` et `[/]` se dérivent de ce que le moteur
observe déjà — `unit_count`, `aligned_count`, `annotation_status`, `curated_at` (ces deux
derniers servis depuis le contrat 1.6.85). Seul `[X]` demande du stockage.

**Le scénario se résout par le défaut, pas par un geste.** Une segmentation appliquée
tombe sur `[/]`, jamais sur `[X]` — le moteur n'a pas qualité à déclarer qu'un travail
est fini. Elle reste donc visible comme non close au retour, **sans que l'utilisateur ait
eu à penser à la marquer avant de quitter**. C'est le point : le cas du scénario est celui
qui n'exige aucune discipline.

**Personne n'a 232 cases à cocher.** Sur la base de travail, les 58 documents arrivent
déjà répartis entre `[ ]` et `[/]` et sont lisibles à l'ouverture. Cocher devient un geste
d'exception, pas une corvée de saisie. C'est ce qui distingue ce modèle d'un suivi
purement manuel, qui serait vide et donc faux le jour de sa livraison.

### Ce qui n'entre pas dans le modèle

**« Index périmé » n'est pas une capacité.** Ce n'est pas un travail qu'on mène à terme,
c'est une anomalie qui apparaît et disparaît toute seule (`fts_stale`, dérivé). Elle
reste un marqueur à part, hors des cases. Lui donner une case à cocher laisserait croire
qu'on peut la déclarer réglée à la main.

## 3. Ce que ça coûte

Un bit à persister par `(document, capacité)` : « validé, à telle date ». La table ne
porte que les `[X]`, donc elle reste petite — au plus 4 lignes par document, en pratique
beaucoup moins.

| artefact | pourquoi |
|---|---|
| migration | table `doc_step_status(doc_id, step, validated_at, …)` + index `(doc_id)` ; FK `ON DELETE CASCADE` vers `documents` |
| route | poser / retirer une validation ; lecture via l'enrichissement de `GET /documents` |
| `sidecar_contract.py` + `docs/openapi.json` + snapshot | route nouvelle ⇒ les trois artefacts, plus `SIDECAR_API_CONTRACT.md` |
| front | la colonne « À faire » devient quatre cases ; les comptes des cartes suivent |

**Une nouvelle table appelle un audit des chemins de SUPPRESSION** : sans
`ON DELETE CASCADE`, avec `foreign_keys=ON`, une suppression de document lève l'erreur
*après* avoir détruit des lignes, sans rollback — perte silencieuse. Ce n'est pas
théorique : la [migration 028](../migrations/028_alignment_cell_status.sql) déclare ses
deux clés étrangères **sans** cascade, et c'est ce qui a fait tomber `/segment`,
`/units/merge` et `/prep/undo`. À ne pas reproduire ici.

## 4. Ce que ça donne à l'écran

La colonne « À faire » — quatre pastilles textuelles bornées à quatre, aujourd'hui
21 rem — devient quatre cases. Deux gains par-dessus le modèle :

- **Scannable en colonne.** On suit « Segmentation » du regard sur 58 lignes, ce qu'un
  chapelet de pastilles de largeurs différentes interdit.
- **Plus étroit.** Quatre cases tiennent dans ce que trois pastilles ne tenaient pas ;
  la place revient à « Titre », seule colonne élastique.

`aria-checked="mixed"` est le tri-état natif : `[/]` n'a pas besoin d'un bricolage
d'accessibilité.

Reste à trancher si la case remplace le bouton d'ouverture de la même capacité (une
colonne au lieu de deux, l'état et le geste au même endroit) ou vit à côté — voir §6.

## 5. La péremption d'un `[X]`

**C'est le point dur.** On valide la segmentation, puis on resegmente : la coche valide
un état qui n'existe plus. Une coche qui rassure à tort est pire que pas de coche.

Le dépôt a déjà ce problème et sa réponse : `source_changed_at` (migration 011). La
transposition : le `[X]` garde une **signature de ce qu'il a validé**, et retombe
visiblement à `[/]` quand elle ne correspond plus.

Reste à choisir la signature. **Mesuré le 31 août** sur la base de travail
(58 documents, 299 lignes de `prep_action_history`), en lecture seule.

### Ce que la mesure établit

**Le taux de retour est réel, ni nul ni permanent.** On revient sur une capacité déjà
travaillée assez souvent pour qu'une signature serve, mais pas au point qu'elle périme
tout :

| capacité | documents touchés | dont revisités | moments de coche qui auraient péri |
|---|---|---|---|
| Curation | 10 | 4 (40 %) | 7 / 17 (41 %) |
| Segmentation | 17 | 2 (11 %) | 6 / 23 (26 %) |
| Alignement | 22 | 6 (27 %) | 13 / 35 (37 %) |
| Annotation | 22 | 6 (27 %) | 13 / 35 (37 %) |

Environ **une coche sur trois** finirait par être démentie par la suite du travail. Une
signature n'est donc pas un ornement : sans elle, un tiers des `[X]` deviennent des
mensonges silencieux.

**La signature par compte d'unités est disqualifiée — par le mécanisme, pas par le
taux.** Sur les 12 resegmentations enregistrées, 2 rendent exactement le même nombre
d'unités. Le rapport « 2 sur 12 » ne vaut rien statistiquement à cet effectif, et il ne
sert pas ici : ce qui disqualifie, c'est que le cas **existe et soit observable**. Un
découpage peut changer entièrement sous la coche sans que le compte bronche. Pour un
signal dont le seul métier est l'honnêteté, une seule occurrence suffit.

**« Rien » est disqualifiée aussi**, par le premier tableau : laisser le `[X]` survivre à
tout, c'est accepter qu'un tiers d'entre eux mentent.

**La règle naïve sur-déclenche.** `set_role` compte 11 actions et ne concerne aucune des
quatre capacités : sous « toute action postérieure périme », renommer un rôle annulerait
tout ce qui était validé sur le document. Le périmètre doit être **par capacité**, pas
par document.

### Ce que cette mesure ne prouve PAS

Elle porte sur **une seule base, la copie de travail** — et il n'existe pas de jeu
indépendant pour recouper : les autres fichiers du dossier sont des instantanés du même
corpus, pas d'autres corpus. Il faut donc trier ce qui tient de ce qui est indicatif.

| résultat | portée |
|---|---|
| `set_role` périme des capacités sans rapport | **structurel** — c'est la table de correspondance action → capacité, pas un comptage |
| une resegmentation peut rendre le même compte d'unités | **structurel** — le cas est observé, donc possible ; le taux n'est pas la question |
| l'angle mort de l'historique | **structurel**, et transitoire (voir ci-dessous) |
| taux de retour 26 – 41 % | **indicatif seulement** — c'est le comportement d'une personne sur un corpus, dans une base *de travail* où l'on expérimente plus qu'en usage réel. À re-mesurer sur un corpus mené de bout en bout avant d'en tirer une règle |

La conclusion « la signature *rien* est disqualifiée » s'appuie sur le seul chiffre
indicatif du tableau. Elle est donc la plus fragile des trois : si le taux de retour réel
s'avérait très bas, un `[X]` définitif redeviendrait défendable. Ce qui ne bouge pas, en
revanche, c'est qu'une coche définitive **ne peut pas dire** qu'elle ne sait rien — et
c'est l'argument qui la condamne, indépendamment du taux.

### Ce que la mesure déplace

Le vrai obstacle n'est pas le choix de la signature, c'est sa **couverture** :

> **36 documents sur 58 — 62 % du corpus — n'ont aucune action enregistrée.**

Sur eux, une signature fondée sur l'historique ne peut jamais périmer quoi que ce soit :
le `[X]` y serait définitif faute de preuve du contraire. Trois causes cumulées, déjà
connues : `prep_action_history` est *forward-only* depuis le 7 mai 2026 ; le chemin
**asynchrone** de la curation n'y écrivait rien — cause **supprimée le 31 août**, contrat
1.6.87, voir plus bas ; et une préparation antérieure n'a laissé aucune trace. L'activité
est en outre très concentrée — le document le plus actif porte 124 actions, soit 47 % de
tout l'historique, pour une médiane de 3.

**Mais l'angle mort se referme, et c'est mesurable.** Comparaison de deux instantanés du
même corpus — un avant/après de la même population, ce à quoi des instantanés servent
légitimement :

| instantané | documents | avec historique | angle mort |
|---|---|---|---|
| `corpus_agrafes.db` (30 juin) | 53 | 9 | 83 % |
| `corpus_agrafes.WORKCOPY.db` (27 août) | 58 | 22 | 62 % |

Vingt et un points en deux mois. L'angle mort n'est donc pas une propriété du modèle
mais un **artefact de transition** : il se résorbe à mesure que le travail passe par des
chemins qui enregistrent. Ce qui change la nature du repli dérivé — c'est une béquille
datée, pas une seconde signature permanente.

À condition que **tous** les chemins enregistrent, ce qui n'était pas le cas. En
énumérant les appelants au lieu de corriger celui qu'on avait sous les yeux : trois
chemins appliquent la curation, et **deux** n'écrivaient aucune ligne — le job
`POST /jobs kind=curate` et la CLI `multicorpus curate`. Une part de l'angle mort n'aurait
donc jamais pu se refermer. C'est ce qui a fait passer ce constat d'un détail d'hygiène à
une **condition de la conception** — corrigé le 31 août (contrat 1.6.87 : les trois
construisent le même recorder, `services/curate_service.apply_recorder`). Le raisonnement
vaut au-delà de ce cas : avant de bâtir sur la résorption de l'angle mort, vérifier
qu'aucune mutation ne reste muette — et les compter, pas se fier à la première trouvée.

Il en restait **une**, `multicorpus segment`, qui n'écrivait pas la ligne `resegment` que
ses deux jumeaux sidecar écrivent : la signature du `[X]` Segmentation aurait eu un trou
par Mode A. Fermée le 31 août, en déplaçant le recorder dans
`services/segment_service.py` — la CLI ne pouvait pas l'atteindre là où il vivait.

**Le préalable est donc levé**, et l'énumération a été faite au code plutôt qu'estimée.
Curation : `POST /curate`, le job `kind=curate`, la CLI — trois, tous enregistrent
maintenant. Segmentation : quatre handlers sidecar (`_handle_segment`,
`_handle_family_segment`, `_handle_segment_apply_propagated`, le job `kind=segment`) qui
enregistraient déjà, plus la CLI qui vient de s'y joindre. Et `lift-markers` n'est une
asymétrie d'aucune sorte : il n'est un type d'action annulable nulle part. La signature
par l'historique peut donc se bâtir dessus.

### Ce que la mesure recommande

**Deux signatures, pas une**, parce qu'aucune ne couvre seule :

1. **L'historique, scopé par capacité** — précis là où il existe, et il fait exactement
   le bon travail : il périme sur les vrais retours et ignore `set_role`.
2. **Un repli dérivé** (`unit_count`, `aligned_count`, `token_count`, `curated_at` au
   moment de la coche) pour les 62 % de documents que l'historique ignore. Sa cécité
   mesurée à 16 % ne mord que là où l'autre est muet — et 84 % de couverture vaut mieux
   que zéro.

Un `[X]` doit alors **dire sur quoi il se fonde** : « validé le 12/08, aucune
modification enregistrée depuis » n'est pas la même promesse que « validé le 12/08,
avant que l'historique existe ». Une coche qui tait sa propre incertitude est le défaut
qu'on vient de corriger ailleurs — l'index de recherche qui se disait « à jour » alors
qu'il était illisible (FTS-01).

> **Note de méthode.** La première passe de cette mesure était circulaire : elle posait
> le `[X]` juste après la *dernière* action de la capacité, donc aucune action de cette
> capacité ne pouvait suivre, et elle rendait 0 % de péremption partout. Les chiffres
> ci-dessus viennent de la seconde, qui compte les retours effectifs.

## 6. Les décisions

- [x] **`workflow_status` survit-il à côté ?** — **oui, et la frontière est écrite**
      (tranché le 31 août). Il est manuel, au grain du document entier, et porte
      `validated_at` + `validated_run_id`. La crainte était la divergence de deux
      vocabulaires, comme les deux tables de curation l'ont fait. La mesure a montré
      qu'aucune des deux autres issues n'était payable : **31 documents sur 58 sont
      `validated`**, 27 `draft`, et `validated_at` est renseigné sur les 31. Le retirer
      perd 31 validations datées ; le *dériver* des quatre cases les ferait toutes
      repasser à non-validé au premier jour, aucune case n'existant encore.

      **La frontière.** `workflow_status` répond à *« ce document est-il bon à servir ? »* —
      un jugement d'ensemble, que son auteur pose une fois. Les quatre cases répondent à
      *« cette capacité est-elle faite sur ce document ? »* — un avancement, par capacité.
      Les deux sont manuels et peuvent se contredire sans que ce soit une incohérence : on
      peut juger un document bon à servir sans avoir annoté, et avoir tout coché sur un
      document qu'on ne veut pas encore publier.

      **Ce qui empêche la dérive n'est pas la doc, c'est une règle de code** : ni l'un ni
      l'autre ne s'écrit à partir de l'autre. Aucune case ne modifie `workflow_status`,
      aucun changement de `workflow_status` ne coche ou décoche une case. C'est
      exactement ce que les deux tables de curation n'avaient pas — l'une était écrite par
      le front, l'autre par le moteur, pour la même chose.

      **Trouvé au passage** : `validated_run_id` n'est renseigné sur **aucun** des 58
      documents. La moitié du couple est morte depuis toujours ; à traiter ailleurs, ce
      n'est pas ce chantier.
- [x] **La signature de péremption** — tranchée par la mesure du 31 août (§5) :
      historique **scopé par capacité**, plus un repli dérivé tant que l'angle mort n'est
      pas résorbé, et un `[X]` qui dit sur quoi il se fonde. Le compte d'unités seul est
      écarté par le mécanisme ; « rien » l'est parce qu'une coche définitive ne peut pas
      dire qu'elle ne sait rien. Les taux mesurés sont **indicatifs** — une seule base, de
      travail, sans jeu de recoupement (§5, « ce que cette mesure ne prouve pas »).
- [x] **La case remplace-t-elle le bouton d'ouverture ?** — **non** (tranché le 31 août).
      Pas par arbitrage de coûts : par ce que la case **veut dire**. Une case à cocher
      énonce un état — en cours, fini. Elle ne désigne pas une destination. Enregistrer et
      se déplacer sont deux verbes différents ; le même contrôle ne peut pas porter les
      deux sans cesser de signifier quoi que ce soit. C'est plus fort que l'argument du
      geste ambigu que la note avançait d'abord : ce n'est pas qu'un clic serait difficile
      à interpréter, c'est qu'on demanderait à une case de faire ce qu'une case ne fait
      pas.

      **Les deux colonnes restent donc distinctes.** La redondance qu'on leur reproche —
      quatre capacités en état, puis les quatre mêmes en gestes, 30,4 rem à elles deux —
      ne disparaît pas pour autant, mais elle change de nature : c'est un problème de
      **mise en page**, à traiter par la largeur (icônes, colonne d'ouverture resserrée,
      geste au niveau de la ligne), jamais en fusionnant deux sens dans un seul contrôle.

## 7. Ce qui est déjà en place et ne bouge pas

Livré avec ACT-01, indépendant de ce modèle :

- `GET /documents` sert `curated_at` et `aligned_count` (contrat 1.6.85), dérivés, sans
  migration. Ce sont deux des quatre sources de l'état `[ ]` / `[/]`.
- `actionsHubState.ts` isole déjà en fonctions pures le calcul de l'état par capacité
  (`stepState`, `stepCounts`, `docBadges`, `visibleBadges`). Le passage aux trois états
  se fait dans ce module, sous tests, avant de toucher au DOM.
- Le seuil de segmentation est `unit_count <= 1`, **pas** `segmented` de `GET /families`,
  qui vaut « le document a au moins une unité » — vrai de 57 documents sur 58, donc vide
  de sens. Ce piège reste valable pour l'état `[ ]`.
