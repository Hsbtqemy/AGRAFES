# Checklist QA shell v0.4.0 (`refonte`) — passe du 2026-08-16

Findings et causes racines : [QA_SHELL_2026-08-16.md](QA_SHELL_2026-08-16.md).
Shell dev + sidecar 1.6.62 sur `corpus_agrafes.WORKCOPY.db`.

### Documents cibles (contenu vérifié en base)


| Doc                        | Contenu réel                                                                  | Sert à                                          |
| -------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------- |
| 416 · Beigbeder-Francs_FR  | borne unité 4, 1327 liens → 364, 1258 unités à `parent_n`, 5 rôles, 37 tokens | matrice, ¶, stylo source, borne                 |
| 364 · Beigbeder-Francs_EN  | borne unité 3, 15 unités à rôle                                               | ¶ refusé sur mur de section, colonne traduction |
| 411 · Asimov-Foundation_FR | 24 902 tokens                                                                 | couche Annotation, éditeur de token             |
| 373 · Modiano-Rue_FR       | 3766 liens                                                                    | matrice en volume                               |


**Préalable** : devtools ouverts (clic droit → Inspecter → Console) pendant toute la passe.
**Déjà connus, ne pas re-remonter** : QA-01, QA-02, et la matrice qui ne peint pas le « périmé »
sur les cellules traduction (décision assumée, cf. `DESIGN_inline_text_correction.md` §10).

### Bloc 1 — Annotation (`◈ Actions` → `◎ Annotation` → Asimov-Foundation_FR)

- [x] 1.1 Clic sur mot coloré → éditeur de token s'ouvre (position buggée = QA-02, ignorer)
- [x] 1.2 Modifier Lemme → Enregistrer → statut OK, token toujours surligné
- [x] 1.3 Survol de la ligne éditée → ✎ apparaît
- [x] 1.4 ✎ → corriger → Ctrl+Entrée → prose corrigée, couleurs conservées, unité « périmée » (D-C9, voulu)
- [x] 1.5 Recherche de token → saute l'unité éditée — 🔎 vérif base (`update_text` + tokens conservés)
- [x] 1.6 Prose ↔ Étendu → correction et surlignage conservés



### Bloc 2 — Curation (`◇ Curation` → Beigbeder-Francs_FR)

- [x] 2.1 Marqueur ⚑ « Début du texte (unité 4) », 3 unités grisées au-dessus
- [x] 2.2 ✎ sur une ligne après la borne → Ctrl+Entrée → texte à jour
- [x] 2.3 ✎ puis Échap → aucune modification
- [x] 2.4 🔎 vérif base : `text_norm` changé, `text_raw` intact, liens pivot 416 → `source_changed_at`
- [x] 2.5 Preset de règles → marquage + diff par unité → Appliquer
- [x] 2.6 « Annuler » → curation défaite



### Bloc 3 — Rôles (même document)

- [x] 3.1 **ÉCHOUE — QA-03** : impossible d'assigner un rôle depuis la barre d'actions ; le seul
  ```
  chemin est le catalogue replié en haut de la pane, dont l'en-tête annonce « créer / modifier /
  supprimer ». L'assignation elle-même fonctionne par ce détour (actions `set_role` #145-148).
  ```
