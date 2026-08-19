# Audit — système d'alignement (2026-08-18)

**Périmètre.** `aligner.py` (1 236 l.), `gale_church.py`, `services/align_links_service.py` (295 l.),
`services/matrix_export_service.py` (353 l.), les routes `/align*` de `sidecar.py`, le front
`AlignMatrixView.ts` (2 026 l.) et `AlignPanel.ts` (1 950 l.), les migrations 003/004/008/022/026-031,
et la table `alignment_links`.

**Méthode.** Lecture de code + **vérification sur données réelles** (`corpus_agrafes.WORKCOPY.db`,
54 documents, 46 674 lignes indexées) et **appels réels au sidecar** (contrat 1.6.62). Chaque constat
porte sa preuve `fichier:ligne` ou sa mesure. Déclenché par une passe de QA visuelle
(→ [`REVIEW_QA_SHELL_2026-08-16.md`](REVIEW_QA_SHELL_2026-08-16.md)) qui a fait remonter trois défauts d'alignement ;
l'audit les reprend sous les identifiants `ALI-*` et les complète. Le **§11** approfondit la
« famille A » en tranchant ses décisions de conception sur pièce, et **corrige deux
conclusions** des §8 et §10.

---

## 1. Ce qui est solide

À dire d'abord, parce que l'essentiel de la mécanique tient :

- **Suppression de document** (`documents_service.py:355-395`) : ordre correct et complet — liens,
  puis FTS (avant les unités, `rowid = unit_id`), puis unités, relations, historique, document.
- **Index** : unique `(pivot_unit_id, target_unit_id)` (mig 008) qui empêche les doublons, plus des
  index ciblés sur pivot, cible, docs, statut, `source_changed_at` (partiel) et beads.
- **Le paratexte est exclu au chargement** dans toutes les stratégies (`_get_text_start_n`,
  `aligner.py:33-40`, 109-116, 143, 376) : jamais de lien paratexte ↔ texte traduit.
- **Garde-fou de taille** sur la stratégie `similarité` (`_MAX_SIMILARITY_UNITS = 5 000`), avec un
  message qui oriente vers une autre stratégie.
- **Snapshots Mode A** sur les mutations d'unités (merge/split), avec `reverted_by_id` reliant
  l'annulation à son action — vérifié en base sur 6 actions.
- **La modale de propagation compte les liens des deux côtés** (`pivot_doc_id OR target_doc_id`,
  `documents_service.py:182-185`) : un document *cible* est correctement protégé.

---

## 2. Tableau des constats

| ID | Sév | Prio | Constat |
|----|-----|------|---------|
| ALI-01 | 🔴 | P0 | La matrice projette `text_raw` ; le stylo, l'aligneur, la FTS et la curation travaillent sur `text_norm`. Les corrections sont invisibles et la surface de contrôle n'est pas la surface de calcul. |
| ALI-02 | 🟠 | P1 | Stratégie `position` : la borne exclut le paratexte mais ne **rebase** pas la numérotation → n'est correcte que si les deux documents ont exactement le même nombre de lignes d'en-tête. |
| ALI-03 | 🟠 | P1 | La fusion d'unités supprime les liens **sans confirmation**, et l'annulation ne les restaure **jamais**. |
| ALI-04 | 🟠 | P1 | Gale–Church dépend entièrement du grain de paragraphes ; **rien ne compare les deux grains** (l'avertissement d'ALI-12 ne couvre que la présence d'une ancre) → grain dégénéré = alignement absurde présenté avec assurance. |
| ALI-05 | 🟡 | P3 | DP `length_bounded` : le garde-fou **existe** (`_MAX_LENGTHS = 5 000`) — constat initial corrigé en passe adverse ; subsiste que le pire cas admis alloue deux matrices pleines (~400 Mo). |
| ALI-06 | 🟠 | P1 | Le « % » du sélecteur de cible est une **proximité de marqueur**, pas une ressemblance de texte. |
| ALI-07 | 🟠 | P2 | Aucune propagation d'une correction manuelle : la réparation est O(n) gestes, sans capitalisation. |
| ALI-08 | 🟡 | P2 | `alignment_links.external_id` (NOT NULL, indexé, documenté « the shared external_id anchor ») contient en réalité une valeur **dépendant de la stratégie**. |
| ALI-09 | 🟡 | P2 | FK sans `ON DELETE` : sûr aujourd'hui parce que **chaque** chemin supprime explicitement, mais l'invariant n'est ni documenté ni testé. |
| ALI-10 | 🟡 | P2 | Resegmentation et propagation détruisent les liens **sans laisser de trace** dans `prep_action_history`. |
| ALI-11 | 🟡 | P2 | Trous de test : `text_start_n` absent des tests d'alignement ; la projection matrice n'est jamais confrontée à `text_norm`. |
| ALI-12 | 🟠 | P1 | Le diagnostic préalable **existe et est bon** (constat initial corrigé), mais son critère d'ancrage n'a **aucun seuil de couverture** : 1 ligne porteuse sur 1 231 suffit à éteindre l'avertissement. |
| ALI-13 | 🟠 | P1 | Le bead posé par le ⭙ **masque une collision légitime** — risque jugé résiduel en §5, **matérialisé** en §8 (voir ALI-22). |
| ALI-14 | 🟢 | P3 | L'avertissement d'ancrage dit quoi faire, jamais **pourquoi** : segmenter et ancrer sont confondus. |
| ALI-15 | 🟠 | P1 | Impossible de réaligner **une seule langue** depuis l'UI ; le moteur sait le faire, le wrapper front existe et n'est appelé nulle part. |
| ALI-16 | 🟡 | P2 | Aucun effectif par colonne : la comparabilité des grains, qui décide de la qualité, n'est pas lisible. |
| ALI-17 | 🟠 | P1 | Réaligner après une **coupe d'unité** superpose une couche au lieu de la remplacer — l'unicité porte sur la paire d'unités. |
| ALI-18 | 🟠 | P1 | Chaque geste re-projette la famille entière, toutes langues comprises : ~2 s pour une cellule sur 7 652. |
| ALI-19 | ✅ | ~~P0~~ | Aucune statistique SQLite (`ANALYZE` jamais lancé) → mauvais index sur un `NOT EXISTS` corrélé. **17,6×** pour 46 ms. |
| ALI-20 | 🟡 | P2 | Pas de bandeau d'annulation dans l'Alignement, **y compris pour les deux gestes qui sont journalisés** (✎, ¶). |
| ALI-21 | 🟡 | P2 | Gestes de cellule invisibles au repos, glyphe ↻ ≠ ↺ annoncé, et refus `_cutBusy` totalement muet. |
| ALI-22 | 🟠 | P1 | Le ⭙ n'a pas d'inverse ; la réparation intuitive (＝) laisse la cible sur **deux** segments, masquée par le bead. **Démontré en base.** |

> ALI-13 est traité en §5 (passe beads) ; ALI-14 à ALI-22 en §7 à §10 (passes du 2026-08-19) ; §10 chiffre le correctif d'ALI-10/ALI-17 ; le **§11** approfondit la famille « données
> détruites » (ALI-03/10/17/22 + QA-06) et tranche ses décisions de conception.

---

## 3. Détail

### ALI-01 🔴 — deux plans de texte, deux surfaces (= QA-09)

`matrix_export_service` projette `text_raw` partout : lignes moyeu (l. 128 et 287), cellules de
traduction (l. 171 → `target_text_raw`), orphelines (l. 209, 231). Le stylo écrit `text_norm` et
préserve `text_raw` (invariant D-C1, voulu). L'aligneur (`aligner.py:379, 1042, 1085, 1093`), la
recherche FTS et la curation travaillent **tous** sur `text_norm`.

**Preuve** (payload réel, doc 416 segment 200) : `cellule == text_raw` → vrai ;
`cellule == text_norm` → faux.

Double conséquence : (a) une correction au stylo dans la matrice n'y apparaît **jamais** — la
fonctionnalité livrée en juillet (`f626c79`) est inopérante du point de vue de l'utilisateur ;
(b) **vérifier visuellement un alignement, c'est juger sur une colonne que le système n'utilise
pas**. Atténuation : pour une unité non corrigée, l'écart raw/norm est purement typographique.

**Aggravation découverte en seconde passe adverse (2026-08-19) — ce n'est pas qu'un défaut
d'affichage, une correction peut en effacer une autre.** L'éditeur inline de la matrice est amorcé
avec le texte du view-model, donc **`text_raw`** (`AlignMatrixView.ts:604-634` : `text = r.hubText`
/ `c.text`), et la sauvegarde envoie ce contenu à `updateUnitTextNorm`, qui écrit **`text_norm`**
(l. 681-700). On édite donc **toujours à partir du texte d'origine, jamais de sa propre
correction**.

*Scénario de perte* : corriger une coquille (→ `text_norm` juste) ; rouvrir plus tard le stylo sur
la même cellule pour une autre coquille → la zone de saisie affiche le texte **d'avant la première
correction** ; enregistrer → **la première correction est écrasée**, sans avertissement. Un
garde-fou limite la casse (`if (newText === oldText) return`) : une ré-ouverture sans modification
est inoffensive ; la perte exige une seconde édition réelle.

*À noter* : les commentaires du code décrivent l'intention inverse — « seeded from its `text_norm` »
(l. 636) et « on success re-project the matrix (**shows the corrected text**) » (l. 681-683). Le code
a été écrit contre une spécification que la projection ne respecte pas ; ce n'est pas un oubli
d'intention, c'est un contrat rompu entre deux couches.

*Conséquence sur le correctif* : même si l'on décidait de ne **pas** changer la projection de la
grille, l'**amorçage de l'éditeur** doit impérativement venir de `text_norm`. C'est le minimum vital,
et c'est indépendant du choix d'affichage.

**Correctif** — pas un simple changement de colonne : les tranches de coupe sont des offsets sur
`text_raw` (`target_char_start/end`). Pistes : projeter `text_norm` **seulement** pour les unités
portant une correction ; ou transporter les deux et trancher côté front ; a minima signaler la
divergence dans la cellule.

### ALI-02 🟠 — `position` n'est pas rebasé sur la borne (= QA-10)

```python
pivot_pos  = {n: uid}                    # filtré n >= text_start_n
target_pos = {n: uid}                    # filtré n >= text_start_n
common = sorted(pivot_ns & target_ns)    # ← intersection des n ABSOLUS
```
(`aligner.py:800-856`)

Mesuré : corps FR = n 4→1231, corps EN = n 3→1269 ; l'intersection démarre à 4, donc **la première
phrase du texte anglais (n=3) n'appartient à aucune paire possible**. Décalage de 2 dès l'ouverture
(le FR a 3 lignes d'en-tête, l'EN 2 ; le numéro de chapitre est côté texte en FR, côté paratexte en
EN), puis dérive variable (vérifié aux segments 300, 800, 1200).

**Ce n'est pas une violation de spec mais une ADR périmée** : ADR-013 (2026-02-28) décide
« alignment by shared sequential position `n` », **avant** l'arrivée du modèle de paratexte
(R4.1, migration 023). Jamais réconciliées.

**Correctif** : apparier par **rang dans le corps** (i-ème ↔ i-ème) au lieu de l'intersection des
`n`. Quelques lignes ; annule d'un coup tout décalage constant d'en-tête. Mettre ADR-013 à jour.

### ALI-03 🟠 — la fusion détruit des liens sans prévenir, et l'undo ne les rend pas

- `_handle_units_merge` supprime les liens des deux unités (`sidecar.py:4988-4992`) — documenté.
- Le front appelle `mergeUnits` **sans aucune confirmation** (`SegmentPane.ts:583`), alors que
  `needsAlignmentConfirm` existe et n'est câblé que sur deux autres chemins (l. 760 et 1087).
- `undo.py` ne **restaure** jamais un lien : il les re-marque périmés (l. 139-160) ou les **supprime**
  (l. 340, undo de split). Fusionner puis annuler = unités rendues, **liens perdus définitivement**.

Le commentaire `undo.py:335-340` montre que l'absence d'`ON DELETE CASCADE` était connue ; la
décision a été de supprimer, pas de restaurer.

**Correctif** : confirmation quand la sélection porte des liens (réutiliser `needsAlignmentConfirm`)
et, si l'annulation doit être honnête, snapshot des liens supprimés dans l'action.

### ALI-04 🟠 — Gale–Church repose sur un grain de paragraphes, en silence

La stratégie est **à deux étages** (`aligner.py:421-423`) : appariement des blocs grossiers par
longueur, puis des phrases à l'intérieur de chaque paire. Les blocs viennent de
`derive_coarse_blocks` (`parent_n`).

**Mesuré** : doc 416 = 1 231 lignes / **10** paragraphes ; doc 364 = 1 269 lignes / **1 268**
paragraphes. L'étage supérieur devait apparier 10 blocs contre 1 268 → **33 liens sur 1 231** (2,7 %
de couverture), sémantiquement absurdes. **Nuance apportée par la passe adverse (2026-08-19)** : un avertissement préalable existe bien
(cf. **ALI-12**), mais il porte sur la **présence d'une ancre**, pas sur la **comparabilité des
grains**. Ici il s'est tu pour deux raisons cumulées : le seuil d'ancrage absent (ALI-12) a
déclaré les deux documents ancrés, et **rien ne compare 10 paragraphes à 1 268**. Le résultat est
donc produit avec la même assurance qu'un alignement réussi.

