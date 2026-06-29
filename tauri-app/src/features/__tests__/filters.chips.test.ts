/**
 * Behavioural tests for renderChips() — the active-filter chip bar (U-03).
 *
 * renderChips reads state.filter* and renders one chip per active filter into
 * #chips-bar, toggling the bar's visibility and wiring each chip's remove (×)
 * button to clear that filter and re-render. happy-dom is the global env
 * (vite.config.ts); state is the shared singleton, reset before each test.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { state } from "../../state";
import { renderChips } from "../filters";
import type { FamilyRecord } from "../../lib/sidecarClient";

function makeFamily(id: number, title: string): FamilyRecord {
  return {
    family_id: id,
    parent: { doc_id: id, title, language: "fr", doc_role: null, resource_type: null },
    children: [],
    stats: {},
  } as unknown as FamilyRecord;
}

function resetFilters(): void {
  state.filterLangs = [];
  state.filterRole = "";
  state.filterResourceType = "";
  state.filterFamilyId = null;
  state.filterFamilyPivotOnly = false;
  state.filterDocIds = null;
  state.filterFederatedDbPaths = [];
  state.families = [];
  state.docs = [];
}

const bar = (): HTMLElement => document.getElementById("chips-bar")!;
const chips = (): HTMLElement[] => Array.from(bar().querySelectorAll<HTMLElement>(".app-chip"));

beforeEach(() => {
  document.body.replaceChildren();
  const el = document.createElement("div");
  el.id = "chips-bar";
  document.body.appendChild(el);
  resetFilters();
});

describe("renderChips", () => {
  it("aucun filtre → barre masquée, aucune chip", () => {
    renderChips();
    expect(chips()).toHaveLength(0);
    expect(bar().style.display).toBe("none");
  });

  it("filtre rôle → une chip 'Rôle: …', barre visible", () => {
    state.filterRole = "source";
    renderChips();
    expect(chips()).toHaveLength(1);
    expect(chips()[0].textContent).toContain("Rôle: source");
    expect(bar().style.display).toBe("");
  });

  it("plusieurs filtres → une chip chacun (langue, rôle, type)", () => {
    state.filterLangs = ["fr", "en"];
    state.filterRole = "source";
    state.filterResourceType = "corpus";
    renderChips();
    const txt = chips().map((c) => c.textContent ?? "");
    expect(chips()).toHaveLength(3);
    expect(txt.some((t) => t.includes("Langue: fr, en"))).toBe(true);
    expect(txt.some((t) => t.includes("Rôle: source"))).toBe(true);
    expect(txt.some((t) => t.includes("Type: corpus"))).toBe(true);
  });

  it("famille + pivotOnly → libellé du parent suffixé '(original)'", () => {
    state.filterFamilyId = 5;
    state.filterFamilyPivotOnly = true;
    state.families = [makeFamily(5, "Les Misérables")];
    renderChips();
    expect(chips()[0].textContent).toContain("Famille: Les Misérables (original)");
  });

  it("famille inconnue dans le cache → fallback 'Famille #id'", () => {
    state.filterFamilyId = 99;
    state.families = [];
    renderChips();
    expect(chips()[0].textContent).toContain("Famille: Famille #99");
  });

  it("sélection de docs vide → chip d'avertissement (chip--warn)", () => {
    state.filterDocIds = [];
    renderChips();
    const warn = bar().querySelector(".app-chip--warn");
    expect(warn).not.toBeNull();
    expect(warn!.textContent).toContain("aucun sélectionné");
  });

  it("bouton × retire le filtre, vide l'état et re-rend (chip disparaît)", () => {
    state.filterRole = "source";
    renderChips();
    expect(chips()).toHaveLength(1);
    bar().querySelector<HTMLButtonElement>(".app-chip-remove")!.click();
    expect(state.filterRole).toBe("");
    expect(chips()).toHaveLength(0);
    expect(bar().style.display).toBe("none");
  });
});
