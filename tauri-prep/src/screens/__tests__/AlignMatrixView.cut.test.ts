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

function lk(link_id: number, target: number, raw: string, over: Partial<MatrixCellLink> = {}): MatrixCellLink {
  return { link_id, target_unit_id: target, char_start: null, char_end: null, target_text_raw: raw, ...over };
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
    [[lk(13, 900, "As far back", { external_id: 1 })]],
    [[lk(14, 901, "It is the sound", { external_id: 2 })]],
  ],
};

/** A resolved straddle cut: aligner head + manual tail — the ↺ shape (D-W13). */
const MATRIX_CUT: AlignMatrix = {
  headers: ["paragraphe", "segment", "fr", "en"],
  languages: ["fr", "en"],
  hub_doc_id: 2,
  rows: [
    ["1", 1, "FR un", "As far"],
    ["1", 2, "FR deux", "back"],
  ],
  hub_unit_ids: [101, 102],
  language_doc_ids: [2, 3],
  cell_links: [
    [[lk(13, 900, "As far back", { char_start: 0, char_end: 6 })]],
    [[lk(77, 900, "As far back", { char_start: 6, char_end: 11, manual: true })]],
  ],
};

/** A family whose EN translation carries no anchor (1.6.59) — the aligner would drift. */
const MATRIX_UNANCHORED: AlignMatrix = {
  headers: ["paragraphe", "segment", "fr", "en"],
  languages: ["fr", "en"],
  hub_doc_id: 2,
  rows: [
    ["1", 1, "FR un", ""],
    ["1", 2, "FR deux", ""],
  ],
  hub_unit_ids: [101, 102],
  language_doc_ids: [2, 3],
  cell_links: [[[]], [[]]],
  link_count: 0,
  anchor_status: [
    { anchored: true, kind: "paragraph", line_count: 2 },
    { anchored: false, kind: null, line_count: 1270 },
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
      if (path === "/align/collisions/resolve") {
        return { ok: true, applied: 1, deleted: 0, errors: [] };
      }
      if (path === "/align/retarget_candidates") {
        return {
          pivot: { unit_id: 101, external_id: 1, text: "seg A" },
          candidates: [
            { target_unit_id: 950, external_id: 5, target_text: "EN right", score: 0.9, reason: "position n=5" },
            { target_unit_id: 951, external_id: 6, target_text: "EN other", score: 0.6, reason: "position n=6" },
          ],
        };
      }
      if (path === "/align/link/retarget") {
        const b = body as { link_id: number; new_target_unit_id: number };
        return { link_id: b.link_id, new_target_unit_id: b.new_target_unit_id, updated: 1 };
      }
      if (path.startsWith("/families/") && path.endsWith("/align")) {
        return { summary: { total_links_created: 0, aligned: 0, skipped: 0, errors: 0, total_pairs: 0 } };
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

describe("AlignMatrixView — « ⭙ Fusionner » (D-W16)", () => {
  it("absorbs the neighbour's sentence: create here + delete there + cell bead, atomic", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    // Two clean 1-1 rows: EN2 (row 1) really belongs to FR un (row 0).
    const { el, toasts } = await mountWithMatrix(calls, { matrix: MATRIX_STRADDLE });

    el.querySelectorAll<HTMLButtonElement>(".prep-matrix-merge-btn")[0].click();
    await vi.waitFor(() => {
      expect(document.querySelector(".prep-matrix-merge-preview")).not.toBeNull();
    });
    // The preview names what moves and what empties.
    expect(document.querySelector(".prep-matrix-merge-preview")!.textContent)
      .toContain("It is the sound");

    document.querySelector<HTMLButtonElement>("[data-cut-ok]")!.click();
    await vi.waitFor(() => {
      expect(calls.filter((c) => c.path === "/align/matrix")).toHaveLength(2);
    });

    // The link is re-created on THIS hub unit, inheriting the pair number…
    const create = calls.find((c) => c.path === "/align/link/create");
    expect(create?.body).toEqual({ pivot_unit_id: 101, target_unit_id: 901, external_id: 2 });
    // …the neighbour's link is deleted ATOMICALLY (the gesture itself)…
    const batches = calls.filter((c) => c.path === "/align/links/batch_update");
    expect(batches[0].body).toEqual({
      actions: [{ action: "delete", link_id: 14 }],
      atomic: true,
    });
    // …and the cell's bead follows in its OWN, non-atomic batch (revue T5): grouping is
    // hygiene — inside the atomic batch, an older sidecar that ignores set_bead would roll
    // the whole merge back.
    expect(batches[1].body).toEqual({
      actions: [
        { action: "set_bead", link_id: 13 },
        { action: "set_bead", link_id: 77 },
      ],
    });
    expect(toasts).toContain("✓ Phrase absorbée — le segment voisin est à traiter");
  });

  it("T1: does NOT bead a cell that already carried a genuine aligner collision", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    // Row 0's cell holds TWO aligner links (a real ambiguity flagged in Qualité) — a merge
    // must not fold them into one bead and erase the alert the user has never arbitrated.
    const collidingCell: AlignMatrix = {
      ...MATRIX_STRADDLE,
      rows: [["1", 1, "FR un", "A. B."], ["1", 2, "FR deux", "It is the sound"]],
      cell_links: [
        [[lk(13, 900, "A.", { external_id: 1 }), lk(15, 902, "B.", { external_id: 1 })]],
        [[lk(14, 901, "It is the sound", { external_id: 2 })]],
      ],
    };
    const { el, toasts } = await mountWithMatrix(calls, { matrix: collidingCell });

    el.querySelectorAll<HTMLButtonElement>(".prep-matrix-merge-btn")[0].click();
    await vi.waitFor(() => {
      expect(document.querySelector(".prep-matrix-merge-preview")).not.toBeNull();
    });
    document.querySelector<HTMLButtonElement>("[data-cut-ok]")!.click();
    await vi.waitFor(() => {
      expect(calls.filter((c) => c.path === "/align/matrix")).toHaveLength(2);
    });

    // The merge itself happens (delete of the neighbour's link)…
    const batches = calls.filter((c) => c.path === "/align/links/batch_update");
    expect(batches).toHaveLength(1);
    expect(batches[0].body).toEqual({ actions: [{ action: "delete", link_id: 14 }], atomic: true });
    // …but NO set_bead is posted, and the user is told the cell needs arbitration.
    expect(JSON.stringify(batches[0].body)).not.toContain("set_bead");
    expect(toasts.some((t) => t.includes("ambiguïté d'alignement"))).toBe(true);
  });

  it("T3: an EMPTY cell keeps the ⭙ — the merge stays reversible", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    // The shape a merge leaves behind: row 1's cell is empty.
    const emptied: AlignMatrix = {
      ...MATRIX_STRADDLE,
      rows: [["1", 1, "FR un", "As far back It is the sound"], ["1", 2, "FR deux", ""]],
      cell_links: [
        [[lk(13, 900, "As far back", { external_id: 1 }), lk(78, 901, "It is the sound", { external_id: 1, manual: true })]],
        [[]],
      ],
    };
    const { el } = await mountWithMatrix(calls, { matrix: emptied });

    const mergeBtns = el.querySelectorAll<HTMLButtonElement>(".prep-matrix-merge-btn");
    const onEmptyRow = Array.from(mergeBtns).find((b) => b.dataset.cutRow === "1");
    expect(onEmptyRow).toBeDefined();  // before the fix the empty cell had no ⭙ at all

    onEmptyRow!.click();
    await vi.waitFor(() => {
      expect(document.querySelector(".prep-matrix-merge-preview")).not.toBeNull();
    });
    // It can absorb the sentence back from the row above (direction « up »).
    const up = document.querySelector<HTMLInputElement>('input[name="prep-matrix-merge-dir"][value="up"]')!;
    expect(up.disabled).toBe(false);
  });

  it("refuses to absorb a CUT neighbour (the two mechanics must not mix)", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const { el, toasts } = await mountWithMatrix(calls, { matrix: MATRIX_CUT });

    el.querySelectorAll<HTMLButtonElement>(".prep-matrix-merge-btn")[0].click();
    await vi.waitFor(() => {
      expect(toasts.some((t) => t.includes("coupée"))).toBe(true);
    });
    expect(document.querySelector(".prep-matrix-cut-dialog")).toBeNull();
    expect(calls.some((c) => c.path === "/align/link/create")).toBe(false);
  });
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
    // The missing link goes to the NEIGHBOUR hub unit (FR deux = 102), same target,
    // and inherits the sibling's pair number (D-W13, 1.6.55).
    const create = calls.find((c) => c.path === "/align/link/create");
    expect(create?.body).toEqual({ pivot_unit_id: 102, target_unit_id: 900, external_id: 1 });
    // "down": the cell keeps the head, the created link takes the tail — atomically.
    // Suggested boundary on "As far back" (hubs "FR un"/"FR deux") = 3.
    const batches = calls.filter((c) => c.path === "/align/links/batch_update");
    expect(batches[0].body).toEqual({
      actions: [
        { action: "set_target_span", link_id: 13, char_start: 0, char_end: 3 },
        { action: "set_target_span", link_id: 77, char_start: 3, char_end: 11 },
      ],
      atomic: true,
    });
    // The neighbour's cell (its own link 14 + the created 77) is grouped into ONE bead in
    // a SEPARATE, best-effort batch (revue T5): hygiene must not be able to roll the cut
    // back on a sidecar that predates set_bead.
    expect(batches[1].body).toEqual({
      actions: [
        { action: "set_bead", link_id: 14 },
        { action: "set_bead", link_id: 77 },
      ],
    });
    expect(toasts).toContain("✓ Traduction coupée à cheval");
    expect(document.querySelector(".prep-matrix-cut-overlay")).toBeNull();
  });

  it("D-W17: « couper après le point » on a multi-link cell MOVES the whole sentence (no split)", async () => {
    // The Beigbeder over-grouping: seg 69 (view row 1) carries TWO whole EN sentences; the
    // aligner shifted seg 70 onto seg 71's line. The user cuts at the unit boundary — the
    // whole « Ask any surfer : » must MOVE to seg 70, not be sliced in half.
    const overGrouped: AlignMatrix = {
      ...MATRIX_STRADDLE,
      rows: [
        ["1", 1, "Je vous empêche de penser.", "I stop you thinking."],
        ["1", 2, "Le terrorisme de la nouveauté…", "The terrorist cult of the new helps me to sell empty space. Ask any surfer :"],
        ["1", 3, "Demandez à n'importe quel surfeur :", "to stay on the surface."],
      ],
      hub_unit_ids: [101, 102, 103],
      cell_links: [
        [[lk(10, 900, "I stop you thinking.", { external_id: 1 })]],
        [[lk(11, 901, "The terrorist cult of the new helps me to sell empty space.", { external_id: 2 }),
          lk(12, 902, "Ask any surfer :", { external_id: 2 })]],
        [[lk(13, 903, "to stay on the surface.", { external_id: 3 })]],
      ],
    };
    const calls: Array<{ path: string; body: unknown }> = [];
    const { toasts } = await mountWithMatrix(calls, { matrix: overGrouped });

    document.querySelector<HTMLButtonElement>('.prep-matrix-cut-any-btn[data-cut-row="1"]')!.click();
    await vi.waitFor(() => {
      expect(document.querySelector(".prep-matrix-cut-dialog")).not.toBeNull();
    });
    // The picker shows BOTH sentences with the unit boundary marked — the default cut sits
    // on that boundary, so a plain confirm moves the last sentence whole.
    const dialog = document.querySelector(".prep-matrix-cut-dialog")!;
    expect(dialog.textContent).toContain("terrorist");
    expect(dialog.textContent).toContain("Ask");
    expect(dialog.querySelector(".prep-matrix-cut-unitsep")).not.toBeNull();

    document.querySelector<HTMLButtonElement>("[data-cut-ok]")!.click();
    await vi.waitFor(() => {
      expect(calls.filter((c) => c.path === "/align/matrix")).toHaveLength(2);
    });
    // The whole sentence is re-created on the NEXT hub unit (seg 70 = 103), pair inherited…
    const create = calls.find((c) => c.path === "/align/link/create");
    expect(create?.body).toEqual({ pivot_unit_id: 103, target_unit_id: 902, external_id: 2 });
    const batches = calls.filter((c) => c.path === "/align/links/batch_update");
    // …the original link is DELETED atomically — NO set_target_span: nothing is sliced.
    expect(batches[0].body).toEqual({ actions: [{ action: "delete", link_id: 12 }], atomic: true });
    expect(JSON.stringify(batches[0].body)).not.toContain("set_target_span");
    // …and seg 70's cell (its own link 13 + the moved 77) becomes one bead, out of band.
    expect(batches[1].body).toEqual({
      actions: [{ action: "set_bead", link_id: 13 }, { action: "set_bead", link_id: 77 }],
    });
    // seg 70 was already translated → the toast flags the continuing cascade.
    expect(toasts.some((t) => t.includes("Phrase déplacée") && t.includes("plusieurs phrases"))).toBe(true);
  });

  it("D-W17: a move onto an EMPTY neighbour gets the plain toast (no cascade caution)", async () => {
    // seg 69 holds two EN sentences; seg 70's cell is empty — moving the 2nd sentence there
    // is a clean fix, no « plusieurs phrases » caution.
    const emptyNeighbour: AlignMatrix = {
      ...MATRIX_STRADDLE,
      rows: [
        ["1", 1, "seg 68", "I stop you thinking."],
        ["1", 2, "seg 69", "The terrorist cult. Ask any surfer :"],
        ["1", 3, "seg 70", ""],
      ],
      hub_unit_ids: [101, 102, 103],
      cell_links: [
        [[lk(10, 900, "I stop you thinking.", { external_id: 1 })]],
        [[lk(11, 901, "The terrorist cult.", { external_id: 2 }),
          lk(12, 902, "Ask any surfer :", { external_id: 2 })]],
        [[]],
      ],
    };
    const calls: Array<{ path: string; body: unknown }> = [];
    const { toasts } = await mountWithMatrix(calls, { matrix: emptyNeighbour });

    document.querySelector<HTMLButtonElement>('.prep-matrix-cut-any-btn[data-cut-row="1"]')!.click();
    await vi.waitFor(() => { expect(document.querySelector("[data-cut-ok]")).not.toBeNull(); });
    document.querySelector<HTMLButtonElement>("[data-cut-ok]")!.click();
    await vi.waitFor(() => {
      expect(calls.filter((c) => c.path === "/align/matrix")).toHaveLength(2);
    });
    expect(toasts).toContain("✓ Phrase déplacée au segment voisin");
    expect(toasts.some((t) => t.includes("plusieurs phrases"))).toBe(false);
  });

  it("G3: a partial commit reporting only `deleted` RESYNCS — the created link is not compensated", async () => {
    // Whole-unit MOVE (seg A's 2nd sentence → seg B): batch = [delete 12]. An old non-atomic
    // sidecar that applied the delete reports {applied:0, deleted:1, errors:[…]}. The guard must
    // read `deleted>0` (not just `applied`) → RESYNC, never compensate (deleting the created 77
    // would orphan the target: gone from BOTH cells).
    const moveMatrix: AlignMatrix = {
      ...MATRIX_STRADDLE,
      rows: [["1", 1, "seg A", "EN un. EN deux."], ["1", 2, "seg B", "EN trois."]],
      hub_unit_ids: [101, 102],
      cell_links: [
        [[lk(11, 901, "EN un.", { external_id: 1 }), lk(12, 902, "EN deux.", { external_id: 1 })]],
        [[lk(13, 903, "EN trois.", { external_id: 2 })]],
      ],
    };
    const calls: Array<{ path: string; body: unknown }> = [];
    const { toasts } = await mountWithMatrix(calls, {
      matrix: moveMatrix,
      batchResponse: { ok: false, applied: 0, deleted: 1, errors: [{ index: 0, link_id: 12, error: "boom" }] },
    });

    document.querySelector<HTMLButtonElement>('.prep-matrix-cut-any-btn[data-cut-row="0"]')!.click();
    await vi.waitFor(() => { expect(document.querySelector("[data-cut-ok]")).not.toBeNull(); });
    document.querySelector<HTMLButtonElement>("[data-cut-ok]")!.click();
    await vi.waitFor(() => {
      expect(calls.filter((c) => c.path === "/align/matrix")).toHaveLength(2); // resynced, not swallowed
    });
    expect(calls.some((c) => c.path === "/align/link/delete")).toBe(false); // created link NOT compensated
    expect(toasts.some((t) => t.includes("partielle"))).toBe(true);
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
      expect(toasts.some((t) => t.includes("Coupe refusée"))).toBe(true);
    });
    const del = calls.find((c) => c.path === "/align/link/delete");
    expect(del?.body).toEqual({ link_id: 77 });
    expect(document.querySelector(".prep-matrix-cut-overlay")).not.toBeNull();
    expect(calls.filter((c) => c.path === "/align/matrix")).toHaveLength(1); // nothing changed
  });
});

