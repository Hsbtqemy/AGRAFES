---
passe: Recherche — ponctuation et écritures
chantier: —
duree: 12 min
derniere: 2026-08-20
---

# QA — le concordancier face à la ponctuation

Passe **transversale** : elle porte sur une capacité, la recherche, et non sur un
chantier. Écrite après le correctif du 2026-08-20 (contrat **1.6.72**), qui a fait suite
à une recherche tombée en 500 dans l'interface — `Mi - ar face plăcere.`

**Ce que le correctif fait, et ce qu'il ne fait pas.** FTS5 recevait la saisie brute, et
une partie de la ponctuation y est de la syntaxe : le trait d'union était lu comme un
filtre de colonne. Les mots contenant de la ponctuation **ASCII** sont désormais mis
entre guillemets avant d'atteindre le moteur. Mesuré : sept caractères cassaient
(`' - : . + & /`), et **tous** les scripts non latins passaient déjà — c'est ce que
cette passe doit confirmer à l'œil, parce qu'une règle qui se mettrait à toucher au
non-ASCII abîmerait des écritures entières sans qu'aucun test unitaire ne s'en plaigne.

**Contexte d'exécution.** Shell dev avec le sidecar reconstruit le 2026-08-20 à 19h.
Contrat live attendu **1.6.72**. Base : une WORKCOPY. Le corpus de travail contient du
français, de l'anglais, de l'espagnol, du roumain et de l'albanais — pour les autres
écritures, un import d'essai suffit.

**Un piège à connaître avant de conclure.** Le corpus GRAFE porte des traits d'union
**espacés** (`dit - il` au lieu de `dit-il`) sur 48 documents — un défaut de la source,
pas de l'outil (`docs/REVIEW_CORPUS_TIRETS_2026-08-20.md`). Une recherche qui rend un
résultat inattendu peut donc venir de la donnée, pas de la requête.

### La requête qui a tout déclenché

- [ ] `Mi - ar face plăcere.` rend des résultats au lieu d'une erreur
- [ ] Le panneau de facettes se remplit lui aussi (compteurs, top docs) — pas seulement la liste
- [ ] Aucune erreur dans la console de l'inspecteur pendant ces recherches

### La ponctuation ASCII, une par une

- [ ] `peut - être` trouve des lignes
- [ ] `dit-il` — la forme **correcte** — trouve le texte fautif `dit - il` du corpus
- [ ] `l'homme` (apostrophe droite) ne fait pas tomber la recherche
- [ ] `18:30` ne fait pas tomber la recherche
- [ ] Une ligne copiée-collée du concordancier, avec sa ponctuation finale, se retrouve

### Les écritures non latines

- [ ] Une recherche en arabe rend des résultats (ou zéro, mais **pas** une erreur)
- [ ] Idem en chinois, ponctuation `，。` comprise
- [ ] Idem en grec, en cyrillique, en hébreu
- [ ] Un mot hébreu avec maqaf (`בת־שבע`) ne déclenche pas d'erreur — le maqaf n'est pas un trait d'union ASCII
- [ ] L'apostrophe **courbe** (`l’homme`) se comporte comme avant le correctif

### Le surlignage

- [ ] Sur `Mi - ar face plăcere.`, le tiret isolé n'est **pas** surligné comme un résultat
- [ ] Les mots de la requête, eux, sont bien surlignés
- [ ] `dit-il` surligne quelque chose dans les lignes trouvées (un résultat sans surlignage se lit comme un faux positif)
- [ ] En mode KWIC, la fenêtre est centrée sur une occurrence réelle

### La syntaxe de requête, qui doit survivre

- [ ] `"phrase exacte"` entre guillemets fonctionne toujours
- [ ] La troncature `mot*` fonctionne toujours
- [ ] `NEAR(chat chien, 3)` fonctionne toujours
- [ ] `chat AND chien`, `chat OR chien`, `NOT` fonctionnent toujours

### Les refus, qui ne doivent plus être des pannes

- [ ] Une requête volontairement fautive — `NEAR()` — affiche un message lisible, pas un écran cassé
- [ ] Ce message parle de la **requête**, pas d'une erreur interne
- [ ] La console de l'inspecteur ne montre **pas** de pile d'appel Python pour ce cas
- [ ] Une requête faite uniquement de ponctuation (`---`) rend zéro résultat sans erreur

### Ce qui n'est pas couvert par ce correctif

- [ ] La recherche par **token** (`/token_query`) n'utilise pas FTS5 : vérifier qu'elle se comporte comme avant
- [ ] Les statistiques lexicales comptent toujours `est` et `ce` séparément sur le corpus GRAFE — c'est le défaut de donnée, pas la recherche
