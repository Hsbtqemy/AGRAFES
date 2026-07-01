/**
 * TextCanvasView.ts — Prototype T0 de la refonte « texte central + couches ».
 *
 * Voir docs/DESIGN_prep_text_canvas.md. Sous-vue unifiée où LE TEXTE (les unités
 * du document) est l'élément central à scroll unique, avec un bandeau d'état
 * permanent et un sélecteur de couche. T0 = couche « Segmentation / Rôles »
 * seule (réutilise RolesPane) ; Curation/Annotation viendront en T1/T2.
 *
 * Lecture + écritures légères (rôle/borne, déjà immédiates). Aucune écriture de
 * curation. Cohabite avec les écrans legacy — rien retiré.
 */

import type { Conn, DocumentRecord, DocumentStats } from "../lib/sidecarClient.ts";
import { getDocumentStats } from "../lib/sidecarClient.ts";
import { escHtml as esc } from "../lib/diff.ts";
import { setHtml, raw } from "../lib/safeHtml.ts";
import { RolesPane } from "../components/RolesPane.ts";

export interface TextCanvasCallbacks {
  log: (msg: string, isError?: boolean) => void;
  toast: (msg: string, isError?: boolean) => void;
  /** Re-fetch the document list from the sidecar (host owns the shared list). */
  onReloadDocs?: () => void | Promise<void>;
}

type CanvasMode = "roles" | "curation" | "annoter";

export class TextCanvasView {
  private readonly _getConn: () => Conn | null;
  private readonly _getDocs: () => DocumentRecord[];
  private readonly _cb: TextCanvasCallbacks;

  private _root: HTMLElement | null = null;
  private _rolesPane: RolesPane | null = null;
  private _docId: number | null = null;
  private _stats: DocumentStats | null = null;
  private _mode: CanvasMode = "roles";
  private _menuOpen = false;
  /** Bound outside-click handler; attached only while the doc menu is open. */
  private readonly _onOutsideClick = (e: MouseEvent): void => {
    const sel = this._root?.querySelector<HTMLElement>("#prep-canvas-doc-select");
    if (sel && !sel.contains(e.target as Node)) this._closeMenu();
  };

  constructor(
    getConn: () => Conn | null,
    getDocs: () => DocumentRecord[],
    cb: TextCanvasCallbacks,
  ) {
    this._getConn = getConn;
    this._getDocs = getDocs;
    this._cb = cb;
  }

