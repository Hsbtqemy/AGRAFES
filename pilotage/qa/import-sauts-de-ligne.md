---
passe: Import — sauts de ligne doux
chantier: R2
duree: 25 min
derniere: 2026-08-26
---

# QA — un DOCX en un seul paragraphe redevient un corpus

Passe écrite après le correctif du 26 août : les modes `*_numbered_lines` découpent
désormais un paragraphe sur ses sauts de ligne doux (`<w:br/>`, `text:line-break`) avant de
chercher le marqueur `[n]`. Elle valide ce qui se **voit** — l'aperçu qui annonce le bon
nombre d'unités, le document qui devient consultable, l'alignement par ancre qui redevient
possible — et elle sert de mode d'emploi au réimport des 15 documents « blob » de la base de
travail.

Elle ne couvre pas le blob **dont le fichier source a disparu** (queue R2.3, différée) ni le
mode `*_paragraphs`, où « un `<w:p>` = une unité » reste délibéré (ADR-012).

**Lancer l'application.** `tauri-prep` seul ne joint pas le sidecar
(`sidecar_fetch_loopback` n'existe que dans le shell) : passer par
`npm --prefix tauri-shell run tauri -- dev`. Si le sidecar a été rebâti, le faire avec
`python scripts/build_sidecar.py --preset shell --format onefile` — le défaut Windows
(`onedir`) produit un exe que `externalBin` ignore.

**D'abord : le sidecar doit porter le correctif.** C'est un processus Python séparé qui
embarque son propre `src/` figé à la compilation — modifier le dépôt ne l'atteint pas, et
l'application continue de répondre l'ancien découpage sans rien signaler. Le piège a été
rencontré le 26 août : l'aperçu annonçait « 1 unité » alors que le correctif était en place
et testé. Vérifier que
`tauri-shell/src-tauri/binaries/multicorpus-x86_64-pc-windows-msvc.exe` est **postérieur au
correctif** ; sinon, fermer l'application, `python scripts/build_sidecar.py --preset shell
--format onefile`, relancer. Le premier démarrage d'un onefile neuf est lent (il se
décompresse) : lui laisser une minute avant de conclure.

**Un aperçu qui annonce « 1 unité » sur un fichier de la table ci-dessous ne dit pas que le
correctif a échoué — il dit d'abord que le sidecar est périmé.** Le vérifier avant d'ouvrir
un constat.

**Un mot de vocabulaire.** Un `.docx` est une archive dont le texte vit dans
`word/document.xml`. Un **paragraphe Word** (`<w:p>`) s'ouvre à chaque **Entrée** ; un
**saut de ligne doux** (`<w:br/>`) s'obtient par **Maj+Entrée** et va à la ligne *sans*
ouvrir de paragraphe. Le défaut corrigé : les importeurs prenaient le paragraphe pour
frontière d'unité, donc un document tapé à coups de Maj+Entrée n'avait qu'une unité. Dans
Word, l'affichage des marques de mise en forme (bouton ¶) montre la différence : ¶ pour un
paragraphe, ↵ pour un saut de ligne doux.

**Les fichiers de référence.** Dossier
`C:\Users\hsemil01\Downloads\GRAFE-Lit-Aligne (1)\GRAFE-Lit-Aligne\Bitextes anglais-francais\GRAFE-Lit-EnFr-Aligné-DOCX`.
Chacun tient en **un seul paragraphe Word** portant des centaines de **sauts de ligne doux**
— c'est la forme qui cassait. Trois d'entre eux, mesurés au parseur corrigé le 26 août :

| fichier | unités attendues | dont `structure` | `external_id` |
|---|---|---|---|
| `Asimov-Foundation_FR.docx` | 1304 | 0 | 4 → 1307, sans trou ni doublon |
| `Coe-House-AL_FR.docx` | 836 | 3 — mais **2 seulement en tête** (titre, « I ») ; la 3ᵉ est « II », le second chapitre, à la ligne 461 | 1 → 833 |
| `Lodge-Nice_EN.docx` | 897 | 0 | 4 → 900 |

Avant le correctif, chacun donnait **une seule unité** de 68 000 à 110 000 caractères.

**Aucun écran n'affiche de compte de caractères.** `max_text_len` existe dans le moteur
(`GET /documents/stats`) mais n'est rendu nulle part ; le bandeau du canvas ne s'en sert
que comme seuil interne. Les longueurs mesurées le 26 août — plus longue unité 631
caractères pour Coe FR, 416 pour Asimov FR, moyennes 79 et 77 — ne se vérifient donc que
par requête, pas à l'écran. Les items ci-dessous s'en tiennent à ce qui s'affiche.

**« Numéroté » veut dire la convention `[n]`** — des crochets littéraux en tête de ligne
(ADR-001, `^\[\s*(\d+)\s*\]`). Ni `1.`, ni `1)`, ni la numérotation **automatique** de
Word ou LibreOffice, qui n'est pas du texte mais un rendu du style de liste et n'atteint
jamais l'importeur. Un document sans marqueur importé en mode numéroté sort **entièrement
en unités `structure`**, donc hors index, sans avertissement. Aucun `.odt` local ne porte
de marqueur `[n]` : la branche ODT numérotée du correctif est couverte par
`tests/test_import_soft_line_breaks.py`, pas par cette passe.

**Le mode d'import doit être « lignes numérotées [n] »** — c'est le défaut pour un `.docx`
quand le profil est `wp_numbered`. En profil `wp_paragraphs`, ces fichiers restent un blob :
c'est attendu, pas un échec de la passe.

**Avant de réimporter, il faut supprimer.** `assert_not_duplicate_import` bloque sur
`source_hash` et aucun forçage n'existe. La suppression est sans risque pour ce qui a été
curé à la main (0 tag, 0 note, 0 rôle, 0 métadonnée, 0 `text_start_n` sur ces 15 documents),
mais elle emporte **13 `doc_relations`** — les familles source↔traduction, à rétablir ensuite
(le `familyDetect` de l'import par lot les recrée peut-être : c'est l'objet d'un item
ci-dessous). Les 24 902 tokens d'annotation et 2 liens d'alignement qui partent ont été
calculés sur un blob, ils n'ont pas de valeur.

**Travailler sur une copie de la base** — comme toute opération destructive.

### Aperçu à l'import

- [x] `Asimov-Foundation_FR.docx` ajouté à la liste, l'aperçu affiche « 1304 unités — 50/1304 affichées »
- [x] Les lignes de l'aperçu portent un `external_id` numéroté, pas un tiret
- [x] `Coe-House-AL_FR.docx` affiche « 836 unités — 50/836 affichées »
- [x] Sur `Coe-House-AL_FR.docx`, les **deux** premières lignes de l'aperçu sont de type `structure` (le titre, puis « I »)
- [x] Sur `Coe-House-AL_FR.docx`, la troisième ligne est de type `line` et porte l'`external_id` **1**
- [x] Aucun aperçu n'affiche « 1 unité » ni « Aucune unité détectée. »

### Le document importé

- [x] `Coe-House-AL_FR.docx` importé sans avertissement de trous ni de doublons dans le journal d'import
- [x] Le canvas affiche des lignes de la taille d'une phrase, pas un pavé unique
- [x] Le bandeau d'état du canvas affiche « Segmenté · 833 phrases » — et **plus** le bouton « Brut (non segmenté) → », qui est ce qu'un blob déclenche
- [x] Le bandeau affiche aussi « Numéroté » (et non « Numéroté (partiel) » ni « Non numéroté »)
- [x] Le numéro affiché en tête de ligne suit la numérotation `[n]` du fichier source

### Recherche

- [x] `Coe-House-AL_FR.docx` apparaît dans le sélecteur de documents du concordancier
- [x] En filtrant sur ce document, « Sarah » rend **44 lignes** (44 occurrences)
- [x] En filtrant sur ce document, « Gregory » rend **30 lignes**
- [x] Le KWIC montre un contexte de la taille d'une phrase, pas le document entier

### Alignement

- [x] `Coe-House-AL_EN.docx` importé lui aussi, il annonce 836 unités
- [x] Une famille relie les deux documents Coe (rétablie à la main si l'import par lot ne l'a pas fait)
- [x] L'alignement par ancre `external_id` journalise « **833 liens créés** » (aucune orpheline : les deux documents portent les mêmes 833 identifiants)
- [x] La matrice affiche deux colonnes peuplées, pas deux cellules géantes

### Non-régression

- [x] `8-CI-TrEn-2022_A Aligner.docx` annonce **28 unités** — un fichier tapé normalement, sans aucun saut de ligne doux : le correctif ne doit rien y changer (dossier « A aligner pour tester » du corpus OneDrive)
- [x] `Asimov-Foundation_FR_réaligné.odt` en mode **ODT paragraphes** annonce **1141 unités**, toutes de type `line`, colonne ID numérotée **1 → 1141** (dossier `GRAFE-Lit-EnFr-REAligné-DOCX`)
- [x] Le même fichier en mode **ODT lignes numérotées [n]** annonce 1141 unités **toutes `structure`**, colonne ID entièrement en tirets — il ne porte aucun marqueur écrit : c'est le piège du mode par défaut, pas un défaut du correctif
- [x] Un `.docx` sans marqueur `[n]` range toujours ses paragraphes en unités `structure` — inchangé, et toujours non signalé à l'import (voir `qa/italique-import.md`)
