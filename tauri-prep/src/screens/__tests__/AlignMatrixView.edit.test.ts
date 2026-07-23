// @vitest-environment happy-dom
/**
 * Integration tests for the matrix « stylo » (β text correction, DESIGN_inline_text_
 * correction.md). Mounts the real AlignMatrixView against a fake Conn and drives the
 * in-place cell editor: the ✎ appears on the source (hub) cell and on a CLEAN translation
 * cell (one whole, uncut link) — never on cut / multi-link / empty cells; saving posts
 * updateUnitTextNorm on the resolved unit and re-projects; cancel restores the cell.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { AlignMatrixView } from "../AlignMatrixView.ts";
import type { AlignMatrix, Conn, MatrixCellLink } from "../../lib/sidecarClient.ts";

function lk(link_id: number, target: number, raw: string, over: Partial<MatrixCellLink> = {}): MatrixCellLink {
  return { link_id, target_unit_id: target, char_start: null, char_end: null, target_text_raw: raw, ...over };
}

const base = { headers: ["paragraphe", "segment", "fr", "en"], languages: ["fr", "en"], hub_doc_id: 2, language_doc_ids: [2, 3] };

/** One clean 1-1 row: hub (101) + a single uncut translation link (→ 900). Both editable. */
const MATRIX_CLEAN: AlignMatrix = {
  ...base, rows: [["1", 1, "FR un", "EN one"]], hub_unit_ids: [101],
  cell_links: [[[lk(11, 900, "EN one")]]],
};

/** A resolved cut cell (char window) — the translation is only a slice, not the whole unit. */
const MATRIX_CUT: AlignMatrix = {
  ...base, rows: [["1", 1, "FR un", "As far"]], hub_unit_ids: [101],
  cell_links: [[[lk(13, 900, "As far back", { char_start: 0, char_end: 6 })]]],
};

/** A cell with two links — no single unit to edit. */
const MATRIX_TWO: AlignMatrix = {
  ...base, rows: [["1", 1, "FR un", "EN a. EN b."]], hub_unit_ids: [101],
  cell_links: [[[lk(11, 900, "EN a."), lk(12, 901, "EN b.")]]],
};

const FAMILY = { family_id: 2, parent: { doc_id: 2, title: "Le Livre" }, children: [], stats: { total_docs: 2 } };

function makeConn(calls: Array<{ path: string; body: unknown }>, matrix: AlignMatrix): Conn {
  return {
    baseUrl: "http://test", token: null,
    get: async (path: string) => {
      calls.push({ path, body: null });
      if (path === "/families") return { families: [FAMILY] };
      throw new Error(`unexpected GET ${path}`);
    },
    post: async (path: string, body: unknown) => {
      calls.push({ path, body });
      if (path === "/align/matrix") return matrix;
      if (path === "/units/update_text") {
        const b = body as { unit_id: number; text_norm: string };
        return { ok: true, unit_id: b.unit_id, doc_id: 2, n: 1, external_id: null, text_raw: b.text_norm, text_norm: b.text_norm };
      }
      throw new Error(`unexpected POST ${path}`);
    },
    put: async () => ({}),
  } as Conn;
}