Aggravant : les deux structures avaient été dégradées par des gestes de l'application elle-même
(le « Pré-remplir » de Tours a réduit 416 à 3 paragraphes ; la propagation appliquée a laissé 364
avec un paragraphe par ligne).

**Correctif** : refuser ou avertir quand le rapport entre les deux grains est aberrant (ex. un ordre
de grandeur d'écart), et expliciter la dépendance dans l'UI de choix de stratégie.

### ALI-05 🟡 — le garde-fou existe ; le pire cas admis reste lourd

> **Corrigé lors de la passe adverse (2026-08-18).** La version initiale de cet audit affirmait
> « aucun garde-fou de taille ». **C'était faux.** `gale_church.py:42` définit
> `_MAX_LENGTHS = 5_000` et lève une `ValueError` explicite au-delà (l. 80-83), en référence à la
> garde par dimension de l'aligneur. L'erreur venait d'une recherche menée *dans*
> `align_pair_length_bounded` alors que la garde vit un niveau plus bas, dans `gale_church_beads`.

Ce qui subsiste, très atténué : la garde borne l'**entrée**, pas l'**allocation**.
`gale_church_beads` alloue `cost` **et** `back` en matrices pleines `(n+1) × (m+1)`
(`gale_church.py:88-89`), sans bande ni faisceau — au plafond autorisé (5 000 × 5 000), cela fait
deux matrices d'environ 25 M de cellules, soit de l'ordre de 400 Mo de listes Python. L'échec est
propre au-delà, mais le maximum admis est déjà peu praticable.

**Piste, non urgente** : DP en bande (Gale–Church se prête au fenêtrage), ou plafond effectif plus
bas quand les deux dimensions sont grandes simultanément.

### ALI-06 🟠 — le score du sélecteur n'est pas une ressemblance (= QA-08)

`build_retarget_candidates` (`align_links_service.py:193-250`) score par proximité de marqueur :
`1.0` si `external_id` identique, sinon `1/(1+Δ)` dans une fenêtre de 5. Les valeurs observées
(100, 50, 50, 33, 33, 25, 25, 20, 20, 17 %) sont exactement cette formule. **Le texte n'entre jamais
dans le calcul** : un candidat au texte identique au pivot est affiché à 25 % pendant qu'un texte
sans rapport est à 100 %.

**Correctif** : étiqueter honnêtement (« voisin ±3 » plutôt qu'un %) **et** ajouter un signal
lexical en départage — `text_norm` est disponible des deux côtés, et les unités structurelles
identiques (numéros de chapitre, intertitres) sont le cas le plus fréquent et le plus décisif.

### ALI-07 🟠 — aucune capitalisation sur une correction manuelle (= S-03)

`/align` n'accepte que `pivot_doc_id` + `target_doc_ids` (`sidecar.py:6532`) : tout ou rien, pas de
plage, pas de reprise. Et `build_retarget_candidates` ancre chaque pivot sur **son propre** lien
courant : corriger le segment 33 n'apprend rien au 34. Sur une dérive constante — le cas typique —
l'utilisateur refait N fois la même correction.

**Piste** : après un ré-ancrage, proposer « décaler la suite de Δ » jusqu'au prochain lien validé.
Mutation de masse → prévoir aperçu **et** undo.

### ALI-08 🟡 — `external_id` porte une valeur dépendant de la stratégie

Colonne `NOT NULL`, indexée (`idx_alinks_ext`), documentée « the shared external_id anchor ».
**Mesuré** : sur le run positionnel du doc 416, elle contient la **position `n`** (1228, 1229, 1230,
1231) alors que 2 unités sur 1 231 ont un `external_id` réel. Un consommateur ne peut pas savoir si
la valeur est un marqueur ou un rang.

**Correctif** : soit rendre la colonne nullable et n'y mettre qu'un vrai marqueur, soit ajouter une
colonne `anchor_kind` — avec migration et mise à jour du contrat.

### ALI-09 🟡 — FK sans `ON DELETE` : correct par discipline, pas par construction

`pivot_unit_id` et `target_unit_id` référencent `units(unit_id)` **sans clause `ON DELETE`**. C'est
sûr aujourd'hui parce que **tous** les chemins suppriment les liens d'abord (`segmenter.py:476` et
`:703`, `sidecar.py:4616`, `documents_service.py:364`). Mais rien ne le garantit pour le prochain
chemin de suppression, et aucun test ne pose l'invariant.

**Correctif** : test de garde (supprimer une unité liée sans purge préalable doit échouer
bruyamment) + note dans `DECISIONS.md`.

### ALI-10 🟡 — les destructions massives ne laissent aucune trace

Une propagation appliquée a supprimé **1 267 liens** et recréé les unités du doc 364 : aucune ligne
dans `prep_action_history` entre l'action `#167` (18:10) et la suivante (18:56). L'utilisateur est
prévenu **avant** (modale correcte), mais après coup l'historique ne porte rien — impossible de
savoir *quand* ni *par quoi* une structure a été remplacée. Même profil que le « Pré-remplir » de
Tours (cf. QA-06).

### ALI-11 🟡 — trous de test sur les zones exactes des défauts

- **La borne n'est jamais exercée sur un chemin d'alignement.** Vérifié deux fois : `text_start_n`
  n'apparaît dans aucun des 6 fichiers `test_align*.py` (55 tests) ; et en resserrant sur les tests
  qui **appellent réellement** une fonction d'alignement — il n'y en a que deux
  (`test_align_cell_status_service.py`, `test_align_length_bounded.py`) — **aucun** ne pose de
  `text_start_n`. C'est précisément le sujet d'ALI-02.
- `test_matrix_export_service.py` crée pourtant des fixtures où `text_raw` ≠ `text_norm`
  (`'Le matin.'` / `'le matin.'`) mais **aucune assertion ne confronte la projection à `text_norm`**
  — ALI-01 serait tombé sous ce test.

### ALI-12 🟠 — le diagnostic préalable existe, mais son critère d'ancrage n'a **aucun seuil**

> **Corrigé lors de la passe adverse (2026-08-19).** La version initiale affirmait « aucun
> diagnostic préalable ». **C'était faux** — et là encore par généralisation d'une absence
> constatée côté moteur : le diagnostic vit dans le **front** (`lib/anchorWarn.ts`), alimenté par
> `anchor_status` que la projection matrice expose déjà (je l'avais même sous les yeux dans un dump
> de payload sans le suivre). Il est **bien conçu** : conscient de la stratégie choisie
> (`LENGTH_CAMP`), il distingue « pas d'ancre » de « ancre inutilisée par cette stratégie »,
> évite les avertissements redondants quand le moyeu est déjà signalé, et **prescrit un remède**
> (« ni numéros [N] ni paragraphes — ré-importer numéroté, ou regrouper les lignes par une
> frontière »).

**Le défaut réel, plus précis et plus grave** : le critère d'ancrage par marqueur n'a **aucun seuil
de couverture**. `_external_id_anchor` (`anchoring.py:38-57`) retourne `"value"` dès qu'**une seule**
ligne porte un `external_id ≠ n` :

```python
carriers = [u for u in lines if u.get("external_id") is not None]
if not carriers: return None
for u in carriers:
    if int(u["external_id"]) != int(u["n"]): return "value"   # ← une suffit
```

**Mesuré sur la base de QA** :

| Document | Lignes porteuses | Total | Verdict |
|---|---|---|---|
| 416 `Beigbeder_FR` | **2** (n=2→ext=5, n=3→ext=6) | 1 231 | « ancré (value) » → **silence** |
| 364 `Beigbeder_EN` | **1** | 1 269 | « ancré (value) » → **silence** |
| 373 `Modiano_FR` | 0 | 1 913 | non ancré → **avertit correctement** |

Deux marqueurs résiduels — vestiges de l'import, la segmentation en phrases ayant consommé les
autres — suffisent à déclarer 1 231 lignes ancrées. L'avertissement s'éteint donc **exactement dans
le cas où il serait décisif**, et l'utilisateur lance un alignement qui dérive sans avoir été
prévenu (constaté en session : couverture aberrante côté Gale–Church, puis 100 % de liens faux
côté position, sans un mot).

**Corroboration (famille Modiano, 4 membres)** — la même base produit le **bon** verdict et le
**mauvais**, et le discriminant est exactement la couverture :

| Document | Lignes | Porteurs `[N]` | Verdict | Correct ? |
|---|---|---|---|---|
| 373 FR (moyeu) | 1 913 | 0 | non ancré → avertit | ✅ |
| 372 EN | 1 886 | 0 | non ancré → avertit | ✅ |
| 419 ES | 1 859 | **1 858** | ancré → silence | ✅ |
| 420 RO | 1 850 | **1 850** | ancré → silence | ✅ |
| 416 FR (Beigbeder) | 1 231 | **2** | ancré → silence | ❌ |

La logique de classification est donc **saine** ; seule la règle « au moins un porteur suffit » ne
l'est pas. Le correctif est un **seuil**, pas une refonte. (À noter aussi : la granularité
par-colonne de l'avertissement est la bonne, et le message distingue correctement le moyeu —
« tout l'alignement dérivera » — d'une colonne isolée.)

**Correctif** : un **seuil de couverture** (ex. « ancré par marqueur » exige qu'une part significative
des lignes en portent — la valeur est à discuter, mais 1 sur 1 231 ne peut pas suffire), et
idéalement rapporter la **proportion** dans l'avertissement (« 2 lignes sur 1 231 portent un
numéro — l'ancrage ne couvre pas le texte »). À rapprocher d'ALI-02 : la segmentation en phrases
détruit les marqueurs hérités de l'import, donc ce cas est **la norme**, pas l'exception.
**Test à ajouter** : document à 1 porteur sur N lignes → `anchored` doit être faux (RED sur le code
actuel).

---

## 4. Ordre de traitement proposé

> **Mis à jour par le §11 (2026-08-19).** ALI-19 est **traité**. Et l'approfondissement de
> la « famille A » (ce qui abîme les données) a montré qu'ALI-03/10/22 + le §10 ne sont pas
> quatre chantiers mais **un seul** — l'undo ne sait pas restaurer un lien. Pour ces
> constats, l'ordre applicable est celui du **§11.7**, pas celui ci-dessous.

*(Révisé le 2026-08-19 : la première version n'ordonnait qu'ALI-01→12 et précédait dix constats,
dont le seul gain gratuit du lot et les deux chemins de destruction démontrés.)*

**D'abord ce qui ne coûte rien.**

1. **ALI-19** (P0) — `ANALYZE`. 46 ms, aucune migration, aucune ligne de code : la projection
   matrice passe de 1 160 ms à 66 ms. Rien d'autre dans cette liste n'a ce rapport effet/coût, et
   ça soulage ALI-18 des deux tiers de son problème avant même de l'attaquer.

**Ensuite ce qui abîme les données.**

2. **ALI-22** — le ⭙ sans inverse laisse un doublon que son propre bead masque au détecteur de
   collisions. Démontré en base. Au minimum : ne plus beader une cellule dont la cible absorbée est
   déjà portée ailleurs (correctif c), qui referme aussi ALI-13.
3. **ALI-17** — réaligner après une coupe d'unité superpose une couche entière. Le correctif
   minimal est un message honnête ; le correctif réel est « supprimer les liens du run *X* ».
4. **ALI-03** — la fusion d'unités détruit des liens sans confirmation et l'annulation ne les rend
   pas. Même famille de dégât, chemin différent.
5. **§10** — rendre un run réversible. Chiffré, prototypé, restitution à l'octet près : c'est le
   filet qui manque sous 2, 3 et 4, et il referme **ALI-10**.

**Puis ce qui rend l'outil utilisable.**

6. **ALI-01** (le seul 🔴) — trancher la stratégie de projection : la surface de contrôle n'est pas
   la surface de calcul, ce qui rend une fonctionnalité livrée inopérante.
7. **ALI-11** en accompagnement immédiat : les tests manquants sont exactement ceux qui auraient
   attrapé ALI-01 et ALI-02. Les écrire avant les correctifs (RED prouvé sur l'ancien code).
8. **ALI-02** puis **ALI-06** — deux correctifs courts au très fort effet sur la qualité perçue de
   l'alignement automatique.
9. **ALI-15** — le « ⇄ par colonne ». Débloque la réparation de tout le reste : aujourd'hui corriger
   une langue oblige à remettre la famille entière à plat, et à perdre le travail manuel.

**Enfin ce qui informe et ce qui allège.**

10. **ALI-04 / ALI-12 / ALI-16 / ALI-14** ensemble — la famille « dire à l'utilisateur ce qu'il
    regarde » : seuil de couverture d'ancre, comparabilité des grains, effectifs par colonne,
    et la phrase qui explique ce qu'est une ancre. Un même passage de code les couvre.
11. **ALI-18** — patch local puis projection scopée ; le fenêtrage seulement si nécessaire après
    ALI-19.
12. **ALI-20 / ALI-21** — bandeau d'annulation dans la matrice (le moteur est déjà là) et gestes
    qui cessent d'être invisibles au repos et muets en cas de refus.
13. **ALI-07**, **ALI-08**, **ALI-09**, **ALI-05** — à cadrer, aucun n'est bloquant.

> **Passe adverse (2026-08-18).** Les constats ont été repris un à un en cherchant à les **réfuter**,
> pas à les confirmer. Bilan : **ALI-05 était faux** et a été corrigé (garde-fou existant, sévérité
> 🟠→🟡, priorité P1→P3) ; **ALI-03** et **ALI-11** ont été re-vérifiés et **renforcés** (aucune table
> n'archive les liens ; seuls deux tests appellent l'aligneur, aucun ne pose de borne). Les autres
> reposaient déjà sur une mesure ou un payload réel.

## 5. Passe ciblée — le modèle de beads (2026-08-18, second temps)

Zone ouverte en second parce que trois signaux convergeaient : **deux migrations de réparation
successives** (030 backfill, 031 repair), une **collision disparaissant silencieusement**, et — dans
l'en-tête même de 031 — l'aveu d'**un test qui passait pour la mauvaise raison**
(« the dedicated test passed only because it put the legitimate collision on a DIFFERENT pivot »).

**Verdict : le mécanisme est sain aujourd'hui.** Vérifications, toutes sur données réelles :

- **La porte sans retour est refermée.** `clear_bead` était inatteignable au moment de 031 ; il est
  aujourd'hui exposé via `/align/links/batch_update` (contrat 1.6.57, D-W16) et appelé par le front
  (`alignCellCut.ts:356`). Les gestes ⭙ (grouper) et ✂ (dégrouper) sont symétriques.
- **Les deux identités de bead sont tenues synchrones.** `(run_id, bead_id)` (mig 022) et `bead_uid`
  (mig 026) coexistent ; l'aligneur écrit **les deux** (`aligner.py:493-494, 511, 519`).
  Mesure : **0** lien porte un `bead_id` sans `bead_uid`. La détection de collision, qui ne groupe
  que par `bead_uid` (`qa_report.py:178`), ne peut donc pas manquer un bead produit par l'aligneur.
- **Aucun résidu de la pathologie réparée par 031.** Les 2 seuls beads de cellule multi-liens
  groupent chacun **un lien aligneur + un lien manuel** — précisément le cas de curation que le
  modèle K3 visait, pas les « ≥2 liens aligneur » que 030 avalait.
- **Pas de fuite d'identité.** Les 5 `bead_uid` couvrant plusieurs pivots sont des beads **2-1**
  légitimes (vérifié : bead `#169` = pivots 183730+183731 → 1 cible unique). L'uid de cellule est
  dérivé de `(pivot_unit_id, target_doc_id)` (`align_links_service.py:105-113`), donc borné à un
  pivot par construction.

### ALI-13 🟢 → 🟠 — risque résiduel assumé : ⭙ peut faire taire une collision légitime

> **Mise à jour 2026-08-19 : ce risque s'est réalisé sur données réelles.** Voir ALI-22 — un ⭙ suivi
> d'un ＝ a laissé une cible sur deux pivots, beadée donc invisible à `/align/quality`.

Par conception, ⭙ Fusionner groupe **tous** les liens actifs d'une cellule en un bead ; si deux de
ces liens venaient de l'aligneur et constituaient une vraie collision à arbitrer, elle disparaît de
`/align/collisions` et du rapport QA. C'est exactement l'effet de la migration 030 — à deux
différences près, qui font toute la différence : le geste est **explicite** (l'utilisateur affirme
« ces N cibles forment un bead ») et **réversible** (✂ appelle `clear_bead`).

**Reste à considérer** : rien ne signale, dans la cellule, qu'un bead masque plusieurs liens
d'aligneur. Une pastille discrète suffirait à distinguer « bead voulu » de « collision endormie ».
Non bloquant.

## 6. Non couvert par cet audit

Statuts de cellule (mig 028/029) au-delà de la vérification du cascade ; `AlignPanel` (« Contrôle »)
dans le détail ; la qualité intrinsèque de l'implémentation Gale–Church (paramètres du modèle de
longueur) ; les exports d'alignement.

*(Les beads, initialement hors périmètre, ont fait l'objet de la passe ciblée du §5.)*

---

## 7. Passe « questions d'usage » (2026-08-19)

Trois questions posées devant l'avertissement d'ancrage de la famille Modiano (moyeu fr 1 913
lignes, en 1 886, es et ro numérotés). Elles portent toutes sur le **pilotage** de l'alignement,
pas sur son calcul — d'où une zone que les six premières passes n'avaient pas touchée.

### ALI-14 🟢 P3 — l'avertissement dit quoi faire, jamais pourquoi

`anchorRemedy` (`tauri-prep/src/lib/anchorWarn.ts`) propose « ré-importer numéroté, ou regrouper
les lignes par une frontière ». Le remède est juste, mais le message n'énonce nulle part ce qu'est
une ancre — un **repère partagé par les deux textes**, sur lequel l'aligneur peut se resynchroniser.
D'où la lecture spontanée, et raisonnable : « ma VO est la référence, elle est segmentée, donc elle
ancre ». Elle ne le fait pas : être le pivot de toutes les paires est un rôle **structurel**,
l'ancrage est une propriété **mesurable** (`anchoring.py` : `external_id ≠ n`, ou `parent_n`).

Le mécanisme, vérifié dans `aligner.py:365-401` : sans `parent_n`, `derive_coarse_blocks` rend
**un bloc par ligne**. L'étage ¶ de Gale–Church devient alors une seule programmation dynamique sur
1 913 blocs d'une phrase, sans aucune frontière où se recaler. Segmenter plus fin **sans** ¶ ne fait
donc qu'augmenter le nombre d'endroits où glisser : c'est le seul cas du système où affiner la
préparation dégrade le résultat.

*Correctif* : une phrase dans l'encart, avant les remèdes — « une ancre est un repère que les deux
textes portent (numéros `[N]` ou frontières de ¶) ; segmenter seul n'en crée pas ».
*Test* : `anchorWarn.test.ts` — l'encart mentionne les deux formes d'ancre.

### ALI-15 🟠 P1 — impossible de relancer une seule langue depuis l'interface

`AlignMatrixView._runAlign` (`tauri-prep/src/screens/AlignMatrixView.ts:451, 541`) n'appelle
qu'`alignFamily` → `POST /families/{id}/align`, qui boucle sur **tous** les enfants
`translation_of`/`excerpt_of` (`sidecar.py:6358-6420`) sans paramètre de filtrage.

Or **le moteur sait déjà le faire** : `POST /align` prend `pivot_doc_id` + `target_doc_ids`
(`sidecar_contract.py:4044-4053`), et la purge de `replace_existing` est scopée à la paire exacte
(`sidecar.py:350-365` : `WHERE pivot_doc_id = ? AND target_doc_id = ?`). Le client front a même
déjà le wrapper — `align()`, `sidecarClient.ts:1571` — **qu'aucun écran n'appelle**.

#### Ce que ça coûte, mesuré sur la famille Modiano (état au 2026-08-19)

| paire | liens | provenance |
|---|---|---|
| 373 fr → 372 en | 3 761 (dont 1 876 collisions, §8) | 2 runs d'aligneur du 2026-06-30 |
| 373 fr → 419 es | **1** | `run_id='manual'`, posé à la main le 2026-08-18 à 23:20 |
| 373 fr → 420 ro | **1** | `run_id='manual'`, posé à la main le 2026-08-18 à 23:20 |

La seule sortie propre de l'état fr↔en décrit en §8 est un **recalcul de cette colonne**. Aujourd'hui
il faut passer par « Recalcul global », qui purge **toutes** les paires de la famille. Et
`preserve_accepted` ne sauve que `status='accepted'` — les deux liens manuels ont `status = NULL` :
**ils seraient supprimés**. Réparer l'anglais coûterait donc le travail manuel fait sur l'espagnol
et le roumain la veille au soir. C'est le cas d'école exact, sur données réelles, aujourd'hui.

#### Correctif proposé (trois niveaux, croissants)

1. **Un « ⇄ » par en-tête de colonne**, à côté du « ↗ Segmenter » existant
   (`alignMatrixGrid.ts:26-39`) → `align()` sur cette seule paire. Le gel des gestes pendant le vol
   (F5) et le contrôle `_loadedConn` sont déjà écrits dans `_runAlign` : à réutiliser tels quels.
2. **« Recalcul global » devient « Recalculer cette colonne »** quand la relance part d'une colonne
   — même confirm inline, même verbe destructif, périmètre réduit à la paire.
3. **À trancher** (choix de modèle, pas simple correctif) : `preserve_accepted` ne protège que les
   liens *validés*. Un lien `run_id='manual'` n'est pas un produit d'aligneur — le purger dans un
   recalcul est défendable (il peut être devenu faux) mais doit au minimum être **compté dans la
   confirmation** : « supprime 3 761 liens, dont 2 posés à la main ».

*Tests* : un clic sur la colonne *i* ne poste que `target_doc_ids: [docId_i]` ; la confirmation de
recalcul annonce le nombre de liens manuels qu'elle va détruire.
*Contournement d'ici là* : **pas par la CLI** — `multicorpus align` n'expose ni `--replace-existing`
ni `--preserve-accepted` (vérifié : `cli.py:1589-1640`, le parser n'a que `--strategy`,
`--sim-threshold`, `--debug-align`), donc elle ne peut qu'**ajouter** une couche de plus. Les deux
sorties réelles sont : `POST /align` en direct sur le sidecar (`{pivot_doc_id, target_doc_ids,
strategy, replace_existing:true}` + en-tête `X-Agrafes-Token` lu dans `.agrafes_sidecar.json`), ou
un `DELETE FROM alignment_links WHERE run_id = ?` ciblé sur la couche périmée — `run_id` est indexé
et c'est exactement le geste que le correctif (c) d'ALI-17 propose d'offrir dans l'interface.

### ALI-16 🟡 P2 — aucun effectif par colonne : la comparabilité des grains n'est pas lisible

L'en-tête de colonne porte la langue, le badge « N hors matrice » et « ↗ Segmenter »
(`alignMatrixGrid.ts:31-40`) ; le bandeau porte un total global (`alignMatrix.ts:217-224`).
**Nulle part** l'effectif de chaque colonne, ni celui du moyeu. C'est le versant lisible d'ALI-04 :
là où ALI-04 demande au moteur de comparer les grains, ALI-16 demande seulement de les **montrer**.

#### Quel chiffre, exactement — le rapport de lignes ne suffit pas

Mesuré sur Modiano fr↔en : **1 913 lignes contre 1 886**, soit un rapport de 0,986. Rassurant — et
pourtant l'alignement est faux de bout en bout (§8). Le rapport de lignes ne dit rien parce que la
stratégie par défaut ne travaille pas sur les lignes : elle travaille sur les **¶**, et ces deux
documents n'en ont **aucun** des deux côtés, donc aucune borne où se recaler (ALI-14). Trois
chiffres sont nécessaires, pas un :

| chiffre | ce qu'il révèle | disponible ? |
|---|---|---|
| lignes | le blob (1) contre le document découpé | **oui**, `anchor_status[i].line_count` |
| **¶** | la borne de Gale–Church : `0 ¶` = pas de borne ; `10 ¶ contre 1 268` = grain incomparable (Beigbeder) | non — champ à ajouter (`coarse_grain.coarse_blocks_for_doc` existe) |
| couverture d'ancre | `2 porteurs / 1 231 lignes` = ancre fantôme — c'est le seuil manquant d'ALI-12 | non — dérivable dans `anchoring._external_id_anchor` |

Le premier est **déjà dans le payload** (c'est lui qui produit le « 1 913 lignes » de
l'avertissement) : l'afficher est du front pur. Les deux autres sont des **champs additifs** dans
`anchor_status`, réponse non schématisée → pas de nouvelle route, pas de mouvement de snapshot ;
bump de version de contrat et note dans `SIDECAR_API_CONTRACT.md` seulement.

*Rendu proposé* : `en · 1886 seg · 0 ¶` dans l'en-tête, en gris quand tout va bien, signalé quand le
rapport au moyeu sort d'une plage raisonnable **ou** quand `0 ¶` des deux côtés (le cas Modiano, que
le seul rapport de lignes déclare sain).
*Tests* : `alignMatrixGrid.test.ts` — l'en-tête porte les effectifs ; `alignMatrix.test.ts` — le
rapport se calcule sur les mêmes bornes que le bandeau (`text_start_n`, cf. ALI-02/ALI-11).

---

## 8. Vérification sur pièce — Modiano fr↔en (2026-08-19)

Déclenchée par une observation en cours d'usage : « il a collé deux beads ensemble à chaque fois ».
**L'observation est juste, et ce ne sont pas des beads.** Toutes les mesures ci-dessous sur
`corpus_agrafes.WORKCOPY.db`, en lecture seule.

### État mesuré

| mesure | valeur |
|---|---|
| liens 373 fr → 372 en | **3 761** |
| segments fr porteurs de **2** liens rivaux | **1 876** (9 n'en portent qu'un) |
| collisions (définition du moteur, `/align/quality`) | **1 876** |
| liens portant un `bead_id` / `bead_uid` | **0** |
| statuts | 3 761 × `NULL` (aucun revu) |
| lignes fr / en | 1 913 / 1 886 |

Les 3 761 liens viennent de **deux runs** dont les appariements diffèrent d'exactement une position :
`job-align-c20ec51c` apparie fr *n* ↔ en *n* (1 881 liens), `job-align-483d855c` apparie fr *n* ↔
en *n+1* (1 876 liens). Exemple, segment fr n°6 (« J'attendais que la pluie s'arrêtât… ») :

* en n°6 — « the shower had started when Hutte left me. »   ← run c20ec51c
* en n°7 — « Some hours before, we had met again for the last time… » ← run 483d855c

### Pourquoi il n'y a aucun bead

La stratégie des quatre runs est `external_id_then_position` (lu dans `runs.params_json`), qui ne
produit **jamais** de bead : seul `length_bounded` en pose (`aligner.py:487-495`). Ce que la matrice
affiche comme deux segments collés n'est donc pas un regroupement N-M assumé, mais **deux liens 1-1
rivaux sur le même pivot** — ce que le moteur appelle, dans son propre vocabulaire, une collision.

### La cause, reconstituée à la minute

`prep_action_history` et `runs` se recoupent exactement :

| heure (2026-06-30) | événement |
|---|---|
| 09:34:22 | align #1 — 1 885 liens |
| 09:39:24 / 09:39:38 | **fusions dans le fr** (`u.79+u.80`, `u.81+u.82`) → renumérotation |
| 09:40:00 | align #2 — 1 885 liens |
| 09:42:05 | align #3 (`483d855c`) — 1 885 liens, appariement *n↔n* **de l'époque** |
| **09:42:27** | **`split_unit` doc 372 « Coupure u.5 »** → l'anglais gagne une unité en n=5, tout décale de +1 |
| 09:42:54 | align #4 (`c20ec51c`) — 1 882 liens, appariement *n↔n* **de la nouvelle numérotation** |

La coupure est corroborée dans la table `units` : les `unit_id` de l'anglais se lisent 241130 (n=4),
241131 (n=5), **243012** (n=6), 241132 (n=7) — l'intrus 243012 est la moitié née de la coupure. Et
les 4 seuls liens du run #3 restés à décalage 0 sont exactement ceux des n=1 à 4, **avant** le point
de coupure. La reconstitution est complète.

Deux réserves d'honnêteté : les runs #1 et #2 n'ont laissé **aucune ligne survivante** et rien dans
la base ne dit ce qui les a effacées — c'est précisément **ALI-10** (les destructions massives ne
laissent aucune trace) qui empêche de le savoir. Et les quatre runs tournaient sous l'ancienne
interface (`job-align-*`), avant la barre « Aligner » de la tranche 5.

### ALI-17 🟠 P1 — un réalignement après une édition de segmentation superpose une couche

Le mécanisme est général et tient en une ligne : l'unicité porte sur **la paire d'unités**
(`idx_alinks_pivot_target_unique ON (pivot_unit_id, target_unit_id)`), donc un appariement *décalé*
n'est pas un doublon — c'est une paire neuve, qui **s'ajoute**. Il n'y a besoin ni de changer de
stratégie, ni de forcer quoi que ce soit : **une coupure d'unité entre deux runs suffit**.

Trois défauts distincts, du plus profond au plus visible :

1. **L'avertissement ne couvre pas ce cas.** `buildAlignRerunConfirmHtml`
   (`tauri-prep/src/lib/alignRunBar.ts:71-83`) dit « une **autre stratégie** peut en ajouter
   par-dessus ». La même stratégie le fait aussi, dès que la segmentation a bougé — et c'est le cas
   le plus fréquent, puisque corriger la segmentation *est* la raison de réaligner.
2. **Le rendu prescrit le mauvais geste.** Deux liens rivaux sur des cibles consécutives font que
   chaque ligne partage une cible avec la ligne du dessus : `cellsShareFusedTarget`
   (`alignCellCut.ts:50-55`) classe la cellule `fused`, et l'infobulle dit « Traduction fusionnée
   avec la ligne du dessus (**à couper**) » (`alignMatrixGrid.ts:142`). Rien n'est à couper : il
   faut supprimer une couche entière. Le ✂ proposé aggraverait l'état.
3. **Aucune sortie proportionnée.** Le compte agrégé existe bien — KPI `collision_count` et panneau
   dédié au « ✎ Contrôle » (`AlignPanel.ts:1183, 1841`) — mais il se résout par groupe, 20 par page
   (`sidecar.py:8618`, `AlignCollisionPanel.ts:82`) : 1 876 collisions ne se traitent pas là. Le ✕
   de la matrice retire **un** lien choisi par cellule (`AlignMatrixView.ts:1421-1484`). La seule
   sortie réelle est le recalcul — dont ALI-15 montre qu'il n'est pas scopable à la colonne.

*Correctifs* : (a) reformuler la confirmation — « re-aligner après une modification de la
segmentation crée une seconde série de liens » ; (b) détecter à la projection qu'une cellule porte
des liens de **`run_id` différents** et le dire comme tel (« 2 alignements rivaux ») au lieu de
`fused` ; (c) offrir « supprimer les liens du run *X* » — le filtre existe déjà en base, c'est une
colonne indexée.
*Test RED* : aligner par position, couper une unité cible, réaligner → attendre **une** série de
liens, pas deux. Aucun test actuel ne réaligne après une édition (cf. ALI-11).

### Épilogue — l'état a été soldé pendant l'audit (2026-08-19, 09:15 locales)

Un réalignement de famille lancé depuis la matrice (`strategy=position`, `replace_existing=true`,
**`preserve_accepted=false`**) a purgé les trois paires et reconstruit une couche unique :

| paire | liens | pivots | collisions |
|---|---|---|---|
| 373 fr → 372 en | 1 886 | 1 886 | **0** |
| 373 fr → 419 es | 1 858 | 1 857 | — |
| 373 fr → 420 ro | 1 850 | 1 850 | — |

Les 3 761 liens rivaux ont disparu. Et **ALI-15 s'est réalisé au passage** : les deux liens manuels
posés la veille à 23:20 (`link_id` 41025 sur l'espagnol, 41026 sur le roumain) ne sont plus dans la
base — la case « Conserver les liens validés » était décochée, et ils n'étaient de toute façon pas
en `accepted`. Le constat n'est donc pas théorique : la seule sortie disponible a coûté le travail
manuel de la veille, exactement comme décrit. Les quatre liens manuels espagnols présents
aujourd'hui sont postérieurs au run (07:15:32 → 07:17:40 UTC) : c'est du travail refait.

### ALI-18 🟠 P1 — chaque geste re-projette la famille entière, toutes langues comprises

Vingt-et-un gestes de la matrice appellent `_reloadPreservingScroll()`
(`tauri-prep/src/screens/AlignMatrixView.ts:1985`), qui appelle `_loadMatrix()`, qui refait
`POST /align/matrix` sur **toute la famille**. Côté moteur, `build_alignment_matrix(conn,
family_root_id)` (`services/matrix_export_service.py:68`) n'a **ni `limit`, ni `offset`, ni filtre
de langue** : la projection est toujours intégrale. Corriger une cellule anglaise recharge donc
aussi l'espagnol et le roumain.

Toutes les mesures ci-dessous sur la famille Modiano — 1 913 lignes × 4 langues, 5 594 liens —
**après** le nettoyage de ce matin : c'est le coût nominal, pas celui d'un état dégradé.

#### Bout en bout

| étape | coût |
|---|---|
| `POST /align/matrix` (3 essais, sidecar réel) | **1 426 / 1 519 / 1 640 ms** — 2,25 Mo sur le fil |
| `JSON.parse` + `buildMatrixView` | 11 ms |
| `buildMatrixGridHtml` | 27 ms → **7,46 Mo de HTML** |
| `innerHTML` → DOM | **51 367 nœuds** (1,6 s sous happy-dom ; un webview parse plus vite mais doit en plus calculer la mise en page) |

Soit de l'ordre de **deux secondes par geste**, pour une modification qui touche **une cellule sur
7 652**.

#### Où passe la seconde et demie côté moteur

19 requêtes SQL, 1 147 ms — dont **1 107 ms (95 %) dans une seule requête exécutée six fois** :

| | cumul | lignes rendues |
|---|---|---|
| `SELECT … FROM units WHERE doc_id=? AND unit_type='line' AND unit_status … NOT EXISTS (…)` | **1 107 ms** (×6) | 0 à 3 |
| `SELECT … FROM alignment_links …` (une par traduction) | 20 ms (×3) | 1 850 à 1 886 |
| `SELECT n, unit_type, external_id, meta_json FROM units …` (ancrage) | 14 ms (×4) | — |

C'est le couple `additions` / `uncovered` de `matrix_export_service.py:204` et `:230` — deux
requêtes quasi identiques, exécutées **deux fois par traduction**. Elles ne renvoient presque rien
et coûtent la quasi-totalité du temps : cause en ALI-19.

#### Ce qui compose les 2,25 Mo transmis

| clé du payload | poids | part |
|---|---|---|
| `cell_links` | 1,05 Mo | **68,7 %** |
| `rows` (le texte affiché) | 0,42 Mo | 27,2 % |
| `cell_statuses` | 0,04 Mo | 2,4 % |
| tout le reste | 0,02 Mo | 1,7 % |

Les identifiants de liens pèsent **deux fois et demie** le texte qu'ils accompagnent. (Le payload
sérialisé fait 1,53 Mo en mémoire contre 2,25 Mo sur le fil : l'écart vient de l'`indent=2` de
`_send_json`, `sidecar.py:549` — 32 % du transfert est de l'indentation.)

#### Ce qui compose les 7,46 Mo de HTML

7 652 cellules, soit **1 023 octets par cellule** et **37 820 boutons** (4,9 par cellule) :

| catégorie | poids | part |
|---|---|---|
| attributs `title` | 2,53 Mo | **34 %** |
| attributs `class` | 1,63 Mo | 22 % |
| attributs `data-*` | 1,23 Mo | 17 % |
| **texte réellement affiché** | 0,36 Mo | **5 %** |

Les infobulles pèsent **sept fois le texte du corpus**. Ce sont quelques dizaines de chaînes
répétées 37 820 fois.

Le rendu est linéaire — donc le fenêtrage rend exactement ce qu'il économise :

| lignes rendues | HTML | DOM | nœuds |
|---|---|---|---|
| 100 | 1 ms | 82 ms | 2 706 |
| 500 | 5 ms | 428 ms | 13 506 |
| 1 000 | 10 ms | 775 ms | 27 006 |
| 1 913 | 28 ms | 1 594 ms | 51 367 |

#### Correctifs, par ordre de rapport effet/coût

0. **ALI-19** (statistiques SQLite) — 1 500 ms → ~100 ms côté serveur, pour une commande déjà écrite.
   À faire avant tout le reste : c'est les deux tiers du problème, sans toucher une ligne de code.
1. **Patch local** — les endpoints de geste renvoient déjà ce qui a changé (`link_id`, statut,
   texte). Remplacer le `<td>` concerné au lieu de re-projeter couvrirait la majorité des 21 appels.
   Aucun changement de contrat.
2. **Projection scopée** — paramètre optionnel `target_doc_ids` sur `/align/matrix` pour ne
   recharger que la colonne touchée. Additif sur une route existante, donc sans artefact de
   contrat ; même découpage que le « ⇄ par colonne » d'ALI-15.
3. **Fenêtrage du rendu** — ne construire que les lignes visibles. Le seul qui attaque les 7,46 Mo
   et les 51 367 nœuds, le seul qui soit un vrai chantier. Deux économies gratuites au passage :
   `indent=2` dans `_send_json` (−32 % de transfert) et les `title` répétés (−34 % du HTML).

*Test* : un geste sur une cellule ne déclenche pas de `POST /align/matrix`, ou n'en déclenche qu'un
scopé à la paire concernée.

### ALI-19 🟠 P0 — la base n'a aucune statistique : le planificateur choisit le mauvais index

> **✅ TRAITÉ le 2026-08-19** — `multicorpus db-optimize --db <WORKCOPY> --analyze`, run
> `8d4f9889`, ~0,2 s process complet, taille du fichier inchangée (259 162 112 o).
> Mesuré avant/après sur la base réelle, meilleur de 3 passes, app fermée :
>
> | | avant | après | gain |
> |---|---|---|---|
> | `build_alignment_matrix(373)` — Modiano, 3 traductions, 1 913 lignes | 1 160 ms *(mesure de l'audit)* | **63,8 ms** | **×18** |
> | les deux `NOT EXISTS`, sur les **11 paires** de la base | 1 259,6 ms | **12,9 ms** | **×98** |
> | `build_alignment_matrix(416)` — Beigbeder | — | 13,9 ms | |
>
> La prédiction de l'audit (« 1 160 → 66 ms ») est confirmée à 2 ms près. Le plan a basculé
> exactement comme annoncé : `SEARCH al USING INDEX idx_alinks_docs (pivot_doc_id=?)` →
> `SEARCH al USING INDEX idx_alinks_target (target_unit_id=?)`. `sqlite_stat1` porte 35 lignes.
>
> **Effets de bord : aucun.** `ANALYZE` ne change que des plans, jamais des résultats ; et aucun
> fichier de `src/`, `tests/` ou `scripts/` ne mentionne `sqlite_stat1` ni n'énumère les tables de
> `sqlite_master` (les trois requêtes existantes visent une table par son nom).
>
> **Reste à faire** : la base **originale** (`corpus_agrafes.db`) n'a pas été touchée — seule la
> WORKCOPY l'a été. Et surtout, rien ne rend ce gain **durable** : une base fraîchement importée
> repartira sans statistiques. Le correctif pérenne est d'appeler `ANALYZE` en fin d'import et
> après une mutation de masse, ou de le brancher sur `PRAGMA optimize` à la fermeture du sidecar.

`sqlite_stat1` **n'existe pas** dans la base de travail : `ANALYZE` n'a jamais tourné. Sans
statistiques, SQLite résout le `NOT EXISTS` d'ALI-18 avec `idx_alinks_docs (pivot_doc_id)` — il
balaie les 5 594 liens de la famille **pour chacune** des 1 886 unités de la traduction, soit
~10 millions de sondes pour un résultat vide. Avec statistiques, il choisit `idx_alinks_target
(target_unit_id)`, qui rend 1 à 2 lignes.

Mesuré sur une copie de la base réelle (259 Mo), connexion neuve à chaque essai, min sur 3 :

| | avant | après `ANALYZE` | facteur |
|---|---|---|---|
| projection matrice, famille Modiano (1 913 × 4) | 1 160 ms | **66 ms** | **17,6×** |
| projection matrice, famille Beigbeder (1 231 × 2) | 72 ms | **17 ms** | 4,2× |
| coût d'`ANALYZE` lui-même, base entière | — | **46 ms**, 35 lignes de stats | — |

Un index composite `(target_unit_id, pivot_doc_id)` a aussi été essayé : **64 ms**, soit rien de
plus qu'`ANALYZE` seul. **Aucune migration n'est nécessaire** — il ne manque que les statistiques.

Effets de bord vérifiés (mêmes conditions, avant/après) — aucun :

| requête | avant | après |
|---|---|---|
| recherche FTS (`fts_units MATCH`) | 2,3 ms | 2,4 ms |
| audit d'alignement d'une paire | 2,4 ms | 2,5 ms |
| collisions (`/align/quality`) | 2,1 ms | 2,1 ms |
| tokens d'un document | 2,0 ms | 1,5 ms |
| agrégat unités par document | 20,7 ms | 20,4 ms |

**La capacité existe déjà et n'est jamais appelée** : `multicorpus db-optimize` exécute `ANALYZE`
(`cli.py:1255`), et `db/connection.py:16-18` pose `journal_mode`, `foreign_keys` et `synchronous`
mais aucun `PRAGMA optimize`.

*Correctif* : `PRAGMA optimize` à la fermeture de connexion (le motif recommandé par SQLite, qui ne
ré-analyse que ce qui a changé), plus un `ANALYZE` après les runs qui déplacent des volumes
(import, alignement, resegmentation). Pour les bases existantes, un `ANALYZE` unique suffit.
*Portée* : trouvé par la matrice, mais le défaut est **global au moteur** — toute requête à
sous-requête corrélée est exposée au même mauvais choix de plan.
*Test* : `sqlite_stat1` est non vide après un cycle import → index → align.

---

## 9. Ce que la base garde comme trace (2026-08-19)

Inventaire mesuré, en réponse à une question directe : *que sait-on de ce qui a été fait, et
qu'est-ce qui a été vérifié ?*

### Trois journaux, aucun ne couvre l'alignement

| source | volume | portée |
|---|---|---|
| `prep_action_history` | **178 actions**, 15 documents, du 2026-05-07 au 2026-08-19 | segmentation, rôles, ¶, texte, curation |
| `runs` | **713 runs** (594 `serve`, 53 `align`, 43 `query`, 12 `token_query`, 7 `index`, 4 `import-remote`) | paramètres et statistiques d'un run, pas ses effets |
| `.agrafes_telemetry.ndjson` | **294 événements** (196 `prep_undo_eligible_view`, 76 `prep_undo_unavailable_view`, 21 `stage_completed`, 1 `doc_deleted`) | instrumentation de l'annulation uniquement |

Détail de `prep_action_history` : `merge_units` 104, `set_paragraph` 24, `update_text` 17,
`split_unit` 8, `undo` 7, `set_role` 7, `resegment` 6, `curation_apply` 5 — 7 annulations au total.

Le `CHECK` de la table (migration d'origine) n'admet que ces huit types. **Aucune mutation
d'alignement n'y entre** : ni run d'aligneur, ni suppression de lien, ni changement de statut, ni
✂/⭙/✕/＝ de la matrice. C'est **ALI-10**, ici chiffré : les 3 761 liens détruits ce matin n'ont
laissé aucune ligne. Leur reconstitution (§8) n'a été possible que par recoupement avec `runs` et
par l'effet de bord d'un `split_unit` — une trace de segmentation, pas d'alignement.

### Aucune vérification n'a eu lieu

Les trois axes de revue existent et sont tous vierges :

| axe | état |
|---|---|
| `alignment_links.status` | **9 598 liens : 1 accepté, 3 rejetés, 9 594 non révisés** (99,96 %) |
| `alignment_cell_statuses` (« non traduit » par cellule, D-W8) | **table vide** |
| `units.unit_status` (axe global : `ajout`, `non traduit`) | **46 648 unités, toutes `NULL`** |

Deux conséquences pour la suite :

1. **Le corpus n'a jamais été relu.** Tout ce que la matrice affiche est une proposition
   d'aligneur non validée — y compris les 1 886 liens fr↔en reconstruits ce matin.
2. **`preserve_accepted` ne protège rien**, puisque presque rien n'est en `accepted` (cf. ALI-15 :
   c'est exactement ce qui a coûté les deux liens manuels de la veille). Tant que la revue n'est
   pas amorcée, tout recalcul global est intégralement destructeur — et le seul garde-fou prévu
   par le moteur est inopérant par défaut.

*Piste* : le statut `accepted` sert aujourd'hui deux rôles incompatibles — « j'ai relu et c'est
juste » et « ne détruis pas ceci ». Un lien posé à la main (`run_id='manual'`) mérite la seconde
protection sans prétendre à la première.

### ALI-20 🟡 P2 — pas de bandeau d'annulation dans l'espace Alignement, y compris pour les deux gestes qui sont journalisés

Le bandeau d'annulation (Mode A, `/prep/undo`) n'existe que dans `CurationPane.ts` et
`SegmentPane.ts`. `AlignMatrixView` n'en a aucun — le mot « Annuler » n'y désigne jamais qu'un
bouton de fermeture de modale.

Le modèle de la matrice est explicite et défendable : **des inverses par geste**, pas une pile
d'annulation. ↺ défait une coupe, ⭙ est documenté comme « l'inverse de ✂ », ＝ Rattacher comme
« l'undo » de ✕ (`AlignMatrixView.ts:1497`), ↺ retire une marque « non traduit » ou « ajout ».
Deux limites tout de même : ＝ recrée un **nouveau** lien (`link_id` neuf, `run_id='manual'`) — il
restitue l'appariement, pas l'objet, donc la provenance du run, le `bead_uid` et la fenêtre de
coupe sont perdus ; et ✕ **supprime** vraiment (revue G1 : le rejet a été abandonné parce qu'il
bloquait l'index unique).

Le vrai trou est ailleurs. **Deux gestes de la matrice écrivent bel et bien dans
`prep_action_history`** :

| geste | endpoint | action journalisée |
|---|---|---|
| ✎ stylo | `updateUnitTextNorm` (`AlignMatrixView.ts:695`) | `update_text` (`units_service.py:334`) |
| ¶ frontière | `setParagraphBoundary` (`AlignMatrixView.ts:726`) | `set_paragraph` (contrat 1.6.62) |

Ils sont donc **annulables par le moteur, mais pas depuis l'écran qui les a produits**. Pour
défaire une correction au stylo faite dans la colonne espagnole, il faut ouvrir *le document
espagnol* dans la Segmentation et y trouver le bandeau — un autre document que le moyeu, un autre
écran que celui du geste. La base porte la trace de cet usage : 17 `update_text` (3 annulées) et
24 `set_paragraph` (1 annulée).

*Correctif* : monter le bandeau existant dans `AlignMatrixView`, scopé au document de la colonne
touchée par le dernier geste journalisé. Aucun moteur à écrire — `/prep/undo/eligibility` et
`/prep/undo` sont déjà là, et le composant aussi.
*Test* : après un ✎ dans une colonne de traduction, le bandeau propose l'annulation de cette
action-là, et l'annulation re-projette la matrice.
*Hors périmètre* : le run d'alignement lui-même reste sans inverse **et** sans trace (ALI-10,
ALI-17) — c'est un manque d'une autre nature, qui ne se règle pas par un bandeau.

---

## 10. Chiffrage — rendre un run d'alignement réversible (2026-08-19)

ALI-10 et ALI-17 laissent le même trou : un run d'alignement n'a ni trace ni inverse. La question
n'était pas *faut-il* le réparer mais *combien ça coûte*. Prototype construit et mesuré sur une
copie de la base réelle (247 Mo, 9 602 liens).

### Le mécanisme tient en deux moitiés, dont une est déjà gratuite

Annuler un run, c'est défaire deux choses :

* **les liens qu'il a créés** — déjà identifiables sans rien ajouter : `alignment_links.run_id`
  porte le run. Un `DELETE … WHERE run_id = ?` suffit. (Il n'existe pas d'index sur `run_id` seul —
  `idx_alinks_bead` est partiel sur `(run_id, bead_id) WHERE bead_id IS NOT NULL`, inutilisable
  ici : le delete balaie la table. Négligeable à 9 602 lignes, à indexer pour un gros corpus.)
* **les liens qu'il a purgés** — c'est la seule chose à archiver, et **seulement** quand
  `replace_existing=true`. Un run « compléter » ne détruit rien : son annulation ne coûte **aucun
  octet de stockage**.

Sur les 53 runs d'alignement de la base : **15 destructifs, 38 additifs**. Les deux tiers des runs
seraient donc réversibles à coût de stockage nul.

### Table proposée, calquée sur l'existant

Même forme que `prep_action_unit_snapshots` (migration 019) : une ligne par objet détruit, clé
composite, `ON DELETE CASCADE` sur l'action.

```sql
CREATE TABLE align_run_purge (
    run_id TEXT NOT NULL, link_id INTEGER NOT NULL, src_run_id TEXT NOT NULL,
    pivot_unit_id INTEGER NOT NULL, target_unit_id INTEGER NOT NULL, external_id INTEGER NOT NULL,
    pivot_doc_id INTEGER NOT NULL, target_doc_id INTEGER NOT NULL, created_at TEXT NOT NULL,
    status TEXT, bead_id INTEGER, bead_uid TEXT, target_char_start INTEGER, target_char_end INTEGER,
    PRIMARY KEY (run_id, link_id));
```

`link_id` et `src_run_id` sont archivés, pas seulement la paire d'unités : c'est ce qui permet une
restitution **à l'identique** plutôt qu'une reconstruction approximative — le défaut de ＝ Rattacher
signalé en ALI-20.

### Mesures — cycle complet sur la famille Modiano (5 595 liens, 3 traductions)

| étape | coût |
|---|---|
| archivage de la purge (5 595 liens) | **8 ms** |
| purge + recalcul (`position`, 3 paires) | 74 ms |
| annulation : `DELETE … WHERE run_id` + réinsertion de l'archive | **31 ms** |
| **empreinte après annulation** | **identique à l'octet près** — `link_id`, `run_id` d'origine, `status`, `bead_uid`, fenêtres de coupe compris |

L'empreinte est un SHA-256 des 13 colonnes de tous les liens de la famille, triés : `810ef356…`
avant, `810ef356…` après annulation.

### Coût de stockage

| | valeur |
|---|---|
| poids d'un lien archivé | **109 octets** |
| purge d'une famille de 5 595 liens | **596 Ko** |
| instantané de la table entière (9 602 liens) | **1,0 Mo** |
| hypothèse haute : les 53 runs historiques archivant chacun une famille de 2 000 liens | **11 Mo** sur une base de 247 Mo (**+4,5 %**) |

Et cette hypothèse est doublement pessimiste : 38 des 53 runs n'auraient rien archivé, et une
politique de rétention (garder les *N* derniers runs par famille, ou purger au-delà de *X* jours)
plafonne le total sans rien coûter d'autre qu'une clause `DELETE`.

### Verdict

**Le mécanisme est bon marché, exact, et n'a pas besoin d'infrastructure neuve.** Une migration
d'une table plus un index sur `run_id`, un `INSERT … SELECT` avant la purge existante
(`sidecar.py:350-365`, qui est déjà le seul point de destruction), et un endpoint d'annulation qui
fait le chemin inverse. Le geste UI a même déjà sa place : la barre « Aligner » affiche le résumé
du run (`alignRunSummary`) — c'est là qu'un « ↺ Annuler ce run » se poserait naturellement.

*Réserve honnête* : le prototype couvre le cas mesuré — purge de famille puis recalcul. Deux
situations demandent un choix explicite avant implémentation : (a) un run partiellement révisé
depuis (statuts posés après coup — l'annulation les écraserait), et (b) une resegmentation
intervenue entre le run et son annulation, qui a détruit les unités que l'archive référence. Dans
les deux cas la bonne réponse est probablement de **refuser** l'annulation avec un message, pas de
tenter une restitution partielle — c'est exactement la discipline de `/prep/undo/eligibility`, qui
sait déjà dire « plus annulable » et pourquoi.

### ALI-21 🟡 P2 — les gestes de cellule sont invisibles au repos et muets en cas de refus

Vérification déclenchée par un « je ne peux pas annuler la coupe » sur l'item 5.14 de la QA. **La
chaîne fonctionne** : le résolveur a été exécuté sur le payload réel de la famille Modiano (cinq
cellules coupées dans la colonne espagnole, segments 12 à 16) et rend à chaque fois un lot d'actions
complet et valide — par exemple `clear_target_span#42925`, `delete#46631`, `clear_bead#42925`. Les
trois actions existent côté moteur (`services/align_links_service.py:94,117`, batch
`sidecar.py:8393`). Rien à corriger dans la logique.

Deux obstacles d'usage, en revanche :

1. **Le ↺ est à `opacity: 0` au repos** (`app.css:2374-2380`, révélé par `.prep-matrix-cell:hover`),
   comme le ✂, le ✕, le 🔍 et le ✎. Une cellule coupée peut en afficher cinq d'un coup, tous en
   glyphes de 0,75 rem, sans libellé et sans indice au repos qu'elle est actionnable. Après un
   geste, l'utilisateur cherche naturellement un bandeau — d'autant qu'ALI-20 en a établi l'absence.
2. **Un refus de geste est parfois totalement silencieux.** `_cellGestureCtx`
   (`AlignMatrixView.ts:586`) commence par `if (!conn || !view || this._cutBusy) return null;` — pas
   de message, pas de curseur, rien. Les autres refus du même point d'entrée, eux, parlent
   (« connexion changée », « sidecar trop ancien »). Un `_cutBusy` resté armé rend donc **tous** les
   gestes de cellule inertes sans que rien ne l'explique ; la sortie est un rechargement de la
   matrice, que rien n'indique non plus.

3. **Le glyphe n'est pas celui qu'on cherche, et la rangée change de forme.** Le code émet
   `&#8635;` = **↻** (flèche *horaire*), tandis que ses propres commentaires, la note de conception
   et la checklist de QA écrivent tous « ↺ » (anti-horaire, U+21BA). Et sur une cellule coupée, le
   ✎ et le ＝ **disparaissent** (ils exigent `char_start == null`) : la rangée passe de six boutons
   à cinq et se réordonne. Rendu réel vérifié sur les cellules concernées : `✂ ⊙ ↻ ✕ 🔍`.

*Correctif* : (a) un marqueur discret mais permanent sur les cellules actionnables — le survol
révèle *quels* gestes, pas *qu'il y en a* ; (b) tracer le refus `_cutBusy` (toast « un geste est en
cours » ou simple `console.debug`), pour qu'un clic sans effet cesse d'être indiscernable d'un
bouton mort.
*Test* : `_cellGestureCtx` refusé pour cause de `_cutBusy` émet un signal observable.

### ALI-22 🟠 P1 — le ⭙ n'a pas d'inverse, et la tentative naturelle laisse un doublon (démontré)

Le ⭙ Fusionner écrit deux choses, atomiquement (`AlignMatrixView.ts:1243-1266`) : il **crée** un
lien `manual` du segment courant vers la cible du voisin (`createAlignLink`), puis **supprime** le
lien du voisin. Aucun bouton ne défait cette paire d'écritures — la note de conception donne le ✂
pour inverse conceptuel, ce qui ne rend ni le lien d'origine ni son `run_id`.

**Le cas s'est produit pendant la QA, et la base en garde la trace exacte** (famille Modiano,
colonne espagnole, 2026-08-19) :

| heure | événement | effet en base |
|---|---|---|
| 07:15:06 | alignement `position` | fr 1 ↔ es 1 *(titre)*, fr 2 ↔ es 2 *(« 16 213 mots »)* — lien 42915 |
| 07:39:28 | **⭙ sur le segment fr 2** | crée 46628 (fr 2 ↔ es 1) **et supprime** le lien fr 1 ↔ es 1 |
| 07:39:39 | **＝ Rattacher sur fr 1** — la réparation intuitive, 11 s plus tard | crée 46629 (fr 1 ↔ es 1) |

Résultat actuel : la phrase espagnole n° 1 est rattachée **à la fois** au segment fr 1 et au segment
fr 2, et le segment fr 2 porte deux phrases espagnoles. Le ＝ a bien rendu au voisin ce que le ⭙ lui
avait pris, mais **rien n'a retiré ce que le ⭙ avait créé** : il aurait fallu deux gestes, dans le
bon ordre, sans que rien ne le dise.

**Et rien ne l'a signalé.** Le ⭙ groupe la cellule en un bead (`_groupCellBead`, best effort) :
46628 et 42915 partagent `bead_uid = 'cell#239214#419'`. Aux yeux du moteur, le segment fr 2 porte
donc **un bead 1-2 assumé**, pas une collision — `/align/quality` n'en compte aucune. C'est
exactement le risque résiduel qu'ALI-13 avait qualifié d'acceptable en §5 (« ⭙ peut faire taire une
collision légitime ») : **il s'est matérialisé sur données réelles**, ce qui justifie de le
reclasser. Seul le ⚠ `fused` de la matrice reste visible, et il prescrit un ✂ qui n'est pas le
remède.

*Réparation du cas* : ✕ sur la cellule espagnole du segment fr 2, choisir la phrase de titre
(supprime 46628). Les liens fr 1 ↔ es 1 et fr 2 ↔ es 2 subsistent : l'alignement d'origine est
rétabli, au `run_id` près.

*Correctif* : (a) un ↻ sur une cellule issue d'un ⭙ — l'information nécessaire est déjà en base
(le lien créé est `manual` et porte le `bead_uid` de cellule) ; (b) à défaut, que le ⭙ dise dans son
résumé *comment* revenir en arrière, en nommant les deux gestes et leur ordre ; (c) ne pas beader
une cellule dont le lien absorbé recouvre une cible déjà portée par un autre segment — c'est le
point qu'ALI-13 avait laissé passer.
*Test RED* : ⭙ puis ＝ sur le voisin ⇒ la cible ne doit pas se retrouver sur deux pivots ; aujourd'hui
elle s'y retrouve, en silence.

---

## 11. Approfondissement « famille A » — ce qui abîme les données (2026-08-19, quatrième temps)

Les cinq constats qui détruisent des données (ALI-03, ALI-10, ALI-17, ALI-22, QA-06) ont été repris
**au code et à la base**, non pour les redécrire mais pour trancher les décisions de conception qui
bloquaient l'écriture d'un ticket. Trois des quatre se tranchent sur pièce ; une reste ouverte.

### 11.1 Le diagnostic unifiant : l'undo ne sait pas restaurer un lien

Ce ne sont pas cinq problèmes, c'est **une capacité manquante vue cinq fois**.

`undo.py` ne touche `alignment_links` que de deux façons — `UPDATE … SET source_changed_at`
(l. 144, re-marquage périmé) et `DELETE` (l. 340, 377). **Il n'y a aucun `INSERT`, nulle part.**
Et `prep_action_unit_snapshots` (migration 019, l. 56-65) porte exactement quatre colonnes
« avant » : `text_raw_before`, `text_norm_before`, `unit_role_before`, `meta_json_before` — toutes
centrées sur l'**unité**, aucune sur le **lien**. Vérifié à l'échelle du schéma : sur les 15 tables,
aucune n'archive un lien.

Quand un geste détruit un lien, il n'existe littéralement aucun endroit où le mettre.

**Corollaire : la famille se scinde en deux, et pas là où §4 la coupait.**

| | ce qui disparaît | infrastructure requise |
|---|---|---|
| **A1** — ALI-03, ALI-22, ALI-10, run destructif du §10 | un **lien** | une table d'archive : **une migration**, un mécanisme, 4 points d'appel |
| **A2** — QA-06 (Pré-remplir) | un **`parent_n`** | **rien** — voir 11.4 |

**ALI-17 est à part** : il ne détruit rien, il **accumule**. Son correctif est le miroir d'A1
(« supprimer les liens du run *X* »), que l'archive rend réversible au lieu de définitif.

### 11.2 Décision « où vivent les liens archivés » — tranchée par le code

Le §10 proposait `align_run_purge`, scopée au **run**. Mais ALI-03 et ALI-22 ne sont pas des runs.
L'ordre des écritures dans `_handle_units_merge` règle la question :

```
sidecar.py:4951    action_id = record_prep_action(…)      ← l'action existe déjà
sidecar.py:4989    DELETE FROM alignment_links WHERE…     ← 38 lignes plus bas
```

L'action est enregistrée **avant** la destruction, **dans la même transaction**, avec `action_id`
en portée. L'`INSERT` d'archive se pose là, sans rien inventer. → **l'archive appartient à
`prep_action_history`** (table `prep_action_link_snapshots` en miroir de celle des unités, plus un
`run_id` nullable pour couvrir aussi le cas du §10). Un seul chemin de restitution à tester.

**Le paysage se lit alors clairement — il y a trois régimes de comptabilité, pas deux :**

| geste | trace | annulable |
|---|---|---|
| unités (fusion, coupe, texte, rôle, ¶) | `prep_action_history` + instantanés | oui |
| runs (alignement, import) | table `runs` | non |
| **liens (⭙, ✕, ＝, ✂)** | **rien** | non |

`align_links_service.py` ne contient **aucune** occurrence de `record_action`, et `sidecar.py`
n'en a que 4 en tout (l. 3648, 3654, 5570, 5713). Les gestes de lien sont le seul régime
entièrement muet.

### 11.3 Obstacle non vu jusqu'ici : les deux chemins ne sont pas symétriques

```
merge  : record_prep_action (4951)  →  DELETE liens (4989)        ✅ archivable en l'état
split  : DELETE liens (5094)        →  record_prep_action (5123)  ❌ ordre inversé
```

Dans `_handle_units_split`, les liens sont détruits **avant** que l'action existe. Le remède est
trivial — capturer les lignes dans une liste locale avant le `DELETE`, insérer après — mais c'est
exactement ce qui se transforme en `// NOTE:` si ce n'est pas décidé avant le ticket.

### 11.4 A2 (QA-06) ne demande aucune infrastructure — vérifié

`parent_n` vit dans `meta_json`, donc `meta_json_before` le sauve **déjà** :

- le type d'action `set_paragraph` est déjà dans le `CHECK` (migration 034) ;
- `_undo_set_paragraph` (`undo.py:187-204`) boucle sur un nombre **quelconque** d'instantanés et
  restaure `meta_json` verbatim — il n'est pas limité à une unité ;
- `set_paragraph_boundary_document` (`coarse_grain.py:438`, appel l. 513) prend déjà
  `record_action` — alors que `regroup_document_coarse` (`coarse_grain.py:269`), **deux fonctions
  plus haut dans le même fichier**, ne le prend pas.

Le correctif est la propagation d'un paramètre. **Zéro migration obligatoire.**

> **Correction (relecture du 2026-08-19, déclenchée par « il ne faut pas décider d'un truc avant
> de partir sur A2 ? »)** — la première rédaction ajoutait « zéro artefact de contrat ». **C'est
> faux.** Pour que le front puisse proposer l'annulation, la réponse doit porter l'`action_id`,
> comme le fait déjà `/segment/paragraph_boundary`. Or `SegmentCoarseResponse` **est schématisée**
> (`sidecar_contract.py:3618`, avec `required` et `properties` explicites). Le coût réel est donc
> de **trois artefacts** : `sidecar_contract.py`, `docs/openapi.json` régénéré (il embarque les
> 119 schémas), et `docs/SIDECAR_API_CONTRACT.md:373` qui énumère la réponse mot pour mot. La règle
> « paramètre optionnel sur route existante = 0 artefact » vaut pour les paramètres de **requête**,
> pas pour un champ de **réponse**.
>
> Bonne nouvelle en revanche : le précédent est **complet et documenté**.
> `SegmentParagraphBoundaryResponse` porte déjà `action_id` en `nullable`
> (`sidecar_contract.py:3645`) et la ligne 374 du contrat écrit déjà « undoable (Mode A,
> `action_type=set_paragraph`) ». C'est un calque, pas une conception.

**Volume mesuré** — un « Pré-remplir » sur le doc 416 archiverait **1 231 lignes**. La table en
porte déjà 12 727, et ses trois plus grosses actions font **1 258, 1 258 et 1 226 lignes** : le
précédent existe, ce n'est pas un cas nouveau.

~~*Verrue relevée au passage* : `text_norm_before` est `NOT NULL`, donc l'instantané embarquerait
**91,8 Ko de texte**…~~ — **retiré, c'était faux.** L'adaptateur de `/segment/paragraph_boundary`
écrit `"text_norm_before": ""` (`sidecar.py:5560`) : la contrainte `NOT NULL` est satisfaite par une
chaîne vide, puisque `_undo_set_paragraph` ne restaure que `meta_json` et n'a que faire du texte.
Un regroupement ferait de même. L'instantané ne coûte donc que ses lignes, pas le texte du document.
J'avais mesuré ce que la colonne *pourrait* contenir, pas ce que ce chemin y écrit.

*Motif d'instantané, réglé par précédent* : `set_paragraph_boundary_document` ne photographie que
les unités qui **changent réellement** (liste `changes`, `coarse_grain.py:503-518`) et appelle
`record_action` **avant** les écritures. Rien à décider, il n'y a qu'à suivre le voisin.

**Décision « réutiliser `set_paragraph` ou créer un type »** — le volume étant réglé, le choix est
purement de **lisibilité de l'historique**. Or le grief central de QA-06 est précisément que la
mutation de masse est *invisible dans l'audit*. Un type qui annonce `set_paragraph` n'en réglerait
que la moitié. → **type `regroup_coarse`, migration 035**, sur le patron exact de 032/033/034.

### 11.5 ALI-22 : le correctif (a) n'est pas indépendant d'A1

État exact des trois liens du cas, relu en base :

| lien | pivot → cible | `run_id` | `bead_uid` | origine |
|---|---|---|---|---|
| 46628 | 239214 → 237353 | `manual` | `cell#239214#419` | **créé par le ⭙** |
| 46629 | 239213 → 237353 | `manual` | `NULL` | créé par le ＝ |
| 42915 | 239214 → 237354 | `d84c2fd5…` | `cell#239214#419` | d'origine |

Le lien créé par un ⭙ **est** identifiable — `run_id='manual'` **et** `bead_uid LIKE 'cell#%'`
(7 liens sur 14 manuels dans toute la base). L'audit avait raison sur ce point.

**Mais la conclusion était fausse.** Un ↻ pourrait supprimer ce que le ⭙ a créé ; il ne peut pas
rendre ce que le ⭙ a **supprimé** — le lien du voisin est parti avec son `link_id` et son `run_id`.
Le recréer, c'est exactement l'approximation reprochée au ＝ Rattacher en ALI-20.

→ Le correctif **(a) dépend d'A1**. Seul **(c)** — ne pas beader quand la cible absorbée est déjà
portée ailleurs — reste court et autonome, et referme ALI-13.

### 11.6 §10 : à quelle fréquence les deux cas de refus se produiraient-ils ?

Sur les 53 runs d'alignement, **9 seulement portent encore des liens** (les autres ont été purgés
par des runs ultérieurs).

| cas | fréquence | détail |
|---|---|---|
| (a) run partiellement révisé depuis | **2 / 9** | 2 liens et 1 lien respectivement |
| (b) segmentation modifiée depuis | **0 / 9** | — |

Deux lectures s'imposent, et aucune ne va de soi :

* **Le zéro du cas (b) ne prouve rien.** Le seul cas (b) connu — Modiano, la coupe d'unité entre
  deux runs, §8 — n'apparaît pas parce que ses liens ont été purgés pendant l'audit. La mesure ne
  voit que les runs survivants. La garde reste nécessaire.
* **Le refus en bloc du cas (a) serait disproportionné** : bloquer l'annulation d'un run de 1 226
  liens parce qu'**un seul** porte un statut posé après coup. La §10 recommandait « refuser plutôt
  que restituer partiellement » ; la mesure invite à nuancer.

> **Seule question encore ouverte de la famille A** : sur le cas (a), refuser en bloc, ou annuler
> en **préservant** les liens revus et en le disant (« 1 lien validé conservé »). Le second est plus
> utile mais rouvre la restitution partielle que §10 voulait éviter. À trancher avant le ticket A1.


### 11.7 Décisions avant le ticket A2 — il n'y en a qu'une (2026-08-19)

Relecture déclenchée par « il ne faut pas décider d'un truc avant de partir sur A2 ? », puis par
« je ne sais pas vraiment quoi trancher ». La première rédaction de ce paragraphe annonçait **trois**
décisions. Vérification faite, **deux n'existent pas**, et sur la troisième la recommandation était
inversée.

**D-A2-1 · Type d'action : réutiliser `set_paragraph` ou créer `regroup_coarse` ?** — seule vraie
décision. → **Réutiliser `set_paragraph`.**

Le raisonnement initial (« un historique qui annonce `set_paragraph` pour 1 231 unités ne règle que
la moitié du grief de QA-06 ») **repose sur une erreur** : le libellé affiché ne vient pas du type
d'action. `formatUndoActionLabel` (`prepUndo.ts:136-141`) rend
`` `Annuler : ${eligibility.description}` `` — et `description` est du **texte libre** écrit par le
moteur à l'enregistrement (« Édition du texte (unité 251320) » dans l'historique réel). Le bandeau
peut donc dire « Annuler : Pré-remplir (tours) — 1 231 segments » **quel que soit le type**.
L'honnêteté du libellé est acquise des deux côtés, et le grief de QA-06 — *aucune* action
enregistrée — est refermé dès qu'une action existe.

Argument manqué la première fois, et qui penche **contre** le nouveau type : l'undo est dispatché
par `action_type`, et `_undo_set_paragraph` fait déjà exactement ce qu'il faut (restaurer
`meta_json` sur N unités). Un `regroup_coarse` imposerait une branche de dispatch **au comportement
identique**, pour une distinction purement sémantique.

