import { describe, it, expect } from "vitest";
import { buildMetadataTree } from "../metadataTree.ts";
import type { DocumentRecord, DocRelationRecord } from "../sidecarClient.ts";

const doc = (doc_id: number): DocumentRecord => ({ doc_id, title: `doc${doc_id}` } as DocumentRecord);
const rel = (doc_id: number, target_doc_id: number, relation_type = "translation_of"): DocRelationRecord =>
  ({ doc_id, target_doc_id, relation_type } as DocRelationRecord);

describe("buildMetadataTree", () => {
  it("returns empty partitions for empty input", () => {
    expect(buildMetadataTree([], [])).toEqual({ roots: [], standalone: [], orphans: [] });
  });

  it("classifies a doc with no relations as standalone", () => {
    const d = doc(1);
    const out = buildMetadataTree([d], []);
    expect(out.standalone).toEqual([d]);
    expect(out.roots).toEqual([]);
    expect(out.orphans).toEqual([]);
  });

  it("nests a child under its parent as a root, not standalone", () => {
    const parent = doc(1), child = doc(2);
    const out = buildMetadataTree([parent, child], [rel(2, 1, "excerpt_of")]);
    expect(out.standalone).toEqual([]);
    expect(out.roots).toHaveLength(1);
    expect(out.roots[0].doc).toBe(parent);
    expect(out.roots[0].children).toHaveLength(1);
    expect(out.roots[0].children[0].doc).toBe(child);
    expect(out.roots[0].children[0].relationLabel).toBe("excerpt_of");
  });

  it("puts a child whose parent is absent from the corpus in orphans", () => {
    const child = doc(2);
    const out = buildMetadataTree([child], [rel(2, 99)]);
    expect(out.orphans).toEqual([child]);
    expect(out.standalone).toEqual([]);
    expect(out.roots).toEqual([]);
  });

  it("ignores a relation whose child doc is absent from the corpus", () => {
    const parent = doc(1);
    const out = buildMetadataTree([parent], [rel(2, 1)]); // child 2 not in docs
    expect(out.standalone).toEqual([parent]); // parent unaffected
    expect(out.roots).toEqual([]);
    expect(out.orphans).toEqual([]);
  });

  it("groups multiple children under one parent in relation order", () => {
    const parent = doc(1), c1 = doc(2), c2 = doc(3);
    const out = buildMetadataTree([parent, c1, c2], [rel(2, 1), rel(3, 1)]);
    expect(out.roots).toHaveLength(1);
    expect(out.roots[0].children.map(n => n.doc.doc_id)).toEqual([2, 3]);
  });

  it("does not mutate its input arrays", () => {
    const docs = [doc(1), doc(2)];
    const rels = [rel(2, 1)];
    const docsCopy = [...docs], relsCopy = [...rels];
    buildMetadataTree(docs, rels);
    expect(docs).toEqual(docsCopy);
    expect(rels).toEqual(relsCopy);
  });
});