async function mountWithMatrix(calls: Array<{ path: string; body: unknown }>, matrix: AlignMatrix) {
  const holder = { conn: makeConn(calls, matrix) };
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

describe("AlignMatrixView — stylo (β correction inline)", () => {
  it("expose le ✎ sur la source (moyeu) et une traduction propre", async () => {
    const { el } = await mountWithMatrix([], MATRIX_CLEAN);
    expect(el.querySelector('.prep-matrix-edit-btn[data-edit-col="hub"]')).not.toBeNull();
    expect(el.querySelector('.prep-matrix-edit-btn[data-edit-col="0"]')).not.toBeNull();
  });

  it("pas de ✎ sur une traduction coupée (fenêtre partielle) — mais la source reste éditable", async () => {
    const { el } = await mountWithMatrix([], MATRIX_CUT);
    expect(el.querySelector(".prep-matrix-cell .prep-matrix-edit-btn")).toBeNull();
    expect(el.querySelector('.prep-matrix-edit-btn[data-edit-col="hub"]')).not.toBeNull();
  });

  it("pas de ✎ sur une cellule multi-liens (pas d'unité unique)", async () => {
    const { el } = await mountWithMatrix([], MATRIX_TWO);
    expect(el.querySelector(".prep-matrix-cell .prep-matrix-edit-btn")).toBeNull();
  });

  it("corriger la source : éditeur seedé du texte, Enregistrer persiste text_norm sur le moyeu + re-projette", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const { el, toasts } = await mountWithMatrix(calls, MATRIX_CLEAN);
    el.querySelector<HTMLButtonElement>('.prep-matrix-edit-btn[data-edit-col="hub"]')!.click();
    const ta = el.querySelector<HTMLTextAreaElement>(".prep-matrix-edit-ta")!;
    expect(ta.value).toBe("FR un");
    ta.value = "FR corrigé";
    el.querySelector<HTMLButtonElement>(".prep-matrix-edit-save")!.click();
    await vi.waitFor(() => { expect(calls.filter((c) => c.path === "/align/matrix")).toHaveLength(2); });
    const upd = calls.find((c) => c.path === "/units/update_text");
    expect(upd?.body).toEqual({ unit_id: 101, text_norm: "FR corrigé" }); // pivot unit; text_norm only (D-C1)
    expect(toasts).toContain("✓ Texte corrigé");
  });

  it("corriger une traduction propre : persiste text_norm sur l'unité cible du lien", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const { el } = await mountWithMatrix(calls, MATRIX_CLEAN);
    el.querySelector<HTMLButtonElement>('.prep-matrix-edit-btn[data-edit-col="0"]')!.click();
    const ta = el.querySelector<HTMLTextAreaElement>(".prep-matrix-edit-ta")!;
    expect(ta.value).toBe("EN one");
    ta.value = "EN fixed";
    el.querySelector<HTMLButtonElement>(".prep-matrix-edit-save")!.click();
    await vi.waitFor(() => { expect(calls.filter((c) => c.path === "/align/matrix")).toHaveLength(2); });
    expect(calls.find((c) => c.path === "/units/update_text")?.body).toEqual({ unit_id: 900, text_norm: "EN fixed" });
  });

  it("Annuler restaure la cellule sans écrire", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const { el } = await mountWithMatrix(calls, MATRIX_CLEAN);
    el.querySelector<HTMLButtonElement>('.prep-matrix-edit-btn[data-edit-col="hub"]')!.click();
    expect(el.querySelector(".prep-matrix-edit-ta")).not.toBeNull();
    el.querySelector<HTMLButtonElement>(".prep-matrix-edit-cancel")!.click();
    expect(el.querySelector(".prep-matrix-edit-ta")).toBeNull();
    expect(el.querySelector('.prep-matrix-edit-btn[data-edit-col="hub"]')).not.toBeNull(); // ✎ back
    expect(calls.some((c) => c.path === "/units/update_text")).toBe(false);
  });

  it("Enregistrer sans changement ne persiste rien (no-op)", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const { el } = await mountWithMatrix(calls, MATRIX_CLEAN);
    el.querySelector<HTMLButtonElement>('.prep-matrix-edit-btn[data-edit-col="hub"]')!.click();
    el.querySelector<HTMLButtonElement>(".prep-matrix-edit-save")!.click();
    expect(el.querySelector(".prep-matrix-edit-ta")).toBeNull(); // closed
    expect(calls.some((c) => c.path === "/units/update_text")).toBe(false);
  });

  it("refuse d'éditer et réinitialise quand la connexion a changé (F1)", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const { el, toasts, holder } = await mountWithMatrix(calls, MATRIX_CLEAN);
    holder.conn = makeConn(calls, MATRIX_CLEAN); // new identity = another DB behind the same screen
    el.querySelector<HTMLButtonElement>('.prep-matrix-edit-btn[data-edit-col="hub"]')!.click();
    expect(toasts.some((t) => t.includes("Connexion changée"))).toBe(true);
    expect(el.querySelector(".prep-matrix-edit-ta")).toBeNull(); // editor never opened
    expect(calls.some((c) => c.path === "/units/update_text")).toBe(false);
  });
});