/** A cell holding three translations: two whole (removable) + one cut (blocked). */
const MATRIX_REMOVE: AlignMatrix = {
  headers: ["paragraphe", "segment", "fr", "en"],
  languages: ["fr", "en"],
  hub_doc_id: 2,
  rows: [["1", 1, "seg A", "EN un. EN deux. EN trois"]],
  hub_unit_ids: [101],
  language_doc_ids: [2, 3],
  cell_links: [
    [[lk(11, 900, "EN un."), lk(12, 901, "EN deux."),
      lk(13, 902, "EN trois cut", { char_start: 0, char_end: 8 })]],
  ],
};

describe("AlignMatrixView — « ✕ Retirer une traduction » (D-W18)", () => {
  it("opens a chooser of the cell's translations; whole removable, cut blocked", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const { el } = await mountWithMatrix(calls, { matrix: MATRIX_REMOVE });

    el.querySelector<HTMLButtonElement>('.prep-matrix-remove-btn[data-cut-row="0"]')!.click();
    await vi.waitFor(() => {
      expect(document.querySelector(".prep-matrix-remove-choices")).not.toBeNull();
    });
    const choices = document.querySelectorAll(".prep-matrix-remove-choice");
    expect(choices).toHaveLength(3);
    // Two whole links are clickable buttons; the cut one is a disabled span.
    const removable = document.querySelectorAll(".prep-matrix-remove-choice[data-remove-link]");
    expect(removable).toHaveLength(2);
    expect(document.querySelector(".prep-matrix-remove-choice--off")).not.toBeNull();
  });

  it("removing a translation posts action:delete with its link_id and re-projects (revue G1)", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const { el, toasts } = await mountWithMatrix(calls, { matrix: MATRIX_REMOVE });

    el.querySelector<HTMLButtonElement>('.prep-matrix-remove-btn[data-cut-row="0"]')!.click();
    await vi.waitFor(() => {
      expect(document.querySelector('.prep-matrix-remove-choice[data-remove-link="12"]')).not.toBeNull();
    });
    document.querySelector<HTMLButtonElement>('.prep-matrix-remove-choice[data-remove-link="12"]')!.click();
    await vi.waitFor(() => {
      expect(calls.filter((c) => c.path === "/align/matrix")).toHaveLength(2); // re-projected
    });
    // Revue G1 : suppression (pas rejet) — sinon ✕ et ＝ ne sont pas des inverses (409).
    const resolve = calls.find((c) => c.path === "/align/collisions/resolve");
    expect(resolve?.body).toEqual({ actions: [{ action: "delete", link_id: 12 }] });
    expect(document.querySelector(".prep-matrix-cut-overlay")).toBeNull();
    expect(toasts.some((t) => t.includes("retirée"))).toBe(true);
  });

  it("refuses the gesture when the connection changed, without opening (F1)", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const { el, toasts, holder } = await mountWithMatrix(calls, { matrix: MATRIX_REMOVE });

    holder.conn = makeConn(calls); // new identity behind the same screen
    el.querySelector<HTMLButtonElement>('.prep-matrix-remove-btn[data-cut-row="0"]')!.click();
    await vi.waitFor(() => {
      expect(toasts.some((t) => t.includes("Connexion changée"))).toBe(true);
    });
    expect(document.querySelector(".prep-matrix-remove-choices")).toBeNull();
    expect(calls.some((c) => c.path === "/align/collisions/resolve")).toBe(false);
  });
});

