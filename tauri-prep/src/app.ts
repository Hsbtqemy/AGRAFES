/**
 * app.ts — ConcordancierPrep V0.4 shell.
 *
 * Tab navigation: [Importer] [Documents] [Actions] [Exporter]
 * Manages shared Conn state and propagates db-changed events.
 */

import type { Conn } from "./lib/sidecarClient.ts";
import { ensureRunning, SidecarError } from "./lib/sidecarClient.ts";
import { getCurrentDbPath, setCurrentDbPath, getOrCreateDefaultDbPath } from "./lib/db.ts";
import { open as dialogOpen, save as dialogSave } from "@tauri-apps/plugin-dialog";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { writeTextFile, readTextFile } from "@tauri-apps/plugin-fs";
import { ImportScreen } from "./screens/ImportScreen.ts";
import { ActionsScreen, type ProjectPreset } from "./screens/ActionsScreen.ts";
import { MetadataScreen } from "./screens/MetadataScreen.ts";
import { ExportsScreen } from "./screens/ExportsScreen.ts";
import { JobCenter, showToast } from "./components/JobCenter.ts";

// ─── Project Presets store ─────────────────────────────────────────────────────

const LS_PRESETS = "agrafes.prep.presets";

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

function _loadPresets(): ProjectPreset[] {
  try {
    const raw = localStorage.getItem(LS_PRESETS);
    return raw ? JSON.parse(raw) as ProjectPreset[] : SEED_PRESETS.map(p => ({ ...p }));
  } catch { return SEED_PRESETS.map(p => ({ ...p })); }
}

