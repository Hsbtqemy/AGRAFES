// @vitest-environment happy-dom
/**
 * Integration tests for the matrix-cell cut gestures (R3.3 tranche 3b + D-W12).
 *
 * Mounts the real AlignMatrixView against a fake Conn (no sidecar) and drives the
 * flows end-to-end on the A2 payload (cell_links): fused ✂ → two-panel picker →
 * atomic set_target_span pair → re-projection; and the on-demand « couper à
 * cheval » → create link + atomic pair (compensated by delete on refusal). The
 * pure pieces (resolvers, suggestion, panels HTML) are covered in
 * lib/__tests__/alignCellCut.test.ts — this exercises the wiring.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { AlignMatrixView } from "../AlignMatrixView.ts";
import type { AlignMatrix, Conn, MatrixCellLink } from "../../lib/sidecarClient.ts";

function lk(link_id: number, target: number, raw: string): MatrixCellLink {
  return { link_id, target_unit_id: target, char_start: null, char_end: null, target_text_raw: raw };
}

/** Two hub rows sharing one uncut EN target (the fused 2-1 of tranche 3b). */
const MATRIX_FUSED: AlignMatrix = {
  headers: ["paragraphe", "segment", "fr", "en"],
  languages: ["fr", "en"],
  hub_doc_id: 2,
  rows: [
    ["1", 1, "FR un", "Hello there world"],
    ["1", 2, "FR deux", "Hello there world"],
  ],
  hub_unit_ids: [101, 102],
  language_doc_ids: [2, 3],
  cell_links: [
    [[lk(11, 900, "Hello there world")]],
    [[lk(12, 900, "Hello there world")]],
  ],
};

/** Two clean 1-1 rows — the Le Clézio straddle shape (EN1 spills over FR deux). */
const MATRIX_STRADDLE: AlignMatrix = {
  headers: ["paragraphe", "segment", "fr", "en"],
  languages: ["fr", "en"],
  hub_doc_id: 2,
  rows: [
    ["1", 1, "FR un", "As far back"],
    ["1", 2, "FR deux", "It is the sound"],
  ],
  hub_unit_ids: [101, 102],
  language_doc_ids: [2, 3],
  cell_links: [
    [[lk(13, 900, "As far back")]],
    [[lk(14, 901, "It is the sound")]],
  ],
};

const FAMILY = {
  family_id: 2,
  parent: { doc_id: 2, title: "Le Livre" },
  children: [],
  stats: { total_docs: 2 },
};

interface ConnOpts { batchResponse?: unknown; matrix?: AlignMatrix }

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
      if (path === "/align/matrix") return opts.matrix ?? MATRIX_FUSED;
      if (path === "/align/links/batch_update") {
        return opts.batchResponse ?? { ok: true, applied: 2, deleted: 0, errors: [], rolled_back: false };
      }
      if (path === "/align/link/create") {
        const b = body as { pivot_unit_id: number; target_unit_id: number };
        return {
          link_id: 77, pivot_unit_id: b.pivot_unit_id, target_unit_id: b.target_unit_id,
          pivot_doc_id: 2, target_doc_id: 3, status: null, created: 1,
        };
      }
      if (path === "/align/link/delete") {
        return { link_id: (body as { link_id: number }).link_id, deleted: 1 };
      }
      throw new Error(`unexpected POST ${path}`);
    },
    put: async () => ({}),
  } as Conn;
}

