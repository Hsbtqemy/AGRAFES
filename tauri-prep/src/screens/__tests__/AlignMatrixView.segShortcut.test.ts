// @vitest-environment happy-dom
/**
 * Shortcut from the matrix to a document's Segmentation layer (Brut): a « ↗ Segmenter »
 * button on each language header (hub + translations), and a per-orphan deep-link inside the
 * « N hors matrice » panel. Both fire onOpenSegmentation, which ActionsScreen routes to
 * focusSegmentationOnUnit — reducing the source↔translation round-trip when a segmentation
 * mismatch must be fixed to align cleanly.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { AlignMatrixView } from "../AlignMatrixView.ts";
import type { AlignMatrix, Conn } from "../../lib/sidecarClient.ts";

const MATRIX: AlignMatrix = {
  headers: ["paragraphe", "segment", "fr", "en"],
  languages: ["fr", "en"],
  hub_doc_id: 2,
  language_doc_ids: [2, 3],
  rows: [["1", 1, "FR un", "EN one"]],
  hub_unit_ids: [101],
  cell_links: [[[{ link_id: 11, target_unit_id: 900, char_start: null, char_end: null, target_text_raw: "EN one" }]]],
  hub_unit_statuses: [null],
  cell_statuses: [[null]],
  uncovered: [[{ unit_id: 950, n: 7, text_raw: "love, art, the planet Earth, you, me." }]],
};

const FAMILY = { family_id: 2, parent: { doc_id: 2, title: "Le Livre" }, children: [], stats: { total_docs: 2 } };

function makeConn(): Conn {
  return {
    baseUrl: "http://test", token: null,
    get: async (path: string) => {
      if (path === "/families") return { families: [FAMILY] };
      throw new Error(`unexpected GET ${path}`);
    },
    post: async (path: string) => {
      if (path === "/align/matrix") return MATRIX;
      throw new Error(`unexpected POST ${path}`);
    },
    put: async () => ({}),
  } as Conn;
}

async function mount(seg: Array<[number, number | undefined]>) {
  const conn = makeConn(); // stable identity — else _statusGestureCtx's conn-change guard trips
  const view = new AlignMatrixView(() => conn, {
    toast: () => {},
    onOpenSegmentation: (docId, unitN) => seg.push([docId, unitN]),
  });
  const el = view.render();
  document.body.appendChild(el);
  view.onActivated();
  await vi.waitFor(() => {
    expect(el.querySelector<HTMLOptionElement>('#matrix-family option[value="2"]')).not.toBeNull();
  });
  const sel = el.querySelector<HTMLSelectElement>("#matrix-family")!;
  sel.value = "2";
  sel.dispatchEvent(new Event("change"));
  el.querySelector<HTMLButtonElement>("#matrix-load")!.click();
  await vi.waitFor(() => { expect(el.querySelector(".prep-matrix-grid")).not.toBeNull(); });
  return { view, el };
}

afterEach(() => { document.body.innerHTML = ""; });

describe("AlignMatrixView — raccourci « ↗ Segmenter »", () => {
  it("le raccourci d'en-tête ouvre la Segmentation du doc (moyeu + traduction), sans unité", async () => {
    const seg: Array<[number, number | undefined]> = [];
    const { el } = await mount(seg);
    el.querySelector<HTMLButtonElement>('.prep-matrix-seg-btn[data-seg-doc="2"]')!.click(); // hub (fr)
    el.querySelector<HTMLButtonElement>('.prep-matrix-seg-btn[data-seg-doc="3"]')!.click(); // en translation
    expect(seg).toEqual([[2, undefined], [3, undefined]]);
  });

  it("une orpheline « hors matrice » deep-linke sur son unité dans la Segmentation du bon doc", async () => {
    const seg: Array<[number, number | undefined]> = [];
    const { el } = await mount(seg);
    el.querySelector<HTMLButtonElement>(".prep-matrix-uncovered-btn")!.click(); // open the panel
    await vi.waitFor(() => { expect(document.querySelector(".prep-matrix-orphan-seg")).not.toBeNull(); });
    document.querySelector<HTMLButtonElement>(".prep-matrix-orphan-seg")!.click();
    // doc 3 (en), orphan unit n=7 — deep-link to that exact unit in Brut.
    expect(seg).toEqual([[3, 7]]);
    // The panel closes on the jump.
    expect(document.querySelector(".prep-matrix-cut-overlay")).toBeNull();
  });
});
