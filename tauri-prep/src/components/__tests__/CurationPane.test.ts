// @vitest-environment happy-dom
/**
 * Behavioural test for the Curation mode of the canvas (R5.1b): the preset dock,
 * the read-only preview, and the discreet marker on changed units (via the shared
 * CanvasUnitList decorateRow hook). No real sidecar — a fake Conn returns canned
 * conventions / units / curate-preview payloads.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { CurationPane } from "../CurationPane.ts";
import type { Conn, UnitRecord } from "../../lib/sidecarClient.ts";

function unit(n: number, over: Partial<UnitRecord> = {}): UnitRecord {
  return {
    unit_id: n * 10, n, text_norm: `u${n}`, text_raw: `u${n}`,
    unit_type: "line", unit_role: null, parent_n: null, ...over,
  };
}

function fakeConn(cfg: {
  units?: UnitRecord[];
  preview?: (body: unknown) => unknown;
  curate?: (body: unknown) => unknown;
  updateText?: (body: unknown) => unknown;
}): Conn {
  return {
    get: async (path: string) => {
      if (path === "/conventions") return { conventions: [] };
      if (path.startsWith("/units")) {
        const units = cfg.units ?? [];
        return { units, count: units.length, doc_id: 1 };
      }
      return {};
    },
    post: async (path: string, body: unknown) => {
      if (path === "/curate/preview") {
        return cfg.preview
          ? cfg.preview(body)
          : { ok: true, doc_id: 1, stats: { units_total: 0, units_changed: 0, replacements_total: 0 }, examples: [] };
      }
      if (path === "/curate") {
        return cfg.curate ? cfg.curate(body) : { ok: true, docs_curated: 1, units_modified: 0, fts_stale: false };
      }
      if (path === "/units/update_text") {
        return cfg.updateText ? cfg.updateText(body) : { unit_id: 0, doc_id: 1, n: 1, text_raw: "", text_norm: "" };
      }
      return {};
    },
  } as unknown as Conn;
}

const flush = () => new Promise((r) => setTimeout(r, 5));

let host: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
});

describe("CurationPane", () => {
  it("mounts a preset dock + preview button", () => {
    const pane = new CurationPane(host, () => null, () => {});
    pane.mount();
    expect(host.querySelector(".prep-cur-dock")).not.toBeNull();
    expect(host.querySelectorAll("input[data-preset]").length).toBeGreaterThan(0);
    expect(host.querySelector("#prep-cur-preview-btn")).not.toBeNull();
  });

  it("refuses preview with no preset selected", async () => {
    const errors: string[] = [];
    const pane = new CurationPane(host, () => fakeConn({ units: [unit(1)] }), (m) => errors.push(m));
    await pane.setDocument(1, null);
    (host.querySelector("#prep-cur-preview-btn") as HTMLButtonElement).click();
    await flush();
    expect(errors.some((e) => /règles/.test(e))).toBe(true);
  });

  it("marks exactly the changed units + reports the count after a preview", async () => {
    const conn = fakeConn({
      units: [unit(1), unit(2), unit(3)],
      preview: () => ({
        ok: true, doc_id: 1,
        stats: { units_total: 3, units_changed: 1, replacements_total: 1 },
        examples: [{ unit_id: 20, external_id: 2, before: "a", after: "b" }],
      }),
    });
    const pane = new CurationPane(host, () => conn, () => {});
    await pane.setDocument(1, null);

    const cb = host.querySelector<HTMLInputElement>('input[data-preset="spaces"]')!;
    cb.checked = true;
    cb.dispatchEvent(new Event("change"));
    (host.querySelector("#prep-cur-preview-btn") as HTMLButtonElement).click();
    await flush();

    const curated = host.querySelectorAll<HTMLElement>(".prep-conv-unit-row--curated");
    expect(curated.length).toBe(1);
    expect(curated[0].dataset.uid).toBe("20");
    expect(host.querySelector("#prep-cur-summary")?.textContent).toContain("1 unité modifiée");
  });

  it("reveals a unit's full diff on the per-unit toggle (R5.1c)", async () => {
    const conn = fakeConn({
      units: [unit(1), unit(2)],
      preview: () => ({
        ok: true, doc_id: 1,
        stats: { units_total: 2, units_changed: 1, replacements_total: 1 },
        examples: [{ unit_id: 20, external_id: 2, before: "le chat", after: "le chien" }],
      }),
    });
    const pane = new CurationPane(host, () => conn, () => {});
    await pane.setDocument(1, null);
    const cb = host.querySelector<HTMLInputElement>('input[data-preset="spaces"]')!;
    cb.checked = true; cb.dispatchEvent(new Event("change"));
    (host.querySelector("#prep-cur-preview-btn") as HTMLButtonElement).click();
    await flush();

    expect(host.querySelector(".prep-cur-diff-panel")).toBeNull(); // closed by default
    (host.querySelector(".prep-cur-diff-toggle") as HTMLButtonElement).click();
    const panel = host.querySelector(".prep-cur-diff-panel");
    expect(panel).not.toBeNull();
    expect(panel!.textContent).toContain("chien"); // the "after" word
  });

  it("global toggle reveals all diffs and flips its label (R5.1c)", async () => {
    const conn = fakeConn({
      units: [unit(1), unit(2)],
      preview: () => ({
        ok: true, doc_id: 1,
        stats: { units_total: 2, units_changed: 1, replacements_total: 1 },
        examples: [{ unit_id: 10, external_id: 1, before: "a", after: "b" }],
      }),
    });
    const pane = new CurationPane(host, () => conn, () => {});
    await pane.setDocument(1, null);
    const cb = host.querySelector<HTMLInputElement>('input[data-preset="spaces"]')!;
    cb.checked = true; cb.dispatchEvent(new Event("change"));
    (host.querySelector("#prep-cur-preview-btn") as HTMLButtonElement).click();
    await flush();

    const toggleAll = host.querySelector("#prep-cur-toggle-all") as HTMLButtonElement;
    expect(host.querySelectorAll(".prep-cur-diff-panel").length).toBe(0);
    toggleAll.click();
    expect(host.querySelectorAll(".prep-cur-diff-panel").length).toBe(1);
    expect(toggleAll.textContent).toContain("Masquer");
  });

  it("Apply is gated on a preview, then persists via /curate after confirm (R5.1d)", async () => {
    let curateBody: { doc_id?: number; rules?: unknown[] } | null = null;
    const conn = fakeConn({
      units: [unit(1), unit(2)],
      preview: () => ({
        ok: true, doc_id: 1,
        stats: { units_total: 2, units_changed: 1, replacements_total: 1 },
        examples: [{ unit_id: 10, external_id: 1, before: "a", after: "b" }],
      }),
      curate: (body) => { curateBody = body as typeof curateBody; return { ok: true, docs_curated: 1, units_modified: 1, fts_stale: true }; },
    });
    const pane = new CurationPane(host, () => conn, () => {});
    await pane.setDocument(1, null);

    const applyBtn = host.querySelector("#prep-cur-apply-btn") as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(true);        // nothing previewed yet
    expect(pane.hasPendingEdits()).toBe(false);

    const cb = host.querySelector<HTMLInputElement>('input[data-preset="spaces"]')!;
    cb.checked = true; cb.dispatchEvent(new Event("change"));
    (host.querySelector("#prep-cur-preview-btn") as HTMLButtonElement).click();
    await flush();
    expect(applyBtn.disabled).toBe(false);       // preview found a change
    expect(pane.hasPendingEdits()).toBe(true);

    applyBtn.click();
    await flush();                               // modalConfirm overlay is up
    const okBtn = document.querySelector("[data-mc-ok]") as HTMLButtonElement;
    expect(okBtn).not.toBeNull();
    okBtn.click();
    await flush();

    expect(curateBody).toMatchObject({ doc_id: 1 });
    expect((curateBody!.rules ?? []).length).toBeGreaterThan(0);
    expect(host.querySelector("#prep-cur-summary")?.textContent).toContain("Curation appliquée");
    expect(applyBtn.disabled).toBe(true);        // consumed
    expect(pane.hasPendingEdits()).toBe(false);
  });

  it("clears markers + preview state when the document changes", async () => {
    const conn = fakeConn({
      units: [unit(1), unit(2)],
      preview: () => ({
        ok: true, doc_id: 1,
        stats: { units_total: 2, units_changed: 1, replacements_total: 1 },
        examples: [{ unit_id: 10, external_id: 1, before: "a", after: "b" }],
      }),
    });
    const pane = new CurationPane(host, () => conn, () => {});
    await pane.setDocument(1, null);
    const cb = host.querySelector<HTMLInputElement>('input[data-preset="spaces"]')!;
    cb.checked = true; cb.dispatchEvent(new Event("change"));
    (host.querySelector("#prep-cur-preview-btn") as HTMLButtonElement).click();
    await flush();
    expect(host.querySelectorAll(".prep-conv-unit-row--curated").length).toBe(1);

    await pane.setDocument(2, null); // switching docs invalidates the preview
    expect(host.querySelectorAll(".prep-conv-unit-row--curated").length).toBe(0);
    expect(host.querySelector("#prep-cur-summary")?.textContent).toBe("");
  });
});

describe("CurationPane — stylo (correction de texte en place, β)", () => {
  const pen = () => host.querySelector<HTMLButtonElement>(".prep-conv-unit-edit")!;
  const editor = () => host.querySelector<HTMLTextAreaElement>(".prep-conv-unit-editor")!;
  const saveBtn = () => host.querySelector<HTMLButtonElement>(".prep-conv-unit-editor-actions .btn-primary")!;
  const cancelBtn = () => host.querySelector<HTMLButtonElement>(".prep-conv-unit-editor-actions .btn-ghost")!;

  it("expose un stylo ✎ sur chaque ligne (via CanvasUnitList)", async () => {
    const pane = new CurationPane(host, () => fakeConn({ units: [unit(1), unit(2)] }), () => {});
    await pane.setDocument(1, null);
    expect(host.querySelectorAll(".prep-conv-unit-edit").length).toBe(2);
  });

  it("✎ ouvre une textarea en place, seedée du text_norm", async () => {
    const pane = new CurationPane(host, () => fakeConn({ units: [unit(1, { text_norm: "avant" })] }), () => {});
    await pane.setDocument(1, null);
    pen().click();
    expect(editor().value).toBe("avant");
  });

  it("Enregistrer persiste via /units/update_text (β, text_norm seul) + reflète le texte", async () => {
    let body: { unit_id?: number; text_norm?: string; text_raw?: string } | null = null;
    const conn = fakeConn({
      units: [unit(1, { text_norm: "avant" })],
      updateText: (b) => { body = b as typeof body; return { unit_id: 10, doc_id: 1, n: 1, text_raw: "avant", text_norm: "corrigé" }; },
    });
    const pane = new CurationPane(host, () => conn, () => {});
    await pane.setDocument(1, null);
    pen().click();
    editor().value = "corrigé";
    saveBtn().click();
    await flush();
    // β = text_norm seul, text_raw conservé (D-C1)
    expect(body).toEqual({ unit_id: 10, text_norm: "corrigé" });
    expect(host.querySelector(".prep-conv-unit-editor")).toBeNull(); // éditeur fermé
    expect(host.querySelector('.prep-conv-unit-row[data-uid="10"] .prep-conv-unit-text')?.textContent).toBe("corrigé");
  });

  it("éditer une unité changée retire son marqueur + décrémente le compte", async () => {
    const conn = fakeConn({
      units: [unit(1), unit(2)],
      preview: () => ({
        ok: true, doc_id: 1, stats: { units_total: 2, units_changed: 1, replacements_total: 1 },
        examples: [{ unit_id: 10, external_id: 1, before: "a", after: "b" }],
      }),
    });
    const pane = new CurationPane(host, () => conn, () => {});
    await pane.setDocument(1, null);
    const cb = host.querySelector<HTMLInputElement>('input[data-preset="spaces"]')!;
    cb.checked = true; cb.dispatchEvent(new Event("change"));
    (host.querySelector("#prep-cur-preview-btn") as HTMLButtonElement).click();
    await flush();
    expect(host.querySelectorAll(".prep-conv-unit-row--curated").length).toBe(1);
    host.querySelector<HTMLButtonElement>('.prep-conv-unit-row[data-uid="10"] .prep-conv-unit-edit')!.click();
    editor().value = "manuel";
    saveBtn().click();
    await flush();
    expect(host.querySelectorAll(".prep-conv-unit-row--curated").length).toBe(0);
    expect(host.querySelector("#prep-cur-summary")?.textContent).toContain("Aucune unité");
    expect(pane.hasPendingEdits()).toBe(false);
  });

  it("Annuler ferme l'éditeur sans persister", async () => {
    let called = false;
    const conn = fakeConn({ units: [unit(1, { text_norm: "a" })], updateText: () => { called = true; return {}; } });
    const pane = new CurationPane(host, () => conn, () => {});
    await pane.setDocument(1, null);
    pen().click();
    editor().value = "b";
    cancelBtn().click();
    await flush();
    expect(called).toBe(false);
    expect(host.querySelector(".prep-conv-unit-editor")).toBeNull();
  });

  it("F1 — changer de document ferme l'éditeur ouvert", async () => {
    const pane = new CurationPane(host, () => fakeConn({ units: [unit(1, { text_norm: "a" })] }), () => {});
    await pane.setDocument(1, null);
    pen().click();
    expect(host.querySelector(".prep-conv-unit-editor")).not.toBeNull();
    await pane.setDocument(2, null);
    expect(host.querySelector(".prep-conv-unit-editor")).toBeNull();
  });
});
