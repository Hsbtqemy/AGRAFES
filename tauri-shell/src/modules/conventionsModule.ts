/**
 * conventionsModule.ts — Gestion des conventions (rôles d'unités).
 *
 * Colonne gauche — deux sections :
 *   Structure : rôles structurels (Titre, Intertitre, Dédicace…) — suggestions dormantes + rôles actifs
 *   Texte     : rôles de contenu (vers, dialogue, citation…)     — CRUD complet
 *
 * Colonne droite : navigation document → unités → assignation de rôle.
 */

import type { ShellContext } from "../context.ts";
import {
  type Conn,
  type UnitRole,
  ensureRunning,
  listConventions,
  createConvention,
  updateConvention,
  deleteConvention,
  bulkSetUnitRole,
  setDocumentTextStart,
} from "../../../tauri-app/src/lib/sidecarClient.ts";

// ─── Structure defaults (dormant suggestions) ─────────────────────────────────

interface StructureSuggestion {
  name: string;
  label: string;
  color: string;
  icon: string;
  sort_order: number;
}

const STRUCTURE_DEFAULTS: StructureSuggestion[] = [
  { name: "titre",     label: "Titre",     color: "#1e40af", icon: "◈",  sort_order: 0 },
  { name: "intertitre",label: "Intertitre",color: "#9333ea", icon: "§",  sort_order: 1 },
  { name: "dedicace",  label: "Dédicace",  color: "#be185d", icon: "✦",  sort_order: 2 },
  { name: "epigraphe", label: "Épigraphe", color: "#0369a1", icon: "❝",  sort_order: 3 },
  { name: "incipit",   label: "Incipit",   color: "#047857", icon: "↳",  sort_order: 4 },
  { name: "colophon",  label: "Colophon",  color: "#92400e", icon: "⌛", sort_order: 5 },
  { name: "preface",   label: "Préface",   color: "#374151", icon: "»",  sort_order: 6 },
  { name: "note",      label: "Note",      color: "#b45309", icon: "†",  sort_order: 7 },
];

// ─── CSS ──────────────────────────────────────────────────────────────────────