describe("AlignMatrixView — « ＝ Rattacher / re-cibler » (D-W19)", () => {
  const base = { headers: ["paragraphe", "segment", "fr", "en"], languages: ["fr", "en"], hub_doc_id: 2, language_doc_ids: [2, 3] };
  const EMPTY: AlignMatrix = { ...base, rows: [["1", 1, "seg A", ""]], hub_unit_ids: [101], cell_links: [[[]]] };
  const ONE: AlignMatrix = { ...base, rows: [["1", 1, "seg A", "EN wrong"]], hub_unit_ids: [101], cell_links: [[[lk(11, 900, "EN wrong")]]] };
  const TWO: AlignMatrix = {
    ...base, rows: [["1", 1, "seg A", "EN a. EN b."]], hub_unit_ids: [101],
    cell_links: [[[lk(11, 900, "EN a."), lk(12, 901, "EN b.")]]],
  };

  it("on an EMPTY cell: fetches candidates, then CREATES a link to the pick", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const { el, toasts } = await mountWithMatrix(calls, { matrix: EMPTY });

    el.querySelector<HTMLButtonElement>('.prep-matrix-attach-btn[data-cut-row="0"]')!.click();
    await vi.waitFor(() => {
      expect(document.querySelector('.prep-align-picker-cand[data-uid="950"]')).not.toBeNull();
    });
    // Candidates were requested for the segment's pivot + the column's target doc.
    const cand = calls.find((c) => c.path === "/align/retarget_candidates");
    expect(cand?.body).toMatchObject({ pivot_unit_id: 101, target_doc_id: 3 });

    document.querySelector<HTMLButtonElement>('.prep-align-picker-cand[data-uid="950"]')!.click();
    await vi.waitFor(() => {
      expect(calls.filter((c) => c.path === "/align/matrix")).toHaveLength(2); // re-projected
    });
    const create = calls.find((c) => c.path === "/align/link/create");
    expect(create?.body).toEqual({ pivot_unit_id: 101, target_unit_id: 950 });
    expect(calls.some((c) => c.path === "/align/link/retarget")).toBe(false);
    expect(toasts.some((t) => t.includes("rattachée"))).toBe(true);
  });

  it("on a SINGLE-link cell: RETARGETS the existing link to the pick (no ✕)", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const { el, toasts } = await mountWithMatrix(calls, { matrix: ONE });

    el.querySelector<HTMLButtonElement>('.prep-matrix-attach-btn[data-cut-row="0"]')!.click();
    await vi.waitFor(() => {
      expect(document.querySelector('.prep-align-picker-cand[data-uid="950"]')).not.toBeNull();
    });
    document.querySelector<HTMLButtonElement>('.prep-align-picker-cand[data-uid="950"]')!.click();
    await vi.waitFor(() => {
      expect(calls.filter((c) => c.path === "/align/matrix")).toHaveLength(2);
    });
    const retarget = calls.find((c) => c.path === "/align/link/retarget");
    expect(retarget?.body).toEqual({ link_id: 11, new_target_unit_id: 950 });
    expect(calls.some((c) => c.path === "/align/link/create")).toBe(false);
    expect(toasts.some((t) => t.includes("re-ciblée"))).toBe(true);
  });

  it("a cell with ≥ 2 translations carries NO ＝ button (retarget assumes one link)", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const { el } = await mountWithMatrix(calls, { matrix: TWO });
    expect(el.querySelector('.prep-matrix-attach-btn[data-cut-row="0"]')).toBeNull();
  });

  it("refuses when the connection changed after the fetch (F1)", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const { el, toasts, holder } = await mountWithMatrix(calls, { matrix: EMPTY });

    el.querySelector<HTMLButtonElement>('.prep-matrix-attach-btn[data-cut-row="0"]')!.click();
    // Swap the connection while the candidates fetch is in flight.
    holder.conn = makeConn(calls);
    await vi.waitFor(() => {
      expect(toasts.some((t) => t.includes("Connexion changée"))).toBe(true);
    });
    expect(calls.some((c) => c.path === "/align/link/create")).toBe(false);
  });
});

