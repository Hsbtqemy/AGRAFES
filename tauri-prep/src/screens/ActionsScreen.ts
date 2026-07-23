/**
 * ActionsScreen — hub des actions (segment / align) + hébergeur du canvas Texte.
 *   - Align Audit UI (paginated link table after alignment run)
 *
 * La curation et l'annotation sont des couches du canvas (TextCanvasView) ; leurs écrans legacy
 * ont été retirés (R6.5-A/C). « Curation »/« Annotation » (hub, sidebar, étape-suivante) ouvrent
 * le canvas via openCurationLayer/openAnnotationLayer.
 */

import type {
  Conn,
  DocumentRecord,
  DocRelationRecord,
} from "../lib/sidecarClient.ts";
import {
  listDocuments,
  enqueueJob,
  getAllDocRelations,
  SidecarError,
} from "../lib/sidecarClient.ts";
import type { JobCenter } from "../components/JobCenter.ts";
import { initCardAccordions } from "../lib/uiAccordions.ts";
import { setHtml, raw } from "../lib/safeHtml.ts";
import { escHtml as _escHtml } from "../lib/diff.ts";
import { actionsHubTemplate } from "../lib/actionsHubTemplate.ts";
import { buildMetadataTree } from "../lib/metadataTree.ts";
import { AlignPanel } from "./AlignPanel.ts";
import { AlignMatrixView } from "./AlignMatrixView.ts";
import { TextCanvasView } from "./TextCanvasView.ts";

// ─── Project Presets (shared type) ───────────────────────────────────────────

export interface ProjectPreset {
  id: string;
  name: string;
  description?: string;
  languages: string[];
  pivot_language?: string;
  segmentation_lang?: string;
  segmentation_pack?: string;
  curation_preset?: string;
  alignment_strategy?: string;
  similarity_threshold?: number;
  created_at: number;
}

interface ActionsExportPrefill {
  stage?: "alignment" | "publication" | "segmentation" | "curation" | "runs" | "qa";
  product?: "aligned_table" | "tei_xml" | "tei_package" | "run_report" | "qa_report" | "readable_text";
  format?: "csv" | "tsv" | "tei_dir" | "zip" | "jsonl" | "html" | "json" | "txt" | "docx";
  docIds?: number[];
  pivotDocId?: number;
  targetDocId?: number;
  runId?: string;
  exceptionsOnly?: boolean;
  strictMode?: boolean;
}


// ─── Sub-view type ────────────────────────────────────────────────

type SubView = "hub" | "texte" | "alignement" | "matrice";

// ─── ActionsScreen ────────────────────────────────────────────────────────────

export class ActionsScreen {
  private _conn: Conn | null = null;
  private _docs: DocumentRecord[] = [];
  private _jobCenter: JobCenter | null = null;
  private _showToast: ((msg: string, isError?: boolean) => void) | null = null;
  private _openExporterTab: ((prefill?: ActionsExportPrefill) => void) | null = null;

  // Run ID of the last completed alignment (set by AlignPanel via onRunDone callback).
  private _alignRunId: string | null = null;
  // AlignPanel (new refactored alignment UI)
  private _alignPanel: AlignPanel | null = null;
  // Matrice (grille ancrée-source, lecture — tranche 2c)
  private _matrixView: AlignMatrixView | null = null;
  // TextCanvasView (refonte T0 — canvas texte central, cohabite avec le legacy)
  private _textCanvasView: TextCanvasView | null = null;

  private _wfRoot: HTMLElement | null = null;
  private static readonly LS_WF_RUN_ID = "agrafes.prep.workflow.run_id";

  // Hub hierarchy view
  private _hubHierarchyView = false;
  private _allRelations: DocRelationRecord[] = [];
  private _allRelationsLoaded = false;
  // Log + busy
  private _logEl: HTMLElement = document.createElement("div");
  private _busyEl!: HTMLElement;
  private _stateEl!: HTMLElement;
  private _isBusy = false;
  private _lastErrorMsg: string | null = null;

  // Sub-view state (hub navigation)
  private _activeSubView: SubView = "hub";
  private _root: HTMLElement | null = null;
  private _lastFocusedBtn: HTMLElement | null = null;
  private static readonly LS_ACTIVE_SUB = "agrafes.prep.actions.active";

  /** Scoped querySelector — searches within the mounted root only. Returns null when unmounted. */
  private _q<T extends HTMLElement>(selector: string): T | null {
    return this._root?.querySelector<T>(selector) ?? null;
  }
  /** Scoped querySelectorAll — returns empty NodeList when unmounted. */
  private _qAll<T extends HTMLElement>(selector: string): NodeListOf<T> {
    return this._root?.querySelectorAll<T>(selector) ?? document.querySelectorAll<T>(".__never__");
  }

