/**
 * familyView.ts — pure HTML renderers for the documentary-families panel,
 * extracted from MetadataScreen (U-02).
 *
 * These are the non-stateful half of the family cluster: they take data and
 * return HTML strings, touching no instance state, no DOM and no sidecar. The
 * stateful orchestration (segment/align/curation flows, author inheritance)
 * stays in MetadataScreen and calls these to build its markup. Keeping them
 * pure makes them trivially testable and lifts ~175 lines of template strings
 * out of the screen.
 */

import type {
  DocumentRecord,
  FamilyRecord,
  FamilyStats,
  FamilySegmentDocResult,
  FamilyAlignPairResult,
  CurationChildStatus,
} from "../lib/sidecarClient.ts";
import { escHtml as esc } from "../lib/diff.ts";
import { truncateMid } from "../lib/textTruncate.ts";
import { completionTier } from "../lib/completionTier.ts";




/**
 * D-P9-3 — cluster compact des signaux dérivés ACTIONNABLES pour le badge par racine de la
 * vue hiérarchie (vue d'ensemble multi-familles, là où le panneau ne montre qu'une famille à
 * la fois). Seuls « à réviser » (⚠) et collisions (⨯) sont rendus inline — ce sont les signaux
 * que `completion_pct` (couverture) NE capture PAS (une famille 100 % couverte peut être 0 %
 * révisée). Le détail complet (révisés / à réviser / rejetés / collisions) est dans l'infobulle.
 * Vide si rien n'est actionnable ou si le sidecar est antérieur à D-P9-1 (status_counts absent).
 * Vocabulaire « révisé » (liens d'alignement) distinct de « validé » (workflow_status du doc,
 * KPI inchangé) — lève l'ambiguïté D-P9d.
 */
export function hierFamilySignalsHtml(stats: FamilyStats): string {
  const sc = stats.status_counts;
  if (!sc) return "";
  const collisions = stats.collision_count ?? 0;
  const parts: string[] = [];
  if (sc.unreviewed > 0) parts.push(`<span class="prep-hier-toreview">⚠ ${sc.unreviewed}</span>`);
  if (collisions > 0) parts.push(`<span class="prep-hier-collisions">⨯ ${collisions}</span>`);
  if (parts.length === 0) return "";
  const title = `✓ ${sc.accepted} révisé(s) · ${sc.unreviewed} à réviser`
    + (sc.rejected > 0 ? ` · ${sc.rejected} rejeté(s)` : "")
    + (collisions > 0 ? ` · ${collisions} collision(s)` : "");
  return `<span class="prep-hier-signals" title="${title}">${parts.join(" ")}</span>`;
}