const CSS = `
.conv-root {
  display: flex;
  height: 100%;
  overflow: hidden;
  font-size: 0.88rem;
  font-family: system-ui, sans-serif;
  background: #f8f9fa;
  color: #212529;
}

/* ── Panneau gauche ── */
.conv-left {
  width: 280px;
  min-width: 220px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid #dee2e0;
  background: #f3f8f7;
  overflow-y: auto;
}

/* Section headers */
.conv-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.6rem 1rem 0.35rem;
  font-weight: 700;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: #6c757d;
  position: sticky;
  top: 0;
  background: #f3f8f7;
  z-index: 1;
}
.conv-section-header--texte {
  border-top: 1px solid #dee2e0;
  margin-top: 0.25rem;
}
.conv-section-header-badge {
  font-size: 0.68rem;
  font-weight: 500;
  color: #adb5bd;
  text-transform: none;
  letter-spacing: 0;
}

/* Role items */
.conv-role-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 1rem;
  cursor: pointer;
  transition: background 0.12s;
  border-left: 3px solid transparent;
}
.conv-role-item:hover { background: rgba(0,0,0,0.04); }
.conv-role-item.active {
  background: #e8f5f3;
  border-left-color: #0c4a46;
}
.conv-role-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  border: 1px solid rgba(0,0,0,0.15);
}
.conv-role-icon { font-size: 0.95rem; width: 18px; text-align: center; }
.conv-role-label { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.conv-role-name { color: #adb5bd; font-size: 0.72rem; font-family: monospace; }
.conv-role-actions { display: none; gap: 0.2rem; }
.conv-role-item:hover .conv-role-actions,
.conv-role-item.active .conv-role-actions { display: flex; }
.conv-btn-icon {
  background: none;
  border: none;
  color: #6c757d;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 3px;
  font-size: 0.75rem;
  line-height: 1;
}
.conv-btn-icon:hover { background: rgba(0,0,0,0.08); color: #212529; }
.conv-btn-icon.danger:hover { background: rgba(220,53,69,0.1); color: #dc3545; }

/* Assign hint (shown when units are selected) */
.conv-assign-hint {
  height: 2.75rem;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  padding: 0 1rem;
  background: #e8f5f3;
  border-bottom: 1px solid #b6e0da;
  font-size: 0.8rem;
  color: #0c4a46;
  font-weight: 500;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* Assignable state — role items pulse with a "click to assign" affordance */
.conv-role-item--assignable {
  cursor: pointer;
}
.conv-role-item--assignable:hover {
  background: #e8f5f3 !important;
  border-left-color: #0c4a46 !important;
}
.conv-role-item--assignable:hover::after {
  content: "← assigner";
  font-size: 0.68rem;
  color: #0c4a46;
  margin-left: auto;
  opacity: 0.7;
  font-style: italic;
}

/* Dormant suggestion rows */
.conv-role-item--dormant {
  opacity: 0.45;
  cursor: default;
}
.conv-role-item--dormant:hover { background: none; opacity: 0.6; }
.conv-dormant-btn {
  font-size: 0.7rem;
  padding: 1px 7px;
  border-radius: 10px;
  border: 1px dashed #9ca3af;
  background: transparent;
  color: #6c757d;
  cursor: pointer;
  white-space: nowrap;
}
.conv-dormant-btn:hover { background: #e8f5f3; border-color: #0c4a46; color: #0c4a46; }

/* Add buttons */
.conv-add-btn {
  margin: 0.4rem 0.75rem;
  padding: 0.38rem 0.65rem;
  background: #e8f5f3;
  border: 1px dashed #0c4a46;
  border-radius: 6px;
  color: #0c4a46;
  cursor: pointer;
  font-size: 0.78rem;
  text-align: center;
  transition: background 0.12s;
}
.conv-add-btn:hover { background: #d5eeeb; }

/* ── Panneau droit : unités ── */
.conv-right {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.conv-right-toolbar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.6rem 1rem;
  border-bottom: 1px solid #dee2e0;
  flex-shrink: 0;
  flex-wrap: wrap;
  background: #fff;
}
.conv-doc-select {
  background: #fff;
  border: 1px solid #ced4da;
  border-radius: 5px;
  color: #212529;
  padding: 0.3rem 0.5rem;
  font-size: 0.82rem;
  flex: 1;
  min-width: 200px;
  max-width: 380px;
}
.conv-right-hint {
  color: #6c757d;
  font-size: 0.8rem;
  flex: 1;
  text-align: right;
}
.conv-units-area {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem 1rem;
  background: #fff;
}
.conv-unit-row {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.35rem 0.5rem;
  border-radius: 5px;
  cursor: pointer;
  transition: background 0.1s;
  border-left: 3px solid transparent;
}
.conv-unit-row:hover { background: #f3f8f7; }
.conv-unit-row.selected { background: #e8f5f3; border-left-color: #0c4a46; }
.conv-unit-row.paratext { opacity: 0.55; }
.conv-unit-n {
  color: #adb5bd;
  font-size: 0.75rem;
  font-family: monospace;
  min-width: 32px;
  text-align: right;
  padding-top: 2px;
  flex-shrink: 0;
}
.conv-unit-text {
  flex: 1;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}
.conv-unit-badge {
  flex-shrink: 0;
  font-size: 0.72rem;
  padding: 1px 6px;
  border-radius: 10px;
  border: 1px solid transparent;
  margin-top: 2px;
}

/* ── Barre d'action en bas ── */
.conv-action-bar {
  display: none;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 1rem;
  border-top: 1px solid #dee2e0;
  background: #f3f8f7;
  flex-shrink: 0;
  flex-wrap: wrap;
}
.conv-action-bar.visible { display: flex; }
.conv-action-count { color: #6c757d; font-size: 0.82rem; }
.conv-role-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.25rem 0.65rem;
  border-radius: 12px;
  border: 1px solid #ced4da;
  background: #fff;
  cursor: pointer;
  font-size: 0.78rem;
  transition: background 0.12s;
  color: #212529;
}
.conv-role-pill:hover { background: #e9ecef; }
.conv-role-pill.remove {
  background: #fff5f5;
  border-color: #f5c2c7;
  color: #dc3545;
}
.conv-role-pill.remove:hover { background: #f8d7da; }
.conv-text-start-btn {
  margin-left: auto;
  padding: 0.25rem 0.65rem;
  background: #f3f0ff;
  border: 1px solid #d0bfff;
  border-radius: 5px;
  color: #6f42c1;
  cursor: pointer;
  font-size: 0.78rem;
}
.conv-text-start-btn:hover { background: #e9e3ff; }

/* ── Dialog modal ── */
.conv-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.4);
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
}
.conv-dialog {
  background: #fff;
  border: 1px solid #dee2e6;
  border-radius: 10px;
  padding: 1.5rem;
  width: 380px;
  max-width: 95vw;
  box-shadow: 0 8px 32px rgba(0,0,0,0.15);
}
.conv-dialog h3 { margin: 0 0 1rem; font-size: 1rem; color: #212529; }
.conv-field { margin-bottom: 0.85rem; }
.conv-field label { display: block; margin-bottom: 0.3rem; color: #6c757d; font-size: 0.78rem; }
.conv-field input[type="text"],
.conv-field input[type="number"] {
  width: 100%;
  box-sizing: border-box;
  background: #fff;
  border: 1px solid #ced4da;
  border-radius: 5px;
  color: #212529;
  padding: 0.4rem 0.6rem;
  font-size: 0.85rem;
}
.conv-field input[type="text"]:focus,
.conv-field input[type="number"]:focus { outline: 2px solid #0c4a46; border-color: transparent; }
.conv-color-row {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.conv-color-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.conv-color-preset {
  width: 22px;
  height: 22px;
  border-radius: 4px;
  border: 2px solid transparent;
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
  transition: transform 0.1s, border-color 0.1s;
}
.conv-color-preset:hover { transform: scale(1.15); }
.conv-color-preset.selected { border-color: #0c4a46; box-shadow: 0 0 0 1px #fff inset; }
.conv-color-custom {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.conv-color-picker-btn {
  width: 34px;
  height: 34px;
  border-radius: 6px;
  border: 2px solid #dee2e6;
  cursor: pointer;
  padding: 2px;
  flex-shrink: 0;
  background: none;
  overflow: hidden;
  position: relative;
}
.conv-color-picker-btn input[type="color"] {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
  border: none;
  padding: 0;
}
.conv-color-swatch-preview {
  width: 100%;
  height: 100%;
  border-radius: 4px;
  pointer-events: none;
}
.conv-color-hex {
  flex: 1;
  box-sizing: border-box;
  background: #fff;
  border: 1px solid #ced4da;
  border-radius: 5px;
  color: #212529;
  padding: 0.4rem 0.6rem;
  font-size: 0.85rem;
  font-family: monospace;
}
.conv-color-hex:focus { outline: 2px solid #0c4a46; border-color: transparent; }
.conv-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1.25rem;
}
.conv-dialog-btn {
  padding: 0.4rem 1rem;
  border-radius: 5px;
  border: none;
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 500;
}
.conv-dialog-btn.primary { background: #0c4a46; color: #fff; }
.conv-dialog-btn.primary:hover { background: #0a3d3a; }
.conv-dialog-btn.secondary { background: #e9ecef; color: #212529; }
.conv-dialog-btn.secondary:hover { background: #dee2e6; }

/* ── États vides / erreur ── */
.prep-conv-empty {
  padding: 2rem 1rem;
  text-align: center;
  color: #6c757d;
  font-size: 0.85rem;
  line-height: 1.6;
}
.conv-error {
  color: #dc3545;
  font-size: 0.8rem;
  margin-top: 0.5rem;
}
`;

