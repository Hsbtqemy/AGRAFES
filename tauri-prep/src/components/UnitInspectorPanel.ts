/**
 * UnitInspectorPanel.ts — document content inspector, extracted from MetadataScreen (U-02).
 *
 * Bundles three interdependent sub-panels of the edit panel:
 *   - the quick content preview (#meta-preview-panel),
 *   - the token-by-token editor (#meta-token-editor-panel),
 *   - inline single-unit text editing (delegated from the preview rows).
 *
 * They share state and re-render each other (the token dropdown is built from
 * the preview lines; inline edit refreshes the preview), so they form one
 * cohesive unit. The panel owns all 12 preview/token state fields plus the
 * conventions cache (which the host no longer touches) and makes ZERO writes to
 * the host's shared state and ZERO sibling-render calls — it only *reads*
 * conn / selectedDoc / editPanelEl and emits log/toast through its deps.
 */

import { setHtml, raw } from "../lib/safeHtml.ts";
import { escHtml as esc, escHtml as escHtmlMeta } from "../lib/diff.ts";
import { truncateMid } from "../lib/textTruncate.ts";
import {
  getDocumentPreview,
  listConventions,
  listTokens,
  updateToken,
  updateUnitText,
  richTextToHtml,
  SidecarError,
  type Conn,
  type DocumentRecord,
  type DocumentPreviewLine,
  type ConventionRole,
  type TokenRecord,
} from "../lib/sidecarClient.ts";

export interface UnitInspectorDeps {
  getConn(): Conn | null;
  getSelectedDoc(): DocumentRecord | null;
  getEditPanelEl(): HTMLElement;
  log(msg: string, isError?: boolean): void;
  showToast(msg: string, isError?: boolean): void;
}




function roleBadgeHtml(role: string | null | undefined, conventions: ConventionRole[]): string {
  if (!role) return "";
  const conv = conventions.find(c => c.name === role);
  const label = escHtmlMeta(conv?.label ?? role);
  const color = conv?.color ?? "#64748b";
  const nbsp = String.fromCharCode(0xa0);
  return `<span class="prep-role-badge" style="--role-color:${color}" title="Rôle : ${label}">${conv?.icon ? escHtmlMeta(conv.icon) + nbsp : ""}${label}</span>`;
}

export class UnitInspectorPanel {
  private _previewLines: DocumentPreviewLine[] = [];
  private _conventions: ConventionRole[] = [];
  private _previewTotalLines = 0;
  private _previewLimit = 6;
  private _previewLoading = false;
  private _previewError: string | null = null;
  private _previewDocId: number | null = null;
  private _tokenUnitId: number | null = null;
  private _tokenRows: TokenRecord[] = [];
  private _tokenLoading = false;
  private _tokenError: string | null = null;
  private _tokenSavingIds: Set<number> = new Set();

  constructor(private readonly _deps: UnitInspectorDeps) {}

  get previewLimit(): number {
    return this._previewLimit;
  }

  /** Clear all preview + token state (e.g. on connection change). */
  clear(): void {
    this._previewLines = [];
    this._previewTotalLines = 0;
    this._previewError = null;
    this._previewDocId = null;
    this._previewLoading = false;
    this._tokenUnitId = null;
    this._tokenRows = [];
    this._tokenLoading = false;
    this._tokenError = null;
    this._tokenSavingIds.clear();
  }

  /** Reset preview + token state for a newly selected document. */
  resetForDoc(docId: number): void {
    this._previewDocId = docId;
    this._previewLoading = true;
    this._previewError = null;
    this._previewLines = [];
    this._previewTotalLines = 0;
    this._tokenUnitId = null;
    this._tokenRows = [];
    this._tokenLoading = false;
    this._tokenError = null;
    this._tokenSavingIds.clear();
  }

