/**
 * SegStructureMatcherPanel.ts — the structure matcher + insert/delete + propagate
 * feature, extracted from SegmentationView (U-02).
 *
 * Owns the "Structure" tab end-to-end: section pairing (positional seed + manual
 * link/unlink), structure-unit insert/delete with an 8s undo banner, and the
 * propagate-preview editor (per-section segment edit/split/merge) culminating in
 * applyPropagated. It owns all matcher state; it reaches the host only through
 * {@link SegStructureMatcherPanelDeps}.
 *
 * Construction takes the SegmentationView root (stable across doc switches) so the
 * panel's root-scoped `_q` resolves the transient `#act-seg-structure-content`
 * scaffold (rebuilt by `_loadSegRightPanel` on every doc load) AND the host param
 * inputs (`#act-seg-calibrate/lang/pack`) exactly as the original inline code did.
 *
 * Host seams: `render(docId)` (open/refresh the tab), `reset(full)` (doc-switch =
 * full, calibrate-change = partial — keeps fetched sections), `dispose()` (clear
 * undo timers). The single apply effect on host state (last report + pending flag +
 * status repaint) is routed through `onSegmentApplied`.
 */

import { setHtml, raw } from "../lib/safeHtml.ts";
import { escHtml as _escHtml } from "../lib/diff.ts";
import {
  structureSections,
  segmentPropagatePreview,
  applyPropagated,
  zoneLines,
  insertStructureUnit,
  deleteStructureUnit,
} from "../lib/sidecarClient.ts";
import type {
  Conn,
  DocumentRecord,
  StructureSection,
} from "../lib/sidecarClient.ts";
import { segStructureMatcherHtml } from "../lib/segStructureMatcher.ts";

/** Host-supplied reads + outward effects. The panel owns all matcher state itself. */
export interface SegStructureMatcherPanelDeps {
  /** Live engine connection (never cached). */
  getConn(): Conn | null;
  /** Doc list for ref/target titles. */
  getDocs(): DocumentRecord[];
  /** Optional toast. */
  toast?(msg: string, isError?: boolean): void;
  /** Host reflects an applied propagation: sets last report + pending flag + repaints status. */
  onSegmentApplied(report: { doc_id: number; units_input: number; units_output: number }): void;
}

export class SegStructureMatcherPanel {
  private _refSections: StructureSection[] = [];
  private _tgtSections: StructureSection[] = [];
  private _structurePairs: [number, number][] = []; // [ref_idx, tgt_idx][]
  private _matcherInitialized = false; // true once user sees the matcher (prevents re-init on tab re-open)
  private _matcherPendingSide: "ref" | "tgt" | null = null;
  private _matcherPendingIdx: number | null = null;
  private _matcherDocId: number | null = null;
  private _matcherRefDocId: number | null = null;
  private _lastDeletedUnit: { docId: number; n: number; text: string; role: string | null } | null = null;
  private _undoTimer: ReturnType<typeof setTimeout> | null = null;
  private _undoCountdownInterval: ReturnType<typeof setInterval> | null = null;
  // ─── Propagate preview editable state ─────────────────────────────────────
  private _propagateLiveSections: Array<{
    status: string;
    header_text: string | null;
    header_role: string | null;
    ref_count: number;
    original_count: number;
    adjusted: boolean;
    segments: string[];
  }> = [];

  constructor(
    private readonly _root: HTMLElement,
    private readonly _deps: SegStructureMatcherPanelDeps,
  ) {}

  private _q<T extends Element = Element>(sel: string): T | null {
    return (this._root?.querySelector<T>(sel)) ?? null;
  }

