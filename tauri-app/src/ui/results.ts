/**
 * ui/results.ts — Individual result card renderers (pure DOM builders).
 *
 * Intentionally has no dependency on query.ts or search.ts to avoid circular imports.
 * The meta panel opener is injected via setMetaOpener() from app.ts.
 */

import type { QueryHit, AlignedUnit } from "../lib/sidecarClient";
import { state } from "../state";
import { elt, escapeHtml } from "./dom";

// ─── Dependency injection (breaks circular: results ↔ metaPanel / query) ─────

let _openMetaFn: ((hit: QueryHit) => void) | null = null;
let _filterDocFn: ((docId: number) => void) | null = null;

/** Called once from app.ts after all modules are imported. */
export function setMetaOpener(fn: (hit: QueryHit) => void): void {
  _openMetaFn = fn;
}

/** Called once from app.ts: wires the "filter on this doc + re-search" action. */
export function setFilterDocCallback(fn: (docId: number) => void): void {
  _filterDocFn = fn;
}

/**
 * Marks the result card whose unit_id matches as active (for meta panel continuity).
 * Called by metaPanel.ts on open/close. Pass null to clear.
 */
export function markActiveCard(unitId: number | null): void {
  document.querySelectorAll(".result-card.card--active, .parallel-card.card--active").forEach(el => {
    el.classList.remove("card--active");
  });
  if (unitId == null) return;
  const card = document.querySelector(`[data-unit-id="${unitId}"]`) as HTMLElement | null;
  card?.classList.add("card--active");
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const PARALLEL_COLLAPSE_N = 5;
export const VIRT_DOM_CAP = 150;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Extract plain text from a hit (strips << >> markers, works in both modes). */
function hitPlainText(hit: QueryHit): string {
  if (hit.text ?? hit.text_norm) {
    return (hit.text ?? hit.text_norm ?? "").replace(/<<|>>/g, "").trim();
  }
  // KWIC fallback
  return `${hit.left ?? ""} ${hit.match ?? ""} ${hit.right ?? ""}`.trim();
}

/** Compact copy-text button with "Copié !" flash feedback. */
function makeCopyBtn(text: string): HTMLButtonElement {
  const btn = elt("button", { class: "card-action-btn", title: "Copier le texte du passage", type: "button" }, "📋 Copier") as HTMLButtonElement;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    void navigator.clipboard?.writeText(text).then(() => {
      btn.textContent = "✓ Copié";
      btn.classList.add("copied");
      setTimeout(() => { btn.textContent = "📋 Copier"; btn.classList.remove("copied"); }, 1500);
    });
  });
  return btn;
}

/** Small inline copy icon for aligned group headers. */
function makeGroupCopyBtn(text: string, lang: string): HTMLButtonElement {
  const btn = elt("button", {
    class: "parallel-group-copy-btn",
    title: `Copier les passages ${lang.toUpperCase()}`,
    type: "button",
  }, "📋") as HTMLButtonElement;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    void navigator.clipboard?.writeText(text).then(() => {
      btn.textContent = "✓";
      setTimeout(() => { btn.textContent = "📋"; }, 1200);
    });
  });
  return btn;
}

/** Build a formatted plain-text citation: pivot + all aligned groups. */
function buildCitationText(hit: QueryHit): string {
  const pivotText = hitPlainText(hit);
  const pivotRef = hit.external_id != null ? ` §${hit.external_id}` : "";
  const pivotLang = (hit.language ?? "?").toUpperCase();
  const lines: string[] = [
    `[${pivotLang}] ${hit.title || "—"}${pivotRef}`,
    `«${pivotText}»`,
  ];
  const groups = new Map<string, AlignedUnit[]>();
  for (const item of hit.aligned ?? []) {
    const key = `${item.language ?? "und"}|${item.doc_id}|${item.title ?? ""}`;
    const cur = groups.get(key);
    if (cur) cur.push(item); else groups.set(key, [item]);
  }
  for (const [key, items] of groups.entries()) {
    const parts = key.split("|");
    const lang = (parts[0] ?? "?").toUpperCase();
    const title = parts.slice(2).join("|");
    const firstRef = items[0]?.external_id != null ? ` §${items[0].external_id}` : "";
    const text = items.map(i => (i.text ?? i.text_norm ?? "").trim()).filter(Boolean).join(" / ");
    lines.push("", `[${lang}] ${title || "—"}${firstRef}`, `«${text}»`);
  }
  return lines.join("\n");
}

