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
import { webdavList, importRemote } from "../lib/sidecarClient.ts";
import type { JobCenter } from "../components/JobCenter.ts";
import { setHtml, appendHtml, raw, safeHtml } from "../lib/safeHtml.ts";
import {
  authIsComplete,
  authSecret,
  buildNextcloudRoot,
  buildWebdavAuth,
  folderLabel,
  formatRemoteSize,
  groupSelectionForImport,
  isImportRemoteReport,
  keyringAccount,
  languageRequiredForMode,
  mergeReports,
  normalizeFolderUrl,
  safeDecodeUrl,
  type SelectedRemoteItem,
  sortRemoteEntries,
  statusBadgeKind,
  statusLabel,
  summarizeReport,
} from "../lib/shareDocs.ts";
import {
  clearLastConn,
  loadLastConn,
  saveLastConn,
  secureDelete,
  secureGet,
  secureSet,
} from "../lib/credentialStore.ts";

const IMPORT_MODES: Array<{ value: string; label: string }> = [
  { value: "docx_numbered_lines", label: "DOCX — lignes numérotées [N]" },
  { value: "txt_numbered_lines", label: "TXT — lignes numérotées [N]" },
  { value: "docx_paragraphs", label: "DOCX — paragraphes" },
  { value: "odt_paragraphs", label: "ODT — paragraphes" },
  { value: "odt_numbered_lines", label: "ODT — lignes numérotées [N]" },
  { value: "tei", label: "TEI (XML)" },
  { value: "conllu", label: "CoNLL-U" },
];

