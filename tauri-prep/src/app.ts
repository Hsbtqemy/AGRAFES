/**
 * app.ts — ConcordancierPrep V0.4 shell.
 *
 * Tab navigation: [Importer] [Documents] [Actions] [Exporter]
 * Manages shared Conn state and propagates db-changed events.
 */

import type { Conn } from "./lib/sidecarClient.ts";
import { ensureRunning, SidecarError, getCorpusInfo, updateCorpusInfo } from "./lib/sidecarClient.ts";
import { getCurrentDbPath, setCurrentDbPath, getOrCreateDefaultDbPath } from "./lib/db.ts";
import { open as dialogOpen, save as dialogSave } from "@tauri-apps/plugin-dialog";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { writeTextFile, readTextFile } from "@tauri-apps/plugin-fs";
import { ImportScreen } from "./screens/ImportScreen.ts";
import { ActionsScreen, type ProjectPreset } from "./screens/ActionsScreen.ts";
import { MetadataScreen } from "./screens/MetadataScreen.ts";
import { ExportsScreen, type ExportWorkflowPrefill } from "./screens/ExportsScreen.ts";
import { JobCenter, showToast } from "./components/JobCenter.ts";
import { inlineConfirm } from "./lib/inlineConfirm.ts";

// ─── Project Presets — seeds ──────────────────────────────────────────────────

const SEED_PRESETS: ProjectPreset[] = [
  {
    id: "default-fr-en",
    name: "Par défaut (FR\u2194EN)",
    description: "Configuration standard pour corpus bilingue fran\u00e7ais/anglais",
    languages: ["fr", "en"],
    pivot_language: "fr",
    segmentation_lang: "fr",
    segmentation_pack: "auto",
    curation_preset: "spaces",
    alignment_strategy: "external_id_then_position",
    created_at: 0,
  },
  {
    id: "default-de-fr",
    name: "Allemand\u2194Fran\u00e7ais",
    description: "Corpus bilingue DE/FR, alignement par id externe",
    languages: ["de", "fr"],
    pivot_language: "de",
    segmentation_lang: "de",
    segmentation_pack: "auto",
    curation_preset: "spaces",
    alignment_strategy: "external_id",
    created_at: 0,
  },
];

// ─── App ──────────────────────────────────────────────────────────────────────
// CSS lives in tauri-prep/src/ui/app.css + job-center.css (Vite-managed, P6).

const TABS = ["import", "documents", "actions", "exporter"] as const;
type TabId = typeof TABS[number];

type GuardableScreen = {
  hasPendingChanges?: () => boolean;
  pendingChangesMessage?: () => string;
};

export class App {
  private _conn: Conn | null = null;
  private _activeTab: TabId = "import";

  private _import!: ImportScreen;
  private _actions!: ActionsScreen;
  private _metadata!: MetadataScreen;
  private _exports!: ExportsScreen;
  private _jobCenter!: JobCenter;

  private _tabBtns: Record<TabId, HTMLButtonElement> = {} as never;
  private _screenEls: Record<TabId, HTMLElement> = {} as never;
  private _screenControllers: Record<TabId, GuardableScreen> = {} as never;
  private _dbPathEl!: HTMLElement;
  private _logEl!: HTMLElement;
  private _journalOpen = false;

  /** beforeunload handler stored so dispose() can remove it cleanly. */
  private _beforeUnloadHandler: ((e: BeforeUnloadEvent) => void) | null = null;

  /** In-memory cache of project presets (persisted in corpus_info.meta.presets per DB). */
  private _presets: ProjectPreset[] = SEED_PRESETS.map(p => ({ ...p }));

  /** Load presets from corpus_info.meta.presets; falls back to seed defaults. */
  private async _loadPresetsFromDb(): Promise<void> {
    if (!this._conn) { this._presets = SEED_PRESETS.map(p => ({ ...p })); return; }
    try {
      const info = await getCorpusInfo(this._conn);
      const raw = info.meta?.presets;
      this._presets = Array.isArray(raw) && raw.length > 0
        ? raw as ProjectPreset[]
        : SEED_PRESETS.map(p => ({ ...p }));
    } catch { this._presets = SEED_PRESETS.map(p => ({ ...p })); }
  }

  /** Persist the current presets to corpus_info.meta.presets (fire-and-forget, merges meta). */
  private _savePresetsToDb(): void {
    if (!this._conn) return;
    const presets = this._presets;
    const conn = this._conn;
    (async () => {
      try {
        const info = await getCorpusInfo(conn);
        const merged = { ...info.meta, presets };
        await updateCorpusInfo(conn, { meta: merged });
      } catch (err) {
        showToast(`Erreur sauvegarde presets\u00a0: ${String(err)}`, true);
      }
    })();
  }