/** Button that copies a formatted multi-language citation. */
function makeCitationBtn(hit: QueryHit): HTMLButtonElement {
  const btn = elt("button", {
    class: "card-action-btn",
    title: "Copier la citation complète (pivot + alignements)",
    type: "button",
  }, "📄 Citation") as HTMLButtonElement;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    void navigator.clipboard?.writeText(buildCitationText(hit)).then(() => {
      btn.textContent = "✓ Copié";
      btn.classList.add("copied");
      setTimeout(() => { btn.textContent = "📄 Citation"; btn.classList.remove("copied"); }, 1500);
    });
  });
  return btn;
}

/** Compact "filter on this document" quick action button. */
function makeFilterDocBtn(docId: number, docTitle: string): HTMLButtonElement {
  const label = docTitle ? `Ce doc (${docTitle.slice(0, 20)}${docTitle.length > 20 ? "…" : ""})` : `Doc #${docId}`;
  const btn = elt("button", { class: "card-action-btn", title: `Chercher dans ce document : ${docTitle || `#${docId}`}`, type: "button" }, `🔍 ${label}`) as HTMLButtonElement;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    _filterDocFn?.(docId);
  });
  return btn;
}

// ─── Card renderers ───────────────────────────────────────────────────────────

export function renderAlignedBlock(hit: QueryHit): HTMLElement {
  const block = elt("div", { class: "aligned-block" });
  const aligned = Array.isArray(hit.aligned) ? hit.aligned : [];
  if (aligned.length === 0) {
    block.appendChild(elt("div", { class: "aligned-empty" }, "Aucun alignement"));
    return block;
  }

  const groups = new Map<string, typeof aligned>();
  for (const item of aligned) {
    const key = `${item.doc_id}|${item.language}|${item.title}`;
    const current = groups.get(key);
    if (current) {
      current.push(item);
    } else {
      groups.set(key, [item]);
    }
  }

  for (const [key, items] of groups.entries()) {
    const [docId, language, title] = key.split("|");
    const card = elt("div", { class: "aligned-group" });
    card.appendChild(
      elt(
        "div",
        { class: "aligned-group-header" },
        `${language || "und"} · ${title || "(sans titre)"} · doc ${docId}`
      )
    );
    for (const item of items) {
      const row = elt("div", { class: "aligned-line" });
      if (item.external_id != null) {
        row.appendChild(elt("span", { class: "aligned-ref" }, `[${item.external_id}]`));
      }
      const text = item.text ?? item.text_norm ?? "";
      row.appendChild(elt("span", {}, text));
      card.appendChild(row);
    }
    block.appendChild(card);
  }
  return block;
}

