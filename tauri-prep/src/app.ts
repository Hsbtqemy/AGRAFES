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
import { JobCenter, JOB_CENTER_CSS, showToast } from "./components/JobCenter.ts";

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

// ─── CSS ─────────────────────────────────────────────────────────────────────

const CSS = `
  :root {
    --color-bg: #f0f2f5;
    --color-surface: #ffffff;
    --color-surface-alt: #f8f9fa;
    --color-border: #dde1e8;
    --color-primary: #0f766e;
    --color-primary-hover: #0c4a46;
    --color-secondary: #6c757d;
    --color-warning: #b8590a;
    --color-danger: #c0392b;
    --color-ok: #1a7f4e;
    --color-text: #1a1a2e;
    --color-muted: #6c757d;
    --radius: 10px;
    --radius-pill: 999px;
    --shadow: 0 1px 3px rgba(0,0,0,0.08);
    --shadow-soft: 0 8px 22px rgba(15, 118, 110, 0.08);
  }

  *, *::before, *::after { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: var(--color-bg); color: var(--color-text); font-size: 14px; }

  /* Topbar */
  .topbar { background: linear-gradient(135deg, #0c4a46, var(--color-primary)); color: #fff; padding: 0 1rem;
    display: flex; align-items: center; height: 52px; gap: 0.75rem; border-bottom: 1px solid #0c4a46; }
  .topbar-title { font-size: 1rem; font-weight: 600; flex: 1; }
  .topbar-dbpath { font-size: 11px; opacity: 0.75; max-width: 280px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .topbar-db-btn {
    background: rgba(255,255,255,0.13);
    border: 1px solid rgba(255,255,255,0.25);
    border-radius: 999px;
    color: rgba(255,255,255,0.9);
    font-size: 0.76rem;
    padding: 4px 10px;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.13s;
  }
  .topbar-db-btn:hover { background: rgba(255,255,255,0.22); }
  /* ── Presets modal ─────────────────────────────────────────────────────── */
  .presets-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.4);
    display: flex; align-items: center; justify-content: center; z-index: 9000;
  }
  .presets-modal {
    background: #fff; border-radius: 8px; width: min(640px, 95vw);
    max-height: 80vh; display: flex; flex-direction: column;
    box-shadow: 0 8px 32px rgba(0,0,0,0.22);
  }
  .presets-modal-head {
    padding: 0.9rem 1.1rem 0.7rem; border-bottom: 1px solid #dee2e6;
    display: flex; align-items: center; gap: 0.5rem;
  }
  .presets-modal-head h3 { margin: 0; font-size: 1rem; flex: 1; }
  .presets-modal-body { overflow-y: auto; flex: 1; padding: 0.75rem 1.1rem; }
  .presets-modal-foot {
    padding: 0.6rem 1.1rem; border-top: 1px solid #dee2e6;
    display: flex; gap: 0.5rem; justify-content: flex-end; flex-wrap: wrap;
  }
  .preset-row {
    display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.6rem;
    border: 1px solid #dee2e6; border-radius: 6px; margin-bottom: 0.4rem;
    background: #f8f9fa;
  }
  .preset-row:hover { background: #edf7f5; }
  .preset-name { font-weight: 600; font-size: 0.88rem; flex: 1; }
  .preset-desc { font-size: 0.78rem; color: #6c757d; display: block; }
  .preset-chips { display: flex; gap: 0.25rem; flex-wrap: wrap; margin-top: 0.2rem; }
  .preset-chip {
    background: #e8f5f3; color: #0c4a46; border-radius: 99px;
    padding: 0.05rem 0.45rem; font-size: 0.72rem; font-weight: 500;
  }
  .presets-empty { color: #6c757d; font-style: italic; padding: 1rem 0; }

  /* DB init error banner in prep */
  .prep-init-error {
    position: sticky;
    top: 0;
    background: #fff3cd;
    border-bottom: 2px solid #e6a817;
    padding: 8px 16px;
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    font-size: 0.83rem;
    z-index: 100;
  }
  .prep-init-error-detail { font-family: monospace; font-size: 0.77rem; color: #555; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

  /* Tab bar */
  .tabbar {
    background: var(--color-surface);
    border-bottom: 1px solid var(--color-border);
    display: flex;
    gap: 8px;
    padding: 8px 14px;
    flex-wrap: wrap;
  }
  .tab-btn {
    padding: 7px 12px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-pill);
    background: var(--color-surface-alt);
    cursor: pointer;
    font-size: 0.86rem;
    color: var(--color-muted);
    transition: color 0.15s, border-color 0.15s, background 0.15s;
  }
  .tab-btn:hover {
    color: var(--color-text);
    border-color: #c6d7d4;
    background: #f3f8f7;
  }
  .tab-btn.active {
    color: #0c4a46;
    border-color: #9fd3cc;
    background: #e8f5f3;
    font-weight: 700;
  }

  /* Content area */
  .content { padding: 1rem 1.1rem 1.25rem; max-width: 1380px; margin: 0 auto; }
  .screen { display: none; }
  .screen.active { display: block; }
  .screen-title { font-size: 1.15rem; font-weight: 700; margin: 0 0 1rem; letter-spacing: -0.01em; }

  /* Card */
  .card { background: var(--color-surface); border-radius: var(--radius);
    border: 1px solid var(--color-border); box-shadow: var(--shadow);
    padding: 1rem; margin-bottom: 1rem; position: relative; }
  .card:hover { box-shadow: var(--shadow-soft); }
  .card h3 { margin: 0 0 0.75rem; font-size: 0.95rem; font-weight: 700; }

  /* Buttons */
  .btn { padding: 0.35rem 0.9rem; border: none; border-radius: var(--radius);
    cursor: pointer; font-size: 0.85rem; font-weight: 500; transition: background 0.15s; }
  .btn:disabled { opacity: 0.45; cursor: not-allowed; }
  .btn-primary { background: var(--color-primary); color: #fff; }
  .btn-primary:hover:not(:disabled) { background: var(--color-primary-hover); }
  .btn-secondary { background: #e9ecef; color: var(--color-text); }
  .btn-secondary:hover:not(:disabled) { background: #d0d4db; }
  .btn-warning { background: var(--color-warning); color: #fff; }
  .btn-warning:hover:not(:disabled) { background: #9b4a08; }
  .btn-danger { background: var(--color-danger); color: #fff; }
  .btn-danger:hover:not(:disabled) { background: #a93226; }
  .btn-sm { padding: 0.2rem 0.55rem; font-size: 0.78rem; }
  .btn-row { display: flex; gap: 0.5rem; flex-wrap: wrap; }
  button:focus-visible,
  input:focus-visible,
  select:focus-visible,
  textarea:focus-visible,
  summary:focus-visible,
  [role="button"]:focus-visible {
    outline: 2px solid #1f6feb;
    outline-offset: 2px;
  }

  /* Status badges */
  .status-badge { display: inline-block; padding: 0.2rem 0.6rem; border-radius: 20px;
    font-size: 0.8rem; font-weight: 600; }
  .status-ok { background: #d4edda; color: var(--color-ok); }
  .status-error { background: #f8d7da; color: var(--color-danger); }
  .status-unknown { background: #e9ecef; color: var(--color-muted); }
  .wf-pill {
    display: inline-flex;
    align-items: center;
    padding: 0.08rem 0.45rem;
    border-radius: 999px;
    font-size: 0.72rem;
    font-weight: 600;
    line-height: 1.2;
  }
  .wf-draft { background: #e9ecef; color: #5f6770; }
  .wf-review { background: #fff3cd; color: #8a5a00; }
  .wf-validated { background: #d4edda; color: var(--color-ok); }
  .wf-meta { font-size: 0.72rem; color: var(--color-muted); }

  /* Log pane */
  .log-pane { background: #1a1a2e; color: #c8d6e5; font-family: monospace; font-size: 0.78rem;
    padding: 0.6rem 0.75rem; border-radius: var(--radius); height: 160px; overflow-y: auto; }
  .log-line { white-space: pre-wrap; line-height: 1.5; }
  .log-error { color: #ff7675; }

  /* Meta table */
  .meta-table { border-collapse: collapse; font-size: 0.82rem; width: 100%; margin-top: 0.5rem; }
  .meta-table th, .meta-table td { border: 1px solid var(--color-border); padding: 0.3rem 0.6rem; text-align: left; }
  .meta-table th { background: var(--color-bg); font-weight: 600; }

  /* Import list */
  .import-list { margin-top: 0.75rem; }
  .import-row { border: 1px solid var(--color-border); border-radius: var(--radius);
    padding: 0.5rem; margin-bottom: 0.4rem; background: var(--color-bg); }
  .import-row-pending { border-left: 4px solid var(--color-muted); }
  .import-row-importing { border-left: 4px solid var(--color-primary); }
  .import-row-done { border-left: 4px solid var(--color-ok); }
  .import-row-error { border-left: 4px solid var(--color-danger); }
  .import-row-info { display: flex; justify-content: space-between; margin-bottom: 0.3rem; }
  .import-row-name { font-weight: 500; max-width: 300px; overflow: hidden; text-overflow: ellipsis; }
  .import-row-status { font-size: 0.78rem; color: var(--color-muted); }
  .import-row-controls { display: flex; gap: 0.4rem; flex-wrap: wrap; align-items: center; }
  .import-row-controls select, .import-row-controls input[type=text] {
    font-size: 0.82rem; padding: 0.15rem 0.3rem; border: 1px solid var(--color-border);
    border-radius: 4px; }
  .import-defaults { display: flex; gap: 1rem; margin-top: 0.5rem; flex-wrap: wrap; }
  .import-defaults label { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.82rem; }
  .import-defaults select, .import-defaults input { font-size: 0.82rem; padding: 0.2rem; border: 1px solid var(--color-border); border-radius: 4px; }
  .import-defaults-actions { margin-top: 0.5rem; align-items: center; }
  .import-disclosure { margin-top: 0.5rem; }
  .import-disclosure > summary,
  .import-log-summary {
    cursor: pointer;
    font-size: 0.83rem;
    color: #3f576f;
    user-select: none;
    list-style: none;
  }
  .import-disclosure > summary::-webkit-details-marker,
  .import-log-summary::-webkit-details-marker {
    display: none;
  }
  .import-disclosure > summary::before,
  .import-log-summary::before {
    content: "▸";
    display: inline-block;
    margin-right: 0.35rem;
    transition: transform 0.14s ease;
  }
  .import-disclosure[open] > summary::before,
  details[open] > .import-log-summary::before {
    transform: rotate(90deg);
  }
  .import-log-card,
  .meta-log-card,
  .export-log-card {
    padding-top: 0.75rem;
  }
  .import-log-card .log-pane,
  .meta-log-card .log-pane,
  .export-log-card .log-pane {
    margin-top: 0.6rem;
  }

  /* Doc list */
  .doc-list { margin-top: 0.5rem; overflow-x: auto; }
  .meta-toolbar-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.7rem;
    flex-wrap: wrap;
    margin-bottom: 0.55rem;
  }
  .meta-bulk-disclosure > summary {
    cursor: pointer;
    font-size: 0.84rem;
    color: #3f576f;
  }
  .meta-layout {
    display: grid;
    grid-template-columns: minmax(260px, 0.9fr) minmax(360px, 1.6fr);
    gap: 1rem;
    align-items: start;
  }
  .meta-list-card,
  .meta-edit-card {
    min-width: 0;
  }
  .meta-doc-list {
    max-height: 460px;
    overflow-y: auto;
  }
  .meta-doc-row {
    padding: 0.4rem 0.55rem;
    cursor: pointer;
    border-bottom: 1px solid var(--color-border);
    border-radius: 6px;
    transition: background 0.12s ease;
  }
  .meta-doc-row:hover {
    background: #f5fbfa;
  }
  .meta-doc-row.is-active {
    background: #e7f4f2;
    border-bottom-color: #c8e6e1;
  }
  .meta-doc-title {
    font-weight: 600;
    font-size: 0.85rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta-doc-meta {
    font-size: 0.78rem;
    color: var(--color-muted);
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex-wrap: wrap;
    margin-top: 0.15rem;
  }
  .meta-preview {
    margin-top: 0.7rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: #fbfdfc;
    padding: 0.55rem 0.65rem;
  }
  .meta-preview-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.6rem;
    margin-bottom: 0.35rem;
  }
  .meta-preview-lines {
    max-height: 220px;
    overflow-y: auto;
    border: 1px solid #e7ecea;
    border-radius: 6px;
    background: #ffffff;
  }
  .meta-preview-line {
    padding: 0.32rem 0.45rem;
    font-size: 0.8rem;
    line-height: 1.45;
    border-bottom: 1px solid #eff3f1;
  }
  .meta-preview-line:last-child {
    border-bottom: 0;
  }
  .meta-preview-marker {
    color: #5a6470;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  }
  .export-legacy-toggle-card {
    background: #f8fbfa;
    border-style: dashed;
  }
  .exports-doc-tools {
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    gap: 0.35rem;
    min-width: 240px;
    padding-top: 1.35rem;
  }
  @media (max-width: 1080px) {
    .meta-layout {
      grid-template-columns: 1fr;
    }
  }

  /* Actions form */
  .actions-screen label { display: flex; flex-direction: column; gap: 0.2rem; margin-bottom: 0.5rem; font-size: 0.85rem; }
  .actions-screen select, .actions-screen input[type=text], .actions-screen input[type=number],
  .actions-screen textarea {
    font-size: 0.85rem; padding: 0.3rem 0.5rem; border: 1px solid var(--color-border);
    border-radius: var(--radius); width: 100%; max-width: 420px; }
  .actions-screen textarea { resize: vertical; }
  .runtime-state {
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    padding: 0.5rem 0.65rem;
    font-size: 0.84rem;
    line-height: 1.35;
    font-weight: 500;
  }
  .state-ok { background: #eaf7ef; border-color: #b6e0c5; color: #13653e; }
  .state-info { background: #eef3fb; border-color: #c9d7ee; color: #20446f; }
  .state-warn { background: #fff5e7; border-color: #f1d39f; color: #8d5500; }
  .state-error { background: #ffe9e9; border-color: #efb8b8; color: #9d2f2f; }

  /* Busy overlay */
  .busy-overlay { position: absolute; inset: 0; background: rgba(255,255,255,0.75);
    display: flex; align-items: center; justify-content: center; border-radius: var(--radius);
    z-index: 10; }
  .busy-spinner { font-size: 0.9rem; font-weight: 600; color: var(--color-primary); }

  /* Misc */
  .empty-hint { color: var(--color-muted); font-style: italic; font-size: 0.85rem; margin: 0; }
  .hint { font-size: 0.82rem; color: var(--color-muted); margin: 0 0 0.5rem; }
  .db-path { font-family: monospace; font-size: 0.82rem; word-break: break-all; color: var(--color-muted); margin: 0 0 0.5rem; }
  code { font-family: monospace; background: var(--color-bg); padding: 0 3px; border-radius: 3px; }

  /* Actions screen — form rows */
  .form-row { display: flex; gap: 1rem; flex-wrap: wrap; margin-bottom: 0.4rem; }
  .form-row label { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.85rem; }
  .form-row select, .form-row input[type=text], .form-row input[type=number] {
    font-size: 0.85rem; padding: 0.25rem 0.4rem; border: 1px solid var(--color-border);
    border-radius: var(--radius); }
  .actions-screen textarea {
    font-size: 0.85rem; padding: 0.3rem 0.5rem; border: 1px solid var(--color-border);
    border-radius: var(--radius); width: 100%; max-width: 480px; resize: vertical; }
  .curation-quick-rules {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
  }
  .curation-rule-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    border: 1px solid #cfe0dc;
    border-radius: 999px;
    padding: 0.26rem 0.62rem;
    background: #f6fbfa;
    font-size: 0.8rem;
    margin: 0;
  }
  .curation-rule-pill input {
    margin: 0;
  }
  .curation-advanced > summary {
    cursor: pointer;
    font-size: 0.82rem;
    color: #3f576f;
    list-style: none;
    user-select: none;
  }
  .curation-advanced > summary::-webkit-details-marker {
    display: none;
  }
  .curation-advanced > summary::before {
    content: "▸";
    display: inline-block;
    margin-right: 0.35rem;
    transition: transform 0.14s ease;
  }
  .curation-advanced[open] > summary::before {
    transform: rotate(90deg);
  }
  .screen .card {
    overflow: hidden;
    scroll-margin-top: 74px;
  }
  .screen .acc-head {
    margin: -1rem -1rem 0;
    padding: 0.75rem 1rem;
    background: var(--color-surface-alt);
    border-bottom: 1px solid var(--color-border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    cursor: pointer;
    user-select: none;
  }
  .screen .acc-head:focus-visible {
    outline: 2px solid #9fd3cc;
    outline-offset: 2px;
  }
  .screen .acc-toggle {
    border: 1px solid #cfd8e6;
    border-radius: 7px;
    background: #fff;
    color: #4c5a73;
    width: 28px;
    height: 28px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }
  .screen .acc-caret {
    display: inline-block;
    transition: transform 0.16s ease;
    font-size: 12px;
    line-height: 1;
  }
  .screen .card.is-collapsed .acc-caret {
    transform: rotate(-90deg);
  }
  .screen .card.is-collapsed .acc-body {
    display: none;
  }
  .screen .acc-body {
    padding-top: 0.75rem;
  }

  /* Preview stats banner */
  .preview-stats { font-size: 0.85rem; margin-bottom: 0.5rem; }
  .stat-ok { color: var(--color-ok); font-weight: 600; }
  .stat-warn { color: var(--color-warning); font-weight: 600; }

  /* Badge for feature labels */
  .badge-preview { font-size: 0.7rem; font-weight: 500; background: #e0ecff;
    color: var(--color-primary); padding: 1px 6px; border-radius: 10px; vertical-align: middle; }

  /* Diff table */
  .diff-table { border-collapse: collapse; font-size: 0.82rem; width: 100%; table-layout: fixed; }
  .diff-table th, .diff-table td { border: 1px solid var(--color-border); padding: 0.25rem 0.45rem;
    vertical-align: top; word-break: break-word; }
  .diff-table th { background: var(--color-bg); font-weight: 600; }
  .diff-extid { color: var(--color-muted); font-family: monospace; }
  .diff-before { background: #fff5f5; color: #6c1a1a; }
  .diff-after { background: #f0fff4; }
  mark.diff-mark { background: #b7f5c8; color: #14532d; border-radius: 2px; padding: 0 1px; font-weight: 600; }

  /* Audit table */
  .audit-table { font-size: 0.82rem; }
  .audit-text { max-width: 300px; word-break: break-word; }
  .audit-table tbody tr {
    cursor: pointer;
  }
  .audit-table tbody tr.audit-row-active {
    background: #edf7f5;
  }
  .audit-table tbody tr:hover {
    background: #f5fbfa;
  }
  .audit-filter-btn {
    border-color: #cfd8e6;
    background: #fff;
    color: #4c5a73;
  }
  .audit-filter-btn.is-active {
    border-color: #9fd3cc;
    background: #e8f5f3;
    color: #0c4a46;
    font-weight: 700;
  }

  /* Align workspace */
  .align-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 320px;
    gap: 12px;
    align-items: start;
  }
  .align-main { min-width: 0; }
  .align-launcher {
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface-alt);
    padding: 0.6rem 0.7rem;
  }
  .align-focus {
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: #fff;
    padding: 0.7rem;
    position: sticky;
    top: 12px;
  }
  .align-finalize-row {
    margin-top: 0.65rem;
    padding-top: 0.5rem;
    border-top: 1px dashed var(--color-border);
    justify-content: flex-end;
  }
  .actions-shortcuts-card .btn-row {
    gap: 0.45rem;
  }
  .actions-shortcuts-card .btn {
    min-width: 150px;
  }
  .actions-shortcuts-card {
    background: #f8fbfa;
  }
  .actions-shortcuts-card h3 {
    margin-bottom: 0.45rem;
    font-size: 0.9rem;
  }
  .actions-quicknav-row .btn {
    border-radius: 999px;
    border: 1px solid #cfd8e6;
    background: #fff;
    color: #35506a;
  }
  .actions-quicknav-row .btn:hover {
    background: #eef6f4;
    border-color: #9fd3cc;
    color: #0c4a46;
  }
  .align-focus-text {
    border: 1px solid var(--color-border);
    border-radius: 8px;
    padding: 0.5rem 0.55rem;
    background: #fafbfd;
  }
  .align-focus-text strong {
    display: block;
    font-size: 0.76rem;
    color: var(--color-muted);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    margin-bottom: 0.25rem;
  }
  .align-focus-text p {
    margin: 0;
    white-space: pre-wrap;
    line-height: 1.4;
    font-size: 0.84rem;
  }
  .actions-screen.seg-focus-mode > section.card {
    display: none;
  }
  .actions-screen.seg-focus-mode > #act-seg-card,
  .actions-screen.seg-focus-mode > section.card:last-of-type {
    display: block;
  }
  .actions-screen.seg-focus-mode > #act-seg-card {
    border-color: #9fd3cc;
    box-shadow: 0 10px 22px rgba(15, 118, 110, 0.11);
  }
  @media (max-width: 1200px) {
    .align-layout {
      grid-template-columns: 1fr;
    }
    .align-focus {
      position: static;
    }
  }

  /* Batch action bar (V1.3) */
  .audit-batch-bar {
    display: none;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
    padding: 0.35rem 0.5rem;
    background: #f0f4ff;
    border: 1px solid #c7d2f7;
    border-radius: var(--radius);
    margin-top: 0.35rem;
    font-size: 0.83rem;
  }
  .audit-sel-count { color: var(--color-muted); margin-right: 0.2rem; }

  /* Align explainability panel */
  .align-debug-head { display: flex; align-items: center; justify-content: space-between; gap: 0.6rem; margin-bottom: 0.45rem; }
  .align-debug-content { display: grid; grid-template-columns: 1fr; gap: 0.45rem; }
  .align-debug-card {
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: #f8fafc;
    padding: 0.45rem 0.6rem;
  }
  .align-debug-title { font-weight: 600; font-size: 0.82rem; }
  .align-debug-meta { margin-top: 0.2rem; font-size: 0.8rem; color: var(--color-muted); }
  .align-debug-row { margin-top: 0.32rem; font-size: 0.8rem; display: flex; gap: 0.45rem; align-items: baseline; flex-wrap: wrap; }
  .align-debug-label { font-weight: 600; min-width: 72px; color: var(--color-text); }
  .align-debug-pills { display: flex; flex-wrap: wrap; gap: 0.3rem; }
  .align-debug-pill { background: #e6eefb; color: var(--color-primary); padding: 0.08rem 0.38rem; border-radius: 999px; font-size: 0.76rem; }
  .align-debug-list { margin: 0; padding-left: 1rem; }

  /* Align quality panel */
  .quality-stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 0.5rem;
  }
  .quality-stat {
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    padding: 0.4rem 0.6rem;
    background: #f8fafc;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .quality-label { font-size: 0.78rem; color: var(--color-muted); }
  .quality-value { font-weight: 700; font-size: 0.92rem; }
  .quality-value.ok  { color: var(--color-success, #2dc653); }
  .quality-value.warn { color: #f4a261; }
  .quality-value.err  { color: var(--color-danger, #e63946); }

  /* ── Skip link (A11y) ─────────────────────────────────────────────────── */
  .prep-skip-link { position: absolute; top: -40px; left: 8px; background: var(--prep-blue,#1e4a80); color: #fff; border-radius: 4px; padding: 6px 12px; font-size: 13px; font-weight: 600; text-decoration: none; z-index: 9999; transition: top 0.12s; }
  .prep-skip-link:focus { top: 8px; }
  /* ── Prep vNext sidebar layout (also in prep-vnext.css for standalone) ── */
  :root { --prep-topbar-h: 54px; --prep-nav-w: 230px; --prep-line: #dde1e8; --prep-line-accent: #9fd3cc; --prep-line-accent-light: #cfe8e3; --prep-accent-soft: #e8f5f3; --prep-accent-dark: #0c4a46; --prep-accent: #0f766e; --prep-muted: #4f5d6d; --prep-text: #1a1a2e; --prep-blue: #1e4a80; --prep-blue-soft: #eaf1fb; --prep-blue-line: #b7c8df; --prep-warn: #e6a817; --prep-warn-soft: #fff7e6; --prep-warn-line: #edd89e; }
  .prep-shell { display: grid; grid-template-columns: var(--prep-nav-w,230px) 1fr; min-height: calc(100vh - var(--prep-topbar-h,54px)); }
  .prep-shell.nav-hidden { grid-template-columns: 30px 1fr; }
  .prep-shell.nav-hidden .prep-nav { display: none; }
  .prep-shell.nav-hidden .prep-rail { display: flex; }
  .prep-nav { border-right: 1px solid var(--prep-line,#dde1e8); background: #f8f9fa; padding: 12px; overflow-y: auto; }
  .prep-nav-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
  .prep-nav-head h2 { margin: 0; font-size: 13px; text-transform: uppercase; letter-spacing: .07em; color: var(--prep-muted,#4f5d6d); }
  .prep-nav-tab { width: 100%; text-align: left; border: 1px solid transparent; border-radius: 8px; padding: 10px; background: transparent; color: var(--prep-text,#1a1a2e); font-size: 14px; margin-bottom: 4px; display: block; cursor: pointer; transition: background .12s, border-color .12s; font-family: inherit; }
  .prep-nav-tab:hover { background: #f0faf8; border-color: var(--prep-line-accent-light,#cfe8e3); }
  .prep-nav-tab.active { background: var(--prep-accent-soft,#e8f5f3); border-color: var(--prep-line-accent,#9fd3cc); color: var(--prep-accent-dark,#0c4a46); font-weight: 700; }
  .prep-nav-collapse-btn { border: 1px solid var(--prep-blue-line,#b7c8df); border-radius: 7px; color: var(--prep-blue,#1e4a80); background: var(--prep-blue-soft,#eaf1fb); width: 26px; height: 26px; padding: 0; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 11px; flex-shrink: 0; font-family: inherit; transition: background .12s; }
  .prep-nav-collapse-btn:hover { background: #d8e8f8; }
  .prep-rail { display: none; width: 30px; border-right: 1px solid var(--prep-line-accent-light,#cfe8e3); background: linear-gradient(180deg,#f3f8f7,#eef3f2); align-items: flex-start; justify-content: center; padding-top: 10px; }
  .prep-rail-expand-btn { border: 1px solid var(--prep-blue-line,#b7c8df); border-radius: 7px; color: var(--prep-blue,#1e4a80); background: var(--prep-blue-soft,#eaf1fb); width: 22px; height: 22px; padding: 0; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 11px; font-family: inherit; }
  .prep-nav-tree { margin: 2px 0 6px 2px; }
  .prep-nav-tree-summary { list-style: none; cursor: pointer; display: flex; align-items: center; justify-content: space-between; border: 1px solid var(--prep-line-accent-light,#cfe8e3); border-radius: 8px; padding: 7px 8px; font-size: 12px; font-weight: 700; color: var(--prep-accent-dark,#0c4a46); background: #edf7f5; user-select: none; }
  .prep-nav-tree-summary::-webkit-details-marker { display: none; }
  .prep-nav-tree-caret { font-size: 11px; color: var(--prep-muted,#4f5d6d); transition: transform .16s ease; }
  .prep-nav-tree[open] .prep-nav-tree-caret { transform: rotate(180deg); }
  .prep-nav-tree-body { margin: 3px 0 0 6px; padding: 4px 0 0 10px; border-left: 2px solid var(--prep-line-accent-light,#cfe8e3); display: grid; gap: 3px; }
  .prep-nav-tree-link { display: block; font-size: 12px; color: var(--prep-muted,#4f5d6d); border: 1px solid transparent; border-radius: 7px; padding: 6px 8px; background: transparent; width: 100%; text-align: left; cursor: pointer; transition: background .1s, border-color .1s; font-family: inherit; text-decoration: none; }
  .prep-nav-tree-link:hover { border-color: var(--prep-line-accent-light,#cfe8e3); background: #f6fbfa; }
  .prep-nav-tree-link.active { border-color: var(--prep-line-accent,#9fd3cc); background: var(--prep-accent-soft,#e8f5f3); color: var(--prep-accent-dark,#0c4a46); font-weight: 700; }
  .prep-main { min-width: 0; overflow-x: hidden; }

  /* ── Curation 3-column workspace (also in prep-vnext.css for standalone) ── */
  .curate-workspace-card { padding: 0 !important; overflow: hidden; }
  .curate-card-head { padding: 12px 16px; border-bottom: 1px solid var(--prep-line,#dde1e8); background: #f8f9fa; display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
  .curate-card-head h2 { margin: 0; font-size: 16px; }
  .curate-card-head p { margin: 4px 0 0; font-size: 13px; color: var(--prep-muted,#4f5d6d); }
  .curate-pill { display: inline-block; border: 1px solid var(--prep-line-accent,#9fd3cc); background: var(--prep-accent-soft,#e8f5f3); color: var(--prep-accent-dark,#0c4a46); border-radius: 999px; font-size: 11px; padding: 3px 10px; }
  .curate-workspace { display: grid; grid-template-columns: 300px minmax(480px,1fr) 270px; align-items: start; }
  .curate-col { min-width: 0; border-right: 1px solid var(--prep-line,#dde1e8); height: 100%; }
  .curate-col:last-child { border-right: 0; }
  .curate-inner-card { border-bottom: 1px solid var(--prep-line,#dde1e8); }
  .curate-inner-card:last-child { border-bottom: 0; }
  .curate-inner-head { padding: 9px 12px; border-bottom: 1px solid var(--prep-line,#dde1e8); background: #f8f9fa; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .curate-inner-head h3 { margin: 0; font-size: 14px; }
  .curate-inner-body { padding: 10px 12px; }
  .curate-chip-row { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
  .curate-btns { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
  .curate-preview-card { display: flex; flex-direction: column; position: sticky; top: 0; max-height: calc(100vh - var(--prep-topbar-h,54px) - 8px); overflow: hidden; }
  .curate-preview-controls { padding: 7px 12px; border-bottom: 1px solid var(--prep-line,#dde1e8); display: flex; gap: 6px; flex-wrap: wrap; align-items: center; background: #fcfdfd; flex-shrink: 0; }
  .curate-preview-body { display: grid; grid-template-columns: 1fr 1fr 22px; gap: 8px; padding: 8px; overflow: hidden; flex: 1; min-height: 200px; }
  .curate-pane { border: 1px solid var(--prep-line,#dde1e8); border-radius: 8px; overflow: hidden; display: grid; grid-template-rows: auto 1fr; min-height: 200px; }
  .curate-pane-head { padding: 6px 10px; font-size: 12px; color: var(--prep-muted,#4f5d6d); border-bottom: 1px solid var(--prep-line,#dde1e8); background: #f8f9fa; }
  .curate-doc-scroll { overflow-y: auto; padding: 8px 10px; font-size: 13px; line-height: 1.5; background: #fff; }
  .curate-doc-scroll p { margin: 0 0 8px; }
  .curate-minimap { border: 1px solid var(--prep-line,#dde1e8); border-radius: 8px; background: #fafbfc; display: grid; align-content: start; gap: 3px; padding: 6px 4px; min-height: 200px; }
  .curate-mm { height: 10px; border-radius: 2px; background: #d6dde8; }
  .curate-mm.changed { background: var(--prep-warn,#e6a817); }
  .curate-mm.current { background: var(--prep-accent,#0f766e); }
  .curate-preview-footer { padding: 8px 12px; border-top: 1px solid var(--prep-line,#dde1e8); background: #f8f9fa; flex-shrink: 0; }
  .curate-diag-list { display: grid; gap: 8px; }
  .curate-diag { border: 1px solid var(--prep-line,#dde1e8); border-radius: 8px; padding: 8px 10px; font-size: 12px; background: #fff; }
  .curate-diag.warn { border-color: var(--prep-warn-line,#edd89e); background: var(--prep-warn-soft,#fff7e6); }
  .curate-diag strong { display: block; margin-bottom: 2px; }
  .curate-doc-scroll .diff-table { font-size: 12px; }
  .curate-doc-scroll .diff-table th, .curate-doc-scroll .diff-table td { padding: 4px 6px; }
  /* ── Segmentation 2-col workspace (also in prep-vnext.css for standalone) ── */
  .seg-workspace-card { padding: 0 !important; overflow: hidden; }
  .seg-workspace { display: grid; grid-template-columns: 360px 1fr; align-items: start; }
  .seg-col { min-width: 0; border-right: 1px solid var(--prep-line,#dde1e8); }
  .seg-col:last-child { border-right: 0; }
  .seg-inner-card { border-bottom: 1px solid var(--prep-line,#dde1e8); }
  .seg-inner-card:last-child { border-bottom: 0; }
  .seg-inner-head { padding: 9px 12px; border-bottom: 1px solid var(--prep-line,#dde1e8); background: #f8f9fa; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .seg-inner-head h3 { margin: 0; font-size: 14px; }
  .seg-inner-body { padding: 10px 12px; }
  .seg-preview-card { position: sticky; top: 0; max-height: calc(100vh - var(--prep-topbar-h,54px) - 8px); overflow: hidden; display: flex; flex-direction: column; }
  .seg-preview-info { font-size: 12px; color: var(--prep-muted,#4f5d6d); }
  .seg-preview-body { overflow-y: auto; padding: 12px; flex: 1; }
  .seg-stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px; }
  .seg-stat { border: 1px solid var(--prep-line,#dde1e8); border-radius: 8px; padding: 8px 10px; background: #fff; font-size: 12px; }
  .seg-stat strong { display: block; font-size: 20px; color: var(--prep-accent-dark,#0c4a46); margin-bottom: 2px; }
  .seg-warn-list { display: grid; gap: 6px; }
  .seg-warn { border: 1px solid var(--prep-warn-line,#edd89e); background: var(--prep-warn-soft,#fff7e6); border-radius: 8px; padding: 7px 10px; font-size: 12px; }
  .seg-batch-overview > summary::-webkit-details-marker { display: none; }
  .seg-batch-list { display: grid; gap: 5px; }
  .seg-batch-line { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: center; padding: 6px 0; border-top: 1px solid var(--prep-line,#dde1e8); font-size: 12px; }
  .seg-batch-line:first-child { border-top: 0; padding-top: 0; }
  .seg-batch-line strong { font-size: 13px; }
  .seg-batch-meta { color: var(--prep-muted,#4f5d6d); font-size: 11px; }
  .seg-batch-badge { border-radius: 999px; font-size: 11px; padding: 3px 8px; white-space: nowrap; }
  .seg-badge-ok { background: #e8f5e9; color: #1a5c33; border: 1px solid #a8d5b0; }
  .seg-badge-warn { background: var(--prep-warn-soft,#fff7e6); color: #7a4a00; border: 1px solid var(--prep-warn-line,#edd89e); }
  .seg-badge-none { background: #f8f9fa; color: var(--prep-muted,#4f5d6d); border: 1px solid var(--prep-line,#dde1e8); }
  @media (max-width:1100px) { .seg-workspace { grid-template-columns: 1fr; } .seg-col { border-right: 0; border-bottom: 1px solid var(--prep-line,#dde1e8); } .seg-col:last-child { border-bottom: 0; } .seg-preview-card { position: static; max-height: none; } }
  @media (max-width:900px) { .seg-stats-grid { grid-template-columns: 1fr 1fr; } .seg-inner-body { padding: 8px; } .seg-preview-body { padding: 8px; } }
  @media (max-width:1400px) { .curate-workspace { grid-template-columns: 280px 1fr; } .curate-col-right { grid-column: 1/-1; border-right: 0; border-top: 1px solid var(--prep-line,#dde1e8); } .curate-preview-body { grid-template-columns: 1fr 1fr; } .curate-minimap { display: none; } }
  @media (max-width:1050px) { .prep-shell { grid-template-columns: 1fr; } .prep-nav { border-right: 0; border-bottom: 1px solid var(--prep-line,#dde1e8); } .curate-workspace { grid-template-columns: 1fr; } .curate-col { border-right: 0; border-bottom: 1px solid var(--prep-line,#dde1e8); } .curate-col:last-child { border-bottom: 0; } .curate-preview-card { position: static; max-height: none; } }
  @media (max-width:800px) { .curate-preview-body { grid-template-columns: 1fr; } .curate-pane { min-height: 160px; } }
`+ JOB_CENTER_CSS;


// ─── App ──────────────────────────────────────────────────────────────────────

const TABS = ["import", "documents", "actions", "exporter"] as const;
type TabId = typeof TABS[number];

type GuardableScreen = {
  hasPendingChanges?: () => boolean;
  pendingChangesMessage?: () => string;
};

/** Stable id for the inline <style> injected by App.init(). Used as dedup key. */
const PREP_STYLE_ID = "agrafes-prep-inline";

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
    // Inject CSS once per document lifetime — idempotent guard prevents accumulation
    // when App is mounted multiple times (e.g. shell navigation Explorer ⇄ Constituer).
    if (!document.getElementById(PREP_STYLE_ID)) {
      const style = document.createElement("style");
      style.id = PREP_STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }

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
        for (const [label, selector, navKey] of treeItems) {
          const link = document.createElement("button");
          link.className = "prep-nav-tree-link";
          link.dataset.nav = navKey;
          link.textContent = label;
          link.addEventListener("click", () => {
            this._switchTab("actions");
            // Scroll to section after brief delay for tab activation
            setTimeout(() => {
              const el = document.querySelector(selector);
              if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
            }, 60);
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
