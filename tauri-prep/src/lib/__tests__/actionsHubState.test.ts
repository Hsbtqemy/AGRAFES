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
  HUB_STEPS, docBadges, docsForStep, hubComparator, sortDocs, stepCounts, stepState,
  visibleBadges,
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

describe("tri de la liste", () => {
  const corpus = [
    doc({ doc_id: 3, title: "Élan", language: "de", doc_role: "cible", unit_count: 10 }),
    doc({ doc_id: 1, title: "abricot", language: "fr", doc_role: null, unit_count: 200 }),
    doc({ doc_id: 2, title: "Abricot", language: "en", doc_role: "source", unit_count: 30 }),
  ];

  it("ne réordonne jamais la liste hôte", () => {
    const out = sortDocs(corpus, "title", "asc");
    expect(out).not.toBe(corpus);
    expect(corpus.map((d) => d.doc_id)).toEqual([3, 1, 2]);
  });

  it("id ascendant est l'ordre d'arrivée — le chemin du retour", () => {
    expect(sortDocs(corpus, "id", "asc").map((d) => d.doc_id)).toEqual([1, 2, 3]);
    expect(sortDocs(corpus, "id", "desc").map((d) => d.doc_id)).toEqual([3, 2, 1]);
  });

  it("le titre ignore casse et accents, et départage sur doc_id", () => {
    // « abricot » et « Abricot » sont égaux pour le collator : sans départage,
    // leur ordre relatif dépendrait de l'implémentation du tri.
    expect(sortDocs(corpus, "title", "asc").map((d) => d.doc_id)).toEqual([1, 2, 3]);
  });

  it("les unités se trient en nombre, pas en texte", () => {
    // Le piège du tri lexical : "200" viendrait avant "30".
    expect(sortDocs(corpus, "units", "asc").map((d) => d.unit_count)).toEqual([10, 30, 200]);
  });

  it("un rôle absent ne casse pas le tri", () => {
    expect(sortDocs(corpus, "role", "asc").map((d) => d.doc_role)).toEqual([null, "cible", "source"]);
  });

  it("« à faire » trie par quantité de travail restant", () => {
    const docs = [
      doc({ doc_id: 1, unit_count: 900, curated_at: "x", aligned_count: 1, annotation_status: "annotated" }), // 0
      doc({ doc_id: 2, unit_count: 1 }),                                                                      // 4
      doc({ doc_id: 3, unit_count: 900, curated_at: "x", aligned_count: 1, annotation_status: "annotated", fts_stale: true }), // 1
    ];
    expect(sortDocs(docs, "todo", "asc").map((d) => d.doc_id)).toEqual([1, 3, 2]);
    expect(sortDocs(docs, "todo", "desc").map((d) => d.doc_id)).toEqual([2, 3, 1]);
  });

  it("le sens descendant n'emporte pas le départage, qui reste stable", () => {
    // Si `desc` inversait aussi le tie-break, deux documents de même langue
    // changeraient de place selon le sens — la liste paraîtrait bouger seule.
    const memes = [
      doc({ doc_id: 1, language: "fr" }), doc({ doc_id: 2, language: "fr" }),
    ];
    expect(sortDocs(memes, "lang", "asc").map((d) => d.doc_id)).toEqual([1, 2]);
    expect(sortDocs(memes, "lang", "desc").map((d) => d.doc_id)).toEqual([1, 2]);
  });

  it("hubComparator est utilisable tel quel pour trier un niveau d'arbre", () => {
    const cmp = hubComparator("title", "asc");
    const niveau = [corpus[0], corpus[2]];
    expect([...niveau].sort(cmp).map((d) => d.doc_id)).toEqual([2, 3]);
  });
});

describe("visibleBadges — une ligne fait une ligne", () => {
  it("sous la borne, tout est montré et rien n'est caché", () => {
    const { shown, hidden } = visibleBadges(doc({ unit_count: 900, aligned_count: 1 }), 4);
    expect(shown.map((b) => b.label)).toEqual(["Curation", "Annotation"]);
    expect(hidden).toBe(0);
  });

  it("au-delà, l'anomalie passe DEVANT et n'est jamais celle qu'on cache", () => {
    // Quatre étapes + index périmé = cinq pastilles pour quatre places. Cacher
    // « Index périmé » cacherait le seul état qui appelle une action.
    const { shown, hidden } = visibleBadges(doc({ unit_count: 1, fts_stale: true }), 4);
    expect(shown[0].label).toBe("Index périmé");
    expect(shown).toHaveLength(4);
    expect(hidden).toBe(1);
    expect(shown.map((b) => b.label)).not.toContain("Annotation");
  });

  it("le compte caché est exact, pas approximatif", () => {
    const d = doc({ unit_count: 1, fts_stale: true });
    const { shown, hidden } = visibleBadges(d, 2);
    expect(shown).toHaveLength(2);
    expect(hidden).toBe(docBadges(d).length - 2);
  });

  it("un document sans rien à faire ne cache rien", () => {
    const d = doc({ unit_count: 900, curated_at: "x", aligned_count: 1, annotation_status: "annotated" });
    expect(visibleBadges(d, 4)).toEqual({ shown: [], hidden: 0 });
  });
});
