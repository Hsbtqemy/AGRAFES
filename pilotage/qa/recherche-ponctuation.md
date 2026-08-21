---
passe: Recherche — ponctuation et écritures
chantier: —
duree: 15 min
derniere: 2026-08-21
---

# QA — le concordancier face à la ponctuation

Passe **transversale** : elle porte sur une capacité, la recherche, et non sur un
chantier. Écrite après le correctif du 2026-08-20, complétée après celui du
2026-08-21 qui a bouché un trou du premier.

**Ce que les correctifs font.** FTS5 recevait la saisie brute, et une partie de la
ponctuation y est de la syntaxe : le trait d'union était lu comme un filtre de colonne.
Les mots contenant de la ponctuation **ASCII** sont désormais mis entre guillemets avant
d'atteindre le moteur, ce qui en fait des phrases — exactement ce que veut quelqu'un qui
colle une ligne du concordancier.

Trois caractères ont demandé une seconde passe, `,` `(` `)`, parce qu'ils appartiennent
à la fois à la syntaxe et à la prose. Deux règles les départagent : une **virgule** n'est
de la syntaxe que dans un `NEAR(...)`, une **parenthèse** ne l'est que si la requête
porte un opérateur en capitales (`AND`/`OR`/`NOT`/`NEAR`).

**Ce qu'ils ne font pas.** Ils ne touchent à rien hors de l'ASCII. Mesuré : **tous** les
scripts non latins passaient déjà, ponctuation non-ASCII comprise. C'est ce que cette
passe doit confirmer à l'œil, parce qu'une règle qui se mettrait à toucher au non-ASCII
abîmerait des écritures entières sans qu'aucun test unitaire ne s'en plaigne.

**Contexte d'exécution.** Shell dev avec un sidecar reconstruit **après le 2026-08-21** —
le binaire du 20 au soir ne porte pas la règle virgule/parenthèses et ferait échouer
toute la deuxième section. Base : une WORKCOPY.

**Deux pièges à connaître avant de conclure.**

1. Le corpus GRAFE porte des traits d'union **espacés** (`dit - il` au lieu de `dit-il`)
   sur 48 documents — un défaut de la source, pas de l'outil
   (`docs/REVIEW_CORPUS_TIRETS_2026-08-20.md`). Un résultat inattendu peut venir de la
   donnée, pas de la requête.
2. Le chinois et le japonais **rendront zéro**, et ce n'est pas un défaut de la
   recherche : l'index utilise `tokenize='unicode61'`, qui ne segmente pas les écritures
   sans espaces. Mesuré : « 你好 » en tête de bloc trouve, « 天气 » au milieu du même bloc
   ne trouve rien. Limite d'indexation antérieure, à ne pas consigner comme régression.

### La requête qui a tout déclenché

- [x] `Mi - ar face plăcere.` rend des résultats au lieu d'une erreur
- [x] Le panneau de facettes se remplit lui aussi (compteurs, top docs) — pas seulement la liste
- [ ] Aucune erreur dans la console de l'inspecteur pendant ces recherches

### La virgule et les parenthèses (correctif du 2026-08-21)

Le point le plus important de la passe : **47,9 % des lignes du corpus portent une
virgule**. Coller une ligne du concordancier échouait donc une fois sur deux.

- [ ] `bonjour, le monde` ne fait pas tomber la recherche
- [ ] Une ligne du corpus **contenant une virgule**, copiée-collée entière, se retrouve
- [ ] `18,5` ne fait pas tomber la recherche
- [ ] Une parenthèse en pleine phrase (`le chat (noir) dort`) ne fait pas tomber la recherche
- [ ] Une parenthèse orpheline (`trois)`) non plus

### Le mode « proximité » du constructeur de requête

Le constructeur fabrique `NEAR(<tes mots>, N)` à partir de ta saisie, sans l'assainir.
Il tombait donc sur deux des mots français les plus courants. À jouer **avec le
sélecteur de mode sur « proximité »**, pas en mode simple.

