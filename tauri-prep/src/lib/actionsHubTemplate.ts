/**
 * actionsHubTemplate — le balisage statique du hub Actions (ActionsScreen._renderHubPanel).
 *
 * ACT-01 — « action d'abord » : les quatre cartes ne sont plus les étapes numérotées d'un
 * pipeline mais quatre FILTRES. Chacune annonce combien de documents elle concerne encore
 * et réduit la liste à ceux-là ; on choisit ensuite un document dans la liste réduite.
 * La numérotation « Étape 1 / 2 / 3 / Optionnel » a disparu : elle décrivait un ordre que
 * DESIGN_peritext_conventions §0 contredit — les documents arrivent à n'importe quel
 * stade et les capacités sont indépendantes. Le compte de restants prend sa place, et
 * c'est lui qui donne son travail à la carte.
 *
 * Les comptes et l'état du filtre sont peints par ActionsScreen (`#act-hub-count-<step>`,
 * `#act-hub-filter-<step>`) : ce fichier reste sans interpolation, injecté via
 * setHtml(el, raw(actionsHubTemplate())).
 */
export function actionsHubTemplate(): string {
  return `
      <section class="card prep-acts-hub-docs-card">
        <div class="prep-acts-hub-docs-header">
          <h2 class="prep-acts-hub-docs-title">Documents du corpus</h2>
          <div class="prep-acts-hub-docs-tools">
            <button id="act-hub-refresh-btn" class="btn btn-secondary btn-sm"
              title="Re-charger la liste des documents et propager aux sous-vues (Curation, Segmentation, Alignement, Annotation)">&#8634; Actualiser</button>
            <button id="act-hub-hierarchy-btn" class="btn btn-secondary btn-sm"
              aria-pressed="false" title="Basculer vue hi&eacute;rarchie / liste">&#127807; Hi&eacute;rarchie</button>
          </div>
        </div>
        <p id="act-hub-filter-strip" class="prep-acts-hub-filter-strip" aria-live="polite" hidden>
          <span id="act-hub-filter-label" class="prep-acts-hub-filter-label"></span>
          <button type="button" id="act-hub-filter-clear" class="prep-acts-hub-filter-clear">Tout afficher</button>
        </p>
        <div id="act-doc-list" class="prep-acts-hub-doc-list"></div>
      </section>
      <div class="prep-acts-hub-workspace">
        <div class="card prep-acts-hub-wf-card" data-step="curation">
          <div class="prep-acts-hub-wf-top">
            <span class="prep-acts-hub-wf-icon" aria-hidden="true">&#10002;</span>
            <span class="prep-acts-hub-wf-count" id="act-hub-count-curation"></span>
          </div>
          <h3 class="prep-acts-hub-wf-title">Curation</h3>
          <p class="prep-acts-hub-wf-desc">Nettoyage et normalisation du texte brut. Applique des r&egrave;gles regex sur les documents sources.</p>
          <div class="prep-acts-hub-wf-actions">
            <button type="button" class="prep-acts-hub-wf-btn prep-acts-hub-wf-filter"
                    id="act-hub-filter-curation" data-step="curation" aria-pressed="false"></button>
            <button type="button" class="prep-acts-hub-wf-btn prep-acts-hub-wf-btn--secondary" data-target="curation">Ouvrir &rarr;</button>
          </div>
        </div>
        <div class="card prep-acts-hub-wf-card" data-step="segmentation">
          <div class="prep-acts-hub-wf-top">
            <span class="prep-acts-hub-wf-icon" aria-hidden="true">&#9889;</span>
            <span class="prep-acts-hub-wf-count" id="act-hub-count-segmentation"></span>
          </div>
          <h3 class="prep-acts-hub-wf-title">Segmentation</h3>
          <p class="prep-acts-hub-wf-desc">D&eacute;coupage du texte en unit&eacute;s. Un document encore d&rsquo;un seul tenant reste &agrave; d&eacute;couper.</p>
          <div class="prep-acts-hub-wf-actions">
            <button type="button" class="prep-acts-hub-wf-btn prep-acts-hub-wf-filter"
                    id="act-hub-filter-segmentation" data-step="segmentation" aria-pressed="false"></button>
            <button type="button" class="prep-acts-hub-wf-btn prep-acts-hub-wf-btn--secondary" data-target="segmentation">Ouvrir &rarr;</button>
          </div>
        </div>
        <div class="card prep-acts-hub-wf-card" data-step="alignement">
          <div class="prep-acts-hub-wf-top">
            <span class="prep-acts-hub-wf-icon" aria-hidden="true">&#8644;</span>
            <span class="prep-acts-hub-wf-count" id="act-hub-count-alignement"></span>
          </div>
          <h3 class="prep-acts-hub-wf-title">Alignement</h3>
          <p class="prep-acts-hub-wf-desc">La forme align&eacute;e du corpus en matrice&#160;: une ligne par segment de l&rsquo;original, une colonne par langue.</p>
          <div class="prep-acts-hub-wf-actions">
            <button type="button" class="prep-acts-hub-wf-btn prep-acts-hub-wf-filter"
                    id="act-hub-filter-alignement" data-step="alignement" aria-pressed="false"></button>
            <button type="button" class="prep-acts-hub-wf-btn prep-acts-hub-wf-btn--secondary" data-target="matrice">Ouvrir &rarr;</button>
            <button type="button" class="prep-acts-hub-wf-btn prep-acts-hub-wf-btn--secondary" data-target="alignement"
                    title="Revue statut / collisions / qualit&eacute; lien par lien">Contr&ocirc;le</button>
          </div>
        </div>
        <div class="card prep-acts-hub-wf-card" data-step="annotation">
          <div class="prep-acts-hub-wf-top">
            <span class="prep-acts-hub-wf-icon" aria-hidden="true">&#9000;</span>
            <span class="prep-acts-hub-wf-count" id="act-hub-count-annotation"></span>
          </div>
          <h3 class="prep-acts-hub-wf-title">Annotation</h3>
          <p class="prep-acts-hub-wf-desc">Vue interlin&eacute;aire (mot / POS / lemme) par document. Annotation spaCy automatique et correction manuelle.</p>
          <div class="prep-acts-hub-wf-actions">
            <button type="button" class="prep-acts-hub-wf-btn prep-acts-hub-wf-filter"
                    id="act-hub-filter-annotation" data-step="annotation" aria-pressed="false"></button>
            <button type="button" class="prep-acts-hub-wf-btn prep-acts-hub-wf-btn--secondary" data-target="annoter">Ouvrir &rarr;</button>
          </div>
        </div>
      </div>
    `;
}
