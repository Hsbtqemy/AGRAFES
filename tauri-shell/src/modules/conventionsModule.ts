/**
 * conventionsModule.ts — Gestion des conventions (rôles d'unités).
 *
 * Deux panneaux :
 *   - Gauche : CRUD des rôles définis pour le corpus (unit_roles)
 *   - Droite : navigation document → unités → assignation de rôle
 *
 * Les rôles permettent de marquer les unités (paratext, titre, note…).
 * La borne paratextuelle (text_start_n) est aussi gérable ici.
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

/* ── Panneau gauche : rôles ── */
.conv-left {
  width: 280px;
  min-width: 220px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid #dee2e0;
  background: #f3f8f7;
}
.conv-left-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem 0.5rem;
  border-bottom: 1px solid #dee2e0;
  font-weight: 600;
  font-size: 0.82rem;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #6c757d;
}
.conv-role-list {
  flex: 1;
  overflow-y: auto;
  padding: 0.4rem 0;
}
.conv-role-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.45rem 1rem;
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
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex-shrink: 0;
  border: 1px solid rgba(0,0,0,0.15);
}
.conv-role-icon { font-size: 1rem; width: 18px; text-align: center; }
.conv-role-label { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.conv-role-name { color: #adb5bd; font-size: 0.75rem; font-family: monospace; }
.conv-role-actions { display: none; gap: 0.25rem; }
.conv-role-item:hover .conv-role-actions,
.conv-role-item.active .conv-role-actions { display: flex; }
.conv-btn-icon {
  background: none;
  border: none;
  color: #6c757d;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 3px;
  font-size: 0.8rem;
  line-height: 1;
}
.conv-btn-icon:hover { background: rgba(0,0,0,0.08); color: #212529; }
.conv-btn-icon.danger:hover { background: rgba(220,53,69,0.1); color: #dc3545; }

/* ── Add role button ── */
.conv-add-btn {
  margin: 0.5rem;
  padding: 0.45rem 0.75rem;
  background: #e8f5f3;
  border: 1px dashed #0c4a46;
  border-radius: 6px;
  color: #0c4a46;
  cursor: pointer;
  font-size: 0.82rem;
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

/* ── Barre d'action en bas (unités sélectionnées) ── */
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
  width: 360px;
  max-width: 95vw;
  box-shadow: 0 8px 32px rgba(0,0,0,0.15);
}
.conv-dialog h3 { margin: 0 0 1rem; font-size: 1rem; color: #212529; }
.conv-field { margin-bottom: 0.85rem; }
.conv-field label { display: block; margin-bottom: 0.3rem; color: #6c757d; font-size: 0.78rem; }
.conv-field input {
  width: 100%;
  box-sizing: border-box;
  background: #fff;
  border: 1px solid #ced4da;
  border-radius: 5px;
  color: #212529;
  padding: 0.4rem 0.6rem;
  font-size: 0.85rem;
}
.conv-field input:focus { outline: 2px solid #0c4a46; border-color: transparent; }
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
let _roleListEl: HTMLElement | null = null;
let _unitsAreaEl: HTMLElement | null = null;
let _actionBarEl: HTMLElement | null = null;
let _docSelectEl: HTMLSelectElement | null = null;
let _rightHintEl: HTMLElement | null = null;

// ─── Public API ───────────────────────────────────────────────────────────────

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
  _roleListEl = null;
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
        <div class="conv-left-header">
          <span>Rôles</span>
        </div>
        <div class="conv-role-list"></div>
        <button class="conv-add-btn">+ Nouveau rôle</button>
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
  _roleListEl = container.querySelector(".conv-role-list");
  _unitsAreaEl = container.querySelector(".conv-units-area");
  _actionBarEl = container.querySelector(".conv-action-bar");
  _docSelectEl = container.querySelector(".conv-doc-select");
  _rightHintEl = container.querySelector(".conv-right-hint");

  container.querySelector(".conv-add-btn")!.addEventListener("click", () => _openRoleDialog(null));

  _docSelectEl!.addEventListener("change", () => {
    const val = _docSelectEl!.value;
    _selectedDocId = val ? parseInt(val) : null;
    _selectedUnitIds.clear();
    void _loadUnits();
  });
}

// ─── Roles CRUD ───────────────────────────────────────────────────────────────

async function _loadRoles(): Promise<void> {
  if (!_conn || !_roleListEl) return;
  try {
    _roles = await listConventions(_conn);
  } catch {
    _roles = [];
  }
  _renderRoles();
}

function _renderRoles(): void {
  if (!_roleListEl) return;
  if (_roles.length === 0) {
    _roleListEl.innerHTML = `<div class="prep-conv-empty" style="padding:1rem;font-size:0.8rem">Aucun rôle défini.</div>`;
    return;
  }
  _roleListEl.innerHTML = _roles.map(r => `
    <div class="conv-role-item${_activeRoleName === r.name ? " active" : ""}" data-role="${_esc(r.name)}">
      <span class="conv-role-dot" style="background:${r.color ?? "#475569"};border-color:${r.color ?? "#475569"}"></span>
      <span class="conv-role-icon">${r.icon ?? ""}</span>
      <span class="conv-role-label">${_esc(r.label)}</span>
      <span class="conv-role-name">${_esc(r.name)}</span>
      <span class="conv-role-actions">
        <button class="conv-btn-icon" data-action="edit" title="Modifier">✏️</button>
        <button class="conv-btn-icon danger" data-action="delete" title="Supprimer">🗑</button>
      </span>
    </div>
  `).join("");

  _roleListEl.querySelectorAll<HTMLElement>(".conv-role-item").forEach(el => {
    const name = el.dataset.role!;
    el.addEventListener("click", (e) => {
      const action = (e.target as HTMLElement).closest("[data-action]")?.getAttribute("data-action");
      if (action === "edit") { e.stopPropagation(); _openRoleDialog(name); return; }
      if (action === "delete") { e.stopPropagation(); void _deleteRole(name); return; }
      _activeRoleName = _activeRoleName === name ? null : name;
      _renderRoles();
      _renderActionBar();
    });
  });
}

function _openRoleDialog(editName: string | null): void {
  const existing = editName ? _roles.find(r => r.name === editName) ?? null : null;
  const isEdit = existing !== null;

  const overlay = document.createElement("div");
  overlay.className = "conv-overlay";
  overlay.innerHTML = `
    <div class="conv-dialog">
      <h3>${isEdit ? "Modifier le rôle" : "Nouveau rôle"}</h3>
      <div class="conv-field">
        <label>Identifiant (slug, immuable)</label>
        <input id="conv-f-name" type="text" value="${_esc(existing?.name ?? "")}" placeholder="ex: titre" ${isEdit ? "readonly" : ""} />
      </div>
      <div class="conv-field">
        <label>Libellé affiché</label>
        <input id="conv-f-label" type="text" value="${_esc(existing?.label ?? "")}" placeholder="ex: Titre" />
      </div>
      <div class="conv-field">
        <label>Couleur (hex)</label>
        <input id="conv-f-color" type="text" value="${_esc(existing?.color ?? "")}" placeholder="#3b82f6" />
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

  const errEl = overlay.querySelector<HTMLElement>("#conv-dialog-err")!;
  overlay.querySelector("#conv-dlg-cancel")!.addEventListener("click", () => overlay.remove());
  overlay.querySelector("#conv-dlg-save")!.addEventListener("click", async () => {
    const name = (overlay.querySelector<HTMLInputElement>("#conv-f-name")!.value).trim();
    const label = (overlay.querySelector<HTMLInputElement>("#conv-f-label")!.value).trim();
    const color = (overlay.querySelector<HTMLInputElement>("#conv-f-color")!.value).trim() || null;
    const icon = (overlay.querySelector<HTMLInputElement>("#conv-f-icon")!.value).trim() || null;
    const sort_order = parseInt(overlay.querySelector<HTMLInputElement>("#conv-f-sort")!.value) || 0;

    if (!name) { errEl.textContent = "L'identifiant est requis."; return; }
    if (!label) { errEl.textContent = "Le libellé est requis."; return; }
    errEl.textContent = "";

    try {
      if (isEdit) {
        await updateConvention(_conn!, name, { label, color, icon, sort_order });
      } else {
        await createConvention(_conn!, { name, label, color, icon, sort_order });
      }
      overlay.remove();
      await _loadRoles();
      _renderUnits(); // badges may have changed
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

  // Rebuild options (keep selected value if still valid)
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
    // text_start_n is already in _docs (loaded by _loadDocs); no extra fetch needed.
    _textStartN = _docs.find(d => d.doc_id === _selectedDocId)?.text_start_n ?? null;

    // GET /units?doc_id=N — lists all units with their role
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
      ? `<span class="conv-unit-badge" style="background:${role.color ?? "#374151"}22;border-color:${role.color ?? "#374151"};color:${role.color ?? "#94a3b8"}">${role.icon ? role.icon + " " : ""}${_esc(role.label)}</span>`
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
        for (let i = lo; i <= hi; i++) {
          _selectedUnitIds.add(_units[i].unit_id);
        }
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

  if (count === 0) {
    _actionBarEl.classList.remove("visible");
    _actionBarEl.innerHTML = "";
    return;
  }

  _actionBarEl.classList.add("visible");

  const rolePills = _roles.map(r =>
    `<button class="conv-role-pill" data-assign="${_esc(r.name)}" style="border-color:${r.color ?? "#475569"}40;color:${r.color ?? "#374151"}">
      ${r.icon ? r.icon + " " : ""}<span>${_esc(r.label)}</span>
    </button>`
  ).join("");

  const textStartBtn = count === 1
    ? `<button class="conv-text-start-btn" id="conv-set-ts" title="Définir comme début du texte (après le paratexte)">⚑ Borne texte</button>`
    : "";

  _actionBarEl.innerHTML = `
    <span class="conv-action-count">${count} unité${count > 1 ? "s" : ""} sélectionnée${count > 1 ? "s" : ""} :</span>
    ${rolePills}
    <button class="conv-role-pill remove" id="conv-clear-role">✕ Retirer rôle</button>
    ${textStartBtn}
  `;

  _actionBarEl.querySelectorAll<HTMLElement>("[data-assign]").forEach(btn => {
    btn.addEventListener("click", () => void _assignRole(btn.dataset.assign!));
  });

  _actionBarEl.querySelector("#conv-clear-role")?.addEventListener("click", () => void _assignRole(null));

  _actionBarEl.querySelector("#conv-set-ts")?.addEventListener("click", async () => {
    const uid = [..._selectedUnitIds][0];
    const unit = _units.find(u => u.unit_id === uid);
    if (!unit || !_conn || _selectedDocId === null) return;
    try {
      await setDocumentTextStart(_conn, _selectedDocId, unit.n);
      _textStartN = unit.n;
      // Keep _docs cache in sync so subsequent _loadUnits calls don't re-fetch stale value.
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
    // Update local state
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

let _cssInjected = false;
function _injectCss(): void {
  if (_cssInjected) return;
  _cssInjected = true;
  const style = document.createElement("style");
  style.id = "conv-module-css";
  style.textContent = CSS;
  document.head.appendChild(style);
}
