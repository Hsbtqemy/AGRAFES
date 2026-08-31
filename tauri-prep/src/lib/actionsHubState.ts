/**
 * actionsHubState — le modèle de la page Actions, en fonctions pures (ACT-01).
 *
 * La page posait une liste de documents inerte au-dessus de quatre cartes d'étapes,
 * sans rien qui circule de l'une à l'autre. Le geste retenu est « action d'abord » :
 * on choisit une capacité, la liste se réduit aux documents qu'elle concerne, puis
 * on choisit un document. Tout ce qui décide de ce qui est montré vit ici, hors DOM,
 * pour être mesurable sans navigateur.
 *
 * Les quatre états viennent tous de `DocumentRecord`, donc d'un seul GET /documents :
 *   curation      curated_at        (ACT-01, dérivé de prep_action_history)
 *   segmentation  unit_count        (≤ 1 unité = texte brut, jamais découpé)
 *   alignement    aligned_count     (ACT-01, dérivé de alignment_links)
 *   annotation    annotation_status (déjà servi)
 *
 * Le seuil de segmentation reprend celui du bandeau d'état du canvas
 * (TextCanvasView._renderStateStrip) : même vocabulaire d'un écran à l'autre.
 * Attention à ne PAS reprendre `segmented` de GET /families, qui vaut « le document
 * a au moins une unité `line` » — vrai de tout document importé (57 sur 58 mesurés) —
 * et peindrait donc « fait » partout.
 */

import type { DocumentRecord } from "./sidecarClient.ts";
import { compareDocsByTitle, compareLocale } from "../../../shared/docSort.ts";

/** Les quatre capacités de préparation. Ordre d'affichage des cartes. */
export const HUB_STEPS = ["curation", "segmentation", "alignement", "annotation"] as const;
export type HubStep = (typeof HUB_STEPS)[number];

/** État d'une capacité sur un document : reste à faire, ou déjà passée dessus. */
export type StepState = "todo" | "done";

/** Nombre d'unités au-delà duquel un document n'est plus un bloc brut. */
export const RAW_UNIT_THRESHOLD = 1;

/**
 * L'état d'UNE capacité sur UN document.
 *
 * Aucun cas « sans objet » : les capacités sont indépendantes et un document arrive
 * à n'importe quel stade (DESIGN_peritext_conventions §0). Un document isolé peut
 * être aligné — c'est pourquoi `aligned_count` est servi par /documents et non lu
 * dans /families, qui ignore les documents hors famille.
 */
export function stepState(doc: DocumentRecord, step: HubStep): StepState {
  switch (step) {
    case "curation":
      return doc.curated_at ? "done" : "todo";
    case "segmentation":
      // `unit_count` absent = on ne sait pas ; ne pas accuser un document de
      // n'être pas segmenté sur une donnée manquante.
      return typeof doc.unit_count === "number" && doc.unit_count <= RAW_UNIT_THRESHOLD
        ? "todo"
        : "done";
    case "alignement":
      return (doc.aligned_count ?? 0) > 0 ? "done" : "todo";
    case "annotation":
      return doc.annotation_status === "annotated" ? "done" : "todo";
  }
}

/** Les documents que `step` concerne encore, dans l'ordre reçu. */
export function docsForStep(docs: DocumentRecord[], step: HubStep | null): DocumentRecord[] {
  if (step === null) return docs.slice();
  return docs.filter((d) => stepState(d, step) === "todo");
}

/** Combien de documents restent à traiter, par capacité. */
export function stepCounts(docs: DocumentRecord[]): Record<HubStep, number> {
  const out = { curation: 0, segmentation: 0, alignement: 0, annotation: 0 };
  for (const doc of docs) {
    for (const step of HUB_STEPS) {
      if (stepState(doc, step) === "todo") out[step] += 1;
    }
  }
  return out;
}

/** Libellés courts, tels qu'ils apparaissent en pastille sur une ligne. */
export const STEP_LABEL: Record<HubStep, string> = {
  curation: "Curation",
  segmentation: "Segmentation",
  alignement: "Alignement",
  annotation: "Annotation",
};

export interface DocBadge {
  /** Rendu en texte, jamais en HTML. */
  label: string;
  /** `todo` = reste à faire ; `warn` = anomalie qui appelle une action. */
  kind: "todo" | "warn";
}