  render(): HTMLElement {
    const root = document.createElement("div");
    root.className = "screen prep-actions-screen";
    this._root = root;
    this._loadSubViewPref();

    const header = document.createElement("div");
    header.className = "prep-acts-header";
    header.innerHTML = `
      <div id="act-state-banner" class="prep-runtime-state prep-state-info" aria-live="polite" style="display:none"></div>
    `;
    root.appendChild(header);
    this._stateEl = root.querySelector("#act-state-banner")!;

    const panelSlot = document.createElement("div");
    panelSlot.className = "prep-acts-panel-slot";

    const hubPanel = this._renderHubPanel(root);
    hubPanel.dataset.panel = "hub";
    hubPanel.style.display = this._activeSubView === "hub" ? "" : "none";

    const alignPanel = this._renderAlignementPanel(root);
    alignPanel.dataset.panel = "alignement";
    alignPanel.style.display = this._activeSubView === "alignement" ? "" : "none";

    const matricePanel = this._renderMatricePanel(root);
    matricePanel.dataset.panel = "matrice";
    matricePanel.style.display = this._activeSubView === "matrice" ? "" : "none";

    const textePanel = this._renderTexteCanvasPanel(root);
    textePanel.dataset.panel = "texte";
    textePanel.style.display = this._activeSubView === "texte" ? "" : "none";

    panelSlot.appendChild(hubPanel);
    panelSlot.appendChild(alignPanel);
    panelSlot.appendChild(matricePanel);
    panelSlot.appendChild(textePanel);

    root.appendChild(panelSlot);

    const busyOverlay = document.createElement("div");
    busyOverlay.id = "act-busy";
    busyOverlay.className = "prep-busy-overlay";
    busyOverlay.style.display = "none";
    busyOverlay.innerHTML = `<div class="prep-busy-spinner">⏳ Opération en cours…</div>`;
    root.appendChild(busyOverlay);

    this._busyEl = root.querySelector("#act-busy")!;

    this._wfRoot = root;
    initCardAccordions(root);
    this._refreshRuntimeState();
    this._setSubViewClass(root, this._activeSubView);

    return root;
  }

  // ─── Sub-view management ───────────────────────────────────────────────────────────

  /** Public API: called from app.ts sidebar tree links. */
  setSubView(view: SubView): void {
    this._activeSubView = view;
    try { localStorage.setItem(ActionsScreen.LS_ACTIVE_SUB, view); } catch { /* */ }
    if (this._root) this._switchSubViewDOM(this._root, view);
  }

  /**
   * Public API (chantier 2 — retour amont) : ouvre la couche Segmentation du
   * canvas sur le doc demandé et focus une unit précise. Utilisé par le listener
   * agrafes:prep-focus-segment-unit dans app.ts.
   */
  async focusSegmentationOnUnit(docId: number, unitN: number): Promise<void> {
    // Retrait Seg tranche 5 : ouvre la couche Segmentation du CANVAS (l'écran legacy est dormant).
    // focusSegmentUnit attend le chargement du pane (via _focusDoc→_syncActivePane) avant de
    // révéler l'unité — plus besoin du délai 50 ms du legacy.
    this.setSubView("texte");
    await this._textCanvasView?.focusSegmentUnit(docId, unitN);
  }

  /**
   * Deep-link « Conventions → Rôles » : ouvre la couche Rôles du canvas sur le doc demandé.
   * Retrait Seg tranche 5 : le sous-onglet Conventions/Rôles vit désormais au canvas.
   */
  async segFocusDocRoles(docId: number): Promise<void> {
    this.setSubView("texte");
    await this._textCanvasView?.focusRolesDoc(docId);
  }

  /**
   * Deep-link D-P9-2b (depuis le panneau famille de « Documents ») : ouvre l'espace
   * Alignement sur `familyId`. `mode === "matrix"` → la matrice (trou de couverture) ;
   * `mode === "review"` → la Révision fine en mode famille (« à réviser » / collisions).
   * Même chemin de nav guardé (`_wfRoot`, racine courante) que le callback `onOpenRevisionFine`
   * (T6.1/T6.2), pas `_root` (périmable après re-render). Délègue à la méthode publique de
   * pré-sélection famille de l'écran cible.
   */
  openAlignmentOnFamily(familyId: number, mode: "matrix" | "review"): void {
    if (!this._wfRoot) return;
    if (mode === "matrix") {
      this._switchSubViewDOM(this._wfRoot, "matrice");
      void this._matrixView?.selectAndLoadFamily(familyId);
    } else {
      this._switchSubViewDOM(this._wfRoot, "alignement");
      void this._alignPanel?.reviewFamily(familyId);
    }
  }

