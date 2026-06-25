/**
 * CorpusAuditPanel.ts — corpus-audit result panel, extracted from MetadataScreen (U-02).
 *
 * Pure renderer for a `CorpusAuditResult`: it owns its panel element and the
 * `_result` it last rendered, and nothing else. Every effect that reaches
 * outside the panel (mutating the shared doc selection, navigating to a doc,
 * re-segmenting / re-aligning families) is delegated to the host through the
 * `CorpusAuditPanelDeps` callbacks, so the panel holds no shared mutable state.
 *
 * The host (MetadataScreen) keeps `_runAudit` — it owns the audit button, the
 * ratio-threshold input and the runtime error banner — and feeds results in via
 * `render(result)`.
 */

import { setHtml, raw } from "../lib/safeHtml.ts";
import type {
  CorpusAuditResult,
  FamilyAuditData,
  DocumentRecord,
} from "../lib/sidecarClient.ts";

/** Host-supplied data reads and outward effects. The panel mutates nothing itself. */
export interface CorpusAuditPanelDeps {
  /** Look up a document by id (for row title/lang/role rendering). */
  getDoc(docId: number): DocumentRecord | undefined;
  /** Whether the corpus has any documentary families (drives the "all healthy" badge). */
  hasFamilies(): boolean;
  /** Whether a doc is currently in the shared selection (for checkbox state). */
  isSelected(docId: number): boolean;
  /**
   * Toggle a group of ids in the shared selection and refresh the host
   * (doc list, batch bar, scroll). Returns the new "is now selected" state so
   * the panel can sync its own checkboxes and button labels.
   */
  selectIds(ids: number[]): boolean;
  /** Add/remove a single doc from the shared selection and refresh the host. */
  toggleOne(docId: number, checked: boolean): void;
  /** Navigate the host to a document's edit panel. */
  navToDoc(docId: number): void;
  /** Re-segment the given family roots, then re-run the audit. */
  segmentFamilies(familyRootIds: number[]): void;
  /** Re-align the given family roots, then re-run the audit. */
  alignFamilies(familyRootIds: number[]): void;
}

/** Middle-truncate long titles: "Lorem ipsum…sit amet" — preserves start and end. */
function truncateMid(text: string, maxChars = 42): string {
  if (!text || text.length <= maxChars) return text;
  const tail = Math.max(8, Math.floor(maxChars * 0.35));
  const head = maxChars - tail - 1; // 1 for the ellipsis
  return text.slice(0, head) + "…" + text.slice(-tail);
}

export class CorpusAuditPanel {
  private _result: CorpusAuditResult | null = null;

  constructor(
    private readonly _el: HTMLElement,
    private readonly _deps: CorpusAuditPanelDeps,
  ) {}

  /** True while the panel is showing a result. */
  isOpen(): boolean {
    return !this._el.hidden;
  }

  /** Render (or hide, when `result` is null) the audit panel. */
  render(result: CorpusAuditResult | null): void {
    this._result = result;
    const panel = this._el;
    const r = this._result;
    if (!r) { panel.hidden = true; return; }

    panel.innerHTML = "";
    panel.hidden = false;

    // ── Header ────────────────────────────────────────────────────────────────
    const header = document.createElement("div");
    header.className = r.total_issues === 0 ? "audit-header audit-header-ok" : "audit-header audit-header-warn";

    const headerText = document.createElement("span");
    headerText.textContent = r.total_issues === 0
      ? `✅ Corpus sain — ${r.total_docs} document(s), aucun problème détecté.`
      : `⚠️ ${r.total_issues} problème(s) sur ${r.total_docs} document(s)`;

    const closeBtn = document.createElement("button");
    closeBtn.className = "audit-close-btn";
    closeBtn.title = "Fermer";
    closeBtn.textContent = "✕";
    closeBtn.addEventListener("click", () => { panel.hidden = true; this._result = null; });

    header.appendChild(headerText);
    header.appendChild(closeBtn);
    panel.appendChild(header);

    // ── Sections ──────────────────────────────────────────────────────────────
    if (r.missing_fields.length > 0) {
      panel.appendChild(this._simpleSection(
        "Champs manquants",
        r.missing_fields.map(e => ({ docId: e.doc_id, extra: e.missing.join(", ") })),
      ));
    }
    if (r.empty_documents.length > 0) {
      panel.appendChild(this._simpleSection(
        "Documents vides (0 unité importée)",
        r.empty_documents.map(e => ({ docId: e.doc_id, extra: "" })),
      ));
    }
    if (r.duplicate_hashes.length > 0) {
      panel.appendChild(this._groupSection(
        "Doublons de contenu (même fichier importé plusieurs fois)",
        r.duplicate_hashes.map(g => ({ label: `hash ${g.hash_prefix}…`, ids: g.doc_ids })),
      ));
    }
    if (r.duplicate_filenames.length > 0) {
      panel.appendChild(this._groupSection(
        "Doublons de nom de fichier",
        r.duplicate_filenames.map(g => ({ label: g.filename, ids: g.doc_ids })),
      ));
    }
    if (r.duplicate_titles.length > 0) {
      panel.appendChild(this._groupSection(
        "Doublons de titre",
        r.duplicate_titles.map(g => ({ label: `«${g.title}»`, ids: g.doc_ids })),
      ));
    }

    // ── Families section ─────────────────────────────────────────────────
    if (r.families && r.families.total_family_issues > 0) {
      panel.appendChild(this._familiesSection(r.families));
    } else if (r.families && r.families.total_family_issues === 0 && (
      r.families.orphan_docs.length + r.families.unsegmented_children.length +
      r.families.unaligned_pairs.length + r.families.ratio_warnings.length
    ) === 0) {
      // All families healthy — show positive badge only if there are any relations
      const anyFamilies = this._deps.hasFamilies();
      if (anyFamilies) {
        const ok = document.createElement("div");
        ok.className = "audit-family-ok";
        ok.textContent = `✅ Toutes les familles documentaires sont en ordre (seuil ratio : ${r.families.ratio_threshold_pct} %)`;
        panel.appendChild(ok);
      }
    }
  }

