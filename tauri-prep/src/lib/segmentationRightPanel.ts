/**
 * segmentationRightPanel.ts — HTML du panneau droit de SegmentationView (config de
 * stratégie + onglets de contenu + barre d'actions), extrait de
 * SegmentationView._loadSegRightPanel (U-02).
 *
 * Builder pur paramétré : tout le calcul (reset d'état, conventions, pack/lang,
 * badge de statut, options de calibrage, async relations) reste dans la vue ; ce
 * module ne fait que produire le markup à partir du document + des options déjà
 * calculées. Injecté via le sink sûr setHtml(raw(...)).
 */

import { escHtml as _escHtml } from "./diff.ts";
import type { DocumentRecord } from "./sidecarClient.ts";

export interface SegRightPanelOpts {
  /** Langue courante (champ #act-seg-lang), pré-remplie. */
  lang: string;
  /** Pack d'abréviations sélectionné (#act-seg-pack). */
  pack: string;
  /** Badge de statut workflow, HTML déjà construit + échappé. */
  statusBadge: string;
  /** <option>… du sélecteur « Calibrer sur », HTML déjà construit + échappé. */
  calibrateOptions: string;
  /** Le document a-t-il déjà des unités en base (active les onglets Modifier/Diff/Valider). */
  savedAlready: boolean;
}

