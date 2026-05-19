/**
 * RolesPane.ts — DOM orchestration of the "Rôles" tab of SegmentationView.
 *
 * Ported from the Shell module conventionsModule.ts. The pure logic
 * (catalogue partitioning, validation, unit search/filtering, badges,
 * counters) lives in lib/conventionsRoles.ts + lib/conventionsUnitList.ts and
 * is tested under lib/__tests__. This file holds only DOM + event wiring +
 * sidecar calls — no business rules.
 *
 * The pane reuses the document already selected in SegmentationView (no second
 * document selector): mount() / setDocument() are driven by the host view.
 */

import type { Conn, ConventionRole, UnitRecord } from "../lib/sidecarClient.ts";
import {
  listConventions,
  createConvention,
  updateConvention,
  deleteConvention,
  bulkSetUnitRole,
  setDocumentTextStart,
  listUnits,
} from "../lib/sidecarClient.ts";
import {
  STRUCTURE_DEFAULTS,
  splitRolesByCategory,
  dormantStructureSuggestions,
  safeColor,
  validateRoleForm,
  type StructureSuggestion,
} from "../lib/conventionsRoles.ts";
import {
  filterUnits,
  isParatext,
  resolveRoleBadge,
  summarizeUnits,
} from "../lib/conventionsUnitList.ts";
import { modalConfirm } from "../lib/modalConfirm.ts";

