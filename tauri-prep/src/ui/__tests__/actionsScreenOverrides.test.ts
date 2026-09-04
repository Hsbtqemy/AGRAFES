/**
 * Garde d'un motif de défaut, pas d'une règle.
 *
 * `app.css` porte des règles génériques de la forme `.prep-actions-screen <élément>` —
 * `label`, `select`, `input`, `textarea`. Leur spécificité est **0,1,1**. Les classes des
 * composants qui vivent dans cet écran — et la matrice d'alignement en fait partie — sont
 * en **0,1,0**. La règle d'écran gagne donc toujours, y compris sur des propriétés que le
 * composant a explicitement déclarées, et y compris pour lui en ajouter qu'il n'a jamais
 * demandées.
 *
 * Trois occurrences mesurées à ce jour :
 *
 *  1. les textareas du canvas, plafonnées à 420 puis 480px par deux règles quasi-jumelles ;
 *  2. le sélecteur de famille de la matrice, qui recevait un `margin-bottom: 0.5rem` — et
 *     comme sa barre est en `align-items: flex-end`, qui aligne les bords de MARGE, il
 *     flottait 8px au-dessus de « Charger la matrice » ;
 *  3. le panneau « Avancé… », dont les labels déclarent `display: flex` **sans direction**
 *     (donc en ligne) et recevaient `column` : « Mode » au-dessus de son menu, et la case à
 *     cocher au-dessus de son propre libellé. Depuis la création du panneau, le 13 juillet
 *     2026 — il ne s'est jamais affiché comme il est écrit.
 *
 * Aucune de ces trois ne se voit autrement qu'à l'œil : le CSS ne casse pas, il déplace.
 * D'où cette garde, qui vérifie que les surcharges tiennent ET que la règle générique qui
 * les rend nécessaires est toujours celle qu'on croit — si elle change, c'est ici qu'on
 * viendra rouvrir la question, pas au hasard d'une capture d'écran.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { describe, expect, it } from "vitest";

const APP_CSS = readFileSync(fileURLToPath(new URL("../app.css", import.meta.url)), "utf-8");

/** Le corps de la règle `<sélecteur> { … }`, ou `null`. */
function corpsDeRegle(css: string, selecteur: string): string | null {
  const at = css.indexOf(`${selecteur} {`);
  if (at === -1) return null;
  const open = css.indexOf("{", at);
  return css.slice(open + 1, css.indexOf("}", open));
}

describe("la règle d'écran qui rend les surcharges nécessaires", () => {
  it("`.prep-actions-screen label` impose toujours colonne et marge basse", () => {
    // Si cette règle cesse d'imposer l'un ou l'autre, les surcharges ci-dessous deviennent
    // du bruit — et surtout, d'autres composants de l'écran changeront d'allure sans qu'on
    // l'ait voulu. Ce test n'interdit pas de la changer : il oblige à s'en apercevoir.
    const corps = corpsDeRegle(APP_CSS, ".prep-actions-screen label");
    expect(corps, "règle générique introuvable — le motif a peut-être changé de forme")
      .not.toBeNull();
    expect(corps!).toMatch(/flex-direction:\s*column/);
    expect(corps!).toMatch(/margin-bottom:\s*0\.5rem/);
  });
});

describe("le sélecteur de famille de la matrice", () => {
  it("garde sa propre règle, celle que la générique écrase", () => {
    expect(corpsDeRegle(APP_CSS, ".prep-matrix-fam-label")).not.toBeNull();
  });

  it("et une surcharge à spécificité suffisante qui annule la marge basse", () => {
    // Sans `margin-bottom: 0`, la barre étant en `align-items: flex-end` (bords de marge),
    // le contrôle remonte de 8px au-dessus de ses voisins. Mesuré le 4 septembre 2026 :
    // bas du select 181,3 contre 189,3 pour « Charger la matrice » ; 0,0 après correction.
    const corps = corpsDeRegle(APP_CSS, ".prep-actions-screen .prep-matrix-fam-label");
    expect(corps, "surcharge introuvable : le sélecteur reflotte de 8px").not.toBeNull();
    expect(corps!).toMatch(/margin-bottom:\s*0\b/);
  });

  it("la barre reste alignée sur les bas — c'est ce qui rend la marge visible", () => {
    const barre = corpsDeRegle(APP_CSS, ".prep-matrix-toolbar");
    expect(barre!).toMatch(/align-items:\s*flex-end/);
  });
});

describe("le panneau « Avancé… » de la matrice", () => {
  it("ses labels sont remis en ligne, comme leur propre règle le suppose", () => {
    // `.prep-matrix-align-field` déclare `display: flex` sans direction : elle COMPTE sur
    // le défaut `row`. C'est ce qui rend l'écrasement invisible à la lecture du composant.
    const propre = corpsDeRegle(APP_CSS, ".prep-matrix-align-field");
    expect(propre!, "la règle du composant ne déclare toujours pas de direction")
      .not.toMatch(/flex-direction/);

    const at = APP_CSS.indexOf(".prep-actions-screen .prep-matrix-align-field,");
    expect(at, "surcharge introuvable : « Mode » repasse au-dessus de son menu")
      .toBeGreaterThan(0);
    const corps = APP_CSS.slice(APP_CSS.indexOf("{", at) + 1, APP_CSS.indexOf("}", at));
    expect(corps).toMatch(/flex-direction:\s*row/);
    expect(corps).toMatch(/margin-bottom:\s*0\b/);
  });

  it("la case à cocher est couverte par la même surcharge", () => {
    // Elle est le cas le plus visible : en colonne, la case se détache AU-DESSUS de son
    // propre libellé « Conserver les liens validés », et ne se lit plus comme une case.
    expect(APP_CSS).toMatch(
      /\.prep-actions-screen \.prep-matrix-align-field,\s*\r?\n\.prep-actions-screen \.prep-matrix-align-check \{/,
    );
  });
});
