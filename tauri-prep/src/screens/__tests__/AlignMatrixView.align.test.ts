// @vitest-environment happy-dom
/**
 * Integration tests for the « ⇄ Aligner » bar of the matrix (R3.3 tranche 5, §4).
 *
 * The pain this closes: the alignment mode was buried in the Settings and opaque — you
 * had to choose a strategy before doing anything. Here the button runs on an assumed
 * default (lengths/DP) and the mode is a fold-away. And the silent footgun: re-running
 * the aligner on an already-aligned family adds NOTHING (existing links are kept), which
 * used to report a hollow success — the bar now makes the choice explicit.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { AlignMatrixView } from "../AlignMatrixView.ts";
import type { AlignMatrix, Conn, MatrixCellLink } from "../../lib/sidecarClient.ts";

function lk(link_id: number, target: number, raw: string): MatrixCellLink {
  return { link_id, target_unit_id: target, char_start: null, char_end: null, target_text_raw: raw };
}

/** An ALIGNED family (the matrix carries links) — the re-run confirm case. */
const MATRIX_ALIGNED: AlignMatrix = {
  headers: ["paragraphe", "segment", "fr", "en"],
  languages: ["fr", "en"],
  hub_doc_id: 2,
  rows: [["1", 1, "FR un", "EN one"]],
  hub_unit_ids: [101],
  language_doc_ids: [2, 3],
  cell_links: [[[lk(11, 900, "EN one")]]],
};

/** A family with NO link yet — pressing Aligner must run straight away. */
const MATRIX_EMPTY: AlignMatrix = {
  ...MATRIX_ALIGNED,
  rows: [["1", 1, "FR un", ""]],
  cell_links: [[[]]],
};

const FAMILY = {
  family_id: 2,
  parent: { doc_id: 2, title: "Le Livre" },
  children: [],
  stats: { total_docs: 2 },
};

interface ConnOpts { matrix?: AlignMatrix; linksCreated?: number }

function makeConn(calls: Array<{ path: string; body: unknown }>, opts: ConnOpts = {}): Conn {
  return {
    baseUrl: "http://test", token: null,
    get: async (path: string) => {
      calls.push({ path, body: null });
      if (path === "/families") return { families: [FAMILY] };
      throw new Error(`unexpected GET ${path}`);
    },
    post: async (path: string, body: unknown) => {
      calls.push({ path, body });
      if (path === "/align/matrix") return opts.matrix ?? MATRIX_ALIGNED;
      if (path === "/families/2/align") {
        return {
          family_root_id: 2, strategy: "length_bounded", results: [],
          summary: {
            total_pairs: 1, aligned: 1, skipped: 0, conflicts: 0, errors: 0,
            total_links_created: opts.linksCreated ?? 7,
          },
        };
      }
      throw new Error(`unexpected POST ${path}`);
    },
    put: async () => ({}),
  } as Conn;
}

async function mount(calls: Array<{ path: string; body: unknown }>, opts: ConnOpts = {}) {
  const holder = { conn: makeConn(calls, opts) };
  const toasts: string[] = [];
  const view = new AlignMatrixView(() => holder.conn, { toast: (m) => toasts.push(m) });
  const el = view.render();
  document.body.appendChild(el);
  view.onActivated();
  await vi.waitFor(() => {
    expect(el.querySelector<HTMLOptionElement>('#matrix-family option[value="2"]')).not.toBeNull();
  });
  const sel = el.querySelector<HTMLSelectElement>("#matrix-family")!;
  sel.value = "2";
  sel.dispatchEvent(new Event("change"));
  return { view, el, toasts, holder };
}

