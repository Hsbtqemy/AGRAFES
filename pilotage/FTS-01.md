---
chantier: FTS-01
statut: à venir
---

# FTS-01 — l'index de recherche se corrompt, et rien ne le dit

**Point de départ** — l'index de recherche est cassé dans **quatre** instantanés du corpus, sous
deux formes distinctes, depuis juin 2026 ; la base de travail a été reconstruite le 25 août,
la **cause** reste inconnue.

## Reste

- [x] **L'écran affichait « ✓ Index à jour » sur une base dont l'index est cassé** — trouvé
      et corrigé le 28 août, ce constat ne figurait dans aucun des dix items et il est le
      plus aigu de la fiche : les deux pannes documentées produisaient une pastille
      **verte**. Cause : `fts_stale` est dérivé par `stale_doc_ids`, qui avale
      `sqlite3.Error` et rend un ensemble vide — un index **cassé** était donc
      indistinguable d'un index **à jour**. Mesuré en rejouant la fonction sur vos
      instantanés : `PRE-REBUILD` du 25/08 (pages corrompues) → 0 périmé ;
      `PRE-FTS-REPAIR` du 17/08 (déclaration absente) → 0 périmé ; `WORKCOPY.db` saine →
      17 périmés, correctement. Correctif : `index_readable(conn)` dans `indexer.py`,
      `fts_readable` sur `GET /documents` (contrat **1.6.84**, champ additif, snapshot
      inchangé), troisième état du bouton — « ⚠ Index illisible », **inactif à dessein**
      puisque `POST /index` ne peut pas réparer, et dont l'infobulle dit qu'aucun texte
      n'est perdu. Trois tests moteur, dont un qui assère le piège en trois temps
      (cinq tables d'ombre survivantes, `integrity_check` à `ok`, zéro périmé), et
      cinq tests front
- [x] **La base de travail n'a pas récidivé** — mesuré le 28 août, trois jours après la
      reconstruction : `WORKCOPY.db` a sa déclaration, ses cinq tables d'ombre, et
      `fts_units` se lit. En revanche l'index **retarde** de 21 532 lignes sur 69 440 —
      c'est normal (aucun trigger, seul `indexer.py` remplit), c'est signalé, et
      personne n'a cliqué. À ne pas confondre avec une panne lors du prochain diagnostic
- [ ] Établir si la disparition de la **déclaration** de `fts_units` est un accident ou une réparation manuelle passée — mesuré le 25 août : `corpus_agrafes.db` et `corpus_agrafes.RECOVERED.db` (30 juin) et `corpus_agrafes.WORKCOPY.PRE-FTS-REPAIR.db` (17 août) portent les **cinq tables d'ombre** (`fts_units_content`, `_data`, `_idx`, `_docsize`, `_config`) mais **pas** la table virtuelle `fts_units`, alors que la migration 002 y est appliquée ; leur intégrité SQLite est par ailleurs `ok`. C'est exactement l'empreinte d'un retrait par `PRAGMA writable_schema` sans recréation — soit quelqu'un l'a fait, soit quelque chose le fait
- [ ] Distinguer les deux pannes dans tout diagnostic futur : *déclaration absente* rend `OperationalError: no such table: fts_units`, *pages corrompues* rend `DatabaseError: database disk image is malformed` — la première laisse `integrity_check` à `ok` et passe donc inaperçue à un contrôle naïf
- [ ] Trouver ce qui corrompt `fts_units` — deux occurrences en huit jours (17 août, trace `corpus_agrafes.WORKCOPY.PRE-FTS-REPAIR.db` ; 25 août, `…PRE-REBUILD-2026-08-25.db`), aucune explication ; pistes non explorées : arrêt brutal du sidecar pendant une écriture FTS, deux sidecars sur la même base, antivirus ou synchronisation sur le dossier `Documents`, une écriture FTS hors transaction
- [ ] Vérifier si les corruptions de pages ont la même signature — sur celle du 25 août, `integrity_check` ne signalait que `fts_units_data` et `fts_units_content` (« invalid page number », 101 lignes de rapport) ; comparer avec la base du 17 août **ne le dira pas** : vérifié le 28 août, elle n'a aucune corruption de pages, c'est l'autre panne (déclaration absente, `integrity_check` à `ok`). Il n'existe donc qu'**une seule** corruption de pages sur disque, et rien à quoi la comparer — cet item attend une récidive, il n'est pas actionnable aujourd'hui
- [ ] Corriger le masquage de l'erreur dans `services/units_service.py` : l'écriture FTS est enveloppée dans un `try/except: pass` (l. 375-387), donc une base malformée ne casse pas là mais **quatre instructions plus loin**, sur `UPDATE alignment_links` (l. 390) — un lecteur du traceback cherche du côté de l'alignement alors que le problème est l'index
- [ ] Rattraper `sqlite3.DatabaseError` dans l'adaptateur `_handle_units_update_text` (`sidecar.py:5805`), qui ne connaît que `BadRequestError` et `NotFoundError` : aujourd'hui une base abîmée se présente à l'utilisateur comme « internal error », sans un mot sur ce qui est abîmé ni sur ce qu'il faudrait faire
- [ ] Décider d'un contrôle d'intégrité au démarrage du sidecar : `PRAGMA quick_check(1)` sur la base ouverte coûte peu et dirait tout de suite ce que trois heures d'enquête ont établi le 25 août ; à trancher — au démarrage seulement, ou aussi avant une écriture ?
- [ ] Donner au produit un chemin de réparation : le bouton *réindexer* actuel (`POST /index`) ne peut pas fonctionner sur un index corrompu, puisqu'il passe par `DELETE`/`INSERT` sur la table même qu'on ne peut plus toucher — mesuré le 25 août, six voies SQL ordinaires échouent toutes
- [ ] Décider si `scripts/` accueille l'outil de reconstruction éprouvé le 25 août (recopie des tables saines dans un fichier neuf + refabrication de l'index depuis `units.text_norm`) — il n'existe aujourd'hui nulle part dans le dépôt, il a été écrit dans un répertoire temporaire
- [ ] Trancher une politique de sauvegarde de la base de travail : le dossier en compte huit versions accumulées à la main depuis mars, sans rotation ni règle, et c'est ce qui a sauvé la mise deux fois

