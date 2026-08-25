// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { selectionRangeIn } from "../richSelection.ts";
import { richTextToHtml } from "../sidecarClient.ts";

let host: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = "";
  host = document.createElement("span");
  document.body.appendChild(host);
});

/** Sélectionne du texte et rend les bornes calculées, comme le ferait un glisser-souris. */
function select(startNode: Node, startOff: number, endNode: Node, endOff: number) {
  const range = document.createRange();
  range.setStart(startNode, startOff);
  range.setEnd(endNode, endOff);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  return selectionRangeIn(host, sel);
}

describe("selectionRangeIn — ligne sans balisage", () => {
  it("rend les bornes d'une sélection simple", () => {
    host.textContent = "un mot ici";
    expect(select(host.firstChild!, 3, host.firstChild!, 6)).toEqual({ start: 3, end: 6 });
  });

  it("mesure pareil une sélection glissée de droite à gauche", () => {
    // Un glisser à rebours se représente par ancre > extension ; `getRangeAt` rend
    // toujours la plage en ordre de document, donc le résultat doit être identique.
    host.textContent = "un mot ici";
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.setBaseAndExtent(host.firstChild!, 6, host.firstChild!, 3);
    expect(selectionRangeIn(host, sel)).toEqual({ start: 3, end: 6 });
  });

  it("rend null sur une sélection vide", () => {
    host.textContent = "un mot ici";
    expect(select(host.firstChild!, 4, host.firstChild!, 4)).toBeNull();
  });
});

describe("selectionRangeIn — ligne déjà stylée (plusieurs nœuds texte)", () => {
  it("compte les caractères à travers un <em>", () => {
    host.innerHTML = richTextToHtml('un <hi rend="italic">mot</hi> ici', "un mot ici");
    const em = host.querySelector("em")!;
    // « ot ici » : commence dans l'italique, finit après.
    const r = select(em.firstChild!, 1, host.lastChild!, 4);
    expect(r).toEqual({ start: 4, end: 10 });
  });

  it("mesure une sélection entièrement contenue dans l'italique", () => {
    host.innerHTML = richTextToHtml('un <hi rend="italic">mot</hi> ici', "un mot ici");
    const em = host.querySelector("em")!;
    expect(select(em.firstChild!, 0, em.firstChild!, 3)).toEqual({ start: 3, end: 6 });
  });

  it("gère une sélection ancrée sur l'élément et non sur son texte", () => {
    // Un double-clic ou un Ctrl+A ancre souvent la sélection sur le conteneur.
    host.innerHTML = richTextToHtml('un <hi rend="italic">mot</hi> ici', "un mot ici");
    const r = select(host, 0, host, host.childNodes.length);
    expect(r).toEqual({ start: 0, end: 10 });
  });
});

describe("selectionRangeIn — refus", () => {
  it("rend null quand la sélection déborde de la ligne", () => {
    host.textContent = "un mot ici";
    const outside = document.createElement("span");
    outside.textContent = "ailleurs";
    document.body.appendChild(outside);
    const range = document.createRange();
    range.setStart(host.firstChild!, 3);
    range.setEnd(outside.firstChild!, 4);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    expect(selectionRangeIn(host, sel)).toBeNull();
  });

  it("rend null sans sélection du tout", () => {
    host.textContent = "un mot ici";
    expect(selectionRangeIn(host, null)).toBeNull();
  });
});
