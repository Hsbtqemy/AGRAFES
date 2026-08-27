// @vitest-environment happy-dom
/**
 * Behavioural test for the shared canvas unit-list base (R5.1a), extracted from
 * RolesPane which had no direct DOM test. Locks the render + selection + search +
 * badge + text-start behaviour so the R5.1b curation mode can build on it safely.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { CanvasUnitList, markRowTextRepainted } from "../CanvasUnitList.ts";
import type { ConventionRole, UnitRecord } from "../../lib/sidecarClient.ts";

function unit(n: number, over: Partial<UnitRecord> = {}): UnitRecord {
  return {
    unit_id: n * 10, n, text_norm: `unit ${n}`, text_raw: `unit ${n}`,
    unit_type: "line", unit_role: null, parent_n: null, ...over,
  };
}
function role(name: string, over: Partial<ConventionRole> = {}): ConventionRole {
  return { name, label: name, color: "#123456", icon: null, sort_order: 0, category: "text", ...over } as ConventionRole;
}

let host: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
});

describe("render", () => {
  it("shows the placeholder when no document is selected", () => {
    const list = new CanvasUnitList(host);
    list.render();
    expect(host.textContent).toContain("Sélectionnez un document");
  });

  it("renders one row per unit with n + text", () => {
    const list = new CanvasUnitList(host);
    list.setData({ docId: 1, units: [unit(1), unit(2, { text_norm: "beta" })] });
    list.render();
    const rows = host.querySelectorAll(".prep-conv-unit-row");
    expect(rows.length).toBe(2);
    expect(rows[1].querySelector(".prep-conv-unit-text")?.textContent).toBe("beta");
  });

  it("renders a role badge when the unit has a role present in the catalogue", () => {
    const list = new CanvasUnitList(host);
    list.setData({ docId: 1, roles: [role("titre", { label: "Titre" })], units: [unit(1, { unit_role: "titre" })] });
    list.render();
    expect(host.querySelector(".prep-conv-unit-badge")?.textContent).toContain("Titre");
  });

  it("empty doc vs no-match give distinct messages", () => {
    const list = new CanvasUnitList(host);
    list.setData({ docId: 1, units: [] });
    list.render();
    expect(host.textContent).toContain("Aucune unité dans ce document");

    list.setData({ units: [unit(1)] });
    list.setSearch("zzz");
    expect(host.textContent).toContain("Aucune unité ne correspond");
  });
});

describe("selection", () => {
  it("toggles a row and fires onSelectionChange", () => {
    const seen: number[] = [];
    const list = new CanvasUnitList(host, { onSelectionChange: (s) => seen.push(s.size) });
    list.setData({ docId: 1, units: [unit(1), unit(2)] });
    list.render();
    (host.querySelector(".prep-conv-unit-row") as HTMLElement).click();
    expect(list.getSelection().has(10)).toBe(true);
    expect(host.querySelector(".prep-conv-unit-row.selected")).not.toBeNull();
    expect(seen[seen.length - 1]).toBe(1);
  });

  it("shift-click selects the range from the anchor", () => {
    const list = new CanvasUnitList(host);
    list.setData({ docId: 1, units: [unit(1), unit(2), unit(3)] });
    list.render();
    const rows = () => host.querySelectorAll<HTMLElement>(".prep-conv-unit-row");
    rows()[0].click();
    rows()[2].dispatchEvent(new MouseEvent("click", { shiftKey: true, bubbles: true }));
    expect([...list.getSelection()].sort((a, b) => a - b)).toEqual([10, 20, 30]);
  });

  it("clearSelection empties + fires; clearSelectionQuiet does not fire", () => {
    let fired = 0;
    const list = new CanvasUnitList(host, { onSelectionChange: () => { fired++; } });
    list.setData({ docId: 1, units: [unit(1)] });
    list.render();
    (host.querySelector(".prep-conv-unit-row") as HTMLElement).click();
    fired = 0;
    list.clearSelection();
    expect(list.getSelection().size).toBe(0);
    expect(fired).toBe(1);
    list.clearSelectionQuiet();
    expect(fired).toBe(1); // no extra fire
  });
});

describe("search + stats", () => {
  it("filters rows and reports matched/total via onStats", () => {
    const stats: string[] = [];
    const list = new CanvasUnitList(host, { onStats: (t) => stats.push(t) });
    list.setData({ docId: 1, units: [unit(1, { text_norm: "alpha" }), unit(2, { text_norm: "beta" })] });
    list.render();
    list.setSearch("bet");
    expect(host.querySelectorAll(".prep-conv-unit-row").length).toBe(1);
    expect(stats[stats.length - 1]).toContain("1/2 unités");
  });
});

describe("decor + text-start hooks", () => {
  it("calls decorateRow for every rendered row with its unit", () => {
    const decorated: number[] = [];
    const list = new CanvasUnitList(host, {
      decorateRow: (u, el) => { decorated.push(u.unit_id); el.classList.add("has-decor"); },
    });
    list.setData({ docId: 1, units: [unit(1), unit(2)] });
    list.render();
    expect(decorated.sort((a, b) => a - b)).toEqual([10, 20]);
    expect(host.querySelectorAll(".prep-conv-unit-row.has-decor").length).toBe(2);
  });

  it("renders the text-start marker and its clear button fires onClearTextStart", () => {
    let cleared = 0;
    const list = new CanvasUnitList(host, { onClearTextStart: () => { cleared++; } });
    list.setData({ docId: 1, units: [unit(1), unit(2)], textStartN: 2 });
    list.render();
    const clearBtn = host.querySelector<HTMLElement>(".prep-conv-text-start-clear");
    expect(clearBtn).not.toBeNull();
    clearBtn!.click();
    expect(cleared).toBe(1);
  });
});

describe("stylo — édition en place (D-C8)", () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("n'ajoute le ✎ que si onEditText est fourni", () => {
    const bare = new CanvasUnitList(host);
    bare.setData({ docId: 1, units: [unit(1)] });
    bare.render();
    expect(host.querySelector(".prep-conv-unit-edit")).toBeNull();

    host.innerHTML = "";
    const list = new CanvasUnitList(host, { onEditText: async () => {} });
    list.setData({ docId: 1, units: [unit(1), unit(2)] });
    list.render();
    expect(host.querySelectorAll(".prep-conv-unit-edit").length).toBe(2);
  });

  it("✎ ouvre une textarea en place seedée du text_norm, Enregistrer appelle onEditText", async () => {
    const saved: Array<[number, string]> = [];
    const list = new CanvasUnitList(host, { onEditText: async (id, t) => { saved.push([id, t]); } });
    list.setData({ docId: 1, units: [unit(1, { text_norm: "avant" })] });
    list.render();
    host.querySelector<HTMLButtonElement>(".prep-conv-unit-edit")!.click();
    const ta = host.querySelector<HTMLTextAreaElement>(".prep-conv-unit-editor")!;
    expect(ta.value).toBe("avant");
    ta.value = "après";
    host.querySelector<HTMLButtonElement>(".prep-conv-unit-editor-actions .btn-primary")!.click();
    await flush();
    expect(saved).toEqual([[10, "après"]]);
    expect(host.querySelector(".prep-conv-unit-editor")).toBeNull(); // fermé
    expect(host.querySelector(".prep-conv-unit-text")?.textContent).toBe("après"); // reflété
  });

  it("garde l'éditeur ouvert si onEditText échoue", async () => {
    const list = new CanvasUnitList(host, { onEditText: async () => { throw new Error("boom"); } });
    list.setData({ docId: 1, units: [unit(1, { text_norm: "x" })] });
    list.render();
    host.querySelector<HTMLButtonElement>(".prep-conv-unit-edit")!.click();
    const ta = host.querySelector<HTMLTextAreaElement>(".prep-conv-unit-editor")!;
    ta.value = "y";
    host.querySelector<HTMLButtonElement>(".prep-conv-unit-editor-actions .btn-primary")!.click();
    await flush();
    expect(host.querySelector(".prep-conv-unit-editor")).not.toBeNull(); // reste ouvert
    expect(host.querySelector(".prep-conv-unit-text")).toBeNull(); // texte non remplacé
  });

  it("cliquer une ligne pendant l'édition ne change pas la sélection", async () => {
    const seen: number[] = [];
    const list = new CanvasUnitList(host, {
      onEditText: async () => {},
      onSelectionChange: (s) => seen.push(s.size),
    });
    list.setData({ docId: 1, units: [unit(1), unit(2)] });
    list.render();
    host.querySelector<HTMLButtonElement>(".prep-conv-unit-edit")!.click(); // entre en édition
    const rows = host.querySelectorAll<HTMLElement>(".prep-conv-unit-row");
    rows[1].click(); // clic sur une autre ligne pendant l'édition
    expect(seen).toEqual([]); // aucune sélection émise
    expect(list.getSelection().size).toBe(0);
  });
});

describe("balisage riche <hi> (§5)", () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("rend l'italique importé plutôt que le texte plat", () => {
    const list = new CanvasUnitList(host);
    list.setData({
      docId: 1,
      units: [unit(1, { text_raw: 'un <hi rend="italic">mot</hi> ici', text_norm: "un mot ici" })],
    });
    list.render();
    const textEl = host.querySelector(".prep-conv-unit-text")!;
    expect(textEl.querySelector("em")).not.toBeNull();
    expect(textEl.textContent).toBe("un mot ici");
  });

  it("rend le texte corrigé quand le verbatim est périmé, sans balisage", () => {
    // La curation / le stylo réécrivent text_norm en gardant text_raw (D-C1) :
    // le balisage décrit alors un texte qui n'existe plus.
    const list = new CanvasUnitList(host);
    list.setData({
      docId: 1,
      units: [unit(1, {
        text_raw: 'The <hi rend="italic">Observer</hi>,  14 Aug 2022',
        text_norm: "The Observer, 14 Aug 2022",
      })],
    });
    list.render();
    const textEl = host.querySelector(".prep-conv-unit-text")!;
    expect(textEl.querySelector("em")).toBeNull();
    expect(textEl.textContent).toBe("The Observer, 14 Aug 2022");
  });

  it("n'injecte jamais de HTML venu du texte", () => {
    const list = new CanvasUnitList(host);
    list.setData({
      docId: 1,
      units: [unit(1, { text_raw: "<img src=x onerror=alert(1)>", text_norm: "<img src=x onerror=alert(1)>" })],
    });
    list.render();
    expect(host.querySelector(".prep-conv-unit-text img")).toBeNull();
    expect(host.querySelector(".prep-conv-unit-text")!.textContent).toContain("<img");
  });

  it("après une correction en place, la ligne affiche le texte corrigé", async () => {
    const list = new CanvasUnitList(host, { onEditText: async () => {} });
    list.setData({
      docId: 1,
      units: [unit(1, { text_raw: 'un <hi rend="italic">mot</hi> ici', text_norm: "un mot ici" })],
    });
    list.render();
    host.querySelector<HTMLButtonElement>(".prep-conv-unit-edit")!.click();
    const ta = host.querySelector<HTMLTextAreaElement>(".prep-conv-unit-editor")!;
    ta.value = "un mot corrigé ici";
    host.querySelector<HTMLButtonElement>(".prep-conv-unit-editor-actions .btn-primary")!.click();
    await flush();
    const textEl = host.querySelector(".prep-conv-unit-text")!;
    expect(textEl.textContent).toBe("un mot corrigé ici");
    expect(textEl.querySelector("em")).toBeNull(); // le balisage périmé ne revient pas
  });
});

describe("stylisation inline (§5, DESIGN_inline_restyling)", () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));

  /** Sélectionne `[from, to)` dans le texte de la première ligne, puis relâche la souris. */
  function selectInRow(from: number, to: number): HTMLElement {
    const span = host.querySelector<HTMLElement>(".prep-conv-unit-text")!;
    const node = span.firstChild!;
    const range = document.createRange();
    range.setStart(node, from);
    range.setEnd(node, to);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    span.dispatchEvent(new window.MouseEvent("mouseup", { bubbles: true }));
    return span;
  }

  function bar(): HTMLElement | null {
    return document.querySelector<HTMLElement>(".prep-conv-stylebar");
  }

  it("ne montre aucune barre tant qu'aucune sélection n'est faite", () => {
    const list = new CanvasUnitList(host, { onStyleText: async () => {} });
    list.setData({ docId: 1, units: [unit(1, { text_norm: "un mot ici", text_raw: "un mot ici" })] });
    list.render();
    expect(bar()).toBeNull();
  });

  it("montre la barre I/G sur une sélection", () => {
    const list = new CanvasUnitList(host, { onStyleText: async () => {} });
    list.setData({ docId: 1, units: [unit(1, { text_norm: "un mot ici", text_raw: "un mot ici" })] });
    list.render();
    selectInRow(3, 6);
    expect(bar()).not.toBeNull();
    expect(bar()!.hidden).toBe(false);
    expect(bar()!.querySelectorAll(".prep-conv-stylebar-btn").length).toBe(2);
  });

  it("persiste le text_raw balisé sans toucher au text_norm", async () => {
    const saved: Array<[number, string]> = [];
    const list = new CanvasUnitList(host, {
      onStyleText: async (uid, textRaw) => { saved.push([uid, textRaw]); },
    });
    const u = unit(1, { text_norm: "un mot ici", text_raw: "un mot ici" });
    list.setData({ docId: 1, units: [u] });
    list.render();
    selectInRow(3, 6);
    bar()!.querySelector<HTMLElement>(".prep-conv-stylebar-btn--italic")!
      .dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
    await flush();
    expect(saved).toEqual([[10, 'un <hi rend="italic">mot</hi> ici']]);
    expect(u.text_norm).toBe("un mot ici"); // le geste n'ajoute que des balises
  });

  it("affiche l'italique après avoir stylisé", async () => {
    const list = new CanvasUnitList(host, { onStyleText: async () => {} });
    list.setData({ docId: 1, units: [unit(1, { text_norm: "un mot ici", text_raw: "un mot ici" })] });
    list.render();
    selectInRow(3, 6);
    bar()!.querySelector<HTMLElement>(".prep-conv-stylebar-btn--italic")!
      .dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
    await flush();
    expect(host.querySelector(".prep-conv-unit-text em")?.textContent).toBe("mot");
  });

  it("bascule : une sélection déjà en italique se dé-italicise", async () => {
    const saved: string[] = [];
    const list = new CanvasUnitList(host, { onStyleText: async (_u, raw) => { saved.push(raw); } });
    list.setData({
      docId: 1,
      units: [unit(1, { text_norm: "un mot ici", text_raw: 'un <hi rend="italic">mot</hi> ici' })],
    });
    list.render();
    // « mot » est en italique : la sélection porte sur 3 caractères affichés à partir de 3.
    const span = host.querySelector<HTMLElement>(".prep-conv-unit-text")!;
    const em = span.querySelector("em")!;
    const range = document.createRange();
    range.setStart(em.firstChild!, 0);
    range.setEnd(em.firstChild!, 3);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    span.dispatchEvent(new window.MouseEvent("mouseup", { bubbles: true }));
    bar()!.querySelector<HTMLElement>(".prep-conv-stylebar-btn--italic")!
      .dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
    await flush();
    expect(saved).toEqual(["un mot ici"]);
  });

  it("stylise le texte corrigé, pas le verbatim périmé", async () => {
    const saved: string[] = [];
    const list = new CanvasUnitList(host, { onStyleText: async (_u, raw) => { saved.push(raw); } });
    list.setData({
      docId: 1,
      units: [unit(1, {
        // Le verbatim décrit un texte que la curation a réécrit : styliser repart du courant.
        text_raw: 'The <hi rend="italic">Observer</hi>,  14 Aug 2022',
        text_norm: "The Observer, 14 Aug 2022",
      })],
    });
    list.render();
    selectInRow(4, 12); // « Observer » dans le texte corrigé
    bar()!.querySelector<HTMLElement>(".prep-conv-stylebar-btn--bold")!
      .dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
    await flush();
    expect(saved).toEqual(['The <hi rend="bold">Observer</hi>, 14 Aug 2022']);
  });

  it("ne fait rien quand l'hôte ne câble pas la persistance", () => {
    const list = new CanvasUnitList(host);
    list.setData({ docId: 1, units: [unit(1, { text_norm: "un mot ici", text_raw: "un mot ici" })] });
    list.render();
    const span = host.querySelector<HTMLElement>(".prep-conv-unit-text")!;
    span.dispatchEvent(new window.MouseEvent("mouseup", { bubbles: true }));
    expect(bar()).toBeNull();
  });
  it("stylise une ligne nue portant une entité XML, sans décalage", async () => {
    // Sur une ligne SANS balise, `richTextToHtml` ré-échappe : l'écran affiche « &amp; »
    // en toutes lettres, donc exactement les caractères de la base. La conversion doit
    // alors être l'identité. Le garde refusait ces lignes ; c'était un faux refus.
    const saved: string[] = [];
    const list = new CanvasUnitList(host, { onStyleText: async (_id, r) => { saved.push(r); } });
    const text = "Fleury &amp; A.";
    list.setData({ docId: 1, units: [unit(1, { text_norm: text, text_raw: text })] });
    list.render();
    const span = host.querySelector<HTMLElement>(".prep-conv-unit-text")!;
    expect(span.textContent).toBe("Fleury &amp; A."); // l'entité s'affiche en toutes lettres

    selectInRow(13, 15); // « A. », en coordonnées d'écran
    expect(bar()!.hidden).toBe(false);
    bar()!.querySelector<HTMLElement>(".prep-conv-stylebar-btn--italic")!
      .dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
    await flush();
    expect(saved).toEqual(['Fleury &amp; <hi rend="italic">A.</hi>']);
  });

  it("repose la sélection au bon endroit malgré une entité XML avant elle", async () => {
    // Sur une ligne DÉJÀ balisée, le navigateur résout l'entité : cinq caractères en base
    // pour un seul à l'écran. Une restauration naïve décalerait la sélection de quatre.
    const saved: string[] = [];
    const list = new CanvasUnitList(host, { onStyleText: async (_id, r) => { saved.push(r); } });
    list.setData({ docId: 1, units: [unit(1, {
      text_norm: "Marks &amp; Spencer plc",
      text_raw: '<hi rend="bold">Marks</hi> &amp; Spencer plc',
    })] });
    list.render();
    const span = host.querySelector<HTMLElement>(".prep-conv-unit-text")!;
    expect(span.textContent).toBe("Marks & Spencer plc"); // l'entité est affichée résolue

    const node = [...span.childNodes].find((n) => (n.textContent ?? "").includes("Spencer"))!;
    const range = document.createRange();
    range.setStart(node, 3);  // « Spencer » dans le nœud « & Spencer plc »
    range.setEnd(node, 10);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    span.dispatchEvent(new window.MouseEvent("mouseup", { bubbles: true }));
    expect(bar()!.hidden).toBe(false);

    bar()!.querySelector<HTMLElement>(".prep-conv-stylebar-btn--italic")!
      .dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
    await flush();
    expect(saved).toEqual(['<hi rend="bold">Marks</hi> &amp; <hi rend="italic">Spencer</hi> plc']);
    expect(window.getSelection()!.toString()).toBe("Spencer"); // et pas « encer p »
  });

  it("garde le surlignage et la barre après un style, pour enchaîner I puis G", async () => {
    const saved: Array<[number, string]> = [];
    const list = new CanvasUnitList(host, { onStyleText: async (id, r) => { saved.push([id, r]); } });
    list.setData({ docId: 1, units: [unit(1, { text_norm: "un mot ici", text_raw: "un mot ici" })] });
    list.render();
    selectInRow(3, 6);

    const press = (t: string) => bar()!.querySelector<HTMLElement>(`.prep-conv-stylebar-btn--${t}`)!
      .dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));

    press("italic");
    await flush();
    // La barre reste, et la sélection aussi : le second style s'applique sans re-viser.
    expect(bar()!.hidden).toBe(false);
    const sel = window.getSelection()!;
    expect(sel.isCollapsed).toBe(false);
    expect(sel.toString()).toBe("mot");

    press("bold");
    await flush();
    expect(saved).toEqual([
      [10, 'un <hi rend="italic">mot</hi> ici'],
      [10, 'un <hi rend="bold italic">mot</hi> ici'],
    ]);
  });

  it("ne repeint que la ligne stylisée, sans refaire la liste", async () => {
    const decorated: number[] = [];
    const list = new CanvasUnitList(host, {
      onStyleText: async () => {},
      decorateRow: (u) => { decorated.push(u.unit_id); },
    });
    list.setData({
      docId: 1,
      units: [
        unit(1, { text_norm: "un mot ici", text_raw: "un mot ici" }),
        unit(2, { text_norm: "une autre ligne", text_raw: "une autre ligne" }),
      ],
    });
    list.render();
    const rows = () => host.querySelectorAll<HTMLElement>(".prep-conv-unit-row");
    const otherBefore = rows()[1];
    decorated.length = 0; // on ne compte que ce qui suit le geste

    selectInRow(3, 6);
    bar()!.querySelector<HTMLElement>(".prep-conv-stylebar-btn--italic")!
      .dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
    await flush();

    const styled = rows()[0].querySelector(".prep-conv-unit-text")!;
    expect(styled.querySelector("em")).not.toBeNull();
    expect(styled.textContent).toBe("un mot ici");
    // Rien d'autre n'est reconstruit : la couche n'a pas à repeindre ses surcouches,
    // et les lignes voisines sont les mêmes nœuds qu'avant le geste.
    expect(decorated).toEqual([]);
    expect(rows()[1]).toBe(otherBefore);
  });

  it("le même bouton retire ce qu'il vient de poser, sans passer par Annuler", async () => {
    const saved: string[] = [];
    const list = new CanvasUnitList(host, { onStyleText: async (_id, r) => { saved.push(r); } });
    list.setData({ docId: 1, units: [unit(1, { text_norm: "un mot ici", text_raw: "un mot ici" })] });
    list.render();
    selectInRow(3, 6);

    const italic = () => bar()!.querySelector<HTMLElement>(".prep-conv-stylebar-btn--italic")!;
    italic().dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
    await flush();
    expect(italic().getAttribute("aria-pressed")).toBe("true"); // l'état suit le texte

    italic().dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
    await flush();
    expect(saved).toEqual(['un <hi rend="italic">mot</hi> ici', "un mot ici"]);
    expect(italic().getAttribute("aria-pressed")).toBe("false");
  });

  it("la sélection reposée couvre le même passage à travers les balises neuves", async () => {
    const list = new CanvasUnitList(host, { onStyleText: async () => {} });
    list.setData({ docId: 1, units: [unit(1, { text_norm: "un mot ici", text_raw: "un mot ici" })] });
    list.render();
    selectInRow(0, 6); // « un mot », à cheval sur ce qui deviendra deux nœuds
    bar()!.querySelector<HTMLElement>(".prep-conv-stylebar-btn--italic")!
      .dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
    await flush();
    // La ligne porte désormais « un <em>mot</em> ici » : la sélection traverse les nœuds.
    expect(host.querySelector(".prep-conv-unit-text em")).not.toBeNull();
    expect(window.getSelection()!.toString()).toBe("un mot");
  });
});

