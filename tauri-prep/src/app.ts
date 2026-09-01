/**
 * app.ts — ConcordancierPrep V0.4 shell.
 *
 * Tab navigation: [Importer] [Documents] [Actions] [Exporter]
 * Manages shared Conn state and propagates db-changed events.
 */

import type { Conn } from "./lib/sidecarClient.ts";
import { ensureRunning, SidecarError, getCorpusInfo, updateCorpusInfo } from "./lib/sidecarClient.ts";
import { setCurrentDbPath, getOrCreateDefaultDbPath } from "./lib/db.ts";
import { ImportScreen } from "./screens/ImportScreen.ts";
import { ShareDocsImportScreen } from "./screens/ShareDocsImportScreen.ts";
import { ActionsScreen } from "./screens/ActionsScreen.ts";
import { MetadataScreen } from "./screens/MetadataScreen.ts";
import { ExportsScreen, type ExportWorkflowPrefill } from "./screens/ExportsScreen.ts";
import { SettingsScreen } from "./screens/SettingsScreen.ts";
import { JobCenter, showToast } from "./components/JobCenter.ts";
import { inlineConfirm } from "./lib/inlineConfirm.ts";
import { registerLevel, unregisterLevel, setPendingGuard, sync as navSync } from "./lib/navHistory.ts";

// ─── App ──────────────────────────────────────────────────────────────────────
// CSS lives in tauri-prep/src/ui/app.css + job-center.css (Vite-managed, P6).

const TABS = ["import", "shareDocs", "documents", "actions", "exporter", "settings"] as const;
type TabId = typeof TABS[number];

type GuardableScreen = {
  hasPendingChanges?: () => boolean;
  pendingChangesMessage?: () => string;
};

export class App {
  private _conn: Conn | null = null;
  private _activeTab: TabId = "import";

  private _import!: ImportScreen;
  private _shareDocs!: ShareDocsImportScreen;
  private _actions!: ActionsScreen;
  private _metadata!: MetadataScreen;
  private _exports!: ExportsScreen;
  private _settings!: SettingsScreen;
  private _jobCenter!: JobCenter;

  private _tabBtns: Record<TabId, HTMLButtonElement> = {} as never;
  private _screenEls: Record<TabId, HTMLElement> = {} as never;
  private _screenControllers: Record<TabId, GuardableScreen> = {} as never;
  private _logEl!: HTMLElement;
  private _journalOpen = false;
  /** Racine montée par `_buildUI`. Gardée pour les commandes publiques appelées
   *  depuis le shell (CHR-01), qui n'ont pas de `root` sous la main. */
  private _root!: HTMLElement;

