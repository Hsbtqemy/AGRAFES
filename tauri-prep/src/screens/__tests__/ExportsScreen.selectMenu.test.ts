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