export function renderParallelHit(hit: QueryHit, mode: "segment" | "kwic"): HTMLElement {
  const card = elt("div", { class: "parallel-card", "data-unit-id": String(hit.unit_id) });

  // ── Pivot column ──
  const pivotCol = elt("div", { class: "parallel-pivot" });
  const meta = elt("div", { class: "result-meta" });
  const titleSpan = elt("span", { class: "doc-title" }, hit.title || "");
  meta.appendChild(titleSpan);
  if (hit.language) meta.appendChild(document.createTextNode(` · ${hit.language}`));
  if (hit.external_id != null) meta.appendChild(document.createTextNode(` · §${hit.external_id}`));
  const pMetaBtn = elt("button", { class: "hit-meta-btn", title: "Métadonnées du document", type: "button" }, "ⓘ");
  pMetaBtn.addEventListener("click", (e) => { e.stopPropagation(); _openMetaFn?.(hit); });
  meta.appendChild(pMetaBtn);
  pivotCol.appendChild(meta);

  // Pivot text: KWIC flex layout if in kwic mode (avoids nested CSS grid issues),
  // full highlighted text in segment mode.
  if (mode === "kwic" && (hit.left !== undefined || hit.match !== undefined)) {
    const kwicRow = elt("div", { class: "parallel-kwic" });
    kwicRow.appendChild(elt("span", { class: "parallel-kwic-left" }, hit.left ?? ""));
    kwicRow.appendChild(elt("span", { class: "parallel-kwic-match" }, hit.match ?? ""));
    kwicRow.appendChild(elt("span", { class: "parallel-kwic-right" }, hit.right ?? ""));
    pivotCol.appendChild(kwicRow);
  } else {
    const textDiv = elt("div", { class: "result-text" });
    let raw: string;
    if (hit.text) {
      raw = hit.text;
    } else if (hit.text_norm) {
      raw = hit.text_norm;
      if (hit.match) {
        const escaped = hit.match.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        raw = raw.replace(new RegExp(`(${escaped})`, "gi"), "<<$1>>");
      }
    } else {
      raw = [hit.left ?? "", hit.match ?? "", hit.right ?? ""].filter(Boolean).join(" ");
    }
    textDiv.innerHTML = escapeHtml(raw)
      .replace(/&lt;&lt;(.*?)&gt;&gt;/g, '<span class="highlight">$1</span>');
    pivotCol.appendChild(textDiv);
  }

  // Quick actions on parallel card pivot
  const pActions = elt("div", { class: "card-actions" });
  const pText = hitPlainText(hit);
  if (pText) pActions.appendChild(makeCopyBtn(pText));
  if (_filterDocFn) pActions.appendChild(makeFilterDocBtn(hit.doc_id, hit.title ?? ""));
  // Citation button added after aligned column is built (see below)
  pivotCol.appendChild(pActions);

  card.appendChild(pivotCol);

  // ── Aligned column ──
  const alignedCol = elt("div", { class: "parallel-aligned" });
  const aligned = Array.isArray(hit.aligned) ? hit.aligned : [];

  if (aligned.length === 0) {
    alignedCol.appendChild(elt("div", { class: "parallel-empty" }, "Aucun alignement"));
  } else {
    alignedCol.appendChild(elt("div", { class: "parallel-aligned-header" }, "Traductions alignées"));
    const groups = new Map<string, typeof aligned>();
    for (const item of aligned) {
      const key = `${item.language ?? "und"}|${item.doc_id}|${item.title ?? ""}`;
      const cur = groups.get(key);
      if (cur) cur.push(item); else groups.set(key, [item]);
    }
    for (const [key, items] of groups.entries()) {
      const parts = key.split("|");
      const lang = parts[0];
      const title = parts.slice(2).join("|");
      const grp = elt("div", { class: "parallel-aligned-group" });
      const hdr = elt("div", { class: "parallel-lang-header" });
      const badge = elt("span", { class: "parallel-lang-badge" }, (lang ?? "?").toUpperCase());
      hdr.appendChild(badge);
      hdr.appendChild(document.createTextNode(` ${title || "(sans titre)"}`));
      const grpText = items.map(i => (i.text ?? i.text_norm ?? "").trim()).filter(Boolean).join("\n");
      hdr.appendChild(makeGroupCopyBtn(grpText, lang ?? "?"));
      grp.appendChild(hdr);
      const visible = items.slice(0, PARALLEL_COLLAPSE_N);
      const hidden = items.slice(PARALLEL_COLLAPSE_N);
      for (const item of visible) {
        const row = elt("div", { class: "parallel-line" });
        if (item.external_id != null) row.appendChild(elt("span", { class: "parallel-ref" }, `[${item.external_id}]`));
        row.appendChild(document.createTextNode(" " + (item.text ?? item.text_norm ?? "")));
        grp.appendChild(row);
      }
      if (hidden.length > 0) {
        const moreWrap = elt("div", {});
        const moreBtn = elt("button", { class: "parallel-more-btn" }, `Voir ${hidden.length} de plus…`) as HTMLButtonElement;
        moreBtn.addEventListener("click", () => {
          for (const item of hidden) {
            const row = elt("div", { class: "parallel-line" });
            if (item.external_id != null) row.appendChild(elt("span", { class: "parallel-ref" }, `[${item.external_id}]`));
            row.appendChild(document.createTextNode(" " + (item.text ?? item.text_norm ?? "")));
            grp.insertBefore(row, moreWrap);
          }
          moreWrap.remove();
        });
        moreWrap.appendChild(moreBtn);
        grp.appendChild(moreWrap);
      }
      alignedCol.appendChild(grp);
    }
  }
  card.appendChild(alignedCol);

  // Add citation button to pivot actions now that we know aligned is populated
  if (aligned.length > 0) pActions.appendChild(makeCitationBtn(hit));

  return card;
}