  async loadDocPreview(docId: number): Promise<void> {
    const conn = this._deps.getConn();
    if (!conn) return;
    this._previewLoading = true;
    this._previewError = null;
    this.renderPreviewPanel();
    try {
      // Load conventions and preview in parallel so badges are ready when the panel renders
      const [convRes, res] = await Promise.all([
        listConventions(conn).catch(() => [] as ConventionRole[]),
        getDocumentPreview(conn, docId, this._previewLimit),
      ]);
      this._conventions = convRes;
      if (this._deps.getSelectedDoc()?.doc_id !== docId) return;
      this._previewDocId = docId;
      this._previewLines = res.lines ?? [];
      this._previewTotalLines = res.total_lines ?? this._previewLines.length;
      this._previewError = null;
    } catch (err) {
      if (this._deps.getSelectedDoc()?.doc_id !== docId) return;
      this._previewLines = [];
      this._previewTotalLines = 0;
      this._previewError = err instanceof SidecarError ? err.message : String(err);
    } finally {
      if (this._deps.getSelectedDoc()?.doc_id === docId) {
        this._previewLoading = false;
        this.renderPreviewPanel();
      }
    }
  }

  renderPreviewPanel(): void {
    const panel = this._deps.getEditPanelEl().querySelector<HTMLElement>("#meta-preview-panel");
    if (!panel || !this._deps.getSelectedDoc()) return;

    if (this._previewLoading) {
      panel.innerHTML = `<p class="empty-hint">Chargement de l'aperçu…</p>`;
      this.renderTokenEditorPanel();
      return;
    }
    if (this._previewError) {
      setHtml(panel, raw(`<p class="empty-hint" style="color:var(--color-danger)">Aperçu indisponible: ${esc(this._previewError)}</p>`));
      this.renderTokenEditorPanel();
      return;
    }
    if (this._previewLines.length === 0) {
      panel.innerHTML = `<p class="empty-hint">Aucune ligne disponible pour ce document.</p>`;
      this.renderTokenEditorPanel();
      return;
    }

    const count = this._previewLines.length;
    const suffix = this._previewTotalLines > count ? ` / ${this._previewTotalLines} lignes` : "";
    setHtml(panel, raw(`
      <p class="hint" style="margin:0 0 0.35rem">Extrait affiché: ${count}${suffix} <span class="prep-meta-edit-hint">— cliquer sur une ligne pour modifier</span></p>
      <div class="prep-meta-preview-lines">
        ${this._previewLines.map((line) => {
          const marker = line.external_id != null ? `[${String(line.external_id).padStart(4, "0")}]` : `[n${line.n}]`;
          const rawEscaped = esc(line.text_raw ?? line.text ?? "");
          return `<div class="prep-meta-preview-line prep-meta-preview-line--editable" data-unit-id="${line.unit_id}" data-text-raw="${rawEscaped}"><span class="prep-meta-preview-marker">${marker}</span>${roleBadgeHtml(line.unit_role, this._conventions)} <span class="prep-meta-preview-text">${richTextToHtml(line.text_raw, line.text)}</span><button class="prep-meta-edit-btn" title="Modifier ce segment" tabindex="-1">✎</button></div>`;
        }).join("")}
      </div>
    `));
    // Inline edit delegation
    panel.querySelector(".prep-meta-preview-lines")?.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>(".prep-meta-edit-btn");
      const row = (e.target as HTMLElement).closest<HTMLElement>(".prep-meta-preview-line--editable");
      if (!row || row.classList.contains("prep-meta-preview-line--editing")) return;
      if (!btn && !(e.target as HTMLElement).closest(".prep-meta-preview-text")) return;
      this._openInlineUnitEdit(row, panel);
    });
    this.renderTokenEditorPanel();
  }

  private _bindTokenEditorEvents(): void {
    const editPanelEl = this._deps.getEditPanelEl();
    const unitSel = editPanelEl.querySelector<HTMLSelectElement>("#meta-token-unit");
    unitSel?.addEventListener("change", () => {
      const raw = unitSel.value;
      this._tokenUnitId = raw ? Number(raw) : null;
    });

    const loadBtn = editPanelEl.querySelector<HTMLButtonElement>("#meta-token-load-btn");
    loadBtn?.addEventListener("click", () => void this._loadTokensForSelectedUnit());

    const wrap = editPanelEl.querySelector<HTMLElement>("#prep-meta-token-table-wrap");
    wrap?.addEventListener("click", (ev) => {
      const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>(".meta-token-save-btn");
      if (!btn) return;
      const tokenId = Number(btn.dataset.tokenId);
      if (!Number.isInteger(tokenId) || tokenId <= 0) return;
      const row = btn.closest<HTMLElement>(".meta-token-row");
      if (!row) return;
      void this._saveTokenRow(tokenId, row, btn);
    });
  }

  renderTokenEditorPanel(): void {
    const panel = this._deps.getEditPanelEl().querySelector<HTMLElement>("#meta-token-editor-panel");
    const doc = this._deps.getSelectedDoc();
    if (!panel || !doc) return;

    const unitOptions = this._previewLines.map((line) => {
      const marker = line.external_id != null ? `[${String(line.external_id).padStart(4, "0")}]` : `[n${line.n}]`;
      const label = `${marker} ${line.text}`.trim();
      const selected = this._tokenUnitId === line.unit_id ? " selected" : "";
      return `<option value="${line.unit_id}"${selected}>${esc(truncateMid(label, 70))}</option>`;
    }).join("");

    const hasRows = this._tokenRows.length > 0;
    const status = this._tokenError
      ? `<span class="prep-meta-token-status err">${esc(this._tokenError)}</span>`
      : hasRows
        ? `<span class="prep-meta-token-status ok">${this._tokenRows.length} token(s) chargé(s)</span>`
        : `<span class="prep-meta-token-status">Aucun token chargé.</span>`;

    setHtml(panel, raw(`
      <div class="prep-meta-token-toolbar">
        <label>Unité
          <select id="meta-token-unit">
            <option value="">— choisir dans l’aperçu —</option>
            ${unitOptions}
          </select>
        </label>
        <button id="meta-token-load-btn" class="btn btn-secondary btn-sm"${this._tokenLoading ? " disabled" : ""}>
          ${this._tokenLoading ? "Chargement…" : "Charger tokens"}
        </button>
        ${status}
      </div>
      <div id="prep-meta-token-table-wrap" class="prep-meta-token-table-wrap">
        ${
          !hasRows
            ? '<p class="empty-hint">Chargez une unité pour éditer ses annotations tokenisées.</p>'
            : `
            <table class="prep-meta-token-table" aria-label="Édition token par token">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Word</th>
                  <th>Lemma</th>
                  <th>UPOS</th>
                  <th>XPOS</th>
                  <th>FEATS</th>
                  <th>MISC</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${this._tokenRows.map((tok) => `
                  <tr class="meta-token-row" data-token-id="${tok.token_id}">
                    <td class="meta-token-pos">${tok.position}</td>
                    <td><input data-field="word" type="text" value="${esc(tok.word ?? "")}"></td>
                    <td><input data-field="lemma" type="text" value="${esc(tok.lemma ?? "")}"></td>
                    <td><input data-field="upos" type="text" value="${esc(tok.upos ?? "")}"></td>
                    <td><input data-field="xpos" type="text" value="${esc(tok.xpos ?? "")}"></td>
                    <td><input data-field="feats" type="text" value="${esc(tok.feats ?? "")}"></td>
                    <td><input data-field="misc" type="text" value="${esc(tok.misc ?? "")}"></td>
                    <td>
                      <button class="btn btn-secondary btn-sm meta-token-save-btn" data-token-id="${tok.token_id}"${this._tokenSavingIds.has(tok.token_id) ? " disabled" : ""}>
                        ${this._tokenSavingIds.has(tok.token_id) ? "…" : "Enregistrer"}
                      </button>
                    </td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
            `
        }
      </div>
    `));
    this._bindTokenEditorEvents();
  }

  private async _loadTokensForSelectedUnit(): Promise<void> {
    const conn = this._deps.getConn();
    const doc = this._deps.getSelectedDoc();
    if (!conn || !doc) return;
    const unitSel = this._deps.getEditPanelEl().querySelector<HTMLSelectElement>("#meta-token-unit");
    const rawUnit = unitSel?.value ?? "";
    const unitId = rawUnit ? Number(rawUnit) : this._tokenUnitId;
    if (!unitId || !Number.isInteger(unitId) || unitId <= 0) {
      this._tokenError = "Sélectionnez une unité dans l’aperçu avant de charger les tokens.";
      this._tokenRows = [];
      this.renderTokenEditorPanel();
      return;
    }

    this._tokenUnitId = unitId;
    this._tokenLoading = true;
    this._tokenError = null;
    this.renderTokenEditorPanel();

    try {
      const res = await listTokens(conn, {
        doc_id: doc.doc_id,
        unit_id: unitId,
        limit: 1000,
        offset: 0,
      });
      const cur = this._deps.getSelectedDoc();
      if (!cur || cur.doc_id !== res.doc_id) return;
      this._tokenRows = res.tokens ?? [];
      if (this._tokenRows.length === 0) {
        this._tokenError = "Aucun token disponible pour cette unité (import CoNLL-U ou annotation requis).";
      } else {
        this._tokenError = null;
      }
    } catch (err) {
      this._tokenRows = [];
      this._tokenError = err instanceof SidecarError ? err.message : String(err);
    } finally {
      this._tokenLoading = false;
      this.renderTokenEditorPanel();
    }
  }

  private async _saveTokenRow(tokenId: number, row: HTMLElement, btn: HTMLButtonElement): Promise<void> {
    const conn = this._deps.getConn();
    if (!conn || !this._deps.getSelectedDoc()) return;
    if (this._tokenSavingIds.has(tokenId)) return;

    const getField = (name: "word" | "lemma" | "upos" | "xpos" | "feats" | "misc"): string | null => {
      const input = row.querySelector<HTMLInputElement>(`input[data-field="${name}"]`);
      if (!input) return null;
      const value = input.value;
      return value === "" ? null : value;
    };

    const payload = {
      token_id: tokenId,
      word: getField("word"),
      lemma: getField("lemma"),
      upos: getField("upos"),
      xpos: getField("xpos"),
      feats: getField("feats"),
      misc: getField("misc"),
    };

    this._tokenSavingIds.add(tokenId);
    btn.disabled = true;
    try {
      const res = await updateToken(conn, payload);
      this._tokenRows = this._tokenRows.map((tok) => (tok.token_id === tokenId ? res.token : tok));
      this._tokenError = null;
      this._deps.log(`✓ Token #${tokenId} mis à jour (doc #${res.token.doc_id}, unité ${res.token.unit_n}).`);
      this._deps.showToast(`✓ Token #${tokenId} enregistré`);
    } catch (err) {
      const msg = err instanceof SidecarError ? err.message : String(err);
      this._tokenError = msg;
      this._deps.log(`Erreur mise à jour token #${tokenId}: ${msg}`, true);
      this._deps.showToast("✗ Impossible d’enregistrer le token", true);
    } finally {
      this._tokenSavingIds.delete(tokenId);
      this.renderTokenEditorPanel();
    }
  }

  // ── Inline unit text edit ────────────────────────────────────────────────────

  private _openInlineUnitEdit(row: HTMLElement, panel: HTMLElement): void {
    const unitId = Number(row.dataset.unitId);
    if (!unitId) return;
    const currentText = row.dataset.textRaw ?? row.querySelector(".prep-meta-preview-text")?.textContent ?? "";
    row.classList.add("prep-meta-preview-line--editing");

    setHtml(row, raw(`
      <textarea class="prep-meta-inline-textarea" rows="2">${esc(currentText)}</textarea>
      <div class="prep-meta-inline-footer">
        <span class="prep-meta-edit-hint">Ctrl+Entrée · Échap</span>
        <span class="prep-meta-inline-actions">
          <button class="btn btn-sm btn-primary prep-meta-inline-save">Enregistrer</button>
          <button class="btn btn-sm prep-meta-inline-cancel">Annuler</button>
        </span>
      </div>
    `));
    const textarea = row.querySelector<HTMLTextAreaElement>(".prep-meta-inline-textarea")!;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    const cancel = (): void => {
      this.renderPreviewPanel();
    };

    const save = async (): Promise<void> => {
      const conn = this._deps.getConn();
      if (!conn) { cancel(); return; }
      const newText = textarea.value;
      const saveBtn = row.querySelector<HTMLButtonElement>(".prep-meta-inline-save");
      if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "…"; }
      try {
        await updateUnitText(conn, unitId, newText);
        // Update cached preview line
        const line = this._previewLines.find(l => l.unit_id === unitId);
        if (line) { line.text_raw = newText; line.text = newText; }
        this._deps.log(`✓ Unité ${unitId} mise à jour.`);
        this.renderPreviewPanel();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this._deps.log(`✗ Erreur mise à jour unité ${unitId} : ${msg}`, true);
        cancel();
      }
    };

    row.querySelector(".prep-meta-inline-save")?.addEventListener("click", () => void save());
    row.querySelector(".prep-meta-inline-cancel")?.addEventListener("click", cancel);
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); cancel(); }
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void save(); }
    });
    panel.scrollTop; // force reflow
  }
}
