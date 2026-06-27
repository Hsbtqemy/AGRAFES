/**
 * importFamilyDetectionTemplate.ts - pure HTML builder for the auto-detected
 * "familles" banner in ImportScreen, extracted from
 * ImportScreen._renderFamilyDetectionBanner (U-02). The host keeps ALL DOM
 * wiring (remove-existing / createElement / setHtml(raw(...)) / insertAdjacentElement);
 * this builds only the inner HTML from the detected groups. Moved byte-identical.
 */
import { escHtml as _escHtml } from "./diff.ts";
import type { FamilyGroup } from "./familyDetect.ts";

export function buildFamilyDetectionBannerHtml(groups: FamilyGroup[]): string {
  return `
      <div class="prep-imp-family-banner-head">
        <span class="prep-imp-family-banner-icon">🔗</span>
        <div>
          <strong>Familles détectées automatiquement</strong>
          <span class="chip">${groups.length} groupe${groups.length > 1 ? "s" : ""}</span>
        </div>
      </div>
      <p class="prep-imp-family-banner-desc">
        Des fichiers partagent le même radical avec des suffixes de langue.
        Après l'import, ils pourront être rattachés en famille automatiquement.
      </p>
      ${groups.map((g, gi) => `
        <div class="prep-imp-family-group">
          <div class="prep-imp-family-group-head">
            Groupe ${gi + 1} — <code>${_escHtml(g.stem)}</code>
          </div>
          <div class="prep-imp-family-group-files">
            ${g.files.map(f => {
              const fname = f.path.replace(/\\/g, "/").split("/").pop() ?? f.path;
              return `<span class="chip">${_escHtml(fname)} <em>[${_escHtml(f.lang.toUpperCase())}]</em></span>`;
            }).join("")}
          </div>
          <div class="prep-imp-family-group-action">
            <label>Original&nbsp;:&nbsp;
              <select class="prep-imp-family-pivot-sel" data-group="${gi}">
                ${g.files.map(f => {
                  const fname = f.path.replace(/\\/g, "/").split("/").pop() ?? f.path;
                  return `<option value="${_escHtml(f.path)}">${_escHtml(fname)} [${_escHtml(f.lang.toUpperCase())}]</option>`;
                }).join("")}
              </select>
            </label>
          </div>
        </div>
      `).join("")}
      <p class="prep-imp-family-banner-note">
        Les relations seront proposées dans la dialog post-import de chaque fichier enfant.
      </p>
    `;
}
