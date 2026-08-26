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
- [ ] Noter la conséquence de bord initiale, suivie dans RICH-01 : ces 365 unités sont aussi celles où le geste de stylisation est refusé, le garde comparant le texte affiché au texte stocké. Corriger l'espacement débloquerait le geste sur une partie d'entre elles — ce qui n'est pas forcément souhaitable, et doit être décidé avec l'item correspondant de RICH-01
- [ ] Retirer `tokensToPlain` s'il reste sans appelant, ou le rebrancher : il est exporté et testé, mais plus utilisé nulle part depuis que le rendu en prose appelle directement `needsSpaceBefore`
- [ ] Trancher si la capacité « retirer l'annotation » manque vraiment : réannoter remplace déjà tout, et le seul état qu'on ne sait pas retrouver est « non annoté »
- [ ] `/segment` supprime les unités puis les réinsère (`sidecar.py:4951`) : les tokens partent par cascade `ON DELETE CASCADE` (migration 012), sans être photographiés, ni comptés dans la réponse, ni annoncés à l'écran
- [ ] `/units/merge` et `/units/split` : même cascade, aucun de ces handlers ne mentionne les tokens
- [ ] L'undo Mode A restitue les unités **et** les liens d'alignement (migration 035, ALI-03) mais jamais les tokens — le mot n'apparaît ni dans `undo.py` ni dans `action_history.py` : trancher entre photographier les tokens et avertir avant l'action
- [ ] Une correction manuelle de token (`/tokens/update`, `tokens_service.py:129`) n'est marquée nulle part : elle est indistinguable d'un token machine, donc une réannotation l'écrase en silence
- [ ] Décider comment distinguer un token corrigé à la main (colonne dédiée ? champ `misc` ?) — c'est le préalable à tout avertissement, et la réponse conditionne les deux items précédents
- [ ] Vérifier si le bandeau « ⟳ texte modifié — à réannoter » doit continuer d'inviter à réannoter sans réserve, puisque le geste qu'il propose détruit les corrections manuelles du document

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
