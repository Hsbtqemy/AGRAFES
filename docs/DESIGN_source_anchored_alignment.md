# Note de design — Alignement ancré-source : le moyeu, les deux formes du corpus, la matrice multilingue

> Statut : **intention de design — modèle et décisions figés (2026-07-07), ticket-ready**. Date : 2026-07-07.
> Modèle conceptuel qui **coiffe** [`DESIGN_alignment_curation_model.md`](DESIGN_alignment_curation_model.md)
> (dont il généralise les verbes) et précise le *pourquoi* en amont des mécaniques wire/bead.
> Dépendances / à confronter : [`DESIGN_R3_sentence_alignment.md`](DESIGN_R3_sentence_alignment.md)
> (alignement par beads, R3.2), [`DESIGN_peritext_conventions.md`](DESIGN_peritext_conventions.md)
> (alignement positionnel, rôles), le modèle **deux-grains** (¶ ⊃ phrase).
> Artefact-cible : [`Test-Alignement(Hugo) (1).csv`](Test-Alignement(Hugo)%20(1).csv) — la matrice
> multilingue prototypée à la main par l'utilisateur ; **c'est le schéma que l'export doit produire**.

## 0. Ce qui a déclenché cette note

Sur un vrai corpus (`LeCléziotest.db`, FR original + EN/RO/DE), trois constats successifs (session 2026-07-07) :

1. **L'aligneur (moteur) est sain.** Rejoué proprement, il produit le bon découpage (2-2, 2-1, 1-1 —
   vérifié sur WORKCOPY). Le « mauvais alignement » venait d'un **footgun** : `replace_existing=false`
   (défaut) → l'aligneur **fusionne par-dessus** l'existant en `INSERT OR IGNORE` et **droppe des liens
   en silence**. Corrigé par « Recalcul global » (`replace_existing=true`). *(Correctif amont distinct,
   noté §7-D-annexe.)*
2. **Le modèle par beads ne passe pas à N langues** (voir §1). C'est le vrai sujet.
3. **L'utilisateur a déjà prototypé la sortie voulue** : une matrice où l'**original est le moyeu** et
   chaque traduction est **recoupée pour s'y aligner 1-1** (le CSV ci-dessus). Cette note formalise ce
   modèle.

## 1. Pourquoi l'alignement par beads ne suffit pas (multi-parallèle)

L'alignement N-M **par paire** (Gale-Church, R3.2) apparie **différemment** chaque traduction contre la
source :

- FR↔EN : {§3,§4} ↔ EN17 (2-1 — l'anglais a fusionné)
- FR↔ES : §3 ↔ ES_a, §4 ↔ ES_b (1-1)
- FR↔RO : {§3,§4,§5} ↔ RO_x (3-1)

→ **`FR§3` n'a pas la même forme de bead selon la langue.** Il n'existe **aucune unité d'alignement
commune** aux N langues. Comparer les 6 langues à hauteur de `FR§3` obligerait à naviguer 6 groupements
distincts. *On ne peut pas laisser l'anglais décider du découpage du reste.* Le bead reste utile comme
**proposition de l'aligneur**, mais ce n'est pas la forme livrable.

## 2. Le modèle — le moyeu (source-anchored)

**L'original fait autorité sur la segmentation.** Chaque traduction est ramenée à la segmentation du
moyeu → **1-1 partout**, et l'alignement devient une **matrice** (lignes = segments-source, colonnes =
langues), avec le **grain paragraphe** comme cadre grossier :

| paragraphe | segment | Français *(moyeu)* | English | Roumain | … |
|---|---|---|---|---|---|
| 1 | 3 | Je l'entends maintenant… | I can hear it now… wherever I go **:** | îl aud şi acum… | … |
| 1 | 4 | Le bruit lent… | the tireless lingering sound… Rivière Noire. | Zgomotul lent… | … |

On **lit en travers d'une ligne** pour comparer toutes les langues à hauteur d'une phrase-source.
Ajouter une langue = une colonne de plus, **indépendante des autres traductions**. C'est exactement ce
que fait le CSV prototype (EN17 coupé au `:` entre §3 et §4, EN15 coupé entre §1/§2, EN16 fusionné dans §2).

