import { describe, it, expect } from "vitest";
import { formatSegDocListHtml, formatSegDocListFlat } from "../segDocList.ts";
import type { DocumentRecord, DocRelationRecord } from "../sidecarClient.ts";

const d = (doc_id: number, over: Partial<DocumentRecord> = {}): DocumentRecord =>
  ({ doc_id, title: `Doc ${doc_id}`, language: "fr", unit_count: 1, ...over }) as unknown as DocumentRecord;
const rel = (doc_id: number, target_doc_id: number): DocRelationRecord =>
  ({ doc_id, target_doc_id }) as unknown as DocRelationRecord;

describe("formatSegDocListFlat", () => {
  it("rend les lignes triées, sans en-tête de groupe", () => {
    const html = formatSegDocListFlat([d(2), d(1)], "id");
    expect(html).not.toContain("prep-seg-doc-group-label");
    expect(html.indexOf('data-doc-id="1"')).toBeLessThan(html.indexOf('data-doc-id="2"'));
  });
});

describe("formatSegDocListHtml", () => {
  it("liste vide → indice « Aucun document »", () => {
    expect(formatSegDocListHtml([], [], "id")).toContain("Aucun document.");
  });

  it("sans relations → groupe unique « Tous les documents »", () => {
    const html = formatSegDocListHtml([d(1), d(2)], [], "id");
    expect(html).toContain("Tous les documents");
    expect(html).not.toContain("Famille 1");
    expect(html).toContain('data-doc-id="1"');
    expect(html).toContain('data-doc-id="2"');
  });

  it("famille (racine + enfant) + orphelin → « Famille 1 », enfant indenté, « Sans famille »", () => {
    const html = formatSegDocListHtml([d(1), d(2), d(3)], [rel(2, 1)], "id");
    expect(html).toContain("Famille 1");
    expect(html).toContain("&#8212; Sans famille");
    expect(html).toContain('prep-seg-doc-child" data-doc-id="2"'); // enfant indenté
    expect(html).toContain('data-doc-id="3"'); // orphelin
  });

  it("respecte le tri (id vs alpha)", () => {
    const docs = [d(2, { title: "Alpha" }), d(1, { title: "Zeta" })];
    const byId = formatSegDocListHtml(docs, [], "id");
    expect(byId.indexOf('data-doc-id="1"')).toBeLessThan(byId.indexOf('data-doc-id="2"'));
    const byAlpha = formatSegDocListHtml(docs, [], "alpha");
    expect(byAlpha.indexOf('data-doc-id="2"')).toBeLessThan(byAlpha.indexOf('data-doc-id="1"'));
  });

  it("échappe le titre du document", () => {
    expect(formatSegDocListHtml([d(1, { title: "A<b>" })], [], "id")).toContain("A&lt;b&gt;");
  });
});
