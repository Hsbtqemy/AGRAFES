# Backlog UX Prep — "Texte premier"

> Principe directeur : l'utilisateur doit pouvoir lire, modifier et amender le texte
> à n'importe quel moment du workflow, sans que les automatismes le lui cachent ou
> le verrouillent.

## Prêt à implémenter (frontend only)

| ID | Panneau | Amélioration | Effort | Notes |
|----|---------|-------------|--------|-------|
| UX-01 | Curation | Typographie panneau brut — font-size 13→14px, line-height 1.5→1.65 | très faible | CSS pur |
| UX-02 | Curation | Compteur réel avant Apply : "247/3000 unités seront modifiées" | faible | `units_changed` déjà dans réponse `/curate/preview` |
| UX-03 | Curation | Banderole persistante "text_norm a divergé de text_raw" après apply | faible | flag local + style |
| UX-04 | Curation | Pagination des exemples de preview (Suivants →, 50 par page) | moyen | client-side |
| UX-05 | Annotation | Identité document dans le viewer (titre + langue + token count) | faible | |
| UX-06 | Annotation | Toggle lecture / annoter : prose colorée UPOS vs. grille tokens | moyen | |
| UX-07 | Annotation | Sauvegarde batch tokens (draft local + commit groupé) | moyen | |
| UX-08 | Transversal | Persistance sélection inter-panneaux (doc sélectionné en Documents → pré-sélectionné en Segmentation/Annotation) | moyen | touche MetadataScreen, ActionsScreen, SegmentationView, AnnotationView, app.ts |
| UX-09 | Transversal | Navigation clavier ↑↓ dans toutes les listes de documents | faible | |

## Nécessite un endpoint sidecar

| ID | Panneau | Amélioration | Ce qu'il manque |
|----|---------|-------------|-----------------|
| UX-10 | Segmentation / Curation | Édition inline d'une unité (correction text_norm depuis n'importe quel panneau) | `PATCH /units/{id}/text` à créer |
| UX-11 | MetadataScreen | Preview extensible (Voir plus → jusqu'à 500 lignes) | `/documents/preview` accepte déjà `limit` — décision: étendre l'existant ou pas ? |
| UX-12 | Align | Vue côte-à-côte pivot/cible avec diff des spans non alignés | refonte partielle AlignPanel |
| UX-13 | Segmentation | Diff avant re-segmentation (avant/après sur le document déjà segmenté) | `/segment/preview` existe, diff client à construire |
| UX-14 | Import | Preview DOCX/ODT/TXT à l'import (20 premières unités avec text_raw) | `/import/preview` ne supporte que CoNLL-U |

## Questions architecturales ouvertes

Voir discussion en cours — cf. section suivante dans ce fichier.

---

## Architecture — points en discussion

### A. Édition de text_raw
text_raw est verrouillé (l'importer est source de vérité). Accepte-t-on une
"correction manuelle ponctuelle" qui diverge du fichier source ? Si oui : nouvel
endpoint + indicateur visuel permanent dans tous les panneaux ("texte source modifié
manuellement le JJ/MM").

### B. Historique des modifications visible globalement
`apply_history` existe en base (migration 007), exposé uniquement en Curation.
Faut-il un bandeau ou une icône dans tous les panneaux pour signaler qu'un document
a été modifié par curation ?

### C. Navigation inter-panneaux avec contexte
`onNavigate` est câblé partiellement. Objectif : sélectionner une unité en
Segmentation et l'ouvrir directement en Annotation (ou son alignement en Align)
sans perdre le contexte de sélection.

### D. Irréversibilité des actions
Curate apply, segment, merge/split, delete lien : tout est irréversible sans filet.
Options : (a) undo via snapshot DB avant opération, (b) confirmation renforcée avec
preview obligatoire, (c) soft-delete + journal consultable.
