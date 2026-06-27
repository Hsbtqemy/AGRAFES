/**
 * metadataTree.ts — pure parent/child/orphan/standalone partition of the corpus,
 * extracted from MetadataScreen._buildTree (U-02).
 *
 * Order-agnostic: returns freshly-allocated arrays in `docs` insertion order; the
 * caller (_renderHierarchyList) does the sorting. Reads only its two arguments and
 * mutates neither (the host shares these arrays).
 */

import type { DocumentRecord, DocRelationRecord } from "./sidecarClient.ts";

export interface TreeNode {
  doc: DocumentRecord;
  children: TreeNode[];
  relationLabel?: string; // e.g. "translation_of"
}

export function buildMetadataTree(
  docs: DocumentRecord[],
  allRelations: DocRelationRecord[],
): { roots: TreeNode[]; standalone: DocumentRecord[]; orphans: DocumentRecord[] } {
    const docMap = new Map(docs.map(d => [d.doc_id, d]));
    // childId → { parentId, relationLabel }
    const childOf = new Map<number, { parentId: number; label: string }>();
    // parentId → [{ childId, label }]
    const parentTo = new Map<number, { childId: number; label: string }[]>();

    for (const rel of allRelations) {
      // rel.doc_id is "child", rel.target_doc_id is "parent"
      if (!docMap.has(rel.doc_id)) continue;
      childOf.set(rel.doc_id, { parentId: rel.target_doc_id, label: rel.relation_type });
      if (!parentTo.has(rel.target_doc_id)) parentTo.set(rel.target_doc_id, []);
      parentTo.get(rel.target_doc_id)!.push({ childId: rel.doc_id, label: rel.relation_type });
    }

    const roots: TreeNode[] = [];
    const standalone: DocumentRecord[] = [];
    const orphans: DocumentRecord[] = [];

    for (const doc of docs) {
      const childInfo = childOf.get(doc.doc_id);
      if (childInfo) {
        // This doc is a child — only show it under its parent
        if (!docMap.has(childInfo.parentId)) {
          orphans.push(doc); // parent missing from corpus
        }
        continue; // will be rendered as child of parent
      }
      // Not a child — check if it has children
      const children = parentTo.get(doc.doc_id) ?? [];
      if (children.length === 0) {
        standalone.push(doc);
      } else {
        roots.push({
          doc,
          children: children
            .map(c => ({ doc: docMap.get(c.childId)!, relationLabel: c.label, children: [] }))
            .filter(n => n.doc != null),
        });
      }
    }

    return { roots, standalone, orphans };
}
