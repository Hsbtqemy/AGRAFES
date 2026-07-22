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

interface FakeException {
  id?: number; unit_id: number; kind: "ignore" | "override";
  override_text?: string | null; note?: string | null; created_at?: string;
}

/** Build a full CurateException row for the list response. */
function exc(unit_id: number, kind: "ignore" | "override", override_text: string | null = null): FakeException {
  return { id: unit_id, unit_id, kind, override_text, note: null, created_at: "2026-07-21" };
}

function fakeConn(cfg: {
  units?: UnitRecord[];
  preview?: (body: unknown) => unknown;
  curate?: (body: unknown) => unknown;
  updateText?: (body: unknown) => unknown;
  exceptions?: FakeException[];
  onExcSet?: (body: unknown) => void;
  onExcDelete?: (body: unknown) => void;
  undoElig?: Record<string, unknown>;
  undoResult?: Record<string, unknown>;
  onUndo?: (body: unknown) => void;
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
      if (path === "/curate/exceptions") {
        const ex = cfg.exceptions ?? [];
        return { ok: true, exceptions: ex, count: ex.length };
      }
      if (path === "/curate/exceptions/set") {
        cfg.onExcSet?.(body);
        const b = body as { unit_id: number; kind: string; override_text?: string; note?: string };
        return { ok: true, unit_id: b.unit_id, kind: b.kind, override_text: b.override_text ?? null, note: b.note ?? null, action: "set" };
      }
      if (path === "/curate/exceptions/delete") {
        cfg.onExcDelete?.(body);
        return { ok: true, unit_id: (body as { unit_id: number }).unit_id, deleted: true };
      }
      if (path === "/prep/undo/eligibility") {
        return cfg.undoElig ?? { eligible: false, reason: "no_action" };
      }
      if (path === "/prep/undo") {
        cfg.onUndo?.(body);
        return cfg.undoResult ?? { undo_action_id: 1, reverted_action_id: 1, reverted_action_type: "curation_apply", units_restored: 3, alignments_reflagged: 0, fts_stale: false };
      }
      return {};
    },
  } as unknown as Conn;
}

const flush = () => new Promise((r) => setTimeout(r, 5));

