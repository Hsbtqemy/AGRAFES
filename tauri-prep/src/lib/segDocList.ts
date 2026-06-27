/**
 * segDocList.ts — markup de la liste de documents (panneau gauche) de
 * SegmentationView, extrait de `_buildSegDocListHtml` (U-02).
 *
 * Pur et testable : groupe les documents par **famille** (racine + enfants via les
 * relations `translation_of`), isole les **orphelins**, trie (`id` / `alpha`) et
 * produit le HTML. La vue garde le fetch des relations + la garde de connexion ;
 * elle appelle {@link formatSegDocListHtml} (chemin nominal) ou
 * {@link formatSegDocListFlat} (repli si le fetch échoue). Injecté via le sink sûr.
 */

import { escHtml as _escHtml } from "./diff.ts";
import { compareDocsByTitle } from "./docSort.ts";
import type { DocumentRecord, DocRelationRecord } from "./sidecarClient.ts";

export type SegDocListSort = "id" | "alpha";

function statusBadge(d: DocumentRecord): string {
  const s = d.workflow_status ?? "draft";
  if (s === "validated") return `<span class="prep-seg-doc-badge prep-seg-badge-ok">&#10003; Valid&#233;</span>`;
  if (s === "review")    return `<span class="prep-seg-doc-badge prep-seg-badge-warn">&#9203; En revue</span>`;
  return `<span class="prep-seg-doc-badge prep-seg-badge-none">Brouillon</span>`;
}

function docRow(d: DocumentRecord, indent = false): string {
  return `<div class="prep-seg-doc-row${indent ? " prep-seg-doc-child" : ""}" data-doc-id="${d.doc_id}">
        <div class="prep-seg-doc-row-main">
          <span class="prep-seg-doc-title" title="${_escHtml(d.title)}">${_escHtml(d.title)}</span>
          <span class="prep-seg-doc-lang">[${_escHtml(d.language)}]</span>
        </div>
        <div class="prep-seg-doc-row-foot">
          <span class="prep-seg-doc-units">${d.unit_count} unit&#233;s</span>
          ${statusBadge(d)}
        </div>
      </div>`;
}

function comparator(sort: SegDocListSort): (a: DocumentRecord, b: DocumentRecord) => number {
  return (a, b) => (sort === "alpha" ? compareDocsByTitle(a, b) : a.doc_id - b.doc_id);
}

/** Flat document list (repli quand les relations de famille sont indisponibles). */
export function formatSegDocListFlat(docs: DocumentRecord[], sort: SegDocListSort): string {
  return [...docs].sort(comparator(sort)).map(d => docRow(d)).join("");
}

/**
 * Document list grouped by family (root + children) then orphans, each sorted.
 * Returns the empty-state hint when nothing renders.
 */
export function formatSegDocListHtml(
  docs: DocumentRecord[],
  relations: DocRelationRecord[],
  sort: SegDocListSort,
): string {
  const childIds = new Set(relations.map(r => r.doc_id));
  const parentMap = new Map<number, number[]>();
  for (const rel of relations) {
    if (!parentMap.has(rel.target_doc_id)) parentMap.set(rel.target_doc_id, []);
    parentMap.get(rel.target_doc_id)!.push(rel.doc_id);
  }

  const cmp = comparator(sort);
  const sorted = [...docs].sort(cmp);
  const familyGroups: Array<{ root: DocumentRecord; children: DocumentRecord[] }> = [];
  const orphans: DocumentRecord[] = [];
  for (const d of sorted) {
    if (!childIds.has(d.doc_id) && parentMap.has(d.doc_id)) {
      const children = (parentMap.get(d.doc_id) ?? [])
        .map(cid => sorted.find(dd => dd.doc_id === cid))
        .filter(Boolean) as DocumentRecord[];
      children.sort(cmp);
      familyGroups.push({ root: d, children });
    } else if (!childIds.has(d.doc_id) && !parentMap.has(d.doc_id)) {
      orphans.push(d);
    }
  }

  let html = "";
  for (let fi = 0; fi < familyGroups.length; fi++) {
    const { root, children } = familyGroups[fi];
    html += `<div class="prep-seg-doc-group-label">
        <span class="prep-seg-family-pill">Famille ${fi + 1}</span>
        <span class="prep-seg-family-root-name" title="${_escHtml(root.title)}">${_escHtml(root.title)}</span>
      </div>`;
    html += `<div class="prep-seg-doc-group">`;
    html += docRow(root);
    for (const child of children) html += docRow(child, true);
    html += `</div>`;
  }
  if (orphans.length > 0) {
    if (familyGroups.length > 0) {
      html += `<div class="prep-seg-doc-group-label">&#8212; Sans famille</div>`;
    } else {
      html += `<div class="prep-seg-doc-group-label">Tous les documents</div>`;
    }
    html += `<div class="prep-seg-doc-group">`;
    for (const d of orphans) html += docRow(d);
    html += `</div>`;
  }
  return html || `<p class="empty-hint">Aucun document.</p>`;
}
