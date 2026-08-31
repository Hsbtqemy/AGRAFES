/**
 * Garde de mise en page pour la liste du hub Actions (ACT-01).
 *
 * Ce que ce test protège ne se voit pas dans le DOM : c'est une propriété de la
 * feuille de style, et son absence ne casse aucun rendu — elle décale les colonnes.
 *
 * Le défaut, trouvé en QA le 31 août : la boîte de la liste est en `overflow: auto`.
 * Sous les filtres qui laissent beaucoup de lignes (57, 53, 37, ou les 58 sans filtre)
 * elle défile, et la barre prend sa largeur DANS la boîte. Sous le filtre Segmentation
 * — une seule ligne sur le corpus de travail — il n'y a pas de barre, et ces ~15 px
 * reviennent au tableau. Comme il est en `table-layout: fixed` avec une seule colonne
 * élastique (« Titre »), ils lui vont entièrement : Langue, Rôle, Unités, À faire et
 * Ouvrir glissent tous vers la droite en changeant de filtre.
 *
 * `scrollbar-gutter: stable` réserve la place de la barre même sans barre. Rien dans
 * le DOM ne le raconte, d'où ce test sur le fichier lui-même.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(fileURLToPath(new URL("../app.css", import.meta.url)), "utf-8");

/** Le corps de la règle `.prep-acts-hub-doc-list { … }`, commentaires compris. */
function ruleBody(selector: string): string {
  const at = CSS.indexOf(`${selector} {`);
  expect(at, `règle ${selector} introuvable dans app.css`).toBeGreaterThan(-1);
  const open = CSS.indexOf("{", at);
  const close = CSS.indexOf("}", open);
  return CSS.slice(open + 1, close);
}

describe("liste du hub Actions — la barre de défilement ne doit pas décaler les colonnes", () => {
  it("réserve la gouttière de défilement", () => {
    expect(ruleBody(".prep-acts-hub-doc-list")).toMatch(/scrollbar-gutter:\s*stable/);
  });

  it("est bien la boîte qui défile, et à hauteur constante", () => {
    // Les deux vont ensemble : sans `overflow: auto` il n'y a pas de gouttière à
    // réserver, et sans hauteur fixée la boîte suivrait le nombre de lignes — le
    // saut vertical que le filtre provoquait avant ACT-01.
    const body = ruleBody(".prep-acts-hub-doc-list");
    expect(body).toMatch(/overflow:\s*auto/);
    expect(body).toMatch(/height:\s*clamp\(/);
  });

  it("garde une seule colonne élastique — c'est ce qui rend le décalage total", () => {
    // Six des sept colonnes portent une largeur en rem ; la deuxième (« Titre »)
    // n'en a pas, et absorbe donc seule toute variation de largeur disponible.
    for (const n of [1, 3, 4, 5, 6, 7]) {
      expect(CSS).toMatch(
        new RegExp(`\\.prep-acts-hub-table td:nth-child\\(${n}\\)[^}]*width:\\s*[\\d.]+rem`),
      );
    }
    expect(CSS).not.toMatch(/\.prep-acts-hub-table td:nth-child\(2\)[^}]*width:/);
  });
});
