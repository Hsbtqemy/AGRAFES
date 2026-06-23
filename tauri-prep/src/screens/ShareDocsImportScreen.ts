/**
 * ShareDocsImportScreen.ts — import depuis un dépôt WebDAV (ShareDocs, Phase 3).
 *
 * Flux : connexion (URL + auth) → POST /webdav/list → navigation dossier →
 * choix mode/langue/filtre → POST /import-remote (job async) → progression via
 * JobCenter → table de rapport par fichier.
 *
 * Aucune logique métier côté front : filtre/dédup/provenance vivent dans le
 * backend (Phases 1-2). Persistance des identifiants (Phase 4A, opt-in « Se
 * souvenir ») : les champs non-secrets (URL, mode, identifiant) vont dans
 * localStorage ; le secret (mot de passe / jeton) va au trousseau OS via
 * credentialStore. Le clair sur disque reste interdit. Cf. DESIGN §9.2.
 */

import type {
  Conn,
  ImportRemoteReport,
  RemoteEntry,
  WebdavAuth,
  WebdavAuthMode,
} from "../lib/sidecarClient.ts";
import { webdavList, importRemote, deleteDocuments } from "../lib/sidecarClient.ts";
import type { JobCenter } from "../components/JobCenter.ts";
import { setHtml, appendHtml, raw, safeHtml } from "../lib/safeHtml.ts";
import {
  WP_DEFAULT_NUMBERED,
  WP_DEFAULT_PARAGRAPHS,
} from "../lib/importDetect.ts";
import {
  authIsComplete,
  authSecret,
  buildNextcloudRoot,
  buildWebdavAuth,
  dedupeDetectedFiles,
  detectImportFile,
  type DetectedImportFile,
  type DetectedImportGroup,
  folderLabel,
  formatRemoteSize,
  groupDetectedFiles,
  isImportRemoteReport,
  keyringAccount,
  mergeReports,
  normalizeFolderUrl,
  routeEntriesToImport,
  safeDecodeUrl,
  type SelectedRemoteItem,
  sortRemoteEntries,
  statusBadgeKind,
  statusLabel,
  summarizeReport,
  urlHasPath,
} from "../lib/shareDocs.ts";
import { inlineConfirm } from "../lib/inlineConfirm.ts";
import {
  clearLastConn,
  loadLastConn,
  saveLastConn,
  secureDelete,
  secureGet,
  secureSet,
} from "../lib/credentialStore.ts";

