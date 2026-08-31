# Statut par étape et par document — la case à trois états

> Statut : **modèle proposé, rien de codé** (2026-08-31), issu de la discussion ACT-01
> du 2026-08-31. Rattache à [`pilotage/ACT-01.md`](../pilotage/ACT-01.md) (la page Actions,
> livrée sans ce modèle) et à [`DESIGN_peritext_conventions.md`](DESIGN_peritext_conventions.md)
> §0 (les capacités sont indépendantes, les documents arrivent à n'importe quel stade).
> **Trois décisions restent ouvertes**, listées en §6 — elles doivent être tranchées avant
> qu'un ticket soit ouvert.

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

Reste à choisir la signature, et le choix n'est pas neutre :

- **Le compte d'unités** au moment de la validation — bon marché, mais aveugle à une
  resegmentation qui rendrait le même nombre d'unités.
- **L'`action_id` de `prep_action_history`** — le moteur y enregistre déjà chaque
  mutation destructive par document (`curation_apply`, `resegment`, `merge_units`,
  `split_unit`, `update_text`, `set_role`, `set_paragraph`). Une validation périme dès
  qu'une action postérieure touche le document. Précis, et **sans donnée nouvelle**.
- **Rien** — le `[X]` survit à tout, et c'est à l'utilisateur de le retirer.

La deuxième piste est la seule qui se dérive de l'existant. Elle a une limite à mesurer
avant de s'y engager : `prep_action_history` est *forward-only* depuis la migration 019,
et le chemin **asynchrone** de la curation n'y écrit rien (constat ouvert dans
`pilotage/ACT-01.md`). Une signature fondée dessus hériterait de ces deux trous.

> **À vérifier en base avant d'écrire une ligne** — combien de documents portent une
> action postérieure à leur dernière trace de capacité ? Une signature qui périmerait
> tout le temps ne vaut pas mieux qu'une qui ne périme jamais.

## 6. Les trois décisions ouvertes

- [ ] **`workflow_status` survit-il à côté ?** Il est manuel, au grain du document
      entier, et porte `validated_at` + `validated_run_id`. Deux vocabulaires de
      validation qui coexistent finissent par diverger — comme les deux tables de
      curation l'ont fait (`curation_apply_history` face à `prep_action_history`).
      Trois issues : il se retire ; il se dérive des quatre cases (« validé » = les
      quatre à `[X]` ) ; il reste indépendant, et on documente pourquoi.
- [ ] **La signature de péremption**, entre les trois pistes de la §5 — à trancher sur
      une mesure en base, pas sur le papier.
- [ ] **La case remplace-t-elle le bouton d'ouverture ?** Les colonnes « À faire » et
      « Ouvrir » disent déjà la même chose deux fois — quatre capacités en état, puis
      les quatre mêmes en gestes, pour 30 rem à elles deux. Une case cliquable qui
      ouvre aussi la capacité les fusionne ; mais un contrôle qui coche ET navigue selon
      la zone cliquée est un geste ambigu, et le dépôt refuse déjà les gestes ambigus
      (pas de dialogue natif, confirmation inline explicite).

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
