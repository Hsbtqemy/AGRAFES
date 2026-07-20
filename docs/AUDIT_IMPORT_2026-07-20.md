# Audit — modes d'import & reconnaissance des types de document (2026-07-20)

> Statut : **audit en lecture seule, findings confrontés au code**. Base : branche
> `refonte`. Déclenché par [`ROADMAP_REFONTE.md`](ROADMAP_REFONTE.md) §3 front ③ («
> à vérifier / auditer — modes d'import & reconnaissance des types », ajouté 2026-07-07).
> Suivi *finding → statut → commit* dans [`AUDIT_FOLLOW_UP.md`](AUDIT_FOLLOW_UP.md),
> section « Import 2026-07-20 ». IDs `IMP-01…IMP-15` + verdict `IMP-RT`.
>
> Méthode : 2 agents de cartographie (importeurs moteur ; détection front) + **re-vérif
> manuelle au code** des findings tête d'affiche (« ✔ »). Sévérité 🔴 critique / 🟠 haute
> / 🟡 moyenne / 🟢 basse.

## 0. Constat de fond

- **Détection front = par nom seul.** `importDetect.ts` / `familyDetect.ts` sont des
  fonctions PURES de chaînes : format = extension, langue = suffixe de nom, famille =
  radical commun. **Aucun reniflage de contenu** nulle part. C'est la racine de la
  plupart des findings front.
- **Moteur = socle solide.** Cap 512 Mio (tous importeurs), XML durci (`defusedxml` +
  `resolve_entities=False`), dédup (`import_guard`), atomicité au crash
  (`try/except: rollback`), CoNLL-U strict (10 colonnes, BOM, multiword/empty-node). Les
  trous sont des cas limites — **sauf IMP-01**.
- **`resource_type`** est câblé de bout en bout (`dispatch_import` → chaque importeur →
  `documents.resource_type`, colonne `TEXT` nullable sans enum, mig 001) mais **jamais
  posé à l'import** — saisie manuelle en MetadataScreen (R6.3).

## 1. Socle déjà protégé (ne pas re-signaler)

Vérifié handled — exclu des findings : fichier manquant → `FileNotFoundError` (tous) ;
cap 512 Mio (tous) ; XML malformé → `ValueError` typé (`tei_importer.py:158`,
`odt_common.py:94`) ; ZIP corrompu / `content.xml` manquant → `ValueError`
(`odt_common.py:91`, testé) ; bombe d'entités XML mitigée (`defusedxml` TEI ;
`resolve_entities=False` python-docx) ; dédup hash/chemin/nom (`import_guard.py`, testé) ;
atomicité au crash (rollback dans chaque importeur) ; CoNLL-U 10-colonnes + multiword +
BOM + fichier vide `raise` (testé) ; DOCX tables (vMerge/nested/narrow, 11 tests).

## 2. Findings moteur (`src/multicorpus_engine/importers/`)

### IMP-01 ✔ — 🔴 P0 — `_analyze_external_ids` : hang → OOM sur un seul écart d'`external_id` large
`docx_numbered_lines.py:151-173` (boucle chaude 169-170), appelée par **tout** importeur
numéroté (`txt.py:199`, `docx_numbered_lines.py:399`, `odt_numbered_lines.py:128`,
`tei_importer.py:269`, `conllu.py:335`).

```python
for expected in range(unique[0], unique[-1] + 1):   # linéaire dans l'ÉCART, pas le nb d'ids
    if expected not in set(external_ids):            # set() RECONSTRUIT à chaque itération
        holes.append(expected)
```

Coût ∝ `max - min`. Déclencheurs **ordinaires** : un `[900000000]` mal tapé (TXT/DOCX/ODT
numéroté) ; un `xml:id="p99999999"` (TEI — `_xmlid_to_int` extrait un entier de queue
**non borné**, `tei_importer.py:43`) ; un `# sent_id = 999999999` (CoNLL-U,
`conllu.py:284`). → boucle de ~10⁹ + liste `holes` de ~10⁹ ints → hang puis `MemoryError`.
Appelée **après le commit**, sous `self._lock()` côté sidecar → **gèle toute l'app** ; et
comme ça *hang* (ne lève pas), le `except Exception` du CLI (`cli.py:176`) ne se déclenche
jamais. Secondaire : même un écart modeste (100 k) embarque 100 k ints dans
`report.warnings` → JSON multi-Mo sur stdout/HTTP. **Aucun test** n'exerce un grand écart.
**Fix** : construire le `set` **une fois** + **borner l'écart** (au-delà d'un seuil,
warning « séquence trop clairsemée » au lieu d'énumérer les trous). ~6 lignes.

