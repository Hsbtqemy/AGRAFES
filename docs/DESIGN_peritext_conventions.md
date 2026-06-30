# Notes de design — Annotation péritextuelle, conventions & alignement positionnel

> Statut : **intention de design — à valider** (décisions cadrantes prises avec l'utilisateur, détails d'implémentation ouverts). · **Révisé 2026-06-30 (voir §0)** : outil général multi-corpus, multi-stade, capacités indépendantes.
> Date : 2026-06-30. Cible : `multicorpus-engine` v0.4 (post-0.3.3) + `tauri-prep` / `tauri-app`.
> **Ancrage code (fichier:ligne, points de greffe, découpage T1-T6) : [`DESIGN_peritext_conventions_grounding.md`](DESIGN_peritext_conventions_grounding.md)** — cette note porte les décisions, le compagnon porte l'implémentation.

## 0. Recadrage (2026-06-30) — outil général, multi-stade, capacités indépendantes

> Cette section **prime** sur les hypothèses de cadrage des §1 et §6. Les mécaniques ancrées au code (lift §3, garde-fous §5, inventaire §7, aligneur T6) restent valides — **en tant que capacités**, pas comme étapes d'un pipeline figé.

**Portée — outil général, pas un corpus.** L'outil monte et traite **plusieurs bases**, de conventions inconnues. Le schéma de l'utilisateur (`[T]`/`[Ch]`/`[InterT]`, segments `[N]`, séparateur `¤`) est **un exemple d'entrée, pas le modèle**. Toute solution qui s'appuie sur un marqueur précis (`[N]`, `¤`) est **overfit** : le bon niveau d'abstraction est le **type de source de frontière**, jamais le caractère.

**Pas d'état de départ unique** (corrige §1/§6). L'hypothèse « importer en ¶ → descendre vers la phrase » est fausse. Relevé sur une base réelle : les documents coexistent à **tous** les stades — brut (1 unité-blob), grossier, phrases, aligné —, parfois **désynchronisés par paire** (un côté numéroté, l'autre non). Le modèle n'est donc **pas un pipeline linéaire**.

**Capacités indépendantes, pas étapes.** Chaque opération doit s'appliquer à un document **à n'importe quel stade** : (1) segmenter grossier · (2) segmenter fin · (3) aligner par clé · (4) aligner par algorithme · (5) lever marqueurs → rôles · (6) garde-fous. La séquence §6 reste une *séquence possible*, pas une obligation.

**Segmentation = multi-niveaux à indices pluggables.** Au moins deux grains : **grossier** (paragraphe/bloc) = *ancre* ; **fin** (phrase/segment) = *analyse*. Les frontières viennent de **sources configurables**, en priorité/fallback :

- **(a) structure déjà présente dans l'entrée** — numérotation, séparateurs, paragraphes du source : à **récolter**, pas reconstruire ;
- **(b) rôles structurels** (titre/intertitre/chapeau) ;
- **(c) heuristiques texte** (ligne vide, ligne-titre non taggée) ;
- **(d) ponctuation** (packs de langue).

Le grain grossier est **persisté** (`meta_json.parent_*`, sans migration). **Défaut actuel à corriger** : la segmentation **capture le fin et jette le grossier**.

**Alignement = par-clé OU par-algorithme, les deux de premier rang.**

- **Par-clé** (`external_id`) quand l'entrée porte une numérotation **appariée** (méthode manuelle) — alignement quasi gratuit ;
- **Par-algorithme** (longueurs / Gale-Church **borné par ancre**, T6) pour le cas **général non numéroté**.

L'outil **offre les deux** et affiche la provenance. Ne **pas** déprioriser l'aligneur sous prétexte qu'un corpus donné est numéroté — un autre ne le sera pas.

## 1. Cadre & périmètre

> ⚠️ **Cadrage révisé (voir §0 ci-dessus)** : outil général multi-corpus, multi-stade. Les formulations « corpus journalistique » et « importer en ¶ → descendre » ci-dessous sont des **exemples d'usage**, pas le périmètre de l'outil.

**But.** Outiller dans AGRAFES le process **segmentation → annotation → alignement**
d'un corpus parallèle journalistique (original ↔ traduction) à partir de **textes
bruts en paragraphes pas encore traités**, en s'appuyant sur le schéma d'annotation
péritextuelle existant de l'utilisateur (`[T]` titre, `[Ch]` chapeau, `[InterT]`
intertitre, `[P]` phrase, `[S]` segment parenthétique, `[non traduit]`, `[+]` ajout).

