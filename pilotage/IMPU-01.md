---
chantier: IMPU-01
statut: différé
---

# IMPU-01 — un seul écran d'import, deux sources

**Différé exprès**, et non abandonné : la conception est faite, la décision de la mener
ne l'est pas. La substance vit dans **`docs/DESIGN_import_unifie.md`** (28 août 2026),
écrite à la fin de SD-01 pendant que le contexte des deux écrans était frais. Cette fiche
n'existe que pour que la note reste atteignable depuis le journal — une note qu'aucune
fiche ne cite est ce qui dérive le plus vite ici.

## Reste

- [x] **Voir tourner ce qui vient d'être livré, avant toute fusion** — fait le 28 août,
      condition **levée**. Ce n'était pas une formalité : refactoriser 3 100 lignes de deux
      écrans par-dessus du code jamais exécuté ferait perdre la capacité de distinguer un
      bug du refactor d'un bug préexistant. L'écran a tourné sur un serveur réel, et
      l'exécution a trouvé ce que les passes écrites n'avaient pas vu — dont un bandeau de
      jobs invisible depuis son commit d'origine, dont le double rappel pouvait faire
      sauter en silence la barrière qui câble les familles.
- [ ] **Le repli « c'est aussi sur le disque » est un accident de corpus** — soulevé le
      28 août au soir, et c'est ce qui remet la fusion en tête de liste. Le report de la
      colonne distante (item de `SD-01`) s'appuie sur le fait que les 26 bitextes en
      tableau existent **aussi** localement. C'est vrai du dossier d'entraînement, qui a
      été téléchargé ; ce n'est pas une propriété du produit. Sur un poste où les documents
      ne vivent que sur ShareDocs il n'y a **aucun** chemin : `FileItem.path` est un chemin
      de système de fichiers, donc un fichier distant n'entre pas dans l'écran local, et
      l'écran distant n'a pas de champ colonne. Le « 26 sur 514 » n'est donc pas un taux du
      produit — la mise en tableau étant une convention d'alignement répandue, un corpus
      peut y être à 100 %. Ajouter `column_index` aux deux routes distantes reste possible,
      mais ce serait la **troisième** capacité portée à la main d'un écran vers l'autre
      après la déduction de mode et le verdict, et le portage précédent a coûté huit
      défauts.
- [ ] **Trancher les cinq points du § 5 de la note** — le flux de familles (avant/lot
      comme ShareDocs, ou après/par document comme en local : décision couplée à
      `FAM-01`) ; l'annulation de lot, qui n'existe qu'à distance ; le devenir du panier ;
      le groupement à la soumission ; et le nombre d'entrées de navigation
- [ ] **La tranche elle-même**, si elle est décidée : commencer par l'origine dans
      `FileItem` et l'aiguillage de l'analyse (`/import/preview` ou `POST /webdav/probe`),
      le reste en découle. Ne **pas** prendre le raccourci « télécharger côté client puis
      traiter comme un fichier local » : il perdrait la provenance distante
      (`source_path` = l'URL) et le dédoublonnage par hash de contenu côté serveur

## Contexte

**Ce qui motive.** La duplication ne coûte pas que des lignes, elle produit des défauts :
le 28 août, porter vers ShareDocs ce que l'écran local avait acquis la veille a demandé
deux passes adverses et rendu **huit défauts**, dont la bulle verte transportant un
avertissement — corrigée le matin sur un écran, réintroduite trois heures plus tard sur
l'autre. Elle coûte aussi des capacités : **26 fichiers** du corpus (sur 514 sondables,
mesurés) sont des bitextes en tableau qu'on ne sait pas importer à distance, non parce que
le moteur ne sait pas — `/import` accepte `column_index` — mais parce que l'écran distant
n'a pas le champ.

**Ce qui survivrait de SD-01.** Tout le moteur : `POST /webdav/probe`, les modes par
fichier de `/import-remote`, la distinction `skipped-no-probe` / `skipped-unsupported`,
`preview_text_units` extrait dans `services/`. C'est exactement ce dont une liste unifiée
a besoin. C'est le **front** du 28 août qui se dissoudrait — `planForRemoteFile`,
`verdictForRemoteFile`, `_verdictCell`, `probeKeysToKeep`, la colonne de verdict distante.

**La divergence que la note a mise au jour**, et qui n'était écrite nulle part : les deux
écrans rattachent aux familles selon deux conceptions opposées — avant l'import et par lot
d'un côté, après et par document de l'autre. Ce ne sont pas deux implémentations d'une
même idée. Voir `FAM-01`.