/** A MIXED cell carrying two cut sequences (inherited tail + own cut head). */
const MATRIX_MIXED: AlignMatrix = {
  headers: ["paragraphe", "segment", "fr", "en"],
  languages: ["fr", "en"],
  hub_doc_id: 2,
  rows: [
    ["1", 1, "FR un", "As far"],
    ["1", 2, "FR deux", "back It is"],
    ["1", 3, "FR trois", "the sound"],
  ],
  hub_unit_ids: [101, 102, 103],
  language_doc_ids: [2, 3],
  cell_links: [
    [[lk(13, 900, "As far back", { char_start: 0, char_end: 6 })]],
    [
      [lk(77, 900, "As far back", { char_start: 6, char_end: 11, manual: true }),
        lk(14, 901, "It is the sound", { char_start: 0, char_end: 5 })],
    ],
    [[lk(78, 901, "It is the sound", { char_start: 5, char_end: 15, manual: true })]],
  ],
};

describe("AlignMatrixView — « ↺ » cellule (D-W13)", () => {
  it("a multi-cut cell opens the chooser; the pick scopes the undo to one sequence (§3.5)", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    await mountWithMatrix(calls, { matrix: MATRIX_MIXED });

    document.querySelector<HTMLButtonElement>('.prep-matrix-uncut-btn[data-cut-row="1"]')!.click();
    await vi.waitFor(() => {
      expect(document.querySelectorAll(".prep-matrix-uncut-choice")).toHaveLength(2);
    });
    // Pick the first sequence (target 900 — the inherited tail).
    document.querySelector<HTMLButtonElement>('.prep-matrix-uncut-choice[data-uncut-target="900"]')!.click();
    await vi.waitFor(() => {
      expect(calls.filter((c) => c.path === "/align/matrix")).toHaveLength(2);
    });
    const batch = calls.find((c) => c.path === "/align/links/batch_update");
    expect(batch?.body).toEqual({
      actions: [
        { action: "clear_target_span", link_id: 13 },
        { action: "delete", link_id: 77 },
        // The ↺ also ungroups what the cut grouped (revue T4) — the exact inverse.
        { action: "clear_bead", link_id: 13 },
      ],
      atomic: true,
    });
    expect(document.querySelector(".prep-matrix-cut-overlay")).toBeNull();
  });

  it("clears the aligner link, deletes the manual one — atomically — then re-projects", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const { toasts } = await mountWithMatrix(calls, { matrix: MATRIX_CUT });

    document.querySelector<HTMLButtonElement>('.prep-matrix-uncut-btn[data-cut-row="0"]')!.click();
    await vi.waitFor(() => {
      expect(calls.filter((c) => c.path === "/align/matrix")).toHaveLength(2); // re-projected
    });
    const batch = calls.find((c) => c.path === "/align/links/batch_update");
    expect(batch?.body).toEqual({
      actions: [
        { action: "clear_target_span", link_id: 13 },
        { action: "delete", link_id: 77 },
        { action: "clear_bead", link_id: 13 },
      ],
      atomic: true,
    });
    expect(toasts.some((t) => t.includes("✓ Coupe annulée"))).toBe(true);
  });
});

