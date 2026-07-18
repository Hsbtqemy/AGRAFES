/**
 * T6.1 — le hub d'Actions doit ouvrir la MATRICE comme surface d'alignement primaire, et
 * offrir « Révision fine » (l'ancien AlignPanel) en secondaire.
 */
import { describe, it, expect } from "vitest";
import { actionsHubTemplate } from "../actionsHubTemplate.ts";

describe("actionsHubTemplate — carte Alignement (T6.1)", () => {
  const html = actionsHubTemplate();

  it("la carte « Alignement » ouvre la matrice (data-target=matrice), plus l'ancien AlignPanel", () => {
    // RED sur l'ancien code : le bouton primaire visait data-target="alignement".
    expect(html).toContain('data-target="matrice"');
    // le primaire « Ouvrir → » ne vise plus « alignement »
    expect(html).toMatch(/data-target="matrice"[^>]*>Ouvrir/);
  });

  it("offre « Révision fine » en accès secondaire (data-target=alignement)", () => {
    expect(html).toContain('prep-acts-hub-wf-btn--secondary');
    expect(html).toMatch(/data-target="alignement"[^>]*>R&eacute;vision fine/);
  });
});
