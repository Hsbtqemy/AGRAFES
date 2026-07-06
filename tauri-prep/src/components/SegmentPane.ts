/**
 * SegmentPane.ts — the canvas "Segmentation" layer (R5.4b-1).
 *
 * A preview→apply flow (not a per-unit selection flow like RolesPane): the header
 * carries the surface (Phrases | Balises | Personnalisé), the body renders the
 * *proposed* segmentation as a list grouped by source unit (aperçu en contexte,
 * decision A), and the fixed bottom sheet holds the summary + Apply so it stays
 * reachable after scrolling (R5.3). Apply is destructive (clears alignment) →
 * modalConfirm only when there is an alignment to lose (garde-fou conditionnel,
 * no imposed WORKCOPY); on success the host reloads the document.
 *
 * Pure logic (surface → params, grouping, summary, guard) lives in
 * lib/segmentControls.ts and is unit-tested; this file is DOM + sidecar wiring.
 *
 * Personnalisé (custom terminators / Mots) is deliberately disabled here → R5.4b-2.
 */

import type { Conn, SegmentPreviewResponse } from "../lib/sidecarClient.ts";
import { segmentPreview, segment, getDocumentStats, listUnits } from "../lib/sidecarClient.ts";
import { escHtml as esc } from "../lib/diff.ts";
import { setHtml, raw } from "../lib/safeHtml.ts";
import { modalConfirm } from "../lib/modalConfirm.ts";
import {
  buildSegmentParams,
  groupSegmentsBySource,
  segmentSummaryLine,
  needsAlignmentConfirm,
  surfaceHint,
  type SegSurface,
} from "../lib/segmentControls.ts";

export class SegmentPane {
  private readonly _root: HTMLElement;
  private readonly _getConn: () => Conn | null;
  /** Toast channel (success + error). Prep proscrit alert()/confirm() natifs. */
  private readonly _notify: (msg: string, isError?: boolean) => void;
  /** Shared fixed bottom sheet (R5.3): the summary + Apply live here. Null → in-pane. */
  private readonly _sheet: HTMLElement | null;
  /** Host reload after a successful resegmentation (stats/bandeau/couches se rechargent). */
  private readonly _onResegmented: (() => void | Promise<void>) | null;

  private _docId: number | null = null;
  private _lang: string | null = null;
  private _surface: SegSurface = "phrases";
  /** Current line units (n + text_norm) — rendered as-is by the "Brut" tab so the user can
   *  compare the current state against a proposed segmentation by switching tabs. */
  private _units: { n: number; text: string }[] = [];
  private _applyBarEl: HTMLElement | null = null;
  private _lastPreview: SegmentPreviewResponse | null = null;
  private _previewTimer: ReturnType<typeof setTimeout> | null = null;
  private _busy = false;
  /** Guards against a stale async preview overwriting a newer one (doc/surface switch). */
  private _previewToken = 0;

  constructor(
    root: HTMLElement,
    getConn: () => Conn | null,
    notify: (msg: string, isError?: boolean) => void,
    sheet?: HTMLElement | null,
    onResegmented?: (() => void | Promise<void>) | null,
  ) {
    this._root = root;
    this._getConn = getConn;
    this._notify = notify;
    this._sheet = sheet ?? null;
    this._onResegmented = onResegmented ?? null;
  }

