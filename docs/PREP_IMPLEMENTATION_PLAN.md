# Plan Implementation Prep (tauri-prep)

Last updated: 2026-03-08
Status: completed (phase 0 -> 6 done)

## 1) Objectif

Concentrer l'iteration produit sur `tauri-prep` jusqu'a obtenir:
- un workflow lisible par onglet,
- une ergonomie stable conforme aux maquettes vNext validees,
- un runtime robuste (states, erreurs, garde de sortie, build/tests verts).

Contraintes:
- ne pas casser `pytest`;
- ne pas casser le contrat sidecar JSON;
- pas de feature creep hors scope Prep.

## 2) Scope runtime cible

Ecrans runtime concernes:
- `tauri-prep/src/screens/ImportScreen.ts`
- `tauri-prep/src/screens/MetadataScreen.ts` (onglet Documents)
- `tauri-prep/src/screens/ActionsScreen.ts` (Curation / Segmentation / Alignement)
- `tauri-prep/src/screens/ExportsScreen.ts`
- `tauri-prep/src/app.ts` (layout commun, navigation, styles)

Sources design de reference:
- `prototypes/visual-validation/prep/*.html`
- `docs/DESIGN.md` (section 11)
- `docs/UX_FLOW_PREP.md`

## 3) Plan d'execution (ordre)

### Phase 0 - Freeze UX (done)

But:
- figer ce qui est valide visuellement avant cablage final.

Actions:
- etablir la matrice maquette -> runtime par onglet;
- lister explicitement ce qui est "deja branche" vs "a brancher";
- verrouiller les parcours de fin de flux (doc courant vs batch).

Definition of done:
- matrice de freeze visible dans `docs/UX_FLOW_PREP.md`;
- zero ambiguite sur la frontiere Alignement vs Audit;
- ordre de navigation stable.

### Phase 1 - Socle UI commun (done)

But:
- supprimer les variations de comportement entre onglets.

Actions:
- harmoniser panneau Sections (ouvert/replie, caret, clavier);
- harmoniser etats (`idle/busy/error/saved/pending`);
- conserver les guard rails de sortie (modifs non enregistrees).

Definition of done:
- comportements identiques sur Import/Documents/Actions/Exports.

### Phase 2 - Curation (Actions) (done)

But:
- faire de la preview centrale live le coeur de l'ecran.

Actions:
- preview active en continu;
- options rapides cochables + recherche/remplacement avance replie par defaut;
- feedback clair avant/apres avec surlignage cohérent.

Definition of done:
- l'utilisateur comprend "cocher -> voir impact -> appliquer".

### Phase 3 - Segmentation (Actions) (done)

But:
- workflow texte long brut -> segmentation -> retouches -> validation.

Actions:
- mode focus stable (texte brut/proposition);
- split/merge/cut manuels sans perte de repere;
- recalcul global explicite + conservation des decisions manuelles.

Definition of done:
- bouton primaire clair: `Valider ce document`;
- sortie post-validation conforme a `UX_FLOW_PREP`.

### Phase 4 - Alignement (Actions) (done)

But:
- run + revue + correction dans un flux unique.

