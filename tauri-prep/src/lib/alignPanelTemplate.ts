/**
 * alignPanelTemplate.ts — squelette HTML statique de l'écran AlignPanel, extrait de
 * AlignPanel._html() (U-02).
 *
 * Pur et sans interpolation : tout le contenu dynamique est rempli ensuite par
 * render() + _bindEvents. Injecté via le sink sûr setHtml(raw(...)).
 */

export function alignPanelTemplate(): string {
    return `
<div class="prep-align-root">

  <!-- ═══ Bannière « source modifiée » (Tier A #6) ═══ -->
  <div id="align-source-changed-banner" class="prep-align-src-changed-banner" style="display:none" role="status"></div>

  <!-- ═══ Barre supérieure : paire + run ═══ -->
  <div class="prep-align-topbar">
    <div class="prep-align-pair-group">
      <label class="prep-align-pair-label">Pivot
        <select id="align-pivot-sel" class="prep-align-pair-sel">
          <option value="">— choisir —</option>
        </select>
      </label>
      <span class="prep-align-pair-arrow" aria-hidden="true">&#8596;</span>
      <label class="prep-align-pair-label">Cible
        <select id="align-target-sel" class="prep-align-pair-sel">
          <option value="">— choisir —</option>
        </select>
      </label>
      <button id="align-load-btn" class="btn btn-sm btn-secondary" disabled>Charger</button>
    </div>
    <div class="prep-align-topbar-run">
      <button id="align-run-btn" class="btn btn-sm prep-btn-warning" disabled>&#9889; Auto-aligner</button>
      <button id="align-run-options-toggle" class="btn btn-sm btn-ghost" title="Options d&#39;alignement">&#9881;</button>
    </div>
    <div class="prep-align-topbar-filters">
      <div class="prep-align-filter-chips" role="group" aria-label="Filtre statut">
        <button class="chip active" data-qf="all">Tout</button>
        <button class="chip" data-qf="accepted">&#10003; Accept&#233;s</button>
        <button class="chip" data-qf="rejected">&#10007; Rejet&#233;s</button>
        <button class="chip" data-qf="unreviewed">? Non r&#233;vis&#233;s</button>
      </div>
      <input id="align-text-filter" class="prep-align-search" type="search" placeholder="Rechercher&#8230;" autocomplete="off">
      <button id="align-audit-next-btn" class="btn btn-sm btn-ghost" title="Lien suivant &#224; revoir">&#8595; Suivant</button>
      <button id="align-orphan-toggle" class="btn btn-sm btn-ghost" title="Afficher les segments pivot sans lien" disabled>&#9651; Orphelins</button>
    </div>
    <div id="align-topbar-kpi" class="prep-align-topbar-kpi" style="display:none"></div>
  </div>

  <!-- ═══ Panneau d'options run (disclosure) ═══ -->
  <div id="align-run-options" class="prep-align-run-options" style="display:none">
    <div class="prep-align-run-options-row">
      <label class="prep-align-run-opt-field">Strat&#233;gie
        <select id="align-strategy-sel" class="prep-align-select">
          <option value="external_id">external_id</option>
          <option value="external_id_then_position" selected>external_id &#8594; position</option>
          <option value="position">position</option>
          <option value="similarity">similarit&#233;</option>
          <option value="length_bounded">longueurs &#182; (Gale&#8211;Church)</option>
        </select>
      </label>
      <div id="align-sim-row" class="prep-align-run-opt-field" style="display:none">
        <label>Seuil
          <input id="align-sim-threshold" type="number" class="prep-align-input-num"
                 min="0" max="1" step="0.05" value="0.8"/>
        </label>
      </div>
      <label class="prep-align-check-label">
        <input id="align-preserve-accepted" type="checkbox" checked/>
        Conserver les liens valid&#233;s
      </label>
      <label class="prep-align-check-label">
        <input id="align-debug-cb" type="checkbox"/>
        Debug
      </label>
      <button id="align-recalc-btn" class="btn btn-sm btn-secondary" disabled>&#8635; Recalcul global</button>
    </div>
    <div class="prep-align-run-options-row prep-align-run-options-family">
      <label class="prep-align-run-opt-field" style="flex:1">Par famille
        <div style="display:flex;gap:6px;align-items:center">
          <select id="align-family-sel" class="prep-align-select" style="flex:1">
            <option value="">&#8212; choisir une famille &#8212;</option>
          </select>
          <button id="align-family-refresh" class="btn btn-sm btn-ghost" title="Rafra&#238;chir">&#8635;</button>
          <button id="align-family-run-btn" class="btn btn-sm prep-btn-warning" disabled>&#9889; Aligner famille</button>
          <button id="align-family-review-btn" class="btn btn-sm btn-secondary" disabled>&#9998; R&#233;viser famille</button>
        </div>
      </label>
      <div id="align-family-stats" class="prep-align-family-stats"></div>
    </div>
  </div>

  <!-- ═══ Confirmation inline ═══ -->
  <div id="align-confirm-banner" class="prep-align-confirm-banner" style="display:none">
    <div id="align-confirm-msg" class="prep-align-confirm-msg"></div>
    <div class="prep-align-confirm-btns">
      <button id="align-confirm-ok" class="btn prep-btn-warning btn-sm">&#9658; Confirmer</button>
      <button id="align-confirm-cancel" class="btn btn-ghost btn-sm">Annuler</button>
    </div>
  </div>

  <!-- ═══ Progression ═══ -->
  <div id="align-progress-area" class="prep-align-progress-area" style="display:none">
    <div class="prep-align-progress-spinner">&#9203;</div>
    <div id="align-progress-msg" class="prep-align-progress-msg">Alignement en cours&#8230;</div>
  </div>

  <!-- ═══ R&#233;sum&#233; KPI apr&#232;s run ═══ -->
  <div id="align-summary" class="prep-align-summary" style="display:none">
    <div class="prep-align-summary-head">
      <span class="prep-align-summary-title">R&#233;sultats du run</span>
      <button id="align-summary-close" class="btn btn-ghost btn-sm" title="Fermer">&#10005;</button>
    </div>
    <div id="align-summary-banner" class="prep-align-summary-banner"></div>
    <div class="prep-align-kpi-row">
      <div class="prep-align-kpi-card">
        <div class="prep-align-kpi-val" id="align-kpi-created">&#8212;</div>
        <div class="prep-align-kpi-lbl">Cr&#233;&#233;s</div>
      </div>
      <div class="prep-align-kpi-card">
        <div class="prep-align-kpi-val" id="align-kpi-skipped">&#8212;</div>
        <div class="prep-align-kpi-lbl">Ignor&#233;s</div>
      </div>
      <div class="prep-align-kpi-card prep-align-kpi-card--coverage" id="align-kpi-coverage-wrap"
           title="Part des segments pivot ayant au moins un lien. &#8805; 90&#160;% = bon&#160;; &#8805; 60&#160;% = acceptable.">
        <div class="prep-align-kpi-val" id="align-kpi-coverage">&#8230;</div>
        <div class="prep-align-kpi-lbl">Couverture</div>
      </div>
    </div>
    <div id="align-summary-per-target" class="prep-align-summary-per-target"></div>
    <details id="align-quality-details" class="prep-align-quality-details" style="display:none">
      <summary class="prep-align-quality-details-summary">D&#233;tails qualit&#233; &#9658;</summary>
      <div id="align-quality-details-body" class="prep-align-quality-details-body"></div>
    </details>
  </div>

  <!-- ═══ Éditeur bitext ═══ -->
  <div class="prep-align-bitext" id="align-bitext">
    <div class="prep-align-bitext-head">
      <div class="prep-align-bitext-check">
        <input type="checkbox" id="align-check-all" title="Tout s&#233;lectionner">
      </div>
      <div class="prep-align-bitext-col-head" id="align-col-pivot-title">Pivot</div>
      <div class="prep-align-bitext-col-head" id="align-col-target-title">Cible</div>
      <div class="prep-align-bitext-col-actions"></div>
    </div>
    <div id="align-bitext-body">
      <p class="empty-hint">S&#233;lectionnez un pivot et une cible, puis cliquez sur Charger.</p>
    </div>
    <div class="prep-align-bitext-foot" id="align-bitext-foot" style="display:none">
      <span id="align-audit-stats" class="prep-align-audit-stats"></span>
      <button id="align-audit-more-btn" class="btn btn-sm btn-secondary" style="display:none">Charger plus</button>
    </div>
  </div>

  <!-- ═══ Orphelins pivot (segments sans lien) ═══ -->
  <div id="align-orphan-section" class="prep-align-orphan-section" style="display:none">
    <div class="prep-align-coll-section-head">
      <span class="prep-align-coll-section-title">&#9651; Segments pivot sans lien</span>
      <button id="align-orphan-close" class="btn btn-ghost btn-sm" title="Fermer">&#10005;</button>
    </div>
    <p class="hint" style="margin:0.3rem 0 0.6rem">Segments du pivot qui n&#8217;ont aucun lien dans la paire active. Cliquez &#8629; pour cr&#233;er un lien.</p>
    <div id="align-orphan-body"></div>
  </div>

  <!-- ═══ Vue famille multi-colonnes ═══ -->
  <div id="align-family-bitext" class="prep-fam-bitext" style="display:none">
    <div class="prep-fam-bitext-head">
      <span id="align-family-bitext-title" class="prep-fam-bitext-title"></span>
      <div class="prep-fam-bitext-actions">
        <button id="align-family-more-btn" class="btn btn-sm btn-secondary" style="display:none">Charger plus</button>
        <button id="align-family-close-btn" class="btn btn-sm btn-ghost" title="Fermer la vue famille">&#10005; Fermer</button>
      </div>
    </div>
    <div id="align-family-bitext-body"></div>
  </div>

  <!-- ═══ Barre d'actions en lot ═══ -->
  <div id="align-batch-bar" class="prep-align-batch-bar" style="display:none">
    <span id="align-batch-count">0 s&#233;lectionn&#233;(s)</span>
    <button id="align-batch-accept" class="btn btn-sm btn-secondary">&#10003; Accepter</button>
    <button id="align-batch-reject" class="btn btn-sm btn-secondary">&#10007; Rejeter</button>
    <button id="align-batch-unreview" class="btn btn-sm btn-secondary">? Non r&#233;vis&#233;</button>
    <button id="align-batch-delete" class="btn btn-sm btn-danger">Supprimer</button>
  </div>

  <!-- ═══ Résolution des collisions (affiché via le badge KPI) ═══ -->
  <div id="align-coll-section" class="prep-align-coll-section" style="display:none">
    <div class="prep-align-coll-section-head">
      <span class="prep-align-coll-section-title">&#9888; Collisions d&#8217;alignement</span>
      <button id="align-coll-close" class="btn btn-ghost btn-sm" title="Fermer">&#10005;</button>
    </div>
    <p class="hint" style="margin:0.3rem 0 0.6rem">Un pivot li&#233; &#224; plusieurs segments dans le m&#234;me document cible est une collision. La paire active est utilis&#233;e automatiquement.</p>
    <div>
      <button id="align-coll-load-btn" class="btn btn-secondary btn-sm">Rafra&#238;chir les collisions</button>
    </div>
    <div id="align-coll-result" style="display:none;margin-top:0.75rem"></div>
    <div id="align-coll-more-wrap" style="display:none;margin-top:0.5rem;text-align:center">
      <button id="align-coll-more-btn" class="btn btn-sm btn-secondary">Charger plus</button>
    </div>
  </div>

</div>
    `;
}
