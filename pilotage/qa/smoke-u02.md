---
passe: Smoke dégraissage front U-02
chantier: U-02
duree: 10 min
derniere: —
---

# QA — dégraissage front U-02 (vague #149→#157)

Confirmer **visuellement** que les 9 extractions à comportement-préservant rendent à
l'identique. Chaque move est byte-identique (DOM rendu inchangé), donc cette passe est une
ceinture-et-bretelles ciblée. À faire sur le shell desktop (`tauri-shell`) avec un corpus
réel — idéalement le corpus démo, hors dossier cloud-sync.

Cocher = « rend comme avant, aucune anomalie ». Les glyphes et libellés exacts sont listés
à l'œil : ce sont les octets transplantés, un mojibake est une régression.

**Préparation** — ouvrir un corpus contenant au moins un document annoté (spaCy), une
famille (source + traduction) et un alignement réalisé, pour exercer toutes les branches.

**Avertissement (2026-08-17, au moment de la migration).** Cette passe a été écrite le
27 juin 2026 et n'a jamais été jouée. Depuis, trois des écrans qu'elle couvre ont été
supprimés en R6.5 : `AnnotationView` le 20 juillet, `CurationView` le 22 juillet,
`SegmentationView` le 23 juillet. **Les 9 points de ces trois zones ne sont plus
vérifiables tels quels** — leurs fonctions ont été reloguées au canvas texte. Les points
sont conservés à l'identique par honnêteté de migration ; à recadrer vers le canvas ou à
supprimer avant de jouer la passe.

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

### À recadrer (écrans retirés en R6.5)

- [ ] SegmentationView (#153) — un aperçu de re-segmentation produisant des différences affiche le diff : segments inchangés (eq), supprimés (del), insérés (ins), dans le bon ordre
- [ ] SegmentationView (#153) — une re-segmentation identique affiche la note « ✓ Aucune différence — … mêmes N segments. »
- [ ] AnnotationView (#156) — sur un document annoté, le mode Lecture (prose colorée UPOS) applique l'espacement français : pas d'espace avant `.,;:!?` ni `)` `]`, pas d'espace après `(` `[`, pas d'espace à l'intérieur des guillemets `« … »` ni autour des apostrophes courbes
- [ ] AnnotationView (#156) — cliquer un token en mode Lecture rebascule en mode Annoter sur ce token
- [ ] CurationView (#157) — sélectionner une modification dans un aperçu de curation affiche la carte contexte en mode affichage : lignes `Avant` / `Après` si contexte, ligne courante `Modifié` avec `avant → après` (flèche → et surlignage des changements), boutons `✎ Éditer` et — si exception absente — `🔒 Toujours ignorer` / `🔒 Conserver cette correction`
- [ ] CurationView (#157) — `✎ Éditer` bascule en mode édition : `Original`, `Résultat` (textarea), hint « Proposition automatique : … », boutons `Enregistrer` et `Annuler` tous deux fonctionnels
- [ ] CurationView (#157) — un document avec override manuel affiche le badge `✏ Édité manuellement` et le bouton `↩ Proposition auto`
- [ ] CurationView (#157) — un document avec exception persistée affiche le badge `🔒 Ignoré durablement` / `Override durable` et le bouton `🔓 Supprimer l'exception`, à la place des boutons ignorer / conserver
- [ ] CurationView (#157) — une ouverture ciblée depuis le panneau Exceptions affiche la note « ↗ Ouverture ciblée … » et le label de ligne devient `Inchangé` ou `Neutralisé` selon le cas

### Verdict

- [ ] Tous les écrans rendent à l'identique, aucune anomalie visuelle, aucun mojibake, aucune régression d'interaction