## Contexte

**Inventaire du 25 août — sept bases, une seule entière.** Mesuré fichier par fichier
(`quick_check`, comptes, lecture de `fts_units`) :

| base | date | docs / unités | intégrité | index |
|---|---|---|---|---|
| `corpus_agrafes.WORKCOPY.db` | 25/08 17:56 | 58 / 48045 | ok | **entier** |
| `…WORKCOPY.PRE-REBUILD-2026-08-25.db` | 25/08 17:54 | 58 / 48045 | **KO** | pages corrompues |
| `…WORKCOPY.PRE-FTS-REPAIR.db` | 17/08 | 54 / 46678 | ok | déclaration absente |
| `corpus_agrafes.RECOVERED.db` | 30/06 | 53 / 46446 | ok | déclaration absente |
| `corpus_agrafes.db` | 30/06 | 53 / 46446 | ok | déclaration absente |
| `corpus_agrafes.db.CORRUPT-BAK` | 30/06 | — | illisible | — |

Les six `*.db.bak` de mars-avril sont des états anciens (0 à 31 documents) et n'ont pas
de valeur de secours. **Aucune base antérieure au 25 août ne permettrait de chercher** :
la seule utilisable est celle qui vient d'être reconstruite.


Ce que la journée du 25 août a établi, pour ne pas le redécouvrir.

**Le symptôme.** « Internal error » sur la stylisation, sur le stylo de correction, sur la
recherche, sur `/corpus/info`, et sur le bouton *réindexer* lui-même. Autrement dit :
tout ce qui touche l'index, en lecture comme en écriture. Le message ne distingue rien.

**Le diagnostic.** `sqlite3.DatabaseError: database disk image is malformed`. Corruption
cantonnée à deux arbres, `fts_units_data` (racine 10) et `fts_units_content` (racine 12),
plus `fts_units_docsize` illisible. Vérifié sur le fichier au repos, sidecar éteint, donc
sans le doute d'une lecture concurrente.

**Les données du corpus étaient intactes** : `units` 48045, `documents` 58, `tokens` 87255,
`alignment_links` 14579, `prep_action_*`, `doc_relations`, `unit_roles` — comparées ligne
à ligne entre l'ancienne base et la neuve, aucun écart. `UPDATE units` fonctionnait
pendant que tout le reste échouait.

**Une anomalie annexe, hors FTS** : l'index de clé primaire de `runs` portait une entrée
sans ligne (un démarrage `serve` du jour même). `PRAGMA integrity_check` ne la signale
pas — il a fallu comparer `COUNT(*)` (qui répond depuis l'index) à un parcours de table
forcé par `NOT INDEXED`. À retenir comme méthode : sur une base suspecte, `integrity_check`
seul ne suffit pas.

**Ce qui ne marche pas** — six voies mesurées, chacune sur une copie fraîche :
`INSERT INTO fts_units(fts_units) VALUES('rebuild')`, `'optimize'`, `'delete-all'`,
`DELETE FROM fts_units` puis remplissage, `DROP TABLE fts_units`, `VACUUM`. Toutes
échouent : ce qui *touche* l'arbre corrompu meurt en le touchant.

**Ce qui marche** — deux voies, l'une et l'autre vérifiées de bout en bout :

- *chirurgie sur place* — retirer les six entrées `fts_units*` du schéma par
  `PRAGMA writable_schema`, recréer la table virtuelle, la remplir depuis `units`,
  `VACUUM` (récupère les ~100 pages orphelines), `REINDEX runs`. Aboutit à
  `integrity_check: ok` ;
- *reconstruction dans un fichier neuf* — recopier les 21 tables saines, refabriquer
  l'index. `integrity_check: ok` d'emblée, 7 s, et surtout : la base d'origine n'est
  jamais écrite. C'est la voie retenue le 25 août.

L'index se refabrique intégralement depuis `units.text_norm` — `fts_units` est une table
FTS5 ordinaire (migration 002), sa seule source de vérité est la colonne. **Aucune perte
de données n'est en jeu dans une corruption d'index** ; ce qui est en jeu, c'est le temps
perdu à comprendre pourquoi l'application dit « internal error ».
