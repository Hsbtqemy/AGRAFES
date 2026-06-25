// @vitest-environment happy-dom
/**
 * Render-smoke for MetadataScreen (T-05) — companion to CurationView.render.test.ts.
 *
 * Mounts the real screen with no sidecar connection and asserts it builds its
 * key structure and tears down cleanly. De-risking groundwork for the future
 * decomposition of this 3.2k-line screen (U-02).
 */
import { describe, it, expect } from "vitest";
import { MetadataScreen } from "../MetadataScreen.ts";

describe("MetadataScreen render-smoke", () => {
  it("renders the main element without a connection", () => {
    const view = new MetadataScreen();
    const el = view.render();
    expect(el).toBeInstanceOf(HTMLElement);
    expect(el.className).toContain("actions-screen");
    expect(el.querySelector(".prep-meta-screen-head")).not.toBeNull();
  });

  it("renders the doc list + edit panel containers", () => {
    const el = new MetadataScreen().render();
    for (const sel of ["#prep-meta-doc-list", "#meta-edit-panel", "#meta-doc-count"]) {
      expect(el.querySelector(sel), `missing ${sel}`).not.toBeNull();
    }
  });

  it("setConn(null) after render does not throw and clears the filter", () => {
    const view = new MetadataScreen();
    view.render();
    expect(() => view.setConn(null)).not.toThrow();
    expect(view.hasPendingChanges()).toBe(false);
  });
});