  render(wrapper: HTMLElement): void {
    wrapper.classList.add("prep-canvas-root");
    wrapper.setAttribute("role", "main");
    wrapper.setAttribute("aria-label", "Canvas Texte");
    this._root = wrapper;
    setHtml(wrapper, raw(`
      <div class="prep-canvas-statestrip" id="prep-canvas-state" aria-live="polite"></div>
      <div class="prep-canvas-toolbar">
        <div class="prep-canvas-doc-picker">
          <span class="prep-canvas-doc-label" id="prep-canvas-doc-label">Document</span>
          <div class="prep-canvas-doc-select" id="prep-canvas-doc-select">
            <button type="button" class="prep-canvas-doc-trigger" id="prep-canvas-doc-trigger"
                    aria-haspopup="listbox" aria-expanded="false"
                    aria-labelledby="prep-canvas-doc-label prep-canvas-doc-trigger">
              <span class="prep-canvas-doc-trigger-text" id="prep-canvas-doc-trigger-text">&#8212; choisir un document &#8212;</span>
              <span class="prep-canvas-doc-caret" aria-hidden="true">&#9662;</span>
            </button>
            <div class="prep-canvas-doc-menu" id="prep-canvas-doc-menu" role="listbox"
                 aria-label="Documents" hidden></div>
          </div>
          <button type="button" class="prep-canvas-reload" id="prep-canvas-reload"
                  title="Recharger la liste des documents depuis la base">&#8635; Actualiser</button>
        </div>
        <div class="prep-canvas-modes" role="group" aria-label="Couche active">
          <button type="button" class="prep-canvas-modebtn active" data-mode="roles" aria-pressed="true">R&#244;les</button>
          <button type="button" class="prep-canvas-modebtn" data-mode="curation" disabled title="à venir (T1)">Curation</button>
          <button type="button" class="prep-canvas-modebtn" data-mode="annoter" disabled title="à venir (T2)">Annotation</button>
        </div>
      </div>
      <div class="prep-canvas-body" id="prep-canvas-body"></div>
    `));

    const body = wrapper.querySelector<HTMLElement>("#prep-canvas-body");
    if (body) {
      this._rolesPane = new RolesPane(body, this._getConn, (msg) => this._cb.toast(msg, true));
      this._rolesPane.mount();
    }

    const trigger = wrapper.querySelector<HTMLButtonElement>("#prep-canvas-doc-trigger");
    trigger?.addEventListener("click", () => this._toggleMenu());
    trigger?.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        this._openMenu();
      } else if (e.key === "Escape") {
        this._closeMenu();
      }
    });
    const menu = wrapper.querySelector<HTMLElement>("#prep-canvas-doc-menu");
    menu?.addEventListener("keydown", (e) => this._onMenuKeydown(e));

    const reloadBtn = wrapper.querySelector<HTMLButtonElement>("#prep-canvas-reload");
    reloadBtn?.addEventListener("click", async () => {
      if (!this._cb.onReloadDocs) return;
      reloadBtn.disabled = true;
      try {
        await this._cb.onReloadDocs(); // host re-fetches + calls back refreshDocs()
        // Re-focus the current doc so its stats + units reflect any change
        // (e.g. a resegmentation that populated parent_n) rather than stale caches.
        if (this._docId !== null) await this._focusDoc(this._docId);
      } finally {
        reloadBtn.disabled = false;
      }
    });

    wrapper.querySelectorAll<HTMLButtonElement>(".prep-canvas-modebtn").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        this._setMode(btn.dataset.mode as CanvasMode);
      });
    });

    this.refreshDocs();
  }

  /** Repopulate the custom document dropdown from the current docs list. */
  refreshDocs(): void {
    const menu = this._root?.querySelector<HTMLElement>("#prep-canvas-doc-menu");
    if (!menu) return;
    const docs = this._sortedDocs();
    // Drop the current focus if its doc vanished from the list.
    if (this._docId !== null && !docs.some((d) => d.doc_id === this._docId)) {
      this._docId = null;
    }
    const optHtml = docs
      .map((d) => {
        const on = d.doc_id === this._docId;
        return `<button type="button" class="prep-canvas-doc-opt${on ? " selected" : ""}" role="option"
                aria-selected="${on}" data-doc="${d.doc_id}">${esc(d.title)}
                <span class="prep-canvas-doc-opt-lang">${esc(d.language ?? "?")}</span></button>`;
      })
      .join("");
    setHtml(menu, raw(
      `<button type="button" class="prep-canvas-doc-opt prep-canvas-doc-opt--none" role="option"
               aria-selected="${this._docId === null}" data-doc="">&#8212; choisir un document &#8212;</button>`
      + optHtml,
    ));
    menu.querySelectorAll<HTMLButtonElement>(".prep-canvas-doc-opt").forEach((btn) => {
      btn.addEventListener("click", () => {
        const docAttr = btn.dataset.doc;
        const id = docAttr ? parseInt(docAttr, 10) : null;
        this._selectDoc(Number.isNaN(id as number) ? null : id);
      });
    });
    this._syncTriggerText();
    this._renderStateStrip();
  }

  private _sortedDocs(): DocumentRecord[] {
    return [...this._getDocs()].sort((a, b) =>
      (a.title ?? "").localeCompare(b.title ?? "", "fr", { numeric: true, sensitivity: "base" }),
    );
  }

  /** Reflect the current selection in the closed trigger's label. */
  private _syncTriggerText(): void {
    const el = this._root?.querySelector<HTMLElement>("#prep-canvas-doc-trigger-text");
    if (!el) return;
    const doc = this._getDocs().find((d) => d.doc_id === this._docId) ?? null;
    el.textContent = doc
      ? `${doc.title} (${doc.language ?? "?"})`
      : "— choisir un document —";
    el.classList.toggle("prep-canvas-doc-trigger-text--placeholder", doc === null);
  }

  /** Reflect the current selection in the menu's option highlight (without rebuilding). */
  private _syncMenuSelection(): void {
    const menu = this._root?.querySelector<HTMLElement>("#prep-canvas-doc-menu");
    menu?.querySelectorAll<HTMLButtonElement>(".prep-canvas-doc-opt").forEach((btn) => {
      const docAttr = btn.dataset.doc;
      const id = docAttr ? parseInt(docAttr, 10) : null;
      const on = id === this._docId;
      btn.classList.toggle("selected", on);
      btn.setAttribute("aria-selected", String(on));
    });
  }

  // ─── Custom document dropdown ──────────────────────────────────────────────

  private _toggleMenu(): void {
    if (this._menuOpen) this._closeMenu();
    else this._openMenu();
  }

  private _openMenu(): void {
    if (this._menuOpen) return;
    const menu = this._root?.querySelector<HTMLElement>("#prep-canvas-doc-menu");
    const trigger = this._root?.querySelector<HTMLButtonElement>("#prep-canvas-doc-trigger");
    if (!menu || !trigger) return;
    this._menuOpen = true;
    menu.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    document.addEventListener("click", this._onOutsideClick);
    // Focus the selected option (or the first) for keyboard navigation.
    const sel = menu.querySelector<HTMLButtonElement>(".prep-canvas-doc-opt.selected")
      ?? menu.querySelector<HTMLButtonElement>(".prep-canvas-doc-opt");
    sel?.focus();
  }

  private _closeMenu(): void {
    if (!this._menuOpen) return;
    this._menuOpen = false;
    const menu = this._root?.querySelector<HTMLElement>("#prep-canvas-doc-menu");
    const trigger = this._root?.querySelector<HTMLButtonElement>("#prep-canvas-doc-trigger");
    if (menu) menu.hidden = true;
    trigger?.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", this._onOutsideClick);
  }

  private _selectDoc(docId: number | null): void {
    this._closeMenu();
    this._root?.querySelector<HTMLButtonElement>("#prep-canvas-doc-trigger")?.focus();
    void this._focusDoc(docId);
  }

  private _onMenuKeydown(e: KeyboardEvent): void {
    const menu = e.currentTarget as HTMLElement;
    const opts = Array.from(menu.querySelectorAll<HTMLButtonElement>(".prep-canvas-doc-opt"));
    const idx = opts.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      opts[Math.min(idx + 1, opts.length - 1)]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      opts[Math.max(idx - 1, 0)]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      opts[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      opts[opts.length - 1]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      this._closeMenu();
      this._root?.querySelector<HTMLButtonElement>("#prep-canvas-doc-trigger")?.focus();
    }
  }

  private async _focusDoc(docId: number | null): Promise<void> {
    this._docId = docId;
    this._stats = null;
    const doc = this._getDocs().find((d) => d.doc_id === docId) ?? null;
    this._syncTriggerText();
    this._syncMenuSelection();
    this._renderStateStrip();
    if (docId !== null) {
      const conn = this._getConn();
      if (conn) {
        try {
          this._stats = await getDocumentStats(conn, docId);
        } catch {
          this._stats = null; // le bandeau retombe sur unit_count (R1.1)
        }
        this._renderStateStrip();
      }
    }
    if (this._rolesPane) {
      await this._rolesPane.setDocument(docId, doc?.text_start_n ?? null);
    }
  }

  private _setMode(mode: CanvasMode): void {
    this._mode = mode;
    this._root?.querySelectorAll<HTMLButtonElement>(".prep-canvas-modebtn").forEach((b) => {
      const on = b.dataset.mode === mode;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    });
    // T0 : seul le mode "roles" a un rendu (RolesPane). Les autres sont désactivés.
  }

  private _renderStateStrip(): void {
    const el = this._root?.querySelector<HTMLElement>("#prep-canvas-state");
    if (!el) return;
    const doc = this._getDocs().find((d) => d.doc_id === this._docId) ?? null;
    if (!doc) {
      setHtml(el, raw(`<span class="prep-canvas-state-empty">Aucun document s&#233;lectionn&#233;.</span>`));
      return;
    }
    const wf = doc.workflow_status ?? "draft";
    const wfLabel = wf === "validated" ? "Valid&#233;" : wf === "review" ? "En revue" : "Brouillon";
    const wfClass = wf === "validated" ? "ok" : wf === "review" ? "warn" : "draft";
    const stale = doc.fts_stale === true;
    const ts = doc.text_start_n;
    // A0/R1.2 — conscience du stade. Sans stats (pas encore chargées) on retombe sur
    // unit_count (R1.1) ; avec les stats (GET /documents/stats) on enrichit : grain
    // fin/grossier, numérotation, alignement, présence du parent ¶.
    const st = this._stats && this._stats.doc_id === doc.doc_id ? this._stats : null;
    const lineCount = st ? st.line_count
      : (typeof doc.unit_count === "number" ? doc.unit_count : null);
    const chip = (cls: string, label: string): string =>
      `<span class="prep-canvas-chip${cls ? ` prep-canvas-chip--${cls}` : ""}">${label}</span>`;

    const chips: string[] = [];
    if (lineCount === null) {
      chips.push(chip("draft", "Stade : ?"));
    } else if (lineCount <= 1) {
      chips.push(chip("warn", "Brut (non segmenté)"));
    } else {
      const grain = st ? (st.avg_text_len > 240 ? "unités ¶" : "phrases") : "unités";
      chips.push(chip("ok", `Segmenté · ${lineCount} ${grain}`));
    }
    if (st && st.line_count > 1) {
      if (st.parent_count > 0) chips.push(chip("ok", `Hiérarchie ¶ (${st.parent_count})`));
      const num = st.external_id_count === 0 ? { c: "draft", l: "Non numéroté" }
        : st.external_id_count >= st.line_count ? { c: "ok", l: "Numéroté" }
        : { c: "ok", l: "Numéroté (partiel)" };
      chips.push(chip(num.c, num.l));
      chips.push(st.aligned_count > 0
        ? chip("ok", `Aligné (${st.aligned_count})`)
        : chip("draft", "Non aligné"));
    }
    chips.push(chip(wfClass, wfLabel));
    chips.push(chip(stale ? "warn" : "ok", `Index ${stale ? "⚠ périmé" : "à jour"}`));
    chips.push(chip("", ts != null ? `Borne : unité ${ts}` : "Borne : non posée"));
    setHtml(el, raw(chips.join("")));
  }
}
