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
- [x] Aucune erreur dans la console de l'inspecteur pendant ces recherches

### La virgule et les parenthèses (correctif du 2026-08-21)

Le point le plus important de la passe : **47,9 % des lignes du corpus portent une
virgule**. Coller une ligne du concordancier échouait donc une fois sur deux.

- [x] `bonjour, le monde` ne fait pas tomber la recherche
- [x] Une ligne du corpus **contenant une virgule**, copiée-collée entière, se retrouve
- [x] `18,5` ne fait pas tomber la recherche
- [x] Une parenthèse en pleine phrase (`le chat (noir) dort`) ne fait pas tomber la recherche
- [x] Une parenthèse orpheline — saisir `trois)` seul — non plus
      *(l'item disait « (`trois)`) », dont le rendu colle un `(` au début : la saisie
      copiée devenait `(trois))`. Reformulé le 2026-08-21.)*

### La recherche grammaticale — boîtes « mot » et « lemme »

Trouvé en jouant la passe, le 2026-08-21 : les prédicats CQL sont des expressions
régulières côté moteur, et la boîte y injectait la saisie telle quelle. L'écran ne
promet qu'un wildcard `.*` ; c'est désormais exactement ce qu'il tient, le reste
étant pris au pied de la lettre. **À jouer en mode « mot ».**

- [x] `trois)` ne fait plus tomber la recherche — et trouve le token s'il existe
- [x] `(`, `?`, `[`, `*` seuls non plus
- [x] `habit.*` trouve *habitants*, *habitude*, *habiter*… — le wildcard documenté survit
      *(l'item disait « `liber.*` trouve *liberté*, *libre* » : faux deux fois — « libre »
      ne commence pas par « liber », et le corpus annoté ne porte qu'un seul token en
      liber-, `libertad`. Le constat coché reste valable, seul l'exemple était mauvais.
      Corrigé le 2026-08-21 sur mesure en base.)*
- [x] `chat|chien` cherche désormais la chaîne littérale, plus une alternance
- [x] En mode **CQL** (sélecteur de mode), saisir `[word="trois)"]` : le message parle
      de la requête, pas d'un `Invalid regex in predicate '…' at position 5`
- [x] Toujours en mode CQL, `[mot="chat"]` — la faute la plus probable en français —
      nomme les six attributs acceptés

**Un piège de lecture, mesuré le 2026-08-21** : seuls **6 documents sur 54** sont
annotés — Asimov-Foundation_FR, Lodge-Nice_FR, Lodge-Small_ES, Hagena_Apfel_AL,
9-CI-OrEn-Obs-2022, Beigbeder-Francs_FR. La recherche grammaticale ne peut atteindre
qu'eux, soit 11 % du corpus. Or le filtre de documents les liste **tous**, sans
distinction, alors que `/documents` renvoie déjà `token_count` et `annotation_status`.
Un résultat vide ne dit donc pas « ce mot est absent du corpus » : il dit peut-être
« ce document n'est pas annoté ».

*(Ces deux points décrivaient le défaut ; ils décrivent maintenant le correctif —
`603e158`.)*

- [x] Dans le filtre de documents, `Rankin-Naming_FR.docx` porte « — non annoté » et
      n'est **pas** sélectionnable ; `Asimov-Foundation_FR.docx` porte son nombre de
      tokens (24902)
- [x] Une ligne sous les filtres annonce la portée : « … ne porte que sur les documents
      annotés : 6 sur 54 »
- [x] Le filtre de langue grise `ro` — seule langue du corpus sans aucun token annoté
      *(l'item disait « ro, de… » : `de` n'existe pas dans ce corpus. Les cinq langues
      présentes sont fr, es, al, en, ro, et seule `ro` est à zéro token. Corrigé le
      2026-08-21 sur mesure en base.)*
- [x] Croiser une portée vide — document `Lodge-Small_ES.docx` **et** langue `fr` —
      donne « Aucun document annoté dans cette sélection » au lieu d'un écran vide

### Le mode NEAR du constructeur de requête

**Où :** écran **Explorer** (le concordancier), pas Recherche grammaticale. Bouton
**« ✏ Requête »** dans la barre d'outils pour déplier le constructeur, puis le bouton
radio **NEAR**. Un champ **`N =`** apparaît alors à côté (nombre, 1 à 50, défaut 5).