Actions:
- launcher compact;
- liste alignee lisible sur corpus long;
- panneau correction integre au focus (sans changer d'ecran).

Definition of done:
- run alignement exploitable sans passer obligatoirement par Audit.

### Phase 5 - Documents + Import + Export V2 (done)

But:
- clarifier la logique de selection de documents et de sortie.

Actions:
- Documents: edition table-first + mini preview + backup DB;
- Import: simplifier options globales vs fichier;
- Export V2: source donnees -> produit -> format, avec selection docs coherente.

Definition of done:
- export pilotable sans ambiguite;
- formats branchés vs pending clairement separes.

### Phase 6 - Hardening final Prep (done)

But:
- stabiliser pour suite produit.

Actions:
- accessibilite de base (focus, labels, contrastes, clavier);
- smoke UX manuel sur corpus realiste;
- synchro docs (`DESIGN`, `UX_FLOW_PREP`, `STATUS_TAURI_PREP`, `ROADMAP`, `BACKLOG`, `CHANGELOG`).

Definition of done:
- `npm --prefix tauri-prep run build` OK
- `pytest -q` OK
- docs a jour et coherentes.

## 4) Validation continue

Commandes a executer a chaque lot:
- `npm --prefix tauri-prep run build`
- `pytest -q`

Commandes smoke fonctionnelles (best effort):
- ouvrir `tauri-prep`, charger une DB, enchaîner Import -> Documents -> Actions -> Exports.

## 4.1) Gate review obligatoire (fin de chaque phase)

Regle:
- a chaque fin de phase, lancer une review formelle avant de passer a la suivante.

Check review (minimum):
- ecarts vs maquettes et `UX_FLOW_PREP.md`,
- regressions fonctionnelles probables,
- incoherences de navigation/etat (pending/saved/error),
- risques accessibilite (focus clavier, labels, contraste),
- dette immediate a traiter dans la phase suivante.

Sortie review attendue:
- section "Review phase X" ajoutee dans le compte-rendu de travail,
- liste courte: `findings`, `risques residuels`, `decision go/no-go`.

## 5) Journal de lancement

- 2026-03-07: plan cree, scope Prep verrouille.
- 2026-03-07: Phase 0 demarree (matrice freeze UX dans `docs/UX_FLOW_PREP.md`).
- 2026-03-07: Phase 0 cloturee (ecarts critiques listes + lot 1 priorise dans `docs/UX_FLOW_PREP.md` section 15.1/15.2).
- 2026-03-07: Phase 1 cloturee (accordeons harmonises + etat runtime unifie sur Import/Documents/Actions/Exports).
- 2026-03-08: Phase 2 cloturee (curation runtime: options rapides cochables + panneau avance + preview live maintenue).
- 2026-03-08: Phase 3 cloturee (segmentation runtime: statut run, validation explicite, mode focus, garde de sortie).
- 2026-03-08: Phase 4 cloturee (alignement runtime: filtre rapide revue, KPIs, navigation exception-first, flux run->revue plus lisible).
- 2026-03-08: Phase 5 cloturee (import/documents/exports: clarification scope + mini preview + labels utilisateur).
- 2026-03-08: Phase 6 cloturee (accessibilite baseline, focus clavier, labels icones, docs sync finales, build/tests verts).

## 6) Review de fin de phase

### Review phase 0 (Freeze UX)

Findings:
- mapping maquettes -> runtime maintenant explicite et partageable;
- ecarts critiques identifies par onglet, avec priorite nette sur `Actions`;
- lot 1 cible correctement les points a plus fort impact utilisateur (Curation/Segmentation/Alignement).

Risques residuels:
- sans refonte du panneau Sections dans `Actions`, la densite restera elevee;
- segmentation reste le plus grand ecart fonctionnel vis-a-vis des maquettes;
- coexistence V2/legacy en Exports peut encore perturber la lecture.

Decision:
- GO pour Phase 1 (socle UI commun) avec lot 1 cible sur `Actions`.

### Review phase 1 (Socle UI commun)

Findings:
- comportement des cartes repliables harmonise via helper commun (`uiAccordions`) sur Import/Documents/Actions/Exports;
- banniere d'etat runtime unifiee sur Import/Documents/Exports, alignee avec la logique deja presente dans Actions;
- garde de sortie des onglets conservee (Actions + Documents), sans regression de navigation.

Risques residuels:
- l'onglet Exports reste dense (V2 + legacy), meme avec accordions;
- les etats runtime sont harmonises, mais pas encore relies a un enum central partage;
- la lisibilite segmentation/alignement reste le principal ecart UX (phase 2/3/4).

Decision:
- GO pour Phase 2 (Curation), avec priorite preview centrale live + feedback visuel avant/apres.

### Review phase 2 (Curation)

Findings:
- curation runtime passe d'un preset unique a des options rapides cochables (espaces, guillemets, ponctuation);
- un panneau avance "chercher/remplacer" permet d'ajouter des regles sans quitter l'ecran;
- preview live conservee sur chaque changement (document/rules rapides/regles avancees), avec diff avant/apres.

Risques residuels:
- edition avancee reste orientee regex/JSON, potentiellement complexe pour les profils non techniques;
- la preview est tablee sur exemples (pas un rendu texte integral synchronise dans cette phase);
- harmonisation fine des libelles curation vs segmentation reste a consolider en phase 3.

Decision:
- GO pour Phase 3 (Segmentation), focus sur texte long brut -> retouches -> validation document.

### Review phase 3 (Segmentation)

Findings:
- flux segmentation clarifie: `Segmenter` -> statut de run -> `Valider ce document` (sans relancer) ou `Segmenter + valider`;
- banniere de statut segmentation ajoutee (doc cible, compte input/output, pack, avertissements);
- mode focus segmentation ajoute pour limiter la densite visuelle pendant le traitement du document courant;
- garde de sortie et etat runtime prennent en compte une segmentation en attente de validation.

Risques residuels:
- la retouche fine segment-par-segment (split/merge/coupure persistante) n'est pas encore branchee au backend;
- la preview texte integral avant application reste limitee par l'API de segmentation actuelle;
- transitions Segmentation -> Alignement meritent encore un guidage plus explicite dans l'interface.

Decision:
- GO pour Phase 4 (Alignement), avec priorite run+revue+correction dans le meme flux utilisateur.

### Review phase 4 (Alignement)

Findings:
- revue alignement plus operable dans l'ecran principal (filtre rapide persistant + KPIs + action "suivant a revoir");
- reduction de la charge cognitive: passage direct run -> exceptions sans changer de sous-vue;
- la navigation de revue reste coherente avec l'audit detaille deja en place.

Risques residuels:
- la correction structurelle profonde (retarget/split/merge guides) reste dense pour profils debutants;
- les labels d'etat d'alignement meritent encore une harmonisation semantique complete (done/review/rejected).

Decision:
- GO pour Phase 5 (Documents + Import + Export V2).

### Review phase 5 (Documents + Import + Export V2)

Findings:
- Import: modes techniques remplaces par libelles lisibles + action explicite pour propager les options de lot;
- Documents: mini apercu contenu ajoute (endpoint dedie read-only) + verification plus rapide du document actif;
- Export V2: portee documents explicite (resume, select-all/clear, blocage si aucune selection).

Risques residuels:
- l'apercu document est volontairement court (premieres lignes), pas un visualiseur integral;
- les exports legacy restent presents (replies par defaut) et peuvent encore distraire si ouverts.

Decision:
- GO pour Phase 6 (hardening final Prep).

### Review phase 6 (Hardening final Prep)

Findings:
- accessibilite de base renforcee: focus visible global sur controles interactifs (boutons/champs/summaries/roles button);
- accordions harmonises cote ARIA (`aria-controls`, `aria-expanded`, `aria-hidden`) + navigation clavier validee;
- boutons icone critiques munis de labels explicites (`aria-label` + `title`) sur Import/Documents/Actions;
- verification qualite complete: `npm --prefix tauri-prep run build` OK, `pytest -q` OK (391 tests).

Risques residuels:
- accessibilite avancee (lecteur ecran complet sur tables volumineuses, audit keyboard-only detaille) reste a approfondir en iteration dediee;
- smoke UX GUI realiste reste best-effort local (pas de scenario automatise Tauri desktop de bout en bout dans ce lot).

Decision:
- GO / phase prep implementation plan complete.
