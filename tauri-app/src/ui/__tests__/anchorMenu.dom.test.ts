/** Passe adverse — les applicateurs DOM, pas seulement la géométrie. */
import { describe, expect, it } from "vitest";
import { clampAnchoredMenu, clampFixedMenu } from "../../../../shared/anchorMenu";

function menuDe(w: number, h: number, hostW: number, hostH: number): HTMLElement {
  document.body.innerHTML = "";
  const host = document.createElement("div");
  host.style.cssText = `overflow:hidden;position:relative;width:${hostW}px;height:${hostH}px`;
  const menu = document.createElement("div");
  menu.style.cssText = `position:absolute;width:${w}px;height:${h}px`;
  host.appendChild(menu);
  document.body.appendChild(host);
  return menu;
}

describe("adverse — rects à zéro (happy-dom, ou appel avant la mise en page)", () => {
  it("ne borne pas un menu qui n'a pas encore de géométrie", () => {
    const menu = menuDe(200, 150, 800, 520);
    clampAnchoredMenu(menu);
    expect(menu.style.maxWidth).toBe("");
    expect(menu.style.maxHeight).toBe("");
  });

  it("idem pour un menu fixed", () => {
    const menu = document.createElement("div");
    menu.style.cssText = "position:fixed;left:0;top:0";
    document.body.appendChild(menu);
    clampFixedMenu(menu);
    expect(menu.style.maxWidth).toBe("");
  });
});

describe("adverse — réouverture", () => {
  it("efface le débordement imposé au tour précédent", () => {
    const menu = menuDe(200, 150, 800, 520);
    menu.style.maxHeight = "100px";
    menu.style.overflowY = "auto";
    menu.style.maxWidth = "100px";
    menu.style.transform = "translate(50px, 0px)";
    clampAnchoredMenu(menu);
    expect(menu.style.maxHeight).toBe("");
    expect(menu.style.maxWidth).toBe("");
    expect(menu.style.overflowY).toBe("");
    expect(menu.style.transform).toBe("");
  });
});
