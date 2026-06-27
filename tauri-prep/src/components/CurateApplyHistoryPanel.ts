/**
 * CurateApplyHistoryPanel.ts — "Historique des apply" panel, extracted from
 * CurationView (U-02).
 *
 * Owns the apply-history panel end-to-end: its skeleton (built on `mount`), its
 * lazy (re)load on open — merging the in-session apply events with the persisted
 * DB history via the pure helper in `lib/curationApplyHistory` — render and export.
 * It holds no mutable state of its own: the in-session events live in the host and
 * are read through {@link CurateApplyHistoryPanelDeps.getSessionEvents}; the scope
 * filter lives in the panel's own <select>.
 *
 * The host (CurationView) keeps owning `_applyHistory` (produced in `_runCurate`,
 * reset on doc switch) and the DB persistence (`recordApplyHistory`); this panel
 * only reads/merges/exports. The merge/format logic is tested in
 * `lib/__tests__/curationApplyHistory.test.ts`.
 */

import { setHtml, raw } from "../lib/safeHtml.ts";
import type {
  Conn,
  CurateApplyEvent,
  ExportApplyHistoryOptions,
} from "../lib/sidecarClient.ts";
import {
  listApplyHistory,
  exportApplyHistory,
} from "../lib/sidecarClient.ts";
import { save as dialogSave } from "@tauri-apps/plugin-dialog";
import {
  mergeApplyHistory,
  formatApplyHistoryList,
  type ApplyHistoryScope,
} from "../lib/curationApplyHistory.ts";

/** Host-supplied reads + log. The panel mutates no shared state itself. */
export interface CurateApplyHistoryPanelDeps {
  /** Live engine connection (never cached). */
  getConn(): Conn | null;
  /** In-session apply events (host-owned; merged with the persisted DB history). */
  getSessionEvents(): CurateApplyEvent[];
  /** Append to the prep-pane log. */
  log(msg: string, isError?: boolean): void;
}

export class CurateApplyHistoryPanel {
  /**
   * @param _root the host `<details>` element (id `act-apply-hist-panel`); the panel
   *   fills it with its skeleton on {@link mount}.
   */
  constructor(
    private readonly _root: HTMLDetailsElement,
    private readonly _deps: CurateApplyHistoryPanelDeps,
  ) {}

  private _q<T extends HTMLElement>(selector: string): T | null {
    return this._root.querySelector<T>(selector);
  }

  /** Build the skeleton into the host element and wire the panel's own listeners. */
  mount(): void {
    setHtml(this._root, raw(`
              <summary class="prep-curate-bottom-details-summary">
                Historique des apply <span id="act-apply-hist-badge" class="prep-apply-hist-badge" style="display:none">0</span>
              </summary>
              <div style="padding:6px 10px 10px">
                <div class="prep-apply-hist-toolbar">
                  <select id="act-apply-hist-scope" class="prep-apply-hist-scope-select" title="Filtrer par portée">
                    <option value="">Tous</option>
                    <option value="doc">Document</option>
                    <option value="all">Corpus</option>
                  </select>
                  <button class="btn btn-sm apply-hist-refresh" id="act-apply-hist-refresh" title="Actualiser">&#8635;</button>
                  <button class="btn btn-sm apply-hist-export-btn" id="act-apply-hist-export-json" title="Exporter en JSON">JSON</button>
                  <button class="btn btn-sm apply-hist-export-btn" id="act-apply-hist-export-csv" title="Exporter en CSV">CSV</button>
                </div>
                <div id="act-apply-hist-list" class="prep-apply-hist-list" aria-live="polite">
                  <p class="empty-hint">Ouvrez ce panneau pour charger l&#8217;historique.</p>
                </div>
                <span id="act-apply-hist-export-result" class="prep-apply-hist-export-result" style="display:none"></span>
              </div>
    `));

    // Lazy (re)load whenever the panel is opened — matches the original host wiring
    // (no cache: the DB history may have changed since the last open).
    this._root.addEventListener("toggle", () => {
      if (this._root.open) void this.load();
    });
    this._q("#act-apply-hist-refresh")?.addEventListener("click", () => void this.load());
    this._q("#act-apply-hist-scope")?.addEventListener("change", () => void this.load());
    this._q("#act-apply-hist-export-json")?.addEventListener("click", () => void this._runExport("json"));
    this._q("#act-apply-hist-export-csv")?.addEventListener("click", () => void this._runExport("csv"));
  }

