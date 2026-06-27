/**
 * exportsScreenTemplate.ts — squelette HTML statique de l'écran ExportsScreen,
 * extrait de ExportsScreen.render() (U-02).
 *
 * Pur et sans interpolation : tout le contenu dynamique est rempli ensuite par
 * render() (sélecteurs, bannières, aperçus). Injecté via le sink sûr setHtml(raw()).
 */

export function exportsScreenTemplate(): string {
  return `
      <!-- EXP-1: Head card enrichie -->
      <div class="card exp-head-card">
        <div class="exp-head-top">
          <div>
            <h2 class="prep-screen-title" id="prep-exports-screen-title">
              Exporter
              <button type="button" id="exp-refresh-btn" class="btn btn-secondary btn-sm"
                      title="Re-charger la liste des documents et l'état d'export depuis la base"
                      style="margin-left:0.6rem;vertical-align:middle">&#8634; Actualiser</button>
            </h2>
            <p class="exp-head-desc">Port&#233;e des documents, puis &#233;tape, produit et format &#8212; la plupart des exports passent par la zone <strong>Export unifi&#233;</strong> ci-dessous.</p>
          </div>
          <div id="exp-state-banner" class="prep-runtime-state prep-state-info" aria-live="polite">
            En attente de connexion sidecar…
          </div>
        </div>
        <div class="exp-head-actions">
          <span id="exp-run-pill" class="chip" title="Identifiant de run de workflow (si disponible)">—</span>
          <button type="button" class="btn btn-sm exp-back-btn" aria-label="Retour &agrave; l&apos;onglet Alignement">&#8592; Alignement</button>
        </div>
      </div>

      <!-- EXP-4: KPI strip display-only -->
      <div class="exp-kpi-strip" role="region" aria-label="R&#233;sum&#233; de la s&#233;lection d&apos;export">
        <div class="exp-kpi"><span class="exp-kpi-lbl">Documents</span><span id="exp-kpi-docs" class="exp-kpi-val">0</span></div>
        <div class="exp-kpi"><span class="exp-kpi-lbl">S&#233;lection</span><span id="exp-kpi-sel" class="exp-kpi-val">&#8212;</span></div>
        <div class="exp-kpi"><span class="exp-kpi-lbl">&#201;tape</span><span id="exp-kpi-stage" class="exp-kpi-val">&#8212;</span></div>
        <div class="exp-kpi"><span class="exp-kpi-lbl">Produit</span><span id="exp-kpi-product" class="exp-kpi-val">&#8212;</span></div>
        <div class="exp-kpi"><span class="exp-kpi-lbl">Format</span><span id="exp-kpi-fmt" class="exp-kpi-val">&#8212;</span></div>
      </div>

      <!-- EXP-2: Workspace 2-col -->
      <div class="card exp-v2-card">
        <p class="exp-workspace-lead">Export unifi&#233;</p>
        <div class="exp-workspace" id="exp-workspace-main" aria-label="Configuration d&apos;export : documents et options">

          <!-- LEFT: doc selection -->
          <div class="exp-col-docs" aria-label="Documents du corpus">
            <div class="exp-doc-toolbar">
              <div style="display:flex;align-items:center;gap:8px">
                <h3>Documents source</h3>
                <span id="v2-doc-summary" class="chip">0 doc</span>
              </div>
              <div class="prep-btn-row" style="margin:0">
                <button id="v2-doc-select-all-btn" class="btn btn-secondary btn-sm">Tout sélectionner</button>
                <button id="v2-doc-clear-btn" class="btn btn-secondary btn-sm">Effacer</button>
              </div>
            </div>
            <!-- EXP-3: hidden select (internal state) + visible table -->
            <select id="v2-doc-sel" multiple style="display:none" aria-hidden="true">
              <option value="__all__" selected>— Tous les documents —</option>
            </select>
            <!-- EXP-9: état vide -->
            <div id="exp-empty-hint" class="exp-empty-hint" style="display:none">
              Aucun document importé — allez d'abord dans <strong>Importer</strong>.
            </div>
            <!-- EXP-3: doc table -->
            <table id="exp-doc-grid" class="exp-doc-grid" style="display:none" role="table" aria-label="Liste des documents pour la port&#233;e d&apos;export">
              <thead>
                <tr>
                  <th scope="col" aria-label="Inclure dans l&apos;export"></th>
                  <th scope="col">ID</th>
                  <th scope="col">Titre</th>
                  <th scope="col">Langue</th>
                  <th scope="col">R&#244;le</th>
                  <th scope="col">Statut</th>
                </tr>
              </thead>
              <tbody id="exp-doc-body"></tbody>
            </table>
          </div>

          <!-- RIGHT: options + CTA -->
          <div class="exp-col-opts" aria-label="&#201;tape, produit, format et lancement">
            <div class="exp-opts-meta">
              <label>&#201;tape (jeu de donn&#233;es)
                <select id="v2-stage" aria-describedby="prep-exports-screen-title">
                  <option value="alignment" selected>Alignement</option>
                  <option value="publication">Publication</option>
                  <option value="segmentation">Segmentation</option>
                  <option value="curation">Curation</option>
                  <option value="runs">Historique des runs</option>
                  <option value="qa">Rapport QA</option>
                </select>
              </label>
              <label>Produit de sortie
                <select id="v2-product"></select>
              </label>
              <label>Format fichier
                <select id="v2-format"></select>
              </label>
            </div>

            <div id="v2-tei-options" class="prep-form-row" style="margin-top:0.4rem;display:none">
              <label style="display:flex;align-items:center;gap:0.4rem;font-size:0.84rem;cursor:pointer;align-self:flex-end">
                <input id="v2-tei-include-structure" type="checkbox" />
                Inclure unités structurelles (<code>&lt;head&gt;</code>)
              </label>
              <label>Relation inter-documents (info)
                <select id="v2-tei-relation-type" style="min-width:180px">
                  <option value="none">Aucune</option>
                  <option value="translation_of">translation_of</option>
                  <option value="excerpt_of">excerpt_of</option>
                </select>
              </label>
            </div>

            <div id="v2-readable-options" class="prep-form-row" style="margin-top:0.4rem;display:none">
              <label>Source du texte
                <select id="v2-readable-source-field" style="min-width:200px">
                  <option value="text_norm" selected>Texte normalis&#233; (par d&#233;faut)</option>
                  <option value="text_raw">Texte brut (mise en forme)</option>
                  <option value="text_source">Texte source (original d'import)</option>
                </select>
              </label>
            </div>

            <div id="v2-align-options" class="prep-form-row" style="margin-top:0.4rem;display:none">
              <label>Pivot (optionnel)
                <select id="v2-align-pivot" style="min-width:170px">
                  <option value="">— tous —</option>
                </select>
              </label>
              <label>Cible (optionnel)
                <select id="v2-align-target" style="min-width:170px">
                  <option value="">— tous —</option>
                </select>
              </label>
              <label style="display:flex;align-items:center;gap:0.4rem;font-size:0.84rem;cursor:pointer;align-self:flex-end">
                <input id="v2-align-exceptions-only" type="checkbox" />
                Exceptions uniquement
              </label>
            </div>

            <div id="v2-package-options" class="prep-form-row" style="margin-top:0.4rem;display:none">
              <label style="display:flex;align-items:center;gap:0.4rem;font-size:0.84rem;cursor:pointer;align-self:flex-end">
                <input id="v2-pkg-include-structure" type="checkbox" />
                Inclure unités structurelles
              </label>
              <label style="display:flex;align-items:center;gap:0.4rem;font-size:0.84rem;cursor:pointer;align-self:flex-end">
                <input id="v2-pkg-include-alignment" type="checkbox" />
                Inclure alignements acceptés
              </label>
              <label>Profil TEI
                <select id="v2-pkg-tei-profile" style="min-width:210px">
                  <option value="generic">Generic</option>
                  <option value="parcolab_like">ParCoLab-like (enrichi)</option>
                  <option value="parcolab_strict">ParCoLab strict (expert)</option>
                </select>
              </label>
            </div>

            <div id="v2-run-options" class="prep-form-row" style="margin-top:0.4rem;display:none">
              <label>run_id (optionnel)
                <input id="v2-run-id" type="text" placeholder="ex: sidecar-align-..." style="min-width:280px"/>
              </label>
            </div>

            <div id="v2-qa-options" class="prep-form-row" style="margin-top:0.4rem;display:none">
              <label style="display:flex;align-items:center;gap:0.4rem;font-size:0.84rem;cursor:pointer;align-self:flex-end">
                <input type="checkbox" id="v2-qa-strict-mode">
                Politique QA : Strict
              </label>
            </div>

            <div id="v2-pending-hint" style="display:none;margin-top:0.45rem;font-size:0.83rem;padding:0.4rem 0.6rem;background:#fff3cd;border-radius:4px;border:1px solid #ffe69c;color:#8a6116"></div>
            <div id="v2-summary-hint" class="hint" style="margin-top:0.45rem"></div>
            <!-- EXP-6: btn-sm supprimé -->
            <div class="prep-btn-row" style="margin-top:0.6rem">
              <button id="v2-run-btn" class="btn btn-primary" disabled>Choisir destination et lancer…</button>
            </div>
          </div>

        </div>
      </div>

      <!-- Bilingue / TMX card -->
      <div class="card exp-bil-card">
        <h3>Export bilingue / TMX <span class="prep-badge-preview">TMX &middot; HTML &middot; TXT</span></h3>
        <p class="hint">Exporte une paire de documents align&eacute;s en TMX (m&eacute;moire de traduction) ou en texte bilingue entrelac&eacute; (HTML ou TXT).</p>
        <div class="prep-form-row">
          <label>Famille (optionnel)
            <select id="bil-family-sel" style="min-width:200px">
              <option value="">— paire directe —</option>
            </select>
          </label>
          <label>Pivot (original)
            <select id="bil-pivot-sel" style="min-width:180px">
              <option value="">— choisir —</option>
            </select>
          </label>
          <label>Cible (traduction)
            <select id="bil-target-sel" style="min-width:180px">
              <option value="">— choisir —</option>
            </select>
          </label>
          <label>Format
            <select id="bil-fmt">
              <option value="tmx">TMX (m&eacute;moire de traduction)</option>
              <option value="html">Bilingue HTML</option>
              <option value="txt">Bilingue TXT</option>
            </select>
          </label>
        </div>
        <div id="bil-preview-area" style="display:none;margin-top:0.5rem;max-height:200px;overflow-y:auto;border:1px solid #dee2e6;border-radius:4px;padding:0.5rem;font-size:0.83rem;background:#f8fafc"></div>
        <div class="prep-btn-row" style="margin-top:0.6rem">
          <button type="button" id="bil-preview-btn" class="btn btn-secondary btn-sm" disabled>Aper&ccedil;u</button>
          <button type="button" id="bil-run-btn" class="btn btn-primary btn-sm" disabled>Choisir fichier et exporter&hellip;</button>
        </div>
      </div>

      <div class="card export-legacy-toggle-card">
        <div class="exp-legacy-toggle-row">
          <div>
            <h3 class="exp-legacy-toggle-title">Exports avanc&#233;s (formulaires s&#233;par&#233;s)</h3>
            <p class="hint exp-legacy-toggle-hint">M&#234;mes capacit&#233;s que ci-dessus, pr&#233;sent&#233;es en cartes ind&#233;pendantes (TEI, ZIP, CSV, rapports&#8230;).</p>
          </div>
          <button type="button" id="exports-toggle-legacy-btn" class="btn btn-secondary btn-sm"
            aria-expanded="false" aria-controls="exports-legacy-container">
            Afficher les exports avanc&#233;s
          </button>
        </div>
      </div>

      <div id="exports-legacy-container" class="prep-exports-legacy-container" hidden>
      <!-- TEI Export -->
      <div class="card">
        <h3>Export TEI <span class="prep-badge-preview">XML</span></h3>
        <p class="hint">Exporte un ou plusieurs documents au format TEI "analyse" (UTF-8). Un fichier XML par document.</p>
        <div class="prep-form-row">
          <label>Portée (documents)
            <select id="tei-doc-sel" multiple style="height:90px;min-width:220px">
              <option value="__all__" selected>— Tous les documents —</option>
            </select>
          </label>
          <div style="display:flex;flex-direction:column;gap:0.5rem;align-self:flex-start;padding-top:1.2rem">
            <label style="display:flex;align-items:center;gap:0.4rem;font-size:0.84rem;cursor:pointer">
              <input id="tei-include-structure" type="checkbox" />
              Inclure unités structurelles (<code>&lt;head&gt;</code>)
            </label>
            <label style="display:flex;flex-direction:column;gap:0.2rem;font-size:0.84rem">
              Relation inter-documents
              <select id="tei-relation-type" style="padding:0.2rem 0.4rem;border:1px solid #dee2e6;border-radius:4px">
                <option value="none">Aucune</option>
                <option value="translation_of">translation_of</option>
                <option value="excerpt_of">excerpt_of</option>
              </select>
            </label>
          </div>
        </div>
        <div id="tei-recap" style="display:none;font-size:0.83rem;margin-top:0.4rem;padding:0.4rem 0.6rem;background:#f0fff4;border-radius:4px;border:1px solid #c6efce;color:#1a7f4e"></div>
        <div class="prep-btn-row" style="margin-top:0.6rem">
          <button id="tei-export-btn" class="btn btn-primary btn-sm" disabled>Choisir dossier et exporter…</button>
        </div>
      </div>

      <!-- Publication Package Export -->
      <div class="card">
        <h3>Package publication <span class="prep-badge-preview">ZIP</span></h3>
        <p class="hint">Génère un fichier ZIP contenant les TEI, un manifeste JSON, les checksums SHA-256 et un README. Idéal pour l'archivage et la diffusion.</p>
        <div class="prep-form-row">
          <label>Portée (documents)
            <select id="pkg-doc-sel" multiple style="height:90px;min-width:220px">
              <option value="__all__" selected>— Tous les documents —</option>
            </select>
          </label>
          <div style="display:flex;flex-direction:column;gap:0.5rem;align-self:flex-start;padding-top:1.2rem">
            <label style="display:flex;align-items:center;gap:0.4rem;font-size:0.84rem;cursor:pointer">
              <input id="pkg-include-structure" type="checkbox" />
              Inclure unités structurelles (<code>&lt;head&gt;</code>)
            </label>
            <label style="display:flex;align-items:center;gap:0.4rem;font-size:0.84rem;cursor:pointer">
              <input id="pkg-include-alignment" type="checkbox" />
              Inclure alignements acceptés (<code>&lt;linkGrp&gt;</code>)
            </label>
          </div>
        </div>
        <div class="prep-form-row" style="margin-top:0.5rem">
          <label style="font-size:0.84rem">Profil TEI
            <select id="pkg-tei-profile" style="padding:3px 8px;border:1px solid #dee2e6;border-radius:4px;margin-left:0.4rem">
              <option value="generic">Generic</option>
              <option value="parcolab_like">ParCoLab-like (enrichi)</option>
              <option value="parcolab_strict">ParCoLab strict (expert)</option>
            </select>
          </label>
        </div>
        <div id="pkg-strict-notice" style="display:none;margin-top:0.35rem;font-size:0.78rem;color:#b8590a;background:#fff3cd;border-radius:4px;padding:0.3rem 0.6rem">
          ⚠ Profil strict : peut bloquer l'export si des métadonnées sont incomplètes (title, language, date). Recommande la politique QA Strict.
        </div>
        <div class="prep-btn-row" style="margin-top:0.6rem">
          <button id="pkg-export-btn" class="btn btn-success btn-sm" disabled>Choisir fichier et exporter package…</button>
        </div>
      </div>

      <!-- Alignment CSV Export -->
      <div class="card">
        <h3>Export alignements <span class="prep-badge-preview">CSV/TSV</span></h3>
        <p class="hint">Exporte les liens d'alignement vers un fichier CSV ou TSV.</p>
        <div class="prep-form-row">
          <label>Pivot (optionnel)
            <select id="align-csv-pivot" style="min-width:160px">
              <option value="">— tous —</option>
            </select>
          </label>
          <label>Cible (optionnel)
            <select id="align-csv-target" style="min-width:160px">
              <option value="">— tous —</option>
            </select>
          </label>
          <label>Format
            <select id="align-csv-fmt">
              <option value=",">CSV (virgule)</option>
              <option value="&#9;">TSV (tabulation)</option>
            </select>
          </label>
          <div style="align-self:flex-end">
            <button id="align-csv-btn" class="btn btn-primary btn-sm" disabled>Choisir fichier et exporter…</button>
          </div>
        </div>
      </div>

      <!-- Run Report Export -->
      <div class="card">
        <h3>Rapport des runs <span class="prep-badge-preview">JSONL/HTML</span></h3>
        <p class="hint">Exporte l'historique des opérations (import, index, align, curate…). Option: filtrer un run précis.</p>
        <div class="prep-form-row">
          <label>run_id (optionnel)
            <input id="report-run-id" type="text" placeholder="ex: 4b23... ou sidecar-align-..." style="min-width:280px"/>
          </label>
          <label>Format
            <select id="report-fmt">
              <option value="jsonl">JSONL</option>
              <option value="html">HTML</option>
            </select>
          </label>
          <div style="align-self:flex-end">
            <button id="report-export-btn" class="btn btn-primary btn-sm" disabled>Choisir fichier et exporter…</button>
          </div>
        </div>
      </div>

      <!-- QA Report Export -->
      <div class="card">
        <h3>Rapport QA corpus <span class="prep-badge-preview">JSON/HTML</span></h3>
        <p class="hint">Génère un rapport de qualité : intégrité des identifiants, unités vides, couverture des alignements, collisions et préparation TEI (métadonnées). Consultez le rapport avant publication.</p>
        <div class="prep-form-row">
          <label>Format
            <select id="qa-report-fmt">
              <option value="json">JSON</option>
              <option value="html">HTML</option>
            </select>
          </label>
          <label style="display:flex;align-items:center;gap:0.4rem;font-size:0.84rem;cursor:pointer;align-self:flex-end">
            <input type="checkbox" id="qa-strict-mode">
            Politique QA : Strict
            <span title="Politique QA Strict : les avertissements (collisions, trous d'import, métadonnées optionnelles manquantes, relations) deviennent bloquants — recommandé avant publication TEI." style="color:#6c757d;cursor:help">ⓘ</span>
          </label>
          <div style="align-self:flex-end">
            <button id="qa-report-btn" class="btn btn-primary btn-sm" disabled>Choisir fichier et exporter rapport QA…</button>
          </div>
        </div>
        <div id="qa-gate-banner" style="display:none;margin-top:0.5rem;padding:0.4rem 0.75rem;border-radius:4px;font-size:0.83rem"></div>
      </div>
      </div>

    `;
}
