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

describe("CurationPane — édition inline / override (Lot 1, parité gap #9)", () => {
  const editBtn = () => host.querySelector<HTMLButtonElement>(".prep-cur-edit-btn")!;
  const saveBtn = () => host.querySelector<HTMLButtonElement>(".prep-cur-editor-actions .btn-primary")!;
  const textarea = () => host.querySelector<HTMLTextAreaElement>(".prep-cur-editor-textarea")!;

  it("expose un bouton d'édition sur CHAQUE ligne (atteint aussi les unités non-suggérées)", async () => {
    const pane = new CurationPane(host, () => fakeConn({ units: [unit(1), unit(2)] }), () => {});
    await pane.setDocument(1, null);
    expect(host.querySelectorAll(".prep-cur-edit-btn").length).toBe(2);
  });

  it("édition directe (unité non-suggérée) : seed = text_norm, save → override staged + marqué", async () => {
    const pane = new CurationPane(host, () => fakeConn({ units: [unit(1, { text_norm: "avant" })] }), () => {});
    await pane.setDocument(1, null);
    expect(pane.hasPendingEdits()).toBe(false);
    editBtn().click();
    expect(textarea().value).toBe("avant"); // seeded from the unit's current text_norm
    textarea().value = "corrigé";
    saveBtn().click();
    expect(pane.hasPendingEdits()).toBe(true);
    expect(host.querySelector(".prep-conv-unit-row--overridden")).not.toBeNull();
    expect(host.querySelector("#prep-cur-summary")?.textContent).toContain("correction manuelle");
  });

  it("override d'une suggestion : seed = le « après » proposé par la règle", async () => {
    const conn = fakeConn({
      units: [unit(1)],
      preview: () => ({
        ok: true, doc_id: 1, stats: { units_total: 1, units_changed: 1, replacements_total: 1 },
        examples: [{ unit_id: 10, external_id: 1, before: "a", after: "APRES" }],
      }),
    });
    const pane = new CurationPane(host, () => conn, () => {});
    await pane.setDocument(1, null);
    const cb = host.querySelector<HTMLInputElement>('input[data-preset="spaces"]')!;
    cb.checked = true; cb.dispatchEvent(new Event("change"));
    (host.querySelector("#prep-cur-preview-btn") as HTMLButtonElement).click();
    await flush();
    host.querySelector<HTMLButtonElement>(".prep-conv-unit-row--curated .prep-cur-edit-btn")!.click();
    expect(textarea().value).toBe("APRES");
  });

  it("Apply embarque manual_overrides — même SANS preset (rules=[]) via α", async () => {
    let body: { rules?: unknown[]; manual_overrides?: Array<{ unit_id: number; text: string }> } | null = null;
    const conn = fakeConn({
      units: [unit(1, { text_norm: "x" })],
      curate: (b) => { body = b as typeof body; return { ok: true, docs_curated: 1, units_modified: 1, fts_stale: false }; },
    });
    const pane = new CurationPane(host, () => conn, () => {});
    await pane.setDocument(1, null);
    editBtn().click();
    textarea().value = "y";
    saveBtn().click();
    // Aucun preset coché → rules vides, mais l'override staged active Apply.
    expect((host.querySelector("#prep-cur-apply-btn") as HTMLButtonElement).disabled).toBe(false);
    (host.querySelector("#prep-cur-apply-btn") as HTMLButtonElement).click();
    await flush();
    (document.querySelector("[data-mc-ok]") as HTMLButtonElement).click();
    await flush();
    expect(body!.rules).toEqual([]);
    expect(body!.manual_overrides).toEqual([{ unit_id: 10, text: "y" }]);
  });

  it("revert retire l'override (bouton du note)", async () => {
    const pane = new CurationPane(host, () => fakeConn({ units: [unit(1, { text_norm: "a" })] }), () => {});
    await pane.setDocument(1, null);
    editBtn().click();
    textarea().value = "b";
    saveBtn().click();
    expect(pane.hasPendingEdits()).toBe(true);
    host.querySelector<HTMLButtonElement>(".prep-cur-override-note .prep-cur-override-revert")!.click();
    expect(pane.hasPendingEdits()).toBe(false);
    expect(host.querySelector(".prep-conv-unit-row--overridden")).toBeNull();
  });

  it("enregistrer un texte identique au baseline ne crée pas d'override", async () => {
    const pane = new CurationPane(host, () => fakeConn({ units: [unit(1, { text_norm: "same" })] }), () => {});
    await pane.setDocument(1, null);
    editBtn().click();
    saveBtn().click(); // sauvegarde sans rien changer
    expect(pane.hasPendingEdits()).toBe(false);
    expect(host.querySelector(".prep-conv-unit-row--overridden")).toBeNull();
  });

  it("changer de preset après un aperçu invalide l'aperçu périmé (marks + gate)", async () => {
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
    expect(pane.hasPendingEdits()).toBe(true);
    // Décocher le preset rend l'aperçu périmé → marks + gate tombent (aucun override en jeu).
    cb.checked = false; cb.dispatchEvent(new Event("change"));
    expect(host.querySelectorAll(".prep-conv-unit-row--curated").length).toBe(0);
    expect(pane.hasPendingEdits()).toBe(false);
    expect((host.querySelector("#prep-cur-apply-btn") as HTMLButtonElement).disabled).toBe(true);
  });

  it("l'override survit à un nouvel aperçu (§6 preview-independent)", async () => {
    const conn = fakeConn({
      units: [unit(1, { text_norm: "a" }), unit(2)],
      preview: () => ({
        ok: true, doc_id: 1, stats: { units_total: 2, units_changed: 1, replacements_total: 1 },
        examples: [{ unit_id: 20, external_id: 2, before: "u2", after: "U2" }],
      }),
    });
    const pane = new CurationPane(host, () => conn, () => {});
    await pane.setDocument(1, null);
    // Override sur l'unité 10 (non-suggérée) AVANT tout aperçu.
    host.querySelector<HTMLButtonElement>('.prep-conv-unit-row[data-uid="10"] .prep-cur-edit-btn')!.click();
    textarea().value = "A!";
    saveBtn().click();
    expect(pane.hasPendingEdits()).toBe(true);
    // Un aperçu (qui change l'unité 20, pas la 10) NE doit PAS effacer l'override.
    const cb = host.querySelector<HTMLInputElement>('input[data-preset="spaces"]')!;
    cb.checked = true; cb.dispatchEvent(new Event("change"));
    (host.querySelector("#prep-cur-preview-btn") as HTMLButtonElement).click();
    await flush();
    expect(host.querySelector('.prep-conv-unit-row--overridden[data-uid="10"]')).not.toBeNull();
    expect(pane.hasPendingEdits()).toBe(true);
  });

  it("F1 — changer de document efface les overrides staged", async () => {
    const pane = new CurationPane(host, () => fakeConn({ units: [unit(1, { text_norm: "a" })] }), () => {});
    await pane.setDocument(1, null);
    editBtn().click();
    textarea().value = "b";
    saveBtn().click();
    expect(pane.hasPendingEdits()).toBe(true);
    await pane.setDocument(2, null);
    expect(pane.hasPendingEdits()).toBe(false);
    expect(host.querySelector(".prep-conv-unit-row--overridden")).toBeNull();
  });
});
