/**
 * Garde de la coquille de modale partagée `.prep-dialog-*` (CHR-01, lot 1).
 *
 * Trois modales de `app.ts` partagent la même coquille : la Fiche corpus, la liste des
 * presets, et l'éditeur de preset. Le lot 2 de CHR-01 supprime les deux dernières —
 * environ 356 lignes de `app.ts` et 13 règles CSS. La Fiche corpus devient alors le
 * SEUL usager de la coquille, et rien ne le dit : les noms de classes sont des chaînes
 * dans `app.ts` et des sélecteurs dans `app.css`, que ni le compilateur ni le bundler
 * ne rapprochent. Supprimer une règle de trop passe donc le build, le lint et les 1390
 * tests sans un mot.
 *
 * Ce que ça coûterait : `.prep-dialog-overlay` porte `position: fixed` et `inset: 0`.
 * Sans elle, l'overlay redevient un bloc dans le flux — la Fiche corpus s'affiche en
 * bas de page au lieu de se centrer par-dessus, et le clic hors modale ne ferme plus
 * rien. Un défaut qu'aucun test de DOM ne voit, puisque le DOM, lui, est correct.
 *
 * D'où une garde sur le rapprochement lui-même, plutôt que sur une liste de noms
 * recopiée : on lit les classes réellement employées par `app.ts` et on exige une règle
 * pour chacune. Elle protège aussi le cas inverse, une classe ajoutée sans style.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(fileURLToPath(new URL("../app.css", import.meta.url)), "utf-8");
const APP_TS = readFileSync(fileURLToPath(new URL("../../app.ts", import.meta.url)), "utf-8");

/** Les classes `prep-dialog*` réellement écrites dans `app.ts`, dédoublonnées. */
function classesEmployees(): string[] {
  const trouvees = APP_TS.match(/prep-dialog[a-z-]*/g) ?? [];
  return [...new Set(trouvees)].sort();
}

/** Le corps de la règle `.<classe> { … }`, ou `null` si la règle n'existe pas. */
function corpsDeRegle(classe: string): string | null {
  const at = CSS.indexOf(`.${classe} {`);
  if (at === -1) return null;
  const open = CSS.indexOf("{", at);
  const close = CSS.indexOf("}", open);
  return CSS.slice(open + 1, close);
}

describe("coquille de modale partagée — app.ts et app.css doivent rester d'accord", () => {
  it("app.ts emploie bien la coquille (garde contre un test qui ne garde plus rien)", () => {
    // Si le lot 2 supprimait la Fiche corpus par accident en même temps que les presets,
    // la liste deviendrait vide et les assertions suivantes passeraient à vide.
    expect(classesEmployees()).toContain("prep-dialog-overlay");
  });

  it("chaque classe employée a une règle dans app.css", () => {
    for (const classe of classesEmployees()) {
      expect(corpsDeRegle(classe), `règle .${classe} introuvable dans app.css`).not.toBeNull();
    }
  });

  it("l'overlay reste un calque centré, pas un bloc dans le flux", () => {
    const body = corpsDeRegle("prep-dialog-overlay");
    expect(body, "règle .prep-dialog-overlay introuvable dans app.css").not.toBeNull();
    expect(body!).toMatch(/position:\s*fixed/);
    expect(body!).toMatch(/inset:\s*0/);
  });

  it("aucune trace des anciens noms `prep-presets-modal*` / `prep-presets-overlay`", () => {
    // Le renommage du lot 1 ; un retour en arrière partiel laisserait les deux familles
    // coexister, et la moitié des modales sans style.
    expect(CSS).not.toMatch(/prep-presets-(modal|overlay)/);
    expect(APP_TS).not.toMatch(/prep-presets-(modal|overlay)/);
  });
});