const COLOR_PRESETS = [
  "#3b82f6", "#6366f1", "#8b5cf6", "#a855f7",
  "#ec4899", "#ef4444", "#f97316", "#f59e0b",
  "#eab308", "#84cc16", "#22c55e", "#10b981",
  "#14b8a6", "#06b6d4", "#0ea5e9", "#64748b",
];

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export class RolesPane {
  private readonly _root: HTMLElement;
  private readonly _getConn: () => Conn | null;
  /** Report an error to the user (toast). Prep proscrit `alert()` natif. */
  private readonly _onError: (msg: string) => void;

  private _roles: ConventionRole[] = [];
  private _units: UnitRecord[] = [];
  private _docId: number | null = null;
  private _textStartN: number | null = null;
  private _selectedUnitIds = new Set<number>();
  private _searchQuery = "";
  private _catalogueOpen = false;
  private _lastClickedIdx = -1;
  private _loaded = false;

  constructor(root: HTMLElement, getConn: () => Conn | null, onError: (msg: string) => void) {
    this._root = root;
    this._getConn = getConn;
    this._onError = onError;
  }

  /** Build the static layout once. Idempotent. */
  mount(): void {
    if (this._root.querySelector(".prep-conv-root")) return;
    this._root.innerHTML = `
      <div class="prep-conv-root">
        <div class="prep-conv-catalogue" data-open="false" id="prep-conv-catalogue">
          <button type="button" class="prep-conv-catalogue-head" id="prep-conv-cat-toggle">
            <span class="prep-conv-catalogue-caret">&#9656;</span>
            <span>Catalogue des r&#244;les</span>
            <span class="prep-conv-catalogue-hint">cr&#233;er / modifier / supprimer</span>
          </button>
          <div class="prep-conv-catalogue-body">
            <div class="prep-conv-cat-cols">
              <div class="prep-conv-cat-col">
                <div class="prep-conv-section-header">
                  <span>Structure</span>
                  <span class="prep-conv-section-header-badge" id="prep-conv-struct-badge"></span>
                </div>
                <div id="prep-conv-struct-list"></div>
                <button class="prep-conv-add-btn" id="prep-conv-add-struct">+ Autre r&#244;le structure</button>
              </div>
              <div class="prep-conv-cat-col">
                <div class="prep-conv-section-header">
                  <span>Texte</span>
                  <span class="prep-conv-section-header-badge" id="prep-conv-text-badge"></span>
                </div>
                <div id="prep-conv-text-list"></div>
                <button class="prep-conv-add-btn" id="prep-conv-add-text">+ Nouveau r&#244;le texte</button>
              </div>
            </div>
          </div>
        </div>

        <div class="prep-conv-toolbar">
          <input type="search" class="prep-conv-search" id="prep-conv-search"
            placeholder="Rechercher des unit&#233;s candidates (ex. Chapter)&#8230;" autocomplete="off" />
          <span class="prep-conv-search-stats" id="prep-conv-search-stats"></span>
        </div>

        <div class="prep-conv-assign-hint" id="prep-conv-assign-hint"></div>
        <div class="prep-conv-units-area" id="prep-conv-units-area">
          <div class="prep-conv-empty">S&#233;lectionnez un document.</div>
        </div>
        <div class="prep-conv-action-bar" id="prep-conv-action-bar"></div>
      </div>
    `;

    this._q("#prep-conv-cat-toggle")?.addEventListener("click", () => {
      this._catalogueOpen = !this._catalogueOpen;
      const cat = this._q("#prep-conv-catalogue");
      if (cat) cat.dataset.open = String(this._catalogueOpen);
    });
    this._q("#prep-conv-add-struct")?.addEventListener("click", () => this._openRoleDialog(null, "structure"));
    this._q("#prep-conv-add-text")?.addEventListener("click", () => this._openRoleDialog(null, "text"));

    const searchEl = this._q<HTMLInputElement>("#prep-conv-search");
    searchEl?.addEventListener("input", () => {
      this._searchQuery = searchEl.value;
      // L'ancre du shift-clic indexe la liste *filtrée* — la recherche change
      // cette liste, donc l'ancre devient invalide : la réinitialiser.
      this._lastClickedIdx = -1;
      this._renderUnits();
    });
  }

  /**
   * Point the pane at a document (the one selected in SegmentationView).
   * Loads the role catalogue once, then the units of the given doc.
   */
  async setDocument(docId: number | null, textStartN: number | null): Promise<void> {
    this.mount();
    this._docId = docId;
    this._textStartN = textStartN;
    this._selectedUnitIds.clear();
    this._lastClickedIdx = -1;
    if (!this._loaded) await this._loadRoles();
    await this._loadUnits();
  }

  /** Refresh units (e.g. after segmentation changed them). */
  async refresh(): Promise<void> {
    await this._loadRoles();
    await this._loadUnits();
  }

  dispose(): void {
    this._roles = [];
    this._units = [];
    this._selectedUnitIds.clear();
    this._docId = null;
    this._loaded = false;
  }

  // ─── Loading ────────────────────────────────────────────────────────────

  private async _loadRoles(): Promise<void> {
    const conn = this._getConn();
    if (!conn) { this._roles = []; return; }
    try {
      this._roles = await listConventions(conn);
      this._loaded = true;
    } catch {
      this._roles = [];
    }
    this._renderCatalogue();
  }

  private async _loadUnits(): Promise<void> {
    const area = this._q("#prep-conv-units-area");
    const conn = this._getConn();
    if (this._docId === null || !conn) {
      this._units = [];
      this._renderUnits();
      this._renderActionBar();
      return;
    }
    if (area) area.innerHTML = `<div class="prep-conv-empty">Chargement&#8230;</div>`;
    try {
      this._units = await listUnits(conn, this._docId);
    } catch (e) {
      if (area) {
        area.innerHTML = `<div class="prep-conv-empty prep-conv-error">Erreur : ${esc(
          e instanceof Error ? e.message : String(e),
        )}</div>`;
      }
      this._units = [];
      return;
    }
    this._selectedUnitIds.clear();
    this._renderUnits();
    this._renderActionBar();
  }

  // ─── Catalogue rendering ────────────────────────────────────────────────

  private _renderCatalogue(): void {
    const { structure, text } = splitRolesByCategory(this._roles);
    const structListEl = this._q("#prep-conv-struct-list");
    const textListEl = this._q("#prep-conv-text-list");
    const structBadge = this._q("#prep-conv-struct-badge");
    const textBadge = this._q("#prep-conv-text-badge");

    if (structBadge) {
      structBadge.textContent = structure.length
        ? `${structure.length} actif${structure.length > 1 ? "s" : ""}`
        : "";
    }
    if (textBadge) {
      textBadge.textContent = text.length
        ? `${text.length} rôle${text.length > 1 ? "s" : ""}`
        : "";
    }

    if (structListEl) {
      const dormant = dormantStructureSuggestions(this._roles);
      let html = structure.map((r) => this._roleItemHtml(r, true)).join("");
      for (const s of dormant) {
        html += `
          <div class="prep-conv-role-item prep-conv-role-item--dormant">
            <span class="prep-conv-role-dot" style="background:${safeColor(s.color)}44;border-color:${safeColor(s.color)}66"></span>
            <span class="prep-conv-role-icon" style="opacity:0.4">${esc(s.icon)}</span>
            <span class="prep-conv-role-label">${esc(s.label)}</span>
            <button class="prep-conv-dormant-btn" data-dormant="${esc(s.name)}">Cr&#233;er</button>
          </div>`;
      }
      if (!html) {
        html = `<div class="prep-conv-empty" style="padding:0.6rem;font-size:0.78rem">Aucun r&#244;le structure.</div>`;
      }
      structListEl.innerHTML = html;
      this._wireRoleItems(structListEl, "structure");
      structListEl.querySelectorAll<HTMLElement>("[data-dormant]").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const def = STRUCTURE_DEFAULTS.find((s) => s.name === btn.dataset.dormant);
          if (def) void this._activateSuggestion(def);
        });
      });
    }

    if (textListEl) {
      textListEl.innerHTML = text.length
        ? text.map((r) => this._roleItemHtml(r, false)).join("")
        : `<div class="prep-conv-empty" style="padding:0.6rem;font-size:0.78rem">Aucun r&#244;le texte.</div>`;
      this._wireRoleItems(textListEl, "text");
    }
  }

  private _roleItemHtml(r: ConventionRole, structural: boolean): string {
    const deleteBtn = structural
      ? ""
      : `<button class="prep-conv-btn-icon danger" data-action="delete" title="Supprimer">&#128465;</button>`;
    return `
      <div class="prep-conv-role-item" data-role="${esc(r.name)}">
        <span class="prep-conv-role-dot" style="background:${safeColor(r.color)};border-color:${safeColor(r.color)}"></span>
        <span class="prep-conv-role-icon">${r.icon ? esc(r.icon) : ""}</span>
        <span class="prep-conv-role-label">${esc(r.label)}</span>
        <span class="prep-conv-role-name">${esc(r.name)}</span>
        <span class="prep-conv-role-actions">
          <button class="prep-conv-btn-icon" data-action="edit" title="Modifier">&#9998;</button>
          ${deleteBtn}
        </span>
      </div>`;
  }

  private _wireRoleItems(listEl: HTMLElement, category: "structure" | "text"): void {
    listEl.querySelectorAll<HTMLElement>(".prep-conv-role-item:not(.prep-conv-role-item--dormant)").forEach((el) => {
      const name = el.dataset.role!;
      el.addEventListener("click", (e) => {
        const action = (e.target as HTMLElement).closest("[data-action]")?.getAttribute("data-action");
        if (action === "edit") { e.stopPropagation(); this._openRoleDialog(name, category); return; }
        if (action === "delete") { e.stopPropagation(); void this._deleteRole(name); return; }
        // Body click = assign role to the current selection (assignable affordance).
        if (this._selectedUnitIds.size > 0) void this._assignRole(name);
      });
    });
  }

  // ─── Units rendering ────────────────────────────────────────────────────

  private get _filteredUnits(): UnitRecord[] {
    return filterUnits(this._units, this._searchQuery);
  }

  private _renderUnits(): void {
    const area = this._q("#prep-conv-units-area");
    const statsEl = this._q("#prep-conv-search-stats");
    if (!area) return;

    if (this._docId === null) {
      area.innerHTML = `<div class="prep-conv-empty">S&#233;lectionnez un document.</div>`;
      if (statsEl) statsEl.textContent = "";
      return;
    }

    const filtered = this._filteredUnits;
    const summary = summarizeUnits(this._units, filtered);
    if (statsEl) {
      statsEl.textContent = this._searchQuery.trim()
        ? `${summary.matched}/${summary.total} unités · ${summary.withRole} avec rôle`
        : `${summary.total} unités · ${summary.withRole} avec rôle`;
    }

    if (this._units.length === 0) {
      area.innerHTML = `<div class="prep-conv-empty">Aucune unit&#233; dans ce document.</div>`;
      return;
    }
    if (filtered.length === 0) {
      area.innerHTML = `<div class="prep-conv-empty">Aucune unit&#233; ne correspond &#224; la recherche.</div>`;
      return;
    }

    area.innerHTML = filtered
      .map((u) => {
        const badge = resolveRoleBadge(u.unit_role, this._roles);
        const selected = this._selectedUnitIds.has(u.unit_id);
        const para = isParatext(u.n, this._textStartN);
        const badgeHtml = badge
          ? `<span class="prep-conv-unit-badge" style="background:${safeColor(badge.color, "#374151")}22;border-color:${safeColor(badge.color, "#374151")};color:${safeColor(badge.color, "#94a3b8")}">${badge.icon ? esc(badge.icon) + " " : ""}${esc(badge.label)}</span>`
          : "";
        return `
          <div class="prep-conv-unit-row${selected ? " selected" : ""}${para ? " paratext" : ""}" data-uid="${u.unit_id}">
            <span class="prep-conv-unit-n">${u.n}</span>
            <span class="prep-conv-unit-text">${esc(u.text_norm ?? "")}</span>
            ${badgeHtml}
          </div>`;
      })
      .join("");

    area.querySelectorAll<HTMLElement>(".prep-conv-unit-row").forEach((el, idx) => {
      el.addEventListener("click", (e) => {
        const uid = parseInt(el.dataset.uid!, 10);
        if ((e as MouseEvent).shiftKey && this._lastClickedIdx >= 0) {
          const lo = Math.min(this._lastClickedIdx, idx);
          const hi = Math.max(this._lastClickedIdx, idx);
          for (let i = lo; i <= hi; i++) this._selectedUnitIds.add(filtered[i].unit_id);
        } else {
          if (this._selectedUnitIds.has(uid)) this._selectedUnitIds.delete(uid);
          else this._selectedUnitIds.add(uid);
          this._lastClickedIdx = idx;
        }
        this._renderUnits();
        this._renderActionBar();
      });
    });
  }

  // ─── Action bar ─────────────────────────────────────────────────────────

  private _renderActionBar(): void {
    const bar = this._q("#prep-conv-action-bar");
    const hint = this._q("#prep-conv-assign-hint");
    if (!bar) return;
    const count = this._selectedUnitIds.size;

    // Mark role items as assignable when units are selected.
    this._root.querySelectorAll<HTMLElement>(".prep-conv-role-item:not(.prep-conv-role-item--dormant)").forEach((el) => {
      el.classList.toggle("prep-conv-role-item--assignable", count > 0);
    });

    if (count === 0) {
      bar.classList.remove("visible");
      bar.innerHTML = "";
      if (hint) hint.classList.remove("visible");
      return;
    }

    if (hint) {
      hint.classList.add("visible");
      hint.textContent = `${count} unité${count > 1 ? "s" : ""} sélectionnée${count > 1 ? "s" : ""} — ouvrir le catalogue et cliquer un rôle pour assigner`;
    }

    const textStartBtn = count === 1
      ? `<button class="prep-conv-text-start-btn" id="prep-conv-set-ts" title="D&#233;finir comme d&#233;but du texte (apr&#232;s le paratexte)">&#9873; Borne texte</button>`
      : "";
    bar.classList.add("visible");
    bar.innerHTML = `
      <span class="prep-conv-action-count">${count} unité${count > 1 ? "s" : ""}</span>
      <button class="prep-conv-role-pill remove" id="prep-conv-clear-role">&#10005; Retirer r&#244;le</button>
      <button class="prep-conv-role-pill" id="prep-conv-deselect">&#10005; D&#233;s&#233;lectionner</button>
      ${textStartBtn}
    `;
    bar.querySelector("#prep-conv-clear-role")?.addEventListener("click", () => void this._assignRole(null));
    bar.querySelector("#prep-conv-deselect")?.addEventListener("click", () => {
      this._selectedUnitIds.clear();
      this._renderUnits();
      this._renderActionBar();
    });
    bar.querySelector("#prep-conv-set-ts")?.addEventListener("click", () => void this._setTextStart());
  }

  // ─── Mutations ──────────────────────────────────────────────────────────

  private async _assignRole(roleName: string | null): Promise<void> {
    const conn = this._getConn();
    if (!conn || this._selectedUnitIds.size === 0) return;
    const ids = [...this._selectedUnitIds];
    try {
      await bulkSetUnitRole(conn, ids, roleName);
      for (const u of this._units) {
        if (this._selectedUnitIds.has(u.unit_id)) u.unit_role = roleName;
      }
      this._selectedUnitIds.clear();
      this._renderUnits();
      this._renderActionBar();
    } catch (e) {
      this._onError(e instanceof Error ? e.message : String(e));
    }
  }

  private async _setTextStart(): Promise<void> {
    const conn = this._getConn();
    if (!conn || this._docId === null) return;
    const uid = [...this._selectedUnitIds][0];
    const unit = this._units.find((u) => u.unit_id === uid);
    if (!unit) return;
    try {
      await setDocumentTextStart(conn, this._docId, unit.n);
      this._textStartN = unit.n;
      this._renderUnits();
    } catch (e) {
      this._onError(e instanceof Error ? e.message : String(e));
    }
  }

  private async _activateSuggestion(def: StructureSuggestion): Promise<void> {
    const conn = this._getConn();
    if (!conn) return;
    try {
      await createConvention(conn, { ...def, category: "structure" });
      await this._loadRoles();
    } catch (e) {
      this._onError(e instanceof Error ? e.message : String(e));
    }
  }

  private async _deleteRole(name: string): Promise<void> {
    const conn = this._getConn();
    if (!conn) return;
    // modalConfirm — prep proscrit window.confirm() (peu fiable dans Tauri,
    // issue #40 : l'action peut s'exécuter même après « Annuler »).
    const ok = await modalConfirm({
      message: `Supprimer le rôle « ${name} » ? Les unités assignées seront réinitialisées.`,
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteConvention(conn, name);
      await this._loadRoles();
      await this._loadUnits();
    } catch (e) {
      this._onError(e instanceof Error ? e.message : String(e));
    }
  }

  // ─── Role dialog (catalogue CRUD) ───────────────────────────────────────

  private _openRoleDialog(editName: string | null, forceCategory: "structure" | "text"): void {
    const existing = editName ? this._roles.find((r) => r.name === editName) ?? null : null;
    const isEdit = existing !== null;
    const initColor = existing?.color ?? "";
    const category = existing?.category ?? forceCategory;
    const pickerVal = /^#[0-9a-fA-F]{6}$/.test(initColor) ? initColor : "#3b82f6";
    const sectionLabel = category === "structure" ? "Structure" : "Texte";
    const presetsHtml = COLOR_PRESETS.map(
      (c) => `<button type="button" class="prep-conv-color-preset" data-color="${c}" style="background:${c}" title="${c}"></button>`,
    ).join("");

    const overlay = document.createElement("div");
    overlay.className = "prep-conv-overlay";
    overlay.innerHTML = `
      <div class="prep-conv-dialog">
        <h3>${isEdit ? "Modifier le rôle" : `Nouveau rôle — ${sectionLabel}`}</h3>
        <div class="prep-conv-field">
          <label>Identifiant (slug, immuable)</label>
          <input id="prep-conv-f-name" type="text" value="${esc(existing?.name ?? "")}" placeholder="ex: titre" ${isEdit ? "readonly" : ""} />
        </div>
        <div class="prep-conv-field">
          <label>Libell&#233; affich&#233;</label>
          <input id="prep-conv-f-label" type="text" value="${esc(existing?.label ?? "")}" placeholder="ex: Titre" />
        </div>
        <div class="prep-conv-field">
          <label>Couleur</label>
          <div class="prep-conv-color-row">
            <div class="prep-conv-color-presets">${presetsHtml}</div>
            <div class="prep-conv-color-custom">
              <button type="button" class="prep-conv-color-picker-btn" title="Ouvrir le sélecteur de couleur">
                <div class="prep-conv-color-swatch-preview" id="prep-conv-swatch" style="background:${esc(initColor || pickerVal)}"></div>
                <input type="color" id="prep-conv-f-color-picker" value="${esc(pickerVal)}" tabindex="-1" />
              </button>
              <input class="prep-conv-color-hex" id="prep-conv-f-color" type="text" value="${esc(initColor)}" placeholder="#3b82f6" maxlength="7" spellcheck="false" />
            </div>
          </div>
        </div>
        <div class="prep-conv-field">
          <label>Ic&#244;ne (emoji ou texte court)</label>
          <input id="prep-conv-f-icon" type="text" value="${esc(existing?.icon ?? "")}" placeholder="&#128204;" />
        </div>
        <div class="prep-conv-field">
          <label>Ordre de tri</label>
          <input id="prep-conv-f-sort" type="number" value="${existing?.sort_order ?? 0}" />
        </div>
        <div class="prep-conv-error" id="prep-conv-dialog-err"></div>
        <div class="prep-conv-dialog-actions">
          <button class="prep-conv-dialog-btn secondary" id="prep-conv-dlg-cancel">Annuler</button>
          <button class="prep-conv-dialog-btn primary" id="prep-conv-dlg-save">Enregistrer</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const hexInput = overlay.querySelector<HTMLInputElement>("#prep-conv-f-color")!;
    const colorPicker = overlay.querySelector<HTMLInputElement>("#prep-conv-f-color-picker")!;
    const swatch = overlay.querySelector<HTMLElement>("#prep-conv-swatch")!;
    const errEl = overlay.querySelector<HTMLElement>("#prep-conv-dialog-err")!;

    const applyColor = (hex: string, source: "preset" | "picker" | "text"): void => {
      const valid = /^#[0-9a-fA-F]{6}$/.test(hex);
      if (source !== "text") hexInput.value = hex;
      if (source !== "picker" && valid) colorPicker.value = hex;
      swatch.style.background = valid ? hex : "#e9ecef";
      overlay.querySelectorAll<HTMLElement>(".prep-conv-color-preset").forEach((b) => {
        b.classList.toggle("selected", b.dataset.color === hex);
      });
    };
    if (initColor) applyColor(initColor, "text");

    overlay.querySelectorAll<HTMLButtonElement>(".prep-conv-color-preset").forEach((btn) => {
      btn.addEventListener("click", () => applyColor(btn.dataset.color!, "preset"));
    });
    colorPicker.addEventListener("input", () => applyColor(colorPicker.value, "picker"));
    hexInput.addEventListener("input", () => {
      let v = hexInput.value.trim();
      if (v && !v.startsWith("#")) v = "#" + v;
      applyColor(v, "text");
    });

    overlay.querySelector("#prep-conv-dlg-cancel")!.addEventListener("click", () => overlay.remove());
    overlay.querySelector("#prep-conv-dlg-save")!.addEventListener("click", async () => {
      const name = overlay.querySelector<HTMLInputElement>("#prep-conv-f-name")!.value.trim();
      const label = overlay.querySelector<HTMLInputElement>("#prep-conv-f-label")!.value.trim();
      const color = hexInput.value.trim() || null;
      const icon = overlay.querySelector<HTMLInputElement>("#prep-conv-f-icon")!.value.trim() || null;
      const sort_order = parseInt(overlay.querySelector<HTMLInputElement>("#prep-conv-f-sort")!.value, 10) || 0;

      const v = validateRoleForm({ name, label, color });
      if (!v.ok) { errEl.textContent = v.error ?? "Formulaire invalide."; return; }
      errEl.textContent = "";

      const conn = this._getConn();
      if (!conn) { errEl.textContent = "Non connecté."; return; }
      try {
        if (isEdit) {
          await updateConvention(conn, name, { label, color, icon, sort_order, category });
        } else {
          await createConvention(conn, { name, label, color, icon, sort_order, category });
        }
        overlay.remove();
        await this._loadRoles();
        this._renderUnits();
      } catch (e) {
        errEl.textContent = e instanceof Error ? e.message : String(e);
      }
    });
  }

  // ─── Utility ────────────────────────────────────────────────────────────

  private _q<T extends HTMLElement>(sel: string): T | null {
    return this._root.querySelector<T>(sel);
  }
}
