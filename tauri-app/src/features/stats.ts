/**
 * features/stats.ts — Lexical statistics panel for the concordancer.
 *
 * Two modes:
 *   Simple  — frequency list for one sub-corpus slot.
 *   Compare — side-by-side A/B comparison of two slots.
 *
 * Each slot is defined by optional filters: doc_ids, language, doc_role,
 * resource_type, family_id, top_n.
 *
 * Inspired by HIMYC-Tauri's concordancierModule stats panel.
 */

import { state } from "../state";
import { elt } from "../ui/dom";
import {
  fetchLexicalStats, fetchStatsCompare,
  type StatsSlot, type StatsResult, type StatsCompareResult, type StatsWord, type StatsCompareWord,
} from "../lib/sidecarClient";

// ─── Panel state ──────────────────────────────────────────────────────────────

let _compareMode = false;
let _lastResult: StatsResult | null = null;
let _lastCompare: StatsCompareResult | null = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _readSlot(prefix: string): StatsSlot {
  const docIdsRaw = (document.getElementById(`stats-${prefix}-doc-ids`) as HTMLInputElement | null)?.value.trim();
  const docIds = docIdsRaw
    ? docIdsRaw.split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))
    : null;

  const language = (document.getElementById(`stats-${prefix}-lang`) as HTMLSelectElement | null)?.value || null;
  const docRole = (document.getElementById(`stats-${prefix}-role`) as HTMLSelectElement | null)?.value || null;
  const resourceType = (document.getElementById(`stats-${prefix}-restype`) as HTMLSelectElement | null)?.value || null;
  const familyIdRaw = (document.getElementById(`stats-${prefix}-family`) as HTMLSelectElement | null)?.value;
  const familyId = familyIdRaw ? parseInt(familyIdRaw, 10) : null;
  const topN = parseInt((document.getElementById("stats-top-n") as HTMLInputElement | null)?.value ?? "50", 10);

  return {
    doc_ids: docIds && docIds.length > 0 ? docIds : null,
    language,
    doc_role: docRole,
    resource_type: resourceType,
    family_id: isNaN(familyId as number) ? null : familyId,
    top_n: Math.max(5, Math.min(500, topN || 50)),
  };
}

function _readLabel(prefix: string): string {
  return (document.getElementById(`stats-${prefix}-label`) as HTMLInputElement | null)?.value.trim() || (prefix === "a" ? "Corpus A" : "Corpus B");
}

function _escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function _barHtml(pct: number, cls = "stats-bar-a"): string {
  const w = Math.min(100, pct * 5).toFixed(1); // scale: 20% = full bar
  return `<span class="stats-bar-wrap"><span class="${cls}" style="width:${w}%"></span></span>`;
}

// ─── Populate filter selects ──────────────────────────────────────────────────

export function populateStatsSelects(): void {
  ["a", "b"].forEach(prefix => {
    const langSel = document.getElementById(`stats-${prefix}-lang`) as HTMLSelectElement | null;
    const roleSel = document.getElementById(`stats-${prefix}-role`) as HTMLSelectElement | null;
    const restypeSel = document.getElementById(`stats-${prefix}-restype`) as HTMLSelectElement | null;
    const famSel = document.getElementById(`stats-${prefix}-family`) as HTMLSelectElement | null;

    if (langSel) {
      const langs = [...new Set(state.docs.map(d => d.language).filter(Boolean))].sort();
      langSel.innerHTML = `<option value="">Toutes</option>` +
        langs.map(l => `<option value="${_escHtml(l)}">${_escHtml(l)}</option>`).join("");
    }
    if (roleSel) {
      const roles = [...new Set(state.docs.map(d => d.doc_role).filter(Boolean) as string[])].sort();
      roleSel.innerHTML = `<option value="">Tous</option>` +
        roles.map(r => `<option value="${_escHtml(r)}">${_escHtml(r)}</option>`).join("");
    }
    if (restypeSel) {
      const types = [...new Set(state.docs.map(d => d.resource_type).filter(Boolean) as string[])].sort();
      restypeSel.innerHTML = `<option value="">Tous</option>` +
        types.map(t => `<option value="${_escHtml(t)}">${_escHtml(t)}</option>`).join("");
    }
    if (famSel) {
      famSel.innerHTML = `<option value="">Toutes familles</option>` +
        state.families.map(f => {
          const label = f.parent?.title ?? `Famille #${f.family_id}`;
          return `<option value="${f.family_id}">${_escHtml(label)}</option>`;
        }).join("");
    }
  });
}

// ─── Slot B visibility ────────────────────────────────────────────────────────

