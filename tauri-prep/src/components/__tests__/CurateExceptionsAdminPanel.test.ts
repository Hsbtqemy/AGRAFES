// @vitest-environment happy-dom
/**
 * Render-smoke for CurateExceptionsAdminPanel (U-02).
 *
 * The pure filter/group/format logic is covered in
 * lib/__tests__/curationExceptionsAdmin.test.ts; this characterises the DOM glue:
 * the panel builds its own skeleton on mount, stays inert without a connection, and
 * its badge / filter wiring does not throw.
 */
import { describe, it, expect } from "vitest";
import {
  CurateExceptionsAdminPanel,
  type CurateExceptionsAdminPanelDeps,
} from "../CurateExceptionsAdminPanel.ts";

function makeDeps(over: Partial<CurateExceptionsAdminPanelDeps> = {}): CurateExceptionsAdminPanelDeps {
  return {
    getConn: () => null,
    log: () => {},
    toast: () => {},
    pushLog: () => {},
    onExceptionDeleted: () => {},
    onExceptionUpdated: () => {},
    openInCuration: () => {},
    ...over,
  };
}

function mountPanel(deps?: Partial<CurateExceptionsAdminPanelDeps>) {
  const details = document.createElement("details");
  details.id = "act-exc-admin-panel";
  document.body.appendChild(details);
  const panel = new CurateExceptionsAdminPanel(details, makeDeps(deps));
  panel.mount();
  return { details, panel };
}

describe("CurateExceptionsAdminPanel render-smoke", () => {
  it("builds its skeleton on mount", () => {
    const { details } = mountPanel();
    expect(details.querySelector("#act-exc-admin-list")).not.toBeNull();
    expect(details.querySelector("#act-exc-admin-badge")).not.toBeNull();
    expect(details.querySelector("#act-exc-doc-filter")).not.toBeNull();
    expect(details.querySelectorAll(".prep-exc-filter-btn")).toHaveLength(3);
    expect(details.querySelector("#act-exc-export-json")).not.toBeNull();
    expect(details.querySelector("#act-exc-export-csv")).not.toBeNull();
  });

  it("load() without a connection is a no-op (no throw, no sidecar call)", async () => {
    const { panel } = mountPanel();
    await expect(panel.load()).resolves.toBeUndefined();
  });

  it("refreshAfterPreview on a closed panel reflects the session count on the badge", () => {
    const { details, panel } = mountPanel();
    panel.refreshAfterPreview(3);
    const badge = details.querySelector<HTMLElement>("#act-exc-admin-badge")!;
    expect(badge.textContent).toBe("3");
    expect(badge.style.display).toBe("inline-flex");
  });

  it("clicking a filter button toggles its active class without throwing", () => {
    const { details } = mountPanel();
    const ignoreBtn = details.querySelector<HTMLButtonElement>('[data-exc-filter="ignore"]')!;
    expect(() => ignoreBtn.click()).not.toThrow();
    expect(ignoreBtn.classList.contains("prep-exc-filter-active")).toBe(true);
  });
});
