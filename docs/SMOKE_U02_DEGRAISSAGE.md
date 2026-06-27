# Smoke manuel — dégraissage front U-02 (vague #149→#157)

But : confirmer **visuellement** que les 9 extractions à comportement-préservant
rendent à l'identique. Chaque move est byte-identique (DOM rendu inchangé), donc
ce smoke est une ceinture-et-bretelles ciblée — **~5-10 min**, à faire sur le shell
desktop (`tauri-shell`) avec un corpus réel (idéalement le corpus démo, hors dossier
cloud-sync).

Cocher = « rend comme avant, aucune anomalie ». Les **glyphes/labels exacts** à
l'œil sont listés car ce sont les octets transplantés (un mojibake = régression).

> Préparation : ouvrir un corpus contenant au moins un document **annoté** (spaCy),
> une **famille** (source + traduction), et une **alignement** réalisée, pour
> exercer toutes les branches.

---

## 1. ImportScreen — `importFamilyDetectionTemplate` + `importStatusLabel` (#150)

- [ ] **Bannière familles** : ajouter à la file des fichiers partageant un radical
      avec suffixes de langue (ex. `roman_fr.docx`, `roman_en.docx`). La bannière
      « 🔗 **Familles détectées automatiquement** » apparaît, avec le bon nombre de
      groupes (`1 groupe` / `2 groupes`), chaque groupe listant ses fichiers
      `roman_fr.docx [FR]` et un `<select>` « Original : » par groupe.
