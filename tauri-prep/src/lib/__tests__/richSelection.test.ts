// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { selectRangeIn, selectionRangeIn } from "../richSelection.ts";
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

describe("selectRangeIn — reposer une sélection sur des nœuds neufs", () => {
  it("retrouve un passage à cheval sur plusieurs nœuds texte", () => {
    const span = document.createElement("span");
    span.innerHTML = 'un <em>mot</em> ici';
    document.body.appendChild(span);
    expect(selectRangeIn(span, 0, 6)).toBe(true);
    expect(document.getSelection()!.toString()).toBe("un mot");
  });

  it("colle la fin de sélection à la fin d'un nœud plutôt qu'au suivant", () => {
    const span = document.createElement("span");
    span.innerHTML = 'un <em>mot</em> ici';
    document.body.appendChild(span);
    expect(selectRangeIn(span, 3, 6)).toBe(true);
    const range = document.getSelection()!.getRangeAt(0);
    expect(range.toString()).toBe("mot");
    expect(range.endContainer.textContent).toBe("mot"); // et non " ici" à l'offset 0
  });

  it("accepte une borne posée tout à la fin du texte", () => {
    const span = document.createElement("span");
    span.innerHTML = 'un <em>mot</em>';
    document.body.appendChild(span);
    expect(selectRangeIn(span, 3, 6)).toBe(true);
    expect(document.getSelection()!.toString()).toBe("mot");
  });

  it("refuse des bornes qui débordent, plutôt que de viser à côté", () => {
    const span = document.createElement("span");
    span.textContent = "court";
    document.body.appendChild(span);
    expect(selectRangeIn(span, 2, 99)).toBe(false);
    expect(selectRangeIn(span, 4, 4)).toBe(false); // vide
  });

  it("fait l'aller-retour avec selectionRangeIn", () => {
    const span = document.createElement("span");
    span.innerHTML = 'un <em>mot</em> ici';
    document.body.appendChild(span);
    selectRangeIn(span, 2, 7);
    expect(selectionRangeIn(span, document.getSelection())).toEqual({ start: 2, end: 7 });
  });
});