// ─── State ────────────────────────────────────────────────────────────────────

let _conn: Conn | null = null;
let _roles: UnitRole[] = [];
let _activeRoleName: string | null = null;
let _docs: { doc_id: number; title: string | null; language: string | null; text_start_n: number | null }[] = [];
let _units: { unit_id: number; n: number; text_norm: string | null; unit_role: string | null; unit_type: string }[] = [];
let _selectedDocId: number | null = null;
let _selectedUnitIds = new Set<number>();
let _textStartN: number | null = null;
let _unsubDbChange: (() => void) | null = null;

// DOM refs
let _root: HTMLElement | null = null;
let _structListEl: HTMLElement | null = null;
let _textListEl: HTMLElement | null = null;
let _unitsAreaEl: HTMLElement | null = null;
let _actionBarEl: HTMLElement | null = null;
let _docSelectEl: HTMLSelectElement | null = null;
let _rightHintEl: HTMLElement | null = null;

// ─── Public API ───────────────────────────────────────────────────────────────

export function getSelectedDocId(): number | null {
  return _selectedDocId;
}

export async function mount(container: HTMLElement, ctx: ShellContext): Promise<void> {
  _injectCss();
  container.innerHTML = "";

  const dbPath = ctx.getDbPath();
  if (!dbPath) {
    container.innerHTML = `<div class="prep-conv-empty">Aucune base de données sélectionnée.</div>`;
    return;
  }

  _conn = await ensureRunning(dbPath);
  _buildLayout(container);
  await _loadRoles();
  await _loadDocs();

  _unsubDbChange = ctx.onDbChange(async (newPath) => {
    if (newPath && _root) {
      _conn = await ensureRunning(newPath);
      _selectedDocId = null;
      _selectedUnitIds.clear();
      _units = [];
      await _loadRoles();
      await _loadDocs();
    }
  });
}

