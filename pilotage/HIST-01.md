---
chantier: HIST-01
statut: à venir
---

# HIST-01 — 278 actions enregistrées, aucune consultable

**Point de départ** — question posée le 25 août 2026 : « le journal des actions est accessible
quelque part ? » Non. La table existe et se remplit depuis mai ; rien ne l'expose.

## Reste

- [ ] Décider s'il faut une **vue de l'historique** dans Prep, et où — aujourd'hui la seule surface est le bouton *Annuler* de Curation et de Segmentation, qui n'annonce que la **prochaine** action annulable (`undo.py:45`, `_latest_undoable_row`, `LIMIT 1`). Rien ne dit ce qui a été fait avant, ni combien d'annulations séparent du texte d'origine
- [ ] Ouvrir l'endpoint de lecture qui manque : aucun ne liste `prep_action_history`, ni côté sidecar (seuls `/prep/undo/eligibility` et `/prep/undo` existent) ni en CLI (seul `runs prune` touche l'autre journal). Coût : c'est une **route neuve**, donc trois artefacts de contrat — `sidecar_contract.py`, `docs/openapi.json` + le snapshot, et `SIDECAR_API_CONTRACT.md`
- [ ] Distinguer les libellés d'action — `update_text` est le deuxième type le plus fréquent (**75 sur 278**) et confond sous « Édition du texte (unité N) » les corrections au stylo et les stylisations, qui n'ont ni le même effet ni le même enjeu. Piste courte : une description distincte. Piste propre : un type d'action à part, qui coûte une migration, `action_type` étant sous contrainte `CHECK` (migrations 019, 032, 033, 034)
- [ ] Trancher l'absence de **rétablir** : `_latest_undoable_row` exclut explicitement les actions de type `undo` (`AND action_type != ACTION_UNDO`), donc une annulation ne s'annule pas. Est-ce voulu ? Les 36 actions `undo` de la base portent pourtant `{"reverted_action_id": …, "reverted_action_type": …}` dans leur `context_json` : la chaîne est traçable, un rétablir serait implémentable
- [ ] Décider si l'historique doit être consultable **au-delà d'un document** : tout est indexé par `doc_id` et l'annulation est par document. Sur 24 documents touchés, deux concentrent l'essentiel (416 : 135 actions ; 423 : 52) — une vue corpus dirait ce qui a été retravaillé, et quand
- [ ] Trancher une politique de **rétention** : rien ne purge `prep_action_history` ni ses snapshots, alors que `runs prune` existe pour le journal de la base. Ce n'est pas urgent — 20 995 snapshots pour environ 2,8 Mo de texte — mais c'est un défaut de décision, pas une décision
- [ ] Vérifier si une vue d'historique change quelque chose au **coût de lecture** sur un gros document : le document 416 porte 135 actions, et les snapshots d'une seule action de resegmentation peuvent en compter des milliers

## Contexte

Mesuré sur la base de travail le 25 août 2026.

```
prep_action_history : 278 actions, du 7 mai au 25 août 2026, sur 24 documents
  merge_units 106 · update_text 75 · undo 36 · set_paragraph 25
  resegment 13 · split_unit 10 · set_role 8 · curation_apply 5
  36 annulées · 203 portent un context_json
  prep_action_unit_snapshots : 20 995 lignes, ~2,8 Mo de texte « avant »
  par mois : mai 38 · juin 8 · juillet 51 · août 182
```

Les 36 actions sans snapshot sont **exactement** les `undo` : une annulation n'enregistre pas
d'état antérieur, ce qui est cohérent avec le fait qu'elle ne soit pas elle-même annulable.

Ce qui rend le manque frappant, c'est que la donnée est complète : chaque action porte son
type, sa date, son document, sa description, et le texte d'avant de chaque unité touchée.
Un panneau n'aurait rien à calculer — seulement à lire une table que personne n'expose.

La distinction avec l'autre journal vaut d'être tenue : `GET /runs` liste les **runs**
(imports, index, alignements, démarrages du sidecar), pas les actions de préparation. Les
deux répondent à des questions différentes — « qu'est-ce que la machine a exécuté » contre
« qu'est-ce que j'ai fait à ce texte ».
