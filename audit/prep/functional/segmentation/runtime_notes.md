# Actions > Segmentation — runtime_notes

## Contexte de test

- Audit statique complet des flux Segmentation/Validation/Navigation.
- Probe backend exécuté avec sidecar API 1.4.6 (corpus démo + corpus vide).

## États couverts

- Sidecar off:
  - bannière erreur, actions principales indisponibles.
- Sidecar on + corpus avec données:
  - job `segment` validé,
  - `documents/update(workflow_status=validated)` validé,
  - preview VO validée via `/documents/preview`.
- Sidecar on + corpus vide:
  - `GET /documents` retourne 0 doc, UI prévue pour état vide.
  - appels segment/align potentiels produisent des résultats vides côté backend (pas de crash observé en probe API).
- Erreur / absence sélection:
  - `_runSegment` bloque avec message explicite sans doc sélectionné.

## Densité / longtext

- Le corpus démo est court; le scénario document dense (>12k chars) n’a pas été validé en run réel.
- Le mode longtext reste branché en UI, mais l’activation auto du hint dépend d’un `char_count` backend non garanti.

## Non validable dans cet état

- E2E UI strict (clics Tauri + rendu complet en shell).
- Validation empirique du comportement "sélection active" et séparateurs avancés (non implémentés).