export function dispose(): void {
  if (_unsubDbChange) { _unsubDbChange(); _unsubDbChange = null; }
  _conn = null;
  _roles = [];
  _docs = [];
  _units = [];
  _selectedDocId = null;
  _selectedUnitIds.clear();
  _root = null;
  _structListEl = null;
  _textListEl = null;
  _unitsAreaEl = null;
  _actionBarEl = null;
  _docSelectEl = null;
  _rightHintEl = null;
}

// ─── Layout ───────────────────────────────────────────────────────────────────

function _buildLayout(container: HTMLElement): void {
  container.innerHTML = `
    <div class="conv-root">
      <div class="conv-left">
        <div class="conv-assign-hint" id="conv-assign-hint">&nbsp;</div>
        <div class="conv-section-header">
          <span>Structure</span>
          <span class="conv-section-header-badge" id="conv-struct-badge"></span>
        </div>
        <div class="conv-role-list" id="conv-struct-list"></div>
        <button class="conv-add-btn" id="conv-add-struct">+ Autre rôle structure</button>

        <div class="conv-section-header conv-section-header--texte">
          <span>Texte</span>
          <span class="conv-section-header-badge" id="conv-text-badge"></span>
        </div>
        <div class="conv-role-list" id="conv-text-list"></div>
        <button class="conv-add-btn" id="conv-add-text">+ Nouveau rôle texte</button>
      </div>
      <div class="conv-right">
        <div class="conv-right-toolbar">
          <select class="conv-doc-select"><option value="">— Choisir un document —</option></select>
          <span class="conv-right-hint"></span>
        </div>
        <div class="conv-units-area"><div class="prep-conv-empty">Sélectionnez un document.</div></div>
        <div class="conv-action-bar"></div>
      </div>
    </div>
  `;

  _root = container.querySelector(".conv-root");
  _structListEl = container.querySelector("#conv-struct-list");
  _textListEl = container.querySelector("#conv-text-list");
  _unitsAreaEl = container.querySelector(".conv-units-area");
  _actionBarEl = container.querySelector(".conv-action-bar");
  _docSelectEl = container.querySelector(".conv-doc-select");
  _rightHintEl = container.querySelector(".conv-right-hint");

  container.querySelector("#conv-add-struct")!.addEventListener("click", () => _openRoleDialog(null, "structure"));
  container.querySelector("#conv-add-text")!.addEventListener("click", () => _openRoleDialog(null, "text"));

  _docSelectEl!.addEventListener("change", () => {
    const val = _docSelectEl!.value;
    _selectedDocId = val ? parseInt(val) : null;
    _selectedUnitIds.clear();
    void _loadUnits();
  });
}

// ─── Roles rendering ──────────────────────────────────────────────────────────

async function _loadRoles(): Promise<void> {
  if (!_conn || !_structListEl) return;
  try {
    _roles = await listConventions(_conn);
  } catch {
    _roles = [];
  }
  _renderRoles();
}

function _renderRoles(): void {
  _renderStructureList();
  _renderTextList();
}

