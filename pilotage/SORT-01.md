---
chantier: SORT-01
statut: à venir
---

# SORT-01 — le texte exporté n'est pas le texte courant

**Point de départ** — constat trouvé en creusant une question sur l'italique, prouvé bout en bout par un export TEI et chiffré sur la base de travail, aucune ligne écrite, 25 août 2026.

## Reste

- [ ] Trancher la nature de `text_raw` : soit chaque export choisit sa colonne comme le fait déjà l'export lisible (`source_field`), soit `text_raw` redevient le verbatim **courant** que l'ADR-043 décrit — la décision engage l'ADR et commande tous les items suivants
- [ ] L'export TEI lit `text_raw` (`tei.py:529`) : toute ligne corrigée au stylo ou par la curation s'exporte dans son état d'import — prouvé, le texte corrigé n'apparaît pas une seule fois dans le fichier produit
- [ ] Le `# text =` de CoNLL-U lit `COALESCE(text_raw, text_norm)` (`conllu_export.py:85`) : même texte périmé, plus les balises `<hi>` en toutes lettres
- [ ] Aucun export ne porte à la fois le texte corrigé **et** sa stylisation : décider si cet export doit exister, sachant qu'il suppose de projeter le balisage sur un texte que la correction a déplacé
- [ ] Vérifier l'ampleur sur les corpus réellement curés avant de choisir le remède : 450 lignes sur 5 documents dans la base de travail, dont 446 dans un seul, mais la plupart des écarts sont fins (espaces insécables, ponctuation)
- [ ] Vérifier si `/export/ske` et l'export de matrice sont concernés — je ne les ai pas ouverts, leur colonne de texte n'est pas apparue au grep
- [ ] Décider si un export doit *dire* ce qu'il exporte (verbatim d'import ou texte courant), plutôt que de laisser le lecteur du fichier le deviner

## QA

Aucune passe : rien de tout cela ne se voit à l'écran, il faut ouvrir le fichier produit.
Une passe deviendra possible quand l'export annoncera sa colonne — c'est cette annonce qui
sera vérifiable, pas le silence actuel.

## Contexte

**Le constat.** `Beigbeder-Francs_FR.docx` a 446 lignes dont le texte courant diffère du
verbatim d'import. Exporté en TEI aujourd'hui, il expédie les 446 dans leur état d'import.
Vérifié bout en bout, pas déduit : sur une base jetable, une unité corrigée par le vrai
chemin moteur (`units/update_text`) puis exportée en TEI ressort avec son texte d'origine,
et le texte corrigé n'apparaît nulle part dans le fichier.

**Ce que chaque export lit.**

| export | colonne | après une correction |
|---|---|---|
| TEI (`tei.py:529`) | `text_raw` | texte d'import, avec stylisation |
| CoNLL-U (`conllu_export.py:85`) | `COALESCE(text_raw, text_norm)` | texte d'import + balises littérales |
| lisible txt/docx/odt | `text_norm` par défaut, `source_field` au choix | texte courant, sans stylisation |
| CSV / TSV / JSONL / HTML | `text_norm` | texte courant, sans stylisation |
| TMX et bilingue (`sidecar.py:7798`) | `text_norm` des deux côtés | texte courant, sans stylisation |

**Pourquoi ça arrive.** L'ADR-043 définit `text_raw` comme le verbatim *courant*. C'est
une fiction : trois chemins d'écriture ne le mettent jamais à jour — le stylo (D-C1), la
curation (`curation.py:357`) et le *marker lift* (`marker_lift.py:215`) réécrivent
`text_norm` seul. `text_raw` est donc le verbatim **d'import**. L'export TEI a choisi cette
colonne pour une raison légitime — garder le balisage `<hi>`, que `text_norm` ne porte pas
— et a hérité du texte périmé par effet de bord. C'est le même défaut que celui corrigé à
l'affichage le 24 août (`0806c66`), à ceci près qu'ici le fichier quitte l'outil.

**L'enjeu, formulé au plus net.** Le seul export qui porte la stylisation est périmé, et
tous ceux qui portent le texte à jour sont nus. Pour comparer une source et sa traduction
en tenant compte de l'emphase — un italique marque un mot étranger, un titre d'œuvre, une
insistance que le traducteur a rendue autrement — il n'existe aujourd'hui **aucun chemin
de sortie correct**. C'est ce qui distingue ce chantier de RICH-01 : là-bas il s'agit de
voir la stylisation dans l'outil, ici de ne pas publier un texte qui n'est plus le nôtre.

**Une nuance à ne pas perdre.** Exporter le verbatim d'import est un besoin légitime — on
peut vouloir publier le texte tel qu'il est arrivé. Le défaut n'est pas de le faire, c'est
de le faire sans le dire et sans laisser le choix, alors que l'export lisible offre déjà
ce choix par `source_field`.

Pas de champ `audit:` : aucun audit ne porte ce chantier, la mesure et l'export de preuve
ci-dessus en sont la seule source.