  private _familiesSection(fam: FamilyAuditData): HTMLDetailsElement {
    const details = document.createElement("details");
    details.className = "audit-section audit-section-family";
    details.open = true;

    const summary = document.createElement("summary");
    summary.className = "audit-section-summary";
    setHtml(summary, raw(`
      <span class="audit-section-label">📁 Familles documentaires</span>
      <span class="audit-issue-badge">${fam.total_family_issues}</span>
      <span class="audit-section-meta">(seuil ratio : ${fam.ratio_threshold_pct} %)</span>`));
    details.appendChild(summary);

    const body = document.createElement("div");
    body.className = "audit-section-body";

    // Orphan docs
    if (fam.orphan_docs.length > 0) {
      body.appendChild(this._famSubsection(
        `Docs orphelins — parent absent du corpus (${fam.orphan_docs.length})`,
        fam.orphan_docs.map(e => ({
          docId: e.child_id,
          extra: `parent attendu : #${e.parent_id}`,
          actionNav: e.child_id,
        })),
        null, null,
      ));
    }

    // Unsegmented children
    if (fam.unsegmented_children.length > 0) {
      const familyRootIds = [...new Set(fam.unsegmented_children.map(e => e.parent_id))];
      body.appendChild(this._famSubsection(
        `Docs non segmentés dans une famille (${fam.unsegmented_children.length})`,
        fam.unsegmented_children.map(e => ({
          docId: e.child_id,
          extra: `${!e.child_segmented ? "enfant non segmenté" : "parent non segmenté"}`,
          actionNav: e.parent_id,
        })),
        { label: "Segmenter les familles", action: () => this._deps.segmentFamilies(familyRootIds) },
        null,
      ));
    }

    // Unaligned pairs
    if (fam.unaligned_pairs.length > 0) {
      const familyRootIds = [...new Set(fam.unaligned_pairs.map(e => e.parent_id))];
      body.appendChild(this._famSubsection(
        `Paires segmentées mais non alignées (${fam.unaligned_pairs.length})`,
        fam.unaligned_pairs.map(e => ({
          docId: e.child_id,
          extra: `#${e.parent_id} ↔ #${e.child_id} · ${e.parent_segs} vs ${e.child_segs} seg.`,
          actionNav: e.parent_id,
        })),
        null,
        { label: "Aligner les familles", action: () => this._deps.alignFamilies(familyRootIds) },
      ));
    }

    // Ratio warnings
    if (fam.ratio_warnings.length > 0) {
      body.appendChild(this._famSubsection(
        `Ratios de segments suspects > ${fam.ratio_threshold_pct} % (${fam.ratio_warnings.length})`,
        fam.ratio_warnings.map(e => ({
          docId: e.child_id,
          extra: `±${e.ratio_pct} % · #${e.parent_id}: ${e.parent_segs} seg. | #${e.child_id}: ${e.child_segs} seg.`,
          actionNav: e.parent_id,
        })),
        null, null,
      ));
    }

    details.appendChild(body);
    return details;
  }