describe("AlignMatrixView — anchoring gate (DESIGN_upstream_anchoring §4)", () => {
  it("warns before aligning an unanchored family; « Aligner quand même » proceeds", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const { el } = await mountWithMatrix(calls, { matrix: MATRIX_UNANCHORED });

    // The passive notice is already above the grid after « Charger » (before any run).
    expect(el.querySelector(".prep-matrix-anchor-notice")).not.toBeNull();

    // « Aligner » → the gate appears and NO align call fires yet (RED on the pre-1.6.59
    // behaviour, which fired /families/2/align immediately).
    el.querySelector<HTMLButtonElement>("#matrix-align")!.click();
    await vi.waitFor(() => {
      expect(document.querySelector("#matrix-anchor-proceed")).not.toBeNull();
    });
    expect(calls.some((c) => c.path === "/families/2/align")).toBe(false);

    // « Aligner quand même » acks the family and lets the run proceed.
    document.querySelector<HTMLButtonElement>("#matrix-anchor-proceed")!.click();
    await vi.waitFor(() => {
      expect(calls.some((c) => c.path === "/families/2/align")).toBe(true);
    });
  });

  it("does NOT warn (nor gate) when both texts are ¶-anchored (length-safe)", async () => {
    // M1 — under the default length strategy only a ¶ pairing (or parallel counts) is safe;
    // a value/[N] anchor would now warn, so the silent case must be genuinely protected.
    const anchored: AlignMatrix = {
      ...MATRIX_UNANCHORED,
      anchor_status: [
        { anchored: true, kind: "paragraph", line_count: 2 },
        { anchored: true, kind: "paragraph", line_count: 2 },
      ],
    };
    const calls: Array<{ path: string; body: unknown }> = [];
    const { el } = await mountWithMatrix(calls, { matrix: anchored });

    expect(el.querySelector(".prep-matrix-anchor-notice")).toBeNull();
    el.querySelector<HTMLButtonElement>("#matrix-align")!.click();
    await vi.waitFor(() => {
      expect(calls.some((c) => c.path === "/families/2/align")).toBe(true);
    });
    expect(document.querySelector("#matrix-anchor-proceed")).toBeNull();
  });
});