function _renderStructureList(): void {
  if (!_structListEl) return;

  const activeStructure = _roles.filter(r => (r.category ?? "text") === "structure");
  const activeNames = new Set(activeStructure.map(r => r.name));
  const dormant = STRUCTURE_DEFAULTS.filter(s => !activeNames.has(s.name));

  const badgeEl = document.getElementById("conv-struct-badge");
  if (badgeEl) badgeEl.textContent = activeStructure.length ? `${activeStructure.length} actif${activeStructure.length > 1 ? "s" : ""}` : "";

  let html = "";

  // Active structure roles
  for (const r of activeStructure) {
    const isActive = _activeRoleName === r.name;
    html += `
      <div class="conv-role-item${isActive ? " active" : ""}" data-role="${_esc(r.name)}">
        <span class="conv-role-dot" style="background:${_safeColor(r.color)};border-color:${_safeColor(r.color)}"></span>
        <span class="conv-role-icon">${r.icon ?? ""}</span>
        <span class="conv-role-label">${_esc(r.label)}</span>
        <span class="conv-role-name">${_esc(r.name)}</span>
        <span class="conv-role-actions">
          <button class="conv-btn-icon" data-action="edit" title="Modifier">✏️</button>
        </span>
      </div>`;
  }

  // Dormant suggestions
  for (const s of dormant) {
    html += `
      <div class="conv-role-item conv-role-item--dormant">
        <span class="conv-role-dot" style="background:${_safeColor(s.color)}44;border-color:${_safeColor(s.color)}66"></span>
        <span class="conv-role-icon" style="opacity:0.4">${s.icon}</span>
        <span class="conv-role-label">${_esc(s.label)}</span>
        <button class="conv-dormant-btn" data-dormant="${_esc(s.name)}">Créer</button>
      </div>`;
  }

  if (!html) {
    html = `<div class="prep-conv-empty" style="padding:0.75rem 1rem;font-size:0.78rem">Aucun rôle structure.</div>`;
  }

  _structListEl.innerHTML = html;

  // Listeners — active roles
  _structListEl.querySelectorAll<HTMLElement>(".conv-role-item:not(.conv-role-item--dormant)").forEach(el => {
    const name = el.dataset.role!;
    el.addEventListener("click", (e) => {
      const action = (e.target as HTMLElement).closest("[data-action]")?.getAttribute("data-action");
      if (action === "edit") { e.stopPropagation(); _openRoleDialog(name, "structure"); return; }
      if (_selectedUnitIds.size > 0) { void _assignRole(name); return; }
      _activeRoleName = _activeRoleName === name ? null : name;
      _renderRoles();
      _renderActionBar();
    });
  });

  // Listeners — dormant suggestions
  _structListEl.querySelectorAll<HTMLElement>("[data-dormant]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const name = (btn as HTMLElement).dataset.dormant!;
      const def = STRUCTURE_DEFAULTS.find(s => s.name === name);
      if (!def) return;
      void _activateSuggestion(def);
    });
  });
}

function _renderTextList(): void {
  if (!_textListEl) return;

  const textRoles = _roles.filter(r => (r.category ?? "text") === "text");

  const badgeEl = document.getElementById("conv-text-badge");
  if (badgeEl) badgeEl.textContent = textRoles.length ? `${textRoles.length} rôle${textRoles.length > 1 ? "s" : ""}` : "";

  if (textRoles.length === 0) {
    _textListEl.innerHTML = `<div class="prep-conv-empty" style="padding:0.75rem 1rem;font-size:0.78rem">Aucun rôle texte.</div>`;
    return;
  }

  _textListEl.innerHTML = textRoles.map(r => `
    <div class="conv-role-item${_activeRoleName === r.name ? " active" : ""}" data-role="${_esc(r.name)}">
      <span class="conv-role-dot" style="background:${_safeColor(r.color)};border-color:${_safeColor(r.color)}"></span>
      <span class="conv-role-icon">${r.icon ?? ""}</span>
      <span class="conv-role-label">${_esc(r.label)}</span>
      <span class="conv-role-name">${_esc(r.name)}</span>
      <span class="conv-role-actions">
        <button class="conv-btn-icon" data-action="edit" title="Modifier">✏️</button>
        <button class="conv-btn-icon danger" data-action="delete" title="Supprimer">🗑</button>
      </span>
    </div>
  `).join("");

  _textListEl.querySelectorAll<HTMLElement>(".conv-role-item").forEach(el => {
    const name = el.dataset.role!;
    el.addEventListener("click", (e) => {
      const action = (e.target as HTMLElement).closest("[data-action]")?.getAttribute("data-action");
      if (action === "edit") { e.stopPropagation(); _openRoleDialog(name, "text"); return; }
      if (action === "delete") { e.stopPropagation(); void _deleteRole(name); return; }
      if (_selectedUnitIds.size > 0) { void _assignRole(name); return; }
      _activeRoleName = _activeRoleName === name ? null : name;
      _renderRoles();
      _renderActionBar();
    });
  });
}

async function _activateSuggestion(def: StructureSuggestion): Promise<void> {
  if (!_conn) return;
  try {
    await createConvention(_conn, { ...def, category: "structure" });
    await _loadRoles();
  } catch (e) {
    alert(e instanceof Error ? e.message : String(e));
  }
}

// ─── Role dialog ──────────────────────────────────────────────────────────────

const COLOR_PRESETS = [
  "#3b82f6", "#6366f1", "#8b5cf6", "#a855f7",
  "#ec4899", "#ef4444", "#f97316", "#f59e0b",
  "#eab308", "#84cc16", "#22c55e", "#10b981",
  "#14b8a6", "#06b6d4", "#0ea5e9", "#64748b",
];