let host: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear(); // isolate the persisted "relu" review state between tests (Lot B)
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
    expect(host.querySelector("#prep-cur-summary")?.textContent).toContain("1 à curer");
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
    // Char-level diff (R6.5-B): each changed char is its own <mark>/<del>, so "chien" isn't a
    // contiguous string — assert the diff rendered + the inserted tail is present.
    expect(panel!.querySelector(".diff-char-ins")).not.toBeNull();
    expect(panel!.textContent).toContain("ien");
  });

  it("le diff rend visible un changement d'espaces seul (R6.5-B)", async () => {
    // The old word-level diff dropped whitespace → a spaces-only change showed nothing.
    const conn = fakeConn({
      units: [unit(1), unit(2)],
      preview: () => ({
        ok: true, doc_id: 1, stats: { units_total: 2, units_changed: 1, replacements_total: 1 },
        examples: [{ unit_id: 20, external_id: 2, before: "a  b", after: "a b" }], // double → simple
      }),
    });
    const pane = new CurationPane(host, () => conn, () => {});
    await pane.setDocument(1, null);
    const cb = host.querySelector<HTMLInputElement>('input[data-preset="spaces"]')!;
    cb.checked = true; cb.dispatchEvent(new Event("change"));
    (host.querySelector("#prep-cur-preview-btn") as HTMLButtonElement).click();
    await flush();
    (host.querySelector(".prep-cur-diff-toggle") as HTMLButtonElement).click();
    const panel = host.querySelector(".prep-cur-diff-panel")!;
    expect(panel.querySelector(".diff-char-del")).not.toBeNull();      // the extra space is deleted…
    expect(panel.querySelector(".diff-special-space")).not.toBeNull(); // …and rendered as a glyph
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

  it("propagates the 'inclure les non traduits' scope toggle to preview and apply (R6.5)", async () => {
    let previewBody: { include_non_traduit?: boolean } | null = null;
    let curateBody: { include_non_traduit?: boolean } | null = null;
    const conn = fakeConn({
      units: [unit(1), unit(2)],
      preview: (b) => {
        previewBody = b as typeof previewBody;
        return {
          ok: true, doc_id: 1,
          stats: { units_total: 2, units_changed: 1, replacements_total: 1 },
          examples: [{ unit_id: 10, external_id: 1, before: "a", after: "b" }],
        };
      },
      curate: (b) => { curateBody = b as typeof curateBody; return { ok: true, docs_curated: 1, units_modified: 1, fts_stale: true }; },
    });
    const pane = new CurationPane(host, () => conn, () => {});
    await pane.setDocument(1, null);

    const cb = host.querySelector<HTMLInputElement>('input[data-preset="spaces"]')!;
    cb.checked = true; cb.dispatchEvent(new Event("change"));

    // Toggle off (default) → preview carries include_non_traduit:false.
    (host.querySelector("#prep-cur-preview-btn") as HTMLButtonElement).click();
    await flush();
    expect(previewBody!.include_non_traduit).toBe(false);

    // Turning the scope toggle on invalidates the preview (like a preset change)…
    const nt = host.querySelector<HTMLInputElement>("#prep-cur-include-nt")!;
    nt.checked = true; nt.dispatchEvent(new Event("change"));
    expect((host.querySelector("#prep-cur-apply-btn") as HTMLButtonElement).disabled).toBe(true);
    // …so re-preview, now with the flag true.
    (host.querySelector("#prep-cur-preview-btn") as HTMLButtonElement).click();
    await flush();
    expect(previewBody!.include_non_traduit).toBe(true);

    // Apply carries the SAME flag → preview/apply symmetry.
    (host.querySelector("#prep-cur-apply-btn") as HTMLButtonElement).click();
    await flush();
    (document.querySelector("[data-mc-ok]") as HTMLButtonElement).click();
    await flush();
    expect(curateBody!.include_non_traduit).toBe(true);
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

describe("CurationPane — exceptions par unité (R6.5-B Lot A)", () => {
  const row = (uid: number) => host.querySelector<HTMLElement>(`.prep-conv-unit-row[data-uid="${uid}"]`)!;
  const excBtn = (uid: number, text: string) =>
    Array.from(row(uid).querySelectorAll<HTMLButtonElement>(".prep-cur-exc-btn"))
      .find((b) => b.textContent === text)!;

  it("charge et affiche les exceptions existantes (badge + Rétablir), même hors set changé", async () => {
    // No preview here → the ignored unit is in NO changed set, yet its badge must show
    // (source of truth = listCurateExceptions, découplé de l'aperçu).
    const pane = new CurationPane(host, () => fakeConn({
      units: [unit(1), unit(2), unit(3)],
      exceptions: [exc(10, "ignore"), exc(20, "override", "forcé")],
    }), () => {});
    await pane.setDocument(1, null);

    expect(row(10).classList.contains("prep-conv-unit-row--exc-ignore")).toBe(true);
    expect(row(10).querySelector(".prep-cur-exc-badge")?.textContent).toContain("ignorée");
    expect(row(20).classList.contains("prep-conv-unit-row--exc-override")).toBe(true);
    expect(row(20).querySelector(".prep-cur-exc-badge")?.textContent).toContain("épinglée");
    expect(excBtn(10, "Rétablir")).not.toBeUndefined();
    expect(host.querySelector("#prep-cur-summary")?.textContent).toContain("1 ignorée");
    expect(host.querySelector("#prep-cur-summary")?.textContent).toContain("1 épinglée");
  });

  it("Ignorer une unité changée : POST set(ignore) + badge + marqueur curated retiré", async () => {
    let setBody: unknown = null;
    const conn = fakeConn({
      units: [unit(1), unit(2)],
      preview: () => ({
        ok: true, doc_id: 1, stats: { units_total: 2, units_changed: 1, replacements_total: 1 },
        examples: [{ unit_id: 10, external_id: 1, before: "a", after: "b" }],
      }),
      onExcSet: (b) => { setBody = b; },
    });
    const pane = new CurationPane(host, () => conn, () => {});
    await pane.setDocument(1, null);
    const cb = host.querySelector<HTMLInputElement>('input[data-preset="spaces"]')!;
    cb.checked = true; cb.dispatchEvent(new Event("change"));
    (host.querySelector("#prep-cur-preview-btn") as HTMLButtonElement).click();
    await flush();
    expect(row(10).classList.contains("prep-conv-unit-row--curated")).toBe(true);

    excBtn(10, "Ignorer").click();
    await flush();
    expect(setBody).toEqual({ unit_id: 10, kind: "ignore", override_text: undefined });
    expect(row(10).classList.contains("prep-conv-unit-row--exc-ignore")).toBe(true);
    expect(row(10).classList.contains("prep-conv-unit-row--curated")).toBe(false);
    expect(host.querySelector("#prep-cur-summary")?.textContent).toContain("1 ignorée");
  });

  it("une ligne changée n'expose plus de bouton Épingler (retiré, redondant au canvas)", async () => {
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
    const labels = Array.from(row(10).querySelectorAll(".prep-cur-exc-btn")).map((b) => b.textContent);
    expect(labels).toContain("Ignorer");
    expect(labels).not.toContain("Épingler");
  });

  it("Rétablir : POST delete + badge retiré", async () => {
    let delBody: unknown = null;
    const pane = new CurationPane(host, () => fakeConn({
      units: [unit(1), unit(2)],
      exceptions: [exc(10, "ignore")],
      onExcDelete: (b) => { delBody = b; },
    }), () => {});
    await pane.setDocument(1, null);
    expect(row(10).querySelector(".prep-cur-exc-badge")).not.toBeNull();

    excBtn(10, "Rétablir").click();
    await flush();
    expect(delBody).toEqual({ unit_id: 10 });
    expect(row(10).querySelector(".prep-cur-exc-badge")).toBeNull();
    expect(row(10).classList.contains("prep-conv-unit-row--exc-ignore")).toBe(false);
  });

  it("stylo sur une unité épinglée : resynchronise l'override (anti-revert silencieux)", async () => {
    const setBodies: unknown[] = [];
    let textBody: unknown = null;
    const conn = fakeConn({
      units: [unit(1, { text_norm: "avant" })],
      exceptions: [exc(10, "override", "avant")],
      onExcSet: (b) => setBodies.push(b),
      updateText: (b) => { textBody = b; return { unit_id: 10, doc_id: 1, n: 1, text_raw: "avant", text_norm: "corrigé" }; },
    });
    const pane = new CurationPane(host, () => conn, () => {});
    await pane.setDocument(1, null);
    expect(row(10).querySelector(".prep-cur-exc-badge")?.textContent).toContain("épinglée");

    // A pinned row still exposes the stylo pen (transversal, CanvasUnitList).
    host.querySelector<HTMLButtonElement>('.prep-conv-unit-row[data-uid="10"] .prep-conv-unit-edit')!.click();
    host.querySelector<HTMLTextAreaElement>(".prep-conv-unit-editor")!.value = "corrigé";
    host.querySelector<HTMLButtonElement>(".prep-conv-unit-editor-actions .btn-primary")!.click();
    await flush();

    expect(textBody).toEqual({ unit_id: 10, text_norm: "corrigé" });
    // The override was re-set to the corrected text → a later /curate won't revert it.
    expect(setBodies).toContainEqual({ unit_id: 10, kind: "override", override_text: "corrigé" });
  });

  it("échec du chargement des unités : le message d'erreur survit (pas de render final qui l'écrase)", async () => {
    // Regression guard: setDocument re-renders after loading exceptions; that render must
    // NOT run when units failed to load, or it clobbers the error message with an empty list.
    const conn = {
      get: async (path: string) => {
        if (path === "/conventions") return { conventions: [] };
        if (path.startsWith("/units")) throw new Error("boom units");
        return {};
      },
      post: async () => ({}),
    } as unknown as Conn;
    const pane = new CurationPane(host, () => conn, () => {});
    await pane.setDocument(1, null);
    const area = host.querySelector("#prep-cur-units");
    expect(area?.textContent).toContain("Erreur");
    expect(area?.textContent).toContain("boom units");
  });
});

describe("CurationPane — revue : relu + persistance + filtres (R6.5-B Lot B)", () => {
  const selectPreset = (key: string) => {
    const cb = host.querySelector<HTMLInputElement>(`input[data-preset="${key}"]`)!;
    cb.checked = true; cb.dispatchEvent(new Event("change"));
  };
  const preview = () => (host.querySelector("#prep-cur-preview-btn") as HTMLButtonElement).click();
  const reluBtn = (uid: number) => host.querySelector<HTMLButtonElement>(`.prep-conv-unit-row[data-uid="${uid}"] .prep-cur-relu-btn`)!;
  const rows = () => host.querySelectorAll<HTMLElement>(".prep-conv-unit-row");
  const summary = () => host.querySelector("#prep-cur-summary")?.textContent ?? "";

  const changedPreview = (examples: Array<{ unit_id: number; before: string; after: string; matched_rule_ids?: number[] }>) =>
    () => ({ ok: true, doc_id: 1, stats: { units_total: examples.length, units_changed: examples.length, replacements_total: examples.length }, examples });

  it("marquer relu : bascule le bouton, met à jour le résumé et persiste (D2)", async () => {
    const conn = fakeConn({
      units: [unit(1), unit(2)],
      preview: changedPreview([{ unit_id: 10, before: "a", after: "b" }, { unit_id: 20, before: "c", after: "d" }]),
    });
    const pane = new CurationPane(host, () => conn, () => {});
    await pane.setDocument(1, null);
    selectPreset("spaces"); preview(); await flush();
    expect(summary()).toContain("2 à curer");

    expect(reluBtn(10).textContent).toContain("relu ?");
    reluBtn(10).click();
    expect(reluBtn(10).textContent).toContain("✓ relu");
    expect(host.querySelector('.prep-conv-unit-row[data-uid="10"]')!.classList.contains("prep-conv-unit-row--relu")).toBe(true);
    expect(summary()).toContain("(1 relue)");

    const blob = JSON.parse(localStorage.getItem("agrafes.prep.curate.review.canvas.1")!);
    expect(Object.keys(blob.relu)).toEqual(["10"]);
  });

  it("re-aperçu (mêmes règles) restaure les marqueurs relu persistés", async () => {
    const conn = fakeConn({ units: [unit(1)], preview: changedPreview([{ unit_id: 10, before: "a", after: "b" }]) });
    const pane = new CurationPane(host, () => conn, () => {});
    await pane.setDocument(1, null);
    selectPreset("spaces"); preview(); await flush();
    reluBtn(10).click();
    preview(); await flush();
    expect(reluBtn(10).textContent).toContain("✓ relu");
  });

  it("une édition (before différent) périme le marqueur au re-aperçu (beforeHash)", async () => {
    let before = "a";
    const conn = fakeConn({
      units: [unit(1)],
      preview: () => ({ ok: true, doc_id: 1, stats: { units_total: 1, units_changed: 1, replacements_total: 1 }, examples: [{ unit_id: 10, before, after: "b" }] }),
    });
    const pane = new CurationPane(host, () => conn, () => {});
    await pane.setDocument(1, null);
    selectPreset("spaces"); preview(); await flush();
    reluBtn(10).click(); // relu on before="a"
    before = "z"; // the unit's text changed between sessions
    preview(); await flush();
    expect(reluBtn(10).textContent).toContain("relu ?"); // stale → dropped
  });

  it("changer de règles périme les marqueurs relu (signature)", async () => {
    const conn = fakeConn({ units: [unit(1)], preview: changedPreview([{ unit_id: 10, before: "a", after: "b" }]) });
    const pane = new CurationPane(host, () => conn, () => {});
    await pane.setDocument(1, null);
    selectPreset("spaces"); preview(); await flush();
    reluBtn(10).click();
    selectPreset("quotes"); // adds a preset → invalidates the preview + changes the signature
    preview(); await flush();
    expect(reluBtn(10).textContent).toContain("relu ?");
  });

  it("filtre par statut : Relues / À revoir masquent les autres", async () => {
    const conn = fakeConn({
      units: [unit(1), unit(2), unit(3)],
      preview: changedPreview([{ unit_id: 10, before: "a", after: "b" }, { unit_id: 20, before: "c", after: "d" }, { unit_id: 30, before: "e", after: "f" }]),
    });
    const pane = new CurationPane(host, () => conn, () => {});
    await pane.setDocument(1, null);
    selectPreset("spaces"); preview(); await flush();
    reluBtn(10).click(); // 10 relu; 20/30 à revoir
    const chip = (sf: string) => host.querySelector<HTMLButtonElement>(`.prep-cur-chip[data-sf="${sf}"]`)!;
    chip("relu").click();
    expect(rows().length).toBe(1);
    expect(rows()[0].dataset.uid).toBe("10");
    chip("todo").click();
    expect(rows().length).toBe(2);
    chip("all").click();
    expect(rows().length).toBe(3);
  });

  it("bulk « tout marquer relu » marque toutes les unités à revoir visibles", async () => {
    const conn = fakeConn({
      units: [unit(1), unit(2)],
      preview: changedPreview([{ unit_id: 10, before: "a", after: "b" }, { unit_id: 20, before: "c", after: "d" }]),
    });
    const pane = new CurationPane(host, () => conn, () => {});
    await pane.setDocument(1, null);
    selectPreset("spaces"); preview(); await flush();
    host.querySelector<HTMLButtonElement>("#prep-cur-bulk-relu")!.click();
    expect(summary()).toContain("(2 relues)");
    expect(host.querySelectorAll(".prep-conv-unit-row--relu").length).toBe(2);
  });

  it("filtre par règle : ne montre que les unités changées par ce preset (#14)", async () => {
    // spaces = rule indices 0-1 ("Espaces") ; quotes = 2-5 ("Apostrophes et guillemets").
    const conn = fakeConn({
      units: [unit(1), unit(2)],
      preview: changedPreview([
        { unit_id: 10, before: "a", after: "b", matched_rule_ids: [0] },
        { unit_id: 20, before: "c", after: "d", matched_rule_ids: [2] },
      ]),
    });
    const pane = new CurationPane(host, () => conn, () => {});
    await pane.setDocument(1, null);
    selectPreset("spaces"); selectPreset("quotes"); preview(); await flush();
    const espaces = host.querySelector<HTMLButtonElement>('.prep-cur-chip[data-rf="Espaces"]')!;
    expect(espaces).not.toBeNull();
    espaces.click();
    expect(rows().length).toBe(1);
    expect(rows()[0].dataset.uid).toBe("10");
  });

  it("la ligne de stats reflète le filtre (matched/total), pas seulement la recherche", async () => {
    const conn = fakeConn({
      units: [unit(1), unit(2), unit(3)],
      preview: changedPreview([{ unit_id: 10, before: "a", after: "b" }, { unit_id: 20, before: "c", after: "d" }, { unit_id: 30, before: "e", after: "f" }]),
    });
    const pane = new CurationPane(host, () => conn, () => {});
    await pane.setDocument(1, null);
    selectPreset("spaces"); preview(); await flush();
    reluBtn(10).click(); // 10 relu
    host.querySelector<HTMLButtonElement>('.prep-cur-chip[data-sf="relu"]')!.click();
    // 1 of 3 rows visible → the count must say 1/3, not "3 unités" (rowFilter must feed onStats).
    expect(host.querySelector("#prep-cur-search-stats")?.textContent).toContain("1/3");
  });

  it("persistance cross-instance : un nouveau pane restaure les marqueurs relu (D2)", async () => {
    const mk = () => fakeConn({ units: [unit(1)], preview: changedPreview([{ unit_id: 10, before: "a", after: "b" }]) });
    const pane1 = new CurationPane(host, mk, () => {});
    await pane1.setDocument(1, null);
    selectPreset("spaces"); preview(); await flush();
    reluBtn(10).click();
    expect(reluBtn(10).textContent).toContain("✓ relu");

    // Fresh instance + fresh host, same localStorage → must restore on preview (true persistence).
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
    const pane2 = new CurationPane(host, mk, () => {});
    await pane2.setDocument(1, null);
    selectPreset("spaces"); preview(); await flush();
    expect(reluBtn(10).textContent).toContain("✓ relu");
  });
});

describe("CurationPane — règle avancée Find/Replace + Trouver (R6.5-B Lot C)", () => {
  const set = (sel: string, v: string) => { (host.querySelector(sel) as HTMLInputElement).value = v; };
  const click = (sel: string) => (host.querySelector(sel) as HTMLButtonElement).click();
  const fb = () => host.querySelector("#prep-cur-fr-feedback")?.textContent ?? "";

  it("Activer : la règle F/R entre dans le run d'aperçu", async () => {
    let body: { rules?: Array<Record<string, unknown>> } | null = null;
    const conn = fakeConn({
      units: [unit(1, { text_norm: "aXb" })],
      preview: (b) => { body = b as typeof body; return { ok: true, doc_id: 1, stats: { units_total: 1, units_changed: 0, replacements_total: 0 }, examples: [] }; },
    });
    const pane = new CurationPane(host, () => conn, () => {});
    await pane.setDocument(1, null);
    set("#prep-cur-fr-find", "X"); set("#prep-cur-fr-replace", "Y");
    click("#prep-cur-fr-apply-btn");
    click("#prep-cur-preview-btn");
    await flush();
    expect(body!.rules).toEqual(expect.arrayContaining([
      expect.objectContaining({ pattern: "X", replacement: "Y", description: "R/R: X" }),
    ]));
  });

  it("motif littéral (regex décoché) : le pattern est échappé", async () => {
    let body: { rules?: Array<Record<string, unknown>> } | null = null;
    const conn = fakeConn({
      units: [unit(1)],
      preview: (b) => { body = b as typeof body; return { ok: true, doc_id: 1, stats: { units_total: 1, units_changed: 0, replacements_total: 0 }, examples: [] }; },
    });
    const pane = new CurationPane(host, () => conn, () => {});
    await pane.setDocument(1, null);
    set("#prep-cur-fr-find", "a.b");
    click("#prep-cur-fr-apply-btn");
    click("#prep-cur-preview-btn");
    await flush();
    const fr = body!.rules!.find((r) => r.description === "R/R: a.b")!;
    expect(fr.pattern).toBe("a\\.b");
  });

  it("Trouver : compte les occurrences + surligne les lignes matchées", async () => {
    const pane = new CurationPane(host, () => fakeConn({
      units: [unit(1, { text_norm: "le chat" }), unit(2, { text_norm: "un chien" }), unit(3, { text_norm: "le chat noir" })],
    }), () => {});
    await pane.setDocument(1, null);
    set("#prep-cur-fr-find", "chat");
    click("#prep-cur-fr-find-btn");
    expect(fb()).toContain("2 occurrences dans 2 unités");
    expect(host.querySelectorAll(".prep-conv-unit-row--found, .prep-conv-unit-row--found-active").length).toBe(2);
    expect((host.querySelector("#prep-cur-fr-nav") as HTMLElement).style.display).not.toBe("none");
  });

  it("Trouver : ◄► navigue entre les unités matchées", async () => {
    const pane = new CurationPane(host, () => fakeConn({
      units: [unit(1, { text_norm: "chat" }), unit(2, { text_norm: "chien" }), unit(3, { text_norm: "chat" })],
    }), () => {});
    await pane.setDocument(1, null);
    set("#prep-cur-fr-find", "chat");
    click("#prep-cur-fr-find-btn");
    expect(host.querySelector("#prep-cur-fr-pos")?.textContent).toBe("1 / 2");
    expect(host.querySelector('.prep-conv-unit-row[data-uid="10"]')?.classList.contains("prep-conv-unit-row--found-active")).toBe(true);
    click("#prep-cur-fr-next");
    expect(host.querySelector("#prep-cur-fr-pos")?.textContent).toBe("2 / 2");
    expect(host.querySelector('.prep-conv-unit-row[data-uid="30"]')?.classList.contains("prep-conv-unit-row--found-active")).toBe(true);
  });

  it("Effacer : retire la règle F/R et vide les champs", async () => {
    const pane = new CurationPane(host, () => fakeConn({ units: [unit(1)] }), () => {});
    await pane.setDocument(1, null);
    set("#prep-cur-fr-find", "x");
    click("#prep-cur-fr-apply-btn");
    expect((host.querySelector("#prep-cur-fr-badge") as HTMLElement).style.display).not.toBe("none");
    click("#prep-cur-fr-clear-btn");
    expect((host.querySelector("#prep-cur-fr-find") as HTMLInputElement).value).toBe("");
    expect((host.querySelector("#prep-cur-fr-badge") as HTMLElement).style.display).toBe("none");
  });

  it("regex invalide → feedback d'erreur, pas de règle", async () => {
    const pane = new CurationPane(host, () => fakeConn({ units: [unit(1)] }), () => {});
    await pane.setDocument(1, null);
    set("#prep-cur-fr-find", "[");
    (host.querySelector("#prep-cur-fr-regex") as HTMLInputElement).checked = true;
    click("#prep-cur-fr-apply-btn");
    expect(fb()).toContain("invalide");
    expect((host.querySelector("#prep-cur-fr-badge") as HTMLElement).style.display).toBe("none");
  });

  it("une règle active marque le <details> (indicateur visible même replié)", async () => {
    const pane = new CurationPane(host, () => fakeConn({ units: [unit(1)] }), () => {});
    await pane.setDocument(1, null);
    const details = host.querySelector(".prep-cur-fr")!;
    expect(details.classList.contains("prep-cur-fr--active")).toBe(false);
    set("#prep-cur-fr-find", "x");
    click("#prep-cur-fr-apply-btn");
    expect(details.classList.contains("prep-cur-fr--active")).toBe(true);
    click("#prep-cur-fr-clear-btn");
    expect(details.classList.contains("prep-cur-fr--active")).toBe(false);
  });
});

describe("CurationPane — undo Apply (R6.5-B Lot D)", () => {
  const undoBtn = () => host.querySelector("#prep-cur-undo-btn") as HTMLButtonElement;

  it("le bouton reflète l'éligibilité (activé + label dynamique)", async () => {
    const conn = fakeConn({
      units: [unit(1)],
      undoElig: { eligible: true, action_type: "curation_apply", action_id: 5, description: "Apply 2 règles · 3 unités" },
    });
    const pane = new CurationPane(host, () => conn, () => {});
    await pane.setDocument(1, null);
    expect(undoBtn().disabled).toBe(false);
    expect(undoBtn().textContent).toContain("Apply 2 règles");
  });

  it("désactivé quand aucune action annulable", async () => {
    const conn = fakeConn({ units: [unit(1)], undoElig: { eligible: false, reason: "no_action" } });
    const pane = new CurationPane(host, () => conn, () => {});
    await pane.setDocument(1, null);
    expect(undoBtn().disabled).toBe(true);
    expect(undoBtn().textContent).toContain("Annuler");
  });

  it("clic : POST /prep/undo (doc-scopé) + recharge + résumé", async () => {
    let body: unknown = null;
    const conn = fakeConn({
      units: [unit(1)],
      undoElig: { eligible: true, action_type: "curation_apply", action_id: 5, description: "Apply" },
      onUndo: (b) => { body = b; },
    });
    const pane = new CurationPane(host, () => conn, () => {});
    await pane.setDocument(1, null);
    undoBtn().click();
    await flush();
    expect(body).toEqual({ doc_id: 1 });
    expect(host.querySelector("#prep-cur-summary")?.textContent).toContain("Annulé");
    expect(host.querySelector("#prep-cur-summary")?.textContent).toContain("3 unités restaurées");
  });

  it("désactivé sans document sélectionné", async () => {
    const conn = fakeConn({
      units: [unit(1)],
      undoElig: { eligible: true, action_type: "curation_apply", action_id: 5, description: "x" },
    });
    const pane = new CurationPane(host, () => conn, () => {});
    await pane.setDocument(null, null);
    expect(undoBtn().disabled).toBe(true);
  });

  it("échec du rechargement après undo : le message d'erreur survit (garde clobber)", async () => {
    let unitsCalls = 0;
    const conn = {
      get: async (path: string) => {
        if (path === "/conventions") return { conventions: [] };
        if (path.startsWith("/units")) {
          unitsCalls++;
          if (unitsCalls >= 2) throw new Error("boom reload"); // le rechargement d'undo échoue
          return { units: [unit(1)], count: 1, doc_id: 1 };
        }
        return {};
      },
      post: async (path: string) => {
        if (path === "/prep/undo/eligibility") return { eligible: true, action_type: "curation_apply", action_id: 1, description: "Apply" };
        if (path === "/prep/undo") return { undo_action_id: 1, reverted_action_id: 1, reverted_action_type: "curation_apply", units_restored: 2, alignments_reflagged: 0, fts_stale: false };
        if (path === "/curate/exceptions") return { ok: true, exceptions: [], count: 0 };
        return {};
      },
    } as unknown as Conn;
    const pane = new CurationPane(host, () => conn, () => {});
    await pane.setDocument(1, null); // call 1 : OK
    undoBtn().click();
    await flush(); // undo → rechargement (call 2) échoue
    const area = host.querySelector("#prep-cur-units");
    expect(area?.textContent).toContain("Erreur");
    expect(area?.textContent).toContain("boom reload");
  });
});
