---
passe: Shell v0.4.0 — lot de juillet
chantier: R6
derniere: 2026-08-16
---

# QA shell v0.4.0 — stylo inline, ¶ manuels, retrait legacy, purge CSS

Passe de QA visuelle du shell couvrant le lot de juillet.

**Où est la preuve.** Cette passe a été jouée le **2026-08-16** (52 / 54 vérifiés), puis
complétée par des vérifications en base le **2026-08-19**. Tout le relevé de ces deux
exécutions — actions, `unit_id`, comptes de liens, sondes CSS — est dans
`docs/REVIEW_QA_SHELL_2026-08-16.md` et son `_checklist.md`. Les énoncés ci-dessous ne
portent plus que le **protocole** : où cliquer, quoi regarder, où le matériel existe.
Élagué le 2026-08-22.

**Contexte d'exécution.** Shell dev (`npm --prefix tauri-shell run tauri -- dev`) +
sidecar PyInstaller `onefile`. Contrat live attendu **1.6.75**, engine **0.4.0**.
Base servie : une WORKCOPY, jamais le corpus réel.

**Préalable** : devtools ouverts (clic droit → Inspecter → Console) toute la passe.

**Vocabulaire.** L'onglet « Brut » de la couche Segmentation s'appelle « Segmentation
actuelle » depuis le 2026-08-21, et les cinq onglets forment deux groupes (l'état à
gauche, « Segmenter : » à droite). Le rapport du 16 août dit encore « Brut » ; c'est la
même vue.

### Bloc 1 — Annotation (`◈ Actions` → `◎ Annotation` → Asimov-Foundation_FR)

- [ ] 1.1 Clic sur mot coloré → l'éditeur de token s'ouvre (position décalée = QA-02, connu)
- [ ] 1.2 Modifier Lemme → Enregistrer → statut OK, token toujours surligné
- [ ] 1.3 Survol de la ligne éditée → ✎ apparaît
- [ ] 1.4 ✎ → corriger → Ctrl+Entrée → prose corrigée, couleurs conservées, unité « périmée » (D-C9, voulu)
- [ ] 1.5 Recherche de token → saute l'unité éditée. 🔎 base : `update_text` posé, tokens conservés
- [ ] 1.6 Prose ↔ Étendu → correction et surlignage conservés

### Bloc 2 — Curation (`◇ Curation` → Beigbeder-Francs_FR)

- [ ] 2.1 Marqueur ⚑ « Début du texte (unité 4) », 3 unités grisées au-dessus
- [ ] 2.2 ✎ sur une ligne après la borne → Ctrl+Entrée → texte à jour
- [ ] 2.3 ✎ puis Échap → aucune modification
- [ ] 2.4 🔎 base : `text_norm` changé, `text_raw` intact, liens du pivot 416 marqués `source_changed_at`
- [ ] 2.5 Preset de règles → marquage + diff par unité → Appliquer
- [ ] 2.6 « Annuler » → curation défaite

### Bloc 3 — Rôles (même document)