**Contexte — la méthode manuelle marche déjà.** Aujourd'hui l'annotation se fait à la
main dans Word : marqueurs collés **en fin de ligne** + paragraphes-placeholder
`[non traduit]` insérés pour **garder les compteurs de paragraphes synchronisés**
entre les deux langues. Vérifié sur les fichiers réels
`docs/6_M-GW-OrFr-2011_Aligné.docx` (FR, 36 ¶) et `docs/6_M-GW-TrEn-2011_Aligné.docx`
(EN, 36 ¶) : importés en mode `docx_paragraphs`, ils s'alignent **36/36, couverture
100 %, 0 orphelin** par alignement positionnel. La méthode est bonne ; l'objectif est
de la rendre **précise, efficace et propre** dans l'outil.

**Corpus historique (20+ ans).** Le corpus de travail, commencé vers 2000, a été
**aligné à la main**. Le but n'est **pas** de le réaligner mais de l'**ingérer en
préservant le travail manuel** (import positionnel → alignement gratuit) tout en
ouvrant des traitements **automatiques** sur les textes neufs. Les deux régimes
cohabitent dans le même corpus ; les liens manuels sont **protégés** d'un éventuel
auto-alignement (`protected_pairs`). La **flexibilité multi-grain/multi-méthode** est
une exigence de premier rang, pas un confort.

**Grain d'analyse = la PHRASE (décision structurante).** Le but du programme est
l'**étude linguistique contrastive à la phrase** ; le concordancier sert à des
recherches précises sur des unités-phrases. Le paragraphe n'est **pas** le grain
final : c'est une **ancre d'alignement** (§6). Cela invalide une version antérieure de
cette note qui visait l'alignement au paragraphe.

