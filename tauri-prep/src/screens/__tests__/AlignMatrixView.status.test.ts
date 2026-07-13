// @vitest-environment happy-dom
/**
 * Integration tests for the matrix "lignes blanches" gestures (D-W8/D8/D-W14):
 * « ∅ non traduit » per-cell set/clear (POST /align/cell_status), the « N hors
 * matrice » panel → « ＋ Ajout » (POST /units/bulk_set_status), and the ↺ of a
 * flux [ajout] row. Mounts the real AlignMatrixView against a fake Conn — the
 * pure rendering pieces are covered in lib/__tests__/alignMatrix*.test.ts.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { AlignMatrixView } from "../AlignMatrixView.ts";
import type { AlignMatrix, Conn, MatrixCellLink } from "../../lib/sidecarClient.ts";

function lk(link_id: number, target: number, raw: string, over: Partial<MatrixCellLink> = {}): MatrixCellLink {
  return { link_id, target_unit_id: target, char_start: null, char_end: null, target_text_raw: raw, ...over };
}

/** Row 0 aligned; row 1 empty (∅ candidate). One uncovered EN unit (the badge). */
const MATRIX_STATUSES: AlignMatrix = {
  headers: ["paragraphe", "segment", "fr", "en"],
  languages: ["fr", "en"],
  hub_doc_id: 2,
  rows: [
    ["1", 1, "FR un", "Hello"],
    ["1", 2, "FR deux", ""],
  ],
  hub_unit_ids: [101, 102],
  language_doc_ids: [2, 3],
  cell_links: [[[lk(11, 900, "Hello")]], [[]]],
  hub_unit_statuses: [null, null],
  cell_statuses: [[null], [null]],
  addition_rows: [],
  uncovered: [[{ unit_id: 905, n: 4, text_raw: "An addition by the translator" }]],
};

/** Row 1 carries a per-cell non_traduit mark (its ↺ clears). */
const MATRIX_MARKED: AlignMatrix = {
  ...MATRIX_STATUSES,
  rows: [
    ["1", 1, "FR un", "Hello"],
    ["1", 2, "FR deux", "[non traduit]"],
  ],
  cell_statuses: [[null], ["non_traduit"]],
  uncovered: [[]],
};

/** A flux [ajout] row woven between the two hub rows (its ↺ clears the mark). */
const MATRIX_ADDITION: AlignMatrix = {
  ...MATRIX_STATUSES,
  rows: [
    ["1", 1, "FR un", "Hello"],
    ["", "", "[ajout]", "An addition by the translator"],
    ["1", 2, "FR deux", "World"],
  ],
  hub_unit_ids: [101, null, 102],
  cell_links: [[[lk(11, 900, "Hello")]], [[]], [[lk(12, 901, "World")]]],
  hub_unit_statuses: [null, null, null],
  cell_statuses: [[null], [null], [null]],
  addition_rows: [{ row: 1, doc_id: 3, unit_id: 905, n: 4 }],
  uncovered: [[]],
};

const FAMILY = {
  family_id: 2,
  parent: { doc_id: 2, title: "Le Livre" },
  children: [],
  stats: { total_docs: 2 },
};

interface ConnOpts {
  matrix?: AlignMatrix;
  cellStatusError?: string;
  /** Projection served AFTER a /units/bulk_set_status — the server weaves the row. */
  matrixAfterStatus?: AlignMatrix;
  updated?: number;
}

function makeConn(calls: Array<{ path: string; body: unknown }>, opts: ConnOpts = {}): Conn {
  let statusPosted = false;
  return {
    baseUrl: "http://test", token: null,
    get: async (path: string) => {
      calls.push({ path, body: null });
      if (path === "/families") return { families: [FAMILY] };
      throw new Error(`unexpected GET ${path}`);
    },
    post: async (path: string, body: unknown) => {
      calls.push({ path, body });
      if (path === "/align/matrix") {
        return (statusPosted && opts.matrixAfterStatus) || opts.matrix || MATRIX_STATUSES;
      }
      if (path === "/align/cell_status") {
        if (opts.cellStatusError) throw new Error(opts.cellStatusError);
        const b = body as { pivot_unit_id: number; target_doc_id: number; status: string | null };
        return { pivot_unit_id: b.pivot_unit_id, target_doc_id: b.target_doc_id, cell_status: b.status };
      }
      if (path === "/units/bulk_set_status") {
        statusPosted = true;
        return { updated: opts.updated ?? 1 };
      }
      if (path === "/align/links/batch_update") {
        return { ok: true, applied: 2, deleted: 0, errors: [], rolled_back: false };
      }
      if (path === "/align/link/create") {
        const b = body as { pivot_unit_id: number; target_unit_id: number };
        return {
          link_id: 77, pivot_unit_id: b.pivot_unit_id, target_unit_id: b.target_unit_id,
          pivot_doc_id: 2, target_doc_id: 3, status: null, created: 1,
        };
      }
      throw new Error(`unexpected POST ${path}`);
    },
    put: async () => ({}),
  } as Conn;
}

