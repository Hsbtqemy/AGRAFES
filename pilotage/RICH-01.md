---
chantier: RICH-01
statut: interrompu
---

# RICH-01 — stylisation inline : ce que l'import perd encore, ce que l'export invente

**Arrêté sur** — geste de stylisation livré dans les trois couches du canvas (`9928be4`), modèle figé dans `docs/DESIGN_inline_restyling.md` ; restent l'asymétrie TEI, les deux autres surfaces et la trace de main, 25 août 2026.

## Reste

- [ ] L'import TEI aplatit les `<hi>` par `itertext()` (`tei_importer.py:169`) alors que l'export les reconstruit (`tei.py:50`) : réimporter un export perd la stylisation, silencieusement
- [ ] Trancher si l'import TEI doit accepter d'autres `rend` que les six tokens connus (garder tel quel ? mapper vers le plus proche ? refuser ?) — la décision manque avant d'écrire la ligne de code
- [x] Vérifier l'aller-retour sur `readable_text` et le `# text =` de CoNLL-U — fait : CoNLL-U lit `COALESCE(text_raw, text_norm)` et `readable_text` offre déjà `source_field` ; le constat est désormais suivi dans **SORT-01**, qui en porte deux items
- [ ] ODT — `odt_extract_style_map` ne lit que `office:automatic-styles` et ne résout pas `style:parent-style-name` : un span héritant d'un style nommé italique passe à travers (0 cas sur les 23 ODT locaux, donc dette assumée tant que rien ne le contredit)
- [ ] Décider si `text_norm` doit cesser de porter les entités XML (`&amp;`) sur les lignes riches : `normalize()` tourne sur un `text_raw` déjà échappé, donc une ligne riche contenant `&` s'affiche « &amp; » et se cherche mal en FTS
- [ ] Vérifier sur données réelles quelle proportion des lignes **entièrement** en gras est un titre ou un intertitre plutôt qu'une emphase — 598 cas mesurés sur les `.docx` locaux, dont 589 sous 120 caractères, mais la longueur est un proxy et non une preuve
- [ ] Si la proportion tient, trancher où le signal s'applique : pré-remplissage du rôle à l'import, ou simple proposition dans la couche Rôles — sans jamais retirer le `<hi rend="bold">` de `text_raw`, dont l'aller-retour TEI dépend
- [ ] Rendre l'original consultable sur une ligne **corrigée** : depuis le geste, une ligne *restylée* l'offre déjà (le repli s'ouvre puisque `text_raw` diverge alors de `text_source`), mais une ligne seulement corrigée ne l'offre toujours pas — `hasImportOriginal` se règle sur `text_source`, que l'import pose égal à `text_raw` ; et le repli n'est câblé que dans la couche Segmentation
- [ ] Trancher la consultation de la stylisation dans le concordancier : la lecture page par page existe déjà (`_fetch_unit_texts`), le coût réel est la projection des offsets KWIC, calculés sur `text_norm`, vers un `text_raw` que chaque balise décale
- [x] Implémenter le geste de restylisation dans le canvas — livré le 25 août pour les couches Rôles, Curation et Annotation (`CanvasUnitList`), sans aucun changement moteur
- [ ] Porter le geste dans la couche **Segmentation** : `SegmentPane` a son propre rendu et n'hérite donc pas de la primitive du canvas
- [ ] Porter le geste dans la **matrice** (D-R3, la surface qui compte pour la traduction) : suppose d'abord de transporter `text_raw` jusqu'aux cellules, `MatrixCell` ne portant que `text`
- [ ] Trancher **D-R4**, la trace d'une stylisation posée à la main — en même temps que la même question pour les tokens dans `ANN-01`, pour ne pas inventer deux mécanismes ; noter que l'export TEI ne recopie que l'attribut `rend` (`tei.py:80`), donc un `resp` serait perdu à la sortie
- [x] Mesurer, sur les lignes réellement corrigées du corpus, la proportion de fragments stylés retrouvables sans ambiguïté — fait le 25 août : 24 unités stylées, **une seule** corrigée depuis, donc rien à mesurer et réapplication automatique écartée

## QA

- qa/italique-import.md
- qa/stylisation-inline.md

## Contexte

**Ce qui est déjà fait, et qu'il ne faut pas refaire.** Trois lots poussés sur `refonte`
le 24 août :

- `0806c66` — `richTextToHtml` ne rend le balisage que s'il décrit encore le texte
  courant. Le stylo (D-C1), la curation et le *marker lift* réécrivent `text_norm` en
  gardant `text_raw` comme provenance ; sur une ligne qu'ils ont touchée, le canvas
  affichait le verbatim d'avant correction. Le pliage JS réplique `normalize()` — vérifié
  par test différentiel sur 4 012 lignes réelles, 0 divergence. Une seconde garde refuse
  d'injecter du HTML venu d'un import verbatim (txt/TEI contenant littéralement `<hi`).
- `b5491e5` — l'italique porté par un style de caractère (Word *Emphasis* /
  « Accentuation », *Strong* pour le gras) n'est plus perdu : python-docx ne rapporte que
  le formatage direct, `run.italic` valant `None` dans ce cas.
- `4d21d69` — le balisage devient visible dans les couches Rôles, Curation et Annotation
  (`CanvasUnitList`), qui affichaient du texte plat.