**Dans le périmètre — aligneur de phrases (révision).** L'alignement phrase↔phrase
est désormais **dans** le périmètre, mais en **deux niveaux** (§6) : paragraphe = ancre,
phrase = grain, via un aligneur **par longueurs (type Gale-Church) borné par paragraphe**,
**sans nouvelle dépendance** (DP sur longueurs, stdlib). La similarité char-level
existante ([aligner.py L746](../src/multicorpus_engine/aligner.py#L746)) reste
inutilisable FR↔EN et n'est **pas** l'aligneur visé.

**Hors périmètre — décision explicite.**

- **Pas d'alignement à plat** phrase-sur-tout-le-document (fragile). On passe par les
  ancres paragraphe (§6).
- **Pas de migration forcée** des corpus déjà annotés en inline. Le lift (§3) est une
  étape *offerte*, pas imposée.

**Choix cadrants validés.**

| Axe | Décision | Raison |
|-----|----------|--------|
| Grain d'analyse / recherche | **Phrase** | C'est l'objet du programme (contrastif à la phrase) ; le concordancier interroge des unités-phrases. |
| Méthodes d'alignement | **Auto ET semi-manuel coexistent** (1er rang, pas l'un repli de l'autre) | Corpus de travail 20+ ans aligné à la main ; nouveaux outils auto. Le moteur protège déjà les liens manuels lors d'un auto (`protected_pairs`). Chaque lien porte sa provenance (`run_id`, `status`). |
| Alignement | **Phrase, à deux niveaux** : bloc = ancre → phrases alignées *dans* la paire | Décompose le cross-langue en sous-problèmes bornés ; aligneur par longueurs fiable sur 2-4↔2-4 phrases. |
| Ancre de bloc | **Parent ¶ persisté OU blocs dérivés des rôles structurels** (`[InterT]`/`[T]`/`[Ch]`) | Double source : le parent paragraphe (fin, à persister) et les marqueurs structurels qui survivent à la segmentation (re-découpage en sections). |
| Couche d'annotation | **Conventions / rôles** (`unit_role`, user-defined) | Filtrable, recherche propre, badges. Remplace les marqueurs inline. Reste **permissif** : vocabulaire libre. |
| « Non traduit » | **Rôle + valeur d'affichage**, `text_norm` vide | Le placeholder reste une unité réelle (garde la position) mais ne pollue pas la FTS. |
| Marqueurs inline | **Levés en rôles à l'import** (étape dédiée) | Sinon : soit pollution FTS (inline gardé), soit perte des placeholders vides (import les supprime). |
| Dépendances | **Aucune nouvelle** | Tout se fait avec le modèle existant (`unit_role`, `text_raw`/`text_norm`) + stdlib. |

## 2. Modèle-cible

Le schéma de l'utilisateur mélange **deux axes** qu'AGRAFES sépare ; il faut les
distinguer dans le modèle.

| Axe | Marqueurs | Porté par |
|-----|-----------|-----------|
| **Type d'élément péritextuel** | `[T]` `[Ch]` `[InterT]` `[P]` `[S]` | `unit_role` (catégorie `structure`/`text`) |
| **Statut de traduction** | `[non traduit]`, `[+]` (ajout) | statut au niveau **unité** ou **lien d'alignement** (à figer, §8) |

État-cible d'une unité, à l'exemple du « chapeau non traduit » (FR a le texte, EN ne
l'a pas) :

| | `unit_role` | `text_raw` (affiché) | `text_norm` (indexé FTS) | statut |
|--|--|--|--|--|
| FR ¶3 | `chapeau` | « Exposé à Paris… » | « exposé à paris… » | — |
| EN ¶3 | `chapeau` | `[non traduit]` | **vide** | `non_traduit` |

Bénéfices :
- recherche « apartheid » → **aucun** bruit `[T]`/`[non traduit]` (aujourd'hui le
  tokenizer `unicode61`, [002_fts5_index.sql](../migrations/002_fts5_index.sql),
  indexe `[non traduit]` comme `non`+`traduit`) ;
- requête « tous les chapeaux non traduits » = **filtre par rôle + statut**, pas une
  recherche texte fragile ;
- le placeholder **reste une unité** → l'alignement positionnel garde les compteurs
  synchronisés (le « déplacement de lignes vides » devient propre).

## 3. Étape de « lift » marqueurs → rôles

Transformer le texte annoté inline en modèle structuré. À l'import (mode
`docx_paragraphs`) ou en passe post-import dédiée.

Pour chaque unité :
1. extraire les marqueurs en fin de ligne (`\[[^\]]+\]`) ;
2. mapper type → `unit_role`, statut → champ statut (table de correspondance figée) ;
3. retirer les marqueurs de `text_norm` (recherche propre) ; les garder dans
   `text_raw` (affichage verbatim) ;
4. pour un placeholder pur (`[non traduit]`, `[+]` seul) : `text_norm = ""`,
   `text_raw` = label, `unit_role`/statut posés.

Points d'attention mesurés :
- l'import **supprime les paragraphes vides**
  ([docx_paragraphs.py L59-60](../src/multicorpus_engine/importers/docx_paragraphs.py#L59)) →
  le lift doit s'exécuter **tant que le placeholder porte encore son texte** (avant
  tout vidage), sinon il disparaît ;
- les styles `Heading` sont déjà auto-mappés `intertitre`
  ([docx_paragraphs.py L82](../src/multicorpus_engine/importers/docx_paragraphs.py#L82)) ;
  les fichiers de l'utilisateur utilisent `List Paragraph`/`Normal (Web)` → pas de
  collision, le lift gère le cas marqueur-en-texte ;
- `text_start_n` ([segmenter.py L22](../src/multicorpus_engine/segmenter.py#L22))
  distingue paratexte / corps : titre & chapeau en deçà, protégés de la segmentation.

## 4. Contrat d'affichage du concordancier

**Manque mesuré** : le concordancier ([tauri-app/src/ui/results.ts](../tauri-app/src/ui/results.ts))
**ignore `unit_role`** et n'affiche que `text_norm`
([query.py L313](../src/multicorpus_engine/query.py#L313) renvoie `text_norm` comme
`text`). Ses seuls badges sont langue + « source modifiée ».

À livrer :
1. la requête de concordance **remonte `unit_role` (+ label/couleur de la convention)
   et une valeur d'affichage** (= `text_raw` ou label de rôle) ;
2. le concordancier **rend** : badge de rôle + valeur d'affichage quand `text_norm`
   est vide (sinon cellule blanche pour un placeholder role-only) ;
3. en vue parallèle, la cellule en face de l'original montre `[non traduit]`
   (label du rôle), pas un blanc, **sans** que ce soit un résultat de recherche.

## 5. Garde-fous d'alignement (anti-dérive)

L'alignement positionnel est fiable **tant que les compteurs sont synchronisés**.
Mesuré : une dérive de longueur est rattrapée (couverture < 100 % + orphelins) ;
une **dérive compensée** (compteurs égaux, contenu décalé) passe le `qa-report` à
`severity=ok` / 100 % → invisible. Deux garde-fous, **aucun n'existe aujourd'hui** :

**5a. Pré-vol (avant alignement).** Refuser un alignement positionnel si pivot et
cible n'ont pas le même nombre de paragraphes. **Bloquant mais acquittable** :
- remonter `missing_in_target`/`missing_in_pivot` (déjà calculés par
  [align_pair](../src/multicorpus_engine/aligner.py#L176)) **et** localiser la
  divergence (diff sur compteurs + séquence de marqueurs) ;
- **recovery** : ajouter le placeholder manquant dans la source → ré-import → ré-aligne ;
- **override** : forcer le gate → repli sur l'appariement manuel de l'AlignPanel
  (orphelins + retarget existants). Jamais de cul-de-sac.

**5b. Post-check d'ancres (après alignement).** Pour chaque lien, comparer le
**marqueur structurel** (`[T]`/`[Ch]`/`[InterT]`/`[P]`/`[S]`, statut exclu) du pivot
et de la cible ; toute incohérence = dérive **localisée à la ligne**. Extension
naturelle de `qa-report`. Limite **assumée** : n'attrape que la dérive qui *traverse*
une ancre ; une dérive compensée dans une longue zone sans marqueur reste au seul
recours de la relecture accept/reject (cas rare = double erreur en zone nue).

## 6. Alignement phrase à deux niveaux — pipeline

> ⚠️ **Séquence *possible*, pas obligatoire** (voir §0). Les étapes ci-dessous sont des *capacités* applicables à un document à n'importe quel stade ; un corpus déjà segmenté/numéroté en saute plusieurs.

Objectif : des **liens phrase↔phrase** pour le contrastif, sans aligneur cross-langue
à plat. On utilise le paragraphe comme **ancre**.

1. Import paragraphes (FR + EN) → unités `line`, `external_id` = position.
2. Lift marqueurs → rôles/statuts (§3). `text_start_n` posé (paratexte vs corps).
3. **Correspondance des paragraphes** : positionnelle (placeholders → 1-à-1) pour les
   textes annotés ; pour du brut, positionnelle + tolérance ou ratio de longueur.
4. **Segmentation phrase** de chaque côté, **en persistant le paragraphe parent** sur
   chaque phrase (cf. trou ci-dessous).
5. **Alignement des phrases borné par bloc** : pour chaque ancre `k`, aligner
   phrases-FR(k) ↔ phrases-EN(k) par DP sur longueurs (Gale-Church), gérant
   1-1 / 1-2 / 2-1 / **1-0** (`non_traduit`) / **0-1** (`ajout`). Les marqueurs
   `[non traduit]`/`[+]` sont des **signaux de gap** explicites.
6. **Revue** accept/reject dans l'AlignPanel (auto + humain). Les liens manuels
   existants sont **protégés** (`protected_pairs`) si on relance l'auto.

**Deux sources d'ancre `k` (flexibilité).**

- **(a) Parent ¶ persisté** — fin, robuste, mais à construire :
  [`resegment_document`](../src/multicorpus_engine/segmenter.py#L527) pose
  `external_id = NULL`, **ne trace pas le paragraphe parent**, et **supprime les
  alignements**. Il faut donc persister le parent `k` (méta ou colonne) à la
  segmentation.
- **(b) Blocs dérivés des rôles structurels** — gratuit, plus grossier : les unités à
  rôle `[InterT]`/`[T]`/`[Ch]` **survivent à la segmentation** (le segmenteur
  ré-applique le rôle sur le 1ᵉʳ segment), donc on peut re-découper en sections entre
  marqueurs. Bon quand le texte a des intertitres ; sinon repli sur (a)/positionnel.

L'alignement phrase **n'utilise pas `external_id`** (NULL) mais le couple
(ancre `k`, ordre + longueurs) → c'est l'aligneur neuf de l'étape 5.

> ⚠️ Ordre : segmenter **invalide** l'alignement (ADR-017). On segmente donc *avant*
> d'aligner les phrases ; la correspondance paragraphe (étape 3) doit survivre comme
> **donnée portée par les phrases** (parent `k`), pas comme `alignment_links`.

## 7. Ce qui existe vs ce qui est à construire

| Brique | État | Référence |
|--------|------|-----------|
| Rôles user-defined (`unit_role`, CRUD `/conventions`) | ✅ existe | [013](../migrations/013_unit_roles.sql)/[014](../migrations/014_unit_role_field.sql), `conventions_service.py` |
| Séparation `text_raw` / `text_norm` | ✅ existe | ADR (DECISIONS.md) |
| Import paragraphes, `external_id` = position | ✅ existe | [docx_paragraphs.py](../src/multicorpus_engine/importers/docx_paragraphs.py) |
| Alignement positionnel + `missing_*` | ✅ existe | [aligner.py L176](../src/multicorpus_engine/aligner.py#L176) |
| Coexistence auto/manuel : protection des liens manuels | ✅ existe | `protected_pairs` ([aligner.py L182](../src/multicorpus_engine/aligner.py#L182)) |
| Segmentation phrase (regex, packs, protection abbrév.) | ✅ existe | [segmenter.py](../src/multicorpus_engine/segmenter.py), ADR-017 |
| Protection paratexte (`text_start_n`) | ✅ existe | [segmenter.py L22](../src/multicorpus_engine/segmenter.py#L22) |
| **Persistance du paragraphe parent** sur les phrases | ❌ à construire (auj. `external_id=NULL`, parent perdu) | [segmenter.py L535](../src/multicorpus_engine/segmenter.py#L535), §6 |
| **Aligneur de phrases borné-paragraphe** (longueurs/Gale-Church, gaps) | ❌ à construire (cœur du livrable) | §6 |
| Lift marqueurs → rôles/statuts | ❌ à construire | §3 |
| Axe statut `non_traduit`/`ajout` | ❌ à construire | §2/§8 |
| Concordancier : afficher rôle + valeur | ❌ à construire | §4 |
| Pré-vol compteurs + diff de divergence (au paragraphe) | ❌ à construire | §5a |
| Post-check d'ancres (extension `qa-report`) | ❌ à construire | §5b |

## 8. Décisions à figer avant ticket

1. **Statut de traduction : où le porter ?** Champ sur l'unité (ex. `unit_status`) vs
   sur le lien d'alignement (`alignment_links.status` existe déjà mais sémantique
   `accepted`/`rejected`). Recommandation : **statut au niveau unité** (le « non
   traduit » est une propriété de l'unité, pas seulement du lien).
2. **Marqueurs composés** (`[Ch][+]`, `[non traduit][P]`) : deux axes orthogonaux
   (rôle + statut) suffisent-ils, ou faut-il du multi-rôle ? Recommandation : **rôle
   (1) + statut (1)** couvre tous les cas du schéma — vérifier exhaustivement.
3. **Niveau d'automatisation** (§6) — **tranché : auto ET semi-manuel coexistent**
   (corpus historique manuel préservé + auto sur le neuf, liens manuels protégés).
   Reste à définir l'UX du choix de méthode par texte/lot et l'affichage de la
   provenance d'un lien.
4. **Aligneur de phrases — paramètres** : modèle de longueurs (caractères vs tokens),
   types de correspondances autorisés (1-1/1-2/2-1/1-0/0-1), seuil de confiance pour
   auto-accept vs flag-pour-revue. Comment porter le **parent paragraphe** (méta JSON
   sur l'unité vs nouvelle colonne).
5. **Lift : à l'import ou passe séparée ?** Idempotence, ré-exécution, annulation.
6. **Table de correspondance marqueurs → (rôle, statut)** : la figer (le schéma de
   l'utilisateur est « ajustable » — fixer la version de référence).

## 9. Découpage indicatif en tickets

- **T1** — Axe statut (`non_traduit`/`ajout`) au niveau unité + filtre.
- **T2** — Lift marqueurs → rôles/statuts (passe dédiée, idempotente).
- **T3** — Concordancier : remonter & afficher rôle + valeur (engine query + tauri-app).
- **T4** — Garde-fous alignement : pré-vol compteurs + diff, post-check d'ancres
  (extension `qa-report`). Contrainte sidecar-growth-gate : logique dans
  `services/`, handlers fins.
- **T5** — Persistance du paragraphe parent sur les phrases à la segmentation
  (prérequis du two-level ; aujourd'hui `external_id=NULL` + parent perdu).
- **T6** — Aligneur de phrases borné-paragraphe (longueurs/Gale-Church, gaps
  1-0/0-1 via marqueurs), + intégration AlignPanel (revue accept/reject). Cœur du
  livrable contrastif. Dépend de T5 (et §8.3/§8.4).

> Rappel contrat : tout endpoint sidecar nouveau/modifié ⇒ `sidecar_contract.py` +
> `scripts/export_openapi.py` + commit de `docs/openapi.json` & du snapshot, et penser
> à `SIDECAR_API_CONTRACT.md`.