async function mountWithMatrix(calls: Array<{ path: string; body: unknown }>, opts: ConnOpts = {}) {
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
  el.querySelector<HTMLButtonElement>("#matrix-load")!.click();
  await vi.waitFor(() => {
    expect(el.querySelector(".prep-matrix-grid")).not.toBeNull();
  });
  return { view, el, toasts, holder };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("AlignMatrixView — « ∅ non traduit » per cell (D-W8)", () => {
  it("marking an empty cell posts /align/cell_status and re-projects", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const { el, toasts } = await mountWithMatrix(calls);

    el.querySelector<HTMLButtonElement>('.prep-matrix-nt-btn[data-nt-action="set"]')!.click();
    await vi.waitFor(() => {
      expect(calls.filter((c) => c.path === "/align/matrix")).toHaveLength(2);
    });
    const post = calls.find((c) => c.path === "/align/cell_status");
    expect(post?.body).toEqual({ pivot_unit_id: 102, target_doc_id: 3, status: "non_traduit" });
    expect(toasts.some((t) => t.startsWith("✓ Cellule marquée"))).toBe(true);
  });

  it("the ↺ of a per-cell mark posts status null", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const { el } = await mountWithMatrix(calls, { matrix: MATRIX_MARKED });

    el.querySelector<HTMLButtonElement>('.prep-matrix-nt-btn[data-nt-action="clear"]')!.click();
    await vi.waitFor(() => {
      expect(calls.some((c) => c.path === "/align/cell_status")).toBe(true);
    });
    const post = calls.find((c) => c.path === "/align/cell_status");
    expect(post?.body).toEqual({ pivot_unit_id: 102, target_doc_id: 3, status: null });
  });

  it("resyncs the grid on the server guard (409 active links) — R6e", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const { el, toasts } = await mountWithMatrix(calls, {
      cellStatusError: "cell has 1 active link(s) — un-align it (↺) before marking non_traduit",
    });

    el.querySelector<HTMLButtonElement>('.prep-matrix-nt-btn[data-nt-action="set"]')!.click();
    // A 409 can only mean the grid is stale (the ∅ button is offered on cells the grid
    // shows as unlinked): re-project, or the user faces a button that re-409s forever
    // and no ↺ to click.
    await vi.waitFor(() => {
      expect(calls.filter((c) => c.path === "/align/matrix")).toHaveLength(2);
    });
    expect(toasts.some((t) => t.startsWith("✗ Non traduit") && t.includes("resynchronisée"))).toBe(true);
  });
});

/** Two fused hub rows (shared uncut target) with a flux [ajout] row woven BETWEEN them —
 *  the shape that made the cut gestures resolve against the addition row (revue R3). */
const MATRIX_FUSED_WITH_ADDITION: AlignMatrix = {
  headers: ["paragraphe", "segment", "fr", "en"],
  languages: ["fr", "en"],
  hub_doc_id: 2,
  rows: [
    ["1", 1, "FR un", "Hello there world"],
    ["", "", "[ajout]", "An addition"],
    ["1", 2, "FR deux", "Hello there world"],
  ],
  hub_unit_ids: [101, null, 102],
  language_doc_ids: [2, 3],
  cell_links: [
    [[lk(11, 900, "Hello there world")]],
    [[]],
    [[lk(12, 900, "Hello there world")]],
  ],
  hub_unit_statuses: [null, null, null],
  cell_statuses: [[null], [null], [null]],
  addition_rows: [{ row: 1, doc_id: 3, unit_id: 905, n: 2 }],
  uncovered: [[]],
};