const SHAREDOCS_CSS = `
  .prep-sharedocs-screen .prep-sd-wrap { max-width: 860px; margin: 0 auto; padding: 1rem 1.25rem 3rem; }
  .prep-sharedocs-screen .prep-sd-title { margin: 0 0 0.25rem; }
  .prep-sharedocs-screen .prep-sd-intro { color: var(--color-muted); margin: 0 0 1rem; font-size: 0.9rem; }
  .prep-sharedocs-screen .prep-sd-card { border: 1px solid var(--color-border, #dbe2ec); border-radius: 8px;
    padding: 1rem 1.1rem; margin-bottom: 1rem; background: var(--color-surface, #fff); }
  .prep-sharedocs-screen .prep-sd-card-title { margin: 0 0 0.75rem; font-size: 0.95rem; }
  .prep-sharedocs-screen .prep-sd-field { display: flex; flex-direction: column; gap: 0.25rem;
    margin-bottom: 0.6rem; font-size: 0.82rem; }
  .prep-sharedocs-screen .prep-sd-field > span { color: var(--color-muted); }
  .prep-sharedocs-screen .prep-sd-field input, .prep-sharedocs-screen .prep-sd-field select {
    padding: 0.4rem 0.5rem; border: 1px solid var(--color-border, #ccd4e0); border-radius: 5px; font-size: 0.85rem; }
  .prep-sharedocs-screen .prep-sd-creds { border-left: 2px solid var(--color-border, #e3e8f0);
    padding-left: 0.75rem; margin: 0 0 0.6rem; }
  .prep-sharedocs-screen .prep-sd-note { font-size: 0.74rem; color: var(--color-muted); margin: 0.2rem 0 0.8rem; }
  .prep-sharedocs-screen .prep-sd-btn { padding: 0.45rem 0.9rem; border-radius: 6px; border: 1px solid transparent;
    cursor: pointer; font-size: 0.85rem; font-weight: 600; }
  .prep-sharedocs-screen .prep-sd-btn--primary { background: var(--color-primary, #2f5fd6); color: #fff; }
  .prep-sharedocs-screen .prep-sd-btn--primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .prep-sharedocs-screen .prep-sd-btn--ghost { background: transparent; border-color: var(--color-border, #ccd4e0);
    color: var(--color-text, #223); }
  .prep-sharedocs-screen .prep-sd-crumb { display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.6rem; }
  .prep-sharedocs-screen .prep-sd-current-url { font-size: 0.78rem; color: var(--color-muted); word-break: break-all; }
  .prep-sharedocs-screen .prep-sd-entries { max-height: 320px; overflow: auto; border: 1px solid var(--color-border, #e3e8f0);
    border-radius: 6px; margin-bottom: 0.9rem; }
  .prep-sharedocs-screen .prep-sd-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
  .prep-sharedocs-screen .prep-sd-table th { text-align: left; padding: 0.4rem 0.6rem; color: var(--color-muted);
    font-weight: 600; border-bottom: 1px solid var(--color-border, #e3e8f0); position: sticky; top: 0;
    background: var(--color-surface, #fff); }
  .prep-sharedocs-screen .prep-sd-table td { padding: 0.35rem 0.6rem; border-bottom: 1px solid var(--color-border, #eef2f7); }
  .prep-sharedocs-screen .prep-sd-folder-link { background: none; border: none; color: var(--color-primary, #2f5fd6);
    cursor: pointer; font-size: 0.82rem; padding: 0; }
  .prep-sharedocs-screen .prep-sd-empty { color: var(--color-muted); padding: 0.8rem; font-size: 0.85rem; }
  .prep-sharedocs-screen .prep-sd-import-controls { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: flex-end; }
  .prep-sharedocs-screen .prep-sd-import-controls .prep-sd-field { flex: 1 1 140px; margin-bottom: 0; }
  .prep-sharedocs-screen .prep-sd-summary { font-weight: 600; margin: 0 0 0.6rem; }
  .prep-sharedocs-screen .prep-sd-badge { display: inline-block; padding: 0.1rem 0.45rem; border-radius: 10px;
    font-size: 0.72rem; font-weight: 700; }
  .prep-sharedocs-screen .prep-sd-badge--ok { background: #d4edda; color: #155724; }
  .prep-sharedocs-screen .prep-sd-badge--warn { background: #fff3cd; color: #856404; }
  .prep-sharedocs-screen .prep-sd-badge--error { background: #f8d7da; color: #721c24; }
  .prep-sharedocs-screen .prep-sd-badge--muted { background: #e9ecef; color: #495057; }
  .prep-sharedocs-screen .prep-sd-help { font-size: 0.74rem; color: var(--color-muted); margin: 0.15rem 0 0; }
  .prep-sharedocs-screen .prep-sd-preset-btn { margin: 0.4rem 0 0.2rem; font-size: 0.78rem; }
  .prep-sharedocs-screen .prep-sd-remember { display: flex; align-items: center; gap: 0.4rem; font-size: 0.8rem;
    margin: 0.2rem 0 0.7rem; }
  .prep-sharedocs-screen .prep-sd-remember input { width: auto; }
  .prep-sharedocs-screen .prep-sd-forget { background: none; border: none; color: var(--color-primary, #2f5fd6);
    cursor: pointer; font-size: 0.74rem; padding: 0; text-decoration: underline; }
  .prep-sharedocs-screen .prep-sd-check-cell { width: 1.6rem; text-align: center; }
  .prep-sharedocs-screen .prep-sd-selection { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap;
    margin: 0.2rem 0 0.5rem; padding: 0.5rem 0.6rem; background: var(--color-surface-alt, #f4f7fb); border-radius: 6px; }
  .prep-sharedocs-screen .prep-sd-sel-count { font-weight: 600; font-size: 0.82rem; }
  .prep-sharedocs-screen .prep-sd-sel-list { font-size: 0.76rem; color: var(--color-muted); margin: 0 0 0.6rem;
    max-height: 110px; overflow: auto; }
  .prep-sharedocs-screen .prep-sd-sel-list ul { margin: 0.2rem 0; padding-left: 1.1rem; }
  .prep-sharedocs-screen .prep-sd-fmt { color: var(--color-muted); font-size: 0.72rem; }
  .prep-sharedocs-screen .prep-sd-mismatch { color: #856404; background: #fff3cd; border-radius: 4px;
    padding: 0 0.3rem; font-size: 0.72rem; font-weight: 600; }
  .prep-sharedocs-screen .prep-sd-sel-confirm, .prep-sharedocs-screen .prep-sd-report-confirm { margin: 0.4rem 0; }
`;

function ensureStyles(): void {
  if (document.getElementById("prep-sd-styles")) return;
  const style = document.createElement("style");
  style.id = "prep-sd-styles";
  style.textContent = SHAREDOCS_CSS; // textContent, not a HTML sink
  document.head.appendChild(style);
}

export class ShareDocsImportScreen {
  private _conn: Conn | null = null;
  private _jobCenter: JobCenter | null = null;
  private _showToast: ((msg: string, isError?: boolean) => void) | null = null;
  private _logEl: HTMLElement | null = null;
  private _root: HTMLElement | null = null;

  /** Working credentials (memory). The non-secret parts may be persisted to
   *  localStorage and the secret to the OS keychain when "remember" is on (P4A). */
  private _auth: WebdavAuth = { mode: "anonymous" };
  private _currentUrl = "";
  private _history: string[] = [];
  private _entries: RemoteEntry[] = [];
  private _report: ImportRemoteReport | null = null;
  private _busy = false;
  /** Accumulative selection cart (P4C), keyed by href, persistent across navigation. */
  private _selected = new Map<string, SelectedRemoteItem>();
  /** True while the remembered secret is being read from the keychain at mount —
   *  keeps "Connecter" disabled so a fast click can't connect with an empty field. */
  private _loadingSecret = false;

