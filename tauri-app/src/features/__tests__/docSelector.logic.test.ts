/**
 * Tests for features/docSelector.ts (FE-06 / U-03) — the multi-document filter
 * selector, previously untested. Covers the localStorage persistence round-trip
 * and its validation/normalisation (all-selected → null, drop ids absent from the
 * corpus, garbage → null, per-DB key isolation), plus the mounted checklist
 * (state-driven checks, title truncation, Tous/Aucun shortcuts, checkbox sync).
 * happy-dom is the package-global env (vite.config) and provides localStorage.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { state } from "../../state";
import {
  saveDocSelectorState,
  loadDocSelectorState,
  mountDocSelector,
  syncDocSelectorUI,
  clearDocSelector,
} from "../docSelector";
import type { DocumentRecord } from "../../lib/sidecarClient";

const DB = "/data/corpus.db";

function doc(id: number, o: Record<string, unknown> = {}): DocumentRecord {
  return { doc_id: id, title: `Doc ${id}`, language: "fr", ...o } as unknown as DocumentRecord;
}
const DOCS = [doc(1), doc(2), doc(3)];

function checkboxes(): HTMLInputElement[] {
  return [...document.querySelectorAll<HTMLInputElement>("#doc-selector-mount input[type=checkbox]")];
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="doc-selector-mount"></div>';
  state.filterDocIds = null;
});

// ─── Persistence ────────────────────────────────────────────────────────────
describe("save/load persistence", () => {
  it("save writes a subset and load restores it", () => {
    state.filterDocIds = [1, 3];
    saveDocSelectorState(DB);
    state.filterDocIds = null; // wipe before reload
    loadDocSelectorState(DOCS, DB);
    expect(state.filterDocIds).toEqual([1, 3]);
  });

  it("save(null) clears the stored selection", () => {
    state.filterDocIds = [1];
    saveDocSelectorState(DB);
    state.filterDocIds = null;
    saveDocSelectorState(DB);
    loadDocSelectorState(DOCS, DB);
    expect(state.filterDocIds).toBeNull();
  });

  it("load normalises an all-selected set to null (no filter)", () => {
    state.filterDocIds = [1, 2, 3];
    saveDocSelectorState(DB);
    state.filterDocIds = [99];
    loadDocSelectorState(DOCS, DB);
    expect(state.filterDocIds).toBeNull();
  });

  it("load drops ids that are no longer in the corpus", () => {
    state.filterDocIds = [1, 99];
    saveDocSelectorState(DB);
    state.filterDocIds = null;
    loadDocSelectorState(DOCS, DB);
    expect(state.filterDocIds).toEqual([1]);
  });

  it("load falls back to null on garbage or missing data", () => {
    localStorage.setItem("agrafes.docsel." + btoa(encodeURIComponent(DB)), "not json");
    loadDocSelectorState(DOCS, DB);
    expect(state.filterDocIds).toBeNull();

    state.filterDocIds = [1];
    loadDocSelectorState(DOCS, "/never/saved.db");
    expect(state.filterDocIds).toBeNull();
  });

  it("keys the selection per DB path", () => {
    state.filterDocIds = [2];
    saveDocSelectorState(DB);
    state.filterDocIds = null;
    loadDocSelectorState(DOCS, "/other/db.db"); // different key → nothing
    expect(state.filterDocIds).toBeNull();
  });
});

// ─── Mounted checklist ──────────────────────────────────────────────────────
describe("mountDocSelector", () => {
  it("shows an empty message when there are no docs", () => {
    mountDocSelector([], DB, () => {});
    expect(document.getElementById("doc-selector-mount")!.textContent).toContain("Aucun document indexé");
  });

  it("checks boxes per state.filterDocIds (null = all)", () => {
    state.filterDocIds = [1];
    mountDocSelector(DOCS, DB, () => {});
    const cbs = checkboxes();
    expect(cbs.map(c => c.checked)).toEqual([true, false, false]);
  });

  it("truncates a long title to 38 chars with an ellipsis", () => {
    mountDocSelector([doc(1, { title: "x".repeat(40) })], DB, () => {});
    const title = document.querySelector(".doc-sel-title")!.textContent!;
    expect(title.length).toBe(38);
    expect(title.endsWith("…")).toBe(true);
  });

  it("'Aucun' empties the selection and fires onChanged", () => {
    const onChanged = vi.fn();
    mountDocSelector(DOCS, DB, onChanged);
    (document.querySelectorAll(".doc-sel-btn")[1] as HTMLButtonElement).click(); // Aucun
    expect(state.filterDocIds).toEqual([]);
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("'Tous' resets the selection to null", () => {
    state.filterDocIds = [1];
    mountDocSelector(DOCS, DB, () => {});
    (document.querySelectorAll(".doc-sel-btn")[0] as HTMLButtonElement).click(); // Tous
    expect(state.filterDocIds).toBeNull();
  });

  it("unchecking one box yields the remaining subset (not null)", () => {
    const onChanged = vi.fn();
    mountDocSelector(DOCS, DB, onChanged); // all checked
    const cbs = checkboxes();
    cbs[1].checked = false;
    cbs[1].dispatchEvent(new Event("change"));
    expect(state.filterDocIds).toEqual([1, 3]);
    expect(onChanged).toHaveBeenCalledOnce();
  });
});

// ─── External sync ──────────────────────────────────────────────────────────
describe("syncDocSelectorUI / clearDocSelector", () => {
  it("syncs checkbox state from an externally-mutated state", () => {
    mountDocSelector(DOCS, DB, () => {}); // all checked
    state.filterDocIds = [2];
    syncDocSelectorUI();
    expect(checkboxes().map(c => c.checked)).toEqual([false, true, false]);
  });

  it("clearDocSelector resets to null, persists, and re-checks all", () => {
    state.filterDocIds = [1];
    mountDocSelector(DOCS, DB, () => {});
    clearDocSelector(DB);
    expect(state.filterDocIds).toBeNull();
    expect(checkboxes().every(c => c.checked)).toBe(true);
    expect(localStorage.getItem("agrafes.docsel." + btoa(encodeURIComponent(DB)))).toBeNull();
  });
});
