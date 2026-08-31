// @vitest-environment happy-dom
/**
 * ActionsScreen — le hub « action d'abord » (ACT-01).
 *
 * Ce que la page faisait avant : elle posait une liste de documents AU-DESSUS de
 * quatre cartes d'étapes, dans deux conteneurs séparés, sans rien qui circule. Les
 * lignes ne portaient aucun écouteur — on pouvait lire, pas cliquer. Ces tests
 * verrouillent le lien qui manquait : une carte filtre la liste, une ligne ouvre la
 * capacité SUR son document.
 *
 * Les états viennent tous de `listDocuments`, donc d'un seul appel : le faux sidecar
 * ci-dessous ne sert que /documents.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ActionsScreen } from "../ActionsScreen.ts";
import type { Conn } from "../../lib/sidecarClient.ts";

const DOCS = [
  // brut, jamais curé, jamais aligné, jamais annoté → concerné par les quatre
  { doc_id: 10, title: "Brouillon", language: "fr", doc_role: null, unit_count: 1 },
  // découpé + aligné + annoté, mais jamais curé, et index périmé
  {
    doc_id: 11, title: "Les Misérables", language: "fr", doc_role: "source",
    unit_count: 4812, aligned_count: 1227, annotation_status: "annotated", fts_stale: true,
  },
  // rien à faire du tout
  {
    doc_id: 12, title: "Die Elenden", language: "de", doc_role: "cible",
    unit_count: 4655, aligned_count: 709, annotation_status: "annotated",
    curated_at: "2026-08-16T21:50:46Z",
  },
  // tout fait SAUF l'annotation — le seul document qui permette d'obtenir
  // « enfant retenu par le filtre, parent hors filtre » dans la vue hiérarchie.
  {
    doc_id: 13, title: "The Wretched", language: "en", doc_role: "cible",
    unit_count: 4901, aligned_count: 640, annotation_status: "missing",
    curated_at: "2026-08-16T21:50:46Z",
  },
];

type Relation = { doc_id: number; target_doc_id: number; relation_type: string };

function fakeConn(relations: Relation[] = []): Conn {
  return {
    get: vi.fn(async (path: string) => {
      if (path.startsWith("/documents")) return { documents: DOCS, count: DOCS.length };
      if (path.startsWith("/doc_relations/all")) return { relations };
      if (path.startsWith("/models")) return { models: [], active: null };
      return {};
    }),
    post: vi.fn(async () => ({})),
  } as unknown as Conn;
}

/** 11 est la source, 12 sa traduction ; 10 reste isolé. */
const FAMILY: Relation[] = [
  { doc_id: 12, target_doc_id: 11, relation_type: "translation_of" },
  { doc_id: 13, target_doc_id: 11, relation_type: "translation_of" },
];

/** Monte l'écran, branche la connexion et attend le chargement de la liste. */
async function mountWithDocs(
  relations: Relation[] = [],
): Promise<{ view: ActionsScreen; root: HTMLElement }> {
  const view = new ActionsScreen();
  const root = view.render();
  document.body.appendChild(root);
  view.setConn(fakeConn(relations));
  await vi.waitFor(() => {
    expect(root.querySelectorAll("#act-doc-list tbody tr").length).toBeGreaterThan(0);
  });
  return { view, root };
}

const rowTitles = (root: HTMLElement): string[] =>
  Array.from(root.querySelectorAll("#act-doc-list tbody tr"))
    .map((tr) => tr.querySelectorAll("td")[1]?.textContent ?? "");