function _updateCompareModeUI(): void {
  const slotB = document.getElementById("stats-slot-b");
  const compareCb = document.getElementById("stats-compare-cb") as HTMLInputElement | null;
  _compareMode = compareCb?.checked ?? false;
  if (slotB) slotB.style.display = _compareMode ? "" : "none";
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function _renderKpiCards(r: StatsResult): string {
  const kpis = [
    { label: "Tokens total", value: r.total_tokens.toLocaleString("fr-FR") },
    { label: "Vocabulaire", value: r.vocabulary_size.toLocaleString("fr-FR") },
    { label: "Unités", value: r.total_units.toLocaleString("fr-FR") },
    { label: "Documents", value: r.total_docs.toLocaleString("fr-FR") },
    { label: "Moy. tokens/unité", value: r.avg_tokens_per_unit.toFixed(1) },
  ];
  return `<div class="stats-kpi-row">${kpis.map(k =>
    `<div class="stats-kpi-card"><div class="stats-kpi-value">${k.value}</div><div class="stats-kpi-label">${k.label}</div></div>`
  ).join("")}</div>`;
}

function _renderWordTable(words: StatsWord[], title: string, exportId: string): string {
  const rows = words.map(w =>
    `<tr>
      <td class="stats-word">${_escHtml(w.word)}</td>
      <td class="stats-count">${w.count}</td>
      <td class="stats-pct">${w.freq_pct.toFixed(3)}&nbsp;%</td>
      <td class="stats-bar-cell">${_barHtml(w.freq_pct)}</td>
    </tr>`
  ).join("");
  return `
    <div class="stats-table-head">
      <strong>${title}</strong>
      <button class="stats-export-btn" data-export="${exportId}" type="button">⬇ CSV</button>
    </div>
    <div class="stats-table-wrap">
      <table class="stats-table">
        <thead><tr><th>Mot</th><th>Occurrences</th><th>Fréquence</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function _renderSingleStats(r: StatsResult): string {
  const label = r.label ? `<h3 class="stats-section-title">${_escHtml(r.label)}</h3>` : "";
  return label
    + _renderKpiCards(r)
    + _renderWordTable(r.top_words, `Top ${r.top_words.length} mots les plus fréquents`, "top")
    + _renderWordTable(r.rare_words, `Top ${r.rare_words.length} mots les plus rares`, "rare");
}

function _renderCompareStats(r: StatsCompareResult): string {
  const summaryHtml = `
    <div class="stats-compare-summaries">
      <div class="stats-compare-col stats-compare-a">
        <div class="stats-compare-col-head">${_escHtml(r.label_a)}</div>
        ${_renderKpiCards(r.summary_a)}
      </div>
      <div class="stats-compare-col stats-compare-b">
        <div class="stats-compare-col-head">${_escHtml(r.label_b)}</div>
        ${_renderKpiCards(r.summary_b)}
      </div>
    </div>`;

  const rows = r.comparison.map(w => {
    const ratioDisplay = w.ratio === null ? "∞" : w.ratio === 0 ? "—" : w.ratio.toFixed(2);
    const ratioClass = w.ratio === null ? "stats-ratio-inf" : (w.ratio ?? 0) >= 1 ? "stats-ratio-a" : "stats-ratio-b";
    return `<tr>
      <td class="stats-word">${_escHtml(w.word)}</td>
      <td class="stats-count">${w.count_a}</td>
      <td class="stats-pct">${w.freq_a.toFixed(3)}&nbsp;%</td>
      <td class="stats-bar-cell">${_barHtml(w.freq_a, "stats-bar-a")}</td>
      <td class="stats-count">${w.count_b}</td>
      <td class="stats-pct">${w.freq_b.toFixed(3)}&nbsp;%</td>
      <td class="stats-bar-cell">${_barHtml(w.freq_b, "stats-bar-b")}</td>
      <td class="stats-ratio ${ratioClass}">${ratioDisplay}</td>
    </tr>`;
  }).join("");

  const compareTable = `
    <div class="stats-table-head">
      <strong>Comparaison (${r.comparison.length} mots)</strong>
      <button class="stats-export-btn" data-export="compare" type="button">⬇ CSV</button>
    </div>
    <div class="stats-table-wrap">
      <table class="stats-table stats-compare-table">
        <thead>
          <tr>
            <th rowspan="2">Mot</th>
            <th colspan="3" class="stats-col-head-a">${_escHtml(r.label_a)}</th>
            <th colspan="3" class="stats-col-head-b">${_escHtml(r.label_b)}</th>
            <th rowspan="2">Ratio</th>
          </tr>
          <tr>
            <th>N</th><th>Freq.&nbsp;%</th><th></th>
            <th>N</th><th>Freq.&nbsp;%</th><th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  return summaryHtml + compareTable;
}

// ─── CSV export ───────────────────────────────────────────────────────────────

function _exportCsv(data: string, filename: string): void {
  const blob = new Blob([data], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function _handleExport(exportType: string): void {
  if (!_compareMode && _lastResult) {
    const r = _lastResult;
    if (exportType === "top") {
      const csv = "mot,occurrences,freq_pct\n" + r.top_words.map(w => `${w.word},${w.count},${w.freq_pct}`).join("\n");
      _exportCsv(csv, `stats_top_${r.label || "corpus"}.csv`);
    } else if (exportType === "rare") {
      const csv = "mot,occurrences,freq_pct\n" + r.rare_words.map(w => `${w.word},${w.count},${w.freq_pct}`).join("\n");
      _exportCsv(csv, `stats_rare_${r.label || "corpus"}.csv`);
    }
  } else if (_compareMode && _lastCompare) {
    const r = _lastCompare;
    const csv = `mot,n_${r.label_a},freq_${r.label_a},n_${r.label_b},freq_${r.label_b},ratio\n` +
      r.comparison.map(w => `${w.word},${w.count_a},${w.freq_a},${w.count_b},${w.freq_b},${w.ratio ?? ""}`).join("\n");
    _exportCsv(csv, `stats_compare_${r.label_a}_${r.label_b}.csv`);
  }
}

// ─── Main run function ────────────────────────────────────────────────────────

export async function runStats(): Promise<void> {
  if (!state.conn) return;

  const resultArea = document.getElementById("stats-results");
  if (!resultArea) return;
  resultArea.innerHTML = `<div class="stats-loading">Calcul en cours…</div>`;

  const runBtn = document.getElementById("stats-run-btn") as HTMLButtonElement | null;
  if (runBtn) runBtn.disabled = true;

  try {
    if (_compareMode) {
      const slotA = _readSlot("a");
      const slotB = _readSlot("b");
      const labelA = _readLabel("a");
      const labelB = _readLabel("b");
      const result = await fetchStatsCompare(state.conn, slotA, slotB, labelA, labelB);
      _lastCompare = result;
      _lastResult = null;
      resultArea.innerHTML = _renderCompareStats(result);
    } else {
      const slotA = _readSlot("a");
      const labelA = _readLabel("a");
      const result = await fetchLexicalStats(state.conn, slotA, labelA);
      _lastResult = result;
      _lastCompare = null;
      resultArea.innerHTML = _renderSingleStats(result);
    }

    // Wire export buttons
    resultArea.querySelectorAll<HTMLButtonElement>(".stats-export-btn").forEach(btn => {
      btn.addEventListener("click", () => _handleExport(btn.dataset.export ?? ""));
    });
  } catch (err) {
    resultArea.innerHTML = `<div class="stats-error">Erreur : ${_escHtml(err instanceof Error ? err.message : String(err))}</div>`;
  } finally {
    if (runBtn) runBtn.disabled = false;
  }
}

// ─── Panel builder ────────────────────────────────────────────────────────────

export function buildStatsPanel(): HTMLElement {
  const panel = elt("div", { class: "stats-panel hidden", id: "stats-panel" });

  const buildSlotGroup = (prefix: string, heading: string, extraClass = ""): HTMLElement => {
    const grp = elt("div", { class: `stats-slot-group ${extraClass}`, id: `stats-slot-${prefix}` });
    if (heading) grp.appendChild(elt("div", { class: "stats-slot-heading" }, heading));

    // Label
    const labelRow = elt("div", { class: "stats-filter-row" });
    labelRow.appendChild(elt("label", { class: "stats-filter-label", for: `stats-${prefix}-label` }, "Étiquette"));
    labelRow.appendChild(elt("input", { type: "text", class: "stats-filter-input", id: `stats-${prefix}-label`, placeholder: prefix === "a" ? "Corpus A" : "Corpus B" }));
    grp.appendChild(labelRow);

    // Language
    const langRow = elt("div", { class: "stats-filter-row" });
    langRow.appendChild(elt("label", { class: "stats-filter-label", for: `stats-${prefix}-lang` }, "Langue"));
    langRow.appendChild(elt("select", { class: "stats-filter-select", id: `stats-${prefix}-lang` }));
    grp.appendChild(langRow);

    // Role
    const roleRow = elt("div", { class: "stats-filter-row" });
    roleRow.appendChild(elt("label", { class: "stats-filter-label", for: `stats-${prefix}-role` }, "Rôle"));
    roleRow.appendChild(elt("select", { class: "stats-filter-select", id: `stats-${prefix}-role` }));
    grp.appendChild(roleRow);

    // Resource type
    const restypeRow = elt("div", { class: "stats-filter-row" });
    restypeRow.appendChild(elt("label", { class: "stats-filter-label", for: `stats-${prefix}-restype` }, "Type"));
    restypeRow.appendChild(elt("select", { class: "stats-filter-select", id: `stats-${prefix}-restype` }));
    grp.appendChild(restypeRow);

    // Family
    const famRow = elt("div", { class: "stats-filter-row" });
    famRow.appendChild(elt("label", { class: "stats-filter-label", for: `stats-${prefix}-family` }, "Famille"));
    famRow.appendChild(elt("select", { class: "stats-filter-select", id: `stats-${prefix}-family` }));
    grp.appendChild(famRow);

    // Doc IDs (manual)
    const docRow = elt("div", { class: "stats-filter-row" });
    docRow.appendChild(elt("label", { class: "stats-filter-label", for: `stats-${prefix}-doc-ids` }, "Doc IDs"));
    const docInput = elt("input", {
      type: "text",
      class: "stats-filter-input",
      id: `stats-${prefix}-doc-ids`,
      placeholder: "ex : 1,3,7",
      title: "IDs de documents séparés par des virgules (optionnel)",
    }) as HTMLInputElement;
    docRow.appendChild(docInput);
    grp.appendChild(docRow);

    return grp;
  };

  // Header with close button
  const header = elt("div", { class: "stats-panel-header" });
  header.appendChild(elt("span", { class: "stats-panel-title" }, "📊 Statistiques lexicales"));
  const closeBtn = elt("button", { class: "stats-close-btn", type: "button", title: "Fermer" }, "✕") as HTMLButtonElement;
  closeBtn.addEventListener("click", () => toggleStatsPanel(false));
  header.appendChild(closeBtn);
  panel.appendChild(header);

  // Controls row
  const controls = elt("div", { class: "stats-controls" });

  // Top N
  const topNRow = elt("div", { class: "stats-filter-row" });
  topNRow.appendChild(elt("label", { class: "stats-filter-label", for: "stats-top-n" }, "Top N"));
  const topNInput = elt("input", { type: "number", class: "stats-topn-input", id: "stats-top-n", value: "50", min: "5", max: "500" }) as HTMLInputElement;
  topNRow.appendChild(topNInput);
  controls.appendChild(topNRow);

  // Compare checkbox
  const compareRow = elt("div", { class: "stats-compare-row" });
  const compareCb = elt("input", { type: "checkbox", id: "stats-compare-cb" }) as HTMLInputElement;
  compareCb.addEventListener("change", _updateCompareModeUI);
  compareRow.appendChild(compareCb);
  compareRow.appendChild(elt("label", { for: "stats-compare-cb" }, "Mode Comparer A/B"));
  controls.appendChild(compareRow);

  // Run button
  const runBtn = elt("button", { class: "btn btn-primary stats-run-btn", id: "stats-run-btn", type: "button" }, "▶ Calculer") as HTMLButtonElement;
  runBtn.addEventListener("click", () => void runStats());
  controls.appendChild(runBtn);

  panel.appendChild(controls);

  // Slot A
  panel.appendChild(buildSlotGroup("a", ""));

  // Slot B (hidden by default)
  const slotB = buildSlotGroup("b", "Corpus B", "stats-slot-b-group");
  slotB.id = "stats-slot-b";
  slotB.style.display = "none";
  panel.appendChild(slotB);

  // Results area
  const resultsArea = elt("div", { class: "stats-results", id: "stats-results" });
  resultsArea.innerHTML = `<p class="stats-empty">Configurez les filtres et cliquez sur <strong>Calculer</strong>.</p>`;
  panel.appendChild(resultsArea);

  return panel;
}

// ─── Toggle ───────────────────────────────────────────────────────────────────

export function toggleStatsPanel(forceOpen?: boolean): void {
  const panel = document.getElementById("stats-panel");
  const btn = document.getElementById("stats-btn");
  if (!panel) return;

  const isOpen = !panel.classList.contains("hidden");
  const shouldOpen = forceOpen !== undefined ? forceOpen : !isOpen;

  if (shouldOpen) {
    panel.classList.remove("hidden");
    btn?.classList.add("active");
    populateStatsSelects();
  } else {
    panel.classList.add("hidden");
    btn?.classList.remove("active");
  }
}