async function mountLoaded(calls: Array<{ path: string; body: unknown }>, opts: ConnOpts = {}) {
  const m = await mount(calls, opts);
  m.el.querySelector<HTMLButtonElement>("#matrix-load")!.click();
  await vi.waitFor(() => {
    expect(m.el.querySelector(".prep-matrix-grid")).not.toBeNull();
  });
  return m;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("AlignMatrixView — barre « Aligner » (tranche 5)", () => {
  it("the buttons need a family; the mode is folded away, not a prerequisite", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const { el } = await mount(calls);

    // A family is selected → Aligner is live WITHOUT having opened « Avancé ».
    expect(el.querySelector<HTMLButtonElement>("#matrix-align")!.disabled).toBe(false);
    const adv = el.querySelector<HTMLElement>("#matrix-align-adv")!;
    expect(adv.hasAttribute("hidden")).toBe(true);

    el.querySelector<HTMLButtonElement>("#matrix-align-adv-toggle")!.click();
    expect(adv.hasAttribute("hidden")).toBe(false);
    // The similarity threshold only shows for the strategy that uses it.
    const simField = el.querySelector<HTMLElement>("#matrix-align-sim-field")!;
    expect(simField.hasAttribute("hidden")).toBe(true);
    const strategy = el.querySelector<HTMLSelectElement>("#matrix-align-strategy")!;
    strategy.value = "similarity";
    strategy.dispatchEvent(new Event("change"));
    expect(simField.hasAttribute("hidden")).toBe(false);
  });

  it("on an UNALIGNED family, « Aligner » runs the assumed default and re-projects", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const { el, toasts } = await mountLoaded(calls, { matrix: MATRIX_EMPTY });

    el.querySelector<HTMLButtonElement>("#matrix-align")!.click();
    await vi.waitFor(() => {
      expect(calls.some((c) => c.path === "/families/2/align")).toBe(true);
    });
    const run = calls.find((c) => c.path === "/families/2/align");
    expect(run?.body).toEqual({
      strategy: "length_bounded",
      preserve_accepted: true,
      replace_existing: false,
      skip_unready: true,
    });
    // The grid is re-projected so the result is visible at once — the point of the bar.
    await vi.waitFor(() => {
      expect(calls.filter((c) => c.path === "/align/matrix")).toHaveLength(2);
    });
    expect(toasts.some((t) => t.includes("7 liens créés"))).toBe(true);
  });

  it("« Avancé » overrides the mode (and its threshold)", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const { el } = await mountLoaded(calls, { matrix: MATRIX_EMPTY });

    el.querySelector<HTMLButtonElement>("#matrix-align-adv-toggle")!.click();
    const strategy = el.querySelector<HTMLSelectElement>("#matrix-align-strategy")!;
    strategy.value = "similarity";
    strategy.dispatchEvent(new Event("change"));
    el.querySelector<HTMLInputElement>("#matrix-align-sim")!.value = "0.6";
    el.querySelector<HTMLInputElement>("#matrix-align-preserve")!.checked = false;

    el.querySelector<HTMLButtonElement>("#matrix-align")!.click();
    await vi.waitFor(() => {
      expect(calls.some((c) => c.path === "/families/2/align")).toBe(true);
    });
    expect(calls.find((c) => c.path === "/families/2/align")?.body).toEqual({
      strategy: "similarity",
      preserve_accepted: false,
      replace_existing: false,
      skip_unready: true,
      sim_threshold: 0.6,
    });
  });

  it("on an ALIGNED family, the silent choice becomes explicit (compléter / recalculer)", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const { el } = await mountLoaded(calls);  // MATRIX_ALIGNED carries a link

    el.querySelector<HTMLButtonElement>("#matrix-align")!.click();
    // No run fired: the user must say what they mean.
    expect(calls.some((c) => c.path === "/families/2/align")).toBe(false);
    expect(el.querySelector("#matrix-align-complete")).not.toBeNull();

    el.querySelector<HTMLButtonElement>("#matrix-align-recalc")!.click();
    await vi.waitFor(() => {
      expect(calls.some((c) => c.path === "/families/2/align")).toBe(true);
    });
    // « Recalcul global » = the flat rewrite the engine would otherwise never do.
    expect(calls.find((c) => c.path === "/families/2/align")?.body).toMatchObject({
      replace_existing: true,
      preserve_accepted: true,
    });
  });

  it("a run that adds nothing says so instead of reporting a hollow success", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const { el, toasts } = await mountLoaded(calls, { linksCreated: 0 });

    el.querySelector<HTMLButtonElement>("#matrix-align")!.click();
    el.querySelector<HTMLButtonElement>("#matrix-align-complete")!.click();
    await vi.waitFor(() => {
      expect(calls.some((c) => c.path === "/families/2/align")).toBe(true);
    });
    await vi.waitFor(() => {
      expect(toasts.some((t) => t.includes("Aucun lien ajouté"))).toBe(true);
    });
    expect(toasts.some((t) => t.startsWith("✓"))).toBe(false);
  });
});