- [ ] `peut-être bien` en mode proximité rend un résultat ou zéro, mais **pas** une erreur
- [ ] `l'homme libre` en mode proximité non plus
- [ ] `dit, puis` en mode proximité non plus
- [ ] Le curseur de distance (`N`) agit toujours sur le nombre de résultats
- [ ] Les modes **et** / **ou** / **phrase** se comportent comme avant

### La ponctuation ASCII, une par une

- [ ] `peut - être` trouve des lignes
- [ ] `dit-il` — la forme **correcte** — trouve le texte fautif `dit - il` du corpus
- [ ] `l'homme` (apostrophe droite) ne fait pas tomber la recherche
- [ ] `18:30` ne fait pas tomber la recherche
- [ ] Une ligne copiée-collée du concordancier, avec sa ponctuation finale, se retrouve

### Les écritures non latines

**Aucun import n'est nécessaire pour cette section** : le critère est l'absence
d'erreur, pas la présence de résultats. Il suffit de taper dans le champ de recherche —
zéro résultat est un succès.

- [ ] Une recherche en arabe ne déclenche pas d'erreur
- [ ] Idem en chinois, ponctuation `，。` comprise (zéro résultat attendu, cf. piège 2)
- [ ] Idem en grec, en cyrillique, en hébreu
- [ ] Un mot grec suivi d'une **virgule ASCII** (`κόσμε,`) ne déclenche pas d'erreur —
      c'est ce cas précis qui a révélé le trou du 2026-08-21
- [ ] Un mot hébreu avec maqaf (`בת־שבע`) ne déclenche pas d'erreur — le maqaf n'est pas un trait d'union ASCII
- [ ] L'apostrophe **courbe** (`l’homme`) se comporte comme avant le correctif

### Le surlignage

- [ ] Sur `Mi - ar face plăcere.`, le tiret isolé n'est **pas** surligné comme un résultat
- [ ] Les mots de la requête, eux, sont bien surlignés
- [ ] `dit-il` surligne quelque chose dans les lignes trouvées (un résultat sans surlignage se lit comme un faux positif)
- [ ] En mode KWIC, la fenêtre est centrée sur une occurrence réelle

Un défaut antérieur corrigé le 2026-08-21 : les **opérateurs** étaient surlignés comme
des termes. Invisible en français, criant sur un document anglais.

- [ ] `chat AND chien` ne surligne **pas** les « and » du segment (à voir sur un document anglais : `cat AND dog`)
- [ ] `NEAR(chat chien, 3)` ne surligne ni « near » ni le chiffre **3** du texte
- [ ] Une recherche sur le **mot** `or` (minuscules) surligne bien les « or » — l'opérateur ne se reconnaît qu'en capitales

### La syntaxe de requête, qui doit survivre

- [ ] `"phrase exacte"` entre guillemets fonctionne toujours
- [ ] La troncature `mot*` fonctionne toujours
- [ ] `NEAR(chat chien, 3)` fonctionne toujours — sa virgule est bien de la syntaxe
- [ ] `(chat OR chien) AND noir` fonctionne toujours — ses parenthèses aussi
- [ ] `chat AND chien`, `chat OR chien`, `NOT` fonctionnent toujours

### Les refus, qui ne doivent plus être des pannes

- [ ] Une requête volontairement fautive — `NEAR()` — affiche un message lisible, pas un écran cassé
- [ ] Ce message parle de la **requête**, pas d'une erreur interne
- [ ] La console de l'inspecteur ne montre **pas** de pile d'appel Python pour ce cas
- [ ] Une requête faite uniquement de ponctuation (`---`) rend zéro résultat sans erreur

### Ce qui n'est pas couvert par ces correctifs

- [ ] La recherche par **token** (`/token_query`) n'utilise pas FTS5 : vérifier qu'elle se comporte comme avant
- [ ] Les statistiques lexicales comptent toujours `est` et `ce` séparément sur le corpus GRAFE — c'est le défaut de donnée, pas la recherche
