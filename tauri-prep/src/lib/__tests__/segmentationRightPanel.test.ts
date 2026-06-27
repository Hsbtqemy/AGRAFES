import { describe, it, expect } from "vitest";
import { segRightPanelHtml, type SegRightPanelOpts } from "../segmentationRightPanel.ts";
import type { DocumentRecord } from "../sidecarClient.ts";

const doc = (over: Partial<DocumentRecord> = {}): DocumentRecord =>
  ({ doc_id: 7, title: "Roman", language: "fr", unit_count: 12, ...over }) as unknown as DocumentRecord;

const opts = (over: Partial<SegRightPanelOpts> = {}): SegRightPanelOpts => ({
  lang: "fr",
  pack: "auto",
  statusBadge: "<span id='SB'></span>",
  calibrateOptions: "<option id='CO'></option>",
  savedAlready: true,
  ...over,
});

describe("segRightPanelHtml", () => {
  it("injecte le document (titre échappé, id, langue, nombre d'unités)", () => {
    const html = segRightPanelHtml(doc({ title: "A<b>", doc_id: 9, language: "en", unit_count: 5 }), opts());
    expect(html).toContain("A&lt;b&gt;");
    expect(html).toContain("#9");
    expect(html).toContain("en");
    expect(html).toContain("5 unit");
  });

  it("injecte statusBadge et calibrateOptions tels quels", () => {
    const html = segRightPanelHtml(doc(), opts());
    expect(html).toContain("<span id='SB'></span>");
    expect(html).toContain("<option id='CO'></option>");
  });

  it("marque l'option de pack sélectionnée (et pas les autres)", () => {
    const html = segRightPanelHtml(doc(), opts({ pack: "fr_strict" }));
    expect(html).toContain(`value="fr_strict" selected`);
    expect(html).not.toContain(`value="auto" selected`);
  });

  it("reflète la langue dans le champ", () => {
    expect(segRightPanelHtml(doc(), opts({ lang: "de" }))).toContain(`value="de"`);
  });

  it("savedAlready=false → onglet « Modifier » désactivé + compte « — »", () => {
    const html = segRightPanelHtml(doc(), opts({ savedAlready: false }));
    expect(html).toContain("Aucun segment");
    expect(html).toContain(`class="chip">&#8212;</span>`);
  });

  it("savedAlready=true → compte = unit_count, onglet actif", () => {
    const html = segRightPanelHtml(doc({ unit_count: 42 }), opts({ savedAlready: true }));
    expect(html).toContain(`class="chip">42</span>`);
    expect(html).not.toContain("Aucun segment");
  });
});
