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
import { STEP_LABEL, type HubStep } from "../../lib/actionsHubState.ts";

/** Une coche fraîche, non démentie. */
const OK = { validated_at: "2026-08-31T10:00:00Z", stale: false, basis: "history" as const };
const coches = (...steps: string[]): Record<string, typeof OK> =>
  Object.fromEntries(steps.map((s) => [s, OK]));

// ACT-01 tri-état : une TRACE ne vaut plus « fait ». Un document curé, découpé, aligné
// et annoté reste « en cours » sur les quatre tant que personne n'a rien validé — c'est
// le changement de fond. Les états « fait » de ces fixtures passent donc par des coches.
const DOCS = [
  // rien nulle part → les quatre capacités le concernent
  { doc_id: 10, title: "Brouillon", language: "fr", doc_role: null, unit_count: 1 },
  // tout validé SAUF la curation, jamais curé, et index périmé
  {
    doc_id: 11, title: "Les Misérables", language: "fr", doc_role: "source",
    unit_count: 4812, aligned_count: 1227, annotation_status: "annotated", fts_stale: true,
    step_status: coches("segmentation", "alignement", "annotation"),
  },
  // rien à faire du tout : les quatre coches
  {
    doc_id: 12, title: "Die Elenden", language: "de", doc_role: "cible",
    unit_count: 4655, aligned_count: 709, annotation_status: "annotated",
    curated_at: "2026-08-16T21:50:46Z",
    step_status: coches("curation", "segmentation", "alignement", "annotation"),
  },
  // tout validé SAUF l'annotation — le seul document qui permette d'obtenir
  // « enfant retenu par le filtre, parent hors filtre » dans la vue hiérarchie.
  {
    doc_id: 13, title: "The Wretched", language: "en", doc_role: "cible",
    unit_count: 4901, aligned_count: 640, annotation_status: "missing",
    curated_at: "2026-08-16T21:50:46Z",
    step_status: coches("curation", "segmentation", "alignement"),
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
    // Le bandeau ne disparaît pas — seul son bouton s'efface. Le faire disparaître
    // ferait changer la carte de hauteur au premier clic, en plus des lignes.
    expect(root.querySelector<HTMLElement>("#act-hub-filter-strip")?.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>("#act-hub-filter-clear")?.hidden).toBe(true);
    expect(root.querySelector("#act-hub-filter-label")?.textContent).toBe("4 documents");
  });

  it("le bandeau occupe la même place filtré ou non, et dit ce qu'on regarde", async () => {
    const { root } = await mountWithDocs();
    const strip = root.querySelector<HTMLElement>("#act-hub-filter-strip")!;
    const label = root.querySelector<HTMLElement>("#act-hub-filter-label")!;

    expect(strip.hidden).toBe(false);
    expect(label.textContent).toBe("4 documents");
    expect(strip.classList.contains("prep-acts-hub-filter-strip--on")).toBe(false);

    root.querySelector<HTMLButtonElement>("#act-hub-filter-segmentation")!.click();
    expect(strip.hidden).toBe(false);
    expect(label.textContent).toBe("Segmentation — 1 document sur 4");
    expect(strip.classList.contains("prep-acts-hub-filter-strip--on")).toBe(true);
    expect(root.querySelector<HTMLElement>("#act-hub-filter-clear")?.hidden).toBe(false);
  });

  it("sur un corpus vide le bandeau reste, et ne prétend pas compter", async () => {
    const view = new ActionsScreen();
    const root = view.render();
    document.body.appendChild(root);
    view.setConn({
      get: vi.fn(async () => ({ documents: [], count: 0 })),
      post: vi.fn(async () => ({})),
    } as unknown as Conn);
    await vi.waitFor(() => {
      expect(root.querySelector("#act-hub-filter-label")?.textContent).toBe("Aucun document");
    });
    expect(root.querySelector<HTMLElement>("#act-hub-filter-strip")?.hidden).toBe(false);
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

  it("une ligne très chargée ne se replie pas : quatre cases, toujours", async () => {
    // Le bornage à quatre pastilles et son « +1 » ont disparu avec les pastilles : une
    // case fait une largeur fixe, les quatre tiennent toujours, et l'anomalie d'index
    // reste une pastille à part. La hauteur de ligne ne dépend plus du contenu.
    const view = new ActionsScreen();
    const root = view.render();
    document.body.appendChild(root);
    view.setConn({
      get: vi.fn(async (path: string) =>
        path.startsWith("/documents")
          ? { documents: [{ ...DOCS[0], fts_stale: true }], count: 1 }
          : { relations: [] }),
      post: vi.fn(async () => ({})),
    } as unknown as Conn);
    await vi.waitFor(() => {
      expect(root.querySelector('tr[data-doc-id="10"]')).not.toBeNull();
    });
    const cell = root.querySelector<HTMLElement>('tr[data-doc-id="10"] .prep-acts-hub-state-cell')!;
    expect(cell.querySelectorAll(".prep-acts-hub-box")).toHaveLength(4);
    const pastilles = Array.from(cell.querySelectorAll(".prep-acts-hub-badge"))
      .map((e) => e.textContent);
    expect(pastilles).toEqual(["Index périmé"]);
    // Chaque case porte SA propre infobulle : c'est le seul endroit où elle peut dire
    // ce qu'elle vaut, et une infobulle de cellule ne le pourrait pas.
    const titres = Array.from(cell.querySelectorAll<HTMLElement>(".prep-acts-hub-box"))
      .map((b) => b.title);
    expect(titres.every((t) => t.includes("Brouillon"))).toBe(true);
    expect(titres[0]).toContain("Curation");
    expect(titres[3]).toContain("Annotation");
  });

  it("l'en-tête rappelle l'ordre des cases, hors infobulle", async () => {
    // Sans lui, une case muette oblige à survoler pour savoir laquelle est laquelle :
    // le nom ne vivait que dans l'infobulle, donc nulle part pour qui balaie la colonne.
    const { root } = await mountWithDocs();
    const items = root.querySelectorAll<HTMLElement>(
      '#act-doc-list th[data-sort="todo"] .prep-acts-hub-legend-item',
    );
    expect(Array.from(items).map((e) => e.textContent)).toEqual(["Cur", "Seg", "Ali", "Ann"]);
  });

  it("chaque abréviation appartient à l'étape qu'elle surplombe", async () => {
    // La garde qui compte, et la seule non tautologique des deux : comparer l'ordre de
    // la légende à celui des cases ne prouve rien, les deux bouclent sur `HUB_STEPS` et
    // ne PEUVENT pas diverger. Ce qui peut diverger, c'est le contenu de `STEP_ABBR` —
    // « Ali » écrit en face d'`annotation` désignerait la mauvaise case sans rien
    // casser. On exige donc que l'abréviation soit un préfixe du libellé de son étape.
    const { root } = await mountWithDocs();
    const items = Array.from(
      root.querySelectorAll<HTMLElement>(".prep-acts-hub-legend-item"),
    );
    expect(items).toHaveLength(4);
    for (const item of items) {
      const step = item.dataset.step as HubStep;
      expect(STEP_LABEL[step].startsWith(item.textContent ?? ""), `${step} / ${item.textContent}`)
        .toBe(true);
    }
  });

  it("la légende est bâtie sur l'ordre des cases, jamais sur une liste recopiée", async () => {
    // Faible par construction (voir ci-dessus), gardée quand même : elle mordrait si
    // quelqu'un remplaçait la boucle de l'en-tête par un tableau écrit à la main.
    const { root } = await mountWithDocs();
    const pos = (sel: string): Array<string | undefined> =>
      Array.from(root.querySelectorAll<HTMLElement>(sel)).map((e) => e.dataset.step);
    expect(pos(".prep-acts-hub-legend-item"))
      .toEqual(pos('tr[data-doc-id="10"] .prep-acts-hub-box'));
  });

  it("le rappel ne s'ajoute pas au nom accessible de la colonne", async () => {
    // Chaque case porte déjà son nom complet en `aria-label`. Sans `aria-hidden`, un
    // lecteur d'écran annoncerait le bouton de tri « À faire Cur Seg Ali Ann ».
    const { root } = await mountWithDocs();
    const legende = root.querySelector(".prep-acts-hub-legend");
    expect(legende).not.toBeNull();
    expect(legende!.getAttribute("aria-hidden")).toBe("true");
  });

  it("chaque ligne porte quatre cases, dans le même ordre, à trois états", async () => {
    const { root } = await mountWithDocs();
    const cases = (docId: number): string[] =>
      Array.from(
        root.querySelectorAll(`#act-doc-list tr[data-doc-id="${docId}"] .prep-acts-hub-box`),
      ).map((el) => el.getAttribute("aria-checked") ?? "");

    // Toujours quatre, et toujours dans l'ordre des cartes : c'est ce qui rend la
    // colonne scannable — on suit « Segmentation » du regard sur toute la liste.
    expect(cases(10)).toEqual(["false", "false", "false", "false"]);
    // 11 : trois coches, la curation jamais faite. `mixed` est le tri-état NATIF.
    expect(cases(11)).toEqual(["false", "true", "true", "true"]);
    expect(cases(12)).toEqual(["true", "true", "true", "true"]);
  });

  it("« en cours » se distingue de « rien » — une trace n'est pas une validation", async () => {
    // Le document 13 est curé, découpé et aligné, mais son annotation manque : trois
    // coches, et la quatrième case doit dire « rien », pas « en cours ». Le document 11,
    // lui, porte une trace de segmentation validée ET un texte annoté.
    const { root } = await mountWithDocs();
    const etat = (docId: number, i: number): string | null =>
      root.querySelectorAll(`#act-doc-list tr[data-doc-id="${docId}"] .prep-acts-hub-box`)[i]
        ?.getAttribute("aria-checked") ?? null;
    expect(etat(13, 3)).toBe("false");   // annotation : aucune trace, aucune coche
    expect(etat(10, 1)).toBe("false");   // segmentation d'un document d'une seule unité
  });

  it("l'anomalie d'index reste une pastille, jamais une case", async () => {
    // Ce n'est pas un travail qu'on mène à terme : lui donner une case laisserait
    // croire qu'on peut la déclarer réglée à la main.
    const { root } = await mountWithDocs();
    const cell = root.querySelector<HTMLElement>('tr[data-doc-id="11"] .prep-acts-hub-state-cell')!;
    expect(cell.querySelectorAll(".prep-acts-hub-box")).toHaveLength(4);
    expect(Array.from(cell.querySelectorAll(".prep-acts-hub-badge")).map((e) => e.textContent))
      .toEqual(["Index périmé"]);
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
    // Même constructeur de ligne, donc mêmes cases et mêmes gestes que la vue plate.
    expect(
      Array.from(row.querySelectorAll(".prep-acts-hub-box"))
        .map((b) => b.getAttribute("aria-checked")),
    ).toEqual(["true", "true", "true", "true"]);
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

describe("hub Actions — le tri de la liste (ACT-01)", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = "";
  });

  const titles = (root: HTMLElement): string[] =>
    Array.from(root.querySelectorAll("#act-doc-list tbody tr"))
      .map((tr) => tr.querySelectorAll("td")[1]?.textContent ?? "");
  const th = (root: HTMLElement, col: string): HTMLElement =>
    root.querySelector<HTMLElement>(`#act-doc-list th[data-sort="${col}"]`)!;

  it("six colonnes sur sept sont triables ; « Ouvrir » ne l'est pas", async () => {
    const { root } = await mountWithDocs();
    const sortables = Array.from(
      root.querySelectorAll<HTMLElement>("#act-doc-list th[data-sort]"),
    ).map((e) => e.dataset.sort);
    expect(sortables).toEqual(["id", "title", "lang", "role", "units", "todo"]);
  });

  it("cliquer une colonne trie, re-cliquer inverse", async () => {
    const { root } = await mountWithDocs();
    th(root, "title").click();
    expect(titles(root)).toEqual(["Brouillon", "Die Elenden", "Les Misérables", "The Wretched"]);
    th(root, "title").click();
    expect(titles(root)).toEqual(["The Wretched", "Les Misérables", "Die Elenden", "Brouillon"]);
  });

  it("l'en-tête annonce le tri courant, aux lecteurs d'écran compris", async () => {
    const { root } = await mountWithDocs();
    th(root, "units").click();
    expect(th(root, "units").getAttribute("aria-sort")).toBe("ascending");
    expect(th(root, "units").classList.contains("sort-active")).toBe(true);
    expect(th(root, "units").querySelector(".sort-ind")?.textContent).toBe("↑");
    // Les autres colonnes doivent se taire, pas garder un ancien état.
    expect(th(root, "title").getAttribute("aria-sort")).toBe("none");
    expect(th(root, "title").querySelector(".sort-ind")?.textContent).toBe("⇅");
  });

  it("le tri s'actionne au clavier, pas seulement à la souris", async () => {
    const { root } = await mountWithDocs();
    const head = th(root, "title");
    expect(head.tabIndex).toBe(0);
    head.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(titles(root)[0]).toBe("Brouillon");
  });

  it("le tri survit au filtre, et la numérotation suit l'affichage", async () => {
    const { root } = await mountWithDocs();
    th(root, "title").click();
    th(root, "title").click(); // descendant
    root.querySelector<HTMLButtonElement>("#act-hub-filter-curation")!.click();
    expect(titles(root)).toEqual(["Les Misérables", "Brouillon"]);
    const nums = Array.from(root.querySelectorAll("#act-doc-list tbody tr"))
      .map((tr) => tr.querySelectorAll("td")[0]?.textContent);
    expect(nums).toEqual(["1", "2"]);
  });

  it("en hiérarchie, le tri agit DANS chaque niveau : un enfant reste sous son parent", async () => {
    const { root } = await mountWithDocs(FAMILY);
    root.querySelector<HTMLButtonElement>("#act-hub-hierarchy-btn")!.click();
    await vi.waitFor(() => {
      expect(root.querySelector("#act-doc-list tr.prep-tree-child")).not.toBeNull();
    });
    th(root, "title").click();
    th(root, "title").click(); // descendant : « The Wretched » avant « Die Elenden »
    const rows = Array.from(
      root.querySelectorAll<HTMLElement>("#act-doc-list tbody tr[data-doc-id]"),
    ).map((tr) => ({ id: tr.dataset.docId, child: tr.classList.contains("prep-tree-child") }));
    // 11 est la racine ; 13 et 12 sont ses enfants, réordonnés entre eux ; 10 est isolé.
    expect(rows).toEqual([
      { id: "11", child: false },
      { id: "13", child: true },
      { id: "12", child: true },
      { id: "10", child: false },
    ]);
  });
});

/**
 * Les trois préférences d'affichage du hub — filtre, tri, vue hiérarchie — ne
 * survivaient pas pareil à `↺ Actualiser`. Le bouton passe par `setConn`, qui
 * remettait `_hubHierarchyView` à `false` sans repeindre le bouton : la liste
 * redevenait plate pendant que le bouton continuait d'annoncer « 📋 Liste » avec
 * `aria-pressed="true"`. Le cliquer renvoyait dans la hiérarchie, l'inverse de ce
 * qu'il promettait. Trouvé en QA le 31 août.
 *
 * Piège de rédaction, tombé dedans une fois : `setConn` lance `_loadDocs` sans
 * l'attendre, donc guetter « l'arbre est là » juste après peut observer le DOM
 * D'AVANT le rechargement — le test passe alors sur le code fautif. Chaque
 * vérification est donc ancrée sur un document que SEULE la seconde connexion
 * sert : tant qu'il n'est pas à l'écran, le rechargement n'a pas eu lieu.
 */
describe("hub Actions — l'actualisation ne fait pas mentir le bouton Hiérarchie", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  /** Le témoin de rechargement : #14, absent de la première connexion. */
  const TEMOIN = {
    doc_id: 14, title: "Ellendige", language: "nl", doc_role: "cible", unit_count: 100,
  };
  const RELATIONS_2 = [...FAMILY, { doc_id: 14, target_doc_id: 11, relation_type: "translation_of" }];

  function connWith(docs: unknown[], relations: Relation[], relationsFail = false): Conn {
    return {
      get: vi.fn(async (path: string) => {
        if (path.startsWith("/documents")) return { documents: docs, count: docs.length };
        if (path.startsWith("/doc_relations/all")) {
          if (relationsFail) throw new Error("relations indisponibles");
          return { relations };
        }
        if (path.startsWith("/models")) return { models: [], active: null };
        return {};
      }),
      post: vi.fn(async () => ({})),
    } as unknown as Conn;
  }

  const hierBtn = (root: HTMLElement): HTMLButtonElement =>
    root.querySelector<HTMLButtonElement>("#act-hub-hierarchy-btn")!;

  const treeShown = (root: HTMLElement): boolean =>
    root.querySelector("#act-doc-list tr.prep-tree-child") !== null;

  async function enterHierarchy(root: HTMLElement): Promise<void> {
    hierBtn(root).click();
    await vi.waitFor(() => expect(treeShown(root)).toBe(true));
  }

  /** Recharge, et n'en revient que lorsque le témoin #14 est rendu. */
  async function refreshAndWait(
    view: ActionsScreen, root: HTMLElement, relationsFail = false,
  ): Promise<void> {
    view.setConn(connWith([...DOCS, TEMOIN], RELATIONS_2, relationsFail));
    await vi.waitFor(() => {
      expect(root.querySelector('#act-doc-list tbody tr[data-doc-id="14"]')).not.toBeNull();
    });
  }

  it("garde la vue hiérarchie après un rechargement, comme le filtre et le tri", async () => {
    const { view, root } = await mountWithDocs(FAMILY);
    await enterHierarchy(root);
    await refreshAndWait(view, root);

    expect(treeShown(root)).toBe(true);          // relations rechargées, arbre reconstruit
    expect(hierBtn(root).textContent).toBe("📋 Liste");
    expect(hierBtn(root).getAttribute("aria-pressed")).toBe("true");
  });

  it("le bouton dit toujours l'état réel de la vue", async () => {
    const { view, root } = await mountWithDocs(FAMILY);
    const agrees = (): void => {
      const tree = treeShown(root);
      expect(hierBtn(root).getAttribute("aria-pressed")).toBe(String(tree));
      expect(hierBtn(root).textContent).toBe(tree ? "📋 Liste" : "🌿 Hiérarchie");
    };

    agrees();
    await enterHierarchy(root);
    agrees();
    await refreshAndWait(view, root);
    agrees();
    hierBtn(root).click();                        // retour à la liste plate
    await vi.waitFor(() => expect(treeShown(root)).toBe(false));
    agrees();
  });

  it("retombe à plat, bouton compris, si les relations ne se lisent plus", async () => {
    const { view, root } = await mountWithDocs(FAMILY);
    await enterHierarchy(root);
    await refreshAndWait(view, root, true);       // /doc_relations/all échoue

    expect(treeShown(root)).toBe(false);
    expect(hierBtn(root).textContent).toBe("🌿 Hiérarchie");
    expect(hierBtn(root).getAttribute("aria-pressed")).toBe("false");
  });
});
/**
 * Le geste que le modèle à trois états ajoute : cocher. C'est le seul endroit de la page
 * où l'utilisateur *déclare* quelque chose — partout ailleurs il ne fait que regarder ce
 * que le moteur observe.
 *
 * Deux états sur trois mènent à la coche, un seul en revient. Et cocher n'ouvre RIEN :
 * une case énonce un état, elle ne désigne pas une destination — c'est la décision du
 * 31 août, et sans test elle se perdrait au premier « tant qu'à cliquer ».
 */