// Static, no user input → safe to embed in the raw() skeleton.
const MODE_OPTIONS = IMPORT_MODES.map(
  (m) => `<option value="${m.value}">${m.label}</option>`,
).join("");

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
            puis « Importer la sélection ». « Importer ce dossier » ingère tout le dossier courant (filtré par le mode / le glob).</p>
          <div id="prep-sd-entries" class="prep-sd-entries"></div>
          <div id="prep-sd-selection" class="prep-sd-selection" style="display:none">
            <span id="prep-sd-sel-count" class="prep-sd-sel-count"></span>
            <button type="button" id="prep-sd-sel-clear" class="prep-sd-btn prep-sd-btn--ghost">Vider</button>
            <button type="button" id="prep-sd-sel-import" class="prep-sd-btn prep-sd-btn--primary">Importer la sélection</button>
          </div>
          <div id="prep-sd-sel-list" class="prep-sd-sel-list"></div>
          <div class="prep-sd-import-controls">
            <label class="prep-sd-field"><span>Mode d'import</span>
              <select id="prep-sd-mode">${MODE_OPTIONS}</select>
            </label>
            <label class="prep-sd-field"><span>Langue (ISO, requise sauf TEI)</span><input type="text" id="prep-sd-language" placeholder="fr" /></label>
            <label class="prep-sd-field"><span>Filtre (glob, optionnel)</span><input type="text" id="prep-sd-include" placeholder="*.docx" /></label>
            <button type="button" id="prep-sd-import-btn" class="prep-sd-btn prep-sd-btn--primary">Importer ce dossier</button>
          </div>
        </section>

        <section class="prep-sd-card" id="prep-sd-report-section" style="display:none">
          <h3 class="prep-sd-card-title">3. Rapport</h3>
          <div id="prep-sd-report"></div>
        </section>
      </div>
    `),
    );

    root.querySelector("#prep-sd-auth-mode")?.addEventListener("change", () => this._onAuthModeChange());
    root.querySelector("#prep-sd-preset-btn")?.addEventListener("click", () => this._prefillUrlFromPreset());
    root.querySelector("#prep-sd-connect-btn")?.addEventListener("click", () => void this._connect());
    root.querySelector("#prep-sd-up-btn")?.addEventListener("click", () => void this._goUp());
    root.querySelector("#prep-sd-import-btn")?.addEventListener("click", () => void this._runImport());
    root.querySelector("#prep-sd-entries")?.addEventListener("click", (ev) => this._onEntryClick(ev));
    root.querySelector("#prep-sd-entries")?.addEventListener("change", (ev) => this._onEntryCheck(ev));
    root.querySelector("#prep-sd-sel-clear")?.addEventListener("click", () => this._clearSelection());
    root.querySelector("#prep-sd-sel-import")?.addEventListener("click", () => void this._importSelection());
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
   * P4B preset: rebuild the URL field as the Nextcloud personal root from whatever
   * host the user typed there + their identifiant. A pure saisie aid — the field
   * stays editable and the connector remains generic WebDAV.
   */
  private _prefillUrlFromPreset(): void {
    const urlEl = this._root?.querySelector<HTMLInputElement>("#prep-sd-url");
    const user = this._root?.querySelector<HTMLInputElement>("#prep-sd-user")?.value ?? "";
    const root = buildNextcloudRoot(urlEl?.value ?? "", user);
    if (!root) {
      this._showToast?.(
        "Renseigne le serveur (champ URL) et ton identifiant pour préremplir l'URL racine",
        true,
      );
      return;
    }
    if (urlEl) urlEl.value = root;
    this._showToast?.("URL racine préremplie — navigue jusqu'au dossier voulu");
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
   * Read + validate the shared import controls (mode / language / include) and the
   * auth form. Shows a toast and returns null on any problem. Also refreshes
   * `this._auth` from the form. Shared by "Importer ce dossier" and "Importer la
   * sélection".
   */
  private _readImportForm(): { mode: string; language?: string; include?: string } | null {
    const mode = this._root?.querySelector<HTMLSelectElement>("#prep-sd-mode")?.value ?? "";
    if (!mode) {
      this._showToast?.("Choisissez un mode d'import", true);
      return null;
    }
    const language = this._root?.querySelector<HTMLInputElement>("#prep-sd-language")?.value.trim() || undefined;
    const include = this._root?.querySelector<HTMLInputElement>("#prep-sd-include")?.value.trim() || undefined;
    if (languageRequiredForMode(mode) && !language) {
      this._showToast?.("La langue (ISO) est requise pour ce mode d'import (seul TEI peut l'omettre)", true);
      return null;
    }
    this._auth = this._readAuthFromForm();
    if (!authIsComplete(this._auth)) {
      this._showToast?.("Identifiants incomplets pour ce mode d'authentification", true);
      return null;
    }
    return { mode, language, include };
  }

  private async _runImport(): Promise<void> {
    if (!this._conn || !this._currentUrl) return;
    const form = this._readImportForm();
    if (!form) return;
    const { mode, language, include } = form;

    const importBtn = this._root?.querySelector<HTMLButtonElement>("#prep-sd-import-btn");
    if (importBtn) importBtn.disabled = true;
    try {
      const job = await importRemote(this._conn, {
        url: this._currentUrl,
        mode,
        language,
        include,
        auth: this._auth,
      });
      // The Job Center now owns the progress UI — re-enable immediately rather
      // than from onDone, which is not guaranteed to fire (a dropped connection
      // or a job that never reaches a terminal state would otherwise leave the
      // button stuck disabled).
      if (importBtn) importBtn.disabled = false;
      this._report = null;
      this._renderReport();
      this._log(`▶ Import lancé — ${safeDecodeUrl(this._currentUrl)} (${mode})`);
      this._jobCenter?.trackJob(job.job_id, `ShareDocs : ${folderLabel(this._currentUrl)}`, (done) => {
        const result = done.result;
        if (done.status === "done" && isImportRemoteReport(result)) {
          this._report = result;
          this._renderReport();
          const summary = summarizeReport(this._report);
          this._showToast?.(`✓ ${summary}`);
          this._log(`✓ ${summary}`);
        } else {
          const msg =
            done.error ||
            (done.status === "done" ? "Import terminé sans rapport exploitable" : "Import distant interrompu");
          this._showToast?.(`✗ ${msg}`, true);
          this._log(`✗ ${msg}`, true);
        }
      });
    } catch (err) {
      if (importBtn) importBtn.disabled = false;
      const msg = err instanceof Error ? err.message : String(err);
      this._showToast?.(`✗ ${msg}`, true);
      this._log(`✗ ${msg}`, true);
    }
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
    if (list) {
      if (n === 0) {
        setHtml(list, raw(""));
      } else {
        // Show the parent folder too — the cart spans folders, so a bare name
        // (e.g. two "a.docx" in different folders) would be ambiguous.
        const items = [...this._selected.values()].map(
          (it) =>
            safeHtml`<li>${it.is_dir ? "📁" : "📄"} ${it.name} — ${folderLabel(it.parentUrl)}</li>`,
        );
        setHtml(list, safeHtml`<ul>${items}</ul>`);
      }
    }
  }

  private _clearSelection(): void {
    this._selected.clear();
    this._root?.querySelectorAll<HTMLInputElement>(".prep-sd-check").forEach((cb) => {
      cb.checked = false;
    });
    this._updateSelectionUi();
  }

  /**
   * Import the cart: one /import-remote per selected folder + one per parent folder
   * of selected files (with `hrefs`), each tracked in the Job Center; the per-batch
   * reports are merged into a single aggregated report. Clears the cart on success.
   */
  private async _importSelection(): Promise<void> {
    if (!this._conn || this._selected.size === 0) return;
    const form = this._readImportForm();
    if (!form) return;
    const { mode, language, include } = form;

    const groups = groupSelectionForImport([...this._selected.values()]);
    const importBtn = this._root?.querySelector<HTMLButtonElement>("#prep-sd-sel-import");
    if (importBtn) importBtn.disabled = true;

    this._report = null;
    this._renderReport();
    this._log(`▶ Import de la sélection — ${groups.length} lot(s)`);

    try {
      for (const g of groups) {
        const job = await importRemote(this._conn, {
          url: g.url,
          mode,
          language,
          include,
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
      this._clearSelection();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._showToast?.(`✗ ${msg}`, true);
      this._log(`✗ ${msg}`, true);
    } finally {
      if (importBtn) importBtn.disabled = false;
    }
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
