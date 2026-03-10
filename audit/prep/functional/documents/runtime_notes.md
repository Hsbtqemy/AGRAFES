# Documents — runtime_notes

## Contexte de test

- Vérification statique complète des listeners et transitions d’état.
- Probe runtime sidecar effectué dans deux configurations:
  1. sidecar embarqué (API 1.4.1) 
  2. sidecar source `.venv/bin/multicorpus` (API 1.4.6)

## États couverts

- Sidecar off:
  - bannière en erreur (`Sidecar indisponible`).
- Sidecar on + corpus avec données:
  - `GET /documents` OK,
  - `POST /documents/update` OK,
  - `POST /validate-meta` OK,
  - `POST /db/backup` OK,
  - `GET/SET/DELETE /doc_relations` OK.
- Sidecar on + corpus vide:
  - table vide correctement gérée, pas de crash.
- Erreur / absence de sélection:
  - panneau d’édition affiche message vide et bloque actions dépendantes.

## Point bloquant majeur

- Le sidecar embarqué utilisé par `tauri-prep` ne fournit pas `/documents/preview`.
- Résultat: l’aperçu document est non validable/instable selon binaire sidecar réellement lancé.

## Non validable dans cet état

- E2E UI strict (clic utilisateur Tauri) non automatisé ici.
- Validation homogène de l’aperçu sans alignement de version sidecar.