  private _famSubsection(
    title: string,
    items: { docId: number; extra: string; actionNav: number }[],
    segAction: { label: string; action: () => void } | null,
    alnAction: { label: string; action: () => void } | null,
  ): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "audit-fam-subsection";

    const head = document.createElement("div");
    head.className = "audit-fam-subsection-head";

    const titleEl = document.createElement("span");
    titleEl.className = "audit-fam-subsection-title";
    titleEl.textContent = title;
    head.appendChild(titleEl);

    if (segAction) {
      const btn = document.createElement("button");
      btn.className = "btn btn-secondary btn-xs";
      btn.textContent = `⟳ ${segAction.label}`;
      btn.addEventListener("click", segAction.action);
      head.appendChild(btn);
    }
    if (alnAction) {
      const btn = document.createElement("button");
      btn.className = "btn btn-secondary btn-xs";
      btn.textContent = `⇄ ${alnAction.label}`;
      btn.addEventListener("click", alnAction.action);
      head.appendChild(btn);
    }
    wrap.appendChild(head);

    items.forEach(item => {
      const row = this._docRow(item.docId, item.extra, undefined);
      // Override nav button to go to parent (family root)
      const navBtn = row.querySelector<HTMLButtonElement>(".audit-doc-nav-btn");
      if (navBtn) {
        navBtn.title = `Ouvrir le document parent #${item.actionNav}`;
        navBtn.onclick = () => this._deps.navToDoc(item.actionNav);
      }
      wrap.appendChild(row);
    });
    return wrap;
  }

  /**
   * Toggle a group of ids in the shared selection (delegated to the host) and
   * reflect the new state in this panel's checkboxes and button label.
   */
  private _selectIds(ids: number[], feedbackBtn?: HTMLButtonElement): void {
    const isNowSelected = this._deps.selectIds(ids);

    // Update checkboxes inside the audit panel without rebuilding it
    this._el.querySelectorAll<HTMLInputElement>(".audit-doc-check").forEach(cb => {
      const id = Number(cb.dataset.docId);
      if (id && ids.includes(id)) cb.checked = this._deps.isSelected(id);
    });

    // Update button label to reflect current state
    if (feedbackBtn) {
      feedbackBtn.textContent = isNowSelected
        ? (ids.length === 1 ? "Désélectionner" : "Tout désélectionner")
        : (ids.length === 1 ? "Sélectionner" : "Tout sélectionner");
    }
  }

  /** One doc row: [ ☐ ] [#id] [title…………] [lang · role] [→] */
  private _docRow(docId: number, extra: string, onToggle?: () => void): HTMLElement {
    const doc = this._deps.getDoc(docId);
    const title = doc?.title ?? `doc #${docId}`;
    const lang  = doc?.language ?? "";
    const role  = doc?.doc_role ?? "";

    const row = document.createElement("div");
    row.className = "audit-doc-row";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "audit-doc-check";
    cb.dataset.docId = String(docId);
    cb.checked = this._deps.isSelected(docId);
    cb.title = "Ajouter / retirer de la sélection";
    cb.addEventListener("change", () => {
      this._deps.toggleOne(docId, cb.checked);
      onToggle?.();
    });

    const idBadge = document.createElement("span");
    idBadge.className = "audit-doc-id-badge";
    idBadge.textContent = `#${docId}`;

    const titleEl = document.createElement("span");
    titleEl.className = "audit-doc-title-cell";
    titleEl.textContent = truncateMid(title, 44);
    titleEl.title = title;

    const metaEl = document.createElement("span");
    metaEl.className = "audit-doc-meta";
    metaEl.textContent = extra || [lang, role].filter(Boolean).join(" · ");

    const navBtn = document.createElement("button");
    navBtn.className = "audit-doc-nav-btn";
    navBtn.textContent = "→";
    navBtn.title = `Ouvrir la fiche du document #${docId}`;
    navBtn.addEventListener("click", () => this._deps.navToDoc(docId));

    row.appendChild(cb);
    row.appendChild(idBadge);
    row.appendChild(titleEl);
    row.appendChild(metaEl);
    row.appendChild(navBtn);
    return row;
  }

  /** Section with one row per document (missing fields, empty docs). */
  private _simpleSection(
    title: string,
    items: { docId: number; extra: string }[],
  ): HTMLDetailsElement {
    const allIds = items.map(i => i.docId);
    const details = document.createElement("details");
    details.className = "audit-section";
    details.open = items.length <= 15;

    const summary = this._summary(title, items.length,
      `${items.length} document${items.length > 1 ? "s" : ""}`, allIds);
    details.appendChild(summary);

    const body = document.createElement("div");
    body.className = "audit-section-body";
    items.forEach(item => body.appendChild(this._docRow(item.docId, item.extra)));
    details.appendChild(body);
    return details;
  }

  /** Section with group cards (duplicate hashes / filenames / titles). */
  private _groupSection(
    title: string,
    groups: { label: string; ids: number[] }[],
  ): HTMLDetailsElement {
    const PAGE = 20;
    const totalDocs = groups.reduce((s, g) => s + g.ids.length, 0);
    const allIds = groups.flatMap(g => g.ids);

    const details = document.createElement("details");
    details.className = "audit-section";
    details.open = groups.length <= 5;

    const summary = this._summary(title, groups.length,
      `${groups.length} groupe${groups.length > 1 ? "s" : ""} · ${totalDocs} documents`, allIds);
    details.appendChild(summary);

    const body = document.createElement("div");
    body.className = "audit-section-body";

    const makeCard = (g: { label: string; ids: number[] }): HTMLElement => {
      const card = document.createElement("div");
      card.className = "audit-group-card";

      const head = document.createElement("div");
      head.className = "audit-group-head";

      const labelEl = document.createElement("span");
      labelEl.className = "audit-group-label";
      labelEl.textContent = g.label;
      labelEl.title = g.label;

      const countEl = document.createElement("span");
      countEl.className = "audit-group-count";
      countEl.textContent = `${g.ids.length} copie${g.ids.length > 1 ? "s" : ""}`;

      const selBtn = document.createElement("button");
      selBtn.className = "audit-sel-btn audit-sel-btn-sm";
      selBtn.textContent = "Sélectionner";
      selBtn.title = "Ajouter ce groupe à la sélection (puis Supprimer dans la barre)";
      const updateSelBtn = () => {
        const allSel = g.ids.every(id => this._deps.isSelected(id));
        selBtn.textContent = allSel ? "Tout désélectionner" : "Sélectionner";
      };
      selBtn.addEventListener("click", () => { this._selectIds(g.ids, selBtn); updateSelBtn(); });

      head.appendChild(labelEl);
      head.appendChild(countEl);
      head.appendChild(selBtn);
      card.appendChild(head);

      g.ids.forEach(id => card.appendChild(this._docRow(id, "", updateSelBtn)));
      return card;
    };

    const firstPage = groups.slice(0, PAGE);
    const rest = groups.slice(PAGE);
    firstPage.forEach(g => body.appendChild(makeCard(g)));

    if (rest.length > 0) {
      let offset = 0;
      const moreBtn = document.createElement("button");
      moreBtn.className = "audit-show-more-btn";
      const updateMoreBtn = () => {
        const remaining = rest.length - offset;
        moreBtn.textContent = `Afficher ${Math.min(PAGE, remaining)} groupe${remaining > 1 ? "s" : ""} de plus… (${remaining} restant${remaining > 1 ? "s" : ""})`;
      };
      updateMoreBtn();
      moreBtn.addEventListener("click", () => {
        const batch = rest.slice(offset, offset + PAGE);
        batch.forEach(g => body.insertBefore(makeCard(g), moreBtn));
        offset += batch.length;
        if (offset >= rest.length) moreBtn.remove();
        else updateMoreBtn();
      });
      body.appendChild(moreBtn);
    }

    details.appendChild(body);
    return details;
  }

  /** Shared <summary> element for audit sections. */
  private _summary(title: string, count: number, metaText: string, allIds: number[]): HTMLElement {
    const summary = document.createElement("summary");
    summary.className = "audit-section-head";

    const badge = document.createElement("span");
    badge.className = "audit-badge audit-badge-warn";
    badge.textContent = String(count);

    const titleEl = document.createElement("strong");
    titleEl.textContent = title;

    const meta = document.createElement("span");
    meta.className = "audit-section-meta";
    meta.textContent = metaText;

    const selAllBtn = document.createElement("button");
    selAllBtn.className = "audit-sel-btn";
    selAllBtn.textContent = "Tout sélectionner";
    selAllBtn.title = "Ajouter tous ces documents à la sélection pour action groupée";
    selAllBtn.addEventListener("click", e => {
      e.stopPropagation(); // prevent <details> toggle
      this._selectIds(allIds, selAllBtn);
    });

    summary.appendChild(badge);
    summary.appendChild(titleEl);
    summary.appendChild(meta);
    summary.appendChild(selAllBtn);
    return summary;
  }
}