function _savePresets(presets: ProjectPreset[]): void {
  try { localStorage.setItem(LS_PRESETS, JSON.stringify(presets)); } catch { /* */ }
}

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

  /** beforeunload handler stored so dispose() can remove it cleanly. */
  private _beforeUnloadHandler: ((e: BeforeUnloadEvent) => void) | null = null;

  async init(): Promise<void> {
    // CSS is now loaded by Vite (app.css + job-center.css) — no inline injection needed.

    // Try to auto-open default DB
    try {
      const dbPath = await getOrCreateDefaultDbPath();
      setCurrentDbPath(dbPath);
      this._conn = await ensureRunning(dbPath);
    } catch {
      // no auto-start, user can open manually
    }

    this._buildUI();
    this._import.setConn(this._conn);
    this._actions.setConn(this._conn);
    this._metadata.setConn(this._conn);
    this._exports.setConn(this._conn);
    this._jobCenter.setConn(this._conn);
    this._import.setJobCenter(this._jobCenter, showToast);
    this._actions.setJobCenter(this._jobCenter, showToast);
    this._actions.setOnOpenDocuments(() => this._switchTab("documents"));
    this._exports.setJobCenter(this._jobCenter, showToast);

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
    topbar.className = "topbar";
    topbar.setAttribute("role", "banner");

    const titleEl = document.createElement("span");
    titleEl.className = "topbar-title";
    titleEl.textContent = "Constituer";

    const dbPathEl = document.createElement("span");
    dbPathEl.id = "topbar-dbpath";
    dbPathEl.className = "topbar-dbpath";
    dbPathEl.textContent = this._dbBadge();

    const openBtn = document.createElement("button");
    openBtn.className = "topbar-db-btn";
    openBtn.textContent = "Ouvrir\u2026";
    openBtn.title = "Ouvrir une base de données existante";
    openBtn.addEventListener("click", () => void this._onOpenDb());

    const createBtn = document.createElement("button");
    createBtn.className = "topbar-db-btn";
    createBtn.textContent = "Cr\u00e9er\u2026";
    createBtn.title = "Créer une nouvelle base de données";
    createBtn.addEventListener("click", () => void this._onCreateDb(root));

    const presetsBtn = document.createElement("button");
    presetsBtn.className = "topbar-db-btn";
    presetsBtn.textContent = "\uD83D\uDCCB Presets";
    presetsBtn.title = "Gérer les presets de projet";
    presetsBtn.addEventListener("click", () => this._showPresetsModal());

    const openConcordancierBtn = document.createElement("button");
    openConcordancierBtn.className = "topbar-db-btn";
    openConcordancierBtn.textContent = "\u2197 Shell";
    openConcordancierBtn.title = "Ouvrir la DB active dans AGRAFES Shell (app unifiée)";
    openConcordancierBtn.addEventListener("click", () => void this._openInConcordancier());

    topbar.appendChild(titleEl);
    topbar.appendChild(dbPathEl);
    topbar.appendChild(openBtn);
    topbar.appendChild(createBtn);
    topbar.appendChild(presetsBtn);
    topbar.appendChild(openConcordancierBtn);

    this._dbPathEl = dbPathEl;
    root.appendChild(topbar);

    // ── vNext Shell: sidebar + main grid ─────────────────────────────────────
    const shell = document.createElement("div");
    shell.className = "prep-shell";
    shell.id = "prep-shell-main";

    // Sidebar nav
    const nav = document.createElement("nav");
    nav.className = "prep-nav";
    nav.id = "prep-nav";
    nav.setAttribute("aria-label", "Navigation Prep");

    const navHead = document.createElement("div");
    navHead.className = "prep-nav-head";
    const navTitle = document.createElement("h2");
    navTitle.textContent = "Sections";
    const collapseBtn = document.createElement("button");
    collapseBtn.className = "prep-nav-collapse-btn";
    collapseBtn.title = "Masquer le panneau";
    collapseBtn.setAttribute("aria-label", "Masquer le panneau de navigation");
    collapseBtn.setAttribute("aria-expanded", "true");
    collapseBtn.setAttribute("aria-controls", "prep-nav");
    collapseBtn.textContent = "◀";
    collapseBtn.addEventListener("click", () => this._toggleNav(shell, collapseBtn));
    navHead.appendChild(navTitle);
    navHead.appendChild(collapseBtn);
    nav.appendChild(navHead);

    // Tab links in sidebar
    const LABELS: Record<TabId, string> = {
      import: "Importer",
      documents: "Documents",
      actions: "Actions",
      exporter: "Exporter",
    };
    for (const tab of TABS) {
      const btn = document.createElement("button");
      btn.className = "prep-nav-tab" + (tab === this._activeTab ? " active" : "");
      if (tab === this._activeTab) btn.setAttribute("aria-current", "page");
      btn.textContent = LABELS[tab];
      btn.addEventListener("click", () => this._switchTab(tab));
      this._tabBtns[tab] = btn as HTMLButtonElement;
      nav.appendChild(btn);

      // Actions sub-tree (shortcuts to major sections)
      if (tab === "actions") {
        const tree = document.createElement("details");
        tree.className = "prep-nav-tree";
        tree.open = true;
        const summary = document.createElement("summary");
        summary.className = "prep-nav-tree-summary";
        summary.innerHTML = `Actions disponibles <span class="prep-nav-tree-caret" aria-hidden="true">▾</span>`;
        tree.appendChild(summary);
        const treeBody = document.createElement("div");
        treeBody.className = "prep-nav-tree-body";
        const treeItems: Array<[string, string, string]> = [
          ["Curation", "#act-curate-card", "curation"],
          ["Segmentation", "#act-seg-card", "segmentation"],
          ["Alignement", "#act-align-card", "alignement"],
        ];
        for (const [label, , navKey] of treeItems) {
          const link = document.createElement("button");
          link.className = "prep-nav-tree-link";
          link.dataset.nav = navKey;
          link.textContent = label;
          link.addEventListener("click", () => {
            this._switchTab("actions");
            this._actions.setSubView(navKey as "curation" | "segmentation" | "alignement");
          });
          treeBody.appendChild(link);
        }
        tree.appendChild(treeBody);
        nav.appendChild(tree);
      }
    }

    shell.appendChild(nav);

    // Left rail (visible when sidebar is collapsed)
    const leftRail = document.createElement("div");
    leftRail.className = "prep-rail";
    leftRail.setAttribute("aria-label", "Rouvrir le panneau");
    const expandBtn = document.createElement("button");
    expandBtn.className = "prep-rail-expand-btn";
    expandBtn.title = "Ouvrir la navigation";
    expandBtn.setAttribute("aria-label", "Ouvrir le panneau de navigation");
    expandBtn.textContent = "▶";
    expandBtn.addEventListener("click", () => this._toggleNav(shell));
    leftRail.appendChild(expandBtn);
    shell.appendChild(leftRail);

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
      el.classList.add("screen");
      if (tab === this._activeTab) el.classList.add("active");
      this._screenEls[tab] = el;
      content.appendChild(el);
    }

    main.appendChild(content);
    this._syncCurationWideClass();
  }

  private _toggleNav(shell: HTMLElement, btn?: HTMLButtonElement): void {
    const nowHidden = shell.classList.toggle("nav-hidden");
    // Update aria-expanded on whichever button triggered the toggle
    const collapseBtn = shell.querySelector<HTMLButtonElement>(".prep-nav-collapse-btn");
    if (collapseBtn) collapseBtn.setAttribute("aria-expanded", String(!nowHidden));
    if (btn) btn.setAttribute("aria-expanded", String(!nowHidden));
  }

  private _switchTab(tab: TabId): void {
    if (tab === this._activeTab) return;
    const cur = this._screenControllers[this._activeTab];
    if (cur?.hasPendingChanges?.()) {
      const msg = cur.pendingChangesMessage?.() ?? "Des modifications non enregistrées sont détectées. Continuer ?";
      if (!window.confirm(msg)) return;
    }
    this._screenEls[this._activeTab].classList.remove("active");
    this._tabBtns[this._activeTab].classList.remove("active");
    this._tabBtns[this._activeTab].removeAttribute("aria-current");
    this._activeTab = tab;
    this._screenEls[tab].classList.add("active");
    this._tabBtns[tab].classList.add("active");
    this._tabBtns[tab].setAttribute("aria-current", "page");
    this._syncCurationWideClass();
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

    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shellUri);
        copied = true;
      }
    } catch {
      copied = false;
    }

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
    const createBtns = root.querySelectorAll<HTMLButtonElement>(".topbar-db-btn");
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
      <button id="prep-retry-btn" class="topbar-db-btn">R&eacute;essayer</button>
      <button id="prep-change-btn" class="topbar-db-btn">Choisir un autre&hellip;</button>
      <button id="prep-dismiss-btn" class="topbar-db-btn">&times;</button>
    `;
    // Insert after topbar
    root.querySelector(".topbar")?.insertAdjacentElement("afterend", banner);
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

  // ─── Presets modal ─────────────────────────────────────────────────────────

  private _showPresetsModal(): void {
    const overlay = document.createElement("div");
    overlay.className = "presets-overlay";

    const modal = document.createElement("div");
    modal.className = "presets-modal";
    overlay.appendChild(modal);

    const head = document.createElement("div");
    head.className = "presets-modal-head";
    head.innerHTML = `<h3>\uD83D\uDCCB Presets de projet</h3>`;
    const closeX = document.createElement("button");
    closeX.className = "btn btn-secondary btn-sm";
    closeX.textContent = "\u2715 Fermer";
    closeX.addEventListener("click", () => overlay.remove());
    head.appendChild(closeX);
    modal.appendChild(head);

    const body = document.createElement("div");
    body.className = "presets-modal-body";
    modal.appendChild(body);

    const foot = document.createElement("div");
    foot.className = "presets-modal-foot";
    modal.appendChild(foot);

    const renderList = (): void => {
      body.innerHTML = "";
      const presets = _loadPresets();
      if (presets.length === 0) {
        body.innerHTML = `<p class="presets-empty">Aucun preset. Créez-en un ou importez un fichier JSON.</p>`;
        return;
      }
      for (const preset of presets) {
        const row = document.createElement("div");
        row.className = "preset-row";

        const info = document.createElement("div");
        info.style.flex = "1";
        info.innerHTML = `<span class="preset-name">${preset.name}</span>` +
          (preset.description ? `<span class="preset-desc">${preset.description}</span>` : "");
        const chips = document.createElement("div");
        chips.className = "preset-chips";
        if (preset.languages?.length) {
          chips.innerHTML += preset.languages.map(l => `<span class="preset-chip">${l}</span>`).join("");
        }
        if (preset.alignment_strategy)
          chips.innerHTML += `<span class="preset-chip">${preset.alignment_strategy}</span>`;
        if (preset.segmentation_pack)
          chips.innerHTML += `<span class="preset-chip">seg:${preset.segmentation_pack}</span>`;
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
          const all = _loadPresets();
          all.push(duped);
          _savePresets(all);
          renderList();
        });

        const delBtn = document.createElement("button");
        delBtn.className = "btn btn-danger btn-sm";
        delBtn.textContent = "\u2715";
        delBtn.title = "Supprimer ce preset";
        delBtn.addEventListener("click", () => {
          if (!confirm(`Supprimer le preset "${preset.name}" ?`)) return;
          const all = _loadPresets().filter(p => p.id !== preset.id);
          _savePresets(all);
          renderList();
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
        const all = _loadPresets();
        for (const p of presets) {
          if (!p.id) p.id = `preset-${Date.now()}`;
          if (!p.name) p.name = "Preset import\u00e9";
          if (!p.created_at) p.created_at = Date.now();
          all.push(p);
        }
        _savePresets(all);
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
        const presets = _loadPresets();
        await writeTextFile(path, JSON.stringify(presets, null, 2));
        showToast(`Presets export\u00e9s (${presets.length})`);
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
    overlay.className = "presets-overlay";
    overlay.style.zIndex = "9100";

    const modal = document.createElement("div");
    modal.className = "presets-modal";
    overlay.appendChild(modal);

    modal.innerHTML = `
      <div class="presets-modal-head">
        <h3>${isNew ? "Nouveau preset" : "Modifier preset"}</h3>
      </div>
      <div class="presets-modal-body">
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
      <div class="presets-modal-foot"></div>
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
      const all = _loadPresets().filter(p => p.id !== saved.id);
      all.push(saved);
      _savePresets(all);
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
    this._dbPathEl.textContent = dbPath;
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
  }

  /** Stop all background timers and remove event listeners. Called by tauri-shell on unmount. */
  dispose(): void {
    this._jobCenter?.setConn(null);
    if (this._beforeUnloadHandler) {
      window.removeEventListener("beforeunload", this._beforeUnloadHandler);
      this._beforeUnloadHandler = null;
    }
  }
}