| | réutiliser `set_paragraph` | créer `regroup_coarse` |
|---|---|---|
| migration | **aucune** | 035 (boilerplate de 034) |
| artefacts de contrat | 3 (l'`action_id` dans la réponse) | 3, plus l'énumération |
| libellé vu par l'utilisateur | « Annuler : Pré-remplir (tours) — 1 231 segments » | identique |
| code d'undo | réutilisé tel quel | branche dupliquée, comportement identique |
| ce qu'on perd | interroger l'historique **par type** — aucune requête de ce genre n'existe | rien |

Le type se lit alors « une action qui a déplacé des `parent_n` », ce qui est exactement vrai des deux
gestes ; la `description` porte la spécificité.

**D-A2-2 · Le bouton d'undo sur Tours — dissoute.** L'undo du moteur est **strictement linéaire** :
`ORDER BY performed_at DESC, action_id DESC LIMIT 1` (`undo.py:53`) rend la dernière action non
annulée du document, quel que soit son type ; **aucun moyen d'annuler une action plus ancienne**.
« Filtrer par type sur cette surface » ne peut donc pas signifier « n'annuler que les paragraphes »,
seulement **cacher le bouton** quand la dernière action est d'un autre type — un bouton qui
disparaît sans explication étant pire qu'un bouton qui nomme ce qu'il va annuler. On le pose, il se
comporte comme celui de Brut.

**D-A2-3 · L'énumération périmée — dissoute.** Une ligne de markdown sans contrepartie : on la
solde en passant. La dette est d'ailleurs **double**, et le second endroit est du code :
`SIDECAR_API_CONTRACT.md:377` documente `action_type ∈ {curation_apply, merge_units, split_unit,
resegment}` (il manque `update_text`, `set_role`, `set_paragraph`), et `PREP_ACTION_TYPES`
(`prepUndo.ts:27-35`) liste 7 valeurs en **oubliant `set_paragraph`** — alors que son commentaire
affirme « matches CHECK constraint », qui en compte 8 depuis la migration 034.

**Périmètre final d'A2** : propager `record_action` à `regroup_document_coarse` ; exposer
`action_id` dans `SegmentCoarseResponse` (3 artefacts : `sidecar_contract.py`, `docs/openapi.json`
régénéré, `SIDECAR_API_CONTRACT.md:373`) ; poser le bouton d'undo sur l'onglet Tours ; solder les
deux énumérations. **Aucune migration.**

### 11.8 Plan qui en découle

1. **A2 / QA-06** — ✅ **FAIT le 2026-08-19** (contrat 1.6.63, aucune migration). Périmètre arrêté en **11.7** — `record_action` sur `regroup_document_coarse`, `action_id`
   dans la réponse (3 artefacts de contrat), bouton d'undo posé sur l'onglet Tours, énumérations soldées.
   **Aucune migration.** Indépendant de tout le reste ; sert de répétition au
   triplet `record_action` → instantané → undo qu'A1 emploiera en grand.
2. **ALI-22 (c)** — la garde anti-bead. Court, autonome, referme ALI-13.
3. **A1** — `prep_action_link_snapshots`, en corrigeant au passage l'ordre de
   `_handle_units_split`. Débloque ALI-03, ALI-22 (a), ALI-10, et le « supprimer les liens du
   run *X* » d'ALI-17.
