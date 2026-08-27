---
passe: Import — l'aperçu comparatif des modes
chantier: IMPO-01
duree: 25 min
derniere: 2026-08-27
---

# QA — l'écran montre ce que chaque mode ferait du fichier

Passe écrite le 27 août, **avant** de déclarer le lot fini — c'est ce geste qui a trouvé
trois défauts dans le lot précédent. Elle valide l'aperçu comparatif : une ligne par mode,
les comptes qui séparent, le mode recommandé, et le cas où l'écran doit dire qu'**aucun**
mode ne lit le document plutôt que d'en pré-sélectionner un.

**Le sidecar doit porter le contrat 1.6.80.** Le tableau a besoin de `units_line`, que
seul un binaire postérieur au commit `389c384` renvoie. Sans lui, **le tableau ne
s'affiche pas du tout** — c'est délibéré : un sidecar plus ancien ferait conclure « aucun
mode ne lit ce document » sur *tous* les fichiers, et un faux verdict est pire que rien.
Si vous ne voyez aucun tableau sur `2021_Texte1`, c'est le sidecar qu'il faut suspecter
avant le code. Reconstruire avec `python scripts/build_sidecar.py --preset shell
--format onefile`, application fermée.

**Où ça se passe.** Écran **Importer**, carte **« Aperçu texte »** — repliée par défaut, il
faut la déplier. Le tableau est en haut de la carte, au-dessus de la note de tableau et de
la liste des unités. **Rien n'est à importer dans cette passe** : on ajoute des fichiers, on
regarde, on retire.

**Ce que le tableau affiche.** Une ligne par mode comparable — deux pour un `.docx` ou un
`.odt`, un seul pour un `.txt`. Colonnes : *Mode*, *Unités*, *Trouvables à la recherche*,
*Non indexées*, *Première unité*. La ligne du mode courant porte un ✓ et un fond gris ; le
mode recommandé porte une pastille verte **recommandé**. Chaque nom de mode est cliquable.

**La colonne qui décide est celle du milieu.** Sur plusieurs des cas ci-dessous, les deux
modes rendent **le même total d'unités** et ne se séparent que sur combien sont trouvables.
Un tableau lu en diagonale sur la colonne *Unités* ne dirait rien.

**Ce que la pastille « recommandé » suit — mis à jour le 27 août.** Elle marque désormais le
mode que la **déduction** a posé sur la ligne du fichier (signal des marqueurs), et non celui
qui compte le plus d'unités trouvables. Sans quoi l'écran se contredirait : la carte du fichier
poserait un mode et le tableau juste en dessous en recommanderait un autre. Le comptage garde
la seule question où il ne peut pas se tromper — **quelque chose lit-il ce document ?** — d'où
le bandeau « Aucun mode ne lit ce document », qui n'a pas changé. Sur les cas de cette passe les
deux règles désignent le même mode ; elles divergent sur `Houellebecq-Plateforme_FR.docx`, qui
est joué par `qa/import-deduction-mode.md`.

**Les cinq cas, mesurés au parseur le 27 août 2026.**

| fichier | mode | unités | trouvables | non indexées |
|---|---|---|---|---|
| `2021_Texte1…Tableau.docx`, **colonne 1** | Paragraphes | 48 | **48** | 0 |
| | Lignes numérotées [n] | 48 | **0** | 48 |
| `2021_Texte1…Tableau.docx`, **sans colonne** | Paragraphes | 0 | 0 | 0 |
| | Lignes numérotées [n] | 0 | 0 | 0 |
| `Coe-House-AL_FR.docx` (blob) | Paragraphes | 1 | 1 | 0 |
| | Lignes numérotées [n] | 836 | **833** | 3 |
| `Asimov-Foundation_FR_réaligné.odt` | Paragraphes | 1141 | **1141** | 0 |
| | Lignes numérotées [n] | 1141 | **0** | 1141 |
| `9_CI-TrFr-2021_Aligné_UTF8.txt` | TXT lignes numérotées [n] | 48 | **0** | 48 |

