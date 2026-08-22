---
passe: Smoke dégraissage front U-02
chantier: U-02
duree: 10 min
derniere: —
---

# QA — dégraissage front U-02 (vague #149→#157)

Confirmer **visuellement** que les extractions à comportement-préservant rendent à
l'identique. Chaque move est byte-identique (DOM rendu inchangé), donc cette passe est une
ceinture-et-bretelles ciblée. À faire sur le shell desktop (`tauri-shell`) avec un corpus
réel — idéalement le corpus démo, hors dossier cloud-sync.

Cocher = « rend comme avant, aucune anomalie ». Les glyphes et libellés exacts sont listés
à l'œil : ce sont les octets transplantés, un mojibake est une régression.

**Préparation** — ouvrir un corpus contenant au moins un document annoté (spaCy), une
famille (source + traduction) et un alignement réalisé, pour exercer toutes les branches.

**Recadrage du 2026-08-22 — huit points retirés, un déplacé.** Cette passe a été écrite le
27 juin 2026 et n'a jamais été jouée. Trois des écrans qu'elle couvrait ont été supprimés
en R6.5 (`AnnotationView` le 20 juillet, `CurationView` le 22, `SegmentationView` le 23),
et le sort de leurs neuf points a été tranché **module par module**, pas à vue :

- `seqDiff` (#153, extrait de `SegmentationView`) — **module supprimé** avec l'écran. Ses
  2 points ne vérifiaient plus rien : retirés.
- le constructeur de contexte de curation (#157) — **module supprimé** de même. Ses
  5 points : retirés.
- `annotationSpacing` (#156) — **module vivant** (`lib/annotationSpacing.ts`), désormais
  consommé par `ui/annotationProse.ts` → `components/AnnotationPane.ts`. Son point de règle
  d'espacement est **déplacé** vers la couche Annotation du canvas, ci-dessous. Le second
  point d'`AnnotationView` (bascule Lecture → Annoter au clic sur un token) décrivait un
  couple de modes qui n'existe plus ; l'équivalent est couvert par `shell-v040` 1.1.

L'historique complet de ces neuf points reste dans `git log -- pilotage/qa/smoke-u02.md`.

Si une case échoue : noter l'écran et le symptôme, comparer au commit correspondant (table
dans `docs/AUDIT_FOLLOW_UP.md`, ligne U-02). Vu la byte-identité prouvée, une anomalie
pointerait plutôt vers un souci d'environnement (build obsolète, cache) que vers le
refactor — rebuilder `npm --prefix tauri-shell run build` avant de conclure.

### ImportScreen (#150)

- [ ] Bannière familles : des fichiers partageant un radical avec suffixes de langue (`roman_fr.docx`, `roman_en.docx`) font apparaître « 🔗 Familles détectées automatiquement » avec le bon nombre de groupes, chaque groupe listant ses fichiers `roman_fr.docx [FR]` et un `<select>` « Original : »
- [ ] Labels de statut par fichier au fil de l'import : `En attente` → `Importation…` (avec l'ellipsis) → `✓ doc_id=…` ou `✗ …`, sans `?` ni mojibake

### ShareDocsImportScreen (#151)

- [ ] L'écran ShareDocs (WebDAV) s'ouvre entièrement : titre, intro, carte « 1. Connexion » avec champ URL, bouton « ↧ Préremplir l'URL racine », sélecteur Anonyme / Identifiant+mot de passe / Jeton (Bearer), case « Se souvenir », note « 🔒 … trousseau du système »
- [ ] Changer le sélecteur d'authentification affiche et masque les bons champs (basic / bearer)
- [ ] Après connexion : carte « 2. Dossier » (fil d'ariane « ← Retour », liste d'entrées, sélecteur « Profil par défaut » avec `Lignes numérotées [n]` / `Paragraphes`) et carte « 3. Rapport » ; tous les boutons réagissent

### ActionsScreen (#152)

- [ ] Dans le Hub, la vue 🌿 Hiérarchie affiche racines avec enfants indentés (`└`, badge de relation), section « Sans famille » et section orphelins le cas échéant, dans le même ordre et le même regroupement qu'avant

### MetadataScreen (#154)

- [ ] Dans la liste des documents, le badge de statut affiche le bon libellé : `Brouillon` / `À revoir` / `Validé`
- [ ] Dans le panneau d'édition d'un document, le `<select>` de statut workflow propose les 3 mêmes libellés, et changer puis enregistrer persiste le bon statut

### ExportsScreen (#155)

- [ ] La table des documents affiche par ligne : case à cocher, id, titre tronqué à 40 caractères avec `…` et `title=` complet au survol, langue, rôle (`—` si absent) et une puce de statut `Validé` / `Révision` / `Brouillon` / `—` — noter que « à revoir » s'affiche ici `Révision`, schéma propre à Export, volontairement différent de Metadata
- [ ] Cocher et décocher une ligne met bien à jour la sélection

### AlignPanel (#149)

- [ ] Lancer un reciblage de lien affiche la ligne du picker de candidats : état « … chargement des candidats », puis la liste de boutons candidats (`[§ext]`, texte, score `%`), ou « Aucun candidat trouvé. »
- [ ] Un candidat déjà lié au pivot apparaît en conflit : classe `--conflict`, score remplacé par `⚠ déjà lié`, infobulle « Déjà lié à ce pivot — sélectionner supprimera le lien existant »

### Couche Annotation du canvas (#156, déplacé)

- [ ] Sur un document annoté, `◈ Actions` → `◎ Annotation`, mode **Prose** : l'espacement français est appliqué — pas d'espace avant `.,;:!?` ni `)` `]`, pas d'espace après `(` `[`, pas d'espace à l'intérieur des guillemets `« … »` ni autour des apostrophes courbes

*Ce point n'est plus une ceinture-et-bretelles : la règle (`lib/annotationSpacing.ts`) est
bien celle qui avait été extraite byte-identique, mais son hôte a changé — `AnnotationView`
a disparu, c'est `AnnotationPane` qui la rend maintenant. L'argument de byte-identité ne
couvre donc pas ce rendu-là.*

### Verdict

- [ ] Tous les écrans rendent à l'identique, aucune anomalie visuelle, aucun mojibake, aucune régression d'interaction
