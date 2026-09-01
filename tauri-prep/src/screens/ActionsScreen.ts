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
  setStepStatus,
  clearStepStatus,
  SidecarError,
} from "../lib/sidecarClient.ts";
import type { JobCenter } from "../components/JobCenter.ts";
import { initCardAccordions } from "../lib/uiAccordions.ts";
import { setHtml, raw } from "../lib/safeHtml.ts";
import { escHtml as _escHtml } from "../lib/diff.ts";
import { actionsHubTemplate } from "../lib/actionsHubTemplate.ts";
import { buildMetadataTree } from "../lib/metadataTree.ts";
import { registerLevel, unregisterLevel, sync as navSync } from "../lib/navHistory.ts";
import {
  HUB_STEPS, STEP_ABBR, STEP_LABEL, docBadges, docsForStep, hubComparator, sortDocs,
  stepCounts,
  stepMark, stepState,
} from "../lib/actionsHubState.ts";
import type {
  HubPile, HubSortCol, HubStep, SortDir, StepState,
} from "../lib/actionsHubState.ts";
import { AlignPanel } from "./AlignPanel.ts";
import { AlignMatrixView } from "./AlignMatrixView.ts";
import { TextCanvasView } from "./TextCanvasView.ts";

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
  // ACT-01 — capacité choisie dans les cartes ; null = tout le corpus.
  private _hubFilter: HubStep | null = null;
  /** La pile au sein de la capacité filtrante. Remise à `any` à chaque changement. */
  private _hubPile: HubPile = "any";
  // Tri de la liste. Mêmes conventions que l'écran Documents (th[data-sort],
  // .sort-ind, .sort-active) : deux tables aux mêmes colonnes doivent se manier
  // pareil. « id » = ordre d'arrivée, c'est-à-dire le défaut.
  private _sortCol: HubSortCol = "id";
  private _sortDir: SortDir = "asc";
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
    this._registerNavLevels();

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

  /**
   * Public API: called from app.ts sidebar tree links.
   *
   * L'affectation ne se fait ici QUE sans DOM : avec un DOM, `_switchSubViewDOM` s'en
   * charge — et il a besoin de lire la vue qu'on quitte pour savoir qu'on revient au
   * hub. Pré-affecter la rendait égale à la vue d'arrivée, et ce seul appelant sur neuf
   * aurait perdu le rechargement, sans que rien ne le signale : la barre latérale et le
   * retour d'historique NAV-01 passent tous deux par ici.
   */
  setSubView(view: SubView): void {
    if (this._root) { this._switchSubViewDOM(this._root, view); return; }
    this._activeSubView = view;
    try { localStorage.setItem(ActionsScreen.LS_ACTIVE_SUB, view); } catch { /* */ }
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
    const depuis = this._activeSubView;
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
    // Et le hub, en revenant, se recharge. Même cause que les deux lignes au-dessus —
    // le DOM des sous-vues persiste, `render()` ne se rejoue pas — mais une raison plus
    // forte : ce qu'on vient de faire dans le canvas PÉRIME des coches. Sans ce
    // rechargement, une case démentie continue d'afficher `✕` jusqu'à un ↺ manuel, et
    // une coche qui survit à ce qui la dément est exactement le mensonge silencieux que
    // le tri-état existe pour empêcher. Trouvé en QA le 31 août, à l'item « corriger une
    // phrase au stylo : la case retombe à `/` » — elle n'y retombait qu'après ↺.
    // Sur `depuis` et non sur la vue seule : au premier rendu, `setConn` a déjà chargé.
    if (view === "hub" && depuis !== "hub" && this._conn) void this._loadDocs();
    // Restore focus to the hub card button that launched this sub-view
    if (view === "hub" && this._lastFocusedBtn) {
      const btn = this._lastFocusedBtn;
      this._lastFocusedBtn = null;
      requestAnimationFrame(() => btn.focus());
    }
    // NAV-01 — c'est bien ICI qu'il faut accrocher l'historique et non dans la publique
    // `setSubView`, que certains chemins court-circuitent (`onOpenRevisionFine` appelle
    // directement le DOM).
    navSync();
  }

  /**
   * NAV-01 — les deux niveaux les plus fins de la pile de navigation. Ils vivent ici parce
   * que cet écran possède la sous-vue ET le canvas ; `read` rend `null` quand le canvas
   * n'est pas monté, ce qui suffit à la pile pour ignorer le niveau.
   */
  private _registerNavLevels(): void {
    registerLevel("subView", {
      order: 30,
      read: () => this._activeSubView,
      apply: (v) => { if (this._root) this._switchSubViewDOM(this._root, v as SubView); },
    });
    registerLevel("layer", {
      order: 40,
      read: () => this._textCanvasView?.layer() ?? null,
      apply: (v) => { this._textCanvasView?.setLayer(v as "roles" | "curation" | "annoter" | "segment"); },
    });
  }

  private _setSubViewClass(root: HTMLElement, view: SubView): void {
    root.classList.remove("actions-sub-hub", "actions-sub-alignement", "actions-sub-matrice");
    root.classList.add(`actions-sub-${view}`);
  }

  /**
   * Le hub — ACT-01. Les quatre cartes sont des FILTRES : chacune annonce combien
   * de documents elle concerne encore, et réduit la liste à ceux-là. « Ouvrir → »
   * garde son ancien rôle : entrer dans l'espace sans document désigné.
   */
  private _renderHubPanel(root: HTMLElement): HTMLElement {
    const el = document.createElement("div");
    el.className = "prep-acts-hub";
    el.setAttribute("role", "main");
    el.setAttribute("aria-label", "Vue synthèse Actions");
    setHtml(el, raw(actionsHubTemplate()));
    // « Ouvrir → » (et « Contrôle ») : navigation sans document désigné.
    el.querySelectorAll<HTMLButtonElement>(".prep-acts-hub-wf-btn[data-target]").forEach((btn) => {
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

    // Les quatre filtres. Re-cliquer la carte active rend la liste entière.
    el.querySelectorAll<HTMLButtonElement>(".prep-acts-hub-wf-filter").forEach((btn) => {
      btn.addEventListener("click", () => {
        const step = btn.dataset.step as HubStep | undefined;
        if (step) this._setHubFilter(this._hubFilter === step ? null : step);
      });
    });
    el.querySelector<HTMLButtonElement>("#act-hub-filter-clear")
      ?.addEventListener("click", () => this._setHubFilter(null));

    // Les trois piles. Elles ne vivent que sous filtre : hors filtre, « jamais
    // commencé » n'a pas de capacité à quoi se rapporter.
    el.querySelectorAll<HTMLButtonElement>(".prep-acts-hub-pile").forEach((btn) => {
      btn.addEventListener("click", () => {
        const pile = btn.dataset.pile as HubPile | undefined;
        if (pile) this._setHubPile(pile);
      });
    });

    // Un seul bouton d'actualisation (il y en avait deux) : le plus fort des deux —
    // setConn re-tire les documents ET ré-émet aux sous-vues (Curation, Segmentation,
    // Alignement, Annotation). Sans connexion, il recharge au moins la liste.
    el.querySelector<HTMLButtonElement>("#act-hub-refresh-btn")?.addEventListener("click", () => {
      if (this._conn) this.setConn(this._conn);
      else void this._loadDocs();
    });

    // Hierarchy toggle
    el.querySelector<HTMLButtonElement>("#act-hub-hierarchy-btn")?.addEventListener("click", () => {
      void this._toggleHubHierarchyView();
    });

    // Peindre les cartes tout de suite : sur un corpus vide elles doivent dire
    // « aucun document », pas rester muettes en attendant un chargement.
    this._paintHubCards(el);

    return el;
  }

  /**
   * Change la capacité filtrante et re-peint cartes + liste.
   *
   * La pile retombe à `any` : elle qualifie une capacité, elle ne se transporte pas
   * d'une capacité à l'autre. Passer de « les 2 en cours de la curation » à
   * l'alignement en gardant « en cours » afficherait 21 documents sans que rien ne
   * l'ait demandé.
   */
  private _setHubFilter(step: HubStep | null): void {
    this._hubFilter = step;
    this._hubPile = "any";
    this._paintHubCards();
    this._renderDocList();
  }

  /** Resserre la liste sur une pile de la capacité courante. */
  private _setHubPile(pile: HubPile): void {
    this._hubPile = pile;
    this._paintHubCards();
    this._renderDocList();
  }

  /**
   * Peint les compteurs des cartes, l'état pressé des filtres et le bandeau de filtre.
   * `scope` sert au premier rendu, quand le panneau n'est pas encore dans `_root`.
   */
  private _paintHubCards(scope?: HTMLElement): void {
    const find = <T extends HTMLElement>(sel: string): T | null =>
      scope ? scope.querySelector<T>(sel) : this._q<T>(sel);
    const counts = stepCounts(this._docs);
    const total = this._docs.length;

    for (const step of HUB_STEPS) {
      const { none, started } = counts[step];
      const remaining = none + started;
      const countEl = find<HTMLElement>(`#act-hub-count-${step}`);
      if (countEl) {
        // DEUX nombres, parce qu'un seul mentait. Sur un corpus neuf, l'import produit
        // des lignes : les cinq documents sont « en cours » de segmentation sans que
        // personne ait rien validé. Une carte qui n'aurait compté que « jamais
        // touché » y aurait affiché « 0 à faire », le mensonge exact que le modèle à
        // trois états existe pour tuer ; une carte qui aurait tout additionné aurait
        // affiché le même nombre sur les quatre cartes, sans plus aider à choisir.
        countEl.textContent = total === 0 ? "aucun document"
          : remaining === 0 ? "tout à jour"
          : started === 0 ? `${none} à faire`
          : none === 0 ? `${started} en cours`
          : `${none} à faire · ${started} en cours`;
        countEl.classList.toggle("prep-acts-hub-wf-count--done", total > 0 && remaining === 0);
      }
      const filterBtn = find<HTMLButtonElement>(`#act-hub-filter-${step}`);
      if (filterBtn) {
        const active = this._hubFilter === step;
        // « Rien à faire » n'a de sens que sur un corpus non vide : sans documents,
        // ce n'est pas que l'étape est finie, c'est qu'il n'y a rien à quoi l'appliquer.
        filterBtn.textContent = active ? "Tout afficher"
          : total === 0 ? "Aucun document"
          : remaining === 0 ? "Rien à faire"
          : `Voir les ${remaining}`;
        filterBtn.disabled = !active && remaining === 0;
        filterBtn.setAttribute("aria-pressed", String(active));
        filterBtn.classList.toggle("prep-acts-hub-wf-filter--on", active);
      }
      find<HTMLElement>(`.prep-acts-hub-wf-card[data-step="${step}"]`)
        ?.classList.toggle("prep-acts-hub-wf-card--on", this._hubFilter === step);
    }

    // Le bandeau reste TOUJOURS là. Le montrer sous filtre seulement faisait varier
    // la hauteur de la carte entre « tout » et « filtré », en plus du nombre de
    // lignes : deux sauts pour un seul clic. Permanent, il gagne un second emploi —
    // dire ce qu'on regarde même quand on regarde tout.
    const label = find<HTMLElement>("#act-hub-filter-label");
    const clear = find<HTMLElement>("#act-hub-filter-clear");
    const piles = find<HTMLElement>("#act-hub-filter-piles");
    if (piles) piles.hidden = this._hubFilter === null;
    if (this._hubFilter !== null) {
      const { none, started } = counts[this._hubFilter];
      const taille: Record<HubPile, number> = { none, started, any: none + started };
      // Une pile qu'on vient de vider ne peut pas rester sélectionnée : la liste
      // serait vide sous un segment désactivé, sans rien qui explique pourquoi.
      // C'est le cas normal de sortie — on coche le dernier « en cours » de la pile.
      if (this._hubPile !== "any" && taille[this._hubPile] === 0) this._hubPile = "any";
      const dit: Record<HubPile, string> = {
        none: `${none} jamais commencé${none > 1 ? "s" : ""}`,
        started: `${started} en cours`,
        any: `Tous (${none + started})`,
      };
      piles?.querySelectorAll<HTMLButtonElement>(".prep-acts-hub-pile").forEach((btn) => {
        const pile = btn.dataset.pile as HubPile;
        btn.textContent = dit[pile];
        // `any` ne se désactive jamais : c'est le retour en arrière, y compris quand
        // la capacité ne concerne plus personne.
        btn.disabled = pile !== "any" && taille[pile] === 0;
        btn.setAttribute("aria-pressed", String(this._hubPile === pile));
        btn.classList.toggle("prep-acts-hub-pile--on", this._hubPile === pile);
      });
    }
    if (label) {
      if (this._hubFilter === null) {
        label.textContent = total === 0
          ? "Aucun document"
          : `${total} document${total > 1 ? "s" : ""}`;
      } else {
        const shown = docsForStep(this._docs, this._hubFilter, this._hubPile).length;
        label.textContent =
          `${STEP_LABEL[this._hubFilter]} — ${shown} document${shown > 1 ? "s" : ""} sur ${total}`;
      }
    }
    // Seul le bouton se retire : « Tout afficher » n'a rien à proposer hors filtre.
    if (clear) clear.hidden = this._hubFilter === null;
    find<HTMLElement>("#act-hub-filter-strip")
      ?.classList.toggle("prep-acts-hub-filter-strip--on", this._hubFilter !== null);
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
    // `_hubHierarchyView` n'est PAS remis à plat ici : c'est une préférence
    // d'affichage, au même titre que le filtre et le tri, qui survivent tous deux.
    // Les relations, elles, sont bien vidées — `_loadDocs` les recharge si la vue en
    // a besoin.
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
      // La vue hiérarchie survit au rechargement, mais ses relations ont été vidées :
      // les reprendre ici, et retomber à plat si elles ne se lisent pas plutôt que de
      // rendre un arbre sans arêtes.
      if (this._hubHierarchyView && !(await this._ensureRelations())) {
        this._hubHierarchyView = false;
      }
      this._paintHierarchyBtn();
      // Les cartes AVANT la liste : elles portent les comptes dont le filtre
      // courant dépend, et un filtre devenu vide doit se voir sur la carte.
      this._paintHubCards();
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

  /**
   * La liste — ACT-01. Elle ne se contente plus de nommer les documents : chaque
   * ligne dit ce qu'il reste à y faire et porte le geste pour le faire. Sous filtre,
   * elle se réduit aux documents que la capacité choisie concerne encore, et la
   * colonne d'ouverture se ramène au seul geste demandé.
   */
  private _renderDocList(): void {
    const el = this._q("#act-doc-list");
    if (!el) return;
    if (this._docs.length === 0) {
      el.innerHTML = '<p class="empty-hint">Aucun document import&#233;.</p>';
      return;
    }
    const shown = docsForStep(this._docs, this._hubFilter, this._hubPile);
    if (shown.length === 0) {
      // Sous filtre uniquement : la liste complète n'est jamais vide ici.
      el.innerHTML = '<p class="empty-hint">Rien &#224; faire ici : aucun document n&rsquo;attend cette &#233;tape.</p>';
      return;
    }
    if (this._hubHierarchyView) {
      this._renderHubHierarchyList(el, shown);
      return;
    }
    const table = document.createElement("table");
    table.className = "prep-meta-table prep-acts-hub-table";
    table.appendChild(this._docTableHead());
    const tbody = document.createElement("tbody");
    // La numérotation suit ce qui est affiché : sous filtre comme sous tri, « 1 »
    // est la première ligne visible, pas le rang du document dans le corpus entier.
    sortDocs(shown, this._sortCol, this._sortDir)
      .forEach((doc, idx) => tbody.appendChild(this._docRow(doc, idx + 1)));
    table.appendChild(tbody);
    el.innerHTML = "";
    el.appendChild(table);
    this._paintSortIndicators(table);
  }

  /**
   * En-tête commun aux deux vues (liste plate et hiérarchie). Six colonnes sur sept
   * sont triables — « Ouvrir » ne porte pas de valeur. N° l'est aussi, contrairement
   * à l'écran Documents : c'est le seul chemin de retour à l'ordre d'arrivée une
   * fois qu'on a trié sur autre chose.
   */
  private _docTableHead(): HTMLTableSectionElement {
    const cols: Array<[string, HubSortCol | null]> = [
      ["N°", "id"], ["Titre", "title"], ["Langue", "lang"], ["Rôle", "role"],
      ["Unités", "units"], ["À faire", "todo"], ["Ouvrir", null],
    ];
    const thead = document.createElement("thead");
    const tr = document.createElement("tr");
    for (const [label, col] of cols) {
      const th = document.createElement("th");
      th.textContent = label;
      if (col !== null) {
        th.classList.add("sortable-th");
        th.dataset.sort = col;
        th.tabIndex = 0;
        th.setAttribute("role", "button");
        th.title = `Trier par ${label}`;
        const ind = document.createElement("span");
        ind.className = "sort-ind";
        ind.setAttribute("aria-hidden", "true");
        th.append(" ", ind);
        const activate = (): void => this._toggleSort(col);
        th.addEventListener("click", activate);
        // Un en-tête cliquable doit s'actionner au clavier, sinon le tri n'existe
        // que pour la souris.
        th.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); activate(); }
        });
      }
      // Sous « À faire », le rappel de l'ordre des quatre cases. Il vit dans l'en-tête
      // et non en légende flottante : une légende ailleurs sur la page se perd dès que
      // la liste défile, et c'est en défilant qu'on oublie quelle case est laquelle.
      // `aria-hidden` parce que chaque case porte déjà son nom complet en `aria-label` —
      // sans ça, un lecteur d'écran annoncerait « Cur Seg Ali Ann » dans le nom de la
      // colonne, et le bouton de tri s'appellerait autrement que ce qu'il est.
      if (col === "todo") {
        const legend = document.createElement("span");
        legend.className = "prep-acts-hub-legend";
        legend.setAttribute("aria-hidden", "true");
        for (const step of HUB_STEPS) {
          const item = document.createElement("span");
          item.className = "prep-acts-hub-legend-item";
          item.dataset.step = step;
          item.textContent = STEP_ABBR[step];
          legend.appendChild(item);
        }
        th.appendChild(legend);
      }
      tr.appendChild(th);
    }
    thead.appendChild(tr);
    return thead;
  }

  /** Re-clic sur la colonne active = inversion ; nouvelle colonne = ascendant. */
  private _toggleSort(col: HubSortCol): void {
    if (this._sortCol === col) {
      this._sortDir = this._sortDir === "asc" ? "desc" : "asc";
    } else {
      this._sortCol = col;
      this._sortDir = "asc";
    }
    this._renderDocList();
  }

  /** Peint ↑ / ↓ sur la colonne triée, ⇅ sur les autres. */
  private _paintSortIndicators(scope: HTMLElement): void {
    scope.querySelectorAll<HTMLElement>("th[data-sort]").forEach((th) => {
      const active = th.dataset.sort === this._sortCol;
      th.classList.toggle("sort-active", active);
      th.setAttribute("aria-sort", active
        ? (this._sortDir === "asc" ? "ascending" : "descending")
        : "none");
      const ind = th.querySelector<HTMLElement>(".sort-ind");
      if (ind) ind.textContent = active ? (this._sortDir === "asc" ? "↑" : "↓") : "⇅";
    });
  }

  /** Le glyphe de chaque état — l'écriture `[ ] [/] [X]` du modèle, telle quelle. */
  private static readonly STEP_GLYPH: Record<StepState, string> = {
    none: "\u00a0", started: "/", done: "✕",
  };

  /**
   * Une case à trois états pour (document, capacité).
   *
   * `aria-checked="mixed"` est le tri-état natif : « en cours » n'a pas besoin d'un
   * bricolage d'accessibilité. Le clic ne fait qu'UNE chose — poser ou retirer la
   * coche. Il n'ouvre rien : une case énonce un état, elle ne désigne pas une
   * destination, et c'est la colonne « Ouvrir » qui porte le déplacement.
   *
   * L'infobulle est le seul endroit où la coche peut dire ce qu'elle vaut. « Validé le
   * 12/08, avant que l'historique existe » n'est pas la même promesse que « validé le
   * 12/08, aucune modification enregistrée depuis » — une coche qui tait sa propre
   * incertitude est le défaut qu'on vient de corriger sur l'index de recherche.
   */
  private _stepBox(doc: DocumentRecord, step: HubStep): HTMLElement {
    const state = stepState(doc, step);
    const mark = stepMark(doc, step);
    const box = document.createElement("button");
    box.type = "button";
    box.className = `prep-acts-hub-box prep-acts-hub-box--${state}`;
    box.dataset.step = step;
    box.setAttribute("role", "checkbox");
    box.setAttribute("aria-checked", state === "done" ? "true" : state === "started" ? "mixed" : "false");
    box.textContent = ActionsScreen.STEP_GLYPH[state];

    const nom = STEP_LABEL[step];
    let dit: string;
    if (state === "done") {
      const quand = (mark?.validated_at ?? "").slice(0, 10);
      dit = mark?.basis === "derived"
        ? `${nom} — validé le ${quand}, avant que l'historique existe`
        : `${nom} — validé le ${quand}, aucune modification enregistrée depuis`;
    } else if (mark?.stale) {
      const quand = mark.validated_at.slice(0, 10);
      dit = `${nom} — validé le ${quand}, puis modifié (${mark.stale_reason ?? "?"})`;
    } else {
      // « aucune trace enregistrée » et non « rien de fait » : l'outil ne sait rien du
      // document, il ne sait que ce qu'il a vu. Un texte curé dans Word avant l'import
      // arrive ici sans trace, et « rien de fait » serait faux à son sujet.
      dit = state === "started"
        ? `${nom} — commencé, jamais validé`
        : `${nom} — aucune trace enregistrée`;
    }
    box.title = `${dit} · « ${doc.title} »`;
    box.setAttribute("aria-label", `${dit} sur ${doc.title}`);
    box.addEventListener("click", () => void this._toggleStep(doc, step));
    return box;
  }

  /**
   * Cocher ou décocher. Deux états sur trois mènent à la coche, un seul en revient :
   * « rien » et « en cours » se valident, « fait » se retire. Une coche PÉRIMÉE se
   * re-pose — c'est le geste « je reconfirme après avoir retravaillé », et le moteur
   * refige alors ses deux signaux.
   *
   * La liste est rechargée plutôt que peinte sur place : les compteurs des cartes
   * dépendent du même état, et les repeindre à la main d'un côté pendant que la ligne
   * change de l'autre est exactement la façon dont deux affichages du même fait se
   * mettent à diverger.
   */
  private async _toggleStep(doc: DocumentRecord, step: HubStep): Promise<void> {
    if (!this._conn) return;
    const state = stepState(doc, step);
    try {
      if (state === "done") await clearStepStatus(this._conn, doc.doc_id, step);
      else await setStepStatus(this._conn, doc.doc_id, step);
    } catch (err) {
      this._log(
        `${STEP_LABEL[step]} sur « ${doc.title} » : ${err instanceof SidecarError ? err.message : String(err)}`,
        true,
      );
      return;
    }
    await this._loadDocs();
  }

  /**
   * Une ligne. `titleTd` permet à la vue hiérarchie de fournir sa propre cellule
   * de titre (indentation + badge de relation) sans dupliquer le reste.
   */
  private _docRow(doc: DocumentRecord, rowNum: number, titleTd?: HTMLTableCellElement): HTMLTableRowElement {
    const tr = document.createElement("tr");
    tr.className = "prep-meta-doc-row";
    tr.dataset.docId = String(doc.doc_id);

    const cell = (text: string): HTMLTableCellElement => {
      const td = document.createElement("td");
      td.textContent = text;
      return td;
    };

    tr.appendChild(cell(String(rowNum)));
    // Le titre est tronqué à la largeur de sa colonne : l'infobulle le rend entier,
    // sinon la troncature serait une perte.
    const flatTitle = cell(doc.title);
    flatTitle.title = doc.title;
    tr.appendChild(titleTd ?? flatTitle);
    tr.appendChild(cell(doc.language));
    tr.appendChild(cell(doc.doc_role ?? "—"));
    tr.appendChild(cell(String(doc.unit_count)));

    // « À faire » — quatre cases à trois états, une par capacité, TOUJOURS dans le même
    // ordre. C'est ce qui la rend scannable en colonne : on suit « Segmentation » du
    // regard sur 58 lignes, ce qu'un chapelet de pastilles de largeurs différentes
    // interdisait. L'anomalie d'index reste une pastille à part — ce n'est pas un
    // travail qu'on mène à terme, et lui donner une case laisserait croire qu'on peut
    // la déclarer réglée à la main.
    const stateTd = document.createElement("td");
    stateTd.className = "prep-acts-hub-state-cell";
    for (const step of HUB_STEPS) {
      stateTd.appendChild(this._stepBox(doc, step));
    }
    if (doc.fts_stale === true) {
      const warn = document.createElement("span");
      warn.className = "prep-acts-hub-badge prep-acts-hub-badge--warn";
      warn.textContent = "Index périmé";
      stateTd.appendChild(warn);
    }
    tr.appendChild(stateTd);

    // « Ouvrir » — sous filtre, le seul geste demandé ; sinon les quatre.
    const actionsTd = document.createElement("td");
    actionsTd.className = "prep-acts-hub-row-actions";
    if (this._hubFilter !== null) {
      const step = this._hubFilter;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "prep-acts-hub-row-btn prep-acts-hub-row-btn--primary";
      btn.textContent = `${STEP_LABEL[step]} →`;
      btn.title = `Ouvrir ${STEP_LABEL[step]} sur « ${doc.title} »`;
      btn.addEventListener("click", () => void this._openStepOnDoc(step, doc.doc_id));
      actionsTd.appendChild(btn);
    } else {
      for (const step of HUB_STEPS) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "prep-acts-hub-row-btn";
        btn.textContent = ActionsScreen.STEP_ICON[step];
        // L'icône seule ne se lit pas : le nom part dans le title ET dans aria-label.
        btn.title = `${STEP_LABEL[step]} — « ${doc.title} »`;
        btn.setAttribute("aria-label", `${STEP_LABEL[step]} sur ${doc.title}`);
        btn.addEventListener("click", () => void this._openStepOnDoc(step, doc.doc_id));
        actionsTd.appendChild(btn);
      }
    }
    tr.appendChild(actionsTd);
    return tr;
  }

  /** Mêmes glyphes que l'arbre de navigation (app.ts), pour ne pas inventer un second alphabet. */
  private static readonly STEP_ICON: Record<HubStep, string> = {
    curation: "◇", segmentation: "⌥", alignement: "⇄", annotation: "◎",
  };

  /**
   * Ouvre une capacité SUR un document. Les trois couches du canvas acceptent déjà
   * un docId ; l'alignement, lui, se travaille par famille — il faut donc remonter
   * du document à sa racine, ce qui demande les relations. Elles ne sont chargées
   * qu'ici, au clic, et non à chaque affichage du hub.
   */
  private async _openStepOnDoc(step: HubStep, docId: number): Promise<void> {
    if (step === "curation") { this.openCurationLayer(docId); return; }
    if (step === "segmentation") { this.openSegmentLayer(docId); return; }
    if (step === "annotation") { this.openAnnotationLayer(docId); return; }
    // Ne pas confondre les deux raisons de ne pas savoir. Sans relations lues, on
    // ignore la famille du document ; dire « il n'en a pas » serait affirmer ce
    // qu'on n'a pas pu vérifier.
    if (!(await this._ensureRelations())) {
      this._showToast?.("Relations indisponibles : impossible de retrouver la famille de ce document.", true);
      return;
    }
    const rootId = this._familyRootFor(docId);
    if (rootId === null) {
      // Document hors famille : la matrice n'a aucune famille à ouvrir. Le dire,
      // plutôt que d'y entrer sur la famille précédemment sélectionnée.
      this._showToast?.(
        "Ce document n'appartient à aucune famille : rattachez-le dans Documents pour l'aligner.",
        true,
      );
      return;
    }
    this.openAlignmentOnFamily(rootId, "matrix");
  }

  /** Charge les relations une fois pour toutes (partagé avec la vue hiérarchie). */
  private async _ensureRelations(): Promise<boolean> {
    if (this._allRelationsLoaded) return true;
    if (!this._conn) return false;
    try {
      this._allRelations = await getAllDocRelations(this._conn);
      this._allRelationsLoaded = true;
      return true;
    } catch (err) {
      this._log(`Erreur chargement relations : ${err instanceof SidecarError ? err.message : String(err)}`, true);
      return false;
    }
  }

  /** Racine de la famille d'un document (lui-même s'il est parent), ou null s'il est isolé.
   *  Pur : suppose les relations déjà chargées (`_ensureRelations`). */
  private _familyRootFor(docId: number): number | null {
    const isFamilyLink = (t: string): boolean => t === "translation_of" || t === "excerpt_of";
    const asChild = this._allRelations.find(
      (rel) => rel.doc_id === docId && isFamilyLink(rel.relation_type),
    );
    if (asChild) return asChild.target_doc_id;
    const isParent = this._allRelations.some(
      (rel) => rel.target_doc_id === docId && isFamilyLink(rel.relation_type),
    );
    return isParent ? docId : null;
  }

  /**
   * Le bouton dit l'état de la vue, d'où qu'on vienne — la bascule ou un rechargement.
   * Peint depuis un seul endroit : quand la peinture vivait dans la seule bascule, un
   * `↺ Actualiser` remettait la liste à plat et laissait le bouton annoncer
   * « 📋 Liste ». Le cliquer renvoyait alors dans la hiérarchie, l'inverse de ce qu'il
   * promettait. Trouvé en QA le 31 août.
   */
  private _paintHierarchyBtn(): void {
    const btn = this._q<HTMLButtonElement>("#act-hub-hierarchy-btn");
    if (!btn) return;
    btn.setAttribute("aria-pressed", String(this._hubHierarchyView));
    btn.classList.toggle("btn-active", this._hubHierarchyView);
    btn.textContent = this._hubHierarchyView ? "📋 Liste" : "🌿 Hiérarchie";
  }

  private async _toggleHubHierarchyView(): Promise<void> {
    this._hubHierarchyView = !this._hubHierarchyView;
    this._paintHierarchyBtn();
    if (this._hubHierarchyView && !(await this._ensureRelations())) {
      this._hubHierarchyView = false;
      this._paintHierarchyBtn();
      return;
    }
    this._renderDocList();
  }

  /**
   * Vue hiérarchie. L'arbre est bâti sur TOUS les documents même sous filtre : les
   * catégories qu'il produit (« Sans famille », « Parent absent du corpus ») portent
   * sur le corpus, et les calculer sur un sous-ensemble les rendrait fausses — un
   * parent simplement masqué par le filtre serait déclaré absent. Le filtre agit
   * donc au rendu : une ligne qui ne correspond pas est omise, sauf si elle est le
   * parent d'une ligne retenue, auquel cas elle reste en contexte, sans geste.
   */
  private _renderHubHierarchyList(el: HTMLElement, shown: DocumentRecord[]): void {
    el.innerHTML = "";
    const keep = new Set(shown.map((d) => d.doc_id));
    const { roots, standalone, orphans } = buildMetadataTree(this._docs, this._allRelations);

    // Le tri s'applique DANS chaque niveau, jamais à l'arbre aplati : un enfant
    // doit rester sous son parent quel que soit l'ordre demandé. `buildMetadataTree`
    // rend des tableaux fraîchement alloués, on peut les réordonner sur place.
    const cmp = hubComparator(this._sortCol, this._sortDir);
    roots.sort((a, b) => cmp(a.doc, b.doc));
    for (const node of roots) node.children.sort((a, b) => cmp(a.doc, b.doc));
    standalone.sort(cmp);
    orphans.sort(cmp);

    const table = document.createElement("table");
    table.className = "prep-meta-table prep-acts-hub-table";
    table.appendChild(this._docTableHead());
    const tbody = document.createElement("tbody");

    let rowNum = 0;
    /** `context` = affichée pour situer un enfant retenu, mais hors filtre elle-même. */
    const appendRow = (doc: DocumentRecord, depth = 0, relationLabel?: string, context = false): void => {
      rowNum++;
      const titleTd = document.createElement("td");
      titleTd.className = "col-title tree-title-cell";
      titleTd.style.paddingLeft = `${0.5 + depth * 1.4}rem`;
      const indent = depth > 0 ? `<span class="prep-tree-connector" aria-hidden="true">└</span>` : "";
      const relBadge = relationLabel
        ? `<span class="prep-tree-rel-badge">${_escHtml(relationLabel)}</span>`
        : "";
      setHtml(titleTd, raw(`${indent}${relBadge}`));
      const titleSpan = document.createElement("span");
      titleSpan.textContent = doc.title;
      titleTd.appendChild(titleSpan);

      const tr = this._docRow(doc, rowNum, titleTd);
      if (depth > 0) tr.classList.add("prep-tree-child");
      if (context) {
        tr.classList.add("prep-acts-hub-row--context");
        // Une ligne de contexte n'est pas un geste offert : elle ne doit pas non plus
        // être atteignable au clavier.
        tr.querySelectorAll<HTMLButtonElement>("button").forEach((b) => { b.disabled = true; });
      }
      tbody.appendChild(tr);
    };

    const appendSectionHeader = (label: string, count: number): void => {
      const tr = document.createElement("tr");
      tr.className = "prep-tree-section-header";
      const td = document.createElement("td");
      td.colSpan = 7;
      td.className = "prep-tree-section-label";
      td.textContent = `${label} `;
      const countSpan = document.createElement("span");
      countSpan.className = "prep-tree-section-count";
      countSpan.textContent = String(count);
      td.appendChild(countSpan);
      tr.appendChild(td);
      tbody.appendChild(tr);
    };

    for (const node of roots) {
      const keptChildren = node.children.filter((c) => keep.has(c.doc.doc_id));
      const keepRoot = keep.has(node.doc.doc_id);
      if (!keepRoot && keptChildren.length === 0) continue;
      appendRow(node.doc, 0, undefined, !keepRoot);
      for (const child of keptChildren) appendRow(child.doc, 1, child.relationLabel);
    }
    const keptStandalone = standalone.filter((d) => keep.has(d.doc_id));
    if (keptStandalone.length > 0) {
      if (roots.length > 0) appendSectionHeader("Sans famille", keptStandalone.length);
      for (const doc of keptStandalone) appendRow(doc);
    }
    const keptOrphans = orphans.filter((d) => keep.has(d.doc_id));
    if (keptOrphans.length > 0) {
      appendSectionHeader("Parent absent du corpus", keptOrphans.length);
      for (const doc of keptOrphans) appendRow(doc);
    }

    table.appendChild(tbody);
    el.appendChild(table);
    this._paintSortIndicators(table);
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
    // NAV-01 — l'écran démonté ne doit plus répondre à la pile : le shell détruit puis
    // recrée Prep à chaque changement de mode, et un niveau survivant lirait un DOM mort.
    unregisterLevel("subView");
    unregisterLevel("layer");
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


