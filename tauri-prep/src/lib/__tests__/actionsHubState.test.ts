/**
 * actionsHubState — le modèle de la page Actions (ACT-01).
 *
 * Ce que ces tests protègent en priorité : le seuil de segmentation. La fiche
 * proposait de lire `segmented` de GET /families, qui vaut « le document a au moins
 * une unité `line` » — vrai de TOUT document importé (mesuré 57 sur 58 dans la base
 * de travail). Un témoin qui répond « fait » partout ne dit rien ; c'est `unit_count`
 * qui sépare un texte encore d'un seul tenant d'un texte découpé, comme le fait déjà
 * le bandeau d'état du canvas.
 */
import { describe, it, expect } from "vitest";
import type { DocumentRecord } from "../sidecarClient.ts";
import {
  HUB_STEPS, docBadges, docsForStep, stepCounts, stepState,
} from "../actionsHubState.ts";

function doc(over: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    doc_id: 1, title: "Doc", language: "fr", doc_role: null, resource_type: null,
    unit_count: 500, ...over,
  } as DocumentRecord;
}

describe("stepState", () => {
  it("curation : suit curated_at, servi par le moteur", () => {
    expect(stepState(doc({ curated_at: null }), "curation")).toBe("todo");
    expect(stepState(doc({}), "curation")).toBe("todo");
    expect(stepState(doc({ curated_at: "2026-08-16T21:50:46Z" }), "curation")).toBe("done");
  });

  it("segmentation : un texte d'un seul tenant reste à découper", () => {
    expect(stepState(doc({ unit_count: 0 }), "segmentation")).toBe("todo");
    expect(stepState(doc({ unit_count: 1 }), "segmentation")).toBe("todo");
    expect(stepState(doc({ unit_count: 2 }), "segmentation")).toBe("done");
    expect(stepState(doc({ unit_count: 4812 }), "segmentation")).toBe("done");
  });

  it("segmentation : un unit_count absent ne vaut pas accusation", () => {
    // Sans la garde, `undefined <= 1` est false et le document passerait pour
    // segmenté — ce qui est le bon repli — mais un jour où l'on écrirait
    // `(doc.unit_count ?? 0)` il passerait pour brut. Le cas est verrouillé.
    const d = doc({});
    delete (d as Partial<DocumentRecord>).unit_count;
    expect(stepState(d, "segmentation")).toBe("done");
  });

  it("alignement : compte les liens, dans un sens comme dans l'autre", () => {
    expect(stepState(doc({ aligned_count: 0 }), "alignement")).toBe("todo");
    expect(stepState(doc({}), "alignement")).toBe("todo");
    expect(stepState(doc({ aligned_count: 1227 }), "alignement")).toBe("done");
  });

  it("annotation : suit annotation_status", () => {
    expect(stepState(doc({ annotation_status: "missing" }), "annotation")).toBe("todo");
    expect(stepState(doc({ annotation_status: "annotated" }), "annotation")).toBe("done");
  });
});

describe("docsForStep", () => {
  const corpus = [
    doc({ doc_id: 1, unit_count: 1 }),                         // brut
    doc({ doc_id: 2, unit_count: 900, aligned_count: 12 }),     // aligné
    doc({ doc_id: 3, unit_count: 900, curated_at: "2026-01-01T00:00:00Z" }),
  ];

  it("sans filtre, rend le corpus entier — et une copie, pas la liste hôte", () => {
    const all = docsForStep(corpus, null);
    expect(all.map((d) => d.doc_id)).toEqual([1, 2, 3]);
    expect(all).not.toBe(corpus);
  });

  it("ne retient que ce que l'étape concerne encore", () => {
    expect(docsForStep(corpus, "segmentation").map((d) => d.doc_id)).toEqual([1]);
    expect(docsForStep(corpus, "alignement").map((d) => d.doc_id)).toEqual([1, 3]);
    expect(docsForStep(corpus, "curation").map((d) => d.doc_id)).toEqual([1, 2]);
  });

  it("conserve l'ordre reçu, sans re-trier", () => {
    const shuffled = [corpus[1], corpus[2], corpus[0]];
    expect(docsForStep(shuffled, "curation").map((d) => d.doc_id)).toEqual([2, 1]);
  });
});

describe("stepCounts", () => {
  it("compte les restants par capacité, indépendamment les unes des autres", () => {
    const counts = stepCounts([
      doc({ doc_id: 1, unit_count: 1 }),
      doc({ doc_id: 2, unit_count: 900, aligned_count: 5, annotation_status: "annotated" }),
      doc({ doc_id: 3, unit_count: 900, curated_at: "2026-01-01T00:00:00Z" }),
    ]);
    expect(counts).toEqual({ curation: 2, segmentation: 1, alignement: 2, annotation: 2 });
  });

  it("rend zéro partout sur un corpus vide, sans clé manquante", () => {
    const counts = stepCounts([]);
    for (const step of HUB_STEPS) expect(counts[step]).toBe(0);
  });
});

describe("docBadges", () => {
  it("liste ce qui reste, dans l'ordre des cartes", () => {
    const badges = docBadges(doc({ unit_count: 1 }));
    expect(badges.map((b) => b.label)).toEqual([
      "Curation", "Segmentation", "Alignement", "Annotation",
    ]);
    expect(badges.every((b) => b.kind === "todo")).toBe(true);
  });

  it("un document entièrement traité ne rend AUCUNE pastille", () => {
    const badges = docBadges(doc({
      unit_count: 900,
      curated_at: "2026-01-01T00:00:00Z",
      aligned_count: 4,
      annotation_status: "annotated",
    }));
    expect(badges).toEqual([]);
  });

  it("l'index périmé est une anomalie, pas une étape — il vient en dernier", () => {
    const badges = docBadges(doc({
      unit_count: 900,
      curated_at: "2026-01-01T00:00:00Z",
      aligned_count: 4,
      annotation_status: "annotated",
      fts_stale: true,
    }));
    expect(badges).toEqual([{ label: "Index périmé", kind: "warn" }]);
  });

  it("fts_stale absent ou false ne produit pas de pastille", () => {
    expect(docBadges(doc({ unit_count: 900, curated_at: "x", aligned_count: 1, annotation_status: "annotated", fts_stale: false })))
      .toEqual([]);
  });
});
