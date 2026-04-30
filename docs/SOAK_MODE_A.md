# Soak Mode A undo — protocole

## Pourquoi

[Mode A undo](../CHANGELOG.md) (annulation immédiate des 4 actions destructives
de prep) vient d'être livré. Avant d'engager Mode B (rollback historique
étendu), on mesure 2 semaines l'usage réel pour décider sur données plutôt
que sur intuition.

## Période

**2026-04-30 → 2026-05-14 (14 jours).** Si le signal est ambigu à terme, on
prolonge d'une semaine et on relance.

## Événements suivis

Trois events télémétrie locaux (NDJSON `<db_dir>/.agrafes_telemetry.ndjson`) :

| Event | Émis quand | Lecture |
|-------|------------|---------|
| `prep_undo_eligible_view` | Le bouton « ↶ Annuler » se rend visible et activé. | « Mode A était disponible » |
| `prep_undo_unavailable_view` | Le bouton se rend grisé avec une raison. | « L'utilisateur a regardé un bouton bloqué » |
| `stage_returned` (filtré sur `from_stage='undo'`) | Clic effectif sur le bouton. | « Mode A a été utilisé » |

Anti-bruit : les deux premiers events sont émis **uniquement sur transition
matérielle de l'état du bouton** (changement d'`action_id` côté éligible,
changement de `reason` côté indisponible). Pas d'inflation par re-render.

## Comment lire le rapport

Lance le script local quand le rappel arrive :

```bash
python scripts/analyze_undo_soak.py --db-dir=<chemin_du_dossier_DB>
```

Par défaut : fenêtre = 14 derniers jours (clampée à 2026-04-30 minimum,
date de livraison Mode A). Surcharge avec `--since` / `--until` si besoin
(format `YYYY-MM-DD`).

Sortie attendue :

```
=== Mode A soak report ===
Période : 2026-04-30 → 2026-05-14 (15 jours)
NDJSON  : /path/to/.agrafes_telemetry.ndjson (12345 lignes, 0 malformées
          ignorées, 87 events dans la fenêtre)

— Événements undo —
prep_undo_eligible_view    : 42 occurrences (par screen : curation 28, segmentation 14)
prep_undo_unavailable_view : 9 occurrences (par reason : no_action 7, structural_dependency 2)
stage_returned (undo)      : 11 occurrences (par action_type : curation_apply 6, merge_units 3, …)

— Distribution undo / éligibilité —
Ratio click / eligible_view : 26.2% (stage_returned ÷ eligible_view, indicateur « voulu / disponible »)
Frustration apparente       : 9 events unavailable_view (utilisateur regardant un bouton grisé)

— Recommandation —
Mode A est utilisé. Envisager Mode B si une demande explicite de rollback historique apparaît, sinon continuer à observer.
```

## Arbre de décision

Le script applique automatiquement les seuils suivants (modifiables en tête
de [scripts/analyze_undo_soak.py](../scripts/analyze_undo_soak.py)) :

1. **« Mode A est utilisé »** — `clicks ≥ 5` ET `eligible_view ≥ 20`.
   → Continuer à observer. Mode B se justifie *seulement* si une demande
   explicite (utilisateur, friction réelle) apparaît, pas par déduction.
2. **« Mode A peu utilisé »** — `clicks < 2` ET soak ≥ 14 jours.
   → Mode B prématuré. Attendre un signal explicite avant d'investir.
3. **« Frustration détectée »** — `unavailable_view > 5` ET `unavailable > clicks`.
   → Examiner les `reason` dominantes. `no_action` est neutre (juste « rien
   à annuler maintenant »). `structural_dependency` ou `unit_diverged`
   indiquent un besoin frustré qui justifie d'élargir le périmètre Mode A
   ou d'engager Mode B.
4. **Signal ambigu** — entre les deux.
   → Prolonger d'une semaine et relancer le rapport.

## Si signal ambigu après prolongation

Le soak n'est pas un oracle. Si après 21 jours on est toujours dans le cas
4, accepter de décider sur intuition + cas vécus (« je me souviens d'avoir
voulu undo X et n'avoir pas pu »). L'instrumentation n'est qu'une aide ;
le jugement reste à toi.