describe("hub Actions — les cartes filtrent la liste (ACT-01)", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = "";
  });

  it("chaque carte annonce combien de documents elle concerne encore", async () => {
    const { root } = await mountWithDocs();
    // curation : 10 et 11 (12 a un curated_at) ; segmentation : 10 seul ;
    // alignement : 10 seul ; annotation : 10 seul.
    expect(root.querySelector("#act-hub-count-curation")?.textContent).toBe("2 à faire");
    expect(root.querySelector("#act-hub-count-segmentation")?.textContent).toBe("1 à faire");
    expect(root.querySelector("#act-hub-count-alignement")?.textContent).toBe("1 à faire");
    expect(root.querySelector("#act-hub-count-annotation")?.textContent).toBe("2 à faire");
  });

  it("cliquer une carte réduit la liste aux documents qu'elle concerne", async () => {
    const { root } = await mountWithDocs();
    expect(rowTitles(root)).toHaveLength(4);

    root.querySelector<HTMLButtonElement>("#act-hub-filter-curation")!.click();

    expect(rowTitles(root)).toEqual(["Brouillon", "Les Misérables"]);
    expect(root.querySelector("#act-hub-filter-curation")?.getAttribute("aria-pressed")).toBe("true");
    expect(root.querySelector<HTMLElement>("#act-hub-filter-strip")?.hidden).toBe(false);
    expect(root.querySelector("#act-hub-filter-label")?.textContent)
      .toBe("Curation — 2 documents sur 4");
  });

  it("re-cliquer la carte active, ou « Tout afficher », rend la liste entière", async () => {
    const { root } = await mountWithDocs();
    const btn = root.querySelector<HTMLButtonElement>("#act-hub-filter-segmentation")!;

    btn.click();
    expect(rowTitles(root)).toEqual(["Brouillon"]);
    btn.click();
    expect(rowTitles(root)).toHaveLength(4);

    btn.click();
    root.querySelector<HTMLButtonElement>("#act-hub-filter-clear")!.click();
    expect(rowTitles(root)).toHaveLength(4);
    expect(root.querySelector<HTMLElement>("#act-hub-filter-strip")?.hidden).toBe(true);
  });

  it("une carte sans reste ne se laisse pas filtrer", async () => {
    const { view, root } = await mountWithDocs();
    // Corpus où tout est traité : les quatre cartes doivent basculer sur « tout à jour ».
    view.setConn({
      get: vi.fn(async (path: string) =>
        path.startsWith("/documents")
          ? { documents: [DOCS[2]], count: 1 }
          : { relations: [] }),
      post: vi.fn(async () => ({})),
    } as unknown as Conn);
    await vi.waitFor(() => {
      expect(root.querySelector("#act-hub-count-curation")?.textContent).toBe("tout à jour");
    });
    const btn = root.querySelector<HTMLButtonElement>("#act-hub-filter-curation")!;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe("Rien à faire");
  });
});

describe("hub Actions — l'ordre des blocs porte le geste (ACT-01)", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = "";
  });

  it("les quatre cartes viennent AVANT la liste dans le DOM", async () => {
    // « Action d'abord » se lit dans l'ordre de la page, pas seulement dans le code :
    // choisir une capacité, PUIS un document. L'écran d'origine posait la liste
    // au-dessus et les actions en dessous ; garder cet ordre ferait lire la page à
    // l'envers du geste qu'elle demande. Rien d'autre ne tient cette position.
    const { root } = await mountWithDocs();
    const cards = root.querySelector(".prep-acts-hub-workspace")!;
    const list = root.querySelector(".prep-acts-hub-docs-card")!;
    expect(cards.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
  });

  it("la liste et son bandeau de filtre restent solidaires, sous les cartes", async () => {
    const { root } = await mountWithDocs();
    const list = root.querySelector(".prep-acts-hub-docs-card")!;
    // Le bandeau annonce le filtre appliqué À CETTE liste : le séparer d'elle
    // rendrait l'annonce flottante.
    expect(list.querySelector("#act-hub-filter-strip")).not.toBeNull();
    expect(list.querySelector("#act-doc-list")).not.toBeNull();
  });
});

