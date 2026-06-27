/**
 * exportDocTable.ts - pure builder for the ExportsScreen visible doc-table rows,
 * extracted from ExportsScreen._renderDocTable (U-02). The host keeps the DOM
 * lookups, the empty/grid toggles, the selectedIds computation, and the checkbox
 * wiring; this builds only the <tr> rows from (docs, selectedIds). Moved
 * byte-identical (FR labels + end-truncation).
 *
 * NOTE: the local statusLabel here is its OWN scheme (review -> "Révision",
 * unknown -> "—") and is deliberately NOT the lib/workflowStatus workflowLabel
 * (review -> "À revoir", default -> "Brouillon"); the title end-truncation
 * (slice(0,40)+"…") is likewise NOT lib/textTruncate's middle truncateMid.
 * Both have drifted; folding them would change behavior.
 */
import { escHtml as _escHtml } from "./diff.ts";
import type { DocumentRecord } from "./sidecarClient.ts";

export function buildExportDocTableRows(docs: DocumentRecord[], selectedIds: number[]): string {
    const statusLabel = (d: DocumentRecord): string => {
      switch (d.workflow_status) {
        case "validated": return "Validé";
        case "review":    return "Révision";
        case "draft":     return "Brouillon";
        default:          return "—";
      }
    };
  return docs.map(d => {
      const sel = selectedIds.includes(d.doc_id);
      const title = d.title.length > 40 ? d.title.slice(0, 40) + "…" : d.title;
      return `<tr class="exp-doc-row" data-doc-id="${d.doc_id}">
        <td><input type="checkbox" class="exp-doc-check" data-doc-id="${d.doc_id}"${sel ? " checked" : ""}></td>
        <td class="exp-doc-id">${d.doc_id}</td>
        <td class="exp-doc-title" title="${_escHtml(d.title)}">${_escHtml(title)}</td>
        <td class="exp-doc-lang">${_escHtml(d.language)}</td>
        <td class="exp-doc-role">${_escHtml(d.doc_role ?? "—")}</td>
        <td><span class="chip">${statusLabel(d)}</span></td>
      </tr>`;
  }).join("");
}
