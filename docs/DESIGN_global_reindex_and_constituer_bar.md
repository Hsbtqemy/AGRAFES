# Suivi — réindex global + revisite de la barre « Constituer »

> **Statut : à faire, non commencé.** Deux follow-ups **front-only** dégagés en cadrant le Lot E de
> R6.5-B (parité Curation, voir [`DESIGN_R6_5_curation_parity.md`](DESIGN_R6_5_curation_parity.md)).
> **Hors R6.5** — n'appartiennent pas à la curation. Consignés ici pour ne pas les perdre.

## Contexte

En scopant le « tiroir Avancé » (Lot E), on a écarté le **bouton réindex** (#20) de la curation :
réindexer n'est **pas** un geste de curation, c'est **corpus-level**. Ce qui périme l'index FTS
(`text_norm` des unités `unit_type="line"`) :

- **oui** : curation appliquée (`/curate`), segmentation (merge/split/resegment), **stylo**
  (`/units/update_text`), import ;
- **non** : annotation (couche `tokens` séparée, ne touche pas `text_norm`), alignement
  (`alignment_links`).

Donc le réindex devrait être **accessible partout**, avec un état « périmé » qui s'allume dès qu'une
op salit l'index, **quelle que soit la couche** (curation, segmentation, canvas). Aujourd'hui il vit
comme **un bouton par onglet** : `MetadataScreen` (onglet Documents) a `#meta-reindex-btn` +
auto-réindex + indicateur périmé (`.prep-meta-reindex-stale`, `_refreshIndexButton`). Ce n'est pas
global.

## Item 1 — Réindex global + indicateur d'état de l'index

**But.** Un contrôle **réindexer** unique, toujours visible, panel-agnostic, avec un badge « index
périmé » qui reflète l'état réel après n'importe quelle op salissante.

**Piste.** Le loger dans le header **« Constituer »** ([`app.ts`](../tauri-prep/src/app.ts) ; capture :
`Constituer | <db> | Ouvrir… | Créer… | Presets | Fiche corpus | Shell | Journal`). Réutiliser
l'endpoint de réindexation + la logique de détection de péremption déjà en place dans
`MetadataScreen` (extraire la partie pure si besoin).

**Questions à trancher.**
- **Suivi de l'état périmé au global** : comment les panels signalent qu'ils ont sali l'index ? Un
  état/événement partagé (les mutations text émettent un « fts_stale ») plutôt que de re-sonder à
  chaque changement d'onglet. Note : les réponses `/curate` et `/prep/undo` renvoient déjà `fts_stale`.
- **Le bouton par-onglet de `MetadataScreen`** : le garder (redondant) ou le retirer au profit du
  global ?
- **Le hint texte « réindexez pour la recherche »** de la curation (`CurationPane._apply`/`_undo`)
  peut alors pointer vers / activer le contrôle global.

## Item 2 — Revisite du header « Constituer »

**Constat.** La barre mêle des registres : **fichier** (Ouvrir/Créer), **corpus** (Presets/Fiche
corpus), **outils** (Shell/Journal). Elle mériterait un petit **pass de design** : qu'est-ce qui est
*global* (réindex + état de l'index, DB courante) vs *contextuel*, regroupement/étiquetage, place du
réindex de l'item 1.

**Scope.** Front, niveau header ([`app.ts`](../tauri-prep/src/app.ts) ; à confirmer si le shell a son
propre header quand il embarque prep). **Séparé de R6.5.** À figer (choix de regroupement/labels)
avant tout ticket, suivant la garde « décisions de design avant le ticket ».

## Rappel — pourquoi c'est ici et pas dans R6.5-B

R6.5-B = **parité Curation au canvas** (per-doc). Le réindex global et le header sont **cross-panel /
app-level** → foyer différent, chantier(s) distinct(s). Les autres 🟠 du Lot E sont soit **absorbés**
(exceptions par-unité → Lot A ; résumé + breakdown par règle → Lot B), soit **re-hébergeables ailleurs**
(admin cross-doc des exceptions → onglet **Documents**/`MetadataScreen`, si le besoin se confirme),
soit **abandonnés** (diag #5, redondant Lot B). Restent #8 historique / #6 export rapport = audit/niche,
notés « à reloger si un besoin réel émerge ».