- [ ] **Labels de statut** par fichier au fil de l'import : `En attente` →
      `Importation…` (avec l'ellipsis) → `✓ doc_id=…` (succès) / `✗ …` (erreur).
      Vérifier que `✓` / `✗` / `…` s'affichent (pas de `?`/mojibake).

## 2. ShareDocsImportScreen — squelette statique `shareDocsImportTemplate` (#151)

- [ ] L'écran **ShareDocs (WebDAV)** s'ouvre entièrement : titre, intro, carte
      « 1. Connexion » (champ URL, bouton « ↧ Préremplir l'URL racine », sélecteur
      d'authentification **Anonyme / Identifiant+mot de passe / Jeton (Bearer)**,
      case « Se souvenir », note « 🔒 … trousseau du système »).
- [ ] Changer le sélecteur d'auth **affiche/masque** les bons champs (basic/bearer).
- [ ] Après connexion : carte « 2. Dossier » (fil d'ariane « ← Retour », liste
      d'entrées, sélecteur « Profil par défaut » avec `Lignes numérotées [n]` /
      `Paragraphes`) et « 3. Rapport ». Tous les boutons réagissent (le câblage est
      post-render, inchangé).

## 3. ActionsScreen — dédup `hubTree` → `buildMetadataTree` (#152)

- [ ] Dans le **Hub**, basculer en vue **🌿 Hiérarchie**. La table affiche
      correctement : **racines** (parents) avec leurs **enfants indentés** (`└`,
      badge de relation), section **« Sans famille »**, section **orphelins** le cas
      échéant. L'ordre et le regroupement doivent être identiques à avant.

## 4. SegmentationView — `seqDiff` (LCS) (#153)

- [ ] Sur un document segmenté, lancer un **aperçu de re-segmentation** qui produit
      des différences. Le **diff** s'affiche : segments inchangés (eq), supprimés
      (del), insérés (ins) dans le bon ordre.
- [ ] Cas « aucune différence » : l'aperçu d'une re-segmentation identique affiche
      bien la note « ✓ Aucune différence — … mêmes N segments. » (le signal
      `every(op==="eq")`).

## 5. MetadataScreen — `workflowStatus` (#154)

- [ ] Dans la **liste des documents**, la colonne/badge de statut affiche le bon
      libellé : `Brouillon` / `À revoir` / `Validé`.
- [ ] Ouvrir le **panneau d'édition** d'un doc : le `<select>` de statut workflow
      propose les 3 options avec ces mêmes libellés ; changer + enregistrer
      persiste le bon statut (le chemin formulaire passe par la même normalisation).

## 6. ExportsScreen — `exportDocTable` (#155)

- [ ] La **table des documents** (vue d'export) affiche une ligne par doc :
      case à cocher (cochée si sélectionné), id, **titre tronqué à 40 car. + `…`**
      pour les longs titres (l'attribut `title=` au survol garde le titre complet),
      langue, rôle (`—` si absent), et une **puce de statut** :
      `Validé` / `Révision` / `Brouillon` / `—`.
      ⚠️ Note : ici le statut « à revoir » s'affiche **`Révision`** (schéma propre à
      Export, volontairement différent du `À revoir` de Metadata — ne pas s'alarmer).
- [ ] Cocher/décocher une ligne met bien à jour la sélection (câblage inchangé).

## 7. AnnotationView — `annotationSpacing` (#156)

- [ ] Sur un document **annoté**, passer en **mode Lecture** (prose colorée UPOS).
      Le texte reconstruit doit avoir un **espacement français correct** : pas
      d'espace avant `.,;:!?` ni `)`/`]`, pas d'espace après `(`/`[`, et **pas
      d'espace à l'intérieur des guillemets `« … »`** ni autour des apostrophes
      courbes. (C'est la règle dédupliquée — read-mode + reconstruction texte
      partagent désormais le même prédicat.)
- [ ] Cliquer un token en mode Lecture rebascule en mode Annoter sur ce token.

## 8. CurationView — `curationContextDetail` (#157)

> L'extraction la plus dense (carte contexte, 2 modes). À exercer avec soin.

- [ ] Sur un aperçu de curation, sélectionner une modification : la **carte
      contexte** affiche, en **mode affichage** : lignes `Avant`/`Après` (si
      contexte), ligne courante `Modifié` avec `avant → après` (flèche **→** +
      surlignage des changements), et les boutons **`✎ Éditer`** + (si exception
      absente) **`🔒 Toujours ignorer`** / **`🔒 Conserver cette correction`**.
- [ ] Cliquer **`✎ Éditer`** → **mode édition** : `Original`, `Résultat` (textarea),
      hint « Proposition automatique : … », boutons `Enregistrer` / `Annuler`. Save
      et Cancel fonctionnent.
- [ ] Document **avec override manuel** : badge **`✏ Édité manuellement`** + bouton
      `↩ Proposition auto` (revert) présents.
- [ ] Document **avec exception persistée** : badge `🔒 Ignoré durablement` /
      `Override durable` + bouton **`🔓 Supprimer l'exception`** (à la place des
      boutons ignore/conserver).
- [ ] Ouverture **ciblée depuis le panneau Exceptions** : la note « ↗ Ouverture
      ciblée … » s'affiche, et le label de ligne devient `Inchangé` / `Neutralisé`
      selon le cas.

## 9. AlignPanel — `alignPickerRow` (#149)

- [ ] Lancer un **reciblage** (retarget) d'un lien : la ligne du **picker de
      candidats** s'affiche — état « … chargement des candidats », puis la liste de
      boutons candidats (`[§ext]`, texte, score `%`), ou « Aucun candidat trouvé. ».
- [ ] Un candidat **déjà lié au pivot** apparaît en **conflit** (classe
      `--conflict`, score remplacé par `⚠ déjà lié`, infobulle « Déjà lié à ce
      pivot — sélectionner supprimera le lien existant »).

---

## Verdict

- [ ] **Tous les écrans rendent à l'identique, aucune anomalie visuelle / mojibake /
      régression d'interaction.**

Si une case échoue : noter l'écran + le symptôme, et comparer au commit
correspondant (table dans `docs/AUDIT_FOLLOW_UP.md`, ligne U-02). Vu la byte-identité
prouvée, une anomalie pointerait plus probablement vers un souci d'environnement
(build obsolète, cache) que vers le refactor — rebuild `npm --prefix tauri-shell run build`
avant de conclure.