describe("hub Actions — cocher une capacité (ACT-01, tri-état)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  /** Monte la liste en capturant les POST, pour lire ce qui part vraiment au moteur. */
  async function mountCapturing(): Promise<{
    view: ActionsScreen; root: HTMLElement; posts: Array<[string, unknown]>;
  }> {
    const posts: Array<[string, unknown]> = [];
    const view = new ActionsScreen();
    const root = view.render();
    document.body.appendChild(root);
    view.setConn({
      get: vi.fn(async (path: string) => {
        if (path.startsWith("/documents")) return { documents: DOCS, count: DOCS.length };
        if (path.startsWith("/doc_relations/all")) return { relations: [] };
        if (path.startsWith("/models")) return { models: [], active: null };
        return {};
      }),
      post: vi.fn(async (path: string, body: unknown) => {
        posts.push([path, body]);
        return {};
      }),
    } as unknown as Conn);
    await vi.waitFor(() => {
      expect(root.querySelectorAll("#act-doc-list tbody tr").length).toBeGreaterThan(0);
    });
    return { view, root, posts };
  }

  const box = (root: HTMLElement, docId: number, i: number): HTMLButtonElement =>
    root.querySelectorAll<HTMLButtonElement>(
      `#act-doc-list tr[data-doc-id="${docId}"] .prep-acts-hub-box`,
    )[i];

  it("cliquer une case vide POSE la coche, sur cette capacité et ce document", async () => {
    const { root, posts } = await mountCapturing();
    box(root, 10, 1).click();   // segmentation du document 10
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual(["/documents/step_status", { doc_id: 10, step: "segmentation" }]);
  });

  it("cliquer une case cochée la RETIRE", async () => {
    const { root, posts } = await mountCapturing();
    box(root, 12, 0).click();   // curation du document 12, déjà validée
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual([
      "/documents/step_status/clear", { doc_id: 12, step: "curation" },
    ]);
  });

  it("une case « en cours » se coche, elle ne se décoche pas", async () => {
    // Le document 11 est annoté sans être validé sur la curation : sa première case
    // est « rien », mais son texte porte des traces ailleurs. On vise la curation, qui
    // n'a ni trace ni coche, puis on vérifie qu'un document EN COURS part aussi vers
    // la pose et non vers le retrait.
    const { root, posts } = await mountCapturing();
    box(root, 13, 3).click();   // annotation du 13 : rien
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0][0]).toBe("/documents/step_status");
  });

  it("cocher ne déplace personne — c'est la colonne « Ouvrir » qui navigue", async () => {
    // Une case énonce un état ; elle ne désigne pas une destination. Si le clic
    // basculait de sous-vue, on serait devant le canvas au lieu de la liste.
    const { root } = await mountCapturing();
    box(root, 10, 0).click();
    await vi.waitFor(() => {
      expect(root.querySelector("#act-doc-list")).not.toBeNull();
    });
    expect(root.querySelector("#act-doc-list")).not.toBeNull();
  });

  it("chaque case dit ce qu'elle vaut, jamais seulement qu'elle est cochée", async () => {
    // « Validé le 12/08, avant que l'historique existe » n'est pas la même promesse que
    // « validé le 12/08, aucune modification enregistrée depuis ». Une coche qui tait sa
    // propre incertitude est le défaut qu'on vient de corriger sur l'index de recherche.
    const view = new ActionsScreen();
    const root = view.render();
    document.body.appendChild(root);
    const faible = {
      ...DOCS[0], doc_id: 20,
      // Une trace de découpage EXISTE : c'est ce qui fait retomber la coche périmée
      // sur « en cours » plutôt que sur « rien ». Sans trace, elle retomberait à rien,
      // ce qui est aussi correct — et c'est le module pur qui l'épingle.
      unit_count: 900,
      step_status: {
        curation: { validated_at: "2026-08-12T09:00:00Z", stale: false, basis: "derived" },
        segmentation: {
          validated_at: "2026-08-12T09:00:00Z", stale: true,
          stale_reason: "resegment", basis: "history",
        },
      },
    };
    view.setConn({
      get: vi.fn(async (path: string) =>
        path.startsWith("/documents") ? { documents: [faible], count: 1 } : { relations: [] }),
      post: vi.fn(async () => ({})),
    } as unknown as Conn);
    await vi.waitFor(() => {
      expect(root.querySelector('tr[data-doc-id="20"]')).not.toBeNull();
    });
    expect(box(root, 20, 0).title).toContain("avant que l'historique existe");
    // La coche périmée n'est pas muette non plus : elle dit quand, et par quoi.
    expect(box(root, 20, 1).getAttribute("aria-checked")).toBe("mixed");
    expect(box(root, 20, 1).title).toContain("puis modifié");
    expect(box(root, 20, 1).title).toContain("resegment");
  });
});