  async init(): Promise<void> {
    // CSS is now loaded by Vite (app.css + job-center.css) — no inline injection needed.

    // Resolve DB path synchronously, then build UI immediately so the user sees
    // the app without waiting for the sidecar (which can take several seconds on
    // first launch or after a DB switch). The sidecar is started in the background;
    // screens update via setConn() once the connection is ready.
    let dbPath: string | null = null;
    try {
      dbPath = await getOrCreateDefaultDbPath();
      setCurrentDbPath(dbPath);
    } catch { /* ignore — user can open manually */ }

    this._buildUI();
    this._import.setConn(null);
    this._actions.setConn(null);
    this._metadata.setConn(null);
    this._exports.setConn(null);
    this._jobCenter.setConn(null);
    this._import.setJobCenter(this._jobCenter, showToast);
    this._actions.setJobCenter(this._jobCenter, showToast);
    this._metadata.setJobCenter(this._jobCenter, showToast);
    this._actions.setOnOpenDocuments(() => this._switchTab("documents"));
    this._actions.setOnOpenExporter((prefill) => this._openExporterWithPrefill(prefill));
    this._exports.setJobCenter(this._jobCenter, showToast);

    void this._refreshTopbarDbLabel();

    // Start sidecar in background — screens will refresh when connection is ready.
    if (dbPath) void this._onDbChanged(dbPath);

    // RG → Prep token navigation: if shell set a pending nav target, consume it
    try {
      const raw = sessionStorage.getItem("agrafes:prep-token-nav");
      if (raw) {
        sessionStorage.removeItem("agrafes:prep-token-nav");
        const nav = JSON.parse(raw) as { doc_id: number; unit_id: number; token_id: number };
        if (nav.doc_id && nav.unit_id) {
          this._switchTab("actions");
          this._actions.setSubView("annoter");
          setTimeout(() => this._actions.annotFocusDoc(nav.doc_id, nav.token_id), 200);
        }
      }
    } catch { /* ignore */ }

    // Store handler reference so dispose() can remove it (prevents listener leak
    // when App is re-mounted during shell navigation).
    this._beforeUnloadHandler = (event: BeforeUnloadEvent) => {
      if (!this._hasPendingChangesInCurrentTab()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", this._beforeUnloadHandler);
  }

  private _buildUI(): void {
    const root = document.getElementById("app")!;

    // Skip link (A11y)
    const skipLink = document.createElement("a");
    skipLink.href = "#prep-main-content";
    skipLink.className = "prep-skip-link";
    skipLink.textContent = "Aller au contenu";
    root.appendChild(skipLink);

    // Topbar
    const topbar = document.createElement("div");
    topbar.className = "prep-topbar";
    topbar.setAttribute("role", "banner");

    const titleEl = document.createElement("span");
    titleEl.className = "prep-topbar-title";
    titleEl.textContent = "Constituer";

    const dbPathEl = document.createElement("span");
    dbPathEl.id = "topbar-dbpath";
    dbPathEl.className = "prep-topbar-dbpath";
    dbPathEl.textContent = this._dbBadge();

    const openBtn = document.createElement("button");
    openBtn.className = "prep-topbar-db-btn";
    openBtn.textContent = "Ouvrir\u2026";
    openBtn.title = "Ouvrir une base de données existante";
    openBtn.addEventListener("click", () => void this._onOpenDb());

    const createBtn = document.createElement("button");
    createBtn.className = "prep-topbar-db-btn";
    createBtn.textContent = "Cr\u00e9er\u2026";
    createBtn.title = "Créer une nouvelle base de données";
    createBtn.addEventListener("click", () => void this._onCreateDb(root));

    const presetsBtn = document.createElement("button");
    presetsBtn.className = "prep-topbar-db-btn";
    presetsBtn.textContent = "\uD83D\uDCCB Presets";
    presetsBtn.title = "Gérer les presets de projet";
    presetsBtn.addEventListener("click", () => this._showPresetsModal());

    const corpusInfoBtn = document.createElement("button");
    corpusInfoBtn.className = "prep-topbar-db-btn";
    corpusInfoBtn.textContent = "\uD83D\uDCC4 Fiche corpus";
    corpusInfoBtn.title = "Qualifier le corpus : titre, descriptif, métadonnées";
    corpusInfoBtn.addEventListener("click", () => void this._showCorpusInfoModal());

    const openConcordancierBtn = document.createElement("button");
    openConcordancierBtn.className = "prep-topbar-db-btn";
    openConcordancierBtn.textContent = "\u2197 Shell";
    openConcordancierBtn.title = "Ouvrir la DB active dans AGRAFES Shell (app unifiée)";
    openConcordancierBtn.addEventListener("click", () => void this._openInConcordancier());

    const journalBtn = document.createElement("button");
    journalBtn.id = "prep-journal-btn";
    journalBtn.className = "prep-topbar-db-btn";
    journalBtn.textContent = "📋 Journal";
    journalBtn.title = "Afficher le journal des opérations";
    journalBtn.addEventListener("click", () => this._toggleJournal(root));

    topbar.appendChild(titleEl);
    topbar.appendChild(dbPathEl);
    topbar.appendChild(openBtn);
    topbar.appendChild(createBtn);
    topbar.appendChild(presetsBtn);
    topbar.appendChild(corpusInfoBtn);
    topbar.appendChild(openConcordancierBtn);
    topbar.appendChild(journalBtn);

    const pendingConfirmBar = document.createElement("div");
    pendingConfirmBar.id = "app-pending-confirm";
    pendingConfirmBar.className = "audit-batch-bar";
    pendingConfirmBar.style.display = "none";
    topbar.appendChild(pendingConfirmBar);

    this._dbPathEl = dbPathEl;
    root.appendChild(topbar);

    // ── Journal drawer (global, fixed) ────────────────────────────────────────
    const drawer = document.createElement("div");
    drawer.id = "prep-journal-drawer";
    drawer.className = "prep-journal-drawer";
    drawer.setAttribute("aria-hidden", "true");
    drawer.setAttribute("role", "complementary");
    drawer.setAttribute("aria-label", "Journal des opérations");
    drawer.innerHTML = `
      <div class="prep-journal-head">
        <span class="prep-journal-title">Journal</span>
        <button id="prep-journal-close" class="prep-journal-close-btn" title="Fermer">&#10005;</button>
      </div>
      <div id="prep-journal-log" class="prep-log-pane prep-journal-log"></div>
    `;
    drawer.querySelector("#prep-journal-close")?.addEventListener("click", () => this._toggleJournal(root));
    root.appendChild(drawer);
    this._logEl = root.querySelector("#prep-journal-log")!;

    // ── vNext Shell: sidebar + main grid ─────────────────────────────────────
    const shell = document.createElement("div");
    shell.className = "prep-shell";
    shell.id = "prep-shell-main";

    // Sidebar nav
    const nav = document.createElement("nav");
    nav.className = "prep-nav";
    nav.id = "prep-nav";
    nav.setAttribute("aria-label", "Navigation Prep");

    // Tab links in sidebar
    const LABELS: Record<TabId, string> = {
      import: "Importer",
      documents: "Documents",
      actions: "Actions",
      exporter: "Exporter",
    };
    const ICONS: Record<TabId, string> = {
      import: "⊕",
      documents: "≡",
      actions: "◈",
      exporter: "⊗",
    };
    for (const tab of TABS) {
      const btn = document.createElement("button");
      btn.className = "prep-nav-tab" + (tab === this._activeTab ? " active" : "");
      if (tab === this._activeTab) btn.setAttribute("aria-current", "page");
      btn.title = LABELS[tab];
      const iconEl = document.createElement("span");
      iconEl.className = "nav-icon";
      iconEl.textContent = ICONS[tab];
      const labelEl = document.createElement("span");
      labelEl.className = "nav-label";
      labelEl.textContent = LABELS[tab];
      btn.appendChild(iconEl);
      btn.appendChild(labelEl);
      btn.addEventListener("click", () => {
        this._switchTab(tab);
        if (tab === "actions") this._actions.setSubView("hub");
      });
      this._tabBtns[tab] = btn as HTMLButtonElement;
      nav.appendChild(btn);

      // Raccourcis sous « Actions »
      if (tab === "actions") {
        const treeBody = document.createElement("div");
        treeBody.className = "prep-nav-tree-body";
        treeBody.setAttribute("aria-label", "Raccourcis Actions");
        const treeItems: Array<[string, string, string]> = [
          ["Curation",     "curation",    "◇"],
          ["Segmentation", "segmentation","⌥"],
          ["Alignement",   "alignement",  "⇄"],
          ["Annotation",   "annoter",     "◎"],
        ];
        for (const [label, navKey, icon] of treeItems) {
          const link = document.createElement("button");
          link.className = "prep-nav-tree-link";
          link.dataset.nav = navKey;
          link.title = label;
          const treeIcon = document.createElement("span");
          treeIcon.className = "nav-icon";
          treeIcon.textContent = icon;
          const treeLabel = document.createElement("span");
          treeLabel.className = "nav-label";
          treeLabel.textContent = label;
          link.appendChild(treeIcon);
          link.appendChild(treeLabel);
          link.addEventListener("click", () => {
            this._switchTab("actions");
            this._actions.setSubView(navKey as "curation" | "segmentation" | "alignement" | "annoter");
          });
          treeBody.appendChild(link);
        }
        const actionsBlock = document.createElement("div");
        actionsBlock.className = "prep-nav-tree";
        actionsBlock.appendChild(treeBody);
        nav.appendChild(actionsBlock);
      }
    }

    shell.appendChild(nav);

    // Main content area
    const main = document.createElement("div");
    main.className = "prep-main";
    main.id = "prep-main-content";
    main.setAttribute("role", "main");
    shell.appendChild(main);

    root.appendChild(shell);

    // Content
    const content = document.createElement("div");
    content.className = "content";

    // Job Center strip
    this._jobCenter = new JobCenter();
    main.appendChild(this._jobCenter.render());

    this._import = new ImportScreen();
    this._actions = new ActionsScreen();
    this._metadata = new MetadataScreen();
    this._exports = new ExportsScreen();
    this._screenControllers = {
      import: this._import as GuardableScreen,
      documents: this._metadata,
      actions: this._actions,
      exporter: this._exports as GuardableScreen,
    };

    const screenMap: Record<TabId, () => HTMLElement> = {
      import: () => this._import.render(),
      documents: () => this._metadata.render(),
      actions: () => this._actions.render(),
      exporter: () => this._exports.render(),
    };

    for (const tab of TABS) {
      const el = screenMap[tab]();
      el.classList.add("prep-screen");
      if (tab === this._activeTab) el.classList.add("active");
      this._screenEls[tab] = el;
      content.appendChild(el);
    }

    main.appendChild(content);
    this._syncCurationWideClass();

    // Share global log element with all screens
    this._import.setLogEl(this._logEl);
    this._actions.setLogEl(this._logEl);
    this._metadata.setLogEl(this._logEl);
    this._exports.setLogEl(this._logEl);
  }

  private _toggleJournal(root: HTMLElement): void {
    this._journalOpen = !this._journalOpen;
    const drawer = root.querySelector<HTMLElement>("#prep-journal-drawer");
    const btn = root.querySelector<HTMLButtonElement>("#prep-journal-btn");
    if (drawer) {
      drawer.classList.toggle("open", this._journalOpen);
      drawer.setAttribute("aria-hidden", String(!this._journalOpen));
      if (this._journalOpen) {
        // Scroll to bottom when opening
        const log = drawer.querySelector<HTMLElement>("#prep-journal-log");
        if (log) log.scrollTop = log.scrollHeight;
      }
    }
    if (btn) btn.classList.toggle("active", this._journalOpen);
  }

  private _switchTab(tab: TabId, force = false): void {
    if (tab === this._activeTab) return;
    const cur = this._screenControllers[this._activeTab];
    if (!force && cur?.hasPendingChanges?.()) {
      const msg = cur.pendingChangesMessage?.() ?? "Des modifications non enregistrées. Continuer ?";
      const confirmEl = document.getElementById("app-pending-confirm") as HTMLElement | null;
      if (confirmEl) {
        void inlineConfirm(confirmEl, msg, { confirmLabel: "Continuer", danger: false })
          .then(ok => { if (ok) this._switchTab(tab, true); });
        return;
      }
      return;
    }
    this._screenEls[this._activeTab].classList.remove("active");
    this._tabBtns[this._activeTab].classList.remove("active");
    this._tabBtns[this._activeTab].removeAttribute("aria-current");
    this._activeTab = tab;
    this._screenEls[tab].classList.add("active");
    this._tabBtns[tab].classList.add("active");
    this._tabBtns[tab].setAttribute("aria-current", "page");
    this._syncCurationWideClass();
    if (tab === "documents") this._metadata.onActivate();
  }

  private _openExporterWithPrefill(prefill?: ExportWorkflowPrefill): void {
    this._switchTab("exporter", true);
    if (this._activeTab !== "exporter") return;
    if (prefill) this._exports.applyWorkflowPrefill(prefill);
  }

  private _syncCurationWideClass(): void {
    const content = document.querySelector<HTMLElement>("#prep-main-content > .content");
    if (!content) return;
    const actionsScreen = this._screenEls.actions;
    const curationActive = this._activeTab === "actions" && actionsScreen?.classList.contains("actions-sub-curation");
    content.classList.toggle("prep-curation-wide", Boolean(curationActive));
  }

  private _hasPendingChangesInCurrentTab(): boolean {
    return Boolean(this._screenControllers[this._activeTab]?.hasPendingChanges?.());
  }

  private _dbBadge(): string {
    const p = getCurrentDbPath();
    if (!p) return "Aucun corpus";
    return p.replace(/\\/g, "/").split("/").pop() ?? p;
  }

  /** Met à jour le libellé topbar (titre du corpus + nom de fichier) et le title (chemin complet). */
  private async _refreshTopbarDbLabel(): Promise<void> {
    const p = getCurrentDbPath();
    const file = this._dbBadge();
    if (!this._conn) {
      this._dbPathEl.textContent = file;
      this._dbPathEl.title = p ? `Chemin complet : ${p.replace(/\\/g, "/")}` : "";
      return;
    }
    try {
      const info = await getCorpusInfo(this._conn);
      const t = info.title?.trim();
      this._dbPathEl.textContent = t ? `${t} \u2014 ${file}` : file;
      this._dbPathEl.title = p ? `Chemin complet : ${p.replace(/\\/g, "/")}` : "";
    } catch {
      this._dbPathEl.textContent = file;
      this._dbPathEl.title = p ? `Chemin complet : ${p.replace(/\\/g, "/")}` : "";
    }
  }

  private _buildShellOpenDbDeepLink(dbPath: string): string {
    return `agrafes-shell://open-db?mode=explorer&path=${encodeURIComponent(dbPath)}`;
  }

  private _buildStandaloneOpenDbDeepLink(dbPath: string): string {
    return `agrafes://open-db?path=${encodeURIComponent(dbPath)}`;
  }

  private async _openInConcordancier(): Promise<void> {
    const dbPath = getCurrentDbPath();
    if (!dbPath) {
      showToast("Aucune DB active à transmettre.", true);
      return;
    }

    const shellUri = this._buildShellOpenDbDeepLink(dbPath);
    const standaloneUri = this._buildStandaloneOpenDbDeepLink(dbPath);

    let opened = false;
    try {
      await shellOpen(shellUri);
      opened = true;
    } catch {
      try {
        await shellOpen(standaloneUri);
        opened = true;
      } catch {
        try {
          const w = window.open(shellUri, "_blank");
          opened = w !== null;
        } catch {
          opened = false;
        }
      }
    }

    if (opened) {
      showToast("Ouverture Concordancier/Shell demandée (deep-link).");
      return;
    }

    try {
      const w = window.open(standaloneUri, "_blank");
      opened = w !== null;
    } catch {
      opened = false;
    }

    if (opened) {
      showToast("Ouverture Concordancier standalone demandée (fallback).");
      return;
    }

    // All open attempts failed — copy to clipboard as last resort
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shellUri);
        copied = true;
      }
    } catch {
      copied = false;
    }