describe("stylisation inline — gardes de la passe adverse", () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));

  function selectAll(span: HTMLElement): void {
    const range = document.createRange();
    range.selectNodeContents(span); // robuste quand la ligne contient deja un <em>
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    span.dispatchEvent(new window.MouseEvent("mouseup", { bubbles: true }));
  }
  const bar = () => document.querySelector<HTMLElement>(".prep-conv-stylebar");

  it("refuse une ligne que la couche DÉCLARE avoir repeinte", () => {
    // L'Annotation reconstruit le texte depuis les tokens, avec ses propres règles
    // d'espacement : les offsets lus à l'écran ne désignent plus les mêmes caractères.
    // La couche le déclare — on ne le devine plus en comparant des longueurs, ce qui
    // laissait passer toute ligne où deux écarts se compensent.
    const list = new CanvasUnitList(host, {
      onStyleText: async () => {},
      decorateRow: (_u, el) => {
        const span = el.querySelector<HTMLElement>(".prep-conv-unit-text");
        if (span) span.textContent = "un mot ici repeint autrement";
        markRowTextRepainted(el);
      },
    });
    list.setData({ docId: 1, units: [unit(1, { text_norm: "un mot ici", text_raw: "un mot ici" })] });
    list.render();
    selectAll(host.querySelector<HTMLElement>(".prep-conv-unit-text")!);
    expect(bar()?.hidden ?? true).toBe(true);
  });

  it("un repeint de MÊME longueur est refusé lui aussi — l'ancien garde le laissait passer", () => {
    // Cas des 196 unités espagnoles : « ¡Vaya caterva ! » stocké, « ¡ Vaya caterva! »
    // affiché, 15 caractères des deux côtés. Comparer les longueurs ne voyait rien.
    const list = new CanvasUnitList(host, {
      onStyleText: async () => {},
      decorateRow: (_u, el) => {
        const span = el.querySelector<HTMLElement>(".prep-conv-unit-text");
        if (span) span.textContent = "¡ Vaya caterva!";
        markRowTextRepainted(el);
      },
    });
    list.setData({ docId: 1, units: [unit(1, { text_norm: "¡Vaya caterva !", text_raw: "¡Vaya caterva !" })] });
    list.render();
    const span = host.querySelector<HTMLElement>(".prep-conv-unit-text")!;
    expect(span.textContent!.length).toBe(15); // même longueur : l'ancien garde passait
    selectAll(span);
    expect(bar()?.hidden ?? true).toBe(true);
  });

  it("la barre ne survit pas à un rendu", () => {
    const list = new CanvasUnitList(host, { onStyleText: async () => {} });
    list.setData({ docId: 1, units: [unit(1, { text_norm: "un mot ici", text_raw: "un mot ici" })] });
    list.render();
    selectAll(host.querySelector<HTMLElement>(".prep-conv-unit-text")!);
    expect(bar()!.hidden).toBe(false);
    list.render();
    expect(bar()!.hidden).toBe(true);
  });

  it("la barre ne survit pas à un changement de document", () => {
    const list = new CanvasUnitList(host, { onStyleText: async () => {} });
    list.setData({ docId: 1, units: [unit(1, { text_norm: "un mot ici", text_raw: "un mot ici" })] });
    list.render();
    selectAll(host.querySelector<HTMLElement>(".prep-conv-unit-text")!);
    list.clearSelectionQuiet();
    expect(bar()!.hidden).toBe(true);
  });

  /** Ouvre l'éditeur sur l'unité 1 d'une liste de deux, et rend la main sur les deux lignes. */
  async function withOpenEditor(styled: string[][] = []) {
    const list = new CanvasUnitList(host, {
      onStyleText: async (id, raw) => { styled.push([String(id), raw]); },
      onEditText: async () => {},
    });
    list.setData({
      docId: 1,
      units: [
        unit(1, { text_norm: "un mot ici", text_raw: "un mot ici" }),
        unit(2, { text_norm: "autre ligne", text_raw: "autre ligne" }),
      ],
    });
    list.render();
    host.querySelector<HTMLButtonElement>(".prep-conv-unit-edit")!.click();
    await flush();
    return list;
  }

  it("ne propose rien sur la ligne en cours de correction : elle n'a plus de texte", async () => {
    await withOpenEditor();
    // La textarea a remplacé le span : il n'y a pas de texte balisable à sélectionner.
    const row = host.querySelector<HTMLElement>('.prep-conv-unit-row[data-uid="10"]')!;
    expect(row.querySelector(".prep-conv-unit-text")).toBeNull();
    expect(bar()?.hidden ?? true).toBe(true);
  });

  it("stylise une AUTRE ligne pendant une correction, sans perdre la frappe", async () => {
    const styled: string[][] = [];
    await withOpenEditor(styled);
    const ta = host.querySelector<HTMLTextAreaElement>(".prep-conv-unit-editor")!;
    ta.value = "je tape encore";

    const other = host.querySelector<HTMLElement>('.prep-conv-unit-row[data-uid="20"] .prep-conv-unit-text')!;
    selectAll(other);
    expect(bar()!.hidden).toBe(false);

    bar()!.querySelector<HTMLElement>(".prep-conv-stylebar-btn--italic")!
      .dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
    await flush();
    expect(styled).toEqual([["20", '<hi rend="italic">autre ligne</hi>']]);
    // Le rendu déclenché par la stylisation ne doit pas avoir effacé la correction.
    expect(host.querySelector<HTMLTextAreaElement>(".prep-conv-unit-editor")!.value).toBe("je tape encore");
  });

  it("marque l'état du bouton pour les lecteurs d'écran", () => {
    const list = new CanvasUnitList(host, { onStyleText: async () => {} });
    list.setData({
      docId: 1,
      units: [unit(1, { text_norm: "un mot ici", text_raw: '<hi rend="italic">un mot ici</hi>' })],
    });
    list.render();
    selectAll(host.querySelector<HTMLElement>(".prep-conv-unit-text")!);
    const italic = bar()!.querySelector<HTMLElement>(".prep-conv-stylebar-btn--italic")!;
    const bold = bar()!.querySelector<HTMLElement>(".prep-conv-stylebar-btn--bold")!;
    expect(italic.getAttribute("aria-pressed")).toBe("true");
    expect(bold.getAttribute("aria-pressed")).toBe("false");
  });
});
describe("stylisation inline — le clic qui suit le glisser", () => {
  const bar = () => document.querySelector<HTMLElement>(".prep-conv-stylebar");

  it("la barre survit au `click` que le navigateur émet après un glisser de sélection", () => {
    // Un glisser de sélection se termine par mouseup PUIS click sur la ligne. Si ce clic
    // est traité comme une sélection de ligne, il rerend la liste — et emporte la barre.
    const list = new CanvasUnitList(host, { onStyleText: async () => {} });
    list.setData({ docId: 1, units: [unit(1, { text_norm: "un mot ici", text_raw: "un mot ici" })] });
    list.render();

    const span = host.querySelector<HTMLElement>(".prep-conv-unit-text")!;
    const range = document.createRange();
    range.setStart(span.firstChild!, 3);
    range.setEnd(span.firstChild!, 6);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    span.dispatchEvent(new window.MouseEvent("mouseup", { bubbles: true }));
    expect(bar()!.hidden).toBe(false);

    span.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(bar()!.hidden).toBe(false); // toujours là, la sélection de texte n'est pas un clic de ligne
  });

  it("un clic simple sélectionne toujours la ligne", () => {
    const seen: number[] = [];
    const list = new CanvasUnitList(host, {
      onStyleText: async () => {},
      onSelectionChange: (s) => seen.push(s.size),
    });
    list.setData({ docId: 1, units: [unit(1, { text_norm: "un mot ici", text_raw: "un mot ici" })] });
    list.render();
    window.getSelection()!.removeAllRanges(); // pas de sélection de texte
    host.querySelector<HTMLElement>(".prep-conv-unit-row")!
      .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(seen).toEqual([1]);
  });
});

