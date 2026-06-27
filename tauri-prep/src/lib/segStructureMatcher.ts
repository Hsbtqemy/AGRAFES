/**
 * segStructureMatcher.ts — scaffold HTML du matcher de structure (colonnes
 * Référence / Document courant + barre d'outils + footer), extrait de
 * SegmentationView._renderStructureDiff (U-02).
 *
 * Builder pur : la vue calcule les sections (structureSections) et garde tout le
 * câblage interactif (cartes du matcher, reset, propagation) ; ce module ne produit
 * que le squelette. Injecté via le sink sûr setHtml(raw(...)).
 */

import { escHtml as _escHtml } from "./diff.ts";
import type { DocumentRecord } from "./sidecarClient.ts";

/** Squelette du matcher pour un couple (référence *refDoc*, courant *curDoc*). */
export function segStructureMatcherHtml(
  refDoc: DocumentRecord | undefined,
  refDocId: number,
  curDoc: DocumentRecord | undefined,
  docId: number,
  res: { ref_sections: readonly unknown[]; target_sections: readonly unknown[] },
): string {
  return `
        <div class="prep-matcher-root">
          <div class="prep-matcher-toolbar">
            <span class="prep-matcher-hint" id="act-matcher-hint"></span>
            <button type="button" class="btn btn-ghost btn-sm" id="act-matcher-reset" title="Revenir à l'appariement positionnel par défaut">&#8635; Réinitialiser</button>
          </div>
          <div class="prep-matcher-cols">
            <div class="prep-matcher-col-head">
              <span class="prep-matcher-col-title">Référence — ${_escHtml(refDoc?.title ?? `#${refDocId}`)}</span>
              <span class="prep-matcher-col-count">${res.ref_sections.length} section${res.ref_sections.length !== 1 ? "s" : ""}</span>
            </div>
            <div class="prep-matcher-col-head">
              <span class="prep-matcher-col-title">Document courant — ${_escHtml(curDoc?.title ?? `#${docId}`)}</span>
              <span class="prep-matcher-col-count">${res.target_sections.length} section${res.target_sections.length !== 1 ? "s" : ""}</span>
            </div>
            <div class="prep-matcher-col" id="act-matcher-ref"></div>
            <div class="prep-matcher-col" id="act-matcher-tgt"></div>
          </div>
          <div id="act-matcher-undo-bar" class="prep-matcher-undo-bar" style="display:none"></div>
          <div class="prep-matcher-footer">
            <button type="button" class="btn btn-primary btn-sm" id="act-strucdiff-propagate-btn">
              &#9654; Aperçu propagé
            </button>
          </div>
          <div id="act-strucdiff-propagate-result"></div>
        </div>
      `;
}