describe("hub Actions — la liste porte l'état et le geste (ACT-01)", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = "";
  });

  it("chaque ligne dit ce qu'il reste à y faire", async () => {
    const { root } = await mountWithDocs();
    const badges = (docId: number): string[] =>
      Array.from(
        root.querySelectorAll(`#act-doc-list tr[data-doc-id="${docId}"] .prep-acts-hub-badge`),
      ).map((el) => el.textContent ?? "");

    expect(badges(10)).toEqual(["Curation", "Segmentation", "Alignement", "Annotation"]);
    // L'index périmé était l'état le plus parlant de ceux que l'écran laissait tomber.
    expect(badges(11)).toEqual(["Curation", "Index périmé"]);
    expect(badges(12)).toEqual(["Rien à faire"]);
  });

  it("hors filtre, la ligne offre les quatre gestes, nommés pour un lecteur d'écran", async () => {
    const { root } = await mountWithDocs();
    const btns = Array.from(
      root.querySelectorAll<HTMLButtonElement>('tr[data-doc-id="11"] .prep-acts-hub-row-btn'),
    );
    expect(btns.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Curation sur Les Misérables",
      "Segmentation sur Les Misérables",
      "Alignement sur Les Misérables",
      "Annotation sur Les Misérables",
    ]);
  });

  it("sous filtre, la ligne n'offre plus que le geste demandé", async () => {
    const { root } = await mountWithDocs();
    root.querySelector<HTMLButtonElement>("#act-hub-filter-annotation")!.click();
    const btns = root.querySelectorAll<HTMLButtonElement>('tr[data-doc-id="10"] .prep-acts-hub-row-btn');
    expect(btns).toHaveLength(1);
    expect(btns[0].textContent).toBe("Annotation →");
  });

  it("le geste ouvre la capacité SUR ce document, pas sur le document courant", async () => {
    const { view, root } = await mountWithDocs();
    // Stubs, pas des sondes passantes : ce qu'on vérifie est le docId transmis.
    // Laisser passer entraînerait tout le canvas (et ses appels /models) dans un
    // test qui ne parle que du hub.
    const curation = vi.spyOn(view, "openCurationLayer").mockImplementation(() => {});
    const segment = vi.spyOn(view, "openSegmentLayer").mockImplementation(() => {});
    const annotation = vi.spyOn(view, "openAnnotationLayer").mockImplementation(() => {});

    const btns = root.querySelectorAll<HTMLButtonElement>('tr[data-doc-id="11"] .prep-acts-hub-row-btn');
    btns[0].click();
    btns[1].click();
    btns[3].click();

    expect(curation).toHaveBeenCalledWith(11);
    expect(segment).toHaveBeenCalledWith(11);
    expect(annotation).toHaveBeenCalledWith(11);
  });

  it("un document hors famille ne peut pas ouvrir la matrice : il le dit", async () => {
    const { view, root } = await mountWithDocs();
    const toast = vi.fn();
    // setJobCenter est le seul point d'entrée du toast ; le JobCenter n'est pas sollicité ici.
    view.setJobCenter({} as never, toast);
    const openFamily = vi.spyOn(view, "openAlignmentOnFamily");

    root.querySelectorAll<HTMLButtonElement>('tr[data-doc-id="11"] .prep-acts-hub-row-btn')[2].click();

    await vi.waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast.mock.calls[0][1]).toBe(true); // signalé comme erreur
    expect(openFamily).not.toHaveBeenCalled();
  });
});

describe("hub Actions — filtre et vue hiérarchie se composent (ACT-01)", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = "";
  });

  /** Bascule en hiérarchie et attend que l'arbre soit RÉELLEMENT rendu : le
   *  chargement des relations est asynchrone, et la liste plate a déjà des lignes —
   *  attendre « une ligne existe » laissait donc passer la liste plate. */
  const switchToHierarchy = async (root: HTMLElement): Promise<void> => {
    root.querySelector<HTMLButtonElement>("#act-hub-hierarchy-btn")!.click();
    await vi.waitFor(() => {
      expect(root.querySelector("#act-doc-list tr.prep-tree-child")).not.toBeNull();
    });
  };

  const rowsOf = (root: HTMLElement): Array<{ id: string | undefined; context: boolean }> =>
    Array.from(root.querySelectorAll<HTMLElement>("#act-doc-list tbody tr[data-doc-id]"))
      .map((tr) => ({
        id: tr.dataset.docId,
        context: tr.classList.contains("prep-acts-hub-row--context"),
      }));

  it("un enfant retenu tire son parent en contexte, sans geste offert", async () => {
    const { root } = await mountWithDocs(FAMILY);
    await switchToHierarchy(root);

    // Filtre Annotation : 10 et 13 restent. 13 est l'ENFANT de 11, qui est annoté
    // et donc hors filtre — 11 doit apparaître quand même, pour situer 13.
    root.querySelector<HTMLButtonElement>("#act-hub-filter-annotation")!.click();
    expect(rowsOf(root)).toEqual([
      { id: "11", context: true },
      { id: "13", context: false },
      { id: "10", context: false },
    ]);

    const parent = root.querySelector('tr[data-doc-id="11"]')!;
    expect(
      Array.from(parent.querySelectorAll<HTMLButtonElement>("button")).every((b) => b.disabled),
    ).toBe(true);
    // L'enfant retenu, lui, garde son geste.
    const child = root.querySelector<HTMLButtonElement>(
      'tr[data-doc-id="13"] .prep-acts-hub-row-btn',
    )!;
    expect(child.disabled).toBe(false);
  });

  it("un parent retenu sans enfant retenu s'affiche seul, avec ses gestes", async () => {
    const { root } = await mountWithDocs(FAMILY);
    await switchToHierarchy(root);

    // Filtre Curation : 10 et 11 restent ; 12 et 13 sont curés.
    root.querySelector<HTMLButtonElement>("#act-hub-filter-curation")!.click();
    expect(rowsOf(root)).toEqual([
      { id: "11", context: false },
      { id: "10", context: false },
    ]);
    const parent = root.querySelector<HTMLButtonElement>(
      'tr[data-doc-id="11"] .prep-acts-hub-row-btn',
    )!;
    expect(parent.disabled).toBe(false);
  });

  it("une famille dont rien n'est retenu disparaît entièrement", async () => {
    const { root } = await mountWithDocs(FAMILY);
    await switchToHierarchy(root);
    // Filtre Segmentation : seul 10 est brut. Toute la famille 11/12/13 sort.
    root.querySelector<HTMLButtonElement>("#act-hub-filter-segmentation")!.click();
    expect(rowsOf(root)).toEqual([{ id: "10", context: false }]);
  });

  it("la vue hiérarchie garde l'état et les gestes de la vue plate", async () => {
    const { root } = await mountWithDocs(FAMILY);
    await switchToHierarchy(root);
    const row = root.querySelector('tr[data-doc-id="12"]')!;
    expect(row.querySelector(".prep-acts-hub-badge")?.textContent).toBe("Rien à faire");
    expect(row.querySelectorAll(".prep-acts-hub-row-btn")).toHaveLength(4);
  });
});