- [x] 3.2 ✎ sur une ligne à badge → le rôle survit à l'édition
- [x] 3.3 « ✕ Retirer la borne » → **doit fonctionner ici** (contournement QA-01)
- [x] 3.4 Re-poser la borne sur l'unité 4 — **obligatoire avant le bloc 5**
- [x] 3.5 **Mécanisme OK, accès KO — QA-03**. 🔎 vérifié en base : action `#114` (« Rôle de
  ```
  convention à 2 unités ») `reverted=1`, `reverted_by_id → #115` (`undo`, « Annulation : Rôle de
  convention à 2 unités »). La migration 033 fonctionne de bout en bout. Mais la couche Rôles
  n'a **aucun bouton d'annulation** : il faut basculer sur Curation, dont le bouton s'annonce
  « curation appliquée ou édition » sans mentionner les rôles.
  ```

> **Bloc 3 clos.** Les deux items « échoués » le sont par défaut d'accès, pas de moteur : les deux
> capacités existent et sont prouvées en base. C'est **QA-03** en entier.



### Bloc 4 — Segmentation / Brut (`⌥ Segmentation`)

- [x] 4.1 Vue Brut : ✎ sur les lignes uniquement, **jamais** sur une unité `unit_type="structure"`.
  ```
  ⚠️ **À tester sur le doc 417 `Coe-House-AL_FR`, unité n=1** (en-tête bibliographique) : c'est
  l'une des **4 seules** unités `structure` du corpus (docs 408/409/417/418, une chacun).
  **416 et 364 n'en ont aucune** → l'item y est intestable.
  Ne pas confondre avec les lignes à **rôle** structurel (« intertitre », « titre ») : ce sont
  des `line`, elles gardent le ✎ (416 n=2 et n=3 en portent).
  ```
- [x] 4.2 Éditeur de coupe ✂ + ✎ → un seul éditeur ouvert à la fois
- [x] 4.3 **Test clé — l'édition vise-t-elle la bonne unité ?** (piège `unit_id` corrigé pendant le
  ```
  lot : le modèle local ne transportait que `n`, le rang dans le document, au lieu de
  `unit_id`, la clé globale). Sur **416**, vue Brut : éditer la ligne **n=8** (« On croit qu'on
  a le temps. ») au ✎, ajouter ` ##QA43`, Ctrl+Entrée.
  À l'écran : ligne corrigée, voisines n=7 et n=9 inchangées.
  ⚠️ **L'écran ne prouve rien** : après sauvegarde la pane patche son état **localement**, sans
  recharger — l'affichage serait identique même si le moteur n'avait rien écrit.
  🔎 **vérif base obligatoire** : le marqueur doit être porté par `unit_id = 251323` (= n=8 du
  doc 416) et par aucune autre unité.
  ```
- [x] 4.4 Onglet Tours : liste `¶ | seg | texte` + aide
- [x] 4.5 Clic n° ¶ → toast « ✓ Nouveau paragraphe » + renumérotation séquentielle
- [x] 4.6 Re-clic sur un début de ¶ → « ✓ Frontière de paragraphe retirée »
- [x] 4.7 Paratexte (avant borne) et unités `structure` → ni n° ¶ ni bouton
- [x] 4.8 Sur 364 : ¶ sur une ligne à rôle structurel → refus propre du moteur, pas de plantage
- [x] 4.9 « Pré-remplir » (tiret/regex) → frontières en masse, ajustables ensuite
- [x] 4.10 « Annuler » → dernier ¶ défait. 🔎 vérifié en base : action `#166` passée `reverted=1`,
  ```
  `reverted_by_id → #167` (type `undo`, « Annulation : Paragraphe à 219 segments regroupés »).
  Bouton d'undo absent de l'onglet Tours (rendu dans la barre Brut) → noté dans QA-06.
  ```

> **Bloc 4 clos.** Findings ouverts au passage : **QA-06** (« Pré-remplir » : ni aperçu, ni undo,
> ni trace) et **QA-07** (deux définitions concurrentes de « rôle structurel »).



### Bloc 5 — Alignement / matrice (`⇄ Alignement`)

- [x] 5.1 Sélecteur de famille trié A→Z
- [x] 5.2 Charger la famille Beigbeder

- [~] 5.3 **ABANDONNÉ — couvert par QA-09** : le stylo de la matrice ne peut pas afficher sa
correction (la grille projette `text_raw`, le stylo écrit `text_norm`). Prouvé sur le payload
réel, deux segments (200 et 210). Inutile de retester.
- [~] 5.4 **ABANDONNÉ — même cause (QA-09)**. La présence du ✎ sur une cellule traduction simple
reste vraie, mais son effet est invisible ; l'item est absorbé par le finding.

- [x] 5.5 ✎ **absent** sur vide / non traduit / ajout / fusionnée / coupée (voulu)
- [x] 5.6 Clic n° ¶ → toast + renumérotation
- [x] 5.7 ↗ en-tête de langue → ouvre la couche Segmentation/Brut
- [x] 5.8 Orphelines « hors matrice » → « ↗ Segmenter » → deep-link sur l'unité exacte
- [x] 5.9 Export CSV → fonctionnel. Chemin : ⌘ **Exporter** → carte « Matrice multilingue »
  (famille + séparateur CSV/TSV). A ouvert **S-04** : l'export ne porte **aucune référence**
  bibliographique, et le TEI lit `meta_json` là où l'application écrit des colonnes dédiées.
- [x] 5.10 Modiano-Rue_FR (3766 liens) → scroll fluide, pas de gel

**Gestes de cellule (le quatuor ✂⭙✕＝ + ré-ancrage, livrés en juillet — ajoutés en cours de passe).**
Repère de départ : **1 267 liens** 416→364, **33** marqués périmés.

- [x] 5.11 **＝ Rattacher** — ouvrir le sélecteur sur une cellule, choisir une cible → lien créé,
  ```
  cellule peuplée. ⚠️ le « % » est une **proximité de marqueur**, pas une ressemblance
  (**QA-08**) : ne pas s'en servir pour juger, lire le texte.
  🔎 **Prouve en base** : lien `run_id='manual'` cree a 21:12:32 entre les deux
  lignes de titre (416 n=1 <-> 364 n=1).
  ```
- [x] 5.12 **✕ Retirer** une traduction → la cellule redevient vide, geste réversible —
  ```
  🔎 vérif base (le compte de liens doit baisser de 1, puis remonter après re-rattachement)
  ```
- [x] 5.13 **⭙ Fusionner** — « reprendre la phrase du segment voisin dans CE segment » → la cellule
  ```
  absorbe la phrase, le voisin la perd. Conforme à l'énoncé.
  ```
- [x] 5.13b **ÉCHOUE — ALI-22** : revenir sur un ⭙ est impossible en un geste (démontré en base). Le ＝ seul
  ```
  laisse la cible rattachée à DEUX segments, sans alerte (le ⭙ a posé un bead qui masque
  le doublon). Retour effectif = ✕ sur la cellule qui a absorbé, PUIS ＝ sur le voisin.
  ```
- [x] 5.14 **✂ Couper** une traduction fusionnée entre ce segment et le précédent, puis
  ```
  « Annuler la coupe » = le bouton ↻ (flèche HORAIRE), révélé au survol de la cellule, entre
  le ⊙ et le ✕ → la traduction redevient entière (char_start remis à null).
  Sur une cellule coupée le ✎ et le ＝ DISPARAISSENT : la rangée de boutons change de forme.
  ⚠ MATÉRIEL DISPONIBLE (famille Modiano, mesuré 2026-08-19) — colonne en : 0 cellule ⚠, 0 coupée ;
  colonne ro : idem. TOUT se joue en colonne es : 1 seule cellule ⚠ (segment 2) pour la partie
  « couper », 5 cellules déjà coupées (segments 12 à 16) pour la partie « annuler ».
  Sur fr↔en l'item est INEXÉCUTABLE faute de cellule fusionnée.
  ✅ VÉRIFIÉ EN BASE (2026-08-19) — ↻ sur la cellule es du segment 12 : lien 42925 (aligneur) passe
  de [0,11] à char_start=NULL / char_end=NULL, bead effacé, run_id d'origine CONSERVÉ ; tranche
  manuelle 46631 supprimée ; total de liens coupés de la base 11 → 9. Assertion démontrée.
  RÉSERVE : le ✂ a été exercé en forme « straddle » (segments 12 à 16), PAS depuis une cellule
  ⚠ fusionnée — un seul candidat subsiste (colonne es, segment 2, celui du doublon ALI-22).
  ```
- [x] 5.15 **Statuts de cellule** — marquer « non traduit » puis retirer la marque ; marquer
  ```
  « ajout du traducteur » (D8) puis retirer. Une cellule « non traduit » compte comme faite.
  ```
- [x] 5.16 **Ré-ancrage (5e verbe, RA-D1)** — dans le sélecteur, choisir un candidat **déjà lié à un
  ```
  autre segment** (badge `= §N`) → l'UI doit proposer « **déplacer ici (ré-ancrer)** » ou
  « ajouter aussi », jamais créer un doublon silencieux
  🔎 **Prouve en base** : le segment FR n=5 pointait vers EN n=5 (run positionnel) et
  pointe desormais vers **EN n=3**, l'appariement correct, statut `accepted`, a 21:10:03.
  C'est le **seul** lien du document dont l'ecart n'est pas nul. Le resultat est prouve ;
  le libelle exact du choix propose par l'UI (« deplacer » vs « ajouter aussi ») ne l'est pas.
  ```
- [x] 5.17 **Renvoi au Contrôle** — « Réviser ce lien dans le Contrôle » ouvre la révision fine sur
  ```
  **ce** lien (statut, collisions, qualité)
  ```



### Bloc 6 — Balayage visuel (purge CSS `aa7ded3`, 2 477 l. retirées)

- [ ] 6.1 Importer · 6.2 ShareDocs · 6.3 Documents · 6.4 Exporter · 6.5 Paramètres
- [ ] 6.6 Contrôle (Révision fine — peu visité, bon candidat)
- [ ] 6.7 Transitoires : toast, modale de confirmation, bandeau d'erreur, badge de statut
- [ ] 6.8 Shell : Explorer + Recherche (CSS prep + app dans un seul webview)



### Bloc 7 — Inspecteur, propagation, nav legacy

*(Trois items de la première version de la checklist — organisée par fonctionnalité — que la
réorganisation par écran avait laissés de côté.)*

- [ ] 7.1 `≡ Documents` → fiche d'un document → **inspecteur d'unité** sur une ligne **riche**
  ```
  (gras/italique, donc `<hi>` dans `text_raw`) : la textarea s'ouvre sur le **texte propre**,
  sans balisage échappé ; après sauvegarde `text_raw` **n'est pas écrasé** (convergence D-C1,
  le bug le plus vicieux du lot) — 🔎 vérif base
  ```
- [ ] 7.2 `⌥ Segmentation` sur **364 Beigbeder-Francs_EN** → le bouton « Propager la segmentation »
  ```
  apparaît (masqué tant que le doc n'a pas de source déclarée — `_togglePropagateBtn`,
  `SegmentPane.ts:959-962`) → **aperçu seulement** : badges de rôle affichés, paratexte **non
  doublé** (borne unité 3 honorée), rôles structurels traités en frontières de section —
  c'est le trio de fix du 22/07 (`2c9adda`, `297bf6a`, `ab7a63e`).
  ⚠️ **Ne pas cliquer « Appliquer » avant d'avoir fini le bloc 5** : l'apply recoupe la
  traduction et détruirait les 1327 liens dont la matrice dépend.
  ```
- [ ] 7.3 Nav : `⌥ Segmentation`, `◇ Curation`, `◎ Annotation` ouvrent les **couches du canvas**
  ```
  (plus aucun écran legacy derrière), aucun lien mort
  ```



### Bloc 8 — Final

- [ ] 8.1 Console sans erreur rouge accumulée
- [ ] 8.2 🔎 bilan base : `update_text` / `set_paragraph` / `source_changed_at`, aucun `text_raw` perdu