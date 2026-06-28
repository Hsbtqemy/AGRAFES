/**
 * Unit tests for the promise-based confirm modal (audit FE-05 — replaces the
 * native window.confirm). happy-dom is the global test env (vite.config.ts).
 */

import { afterEach, describe, expect, it } from "vitest";

import { confirmModal } from "../confirmModal";

afterEach(() => {
  document.getElementById("app-confirm-overlay")?.remove();
});

function buttons(): HTMLButtonElement[] {
  const overlay = document.getElementById("app-confirm-overlay");
  return Array.from(overlay?.querySelectorAll("button") ?? []) as HTMLButtonElement[];
}

describe("confirmModal", () => {
  it("mounts an overlay and resolves true when confirmed", async () => {
    const p = confirmModal("Proceed?");
    expect(document.getElementById("app-confirm-overlay")).toBeTruthy();
    buttons()[1].click(); // [cancel, confirm]
    await expect(p).resolves.toBe(true);
    expect(document.getElementById("app-confirm-overlay")).toBeNull(); // cleaned up
  });

  it("resolves false when cancelled", async () => {
    const p = confirmModal("Proceed?");
    buttons()[0].click();
    await expect(p).resolves.toBe(false);
    expect(document.getElementById("app-confirm-overlay")).toBeNull();
  });

  it("renders multi-line messages as text (no innerHTML)", async () => {
    const p = confirmModal("line one\nline two");
    const overlay = document.getElementById("app-confirm-overlay")!;
    expect(overlay.textContent).toContain("line one");
    expect(overlay.textContent).toContain("line two");
    buttons()[0].click();
    await p;
  });

  it("uses custom button labels", async () => {
    const p = confirmModal("x", { confirmLabel: "Go", cancelLabel: "Stop" });
    const labels = buttons().map(b => b.textContent);
    expect(labels).toEqual(["Stop", "Go"]);
    buttons()[0].click();
    await p;
  });
});
