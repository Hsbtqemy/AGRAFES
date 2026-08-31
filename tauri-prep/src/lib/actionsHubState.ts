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
