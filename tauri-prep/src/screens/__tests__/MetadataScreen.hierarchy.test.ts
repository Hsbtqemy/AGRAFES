// @vitest-environment happy-dom
/**
 * D-P9-3 — la vue hiérarchie porte, par racine de famille, un résumé compact des signaux
 * dérivés (⚠ à réviser · ⨯ collisions) à côté du badge %. Vue d'ensemble multi-familles, là
 * où le panneau ne montre qu'une famille à la fois.
 *
 * On pilote le VRAI `_renderHierarchyList` (aucune connexion) en injectant l'état en mémoire.
 */
import { describe, it, expect, afterEach } from "vitest";
import { MetadataScreen } from "../MetadataScreen.ts";
import type { DocumentRecord, DocRelationRecord, FamilyRecord } from "../../lib/sidecarClient.ts";

const PARENT = { doc_id: 2, title: "Le Livre", language: "fr" } as DocumentRecord;
const CHILD = { doc_id: 3, title: "The Book", language: "en" } as DocumentRecord;
const REL = { doc_id: 3, target_doc_id: 2, relation_type: "translation_of" } as DocRelationRecord;

function family(over: Partial<FamilyRecord["stats"]> = {}): FamilyRecord {
  return {
    family_id: 2,
    parent: PARENT,
    children: [{ doc_id: 3, doc: CHILD, segmented: true, aligned_to_parent: true, relation_type: "translation_of" }],
    stats: {
      total_docs: 2, segmented_docs: 2, parent_seg_count: 10,
      aligned_pairs: 1, total_pairs: 1, validated_docs: 0, completion_pct: 60,
      ratio_warnings: [], status_counts: { accepted: 1, rejected: 0, unreviewed: 3 }, collision_count: 2, ...over,
    },
  } as unknown as FamilyRecord;
}

/** Render the screen, seed in-memory state, run the real hierarchy render. */
function renderHierarchy(families: FamilyRecord[]) {
  const view = new MetadataScreen();
  view.render();
  const anyView = view as unknown as {
    _docs: DocumentRecord[]; _allRelations: DocRelationRecord[]; _allRelationsLoaded: boolean;
    _families: FamilyRecord[]; _renderHierarchyList: () => void; _docListEl: HTMLElement;
  };
  anyView._docs = [PARENT, CHILD];
  anyView._allRelations = [REL];
  anyView._allRelationsLoaded = true;
  anyView._families = families;
  anyView._renderHierarchyList();
  return anyView._docListEl;
}

afterEach(() => { document.body.innerHTML = ""; });

describe("MetadataScreen — signaux hiérarchie D-P9-3", () => {
  it("affiche le cluster ⚠/⨯ sur la ligne racine de la famille", () => {
    const list = renderHierarchy([family()]);
    const signals = list.querySelector(".prep-hier-signals");
    expect(signals).not.toBeNull();
    expect(signals!.textContent).toContain("⚠ 3");
    expect(signals!.textContent).toContain("⨯ 2");
  });

  it("pas de cluster quand la famille n'a rien d'actionnable (tout révisé, sans collision)", () => {
    const list = renderHierarchy([family({
      status_counts: { accepted: 4, rejected: 0, unreviewed: 0 }, collision_count: 0,
    })]);
    expect(list.querySelector(".prep-hier-signals")).toBeNull();
    // Le badge % de couverture reste, lui.
    expect(list.querySelector(".prep-family-pct-badge")).not.toBeNull();
  });

  it("pas de cluster si le sidecar est antérieur à D-P9-1 (status_counts absent)", () => {
    const fam = family();
    delete (fam.stats as { status_counts?: unknown }).status_counts;
    delete (fam.stats as { collision_count?: unknown }).collision_count;
    const list = renderHierarchy([fam]);
    expect(list.querySelector(".prep-hier-signals")).toBeNull();
  });
});