function _openRoleDialog(editName: string | null, forceCategory: "structure" | "text"): void {
  const existing = editName ? _roles.find(r => r.name === editName) ?? null : null;
  const isEdit = existing !== null;
  const initColor = existing?.color ?? "";
  const category = existing?.category ?? forceCategory;

  const presetsHtml = COLOR_PRESETS.map(c =>
    `<button type="button" class="conv-color-preset" data-color="${c}" style="background:${c}" title="${c}"></button>`
  ).join("");

  const pickerVal = /^#[0-9a-fA-F]{6}$/.test(initColor) ? initColor : "#3b82f6";
  const sectionLabel = category === "structure" ? "Structure" : "Texte";

  const overlay = document.createElement("div");
  overlay.className = "conv-overlay";
  overlay.innerHTML = `
    <div class="conv-dialog">
      <h3>${isEdit ? "Modifier le rôle" : `Nouveau rôle — ${sectionLabel}`}</h3>
      <div class="conv-field">
        <label>Identifiant (slug, immuable)</label>
        <input id="conv-f-name" type="text" value="${_esc(existing?.name ?? "")}" placeholder="ex: titre" ${isEdit ? "readonly" : ""} />
      </div>
      <div class="conv-field">
        <label>Libellé affiché</label>
        <input id="conv-f-label" type="text" value="${_esc(existing?.label ?? "")}" placeholder="ex: Titre" />
      </div>
      <div class="conv-field">
        <label>Couleur</label>
        <div class="conv-color-row">
          <div class="conv-color-presets">${presetsHtml}</div>
          <div class="conv-color-custom">
            <button type="button" class="conv-color-picker-btn" title="Ouvrir le sélecteur de couleur">
              <div class="conv-color-swatch-preview" id="conv-swatch-preview" style="background:${_esc(initColor || pickerVal)}"></div>
              <input type="color" id="conv-f-color-picker" value="${_esc(pickerVal)}" tabindex="-1" />
            </button>
            <input class="conv-color-hex" id="conv-f-color" type="text" value="${_esc(initColor)}" placeholder="#3b82f6" maxlength="7" spellcheck="false" />
          </div>
        </div>
      </div>
      <div class="conv-field">
        <label>Icône (emoji ou texte court)</label>
        <input id="conv-f-icon" type="text" value="${_esc(existing?.icon ?? "")}" placeholder="📌" />
      </div>
      <div class="conv-field">
        <label>Ordre de tri</label>
        <input id="conv-f-sort" type="number" value="${existing?.sort_order ?? 0}" />
      </div>
      <div class="conv-error" id="conv-dialog-err"></div>
      <div class="conv-dialog-actions">
        <button class="conv-dialog-btn secondary" id="conv-dlg-cancel">Annuler</button>
        <button class="conv-dialog-btn primary" id="conv-dlg-save">Enregistrer</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const hexInput = overlay.querySelector<HTMLInputElement>("#conv-f-color")!;
  const colorPicker = overlay.querySelector<HTMLInputElement>("#conv-f-color-picker")!;
  const swatchPreview = overlay.querySelector<HTMLElement>("#conv-swatch-preview")!;
  const errEl = overlay.querySelector<HTMLElement>("#conv-dialog-err")!;

  function _applyColor(hex: string, source: "preset" | "picker" | "text"): void {
    const valid = /^#[0-9a-fA-F]{6}$/.test(hex);
    if (source !== "text") hexInput.value = hex;
    if (source !== "picker" && valid) colorPicker.value = hex;
    swatchPreview.style.background = valid ? hex : "#e9ecef";
    overlay.querySelectorAll<HTMLElement>(".conv-color-preset").forEach(b => {
      b.classList.toggle("selected", b.dataset.color === hex);
    });
  }

  if (initColor) _applyColor(initColor, "text");

  overlay.querySelectorAll<HTMLButtonElement>(".conv-color-preset").forEach(btn => {
    btn.addEventListener("click", () => _applyColor(btn.dataset.color!, "preset"));
  });
  colorPicker.addEventListener("input", () => _applyColor(colorPicker.value, "picker"));
  hexInput.addEventListener("input", () => {
    let v = hexInput.value.trim();
    if (v && !v.startsWith("#")) v = "#" + v;
    _applyColor(v, "text");
  });

  overlay.querySelector("#conv-dlg-cancel")!.addEventListener("click", () => overlay.remove());
  overlay.querySelector("#conv-dlg-save")!.addEventListener("click", async () => {
    const name = (overlay.querySelector<HTMLInputElement>("#conv-f-name")!.value).trim();
    const label = (overlay.querySelector<HTMLInputElement>("#conv-f-label")!.value).trim();
    const color = hexInput.value.trim() || null;
    const icon = (overlay.querySelector<HTMLInputElement>("#conv-f-icon")!.value).trim() || null;
    const sort_order = parseInt(overlay.querySelector<HTMLInputElement>("#conv-f-sort")!.value) || 0;

    if (!name) { errEl.textContent = "L'identifiant est requis."; return; }
    if (!label) { errEl.textContent = "Le libellé est requis."; return; }
    errEl.textContent = "";

    try {
      if (isEdit) {
        await updateConvention(_conn!, name, { label, color, icon, sort_order, category });
      } else {
        await createConvention(_conn!, { name, label, color, icon, sort_order, category });
      }
      overlay.remove();
      await _loadRoles();
      _renderUnits();
    } catch (e) {
      errEl.textContent = e instanceof Error ? e.message : String(e);
    }
  });
}

async function _deleteRole(name: string): Promise<void> {
  if (!_conn) return;
  if (!confirm(`Supprimer le rôle « ${name} » ? Les unités assignées seront réinitialisées.`)) return;
  try {
    await deleteConvention(_conn, name);
    if (_activeRoleName === name) _activeRoleName = null;
    await _loadRoles();
    if (_selectedDocId !== null) await _loadUnits();
  } catch (e) {
    alert(e instanceof Error ? e.message : String(e));
  }
}

// ─── Documents ────────────────────────────────────────────────────────────────

async function _loadDocs(): Promise<void> {
  if (!_conn || !_docSelectEl) return;
  try {
    const res = (await _conn.get("/documents")) as { documents: typeof _docs };
    _docs = res.documents;
  } catch {
    _docs = [];
  }

  const prev = _selectedDocId;
  _docSelectEl.innerHTML = `<option value="">— Choisir un document —</option>` +
    _docs.map(d => `<option value="${d.doc_id}">${_esc(d.title ?? `Doc #${d.doc_id}`)} ${d.language ? `[${d.language}]` : ""}</option>`).join("");

  if (prev !== null && _docs.some(d => d.doc_id === prev)) {
    _docSelectEl.value = String(prev);
  } else {
    _selectedDocId = null;
  }
}

// ─── Units ────────────────────────────────────────────────────────────────────

async function _loadUnits(): Promise<void> {
  if (!_conn || !_unitsAreaEl) return;
  if (_selectedDocId === null) {
    _units = [];
    _renderUnits();
    _renderActionBar();
    return;
  }

  _unitsAreaEl.innerHTML = `<div class="prep-conv-empty">Chargement…</div>`;

  try {
    _textStartN = _docs.find(d => d.doc_id === _selectedDocId)?.text_start_n ?? null;
    const unitsRes = (await _conn.get(`/units?doc_id=${_selectedDocId}`)) as {
      units: { unit_id: number; n: number; text_norm: string | null; unit_role: string | null; unit_type: string }[];
    };
    _units = unitsRes.units ?? [];
  } catch (e) {
    _unitsAreaEl.innerHTML = `<div class="prep-conv-empty conv-error">Erreur: ${_esc(e instanceof Error ? e.message : String(e))}</div>`;
    return;
  }

  _selectedUnitIds.clear();
  _renderUnits();
  _renderActionBar();
}

function _renderUnits(): void {
  if (!_unitsAreaEl) return;
  if (_units.length === 0) {
    _unitsAreaEl.innerHTML = `<div class="prep-conv-empty">${_selectedDocId ? "Aucune unité trouvée." : "Sélectionnez un document."}</div>`;
    if (_rightHintEl) _rightHintEl.textContent = "";
    return;
  }

  if (_rightHintEl) {
    const roleCount = _units.filter(u => u.unit_role).length;
    _rightHintEl.textContent = `${_units.length} unités · ${roleCount} avec rôle · Clic = sélectionner · Shift+clic = plage`;
  }

  _unitsAreaEl.innerHTML = _units.map(u => {
    const role = _roles.find(r => r.name === u.unit_role);
    const isParatext = _textStartN !== null && u.n < _textStartN;
    const selected = _selectedUnitIds.has(u.unit_id);
    const badge = role
      ? `<span class="conv-unit-badge" style="background:${_safeColor(role.color, "#374151")}22;border-color:${_safeColor(role.color, "#374151")};color:${_safeColor(role.color, "#94a3b8")}">${role.icon ? role.icon + " " : ""}${_esc(role.label)}</span>`
      : "";
    return `
      <div class="conv-unit-row${selected ? " selected" : ""}${isParatext ? " paratext" : ""}" data-uid="${u.unit_id}" data-n="${u.n}">
        <span class="conv-unit-n">${u.n}</span>
        <span class="conv-unit-text">${_esc(u.text_norm ?? "")}</span>
        ${badge}
      </div>
    `;
  }).join("");

  let _lastClickedIdx = -1;
  _unitsAreaEl.querySelectorAll<HTMLElement>(".conv-unit-row").forEach((el, idx) => {
    el.addEventListener("click", (e) => {
      const uid = parseInt(el.dataset.uid!);
      if ((e as MouseEvent).shiftKey && _lastClickedIdx >= 0) {
        const lo = Math.min(_lastClickedIdx, idx);
        const hi = Math.max(_lastClickedIdx, idx);
        for (let i = lo; i <= hi; i++) _selectedUnitIds.add(_units[i].unit_id);
      } else {
        if (_selectedUnitIds.has(uid)) _selectedUnitIds.delete(uid);
        else _selectedUnitIds.add(uid);
        _lastClickedIdx = idx;
      }
      _renderUnits();
      _renderActionBar();
    });
  });
}

