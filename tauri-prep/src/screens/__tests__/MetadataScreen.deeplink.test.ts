// @vitest-environment happy-dom
/**
 * D-P9-2b — délégation des deep-links du panneau famille (Documents → espace Alignement).
 *
 * On pilote le VRAI `_renderEditPanel` (edit panel d'un doc racine de famille) sans connexion,
 * en injectant l'état en mémoire, puis on clique les boutons `.prep-fam-deeplink` pour vérifier
 * que la délégation appelle `onOpenAlignment(familyId, mode)` avec les bons arguments. C'est le
 * maillon qui, cassé (mauvaise clé data-*, faute de frappe), reproduirait un « badge mort ».
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { MetadataScreen } from "../MetadataScreen.ts";
import type { DocumentRecord, FamilyRecord } from "../../lib/sidecarClient.ts";

const DOC = { doc_id: 2, title: "Le Livre", language: "fr" } as DocumentRecord;

function family(): FamilyRecord {
  return {
    family_id: 2,
    parent: DOC,
    children: [
      { doc_id: 3, doc: { doc_id: 3, title: "The Book", language: "en" }, segmented: true,
        aligned_to_parent: true, relation_type: "translation_of" },
    ],
    stats: {
      total_docs: 2, segmented_docs: 2, parent_seg_count: 2,
      aligned_pairs: 1, total_pairs: 2, validated_docs: 0, completion_pct: 60,
      ratio_warnings: [], status_counts: { accepted: 1, rejected: 0, unreviewed: 3 }, collision_count: 2,
    },
  } as unknown as FamilyRecord;
}

/** Render the screen, seed in-memory state so the family panel renders, wire the edit panel. */
function mountWithFamily() {
  const view = new MetadataScreen();
  view.render();
  const anyView = view as unknown as {
    _selectedDoc: DocumentRecord; _families: FamilyRecord[]; _docs: DocumentRecord[];
    _relations: unknown[]; _allRelations: unknown[]; _allRelationsLoaded: boolean;
    _renderEditPanel: () => void; _editPanelEl: HTMLElement;
  };
  anyView._selectedDoc = DOC;
  anyView._families = [family()];
  anyView._docs = [DOC];
  anyView._relations = [];
  anyView._allRelations = [];
  anyView._allRelationsLoaded = false;
  anyView._renderEditPanel();
  return { view, panel: anyView._editPanelEl };
}

afterEach(() => { document.body.innerHTML = ""; });

describe("MetadataScreen — délégation deep-links D-P9-2b", () => {
  it("cliquer « à réviser » appelle onOpenAlignment(familyId, 'review')", () => {
    const spy = vi.fn();
    const { view, panel } = mountWithFamily();
    view.setOnOpenAlignment(spy);

    const btn = panel.querySelector<HTMLButtonElement>('.prep-fam-verif[data-deeplink="review"]');
    expect(btn).not.toBeNull();
    btn!.click();
    expect(spy).toHaveBeenCalledWith(2, "review");
  });

  it("cliquer « collisions » appelle onOpenAlignment(familyId, 'review')", () => {
    const spy = vi.fn();
    const { view, panel } = mountWithFamily();
    view.setOnOpenAlignment(spy);

    panel.querySelector<HTMLButtonElement>('.prep-fam-collisions[data-deeplink="review"]')!.click();
    expect(spy).toHaveBeenCalledWith(2, "review");
  });

  it("cliquer « couverture incomplète » appelle onOpenAlignment(familyId, 'matrix')", () => {
    const spy = vi.fn();
    const { view, panel } = mountWithFamily();
    view.setOnOpenAlignment(spy);

    panel.querySelector<HTMLButtonElement>('.prep-fam-coverage[data-deeplink="matrix"]')!.click();
    expect(spy).toHaveBeenCalledWith(2, "matrix");
  });

  it("sans callback injecté, le clic ne jette pas (guard optionnel)", () => {
    const { panel } = mountWithFamily();
    const btn = panel.querySelector<HTMLButtonElement>('.prep-fam-coverage[data-deeplink="matrix"]');
    expect(() => btn!.click()).not.toThrow();
  });
});