  async render(docId: number): Promise<void> {
    const el = this._q<HTMLElement>("#act-seg-structure-content");
    if (!el) return;
    const conn = this._deps.getConn();
    if (!conn) { el.innerHTML = `<p class="empty-hint">Non connecté.</p>`; return; }

    const calibrateRaw = (this._q("#act-seg-calibrate") as HTMLSelectElement | null)?.value ?? "";
    if (!calibrateRaw) {
      el.innerHTML = `<p class="empty-hint">S&#233;lectionnez un document de r&#233;f&#233;rence dans &#171;&#160;Calibrer sur&#160;&#187;.</p>`;
      return;
    }
    const refDocId = parseInt(calibrateRaw, 10);
    const docs = this._deps.getDocs();
    const refDoc = docs.find(d => d.doc_id === refDocId);
    const curDoc = docs.find(d => d.doc_id === docId);

    el.innerHTML = `<p class="empty-hint">Analyse de la structure&#8230;</p>`;
    try {
      const res = await structureSections(conn, docId, refDocId);
      this._refSections = res.ref_sections;
      this._tgtSections = res.target_sections;

      if (res.ref_sections.length === 0 && res.target_sections.length === 0) {
        el.innerHTML = `<p class="empty-hint">Aucune unit&#233; de structure dans ces deux documents.</p>`;
        return;
      }

      // Init default positional pairs only on first load for this doc/ref pair
      if (!this._matcherInitialized || this._matcherDocId !== docId || this._matcherRefDocId !== refDocId) {
        const n = Math.min(this._refSections.length, this._tgtSections.length);
        this._structurePairs = Array.from({ length: n }, (_, i) => [i, i] as [number, number]);
        this._matcherPendingSide = null;
        this._matcherPendingIdx = null;
        this._matcherDocId = docId;
        this._matcherRefDocId = refDocId;
        this._matcherInitialized = true;
      }

      setHtml(el, raw(segStructureMatcherHtml(refDoc, refDocId, curDoc, docId, res)));

      this._rebuildMatcherCards();

      el.querySelector("#act-matcher-reset")?.addEventListener("click", () => {
        const n = Math.min(this._refSections.length, this._tgtSections.length);
        this._structurePairs = Array.from({ length: n }, (_, i) => [i, i] as [number, number]);
        this._matcherPendingSide = null;
        this._matcherPendingIdx = null;
        this._matcherInitialized = true; // keep initialized so re-opening the tab preserves reset state
        this._rebuildMatcherCards();
      });

      el.querySelector("#act-strucdiff-propagate-btn")?.addEventListener("click", () => {
        void this._runPropagatePreview(docId, refDocId);
      });
    } catch (err) {
      el.innerHTML = `<p class="empty-hint" style="color:var(--color-danger)">Erreur structure : ${_escHtml(err instanceof Error ? err.message : String(err))}</p>`;
    }
  }

  private _pairColor(pairIdx: number): string {
    return `hsl(${Math.round((pairIdx * 137.508) % 360)}, 55%, 35%)`;
  }

