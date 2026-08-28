---
chantier: FAM-01
statut: à venir
---

# FAM-01 — la relation de famille n'existe qu'une fois, et dans un seul sens

**Point de départ** — deux constats indépendants, remontés le 28 août 2026 par
l'utilisateur en jouant la passe d'import, vérifiés au code et **mesurés sur la base de
travail** (32 relations). Aucune ligne écrite. Le symptôme commun : une relation créée
existe bel et bien, mais l'application se comporte comme si elle n'existait pas — elle ne
la montre pas au parent, et elle redemande ce qu'elle vient d'obtenir.

## Reste

- [ ] **La relation n'est visible que depuis l'enfant.** `doc_relations` est directionnel
      — l'enfant porte `doc_id`, le parent `target_doc_id` (migration 003) — et c'est le
      bon modèle. Mais `doc_relations_service.list_doc_relations` lit
      `WHERE doc_id = ?`, donc **uniquement les arêtes sortantes**, et `MetadataScreen`
      appelle exactement cet endpoint (`getDocRelations`, deux sites : l. 660 et 1515),
      tout comme `SegmentPane` (l. 1048). Mesuré sur la base de travail : pour la relation
      `#367 → translation_of → #368`, l'enfant #367 voit **1** relation, le parent #368 en
      voit **0**, alors qu'un enfant pointe vers lui. Le panneau du parent est donc vide et
      laisse croire qu'aucune famille n'existe. `GET /doc_relations/all` renvoie déjà tout
      et permettrait de reconstruire les deux sens ; aucun écran ne s'en sert pour ça.
      À trancher : élargir la lecture par `doc_id` aux deux sens (et alors distinguer
      entrant/sortant dans la charge utile, ce qui touche le contrat), ou faire lire
      `/doc_relations/all` aux écrans concernés (aucun changement de contrat)
- [ ] **La file de dialogues post-import redemande ce qu'elle vient d'obtenir.** Chaque
      import réussi met un dialogue en file sans condition (`ImportScreen.ts:1322`, seule
      garde : la case « ne plus demander »). Importer un parent et deux enfants ouvre donc
      **trois** dialogues — et si l'on déclare le premier parent de ses deux enfants, les
      deux suivants s'ouvrent quand même, pour des documents dont la relation vient d'être
      créée. Le dialogue rafraîchit pourtant `listDocuments` à chaque ouverture : il a de
      quoi savoir. Remède minimal : avant d'ouvrir, sauter tout document participant déjà
      à une relation, dans un sens ou dans l'autre — ce qui dépend du premier item, la
      lecture par `doc_id` ne voyant aujourd'hui qu'un seul sens
- [ ] **Le bandeau des familles détectées propose un choix sans effet.** Son `<select>`
      « Original : » (`prep-imp-family-pivot-sel`,
      `lib/importFamilyDetectionTemplate.ts:37`) n'existe **que** dans le gabarit : aucun
      gestionnaire, aucune lecture, nulle part dans les fronts. Sa propre note dit que la
      décision se prend « dans la dialog post-import de chaque fichier enfant » — le
      sélecteur invite donc à un choix qui sera ignoré. À retirer, ou à câbler pour qu'il
      pré-remplisse le pivot du dialogue

## Contexte

**Ce qui existe déjà, et qu'il ne faut pas réinventer.** La détection de famille au nom de
fichier vit dans `lib/familyDetect.ts` (partagée par l'import local et ShareDocs, phase P6
de `DESIGN_sharedocs_ingestion.md`) ; le bandeau de proposition dans
`lib/importFamilyDetectionTemplate.ts` ; le dialogue post-import dans `ImportScreen.ts`
(Sprint 8), avec ses deux modes — le nouveau document devient **enfant** d'un existant, ou
**parent** de N existants. Le rattachement à une famille *existante* se fait par ailleurs
depuis `MetadataScreen`.

**Pourquoi ces constats sortent d'IMPO-01.** Ils ont été trouvés en jouant
`qa/import-deduction-mode.md`, mais ne concernent pas la déduction du mode d'import : ils
portent sur les relations entre documents, qui survivront à la fermeture d'IMPO-01. Le
troisième item y a d'abord été consigné le 28 août, puis déplacé ici.

**Ce que la base dit aujourd'hui** : 32 relations, toutes de type `translation_of`.
