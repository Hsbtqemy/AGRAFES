---
chantier: EXPO-01
statut: à venir
---

# EXPO-01 — la page des exports : huit portes pour six sorties

**Point de départ** — demande de refonte de la présentation, écran mesuré au code, aucune ligne écrite, 26 août 2026.

> À ne pas confondre avec **EXP-01** (explorateur autonome), ni avec **SORT-01**, qui porte
> un défaut de *contenu* des exports — quelle colonne de texte ils lisent. Ici il s'agit de
> la *page* : combien de portes elle offre, et laquelle prendre.

## Reste

- [ ] **Trancher la porte unique** — le formulaire unifié devient-il le seul chemin (il absorbe alors bilingue/TMX et matrice, qu'il ne couvre pas), ou disparaît-il au profit de formulaires nommés ? Toutes les décisions suivantes en découlent ; tant qu'elle n'est pas prise, chaque item se règle deux fois
- [ ] **Les trois « TEI XML » du formulaire unifié produisent le même fichier** — `PRODUCT_BY_STAGE` offre `tei_xml` sous « documents sélectionnés », « segments validés » et « texte revu » selon l'étape, mais `stage` n'atteint jamais la requête (`ExportsScreen.ts:636-668` : `out_dir`, `include_structure`, `relation_type`, `doc_ids`). Décider : soit l'étape change réellement l'export, soit elle cesse de figurer dans le libellé
- [ ] Même question pour `readable_text`, offert sous un libellé identique dans deux étapes — la duplication y est visible, mais elle ne dit pas davantage laquelle prendre
- [ ] **Cinq produits sur six ont deux portes** : `tei_xml`, `tei_package`, `aligned_table`, `run_report`, `qa_report` sont atteignables par le formulaire unifié ET par leur formulaire nommé sous « Exports avancés ». Décider lequel des deux chemins survit, produit par produit
- [ ] **Deux exports n'existent QUE hors du formulaire unifié** — bilingue/TMX et matrice multilingue. « Tout est dans le formulaire unifié » est donc faux, et c'est ce qui rend le repli « Exports avancés » impossible à ignorer
- [ ] **La carte « Documents source » ne porte qu'un seul export** — ses cases alimentent `_v2DocSelEl` et rien d'autre (`ExportsScreen.ts:507-512`). Elle occupe la tête de page comme une portée globale alors qu'elle scope un huitième de l'écran. Décider : portée réellement globale, ou carte déplacée dans le formulaire qu'elle sert
- [ ] **Onze sélecteurs de portée sur un écran** — cinq « quels documents / quelle famille » (`#v2-doc-sel`, `#tei-doc-sel`, `#pkg-doc-sel`, `#bil-family-sel`, `#matrix-family-sel`) et six pivot/cible. Réduire, ou expliquer pourquoi ils ne peuvent pas l'être
- [ ] Décider du sort du repli « Exports avancés (formulaires séparés) » : un repli qui cache cinq doublons et deux exports uniques n'est ni un rangement ni une dépréciation
- [ ] **Nommer les sorties par ce qu'on en fait**, pas par leur format — c'est ce qui répond à « je ne sais pas lequel prendre ». Un utilisateur cherche « comparer une source et sa traduction », pas « TMX » ; il choisit aujourd'hui entre huit boîtes qui annoncent des formats
- [ ] Vérifier si le préremplissage depuis d'autres écrans (`applyWorkflowPrefill`, `ExportWorkflowPrefill.stage`) survit à la décision : il pointe aujourd'hui une étape qui ne change rien

## QA

Aucune passe pour l'instant : la page se réorganise avant de se vérifier. Une passe
deviendra utile quand la décision de porte unique sera prise — elle portera sur « le
même export produit le même fichier par le chemin retenu », ce qui est vérifiable, et
non sur l'impression d'encombrement, qui ne l'est pas.

## Contexte

**Ce que la page présente.** Neuf boîtes, dont huit qui exportent.

| boîte | où | couverte par l'unifié ? |
|---|---|---|
| Documents source | tête de page (`:51`) | — (c'est un sélecteur) |
| formulaire unifié (étape → produit → format) | tête de page | — |
| Export bilingue / TMX | visible (`:196`) | **non** |
| Matrice multilingue | visible (`:231`) | **non** |
| Export TEI | repli (`:268`) | oui |
| Package publication | repli (`:299`) | oui |
| Export alignements | repli (`:337`) | oui |
| Rapport des runs | repli (`:364`) | oui |
| Rapport QA corpus | repli (`:384`) | oui |

Lignes de `tauri-prep/src/lib/exportsScreenTemplate.ts`. Le repli est commandé par
`#exports-toggle-legacy-btn`, titré « Exports avancés (formulaires séparés) ».

**Ce que le formulaire unifié produit vraiment.** Six produits distincts, pas davantage
(`tauri-prep/src/lib/exportV2Options.ts`) : `aligned_table`, `tei_xml`, `tei_package`,
`readable_text`, `run_report`, `qa_report`. Ils sont répartis sur six étapes, ce qui
fabrique dix combinaisons pour six sorties.

**Le point le plus dur, parce qu'il ne se voit pas.** `tei_xml` est proposé trois fois,
sous trois libellés qui promettent trois choses :

| étape | libellé affiché | export réellement produit |
|---|---|---|
| Alignement | TEI XML (documents sélectionnés) | identique |
| Segmentation | TEI XML (segments validés) | identique |
| Curation | TEI XML (texte revu) | identique |

`stage` n'apparaît que trois fois hors du câblage d'interface : sa déclaration de type,
`productsForStage(stage)` qui filtre la liste des produits, et une phrase de résumé
(`:625`). Il n'entre dans aucune requête. Les paramètres envoyés sont `out_dir`,
`include_structure`, `relation_type`, `doc_ids` — vérifié sur le corps de l'appel, pas
déduit d'un grep. Trois libellés, une seule requête, trois fichiers identiques.

Ce n'est donc pas l'utilisateur qui hésite : c'est l'écran qui promet une distinction
qu'il n'applique pas. Corriger la présentation sans trancher ce point reviendrait à mieux
ranger trois portes qui donnent sur la même pièce.

**Pourquoi il y a deux chemins.** Le formulaire unifié est arrivé après les formulaires
nommés, et les a repoussés derrière un repli sans les remplacer — il n'en couvre que
cinq sur sept. Le repli n'est donc ni un rangement (il cache des doublons) ni une
dépréciation (il cache aussi deux exports qu'on ne trouve nulle part ailleurs). C'est
l'état intermédiaire d'une migration qui n'a pas été finie, et c'est lui qui produit
l'encombrement ressenti.

**Ce qui n'est pas en cause.** La justesse des exports eux-mêmes. Un fichier produit par
le formulaire unifié et par son doublon nommé est le même fichier — le défaut est qu'il
faille le savoir. Le contenu, lui, a son propre chantier : `SORT-01` établit que TEI et
CoNLL-U exportent le texte d'import et non le texte courant. Les deux se traitent
séparément, mais l'item « nommer les sorties par ce qu'on en fait » les touche tous les
deux : dire « texte revu » alors qu'on exporte le verbatim d'import est le même mensonge
des deux côtés.

Pas de champ `audit:` : aucun audit ne porte cet écran, les mesures ci-dessus en sont la
seule source.
