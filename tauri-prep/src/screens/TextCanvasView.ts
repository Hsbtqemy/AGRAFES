/**
 * TextCanvasView.ts — Prototype T0 de la refonte « texte central + couches ».
 *
 * Voir docs/DESIGN_prep_text_canvas.md. Sous-vue unifiée où LE TEXTE (les unités
 * du document) est l'élément central à scroll unique, avec un bandeau d'état
 * permanent et un sélecteur de couche. T0 = couche « Segmentation / Rôles »
 * seule (réutilise RolesPane) ; Curation/Annotation viendront en T1/T2.
 *
 * Lecture + écritures légères (rôle/borne, déjà immédiates). Aucune écriture de
 * curation. Cohabite avec les écrans legacy — rien retiré.
 */

import type { Conn, DocumentRecord } from "../lib/sidecarClient.ts";
import { escHtml as esc } from "../lib/diff.ts";
import { setHtml, raw } from "../lib/safeHtml.ts";
import { RolesPane } from "../components/RolesPane.ts";

export interface TextCanvasCallbacks {
  log: (msg: string, isError?: boolean) => void;
  toast: (msg: string, isError?: boolean) => void;
}

type CanvasMode = "roles" | "curation" | "annoter";

export class TextCanvasView {
  private readonly _getConn: () => Conn | null;
  private readonly _getDocs: () => DocumentRecord[];
  private readonly _cb: TextCanvasCallbacks;

  private _root: HTMLElement | null = null;
  private _rolesPane: RolesPane | null = null;
  private _docId: number | null = null;
  private _mode: CanvasMode = "roles";

  constructor(
    getConn: () => Conn | null,
    getDocs: () => DocumentRecord[],
    cb: TextCanvasCallbacks,
  ) {
    this._getConn = getConn;
    this._getDocs = getDocs;
    this._cb = cb;
  }

  render(wrapper: HTMLElement): void {
    wrapper.classList.add("prep-canvas-root");
    wrapper.setAttribute("role", "main");
    wrapper.setAttribute("aria-label", "Canvas Texte");
    this._root = wrapper;
    setHtml(wrapper, raw(`
      <div class="prep-canvas-statestrip" id="prep-canvas-state" aria-live="polite"></div>
      <div class="prep-canvas-toolbar">
        <label class="prep-canvas-doc-label">Document
          <select class="prep-canvas-doc" id="prep-canvas-doc"></select>
        </label>
        <div class="prep-canvas-modes" role="group" aria-label="Couche active">
          <button type="button" class="prep-canvas-modebtn active" data-mode="roles" aria-pressed="true">R&#244;les</button>
          <button type="button" class="prep-canvas-modebtn" data-mode="curation" disabled title="à venir (T1)">Curation</button>
          <button type="button" class="prep-canvas-modebtn" data-mode="annoter" disabled title="à venir (T2)">Annotation</button>
        </div>
      </div>
      <div class="prep-canvas-body" id="prep-canvas-body"></div>
    `));

    const body = wrapper.querySelector<HTMLElement>("#prep-canvas-body");
    if (body) {
      this._rolesPane = new RolesPane(body, this._getConn, (msg) => this._cb.toast(msg, true));
      this._rolesPane.mount();
    }

    const sel = wrapper.querySelector<HTMLSelectElement>("#prep-canvas-doc");
    sel?.addEventListener("change", () => {
      const v = sel.value ? parseInt(sel.value, 10) : null;
      void this._focusDoc(Number.isNaN(v as number) ? null : v);
    });

    wrapper.querySelectorAll<HTMLButtonElement>(".prep-canvas-modebtn").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        this._setMode(btn.dataset.mode as CanvasMode);
      });
    });

    this.refreshDocs();
  }

  /** Repopulate the document selector from the current docs list and re-focus. */
  refreshDocs(): void {
    const sel = this._root?.querySelector<HTMLSelectElement>("#prep-canvas-doc");
    if (!sel) return;
    const docs = this._getDocs();
    const opts = docs
      .map((d) => `<option value="${d.doc_id}">${esc(d.title)} (${esc(d.language ?? "?")})</option>`)
      .join("");
    setHtml(sel, raw(`<option value="">— choisir un document —</option>${opts}`));
    if (this._docId !== null && docs.some((d) => d.doc_id === this._docId)) {
      sel.value = String(this._docId);
    } else {
      this._docId = null;
    }
    this._renderStateStrip();
  }

  private async _focusDoc(docId: number | null): Promise<void> {
    this._docId = docId;
    const doc = this._getDocs().find((d) => d.doc_id === docId) ?? null;
    this._renderStateStrip();
    if (this._rolesPane) {
      await this._rolesPane.setDocument(docId, doc?.text_start_n ?? null);
    }
  }

  private _setMode(mode: CanvasMode): void {
    this._mode = mode;
    this._root?.querySelectorAll<HTMLButtonElement>(".prep-canvas-modebtn").forEach((b) => {
      const on = b.dataset.mode === mode;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    });
    // T0 : seul le mode "roles" a un rendu (RolesPane). Les autres sont désactivés.
  }

  private _renderStateStrip(): void {
    const el = this._root?.querySelector<HTMLElement>("#prep-canvas-state");
    if (!el) return;
    const doc = this._getDocs().find((d) => d.doc_id === this._docId) ?? null;
    if (!doc) {
      setHtml(el, raw(`<span class="prep-canvas-state-empty">Aucun document s&#233;lectionn&#233;.</span>`));
      return;
    }
    const wf = doc.workflow_status ?? "draft";
    const wfLabel = wf === "validated" ? "Valid&#233;" : wf === "review" ? "En revue" : "Brouillon";
    const wfClass = wf === "validated" ? "ok" : wf === "review" ? "warn" : "draft";
    const stale = doc.fts_stale === true;
    const ts = doc.text_start_n;
    // A0 — conscience du stade (DESIGN_prep_text_canvas.md §10). Dérivation front-pure
    // depuis unit_count (déjà au contrat) : Brut (≈1 unité) vs Segmenté (N unités). Les
    // signaux plus fins (grossier/fin, parent ¶, aligné) viendront avec l'expo de stats
    // par doc, en même temps qu'A1 (persistance du parent).
    const uc = typeof doc.unit_count === "number" ? doc.unit_count : null;
    const stageLabel = uc === null ? "Stade : ?" : uc <= 1 ? "Brut (non segmenté)" : `Segmenté · ${uc} unités`;
    const stageClass = uc === null ? "draft" : uc <= 1 ? "warn" : "ok";
    setHtml(el, raw(
      `<span class="prep-canvas-chip prep-canvas-chip--${stageClass}">${stageLabel}</span>` +
      `<span class="prep-canvas-chip prep-canvas-chip--${wfClass}">${wfLabel}</span>` +
      `<span class="prep-canvas-chip prep-canvas-chip--${stale ? "warn" : "ok"}">Index ${stale ? "⚠ périmé" : "à jour"}</span>` +
      `<span class="prep-canvas-chip">${ts != null ? `Borne : unité ${ts}` : "Borne : non posée"}</span>`,
    ));
  }
}
