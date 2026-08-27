---
chantier: ANN-01
statut: à venir
---

# ANN-01 — l'annotation se perd sans le dire, et l'undo ne la rend pas

**Point de départ** — question posée en pleine passe de QA (« on ne peut pas supprimer une couche d'annotation ? »), constat vérifié au code et chiffré en base, aucune ligne écrite, 25 août 2026.

## Reste

- [ ] Corriger la règle d'espacement du rendu en prose, ou l'assumer — `lib/annotationSpacing.ts` s'annonce « French-spacing rule » et implémente la convention **anglo-saxonne** : `:` `;` `!` `?` et `»` sont rangés parmi les signes sans espace avant, alors que le français en demande une (insécable), et `«` colle au mot suivant. Seuls `.` `,` `)` `]` `}` sont justes. La colonne `language` des documents n'est jamais consultée : une seule règle vaut pour tout le corpus
- [ ] Mesurer l'effet avant de choisir un remède — fait le 25 août : sur 3697 unités annotées, **1348** s'affichent autrement qu'elles ne sont stockées, et **365 de ces écarts (27 %) viennent de cette seule règle** — 184 unités espagnoles, 173 françaises, 8 allemandes. L'espagnol est majoritaire parce que ces traductions ont été composées avec les espaces françaises. Rien n'est corrompu pour autant : la reconstruction ne sert qu'à l'affichage, `tokensToPlain` n'a plus d'appelant hors tests et rien n'est réenregistré
- [ ] Noter la conséquence de bord, **plus grave que d'abord écrit** : la règle ne fait pas que provoquer des refus, elle en fait aussi passer à tort. Sur les unités où deux erreurs d'espacement se compensent — `¿` qui gagne une espace, `?` qui en perd une — les longueurs coïncident, le garde de RICH-01 laisse passer, et le style se pose décalé d'un caractère. **196 unités** sont dans ce cas. Voir la démonstration dans `RICH-01`
- [ ] Noter la conséquence de bord initiale, suivie dans RICH-01 : ces 365 unités sont aussi celles où le geste de stylisation est refusé, le garde comparant le texte affiché au texte stocké. **Mais corriger l'espacement ne doit pas servir à débloquer le geste** — l'analyse du 25 août a conclu que la couche Annotation doit déclarer explicitement les lignes qu'elle repeint, précisément pour ne plus dépendre d'une coïncidence de longueurs. Les deux corrections sont indépendantes : celle-ci vise l'affichage, celle de RICH-01 vise le geste
- [ ] Retirer `tokensToPlain` s'il reste sans appelant, ou le rebrancher : il est exporté et testé, mais plus utilisé nulle part depuis que le rendu en prose appelle directement `needsSpaceBefore`
- [ ] Trancher si la capacité « retirer l'annotation » manque vraiment : réannoter remplace déjà tout, et le seul état qu'on ne sait pas retrouver est « non annoté »
- [ ] `/segment` supprime les unités puis les réinsère (`sidecar.py:4951`) : les tokens partent par cascade `ON DELETE CASCADE` (migration 012), sans être photographiés, ni comptés dans la réponse, ni annoncés à l'écran
- [ ] `/units/merge` et `/units/split` : même cascade, aucun de ces handlers ne mentionne les tokens
- [ ] L'undo Mode A restitue les unités **et** les liens d'alignement (migration 035, ALI-03) mais jamais les tokens — le mot n'apparaît ni dans `undo.py` ni dans `action_history.py` : trancher entre photographier les tokens et avertir avant l'action
- [ ] Une correction manuelle de token (`/tokens/update`, `tokens_service.py:129`) n'est marquée nulle part : elle est indistinguable d'un token machine, donc une réannotation l'écrase en silence
- [ ] Décider comment distinguer un token corrigé à la main (colonne dédiée ? champ `misc` ?) — c'est le préalable à tout avertissement, et la réponse conditionne les deux items précédents
- [ ] Vérifier si le bandeau « ⟳ texte modifié — à réannoter » doit continuer d'inviter à réannoter sans réserve, puisque le geste qu'il propose détruit les corrections manuelles du document
- [ ] Corriger l'**affichage faux** que produit ce signal amnésique — trouvé le 27 août en passe de QA, et aggravé le même jour par la vérification. Le signal ne vit que dans un `Set` du front (`AnnotationPane._staleAnnot`), vidé à chaque chargement de document (`AnnotationPane.ts:183` et `:209`). Après un rechargement, la pastille disparaît **et la surcouche se repeint** : l'écran affiche alors le texte reconstruit depuis des tokens périmés, c'est-à-dire **un texte qui n'est plus en base**. Vérifié sur la n° 11 de `Lodge-Small_ES.docx` — la base porte « ni cada tapón **unas** cadenilla », les tokens rendent « **una** » ; seul le stylo ✎, qui lit `text_norm`, montre le texte réel. Ce n'est donc pas un avertissement perdu, c'est un écran qui ment. **Deux unités** du corpus sont dans ce cas aujourd'hui — n° 11 du document 387, et n° 3 du document 416 où une virgule et un tiret ont disparu — sur 3696 annotées ; la mesure ignore les espaces, donc les 1348 écarts d'espacement ci-dessus n'y sont pas comptés : ce sont bien des divergences de **mots**. Le défaut est rare mais il grandit d'une unité à chaque correction au stylo sur un document annoté. Rien en base ne permet de détecter l'état — `tokens` n'a ni date ni run parmi ses dix colonnes, et `units.text_source` n'est pas alimenté par ce chemin (document 387 : **11 actions `update_text`**, **0 unité** au `text_source` renseigné) ; le comparer à la date d'annotation est impossible, elle n'est enregistrée nulle part. **Piste immédiate, sans migration ni contrat** : au chargement, comparer les mots des tokens au `text_norm` courant, espaces exclus — c'est exactement la mesure ci-dessus, et elle tient en une requête. Conséquence de bord sur RICH-01 : la stylisation, refusée sur une ligne repeinte, redevient possible tant que la session sait la ligne périmée, puis impossible après un rechargement
- [ ] Ouvrir le **grain** de l'annotation — question posée le 27 août : peut-on réannoter une seule ligne ? Non. `/annotate` accepte `doc_id` **ou** `all_docs`, rien entre les deux (`sidecar.py:3998`), et le front n'envoie jamais que `{kind: "annotate", params: {doc_id}}` (`AnnotationPane.ts:304`). Réparer une ligne oblige donc à tout refaire, et la phase d'écriture supprime les tokens du document entier avant de réinsérer (`annotator.py:211`) : **20 636 tokens** détruits et réécrits pour une ligne sur `Lodge-Small_ES.docx` — avec eux toute correction manuelle, que rien ne distingue ni ne trace (les huit types d'action de l'historique n'en comptent aucun qui touche aux tokens). **Rien dans le modèle ne l'impose** : l'inférence est déjà unité par unité (`annotator.py:152`), aucun état ne traverse les unités, les phrases sont numérotées à l'intérieur de chacune. Coût tracé jusqu'aux artefacts : moteur = un filtre `unit_ids` à la lecture et un `DELETE` borné aux mêmes identifiants ; contrat = **zéro artefact** par `/jobs/enqueue`, le chemin qu'emprunte déjà le front (`params` y est `additionalProperties: True`), mais openapi + snapshot si l'on ouvre aussi `/annotate` en direct, dont `AnnotateRequest` énumère ses trois propriétés sous `additionalProperties: False` ; plus le bloc de validation du job (`sidecar.py:1598`)
- [ ] Décider **où** poser le geste fin, une fois le grain ouvert : « annoter la sélection » — le modèle de sélection existe dans `CanvasUnitList`, mais `AnnotationPane` ne branche pas `onSelectionChange`, la couche ignore aujourd'hui la sélection — ou **« réannoter cette ligne » sur la pastille ⟳ elle-même**, à l'endroit exact où le besoin se constate. La seconde piste referme la boucle avec les deux items ci-dessus : aujourd'hui le signal invite à un geste sans commune mesure avec ce qu'il signale