- **D2 — Moyeu par défaut = l'original** (`doc_role='original'`, ou le **parent** dans la hiérarchie de
  famille) ; **surchargeable** par l'utilisateur, **au grain run/bitexte** (corpus futurs inconnus →
  flexibilité). Le moyeu est une *propriété de la vue alignée*, pas une constante globale. **Figé.**

## 3. Les deux formes du corpus (le cœur du modèle)

Le corpus a **deux formes**, dérivées des **mêmes** données stockées :

| Forme | Contenu | Rôle | Consommée par |
|---|---|---|---|
| **Documentaire** | chaque doc, **sa** segmentation propre (¶ + phrases), verbatim | substrat **indexé** (FTS) | la **recherche** du concordancier · exports par-doc |
| **Alignée** | moyeu + **couche d'alignement** (coupes / fusions / groupes) → matrice | **projection** cross-lingue | l'éditeur d'alignement · l'export matrice · **l'affichage parallèle** des résultats du concordancier (KWIC + traductions en regard) |

Principes (figés) :

- **D3 — La traduction existe *en soi* (Ontologie 1).** C'est un document de plein droit, interrogeable
  seul. L'alignement **n'est pas une transformation destructive** : c'est une **couche additive**, et la
  matrice en est une **nouvelle forme dérivée**. **Figé.**
- **D4 — La forme alignée est *projetée à la demande*, jamais matérialisée en copie.** Source de vérité
  unique = **documents + couche d'alignement**. Figer la matrice la ferait *dériver* — exactement le bug
  de staleness diagnostiqué cette session. On l'affiche et on l'exporte ; on ne la stocke pas. **Figé.**
- **D5 — On indexe le documentaire, on projette l'aligné.** Le FTS porte sur les **unités propres**
  (stables) ; la forme alignée (coupes = vue) n'est pas indexée mais **lue pour l'affichage** (y compris
  le concordancier parallèle). *On cherche dans la forme documentaire, on affiche aussi la forme alignée.*
  **Figé.**
- **Ce qui est destructif, et ce qui ne l'est pas** : aligner / couper / fusionner / grouper →
  **non-destructif** (enrichit la couche, docs intacts). **Seul** invalidant : **changer la segmentation
  du moyeu** (dépendance à sens unique moyeu → forme alignée). Toucher à la segmentation *propre* d'une
  traduction n'affecte pas la forme alignée.

## 4. Les gestes de curation (généralise la note curation)

L'aligneur **propose** (des beads length-based) ; l'utilisateur **raffine** côté traduction jusqu'à la
correspondance voulue. Cinq gestes, **tous chirurgicaux et non-destructifs**, dans la **vue Alignement** :

| Geste | Effet | Statut |
|---|---|---|
| **Couper** un segment de trad | une phrase cible fond 2 idées source → la scinder (au `:`, ou au jugement) pour du 1-1 | ❌ à construire |
| **Fusionner** deux segments de trad | la trad a sur-découpé → les recoller en une cellule | ❌ à construire |
| **Grouper (bead)** | *garder* 2 phrases entières alignées en groupe plutôt que couper (choix cas par cas) | tranche 2 de [curation model] |
| **Ré-ancrer** | corriger le pivot d'un lien | note curation D2 |
| **(Dé)grouper** | poser/retirer l'identité de bead | tranche 2 (socle K3 livré) |

- **D6 — « Couper » et « fusionner » sont des gestes d'*alignement*, pas de *segmentation*.** Aujourd'hui
  le merge/split d'unités vit dans la couche Segmentation (SegmentPane, R5.4b-3) et **efface l'alignement**
  (ADR-017). Ici il faut un **split/merge chirurgical qui recâble seulement le(s) lien(s) concerné(s)**,
  sans rejouer la segmentation. C'est l'enjeu technique n°1. **Figé (principe) ; mécanique → §7-D9.**

## 5. L'export — la matrice multilingue (contrat cible)

La matrice **est** la forme alignée matérialisée. Schéma cible = le CSV prototype, **durci** :

