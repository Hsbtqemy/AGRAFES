/**
 * AlignCollisionPanel.ts — the alignment "collisions" sub-feature, extracted from
 * AlignPanel (U-02, first interactive-core extraction).
 *
 * Owns the collision section end-to-end: paging (listCollisions), the group/links
 * table render, and resolve (keep/reject/delete). It fetches its OWN link objects
 * (no aliasing with AlignPanel's audit `_auditLinks`) and writes back to the host
 * exactly ONE value — the total collision count — through {@link AlignCollisionPanelDeps.onCollisionCountChanged}
 * (which drives the host topbar KPI badge). It renders into the host-built, stable
 * `#align-coll-section`/`#align-coll-result` subtree, queried via the AlignPanel root.
 */

import { setHtml, raw } from "../lib/safeHtml.ts";
import { escHtml as _esc } from "../lib/diff.ts";
import type { Conn, CollisionGroup } from "../lib/sidecarClient.ts";
import { listCollisions, resolveCollisions, SidecarError } from "../lib/sidecarClient.ts";

/** Host-supplied reads + the single shared-write (collision count → KPI badge). */
export interface AlignCollisionPanelDeps {
  getConn(): Conn | null;
  log(msg: string, isError?: boolean): void;
  toast(msg: string, isError?: boolean): void;
  /** Report the total collision count to the host (drives the topbar KPI badge). */
  onCollisionCountChanged(count: number): void;
}

export class AlignCollisionPanel {
  private _collOffset = 0;
  private _collLimit = 20;
  private _collGroups: CollisionGroup[] = [];
  private _collHasMore = false;
  private _collTotalCount = 0;

  constructor(
    private readonly _root: HTMLElement,
    private readonly _deps: AlignCollisionPanelDeps,
  ) {}

  private _q<T extends HTMLElement>(sel: string): T | null {
    return this._root.querySelector<T>(sel);
  }

  /** Wire the section's load / more / close buttons (stable template nodes). */
  mount(): void {
    this._q("#align-coll-load-btn")?.addEventListener("click", () => void this.loadCollisions(false));
    this._q("#align-coll-more-btn")?.addEventListener("click", () => void this.loadCollisions(true));
    this._q("#align-coll-close")?.addEventListener("click", () => {
      const section = this._q<HTMLElement>("#align-coll-section");
      if (section) section.style.display = "none";
    });
  }

  /** Load a page of collisions (append=false resets paging). Entry: load btn, KPI badge, post-resolve. */
  loadCollisions(append = false): Promise<void> {
    return this._loadCollisionsPage(this._root, append);
  }

  /** Reset collision state + hide the section — called by the host when the audit reloads. */
  reset(): void {
    this._collGroups = [];
    this._collOffset = 0;
    const section = this._q<HTMLElement>("#align-coll-section");
    if (section) { section.style.display = "none"; }
    const result = this._q<HTMLElement>("#align-coll-result");
    if (result) { result.style.display = "none"; result.innerHTML = ""; }
  }

  private async _loadCollisionsPage(el: HTMLElement, append: boolean): Promise<void> {
    const conn = this._deps.getConn();
    if (!conn) return;
    const pivotId = parseInt(el.querySelector<HTMLSelectElement>("#align-pivot-sel")?.value ?? "");
    const targetId = parseInt(el.querySelector<HTMLSelectElement>("#align-target-sel")?.value ?? "");
    if (!pivotId || !targetId) {
      this._deps.toast("Chargez d'abord une paire dans l'éditeur bitext.", true);
      return;
    }
    if (!append) { this._collOffset = 0; this._collGroups = []; }
    try {
      const res = await listCollisions(conn, {
        pivot_doc_id: pivotId,
        target_doc_id: targetId,
        limit: this._collLimit,
        offset: this._collOffset,
      });
      this._collTotalCount = res.total_collisions;
      this._collGroups = append ? [...this._collGroups, ...res.collisions] : res.collisions;
      this._collHasMore = res.has_more;
      this._collOffset = res.next_offset;
      this._renderCollisionTable(el, targetId);
      this._deps.onCollisionCountChanged(this._collTotalCount);
      this._deps.log(`Collisions : ${this._collTotalCount} groupe(s) trouvé(s).`);
    } catch (err) {
      this._deps.log(`Erreur collisions : ${err instanceof SidecarError ? err.message : String(err)}`, true);
      this._deps.toast("✗ Erreur chargement collisions", true);
    }
  }

