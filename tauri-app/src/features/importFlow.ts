/**
 * features/importFlow.ts — Import modal UI and doImport orchestration.
 */

import { importFile, rebuildIndex, SidecarError } from "../lib/sidecarClient";
import { state } from "../state";
import { elt } from "../ui/dom";
import { updateStatus } from "../ui/status";
import { loadDocsForFilters } from "./filters";

export function showImportModal(): void {
  document.getElementById("import-modal")!.classList.remove("hidden");
}

export function hideImportModal(): void {
  document.getElementById("import-modal")!.classList.add("hidden");
  (document.getElementById("import-path-input") as HTMLInputElement).value = "";
  (document.getElementById("import-lang-input") as HTMLInputElement).value = "";
  (document.getElementById("import-title-input") as HTMLInputElement).value = "";
  (document.getElementById("import-role-select") as HTMLSelectElement).value = "";
  (document.getElementById("import-restype-select") as HTMLSelectElement).value = "";
  document.getElementById("import-modal-error")!.innerHTML = "";
}

export async function doImport(
  filePath: string,
  mode: string,
  language: string,
  title: string,
  docRole: string,
  resourceType: string,
): Promise<void> {
  if (!state.conn) return;
  state.isImporting = true;
  const btn = document.getElementById("import-confirm-btn") as HTMLButtonElement;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> Import…`;

  try {
    await importFile(state.conn, {
      mode: mode as "docx_numbered_lines" | "txt_numbered_lines" | "docx_paragraphs" | "tei",
      path: filePath,
      language: language || undefined,
      title: title || undefined,
      doc_role: docRole || undefined,
      resource_type: resourceType || undefined,
    });
    await rebuildIndex(state.conn);
    hideImportModal();
    updateStatus();
    await loadDocsForFilters();
    const notice = elt("div", { class: "error-banner" });
    notice.style.background = "#f0fff4";
    notice.style.borderColor = "#b2f2bb";
    notice.style.color = "#2dc653";
    notice.textContent = "Import + indexation réussis. Les filtres ont été mis à jour.";
    const area = document.getElementById("results-area")!;
    area.innerHTML = "";
    area.appendChild(notice);
  } catch (err) {
    const errMsg = elt("p", { style: "color:var(--danger);font-size:13px;margin:0;" });
    errMsg.textContent = `Erreur : ${err instanceof SidecarError ? err.message : String(err)}`;
    document.getElementById("import-modal-error")!.replaceChildren(errMsg);
  } finally {
    state.isImporting = false;
    btn.disabled = false;
    btn.textContent = "Importer";
  }
}
