/**
 * Garde des trois réancrages de CHR-01 lot 3.
 *
 * La barre « Constituer » hébergeait trois choses qui n'y étaient que par accident
 * d'implantation. En la retirant, chacune pouvait se casser SANS UN MOT — ni erreur,
 * ni test rouge, ni différence visible tant qu'on ne provoque pas le cas :
 *
 *  1. Le bandeau « Impossible d'initialiser la DB » s'insérait par un sélecteur
 *     optionnel sur `.prep-topbar`. Sans barre, l'optionnel avale l'échec et la seule
 *     surface qui signale une base illisible cesse d'exister.
 *  2. `#app-pending-confirm`, hôte du garde « modifications non enregistrées », est
 *     positionné en absolu dans `app.css` — mais son ancêtre positionné, `.prep-shell`,
 *     est déclaré dans `prep-vnext.css`. Deux fichiers pour un seul mécanisme : qui
 *     retire ce `position: relative` en le prenant pour un reste déplace le bandeau
 *     hors de son coin, sans rien casser d'autre.
 *  3. `--prep-topbar-h` ne mesure plus une barre mais le chrome au-dessus du contenu.
 *     Sa valeur et les valeurs de repli de ses quatre consommateurs doivent rester
 *     d'accord : une dérive ne se voit qu'en cadrant mal un panneau de quelques pixels.
 *
 * D'où des assertions sur les fichiers eux-mêmes plutôt que sur un DOM : ce qui est en
 * jeu ne se rend pas, il se câble.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { describe, expect, it } from "vitest";

const lire = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf-8");

const APP_CSS = lire("../app.css");
const VNEXT_CSS = lire("../prep-vnext.css");
const TOKENS_CSS = lire("../tokens.css");
const APP_TS = lire("../../app.ts");

/**
 * `app.ts` sans ses commentaires. Les commentaires de CHR-01 citent les motifs qu'on
 * proscrit — c'est même leur rôle, expliquer ce qui ne doit pas revenir. Chercher dans
 * le fichier brut ferait donc échouer la garde sur sa propre documentation.
 * Suffisant ici : on retire les blocs, puis les lignes qui ne sont QUE du commentaire,
 * sans toucher aux `//` en milieu de ligne (une URL dans une chaîne, par exemple).
 */
function sansCommentaires(ts: string): string {
  return ts
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join("\n");
}

const APP_TS_CODE = sansCommentaires(APP_TS);

/** Le corps de la règle `<sélecteur> { … }`, ou `null` si elle n'existe pas. */
function corpsDeRegle(css: string, selecteur: string): string | null {
  const at = css.indexOf(`${selecteur} {`);
  if (at === -1) return null;
  const open = css.indexOf("{", at);
  return css.slice(open + 1, css.indexOf("}", open));
}

describe("bandeau d'erreur d'ouverture de base", () => {
  it("ne s'ancre plus par un sélecteur optionnel, qui avalerait son échec", () => {
    expect(APP_TS_CODE).not.toMatch(/querySelector\(["']\.prep-topbar["']\)\?\./);
    expect(APP_TS_CODE).toMatch(/_shellEl\.insertAdjacentElement\(\s*["']beforebegin["']/);
  });

  it("ses boutons ne réempruntent pas le style de la barre disparue", () => {
    // `.prep-topbar-db-btn` peignait du blanc à 90 % sur un fond blanc à 13 %, pour une
    // barre teal foncé. Sur le jaune du bandeau (#fff3cd), les trois boutons étaient
    // illisibles — sur la surface même qui annonce une base impossible à ouvrir.
    expect(APP_TS_CODE).not.toMatch(/prep-topbar-db-btn/);
    expect(corpsDeRegle(APP_CSS, ".prep-init-error-btn")).not.toBeNull();
  });
});

describe("garde de sortie d'onglet", () => {
  it("son hôte est posé dans `.prep-shell`, pas dans une barre", () => {
    expect(APP_TS_CODE).toMatch(/shell\.appendChild\(pendingConfirmBar\)/);
  });

  it("l'ancêtre positionné qu'il suppose existe — et il vit dans un AUTRE fichier", () => {
    const shell = corpsDeRegle(VNEXT_CSS, ".prep-shell");
    expect(shell, "règle .prep-shell introuvable dans prep-vnext.css").not.toBeNull();
    expect(shell!, "`.prep-shell` doit rester positionné : `#app-pending-confirm` s'y ancre")
      .toMatch(/position:\s*relative/);

    const bandeau = corpsDeRegle(APP_CSS, "#app-pending-confirm");
    expect(bandeau, "règle #app-pending-confirm introuvable dans app.css").not.toBeNull();
    expect(bandeau!).toMatch(/position:\s*absolute/);
  });
});

describe("--prep-topbar-h", () => {
  it("sa valeur et les replis de ses consommateurs restent d'accord", () => {
    const decl = TOKENS_CSS.match(/--prep-topbar-h:\s*(\d+)px/);
    expect(decl, "déclaration de --prep-topbar-h introuvable dans tokens.css").not.toBeNull();
    const valeur = decl![1];

    // Un repli qui diverge de la déclaration ne se voit que le jour où la variable
    // n'est pas résolue — c'est-à-dire jamais en test, et une fois en production.
    for (const css of [APP_CSS, VNEXT_CSS]) {
      for (const m of css.matchAll(/--prep-topbar-h,\s*(\d+)px/g)) {
        expect(m[1], `repli ${m[1]}px ≠ déclaration ${valeur}px`).toBe(valeur);
      }
    }
  });
});