describe("stylisation inline — où l'on relâche la souris", () => {
  const bar = () => document.querySelector<HTMLElement>(".prep-conv-stylebar");

  function twoLines() {
    const list = new CanvasUnitList(host, { onStyleText: async () => {} });
    list.setData({
      docId: 1,
      units: [
        unit(1, { text_norm: "un mot ici", text_raw: "un mot ici" }),
        unit(2, { text_norm: "autre ligne", text_raw: "autre ligne" }),
      ],
    });
    list.render();
    return host.querySelectorAll<HTMLElement>(".prep-conv-unit-text");
  }

  it("la barre apparaît même si l'on relâche hors du texte", () => {
    // Cas courant : on surligne d'un geste rapide et on relâche dans la marge, sur un
    // badge, ou au-delà de la fin de la ligne. L'écoute posée sur le seul texte ratait
    // alors la sélection (signalé en QA le 25 août).
    const spans = twoLines();
    const range = document.createRange();
    range.setStart(spans[0].firstChild!, 3);
    range.setEnd(spans[0].firstChild!, 6);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    document.body.dispatchEvent(new window.MouseEvent("mouseup", { bubbles: true }));
    expect(bar()!.hidden).toBe(false);
  });

  it("ne propose rien sur une sélection à cheval sur deux lignes", () => {
    const spans = twoLines();
    const range = document.createRange();
    range.setStart(spans[0].firstChild!, 3);
    range.setEnd(spans[1].firstChild!, 5);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    document.body.dispatchEvent(new window.MouseEvent("mouseup", { bubbles: true }));
    expect(bar()?.hidden ?? true).toBe(true);
  });

  it("ne propose rien pour une sélection faite hors de la liste", () => {
    twoLines();
    const outside = document.createElement("p");
    outside.textContent = "texte etranger";
    document.body.appendChild(outside);
    const range = document.createRange();
    range.setStart(outside.firstChild!, 0);
    range.setEnd(outside.firstChild!, 5);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    document.body.dispatchEvent(new window.MouseEvent("mouseup", { bubbles: true }));
    expect(bar()?.hidden ?? true).toBe(true);
  });
});