describe("AlignMatrixView — les lignes [ajout] ne cassent pas les gestes de coupe (R3)", () => {
  it("✂ Couper resolves across a woven addition row (hub-only column)", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const { el, toasts } = await mountWithMatrix(calls, { matrix: MATRIX_FUSED_WITH_ADDITION });

    // The fused ⚠ is on the LAST view row (index 2) — one addition row above it.
    const cutBtn = el.querySelector<HTMLButtonElement>(".prep-matrix-cut-btn")!;
    expect(cutBtn.dataset.cutRow).toBe("2");
    cutBtn.click();

    // Before R3 the resolver read the addition row as « the segment above » and toasted
    // « Liens d'alignement introuvables » instead of opening the picker.
    await vi.waitFor(() => {
      expect(document.querySelector(".prep-matrix-cut-dialog")).not.toBeNull();
    });
    expect(toasts.filter((t) => t.startsWith("✗"))).toEqual([]);
    const panels = document.querySelectorAll(".prep-matrix-cut-panel");
    expect(panels[0].textContent).toContain("seg 1");   // the real hub above, not [ajout]
    expect(panels[1].textContent).toContain("seg 2");

    document.querySelector<HTMLButtonElement>("[data-cut-ok]")!.click();
    await vi.waitFor(() => {
      expect(calls.some((c) => c.path === "/align/links/batch_update")).toBe(true);
    });
    const batch = calls.find((c) => c.path === "/align/links/batch_update");
    expect(batch?.body).toMatchObject({
      actions: [
        { action: "set_target_span", link_id: 11 },
        { action: "set_target_span", link_id: 12 },
      ],
      atomic: true,
    });
  });

  it("« couper à cheval » never targets an addition row as a neighbour", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    // Hub row 0 aligned, addition row woven after it: 'down' must NOT see the addition
    // row (which has no hub unit → the confirm used to be a silent no-op).
    const { el } = await mountWithMatrix(calls, {
      matrix: {
        ...MATRIX_FUSED_WITH_ADDITION,
        rows: [
          ["1", 1, "FR un", "As far back"],
          ["", "", "[ajout]", "An addition"],
          ["1", 2, "FR deux", "It is the sound"],
        ],
        cell_links: [[[lk(13, 900, "As far back")]], [[]], [[lk(14, 901, "It is the sound")]]],
      },
    });

    el.querySelectorAll<HTMLButtonElement>(".prep-matrix-cut-any-btn")[0].click();
    await vi.waitFor(() => {
      expect(document.querySelector(".prep-matrix-cut-dialog")).not.toBeNull();
    });
    // The « fin → segment suivant » radio must name the real hub segment (2), not the
    // addition row's « 0 ».
    const dirs = document.querySelector(".prep-matrix-cut-dir")!;
    expect(dirs.textContent).toContain("(2)");
    expect(dirs.textContent).not.toContain("(0)");
    const panels = document.querySelectorAll(".prep-matrix-cut-panel");
    expect(Array.from(panels).map((p) => p.textContent).join(" ")).not.toContain("[ajout]");
  });
});

describe("AlignMatrixView — « hors matrice » panel → ＋ Ajout (D-W14/D8)", () => {
  it("the header badge opens the panel; ＋ Ajout posts unit_status='ajout' and re-projects", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    // Faithful server: after the status is posted, the projection weaves the flux row.
    const { el, toasts } = await mountWithMatrix(calls, { matrixAfterStatus: MATRIX_ADDITION });

    el.querySelector<HTMLButtonElement>(".prep-matrix-uncovered-btn")!.click();
    await vi.waitFor(() => {
      expect(document.querySelector(".prep-matrix-orphans")).not.toBeNull();
    });
    expect(document.querySelector(".prep-matrix-orphan-text")!.textContent)
      .toContain("An addition by the translator");

    document.querySelector<HTMLButtonElement>(".prep-matrix-add-choice")!.click();
    await vi.waitFor(() => {
      expect(calls.filter((c) => c.path === "/align/matrix")).toHaveLength(2);
    });
    const post = calls.find((c) => c.path === "/units/bulk_set_status");
    expect(post?.body).toEqual({ unit_ids: [905], status: "ajout" });
    expect(document.querySelector(".prep-matrix-cut-overlay")).toBeNull();
    expect(toasts.some((t) => t.startsWith("✓ Ligne [ajout]"))).toBe(true);
  });

  it("the ↺ of a flux [ajout] row clears the mark (status null)", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const { el, toasts } = await mountWithMatrix(calls, { matrix: MATRIX_ADDITION });

    el.querySelector<HTMLButtonElement>(".prep-matrix-unadd-btn")!.click();
    await vi.waitFor(() => {
      expect(calls.filter((c) => c.path === "/align/matrix")).toHaveLength(2);
    });
    const post = calls.find((c) => c.path === "/units/bulk_set_status");
    expect(post?.body).toEqual({ unit_ids: [905], status: null });
    expect(toasts.some((t) => t.startsWith("✓ Marque d'ajout retirée"))).toBe(true);
  });

  it("a vanished unit ({updated: 0}) is reported as an error, not a success — R6d", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const { el, toasts } = await mountWithMatrix(calls, { updated: 0 });

    el.querySelector<HTMLButtonElement>(".prep-matrix-uncovered-btn")!.click();
    await vi.waitFor(() => {
      expect(document.querySelector(".prep-matrix-add-choice")).not.toBeNull();
    });
    document.querySelector<HTMLButtonElement>(".prep-matrix-add-choice")!.click();
    await vi.waitFor(() => {
      expect(toasts.some((t) => t.startsWith("✗ Unité introuvable"))).toBe(true);
    });
    expect(toasts.some((t) => t.startsWith("✓"))).toBe(false);
  });
});