async function mountWithMatrix(calls: Array<{ path: string; body: unknown }>, opts: ConnOpts = {}) {
  // Mutable holder so tests can swap the connection identity (corpus switch, F1).
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

describe("AlignMatrixView — « ✂ Couper » on a fused cell (3b, via cell_links)", () => {
  it("opens the two-panel picker synchronously, pre-filled — no audit round-trip", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const { el } = await mountWithMatrix(calls);

    el.querySelector<HTMLButtonElement>(".prep-matrix-cut-btn")!.click();
    await vi.waitFor(() => {
      expect(document.querySelector(".prep-matrix-cut-dialog")).not.toBeNull();
    });
    expect(calls.some((c) => c.path === "/align/audit")).toBe(false);
    const panels = document.querySelectorAll(".prep-matrix-cut-panel");
    expect(panels).toHaveLength(2);
    expect(panels[0].textContent).toContain("seg 1");
    expect(panels[0].textContent).toContain("Hello");
    expect(panels[1].textContent).toContain("seg 2");
    expect(panels[1].textContent).toContain("world");
  });

  it("confirming posts the complementary pair as an ATOMIC batch and re-projects", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const { toasts } = await mountWithMatrix(calls);

    document.querySelector<HTMLButtonElement>(".prep-matrix-cut-btn")!.click();
    await vi.waitFor(() => {
      expect(document.querySelector("[data-cut-ok]")).not.toBeNull();
    });
    document.querySelector<HTMLButtonElement>("[data-cut-ok]")!.click();
    await vi.waitFor(() => {
      expect(calls.filter((c) => c.path === "/align/matrix")).toHaveLength(2);
    });
    const batch = calls.find((c) => c.path === "/align/links/batch_update");
    expect(batch?.body).toEqual({
      actions: [
        { action: "set_target_span", link_id: 11, char_start: 0, char_end: 6 },
        { action: "set_target_span", link_id: 12, char_start: 6, char_end: 17 },
      ],
      atomic: true,
    });
    expect(document.querySelector(".prep-matrix-cut-overlay")).toBeNull();
    expect(toasts).toContain("✓ Traduction coupée");
  });

  it("clicking a word moves the boundary before confirming", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    await mountWithMatrix(calls);

    document.querySelector<HTMLButtonElement>(".prep-matrix-cut-btn")!.click();
    await vi.waitFor(() => {
      expect(document.querySelector(".prep-matrix-cut-word[data-cut-offset='12']")).not.toBeNull();
    });
    document.querySelector<HTMLButtonElement>(".prep-matrix-cut-word[data-cut-offset='12']")!.click();
    document.querySelector<HTMLButtonElement>("[data-cut-ok]")!.click();
    await vi.waitFor(() => {
      expect(calls.some((c) => c.path === "/align/links/batch_update")).toBe(true);
    });
    const batch = calls.find((c) => c.path === "/align/links/batch_update");
    expect(batch?.body).toMatchObject({
      actions: [
        { action: "set_target_span", link_id: 11, char_start: 0, char_end: 12 },
        { action: "set_target_span", link_id: 12, char_start: 12, char_end: 17 },
      ],
    });
  });

  it("cancelling (Annuler / Escape) closes without any write", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    await mountWithMatrix(calls);

    document.querySelector<HTMLButtonElement>(".prep-matrix-cut-btn")!.click();
    await vi.waitFor(() => {
      expect(document.querySelector("[data-cut-cancel]")).not.toBeNull();
    });
    document.querySelector<HTMLButtonElement>("[data-cut-cancel]")!.click();
    expect(document.querySelector(".prep-matrix-cut-overlay")).toBeNull();
    expect(calls.some((c) => c.path === "/align/links/batch_update")).toBe(false);
  });

  it("ignores a second ✂ click while the gesture is in flight (F5)", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    await mountWithMatrix(calls);

    const btn = document.querySelector<HTMLButtonElement>(".prep-matrix-cut-btn")!;
    btn.click();
    btn.click();
    await vi.waitFor(() => {
      expect(document.querySelector(".prep-matrix-cut-dialog")).not.toBeNull();
    });
    expect(document.querySelectorAll(".prep-matrix-cut-dialog")).toHaveLength(1);
  });

  it("refuses the gesture and resets the grid when the connection changed (F1)", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const { el, toasts, holder } = await mountWithMatrix(calls);

    holder.conn = makeConn(calls); // new identity = another DB behind the same screen
    document.querySelector<HTMLButtonElement>(".prep-matrix-cut-btn")!.click();
    await vi.waitFor(() => {
      expect(toasts.some((t) => t.includes("Connexion changée"))).toBe(true);
    });
    expect(calls.some((c) => c.path === "/align/links/batch_update")).toBe(false);
    expect(el.querySelector(".prep-matrix-cut-btn")).toBeNull();
    expect(document.querySelector(".prep-matrix-cut-overlay")).toBeNull();
  });

  it("a partially applied batch (old sidecar) closes the modal and resyncs (F2 fallback)", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const { toasts } = await mountWithMatrix(calls, {
      batchResponse: {
        ok: false, applied: 1, deleted: 0,
        errors: [{ index: 1, link_id: 12, error: "link_id=12 not found" }],
      },
    });

    document.querySelector<HTMLButtonElement>(".prep-matrix-cut-btn")!.click();
    await vi.waitFor(() => {
      expect(document.querySelector("[data-cut-ok]")).not.toBeNull();
    });
    document.querySelector<HTMLButtonElement>("[data-cut-ok]")!.click();
    await vi.waitFor(() => {
      expect(calls.filter((c) => c.path === "/align/matrix")).toHaveLength(2);
    });
    expect(document.querySelector(".prep-matrix-cut-overlay")).toBeNull();
    expect(toasts.some((t) => t.includes("Coupe partielle"))).toBe(true);
  });

  it("an atomically rolled-back batch keeps the modal open for retry", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const { toasts } = await mountWithMatrix(calls, {
      batchResponse: {
        ok: false, applied: 0, deleted: 0, rolled_back: true,
        errors: [{ index: 0, link_id: 11, error: "link_id=11 not found" }],
      },
    });

    document.querySelector<HTMLButtonElement>(".prep-matrix-cut-btn")!.click();
    await vi.waitFor(() => {
      expect(document.querySelector("[data-cut-ok]")).not.toBeNull();
    });
    document.querySelector<HTMLButtonElement>("[data-cut-ok]")!.click();
    await vi.waitFor(() => {
      expect(toasts.some((t) => t.includes("Coupe refusée"))).toBe(true);
    });
    expect(document.querySelector(".prep-matrix-cut-overlay")).not.toBeNull();
    expect(calls.filter((c) => c.path === "/align/matrix")).toHaveLength(1); // no resync needed
    expect(document.querySelector<HTMLButtonElement>("[data-cut-ok]")!.disabled).toBe(false);
  });

  it("dispose() force-closes an open cut modal (F4)", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const { view } = await mountWithMatrix(calls);

    document.querySelector<HTMLButtonElement>(".prep-matrix-cut-btn")!.click();
    await vi.waitFor(() => {
      expect(document.querySelector(".prep-matrix-cut-overlay")).not.toBeNull();
    });
    view.dispose();
    expect(document.querySelector(".prep-matrix-cut-overlay")).toBeNull();
  });
});

