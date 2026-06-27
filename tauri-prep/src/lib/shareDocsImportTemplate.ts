/**
 * shareDocsImportTemplate.ts - static HTML skeleton of the ShareDocs (WebDAV)
 * import screen, extracted from ShareDocsImportScreen.render() (U-02). Mirrors
 * the importScreenTemplate.ts pattern: quasi-static, the only substitutions are
 * the default-profile constants WP_DEFAULT_* (mode-selector option values).
 * Injected via the trusted sink setHtml(root, raw(...)). Moved byte-identical.
 */
import { WP_DEFAULT_NUMBERED, WP_DEFAULT_PARAGRAPHS } from "./importDetect.ts";

export function shareDocsImportTemplate(): string {
  return `
      <div class="prep-sd-wrap">
        <h2 class="prep-sd-title">Importer depuis ShareDocs (WebDAV)</h2>
        <p class="prep-sd-intro">Parcourez un dépôt WebDAV (ShareDocs Huma-Num…) et ingérez un dossier entier.
          La base reste strictement locale — rien n'est ré-écrit côté serveur.</p>

        <section class="prep-sd-card">
          <h3 class="prep-sd-card-title">1. Connexion</h3>
          <label class="prep-sd-field"><span>URL du dossier</span>
            <input type="text" id="prep-sd-url" autocomplete="off" spellcheck="false"
              placeholder="https://serveur/remote.php/dav/files/utilisateur/dossier/" />
          </label>
          <p class="prep-sd-help">Adresse WebDAV du <strong>dossier</strong> à importer (pas un fichier).
            Sur ShareDocs / Nextcloud, c'est le lien <code>…/remote.php/dav/files/&lt;vous&gt;/&lt;dossier&gt;/</code>.</p>
          <button type="button" id="prep-sd-preset-btn" class="prep-sd-btn prep-sd-btn--ghost prep-sd-preset-btn">↧ Préremplir l'URL racine (Huma-Num / Nextcloud)</button>
          <div id="prep-sd-preset-confirm" class="prep-sd-preset-confirm"></div>
          <p class="prep-sd-help">Astuce : mets juste le <strong>serveur</strong> dans le champ URL (ex. <code>dav.huma-num.fr</code>)
            et ton identifiant ci-dessous, puis ce bouton construit l'URL racine de ton espace — tu navigues ensuite jusqu'au dossier voulu.</p>
          <label class="prep-sd-field"><span>Authentification</span>
            <select id="prep-sd-auth-mode">
              <option value="anonymous">Anonyme — dépôt public</option>
              <option value="basic">Identifiant + mot de passe</option>
              <option value="bearer">Jeton d'accès (Bearer)</option>
            </select>
          </label>
          <div id="prep-sd-basic-fields" class="prep-sd-creds" style="display:none">
            <label class="prep-sd-field"><span>Identifiant</span><input type="text" id="prep-sd-user" autocomplete="off" /></label>
            <label class="prep-sd-field"><span>Mot de passe</span><input type="password" id="prep-sd-password" autocomplete="off" /></label>
            <p class="prep-sd-note">ShareDocs Huma-Num via humanID / 2FA : le mot de passe de connexion habituel est
              souvent refusé en WebDAV. Générez un « mot de passe d'application » dans Nextcloud
              (Réglages → Sécurité → Mots de passe d'application) et collez-le ici.</p>
          </div>
          <div id="prep-sd-bearer-fields" class="prep-sd-creds" style="display:none">
            <label class="prep-sd-field"><span>Jeton</span><input type="password" id="prep-sd-token" autocomplete="off" /></label>
          </div>
          <label class="prep-sd-remember">
            <input type="checkbox" id="prep-sd-remember" />
            <span>Se souvenir de mes identifiants (chiffrés par le système)</span>
          </label>
          <p class="prep-sd-note">🔒 Si « Se souvenir » est coché, le secret est conservé dans le trousseau du système
            (jamais en clair sur le disque) ; sinon il n'est gardé que pour cette session.
            <button type="button" id="prep-sd-forget-btn" class="prep-sd-forget">Oublier les identifiants mémorisés</button>
          </p>
          <button type="button" id="prep-sd-connect-btn" class="prep-sd-btn prep-sd-btn--primary">Connecter</button>
        </section>

        <section class="prep-sd-card" id="prep-sd-folder-section" style="display:none">
          <h3 class="prep-sd-card-title">2. Dossier</h3>
          <div class="prep-sd-crumb">
            <button type="button" id="prep-sd-up-btn" class="prep-sd-btn prep-sd-btn--ghost" disabled>← Retour</button>
            <code id="prep-sd-current-url" class="prep-sd-current-url"></code>
          </div>
          <p class="prep-sd-help">Coche des dossiers et/ou des fichiers (la sélection se conserve quand tu navigues),
            puis « Importer la sélection ». « Importer ce dossier » ingère le dossier courant : chaque fichier est
            importé avec son format (extension) et sa langue (nom du fichier) ; les extensions inconnues sont ignorées.</p>
          <div id="prep-sd-entries" class="prep-sd-entries"></div>
          <div id="prep-sd-selection" class="prep-sd-selection" style="display:none">
            <span id="prep-sd-sel-count" class="prep-sd-sel-count"></span>
            <button type="button" id="prep-sd-sel-clear" class="prep-sd-btn prep-sd-btn--ghost">Vider</button>
            <button type="button" id="prep-sd-sel-import" class="prep-sd-btn prep-sd-btn--primary">Importer la sélection</button>
          </div>
          <div id="prep-sd-sel-list" class="prep-sd-sel-list"></div>
          <div id="prep-sd-sel-confirm" class="prep-sd-sel-confirm"></div>
          <div class="prep-sd-import-controls">
            <label class="prep-sd-field"><span>Profil par défaut (style)</span>
              <select id="prep-sd-profile">
                <option value="${WP_DEFAULT_NUMBERED}" selected>Lignes numérotées [n]</option>
                <option value="${WP_DEFAULT_PARAGRAPHS}">Paragraphes</option>
              </select>
            </label>
            <label class="prep-sd-field"><span>Langue par défaut (si non détectée)</span><input type="text" id="prep-sd-language" placeholder="fr" /></label>
            <button type="button" id="prep-sd-import-btn" class="prep-sd-btn prep-sd-btn--primary">Importer ce dossier</button>
          </div>
          <div id="prep-sd-import-confirm" class="prep-sd-sel-confirm"></div>
        </section>

        <section class="prep-sd-card" id="prep-sd-report-section" style="display:none">
          <h3 class="prep-sd-card-title">3. Rapport</h3>
          <div id="prep-sd-report"></div>
        </section>
      </div>
    `;
}