**Livré le 25 août.** Le modèle pur (`richTextModel`, style par caractère), la lecture de sélection (`richSelection`), le geste et sa barre I/G dans les trois couches que sert `CanvasUnitList`, plus une passe adverse qui a rattrapé quatre gardes — dont le refus de styliser une ligne repeinte par la surcouche de tokens, où les offsets auraient visé à côté. Commits `69c3799`, `0dd89a0`, `9928be4` ; passe de QA `qa/stylisation-inline.md`. Ces commits ne citent pas le code du chantier dans leur sujet, contrairement à l'usage du dépôt : le journal ne les rattachera donc pas tout seul, d'où leur rappel ici.

**Ce que la mesure a dit, et qui recadre la priorité.** Sur les 53 documents en base dont
le fichier source a été retrouvé en local : 3 runs en italique direct, **0** via style de
caractère. Rien n'était perdu sur l'existant. En revanche, sur les 785 `.docx` locaux :
7 198 runs en italique direct, **835 via style de caractère répartis sur 58 fichiers,
dont 33 sans le moindre italique direct** — concentrés dans le corpus presse
(`CI-OrEnTrFr`, `M-GW`), pas encore importé. Le correctif est une assurance avant la
prochaine vague, pas une réparation.

**Le piège de performance, pour mémoire.** `run.style` déclenche une résolution de style
complète dans python-docx : 0,305 ms par appel, soit 0,30 s → 10,65 s sur un document de
6 226 runs quand on la demande six fois par run. `_run_has_char_style` sonde le
`<w:rPr><w:rStyle>` sous-jacent, 500× moins cher, et seuls 46 runs sur 6 226 en portent
un. Toute évolution de ce module doit garder cette barrière — et la garder *testée sur de
vrais documents python-docx*, puisque les doublures n'ont pas de `_element` et la
contournent entièrement.

**Le gras n'a pas la forme de l'italique, et c'est le constat le moins attendu.** Sur les 66 770 paragraphes des `.docx` locaux, l'italique est de l'emphase inline — 2 085 des 2 247 paragraphes concernés (93 %) le portent sur un *fragment*. Le gras fait l'inverse : 598 des 832 (72 %) couvrent la **ligne entière**, dont 589 sous les 120 caractères. Ce sont des titres et des intertitres, et seuls 26 d'entre eux portent un style de paragraphe de titre — le seul signal que l'import regarde (`docx_paragraphs.py:61`). Les autres arrivent sans rôle : dans `8-CI-TrEn-2022_A Aligner.docx`, `n=1` (« Texte_8 ») et `n=2` (le titre de l'article) sont entièrement en gras avec `unit_role = None`, alors que la base porte déjà les rôles `titre` et `intertitre`. Autrement dit, un gras pleine ligne n'est pas de l'emphase : c'est un signal structurel encodé en stylisation inline.

Deux « signaux automatiques évidents » sont déjà morts à la vérification sur ce dépôt. D'où la forme des deux items ci-dessus : mesurer d'abord, décider ensuite, coder en dernier.

**Ce qu'une correction fait vraiment à la stylisation, mesuré.** Une correction du stylo réécrit `text_norm` et **ne touche pas** `text_raw` : sur une base jetable, une unité passée de 519 à 26 caractères garde ses 542 caractères de verbatim balisé. L'italique n'est donc jamais détruit — il cesse d'être affiché, parce qu'il ne décrit plus le texte courant. Mais aucune surface ne le montre ensuite : le repli d'original se règle sur `text_source`, que l'importateur pose **égal** à `text_raw` et que le stylo ne touche pas davantage. La donnée est là, en double, et l'écran n'a aucune porte pour l'ouvrir.

**L'enjeu de traduction.** Un italique marque un mot étranger, un titre d'œuvre, une insistance — autant de choses qu'une traduction rend autrement, et qu'on veut donc comparer. Voir la version d'origine ne suffira pas toujours : il faudra pouvoir re-styliser un texte corrigé, et ce geste n'existe pas. D-C1 avait prévu le retournement en toutes lettres — « réversible si un besoin *réécrire le verbatim* émerge » — c'est ce besoin qui émerge ici. Le versant *sortie* du même problème vit dans SORT-01 : aucun export ne porte à la fois le texte corrigé et sa stylisation.

**Pourquoi l'asymétrie TEI mérite un code.** On exporte un balisage qu'on ne sait pas
relire. Un utilisateur qui exporte en TEI puis réimporte croit récupérer son document et
récupère du texte nu, sans avertissement. C'est le seul des cinq points ci-dessus qui
détruit de l'information au su de l'outil.

Décisions applicables : ADR-002 (le `¤`), ADR-003 (la politique de normalisation que le
pliage front réplique), ADR-043 (`text_source`), D-C1 (`docs/DESIGN_inline_text_correction.md`
§9.2 — le stylo édite `text_norm` et garde `text_raw`).

Pas de champ `audit:` : aucun audit ne porte ce chantier, les mesures ci-dessus sont sa
seule source. Aucun ADR n'a jamais cadré la stylisation inline : le périmètre « formatage direct
seulement » de `f1c8658` (17 avril 2026) était un fait d'implémentation, pas une décision.
S'il faut en écrire un, c'est ici.
