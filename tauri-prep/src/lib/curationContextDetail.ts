/**
 * curationContextDetail.ts - pure HTML builder for the curation context-detail
 * card body (edit + display modes), extracted from CurationView._renderContextDetail
 * (U-02). The host keeps the DOM lookups, the card/pos updates, the setHtml sink and
 * the button wiring; this builds the body HTML from (ex, editing) — `editing` is the
 * host's _editingManualOverride (read-only here). Moved byte-identical (dense FR text,
 * arrows →↩, badges ✏🔒🔓, HTML entities).
 */
import { escHtml as _escHtml, highlightChanges as _highlightChanges } from "./diff.ts";
import type { CuratePreviewExample } from "./sidecarClient.ts";

export function buildContextDetailHtml(ex: CuratePreviewExample, editing: boolean): string {
    const DISPLAY_TRIM = 200;
    const trim = (t: string): string => t.length > DISPLAY_TRIM ? t.slice(0, DISPLAY_TRIM) + "…" : t;
    const ctxBefore = (ex.context_before ?? "").trim();
    const ctxAfter  = (ex.context_after  ?? "").trim();
    const effectiveAfter = ex.manual_after ?? ex.after;
    const ctxBeforeHtml = ctxBefore ? `<div class="prep-ctx-row ctx-before"><span class="prep-ctx-label">Avant</span><span class="prep-ctx-text">${_escHtml(trim(ctxBefore))}</span></div>` : "";
    const ctxAfterHtml  = ctxAfter  ? `<div class="prep-ctx-row ctx-after"><span class="prep-ctx-label">Après</span><span class="prep-ctx-text">${_escHtml(trim(ctxAfter))}</span></div>`  : "";
    if (editing) {
      return (
        ctxBeforeHtml +
        `<div class="prep-ctx-row ctx-current"><span class="prep-ctx-label ctx-label-cur">Original</span><span class="prep-ctx-text ctx-original">${_escHtml(ex.before)}</span></div>` +
        `<div class="prep-ctx-row ctx-edit-row"><span class="prep-ctx-label ctx-label-edit">Résultat</span><span class="prep-ctx-edit-area"><textarea id="act-manual-override-input" class="prep-ctx-override-textarea" rows="3" spellcheck="true">${_escHtml(effectiveAfter)}</textarea><span class="prep-ctx-edit-hint">Proposition automatique : <em>${_escHtml(ex.after)}</em></span></span></div>` +
        `<div class="prep-ctx-edit-actions"><button class="btn btn-sm btn-primary" id="act-override-save">Enregistrer</button><button class="btn btn-sm btn-secondary" id="act-override-cancel">Annuler</button>${ex.is_manual_override ? `<button class="btn btn-sm" id="act-override-revert" title="Revenir à la proposition automatique">&#8617; Automatique</button>` : ""}</div>` +
        ctxAfterHtml);
    } else {
      const overrideBadgeHtml = ex.is_manual_override
        ? `<span class="prep-ctx-override-badge" title="Ce résultat a été corrigé manuellement. Proposition automatique : ${_escHtml(ex.after)}">✏ Édité manuellement</span>` : "";
      const hasException = ex.is_exception_ignored || ex.is_exception_override;
      const exceptionBadgeHtml = hasException
        ? `<span class="prep-ctx-exception-badge" title="${ex.is_exception_ignored ? "Exception persistée : cette unité sera toujours ignorée par la curation, quelle que soit la session." : `Exception persistée : ce texte sera toujours appliqué à cette unité. Texte : "${_escHtml(ex.exception_override ?? "")}"`}">🔒 ${ex.is_exception_ignored ? "Ignoré durablement" : "Override durable"}</span>` : "";
      const forcedReason = ex.preview_reason;
      const forcedNoteHtml = forcedReason && forcedReason !== "standard"
        ? `<div class="prep-ctx-forced-note ctx-forced-${forcedReason}">${forcedReason === "forced" ? "↗ Ouverture ciblée depuis le panneau Exceptions." : forcedReason === "forced_ignored" ? "↗ Ouverture ciblée — cette unité est <strong>neutralisée par une exception ignore</strong>. Elle n'est pas appliquée." : "↗ Ouverture ciblée — aucune modification active avec les règles courantes."}</div>` : "";
      return (
        ctxBeforeHtml +
        `<div class="prep-ctx-row ctx-current"><span class="prep-ctx-label ctx-label-cur">${forcedReason === "forced_no_change" ? "Inchangé" : forcedReason === "forced_ignored" ? "Neutralisé" : "Modifié"}</span><span class="prep-ctx-modification"><span class="prep-ctx-diff-before">${_escHtml(ex.before)}</span><span class="prep-ctx-arrow">&#8594;</span><span class="prep-ctx-diff-after${ex.is_manual_override ? " ctx-manual-override" : ""}">${_highlightChanges(ex.before, effectiveAfter)}</span></span></div>` +
        ctxAfterHtml + forcedNoteHtml +
        `<div class="prep-ctx-edit-actions">${overrideBadgeHtml}<button class="btn btn-sm" id="act-override-edit" title="Modifier manuellement le résultat de cette modification">&#9998; Éditer</button>${ex.is_manual_override ? `<button class="btn btn-sm" id="act-override-revert" title="Annuler la correction manuelle et utiliser la proposition automatique">&#8617; Proposition auto</button>` : ""}</div>` +
        `<div class="prep-ctx-exception-actions">${exceptionBadgeHtml}${!hasException ? `<button class="btn btn-sm prep-ctx-exception-btn" id="act-exc-ignore" title="Ne plus jamais appliquer de curation sur cette unité, même lors des prochaines sessions">🔒 Toujours ignorer</button><button class="btn btn-sm prep-ctx-exception-btn" id="act-exc-override" title="Appliquer durablement le résultat actuel comme correction permanente de cette unité">🔒 Conserver cette correction</button>` : `<button class="btn btn-sm prep-ctx-exception-btn prep-ctx-exception-btn-delete" id="act-exc-delete" title="Supprimer l'exception persistée — la curation automatique sera réactivée pour cette unité">🔓 Supprimer l'exception</button>`}</div>`);
}
}
