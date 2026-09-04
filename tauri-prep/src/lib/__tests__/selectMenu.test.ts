// @vitest-environment happy-dom
/**
 * `lib/selectMenu.ts` — le menu qui remplace la liste native d'un `<select>`.
 *
 * Ce qui se garde ici n'est pas l'apparence mais le **contrat** : le `<select>` reste le
 * modèle. C'est lui qui porte `value`, lui qui émet `change`, lui qui garde ses `<option>` —
 * et c'est pour cela que les 85 assertions des huit suites de la matrice n'ont pas eu à
 * changer d'une ligne. Casser ce contrat les casserait toutes, mais indirectement : la
 * cause serait ici et l'échec là-bas.
 *
 * S'y ajoute ce qu'un `<select>` natif donnait gratuitement et qu'il faut désormais tenir
 * soi-même : le clavier, et le fait que la liste ne se retourne jamais.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { enhanceSelect } from "../selectMenu.ts";

/** Les libellés réels de la matrice : ils commencent par un identifiant, ce qui compte. */
const FAMILLES = [
  ["", "— choisir —"],
  ["366", "#366 Houellebecq-Carte_FR.docx (2 docs)"],
  ["368", "#368 Houellebecq-Plateforme_FR.docx (2 docs)"],
  ["373", "#373 Modiano-Rue_FR.docx (4 docs)"],
];

function poser(): HTMLSelectElement {
  document.body.innerHTML = "";
  const sel = document.createElement("select");
  sel.id = "fam";
  for (const [v, t] of FAMILLES) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = t;
    sel.appendChild(o);
  }
  document.body.appendChild(sel);
  return sel;
}

const declencheur = (): HTMLButtonElement =>
  document.querySelector<HTMLButtonElement>(".prep-selmenu-trigger")!;
const liste = (): HTMLElement => document.querySelector<HTMLElement>(".prep-selmenu-list")!;
const options = (): HTMLButtonElement[] =>
  Array.from(document.querySelectorAll<HTMLButtonElement>(".prep-selmenu-opt"));

describe("le `<select>` reste le modèle", () => {
  let sel: HTMLSelectElement;
  beforeEach(() => {
    sel = poser();
    enhanceSelect(sel);
  });

  it("il reste dans le DOM, avec ses options — c'est ce que les suites interrogent", () => {
    expect(document.getElementById("fam")).toBe(sel);
    expect(sel.querySelectorAll("option")).toHaveLength(4);
    expect(sel.querySelector('option[value="368"]')).not.toBeNull();
  });

  it("choisir dans le menu écrit dans le `<select>` et émet `change` depuis LUI", () => {
    // L'événement doit partir du `<select>` et remonter : pour tout le reste de
    // l'application, rien ne doit distinguer ce choix d'un choix natif.
    const vu = vi.fn();
    sel.addEventListener("change", vu);
    const remonte = vi.fn();
    document.body.addEventListener("change", remonte);

    declencheur().click();
    options().find((b) => b.dataset.value === "368")!.click();

    expect(sel.value).toBe("368");
    expect(vu).toHaveBeenCalledTimes(1);
    expect(remonte, "l'événement doit bouillonner, des écrans écoutent plus haut")
      .toHaveBeenCalledTimes(1);
  });

  it("choisir la valeur déjà posée n'émet rien", () => {
    sel.value = "368";
    const vu = vi.fn();
    sel.addEventListener("change", vu);
    declencheur().click();
    options().find((b) => b.dataset.value === "368")!.click();
    expect(vu).not.toHaveBeenCalled();
  });

  it("le déclencheur affiche l'option choisie, et l'invite s'écrit en atténué", () => {
    const texte = document.querySelector<HTMLElement>(".prep-selmenu-text")!;
    expect(texte.textContent).toBe("— choisir —");
    expect(texte.classList.contains("prep-selmenu-text--vide")).toBe(true);

    declencheur().click();
    options().find((b) => b.dataset.value === "373")!.click();
    expect(texte.textContent).toBe("#373 Modiano-Rue_FR.docx (4 docs)");
    expect(texte.classList.contains("prep-selmenu-text--vide")).toBe(false);
  });
});

describe("ce que le `<select>` fait sans prévenir", () => {
  it("`disabled` posé ailleurs désactive le déclencheur, sans qu'on l'appelle", async () => {
    // La matrice gèle ses sélecteurs pendant un run (discipline F5). Elle le fait par
    // `famSel.disabled = true`, sans rien dire au menu : sans l'observateur, le déclencheur
    // resterait cliquable et la garde ne garderait plus rien.
    const sel = poser();
    enhanceSelect(sel);
    expect(declencheur().disabled).toBe(false);

    sel.disabled = true;
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(declencheur().disabled).toBe(true);
  });

  it("des options reconstruites se retrouvent dans la liste", async () => {
    const sel = poser();
    enhanceSelect(sel);
    sel.innerHTML = "";
    const o = document.createElement("option");
    o.value = "999";
    o.textContent = "#999 Nouvelle-Famille.docx (2 docs)";
    sel.appendChild(o);
    await new Promise((r) => setTimeout(r, 0));

    declencheur().click();
    expect(options().map((b) => b.dataset.value)).toEqual(["999"]);
  });

  it("`value` posé par programme demande `sync()` — rien ne peut l'observer", () => {
    // `value` est une propriété : aucune mutation, donc aucun observateur possible. C'est
    // la seule chose que les appelants doivent dire, et le défaut est visible si on oublie.
    const sel = poser();
    const menu = enhanceSelect(sel);
    sel.value = "366";
    expect(document.querySelector(".prep-selmenu-text")!.textContent).toBe("— choisir —");
    menu.sync();
    expect(document.querySelector(".prep-selmenu-text")!.textContent)
      .toBe("#366 Houellebecq-Carte_FR.docx (2 docs)");
  });
});

