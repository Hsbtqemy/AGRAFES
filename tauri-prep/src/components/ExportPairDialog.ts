/**
 * ExportPairDialog.ts — bilingual pair-export dialog, extracted from MetadataScreen (U-02).
 *
 * Self-contained, stateless: renders the export controls into a host-supplied
 * container and wires its own buttons (format select, preview, save). It holds
 * no persistent state — the host opens it on demand and it clears the container
 * on close. The sidecar connection is read live through `getConn` so it mirrors
 * the original behaviour (re-read on each action, not captured at open time).
 */

import { setHtml, raw } from "../lib/safeHtml.ts";
import {
  exportBilingual,
  exportTmx,
  SidecarError,
  type Conn,
  type BilingualPreviewPair,
} from "../lib/sidecarClient.ts";

export interface ExportPairDialogOptions {
  /** Container the dialog renders into (its innerHTML is cleared on close). */
  container: HTMLElement;
  /** Live accessor for the sidecar connection (re-read on each action). */
  getConn: () => Conn | null;
  pivotId: number;
  targetId: number;
  pivotLang: string;
  targetLang: string;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderBilingualPreview(
  pairs: BilingualPreviewPair[],
  srcLang: string,
  tgtLang: string,
  totalCount: number,
): string {
  if (pairs.length === 0) return `<p class="empty-hint">Aucune paire alignée.</p>`;
  const rows = pairs.map(p => `
      <tr>
        <td>${esc(p.pivot_text)}</td>
        <td>${esc(p.target_text)}</td>
      </tr>`).join("");
  const more = totalCount > pairs.length
    ? `<p class="hint" style="margin:4px 0">… et ${totalCount - pairs.length} paire(s) de plus.</p>`
    : "";
  return `
      <table class="prep-bilingual-preview-table">
        <thead><tr>
          <th>${esc(srcLang)}</th>
          <th>${esc(tgtLang)}</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${more}`;
}

/** Render and wire the bilingual pair-export dialog into `opts.container`. */
export async function openExportPairDialog(opts: ExportPairDialogOptions): Promise<void> {
  const { container, getConn, pivotId, targetId, pivotLang, targetLang } = opts;
  if (!getConn()) return;

  // Suggested default out_path (desktop or documents folder heuristic)
  const suggestedPath = `export_${pivotLang}_${targetLang}_${pivotId}_${targetId}`;

  setHtml(container, raw(`
      <div class="prep-export-pair-dialog">
        <div class="prep-export-pair-head">
          <strong>↗ Exporter la paire #${pivotId} ↔ #${targetId}</strong>
          <button id="export-close-btn" class="audit-close-btn" title="Fermer">✕</button>
        </div>
        <div class="prep-export-pair-body">
          <div class="prep-form-row" style="flex-wrap:wrap;gap:0.5rem">
            <label>Format
              <select id="export-format-sel" style="width:90px">
                <option value="html">HTML</option>
                <option value="txt">TXT</option>
                <option value="tmx">TMX</option>
              </select>
            </label>
            <label style="flex:2">Chemin de sortie
              <input id="export-out-path" type="text"
                     placeholder="${suggestedPath}.html"
                     style="width:100%;font-size:0.8rem">
            </label>
          </div>
          <div class="prep-btn-row" style="gap:0.5rem;margin-top:0.4rem">
            <button id="export-preview-btn" class="btn btn-secondary btn-sm">👁 Prévisualiser</button>
            <button id="export-save-btn" class="btn btn-primary btn-sm">↗ Enregistrer</button>
          </div>
          <div id="export-preview-area" style="margin-top:0.5rem"></div>
          <div id="export-status" style="font-size:0.8rem;margin-top:0.4rem"></div>
        </div>
      </div>`));

  const formatSel  = container.querySelector<HTMLSelectElement>("#export-format-sel")!;
  const outInput   = container.querySelector<HTMLInputElement>("#export-out-path")!;
  const previewArea = container.querySelector<HTMLDivElement>("#export-preview-area")!;
  const statusEl   = container.querySelector<HTMLDivElement>("#export-status")!;

  // Update placeholder when format changes
  formatSel.addEventListener("change", () => {
    const ext = formatSel.value === "tmx" ? "tmx" : formatSel.value;
    if (!outInput.value || outInput.value === outInput.placeholder) {
      outInput.placeholder = `${suggestedPath}.${ext}`;
      outInput.value = "";
    }
  });

  container.querySelector("#export-close-btn")?.addEventListener("click", () => {
    container.innerHTML = "";
  });

  container.querySelector("#export-preview-btn")?.addEventListener("click", async () => {
    const fmt = formatSel.value;
    if (fmt === "tmx") {
      statusEl.textContent = "Prévisualisation non disponible pour TMX — utilisez Enregistrer.";
      return;
    }
    statusEl.textContent = "Chargement de la prévisualisation…";
    previewArea.innerHTML = "";
    try {
      const res = await exportBilingual(getConn()!, {
        pivot_doc_id: pivotId,
        target_doc_id: targetId,
        format: fmt as "html" | "txt",
        preview_only: true,
        preview_limit: 15,
      });
      statusEl.textContent = `${res.pair_count} paires alignées.`;
      setHtml(previewArea, raw(renderBilingualPreview(
        res.preview ?? [], pivotLang, targetLang, res.pair_count,
      )));
    } catch (err) {
      statusEl.textContent = `Erreur : ${err instanceof SidecarError ? err.message : String(err)}`;
    }
  });

  container.querySelector("#export-save-btn")?.addEventListener("click", async () => {
    const fmt     = formatSel.value;
    const outPath = outInput.value.trim();
    if (!outPath) {
      statusEl.textContent = "⚠ Indiquez un chemin de sortie.";
      return;
    }
    statusEl.textContent = "Export en cours…";
    try {
      if (fmt === "tmx") {
        const res = await exportTmx(getConn()!, {
          pivot_doc_id: pivotId,
          target_doc_id: targetId,
          out_path: outPath,
        });
        setHtml(statusEl, raw(`✅ TMX enregistré : <code>${esc(res.out_path)}</code> · ${res.tu_count} TU(s)`));
      } else {
        const res = await exportBilingual(getConn()!, {
          pivot_doc_id: pivotId,
          target_doc_id: targetId,
          format: fmt as "html" | "txt",
          out_path: outPath,
        });
        setHtml(statusEl, raw(`✅ Fichier enregistré : <code>${esc(res.out_path ?? "")}</code> · ${res.pair_count} paires`));
      }
    } catch (err) {
      statusEl.textContent = `Erreur : ${err instanceof SidecarError ? err.message : String(err)}`;
    }
  });
}
