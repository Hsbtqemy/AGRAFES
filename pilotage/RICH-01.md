---
chantier: RICH-01
statut: interrompu
---

# RICH-01 — stylisation inline : ce que l'import perd encore, ce que l'export invente

**Arrêté sur** — geste de stylisation livré dans les trois couches du canvas (`9928be4`), modèle figé dans `docs/DESIGN_inline_restyling.md` ; restent l'asymétrie TEI, les deux autres surfaces et la trace de main, 25 août 2026.

## Reste

- [ ] L'**aperçu d'import** affiche le balisage en toutes lettres — `ImportScreen.ts:712` pose `tdText.textContent = raw`, alors que toutes les autres surfaces qui montrent des unités passent par `richTextToHtml` (`CanvasUnitList.ts:228`, `SegmentPane.ts:477`, `UnitInspectorPanel.ts:164`). Constaté le 26 août sur `8-CI-TrEn-2022_A Aligner.docx` : la colonne texte rend `<hi rend="bold">Texte_8</hi>`. Effet de bord : la troncature à 120 caractères compte les balises, donc une ligne stylée montre moins de texte que les autres. Correctif possible sans changer le contrat — la charge de `/import/preview` ne porte que `text_raw` (`parsed.to_preview`), donc soit dépouiller par `stripHiTags` (`richTextModel.ts`) en gardant `textContent`, soit rendre le style avec `richTextToHtml(raw, stripHiTags(raw))`. Dépouiller suffit : l'aperçu répond « ce qui sera importé et où ça coupe », pas « à quoi ça ressemble »
- [ ] L'import TEI aplatit les `<hi>` par `itertext()` (`tei_importer.py:169`) alors que l'export les reconstruit (`tei.py:50`) : réimporter un export perd la stylisation, silencieusement. **Démontré de bout en bout le 25 août** sur le document 423 — exporté `<hi rend="italic">The Observer</hi>, 14<hi rend="bold"> Aug </hi>2022`, réimporté `The Observer, 14 Aug 2022` : 29 unités balisées à l'aller, zéro au retour. Vérifié au passage que l'indentation du fichier n'abîme rien : `ET.indent` insère bien une nouvelle ligne et dix espaces avant un `<hi>` en tête de paragraphe (9 unités du corpus commencent ainsi), mais le normaliseur les retire au réimport, tandis qu'une double espace *interne* survit — le nettoyage ne vise que les bords
- [ ] Trancher si l'import TEI doit accepter d'autres `rend` que les six tokens connus (garder tel quel ? mapper vers le plus proche ? refuser ?) — la décision manque avant d'écrire la ligne de code
- [x] Vérifier l'aller-retour sur `readable_text` et le `# text =` de CoNLL-U — fait : CoNLL-U lit `COALESCE(text_raw, text_norm)` et `readable_text` offre déjà `source_field` ; le constat est désormais suivi dans **SORT-01**, qui en porte deux items
- [ ] ODT — `odt_extract_style_map` ne lit que `office:automatic-styles` et ne résout pas `style:parent-style-name` : un span héritant d'un style nommé italique passe à travers (0 cas sur les 23 ODT locaux, donc dette assumée tant que rien ne le contredit)
- [ ] Faire cesser le portage des entités XML par `text_norm` — la chaîne est asymétrique : `para_to_rich_text` échappe chaque segment (`&` → `&amp;`) pour que `text_raw` reste du XML valide (`rich_text.py:39`), puis `normalize()` retire bien les balises `<hi>` (`unicode_policy.py:62`) mais **ne désamorce jamais l'échappement**. Les cinq caractères survivent dans la colonne indexée. **Portée mesurée le 25 août** : 24 unités portent `&amp;` dans `text_norm`, 5 portent `&lt;`, 9 portent `&gt;` ; **23 de ces unités sont indexées sous le mot fantôme « amp »** — une recherche sur `amp` rend 23 résultats pour un mot absent de tout texte source — et **3 tokens d'annotation ont pour mot « amp »**, étiquetés NOUN et PROPN par spaCy, lemme « amp ». L'esperluette n'est donc pas seulement mal affichée : elle a disparu du corpus en tant que caractère. **Deuxième conséquence, mesurée le 25 août** : le défaut se scinde en deux régimes selon que la ligne porte ou non une balise. Ligne **nue** — `richTextToHtml` retombe sur `_esc(text_norm)`, donc ré-échappe : « &amp; » s'affiche en toutes lettres, et le garde de cohérence de la stylisation voit 23 caractères à l'écran contre 19 attendus, donc **refuse silencieusement le geste** sur ces lignes. Ligne **balisée** — le navigateur résout l'entité, le compte tombe juste, le geste fonctionne. **Ce refus est un faux refus**, vérifié le 25 août : sur une ligne nue, l'écran affiche « &amp; » en toutes lettres, donc exactement les caractères de la base — les positions se correspondent une à une et le geste serait sûr. Le garde se trompe parce qu'il appelle `domLength()`, qui replie les entités inconditionnellement, alors que seule la branche **riche** de `richTextToHtml` les laisse résoudre par le navigateur ; la branche nue les ré-échappe (`sidecarClient.ts:142`). Le garde doit calculer la longueur attendue **selon la branche prise**, pas supposer le repliement. Vingt-quatre lignes du corpus sont bloquées pour rien
- [ ] Vérifier sur données réelles quelle proportion des lignes **entièrement** en gras est un titre ou un intertitre plutôt qu'une emphase — 598 cas mesurés sur les `.docx` locaux, dont 589 sous 120 caractères, mais la longueur est un proxy et non une preuve
- [ ] Si la proportion tient, trancher où le signal s'applique : pré-remplissage du rôle à l'import, ou simple proposition dans la couche Rôles — sans jamais retirer le `<hi rend="bold">` de `text_raw`, dont l'aller-retour TEI dépend
- [ ] Rendre l'original consultable sur une ligne **corrigée** : depuis le geste, une ligne *restylée* l'offre déjà (le repli s'ouvre puisque `text_raw` diverge alors de `text_source`), mais une ligne seulement corrigée ne l'offre toujours pas — `hasImportOriginal` se règle sur `text_source`, que l'import pose égal à `text_raw` ; et le repli n'est câblé que dans la couche Segmentation
- [ ] Trancher la consultation de la stylisation dans le concordancier : **confirmé le 25 août, il n'en montre rien** — le KWIC (`query.py:830`, `highlight_segment(text_norm)`), le mode segment (l. 689, 763) et la lecture page par page de la recherche grammaticale (`token_query.py:332`, qui sélectionne explicitement `text_norm`) lisent tous le texte sans balise ; l'italique existe en base et reste invisible à la consultation. Le coût réel est la projection des offsets KWIC, calculés sur `text_norm`, vers un `text_raw` que chaque balise décale
- [ ] **Défaut mesuré le 25 août** — le post-filtre « respecter la casse » teste `t in row["text_raw"]` (`query.py:1253-1259`) : styliser **le milieu d'un mot** y insère une balise qui coupe le mot, et l'unité disparaît des résultats en recherche sensible à la casse. Vérifié sur « Observer » — mot entier `The <hi rend="italic">Observer</hi>` trouvé, milieu de mot `The Obs<hi rend="italic">erver</hi>` perdu ; la recherche ordinaire, elle, n'est pas touchée puisqu'elle passe par `text_norm`. Deux remèdes possibles : filtrer sur `text_norm` en respectant la casse d'origine, ou dépouiller `text_raw` de ses balises avant le test
- [x] Implémenter le geste de restylisation dans le canvas — livré le 25 août pour les couches Rôles, Curation et Annotation (`CanvasUnitList`), sans aucun changement moteur
- [x] Lever le refus de styliser pendant une correction — fait le 25 août : le refus tenait à un défaut **préexistant** au geste, `CanvasUnitList._mountEditor` ressemant la zone de saisie depuis `text_norm` à chaque rendu, donc toute frappe dans la recherche ou toute assignation de rôle effaçait la correction en cours sans un mot (prouvé par deux tests rouges avant correctif). Parade portée de `SegmentPane._textDraft` : brouillon relevé avant rendu, curseur et focus reposés, focus rendu seulement s'il était dans la zone de saisie. Styliser une **autre** ligne est désormais permis ; sur la ligne corrigée elle-même il n'y a par nature pas de texte à sélectionner
- [x] Garder le surlignage après un style — fait le 25 août : la barre et la sélection sont reposées sur la ligne réaffichée (`plainOffsetToDom` + `selectRangeIn`, l'inverse du chemin de lecture), ce qui rend possible d'enchaîner I puis G sans re-viser, et de **retirer** d'un second clic ce qu'on vient de poser sans remonter à *Annuler* — le modèle rejouait déjà chaque marque exactement à l'envers, seul le DOM manquait
- [x] Le garde de cohérence cessait de deviner — **fait le 26 août** : la couche qui repeint une ligne le déclare désormais (`markRowTextRepainted`, appelé par `AnnotationPane._decorateAnnotated` juste avant de remplacer le texte), au lieu qu'on le déduise d'une comparaison de longueurs. Les 196 unités où deux écarts d'espacement se compensaient sont refusées comme les autres, et l'écart entre vue Prose et vue Étendue disparaît : le refus tient au repeint, pas à une coïncidence de comptage. Test posé sur le cas espagnol exact (« ¡Vaya caterva ! » stocké contre « ¡ Vaya caterva! » affiché, 15 caractères des deux côtés)
- [x] La conversion d'offsets connaît la branche de rendu — **fait le 26 août** : `rendersRich` est extrait de `richTextToHtml` et devient la seule source de vérité du choix ; `_styleBase` s'y aligne, si bien que **la base à styliser est exactement la chaîne dont l'écran est le rendu**. Sur la branche nue la conversion est l'identité, et les 24 lignes à esperluette se stylisent correctement (test : `Fleury &amp; A.` + italique sur « A. » rend `Fleury &amp; <hi rend="italic">A.</hi>`). Bénéfice non prévu, mesuré : **47 lignes** du corpus ont un `text_raw` et un `text_norm` de longueurs différentes tout en étant « en phase » — BOM en tête, caractères de largeur nulle — et l'ancienne base y décalait le style sans que rien ne le signale
- [x] Le remède est appliqué — **fait le 26 août**, en une tranche front, sans changement moteur ni artefact de contrat : `rendersRich` exposé, `_styleBase` et les deux traducteurs d'offsets alignés dessus, le marqueur de repeint posé par la couche, la barre ancrée sur la sélection. 1139 tests, `tsc` et ESLint à zéro
- [ ] Décider comment la stylisation figure dans l'historique *Annuler* — mesuré le 25 août : chaque clic sur I ou G passe par `/units/update_text`, qui inscrit sans condition une action `update_text` décrite « Édition du texte (unité N) » (`units_service.py:412`). Poser puis retirer l'italique laisse donc **deux** entrées (31 → 32 → 33 sur le document 423), **indiscernables d'une correction au stylo** — et il n'existe aucune liste où le constater : le bouton n'annonce que la **prochaine** action annulable (`undo.py:76`, `_latest_undoable_row`), si bien qu'après deux clics de stylisation on ignore combien d'annulations séparent du texte d'origine. L'annulation elle-même est correcte (le snapshot porte `text_raw_before`) ; c'est l'étiquette et le volume qui trompent. Pistes : une description distincte (« Mise en forme »), ou un type d'action propre — ce dernier coûte une migration, la colonne `action_type` étant sous contrainte `CHECK`
- [x] La barre est ancrée sur la **sélection** — **fait le 26 août** : `_showStyleBar` lit le rectangle de la plage sélectionnée et ne retombe sur celui de la ligne que s'il est vide (cas de happy-dom, où tout vaut zéro). La barre ne part plus hors écran quand on défile dans une unité longue
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