  private _rebuildMatcherCards(): void {
    const refCol = this._q<HTMLElement>("#act-matcher-ref");
    const tgtCol = this._q<HTMLElement>("#act-matcher-tgt");
    const hintEl = this._q<HTMLElement>("#act-matcher-hint");
    if (!refCol || !tgtCol) return;

    const cardHtml = (side: "ref" | "tgt", idx: number, section: StructureSection): string => {
      const pairIdx = side === "ref"
        ? this._structurePairs.findIndex(p => p[0] === idx)
        : this._structurePairs.findIndex(p => p[1] === idx);
      const isPending = this._matcherPendingSide === side && this._matcherPendingIdx === idx;

      let badge: string;
      let stateClass: string;
      if (isPending) {
        badge = `<span class="prep-matcher-badge prep-matcher-badge--pending">&#9679;</span>`;
        stateClass = "prep-matcher-card--pending";
      } else if (pairIdx >= 0) {
        const color = this._pairColor(pairIdx);
        badge = `<span class="prep-matcher-badge prep-matcher-badge--linked" style="background:${color};color:#fff">${pairIdx + 1}</span>`;
        stateClass = "prep-matcher-card--linked";
      } else {
        badge = `<span class="prep-matcher-badge prep-matcher-badge--orphan">&#8212;</span>`;
        stateClass = "prep-matcher-card--orphan";
      }

      const insertBtn = side === "ref" && pairIdx < 0
        ? `<button type="button" class="prep-matcher-insert-btn btn btn-ghost btn-xs" data-insert-ref-idx="${idx}" title="Insérer cet intertitre dans le document cible">&#8853;</button>`
        : side === "tgt"
        ? `<button type="button" class="prep-matcher-insert-btn btn btn-ghost btn-xs" data-insert-tgt-idx="${idx}" title="Insérer un nouvel intertitre dans cette section">&#8853;</button>
           <button type="button" class="prep-matcher-delete-btn btn btn-ghost btn-xs" data-delete-tgt-n="${section.n}" title="Supprimer cet intertitre du document cible">&#10005;</button>`
        : "";
      return `<div class="prep-matcher-card ${stateClass}" data-side="${side}" data-idx="${idx}" data-unit-role="${_escHtml(section.role ?? "")}" role="button" tabindex="0" title="${_escHtml(section.text)}">
        ${badge}
        <span class="prep-matcher-card-text">${_escHtml(section.text || "—")}</span>
        <span class="prep-matcher-card-count">${section.line_count} l.</span>
        ${insertBtn}
      </div>`;
    };

    setHtml(refCol, raw(this._refSections.map((s, i) => cardHtml("ref", i, s)).join("")));
    setHtml(tgtCol, raw(this._tgtSections.map((s, i) => cardHtml("tgt", i, s)).join("")));

    if (hintEl) {
      if (this._matcherPendingSide !== null) {
        const pendingIsLinked = this._matcherPendingSide === "ref"
          ? this._structurePairs.some(p => p[0] === this._matcherPendingIdx)
          : this._structurePairs.some(p => p[1] === this._matcherPendingIdx);
        const otherSide = this._matcherPendingSide === "ref" ? "document courant" : "référence";
        if (pendingIsLinked) {
          hintEl.textContent = `Section sélectionnée — cliquez sur une section de la ${otherSide} pour re-lier, ou recliquez pour délier`;
        } else {
          hintEl.textContent = `Section sélectionnée — cliquez sur une section de la ${otherSide} pour apparier`;
        }
      } else {
        const orphanRef = this._refSections.filter((_, i) => !this._structurePairs.some(p => p[0] === i)).length;
        const orphanTgt = this._tgtSections.filter((_, i) => !this._structurePairs.some(p => p[1] === i)).length;
        const parts = [`${this._structurePairs.length} paire${this._structurePairs.length !== 1 ? "s" : ""}`];
        if (orphanRef > 0) parts.push(`${orphanRef} orphelin${orphanRef !== 1 ? "s" : ""} réf`);
        if (orphanTgt > 0) parts.push(`${orphanTgt} orphelin${orphanTgt !== 1 ? "s" : ""} cible`);
        hintEl.textContent = parts.join(" · ") + " — cliquez une section pour la sélectionner";
      }
    }

    [refCol, tgtCol].forEach(col => {
      col.querySelectorAll<HTMLElement>(".prep-matcher-card").forEach(card => {
        card.addEventListener("click", () => {
          const side = card.dataset.side as "ref" | "tgt";
          const idx = parseInt(card.dataset.idx ?? "0", 10);
          this._handleMatcherClick(side, idx);
        });
      });
    });

    // Bind insert buttons on orphan ref cards
    refCol.querySelectorAll<HTMLButtonElement>(".prep-matcher-insert-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const rIdx = parseInt(btn.dataset.insertRefIdx ?? "0", 10);
        if (this._matcherDocId != null) {
          void this._openInsertZone({ side: "ref", idx: rIdx }, this._matcherDocId);
        }
      });
    });

    // Bind insert buttons on target cards
    tgtCol.querySelectorAll<HTMLButtonElement>(".prep-matcher-insert-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const tIdx = parseInt(btn.dataset.insertTgtIdx ?? "0", 10);
        if (this._matcherDocId != null) {
          void this._openInsertZone({ side: "tgt", idx: tIdx }, this._matcherDocId);
        }
      });
    });

    // Bind delete buttons on target cards
    tgtCol.querySelectorAll<HTMLButtonElement>(".prep-matcher-delete-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const n = parseInt(btn.dataset.deleteTgtN ?? "0", 10);
        if (this._matcherDocId != null) {
          void this._deleteStructureUnit(this._matcherDocId, n, btn);
        }
      });
    });
  }

  private async _deleteStructureUnit(docId: number, n: number, triggerBtn: HTMLButtonElement): Promise<void> {
    const conn = this._deps.getConn();
    if (!conn) return;
    const card = triggerBtn.closest<HTMLElement>(".prep-matcher-card");
    const label = card?.querySelector(".prep-matcher-card-text")?.textContent?.trim() ?? `n=${n}`;

    // Fetch role before deleting
    const roleAttr = card?.dataset.unitRole ?? null;

    try {
      await deleteStructureUnit(conn, docId, n);
      // Store for undo
      this._lastDeletedUnit = { docId, n, text: label, role: roleAttr };
      this._matcherInitialized = false;
      this._matcherPendingSide = null;
      this._matcherPendingIdx = null;
      await this.render(docId);
      this._showUndoBanner(label);
    } catch (err) {
      this._deps.toast?.(`Erreur suppression : ${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  private _showUndoBanner(label: string): void {
    const bar = this._q<HTMLElement>("#act-matcher-undo-bar");
    if (!bar) return;

    if (this._undoTimer) { clearTimeout(this._undoTimer); this._undoTimer = null; }

    const DURATION = 8000;
    bar.style.display = "";
    bar.innerHTML = `
      <span class="prep-matcher-undo-msg">Intertitre &#171;&#160;${_escHtml(label)}&#160;&#187; supprimé</span>
      <span class="prep-matcher-undo-countdown" id="act-undo-countdown">8</span>
      <button type="button" class="btn btn-ghost btn-xs prep-matcher-undo-btn" id="act-matcher-undo-btn">&#8630; Annuler</button>
    `;

    // Countdown display
    let remaining = DURATION / 1000;
    const countEl = bar.querySelector<HTMLElement>("#act-undo-countdown");
    if (this._undoCountdownInterval) clearInterval(this._undoCountdownInterval);
    this._undoCountdownInterval = setInterval(() => {
      remaining -= 1;
      if (countEl) countEl.textContent = String(remaining);
      if (remaining <= 0) { clearInterval(this._undoCountdownInterval!); this._undoCountdownInterval = null; }
    }, 1000);

    bar.querySelector("#act-matcher-undo-btn")?.addEventListener("click", () => {
      if (this._undoCountdownInterval) { clearInterval(this._undoCountdownInterval); this._undoCountdownInterval = null; }
      this._clearUndoBanner();
      void this._undoDeleteStructure();
    });

    this._undoTimer = setTimeout(() => {
      if (this._undoCountdownInterval) { clearInterval(this._undoCountdownInterval); this._undoCountdownInterval = null; }
      this._clearUndoBanner();
      this._lastDeletedUnit = null;
    }, DURATION);
  }

  private _clearUndoBanner(): void {
    if (this._undoTimer) { clearTimeout(this._undoTimer); this._undoTimer = null; }
    const bar = this._q<HTMLElement>("#act-matcher-undo-bar");
    if (bar) { bar.style.display = "none"; bar.innerHTML = ""; }
  }

  private async _undoDeleteStructure(): Promise<void> {
    const saved = this._lastDeletedUnit;
    if (!saved) return;
    this._lastDeletedUnit = null;
    const conn = this._deps.getConn();
    if (!conn) return;
    try {
      await insertStructureUnit(conn, saved.docId, saved.n, saved.text, saved.role ?? undefined);
      this._matcherInitialized = false;
      this._matcherPendingSide = null;
      this._matcherPendingIdx = null;
      await this.render(saved.docId);
      this._deps.toast?.(`Intertitre « ${saved.text} » restauré.`);
    } catch (err) {
      this._deps.toast?.(`Erreur restauration : ${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  private _handleMatcherClick(side: "ref" | "tgt", idx: number): void {
    const existingPairIdx = side === "ref"
      ? this._structurePairs.findIndex(p => p[0] === idx)
      : this._structurePairs.findIndex(p => p[1] === idx);
    const isLinked = existingPairIdx >= 0;
    const isPending = this._matcherPendingSide === side && this._matcherPendingIdx === idx;

    // Already pending (selected) → second click = deselect (and unlink if it was linked)
    if (isPending) {
      if (isLinked) this._structurePairs.splice(existingPairIdx, 1);
      this._matcherPendingSide = null;
      this._matcherPendingIdx = null;
      this._rebuildMatcherCards();
      return;
    }

    // Opposite side pending → create pair (first unlink both sides if already linked)
    if (this._matcherPendingSide !== null && this._matcherPendingSide !== side) {
      const refIdx = this._matcherPendingSide === "ref" ? this._matcherPendingIdx! : idx;
      const tgtIdx = this._matcherPendingSide === "tgt" ? this._matcherPendingIdx! : idx;
      // Remove any existing pair involving either side
      this._structurePairs = this._structurePairs.filter(
        p => p[0] !== refIdx && p[1] !== tgtIdx
      );
      this._structurePairs.push([refIdx, tgtIdx]);
      this._matcherPendingSide = null;
      this._matcherPendingIdx = null;
      this._rebuildMatcherCards();
      return;
    }

    // Same side pending → reselect to a different card on the same side
    if (this._matcherPendingSide === side) {
      this._matcherPendingIdx = idx;
      this._rebuildMatcherCards();
      return;
    }

    // No pending → select this card (linked or orphan)
    this._matcherPendingSide = side;
    this._matcherPendingIdx = idx;
    this._rebuildMatcherCards();
  }

  /** Open the insert modal for a ref orphan or a target section. */
  private async _openInsertZone(source: { side: "ref"; idx: number } | { side: "tgt"; idx: number }, docId: number): Promise<void> {
    if (!this._root) return;
    const conn = this._deps.getConn();
    if (!conn) return;

    // Remove any existing modal first
    this._root.querySelector(".prep-insert-modal-backdrop")?.remove();

    let prefillText = "";
    let fromN: number | null = null;
    let toN: number | null = null;

    if (source.side === "ref") {
      // Orphan ref section: zone = target area around where this ref section should go
      const refSection = this._refSections[source.idx];
      if (!refSection) return;
      prefillText = refSection.text;
      const sortedPairs = [...this._structurePairs].sort((a, b) => a[0] - b[0]);
      const prevPair = [...sortedPairs].reverse().find(p => p[0] < source.idx);
      const nextPair = sortedPairs.find(p => p[0] > source.idx);
      fromN = prevPair != null ? this._tgtSections[prevPair[1]]?.n ?? null : null;
      toN = nextPair != null ? this._tgtSections[nextPair[1]]?.n ?? null : null;
    } else {
      // Target section: zone = lines within this target section
      const tgtSection = this._tgtSections[source.idx];
      if (!tgtSection) return;
      prefillText = "";
      fromN = tgtSection.n;
      toN = this._tgtSections[source.idx + 1]?.n ?? null;
    }

    const backdrop = document.createElement("div");
    backdrop.className = "prep-insert-modal-backdrop";
    backdrop.innerHTML = `
      <div class="prep-insert-modal" role="dialog" aria-modal="true">
        <div class="prep-insert-modal-header">
          <span class="prep-insert-modal-title">&#8853; Insérer un intertitre</span>
          <button type="button" class="btn btn-ghost btn-xs prep-insert-modal-close">&#10005;</button>
        </div>
        <div class="prep-insert-modal-body">
          <div class="prep-insert-modal-form">
            <label class="prep-matcher-insert-label">Texte de l'intertitre</label>
            <input type="text" class="prep-matcher-insert-text-input prep-insert-modal-text" value="${_escHtml(prefillText)}" placeholder="Saisir le texte de l'intertitre…" />
          </div>
          <div class="prep-matcher-insert-lines-label">Choisissez la ligne du document cible avant laquelle insérer :</div>
          <div class="prep-matcher-insert-lines prep-insert-modal-lines">
            <p class="empty-hint">Chargement&#8230;</p>
          </div>
        </div>
      </div>
    `;
    this._root.appendChild(backdrop);

    const close = () => backdrop.remove();
    backdrop.querySelector(".prep-insert-modal-close")?.addEventListener("click", close);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    backdrop.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

    const textInput = backdrop.querySelector<HTMLInputElement>(".prep-insert-modal-text");
    textInput?.focus();

    try {
      const res = await zoneLines(conn, docId, fromN, toN);
      const linesEl = backdrop.querySelector<HTMLElement>(".prep-insert-modal-lines");
      if (!linesEl) return;

      if (res.lines.length === 0) {
        // Zone vide — proposer d'insérer à la position calculée (après fromN, ou en début de doc)
        const insertN = fromN != null ? fromN + 1 : 1;
        setHtml(linesEl, raw(`
          <p class="empty-hint" style="margin-bottom:0.5rem">Aucune ligne dans cette zone.</p>
          <div class="prep-matcher-insert-line">
            <span class="prep-matcher-insert-line-n">${insertN}</span>
            <span class="prep-matcher-insert-line-text" style="font-style:italic">${fromN != null ? `après la position ${fromN}` : "début du document"}</span>
            <button type="button" class="btn btn-ghost btn-xs prep-matcher-insert-line-btn" data-before-n="${insertN}">Insérer ici</button>
          </div>`));
        linesEl.querySelectorAll<HTMLButtonElement>(".prep-matcher-insert-line-btn").forEach(btn => {
          btn.addEventListener("click", async () => {
            const beforeN = parseInt(btn.dataset.beforeN ?? "0", 10);
            const text = textInput?.value.trim() ?? prefillText;
            if (!text) return;
            close();
            await this._executeInsertStructure(docId, beforeN, text);
          });
        });
        return;
      }

      setHtml(linesEl, raw(res.lines.map(line => `
        <div class="prep-matcher-insert-line" data-line-n="${line.n}">
          <span class="prep-matcher-insert-line-n">${line.n}</span>
          <span class="prep-matcher-insert-line-text">${_escHtml(line.text)}</span>
          <button type="button" class="btn btn-ghost btn-xs prep-matcher-insert-line-btn" data-before-n="${line.n}">Insérer avant</button>
        </div>
      `).join("")));

      linesEl.querySelectorAll<HTMLButtonElement>(".prep-matcher-insert-line-btn").forEach(btn => {
        btn.addEventListener("click", async () => {
          const beforeN = parseInt(btn.dataset.beforeN ?? "0", 10);
          const text = textInput?.value.trim() ?? prefillText;
          if (!text) return;
          close();
          await this._executeInsertStructure(docId, beforeN, text);
        });
      });
    } catch (err) {
      const linesEl = backdrop.querySelector<HTMLElement>(".prep-insert-modal-lines");
      if (linesEl) linesEl.innerHTML = `<p class="empty-hint" style="color:var(--color-danger)">Erreur : ${_escHtml(err instanceof Error ? err.message : String(err))}</p>`;
    }
  }

  /** Insert a structure unit in the DB and reload the matcher. */
  private async _executeInsertStructure(docId: number, beforeN: number, text: string): Promise<void> {
    const conn = this._deps.getConn();
    if (!conn) return;

    try {
      await insertStructureUnit(conn, docId, beforeN, text);
      this._deps.toast?.(`Intertitre « ${text} » inséré avant la ligne ${beforeN}.`);
      // Reset matcher state and reload
      this._matcherInitialized = false;
      this._matcherPendingSide = null;
      this._matcherPendingIdx = null;
      await this.render(docId);
    } catch (err) {
      this._deps.toast?.(`Erreur insertion : ${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  private async _runPropagatePreview(docId: number, refDocId: number): Promise<void> {
    const resultEl = this._q<HTMLElement>("#act-strucdiff-propagate-result");
    const btn = this._q<HTMLButtonElement>("#act-strucdiff-propagate-btn");
    if (!resultEl) return;
    const conn = this._deps.getConn();
    if (!conn) return;

    const lang = (this._q("#act-seg-lang") as HTMLInputElement | null)?.value.trim() || "fr";
    const pack = (this._q("#act-seg-pack") as HTMLSelectElement | null)?.value ?? "auto";

    if (btn) { btn.disabled = true; btn.textContent = "Calcul…"; }
    resultEl.innerHTML = `<p class="empty-hint">Segmentation propagée en cours&#8230;</p>`;

    try {
      const mapping = this._structurePairs.length > 0 ? this._structurePairs : undefined;
      const res = await segmentPropagatePreview(conn, { doc_id: docId, reference_doc_id: refDocId, lang, pack, section_mapping: mapping });

      // Build live editable state
      this._propagateLiveSections = res.sections.map(s => ({
        status: s.status,
        header_text: s.header_text,
        header_role: s.header_role,
        ref_count: s.ref_count,
        original_count: s.segments.length,
        adjusted: s.adjusted,
        segments: s.segments.map(seg => seg.text),
      }));

      const warns = res.warnings.length
        ? `<div class="prep-seg-warn-list">${res.warnings.map(w => `<div class="prep-seg-warn">${_escHtml(w)}</div>`).join("")}</div>`
        : "";

      setHtml(resultEl, raw(`
        <div class="prep-propagate-result-header">
          <span class="prep-propagate-result-title">Aperçu propagé — <span data-propagate-total>${res.total_segments} phrases</span> · pack ${res.segment_pack}</span>
          <button type="button" class="btn prep-btn-warning btn-sm" id="act-propagate-apply-btn">
            Appliquer cette segmentation
          </button>
        </div>
        ${warns}
        <div class="prep-propagate-sections">
          ${res.sections.map((s, i) => {
            const headerLabel = s.header_text != null ? _escHtml(s.header_text) : `<em>avant premier intertitre</em>`;
            const missingBadge = s.status === "missing_in_target"
              ? `<span class="prep-strucdiff-badge prep-strucdiff-missing">&#9888; manquant dans cible</span>` : "";
            return `
              <details class="prep-propagate-section" open data-sec-idx="${i}">
                <summary class="prep-propagate-section-head">
                  <span class="prep-propagate-section-label">${headerLabel}</span>
                  <span class="prep-propagate-section-count" data-count-sec="${i}"></span>
                  ${missingBadge}
                </summary>
                <div class="prep-propagate-section-body" data-sec-body="${i}"></div>
              </details>`;
          }).join("")}
        </div>
      `));

      // Render each section body with interactive edit controls
      res.sections.forEach((_, i) => {
        this._rebuildPropagateSectionBody(i);
        this._updateSectionCount(i);
      });

      resultEl.querySelector("#act-propagate-apply-btn")?.addEventListener("click", () => {
        void this._applyPropagateResult(res);
      });

    } catch (err) {
      resultEl.innerHTML = `<p class="empty-hint" style="color:var(--color-danger)">Erreur : ${_escHtml(err instanceof Error ? err.message : String(err))}</p>`;
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = "&#9654; Aperçu propagé"; }
    }
  }

  private _rebuildPropagateSectionBody(secIdx: number): void {
    const bodyEl = this._q<HTMLElement>(`[data-sec-body="${secIdx}"]`);
    if (!bodyEl) return;
    const sec = this._propagateLiveSections[secIdx];
    if (!sec) return;

    if (sec.segments.length === 0) {
      bodyEl.innerHTML = `<div class="prep-propagate-seg-empty">Aucun segment (section manquante dans la cible).</div>`;
      return;
    }

    setHtml(bodyEl, raw(sec.segments.flatMap((text, segIdx) => {
      const segRow = `
        <div class="prep-propagate-seg-row" data-sec-idx="${secIdx}" data-seg-idx="${segIdx}">
          <span class="prep-propagate-seg-n">${segIdx + 1}</span>
          <span class="prep-propagate-seg-text" title="Double-cliquez pour modifier">${_escHtml(text)}</span>
          <div class="prep-propagate-seg-actions">
            <button type="button" class="btn btn-ghost btn-xs prep-propagate-split-btn" title="Couper ce segment">&#247;</button>
          </div>
        </div>`;
      const mergeRow = segIdx < sec.segments.length - 1 ? `
        <div class="prep-propagate-merge-row" data-sec-idx="${secIdx}" data-before-seg-idx="${segIdx}">
          <button type="button" class="prep-propagate-merge-btn" title="Fusionner avec le segment suivant">&#8627; fusionner</button>
        </div>` : "";
      return [segRow, mergeRow];
    }).join("")));

    bodyEl.querySelectorAll<HTMLElement>(".prep-propagate-seg-text").forEach(el => {
      el.addEventListener("dblclick", () => {
        const row = el.closest<HTMLElement>(".prep-propagate-seg-row");
        if (!row) return;
        this._startSegmentEdit(
          parseInt(row.dataset.secIdx ?? "0", 10),
          parseInt(row.dataset.segIdx ?? "0", 10),
        );
      });
    });

    bodyEl.querySelectorAll<HTMLButtonElement>(".prep-propagate-split-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const row = btn.closest<HTMLElement>(".prep-propagate-seg-row");
        if (!row) return;
        this._startSegmentSplit(
          parseInt(row.dataset.secIdx ?? "0", 10),
          parseInt(row.dataset.segIdx ?? "0", 10),
        );
      });
    });

    bodyEl.querySelectorAll<HTMLButtonElement>(".prep-propagate-merge-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const mrow = btn.closest<HTMLElement>(".prep-propagate-merge-row");
        if (!mrow) return;
        this._mergeSegments(
          parseInt(mrow.dataset.secIdx ?? "0", 10),
          parseInt(mrow.dataset.beforeSegIdx ?? "0", 10),
        );
      });
    });
  }

  private _startSegmentEdit(secIdx: number, segIdx: number): void {
    const bodyEl = this._q<HTMLElement>(`[data-sec-body="${secIdx}"]`);
    if (!bodyEl) return;
    const text = this._propagateLiveSections[secIdx]?.segments[segIdx] ?? "";
    const row = bodyEl.querySelector<HTMLElement>(
      `.prep-propagate-seg-row[data-sec-idx="${secIdx}"][data-seg-idx="${segIdx}"]`,
    );
    if (!row) return;

    const editDiv = document.createElement("div");
    editDiv.className = "prep-propagate-edit-row";
    editDiv.innerHTML = `
      <textarea class="prep-propagate-edit-area" rows="2">${_escHtml(text)}</textarea>
      <div class="prep-propagate-edit-actions">
        <button type="button" class="btn btn-primary btn-xs prep-propagate-edit-ok">&#10003; Valider</button>
        <button type="button" class="btn btn-ghost btn-xs prep-propagate-edit-cancel">&#10005; Annuler</button>
      </div>`;
    row.replaceWith(editDiv);

    const ta = editDiv.querySelector<HTMLTextAreaElement>("textarea");
    ta?.focus();

    const commit = () => {
      const val = ta?.value.trim() ?? "";
      if (!val) {
        if (ta) ta.style.borderColor = "var(--color-danger, #dc2626)";
        return;
      }
      this._propagateLiveSections[secIdx].segments[segIdx] = val;
      this._rebuildPropagateSectionBody(secIdx);
      this._updateSectionCount(secIdx);
    };
    editDiv.querySelector(".prep-propagate-edit-ok")?.addEventListener("click", commit);
    editDiv.querySelector(".prep-propagate-edit-cancel")?.addEventListener("click", () => {
      this._rebuildPropagateSectionBody(secIdx);
    });
    ta?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commit(); }
      if (e.key === "Escape") this._rebuildPropagateSectionBody(secIdx);
    });
  }

  private _startSegmentSplit(secIdx: number, segIdx: number): void {
    const bodyEl = this._q<HTMLElement>(`[data-sec-body="${secIdx}"]`);
    if (!bodyEl) return;
    const text = this._propagateLiveSections[secIdx]?.segments[segIdx] ?? "";
    const row = bodyEl.querySelector<HTMLElement>(
      `.prep-propagate-seg-row[data-sec-idx="${secIdx}"][data-seg-idx="${segIdx}"]`,
    );
    if (!row) return;

    const [partA, partB] = _splitAtMidpoint(text);
    const splitDiv = document.createElement("div");
    splitDiv.className = "prep-propagate-split-row";
    splitDiv.innerHTML = `
      <div class="prep-propagate-split-halves">
        <textarea class="prep-propagate-edit-area prep-propagate-split-a" rows="2">${_escHtml(partA)}</textarea>
        <div class="prep-propagate-split-sep">&#8213; coupure &#8213;</div>
        <textarea class="prep-propagate-edit-area prep-propagate-split-b" rows="2">${_escHtml(partB)}</textarea>
      </div>
      <div class="prep-propagate-edit-actions">
        <button type="button" class="btn btn-primary btn-xs prep-propagate-split-ok">&#247; Couper</button>
        <button type="button" class="btn btn-ghost btn-xs prep-propagate-split-cancel">&#10005; Annuler</button>
      </div>`;
    row.replaceWith(splitDiv);

    splitDiv.querySelector<HTMLTextAreaElement>(".prep-propagate-split-a")?.focus();

    splitDiv.querySelector(".prep-propagate-split-ok")?.addEventListener("click", () => {
      const a = splitDiv.querySelector<HTMLTextAreaElement>(".prep-propagate-split-a")?.value.trim() ?? "";
      const b = splitDiv.querySelector<HTMLTextAreaElement>(".prep-propagate-split-b")?.value.trim() ?? "";
      const parts = [a, b].filter(s => s.length > 0);
      if (parts.length > 0) {
        this._propagateLiveSections[secIdx].segments.splice(segIdx, 1, ...parts);
      }
      this._rebuildPropagateSectionBody(secIdx);
      this._updateSectionCount(secIdx);
    });
    splitDiv.querySelector(".prep-propagate-split-cancel")?.addEventListener("click", () => {
      this._rebuildPropagateSectionBody(secIdx);
    });
  }

  private _mergeSegments(secIdx: number, beforeSegIdx: number): void {
    const segs = this._propagateLiveSections[secIdx]?.segments;
    if (!segs || beforeSegIdx + 1 >= segs.length) return;
    const merged = (segs[beforeSegIdx] + " " + segs[beforeSegIdx + 1]).replace(/\s+/g, " ").trim();
    segs.splice(beforeSegIdx, 2, merged);
    this._rebuildPropagateSectionBody(secIdx);
    this._updateSectionCount(secIdx);
  }

  private _updateSectionCount(secIdx: number): void {
    const el = this._q<HTMLElement>(`[data-count-sec="${secIdx}"]`);
    if (!el) return;
    const sec = this._propagateLiveSections[secIdx];
    if (!sec) return;
    const count = sec.segments.length;
    const delta = count - sec.ref_count;
    const deltaSign = delta > 0 ? "+" : "";
    const deltaAbs = Math.abs(delta);
    const deltaRatio = sec.ref_count > 0 ? deltaAbs / sec.ref_count : 0;
    const deltaClass = deltaAbs === 0 ? "prep-strucdiff-delta-ok"
      : deltaRatio > 0.15 ? "prep-strucdiff-delta-warn"
      : "prep-strucdiff-delta-ok";
    const deltaBadge = sec.ref_count > 0
      ? `<span class="prep-strucdiff-delta ${deltaClass}">${deltaSign}${delta}</span>`
      : "";
    const isEdited = count !== sec.original_count;
    const badge = isEdited
      ? `<span class="prep-propagate-adj-badge prep-propagate-edited-badge">édité</span>`
      : sec.adjusted ? `<span class="prep-propagate-adj-badge">ajusté</span>` : "";
    setHtml(el, raw(sec.ref_count > 0
      ? `${count} phrases <span class="prep-strucdiff-count-ref">(réf: ${sec.ref_count})</span> ${deltaBadge} ${badge}`
      : `${count} phrases ${badge}`));

    // Update global total
    const total = this._propagateLiveSections.reduce((sum, s) => sum + s.segments.length, 0);
    const totalEl = this._q<HTMLElement>("[data-propagate-total]");
    if (totalEl) totalEl.textContent = `${total} phrases`;
  }

  private async _applyPropagateResult(res: import("../lib/sidecarClient.ts").PropagatePreviewResponse): Promise<void> {
    const conn = this._deps.getConn();
    if (!conn) return;
    const docId = res.doc_id;

    if (this._propagateLiveSections.length === 0) {
      this._deps.toast?.("Aucune section à appliquer.", true);
      return;
    }

    // Build flat ordered unit list from the editable state
    const units: import("../lib/sidecarClient.ts").ApplyPropagatedUnit[] = [];
    for (const sec of this._propagateLiveSections) {
      // Include structure unit for matched/extra sections (pre and missing_in_target have none)
      if (sec.status !== "pre" && sec.status !== "missing_in_target" && sec.header_text) {
        units.push({
          type: "structure",
          text: sec.header_text,
          ...(sec.header_role ? { role: sec.header_role } : {}),
        });
      }
      for (const text of sec.segments) {
        if (text.trim()) units.push({ type: "line", text });
      }
    }

    if (units.length === 0) {
      this._deps.toast?.("Aucune unité à écrire.", true);
      return;
    }

    const applyBtn = this._q<HTMLButtonElement>("#act-propagate-apply-btn");
    if (applyBtn) { applyBtn.disabled = true; applyBtn.textContent = "Application…"; }

    try {
      const result = await applyPropagated(conn, docId, units);
      this._deps.onSegmentApplied({ doc_id: docId, units_input: 0, units_output: result.units_written });
      this._deps.toast?.(`Segmentation propagée appliquée — ${result.units_written} unités écrites.`);
      if (applyBtn) {
        applyBtn.disabled = false;
        applyBtn.innerHTML = "&#10003; Réappliquer";
      }
    } catch (e) {
      this._deps.toast?.(`Erreur : ${e instanceof Error ? e.message : String(e)}`, true);
      if (applyBtn) { applyBtn.disabled = false; applyBtn.textContent = "Appliquer cette segmentation"; }
    }
  }

  /**
   * Reset matcher state. `full` (doc switch) also clears fetched sections + propagate
   * editor; `full=false` (calibrate change) keeps them — mirrors the two original
   * inline reset blocks exactly.
   */
  reset(full: boolean): void {
    this._structurePairs = [];
    this._matcherInitialized = false;
    this._matcherPendingSide = null;
    this._matcherPendingIdx = null;
    this._matcherDocId = null;
    this._matcherRefDocId = null;
    if (full) {
      this._refSections = [];
      this._tgtSections = [];
      this._propagateLiveSections = [];
    }
  }

  /** Clear the undo banner timers (called by the host on dispose). */
  dispose(): void {
    if (this._undoTimer) {
      clearTimeout(this._undoTimer);
      this._undoTimer = null;
    }
    if (this._undoCountdownInterval) {
      clearInterval(this._undoCountdownInterval);
      this._undoCountdownInterval = null;
    }
  }
}

function _splitAtMidpoint(text: string): [string, string] {
  const mid = Math.floor(text.length / 2);
  let best = mid;
  let bestDist = Infinity;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === " " || text[i] === "\n") {
      const dist = Math.abs(i - mid);
      if (dist < bestDist) { bestDist = dist; best = i; }
    }
  }
  return [text.slice(0, best).trim(), text.slice(best).trim()];
}
