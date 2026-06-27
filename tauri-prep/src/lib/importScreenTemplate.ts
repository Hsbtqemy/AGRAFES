/**
 * importScreenTemplate.ts — squelette HTML statique de l'écran ImportScreen, extrait
 * de ImportScreen.render() (U-02).
 *
 * Quasi-statique : les seules substitutions sont les constantes de profil
 * WP_DEFAULT_* (valeurs d'options du sélecteur de mode par défaut). Injecté via le
 * sink sûr setHtml(raw(...)).
 */

import { WP_DEFAULT_NUMBERED, WP_DEFAULT_PARAGRAPHS } from "./importDetect.ts";

export function importScreenTemplate(): string {
  return `
      <div class="imp-scroll">
      <!-- Head card + stepper -->
      <div class="card imp-head-card">
        <div class="imp-head-top">
          <div>
            <h2 class="prep-screen-title" style="margin:0 0 4px">
              Importer des fichiers
              <button type="button" id="imp-refresh-btn" class="btn btn-secondary btn-sm"
                      title="Re-charger la liste des documents du corpus depuis la base (vérification doublons, candidats famille)"
                      style="margin-left:0.6rem;vertical-align:middle">↻ Actualiser</button>
            </h2>
            <p class="imp-head-desc">Ajoutez vos fichiers source, configurez le profil de lot, puis lancez l'import.</p>
          </div>
          <div id="imp-state-banner" class="prep-runtime-state prep-state-info" aria-live="polite">
            En attente de connexion sidecar…
          </div>
        </div>
        <div class="imp-steps">
          <span class="imp-step active">① Sources</span>
          <span class="imp-step-sep">›</span>
          <span class="imp-step">② Profil</span>
          <span class="imp-step-sep">›</span>
          <span class="imp-step">③ Validation</span>
          <span class="imp-step-sep">›</span>
          <span class="imp-step">④ Exécution</span>
        </div>
      </div>

      <!-- 2-col workspace -->
      <div class="imp-workspace">

        <!-- Left column: files -->
        <div class="imp-col-main">
          <div class="card">
            <div class="imp-file-card-head">
              <h3 style="margin:0">Fichiers source</h3>
              <span id="imp-summary" class="chip">0 fichier</span>
            </div>
            <div class="imp-dropzone" id="imp-dropzone">
              <div class="imp-dropzone-icon">📂</div>
              <div class="imp-dropzone-text">Glissez vos fichiers ici</div>
              <div class="imp-dropzone-sub">.docx &middot; .odt &middot; .txt &middot; .conllu &middot; .tei &middot; .xml</div>
              <div class="prep-btn-row" style="justify-content:center;margin-top:8px">
                <button id="imp-add-btn" class="btn btn-primary btn-sm">Ajouter des fichiers…</button>
                <button id="imp-clear-btn" class="btn btn-secondary btn-sm">Vider</button>
              </div>
            </div>
            <div id="imp-list" class="imp-file-list">
              <p class="empty-hint">Aucun fichier sélectionné.</p>
            </div>
          </div>

        </div>

        <!-- Right column: settings + pre-check + index -->
        <div class="imp-col-side">
          <details class="card imp-settings-card" open>
            <summary class="imp-settings-summary">
              <span class="imp-settings-title" id="imp-settings-title">Profil de lot</span>
              <span class="chip">par défaut</span>
            </summary>
            <div class="imp-settings-body" role="region" aria-labelledby="imp-settings-title">
              <div class="imp-settings-grid">
                <div class="imp-settings-field">
                  <label for="imp-default-mode">Format par défaut</label>
                  <select id="imp-default-mode" aria-describedby="imp-settings-hint-apply">
                    <optgroup label="Traitement de texte (DOCX / ODT)">
                      <option value="${WP_DEFAULT_NUMBERED}" selected>Lignes numérotées [n]</option>
                      <option value="${WP_DEFAULT_PARAGRAPHS}">Paragraphes</option>
                    </optgroup>
                    <optgroup label="Autres formats">
                      <option value="txt_numbered_lines">TXT · lignes [n]</option>
                      <option value="conllu">CoNLL-U annoté</option>
                      <option value="tei">TEI XML</option>
                    </optgroup>
                  </select>
                </div>
                <div class="imp-settings-field">
                  <label for="imp-default-lang">Langue par défaut</label>
                  <input
                    id="imp-default-lang"
                    type="text"
                    value="fr"
                    placeholder="fr, en, …"
                    maxlength="10"
                    autocomplete="off"
                    spellcheck="false"
                    inputmode="text"
                    aria-describedby="imp-settings-hint-apply"
                  />
                </div>
              </div>
              <label class="imp-settings-filename-check" title="Si coché : refuse l’import lorsqu’un document avec le même nom de fichier existe déjà dans le corpus (chemins différents inclus).">
                <input type="checkbox" id="imp-check-filename" />
                <span>Bloquer les doublons par nom de fichier</span>
              </label>
              <div class="imp-settings-actions prep-btn-row">
                <button type="button" id="imp-apply-defaults-btn" class="btn btn-secondary btn-sm">
                  Appliquer aux fichiers en attente
                </button>
                <p id="imp-settings-hint-apply" class="hint imp-settings-hint">
                  Pour DOCX/ODT, le profil « traitement de texte » s’applique selon l’extension de chaque fichier. Réapplique format + langue aux lignes en attente.
                </p>
                <p class="hint imp-settings-hint" title="Le mode lignes numérotées reconnaît [n] seulement en tête de ligne/paragraphe après trim.">
                  Balises <code>[n]</code> : le mode <strong>Lignes numérotées</strong> attend <code>[12]</code> en début de ligne/paragraphe. Si les balises sont au milieu du texte, importez en <strong>Paragraphes</strong> puis segmentez en mode <strong>Balises [N]</strong>.
                </p>
                <p
                  class="hint imp-settings-hint"
                  title="Unicode: normalisation NFC, conversion NBSP/NNBSP/¤ en espace, suppression des invisibles de contrôle dans text_norm."
                >
                  Texte Unicode: import DOCX/ODT en UTF-8/XML puis normalisation moteur sur <code>text_norm</code> (espaces insécables, invisibles, <code>¤</code>).
                </p>
              </div>
            </div>
          </details>

          <div class="card imp-precheck-card">
            <div class="imp-precheck-head">
              <h3 style="margin:0">Pré-vérification</h3>
              <span id="imp-precheck-badge" class="chip">—</span>
            </div>
            <div class="imp-precheck-body">
              <div class="imp-diag">
                <span class="imp-diag-label">Fichiers sélectionnés</span>
                <span class="imp-diag-value" id="imp-diag-total">0</span>
              </div>
              <div class="imp-diag">
                <span class="imp-diag-label">En attente</span>
                <span class="imp-diag-value" id="imp-diag-pending">0</span>
              </div>
              <div class="imp-diag">
                <span class="imp-diag-label">Importés</span>
                <span class="imp-diag-value" id="imp-diag-done">0</span>
              </div>
              <div class="imp-diag">
                <span class="imp-diag-label">Erreurs</span>
                <span class="imp-diag-value" id="imp-diag-errors">0</span>
              </div>
            </div>
          </div>

          <section class="card imp-conllu-card" data-collapsible="true">
            <h3>Aperçu CoNLL-U</h3>
            <div class="imp-conllu-head">
              <span id="imp-conllu-badge" class="chip">Aucun</span>
              <div class="prep-btn-row">
                <button type="button" id="imp-conllu-next" class="btn btn-secondary btn-sm" title="Passer au fichier CoNLL-U suivant">Suivant</button>
                <button type="button" id="imp-conllu-refresh" class="btn btn-secondary btn-sm" title="Relire le fichier sélectionné">Rafraîchir</button>
              </div>
            </div>
            <p id="imp-conllu-file" class="hint imp-conllu-file">Aucun fichier .conllu sélectionné.</p>
            <p id="imp-conllu-summary" class="hint imp-conllu-summary">Ajoutez un fichier CoNLL-U pour prévisualiser les tokens avant l’import.</p>
            <div class="imp-conllu-table-wrap">
              <table class="imp-conllu-table" aria-label="Aperçu tokens CoNLL-U">
                <thead>
                  <tr>
                    <th>Phrase</th>
                    <th>ID</th>
                    <th>Forme</th>
                    <th>Lemme</th>
                    <th>UPOS</th>
                  </tr>
                </thead>
                <tbody id="imp-conllu-rows">
                  <tr><td colspan="5" class="empty-hint">Aperçu indisponible.</td></tr>
                </tbody>
              </table>
            </div>
          </section>

          <section class="card imp-text-preview-card" data-collapsible="true" data-collapsed-default="true">
            <h3>Aperçu texte</h3>
            <div class="imp-conllu-head">
              <span id="imp-text-badge" class="chip">Aucun</span>
              <div class="prep-btn-row">
                <button type="button" id="imp-text-next" class="btn btn-secondary btn-sm" title="Fichier texte suivant">Suivant</button>
                <button type="button" id="imp-text-refresh" class="btn btn-secondary btn-sm" title="Relire le fichier">Rafraîchir</button>
              </div>
            </div>
            <p id="imp-text-file" class="hint imp-conllu-file">Aucun fichier texte sélectionné.</p>
            <p id="imp-text-summary" class="hint imp-conllu-summary">Ajoutez un fichier DOCX, ODT, TXT ou TEI pour prévisualiser les unités avant l'import.</p>
            <div class="imp-conllu-table-wrap">
              <table class="imp-conllu-table" aria-label="Aperçu unités texte">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Type</th>
                    <th>Texte (extrait)</th>
                  </tr>
                </thead>
                <tbody id="imp-text-rows">
                  <tr><td colspan="3" class="empty-hint">Aperçu indisponible.</td></tr>
                </tbody>
              </table>
            </div>
          </section>

          <section class="card" data-collapsible="true" data-collapsed-default="true">
            <h3>Index FTS</h3>
            <p class="hint">Après avoir importé des documents, reconstruisez l'index pour activer la recherche.</p>
            <div class="prep-btn-row">
              <button id="imp-index-btn" class="btn btn-secondary" disabled>Reconstruire l'index</button>
            </div>
          </section>
        </div>
      </div>
      </div>

      <!-- Footer docked at bottom of main prep-pane (above scrolling content) -->
      <div class="imp-footer-bar">
        <div class="imp-footer-meta">
          <span class="hint" style="margin:0">Importe tous les fichiers en attente (profil + options ci-dessus).</span>
        </div>
        <label class="imp-footer-check" title="Si coché : refuse l'import lorsqu'un document avec le même nom de fichier existe déjà dans le corpus (chemins différents inclus).">
          <input type="checkbox" id="imp-check-filename-footer" />
          Bloquer doublons par nom
        </label>
        <div class="prep-btn-row">
          <button id="imp-import-btn" class="btn btn-primary" title="Importer tous les fichiers en attente" aria-label="Importer tous les fichiers en attente" disabled>⬆ Importer</button>
        </div>
      </div>
    `;
}
