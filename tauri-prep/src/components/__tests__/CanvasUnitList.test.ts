// @vitest-environment happy-dom
/**
 * Behavioural test for the shared canvas unit-list base (R5.1a), extracted from
 * RolesPane which had no direct DOM test. Locks the render + selection + search +
 * badge + text-start behaviour so the R5.1b curation mode can build on it safely.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { CanvasUnitList } from "../CanvasUnitList.ts";
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