describe("hub Actions — l'alignement distingue ses deux refus (ACT-01)", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = "";
  });

  const clickAlign = (root: HTMLElement, docId: number): void => {
    root.querySelectorAll<HTMLButtonElement>(
      `tr[data-doc-id="${docId}"] .prep-acts-hub-row-btn`,
    )[2].click();
  };

  it("document isolé : on le dit, on n'ouvre pas la matrice sur la famille précédente", async () => {
    const { view, root } = await mountWithDocs(FAMILY);
    const toast = vi.fn();
    view.setJobCenter({} as never, toast);
    const openFamily = vi.spyOn(view, "openAlignmentOnFamily").mockImplementation(() => {});

    clickAlign(root, 10);

    await vi.waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast.mock.calls[0][0]).toContain("aucune famille");
    expect(openFamily).not.toHaveBeenCalled();
  });

  it("relations illisibles : le message dit qu'on ne SAIT pas, pas qu'il n'y a pas de famille", async () => {
    // Le piège que FTS-01 vient de corriger ailleurs : sans ce cas, un échec de
    // lecture rendait le même message qu'un document réellement isolé.
    const view = new ActionsScreen();
    const root = view.render();
    document.body.appendChild(root);
    view.setConn({
      get: vi.fn(async (path: string) => {
        if (path.startsWith("/documents")) return { documents: DOCS, count: DOCS.length };
        throw new Error("boom");
      }),
      post: vi.fn(async () => ({})),
    } as unknown as Conn);
    await vi.waitFor(() => {
      expect(root.querySelectorAll("#act-doc-list tbody tr").length).toBeGreaterThan(0);
    });
    const toast = vi.fn();
    view.setJobCenter({} as never, toast);

    clickAlign(root, 11);

    await vi.waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast.mock.calls[0][0]).toContain("Relations indisponibles");
  });

  it("document en famille : ouvre la matrice sur la RACINE, pas sur lui-même", async () => {
    const { view, root } = await mountWithDocs(FAMILY);
    const openFamily = vi.spyOn(view, "openAlignmentOnFamily").mockImplementation(() => {});

    clickAlign(root, 12); // 12 est l'enfant ; sa racine est 11
    await vi.waitFor(() => expect(openFamily).toHaveBeenCalledWith(11, "matrix"));

    clickAlign(root, 11); // un parent est sa propre racine
    await vi.waitFor(() => expect(openFamily).toHaveBeenLastCalledWith(11, "matrix"));
  });
});