### IMP-02 — 🟡 P1 — import **vide silencieux** → document fantôme (tout sauf CoNLL-U)
Seul `import_conllu` garde (`if not sentences: raise`, `conllu.py:247`). Les autres
insèrent une ligne `documents` et renvoient `units_total=0` **sans erreur** :
`tei_importer.py:245-279` (aucune garde `if not parsed.units` — ex. TEI en `<p>` importé
avec `unit_element='s'`, ou sans `<body>`), `txt.py:193` (fichier vide/blanc),
`docx_paragraphs.py:128`, `odt_paragraphs.py:87`, `docx_numbered_lines.py:381`,
`odt_numbered_lines.py:110`. L'utilisateur croit l'import réussi et récupère un document
fantôme qui pollue alignement/recherche. **Aucun test** du chemin vide hors CoNLL-U.
**Fix** : garde partagée « 0 unité → lever ou avertir » (aligner sur CoNLL-U).

### IMP-03 — 🟡 P2 — CoNLL-U : aperçu tolérant, import strict (divergence d'encodage)
`preview_conllu` décode `utf-8-sig` puis retombe sur `latin-1` et **ne lève jamais**
(`conllu.py:128`), alors qu'`import_conllu` rejette tout non-UTF-8 (`conllu.py:241`). Un
CoNLL-U Latin-1/CP1252 s'aperçoit proprement (avec mojibake) puis **échoue dur** au commit.
Contradiction UX, **pas de corruption** (rejet propre). **Fix** : documenter/aligner la
politique (avertir à l'aperçu, ou tolérer + convertir à l'import).

### IMP-04 — 🟡 P2 — TXT `errors="replace"` → mojibake **silencieux** sur mauvaise devinette
`txt.py:91` décode avec `errors="replace"` ; le warning `encoding_fallback` (`txt.py:88`)
ne se déclenche **que** pour les méthodes `cp1252/latin-1-fallback`. Si `charset-normalizer`
se trompe (UTF-16-LE sans BOM, fichier mixte) ou si `cp1252` « réussit » sur des octets qui
n'en sont pas → texte corrompu (U+FFFD ou glyphes faux) **sans warning**. Aussi : une
exception non-`ImportError` dans `from_bytes` (`txt.py:48`) n'est pas attrapée → crash. Le
seul test d'encodage **mocke** `_detect_encoding` — **aucun test sur octets réels**.

### IMP-05 — 🟢 dette — bombe de décompression ODT/DOCX (pas de cap décompressé)
`odt_common.py:89` `zf.read("content.xml")` charge tout le membre ; le cap 512 Mio porte
sur l'archive **compressée**. Un petit `.odt` dont `content.xml` gonfle à plusieurs Go →
OOM. Idem DOCX via python-docx. Fichier forgé, outil local mono-utilisateur → basse prio.

### IMP-06 — 🟢 dette — récursion illimitée dans le walk ODT/rich_text
`odt_common.py:_walk_text_content` (28-49) et `rich_text.py:_walk_odt_elem` (228-279)
récursent par niveau d'imbrication. Un `content.xml` à des milliers de `<text:span>`
imbriqués → `RecursionError` (non attrapé → stack opaque).

### IMP-07 — 🟢 dette — `documents.source_hash` sans index UNIQUE → dédup TOCTOU
`migrations/001_initial_schema.sql:17` : `source_hash TEXT` sans UNIQUE. La dédup repose
sur `assert_not_duplicate_import` (`import_guard.py:114`). Deux imports **CLI** concurrents
du même fichier peuvent passer tous deux le check et insérer. Le sidecar sérialise via
`self._lock()` → risque multi-process/CLI seulement.

