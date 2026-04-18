# Backlog UX Prep — "Texte premier"

> Principe directeur : l'utilisateur doit pouvoir lire, modifier et amender le texte
> à n'importe quel moment du workflow, sans que les automatismes le lui cachent ou
> le verrouillent.
>
> Note architecture : à l'import, le fichier source est lu une seule fois puis
> déconnecté. La base SQLite est la source de vérité — text_raw en base n'est pas
> synchronisé avec le fichier disque. Éditer text_raw en base est donc propre.

## Prêt à implémenter (frontend only)

| ID | Panneau | Amélioration | Effort | Notes |
|----|---------|-------------|--------|-------|
| UX-01 | Curation | Typographie panneau brut — font-size 13→14px, line-height 1.5→1.65 | très faible | CSS pur |
| UX-02 | Curation | Compteur réel avant Apply : "247/3000 unités seront modifiées" — Apply bloqué si aucune preview lancée | faible | `units_changed` déjà dans réponse `/curate/preview` |
| UX-03 | Curation | Banderole persistante "text_norm a divergé de text_raw" + icône sur les unités modifiées | faible | flag local + badge dans preview |
| UX-04 | Curation | Pagination des exemples de preview (Suivants →, 50 par page) | moyen | client-side |
| UX-05 | Annotation | Identité document dans le viewer (titre + langue + token count) | faible | |
| UX-06 | Annotation | Toggle lecture / annoter : prose colorée UPOS vs. grille tokens | moyen | |
| UX-07 | Annotation | Sauvegarde batch tokens (draft local + commit groupé) | moyen | |
| UX-08 | Transversal | Persistance sélection inter-panneaux + navigation inter-panneaux avec contexte (onNavigate étendu) | moyen | MetadataScreen, ActionsScreen, SegmentationView, AnnotationView, app.ts |
| UX-09 | Transversal | Navigation clavier ↑↓ dans toutes les listes de documents | faible | |

## Nécessite un endpoint sidecar

| ID | Panneau | Amélioration | Ce qu'il manque |
|----|---------|-------------|-----------------|
| UX-10 | Tous | Édition inline d'une unité (text_raw + text_norm) depuis n'importe quel panneau | `PATCH /units/{id}/text` à créer — édition text_raw propre car fichier source déconnecté après import |
| UX-11 | MetadataScreen | Preview extensible (Voir plus → jusqu'à 500 lignes) | `/documents/preview` accepte déjà `limit` — décision en suspens |
| UX-12 | Align | Vue côte-à-côte pivot/cible avec diff des spans non alignés | refonte partielle AlignPanel |
| UX-13 | Segmentation | Diff avant re-segmentation (avant/après sur document déjà segmenté) | `/segment/preview` existe, diff client à construire |
| UX-14 | Import | Preview DOCX/ODT/TXT à l'import (20 premières unités avec text_raw) | `/import/preview` ne supporte que CoNLL-U |
| UX-15 | Curation | Icône "modifié par curation" sur les unités dans /documents/preview | flag `curated` à ajouter dans la réponse sidecar |

## Décisions architecturales

### A. Édition de text_raw — DÉCIDÉ : autorisée
Le fichier source est déconnecté après import (pas de synchronisation automatique).
Éditer text_raw en base est propre. Implémentation via UX-10 (PATCH /units/{id}/text).
Message d'avertissement si l'utilisateur tente de ré-importer le même fichier.

### B. Historique global — DÉCIDÉ : icône par unité
`apply_history` exposé en Curation uniquement. Ajouter un flag `curated` dans
`/documents/preview` (sidecar) → icône discrète sur chaque unité modifiée dans
tous les panneaux (UX-15). Pas de bandeau global — trop intrusif.

### C. Navigation inter-panneaux — DÉCIDÉ : étendre onNavigate
Câblage partiel existant. Extension : Segmentation → Annotation du même document/unité,
Align → Segmentation de l'unité concernée. Intégré dans UX-08.

### D. Irréversibilité — DÉCIDÉ : les deux
- Confirmation obligatoire avec preview avant Apply (UX-02 — Apply bloqué sans preview)
- Snapshot DB automatique avant chaque opération destructive (curate apply, segment,
  delete) → bouton "Restaurer la version précédente" dans Curation (et à terme partout).
  SQLite = fichier unique, copie < 100ms, retour arrière complet sans changer le schéma.
  Nouveau endpoint : `POST /db/snapshot` + `POST /db/restore`.