  private _loadSubViewPref(): void {
    try {
      const saved = localStorage.getItem(ActionsScreen.LS_ACTIVE_SUB);
      // Retrait Seg tranche 6 : un état sauvé « segmentation » (écran retiré) est migré vers le
      // canvas — sinon le restore viserait une subview qui n'existe plus.
      if (saved === "segmentation") {
        this._activeSubView = "texte";
      } else if (saved === "hub" || saved === "texte" || saved === "alignement" || saved === "matrice") {
        this._activeSubView = saved;
      }
    } catch { /* ignore */ }
  }

  private _switchSubViewDOM(root: HTMLElement, view: SubView): void {
    // Store the triggering button so focus can be restored when returning to hub
    if (this._activeSubView === "hub" && view !== "hub") {
      const active = document.activeElement;
      this._lastFocusedBtn = active instanceof HTMLElement ? active : null;
    }
    this._activeSubView = view;
    try { localStorage.setItem(ActionsScreen.LS_ACTIVE_SUB, view); } catch { /* */ }
    root.querySelectorAll<HTMLElement>("[data-panel]").forEach((panel) => {
      panel.style.display = panel.dataset.panel === view ? "" : "none";
    });
    this._qAll<HTMLElement>("[data-nav]").forEach((link) => {
      const isActive = link.dataset.nav === view;
      link.classList.toggle("active", isActive);
      if (isActive) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    });
    this._setSubViewClass(root, view);
    // Notifier la sous-vue Alignement pour rafraîchir sa bannière
    // « source modifiée » (DOM persistant → render() ne se rejoue pas).
    if (view === "alignement") this._alignPanel?.onActivated();
    if (view === "matrice") this._matrixView?.onActivated();
    // Restore focus to the hub card button that launched this sub-view
    if (view === "hub" && this._lastFocusedBtn) {
      const btn = this._lastFocusedBtn;
      this._lastFocusedBtn = null;
      requestAnimationFrame(() => btn.focus());
    }
  }

  private _setSubViewClass(root: HTMLElement, view: SubView): void {
    root.classList.remove("actions-sub-hub", "actions-sub-alignement", "actions-sub-matrice");
    root.classList.add(`actions-sub-${view}`);
  }

