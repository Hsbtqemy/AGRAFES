/**
 * exportV2Options.ts — declarative stage -> product -> format option matrix for the
 * ExportsScreen V2 UI, extracted from ExportsScreen._syncV2Ui (U-02).
 *
 * Pure data + two selectors carrying the original `?? alignment` / `?? []`
 * fallbacks. No `this`, no DOM, no side effects: the host feeds these straight
 * into _setSelectOptions exactly as before.
 */

export interface ExportOption {
  value: string;
  label: string;
  pending?: boolean;
}

export const PRODUCT_BY_STAGE: Record<string, ExportOption[]> = {
  alignment: [
    { value: "aligned_table", label: "Tableau segments alignés" },
    { value: "tei_xml", label: "TEI XML (documents sélectionnés)" },
  ],
  publication: [
    { value: "tei_package", label: "Package publication TEI (ZIP)" },
  ],
  segmentation: [
    { value: "tei_xml", label: "TEI XML (segments validés)" },
    { value: "readable_text", label: "Texte lisible" },
  ],
  curation: [
    { value: "tei_xml", label: "TEI XML (texte revu)" },
    { value: "readable_text", label: "Texte lisible" },
  ],
  runs: [
    { value: "run_report", label: "Rapport des runs" },
  ],
  qa: [
    { value: "qa_report", label: "Rapport QA corpus" },
  ],
};

export const FORMAT_BY_PRODUCT: Record<string, ExportOption[]> = {
  aligned_table: [
    { value: "csv", label: "CSV" },
    { value: "tsv", label: "TSV" },
  ],
  tei_xml: [
    { value: "tei_dir", label: "Dossier TEI (un fichier/doc)" },
  ],
  tei_package: [
    { value: "zip", label: "ZIP" },
  ],
  run_report: [
    { value: "jsonl", label: "JSONL" },
    { value: "html", label: "HTML" },
  ],
  qa_report: [
    { value: "json", label: "JSON" },
    { value: "html", label: "HTML" },
  ],
  readable_text: [
    { value: "txt", label: "TXT" },
    { value: "docx", label: "DOCX" },
    { value: "odt", label: "ODT" },
  ],
};

/** Products available for a workflow stage (falls back to the alignment set). */
export function productsForStage(stage: string): ExportOption[] {
  return PRODUCT_BY_STAGE[stage] ?? PRODUCT_BY_STAGE.alignment;
}

/** Output formats available for a product (empty when none). */
export function formatsForProduct(product: string): ExportOption[] {
  return FORMAT_BY_PRODUCT[product] ?? [];
}