  /** beforeunload handler stored so dispose() can remove it cleanly. */
  private _beforeUnloadHandler: ((e: BeforeUnloadEvent) => void) | null = null;
  private _focusSegmentHandler: ((e: Event) => void) | null = null;

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
    this._shareDocs.setConn(null);
    this._actions.setConn(null);
    this._metadata.setConn(null);
    this._exports.setConn(null);
    this._settings.setConn(null);
    this._jobCenter.setConn(null);
    this._import.setJobCenter(this._jobCenter, showToast);
    this._shareDocs.setJobCenter(this._jobCenter, showToast);
    this._actions.setJobCenter(this._jobCenter, showToast);
    this._metadata.setJobCenter(this._jobCenter, showToast);
    this._actions.setOnOpenExporter((prefill) => this._openExporterWithPrefill(prefill));
    // D-P9-2b — deep-link « panneau famille (Documents) → espace Alignement ». App orchestre
    // la nav inter-écrans (les écrans ne se référencent pas) : même forme que les deep-links
    // existants (switchTab puis méthode publique de l'écran cible, cf. app.ts:159/376).
    this._metadata.setOnOpenAlignment((familyId, mode) => {
      this._switchTab("actions");
      this._actions.openAlignmentOnFamily(familyId, mode);
    });
    this._exports.setJobCenter(this._jobCenter, showToast);

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
          // #23 — le pont de correction Explorer→Prep vise désormais le canvas (couche
          // Annotation), pas l'écran legacy : sélection doc + éditeur du token, prêt à corriger.
          this._actions.setSubView("texte");
          setTimeout(() => void this._actions.canvasFocusAnnotationToken(nav.doc_id, nav.token_id), 200);
        }
      }
    } catch { /* ignore */ }

    // Conventions → Prep navigation : les conventions (rôles d'unités) vivent
    // désormais dans la couche « Rôles » du canvas (retrait Seg tranche 6).
    // Un deep-link vers les conventions ouvre Actions → canvas → couche Rôles.
    // Les clés historiques (prep-curation-doc) et la nouvelle (prep-roles-doc)
    // sont toutes deux consommées vers cette destination.
    try {
      const rawRoles = sessionStorage.getItem("agrafes:prep-roles-doc")
        ?? sessionStorage.getItem("agrafes:prep-curation-doc");
      if (rawRoles) {
        sessionStorage.removeItem("agrafes:prep-roles-doc");
        sessionStorage.removeItem("agrafes:prep-curation-doc");
        const nav = JSON.parse(rawRoles) as { doc_id: number };
        if (nav.doc_id) {
          this._switchTab("actions");
          setTimeout(() => void this._actions.segFocusDocRoles(nav.doc_id), 200);
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

    // NAV-01 — le niveau « onglet » de la pile de navigation, et le garde de sortie.
    // Enregistrés ici plutôt qu'au constructeur parce que le shell détruit puis recrée
    // cette application à chaque changement de mode : la paire register/unregister suit la
    // durée de vie réelle de l'instance.
    registerLevel("tab", {
      order: 20,
      read: () => this._activeTab,
      // Forcé : la question des modifications en attente a déjà été posée par le garde,
      // avant que le geste ne navigue. La reposer ici la ferait apparaître deux fois.
      apply: (v) => { this._switchTab(v as TabId, true); },
    });
    setPendingGuard(() => this._navPendingGuard());
  }

  /**
   * NAV-01 — ce que la pile demande avant de laisser partir un retour. Rendu non nul, le
   * geste est annulé AVANT la navigation et la question posée ; `popstate` ne s'annulant
   * pas, c'est le seul moment où un refus reste propre.
   */
  private _navPendingGuard(): { confirm: () => Promise<boolean> } | null {
    if (!this._hasPendingChangesInCurrentTab()) return null;
    const cur = this._screenControllers[this._activeTab];
    const msg = cur?.pendingChangesMessage?.() ?? "Des modifications non enregistrées. Continuer ?";
    return {
      confirm: () => {
        const el = document.getElementById("app-pending-confirm") as HTMLElement | null;
        if (!el) return Promise.resolve(false);
        return inlineConfirm(el, msg, { confirmLabel: "Continuer", danger: false });
      },
    };
  }

  private _buildUI(): void {
    const root = document.getElementById("app")!;
    this._root = root;

    // Skip link (A11y)
    const skipLink = document.createElement("a");
    skipLink.href = "#prep-main-content";
    skipLink.className = "prep-skip-link";
    skipLink.textContent = "Aller au contenu";
    root.appendChild(skipLink);

    // CHR-01 — la barre « Constituer » est partie. Elle redisait le nom de la base,
    // « Ouvrir » et « Créer », que le menu de la base du shell fait mieux (avec les
    // récentes et l'épinglage) ; « ↗ Shell » se déclenchait depuis le shell lui-même ;
    // la Fiche corpus et le Journal sont remontés d'un cran au lot 4. Restaient deux
    // choses qui n'y étaient QUE par accident d'implantation, et qui vivent maintenant
    // dans `.prep-shell` : le garde de sortie d'onglet, et le bandeau d'erreur.
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

    // CHR-01 — le garde de sortie d'onglet (« modifications non enregistrées »)
    // pendait sous la barre, qui portait `position: relative` pour lui. `.prep-shell`
    // la porte déjà : le bandeau garde donc son ancrage absolu, en haut à droite du
    // contenu, sans peser sur le flex de la barre latérale. Hôte toujours présent —
    // sans lui, `inlineConfirm` n'a nulle part où s'écrire et le garde ne demande
    // plus rien, en silence.
    const pendingConfirmBar = document.createElement("div");
    pendingConfirmBar.id = "app-pending-confirm";
    pendingConfirmBar.className = "audit-batch-bar";
    pendingConfirmBar.style.display = "none";
    shell.appendChild(pendingConfirmBar);

    // Sidebar nav
    const nav = document.createElement("nav");
    nav.className = "prep-nav";
    nav.id = "prep-nav";
    nav.setAttribute("aria-label", "Navigation Prep");

    // Tab links in sidebar
    const LABELS: Record<TabId, string> = {
      import: "Importer",
      shareDocs: "ShareDocs",
      documents: "Documents",
      actions: "Actions",
      exporter: "Exporter",
      settings: "Paramètres",
    };
    const ICONS: Record<TabId, string> = {
      import: "⊕",
      shareDocs: "☁",
      documents: "≡",
      actions: "◈",
      exporter: "⊗",
      settings: "⚙",
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
        // Order matches the documented pipeline (HANDOFF_PREP § 1) :
        // Segmentation → Curation → Alignement → Annotation.
        // (L'ordre historique « curation d'abord » venait des pratiques
        //  pre-app sur du brut OCR ; sur du texte généralement déjà nettoyé,
        //  segmenter d'abord rend la curation locale plus lisible.)
        // Tranche 6 (T6.1) — la matrice EST la surface d'alignement primaire (« Alignement ») ;
        // l'ancien AlignPanel devient « Révision fine » (revue statut/collisions/qualité par lien),
        // secondaire. Les navKey internes ("matrice"/"alignement") restent inchangés.
        const treeItems: Array<[string, string, string]> = [
          ["Segmentation",  "segmentation","⌥"],
          ["Curation",      "curation",    "◇"],
          ["Alignement",    "matrice",     "⇄"],
          ["Contrôle",      "alignement",  "✎"],
          ["Annotation",    "annoter",     "◎"],
        ];
        for (const [label, navKey, icon] of treeItems) {
          const link = document.createElement("button");
          link.className = "prep-nav-tree-link";
          // « Révision fine » (ancien AlignPanel) est un mode secondaire, dé-emphasé.
          if (navKey === "alignement") link.classList.add("prep-nav-tree-link--secondary");
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
            // R6.5-A/C + retrait Seg tranche 5 : « Annotation », « Curation », « Segmentation »
            // ouvrent le canvas (couches dédiées).
            if (navKey === "annoter") this._actions.openAnnotationLayer();
            else if (navKey === "curation") this._actions.openCurationLayer();
            else if (navKey === "segmentation") this._actions.openSegmentLayer();
            else this._actions.setSubView(navKey as "alignement" | "matrice");
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
    this._shareDocs = new ShareDocsImportScreen();
    this._actions = new ActionsScreen();
    this._metadata = new MetadataScreen();
    this._exports = new ExportsScreen();
    this._settings = new SettingsScreen();
    this._screenControllers = {
      import: this._import as GuardableScreen,
      shareDocs: this._shareDocs as GuardableScreen,
      documents: this._metadata,
      // Retrait Seg tranche 6 : ActionsScreen n'a plus d'état en attente (le canvas est
      // preview→apply), donc plus de méthodes de garde — cast comme les autres écrans sans garde.
      actions: this._actions as GuardableScreen,
      exporter: this._exports as GuardableScreen,
      settings: this._settings as GuardableScreen,
    };

    const screenMap: Record<TabId, () => HTMLElement> = {
      import: () => this._import.render(),
      shareDocs: () => this._shareDocs.render(),
      documents: () => this._metadata.render(),
      actions: () => this._actions.render(),
      exporter: () => this._exports.render(),
      settings: () => this._settings.render(),
    };

    for (const tab of TABS) {
      const el = screenMap[tab]();
      el.classList.add("prep-screen");
      if (tab === this._activeTab) el.classList.add("active");
      this._screenEls[tab] = el;
      content.appendChild(el);
    }

    main.appendChild(content);

    // Share global log element with all screens
    this._import.setLogEl(this._logEl);
    this._shareDocs.setLogEl(this._logEl);
    this._actions.setLogEl(this._logEl);
    this._metadata.setLogEl(this._logEl);
    this._exports.setLogEl(this._logEl);

    // Bridge (chantier 2 — retour amont) : Shell → focus Segmentation on unit.
    // Émet stage_returned (curate → segment) en télémétrie.
    // Stored in a field so dispose() can remove it — a fresh App is created on
    // every prep re-mount in the shell, so an anonymous listener would leak and
    // pin the dead instance (audit FE-08, same class as FE-02).
    this._focusSegmentHandler = (e: Event) => {
      const detail = (e as CustomEvent<{ docId: number; unitN: number }>).detail;
      if (!detail || typeof detail.docId !== "number" || typeof detail.unitN !== "number") return;
      // Switch to actions tab, then focus segmentation on unit
      this._switchTab("actions", true);
      void this._actions.focusSegmentationOnUnit(detail.docId, detail.unitN);
      // Telemetry: stage_returned (fire-and-forget)
      void (async () => {
        try {
          const { reportEvent } = await import("./lib/telemetry.ts");
          reportEvent(this._conn, "stage_returned", {
            doc_id: detail.docId,
            from_stage: "curate",
            to_stage: "segment",
          });
        } catch { /* swallow */ }
      })();
    };
    window.addEventListener("agrafes:prep-focus-segment-unit", this._focusSegmentHandler);
  }

  private _toggleJournal(root: HTMLElement): void {
    this._journalOpen = !this._journalOpen;
    const drawer = root.querySelector<HTMLElement>("#prep-journal-drawer");
    if (drawer) {
      drawer.classList.toggle("open", this._journalOpen);
      drawer.setAttribute("aria-hidden", String(!this._journalOpen));
      if (this._journalOpen) {
        // Scroll to bottom when opening
        const log = drawer.querySelector<HTMLElement>("#prep-journal-log");
        if (log) log.scrollTop = log.scrollHeight;
      }
    }
    // CHR-01 — le déclencheur n'est plus ici mais dans le header shell, qui reflète
    // lui-même son état actif. Prep ne le connaît pas, et n'a pas à le connaître.
  }

  // ─── Commandes publiques (appelées par le shell) ───────────────────────────
  // CHR-01 : ces deux gestes vivaient dans la barre de prep, qui disparaît au
  // profit du header shell. Le shell n'atteint `App` que par `constituerModule`,
  // d'où ces deux entrées — et rien d'autre : la surface reste étroite exprès.

  /** Ouvre la Fiche corpus (métadonnées de la base). Sans effet si aucune base. */
  openCorpusInfo(): void {
    void this._showCorpusInfoModal();
  }

  /** Ouvre ou ferme le tiroir du Journal. Renvoie son nouvel état, dont le shell
   *  se sert pour refléter l'icône active. */
  toggleJournal(): boolean {
    this._toggleJournal(this._root);
    return this._journalOpen;
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
    if (tab === "documents") this._metadata.onActivate();
    navSync();
  }

  private _openExporterWithPrefill(prefill?: ExportWorkflowPrefill): void {
    this._switchTab("exporter", true);
    if (this._activeTab !== "exporter") return;
    if (prefill) this._exports.applyWorkflowPrefill(prefill);
  }


  private _hasPendingChangesInCurrentTab(): boolean {
    return Boolean(this._screenControllers[this._activeTab]?.hasPendingChanges?.());
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
    overlay.className = "prep-dialog-overlay";

    const modal = document.createElement("div");
    modal.className = "prep-dialog";
    overlay.appendChild(modal);

    const head = document.createElement("div");
    head.className = "prep-dialog-head";
    head.innerHTML = `<h3>\uD83D\uDCC4 Fiche corpus</h3>`;
    const closeX = document.createElement("button");
    closeX.className = "btn btn-secondary btn-sm";
    closeX.textContent = "\u2715 Fermer";
    closeX.addEventListener("click", () => overlay.remove());
    head.appendChild(closeX);
    modal.appendChild(head);

    const body = document.createElement("div");
    body.className = "prep-dialog-body";
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
    foot.className = "prep-dialog-foot";
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

  private async _onDbChanged(dbPath: string): Promise<void> {
    try {
      this._conn = await ensureRunning(dbPath);
    } catch (err) {
      this._conn = null;
      console.error("db-changed: sidecar failed", err instanceof SidecarError ? err.message : err);
    }
    this._import.setConn(this._conn);
    this._shareDocs.setConn(this._conn);
    this._actions.setConn(this._conn);
    this._metadata.setConn(this._conn);
    this._exports.setConn(this._conn);
    this._settings.setConn(this._conn);
    this._jobCenter.setConn(this._conn);
    this._import.setJobCenter(this._jobCenter, showToast);
    this._shareDocs.setJobCenter(this._jobCenter, showToast);
    this._actions.setJobCenter(this._jobCenter, showToast);
    this._exports.setJobCenter(this._jobCenter, showToast);
  }

  /** Stop all background timers and remove event listeners. Called by tauri-shell on unmount. */
  dispose(): void {
    // NAV-01 — avant les écrans : le garde interroge `_screenControllers`, qu'on s'apprête
    // à laisser derrière.
    unregisterLevel("tab");
    setPendingGuard(null);
    this._actions.dispose();
    this._settings?.setConn(null);
    this._jobCenter?.setConn(null);
    if (this._beforeUnloadHandler) {
      window.removeEventListener("beforeunload", this._beforeUnloadHandler);
      this._beforeUnloadHandler = null;
    }
    if (this._focusSegmentHandler) {
      window.removeEventListener("agrafes:prep-focus-segment-unit", this._focusSegmentHandler);
      this._focusSegmentHandler = null;
    }
  }
}
