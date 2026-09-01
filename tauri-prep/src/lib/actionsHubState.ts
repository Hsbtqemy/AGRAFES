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

import type { DocumentRecord, StepMark } from "./sidecarClient.ts";
import { compareDocsByTitle, compareLocale } from "../../../shared/docSort.ts";

/** Les quatre capacités de préparation. Ordre d'affichage des cartes. */
export const HUB_STEPS = ["curation", "segmentation", "alignement", "annotation"] as const;
export type HubStep = (typeof HUB_STEPS)[number];

/**
 * L'état d'une capacité sur un document, à trois valeurs.
 *
 *   "none"     aucune trace — la capacité n'a jamais rien produit ici
 *   "started"  une trace existe, mais PERSONNE n'a dit que c'était fini
 *   "done"     l'utilisateur a coché, et rien ne l'a démenti depuis
 *
 * Les deux premiers sont dérivés et gratuits ; seul `done` se stocke, et seul
 * l'utilisateur le pose. Le moteur n'a pas qualité à déclarer qu'un travail est fini —
 * c'est ce qui fait qu'une segmentation appliquée mais insatisfaisante retombe sur
 * "started" au retour, sans que personne ait eu à penser à la marquer avant de quitter.
 */
export type StepState = "none" | "started" | "done";

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
  // La coche de l'utilisateur passe avant tout — mais seulement si le travail qui a
  // suivi ne l'a pas démentie. Une coche périmée retombe à "started" : elle a bien été
  // posée, et le moteur dit qu'elle ne vaut plus. Elle ne disparaît pas pour autant,
  // `stepMark` la rend avec sa raison pour que la ligne puisse l'expliquer.
  const mark = doc.step_status?.[step];
  if (mark && !mark.stale) return "done";
  return hasTrace(doc, step) ? "started" : "none";
}

/** Y a-t-il une trace de cette capacité sur ce document ? Entièrement dérivé. */
export function hasTrace(doc: DocumentRecord, step: HubStep): boolean {
  switch (step) {
    case "curation":
      return Boolean(doc.curated_at);
    case "segmentation":
      // `unit_count` absent = on ne sait pas ; ne pas accuser un document de
      // n'être pas segmenté sur une donnée manquante.
      return !(typeof doc.unit_count === "number" && doc.unit_count <= RAW_UNIT_THRESHOLD);
    case "alignement":
      return (doc.aligned_count ?? 0) > 0;
    case "annotation":
      return doc.annotation_status === "annotated";
  }
}

/** La coche telle qu'elle est stockée, périmée ou non — `null` s'il n'y en a pas. */
export function stepMark(doc: DocumentRecord, step: HubStep): StepMark | null {
  return doc.step_status?.[step] ?? null;
}

/**
 * Les documents que `step` concerne encore : tout ce qui n'est pas validé, donc les
 * deux premiers états. Un document « en cours » concerne toujours la capacité — c'est
 * même celui sur lequel il reste le plus à décider.
 */
export function docsForStep(docs: DocumentRecord[], step: HubStep | null): DocumentRecord[] {
  if (step === null) return docs.slice();
  return docs.filter((d) => stepState(d, step) !== "done");
}

/** Ce qu'une carte annonce : jamais commencé d'un côté, commencé sans conclusion de l'autre. */
export interface StepCount {
  /** Aucune trace : la capacité n'a rien produit sur ce document. */
  none: number;
  /** Une trace, aucune validation. */
  started: number;
}

/**
 * Les deux nombres de chaque carte.
 *
 * Un seul nombre ne pouvait pas les porter, et la simulation d'un corpus NEUF le
 * montre mieux que le corpus de travail : cinq documents fraîchement importés donnent
 * `[/]` sur les cinq en segmentation, parce que l'import a produit des lignes. Une
 * carte qui ne compterait que « aucune trace » y afficherait « 0 à faire » — le
 * mensonge exact que ce modèle existe pour tuer. Une carte qui compterait les deux
 * afficherait le nombre de documents partout, sur les quatre cartes, et n'aiderait plus
 * à choisir par quoi commencer.
 */
export function stepCounts(docs: DocumentRecord[]): Record<HubStep, StepCount> {
  const out: Record<HubStep, StepCount> = {
    curation:     { none: 0, started: 0 },
    segmentation: { none: 0, started: 0 },
    alignement:   { none: 0, started: 0 },
    annotation:   { none: 0, started: 0 },
  };
  for (const doc of docs) {
    for (const step of HUB_STEPS) {
      const state = stepState(doc, step);
      if (state === "none") out[step].none += 1;
      else if (state === "started") out[step].started += 1;
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

/**
 * Le rappel de l'ordre, sous l'en-tête de la colonne « À faire ».
 *
 * Quatre cases muettes obligent à survoler pour savoir laquelle est laquelle : le nom
 * ne vivait que dans l'infobulle, donc nulle part pour qui regarde la colonne entière.
 *
 * Trois lettres et pas une : `Alignement` et `Annotation` partagent leur initiale, et
 * `Al`/`An` se confondent au coup d'œil à la taille où ces étiquettes sont lues.
 */
export const STEP_ABBR: Record<HubStep, string> = {
  curation: "Cur",
  segmentation: "Seg",
  alignement: "Ali",
  annotation: "Ann",
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
    .filter((step) => stepState(doc, step) !== "done")
    .map((step) => ({ label: STEP_LABEL[step], kind: "todo" as const }));
  if (doc.fts_stale === true) badges.push({ label: "Index périmé", kind: "warn" });
  return badges;
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
