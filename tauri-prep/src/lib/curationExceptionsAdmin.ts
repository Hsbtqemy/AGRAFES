/**
 * curationExceptionsAdmin.ts — Pure helpers for the persisted exceptions
 * admin panel of CurationView.
 *
 * Phase 3 of the CurationView decomposition (cf. HANDOFF_PREP § 7 backlog).
 * No DOM manipulation, no I/O. Renders to HTML strings — caller is responsible
 * for assigning to `container.innerHTML`.
 *
 * Invariants protégés par les tests __tests__/curationExceptionsAdmin.test.ts :
 *   1. filterExceptions : kind="all" passthrough, "ignore"/"override" stricts
 *   2. filterExceptions : docFilter=0 = tous documents, N = filtre exact
 *   3. filterExceptions : combinaison kind ∩ docFilter
 *   4. groupExceptionsByDoc : ordre préservé dans chaque groupe ; doc_id
 *      undefined → clé "?" (séparée des numérotés)
 *   5. buildExcDocOptions : dédup par doc_id ; tri ascendant ; fallback
 *      "Document #N" si doc_title null/absent
 *   6. formatExcAdminRow : kind="ignore" → ni edit btn ni textarea ni override block
 *   7. formatExcAdminRow : kind="override" non-editing → bouton edit + bloc override
 *   8. formatExcAdminRow : kind="override" editing → textarea (PAS de bouton edit)
 *   9. formatExcAdminRow : doc_id undefined → pas de bouton "ouvrir dans Curation"
 *  10. formatExcAdminRow : escape HTML sur unit_text/override_text/doc_title
 *  11. formatExcAdminList : empty all → message "Aucune exception persistée"
 *  12. formatExcAdminList : empty filtered → message "Aucun résultat pour ce filtre"
 *  13. formatExcAdminList : doc heads visibles uniquement si docFilter=0
 */
import type { CurateException } from "./sidecarClient.ts";
import { escHtml } from "./diff.ts";

export type ExcKindFilter = "all" | "ignore" | "override";

/**
 * Filter exceptions by kind and/or doc_id. Pure.
 *
 * @param all          Source list
 * @param kindFilter   "all" → passthrough on kind, "ignore"/"override" → strict
 * @param docFilter    0 → tous documents, sinon doc_id exact (les exceptions
 *                     sans doc_id ne matchent jamais quand docFilter > 0)
 */
export function filterExceptions(
  all: CurateException[],
  kindFilter: ExcKindFilter,
  docFilter: number,
): CurateException[] {
  let out = kindFilter === "all" ? all : all.filter((e) => e.kind === kindFilter);
  if (docFilter > 0) out = out.filter((e) => e.doc_id === docFilter);
  return out;
}

/**
 * Group exceptions by doc_id. Pure. Preserves input order within each group.
 * Exceptions sans doc_id sont regroupées sous la clé "?".
 *
 * @returns Map<key, exceptions[]> — key = String(doc_id) ou "?"
 */
export function groupExceptionsByDoc(
  filtered: CurateException[],
): Map<string, CurateException[]> {
  const byDoc = new Map<string, CurateException[]>();
  for (const exc of filtered) {
    const key = exc.doc_id !== undefined ? String(exc.doc_id) : "?";
    if (!byDoc.has(key)) byDoc.set(key, []);
    byDoc.get(key)!.push(exc);
  }
  return byDoc;
}

/**
 * Build a sorted, deduplicated map of doc_id → display title. Pure.
 *
 * Used to populate the doc filter <select>. Exceptions sans doc_id sont
 * ignorées (le sélecteur ne propose que des documents identifiables).
 *
 * @returns Entries sont triées par doc_id ascendant. Title fallback :
 *          "Document #N" si doc_title null/absent.
 */
export function buildExcDocOptions(
  all: CurateException[],
): Map<number, string> {
  // Last-write-wins (Map.set overwrite) — préserve le comportement original.
  // Cas pathologique : si plusieurs exceptions partagent un doc_id mais avec
  // des doc_title divergents, le dernier scanné gagne. Aligne le comportement
  // sur le rendu interactif legacy.
  const known = new Map<number, string>();
  for (const exc of all) {
    if (exc.doc_id !== undefined) {
      known.set(exc.doc_id, exc.doc_title || `Document #${exc.doc_id}`);
    }
  }
  return new Map([...known.entries()].sort((a, b) => a[0] - b[0]));
}

/**
 * Render a single exception row as an HTML string. Pure.
 *
 * The output structure must match the existing CSS in app.css :
 *   - .prep-exc-admin-row[data-exc-unit-id]
 *   - .prep-exc-row-meta (kind badge + unit id + created_at + actions)
 *   - .prep-exc-unit-preview-block (optionnel, si unit_text)
 *   - .prep-exc-row-edit-block (textarea, si override + editing)
 *   - .prep-exc-override-text (si override + non-editing)
 *
 * @param exc        Exception to render
 * @param isEditing  True ssi cette unité est en mode édition (textarea visible).
 *                   Ignoré pour kind="ignore" (jamais éditable).
 */
