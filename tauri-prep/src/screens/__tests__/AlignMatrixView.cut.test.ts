// @vitest-environment happy-dom
/**
 * Integration test for the matrix-cell « ✂ Couper » gesture (R3.3 tranche 3b).
 *
 * Mounts the real AlignMatrixView against a fake Conn (no sidecar) and drives the
 * whole flow: load matrix → fused cell shows the ✂ button → the two-panel picker
 * opens (§3.2) → confirming posts the complementary `set_target_span` pair and
 * re-projects the matrix. The pure pieces (resolution, suggestion, panels HTML)
 * are covered in lib/__tests__/alignCellCut.test.ts — this exercises the wiring.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { AlignMatrixView } from "../AlignMatrixView.ts";
import type { Conn } from "../../lib/sidecarClient.ts";

const MATRIX = {
  headers: ["paragraphe", "segment", "fr", "en"],
  languages: ["fr", "en"],
  hub_doc_id: 2,
  // Row 2 repeats row 1's translation → one fused cell (the uncut 2-1).
  rows: [
    ["1", 1, "FR un", "Hello there world"],
    ["1", 2, "FR deux", "Hello there world"],
  ],
  hub_unit_ids: [101, 102],
  language_doc_ids: [2, 3],
};

const LINKS = [
  {
    link_id: 11, external_id: null, pivot_unit_id: 101, target_unit_id: 900,
    pivot_text: "FR un", target_text: "hello there world",
    target_text_raw: "Hello there world", status: null,
  },
  {
    link_id: 12, external_id: null, pivot_unit_id: 102, target_unit_id: 900,
    pivot_text: "FR deux", target_text: "hello there world",
    target_text_raw: "Hello there world", status: null,
  },
];

const FAMILY = {
  family_id: 2,
  parent: { doc_id: 2, title: "Le Livre" },
  children: [],
  stats: { total_docs: 2 },
};

interface ConnOpts { batchResponse?: unknown }

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
      if (path === "/align/matrix") return MATRIX;
      if (path === "/align/audit") {
        return {
          ok: true, pivot_doc_id: 2, target_doc_id: 3, limit: 200, offset: 0,
          has_more: false, next_offset: null,
          stats: { links_returned: LINKS.length }, links: LINKS,
        };
      }
      if (path === "/align/links/batch_update") {
        return opts.batchResponse ?? { ok: true, applied: 2, deleted: 0, errors: [] };
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
    expect(el.querySelector(".prep-matrix-cut-btn")).not.toBeNull();
  });
  return { view, el, toasts, holder };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("AlignMatrixView — « ✂ Couper » from a fused cell (3b)", () => {
  it("opens the two-panel picker on the fused cell, pre-filled with a suggestion", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const { el } = await mountWithMatrix(calls);

    el.querySelector<HTMLButtonElement>(".prep-matrix-cut-btn")!.click();
    await vi.waitFor(() => {
      expect(document.querySelector(".prep-matrix-cut-dialog")).not.toBeNull();
    });
    // Resolution went through the audit of the hub↔EN pair (3a identifiers).
    const audit = calls.find((c) => c.path === "/align/audit");
    expect(audit?.body).toMatchObject({ pivot_doc_id: 2, target_doc_id: 3 });
    // Two panels labelled with the hub segments, suggestion applied (offset 6 →
    // "Hello" up, "there world" down: proportional to "FR un" vs "FR deux").
    const panels = document.querySelectorAll(".prep-matrix-cut-panel");
    expect(panels).toHaveLength(2);
    expect(panels[0].textContent).toContain("seg 1");
    expect(panels[0].textContent).toContain("Hello");
    expect(panels[1].textContent).toContain("seg 2");
    expect(panels[1].textContent).toContain("world");
  });

  it("confirming posts the complementary set_target_span pair and re-projects", async () => {
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
    // "there" (bottom panel) → boundary moves after it (offset 12).
    document.querySelector<HTMLButtonElement>(".prep-matrix-cut-word[data-cut-offset='12']")!.click();
    document.querySelector<HTMLButtonElement>("[data-cut-ok]")!.click();
    await vi.waitFor(() => {
      expect(calls.some((c) => c.path === "/align/links/batch_update")).toBe(true);
    });
    const batch = calls.find((c) => c.path === "/align/links/batch_update");
    expect(batch?.body).toEqual({
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
    expect(calls.filter((c) => c.path === "/align/audit")).toHaveLength(1);
  });

  it("refuses the gesture and resets the grid when the connection changed (F1)", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const { el, toasts, holder } = await mountWithMatrix(calls);

    holder.conn = makeConn(calls); // new identity = another DB behind the same screen
    document.querySelector<HTMLButtonElement>(".prep-matrix-cut-btn")!.click();
    await vi.waitFor(() => {
      expect(toasts.some((t) => t.includes("Connexion changée"))).toBe(true);
    });
    // No audit fired against the new DB with the old matrix's ids, grid is reset.
    expect(calls.filter((c) => c.path === "/align/audit")).toHaveLength(0);
    expect(el.querySelector(".prep-matrix-cut-btn")).toBeNull();
    expect(document.querySelector(".prep-matrix-cut-overlay")).toBeNull();
  });

  it("a partially applied batch closes the modal and resyncs instead of claiming refusal (F2)", async () => {
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
      // The half-commit is durable server-side → the grid MUST re-project.
      expect(calls.filter((c) => c.path === "/align/matrix")).toHaveLength(2);
    });
    expect(document.querySelector(".prep-matrix-cut-overlay")).toBeNull();
    expect(toasts.some((t) => t.includes("Coupe partielle"))).toBe(true);
    expect(toasts.some((t) => t.includes("Coupe refusée"))).toBe(false);
  });

  it("a fully refused batch (nothing applied) keeps the modal open for retry", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const { toasts } = await mountWithMatrix(calls, {
      batchResponse: {
        ok: false, applied: 0, deleted: 0,
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
