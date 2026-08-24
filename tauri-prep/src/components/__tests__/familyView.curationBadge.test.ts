/**
 * La liste « traductions à relire » nomme le segment comme la matrice le nomme (ALI-24).
 *
 * Elle composait sa première colonne avec `[§${String(p.external_id)}]` : le même champ
 * que le Contrôle, avec le même défaut (ce n'est pas un numéro de segment mais la clé qui
 * a apparié) — et sans repli, si bien qu'un corpus sans marqueurs y affichait
 * littéralement « [§null] ». La règle de choix vit dans `lib/segmentBadge.ts`, testée à
 * part ; ce fichier épingle le BRANCHEMENT, c'est-à-dire que cette liste-ci l'emprunte.
 */
import { describe, it, expect } from "vitest";
import { curationStatusHtml } from "../familyView.ts";
import type { CurationChildStatus, CurationPendingLink } from "../../lib/sidecarClient.ts";

function enfant(pending: CurationPendingLink[]): CurationChildStatus {
  return {
    doc_id: 2, title: "Traduction", language: "en",
    pending_count: pending.length,
    pending,
  };
}

// Un lien complet, typé — pas de cast : le `tsc` du shell compile ce fichier et rejette
// un `Record<string, unknown>` déguisé, ce que celui de prep laissait passer.
const LIEN: CurationPendingLink = {
  link_id: 1, external_id: 7, pivot_unit_id: 10, target_unit_id: 20,
  pivot_text: "Le texte source.", target_text: "The source text.",
  source_changed_at: "2026-08-24T10:00:00Z",
};

describe("curationStatusHtml — le numéro de la colonne de gauche", () => {
  it("affiche le rang calculé par le moteur, pas la clé d'appariement", () => {
    const html = curationStatusHtml([enfant([{ ...LIEN, external_id: 42, pivot_segment: 3 }])], 1);
    expect(html).toContain("[§3]");
    expect(html).not.toContain("[§42]");
  });

  it("retombe sur la clé face à un sidecar antérieur à 1.6.76", () => {
    const html = curationStatusHtml([enfant([LIEN])], 1);
    expect(html).toContain("[§7]");
  });

  it("laisse la cellule VIDE plutôt que d'écrire « [§null] »", () => {
    const html = curationStatusHtml([enfant([{ ...LIEN, pivot_segment: null }])], 1);
    expect(html).not.toContain("[§");
    expect(html).toContain("Le texte source.");
  });
});