    if (copied) {
      showToast("Deep-link Shell copié. Ouvre-le depuis le presse-papiers si nécessaire.");
      return;
    }

    showToast(`Deep-link prêt: ${shellUri}`);
  }

  private async _onOpenDb(): Promise<void> {
    let picked: string | string[] | null;
    try {
      picked = await dialogOpen({
        title: "Ouvrir une base de données SQLite",
        filters: [{ name: "SQLite", extensions: ["db", "sqlite", "sqlite3"] }],
        multiple: false,
      });
    } catch { return; }
    const p = Array.isArray(picked) ? picked[0] : picked;
    if (!p) return;
    setCurrentDbPath(p);
    this._dbPathEl.textContent = this._dbBadge();
    await this._onDbChanged(p);
    showToast(`DB active\u00a0: ${this._dbBadge()}`);
  }

  private async _onCreateDb(root: HTMLElement): Promise<void> {
    let savePath: string | null;
    try {
      savePath = await dialogSave({
        title: "Créer une nouvelle base de données AGRAFES",
        filters: [{ name: "SQLite", extensions: ["db"] }],
        defaultPath: "nouveau_corpus.db",
      });
    } catch { return; }
    if (!savePath) return;
    if (!/\.(db|sqlite|sqlite3)$/i.test(savePath)) savePath += ".db";

    setCurrentDbPath(savePath);
    this._dbPathEl.textContent = this._dbBadge();

    // Show init state
    const createBtns = root.querySelectorAll<HTMLButtonElement>(".prep-topbar-db-btn");
    createBtns.forEach(b => { b.disabled = true; });

    // Remove any stale error banner
    root.querySelector(".prep-init-error")?.remove();

    try {
      await this._onDbChanged(savePath);
      showToast(`DB initialis\u00e9e\u00a0: ${this._dbBadge()}`);
    } catch (err) {
      this._showPrepInitError(root, savePath, String(err));
    } finally {
      createBtns.forEach(b => { b.disabled = false; });
    }
  }

  private _showPrepInitError(root: HTMLElement, dbPath: string, msg: string): void {
    root.querySelector(".prep-init-error")?.remove();
    const banner = document.createElement("div");
    banner.className = "prep-init-error";
    banner.innerHTML = `
      <span style="color:#856404;font-size:1.1rem">&#9888;</span>
      <span style="font-weight:600;color:#856404;white-space:nowrap">Impossible d&rsquo;initialiser la DB</span>
      <code class="prep-init-error-detail">${msg.replace(/&/g,"&amp;").replace(/</g,"&lt;")}</code>
      <button id="prep-retry-btn" class="prep-topbar-db-btn">R&eacute;essayer</button>
      <button id="prep-change-btn" class="prep-topbar-db-btn">Choisir un autre&hellip;</button>
      <button id="prep-dismiss-btn" class="prep-topbar-db-btn">&times;</button>
    `;
    // Insert after topbar
    root.querySelector(".prep-topbar")?.insertAdjacentElement("afterend", banner);
    banner.querySelector("#prep-retry-btn")?.addEventListener("click", () => {
      banner.remove();
      void this._onCreateDb(root);
    });
    banner.querySelector("#prep-change-btn")?.addEventListener("click", () => {
      banner.remove();
      void this._onOpenDb();
    });
    banner.querySelector("#prep-dismiss-btn")?.addEventListener("click", () => banner.remove());
  }

  // ─── Fiche corpus (métadonnées DB) ─────────────────────────────────────────

  private async _showCorpusInfoModal(): Promise<void> {
    if (!this._conn) {
      showToast("Ouvrez ou cr\u00e9ez une base pour \u00e9diter la fiche corpus.", true);
      return;
    }
    let info;
    try {
      info = await getCorpusInfo(this._conn);
    } catch (err) {
      showToast(`Lecture fiche corpus : ${String(err)}`, true);
      return;
    }

    const overlay = document.createElement("div");
    overlay.className = "prep-presets-overlay";

    const modal = document.createElement("div");
    modal.className = "prep-presets-modal";
    overlay.appendChild(modal);

    const head = document.createElement("div");
    head.className = "prep-presets-modal-head";
    head.innerHTML = `<h3>\uD83D\uDCC4 Fiche corpus</h3>`;
    const closeX = document.createElement("button");
    closeX.className = "btn btn-secondary btn-sm";
    closeX.textContent = "\u2715 Fermer";
    closeX.addEventListener("click", () => overlay.remove());
    head.appendChild(closeX);
    modal.appendChild(head);

    const body = document.createElement("div");
    body.className = "prep-presets-modal-body";
    const metaBase: Record<string, unknown> = { ...info.meta };
    const q0 = typeof metaBase.qualifier === "string" ? metaBase.qualifier : "";
    const tags0 = Array.isArray(metaBase.tags)
      ? metaBase.tags.map((x) => String(x)).join(", ")
      : "";

    body.innerHTML = `
      <label class="prep-corpus-label">Titre du corpus
        <input type="text" id="ci-title" class="prep-corpus-input" autocomplete="off"
          placeholder="Nom lisible (affich\u00e9 dans la barre)" />
      </label>
      <label class="prep-corpus-label">Descriptif
        <textarea id="ci-desc" class="prep-corpus-textarea" rows="5"
          placeholder="Contexte, sources, contraintes\u2026"></textarea>
      </label>
      <label class="prep-corpus-label">Qualification / usage
        <input type="text" id="ci-qual" class="prep-corpus-input" autocomplete="off"
          placeholder="ex. production, brouillon, archive\u2026" />
      </label>
      <label class="prep-corpus-label">Mots-cl\u00e9s (s\u00e9par\u00e9s par des virgules)
        <input type="text" id="ci-tags" class="prep-corpus-input" autocomplete="off"
          placeholder="fr, en, th\u00e9\u00e2tre\u2026" />
      </label>
      <p class="prep-corpus-hint">Les champs optionnels sont stock\u00e9s dans la base (table <code>corpus_info</code>) avec des m\u00e9tadonn\u00e9es flexibles (<code>meta</code>).</p>
    `;
    (body.querySelector("#ci-title") as HTMLInputElement).value = info.title ?? "";
    (body.querySelector("#ci-desc") as HTMLTextAreaElement).value = info.description ?? "";
    (body.querySelector("#ci-qual") as HTMLInputElement).value = q0;
    (body.querySelector("#ci-tags") as HTMLInputElement).value = tags0;
    modal.appendChild(body);

    const foot = document.createElement("div");
    foot.className = "prep-presets-modal-foot";
    const saveBtn = document.createElement("button");
    saveBtn.className = "btn btn-primary btn-sm";
    saveBtn.textContent = "Enregistrer";
    saveBtn.addEventListener("click", async () => {
      if (!this._conn) return;
      const title = (modal.querySelector("#ci-title") as HTMLInputElement).value.trim() || null;
      const description = (modal.querySelector("#ci-desc") as HTMLTextAreaElement).value.trim() || null;
      const qual = (modal.querySelector("#ci-qual") as HTMLInputElement).value.trim();
      const tagsRaw = (modal.querySelector("#ci-tags") as HTMLInputElement).value;
      const tags = tagsRaw.split(",").map((s) => s.trim()).filter(Boolean);
      const nextMeta: Record<string, unknown> = { ...metaBase };
      if (qual) nextMeta.qualifier = qual;
      else delete nextMeta.qualifier;
      if (tags.length) nextMeta.tags = tags;
      else delete nextMeta.tags;
      try {
        await updateCorpusInfo(this._conn, {
          title,
          description,
          meta: nextMeta,
        });
        overlay.remove();
        await this._refreshTopbarDbLabel();
        showToast("Fiche corpus enregistr\u00e9e.");
      } catch (err) {
        showToast(`Enregistrement : ${String(err)}`, true);
      }
    });
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "btn btn-secondary btn-sm";
    cancelBtn.textContent = "Annuler";
    cancelBtn.addEventListener("click", () => overlay.remove());
    foot.appendChild(saveBtn);
    foot.appendChild(cancelBtn);
    modal.appendChild(foot);

    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") overlay.remove(); }, { once: true });
    document.body.appendChild(overlay);
  }

  // ─── Presets modal ─────────────────────────────────────────────────────────

  private _showPresetsModal(): void {
    const overlay = document.createElement("div");
    overlay.className = "prep-presets-overlay";

    const modal = document.createElement("div");
    modal.className = "prep-presets-modal";
    overlay.appendChild(modal);

    const head = document.createElement("div");
    head.className = "prep-presets-modal-head";
    head.innerHTML = `<h3>\uD83D\uDCCB Presets de projet</h3>`;
    const closeX = document.createElement("button");
    closeX.className = "btn btn-secondary btn-sm";
    closeX.textContent = "\u2715 Fermer";
    closeX.addEventListener("click", () => overlay.remove());
    head.appendChild(closeX);
    modal.appendChild(head);

    const body = document.createElement("div");
    body.className = "prep-presets-modal-body";
    modal.appendChild(body);

    const foot = document.createElement("div");
    foot.className = "prep-presets-modal-foot";
    modal.appendChild(foot);

    const renderList = (): void => {
      body.innerHTML = "";
      const presets = this._presets;
      if (presets.length === 0) {
        body.innerHTML = `<p class="prep-presets-empty">Aucun preset. Créez-en un ou importez un fichier JSON.</p>`;
        return;
      }
      for (const preset of presets) {
        const row = document.createElement("div");
        row.className = "prep-preset-row";

        const info = document.createElement("div");
        info.style.flex = "1";
        info.innerHTML = `<span class="prep-preset-name">${preset.name}</span>` +
          (preset.description ? `<span class="prep-preset-desc">${preset.description}</span>` : "");
        const chips = document.createElement("div");
        chips.className = "prep-preset-chips";
        if (preset.languages?.length) {
          chips.innerHTML += preset.languages.map(l => `<span class="prep-preset-chip">${l}</span>`).join("");
        }
        if (preset.alignment_strategy)
          chips.innerHTML += `<span class="prep-preset-chip">${preset.alignment_strategy}</span>`;
        if (preset.segmentation_pack)
          chips.innerHTML += `<span class="prep-preset-chip">seg:${preset.segmentation_pack}</span>`;
        info.appendChild(chips);
        row.appendChild(info);

        const applyBtn = document.createElement("button");
        applyBtn.className = "btn btn-primary btn-sm";
        applyBtn.textContent = "Appliquer";
        applyBtn.addEventListener("click", () => {
          this._actions.applyPreset(preset);
          this._switchTab("actions");
          overlay.remove();
          showToast(`Preset appliqu\u00e9\u00a0: ${preset.name}`);
        });

        const dupBtn = document.createElement("button");
        dupBtn.className = "btn btn-secondary btn-sm";
        dupBtn.textContent = "Dupliquer";
        dupBtn.addEventListener("click", () => {
          const duped: ProjectPreset = {
            ...preset,
            id: `preset-${Date.now()}`,
            name: `${preset.name} (copie)`,
            created_at: Date.now(),
          };
          this._presets = [...this._presets, duped];
          this._savePresetsToDb();
          renderList();
        });

        const delBtn = document.createElement("button");
        delBtn.className = "btn btn-danger btn-sm";
        delBtn.textContent = "\u2715";
        delBtn.title = "Supprimer ce preset";
        delBtn.addEventListener("click", () => {
          // Inline confirm: replace the row buttons temporarily
          const confirmSpan = document.createElement("span");
          confirmSpan.className = "inline-confirm-msg";
          confirmSpan.style.cssText = "display:inline-flex;gap:0.35rem;align-items:center;font-size:0.82rem";
          confirmSpan.innerHTML =
            `<span>Supprimer « ${preset.name.replace(/&/g,"&amp;").replace(/</g,"&lt;")} » ?</span>` +
            `<button class="btn btn-danger btn-sm" data-confirm-yes>Confirmer</button>` +
            `<button class="btn btn-ghost btn-sm" data-confirm-no>Annuler</button>`;
          delBtn.replaceWith(confirmSpan);
          const yes = confirmSpan.querySelector<HTMLButtonElement>("[data-confirm-yes]")!;
          const no  = confirmSpan.querySelector<HTMLButtonElement>("[data-confirm-no]")!;
          yes.focus();
          yes.addEventListener("click", () => {
            this._presets = this._presets.filter(p => p.id !== preset.id);
            this._savePresetsToDb();
            renderList();
          }, { once: true });
          no.addEventListener("click", () => { confirmSpan.replaceWith(delBtn); }, { once: true });
        });

        row.appendChild(applyBtn);
        row.appendChild(dupBtn);
        row.appendChild(delBtn);
        body.appendChild(row);
      }
    };

    renderList();

    // ── Foot actions ──
    const newBtn = document.createElement("button");
    newBtn.className = "btn btn-secondary btn-sm";
    newBtn.textContent = "+ Nouveau preset";
    newBtn.addEventListener("click", () => this._showPresetEditModal(null, renderList));

    const importBtn = document.createElement("button");
    importBtn.className = "btn btn-secondary btn-sm";
    importBtn.textContent = "\u2B06 Importer\u2026";
    importBtn.addEventListener("click", async () => {
      try {
        const picked = await dialogOpen({
          title: "Importer un preset JSON",
          filters: [{ name: "JSON", extensions: ["json"] }],
          multiple: false,
        });
        const path = Array.isArray(picked) ? picked[0] : picked;
        if (!path) return;
        const raw = await readTextFile(path);
        const data = JSON.parse(raw);
        const presets = Array.isArray(data) ? data as ProjectPreset[] : [data as ProjectPreset];
        const all = [...this._presets];
        for (const p of presets) {
          if (!p.id) p.id = `preset-${Date.now()}`;
          if (!p.name) p.name = "Preset import\u00e9";
          if (!p.created_at) p.created_at = Date.now();
          all.push(p);
        }
        this._presets = all;
        this._savePresetsToDb();
        renderList();
        showToast(`${presets.length} preset(s) import\u00e9(s)`);
      } catch (err) {
        showToast(`Erreur import : ${String(err)}`, true);
      }
    });

    const exportBtn = document.createElement("button");
    exportBtn.className = "btn btn-secondary btn-sm";
    exportBtn.textContent = "\u2B07 Exporter\u2026";
    exportBtn.addEventListener("click", async () => {
      try {
        const path = await dialogSave({
          title: "Exporter les presets",
          filters: [{ name: "JSON", extensions: ["json"] }],
          defaultPath: "agrafes_presets.json",
        });
        if (!path) return;
        await writeTextFile(path, JSON.stringify(this._presets, null, 2));
        showToast(`Presets export\u00e9s (${this._presets.length})`);
      } catch (err) {
        showToast(`Erreur export : ${String(err)}`, true);
      }
    });

    foot.appendChild(newBtn);
    foot.appendChild(importBtn);
    foot.appendChild(exportBtn);

    // Close on overlay click (not modal click)
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") overlay.remove(); }, { once: true });

    document.body.appendChild(overlay);
  }

  private _showPresetEditModal(preset: ProjectPreset | null, onSave: () => void): void {
    const isNew = preset === null;
    const draft: ProjectPreset = preset ? { ...preset } : {
      id: `preset-${Date.now()}`,
      name: "",
      description: "",
      languages: ["fr"],
      pivot_language: "fr",
      segmentation_lang: "fr",
      segmentation_pack: "auto",
      curation_preset: "spaces",
      alignment_strategy: "external_id_then_position",
      created_at: Date.now(),
    };

    const overlay = document.createElement("div");
    overlay.className = "prep-presets-overlay";
    overlay.style.zIndex = "9100";

    const modal = document.createElement("div");
    modal.className = "prep-presets-modal";
    overlay.appendChild(modal);

    modal.innerHTML = `
      <div class="prep-presets-modal-head">
        <h3>${isNew ? "Nouveau preset" : "Modifier preset"}</h3>
      </div>
      <div class="prep-presets-modal-body">
        <label style="display:flex;flex-direction:column;gap:0.2rem;margin-bottom:0.5rem;font-size:0.85rem">
          Nom <input id="pe-name" type="text" value="${draft.name}" style="padding:0.25rem 0.4rem;border:1px solid #dee2e6;border-radius:4px" />
        </label>
        <label style="display:flex;flex-direction:column;gap:0.2rem;margin-bottom:0.5rem;font-size:0.85rem">
          Description <input id="pe-desc" type="text" value="${draft.description ?? ""}" style="padding:0.25rem 0.4rem;border:1px solid #dee2e6;border-radius:4px" />
        </label>
        <label style="display:flex;flex-direction:column;gap:0.2rem;margin-bottom:0.5rem;font-size:0.85rem">
          Langues (séparées par virgule) <input id="pe-langs" type="text" value="${(draft.languages ?? []).join(",")}" style="padding:0.25rem 0.4rem;border:1px solid #dee2e6;border-radius:4px" />
        </label>
        <label style="display:flex;flex-direction:column;gap:0.2rem;margin-bottom:0.5rem;font-size:0.85rem">
          Langue pivot <input id="pe-pivot" type="text" value="${draft.pivot_language ?? ""}" style="padding:0.25rem 0.4rem;border:1px solid #dee2e6;border-radius:4px;width:80px" />
        </label>
        <div style="display:flex;gap:1rem;flex-wrap:wrap;margin-bottom:0.5rem">
          <label style="display:flex;flex-direction:column;gap:0.2rem;font-size:0.85rem">Langue segmentation
            <input id="pe-seg-lang" type="text" value="${draft.segmentation_lang ?? ""}" style="padding:0.25rem 0.4rem;border:1px solid #dee2e6;border-radius:4px;width:80px" />
          </label>
          <label style="display:flex;flex-direction:column;gap:0.2rem;font-size:0.85rem">Pack segmentation
            <select id="pe-seg-pack" style="padding:0.25rem 0.4rem;border:1px solid #dee2e6;border-radius:4px">
              <option value="auto" ${draft.segmentation_pack === "auto" ? "selected" : ""}>auto</option>
              <option value="fr_strict" ${draft.segmentation_pack === "fr_strict" ? "selected" : ""}>fr_strict</option>
              <option value="en_strict" ${draft.segmentation_pack === "en_strict" ? "selected" : ""}>en_strict</option>
              <option value="default" ${draft.segmentation_pack === "default" ? "selected" : ""}>default</option>
            </select>
          </label>
        </div>
        <div style="display:flex;gap:1rem;flex-wrap:wrap;margin-bottom:0.5rem">
          <label style="display:flex;flex-direction:column;gap:0.2rem;font-size:0.85rem">Preset curation
            <select id="pe-curation" style="padding:0.25rem 0.4rem;border:1px solid #dee2e6;border-radius:4px">
              <option value="spaces" ${draft.curation_preset === "spaces" ? "selected" : ""}>Espaces</option>
              <option value="quotes" ${draft.curation_preset === "quotes" ? "selected" : ""}>Apostrophes</option>
              <option value="punctuation" ${draft.curation_preset === "punctuation" ? "selected" : ""}>Ponctuation</option>
              <option value="custom" ${draft.curation_preset === "custom" ? "selected" : ""}>Personnalis\u00e9</option>
            </select>
          </label>
          <label style="display:flex;flex-direction:column;gap:0.2rem;font-size:0.85rem">Strat\u00e9gie alignement
            <select id="pe-strategy" style="padding:0.25rem 0.4rem;border:1px solid #dee2e6;border-radius:4px">
              <option value="external_id" ${draft.alignment_strategy === "external_id" ? "selected" : ""}>external_id</option>
              <option value="external_id_then_position" ${draft.alignment_strategy === "external_id_then_position" ? "selected" : ""}>hybride</option>
              <option value="position" ${draft.alignment_strategy === "position" ? "selected" : ""}>position</option>
              <option value="similarity" ${draft.alignment_strategy === "similarity" ? "selected" : ""}>similarit\u00e9</option>
            </select>
          </label>
        </div>
      </div>
      <div class="prep-presets-modal-foot"></div>
    `;

    const foot = modal.querySelector(".presets-modal-foot")!;
    const saveBtn = document.createElement("button");
    saveBtn.className = "btn btn-primary btn-sm";
    saveBtn.textContent = "Enregistrer";
    saveBtn.addEventListener("click", () => {
      const nameVal = (modal.querySelector<HTMLInputElement>("#pe-name")!).value.trim();
      if (!nameVal) { alert("Le nom est requis."); return; }
      const saved: ProjectPreset = {
        ...draft,
        name: nameVal,
        description: (modal.querySelector<HTMLInputElement>("#pe-desc")!).value.trim() || undefined,
        languages: (modal.querySelector<HTMLInputElement>("#pe-langs")!).value.split(",").map(l => l.trim()).filter(Boolean),
        pivot_language: (modal.querySelector<HTMLInputElement>("#pe-pivot")!).value.trim() || undefined,
        segmentation_lang: (modal.querySelector<HTMLInputElement>("#pe-seg-lang")!).value.trim() || undefined,
        segmentation_pack: (modal.querySelector<HTMLSelectElement>("#pe-seg-pack")!).value || undefined,
        curation_preset: (modal.querySelector<HTMLSelectElement>("#pe-curation")!).value || undefined,
        alignment_strategy: (modal.querySelector<HTMLSelectElement>("#pe-strategy")!).value || undefined,
        created_at: draft.created_at || Date.now(),
      };
      const all = this._presets.filter(p => p.id !== saved.id);
      all.push(saved);
      this._presets = all;
      this._savePresetsToDb();
      overlay.remove();
      onSave();
      showToast(`Preset ${isNew ? "cr\u00e9\u00e9" : "mis \u00e0 jour"}\u00a0: ${saved.name}`);
    });
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "btn btn-secondary btn-sm";
    cancelBtn.textContent = "Annuler";
    cancelBtn.addEventListener("click", () => overlay.remove());
    foot.appendChild(saveBtn);
    foot.appendChild(cancelBtn);

    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") overlay.remove(); }, { once: true });
    document.body.appendChild(overlay);
  }

  private async _onDbChanged(dbPath: string): Promise<void> {
    try {
      this._conn = await ensureRunning(dbPath);
    } catch (err) {
      this._conn = null;
      console.error("db-changed: sidecar failed", err instanceof SidecarError ? err.message : err);
    }
    this._import.setConn(this._conn);
    this._actions.setConn(this._conn);
    this._metadata.setConn(this._conn);
    this._exports.setConn(this._conn);
    this._jobCenter.setConn(this._conn);
    this._import.setJobCenter(this._jobCenter, showToast);
    this._actions.setJobCenter(this._jobCenter, showToast);
    this._exports.setJobCenter(this._jobCenter, showToast);
    await Promise.all([this._refreshTopbarDbLabel(), this._loadPresetsFromDb()]);
  }

  /** Stop all background timers and remove event listeners. Called by tauri-shell on unmount. */
  dispose(): void {
    this._actions.dispose();
    this._jobCenter?.setConn(null);
    if (this._beforeUnloadHandler) {
      window.removeEventListener("beforeunload", this._beforeUnloadHandler);
      this._beforeUnloadHandler = null;
    }
  }
}