/** Markup du panneau droit pour *doc* + *opts* (aucun effet de bord). */
export function segRightPanelHtml(doc: DocumentRecord, opts: SegRightPanelOpts): string {
  const { lang, pack, statusBadge, calibrateOptions, savedAlready } = opts;
  return `
      <div class="prep-seg-right-root" id="act-seg-right-root">
        <div class="prep-seg-right-scroll">
        <div class="prep-seg-right-header">
          <div class="prep-seg-right-header-main">
            <h3 class="prep-seg-right-doc-title">${_escHtml(doc.title)}</h3>
            ${statusBadge}
          </div>
          <div class="prep-seg-right-header-meta">#${doc.doc_id} &middot; ${_escHtml(doc.language)} &middot; ${doc.unit_count} unit&#233;s</div>
        </div>
        <div class="prep-seg-config-bar" role="region" aria-label="Strat&#233;gie de segmentation">
          <div class="prep-seg-config-row">
            <div class="prep-seg-config-tabs" role="group" aria-label="Strat&#233;gie">
              <label class="prep-seg-tab-label">
                <input type="radio" name="act-seg-strategy" id="act-seg-strategy-sentences" value="sentences" checked />
                <span>Phrases</span>
              </label>
              <label class="prep-seg-tab-label">
                <input type="radio" name="act-seg-strategy" id="act-seg-strategy-markers" value="markers" />
                <span>Balises&nbsp;<code>[N]</code></span>
              </label>
            </div>
            <div class="prep-seg-config-params">
              <label class="prep-seg-param-field">Langue
                <input id="act-seg-lang" type="text" value="${_escHtml(lang)}" maxlength="10"
                  class="prep-seg-param-input" placeholder="fr, en&#8230;" autocomplete="off" spellcheck="false" />
              </label>
              <div id="act-seg-params-phrases" class="prep-seg-config-params-group">
                <label class="prep-seg-param-field"
                  title="&#201;vite de couper apr&#232;s un point qui suit une abr&#233;viation (M., Dr., ann., chap., etc.).">
                  <span class="prep-seg-param-label-text">O&#249; couper les phrases</span>
                  <select id="act-seg-pack" class="seg-param-select">
                    <option value="auto"${pack === "auto" ? " selected" : ""}>Auto (selon la langue)</option>
                    <option value="fr_strict"${pack === "fr_strict" ? " selected" : ""}>Fran&#231;ais &#8212; liste longue d&#8217;abr&#233;viations</option>
                    <option value="en_strict"${pack === "en_strict" ? " selected" : ""}>Anglais &#8212; liste longue d&#8217;abr&#233;viations</option>
                    <option value="default"${pack === "default" ? " selected" : ""}>Liste courte (moins de protections)</option>
                  </select>
                </label>
              </div>
              <div id="act-seg-params-markers" class="prep-seg-config-params-group" style="display:none">
                <button type="button" class="btn btn-ghost btn-sm" id="act-seg-detect-btn"
                  title="D&#233;tecter les balises [N] dans le texte">&#128270; D&#233;tecter balises</button>
              </div>
              <label class="prep-seg-param-field"
                title="R&#233;f&#233;rence pour calibrer la segmentation (mode phrases) et comparer la structure (onglet Structure).">Calibrer sur
                <select id="act-seg-calibrate" class="seg-param-select">
                  ${calibrateOptions}
                </select>
              </label>
            </div>
          </div>
          <p id="act-seg-strategy-summary" class="prep-seg-strategy-summary" aria-live="polite"></p>
        </div>
        <div id="act-seg-marker-banner" class="prep-seg-marker-banner" style="display:none" aria-live="polite"></div>
        <details class="prep-seg-rule-info" id="act-seg-rule-info">
          <summary class="prep-seg-rule-info-sum">&#9432; Moteur de d&#233;coupage</summary>
          <div class="prep-seg-rule-info-body">
            <p>Le moteur coupe sur <code>.&nbsp;!&nbsp;?</code> suivi d&#8217;un espace puis d&#8217;une <strong>lettre majuscule</strong> (ou guillemet ouvrant).</p>
            <p>&#8594; Si vos phrases d&#233;butent par une minuscule, le moteur ne les d&#233;tectera pas comme d&#233;but de phrase.</p>
            <p>&#8594; Si chaque paragraphe du document est d&#233;j&#224; une phrase, la segmentation retourne le m&#234;me nombre d&#8217;unit&#233;s.</p>
            <p><strong>O&#249; couper les phrases :</strong> les options <em>Fran&#231;ais / Anglais &#8212; liste longue</em> ajoutent des abr&#233;viations prot&#233;g&#233;es (ann., chap., etc.) pour &#233;viter les faux d&#233;coupages apr&#232;s un point.</p>
            <p><strong>Mode balises :</strong> utilisez-le si des motifs <code>[N]</code> sont encore dans <em>le texte des unit&#233;s</em> (ex. import en paragraphes / blocs). Chaque balise devient un <code>external_id</code> pour l&#8217;alignement. Si le document a d&#233;j&#224; &#233;t&#233; import&#233; en <em>lignes num&#233;rot&#233;es [n]</em>, les IDs sont d&#233;j&#224; port&#233;s par les unit&#233;s et ce mode apporte souvent peu de diff&#233;rence.</p>
            <p><strong>Pr&#233;fixe avant <code>[1]</code> :</strong> le texte plac&#233; avant la premi&#232;re balise devient un segment distinct, avec <code>external_id = NULL</code>.</p>
          </div>
        </details>
        <div class="prep-seg-content-section" id="act-seg-content-section">
          <div class="prep-seg-content-head">
            <div class="prep-seg-content-tabs" role="tablist">
              <button class="prep-seg-content-tab active" role="tab" data-pane="preview">
                Aper&#231;u&#160;<span class="prep-seg-preview-badge" id="act-seg-mode-badge">phrases</span>
              </button>
              <button class="prep-seg-content-tab" role="tab" data-pane="saved"
                ${!savedAlready ? 'disabled title="Aucun segment — appliquez d\'abord la segmentation"' : 'title="Éditer les segments : fusionner, couper"'}>
                &#9986; Modifier&#160;<span id="act-seg-saved-count" class="chip">${savedAlready ? doc.unit_count : "&#8212;"}</span>
              </button>
              <button class="prep-seg-content-tab" role="tab" data-pane="diff"
                ${!savedAlready ? 'disabled title="Aucun segment en base"' : 'title="Comparer avant/après re-segmentation"'}>
                &#8644;&#160;Diff
              </button>
              <button class="prep-seg-content-tab" role="tab" data-pane="structure"
                title="Comparer la structure (intertitres) avec le document de référence">
                &#9783;&#160;Structure
              </button>
              <button class="prep-seg-content-tab" role="tab" data-pane="roles"
                title="Assigner des rôles d'unité (conventions) et chercher des unités candidates">
                &#127991;&#160;R&#244;les
              </button>
            </div>
            <span id="act-seg-prev-stats" class="prep-seg-preview-stats"></span>
            <button type="button" class="btn btn-ghost btn-sm" id="act-seg-prev-refresh"
              title="Relancer l&#8217;aper&#231;u">&#8635;</button>
          </div>
          <div id="act-seg-pane-preview" role="tabpanel">
            <div class="prep-seg-preview-split" id="act-seg-preview-split">
              <div>
                <div class="prep-seg-preview-col-title">Brut (<span id="act-seg-prev-raw-count">&#8212;</span> unit&#233;s)</div>
                <div class="prep-seg-preview-col-list" id="act-seg-prev-raw">
                  <p class="empty-hint">Chargement&#8230;</p>
                </div>
              </div>
              <div>
                <div class="prep-seg-preview-col-title">Segment&#233; (<span id="act-seg-prev-seg-count">&#8212;</span> phrases)</div>
                <div class="prep-seg-preview-col-list" id="act-seg-prev-seg">
                  <p class="empty-hint">En attente&#8230;</p>
                </div>
              </div>
            </div>
            <div id="act-seg-prev-warns" class="prep-seg-warn-list" style="display:none"></div>
          </div>
          <div id="act-seg-pane-saved" style="display:none" role="tabpanel">
            <div id="act-seg-saved-table">
              ${savedAlready ? `<p class="empty-hint">Chargement des segments&#8230;</p>` : ""}
            </div>
          </div>
          <div id="act-seg-pane-diff" style="display:none" role="tabpanel">
            <div id="act-seg-diff-content">
              <p class="empty-hint">Basculez sur l&#8217;onglet Diff pour comparer.</p>
            </div>
          </div>
          <div id="act-seg-pane-structure" style="display:none" role="tabpanel">
            <div id="act-seg-structure-content">
              <p class="empty-hint">S&#233;lectionnez un document de r&#233;f&#233;rence dans &#171;&#160;Calibrer sur&#160;&#187; puis ouvrez cet onglet.</p>
            </div>
          </div>
          <div id="act-seg-pane-roles" style="display:none" role="tabpanel">
            <div id="act-seg-roles-content"></div>
          </div>
        </div>
        </div><!-- /.prep-seg-right-scroll -->
        <div class="prep-seg-actions-bar" id="act-seg-actions">
          <button class="btn prep-btn-warning" id="act-seg-btn"
            title="Appliquer la segmentation (efface les liens d&#8217;alignement existants)">Appliquer</button>
          <button class="btn btn-secondary btn-sm" id="act-seg-validate-btn"
            title="Appliquer la segmentation puis valider le document">Appliquer + Valider</button>
          <button class="btn btn-primary btn-sm" id="act-seg-validate-only-btn"
            ${!savedAlready ? "disabled" : ""}>Valider &#10003;</button>
          <button class="btn btn-sm" id="act-seg-goto-annot-btn"
            title="Ouvrir ce document dans le panneau Annotation">Voir&#160;annotation&#160;&#8599;</button>
          <!-- Mode A undo (raccourci clavier reporté à une session ultérieure si l'usage révèle le besoin). -->
          <button class="btn btn-sm prep-btn-undo" id="act-seg-undo-btn"
            title="" disabled>&#8634; Annuler</button>
          <div class="prep-seg-actions-dest">
            Apr&#232;s validation&#160;:
            <select id="act-seg-after-validate" class="seg-param-select prep-seg-param-select-sm">
              <option value="stay">Rester ici</option>
              <option value="next">Doc suivant</option>
              <option value="documents">Onglet Documents</option>
            </select>
          </div>
        </div>
        <div id="act-seg-confirm-bar" class="audit-batch-bar" style="display:none"></div>
        <div id="act-seg-status-banner" class="prep-seg-status-banner prep-runtime-state prep-state-info" aria-live="polite"></div>
      </div>
    `;
}
