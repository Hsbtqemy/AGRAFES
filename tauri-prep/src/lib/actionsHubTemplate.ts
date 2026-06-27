/**
 * actionsHubTemplate — static markup for ActionsScreen._renderHubPanel (the
 * Actions hub: corpus docs list + Curation/Segmentation/Alignement/Annotation
 * workflow cards). Extracted verbatim (0 interpolation) as part of the U-02
 * dégraissage; injected via setHtml(el, raw(actionsHubTemplate())).
 */
export function actionsHubTemplate(): string {
  return `
      <section class="prep-acts-hub-head-card">
        <div class="prep-acts-hub-head-left">
          <h2 class="prep-acts-hub-head-title">
            Traitement de corpus
            <button type="button" id="act-hub-refresh-corpus-btn" class="btn btn-secondary btn-sm"
                    title="Re-charger la liste des documents et propager aux sous-vues (Curation, Segmentation, Alignement, Annotation)"
                    style="margin-left:0.6rem;vertical-align:middle">&#8634; Actualiser</button>
          </h2>
          <p class="prep-acts-hub-head-desc">Curation &middot; Segmentation &middot; Alignement &mdash; pilotage des op&eacute;rations de pr&eacute;paration du corpus.</p>
        </div>
        <div class="prep-acts-hub-head-tools"></div>
      </section>
      <section class="card prep-acts-hub-docs-card">
        <div class="prep-acts-hub-docs-header">
          <h3 class="prep-acts-hub-docs-title">Documents du corpus</h3>
          <button id="act-hub-refresh-btn" class="btn btn-secondary btn-sm"
            title="Actualiser la liste des documents">↺</button>
          <button id="act-hub-hierarchy-btn" class="btn btn-secondary btn-sm"
            aria-pressed="false" title="Basculer vue hiérarchie / liste">🌿 Hiérarchie</button>
        </div>
        <div id="act-doc-list" class="prep-acts-hub-doc-list"></div>
      </section>
      <div class="prep-acts-hub-workspace">
        <div class="card prep-acts-hub-wf-card">
          <div class="prep-acts-hub-wf-top">
            <span class="prep-acts-hub-wf-icon" aria-hidden="true">&#10002;</span>
            <span class="prep-acts-hub-wf-step">&Eacute;tape 1</span>
          </div>
          <h3 class="prep-acts-hub-wf-title">Curation</h3>
          <p class="prep-acts-hub-wf-desc">Nettoyage et normalisation du texte brut. Applique des r&egrave;gles regex sur les documents sources avant segmentation.</p>
          <div class="prep-acts-hub-wf-actions">
            <button class="prep-acts-hub-wf-btn" data-target="curation">Ouvrir &rarr;</button>
          </div>
        </div>
        <div class="card prep-acts-hub-wf-card">
          <div class="prep-acts-hub-wf-top">
            <span class="prep-acts-hub-wf-icon" aria-hidden="true">&#9889;</span>
            <span class="prep-acts-hub-wf-step">&Eacute;tape 2</span>
          </div>
          <h3 class="prep-acts-hub-wf-title">Segmentation</h3>
          <p class="prep-acts-hub-wf-desc">D&eacute;coupage du corpus en unit&eacute;s traductionnelles pivot et cibles. G&eacute;n&egrave;re les segments pour l&rsquo;alignement automatique.</p>
          <div class="prep-acts-hub-wf-actions">
            <button class="prep-acts-hub-wf-btn" data-target="segmentation">Ouvrir &rarr;</button>
          </div>
        </div>
        <div class="card prep-acts-hub-wf-card">
          <div class="prep-acts-hub-wf-top">
            <span class="prep-acts-hub-wf-icon" aria-hidden="true">&#8644;</span>
            <span class="prep-acts-hub-wf-step">&Eacute;tape 3</span>
          </div>
          <h3 class="prep-acts-hub-wf-title">Alignement</h3>
          <p class="prep-acts-hub-wf-desc">Cr&eacute;ation et r&eacute;vision des liens pivot &harr; cible entre documents align&eacute;s. Inspection, retarget et r&eacute;solution de collisions.</p>
          <div class="prep-acts-hub-wf-actions">
            <button class="prep-acts-hub-wf-btn" data-target="alignement">Ouvrir &rarr;</button>
          </div>
        </div>
        <div class="card prep-acts-hub-wf-card">
          <div class="prep-acts-hub-wf-top">
            <span class="prep-acts-hub-wf-icon" aria-hidden="true">&#9000;</span>
            <span class="prep-acts-hub-wf-step">Optionnel</span>
          </div>
          <h3 class="prep-acts-hub-wf-title">Annotation</h3>
          <p class="prep-acts-hub-wf-desc">Vue interlin&eacute;aire (mot / POS / lemme) par document. Annotation spaCy automatique et correction manuelle token par token.</p>
          <div class="prep-acts-hub-wf-actions">
            <button class="prep-acts-hub-wf-btn" data-target="annoter">Ouvrir &rarr;</button>
          </div>
        </div>
      </div>
    `;
}