describe("AlignMatrixView — « ✂ couper à cheval » (D-W12)", () => {
  it("cut down: creates the missing link then posts the atomic pair, head to the cell", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const { toasts } = await mountWithMatrix(calls, { matrix: MATRIX_STRADDLE });

    // Row 0's cell — its translation spills over FR deux (the Le Clézio case).
    document.querySelector<HTMLButtonElement>('.prep-matrix-cut-any-btn[data-cut-row="0"]')!.click();
    await vi.waitFor(() => {
      expect(document.querySelector(".prep-matrix-cut-dialog")).not.toBeNull();
    });
    // No row above → "up" disabled, "down" pre-selected.
    const up = document.querySelector<HTMLInputElement>('input[name="prep-matrix-cut-dir"][value="up"]')!;
    const down = document.querySelector<HTMLInputElement>('input[name="prep-matrix-cut-dir"][value="down"]')!;
    expect(up.disabled).toBe(true);
    expect(down.checked).toBe(true);

    document.querySelector<HTMLButtonElement>("[data-cut-ok]")!.click();
    await vi.waitFor(() => {
      expect(calls.filter((c) => c.path === "/align/matrix")).toHaveLength(2); // re-projected
    });
    // The missing link goes to the NEIGHBOUR hub unit (FR deux = 102), same target.
    const create = calls.find((c) => c.path === "/align/link/create");
    expect(create?.body).toEqual({ pivot_unit_id: 102, target_unit_id: 900 });
    // "down": the cell keeps the head, the created link takes the tail — atomically.
    // Suggested boundary on "As far back" (hubs "FR un"/"FR deux") = 3.
    const batch = calls.find((c) => c.path === "/align/links/batch_update");
    expect(batch?.body).toEqual({
      actions: [
        { action: "set_target_span", link_id: 13, char_start: 0, char_end: 3 },
        { action: "set_target_span", link_id: 77, char_start: 3, char_end: 11 },
      ],
      atomic: true,
    });
    expect(toasts).toContain("✓ Traduction coupée à cheval");
    expect(document.querySelector(".prep-matrix-cut-overlay")).toBeNull();
  });

  it("a refused batch deletes the created link in compensation and keeps the modal open", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const { toasts } = await mountWithMatrix(calls, {
      matrix: MATRIX_STRADDLE,
      batchResponse: {
        ok: false, applied: 0, deleted: 0, rolled_back: true,
        errors: [{ index: 0, link_id: 13, error: "conflit" }],
      },
    });

    document.querySelector<HTMLButtonElement>('.prep-matrix-cut-any-btn[data-cut-row="0"]')!.click();
    await vi.waitFor(() => {
      expect(document.querySelector("[data-cut-ok]")).not.toBeNull();
    });
    document.querySelector<HTMLButtonElement>("[data-cut-ok]")!.click();
    await vi.waitFor(() => {
      expect(toasts.some((t) => t.includes("Coupe à cheval refusée"))).toBe(true);
    });
    const del = calls.find((c) => c.path === "/align/link/delete");
    expect(del?.body).toEqual({ link_id: 77 });
    expect(document.querySelector(".prep-matrix-cut-overlay")).not.toBeNull();
    expect(calls.filter((c) => c.path === "/align/matrix")).toHaveLength(1); // nothing changed
  });
});