describe("éditeur inline — le brouillon survit à un rendu", () => {
  function editing() {
    const list = new CanvasUnitList(host, { onEditText: async () => {}, onStyleText: async () => {} });
    list.setData({ docId: 1, units: [unit(1), unit(2)] });
    list.render();
    host.querySelector<HTMLElement>('.prep-conv-unit-row[data-uid="10"] .prep-conv-unit-edit')!.click();
    const ta = host.querySelector<HTMLTextAreaElement>(".prep-conv-unit-editor")!;
    ta.value = "correction en cours";
    ta.dispatchEvent(new window.Event("input", { bubbles: true }));
    return { list, ta };
  }

  const openEditor = () => host.querySelector<HTMLTextAreaElement>(".prep-conv-unit-editor");

  it("une frappe dans la recherche ne perd pas la correction en cours", () => {
    const { list } = editing();
    list.setSearch("unit");
    expect(openEditor()!.value).toBe("correction en cours");
  });

  it("une assignation de rôle ne perd pas la correction en cours", () => {
    const { list } = editing();
    list.setUnitsRole([20], "titre");
    expect(openEditor()!.value).toBe("correction en cours");
  });

  it("le curseur est reposé où il était, pas rejeté à la fin", () => {
    const { list, ta } = editing();
    ta.setSelectionRange(4, 4);
    list.setSearch("unit");
    const after = openEditor()!;
    expect([after.selectionStart, after.selectionEnd]).toEqual([4, 4]);
  });

  it("ne vole pas le focus au champ qui a provoqué le rendu", () => {
    const { list } = editing();
    const search = document.createElement("input");
    document.body.appendChild(search);
    search.focus();
    list.setSearch("unit"); // ce que fait le champ de recherche à chaque frappe
    expect(document.activeElement).toBe(search);
  });

  it("rend le focus à la zone de saisie si elle l'avait", () => {
    const { list, ta } = editing();
    ta.focus();
    list.setSearch("unit");
    expect(document.activeElement).toBe(openEditor());
  });

  it("ouvrir le stylo sur une autre unité n'y reporte pas la frappe", () => {
    editing();
    host.querySelector<HTMLElement>('.prep-conv-unit-row[data-uid="20"] .prep-conv-unit-edit')!.click();
    expect(openEditor()!.value).toBe("unit 2");
  });

  it("le brouillon est oublié après annulation", () => {
    const { list } = editing();
    host.querySelectorAll<HTMLElement>(".prep-conv-unit-editor-actions button")[1].click();
    list.render();
    host.querySelector<HTMLElement>('.prep-conv-unit-row[data-uid="10"] .prep-conv-unit-edit')!.click();
    expect(openEditor()!.value).toBe("unit 1");
  });
});