describe("la liste ne se retourne pas, et le clavier la mène", () => {
  let sel: HTMLSelectElement;
  beforeEach(() => {
    sel = poser();
    enhanceSelect(sel);
  });

  it("elle est ancrée sous le déclencheur, jamais au-dessus", () => {
    // Tout le chantier tient là-dedans : une liste native bascule au-dessus quand la place
    // manque sous elle, et « la place » se mesure sur l'écran — d'où un comportement qui
    // change d'un moniteur à l'autre. Celle-ci est ancrée par le CSS et ne bascule pas.
    expect(liste().hidden).toBe(true);
    declencheur().click();
    expect(liste().hidden).toBe(false);
    expect(declencheur().getAttribute("aria-expanded")).toBe("true");
  });

  it("Échap referme et rend le focus au déclencheur", () => {
    declencheur().click();
    liste().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(liste().hidden).toBe(true);
    expect(document.activeElement).toBe(declencheur());
  });

  it("les flèches parcourent la liste", () => {
    declencheur().click();
    const avant = document.activeElement;
    liste().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).not.toBe(avant);
    expect(options()).toContain(document.activeElement as HTMLButtonElement);
  });

  it("taper « h » mène à Houellebecq — malgré le « #366 » qui ouvre le libellé", () => {
    // Un `<select>` natif compare sur le DÉBUT du texte de l'option. Nos libellés commencent
    // par un identifiant : « h » n'y menait à rien, il aurait fallu taper « #366 », c'est-à-dire
    // connaître déjà la réponse. On retire ce préfixe avant de comparer.
    declencheur().click();
    liste().dispatchEvent(new KeyboardEvent("keydown", { key: "h", bubbles: true }));
    expect((document.activeElement as HTMLElement).textContent)
      .toBe("#366 Houellebecq-Carte_FR.docx (2 docs)");
  });

  it("taper « m » mène à Modiano", () => {
    declencheur().click();
    liste().dispatchEvent(new KeyboardEvent("keydown", { key: "m", bubbles: true }));
    expect((document.activeElement as HTMLElement).textContent)
      .toBe("#373 Modiano-Rue_FR.docx (4 docs)");
  });

  it("retaper la même lettre parcourt les entrées, et boucle", () => {
    // Ce que fait un `<select>` natif, et que le composant ne faisait pas : chercher « hh »
    // ne mène nulle part, donc la SECONDE famille Houellebecq était inatteignable au clavier.
    declencheur().click();
    const frapper = () =>
      liste().dispatchEvent(new KeyboardEvent("keydown", { key: "h", bubbles: true }));
    frapper();
    expect((document.activeElement as HTMLElement).textContent)
      .toBe("#366 Houellebecq-Carte_FR.docx (2 docs)");
    frapper();
    expect((document.activeElement as HTMLElement).textContent)
      .toBe("#368 Houellebecq-Plateforme_FR.docx (2 docs)");
    frapper();
    expect((document.activeElement as HTMLElement).textContent,
      "après la dernière, on revient à la première").toBe("#366 Houellebecq-Carte_FR.docx (2 docs)");
  });

  it("deux lettres différentes restent une recherche, pas un parcours", () => {
    declencheur().click();
    liste().dispatchEvent(new KeyboardEvent("keydown", { key: "m", bubbles: true }));
    liste().dispatchEvent(new KeyboardEvent("keydown", { key: "o", bubbles: true }));
    // « mo » ne correspond à rien au début d'un libellé : le repli « contient » s'applique,
    // et il ne doit pas se mettre à parcourir sous prétexte qu'on a frappé deux fois.
    expect((document.activeElement as HTMLElement).textContent)
      .toBe("#373 Modiano-Rue_FR.docx (4 docs)");
  });
});

describe("poser et retirer l'habillage", () => {
  it("habiller deux fois ne fabrique pas deux menus", () => {
    const sel = poser();
    const a = enhanceSelect(sel);
    const b = enhanceSelect(sel);
    expect(b).toBe(a);
    expect(document.querySelectorAll(".prep-selmenu-trigger")).toHaveLength(1);
  });

  it("`className` habille l'enveloppe — c'est là que vit la largeur", () => {
    // Le style de largeur que portait le `<select>` reste sur lui, masqué : il ne se
    // transporte pas. Sans classe sur l'enveloppe, le déclencheur se dimensionne sur
    // l'entrée choisie et la barre bouge à chaque sélection.
    const sel = poser();
    const menu = enhanceSelect(sel, { className: "prep-selmenu--doc" });
    const enveloppe = document.querySelector(".prep-selmenu")!;
    expect(enveloppe.classList.contains("prep-selmenu")).toBe(true);
    expect(enveloppe.classList.contains("prep-selmenu--doc")).toBe(true);
    menu.destroy();
  });

  it("`destroy()` rend le `<select>` à son état d'origine", () => {
    const sel = poser();
    const menu = enhanceSelect(sel);
    menu.destroy();
    expect(document.querySelector(".prep-selmenu")).toBeNull();
    expect(document.getElementById("fam")).toBe(sel);
    expect(sel.getAttribute("aria-hidden")).toBeNull();
    expect(sel.classList.contains("prep-selmenu-native")).toBe(false);
  });
});