### IMP-08 — 🟢 dette — TEI multi-`<text>` (teiCorpus) : seul le 1er importé
`tei_importer.py:72` `root.find(f".//{text_tag}")` prend le **premier** `<text>`. Un
`<teiCorpus>` groupant plusieurs `<TEI>`/`<text>` n'importe que le premier, **sans
warning**. Connexe : `_get_title` (100-110) renvoie le premier `<title>` **où qu'il soit**
dans l'arbre (pas restreint au `teiHeader` malgré la docstring) → peut choisir un titre
bibliographique/analytique.

## 3. Findings front (`tauri-prep/src/lib/`)

### IMP-09 ✔ — 🟠 P1 — mauvaise extension → import **silencieux en charabia**, sans échappatoire
`deriveModeFromExt` mappe `.txt`→`txt_numbered_lines` (`importDetect.ts:65`),
`.xml`/`.tei`→`tei` (64), `.conllu`→`conllu` (66) — **par extension seule**. Un CoNLL-U ou
un TEI enregistré `.txt` → mode `txt_numbered_lines`, tables de tokens ingérées comme du
texte numéroté littéral, **aucune erreur**. Et `modeOptionsForExt("txt")` ne renvoie que
`txt_numbered_lines` (51) → le menu par-ligne **n'offre aucun autre mode** pour corriger.
Inverse pour `.xml` (seul TEI proposé). **Fix** : reniflage de contenu léger (CoNLL-U =
`# sent_id`/tabs ; TEI = `<?xml`+`<TEI` ; zip magic) **ou** échappatoire : autoriser tout
mode dans le menu par-ligne.

### IMP-10 ✔ — 🟠 P1 — famille **mal liée** = docs non liés câblés source↔traduction
`detectFamilyGroups` (`familyDetect.ts:43`) : (a) `baseName` (29-31) **jette le
répertoire** → `2020/rapport_fr.docx` + `2021/rapport_en.docx` (radical `rapport.docx`)
fusionnent ; (b) les **mots-outils** sont des codes whitelistés (`de`,`la`,`en`,`it`,`is`,
`id`,`ca`,`no` ∈ `KNOWN_LANG_CODES`, `importDetect.ts:115-138`) → `chanson_de.docx` +
`chanson_la.docx` (deux FR) → famille « allemand↔latin ». À l'import de lot, ça câble une
vraie relation source↔traduction entre docs sans rapport. **Fix** : scoper au même dossier
(ou avertir cross-dossier) ; cf. IMP-13.

### IMP-11 ✔ — 🟠 P2 — langue devinée **`fr` en silence**
Pour tout non-TEI sans token reconnu, `detectLanguageFromName` renvoie le fallback
(`importDetect.ts:161`), câblé en dur `"fr"` côté import local (`ImportScreen.ts:164/300/
339`). Un corpus DE/EN à noms neutres (`bericht.docx`, `report.docx`) est importé
**français** sans le dire (le non-TEI ne renvoie jamais `undefined`, contrairement au TEI
qui laisse `xml:lang` décider). **Fix** : surfacer « langue indéterminée → défaut X, à
confirmer » plutôt que muet.

### IMP-12 — 🟡 P2 — famille **rate** l'original non-marqué
`if (!m) continue` (`familyDetect.ts:49`) : un fichier **sans** token est ignoré. Le
pattern courant `book.docx` (original) + `book_en.docx` (traduction) → un seul membre
tokené → **pas de famille**. Le test l'assume comme *correct* (`familyDetect.test.ts:34`),
mais c'est un manque réel sur le nommage dominant.

### IMP-13 — 🟡 P1 — famille **sans check langues distinctes** (mismatch doc/code)
`detectFamilyGroups` ne teste que `files.length >= 2` (`familyDetect.ts:66`) — jamais que
les langues diffèrent, **alors que la docstring dit « langues différentes »** (22/35). Deux
`book_en.docx` (dossiers `/drafts` et `/final`) → famille de deux membres EN, et
`pickDefaultPivot` fait de l'un la « traduction » de l'autre. **Fix : 1 ligne** (exiger ≥2
langues distinctes) — referme aussi une partie d'IMP-10.

