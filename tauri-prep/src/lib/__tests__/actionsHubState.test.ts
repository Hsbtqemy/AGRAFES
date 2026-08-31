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
} from "../actionsHubState.ts";

function doc(over: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    doc_id: 1, title: "Doc", language: "fr", doc_role: null, resource_type: null,
    unit_count: 500, ...over,
  } as DocumentRecord;
}

/** Les quatre capacités validées, coches fraîches — le seul moyen de vider une ligne. */
const TOUT_COCHE = Object.fromEntries(
  HUB_STEPS.map((step) => [
    step,
    { validated_at: "2026-08-31T10:00:00Z", stale: false, basis: "history" as const },
  ]),
);

describe("stepState", () => {
  it("curation : une trace donne « en cours », jamais « fait »", () => {
    expect(stepState(doc({ curated_at: null }), "curation")).toBe("none");
    expect(stepState(doc({}), "curation")).toBe("none");
    // LE point du modèle : le moteur OBSERVE une curation, il ne DÉCLARE pas qu'elle
    // est finie. C'est ce qui fait qu'un travail insatisfaisant reste visible au retour.
    expect(stepState(doc({ curated_at: "2026-08-16T21:50:46Z" }), "curation")).toBe("started");
  });

  it("segmentation : un texte d'un seul tenant n'a aucune trace", () => {
    expect(stepState(doc({ unit_count: 0 }), "segmentation")).toBe("none");
    expect(stepState(doc({ unit_count: 1 }), "segmentation")).toBe("none");
    expect(stepState(doc({ unit_count: 2 }), "segmentation")).toBe("started");
    expect(stepState(doc({ unit_count: 4812 }), "segmentation")).toBe("started");
  });

  it("segmentation : un unit_count absent ne vaut pas accusation", () => {
    // Sans la garde, `undefined <= 1` est false et le document passe pour porteur
    // d'une trace — ce qui est le bon repli — mais un jour où l'on écrirait
    // `(doc.unit_count ?? 0)` il passerait pour brut. Le cas est verrouillé.
    const d = doc({});
    delete (d as Partial<DocumentRecord>).unit_count;
    expect(stepState(d, "segmentation")).toBe("started");
  });

  it("alignement : compte les liens, dans un sens comme dans l'autre", () => {
    expect(stepState(doc({ aligned_count: 0 }), "alignement")).toBe("none");
    expect(stepState(doc({}), "alignement")).toBe("none");
    expect(stepState(doc({ aligned_count: 1227 }), "alignement")).toBe("started");
  });

  it("annotation : suit annotation_status", () => {
    expect(stepState(doc({ annotation_status: "missing" }), "annotation")).toBe("none");
    expect(stepState(doc({ annotation_status: "annotated" }), "annotation")).toBe("started");
  });

  it("seule la coche de l'utilisateur donne « fait »", () => {
    const marque = { validated_at: "2026-08-31T10:00:00Z", stale: false, basis: "history" as const };
    // Même sans AUCUNE trace : cocher, c'est dire « il n'y a rien à faire ici ».
    expect(stepState(doc({ step_status: { curation: marque } }), "curation")).toBe("done");
    expect(stepState(doc({ unit_count: 900, step_status: { segmentation: marque } }), "segmentation")).toBe("done");
  });

  it("une coche PÉRIMÉE retombe à « en cours », elle ne ment pas", () => {
    // Le cœur du modèle. Sans ça, une coche que le travail suivant dément resterait
    // « fait » pour toujours — mesuré : environ une sur trois finirait ainsi.
    const perimee = {
      validated_at: "2026-08-31T10:00:00Z", stale: true,
      stale_reason: "resegment", basis: "history" as const,
    };
    expect(stepState(doc({ unit_count: 900, step_status: { segmentation: perimee } }), "segmentation")).toBe("started");
    // Et sans trace dérivée, elle ne remonte pas non plus à « fait ».
    expect(stepState(doc({ step_status: { curation: perimee } }), "curation")).toBe("none");
  });

  it("une coche sur une AUTRE capacité ne déteint pas", () => {
    const marque = { validated_at: "2026-08-31T10:00:00Z", stale: false, basis: "history" as const };
    const d = doc({ unit_count: 900, step_status: { curation: marque } });
    expect(stepState(d, "curation")).toBe("done");
    expect(stepState(d, "segmentation")).toBe("started");
    expect(stepState(d, "alignement")).toBe("none");
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

  it("retient tout ce qui n'est pas validé, « en cours » compris", () => {
    // Aucun des trois n'est coché : la capacité les concerne donc tous, y compris
    // ceux qui portent déjà une trace. C'est le sens de « concerne encore ».
    expect(docsForStep(corpus, "segmentation").map((d) => d.doc_id)).toEqual([1, 2, 3]);
    expect(docsForStep(corpus, "curation").map((d) => d.doc_id)).toEqual([1, 2, 3]);
  });

  it("une coche fait sortir le document de la liste filtrée", () => {
    const marque = { validated_at: "2026-08-31T10:00:00Z", stale: false, basis: "history" as const };
    const coche = [corpus[0], doc({ doc_id: 2, unit_count: 900, step_status: { curation: marque } }), corpus[2]];
    expect(docsForStep(coche, "curation").map((d) => d.doc_id)).toEqual([1, 3]);
  });

  it("une coche périmée l'y laisse — c'est tout l'intérêt", () => {
    const perimee = {
      validated_at: "2026-08-31T10:00:00Z", stale: true,
      stale_reason: "curation_apply", basis: "history" as const,
    };
    const liste = [doc({ doc_id: 9, unit_count: 900, step_status: { curation: perimee } })];
    expect(docsForStep(liste, "curation").map((d) => d.doc_id)).toEqual([9]);
  });

  it("conserve l'ordre reçu, sans re-trier", () => {
    const shuffled = [corpus[1], corpus[2], corpus[0]];
    expect(docsForStep(shuffled, "curation").map((d) => d.doc_id)).toEqual([2, 3, 1]);
  });
});

describe("stepCounts", () => {
  it("sépare « jamais commencé » de « commencé sans conclusion »", () => {
    const counts = stepCounts([
      doc({ doc_id: 1, unit_count: 1 }),
      doc({ doc_id: 2, unit_count: 900, aligned_count: 5, annotation_status: "annotated" }),
      doc({ doc_id: 3, unit_count: 900, curated_at: "2026-01-01T00:00:00Z" }),
    ]);
    expect(counts).toEqual({
      curation:     { none: 2, started: 1 },
      segmentation: { none: 1, started: 2 },
      alignement:   { none: 2, started: 1 },
      annotation:   { none: 2, started: 1 },
    });
  });

  it("une coche ne compte NI dans l'un NI dans l'autre", () => {
    const marque = { validated_at: "2026-08-31T10:00:00Z", stale: false, basis: "history" as const };
    const counts = stepCounts([doc({ unit_count: 900, step_status: { segmentation: marque } })]);
    expect(counts.segmentation).toEqual({ none: 0, started: 0 });
  });

  it("un corpus neuf : rien de commencé partout, SAUF la segmentation", () => {
    // Simulé en base le 31 août : cinq documents fraîchement importés donnent une
    // trace de segmentation sur les cinq, parce que l'import a produit des lignes. Une
    // carte qui ne compterait que « jamais touché » y afficherait « 0 à faire » — le
    // mensonge exact que le modèle à trois états existe pour tuer.
    const neuf = [1, 2, 3].map((n) => doc({ doc_id: n, unit_count: 20 }));
    const counts = stepCounts(neuf);
    expect(counts.segmentation).toEqual({ none: 0, started: 3 });
    expect(counts.curation).toEqual({ none: 3, started: 0 });
    expect(counts.alignement).toEqual({ none: 3, started: 0 });
    expect(counts.annotation).toEqual({ none: 3, started: 0 });
  });

  it("rend zéro partout sur un corpus vide, sans clé manquante", () => {
    const counts = stepCounts([]);
    for (const step of HUB_STEPS) expect(counts[step]).toEqual({ none: 0, started: 0 });
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

  it("des traces partout ne suffisent PAS à vider la liste", () => {
    // Le document est curé, découpé, aligné, annoté — et il reste les quatre
    // pastilles, parce que personne n'a rien validé. C'est le changement de fond du
    // modèle : le moteur ne conclut pas à la place de l'utilisateur.
    const badges = docBadges(doc({
      unit_count: 900,
      curated_at: "2026-01-01T00:00:00Z",
      aligned_count: 4,
      annotation_status: "annotated",
    }));
    expect(badges.map((b) => b.label)).toEqual([
      "Curation", "Segmentation", "Alignement", "Annotation",
    ]);
  });

  it("quatre coches, elles, la vident", () => {
    expect(docBadges(doc({ unit_count: 900, step_status: TOUT_COCHE }))).toEqual([]);
  });

  it("l'index périmé est une anomalie, pas une étape — il vient en dernier", () => {
    const badges = docBadges(doc({
      unit_count: 900,
      step_status: TOUT_COCHE,
      fts_stale: true,
    }));
    expect(badges).toEqual([{ label: "Index périmé", kind: "warn" }]);
  });

  it("fts_stale absent ou false ne produit pas de pastille", () => {
    expect(docBadges(doc({ unit_count: 900, step_status: TOUT_COCHE, fts_stale: false })))
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
      doc({ doc_id: 1, unit_count: 900, step_status: TOUT_COCHE }),                    // 0
      doc({ doc_id: 2, unit_count: 1 }),                                              // 4
      doc({ doc_id: 3, unit_count: 900, step_status: TOUT_COCHE, fts_stale: true }),   // 1
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