  render(): HTMLElement {
    ensureStyles();
    const root = document.createElement("div");
    root.className = "screen prep-sharedocs-screen";
    this._root = root;

    setHtml(
      root,
      raw(`
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
    `),
    );

    root.querySelector("#prep-sd-auth-mode")?.addEventListener("change", () => this._onAuthModeChange());
    root.querySelector("#prep-sd-preset-btn")?.addEventListener("click", () => void this._prefillUrlFromPreset());
    root.querySelector("#prep-sd-connect-btn")?.addEventListener("click", () => void this._connect());
    root.querySelector("#prep-sd-up-btn")?.addEventListener("click", () => void this._goUp());
    root.querySelector("#prep-sd-import-btn")?.addEventListener("click", () => void this._runImport());
    root.querySelector("#prep-sd-entries")?.addEventListener("click", (ev) => this._onEntryClick(ev));
    root.querySelector("#prep-sd-entries")?.addEventListener("change", (ev) => this._onEntryCheck(ev));
    root.querySelector("#prep-sd-sel-clear")?.addEventListener("click", () => this._clearSelection());
    root.querySelector("#prep-sd-sel-import")?.addEventListener("click", () => void this._importSelection());
    root.querySelector("#prep-sd-profile")?.addEventListener("change", () => this._updateSelectionUi());
    root.querySelector("#prep-sd-language")?.addEventListener("input", () => this._updateSelectionUi());
    root.querySelector("#prep-sd-forget-btn")?.addEventListener("click", () => void this._forget());

    this._updateConnectBtn();
    void this._prefillFromStorage();
    return root;
  }

  // ─── Lifecycle (mirrors the other Prep screens) ─────────────────────────────

  setConn(conn: Conn | null): void {
    this._conn = conn;
    this._updateConnectBtn();
  }

  setJobCenter(jc: JobCenter, showToast: (msg: string, isError?: boolean) => void): void {
    this._jobCenter = jc;
    this._showToast = showToast;
  }

  setLogEl(el: HTMLElement): void {
    this._logEl = el;
  }

  // ─── Connection / browsing ──────────────────────────────────────────────────