/**
 * Ce qui reste à faire sur un document, dans l'ordre des cartes, suivi des
 * anomalies. Un document sur lequel il n'y a rien à faire rend un tableau vide —
 * c'est l'appelant qui décide comment dire « rien » (et non une pastille de plus).
 *
 * `fts_stale` figure ici et pas parmi les capacités : ce n'est pas une étape de
 * préparation mais une conséquence — le texte a bougé après l'indexation. C'était
 * l'état le plus parlant de ceux que l'écran laissait tomber.
 */
export function docBadges(doc: DocumentRecord): DocBadge[] {
  const badges: DocBadge[] = HUB_STEPS
    .filter((step) => stepState(doc, step) === "todo")
    .map((step) => ({ label: STEP_LABEL[step], kind: "todo" as const }));
  if (doc.fts_stale === true) badges.push({ label: "Index périmé", kind: "warn" });
  return badges;
}

/** Ce qu'une ligne montre, et ce qu'elle garde pour l'infobulle. */
export interface VisibleBadges {
  shown: DocBadge[];
  /** Nombre de pastilles non montrées ; 0 = tout est visible. */
  hidden: number;
}

/**
 * Borne les pastilles d'une ligne à `max`, pour que toutes les lignes fassent la
 * MÊME hauteur : au-delà, elles se replient et la ligne grandit, ce qui rend la
 * liste illisible en diagonale — on ne peut plus suivre une colonne du regard.
 *
 * Une anomalie n'est jamais celle qu'on cache. « Index périmé » appelle une action
 * et ne concerne que 17 documents sur 58 ; les étapes restantes, elles, sont le cas
 * courant. Les avertissements sont donc servis d'abord, et le débordement ne mange
 * que des étapes.
 */
export function visibleBadges(doc: DocumentRecord, max: number): VisibleBadges {
  const all = docBadges(doc);
  if (all.length <= max) return { shown: all, hidden: 0 };
  const warns = all.filter((b) => b.kind === "warn");
  const steps = all.filter((b) => b.kind !== "warn");
  const shown = [...warns.slice(0, max), ...steps.slice(0, Math.max(0, max - warns.length))];
  return { shown, hidden: all.length - shown.length };
}

// ─── Tri de la liste ────────────────────────────────────────────────────────

/** Colonnes triables. `todo` = combien il reste à faire sur le document. */
export const HUB_SORT_COLS = ["id", "title", "lang", "role", "units", "todo"] as const;
export type HubSortCol = (typeof HUB_SORT_COLS)[number];
export type SortDir = "asc" | "desc";

/**
 * Comparateur pur pour la liste du hub.
 *
 * Les colonnes texte passent par `shared/docSort.ts` — locale FR, insensible à la
 * casse et aux accents — qui est la convention du dépôt entier : trois variantes
 * avaient coexisté avant qu'elle existe, ce n'est pas le moment d'en ajouter une
 * quatrième. `id` n'est pas le numéro affiché mais l'ordre d'arrivée des documents,
 * c'est-à-dire le tri par défaut et le chemin du retour.
 *
 * Départage toujours sur `doc_id` : sans ça, deux documents de même langue changent
 * de place d'un rendu à l'autre, et la liste paraît bouger toute seule.
 */
export function hubComparator(
  col: HubSortCol,
  dir: SortDir,
): (a: DocumentRecord, b: DocumentRecord) => number {
  const sign = dir === "asc" ? 1 : -1;
  const tie = (a: DocumentRecord, b: DocumentRecord, cmp: number): number =>
    cmp !== 0 ? sign * cmp : a.doc_id - b.doc_id;
  return (a, b) => {
    switch (col) {
      case "id":    return sign * (a.doc_id - b.doc_id);
      case "title": return tie(a, b, compareDocsByTitle(a, b));
      case "lang":  return tie(a, b, compareLocale(a.language, b.language));
      case "role":  return tie(a, b, compareLocale(a.doc_role, b.doc_role));
      case "units": return tie(a, b, (a.unit_count ?? 0) - (b.unit_count ?? 0));
      // « Ce qui reste » : le nombre de pastilles, anomalie d'index comprise.
      // C'est le tri qui répond à « par quoi je commence ».
      case "todo":  return tie(a, b, docBadges(a).length - docBadges(b).length);
    }
  };
}

/** Trie une copie — la liste hôte (`_docs`) est partagée, ne jamais la réordonner. */
export function sortDocs(
  docs: DocumentRecord[],
  col: HubSortCol,
  dir: SortDir,
): DocumentRecord[] {
  return docs.slice().sort(hubComparator(col, dir));
}