## QA

Aucune passe : la perte ne se voit pas à l'écran, elle se constate en base. Une passe
n'aurait de sens qu'une fois l'avertissement écrit — c'est lui qui serait vérifiable.

## Contexte

**Ce qui existe.** Le seul `DELETE FROM tokens` du dépôt est à `annotator.py:212`, à
l'intérieur d'une passe d'annotation : elle supprime tous les tokens du document avant de
réinsérer. Aucune route ne retire l'annotation — `_WRITE_PATHS` (`sidecar.py:643`) ne
connaît que `/annotate` et `/tokens/update` de ce côté. À l'écran, la couche Annotation
n'a qu'une action, « Annoter ▶ », plus la recherche, le mode prose/étendu et l'éditeur de
token. Rien de destructif, donc rien qui prévienne.

**Le vrai défaut n'est pas la capacité manquante.** `tokens.unit_id` est déclaré
`ON DELETE CASCADE` et `PRAGMA foreign_keys=ON` : toute suppression d'unité emporte ses
tokens. Trois gestes le font — supprimer le document (légitime), resegmenter, fusionner
ou couper des unités. Le resegment **archive** les liens d'alignement pour pouvoir les
rendre et **photographie** les unités pour l'undo ; les tokens, eux, disparaissent sans
trace. Après un resegment puis « annuler », le texte revient, les alignements reviennent,
et le document est silencieusement redevenu non annoté. L'undo tient sa promesse sur deux
couches sur trois sans dire laquelle il abandonne.

**Ce que ça coûte, mesuré.** Réannotation chronométrée sur une *copie* de
`corpus_agrafes.WORKCOPY.db` (jamais l'originale), modèle `fr_core_news_sm` :

- `Modiano-Rue_FR.docx` — 1 913 unités, 21 675 tokens : **26,0 s**, dont ~14 s de
  chargement du modèle ; **11,6 s** à modèle déjà chaud.
- `Lodge-Small_FR.docx` — 1 352 unités, 21 868 tokens : **9,7 s**.
- Le corpus français entier fait 18 documents et 18 733 unités, soit deux à trois minutes.

**D'où la coupure à faire.** Une annotation *automatique* perdue se refait en une dizaine
de secondes : c'est un ennui, pas un accident. Une correction *manuelle* de token, elle,
est irrécupérable — et pire, invisible : rien ne la distingue d'un token machine, donc ni
l'outil ni l'utilisateur ne peuvent savoir qu'il y en avait. C'est cette asymétrie qui
doit décider du remède : photographier les tokens dans l'undo coûte cher pour protéger
quelque chose qui se recalcule, alors qu'un simple marqueur de provenance protégerait ce
qui ne se recalcule pas.

Le chantier R5 porte la construction de la couche annotation (R5.2, éditeur de token
R5.2d) ; ANN-01 ne porte que son cycle de vie — ce qui l'efface et ce qui devrait le dire.

Pas de champ `audit:` : aucun audit ne porte ce chantier, les mesures ci-dessus et les
références au code en sont la seule source.