  /**
   * Run *op* with *triggerSel* disabled for its **whole** duration, optionally
   * gated by an inlineConfirm. Disabling the trigger across the entire async flow
   * (confirm + op) prevents a double-click from re-entering — in particular from
   * opening a second inlineConfirm on the same container (which would capture the
   * first banner as its "original" and restore a stale one). A missing confirm
   * container is treated as "no confirm needed" (proceed). Used by every
   * button→async-confirm flow on this screen so the guard can't be forgotten.
   */
  private async _guardedRun(
    triggerSel: string,
    op: () => Promise<void> | void,
    confirm?: {
      containerSel: string;
      message: string;
      opts?: { confirmLabel?: string; cancelLabel?: string; danger?: boolean };
    },
  ): Promise<void> {
    const btn = this._root?.querySelector<HTMLButtonElement>(triggerSel);
    if (btn) btn.disabled = true;
    try {
      if (confirm) {
        const container = this._root?.querySelector<HTMLElement>(confirm.containerSel);
        if (container) {
          const ok = await inlineConfirm(container, confirm.message, confirm.opts);
          if (!ok) return;
        }
      }
      await op();
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  /**
   * P4B preset: rebuild the URL field as the Nextcloud personal root from whatever
   * host the user typed there + their identifiant. A pure saisie aid — the field
   * stays editable and the connector remains generic WebDAV. Confirms before
   * overwriting a field that already holds a deep path (footgun guard).
   */
  private async _prefillUrlFromPreset(): Promise<void> {
    const urlEl = this._root?.querySelector<HTMLInputElement>("#prep-sd-url");
    const user = this._root?.querySelector<HTMLInputElement>("#prep-sd-user")?.value ?? "";
    const current = urlEl?.value ?? "";
    const root = buildNextcloudRoot(current, user);
    if (!root) {
      this._showToast?.(
        "Renseigne le serveur (champ URL) et ton identifiant pour préremplir l'URL racine",
        true,
      );
      return;
    }
    const overwrite = () => {
      if (urlEl) urlEl.value = root;
      this._showToast?.("URL racine préremplie — navigue jusqu'au dossier voulu");
    };
    // Confirm only when the field already holds a real path (a deep URL the user
    // typed); a bare host → root is overwritten silently.
    const needsConfirm = urlHasPath(current) && current.trim() !== root;
    await this._guardedRun(
      "#prep-sd-preset-btn",
      overwrite,
      needsConfirm
        ? {
            containerSel: "#prep-sd-preset-confirm",
            message: "Le champ URL contient déjà un chemin — le remplacer par l'URL racine ?",
            opts: { confirmLabel: "Remplacer", danger: false },
          }
        : undefined,
    );
  }

  private async _connect(): Promise<void> {
    if (!this._conn) {
      this._showToast?.("Connexion au moteur indisponible", true);
      return;
    }
    const rawUrl = this._root?.querySelector<HTMLInputElement>("#prep-sd-url")?.value ?? "";
    const url = normalizeFolderUrl(rawUrl);
    if (!url) {
      this._showToast?.("Saisissez l'URL d'un dossier WebDAV", true);
      return;
    }
    this._auth = this._readAuthFromForm();
    if (!authIsComplete(this._auth)) {
      this._showToast?.("Identifiants incomplets pour ce mode d'authentification", true);
      return;
    }
    this._history = [];
    const ok = await this._browse(url);
    if (ok) await this._persistConnection(url);
  }

  // ─── Persistance des identifiants (Phase 4A) ────────────────────────────────

  /**
   * Au montage : préremplir les champs non-secrets depuis localStorage, puis le
   * secret depuis le trousseau OS si « Se souvenir » était actif. Best-effort —
   * ne lève jamais (trousseau indisponible ⇒ champ secret laissé vide).
   */
  private async _prefillFromStorage(): Promise<void> {
    const last = loadLastConn();
    const root = this._root;
    if (!last || !root) return;
    const set = (sel: string, val: string) => {
      const el = root.querySelector<HTMLInputElement>(sel);
      if (el) el.value = val;
    };
    set("#prep-sd-url", last.url);
    const modeEl = root.querySelector<HTMLSelectElement>("#prep-sd-auth-mode");
    if (modeEl) modeEl.value = last.mode;
    set("#prep-sd-user", last.user);
    const rememberEl = root.querySelector<HTMLInputElement>("#prep-sd-remember");
    if (rememberEl) rememberEl.checked = last.remember;
    this._onAuthModeChange();

    if (!last.remember || last.mode === "anonymous") return;
    // Keep "Connecter" disabled while the remembered secret loads from the keychain,
    // so a fast click can't fire a connect with the secret field still empty. The
    // flag is honoured by _updateConnectBtn(), so a concurrent setConn() can't
    // re-enable the button mid-read.
    this._loadingSecret = true;
    this._updateConnectBtn();
    try {
      const secret = await secureGet(keyringAccount(last.url, last.mode, last.user));
      // Only fill if the field is still empty — never clobber a value the user may
      // have typed during the (async) keychain read.
      const secretEl = root.querySelector<HTMLInputElement>(
        last.mode === "basic" ? "#prep-sd-password" : "#prep-sd-token",
      );
      if (secret && secretEl && !secretEl.value) secretEl.value = secret;
    } finally {
      this._loadingSecret = false;
      this._updateConnectBtn();
    }
  }

  /**
   * Après une connexion réussie : si « Se souvenir » est coché, persister les
   * champs non-secrets (localStorage) + le secret (trousseau OS) ; sinon oublier
   * toute trace précédente pour ce compte. Jamais de secret en clair sur disque.
   */
  private async _persistConnection(url: string): Promise<void> {
    const remember =
      this._root?.querySelector<HTMLInputElement>("#prep-sd-remember")?.checked ?? false;
    const user = this._auth.mode === "basic" ? (this._auth.user ?? "") : "";
    const account = keyringAccount(url, this._auth.mode, user);
    if (!remember) {
      clearLastConn();
      await secureDelete(account);
      return;
    }
    saveLastConn({ url, mode: this._auth.mode, user, remember: true });
    const secret = authSecret(this._auth);
    if (secret) {
      const stored = await secureSet(account, secret);
      if (!stored) {
        this._showToast?.(
          "Préférences mémorisées, mais le secret n'a pas pu être stocké (trousseau indisponible)",
          true,
        );
      }
    }
  }

  /** « Oublier » : purge le trousseau + localStorage + vide les champs secret. */
  private async _forget(): Promise<void> {
    const last = loadLastConn();
    clearLastConn();
    if (last && last.mode !== "anonymous") {
      await secureDelete(keyringAccount(last.url, last.mode, last.user));
    }
    // Also forget the account currently typed in the form, in case it differs.
    const url = normalizeFolderUrl(
      this._root?.querySelector<HTMLInputElement>("#prep-sd-url")?.value ?? "",
    );
    const formAuth = this._readAuthFromForm();
    if (url && formAuth.mode !== "anonymous") {
      const user = formAuth.mode === "basic" ? (formAuth.user ?? "") : "";
      await secureDelete(keyringAccount(url, formAuth.mode, user));
    }
    const root = this._root;
    if (root) {
      const rememberEl = root.querySelector<HTMLInputElement>("#prep-sd-remember");
      if (rememberEl) rememberEl.checked = false;
      for (const sel of ["#prep-sd-password", "#prep-sd-token"]) {
        const el = root.querySelector<HTMLInputElement>(sel);
        if (el) el.value = "";
      }
    }
    this._showToast?.("Identifiants ShareDocs oubliés");
  }

  private async _browse(url: string, recordHistory = false): Promise<boolean> {
    if (!this._conn || this._busy) return false;
    // Push history only once navigation actually starts (after the guards) so a
    // no-op browse (busy / no connection) can never corrupt the back-stack.
    if (recordHistory && this._currentUrl) this._history.push(this._currentUrl);
    this._setBusy(true);
    try {
      const entries = await webdavList(this._conn, { url, auth: this._auth });
      this._currentUrl = url;
      this._entries = sortRemoteEntries(entries);
      this._renderEntries();
      this._log(`✓ ${entries.length} élément(s) — ${safeDecodeUrl(url)}`);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._showToast?.(`✗ ${msg}`, true);
      this._log(`✗ ${msg}`, true);
      return false;
    } finally {
      this._setBusy(false);
    }
  }

  private _onEntryClick(ev: Event): void {
    if (this._busy) return;
    // Only the folder-name link navigates — the row's checkbox (also carrying
    // data-idx) must not trigger a browse when toggled (P4C).
    const target = (ev.target as HTMLElement | null)?.closest<HTMLElement>(".prep-sd-folder-link");
    if (!target) return;
    const entry = this._entries[Number(target.dataset.idx)];
    if (!entry || !entry.is_dir) return;
    void this._browse(entry.href, true);
  }

  /** Toggle a row's checkbox in/out of the selection cart (P4C). */
  private _onEntryCheck(ev: Event): void {
    const cb = (ev.target as HTMLElement | null)?.closest<HTMLInputElement>(".prep-sd-check");
    if (!cb) return;
    const entry = this._entries[Number(cb.dataset.idx)];
    if (!entry) return;
    if (cb.checked) {
      this._selected.set(entry.href, {
        href: entry.href,
        name: entry.name,
        parentUrl: this._currentUrl,
        is_dir: entry.is_dir,
      });
    } else {
      this._selected.delete(entry.href);
    }
    this._updateSelectionUi();
  }

  private _goUp(): void {
    const prev = this._history.pop();
    if (prev) void this._browse(prev);
  }

  // ─── Import ─────────────────────────────────────────────────────────────────

  /**
   * Read + validate the shared *defaults* (profil de segmentation par défaut + langue
   * par défaut) and the auth form. Shows a toast and returns null on a problem. Also
   * refreshes `this._auth`. Shared by "Importer ce dossier" and "Importer la
   * sélection". The per-file format + langue are derived later (importDetect) ; ces
   * deux valeurs ne sont que les replis (profil = style ; langue si non détectée).
   */
  private _readImportForm(): { profile: string; defaultLanguage: string } | null {
    const profile =
      this._root?.querySelector<HTMLSelectElement>("#prep-sd-profile")?.value || WP_DEFAULT_NUMBERED;
    const defaultLanguage =
      this._root?.querySelector<HTMLInputElement>("#prep-sd-language")?.value.trim() || "fr";
    this._auth = this._readAuthFromForm();
    if (!authIsComplete(this._auth)) {
      this._showToast?.("Identifiants incomplets pour ce mode d'authentification", true);
      return null;
    }
    return { profile, defaultLanguage };
  }

  /**
   * Per-file import params (mode + langue) dérivés d'un nom de fichier distant, en
   * réutilisant la détection de l'import local (importDetect — source unique).
   * Retourne null quand l'extension n'est pas un format importable : le fichier est
   * alors ignoré (ni importé, ni en erreur), cf. DESIGN §11.3.
   */
  private _detectFile(
    name: string,
    href: string,
    parentUrl: string,
    profile: string,
    defaultLanguage: string,
  ): DetectedImportFile | null {
    // Délègue à la fonction pure partagée (testée en isolation, source unique).
    return detectImportFile(name, href, parentUrl, profile, defaultLanguage);
  }

  /**
   * Submit one /import-remote per group (each carries its own mode/language/hrefs),
   * track each in the Job Center, aggregate the per-batch reports into a single one.
   * Returns false if enqueuing a group threw (network/sidecar) — the caller can then
   * keep the selection cart for a retry rather than clearing it.
   */
  private async _submitGroups(conn: Conn, groups: DetectedImportGroup[]): Promise<boolean> {
    this._report = null;
    this._renderReport();
    this._log(`▶ Import — ${groups.length} lot(s)`);
    try {
      for (const g of groups) {
        const job = await importRemote(conn, {
          url: g.url,
          mode: g.mode,
          language: g.language,
          hrefs: g.hrefs,
          auth: this._auth,
        });
        this._jobCenter?.trackJob(job.job_id, `ShareDocs : ${g.label}`, (done) => {
          const result = done.result;
          if (done.status === "done" && isImportRemoteReport(result)) {
            this._report = mergeReports(this._report, result);
            this._renderReport();
            this._showToast?.(`✓ ${summarizeReport(this._report)}`);
            this._log(`✓ ${g.label} — ${summarizeReport(result)}`);
          } else {
            const msg =
              done.error ||
              (done.status === "done"
                ? "Import terminé sans rapport exploitable"
                : "Import distant interrompu");
            this._showToast?.(`✗ ${g.label} : ${msg}`, true);
            this._log(`✗ ${g.label} : ${msg}`, true);
          }
        });
      }
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._showToast?.(`✗ ${msg}`, true);
      this._log(`✗ ${msg}`, true);
      return false;
    }
  }

  private async _runImport(): Promise<void> {
    if (!this._conn || !this._currentUrl) return;
    const form = this._readImportForm();
    if (!form) return;
    const conn = this._conn;
    const parentUrl = this._currentUrl;

    // Détection par fichier sur le dossier courant (les sous-dossiers ne s'importent
    // pas ici). Les extensions inconnues sont ignorées mais comptées (jamais en
    // erreur) — DESIGN §11.3. Routage partagé avec l'expansion des dossiers cochés.
    const { files, ignored } = routeEntriesToImport(
      this._entries,
      parentUrl,
      form.profile,
      form.defaultLanguage,
    );
    if (files.length === 0) {
      this._showToast?.(
        ignored > 0
          ? `Aucun fichier importable — ${ignored} ignoré(s) (extension non reconnue).`
          : "Aucun fichier à importer dans ce dossier.",
        true,
      );
      return;
    }
    const groups = groupDetectedFiles(files);

    await this._guardedRun(
      "#prep-sd-import-btn",
      async () => {
        await this._submitGroups(conn, groups);
      },
      ignored > 0
        ? {
            containerSel: "#prep-sd-import-confirm",
            message: `${files.length} fichier(s) → ${groups.length} lot(s) ; ${ignored} ignoré(s) (extension non reconnue). Importer ?`,
            opts: { confirmLabel: "Importer", danger: false },
          }
        : undefined,
    );
  }

  // ─── Sélection multiple (panier, P4C) ───────────────────────────────────────

  /** Refresh the selection bar (count, list, import button label) from the cart. */
  private _updateSelectionUi(): void {
    const root = this._root;
    if (!root) return;
    const n = this._selected.size;
    const bar = root.querySelector<HTMLElement>("#prep-sd-selection");
    if (bar) bar.style.display = n > 0 ? "" : "none";
    const count = root.querySelector<HTMLElement>("#prep-sd-sel-count");
    if (count) count.textContent = `${n} élément${n > 1 ? "s" : ""} sélectionné${n > 1 ? "s" : ""}`;
    const importBtn = root.querySelector<HTMLButtonElement>("#prep-sd-sel-import");
    if (importBtn) importBtn.textContent = `Importer la sélection (${n})`;
    const list = root.querySelector<HTMLElement>("#prep-sd-sel-list");
    if (!list) return;
    if (n === 0) {
      setHtml(list, raw(""));
      return;
    }
    // Per fichier : afficher le (mode, langue) détectés avec lequel il sera importé
    // (remplace le drapeau ⚠ de P4D — on route par fichier au lieu de signaler). Le
    // parent est affiché car le panier s'étend sur plusieurs dossiers. Un dossier coché
    // est développé à l'import (PROPFIND Depth:1, non récursif — cf. _importSelection).
    const profile =
      root.querySelector<HTMLSelectElement>("#prep-sd-profile")?.value || WP_DEFAULT_NUMBERED;
    const defaultLanguage =
      root.querySelector<HTMLInputElement>("#prep-sd-language")?.value.trim() || "fr";
    const items = [...this._selected.values()].map((it) => {
      if (it.is_dir) {
        return safeHtml`<li>📁 ${it.name} — ${folderLabel(it.parentUrl)} <span class="prep-sd-fmt">(dossier — son contenu sera développé à l'import)</span></li>`;
      }
      const det = this._detectFile(it.name, it.href, it.parentUrl, profile, defaultLanguage);
      // langue undefined = TEI sans token → le xml:lang du document fait foi.
      const tag = det
        ? safeHtml`<span class="prep-sd-fmt">${det.mode} · ${det.language ?? "xml:lang"}</span>`
        : safeHtml`<span class="prep-sd-mismatch" title="Extension non reconnue — ce fichier sera ignoré">⚠ ignoré</span>`;
      return safeHtml`<li>📄 ${it.name} — ${folderLabel(it.parentUrl)} ${tag}</li>`;
    });
    setHtml(list, safeHtml`<ul>${items}</ul>`);
  }

  private _clearSelection(): void {
    this._selected.clear();
    this._root?.querySelectorAll<HTMLInputElement>(".prep-sd-check").forEach((cb) => {
      cb.checked = false;
    });
    this._updateSelectionUi();
  }

  /**
   * Develop a checked folder via one PROPFIND (Depth:1) and detect its **files**
   * (Phase 5 — expansion des dossiers cochés). **Non-récursif** : les sous-dossiers
   * d'un dossier coché sont comptés puis ignorés (cohérent avec « Importer ce dossier »,
   * lui-même non récursif). Une erreur de PROPFIND est **reportée, jamais bloquante**
   * (DESIGN §11.3) : le dossier est signalé dans `failed` et l'import continue.
   */
  private async _expandFolders(
    conn: Conn,
    folders: SelectedRemoteItem[],
    form: { profile: string; defaultLanguage: string },
  ): Promise<{ files: DetectedImportFile[]; ignored: number; subfolders: number; failed: string[] }> {
    const files: DetectedImportFile[] = [];
    let ignored = 0;
    let subfolders = 0;
    const failed: string[] = [];
    for (const folder of folders) {
      try {
        const entries = await webdavList(conn, { url: folder.href, auth: this._auth });
        // Non-récursif : les sous-dossiers sont comptés puis ignorés (routeEntriesToImport).
        const routed = routeEntriesToImport(entries, folder.href, form.profile, form.defaultLanguage);
        files.push(...routed.files);
        ignored += routed.ignored;
        subfolders += routed.subfolders;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this._log(`✗ Dossier « ${folder.name} » non développé : ${msg}`, true);
        failed.push(folder.name);
      }
    }
    return { files, ignored, subfolders, failed };
  }

  /**
   * Import the cart (Phase 5) : détection par fichier sur les fichiers cochés **et**
   * sur le contenu des DOSSIERS cochés (développés par un PROPFIND Depth:1 chacun) ;
   * dédup par href ; groupement par (parent, mode, langue) → un /import-remote par lot
   * (chacun avec son `hrefs`), suivi Job Center, rapports agrégés. Vide le panier au
   * lancement. Les sous-dossiers d'un dossier coché ne sont pas développés (non récursif).
   */
  private async _importSelection(): Promise<void> {
    if (!this._conn || this._selected.size === 0 || this._busy) return;
    const conn = this._conn;
    const form = this._readImportForm();
    if (!form) return;

    const items = [...this._selected.values()];
    const folders = items.filter((it) => it.is_dir);

    // 1) Fichiers cochés directement.
    const files: DetectedImportFile[] = [];
    let ignored = 0;
    for (const it of items) {
      if (it.is_dir) continue;
      const det = this._detectFile(it.name, it.href, it.parentUrl, form.profile, form.defaultLanguage);
      if (det) files.push(det);
      else ignored += 1;
    }

    // 2) Expansion des dossiers cochés (PROPFIND par dossier — IO, donc avant le
    //    `_guardedRun` qui ne sert qu'à la confirmation + verrou bouton).
    let subfolders = 0;
    const failed: string[] = [];
    if (folders.length > 0) {
      const btn = this._root?.querySelector<HTMLButtonElement>("#prep-sd-sel-import");
      if (btn) btn.disabled = true;
      this._setBusy(true);
      this._log(`▶ Développement de ${folders.length} dossier(s) coché(s)…`);
      try {
        const exp = await this._expandFolders(conn, folders, form);
        files.push(...exp.files);
        ignored += exp.ignored;
        subfolders = exp.subfolders;
        failed.push(...exp.failed);
      } finally {
        this._setBusy(false);
        if (btn) btn.disabled = false;
      }
    }

    // 3) Dédup (un fichier coché peut aussi remonter via l'expansion de son dossier).
    const deduped = dedupeDetectedFiles(files);

    if (deduped.length === 0) {
      const why =
        failed.length > 0
          ? `${failed.length} dossier(s) illisible(s) ; aucun fichier importable.`
          : folders.length > 0
            ? "Dossiers cochés sans fichier importable (sous-dossiers et extensions inconnues exclus)."
            : `Aucun fichier importable dans la sélection — ${ignored} ignoré(s) (extension non reconnue).`;
      this._showToast?.(why, true);
      return;
    }
    const groups = groupDetectedFiles(deduped);

    const notes: string[] = [];
    if (ignored > 0) notes.push(`${ignored} ignoré(s) (extension non reconnue)`);
    if (subfolders > 0) notes.push(`${subfolders} sous-dossier(s) non développé(s)`);
    if (failed.length > 0) notes.push(`${failed.length} dossier(s) illisible(s) ignoré(s)`);

    await this._guardedRun(
      "#prep-sd-sel-import",
      async () => {
        const ok = await this._submitGroups(conn, groups);
        if (ok) this._clearSelection();
      },
      notes.length > 0
        ? {
            containerSel: "#prep-sd-sel-confirm",
            message: `${deduped.length} fichier(s) → ${groups.length} lot(s) ; ${notes.join(" ; ")}. Importer ?`,
            opts: { confirmLabel: "Importer", danger: false },
          }
        : undefined,
    );
  }

  // ─── Rendering ──────────────────────────────────────────────────────────────

  private _renderEntries(): void {
    const host = this._root?.querySelector<HTMLElement>("#prep-sd-entries");
    const section = this._root?.querySelector<HTMLElement>("#prep-sd-folder-section");
    if (!host) return;
    if (section) section.style.display = "";

    const crumb = this._root?.querySelector<HTMLElement>("#prep-sd-current-url");
    if (crumb) crumb.textContent = safeDecodeUrl(this._currentUrl);
    const upBtn = this._root?.querySelector<HTMLButtonElement>("#prep-sd-up-btn");
    if (upBtn) upBtn.disabled = this._history.length === 0;

    if (this._entries.length === 0) {
      setHtml(host, safeHtml`<p class="prep-sd-empty">Dossier vide.</p>`);
      this._updateSelectionUi();
      return;
    }

    const rows = this._entries.map((e, idx) => {
      const icon = e.is_dir ? "📁" : "📄";
      const nameCell = e.is_dir
        ? safeHtml`<button type="button" class="prep-sd-folder-link" data-idx="${idx}">${icon} ${e.name}/</button>`
        : safeHtml`<span>${icon} ${e.name}</span>`;
      const size = e.is_dir ? "" : formatRemoteSize(e.size);
      return safeHtml`<tr>
        <td class="prep-sd-check-cell"><input type="checkbox" class="prep-sd-check" data-idx="${idx}" /></td>
        <td class="prep-sd-name">${nameCell}</td>
        <td class="prep-sd-size">${size}</td>
        <td class="prep-sd-mod">${e.modified ?? ""}</td>
      </tr>`;
    });

    setHtml(
      host,
      safeHtml`<table class="prep-sd-table">
        <thead><tr><th></th><th>Nom</th><th>Taille</th><th>Modifié</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`,
    );

    // Reflect the cart's checked state on the freshly-rendered rows (selection
    // persists across navigation, so a re-visited folder shows its ticks again).
    host.querySelectorAll<HTMLInputElement>(".prep-sd-check").forEach((cb) => {
      const e = this._entries[Number(cb.dataset.idx)];
      if (e) cb.checked = this._selected.has(e.href);
    });
    this._updateSelectionUi();
  }

  private _renderReport(): void {
    const host = this._root?.querySelector<HTMLElement>("#prep-sd-report");
    const section = this._root?.querySelector<HTMLElement>("#prep-sd-report-section");
    if (!host) return;
    if (!this._report) {
      if (section) section.style.display = "none";
      setHtml(host, raw(""));
      return;
    }
    if (section) section.style.display = "";

    const r = this._report;
    const rows = (r.files ?? []).map((f) => {
      const kind = statusBadgeKind(f.status);
      const detail =
        f.status === "error" ? (f.error ?? "") : f.doc_id != null ? `doc #${f.doc_id}` : "";
      return safeHtml`<tr>
        <td><span class="prep-sd-badge prep-sd-badge--${kind}">${statusLabel(f.status)}</span></td>
        <td class="prep-sd-name">${f.name}</td>
        <td class="prep-sd-detail">${detail}</td>
      </tr>`;
    });

    setHtml(host, safeHtml`<p class="prep-sd-summary">${summarizeReport(r)}</p>`);
    appendHtml(
      host,
      safeHtml`<table class="prep-sd-table">
        <thead><tr><th>Statut</th><th>Fichier</th><th>Détail</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`,
    );

    // "Annuler cet import" — only the docs ACTUALLY imported by this batch (never
    // skipped-duplicate, whose doc_id is a pre-existing document).
    const importedCount = (r.files ?? []).filter(
      (f) => f.status === "imported" && f.doc_id != null,
    ).length;
    if (importedCount > 0) {
      appendHtml(
        host,
        safeHtml`<div class="prep-sd-report-actions">
          <button type="button" id="prep-sd-undo-btn" class="prep-sd-btn prep-sd-btn--ghost">Annuler cet import (${importedCount} document${importedCount > 1 ? "s" : ""})</button>
        </div>
        <div id="prep-sd-report-confirm" class="prep-sd-report-confirm"></div>`,
      );
      host
        .querySelector<HTMLButtonElement>("#prep-sd-undo-btn")
        ?.addEventListener("click", () => void this._undoImport());
    }
  }

  /**
   * Undo a batch import: delete the documents this batch created. Only files with
   * `status === "imported"` are removed — `skipped-duplicate` entries point at a
   * pre-existing document and must NOT be deleted. Confirmed (destructive).
   */
  private async _undoImport(): Promise<void> {
    if (!this._conn || !this._report) return;
    const conn = this._conn;
    const ids = (this._report.files ?? [])
      .filter((f) => f.status === "imported" && f.doc_id != null)
      .map((f) => f.doc_id as number);
    if (ids.length === 0) return;

    await this._guardedRun(
      "#prep-sd-undo-btn",
      async () => {
        try {
          const res = await deleteDocuments(conn, ids);
          this._showToast?.(`✓ Lot annulé — ${res.deleted} document(s) supprimé(s)`);
          this._log(`✓ Import annulé — ${res.deleted} document(s) supprimé(s)`);
          this._report = null;
          this._renderReport();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this._showToast?.(`✗ Annulation : ${msg}`, true);
          this._log(`✗ Annulation : ${msg}`, true);
        }
      },
      {
        containerSel: "#prep-sd-report-confirm",
        message: `Supprimer définitivement les ${ids.length} document(s) importés par ce lot ? (Les doublons ignorés ne sont pas touchés.)`,
        opts: { confirmLabel: "Supprimer", danger: true },
      },
    );
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private _readAuthFromForm(): WebdavAuth {
    const mode = (this._root?.querySelector<HTMLSelectElement>("#prep-sd-auth-mode")?.value ??
      "anonymous") as WebdavAuthMode;
    return buildWebdavAuth(mode, {
      user: this._root?.querySelector<HTMLInputElement>("#prep-sd-user")?.value,
      password: this._root?.querySelector<HTMLInputElement>("#prep-sd-password")?.value,
      token: this._root?.querySelector<HTMLInputElement>("#prep-sd-token")?.value,
    });
  }

  private _onAuthModeChange(): void {
    const mode = this._root?.querySelector<HTMLSelectElement>("#prep-sd-auth-mode")?.value ?? "anonymous";
    const basic = this._root?.querySelector<HTMLElement>("#prep-sd-basic-fields");
    const bearer = this._root?.querySelector<HTMLElement>("#prep-sd-bearer-fields");
    if (basic) basic.style.display = mode === "basic" ? "" : "none";
    if (bearer) bearer.style.display = mode === "bearer" ? "" : "none";
  }

  private _setBusy(busy: boolean): void {
    this._busy = busy;
    this._updateConnectBtn();
    const upBtn = this._root?.querySelector<HTMLButtonElement>("#prep-sd-up-btn");
    if (upBtn) upBtn.disabled = busy || this._history.length === 0;
  }

  private _updateConnectBtn(): void {
    const btn = this._root?.querySelector<HTMLButtonElement>("#prep-sd-connect-btn");
    if (btn) btn.disabled = !this._conn || this._busy || this._loadingSecret;
  }

  private _log(msg: string, isError = false): void {
    if (!this._logEl) return;
    const ts = new Date().toLocaleTimeString();
    const line = document.createElement("div");
    line.className = isError ? "log-line log-error" : "log-line";
    line.dataset.source = "sharedocs";
    line.textContent = `[${ts}] [ShareDocs] ${msg}`;
    this._logEl.appendChild(line);
    this._logEl.scrollTop = this._logEl.scrollHeight;
  }
}
