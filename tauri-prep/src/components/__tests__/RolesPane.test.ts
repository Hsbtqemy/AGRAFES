// @vitest-environment happy-dom
/**
 * Dock wiring for the Rôles layer (R5.3-2): the selection action bar (borne/rôle) is
 * re-parented into the shared canvas dock when one is provided, so it stays pinned to the
 * viewport bottom instead of scrolling away; without a dock (legacy SegmentationView) it
 * stays in-pane. mount() is pure DOM — no sidecar connection needed.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { RolesPane } from "../RolesPane.ts";

let host: HTMLElement;
let dock: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = "";
  host = document.createElement("div");
  dock = document.createElement("div");
  document.body.append(host, dock);
});

describe("RolesPane dock (R5.3-2)", () => {
  it("re-parents the action bar into the dock when one is provided", () => {
    const pane = new RolesPane(host, () => null, () => {}, dock);
    pane.mount();
    expect(host.querySelector("#prep-conv-action-bar")).toBeNull();
    expect(dock.querySelector("#prep-conv-action-bar")).not.toBeNull();
  });

  it("keeps the action bar in-pane without a dock (legacy fallback)", () => {
    const pane = new RolesPane(host, () => null, () => {});
    pane.mount();
    expect(host.querySelector("#prep-conv-action-bar")).not.toBeNull();
  });

  it("deactivate() retracts the docked action bar", () => {
    const pane = new RolesPane(host, () => null, () => {}, dock);
    pane.mount();
    const bar = dock.querySelector<HTMLElement>("#prep-conv-action-bar")!;
    bar.classList.add("visible");
    bar.innerHTML = "<button>x</button>";
    pane.deactivate();
    expect(bar.classList.contains("visible")).toBe(false);
    expect(bar.innerHTML).toBe("");
  });
});