Les deux premiers dossiers sont sous `OneDrive_2026-06-29\00-Hugo-Corpus Multilingues` ;
le `.odt` est dans `GRAFE-Lit-EnFr-REAligné-DOCX`, le `.txt` dans `CI-2021\CI-OrEnTrFr-2021_Aligné`.

### Le tableau et ses comptes

- [ ] `2021_Texte1…Tableau.docx` ajouté, colonne **1** saisie : le tableau affiche **deux lignes**, Paragraphes et Lignes numérotées [n]
- [ ] Les deux lignes annoncent **48 unités** — le total ne les sépare pas
- [ ] La ligne Paragraphes annonce **48 trouvables** et **0 non indexées**
- [ ] La ligne Lignes numérotées annonce **0 trouvables** et **48 non indexées**
- [ ] La colonne « Première unité » affiche **« Texte 1 »** sur les deux lignes, **sans balise** — le texte est en gras dans la source
- [ ] Un `.txt` n'affiche qu'**une seule ligne** de tableau : il n'a qu'un mode comparable

### Le mode recommandé

- [ ] Sur `2021_Texte1` colonne 1, la pastille **recommandé** est sur **Paragraphes**
- [ ] Sur `Coe-House-AL_FR.docx`, elle est sur **Lignes numérotées [n]** : la recommandation suit le document, pas une préférence de mode
- [ ] Sur `Asimov-Foundation_FR_réaligné.odt`, elle est sur **Paragraphes**, alors que les deux modes annoncent 1141 unités — le total ne les sépare pas, la colonne du milieu si
- [ ] La ligne du mode **actuellement retenu** pour le fichier porte un ✓ et se distingue visuellement, qu'elle soit recommandée ou non

### Quand aucun mode ne lit le document

- [ ] `2021_Texte1…Tableau.docx` ajouté **sans saisir de colonne** : les deux lignes annoncent **0 unité**, et un bandeau dit **« Aucun mode ne lit ce document »**
- [ ] Ce bandeau propose la bonne sortie — indiquer une colonne s'il s'agit d'un tableau
- [ ] **Aucune** pastille « recommandé » n'apparaît dans ce cas : l'écran ne désigne pas le moins mauvais
- [ ] Saisir la colonne 1 fait disparaître le bandeau et apparaître la recommandation
- [ ] `9_CI-TrFr-2021_Aligné_UTF8.txt` affiche **48 unités, 0 trouvables** et le même bandeau — c'est un `.txt` numéroté « 1. » et non `[1]`, aucun mode ne sait le lire aujourd'hui
- [ ] Sa colonne « Première unité » montre **« 1. Texte 9 »**, ce qui rend la cause lisible à l'œil

### Choisir sur pièces

- [ ] Cliquer le nom d'un mode dans le tableau **applique** ce mode au fichier — la ligne dans la liste des fichiers change de mode
- [ ] Le ✓ se déplace sur la ligne cliquée, et la liste des unités en dessous se recharge dans le nouveau mode
- [ ] Cliquer le mode **déjà courant** ne fait rien de visible
- [ ] Changer de fichier avec « Suivant » recalcule le tableau pour le nouveau fichier

### Non-régression

- [ ] Un `.docx` ordinaire (`8-CI-TrEn-2022_A Aligner.docx`) affiche ses deux lignes sans bandeau, et le reste de la carte d'aperçu se comporte comme avant
- [ ] La note de tableau (« Tableau : 2 colonnes × 1 ligne. ») et le bouton « Un document par colonne » sont toujours là, **sous** le tableau comparatif
- [ ] Un fichier illisible ne laisse pas le tableau du fichier précédent à l'écran
- [ ] Un `.conllu` n'affiche aucun tableau comparatif — il a son propre aperçu, qui n'a pas changé
