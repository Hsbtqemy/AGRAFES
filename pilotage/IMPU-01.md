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

- [ ] **Voir tourner ce qui vient d'être livré, avant toute fusion.** C'est la condition
      du report, pas une formalité : refactoriser 3 100 lignes de deux écrans par-dessus
      du code jamais exécuté ferait perdre la capacité de distinguer un bug du refactor
      d'un bug préexistant. Le lot SD-01 (sonde distante, modes par fichier, retrait du
      profil de lot) est vérifié par les tests et les builds, **jamais par l'écran**
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