*(L'item disait « sélecteur de mode sur proximité » : ce libellé n'existe nulle part
dans l'interface, qui affiche `NEAR`. Corrigé le 2026-08-21.)*

Le constructeur fabrique `NEAR(<tes mots>, N)` à partir de ta saisie sans l'assainir,
et c'est l'assainisseur du moteur qui rattrape. Le piège réel était la **virgule** —
mesuré le 2026-08-21 en rejouant l'ancien assainisseur (`1675310^`) sur le corpus :

| saisie | avant | après |
|---|---|---|
| `peut-être bien` | 3 lignes | 3 lignes |
| `l'homme femme` | 10 lignes | 10 lignes |
| `dit, puis` | **`fts5: syntax error near ","`** | 7 lignes |

*(L'intro disait « il tombait sur deux des mots français les plus courants » : faux, le
trait d'union et l'apostrophe passaient déjà. Corrigé le 2026-08-21.)*

- [x] `dit, puis` en NEAR rend des lignes — c'est le cas qui plantait
- [x] `peut-être bien` en NEAR rend des lignes (non-régression du trait d'union)
- [x] `qu'il dit` en NEAR rend des lignes (non-régression de l'apostrophe)
- [x] Le champ `N =` agit sur le nombre de résultats : `peut-être bien` passe de 3 à 11
      lignes entre `N = 5` et `N = 20`
- [x] Un seul mot en NEAR affiche « NEAR requiert au moins 2 mots » et cherche quand même
- [x] Les modes **ET** / **OU** / **Expression exacte** se comportent comme avant

### La ponctuation ASCII, une par une

- [x] `peut - être` trouve des lignes
- [x] `dit-il` — la forme **correcte** — trouve le texte fautif `dit - il` du corpus
- [x] `l'homme` (apostrophe droite) ne fait pas tomber la recherche
- [x] `18:30` ne fait pas tomber la recherche
- [x] Une ligne copiée-collée du concordancier, avec sa ponctuation finale, se retrouve

### Les écritures non latines

**Aucun import n'est nécessaire pour cette section** : le critère est l'absence
d'erreur, pas la présence de résultats. Il suffit de taper dans le champ de recherche —
zéro résultat est un succès.

**Deux familles à distinguer**, mesurées le 2026-08-21 : la ponctuation *propre* à
chaque écriture (`،` `؟` `，` `。` `、` `—` `־` `’`) ressort **intacte** du sanitiseur,
alors que la ponctuation **ASCII** glissée dans un mot non latin est mise entre
guillemets. C'est le partage voulu — l'ASCII seul est ambigu pour FTS5.

*Ponctuation propre à l'écriture — la requête doit sortir intacte :*

- [x] Arabe, virgule arabe `،` : `مرحبا، بالعالم`
- [x] Arabe, point d'interrogation `؟` : `كيف حالك؟`
- [x] Chinois, `，。` : `你好，世界。` (zéro résultat attendu, cf. piège 2)
- [x] Japonais, `、。` : `こんにちは、世界。` (idem)
- [x] Grec sans ponctuation : `καλημέρα κόσμε`
- [x] Cyrillique avec tiret cadratin : `здравствуй — мир`
- [x] Hébreu avec maqaf : `בת־שבע` — le maqaf n'est pas un trait d'union ASCII
- [x] L'apostrophe **courbe** : `l’homme` — seul item de la section à devoir rendre des
      résultats (72 lignes mesurées), le corpus en contient

*Ponctuation ASCII dans une écriture non latine — la requête est mise entre guillemets,
et ne doit pas tomber :*

- [x] Grec + **virgule ASCII** : `κόσμε, φίλε` — c'est ce cas précis qui a révélé le
      trou du 2026-08-21
- [x] Grec + **point-virgule ASCII** (l'érotimatiko grec) : `Τι κάνεις;`
- [x] Cyrillique + virgule ASCII : `Привет, мир`
- [x] Hébreu + virgule ASCII : `שלום, עולם`
- [x] Arabe entre **parenthèses ASCII** : `(مرحبا)`

### Le surlignage

- [x] Sur `Mi - ar face plăcere.`, le tiret isolé n'est **pas** surligné comme un résultat
- [x] Les mots de la requête, eux, sont bien surlignés
- [x] `dit-il` surligne quelque chose dans les lignes trouvées (un résultat sans surlignage se lit comme un faux positif)
- [x] En mode KWIC, la fenêtre est centrée sur une occurrence réelle

Un défaut antérieur corrigé le 2026-08-21 : les **opérateurs** étaient surlignés comme
des termes. Invisible en français, criant sur un document anglais.

*(Les trois exemples ont été refaits le 2026-08-21 sur mesure en base : `chat AND chien`
rendait **zéro** ligne — `chat` sort 51 lignes et `chien` 13, mais aucune ne porte les
deux. L'item était donc injouable tel quel.)*

- [x] `man AND woman` — deux « and » dans la ligne, aucun surligné, les deux termes
      marqués : `" He wasn't a **woman**, in the first place, and in the second place he
      was hardly a **man**.` (Vargas-Pars_EN)
- [x] `NEAR(live Jardin, 5)` ne surligne pas le mot « near » du texte :
      `I **live** near the **Jardin** des Plantes, what would I want with a Toyota…`
      (Houellebecq-Plateforme_EN)
- [x] `NEAR(cretin like, 2)` ne surligne pas le **chiffre de la distance** :
      `It's about 2,000 years since a **cretin** **like** me…` — le « 2 » reste nu
      (Beigbeder-Francs_EN)
- [x] Une recherche sur le **mot** `or` (minuscules) surligne bien les « or » —
      l'opérateur ne se reconnaît qu'en capitales : `**Or** il s'était lui - même…` et
      `un briquet en **or**` (Simenon-Vacances_FR)

### Le pivot KWIC et les accents (contrats 1.6.74 et 1.6.75)

**Zone neuve, jamais jouée.** Le pivot — la colonne centrale du mode KWIC — cherchait la
requête comme une chaîne littérale, alors que le moteur apparie des tokens repliés. Deux
correctifs successifs. Nécessite le sidecar reconstruit **après le 2026-08-21 16:34**.

Mesuré avant correctif, sur 25 à 40 lignes trouvées par requête : `dit-il` 25 pivots vides
sur 25, `libér*` 26/40, `etre` 39/40, `annee` 40/40, `francais` 36/36.

- [x] En mode **KWIC**, `dit-il` centre sur `dit - il` — la locution entière, pas son
      premier mot, et le contexte droit reprend **après** elle
- [x] `etre` sans accent centre sur `être` — l'index replie les diacritiques, le pivot
      doit suivre
- [x] `annee`, `francais`, `deja` de même
- [x] `liber.*` centre sur `libération` — la troncature de locution garde son préfixe
- [x] `"liber*"` (étoile **dans** les guillemets) ne rend **rien** : le tokeniseur la
      laisse tomber, donc FTS cherche le token exact `liber`. Une ligne qui sortirait ici
      avec un pivot sur « liberal » serait un pivot **faux**, pire qu'un pivot vide
- [x] En mode Segment, `etre` surligne `être` — le même trou existait là
- [x] Chercher `homme` en **KWIC** et filtrer sur le document
      `Asimov-Foundation_FR.docx` : **un seul** résultat, et c'est une ligne de
      concordance normale — mesuré, 63 caractères à gauche, pivot « homme »,
      43 à droite. Ce document est stocké en **une seule unité de 110 786 caractères**,
      donc c'est le pire cas du corpus : si la fenêtre tient ici, elle tient partout
- [x] La même recherche en mode **Segment** rend, elle, les 110 802 caractères dans une
      seule ligne de résultat. Ce n'est **pas** un défaut de la recherche mais celui de
      la donnée — 12 documents du corpus sont importés en une unité. À connaître pour ne
      pas le consigner comme une régression
      *(Cet item remplace « aucune ligne ne déverse un pavé dans la colonne gauche »,
      qui n'était pas jouable : ce repli ne se déclenche que si le moteur trouve une
      ligne que le pivot ne retrouve pas, et les trois causes connues — trait d'union
      espacé, diacritiques, troncature — sont corrigées depuis 1.6.75. Vérifié le
      2026-08-21 : le corpus ne porte aucun texte décomposé, et aucune requête essayée
      ne laisse un pivot vide. Le repli reste borné, mais c'est désormais une garde de
      non-régression, pas une chose qui s'observe à l'écran.)*
- [x] Mode **Expression exacte** du constructeur + KWIC : coller une phrase entière du
      corpus. Le pivot fera une centaine de caractères et doit **se couper sur plusieurs
      lignes** sans pousser les colonnes de contexte hors de l'écran

### La syntaxe de requête, qui doit survivre

**Paramètres :** mode **simple** du constructeur — dès qu'une requête porte `AND`, `OR`,
`NOT`, `NEAR` ou des guillemets, le constructeur la détecte et la passe **telle quelle**
au moteur, sans la transformer. Inutile donc de choisir un autre mode ; en choisir un
affiche seulement l'avertissement « Requête FTS détectée — transformation annulée ».

**Le nombre de résultats fait partie du critère.** Une syntaxe cassée rend zéro elle
aussi : un item qui ne sort rien ne prouve rien. Les comptes ci-dessous ont été mesurés
sur le corpus de travail le 2026-08-21.

*(Les exemples ont été refaits : `chat AND chien`, `NEAR(chat chien, 3)` et
`(chat OR chien) AND noir` rendaient **zéro** ligne, et `"phrase exacte"` aussi. Les deux
premiers items restent cochés, mais leur exemple est désormais plus exigeant que celui
qui a été validé — à rejouer si tu veux que la coche porte sur le nouveau.)*

- [x] `"il y a"` entre guillemets — **219 lignes**
- [x] La troncature `libér*` — **58 lignes**
- [x] `NEAR(homme monde, 10)` — **3 lignes** ; sa virgule est bien de la syntaxe
- [x] `(homme OR femme) AND monde` — **13 lignes**, donc **plus** que `homme AND monde`
      qui en donne 9 : les parenthèses ont bien élargi la requête, elles n'ont pas été
      prises pour de la prose
- [x] `homme AND monde` 9 lignes, `homme OR femme` 450, `homme NOT femme` 248 — les
      trois booléens répondent, et `NOT` retranche bien (248 < 450)

### Les refus, qui ne doivent plus être des pannes

- [x] Une requête volontairement fautive — `NEAR()` — affiche un message lisible, pas un
      écran cassé. Le moteur rend `fts5: syntax error near ")"`, que le sidecar habille
      en **« Requête de recherche invalide : … »** avec un code 400
- [x] Ce message parle de la **requête**, pas d'une erreur interne
- [x] La console de l'inspecteur ne montre **pas** de pile d'appel Python pour ce cas
- [x] `NEAR(a (b), 3)` — parenthèse imbriquée, l'autre syntaxe irrattrapable — donne le
      même refus lisible
- [x] Une requête faite uniquement de ponctuation (`---`) rend **zéro résultat sans
      erreur** : elle est assainie, pas refusée. Un guillemet solitaire (`"`) de même

### Ce qui n'est pas couvert par ces correctifs

La recherche par **token** (`/token_query`) n'utilise pas FTS5 : ni l'assainissement de
la ponctuation, ni le repliement des diacritiques ne s'y appliquent. `token_query.py`
n'importe **rien** de `query.py` — vérifié. Ce qui suit se joue dans **Recherche
grammaticale**, mode CQL, et ne doit **pas** être aligné sur le plein texte : la
divergence est voulue, et ces items la verrouillent.

*(L'item disait « vérifier qu'elle se comporte comme avant », sans dire par rapport à
quoi ni comment. Refait sur mesure le 2026-08-21.)*

- [x] `[word="homme"]` rend **7** hits, `[lemma="être"]` **984**, `[upos="VERB"]`
      **9071** — la recherche grammaticale répond toujours
- [x] `[lemma="homme"][upos="ADJ"]` rend **2** hits : une séquence de deux tokens
      fonctionne, pas seulement un prédicat isolé
- [x] `[word="habit.*"]` rend **36** hits — le wildcard des prédicats est intact
- [x] **La divergence voulue, à ne surtout pas « corriger »** : `[word="etre"]` rend
      **0** hit, alors que `etre` en plein texte en rend **509**. Le repliement des
      diacritiques est propre à l'index FTS ; `[word="être"]` rend, lui, **111** hits
- [x] Même chose pour la ponctuation : `[word="dit-il"]` rend **0** hit, quand `dit-il`
      en plein texte en rend **142**. Un prédicat CQL est une expression régulière sur
      **un** token, et aucun token ne vaut littéralement « dit-il »
- [x] Chaque requête répond en moins d'une seconde (mesuré ~0,6 s). Avant le correctif
      de performance, `/token_query` prenait 95 s et 11 Go
- [x] Les statistiques lexicales comptent toujours `est` et `ce` séparément sur le corpus GRAFE — c'est le défaut de donnée, pas la recherche
