import { describe, it, expect } from "vitest";
import { buildExportDocTableRows } from "../exportDocTable.ts";
import type { DocumentRecord } from "../sidecarClient.ts";

const doc = (over: Partial<DocumentRecord> = {}): DocumentRecord =>
  ({ doc_id: 1, title: "T", language: "fr", doc_role: null, workflow_status: "draft", ...over } as DocumentRecord);

describe("buildExportDocTableRows", () => {
  it("renders one row per doc with its id and language cells", () => {
    const html = buildExportDocTableRows([doc({ doc_id: 7, language: "en" })], [7]);
    expect(html).toContain('class="exp-doc-row" data-doc-id="7"');
    expect(html).toContain('class="exp-doc-id">7<');
    expect(html).toContain('class="exp-doc-lang">en<');
  });

  it("checks the checkbox only for docs in selectedIds", () => {
    expect(buildExportDocTableRows([doc({ doc_id: 7 })], [7])).toContain('data-doc-id="7" checked>');
    expect(buildExportDocTableRows([doc({ doc_id: 7 })], [3])).not.toContain("checked>");
  });

  it("joins one row per doc and applies selectedIds per row", () => {
    const html = buildExportDocTableRows([doc({ doc_id: 1 }), doc({ doc_id: 2 })], [1]);
    expect((html.match(/class="exp-doc-row"/g) ?? []).length).toBe(2);
    expect(html).toContain('data-doc-id="1" checked>');
    expect(html).toContain('data-doc-id="2"');
    expect(html).not.toContain('data-doc-id="2" checked>');
  });

  it("maps each workflow_status to the export label scheme (own, not workflowLabel)", () => {
    expect(buildExportDocTableRows([doc({ workflow_status: "validated" })], [])).toContain(">Validé<");
    expect(buildExportDocTableRows([doc({ workflow_status: "review" })], [])).toContain(">Révision<");
    expect(buildExportDocTableRows([doc({ workflow_status: "draft" })], [])).toContain(">Brouillon<");
    // unknown/missing → em-dash default (NOT "Brouillon" like workflowLabel)
    expect(buildExportDocTableRows([doc({ workflow_status: undefined })], [])).toContain('class="chip">—<');
  });

  it("end-truncates a title longer than 40 chars with an ellipsis (cell only, attr keeps full)", () => {
    const html = buildExportDocTableRows([doc({ title: "x".repeat(50) })], []);
    expect(html).toContain("x".repeat(40) + "…</td>"); // cell content truncated
    expect(html).toContain('title="' + "x".repeat(50) + '"'); // full title preserved in the attr
  });

  it("leaves a title of 40 chars or fewer unchanged in the cell", () => {
    const short = "y".repeat(40);
    expect(buildExportDocTableRows([doc({ title: short })], [])).toContain(">" + short + "</td>");
  });

  it("falls back to em-dash for a missing role and escapes HTML in title/lang", () => {
    const html = buildExportDocTableRows([doc({ doc_role: null, title: "<b>", language: "f<r" })], []);
    expect(html).toContain('class="exp-doc-role">—<');
    expect(html).toContain("&lt;b&gt;");
    expect(html).toContain("f&lt;r");
  });
});