/** The family panel embedded in the edit panel for a doc that roots a family. */
export function familyPanelHtml(doc: DocumentRecord, families: FamilyRecord[]): string {
  const family = families.find(f => f.family_id === doc.doc_id);
  if (!family) return "";

  const { stats } = family;
  const tier = completionTier(stats.completion_pct);

  const pairRows = family.children.map(c => {
    const segIcon  = c.segmented       ? "✓" : "○";
    const segClass = c.segmented       ? "prep-fam-ok" : "prep-fam-todo";
    const alnIcon  = c.aligned_to_parent ? "✓" : "○";
    const alnClass = c.aligned_to_parent ? "prep-fam-ok" : "prep-fam-todo";
    const childTitle = c.doc ? esc(truncateMid(c.doc.title, 28)) : `doc #${c.doc_id}`;
    const childLang  = c.doc ? esc(c.doc.language) : "?";
    const exportDisabled = c.aligned_to_parent ? "" : "disabled title=\"Aligner la paire d'abord\"";
    return `
        <tr class="prep-fam-pair-row">
          <td class="prep-fam-pair-lang">${childLang}</td>
          <td class="prep-fam-pair-title" title="${c.doc ? esc(c.doc.title) : ""}">${childTitle}</td>
          <td class="prep-fam-pair-icon ${segClass}" title="Segmenté">${segIcon}</td>
          <td class="prep-fam-pair-icon ${alnClass}" title="Aligné">${alnIcon}</td>
          <td class="prep-fam-pair-export">
            <button class="btn btn-xs prep-fam-export-pair-btn"
                    data-pivot="${family.family_id}" data-target="${c.doc_id}"
                    data-pivot-lang="${esc(family.parent?.language ?? 'und')}"
                    data-target-lang="${childLang}"
                    ${exportDisabled}>↗ Export</button>
          </td>
        </tr>`;
  }).join("");

  const ratioWarnings = stats.ratio_warnings.length > 0
    ? `<p class="prep-fam-ratio-warn">⚠ ${stats.ratio_warnings.length} paire(s) avec ratio de segments suspect (&gt;15 %)</p>`
    : "";

  // D-P9 — axe VÉRIFICATION (statut des liens) distinct de la couverture (paires alignées),
  // + collisions. Remplace « N validé(s) » (= workflow_status, axe segmentation ambigu — D-P9d) ;
  // repli sur validated_docs si le sidecar est antérieur à D-P9-1 (champs absents).
  // D-P9-2b — chaque signal ACTIONNABLE est un deep-link (bouton .prep-fam-deeplink,
  // délégué dans MetadataScreen) : « à réviser » / collisions → Révision fine famille ;
  // couverture incomplète → matrice. « La conséquence EST la feature » (note §0) : sans
  // ces liens, ce ne serait qu'un badge mort de plus.
  const famId = family.family_id;
  const sc = stats.status_counts;
  let verifBadge: string;
  if (!sc) {
    verifBadge = `<span>${stats.validated_docs} validé(s)</span>`;
  } else {
    const reviewed = `✓ ${sc.accepted} révisé(s)`;
    const rejected = sc.rejected > 0 ? ` · ${sc.rejected} rejeté(s)` : "";
    verifBadge = sc.unreviewed > 0
      // Reste-à-réviser → bouton vers la Révision fine famille.
      ? `<button type="button" class="prep-fam-deeplink prep-fam-verif"`
        + ` data-deeplink="review" data-family-id="${famId}"`
        + ` title="Réviser les ${sc.unreviewed} lien(s) non-révisé(s) de cette famille">`
        + reviewed + ` · <strong class="prep-fam-toreview">${sc.unreviewed} à réviser</strong>` + rejected
        + `</button>`
      : `<span class="prep-fam-verif" title="Liens d'alignement révisés (acceptés)">`
        + reviewed + rejected + `</span>`;
  }
  const collBadge = (stats.collision_count ?? 0) > 0
    ? `<button type="button" class="prep-fam-deeplink prep-fam-collisions"`
      + ` data-deeplink="review" data-family-id="${famId}"`
      + ` title="Résoudre ${stats.collision_count} collision(s) — un segment lié à plusieurs cibles">`
      + `⨯ ${stats.collision_count} collision(s)</button>`
    : "";
  // Couverture : deep-link vers la matrice seulement s'il reste des paires à aligner.
  const coverageBadge = stats.aligned_pairs < stats.total_pairs
    ? `<button type="button" class="prep-fam-deeplink prep-fam-coverage"`
      + ` data-deeplink="matrix" data-family-id="${famId}"`
      + ` title="Ouvrir la matrice sur cette famille pour aligner les paires manquantes">`
      + `${stats.aligned_pairs}/${stats.total_pairs} paires alignées ↗</button>`
    : `<span>${stats.aligned_pairs}/${stats.total_pairs} paires alignées</span>`;

  return `
      <div class="prep-family-panel">
        <div class="prep-family-panel-head">
          <span class="prep-fam-title">📁 Famille documentaire</span>
          <span class="prep-family-pct-badge family-pct-${tier}">${stats.completion_pct} %</span>
        </div>
        <div class="prep-fam-stats-row">
          <span>${stats.total_docs} doc(s)</span>
          <span>${stats.segmented_docs}/${stats.total_docs} segmentés</span>
          ${coverageBadge}
          ${verifBadge}
          ${collBadge}
        </div>
        <table class="prep-fam-pairs-table">
          <thead><tr>
            <th>Langue</th><th>Traduction / Extrait</th>
            <th title="Segmenté">Seg.</th><th title="Aligné">Aln.</th><th></th>
          </tr></thead>
          <tbody>${pairRows}</tbody>
        </table>
        ${ratioWarnings}
        <div class="prep-fam-actions">
          <button id="seg-family-btn" class="btn btn-secondary btn-sm"
                  data-family-id="${family.family_id}">⟳ Segmenter la famille</button>
          <button id="aln-family-btn" class="btn btn-secondary btn-sm"
                  data-family-id="${family.family_id}"
                  data-pairs="${esc(JSON.stringify(family.children.map(c => ({
                    doc_id: c.doc_id,
                    lang: c.doc?.language ?? "?",
                    title: c.doc?.title ?? `#${c.doc_id}`,
                    segmented: c.segmented,
                    aligned: c.aligned_to_parent,
                    relation_type: c.relation_type,
                  }))))}"
                  >⇄ Aligner la famille</button>
          <button id="curation-family-btn" class="btn btn-secondary btn-sm"
                  data-family-id="${family.family_id}">📋 Curation</button>
        </div>
        <div id="seg-family-result"></div>
        <div id="aln-family-result"></div>
        <div id="curation-family-result"></div>
        <div id="export-pair-dialog"></div>
      </div>`;
}

/** One result row in the segment-family report table. */
export function segResultRow(r: FamilySegmentDocResult): string {
  const statusLabel = r.status === "segmented" ? "✓ Segmenté"
    : r.status === "skipped" ? "— Ignoré"
    : "✕ Erreur";
  const statusClass = r.status === "segmented" ? "prep-fam-ok"
    : r.status === "skipped" ? "prep-fam-todo"
    : "prep-fam-ratio-warn";
  const warns = r.warnings.length > 0
    ? `<span title="${esc(r.warnings.join(" | "))}">⚠ ${r.warnings.length}</span>`
    : "—";
  const ratio = r.calibrate_ratio_pct != null
    ? ` <em>(±${r.calibrate_ratio_pct} %)</em>` : "";
  return `
      <tr>
        <td>#${r.doc_id}</td>
        <td class="${statusClass}">${statusLabel}</td>
        <td>${r.units_input} → ${r.units_output}${ratio}</td>
        <td>${warns}</td>
      </tr>`;
}

/** One result row in the align-family report table. */
export function alnResultRow(r: FamilyAlignPairResult): string {
  const statusLabel = r.status === "aligned"   ? "✓ Aligné"
    : r.status === "skipped"   ? "— Ignoré"
    : r.status === "conflict"  ? "⚡ Conflit"
    : "✕ Erreur";
  const statusClass = r.status === "aligned"  ? "prep-fam-ok"
    : r.status === "skipped"  ? "prep-fam-todo"
    : "prep-fam-ratio-warn";
  const warns = r.warnings.length > 0
    ? `<span title="${esc(r.warnings.join(" | "))}">⚠ ${r.warnings.length}</span>`
    : "—";
  return `
      <tr>
        <td>#${r.pivot_doc_id} ↔ #${r.target_doc_id} (${esc(r.target_lang)})</td>
        <td class="${statusClass}">${statusLabel}</td>
        <td>${r.links_created}</td>
        <td>${warns}</td>
      </tr>`;
}

/** The "translations to review after source change" curation status block. */
export function curationStatusHtml(children: CurationChildStatus[], familyRootId: number): string {
  const sections = children
    .filter(c => c.pending_count > 0)
    .map(c => {
      const rows = c.pending.map(p => `
          <tr class="prep-curation-pending-row">
            <td class="prep-curation-ext-id">[§${esc(String(p.external_id))}]</td>
            <td class="prep-curation-pivot-text" title="${esc(p.pivot_text)}">${esc(truncateMid(p.pivot_text, 60))}</td>
            <td class="prep-curation-target-text" title="${esc(p.target_text)}">${esc(truncateMid(p.target_text, 60))}</td>
            <td class="prep-curation-changed-at" title="${esc(p.source_changed_at)}">${p.source_changed_at.slice(0, 10)}</td>
            <td>
              <button class="btn btn-xs btn-ghost prep-curation-ack-link-btn"
                      data-link-id="${p.link_id}">✓ Lu</button>
            </td>
          </tr>`).join("");

      return `
          <div class="prep-curation-child-block">
            <div class="prep-curation-child-head">
              <span class="prep-curation-child-lang">${esc(c.language ?? "?")} · ${esc(c.title ?? `#${c.doc_id}`)}</span>
              <span class="prep-curation-child-count">${c.pending_count} unité(s) à revoir</span>
              <button class="btn btn-xs prep-curation-ack-doc-btn"
                      data-doc-id="${c.doc_id}" data-family-id="${familyRootId}">✓ Acquitter tout</button>
            </div>
            <table class="prep-curation-pending-table">
              <thead><tr>
                <th>§</th><th>Texte original (pivot)</th><th>Traduction en cours</th>
                <th>Modifié le</th><th></th>
              </tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>`;
    }).join("");

  return `
      <div class="prep-curation-status-block">
        <div class="prep-curation-status-head">
          ⚠ <strong>${children.reduce((s, c) => s + c.pending_count, 0)}</strong>
          unité(s) de traductions à revoir après modification des originaux
        </div>
        ${sections}
      </div>`;
}
