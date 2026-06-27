/**
 * curationViewTemplate.ts — static HTML skeleton of the CurationView screen,
 * extracted from CurationView.render() (U-02).
 *
 * Pure and side-effect-free: returns the screen's static markup as a string. There
 * is NO interpolation — every dynamic value is filled in afterwards by render() and
 * _wireEvents. Injected through the trusted safeHtml sink (setHtml + raw()).
 */

export function curationViewTemplate(): string {
  return `
      <section class="prep-acts-seg-head-card acts-seg-head-card--compact" id="act-curation-head">
        <div class="prep-acts-hub-head-left">
          <h1>Curation <span class="prep-badge-preview">pr&#233;visualisation live</span></h1>
        </div>
        <div class="prep-acts-hub-head-tools">
          <button id="act-reload-docs-btn" class="btn btn-secondary btn-sm" title="Re-charger la liste des documents depuis la base">&#8635;&#160;Actualiser</button>
          <span class="prep-curate-pill" id="act-curate-mode-pill">Mode &#233;dition</span>
        </div>
      </section>
      <div id="act-curate-diverge-banner" class="prep-curate-diverge-banner" style="display:none" role="status">
        &#9872;&#160;<strong>text_norm a diverg&#233; de text_raw</strong> &#8212; les modifications sont visibles dans les autres panneaux.
      </div>
      <div id="act-curate-confirm-bar" class="prep-curate-confirm-bar" style="display:none" role="alertdialog" aria-modal="false"></div>
      <div class="prep-curate-doc-bar">
        <select id="act-curate-doc" style="display:none"><option value="">Tous les documents</option></select>
        <div class="prep-curate-doc-toolbar">
          <input type="search" id="act-curate-doc-filter" class="prep-curate-doc-filter-input"
            placeholder="Filtrer&#8230;" autocomplete="off" spellcheck="false" />
          <div class="prep-curate-sort-group" role="group" aria-label="Tri">
            <button class="prep-curate-sort-btn active" data-sort="alpha" title="Trier par titre">A&#8211;Z</button>
            <button class="prep-curate-sort-btn" data-sort="id" title="Trier par identifiant">ID</button>
          </div>
        </div>
        <div id="act-curate-doc-list" class="prep-curate-doc-list" role="listbox" aria-label="S&#233;lectionner un document"></div>
        <span id="act-curate-ctx-lang" style="display:none"></span>
      </div>
      <section class="card curate-workspace-card" id="act-curate-card">
        <div class="prep-curate-workspace">
          <div class="prep-curate-col curate-col-left prep-curate-col-left-layout">
            <article class="prep-curate-inner-card">
              <div class="card-head">
                <h2>Param&#232;tres curation</h2>
                <span id="act-curate-doc-label"></span>
              </div>
              <div class="prep-card-body">
                <div class="prep-curation-quick-rules">
                  <div class="prep-curate-rule-group">
                    <span class="prep-curate-rule-group-label">Corrections</span>
                    <div class="prep-chip-row">
                      <input id="act-rule-spaces" class="prep-curate-rule-input" type="checkbox" />
                      <label class="prep-curation-chip" for="act-rule-spaces">Espaces incoh&#233;rents</label>
                      <input id="act-rule-quotes" class="prep-curate-rule-input" type="checkbox" />
                      <label class="prep-curation-chip" for="act-rule-quotes">Guillemets typographiques</label>
                      <input id="act-rule-invisibles" class="prep-curate-rule-input" type="checkbox" />
                      <label class="prep-curation-chip" for="act-rule-invisibles">Contr&#244;le invisibles</label>
                      <input id="act-rule-numbering" class="prep-curate-rule-input" type="checkbox" />
                      <label class="prep-curation-chip" for="act-rule-numbering">Num&#233;rotation [n]</label>
                    </div>
                  </div>
                  <div class="prep-curate-rule-group">
                    <span class="prep-curate-rule-group-label">Ponctuation</span>
                    <div class="prep-curate-segmented" role="group" aria-label="Mode de correction ponctuation">
                      <input id="act-punct-none" class="prep-curate-rule-input" type="radio" name="curate-punct" value="" checked />
                      <label class="prep-curate-seg-item" for="act-punct-none" title="Aucune correction de ponctuation">&#8212;</label>
                      <input id="act-punct-fr" class="prep-curate-rule-input" type="radio" name="curate-punct" value="fr" />
                      <label class="prep-curate-seg-item" for="act-punct-fr" title="Typographie fran&#231;aise">FR</label>
                      <input id="act-punct-en" class="prep-curate-rule-input" type="radio" name="curate-punct" value="en" />
                      <label class="prep-curate-seg-item" for="act-punct-en" title="Typographie anglaise">EN</label>
                    </div>
                  </div>
                </div>
              </div>
            </article>

            <article class="prep-curate-inner-card" id="act-roles-card">
              <details id="act-curate-roles" class="prep-curation-advanced">
                <summary class="card-head prep-curate-advanced-summary">
                  <h2>R&#244;les</h2>
                </summary>
                <div class="prep-card-body prep-curate-roles-body">
                  <p class="prep-curate-roles-hint" id="act-roles-hint">Passez en <em>Texte brut</em> pour assigner des r&#244;les aux unit&#233;s.</p>
                  <div id="act-roles-controls" style="display:none">
                    <button id="raw-role-mode-btn" class="btn btn-xs prep-raw-role-mode-btn">Activer Conventions</button>
                    <div class="prep-curate-roles-assign" id="act-roles-assign">
                      <span class="prep-curate-roles-count" id="act-roles-count" style="display:none"></span>
                      <div class="prep-curate-roles-select-row">
                        <label class="prep-curate-roles-select-label" for="raw-role-select">R&#244;le&nbsp;:</label>
                        <select id="raw-role-select" class="prep-raw-role-select"><option value="">&#8212; choisir &#8212;</option></select>
                      </div>
                      <div class="prep-curate-roles-btns">
                        <button id="raw-role-assign-btn" class="btn btn-primary btn-xs">Assigner</button>
                        <button id="raw-role-clear-btn" class="btn btn-secondary btn-xs">Effacer le r&#244;le</button>
                        <button id="raw-role-deselect-btn" class="btn btn-ghost btn-xs">&#10005;&#160;D&#233;s&#233;lectionner tout</button>
                      </div>
                    </div>
                  </div>
                </div>
              </details>
            </article>

            <article class="prep-curate-inner-card curate-stack-card" id="act-fr-card">
              <details id="act-curate-advanced" class="prep-curation-advanced">
                <summary class="card-head prep-curate-advanced-summary">
                  <h2>R&#232;gles avanc&#233;es <span id="act-fr-active-badge" class="prep-fr-active-badge" style="display:none">actif</span></h2>
                </summary>
                <div class="prep-card-body">
                  <div class="prep-curate-adv-tabs">
                    <button class="prep-curate-adv-tab active" data-adv-tab="fr">Trouver&#160;/&#160;Remplacer</button>
                    <button class="prep-curate-adv-tab" data-adv-tab="regex">Regex</button>
                  </div>

                  <div class="prep-curate-adv-panel" data-adv-panel="regex" style="display:none">
                    <div class="prep-curate-adv-regex-row">
                      <input id="act-curate-quick-pattern" type="text" placeholder="Motif regex&#8230;" />
                      <input id="act-curate-quick-replacement" type="text" placeholder="Remplacement" />
                      <input id="act-curate-quick-flags" type="text" value="g" maxlength="6" style="width:3rem" title="Flags" />
                      <button id="act-curate-add-rule-btn" class="btn btn-secondary btn-sm">+</button>
                    </div>
                    <label class="prep-curate-json-field">
                      <textarea id="act-curate-rules" rows="3" placeholder='[{"pattern":"foo","replacement":"bar","flags":"gi"}]'></textarea>
                    </label>
                    <div class="prep-curate-adv-footer">
                      <button id="act-curate-reset-btn" class="btn btn-secondary btn-sm">R&#233;initialiser</button>
                    </div>
                  </div>

                  <div class="prep-curate-adv-panel" data-adv-panel="fr">
                    <div class="prep-fr-fields">
                      <label class="prep-fr-field-label">
                        <span>Chercher</span>
                        <input id="act-fr-find" type="text" class="prep-fr-input" placeholder="ex&#160;: M.&#160;" autocomplete="off" />
                      </label>
                      <label class="prep-fr-field-label">
                        <span>Remplacer par</span>
                        <input id="act-fr-replace" type="text" class="prep-fr-input" placeholder="(vide&#160;= supprimer)" autocomplete="off" />
                      </label>
                    </div>
                    <div class="prep-chip-row fr-options-row">
                      <input id="act-fr-regex" type="checkbox" />
                      <label class="chip" for="act-fr-regex">Regex</label>
                      <input id="act-fr-nocase" type="checkbox" />
                      <label class="chip" for="act-fr-nocase">Insensible &#224; la casse</label>
                    </div>
                    <div class="prep-btns fr-actions-row">
                      <button id="act-fr-count-btn" class="btn btn-sm btn-secondary">&#128269;&#160;Trouver</button>
                      <button id="act-fr-apply-btn" class="btn btn-sm alt">&#9654;&#160;Pr&#233;visualiser</button>
                      <button id="act-fr-clear-btn" class="btn btn-sm" style="display:none">&#10005;&#160;Effacer</button>
                    </div>
                    <div id="act-fr-feedback" class="prep-fr-feedback" style="display:none"></div>
                    <div id="act-fr-nav" class="prep-fr-nav" style="display:none">
                      <button id="act-fr-prev-btn" class="btn btn-xs btn-secondary" disabled>&#8592;&#160;Pr&#233;c.</button>
                      <span id="act-fr-nav-pos" class="prep-fr-nav-pos"></span>
                      <button id="act-fr-next-btn" class="btn btn-xs btn-secondary">Suiv.&#160;&#8594;</button>
                    </div>
                  </div>
                </div>
              </details>
            </article>

            <div class="prep-curate-col-spacer"></div>
            <div class="prep-curate-primary-actions-footer">
              <button id="act-curate-btn" class="btn pri" disabled>Appliquer curation</button>
              <button id="act-curate-goto-annot-btn" class="btn btn-sm" title="Ouvrir ce document dans le panneau Annotation">Voir&#160;annotation&#160;&#8599;</button>
            </div>
          </div>
          <div class="prep-curate-col curate-col-center">
            <article class="prep-curate-inner-card curate-preview-card" id="act-preview-panel">
              <div class="card-head">
                <h2>Preview synchronis&#233;e</h2>
                <span id="act-preview-info" style="font-size:12px;color:var(--prep-muted,#4f5d6d)">&#8212;</span>
              </div>
              <div class="prep-preview-controls">
                <div class="prep-preview-mode-row prep-chip-row">
                  <button class="prep-preview-mode-btn" data-preview-mode="diffonly" title="Afficher le texte cur&#233; avec les modifications en surbrillance">Cur&#233; seul</button>
                  <button class="prep-preview-mode-btn active" data-preview-mode="rawonly" title="Afficher le texte source uniquement (vue par d&#233;faut)">Brut seul</button>
                  <button class="prep-preview-mode-btn" data-preview-mode="sidebyside" title="Afficher le brut et le cur&#233; c&#244;te &#224; c&#244;te">C&#244;te &#224; c&#244;te</button>
                  <label class="prep-preview-sync-label" title="Synchroniser le scroll entre les deux panneaux">
                    <input id="act-sync-scroll" type="checkbox" checked />&#160;Sync scroll
                  </label>
                </div>
                <div class="prep-preview-nav-row" role="toolbar" aria-label="Navigation entre occurrences de modification">
                  <button id="act-diff-prev" type="button" class="btn btn-sm btn-secondary" disabled
                    title="Occurrence de modification pr&#233;c&#233;dente"
                    aria-label="Occurrence de modification pr&#233;c&#233;dente">&#8592; Modif pr&#233;c&#233;d.</button>
                  <span id="act-diff-position" class="prep-preview-nav-pos">&#8212;</span>
                  <button id="act-diff-next" type="button" class="btn btn-sm btn-secondary" disabled
                    title="Occurrence de modification suivante"
                    aria-label="Occurrence de modification suivante">Modif suiv. &#8594;</button>
                </div>
                <div id="act-curate-filter-badge" class="prep-preview-filter-badge" style="display:none">
                  Filtre&#160;: <strong id="act-curate-filter-label"></strong><span class="filter-scope-note">&#160;&#8212;&#160;dans l&#8217;&#233;chantillon courant</span>
                  <button id="act-curate-filter-clear" class="filter-clear-btn" title="Effacer le filtre">&#215;</button>
                </div>
                <div id="act-curate-sample-info" class="prep-curate-sample-info" style="display:none"></div>
              </div>
              <div class="prep-preview-grid">
                <section class="prep-pane">
                  <div class="prep-pane-head">Texte brut (source)</div>
                  <div id="act-preview-raw" class="prep-doc-scroll" aria-label="Texte brut">
                    <p class="empty-hint">S&#233;lectionnez un document et lancez une pr&#233;visualisation.</p>
                  </div>
                </section>
                <section class="prep-pane">
                  <div class="prep-pane-head">Texte cur&#233; (diff)
                    <span class="prep-kbd-legend" title="Raccourcis clavier" aria-label="Raccourcis clavier : fl&#232;ches naviguer, A accepter, I ignorer, P remettre en attente">
                      <kbd>&#8593;</kbd><kbd>&#8595;</kbd>&#160;nav&#160;·&#160;<kbd>A</kbd>&#160;acc.&#160;·&#160;<kbd>I</kbd>&#160;ign.&#160;·&#160;<kbd>P</kbd>&#160;att.
                    </span>
                  </div>
                  <div id="act-diff-list" class="prep-diff-list prep-doc-scroll" tabindex="0" aria-label="Texte cur&#233; avec diff&#233;rences (&#8593;&#8595; naviguer, A&#160;accepter, I&#160;ignorer, P&#160;remettre en attente)">
                    <p class="empty-hint">Aucune pr&#233;visualisation.</p>
                  </div>
                </section>
                <aside id="act-curate-minimap" class="prep-minimap" aria-label="Minimap des changements">
                  <div class="prep-mm"></div>
                  <div class="prep-mm"></div>
                  <div class="prep-mm"></div>
                </aside>
              </div>
              <div class="prep-preview-foot">
                <div id="act-preview-stats" class="prep-preview-stats"></div>
                <div id="act-curate-action-bar" class="prep-curate-action-bar" style="display:none">
                  <button id="act-item-accept"  class="btn btn-sm prep-btn-action-accept"  disabled title="Marquer cette modification comme accept&#233;e">&#10003;&#160;Accepter</button>
                  <button id="act-item-ignore"  class="btn btn-sm prep-btn-action-ignore"  disabled title="Ignorer cette modification (ne pas appliquer)">&#215;&#160;Ignorer</button>
                  <button id="act-item-pending" class="btn btn-sm prep-btn-action-pending" disabled title="Remettre en attente de d&#233;cision">&#8635;&#160;En attente</button>
                  <span class="prep-action-bar-sep"></span>
                  <button id="act-bulk-accept"  class="btn btn-sm prep-btn-action-bulk" title="Accepter toutes les modifications visibles">&#10003;&#160;Tout accepter</button>
                  <button id="act-bulk-ignore"  class="btn btn-sm prep-btn-action-bulk" title="Ignorer toutes les modifications visibles">&#215;&#160;Tout ignorer</button>
                </div>
                <div class="prep-btn-row" style="margin-top:0.35rem">
                  <button id="act-apply-after-preview-btn" class="btn prep-btn-warning btn-sm" style="display:none">Appliquer maintenant</button>
                  <button id="act-reindex-after-curate-btn" class="btn btn-secondary btn-sm" style="display:none" title="L'index de recherche est périmé — cliquez pour le mettre à jour">Mettre à jour l'index</button>
                  <!-- Mode A undo (raccourci clavier reporté à une session ultérieure si l'usage révèle le besoin). -->
                  <button id="act-curate-undo-btn" class="btn btn-sm prep-btn-undo" title="" disabled>&#8634; Annuler</button>
                </div>
              </div>
            </article>
          </div>
        </div>
      </section>
      <details class="prep-curate-bottom-panel" id="act-curate-bottom-panel">
        <summary class="prep-curate-bottom-summary">
          <span class="prep-curate-bottom-title">Diagnostics &amp; journal <span class="prep-curate-log-badge" id="act-curate-log-badge" style="display:none"></span></span>
          <span class="prep-curate-bottom-hint">session courante</span>
        </summary>
        <div class="prep-curate-bottom-body">
          <div class="prep-curate-bottom-col curate-bottom-col-diag">
            <div class="prep-curate-bottom-col-head">Diagnostics</div>
            <div id="act-curate-session-summary" class="prep-curate-session-summary" style="display:none"></div>
            <div id="act-curate-diag" class="prep-curate-diag-list">
              <p class="empty-hint">Lancez une pr&#233;visualisation pour voir les statistiques.</p>
            </div>
            <div id="act-curate-seg-link" style="display:none;padding:8px 0"></div>
          </div>
          <div class="prep-curate-bottom-col curate-bottom-col-journal">
            <div class="prep-curate-bottom-col-head">Journal de revue</div>
            <div id="act-curate-review-log" class="prep-curate-log-list" aria-live="polite">
              <p class="empty-hint" style="padding:10px">Aucune action enregistr&#233;e.</p>
            </div>
            <div id="act-curate-context-card" class="prep-curate-bottom-context" style="display:none" aria-label="Contexte local de la modification active">
              <div class="prep-curate-bottom-context-head">
                Contexte local
                <span id="act-context-pos" style="font-size:11px;color:var(--prep-muted,#4f5d6d);margin-left:8px">&#8212;</span>
              </div>
              <div id="act-curate-context" class="prep-curate-context-body"></div>
            </div>
          </div>
          <div class="prep-curate-bottom-col curate-bottom-col-extra">
            <div id="act-review-export-card" class="prep-curate-bottom-export" style="display:none">
              <div class="prep-curate-bottom-col-head">Exporter le rapport</div>
              <div id="act-apply-result-note" class="prep-apply-result-note" style="display:none"></div>
              <div class="prep-review-export-row">
                <button class="btn btn-sm review-export-btn" id="act-review-export-json" title="Exporter en JSON structuré">JSON</button>
                <button class="btn btn-sm review-export-btn" id="act-review-export-csv" title="Exporter en CSV (une ligne par item)">CSV</button>
                <span id="act-review-export-result" class="prep-review-export-result" style="display:none"></span>
              </div>
              <p class="hint review-export-hint">Items de l&#8217;&#233;chantillon courant, statuts et d&#233;cisions.</p>
            </div>
            <details class="prep-exc-admin-panel" id="act-exc-admin-panel"></details>
            <details class="prep-apply-hist-panel" id="act-apply-hist-panel"></details>
          </div>
        </div>
      </details>
      <section class="card" data-collapsible="true" data-collapsed-default="true" id="act-conventions-card">
        <h3>Conventions</h3>
        <div id="act-conventions-list" class="prep-conv-list"></div>
        <form id="act-conventions-form" class="prep-conv-form" autocomplete="off">
          <div class="prep-conv-form-row">
            <input id="act-conv-name"  class="prep-conv-input" type="text"  placeholder="identifiant (ex: titre)"  maxlength="64" required />
            <input id="act-conv-label" class="prep-conv-input" type="text"  placeholder="label (ex: Titre)"        maxlength="64" required />
            <input id="act-conv-color" class="prep-conv-color-input" type="color" value="#6366f1" />
            <button type="submit" class="btn btn-primary btn-sm" disabled id="act-conv-add-btn">Ajouter</button>
          </div>
          <p id="act-conv-form-error" class="prep-conv-form-error" style="display:none"></p>
        </form>
      </section>
      <section class="card" data-collapsible="true" data-collapsed-default="true">
        <h3>Validation m&#233;tadonn&#233;es</h3>
        <div class="prep-form-row">
          <label>Document :
            <select id="act-meta-doc"><option value="">Tous</option></select>
          </label>
        </div>
        <div class="prep-btn-row" style="margin-top:0.5rem">
          <button id="act-meta-btn" class="btn btn-secondary" disabled>Valider</button>
        </div>
      </section>
    `;
}