  async load(): Promise<void> {
    const conn = this._deps.getConn();
    if (!conn) return;
    const listEl = this._q<HTMLElement>("#act-apply-hist-list");
    if (!listEl) return;
    const scopeEl = this._q<HTMLSelectElement>("#act-apply-hist-scope");
    const scopeFilter = (scopeEl?.value ?? "") as ApplyHistoryScope;
    listEl.innerHTML = `<p class="empty-hint" style="opacity:.6">Chargement\u2026</p>`;
    try {
      const res = await listApplyHistory(conn, { limit: 50 });
      const dbEvents = (res.events ?? []) as CurateApplyEvent[];
      // Merge + filter + cap delegated to the pure helper (testé dans
      // __tests__/curationApplyHistory.test.ts).
      const merged = mergeApplyHistory(this._deps.getSessionEvents(), dbEvents, {
        scope: scopeFilter,
        cap: 50,
      });
      this._render(listEl, merged);
      const badge = this._q<HTMLElement>("#act-apply-hist-badge");
      if (badge) { badge.textContent = String(merged.length); badge.style.display = merged.length ? "" : "none"; }
    } catch (err) {
      listEl.innerHTML = `<p class="empty-hint error-hint">Erreur lors du chargement.</p>`;
      this._deps.log(`⚠ Historique apply : ${err}`, true);
    }
  }

  private _render(container: HTMLElement, events: CurateApplyEvent[]): void {
    // Delegated to the pure helper (testé dans __tests__/curationApplyHistory.test.ts).
    setHtml(container, raw(formatApplyHistoryList(events)));
  }

  private async _runExport(format: "json" | "csv"): Promise<void> {
    const conn = this._deps.getConn();
    if (!conn) return;
    const resultEl = this._q<HTMLElement>("#act-apply-hist-export-result");
    const scopeEl  = this._q<HTMLSelectElement>("#act-apply-hist-scope");
    const scopeFilter = scopeEl?.value ?? "";
    if (resultEl) { resultEl.textContent = ""; resultEl.style.display = "none"; }
    const today = new Date().toISOString().slice(0, 10);
    const defaultName = `curation_apply_history_${scopeFilter || "all"}_${today}.${format}`;
    const outPath = await dialogSave({
      title: "Exporter l\u2019historique des apply",
      defaultPath: defaultName,
      filters: [{ name: format.toUpperCase(), extensions: [format] }],
    });
    if (!outPath) return;
    try {
      const opts: ExportApplyHistoryOptions = { out_path: outPath, format };
      const res = await exportApplyHistory(conn, opts);
      if (resultEl) {
        resultEl.textContent = res.count
          ? `Export\u00e9\u00a0: ${res.count}\u00a0\u00e9v\u00e9nement(s) \u2192 ${outPath}`
          : "Aucun \u00e9v\u00e9nement \u00e0 exporter.";
        resultEl.className = res.count ? "apply-hist-export-result ok" : "apply-hist-export-result empty";
        resultEl.style.display = "";
      }
    } catch (err) {
      if (resultEl) { resultEl.textContent = `Erreur export\u00a0: ${err}`; resultEl.className = "prep-apply-hist-export-result error"; resultEl.style.display = ""; }
      this._deps.log(`⚠ Export historique apply\u00a0: ${err}`, true);
    }
  }
}