  /** Stable class method — replaces captured closure pattern for seg mode switching. */
  private _renderHubPanel(root: HTMLElement): HTMLElement {
    const el = document.createElement("div");
    el.className = "prep-acts-hub";
    el.setAttribute("role", "main");
    el.setAttribute("aria-label", "Vue synth\u00e8se Actions");
    setHtml(el, raw(actionsHubTemplate()));
    // Workflow card primary buttons → navigate to sub-view
    el.querySelectorAll<HTMLButtonElement>(".prep-acts-hub-wf-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = btn.dataset.target ?? "";
        // R6.5-A/C + retrait Seg tranche 5 : « Annotation », « Curation », « Segmentation »
        // ouvrent le canvas (couches dédiées) ; l'écran Segmentation legacy devient dormant.
        if (target === "annoter") { this.openAnnotationLayer(); return; }
        if (target === "curation") { this.openCurationLayer(); return; }
        if (target === "segmentation") { this.openSegmentLayer(); return; }
        this._switchSubViewDOM(root, target as SubView);
      });
    });

    // Refresh doc list
    el.querySelector<HTMLButtonElement>("#act-hub-refresh-btn")?.addEventListener("click", () => {
      void this._loadDocs();
    });
    // Refresh + propagate to sub-views (Curation, Segmentation, Align, Annotation)
    // via setConn(this._conn) — l'entrée canonique qui re-tire les docs et
    // ré-émet aux extracted views.
    el.querySelector<HTMLButtonElement>("#act-hub-refresh-corpus-btn")?.addEventListener("click", () => {
      if (this._conn) this.setConn(this._conn);
    });

    // Hierarchy toggle
    el.querySelector<HTMLButtonElement>("#act-hub-hierarchy-btn")?.addEventListener("click", () => {
      void this._toggleHubHierarchyView();
    });

    // T0 (refonte « texte central ») — accès prototype au canvas unifié.
    // Cohabite avec les écrans legacy ; cf. docs/DESIGN_prep_text_canvas.md.
    const protoBtn = document.createElement("button");
    protoBtn.type = "button";
    protoBtn.className = "prep-canvas-proto-launch";
    protoBtn.textContent = "🧪 Canvas Texte (prototype)";
    protoBtn.addEventListener("click", () => this._switchSubViewDOM(root, "texte"));
    el.appendChild(protoBtn);

    return el;
  }

  private _prependBackBtn(panel: HTMLElement, root: HTMLElement): void {
    const div = document.createElement("div");
    div.className = "prep-acts-view-back";
    div.innerHTML = `<button class="prep-acts-view-back-btn">&#8592; Vue synth&#232;se</button>`;
    div.querySelector("button")!.addEventListener("click", () => this._switchSubViewDOM(root, "hub"));
    panel.prepend(div);
  }

  /** Wires `data-nav` head-links inside a panel (cross-view navigation). */
  private _bindHeadNavLinks(el: HTMLElement, root: HTMLElement): void {
    el.querySelectorAll<HTMLButtonElement>("[data-nav]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = btn.dataset.nav as SubView;
        if (target) this._switchSubViewDOM(root, target);
      });
    });
  }

  // ── New split segmentation panel (Sprint 9) ────────────────────────────────

  private _renderTexteCanvasPanel(_root: HTMLElement): HTMLElement {
    const wrapper = document.createElement("div");
    this._textCanvasView = new TextCanvasView(
      () => this._conn,
      () => this._docs,
      {
        log: (msg, isError) => this._log(msg, isError),
        toast: (msg, isError) => this._showToast?.(msg, isError),
        onReloadDocs: () => this._loadDocs(),
      },
    );
    this._textCanvasView.render(wrapper);
    return wrapper;
  }

  private _renderAlignementPanel(root: HTMLElement): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.setAttribute("role", "main");
    wrapper.setAttribute("aria-label", "Vue Alignement");

    // ── En-tête ──
    const headSection = document.createElement("section");
    headSection.className = "prep-acts-seg-head-card";
    // T6.1 — mode secondaire : l'ancien écran d'alignement devient « Révision fine ».
    headSection.innerHTML = `
      <div class="prep-acts-hub-head-left">
        <h1>Contrôle
          <button type="button" id="act-align-reload-docs-btn" class="btn btn-secondary btn-sm"
                  title="Re-charger la liste des documents depuis la base"
                  style="margin-left:0.5rem;vertical-align:middle">&#8635; Actualiser</button>
        </h1>
        <p>Revue de l'alignement lien par lien&#160;: accepter / rejeter / statut, collisions, qualité, audit paginé. La réparation structurelle (couper, fusionner, rattacher) se fait dans la matrice « Alignement ».</p>
      </div>
      <div class="prep-acts-hub-head-tools">
        <button class="prep-acts-hub-head-link" id="act-align-open-export-btn">Exporter cette étape…</button>
      </div>`;
    this._bindHeadNavLinks(headSection, root);
    headSection.querySelector("#act-align-open-export-btn")?.addEventListener("click", () => this._openAlignmentExportPrefill());
    headSection.querySelector("#act-align-reload-docs-btn")?.addEventListener("click", () => {
      if (this._conn) void this._loadDocs();
    });
    wrapper.appendChild(headSection);

    // ── AlignPanel : 2-col + famille + audit + qualité + collisions + runs ──
    this._alignPanel = new AlignPanel(
      () => this._conn,
      () => this._docs,
      {
        log: (msg, isError) => this._log(msg, isError),
        toast: (msg, isError) => this._showToast?.(msg, isError),
        setBusy: (v) => this._setBusy(v),
        jobCenter: () => this._jobCenter,
        onRunDone: (_pivot, _targets, runId) => {
          if (runId) {
            this._alignRunId = runId;
            localStorage.setItem(ActionsScreen.LS_WF_RUN_ID, runId);
          }
        },
        onNav: (target) => {
          const linkEl = this._q<HTMLButtonElement>(`[data-nav="${target}"]`);
          linkEl?.click();
        },
        onOpenExporter: () => this._openAlignmentExportPrefill(),
      },
    );
    wrapper.appendChild(this._alignPanel.render());
    return wrapper;
  }

  private _renderMatricePanel(_root: HTMLElement): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "prep-acts-panel prep-acts-matrice-panel";

    const headSection = document.createElement("section");
    headSection.className = "prep-acts-seg-head-card";
    // T6.1 — la matrice est la surface d'alignement PRIMAIRE : le titre porte « Alignement ».
    headSection.innerHTML = `
      <div class="prep-acts-hub-head-left">
        <h1>Alignement</h1>
        <p>La forme align&#233;e du corpus&#160;: une ligne par segment de l'original (moyeu), une colonne par langue. Les cellules &#9888; se r&#233;parent sur place (&#9986;&#160;Couper). Pour la revue statut / collisions lien par lien&#160;: &#9998;&#160;R&#233;vision fine.</p>
      </div>`;
    wrapper.appendChild(headSection);

    this._matrixView = new AlignMatrixView(
      () => this._conn,
      {
        toast: (msg, isError) => this._showToast?.(msg, isError),
        // T6.1 — la barre de la matrice ouvre le mode secondaire « Révision fine » (AlignPanel).
        // Via _wfRoot (racine courante, guardée) comme les autres callbacks de nav, pas le
        // `root` capturé (qui pourrait être périmé après un re-render).
        // T6.2 (D-P2) — avec un `scope` (handoff depuis une cellule), on bascule PUIS on
        // pré-charge la paire moyeu ↔ colonne dans l'AlignPanel, scrollée sur le lien.
        onOpenRevisionFine: (scope) => {
          if (!this._wfRoot) return;
          this._switchSubViewDOM(this._wfRoot, "alignement");
          if (scope) void this._alignPanel?.scopeTo(scope);
        },
        // Raccourci matrice → couche Segmentation (Brut) d'un doc : depuis l'en-tête de langue
        // (docId seul → haut du doc) ou une orpheline « hors matrice » (docId + son n, deep-link).
        // Réutilise le chemin de nav du deep-link retour-amont (focusSegmentationOnUnit).
        onOpenSegmentation: (docId, unitN) => void this.focusSegmentationOnUnit(docId, unitN ?? 1),
      },
    );
    wrapper.appendChild(this._matrixView.render());
    return wrapper;
  }

  setConn(conn: Conn | null): void {
    this._conn = conn;
    this._docs = [];
    this._allRelations = [];
    this._allRelationsLoaded = false;
    this._hubHierarchyView = false;
    if (!conn) {
      this._lastErrorMsg = null;
    }
    this._setButtonsEnabled(false);
    // Notify extracted views of connection change
    if (conn) {
      this._loadDocs();
      // Restore workflow run_id from localStorage
      const savedRunId = localStorage.getItem(ActionsScreen.LS_WF_RUN_ID);
      if (savedRunId) this._alignRunId = savedRunId;
    }
    if (this._wfRoot) {
      this._textCanvasView?.refreshDocs();
      this._matrixView?.refreshDocs();
    }
    this._refreshRuntimeState();
  }

  /** Deep-link (Explorer→Prep, #23): route a token edit to the canvas Annotation layer
   *  (the read-only concordancier can't edit; the legacy AnnotationView is retired). */
  canvasFocusAnnotationToken(docId: number, tokenId?: number): void {
    void this._textCanvasView?.focusAnnotationToken(docId, tokenId);
  }

  /** R6.5-A retrait : « Annotation » (hub, sidebar, étape-suivante) ouvre désormais le canvas
   *  sur la couche Annotation, l'écran legacy ayant été retiré. Avec `docId`, focalise ce doc ;
   *  sinon garde le doc courant du canvas. */
  openAnnotationLayer(docId?: number): void {
    this.setSubView("texte");
    if (docId != null) void this._textCanvasView?.focusAnnotationToken(docId);
    else this._textCanvasView?.showAnnotationLayer();
  }

  /** R6.5-C retrait : « Curation » (hub, sidebar, étape-suivante) ouvre désormais le canvas sur la
   *  couche Curation, l'écran legacy ayant été retiré. Avec `docId`, focalise ce doc ; sinon garde
   *  le doc courant du canvas. Miroir exact de openAnnotationLayer. */
  openCurationLayer(docId?: number): void {
    this.setSubView("texte");
    if (docId != null) void this._textCanvasView?.focusCurationDoc(docId);
    else this._textCanvasView?.showCurationLayer();
  }

  /** Retrait Seg tranche 5 : « Segmentation » (sidebar, step-next) ouvre désormais le canvas sur la
   *  couche Segmentation, l'écran legacy devenant dormant. Miroir exact de openCurationLayer. */
  openSegmentLayer(docId?: number): void {
    this.setSubView("texte");
    if (docId != null) void this._textCanvasView?.focusSegmentDoc(docId);
    else this._textCanvasView?.showSegmentLayer();
  }

  setJobCenter(jc: JobCenter, showToast: (msg: string, isError?: boolean) => void): void {
    this._jobCenter = jc;
    this._showToast = showToast;
  }

  setOnOpenExporter(cb: ((prefill?: ActionsExportPrefill) => void) | null): void {
    this._openExporterTab = cb;
  }

  /** Apply a project preset to the current form fields (non-destructive). */
  applyPreset(preset: ProjectPreset): void {
    const root = this._wfRoot;
    if (!root) return;
    const setVal = (sel: string, val: string | undefined): void => {
      if (!val) return;
      const el = root.querySelector<HTMLInputElement | HTMLSelectElement>(sel);
      if (el) { el.value = val; el.dispatchEvent(new Event("change")); }
    };
    // Retrait Seg/Curation : les champs de langue/pack de segmentation (SegmentationView) et
    // le preset de curation (CurationView) ont disparu ; la segmentation/curation canvas gère
    // ses presets elle-même. Seuls les champs d'alignement encore présents sont appliqués ici.
    setVal("#act-align-strategy", preset.alignment_strategy);
    if (preset.similarity_threshold !== undefined) {
      setVal("#act-sim-threshold", String(preset.similarity_threshold));
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  setLogEl(el: HTMLElement): void {
    this._logEl = el;
  }

  private _log(msg: string, isError = false): void {
    const ts = new Date().toLocaleTimeString();
    const line = document.createElement("div");
    line.className = isError ? "log-line log-error" : "log-line";
    line.dataset.source = "actions";
    line.textContent = `[${ts}] [Actions] ${msg}`;
    this._logEl.appendChild(line);
    this._logEl.scrollTop = this._logEl.scrollHeight;
    if (isError) {
      this._lastErrorMsg = msg;
    } else if (msg.trim().startsWith("✓")) {
      this._lastErrorMsg = null;
    }
    this._refreshRuntimeState();
  }

  private _setBusy(v: boolean): void {
    this._isBusy = v;
    this._busyEl.style.display = v ? "flex" : "none";
    this._refreshRuntimeState();
  }

  private _setRuntimeState(kind: "ok" | "info" | "warn" | "error", text: string): void {
    if (!this._stateEl) return;
    this._stateEl.className = `prep-runtime-state prep-state-${kind}`;
    this._stateEl.style.display = kind === "ok" ? "none" : "";
    this._stateEl.textContent = text;
  }

  private _refreshRuntimeState(): void {
    if (!this._stateEl) return;
    if (!this._conn) {
      this._setRuntimeState("error", "Sidecar indisponible. Ouvrez un projet ou relancez la connexion.");
      return;
    }
    if (this._isBusy) {
      this._setRuntimeState("info", "Opération en cours…");
      return;
    }
    if (this._lastErrorMsg) {
      this._setRuntimeState("warn", `Dernière erreur: ${this._lastErrorMsg}`);
      return;
    }
    if (this._docs.length === 0) {
      this._setRuntimeState("info", "Aucun document importé pour le moment.");
      return;
    }
    this._setRuntimeState("ok", "Session prête: vous pouvez lancer des actions.");
  }

  private _setButtonsEnabled(on: boolean): void {
    // Retrait Seg/Curation : les boutons preview/curate/seg/seg-lt/meta ont été retirés avec
    // leurs écrans legacy ; ne restent que les boutons vivants (export d'alignement, collisions).
    ["act-align-open-export-btn", "align-coll-load-btn"].forEach(id => {
      const el = this._q(`#${id}`) as HTMLButtonElement | null;
      if (el) el.disabled = !on;
    });
  }

  private async _loadDocs(): Promise<void> {
    if (!this._conn) return;
    try {
      this._docs = await listDocuments(this._conn);
      this._renderDocList();
      this._setButtonsEnabled(true);
      this._alignPanel?.refreshDocs();
      this._matrixView?.refreshDocs();
      this._textCanvasView?.refreshDocs();
      this._log(`${this._docs.length} document(s) chargé(s).`);
      this._refreshRuntimeState();
    } catch (err) {
      this._log(`Erreur chargement docs : ${err instanceof SidecarError ? err.message : String(err)}`, true);
      this._refreshRuntimeState();
    }
  }

  private _renderDocList(): void {
    const el = this._q("#act-doc-list");
    if (!el) return;
    if (this._docs.length === 0) {
      el.innerHTML = '<p class="empty-hint">Aucun document importé.</p>';
      return;
    }
    if (this._hubHierarchyView) {
      this._renderHubHierarchyList(el);
      return;
    }
    const table = document.createElement("table");
    table.className = "prep-meta-table";
    table.innerHTML = `<thead><tr><th>N°</th><th>Titre</th><th>Langue</th><th>Rôle</th><th>Unités</th></tr></thead>`;
    const tbody = document.createElement("tbody");
    this._docs.forEach((doc, idx) => {
      const tr = document.createElement("tr");
      for (const text of [String(idx + 1), doc.title, doc.language, doc.doc_role ?? "—", String(doc.unit_count)]) {
        const td = document.createElement("td");
        td.textContent = text;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    el.innerHTML = "";
    el.appendChild(table);
  }

  private async _toggleHubHierarchyView(): Promise<void> {
    this._hubHierarchyView = !this._hubHierarchyView;
    const btn = this._q<HTMLButtonElement>("#act-hub-hierarchy-btn");
    if (btn) {
      btn.setAttribute("aria-pressed", String(this._hubHierarchyView));
      btn.classList.toggle("btn-active", this._hubHierarchyView);
      btn.textContent = this._hubHierarchyView ? "📋 Liste" : "🌿 Hiérarchie";
    }
    if (this._hubHierarchyView && this._conn && !this._allRelationsLoaded) {
      try {
        this._allRelations = await getAllDocRelations(this._conn);
        this._allRelationsLoaded = true;
      } catch (err) {
        this._log(`Erreur chargement relations : ${err instanceof SidecarError ? err.message : String(err)}`, true);
        this._hubHierarchyView = false;
        if (btn) { btn.setAttribute("aria-pressed", "false"); btn.classList.remove("btn-active"); btn.textContent = "🌿 Hiérarchie"; }
        return;
      }
    }
    this._renderDocList();
  }

  private _renderHubHierarchyList(el: HTMLElement): void {
    el.innerHTML = "";
    const { roots, standalone, orphans } = buildMetadataTree(this._docs, this._allRelations);

    const table = document.createElement("table");
    table.className = "prep-meta-table";
    table.innerHTML = `<thead><tr><th>N°</th><th>Titre</th><th>Langue</th><th>Rôle</th><th>Unités</th></tr></thead>`;
    const tbody = document.createElement("tbody");

    let _rowNum = 0;
    const appendRow = (doc: DocumentRecord, depth = 0, relationLabel?: string): void => {
      _rowNum++;
      const tr = document.createElement("tr");
      tr.className = "prep-meta-doc-row";
      if (depth > 0) tr.classList.add("prep-tree-child");

      const indent = depth > 0 ? `<span class="prep-tree-connector" aria-hidden="true">└</span>` : "";
      const relBadge = relationLabel
        ? `<span class="prep-tree-rel-badge">${_escHtml(relationLabel)}</span>`
        : "";

      const titleTd = document.createElement("td");
      titleTd.className = "col-title tree-title-cell";
      titleTd.style.paddingLeft = `${0.5 + depth * 1.4}rem`;
      setHtml(titleTd, raw(`${indent}${relBadge}`));
      const titleSpan = document.createElement("span");
      titleSpan.textContent = doc.title;
      titleTd.appendChild(titleSpan);

      const idTd = document.createElement("td"); idTd.textContent = String(_rowNum);
      const langTd = document.createElement("td"); langTd.textContent = doc.language;
      const roleTd = document.createElement("td"); roleTd.textContent = doc.doc_role ?? "—";
      const unitsTd = document.createElement("td"); unitsTd.textContent = String(doc.unit_count);

      tr.appendChild(idTd);
      tr.appendChild(titleTd);
      tr.appendChild(langTd);
      tr.appendChild(roleTd);
      tr.appendChild(unitsTd);
      tbody.appendChild(tr);
    };

    const appendSectionHeader = (label: string, count: number): void => {
      const tr = document.createElement("tr");
      tr.className = "prep-tree-section-header";
      const td = document.createElement("td");
      td.colSpan = 5;
      td.className = "prep-tree-section-label";
      td.textContent = `${label} `;
      const countSpan = document.createElement("span");
      countSpan.className = "prep-tree-section-count";
      countSpan.textContent = String(count);
      td.appendChild(countSpan);
      tr.appendChild(td);
      tbody.appendChild(tr);
    };

    if (roots.length > 0) {
      for (const node of roots) {
        appendRow(node.doc);
        for (const child of node.children) {
          appendRow(child.doc, 1, child.relationLabel);
        }
      }
    }
    if (standalone.length > 0) {
      if (roots.length > 0) appendSectionHeader("Sans famille", standalone.length);
      for (const doc of standalone) appendRow(doc);
    }
    if (orphans.length > 0) {
      appendSectionHeader("Parent absent du corpus", orphans.length);
      for (const doc of orphans) appendRow(doc);
    }

    table.appendChild(tbody);
    el.appendChild(table);
  }


  private _openExporterWithPrefill(prefill?: ActionsExportPrefill): void {
    if (!this._openExporterTab) {
      this._showToast?.("Onglet Exporter indisponible.", true);
      return;
    }
    this._openExporterTab(prefill);
  }

  private _openAlignmentExportPrefill(): void {
    const pivotRaw = (this._q("#act-align-pivot") as HTMLSelectElement | null)?.value ?? "";
    const pivotId = pivotRaw ? parseInt(pivotRaw, 10) : NaN;
    const targetsSel = this._q("#act-align-targets") as HTMLSelectElement | null;
    const targetIds = targetsSel
      ? Array.from(targetsSel.selectedOptions)
        .map((opt) => parseInt(opt.value, 10))
        .filter((v) => Number.isInteger(v))
      : [];

    const prefill: ActionsExportPrefill = {
      stage: "alignment",
      product: "aligned_table",
      format: "csv",
      strictMode: false,
    };
    if (Number.isInteger(pivotId)) prefill.pivotDocId = pivotId;
    if (targetIds.length > 0) {
      prefill.docIds = targetIds;
      prefill.targetDocId = targetIds[0];
    }
    if (this._alignRunId) prefill.runId = this._alignRunId;
    this._openExporterWithPrefill(prefill);
  }

  // ─── Validate meta + index ────────────────────────────────────────────────

  private async _runValidateMeta(): Promise<void> {
    if (!this._conn) return;
    const docSel = (this._q("#act-meta-doc") as HTMLSelectElement)?.value;
    const docId = docSel ? parseInt(docSel) : undefined;
    const label = docId !== undefined ? `doc #${docId}` : "tous les documents";
    this._log(`Validation métadonnées de ${label} (job asynchrone)…`);
    const params: Record<string, unknown> = {};
    if (docId !== undefined) params.doc_id = docId;
    try {
      const job = await enqueueJob(this._conn, "validate-meta", params);
      this._jobCenter?.trackJob(job.job_id, `Validation méta ${label}`, (done) => {
        if (done.status === "done") {
          const results = (done.result as { results?: Array<{ doc_id: number; is_valid: boolean; warnings: string[] }> } | undefined)?.results ?? [];
          const invalid = results.filter(r => !r.is_valid);
          if (invalid.length === 0) {
            this._log(`✓ Métadonnées valides (${results.length} doc(s)).`);
            this._showToast?.("✓ Métadonnées valides");
          } else {
            for (const r of invalid) {
              this._log(`⚠ doc #${r.doc_id}: ${r.warnings.join(", ")}`, true);
            }
            this._showToast?.(`⚠ ${invalid.length} doc(s) invalide(s)`, true);
          }
        } else {
          this._log(`✗ Validation : ${done.error ?? done.status}`, true);
          this._showToast?.("✗ Erreur validation méta", true);
        }
      });
    } catch (err) {
      this._log(`✗ Validation : ${err instanceof SidecarError ? err.message : String(err)}`, true);
    }
  }

  private async _runIndex(): Promise<void> {
    if (!this._conn) return;
    this._setBusy(true);
    this._log("Reconstruction de l'index FTS (job asynchrone)…");
    try {
      const job = await enqueueJob(this._conn, "index", {});
      this._log(`Job index soumis (${job.job_id.slice(0, 8)}…)`);
      this._jobCenter?.trackJob(job.job_id, "Rebuild index FTS", (done) => {
        if (done.status === "done") {
          const n = (done.result as { units_indexed?: number } | undefined)?.units_indexed ?? "?";
          this._log(`✓ Index reconstruit — ${n} unités indexées.`);
          const reindexBtn = this._q("#act-reindex-after-curate-btn") as HTMLElement | null;
          if (reindexBtn) reindexBtn.style.display = "none";
          this._showToast?.(`✓ Index reconstruit (${n} unités)`);
        } else {
          const errMsg = done.error ?? done.status;
          this._log(`✗ Index : ${errMsg}`, true);
          const short = typeof errMsg === "string" && errMsg.length > 60 ? errMsg.slice(0, 57) + "…" : errMsg;
          this._showToast?.(`✗ Erreur index FTS${short ? `: ${short}` : ""}`, true);
        }
        this._setBusy(false);
      });
    } catch (err) {
      this._log(`✗ Index : ${err instanceof SidecarError ? err.message : String(err)}`, true);
      this._setBusy(false);
    }
  }


  /**
   * Release all resources held by this screen.
   * Safe to call multiple times (idempotent).
   */
  dispose(): void {
    // Dispose sub-panels
    this._alignPanel?.dispose();
    this._alignPanel = null;
    this._matrixView?.dispose();
    this._matrixView = null;
    // Drop DOM references
    this._root = null;
    this._wfRoot = null;
  }
}

// ─── Utility helpers ──────────────────────────────────────────────────────────