// ─── Action bar ───────────────────────────────────────────────────────────────

function _renderActionBar(): void {
  if (!_actionBarEl) return;
  const count = _selectedUnitIds.size;
  const hintEl = document.getElementById("conv-assign-hint");

  if (count === 0) {
    _actionBarEl.classList.remove("visible");
    _actionBarEl.innerHTML = "";
    if (hintEl) hintEl.textContent = "\u00a0";
    _renderRoles(); // remove assignable state from role items
    return;
  }

  // Hint in left column — always visible, text changes
  if (hintEl) {
    hintEl.textContent = `${count} unité${count > 1 ? "s" : ""} sélectionnée${count > 1 ? "s" : ""} — cliquer un rôle pour assigner`;
  }
  // Mark role items as assignable
  document.querySelectorAll<HTMLElement>(".conv-role-item:not(.conv-role-item--dormant)").forEach(el => {
    el.classList.add("conv-role-item--assignable");
  });

  _actionBarEl.classList.add("visible");

  const textStartBtn = count === 1
    ? `<button class="conv-text-start-btn" id="conv-set-ts" title="Définir comme début du texte (après le paratexte)">⚑ Borne texte</button>`
    : "";

  _actionBarEl.innerHTML = `
    <span class="conv-action-count">${count} unité${count > 1 ? "s" : ""}</span>
    <button class="conv-role-pill remove" id="conv-clear-role">✕ Retirer rôle</button>
    <button class="conv-role-pill" id="conv-deselect-all" style="border-color:#94a3b840;color:#64748b">✕ Désélectionner</button>
    ${textStartBtn}
  `;

  _actionBarEl.querySelector("#conv-clear-role")?.addEventListener("click", () => void _assignRole(null));
  _actionBarEl.querySelector("#conv-deselect-all")?.addEventListener("click", () => {
    _selectedUnitIds.clear();
    _renderUnits();
    _renderActionBar();
  });

  _actionBarEl.querySelector("#conv-set-ts")?.addEventListener("click", async () => {
    const uid = [..._selectedUnitIds][0];
    const unit = _units.find(u => u.unit_id === uid);
    if (!unit || !_conn || _selectedDocId === null) return;
    try {
      await setDocumentTextStart(_conn, _selectedDocId, unit.n);
      _textStartN = unit.n;
      const docEntry = _docs.find(d => d.doc_id === _selectedDocId);
      if (docEntry) docEntry.text_start_n = unit.n;
      _renderUnits();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  });
}

async function _assignRole(roleName: string | null): Promise<void> {
  if (!_conn || _selectedUnitIds.size === 0) return;
  const ids = [..._selectedUnitIds];
  try {
    await bulkSetUnitRole(_conn, ids, roleName);
    for (const u of _units) {
      if (_selectedUnitIds.has(u.unit_id)) u.unit_role = roleName;
    }
    _selectedUnitIds.clear();
    _renderUnits();
    _renderActionBar();
  } catch (e) {
    alert(e instanceof Error ? e.message : String(e));
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function _esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Validate that a color value is a safe CSS hex color (#RGB or #RRGGBB). Falls back to a safe default. */
function _safeColor(color: string | null | undefined, fallback = "#475569"): string {
  if (color && /^#[0-9a-fA-F]{3,8}$/.test(color)) return color;
  return fallback;
}

let _cssInjected = false;
function _injectCss(): void {
  if (_cssInjected) return;
  _cssInjected = true;
  const style = document.createElement("style");
  style.id = "conv-module-css";
  style.textContent = CSS;
  document.head.appendChild(style);
}