export function formatExcAdminRow(exc: CurateException, isEditing: boolean): string {
  const kindBadge = `<span class="prep-exc-kind-badge exc-kind-${exc.kind}">${exc.kind === "ignore" ? "🚫 ignore" : "✏ override"}</span>`;
  const unitText = exc.unit_text
    ? `<span class="prep-exc-unit-preview" title="${escHtml(exc.unit_text)}">${escHtml(exc.unit_text.slice(0, 80))}…</span>`
    : "";
  const createdAt = exc.created_at
    ? `<span class="prep-exc-created-at">${exc.created_at.slice(0, 16).replace("T", " ")}</span>`
    : "";
  const openBtn = exc.doc_id !== undefined
    ? `<button class="btn btn-sm prep-exc-row-open-curation" title="Voir cette unité dans Curation">&#x1F441;</button>`
    : "";

  if (exc.kind === "override" && isEditing) {
    return (
      `<div class="prep-exc-admin-row" data-exc-unit-id="${exc.unit_id}">` +
      `<div class="prep-exc-row-meta">${kindBadge}<span class="prep-exc-unit-id">unité&nbsp;${exc.unit_id}</span>${createdAt}</div>` +
      (unitText ? `<div class="prep-exc-unit-preview-block">${unitText}</div>` : "") +
      `<div class="prep-exc-row-edit-block">` +
      `<label class="prep-exc-edit-label">Texte override :</label>` +
      `<textarea class="prep-exc-edit-textarea" id="exc-edit-${exc.unit_id}" rows="3">${escHtml(exc.override_text ?? "")}</textarea>` +
      `<div class="prep-exc-edit-actions">` +
      `<button class="btn btn-sm btn-primary prep-exc-row-edit-save">Enregistrer</button>` +
      `<button class="btn btn-sm prep-exc-row-edit-cancel">Annuler</button>` +
      `</div></div></div>`
    );
  }
  const overrideText = exc.kind === "override" && exc.override_text
    ? `<div class="prep-exc-override-text">${escHtml(exc.override_text)}</div>`
    : "";
  const editBtn = exc.kind === "override"
    ? `<button class="btn btn-sm prep-exc-row-edit-start" title="Modifier le texte override">✎</button>`
    : "";
  return (
    `<div class="prep-exc-admin-row" data-exc-unit-id="${exc.unit_id}">` +
    `<div class="prep-exc-row-meta">${kindBadge}<span class="prep-exc-unit-id">unité&nbsp;${exc.unit_id}</span>${createdAt}` +
    `<div class="prep-exc-row-actions">${openBtn}${editBtn}<button class="btn btn-sm prep-exc-row-delete" title="Supprimer cette exception">✕</button></div>` +
    `</div>` +
    (unitText ? `<div class="prep-exc-unit-preview-block">${unitText}</div>` : "") +
    overrideText +
    `</div>`
  );
}

export interface FormatExcAdminListOptions {
  /** Map<unit_id, isEditing> — typiquement un Set ou un id unique côté caller */
  editingUnitId: number | null;
  /** True ssi le filtre doc actif vaut 0 (tous docs). Détermine l'affichage des doc heads. */
  showDocHeads: boolean;
  /** True ssi la liste totale `all` (avant filtrage) est vide. Permet de distinguer
   *  "aucune exception" de "aucun résultat pour ce filtre". */
  totalIsEmpty: boolean;
}

/**
 * Render the full exceptions admin list as an HTML string. Pure.
 *
 * @param filtered  Already filtered exceptions (cf. filterExceptions)
 * @param options   editingUnitId, showDocHeads, totalIsEmpty
 */
export function formatExcAdminList(
  filtered: CurateException[],
  options: FormatExcAdminListOptions,
): string {
  if (options.totalIsEmpty) {
    return `<p class="empty-hint">Aucune exception persistée.</p>`;
  }
  if (filtered.length === 0) {
    return `<p class="empty-hint">Aucun résultat pour ce filtre.</p>`;
  }
  const grouped = groupExceptionsByDoc(filtered);
  const parts: string[] = [];
  for (const [, rows] of grouped) {
    const firstRow = rows[0];
    if (options.showDocHeads && firstRow.doc_title !== undefined) {
      const headTitle = firstRow.doc_title || `Document #${firstRow.doc_id ?? "?"}`;
      parts.push(`<div class="prep-exc-admin-doc-head">${escHtml(headTitle)}</div>`);
    }
    for (const exc of rows) {
      parts.push(formatExcAdminRow(exc, options.editingUnitId === exc.unit_id));
    }
  }
  return parts.join("");
}