export function renderHit(hit: QueryHit, mode: "segment" | "kwic", showAligned: boolean): HTMLElement {
  if (showAligned && state.showParallel) {
    return renderParallelHit(hit, mode);
  }

  const card = elt("div", { class: "result-card", "data-unit-id": String(hit.unit_id) });

  const meta = elt("div", { class: "result-meta" });
  const titleSpan = elt("span", { class: "doc-title" }, hit.title || "");
  meta.appendChild(titleSpan);
  if (hit.language) meta.appendChild(document.createTextNode(` · ${hit.language}`));
  if (hit.external_id != null) meta.appendChild(document.createTextNode(` · §${hit.external_id}`));
  const metaBtn = elt("button", { class: "hit-meta-btn", title: "Métadonnées du document", type: "button" }, "ⓘ");
  metaBtn.addEventListener("click", (e) => { e.stopPropagation(); _openMetaFn?.(hit); });
  meta.appendChild(metaBtn);
  card.appendChild(meta);

  if (mode === "kwic" && hit.left !== undefined) {
    const row = elt("div", { class: "kwic-row" });
    row.appendChild(elt("span", { class: "kwic-left" }, hit.left ?? ""));
    row.appendChild(elt("span", { class: "kwic-match" }, hit.match ?? ""));
    row.appendChild(elt("span", { class: "kwic-right" }, hit.right ?? ""));
    card.appendChild(row);
  } else {
    const textDiv = elt("div", { class: "result-text" });
    const raw = hit.text ?? hit.text_norm ?? "";
    textDiv.innerHTML = escapeHtml(raw)
      .replace(/&lt;&lt;(.*?)&gt;&gt;/g, '<span class="highlight">$1</span>');
    card.appendChild(textDiv);
  }

  // ── Quick actions row ──
  const actions = elt("div", { class: "card-actions" });
  const plainText = hitPlainText(hit);
  if (plainText) actions.appendChild(makeCopyBtn(plainText));
  if (_filterDocFn) actions.appendChild(makeFilterDocBtn(hit.doc_id, hit.title ?? ""));
  card.appendChild(actions);

  if (showAligned) {
    const expanded = state.expandedAlignedUnitIds.has(hit.unit_id);
    const toggle = elt(
      "button",
      { class: "btn btn-secondary", type: "button" },
      expanded ? "Masquer traductions" : "Afficher traductions"
    ) as HTMLButtonElement;
    toggle.addEventListener("click", () => {
      if (state.expandedAlignedUnitIds.has(hit.unit_id)) {
        state.expandedAlignedUnitIds.delete(hit.unit_id);
      } else {
        state.expandedAlignedUnitIds.add(hit.unit_id);
      }
      // Trigger re-render via query module (lazy reference to avoid circular)
      _rerenderFn?.();
    });
    card.appendChild(toggle);
    if (expanded) {
      card.appendChild(renderAlignedBlock(hit));
    }
  }

  return card;
}

// ─── Re-render callback (breaks circular: results ↔ query) ───────────────────

let _rerenderFn: (() => void) | null = null;

/** Called once from app.ts: injects the renderResults function from query.ts. */
export function setRerenderCallback(fn: () => void): void {
  _rerenderFn = fn;
}

// Silence unused-import warning for AlignedUnit (used via type alias in csv export)
void (undefined as unknown as AlignedUnit);
