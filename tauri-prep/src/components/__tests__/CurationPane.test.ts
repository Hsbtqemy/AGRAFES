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

function fakeConn(cfg: { units?: UnitRecord[]; preview?: (body: unknown) => unknown }): Conn {
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