  /** Build the static layout once. Idempotent. */
  mount(): void {
    if (this._root.querySelector(".prep-seg-canvas-root")) return;
    this._root.innerHTML = `
      <div class="prep-seg-canvas-root">
        <div class="prep-seg-canvas-toolbar">
          <div class="prep-seg-canvas-surface" role="tablist" aria-label="Vue de segmentation">
            <button type="button" class="prep-seg-canvas-surfbtn" data-surface="brut" role="tab" aria-selected="false">Brut</button>
            <button type="button" class="prep-seg-canvas-surfbtn active" data-surface="phrases" role="tab" aria-selected="true">Phrases</button>
            <button type="button" class="prep-seg-canvas-surfbtn" data-surface="balises" role="tab" aria-selected="false">Balises [N]</button>
            <button type="button" class="prep-seg-canvas-surfbtn" data-surface="custom" role="tab" aria-selected="false" disabled title="Personnalis&#233; &#8212; &#224; venir (R5.4b-2)">Personnalis&#233;</button>
          </div>
          <span class="prep-seg-canvas-hint" id="prep-seg-canvas-hint"></span>
        </div>
        <div class="prep-seg-canvas-preview" id="prep-seg-canvas-preview">
          <div class="prep-seg-canvas-empty">S&#233;lectionnez un document.</div>
        </div>
      </div>
    `;

    this._root.querySelectorAll<HTMLButtonElement>(".prep-seg-canvas-surfbtn").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        this._setSurface(btn.dataset.surface as SegSurface);
      });
    });

    // The summary + Apply live in the shared canvas sheet (sticky bottom, R5.3) if one is
    // provided, so they stay reachable without scrolling back up. Else in-pane.
    this._applyBarEl = document.createElement("div");
    this._applyBarEl.className = "prep-seg-canvas-applybar";
    (this._sheet ?? this._root).appendChild(this._applyBarEl);

    this._syncHint();
  }

  /** Point the pane at a document; renders the active view (Brut = current units,
   *  else the live segmentation preview). */
  async setDocument(docId: number | null, lang: string | null): Promise<void> {
    this.mount();
    this._docId = docId;
    this._lang = lang;
    this._lastPreview = null;
    this._units = [];
    if (docId === null) {
      this._renderEmpty("Sélectionnez un document.");
      this._renderApplyBar();
      return;
    }
    await this._loadUnits();
    await this._renderActiveView();
  }

  /** Load the current line units (for the Brut view). Mode switches don't change them,
   *  so this is per-document, not per-preview. */
  private async _loadUnits(): Promise<void> {
    const conn = this._getConn();
    if (!conn || this._docId === null) return;
    try {
      const units = await listUnits(conn, this._docId);
      this._units = units.map((u) => ({ n: u.n, text: u.text_norm ?? u.text_raw ?? "" }));
    } catch {
      this._units = [];
    }
  }

  /** Render whichever view the active surface calls for: Brut shows the current units
   *  (no segmentation, no Apply); the other surfaces run the live preview. */
  private async _renderActiveView(): Promise<void> {
    if (this._surface === "brut") {
      this._lastPreview = null;
      this._renderBrut();
      this._renderApplyBar();
      return;
    }
    await this._runPreview();
  }

  /** Canvas switched away from the Segmentation layer: retract our sheet contribution (R5.3). */
  deactivate(): void {
    const bar = this._applyBarEl;
    if (bar) { bar.classList.remove("visible"); bar.innerHTML = ""; }
  }

  dispose(): void {
    if (this._previewTimer) { clearTimeout(this._previewTimer); this._previewTimer = null; }
    this._docId = null;
    this._lastPreview = null;
  }

  // ─── Surface ──────────────────────────────────────────────────────────────

  private _setSurface(s: SegSurface): void {
    if (s === this._surface) return;
    this._surface = s;
    this._root.querySelectorAll<HTMLButtonElement>(".prep-seg-canvas-surfbtn").forEach((b) => {
      const on = b.dataset.surface === s;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", String(on));
    });
    this._syncHint();
    if (s === "brut") {
      this._previewToken++; // cancel any in-flight preview render
      this._lastPreview = null;
      this._renderBrut();
      this._renderApplyBar();
    } else {
      this._schedulePreview();
    }
  }

  /** Brut view: the current units in full. This tab exists precisely to read the raw text,
   *  so nothing is truncated. No Apply — Brut is a read of the current state, not a transform. */
  private _renderBrut(): void {
    const el = this._root.querySelector<HTMLElement>("#prep-seg-canvas-preview");
    if (!el) return;
    if (!this._units.length) {
      this._renderEmpty("Aucune unité de texte dans ce document.");
      return;
    }
    const html = this._units
      .map((u) =>
        `<div class="prep-seg-canvas-group">
            <div class="prep-seg-canvas-group-head">unit&#233; ${esc(String(u.n))}</div>
            <div class="prep-seg-canvas-seg"><span class="prep-seg-canvas-seg-text">${esc(u.text)}</span></div>
          </div>`,
      )
      .join("");
    setHtml(el, raw(html));
  }

  private _syncHint(): void {
    const el = this._root.querySelector<HTMLElement>("#prep-seg-canvas-hint");
    if (el) el.textContent = surfaceHint(this._surface);
  }

  // ─── Preview ──────────────────────────────────────────────────────────────

  private _schedulePreview(): void {
    if (this._previewTimer) clearTimeout(this._previewTimer);
    this._previewTimer = setTimeout(() => void this._runPreview(), 180);
  }

  private async _runPreview(): Promise<void> {
    const conn = this._getConn();
    if (!conn || this._docId === null) return;
    const token = ++this._previewToken;
    const previewEl = this._root.querySelector<HTMLElement>("#prep-seg-canvas-preview");
    if (previewEl) setHtml(previewEl, raw(`<div class="prep-seg-canvas-empty">Calcul de l&#8217;aper&#231;u&#8230;</div>`));
    const params = buildSegmentParams(this._surface);
    try {
      const resp = await segmentPreview(conn, { doc_id: this._docId, lang: this._lang ?? "und", ...params });
      if (token !== this._previewToken) return; // a newer preview superseded this one
      this._lastPreview = resp;
      this._renderPreview(resp);
    } catch (e) {
      if (token !== this._previewToken) return;
      this._lastPreview = null;
      this._renderEmpty(`Erreur : ${e instanceof Error ? e.message : String(e)}`, true);
    }
    this._renderApplyBar();
  }

  private _renderPreview(resp: SegmentPreviewResponse): void {
    const el = this._root.querySelector<HTMLElement>("#prep-seg-canvas-preview");
    if (!el) return;
    if (!resp.segments.length) {
      this._renderEmpty("Aucun segment — document vide ou non segmentable.");
      return;
    }
    const warns = resp.warnings.length
      ? `<div class="prep-seg-canvas-warns">${resp.warnings
          .map((w) => `<div class="prep-seg-canvas-warn">&#9888; ${esc(w)}</div>`)
          .join("")}</div>`
      : "";
    const groups = groupSegmentsBySource(resp.segments);
    const groupsHtml = groups
      .map((g) => {
        const segs = g.segments
          .map((s) => {
            const badge = s.external_id != null
              ? `<span class="prep-seg-canvas-extid">[${esc(String(s.external_id))}]</span>`
              : "";
            return `<div class="prep-seg-canvas-seg">${badge}<span class="prep-seg-canvas-seg-text">${esc(s.text)}</span></div>`;
          })
          .join("");
        const n = g.segments.length;
        return `<div class="prep-seg-canvas-group">
            <div class="prep-seg-canvas-group-head">unit&#233; ${esc(String(g.source_unit_n))} &#183; ${n} segment${n > 1 ? "s" : ""}</div>
            ${segs}
          </div>`;
      })
      .join("");
    setHtml(el, raw(warns + groupsHtml));
  }

  private _renderEmpty(msg: string, isError = false): void {
    const el = this._root.querySelector<HTMLElement>("#prep-seg-canvas-preview");
    if (el) {
      setHtml(el, raw(
        `<div class="prep-seg-canvas-empty${isError ? " prep-seg-canvas-error" : ""}">${esc(msg)}</div>`,
      ));
    }
  }

  // ─── Apply bar (in the fixed sheet) ───────────────────────────────────────

  private _renderApplyBar(): void {
    const bar = this._applyBarEl;
    if (!bar) return;
    const resp = this._lastPreview;
    if (!resp || this._docId === null) {
      bar.classList.remove("visible");
      bar.innerHTML = "";
      return;
    }
    bar.classList.add("visible");
    setHtml(bar, raw(`
      <span class="prep-seg-canvas-summary">${esc(segmentSummaryLine(resp.units_input, resp.units_output))}</span>
      <button type="button" class="btn btn-primary btn-sm" id="prep-seg-canvas-apply">Appliquer la segmentation</button>
    `));
    bar.querySelector("#prep-seg-canvas-apply")?.addEventListener("click", () => void this._apply());
  }

  private async _apply(): Promise<void> {
    const conn = this._getConn();
    if (!conn || this._docId === null || this._busy) return;

    // Fresh alignment signal → confirm only when there is an alignment to lose
    // (garde-fou conditionnel). Stats unavailable → best-effort treat as none.
    let alignedCount = 0;
    try {
      alignedCount = (await getDocumentStats(conn, this._docId)).aligned_count;
    } catch { /* ignore — no confirm */ }
    if (needsAlignmentConfirm(alignedCount)) {
      const ok = await modalConfirm({
        message: `Ce document a ${alignedCount} lien${alignedCount > 1 ? "s" : ""} d’alignement. Resegmenter les effacera. Continuer ?`,
        confirmLabel: "Resegmenter",
        danger: true,
      });
      if (!ok) return;
    }

    this._busy = true;
    const btn = this._applyBarEl?.querySelector<HTMLButtonElement>("#prep-seg-canvas-apply");
    if (btn) { btn.disabled = true; btn.textContent = "Application…"; }
    const params = buildSegmentParams(this._surface);
    try {
      const resp = await segment(conn, { doc_id: this._docId, lang: this._lang ?? "und", ...params });
      this._notify(`Segmentation appliquée — ${segmentSummaryLine(resp.units_input, resp.units_output)}.`);
      // Host reloads: re-fetch docs + re-focus → stats/bandeau/couches à jour, fts_stale remonté.
      // The re-focus re-enters setDocument here and rebuilds the preview + apply bar.
      await this._onResegmented?.();
    } catch (e) {
      this._notify(e instanceof Error ? e.message : String(e), true);
      if (btn) { btn.disabled = false; btn.textContent = "Appliquer la segmentation"; }
    } finally {
      this._busy = false;
    }
  }
}
