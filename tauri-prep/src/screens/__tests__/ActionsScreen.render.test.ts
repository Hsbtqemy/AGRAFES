// @vitest-environment happy-dom
/**
 * Render-smoke for ActionsScreen (retrait Seg tranche 6) — companion to
 * MetadataScreen.render.test.ts.
 *
 * ActionsScreen.render() had no test coverage, yet tranche 6 removed the
 * `segmentation` sub-view panel from it. This locks that removal (no
 * `[data-panel="segmentation"]`), the surviving panel set, and the
 * localStorage migration of a stale « segmentation » preference → canvas.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { ActionsScreen } from "../ActionsScreen.ts";

// Mirror of the private static ActionsScreen.LS_ACTIVE_SUB.
const LS_ACTIVE_SUB = "agrafes.prep.actions.active";

describe("ActionsScreen render-smoke (retrait Seg tranche 6)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders the main element without a connection", () => {
    const el = new ActionsScreen().render();
    expect(el).toBeInstanceOf(HTMLElement);
    expect(el.className).toContain("prep-actions-screen");
  });

  it("builds the surviving panels and NOT the removed segmentation panel", () => {
    const el = new ActionsScreen().render();
    for (const panel of ["hub", "alignement", "matrice", "texte"]) {
      expect(el.querySelector(`[data-panel="${panel}"]`), `missing ${panel}`).not.toBeNull();
    }
    // tranche 6: the legacy segmentation panel is gone (nav routes to the canvas).
    expect(el.querySelector('[data-panel="segmentation"]')).toBeNull();
  });

  it("migrates a stale « segmentation » subview preference to the canvas (texte)", () => {
    localStorage.setItem(LS_ACTIVE_SUB, "segmentation");
    const el = new ActionsScreen().render();
    // _loadSubViewPref rewrites the removed value → "texte": the canvas panel is
    // the visible one, the hub is hidden.
    const texte = el.querySelector<HTMLElement>('[data-panel="texte"]');
    const hub = el.querySelector<HTMLElement>('[data-panel="hub"]');
    expect(texte?.style.display).toBe("");
    expect(hub?.style.display).toBe("none");
  });

  it("setConn(null) after render does not throw", () => {
    const view = new ActionsScreen();
    view.render();
    expect(() => view.setConn(null)).not.toThrow();
  });
});
