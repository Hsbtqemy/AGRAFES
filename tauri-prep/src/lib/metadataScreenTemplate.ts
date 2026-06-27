/**
 * metadataScreenTemplate.ts — squelette HTML de l'écran MetadataScreen, extrait de
 * MetadataScreen.render() (U-02).
 *
 * Quasi-statique : les seules substitutions sont les listes d'options de rôle
 * (DOC_ROLES, source partagée). Injecté via le sink sûr setHtml(raw(...)).
 */

import { DOC_ROLES } from "./docRoles.ts";

export function metadataScreenTemplate(): string {
  return `
      <!-- Head card: title + state banner + KPI bar + corpus actions -->
      <div class="card prep-meta-screen-head">
        <div class="prep-meta-head-top">
          <div>
            <h2 class="prep-screen-title" style="margin:0 0 4px">
              Documents
              <button type="button" id="meta-refresh-btn" class="btn btn-secondary btn-sm"
                      title="Re-charger la liste des documents depuis la base"
                      style="margin-left:0.6rem;vertical-align:middle">↻ Actualiser</button>
            </h2>
            <p class="prep-meta-head-desc">Sélectionnez un document pour éditer ses métadonnées ou utilisez l'édition en masse.</p>
          </div>
          <div id="meta-state-banner" class="prep-runtime-state prep-state-info" aria-live="polite">
            En attente de connexion sidecar…
          </div>
        </div>
        <div class="prep-meta-head-bottom">
          <div id="prep-meta-kpi-bar" class="prep-meta-kpi-bar">
            <span id="meta-kpi-total"  class="prep-meta-kpi">0 doc</span>
            <span id="prep-meta-kpi-ok"    class="prep-meta-kpi prep-meta-kpi-ok">0 validés</span>
            <span id="prep-meta-kpi-warn"  class="prep-meta-kpi prep-meta-kpi-warn">0 à traiter</span>
            <span id="meta-kpi-langs" class="prep-meta-kpi">0 langues</span>
          </div>
          <div class="prep-meta-head-actions">
            <button id="db-backup-btn" class="btn btn-secondary btn-sm">Sauvegarder la DB</button>
            <button id="db-export-btn" class="btn btn-secondary btn-sm">↗ Exporter pour partage…</button>
            <span id="db-backup-status" class="hint" style="margin:0">Aucune sauvegarde récente</span>
            <button id="validate-btn" class="btn btn-secondary btn-sm">Valider métadonnées</button>
            <button id="audit-btn" class="btn btn-secondary btn-sm">🔍 Audit corpus</button>
            <button id="meta-reindex-btn" class="btn btn-secondary btn-sm" disabled>✓ Index à jour</button>
            <label class="prep-meta-auto-reindex-label"
                   title="Réindexer automatiquement l'index FTS après chaque curation appliquée (job asynchrone, non bloquant)">
              <input type="checkbox" id="meta-auto-reindex" /> Auto après curation
            </label>
            <label class="audit-ratio-label" title="Seuil d'avertissement pour le ratio de segments parent/enfant">
              Seuil ratio
              <input id="audit-ratio-input" type="number" min="1" max="100" value="15"
                     class="audit-ratio-input" style="width:52px">%
            </label>
          </div>
        </div>
        <!-- Audit panel — shown after clicking "Audit corpus" -->
        <div id="prep-meta-audit-panel" class="prep-meta-audit-panel" hidden></div>
      </div>

      <!-- 2-col workspace -->
      <div class="prep-meta-layout">

        <!-- Left column: document list (not collapsible — always visible) -->
        <section class="card prep-meta-list-card">
          <div class="prep-meta-list-head">
            <div class="prep-meta-list-head-left">
              <h3 style="margin:0">Documents</h3>
              <button id="refresh-docs-btn" class="btn btn-secondary btn-sm prep-meta-refresh-btn"
                aria-label="Actualiser la liste des documents" title="Recharger la liste depuis la base">↻ Actualiser</button>
            </div>
            <span id="meta-doc-count" class="hint" style="margin:0">0 document</span>
          </div>
          <div class="prep-meta-list-toolbar">
            <input id="meta-doc-filter" type="text"
              placeholder="Titre, langue, #id…" class="meta-filter-input" />
            <select id="meta-status-filter" class="meta-filter-select">
              <option value="all">Tous statuts</option>
              <option value="ok">Validé</option>
              <option value="todo">Brouillon / À revoir</option>
            </select>
            <button id="meta-reset-filter" class="btn btn-secondary btn-sm"
              aria-label="Réinitialiser les filtres" title="Réinitialiser">↺</button>
            <button id="meta-hierarchy-btn" class="btn btn-secondary btn-sm"
              title="Basculer entre vue liste et vue hiérarchique" aria-pressed="false">🌿 Hiérarchie</button>
          </div>
          <div class="prep-meta-doc-list-wrap">
            <table class="prep-meta-doc-table" aria-label="Documents du corpus">
              <thead>
                <tr>
                  <th class="col-check">
                    <input id="meta-select-all" type="checkbox" aria-label="Sélectionner tout" />
                  </th>
                  <th class="col-id">N°</th>
                  <th class="col-title sortable-th" data-sort="title">Titre <span class="sort-ind" aria-hidden="true"></span></th>
                  <th class="col-lang sortable-th" data-sort="lang">Langue <span class="sort-ind" aria-hidden="true"></span></th>
                  <th class="col-role sortable-th" data-sort="role">Rôle <span class="sort-ind" aria-hidden="true"></span></th>
                  <th class="col-status sortable-th" data-sort="status">Statut <span class="sort-ind" aria-hidden="true"></span></th>
                </tr>
              </thead>
              <tbody id="prep-meta-doc-list"></tbody>
            </table>
          </div>
          <div id="prep-meta-batch-bar" class="prep-meta-batch-bar">
            <span id="prep-meta-batch-meta" class="prep-meta-batch-meta">0 sélectionné</span>
            <div class="prep-meta-batch-actions">
              <select id="meta-batch-role-sel" class="btn btn-secondary btn-sm" disabled>
                <option value="">— Rôle —</option>
                ${DOC_ROLES.map(r => `<option value="${r}">${r}</option>`).join("")}
              </select>
              <button id="meta-batch-role-btn" class="btn btn-secondary btn-sm" disabled>Appliquer rôle</button>
              <button id="meta-batch-delete-btn" class="btn btn-danger btn-sm" disabled>🗑 Supprimer</button>
            </div>
          </div>
        </section>

        <!-- Right column: edit panel -->
        <section class="card prep-meta-edit-card" data-collapsible="true">
          <h3>Édition du document sélectionné</h3>
          <div id="meta-edit-panel">
            <p class="empty-hint">Sélectionnez un document dans la liste.</p>
          </div>
        </section>
      </div>

      <!-- Bulk update (collapsed by default) -->
      <section class="card" data-collapsible="true" data-collapsed-default="true">
        <h3>Édition en masse</h3>
        <div class="prep-form-row" style="margin-top:0.55rem">
          <label>Doc role (tous)
            <select id="bulk-role">
              <option value="">— ne pas changer —</option>
              ${DOC_ROLES.map(r => `<option value="${r}">${r}</option>`).join("")}
            </select>
          </label>
          <label>Resource type (tous)
            <input id="bulk-restype" type="text" placeholder="littérature, article, discours…" style="max-width:220px">
          </label>
          <div style="align-self:flex-end">
            <button id="bulk-apply-btn" class="btn btn-secondary btn-sm" disabled>Appliquer à tous</button>
          </div>
        </div>
      </section>

    `;
}