  private _renderCollisionTable(el: HTMLElement, targetDocId: number): void {
    const resultEl = el.querySelector<HTMLElement>("#align-coll-result");
    const moreWrap = el.querySelector<HTMLElement>("#align-coll-more-wrap");
    if (!resultEl) return;
    resultEl.style.display = "";
    if (this._collGroups.length === 0) {
      resultEl.innerHTML = `<p class="hint">✓ Aucune collision détectée.</p>`;
      if (moreWrap) moreWrap.style.display = "none";
      return;
    }
    const header = `<p style="margin-bottom:0.5rem;font-size:0.88rem;color:var(--text-muted)">
      ${this._collTotalCount} groupe(s) de collision — ${this._collGroups.length} affiché(s)</p>`;
    const groupHtml = this._collGroups.map((g) => {
      const linksHtml = g.links.map((lnk) => {
        const badge = lnk.status === "accepted"
          ? `<span class="prep-status-badge prep-status-ok">✅ Accepté</span>`
          : lnk.status === "rejected"
          ? `<span class="prep-status-badge prep-status-error">❌ Rejeté</span>`
          : `<span class="prep-status-badge prep-status-unknown">🔵 Non révisé</span>`;
        return `<tr>
          <td class="prep-audit-cell-text">${_esc(lnk.target_text ?? "")}</td>
          <td>[§${lnk.target_external_id ?? "?"}]</td>
          <td>${badge}</td>
          <td class="prep-audit-cell-actions">
            <button class="btn btn-sm btn-primary coll-keep-btn" data-link="${lnk.link_id}" data-group="${g.pivot_unit_id}" title="Garder">✓ Garder</button>
            <button class="btn btn-sm btn-secondary coll-reject-btn" data-link="${lnk.link_id}" title="Rejeter">❌ Rejeter</button>
            <button class="btn btn-sm btn-danger coll-delete-btn" data-link="${lnk.link_id}" data-group="${g.pivot_unit_id}" data-target="${targetDocId}" aria-label="Supprimer ce lien">🗑</button>
          </td>
        </tr>`;
      }).join("");
      return `<div class="collision-group" style="margin-bottom:1rem;border:1px solid var(--border);border-radius:6px;overflow:hidden">
        <div class="collision-pivot-header" style="background:var(--surface-alt,#f5f5f5);padding:0.4rem 0.75rem;font-size:0.85rem;font-weight:600">
          [§${_esc(String(g.pivot_external_id ?? "?"))}] ${_esc(g.pivot_text ?? "")}
          <button class="btn btn-sm btn-danger coll-delete-others-btn" data-group="${g.pivot_unit_id}" data-target="${targetDocId}"
            style="float:right;font-size:0.75rem" aria-label="Supprimer tous les liens de ce groupe">🗑 Tout supprimer</button>
        </div>
        <table class="prep-meta-table" style="margin:0;width:100%">
          <thead><tr><th>Texte cible</th><th>Ext. id</th><th>Statut</th><th>Actions</th></tr></thead>
          <tbody>${linksHtml}</tbody>
        </table>
      </div>`;
    }).join("");
    setHtml(resultEl, raw(header + groupHtml));
    if (moreWrap) moreWrap.style.display = this._collHasMore ? "" : "none";
    resultEl.querySelectorAll<HTMLButtonElement>(".coll-keep-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        void this._resolveCollision([{ action: "keep", link_id: parseInt(btn.dataset.link!) }], el);
      });
    });
    resultEl.querySelectorAll<HTMLButtonElement>(".coll-reject-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        void this._resolveCollision([{ action: "reject", link_id: parseInt(btn.dataset.link!) }], el);
      });
    });
    resultEl.querySelectorAll<HTMLButtonElement>(".coll-delete-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        void this._resolveCollision([{ action: "delete", link_id: parseInt(btn.dataset.link!) }], el);
      });
    });
    resultEl.querySelectorAll<HTMLButtonElement>(".coll-delete-others-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const pivotUid = parseInt(btn.dataset.group!);
        const targetDoc = parseInt(btn.dataset.target!);
        const group = this._collGroups.find(g => g.pivot_unit_id === pivotUid);
        if (!group) return;
        const actions = group.links.map(lnk => ({ action: "delete" as const, link_id: lnk.link_id }));
        void this._resolveCollision(actions, el);
      });
    });
  }

  private async _resolveCollision(
    actions: Array<{ action: "keep" | "delete" | "reject" | "unreviewed"; link_id: number }>,
    el: HTMLElement,
  ): Promise<void> {
    const conn = this._deps.getConn();
    if (!conn) return;
    try {
      const res = await resolveCollisions(conn, actions);
      if (res.errors.length > 0) {
        this._deps.toast(`⚠ ${res.errors.length} erreur(s)`, true);
      } else {
        this._deps.toast(`✓ Résolution appliquée (${res.applied} modif., ${res.deleted} suppr.)`);
      }
      this._collOffset = 0;
      this._collGroups = [];
      await this._loadCollisionsPage(el, false);
    } catch (err) {
      this._deps.log(`Erreur résolution collision : ${err instanceof SidecarError ? err.message : String(err)}`, true);
      this._deps.toast("✗ Erreur résolution collision", true);
    }
  }
}