- [ ] 3.1 Assigner un rôle **depuis la barre d'actions** (QA-03 : au 16/08, seul le catalogue replié le permettait)
- [ ] 3.2 ✎ sur une ligne à badge → le rôle survit à l'édition
- [ ] 3.3 « ✕ Retirer la borne » → doit fonctionner ici (contournement QA-01)
- [ ] 3.4 Re-poser la borne sur l'unité 4 — **obligatoire avant le bloc 5**
- [ ] 3.5 Annuler une assignation de rôle **sans quitter la couche Rôles** (QA-03 : le mécanisme marche, l'accès manquait — il fallait passer par Curation)

### Bloc 4 — Segmentation / « Segmentation actuelle » (`⌥ Segmentation`)

- [ ] 4.1 Vue « Segmentation actuelle » : ✎ sur les lignes, **jamais** sur une unité `unit_type="structure"`. Matériel : seuls les docs 408 / 409 / 417 / 418 en portent une (une chacun) — jouer sur **417 `Coe-House-AL_FR`, n=1** ; 416 et 364 n'en ont aucune. Ne pas confondre avec une ligne à **rôle** structurel (« intertitre », « titre ») : c'est une `line`, elle garde le ✎
- [ ] 4.2 Éditeur de coupe ✂ + ✎ → un seul éditeur ouvert à la fois
- [ ] 4.3 **Test clé — l'édition vise-t-elle la bonne unité ?** Sur **416**, éditer la ligne **n=8** au ✎, ajouter un marqueur reconnaissable, Ctrl+Entrée. ⚠️ **L'écran ne prouve rien** : après sauvegarde la pane patche son état localement, sans recharger — l'affichage serait identique si le moteur n'avait rien écrit. 🔎 **vérif base obligatoire** : le marqueur doit être porté par l'`unit_id` de n=8, et par aucune autre unité
- [ ] 4.4 Onglet Tours : liste `¶ | seg | texte` + aide
- [ ] 4.5 Clic n° ¶ → toast « ✓ Nouveau paragraphe » + renumérotation séquentielle
- [ ] 4.6 Re-clic sur un début de ¶ → « ✓ Frontière de paragraphe retirée »
- [ ] 4.7 Paratexte (avant borne) et unités `structure` → ni n° ¶ ni bouton
- [ ] 4.8 Sur 364 : ¶ sur une ligne à rôle structurel → refus propre du moteur, pas de plantage
- [ ] 4.9 « Pré-remplir » (tiret / regex) → frontières en masse, ajustables ensuite
- [ ] 4.10 « Annuler » → dernier ¶ défait. 🔎 base : l'action passe `reverted=1`. Bouton d'undo absent de l'onglet Tours, rendu dans la barre de la vue d'état (QA-06)

### Bloc 5 — Alignement / matrice (`⇄ Alignement`)

- [ ] 5.1 Sélecteur de famille trié A→Z
- [ ] 5.2 Charger la famille Beigbeder
- [ ] 5.3 + 5.4 Le ✎ sur une cellule de traduction simple, et **sa correction visible dans la grille**. *(Abandonné le 16/08 sous QA-09 — la grille projetait `text_raw`, le stylo écrivait `text_norm` ; corrigé par ALI-01 `e32158b`. **Déjà revérifié** le 19/08 par `qa/alignement-2026-08.md`, zone « Matrice — le stylo » : contre-épreuve si cette passe est jouée seule, pas une découverte.)*
- [ ] 5.5 ✎ **absent** sur vide / non traduit / ajout / fusionnée / coupée (voulu)
- [ ] 5.6 Clic n° ¶ → toast + renumérotation
- [ ] 5.7 ↗ en-tête de langue → ouvre la couche Segmentation, onglet « Segmentation actuelle »
- [ ] 5.8 Orphelines « hors matrice » → « ↗ Segmenter » → deep-link sur l'unité exacte
- [ ] 5.9 Export CSV. Chemin : ⌘ **Exporter** → carte « Matrice multilingue » (famille + séparateur CSV/TSV). Connu : l'export ne porte aucune référence bibliographique, et le TEI lit `meta_json` là où l'application écrit des colonnes dédiées (S-04)
- [ ] 5.10 Modiano-Rue_FR (3 766 liens) → scroll fluide, pas de gel
- [ ] 5.11 **＝ Rattacher** — ouvrir le sélecteur sur une cellule, choisir une cible → lien créé, cellule peuplée. ⚠️ le « % » est une **proximité de marqueur**, pas une ressemblance (QA-08) : lire le texte, ne pas s'y fier pour juger
- [ ] 5.12 **✕ Retirer** une traduction → la cellule redevient vide, geste réversible. 🔎 base : le compte de liens baisse de 1, puis remonte après re-rattachement
- [ ] 5.13 **⭙ Fusionner** — « reprendre la phrase du segment voisin dans CE segment » : la cellule absorbe la phrase, le voisin la perd
- [ ] 5.13b Revenir sur un ⭙ **en un geste** (ALI-22 : impossible au 16/08 — le ＝ seul laissait la cible rattachée à deux segments sans alerte, le bead masquant le doublon. Deux correctifs depuis, `cb799c6` et le bandeau ↺ : à rejouer)
- [ ] 5.14 **✂ Couper** une traduction fusionnée entre ce segment et le précédent, puis « Annuler la coupe » = le bouton ↻ (flèche **horaire**), révélé au survol entre le ⊙ et le ✕ → la traduction redevient entière. Sur une cellule coupée, ✎ et ＝ **disparaissent** : la rangée change de forme. ⚠ **Matériel** (famille Modiano, mesuré le 19/08) : rien en colonnes `en` ni `ro`. Tout se joue en **`es`** — 1 seule cellule ⚠ (segment 2) pour la partie « couper », 5 déjà coupées (segments 12 à 16) pour la partie « annuler ». Sur fr↔en l'item est **inexécutable**
- [ ] 5.15 **Statuts de cellule** — marquer « non traduit » puis retirer la marque ; marquer « ajout du traducteur » (D8) puis retirer. Une cellule « non traduit » compte comme faite
- [ ] 5.16 **Ré-ancrage (5ᵉ verbe, RA-D1)** — dans le sélecteur, choisir un candidat **déjà lié à un autre segment** (badge `= §N`) → l'UI doit proposer « **déplacer ici (ré-ancrer)** » ou « ajouter aussi », jamais créer un doublon silencieux. Le résultat en base a été prouvé le 16/08 ; le **libellé** du choix ne l'a pas été — c'est ce qui reste à voir
- [ ] 5.17 **Renvoi au Contrôle** — « Réviser ce lien dans le Contrôle » ouvre la révision fine sur **ce** lien (statut, collisions, qualité)

### Bloc 6 — Balayage visuel (purge CSS `aa7ded3`, 2 477 l. retirées)

- [ ] 6.1 Importer · 6.2 ShareDocs · 6.3 Documents · 6.4 Exporter · 6.5 Paramètres — chercher du **nu** : texte sans style, bordure absente, bouton dénudé
- [ ] 6.6 Contrôle (Révision fine — peu visité, bon candidat)
- [ ] 6.7 Transitoires : toast, modale de confirmation, bandeau d'erreur, badge de statut
- [ ] 6.8 Shell : Explorer + Recherche (CSS prep + app dans un seul webview)

*Ce bloc se joue **à l'œil et seulement à l'œil**. La sonde mécanique « classe présente dans
le DOM sans règle CSS » a déjà tourné le 19/08 sur les quatre zones, intersection vide avec
les 289 classes purgées ; elle ne couvre **ni** le contenu construit après chargement **ni**
le cas combinateur (`.a .b` supprimé, `.b` gardé). C'est exactement ce qui reste ici.*

### Bloc 7 — Inspecteur, propagation, nav legacy

- [ ] 7.1 `≡ Documents` → fiche d'un document → **inspecteur d'unité** sur une ligne **riche** (gras / italique, donc `<hi>` dans `text_raw`) : la textarea s'ouvre sur le **texte propre**, sans balisage échappé ; après sauvegarde `text_raw` **n'est pas écrasé** (convergence D-C1, le bug le plus vicieux du lot). Matériel : doc **423 « 9-CI-OrEn-Obs-2022 »**, qui porte les 4 seules unités du corpus dont `text_raw` contient du `<hi>`. 🔎 vérif base
- [ ] 7.2 `⌥ Segmentation` sur **364 Beigbeder-Francs_EN** → « Propager la segmentation » apparaît (masqué tant que le doc n'a pas de source déclarée) → **aperçu seulement** : badges de rôle affichés, paratexte **non doublé** (borne unité 3 honorée), rôles structurels traités en frontières de section. ⚠️ **Ne pas cliquer « Appliquer »** — deux raisons : l'apply recoupe la traduction et détruit les 1 327 liens dont la matrice dépend, sans trace ni annulation (ALI-10) ; et il découperait la section 3 de l'anglais en 1 229 morceaux. L'aperçu doit émettre l'avertissement d'écart de section ; son appariement est **positionnel**, aveugle aux intitulés (QA-12)
- [ ] 7.3 Nav : `⌥ Segmentation`, `◇ Curation`, `◎ Annotation` ouvrent les **couches du canvas** (plus aucun écran legacy derrière), aucun lien mort

### Bloc 8 — Final

- [ ] 8.1 Console sans erreur rouge accumulée. **Déjà diagnostiqués, ne pas recompter** : QA-13 (CORS + `net::ERR_FAILED` sur le `/health` de la modale Diagnostic — seul `fetch()` brut du shell, d'où le « Running : no » alors que le pont Rust répond), QA-14 (`aria-hidden` sur le tiroir Journal pendant que son ✕ a le focus), QA-11 (`ERR_NETWORK_CHANGED` / module importé dynamiquement)
- [ ] 8.2 🔎 bilan base : `update_text` / `set_paragraph` / `source_changed_at` cohérents, **aucun `text_raw` écrasé ni vidé**, unités à balisage `<hi>` intactes