### IMP-14 — 🟡 dette — `LANG_RE` : sensibilité de position + sous-tags région
`LANG_RE` (`importDetect.ts:106`) ne matche que le **dernier** token avant l'extension.
`roman_fr_v2.docx` → dernier token `v2` → `fr` manqué → fallback. `roman_pt-BR.docx` →
capture `br` (hors whitelist) → manqué. Préfixe `fr_roman.docx` → non matché (suffixe
seul). Tous retombent en silence sur la langue par défaut.

### IMP-15 — 🟡 P2 — drop local sans filtre d'extension (divergence ShareDocs)
ShareDocs filtre via `isKnownImportExt` (unknown → ignoré). Le drop local appelle
`_tryAddSingle` pour **tout** fichier (`ImportScreen.ts:158-175`) sans garde. Un `.doc`
(binaire ancien), `.pdf` ou sans extension → `deriveModeFromExt` renvoie le profil brut
`"wp_numbered"` (`importDetect.ts:79`), que `normalizeModeForExt` ne peut réparer → ligne
acceptée avec un **mode bidon** qui n'échoue qu'au dispatch. `.doc` n'est même pas dans
`KNOWN_IMPORT_EXTS`.

## 4. Couverture de tests — manques notables

| Domaine | Manque |
|---|---|
| **IMP-01** | aucun test à grand écart d'`external_id` (les tests trous = ids 3,4) |
| **IMP-02** | chemin « 0 unité » non testé hors CoNLL-U (TEI/TXT/DOCX/ODT) |
| **IMP-04** | encodage TXT seulement via `_detect_encoding` **mocké** — pas d'octets réels (BOM/CP1252/mojibake) |
| **IMP-09** | mauvaise extension (CoNLL-U/TEI en `.txt`) non testé |
| **IMP-10** | mots-outils `de/la/en`, cross-dossier même-radical non testés (les tests n'assertent que le rejet de `_v2`) |
| **IMP-12/13** | original non-marqué **asserté comme correct** ; membres même-langue non testés |

## 5. `resource_type` — verdict de faisabilité (question R6.3) — IMP-RT 📝

**Prémisse vérifiée au code : signal nul → l'auto-détection n'est PAS faisable** et
étiquetterait faux plus souvent qu'à raison.
- **Nom de fichier** = un titre, pas un genre → zéro signal.
- **Format** (`.conllu`) = un état de traitement, pas un genre (un roman peut être CoNLL-U)
  → zéro signal.
- **Dossier** = suppose une organisation par genre qu'AGRAFES **n'impose pas** (import
  agnostique du stade, DESIGN §0) → faible, opt-in au mieux.
- **`teiHeader`** *peut* porter `<textClass>`/`<catRef>`/`<text type>`, mais (a) l'importeur
  n'en lit **rien** (`tei_importer.py` = titre + `xml:lang` seulement) et (b) ce serait une
  taxonomie de projet ≠ le vocabulaire {roman, nouvelle, essai…} (`metaTemplates.ts:33`) →
  mapping non déterministe.
- **Contenu** = jugement littéraire sémantique (roman vs nouvelle vs essai) ; la longueur
  est un proxy faible ; poésie/théâtre ne sont détectables qu'en TEI richement balisé.

**Décision : garder `resource_type` manuel (R6.3 tel quel).** Au mieux, plus tard, un
*pré-remplissage éditable* (jamais commité en silence) si on étend l'importeur TEI pour
lire `<text type>` — **pas maintenant, aucun build**.

## 6. Priorisation

- **P0 (à corriger) :** IMP-01 (critique, ~6 lignes).
- **P1 (vrais gains, bon marché) :** IMP-02 (garde vide), IMP-09 (échappatoire/sniff),
  IMP-10 + IMP-13 (famille : langues distinctes + cross-dossier).
- **P2 (réels, plus bas) :** IMP-03, IMP-04, IMP-11, IMP-12, IMP-15.
- **Dette (📝 assumé) :** IMP-05, IMP-06, IMP-07, IMP-08, IMP-14.
- **Décidé, zéro build :** IMP-RT (pas d'auto-détection `resource_type`).
