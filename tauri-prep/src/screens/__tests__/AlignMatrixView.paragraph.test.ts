// @vitest-environment happy-dom
/**
 * Integration tests for the matrix ¶ toggle (R6 manual paragraph boundaries). Mounts the
 * real AlignMatrixView against a fake Conn: the ¶ cell of each hub row is a button that
 * posts /segment/paragraph_boundary on the row's hub unit and re-projects; a paragraph-start
 * row is highlighted; the F1 guard blocks a write after a corpus switch.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { AlignMatrixView } from "../AlignMatrixView.ts";
import type { AlignMatrix, Conn } from "../../lib/sidecarClient.ts";

const base = { headers: ["paragraphe", "segment", "fr", "en"], languages: ["fr", "en"], hub_doc_id: 2, language_doc_ids: [2, 3] };

/** Three hub rows: ¶1 spans rows 0-1, ¶2 is row 2. Units 101,102,103. */
const MATRIX: AlignMatrix = {
  ...base,
  rows: [
    ["1", 1, "FR1", "EN1"],
    ["1", 2, "FR2", "EN2"],
    ["2", 3, "FR3", "EN3"],
  ],
  hub_unit_ids: [101, 102, 103],
};

const FAMILY = { family_id: 2, parent: { doc_id: 2, title: "Le Livre" }, children: [], stats: { total_docs: 2 } };

function makeConn(calls: Array<{ path: string; body: unknown }>): Conn {
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
      if (path === "/segment/paragraph_boundary") {
        const b = body as { doc_id: number; unit_id: number };
        return { ok: true, doc_id: b.doc_id, unit_id: b.unit_id, unit_n: 1, units_changed: 2, blocks: 2, action_id: 7 };
      }
      throw new Error(`unexpected POST ${path}`);
    },
    put: async () => ({}),
  } as Conn;
}

async function mount(calls: Array<{ path: string; body: unknown }>) {
  const holder = { conn: makeConn(calls) };
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
  await vi.waitFor(() => { expect(el.querySelector(".prep-matrix-grid")).not.toBeNull(); });
  return { view, el, toasts, holder };
}

afterEach(() => { document.body.innerHTML = ""; });

describe("AlignMatrixView — ¶ toggle (R6)", () => {
  it("renders a ¶ toggle per hub row and highlights paragraph starts", async () => {
    const { el } = await mount([]);
    expect(el.querySelectorAll(".prep-matrix-para-btn")).toHaveLength(3);
    // Rows 0 and 2 open a paragraph; row 1 is mid-paragraph.
    expect(el.querySelector('.prep-matrix-para-btn--start[data-para-row="0"]')).not.toBeNull();
    expect(el.querySelector('.prep-matrix-para-btn--start[data-para-row="2"]')).not.toBeNull();
    expect(el.querySelector('.prep-matrix-para-btn--start[data-para-row="1"]')).toBeNull();
  });

  it("clicking a ¶ cell posts the toggle on that row's hub unit and re-projects", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const { el, toasts } = await mount(calls);
    // Designate a new paragraph at the mid-paragraph row (unit 102).
    el.querySelector<HTMLButtonElement>('.prep-matrix-para-btn[data-para-row="1"]')!.click();
    await vi.waitFor(() => { expect(calls.filter((c) => c.path === "/align/matrix")).toHaveLength(2); });
    const post = calls.find((c) => c.path === "/segment/paragraph_boundary");
    expect(post?.body).toEqual({ doc_id: 2, unit_id: 102 });
    expect(toasts).toContain("✓ Nouveau paragraphe");
  });

  it("clicking a paragraph-start ¶ cell toasts the removal wording", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const { el, toasts } = await mount(calls);
    el.querySelector<HTMLButtonElement>('.prep-matrix-para-btn--start[data-para-row="2"]')!.click();
    await vi.waitFor(() => { expect(toasts).toContain("✓ Frontière de paragraphe retirée"); });
    expect(calls.find((c) => c.path === "/segment/paragraph_boundary")?.body).toEqual({ doc_id: 2, unit_id: 103 });
  });

  it("blocks the toggle and resets when the connection changed (F1)", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const { el, toasts, holder } = await mount(calls);
    holder.conn = makeConn(calls); // another DB behind the same screen
    el.querySelector<HTMLButtonElement>('.prep-matrix-para-btn[data-para-row="0"]')!.click();
    expect(toasts.some((t) => t.includes("Connexion changée"))).toBe(true);
    expect(calls.some((c) => c.path === "/segment/paragraph_boundary")).toBe(false);
  });
});
