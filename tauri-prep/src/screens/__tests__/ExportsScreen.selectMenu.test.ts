// @vitest-environment happy-dom
/**
 * SEL-01 — les huit listes d'Exports peuplées par la base sont habillées d'un menu qui
 * s'ouvre vers le bas ; les trois `<select multiple>` restent natifs.
 *
 * L'inventaire du chantier en annonçait six pour cet écran. `bil-pivot-sel` et
 * `bil-target-sel` reçoivent eux aussi leurs `<option>` depuis les documents (même fonction
 * de peuplement que les autres) : ils étaient simplement absents de la liste. Le test les
 * nomme un par un, pour que la prochaine relecture parte d'un compte vérifié.
 */
import { describe, it, expect, afterEach } from "vitest";
import { ExportsScreen } from "../ExportsScreen.ts";
import type { DocumentRecord, FamilyRecord } from "../../lib/sidecarClient.ts";

const DOCS = [
  { doc_id: 1, title: "Le Livre", language: "fr" },
  { doc_id: 2, title: "The Book", language: "en" },
] as unknown as DocumentRecord[];

const FAMILLES = [{
  family_id: 1,
  parent: { doc_id: 1, title: "Le Livre", language: "fr" },
  children: [{ doc_id: 2, doc: { doc_id: 2, title: "The Book", language: "en" } }],
  stats: { total_docs: 2 },
}] as unknown as FamilyRecord[];

/** Remplit les listes depuis la base, comme le fait `_refreshDocs` une fois connecté. */
function peupler(screen: ExportsScreen): void {
  const s = screen as unknown as {
    _docs: DocumentRecord[]; _families: FamilyRecord[]; _renderDocOptions: () => void;
  };
  s._docs = DOCS;
  s._families = FAMILLES;
  s._renderDocOptions();
}

/** Le texte que le déclencheur d'un `<select>` habillé affiche à l'écran. */
function affiche(el: HTMLElement, id: string): string {
  return el.querySelector(id)?.closest(".prep-selmenu")
    ?.querySelector(".prep-selmenu-text")?.textContent ?? "";
}

/** Les huit listes peuplées par la base, et la largeur attendue de leur habillage. */
const HABILLES: Array<[string, string]> = [
  ["#align-csv-pivot", "prep-selmenu--doc"],
  ["#align-csv-target", "prep-selmenu--doc"],
  ["#v2-align-pivot", "prep-selmenu--doc"],
  ["#v2-align-target", "prep-selmenu--doc"],
  ["#bil-family-sel", "prep-selmenu--famille"],
  ["#bil-pivot-sel", "prep-selmenu--doc"],
  ["#bil-target-sel", "prep-selmenu--doc"],
  ["#matrix-family-sel", "prep-selmenu--famille"],
];

/** Ceux qui restent natifs : listes ouvertes (multiple) ou listes courtes et fixes. */
const NATIFS = ["#tei-doc-sel", "#pkg-doc-sel", "#v2-doc-sel", "#v2-stage", "#v2-format",
  "#bil-fmt", "#matrix-fmt", "#align-csv-fmt"];

function monter() {
  const screen = new ExportsScreen();
  const el = screen.render();
  document.body.appendChild(el);
  return { screen, el };
}

afterEach(() => { document.body.innerHTML = ""; });

describe("ExportsScreen — les listes peuplées par la base (SEL-01)", () => {
  it("habille les huit listes de documents et de familles, avec leur largeur", () => {
    const { el } = monter();
    for (const [id, classe] of HABILLES) {
      const sel = el.querySelector<HTMLSelectElement>(id);
      expect(sel, id).toBeTruthy();
      const enveloppe = sel!.closest(".prep-selmenu");
      expect(enveloppe, `${id} devrait être habillé`).toBeTruthy();
      // Sans cette classe le déclencheur se dimensionne sur l'entrée choisie, et la ligne
      // change de largeur à chaque sélection — ce que le <select> natif ne faisait pas.
      expect(enveloppe!.classList.contains(classe), `${id} → ${classe}`).toBe(true);
    }
  });

  it("laisse natifs les <select multiple> et les listes courtes", () => {
    const { el } = monter();
    for (const id of NATIFS) {
      const sel = el.querySelector<HTMLSelectElement>(id);
      expect(sel, id).toBeTruthy();
      expect(sel!.closest(".prep-selmenu"), `${id} devrait rester natif`).toBeNull();
    }
  });

  it("le préremplissage venu du workflow repeint les deux déclencheurs", () => {
    const { screen, el } = monter();
    peupler(screen);
    expect(affiche(el, "#v2-align-pivot")).toBe("— tous —");
    screen.applyWorkflowPrefill({ pivotDocId: 1, targetDocId: 2 });
    // `value` est une propriété : rien ne l'observe. Sans repeinture, les deux déclencheurs
    // afficheraient encore « — tous — » pendant que l'export part sur la paire 1↔2.
    expect(el.querySelector<HTMLSelectElement>("#v2-align-pivot")!.value).toBe("1");
    expect(affiche(el, "#v2-align-pivot")).toBe("#1 Le Livre");
    expect(affiche(el, "#v2-align-target")).toBe("#2 The Book");
  });

  it("choisir une famille en export bilingue repeint pivot et cible", () => {
    const { screen, el } = monter();
    peupler(screen);
    const fam = el.querySelector<HTMLSelectElement>("#bil-family-sel")!;
    fam.value = "1";
    fam.dispatchEvent(new Event("change", { bubbles: true }));
    // L'écran choisit lui-même le pivot (le parent) et la cible (le premier enfant).
    expect(el.querySelector<HTMLSelectElement>("#bil-pivot-sel")!.value).toBe("1");
    expect(affiche(el, "#bil-pivot-sel")).toBe("#1 Le Livre (fr)");
    expect(affiche(el, "#bil-target-sel")).toBe("#2 The Book (en)");
  });

  it("le <select> reste le modèle, et dispose() rend l'écran à son état d'origine", () => {
    const { screen, el } = monter();
    expect(el.querySelectorAll(".prep-selmenu-trigger").length).toBe(HABILLES.length);
    screen.dispose();
    for (const [id] of HABILLES) {
      const sel = el.querySelector<HTMLSelectElement>(id);
      expect(sel, id).toBeTruthy();
      expect(sel!.closest(".prep-selmenu"), `${id} devrait être démonté`).toBeNull();
    }
    expect(el.querySelectorAll(".prep-selmenu-trigger").length).toBe(0);
  });
});
