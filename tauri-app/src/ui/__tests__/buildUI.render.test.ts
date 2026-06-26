/**
 * Render-smoke for the concordancier UI scaffold (U-03).
 *
 * Mounts the REAL buildUI() against a headless DOM (happy-dom, set globally in
 * vite.config.ts) with NO sidecar connection — buildUI only constructs DOM and
 * wires listeners; every network call lives in the (un-invoked) event handlers.
 * Asserts the key structure renders and that the full build path stays
 * mountable.
 *
 * This is a characterization safety-net for the ~7.3k-line, near-untested app
 * (audit finding U-03), mirroring the CurationView render-smoke (#124, T-05). It
 * does not exercise behaviour — only that the large build path stays mountable,
 * the de-risking groundwork before testing the feature logic underneath.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { buildUI } from "../buildUI";

/** Mount buildUI into a fresh, document-attached container. */
function mount(): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  buildUI(container);
  return container;
}

beforeEach(() => {
  // buildUI resolves several elements via document.getElementById during wiring
  // and injects a <style> into <head> — start each test from a clean document.
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

describe("buildUI render-smoke", () => {
  it("mounts the full scaffold without throwing", () => {
    expect(() => mount()).not.toThrow();
  });

  it("renders the topbar and the search toolbar", () => {
    const c = mount();
    expect(c.querySelector(".topbar")).not.toBeNull();
    expect(c.querySelector<HTMLInputElement>("#search-input")).not.toBeNull();
    expect(c.querySelector("#search-btn")).not.toBeNull();
    expect(c.querySelector("#mode-seg")).not.toBeNull();
    expect(c.querySelector("#mode-kwic")).not.toBeNull();
  });

  it("renders the filter drawer (hidden) with its filter groups", () => {
    const c = mount();
    const drawer = c.querySelector("#filter-drawer");
    expect(drawer).not.toBeNull();
    expect(drawer!.classList.contains("hidden")).toBe(true);
    expect(c.querySelector("#filter-role-sel")).not.toBeNull();
    expect(c.querySelector("#filter-family-sel")).not.toBeNull();
    expect(c.querySelector("#filter-author")).not.toBeNull();
    expect(c.querySelector("#filter-source-ext")).not.toBeNull();
  });

  it("renders the query builder with all seven modes (hidden, simple default)", () => {
    const c = mount();
    const panel = c.querySelector("#builder-panel");
    expect(panel).not.toBeNull();
    expect(panel!.classList.contains("hidden")).toBe(true);
    expect(c.querySelectorAll("input[name='builder-mode']")).toHaveLength(7);
    const checked = c.querySelector<HTMLInputElement>("input[name='builder-mode']:checked");
    expect(checked?.value).toBe("simple");
  });

  it("renders the stats panel, import modal and metadata panel", () => {
    const c = mount();
    expect(c.querySelector("#stats-panel")).not.toBeNull();
    expect(c.querySelector("#import-modal")).not.toBeNull();
    expect(c.querySelector("#import-mode-select")).not.toBeNull();
    expect(c.querySelector("#meta-panel")).not.toBeNull();
  });

  it("renders the results area in its initial 'starting' empty-state", () => {
    const c = mount();
    const area = c.querySelector("#results-area");
    expect(area).not.toBeNull();
    expect(area!.querySelector(".empty-state")).not.toBeNull();
    expect(area!.textContent).toContain("Démarrage");
  });
});
