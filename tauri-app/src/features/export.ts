/**
 * features/export.ts — Export serializers and _exportHits orchestration.
 */

import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import type { QueryHit, AlignedUnit } from "../lib/sidecarClient";
import { state } from "../state";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ExportFormat = "jsonl-simple" | "jsonl-parallel" | "csv-flat" | "csv-long";

// ─── Serializers ──────────────────────────────────────────────────────────────

function escCsv(val: string | number | null | undefined): string {
  const s = val == null ? "" : String(val);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toJsonlSimple(hits: QueryHit[]): string {
  return hits.map(h => JSON.stringify(h)).join("\n");
}

function toJsonlParallel(hits: QueryHit[]): string {
  return hits.map(h => JSON.stringify({
    pivot: {
      doc_id: h.doc_id, title: h.title, language: h.language,
      unit_id: h.unit_id, external_id: h.external_id,
      text: h.text, left: h.left, match: h.match, right: h.right,
    },
    aligned: (h.aligned ?? []).map(a => ({
      doc_id: a.doc_id, title: a.title, language: a.language,
      unit_id: a.unit_id, external_id: a.external_id,
      text: a.text ?? a.text_norm,
    })),
  })).join("\n");
}

function toCsvFlat(hits: QueryHit[]): string {
  const maxAl = hits.reduce((m, h) => Math.max(m, (h.aligned ?? []).length), 0);
  const header = ["doc_id", "title", "language", "unit_id", "external_id",
    "text", "left", "match", "right"];
  for (let i = 1; i <= maxAl; i++) {
    header.push(`al${i}_lang`, `al${i}_title`, `al${i}_unit_id`, `al${i}_ext_id`, `al${i}_text`);
  }
  const rows = hits.map(h => {
    const r: (string | number | null)[] = [
      h.doc_id, h.title, h.language, h.unit_id, h.external_id ?? "",
      h.text ?? "", h.left ?? "", h.match ?? "", h.right ?? "",
    ];
    const al = h.aligned ?? [];
    for (let i = 0; i < maxAl; i++) {
      const a = al[i];
      r.push(a?.language ?? "", a?.title ?? "", a?.unit_id ?? "", a?.external_id ?? "",
        a?.text ?? (a as AlignedUnit | undefined)?.text_norm ?? "");
    }
    return r.map(v => escCsv(v)).join(",");
  });
  return [header.join(","), ...rows].join("\r\n");
}

function toCsvLong(hits: QueryHit[]): string {
  const header = [
    "pivot_doc_id", "pivot_title", "pivot_lang", "pivot_unit_id", "pivot_ext_id",
    "pivot_text", "pivot_left", "pivot_match", "pivot_right",
    "al_doc_id", "al_title", "al_lang", "al_unit_id", "al_ext_id", "al_text",
  ];
  const rows: string[] = [];
  for (const h of hits) {
    const pCells: (string | number | null)[] = [
      h.doc_id, h.title, h.language, h.unit_id, h.external_id ?? "",
      h.text ?? "", h.left ?? "", h.match ?? "", h.right ?? "",
    ];
    const al = h.aligned ?? [];
    if (al.length === 0) {
      rows.push([...pCells, "", "", "", "", "", ""].map(v => escCsv(v)).join(","));
    } else {
      for (const a of al) {
        rows.push([
          ...pCells,
          a.doc_id, a.title, a.language, a.unit_id, a.external_id ?? "",
          a.text ?? (a as AlignedUnit).text_norm ?? "",
        ].map(v => escCsv(v)).join(","));
      }
    }
  }
  return [header.join(","), ...rows].join("\r\n");
}

// ─── Export orchestration ─────────────────────────────────────────────────────

export async function exportHits(format: ExportFormat): Promise<void> {
  if (state.hits.length === 0) return;

  if (state.hasMore) {
    const totalLabel = typeof state.total === "number" ? ` (${state.total} au total)` : "";
    const proceed = window.confirm(
      `Attention : l'export portera sur ${state.hits.length} résultat(s) actuellement chargé(s)${totalLabel}, ` +
      `pas nécessairement sur l'ensemble des résultats disponibles.\n\n` +
      `Utilisez le bouton "Charger plus" ou faites défiler jusqu'en bas pour en charger davantage avant d'exporter.\n\n` +
      `Continuer l'export partiel ?`
    );
    if (!proceed) return;
  }

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const modeStr = state.showAligned ? (state.showParallel ? "parallel" : "aligned") : "simple";

  let content: string;
  let ext: string;
  let label: string;

  switch (format) {
    case "jsonl-simple":
      content = toJsonlSimple(state.hits); ext = "jsonl"; label = "simple"; break;
    case "jsonl-parallel":
      content = toJsonlParallel(state.hits); ext = "jsonl"; label = "parallel"; break;
    case "csv-flat":
      content = toCsvFlat(state.hits); ext = "csv"; label = "flat"; break;
    case "csv-long":
      content = toCsvLong(state.hits); ext = "csv"; label = "long"; break;
  }

  let outPath: string | null;
  try {
    outPath = await saveDialog({
      title: "Exporter les résultats",
      defaultPath: `agrafes_export_${modeStr}_${label}_${dateStr}.${ext}`,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
  } catch { return; }
  if (!outPath) return;

  try {
    await writeTextFile(outPath, content);
    // Use Blob.size for byte count — avoids re-encoding the full content string
    const bytes = new Blob([content]).size;
    const nbAligned = state.hits.reduce((s, h) => s + (h.aligned?.length ?? 0), 0);
    const isPartial = state.hasMore || (typeof state.total === "number" && state.hits.length < state.total);
    const partialLabel = isPartial
      ? ` (${state.hits.length}/${state.total ?? "?"} chargés — export partiel)`
      : ` (complet)`;
    const statusEl = document.getElementById("status-msg");
    if (statusEl) {
      const prev = statusEl.textContent;
      const recap = `✓ Export${partialLabel} · ${nbAligned > 0 ? `${nbAligned} alignés · ` : ""}${(bytes / 1024).toFixed(1)} KB → ${outPath.split(/[/\\]/).pop()}`;
      statusEl.textContent = recap;
      setTimeout(() => { if (statusEl.textContent?.startsWith("✓")) statusEl.textContent = prev; }, 6000);
    }
  } catch (err) {
    console.error("[export] error:", err);
  }
}