| Colonne | Rôle |
|---|---|
| `segment_id` | **clé stable** (round-trip : éditer dans Excel puis ré-importer sans casser l'appariement — l'index d'affichage ne suffit pas) |
| `paragraphe` | grain grossier (deux-grains) |
| `n` | index du segment-moyeu |
| `<langue-moyeu>*` | la référence, **marquée** (le moyeu peut changer, D2) |
| `<langue>` … | une colonne par traduction, recoupée sur le moyeu |

Le **format est le facteur décisif** pour les résidus N-M et les bords :

| Cas | CSV (plat) | Excel / Word (riche) |
|---|---|---|
| Découpe 1→2 (trad sur-découpe) | **fusionner** dans la cellule (trivial, séparateur `¶`) | multi-lignes dans la cellule |
| Fusion 2→1 sans coupe nette | texte + `[fusion]`, cellule partenaire vide marquée | **cellule fusionnée** sur les lignes-source |
| Omission | token `[non traduit]` | idem + style |
| Ajout | ligne d'ajout `[ajout]` en flux (D8) | idem, ou section à part (option export) |

- **D7 — Export cible = matrice multilingue ancrée-source**, une ligne par segment-moyeu, une colonne
  par langue. Le CSV prototype est le **schéma de référence**. **Figé.**
- **Asymétrie utile** (à exploiter dans l'outil) : **fusionner** est trivial (concaténer, zéro jugement) ;
  **couper** demande un point de coupe (le `:` sauveur, sinon jugement humain). Le seul cas dur est donc
  « la traduction a fusionné plusieurs phrases-source ».

## 6. Cas-bord — statut par cellule

`[non traduit]`, `[ajout]`, rôles structurels (titre/chapitre) ne sont pas du *texte* : c'est un
**statut porté par la cellule** (par couple *ligne × langue*, pas par ligne — EN peut omettre, DE non).
En CSV plat, l'encoder **dans la cellule** (token) garde la matrice plate et N-langues.

**Déjà bâti au moteur** : cet axe existe — **`units.unit_status ∈ {non_traduit, ajout}`** (R4.1,
migration 023, filtrable en recherche/facettes), **orthogonal à `unit_role`**, alimenté par le marker-lift
(`[non traduit]`/`[+]`) ou à la main. La note péritexte le tenait déjà : une **omission** = une unité
placeholder (`text_norm` vide → hors FTS) `unit_status=non_traduit` qui **garde la position** ; un **ajout**
= une unité `unit_status=ajout` (un 0-1). → la matrice **lit `unit_status`**, elle n'invente rien.

- **D10 — Omission = token `[non traduit]`** (pas cellule vide, ambiguë avec « pas encore fait »), issu de
  `unit_status=non_traduit`. **Figé.**
- **D11 — Statut par cellule = `unit_status` sur l'unité** (une *tranche* de coupe n'a pas de statut propre :
  elle est traduite par définition), matérialisée en token intra-cellule (CSV) / couleur-commentaire
  (Excel) / marqueur (Word). Conçue une fois, pas par format. **Figé.**

## 7. Décisions

**Figées** (session 2026-07-07) : D2 (moyeu original/parent surchargeable) · D3 (Ontologie 1, couche
additive) · D4 (forme alignée projetée, jamais matérialisée) · D5 (index documentaire / projection alignée) ·
D6 (couper/fusionner = gestes d'alignement chirurgicaux) · D7 (matrice multilingue = export cible) ·
D10/D11 (statut par cellule = `unit_status`, omission = `[non traduit]`).

- **D8 — Les ajouts (tranché).** Donnée = `unit_status=ajout` (déjà bâti). **Projection (a) par défaut** :
  une **ligne d'ajout en flux**, à sa position, cellule-moyeu `[ajout]`, le texte dans sa colonne-langue —
  honnête, fidèle au flux, cohérent avec le modèle positionnel. **(c) « section ajouts à part » = option
  d'export** (matrice principale 100 % 1-1 + liste des ajouts ancrés) pour une comparaison pure. Comme la
  matrice est une *projection* (D4), les deux vues dérivent des mêmes unités `ajout` — pas de choix rigide.
  **(b) rattachement au voisin écarté** (dilue l'ajout, casse « 1 ligne = 1 segment-moyeu »). **Figé.**
- **D9 — Stockage des coupes (tranché) = (i) offsets sur le lien, côté cible.** Deux colonnes `nullable`
  `target_char_start` / `target_char_end` sur `alignment_links` (null = unité entière), **offsets dans
  `text_raw`** (verbatim, immuable → stables). Couper EN17 = poser des offsets complémentaires sur les deux
  liens du bead (`EN17[0:X]` / `EN17[X:]`) — **non-destructif** (EN reste 7 phrases, FTS intacte). Les liens
  coupés **gardent `bead_id`/`bead_uid`** (couper *raffine* le bead : provenance + undo/re-fusion ; sans
  effet collision — le détecteur groupe par pivot, or ce sont deux pivots distincts). **On ne coupe jamais
  le moyeu** → pas d'offsets côté pivot. **Fusionner (1→M) ne touche pas au schéma** (déjà un bead 1-M dont
  la matrice concatène les cibles). (ii) sous-grain écarté : la matrice étant une projection, des segments
  d'alignement persistants sont inutiles. **Figé.**
- **D-annexe (footgun aligneur)** — indépendant mais réel : rendre « Recalcul global » (remise à plat) le
  défaut sur une paire déjà alignée, **ou** avertir quand un run droppe des liens (`links_skipped`/
  `deleted_before` existent déjà dans le rapport ; il suffit de les surfacer + confirmer). Petit,
  moteur+front.

## 8. Implications (haut niveau, à préciser au ticket)

- **Moteur** : migration additive = 2 colonnes `nullable` `target_char_start/end` sur `alignment_links`
  (D9) ; le geste **couper** pose des offsets, **fusionner** réutilise le bead 1-M (rien de neuf) ; ajouts/
  omissions réutilisent **`unit_status`** (déjà bâti, R4.1). Le socle **K3 `bead_uid`** (livré) porte le
  groupement inter-runs. Aucune logique lourde.
- **Contrat** : nouveaux gestes (couper/fusionner) + endpoint d'export **matrice multilingue** (l'export
  bilingue par paire existe déjà ; la matrice N-langues est un **produit neuf**). Additif.
- **Non-destructif / pas de staleness** : la forme alignée reste **dérivée** (D4) — l'export la projette,
  ne la fige jamais.
- **Front** : les gestes dans la **vue Alignement** (pas Segmentation) ; l'affichage d'un bead 2→1 **en
  bloc** (cible une seule fois, pivots accolés, badge « 2→1 ») corrige au passage le rendu illisible
  actuel (une ligne par lien qui duplique le texte cible).

## 9. Ordre — état (2026-07-07)

1. **Affichage bead en bloc** *(front pur)* — ✅ **livré** (`05cb44b`, CI verte).
2. **Couper / fusionner chirurgicaux** *(moteur + front)* — **en cours** :
   - ✅ **socle « couper »** — offsets cible `target_char_start/end` (migration 027), service +
     validation, actions additives `set_target_span`/`clear_target_span`, contrat 1.6.50 (`8f2bc1f`) ;
   - ✅ **audit expose `target_text_raw` + offsets** — contrat 1.6.51 (`f80348e`) ;
   - ✅ **rendu d'un bead coupé** en tranches 1-1 (front, badge « ✂ coupé », slicing code-point) ;
   - ✅ **cut-picker** — « ✂ Couper » sur un bead 2-1 → picker inline (cible verbatim, clic entre mots
     = offset code-point) → `set_target_span` ×2 + update optimiste ; « ↺ » pour annuler ;
   - 🔲 **fusionner / grouper** — action `set_bead`/`clear_bead`, réutilise le socle K3 ;
   - 🔲 **cut-picker N-1** (>2 sources : plusieurs points de coupe) + coupe dans la **vue famille**.
3. **Export matrice multilingue** *(moteur + front)* — ✅ **livré** :
   - ✅ **moteur** — `POST /export/matrix` (service `matrix_export_service` — projection coupes
     `text_raw[cs:ce]` + concat beads + omission, *dérivée jamais stockée* D4 ; contrat 1.6.52) ;
   - ✅ **front (C2)** — carte « Matrice multilingue » dans l'écran Exports : sélecteur de famille
     (moyeu = `family_root_id`) + format (CSV `;`/`,` · TSV) → `save()` → `/export/matrix` en 1 clic.
4. **Statuts/ajouts** *(D8/D10/D11)* — 🔲 une fois la mécanique en place.
