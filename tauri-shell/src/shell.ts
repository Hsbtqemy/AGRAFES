/**
 * shell.ts — AGRAFES Shell V0.2
 *
 * V0.1: permanent header + tabs (Explorer / Constituer) + lifecycle + accents.
 * V0.2 additions:
 *   - DB state unique  : `_currentDbPath` as single source of truth
 *   - DB badge         : header shows "DB: <basename>" or "DB: (aucune)"
 *   - Switch DB        : "Changer…" button → Tauri file picker (.db)
 *   - Persistance      : localStorage for last_mode + last_db_path
 *   - Deep-link boot   : location.hash (#explorer/#constituer/#home) or ?mode=
 *   - Module wrappers  : explorerModule / constituerModule via mount/dispose
 *   - Toast            : animated notification on DB change
 *
 * Layout (index.html):
 *   #shell-header  fixed 44px — brand + tabs + db zone (always visible)
 *   #app           padding-top:44px — module mount point; replaced on each navigation
 */

import { open as dialogOpen, save as dialogSave } from "@tauri-apps/plugin-dialog";
import { exists, writeFile, mkdir, remove, stat } from "@tauri-apps/plugin-fs";
import { getCurrent as getCurrentDeepLinks, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { appDataDir } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import type { ShellContext } from "./context.ts";

// ─── CSS ─────────────────────────────────────────────────────────────────────

const SHELL_CSS = `
  /* ── Accent tokens ─────────────────────────────────────────── */
  :root {
    --accent:            #2c5f9e;
    --accent-header-bg:  #1a1a2e;
  }
  body[data-mode="explorer"] {
    --accent:            #2c5f9e;
    --accent-header-bg:  #1e4a80;
  }
  body[data-mode="constituer"] {
    --accent:            #1a7f4e;
    --accent-header-bg:  #145a38;
  }
  /* ── Shell header ──────────────────────────────────────────── */
  #shell-header {
    background: var(--accent-header-bg);
    display: flex;
    align-items: center;
    padding: 0;
    gap: 0;
    transition: background 0.22s;
    box-shadow: 0 1px 4px rgba(0,0,0,0.18);
  }

  .shell-brand {
    font-size: 0.95rem;
    font-weight: 700;
    color: #fff;
    cursor: pointer;
    user-select: none;
    letter-spacing: 0.5px;
    padding: 0 1rem;
    height: 44px;
    display: flex;
    align-items: center;
    border-right: 1px solid rgba(255,255,255,0.15);
    margin-right: 0.25rem;
    transition: background 0.15s;
  }
  .shell-brand:hover { background: rgba(255,255,255,0.08); }

  .shell-tabs {
    display: flex;
    height: 44px;
    gap: 0;
  }

  .shell-tab {
    background: none;
    border: none;
    border-bottom: 3px solid transparent;
    color: rgba(255,255,255,0.65);
    font-size: 0.875rem;
    font-weight: 500;
    padding: 0 1.15rem;
    height: 100%;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s, background 0.15s;
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }
  .shell-tab:hover {
    color: #fff;
    background: rgba(255,255,255,0.08);
  }
  .shell-tab.active {
    color: #fff;
    font-weight: 700;
    border-bottom-color: rgba(255,255,255,0.88);
    background: rgba(255,255,255,0.12);
  }
  .shell-tab-badge {
    font-size: 0.7rem;
    opacity: 0.5;
  }

  /* ── DB zone (right side of header) ────────────────────────── */
  .shell-db-zone {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0 0.75rem;
    height: 44px;
    border-left: 1px solid rgba(255,255,255,0.12);
  }

  .shell-db-badge {
    font-size: 0.75rem;
    color: rgba(255,255,255,0.6);
    font-family: ui-monospace, "SF Mono", monospace;
    white-space: nowrap;
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: default;
    transition: color 0.2s;
  }
  .shell-db-badge--pending {
    color: #fcd34d;
  }

  .shell-db-btn {
    background: rgba(255,255,255,0.1);
    border: 1px solid rgba(255,255,255,0.2);
    border-radius: 4px;
    color: rgba(255,255,255,0.85);
    font-size: 0.75rem;
    padding: 3px 9px;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
    white-space: nowrap;
  }
  .shell-db-btn:hover {
    background: rgba(255,255,255,0.18);
    border-color: rgba(255,255,255,0.35);
  }

  /* ── DB action dropdown menu ────────────────────────────────── */
  .shell-db-menu-wrap {
    position: relative;
    display: flex;
    align-items: center;
  }
  .shell-db-menu {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    background: #fff;
    border: 1px solid rgba(0,0,0,0.12);
    border-radius: 6px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.20);
    min-width: 150px;
    z-index: 9999;
    overflow: hidden;
    display: none;
  }
  .shell-db-menu.open { display: block; }
  .shell-db-menu-item {
    display: block;
    width: 100%;
    padding: 9px 16px;
    background: none;
    border: none;
    text-align: left;
    font-size: 0.83rem;
    cursor: pointer;
    color: #1a1a2e;
    white-space: nowrap;
    transition: background 0.12s;
  }
  .shell-db-menu-item:hover { background: #f0f2f5; }
  .shell-db-menu-sep { height: 1px; background: #e9ecef; margin: 2px 0; }

  /* ── DB init error banner (V0.5) ────────────────────────────── */
  .shell-init-error {
    position: fixed;
    top: 44px;
    left: 0;
    right: 0;
    background: #fff3cd;
    border-bottom: 2px solid #e6a817;
    z-index: 9990;
    padding: 8px 16px;
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    font-size: 0.84rem;
    box-shadow: 0 2px 6px rgba(0,0,0,0.1);
  }
  .shell-init-error-icon { font-size: 1.1rem; color: #856404; flex-shrink: 0; }
  .shell-init-error-msg { font-weight: 600; color: #856404; flex-shrink: 0; }
  .shell-init-error-detail {
    font-family: ui-monospace, monospace;
    font-size: 0.78rem;
    color: #555;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 500px;
  }
  .shell-init-error-btns { display: flex; gap: 6px; margin-left: auto; flex-shrink: 0; }

  /* ── DB change banner (P4-2) ────────────────────────────────── */
  .shell-db-change-banner {
    position: fixed;
    top: 44px;
    left: 0;
    right: 0;
    background: #e8f4fd;
    border-bottom: 2px solid #4a90d9;
    z-index: 9989;
    padding: 7px 16px;
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    font-size: 0.83rem;
    box-shadow: 0 2px 6px rgba(0,0,0,0.08);
    animation: shell-banner-in 0.18s ease-out;
  }
  @keyframes shell-banner-in {
    from { opacity: 0; transform: translateY(-6px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .shell-db-change-banner-icon { font-size: 1rem; flex-shrink: 0; }
  .shell-db-change-banner-msg  { color: #1a4f7a; font-weight: 600; flex-shrink: 0; }
  .shell-db-change-banner-name {
    font-family: ui-monospace, "SF Mono", monospace;
    font-size: 0.78rem;
    color: #2c6fa8;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 400px;
  }
  .shell-db-change-banner-btns { display: flex; gap: 6px; margin-left: auto; flex-shrink: 0; }
  .shell-db-change-banner-btn {
    font-size: 0.78rem;
    padding: 3px 10px;
    border-radius: 4px;
    cursor: pointer;
    border: 1px solid #4a90d9;
    background: #fff;
    color: #1a4f7a;
    transition: background 0.12s;
  }
  .shell-db-change-banner-btn:hover { background: #d0e8f8; }
  .shell-db-change-banner-btn.primary { background: #4a90d9; color: #fff; border-color: #3575bb; }
  .shell-db-change-banner-btn.primary:hover { background: #3575bb; }
  .shell-db-change-banner-btn.dismiss { border-color: transparent; color: #5a8aad; background: transparent; }
  .shell-db-change-banner-btn.dismiss:hover { background: #cce0f2; }

  /* ── Home screen ───────────────────────────────────────────── */
  .shell-home-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: calc(100vh - 44px);
    background: #f0f2f5;
    padding: 2rem;
  }

  .shell-home-title {
    font-size: 2.2rem;
    font-weight: 700;
    color: #1a1a2e;
    margin: 0 0 0.35rem;
    letter-spacing: -0.5px;
  }

  .shell-home-subtitle {
    font-size: 0.95rem;
    color: #6c757d;
    margin: 0 0 2.5rem;
  }

  .shell-cards {
    display: flex;
    gap: 1.5rem;
    flex-wrap: wrap;
    justify-content: center;
  }

  .shell-card {
    background: #fff;
    border: 1px solid #dde1e8;
    border-radius: 10px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    padding: 2rem 2.5rem;
    width: 240px;
    cursor: pointer;
    transition: box-shadow 0.18s, transform 0.12s, border-color 0.18s;
    text-align: center;
    user-select: none;
  }
  .shell-card:hover {
    transform: translateY(-3px);
  }
  .shell-card-explorer:hover {
    box-shadow: 0 6px 20px rgba(44,95,158,0.22);
    border-color: #2c5f9e;
  }
  .shell-card-constituer:hover {
    box-shadow: 0 6px 20px rgba(26,127,78,0.22);
    border-color: #1a7f4e;
  }
  .shell-card-badge {
    display: inline-block;
    font-size: 0.7rem;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 20px;
    margin-bottom: 0.75rem;
  }
  .shell-card-badge-explorer {
    background: #dbeafe;
    color: #1e4a80;
  }
  .shell-card-badge-constituer {
    background: #d1fae5;
    color: #145a38;
  }
  .shell-card-publish:hover {
    box-shadow: 0 6px 20px rgba(130,80,20,0.22);
    border-color: #7c4a00;
  }
  .shell-card-badge-publish {
    background: #fff3cd;
    color: #7c4a00;
  }
  .shell-card-icon { font-size: 2.2rem; margin-bottom: 0.4rem; }
  .shell-card h2 { font-size: 1.05rem; font-weight: 600; margin: 0 0 0.4rem; color: #1a1a2e; }
  .shell-card p { font-size: 0.82rem; color: #6c757d; margin: 0; line-height: 1.4; }

  /* ── MRU DB list ───────────────────────────────────────────── */
  .shell-mru-heading {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #adb5bd;
    padding: 0.3rem 0.85rem 0.1rem;
  }
  .shell-mru-row {
    display: flex;
    align-items: center;
    gap: 0;
  }
  .shell-mru-row.missing .shell-mru-name { color: #adb5bd; }
  .shell-mru-name {
    flex: 1;
    text-align: left;
    background: none;
    border: none;
    padding: 0.4rem 0.85rem;
    font-size: 0.8rem;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 160px;
    color: #1a1a2e;
  }
  .shell-mru-name:hover { background: #f0f4ff; }
  .shell-mru-missing-badge {
    font-size: 0.65rem;
    background: #e9ecef;
    color: #6c757d;
    border-radius: 3px;
    padding: 1px 4px;
    margin-left: 4px;
  }
  .shell-mru-actions {
    display: flex;
    gap: 0;
    padding-right: 4px;
  }
  .shell-mru-action {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 0.78rem;
    padding: 0.25rem 0.3rem;
    color: #6c757d;
    opacity: 0;
    transition: opacity 0.15s;
  }
  .shell-mru-row:hover .shell-mru-action { opacity: 1; }
  .shell-mru-action:hover { color: #1a1a2e; }

  /* ── Guided tour ───────────────────────────────────────────── */
  .shell-guide-section {
    margin-top: 1.5rem;
    width: 100%;
    max-width: 600px;
  }
  .shell-guide-card {
    background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);
    border: 1px solid #7dd3fc;
    border-radius: 10px;
    padding: 1.25rem 1.5rem;
    box-shadow: 0 2px 8px rgba(14,165,233,0.1);
  }
  .shell-guide-title {
    font-size: 0.95rem;
    font-weight: 700;
    color: #0369a1;
    margin: 0 0 0.75rem;
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .shell-guide-steps {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .shell-guide-step {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    font-size: 0.83rem;
  }
  .shell-guide-step-num {
    min-width: 22px;
    height: 22px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.72rem;
    font-weight: 700;
    flex-shrink: 0;
  }
  .shell-guide-step-num.done { background: #1a7f4e; color: #fff; }
  .shell-guide-step-num.active { background: #0369a1; color: #fff; }
  .shell-guide-step-num.pending { background: #e2e8f0; color: #64748b; }
  .shell-guide-step-label { flex: 1; color: #1a1a2e; }
  .shell-guide-step-label.done { text-decoration: line-through; color: #6c757d; }
  .shell-guide-step-btn {
    font-size: 0.75rem;
    padding: 3px 10px;
    border-radius: 4px;
    border: 1px solid #0369a1;
    background: #0369a1;
    color: #fff;
    cursor: pointer;
    transition: background 0.15s;
    white-space: nowrap;
  }
  .shell-guide-step-btn:hover { background: #0284c7; }
  .shell-guide-step-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .shell-guide-footer {
    margin-top: 0.75rem;
    font-size: 0.75rem;
    color: #64748b;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .shell-guide-reset {
    font-size: 0.72rem;
    background: none;
    border: none;
    color: #94a3b8;
    cursor: pointer;
    text-decoration: underline;
    padding: 0;
  }
  .shell-guide-reset:hover { color: #475569; }

  /* ── Support menu ──────────────────────────────────────────── */
  .shell-support-wrap {
    position: relative;
    display: inline-flex;
  }
  .shell-support-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 0.8rem;
    color: #6c757d;
    padding: 4px 8px;
    border-radius: 4px;
    transition: background 0.15s, color 0.15s;
    white-space: nowrap;
  }
  .shell-support-btn:hover {
    background: rgba(255,255,255,0.15);
    color: #fff;
  }
  .shell-support-menu {
    display: none;
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.12);
    z-index: 2000;
    min-width: 200px;
    padding: 4px 0;
  }
  .shell-support-menu.open { display: block; }
  .shell-support-menu-item {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    padding: 0.42rem 1rem;
    font-size: 0.82rem;
    cursor: pointer;
    color: #1a1a2e;
    white-space: nowrap;
  }
  .shell-support-menu-item:hover { background: #f0f4ff; }
  .shell-support-menu-sep {
    height: 1px;
    background: #eee;
    margin: 3px 0;
  }
  /* ── Diagnostics modal ──────────────────────────────────────── */
  .shell-diag-box {
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.18);
    padding: 0;
    min-width: 520px;
    max-width: 680px;
    max-height: 82vh;
    display: flex;
    flex-direction: column;
    position: relative;
    overflow: hidden;
  }
  .shell-diag-header {
    padding: 1rem 1.25rem 0.75rem;
    border-bottom: 1px solid #eee;
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }
  .shell-diag-title {
    font-size: 1rem;
    font-weight: 700;
    color: #1a1a2e;
    flex: 1;
  }
  .shell-diag-body {
    flex: 1;
    overflow-y: auto;
    padding: 1rem 1.25rem;
    font-size: 0.78rem;
    font-family: monospace;
    white-space: pre;
    color: #2d3748;
    background: #f8fafc;
    line-height: 1.55;
  }
  .shell-diag-footer {
    padding: 0.75rem 1.25rem;
    border-top: 1px solid #eee;
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
    flex-wrap: wrap;
  }
  .shell-diag-btn {
    font-size: 0.8rem;
    padding: 5px 14px;
    border-radius: 5px;
    cursor: pointer;
    border: 1px solid #adb5bd;
    background: #f8f9fa;
    color: #495057;
    transition: background 0.15s;
  }
  .shell-diag-btn:hover { background: #e9ecef; }
  .shell-diag-btn-primary {
    background: #2563eb;
    color: #fff;
    border-color: #2563eb;
  }
  .shell-diag-btn-primary:hover { background: #1d4ed8; }
  .shell-diag-loading {
    padding: 2rem;
    text-align: center;
    color: #6c757d;
    font-size: 0.84rem;
  }

  /* ── About + Shortcuts ──────────────────────────────────────── */
  .shell-about-btn, .shell-shortcuts-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 0.8rem;
    color: #6c757d;
    padding: 4px 8px;
    border-radius: 4px;
    transition: background 0.15s, color 0.15s;
    white-space: nowrap;
  }
  .shell-about-btn:hover, .shell-shortcuts-btn:hover {
    background: rgba(255,255,255,0.15);
    color: #fff;
  }
  .shell-about-modal {
    position: fixed;
    inset: 0;
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0,0,0,0.45);
  }
  .shell-about-box {
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.18);
    padding: 2rem 2.5rem;
    min-width: 340px;
    max-width: 480px;
    position: relative;
  }
  .shell-about-title {
    font-size: 1.3rem;
    font-weight: 800;
    color: #1a1a2e;
    margin: 0 0 0.25rem;
    letter-spacing: -0.5px;
  }
  .shell-about-tagline {
    color: #6c757d;
    font-size: 0.83rem;
    margin: 0 0 1.25rem;
  }
  .shell-about-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.82rem;
  }
  .shell-about-table td { padding: 0.25rem 0.4rem; }
  .shell-about-table td:first-child { color: #6c757d; min-width: 120px; }
  .shell-about-table td:last-child { font-weight: 600; font-family: monospace; }
  .shell-about-profiles {
    margin-top: 0.75rem;
    font-size: 0.78rem;
    color: #6c757d;
  }
  .shell-about-close {
    position: absolute;
    top: 0.8rem;
    right: 1rem;
    background: none;
    border: none;
    cursor: pointer;
    font-size: 1.3rem;
    color: #adb5bd;
  }
  .shell-about-close:hover { color: #1a1a2e; }
  .shell-shortcuts-box {
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.18);
    padding: 1.75rem 2.25rem;
    min-width: 320px;
    max-width: 440px;
    position: relative;
  }
  .shell-shortcuts-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.83rem;
  }
  .shell-shortcuts-table tr { border-bottom: 1px solid #f0f0f0; }
  .shell-shortcuts-table tr:last-child { border-bottom: none; }
  .shell-shortcuts-table td { padding: 0.3rem 0.4rem; }
  .shell-shortcuts-table td:first-child {
    font-family: monospace;
    background: #f4f5f7;
    border-radius: 4px;
    padding: 2px 8px;
    white-space: nowrap;
    color: #1a1a2e;
    font-weight: 600;
  }
  .shell-shortcuts-table td:last-child { color: #495057; padding-left: 1rem; }

  /* ── Presets button in header ───────────────────────────────── */
  .shell-presets-btn {
    background: none;
    border: 1px solid rgba(255,255,255,0.25);
    color: rgba(255,255,255,0.7);
    font-size: 0.78rem;
    padding: 3px 10px;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    white-space: nowrap;
  }
  .shell-presets-btn:hover {
    background: rgba(255,255,255,0.12);
    color: #fff;
  }

  /* ── Loading indicator ─────────────────────────────────────── */
  .shell-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: calc(100vh - 44px);
    font-size: 0.95rem;
    color: #6c757d;
    gap: 0.5rem;
  }
  .shell-loading-dot {
    width: 6px; height: 6px;
    border-radius: 50%;
    background: var(--accent);
    animation: shell-pulse 1.2s ease-in-out infinite;
  }
  .shell-loading-dot:nth-child(2) { animation-delay: 0.2s; }
  .shell-loading-dot:nth-child(3) { animation-delay: 0.4s; }
  @keyframes shell-pulse {
    0%, 80%, 100% { opacity: 0.25; transform: scale(0.85); }
    40%           { opacity: 1;    transform: scale(1.15); }
  }

  /* ── Home demo section ─────────────────────────────────────── */
  .shell-demo-section {
    margin-top: 2rem;
    text-align: center;
  }
  .shell-demo-hint {
    font-size: 0.82rem;
    color: #6c757d;
    margin: 0 0 0.75rem;
  }
  .shell-demo-card {
    display: inline-flex;
    align-items: center;
    gap: 0.75rem;
    background: #fff;
    border: 1px solid #dde1e8;
    border-radius: 8px;
    padding: 0.75rem 1.25rem;
    box-shadow: 0 1px 4px rgba(0,0,0,0.06);
    font-size: 0.88rem;
    color: #1a1a2e;
  }
  .shell-demo-icon { font-size: 1.4rem; }
  .shell-demo-label { font-weight: 500; }
  .shell-demo-btns { display: flex; gap: 0.4rem; margin-left: 0.5rem; }
  .shell-demo-btn {
    font-size: 0.78rem;
    padding: 4px 10px;
    border-radius: 5px;
    border: 1px solid;
    cursor: pointer;
    transition: background 0.15s;
    white-space: nowrap;
  }
  .shell-demo-btn-install {
    background: #f0f2f5;
    border-color: #adb5bd;
    color: #495057;
  }
  .shell-demo-btn-install:hover { background: #e2e6ea; }
  .shell-demo-btn-install:disabled { opacity: 0.55; cursor: not-allowed; }
  .shell-demo-btn-open {
    background: #2c5f9e;
    border-color: #2c5f9e;
    color: #fff;
  }
  .shell-demo-btn-open:hover { background: #1e4a80; border-color: #1e4a80; }

  /* ── Toast ─────────────────────────────────────────────────── */
  .shell-toast {
    position: fixed;
    bottom: 1.5rem;
    left: 50%;
    transform: translateX(-50%) translateY(0);
    background: #1a1a2e;
    color: #fff;
    font-size: 0.85rem;
    padding: 0.55rem 1.25rem;
    border-radius: 6px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.28);
    z-index: 99999;
    pointer-events: none;
    opacity: 1;
    transition: opacity 0.4s, transform 0.4s;
  }
  .shell-toast.shell-toast-hide {
    opacity: 0;
    transform: translateX(-50%) translateY(8px);
  }

  /* ── Sidecar loading overlay ────────────────────────────────── */
  .shell-sidecar-overlay {
    position: fixed;
    inset: 0;
    background: rgba(255, 255, 255, 0.72);
    backdrop-filter: blur(3px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9998;
    opacity: 1;
    transition: opacity 0.35s ease;
  }
  .shell-sidecar-overlay.shell-sidecar-overlay-hide {
    opacity: 0;
    pointer-events: none;
  }
  .shell-sidecar-card {
    background: #fff;
    border: 1px solid #dde1e8;
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
    padding: 2rem 2.5rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.25rem;
    min-width: 220px;
  }
  .shell-sidecar-spinner {
    width: 40px;
    height: 40px;
    border: 3px solid #e9ecef;
    border-top-color: var(--accent, #2c5f9e);
    border-radius: 50%;
    animation: shell-spin 0.75s linear infinite;
  }
  @keyframes shell-spin {
    to { transform: rotate(360deg); }
  }
  .shell-sidecar-label {
    font-size: 0.9rem;
    color: #495057;
    font-weight: 500;
    text-align: center;
    line-height: 1.4;
  }
  .shell-sidecar-sub {
    font-size: 0.78rem;
    color: #868e96;
    margin-top: -0.5rem;
    text-align: center;
  }
`;

// ─── Demo corpus ──────────────────────────────────────────────────────────────

const DEMO_FILENAME  = "agrafes_demo.db";
const DEMO_ASSET_URL = "/demo/agrafes_demo.db"; // served from tauri-shell/public/

async function _getDemoDbPath(): Promise<string> {
  const dir = await appDataDir();
  const sep = dir.includes("/") ? "/" : "\\";
  return `${dir}${sep}${DEMO_FILENAME}`;
}

// Un fichier SQLite valide fait au moins 100 Ko.
// Un fichier de 4 Ko = DB vide créée par le sidecar sur un chemin inconnu.
const DEMO_MIN_VALID_BYTES = 100_000;

async function _isDemoInstalled(): Promise<boolean> {
  try {
    const p = await _getDemoDbPath();
    if (!(await exists(p))) return false;
    const info = await stat(p);
    return (info.size ?? 0) >= DEMO_MIN_VALID_BYTES;
  } catch {
    return false;
  }
}

/** Déconnecte le sidecar de la démo si elle est active, supprime WAL/SHM,
 *  télécharge la DB depuis l'asset bundle et l'écrit sur disque. */
async function _installDemo(): Promise<void> {
  const demoPath = await _getDemoDbPath();
  const dir = await appDataDir();
  if (!(await exists(dir))) await mkdir(dir, { recursive: true });

  // Déconnecter le sidecar si la démo est la DB active, pour éviter
  // d'écrire sur un fichier ouvert (corrompt les shadow tables FTS5).
  if (_currentDbPath === demoPath) {
    _currentDbPath = null;
    _dbListeners.forEach(cb => cb(null));
    await new Promise(r => setTimeout(r, 500));
  }

  // Télécharger la DB bundle en mémoire d'abord (avant toute modification du disque).
  const resp = await window.fetch(DEMO_ASSET_URL);
  if (!resp.ok) throw new Error(`Impossible de charger la démo (${resp.status})`);
  const bytes = new Uint8Array(await resp.arrayBuffer());
  if (bytes.length < DEMO_MIN_VALID_BYTES) {
    throw new Error(`Réponse trop courte (${bytes.length} octets) — corpus démo non disponible`);
  }

  // Supprimer WAL/SHM AVANT l'écriture.
  for (const suffix of ["-wal", "-shm"]) {
    try { await remove(demoPath + suffix); } catch { /* inexistants — OK */ }
  }

  // Écrire la nouvelle DB.
  await writeFile(demoPath, bytes);

  // Supprimer WAL/SHM APRÈS l'écriture aussi : le sidecar encore actif peut
  // les avoir recréés pendant le délai de déconnexion. Le WAL d'une session
  // précédente écrase les données de la main DB même si les salts diffèrent.
  await new Promise(r => setTimeout(r, 300));
  for (const suffix of ["-wal", "-shm"]) {
    try { await remove(demoPath + suffix); } catch { /* inexistants — OK */ }
  }
}

// ─── Storage keys ─────────────────────────────────────────────────────────────

const LS_MODE              = "agrafes.lastMode";
const LS_DB                = "agrafes.lastDbPath";
const LS_PRESETS_GLOBAL    = "agrafes.presets.global";
const LS_PRESETS_PREP      = "agrafes.prep.presets"; // source for migration
const LS_ONBOARDING_STEP   = "agrafes.onboarding.demo.step";  // 0..3
const LS_DB_RECENT         = "agrafes.db.recent";             // MruEntry[]
const LS_CRASH_MARKER      = "agrafes.session.crash_marker";  // ISO timestamp if crashed

const MRU_MAX = 10;
const DEEP_LINK_SCHEME = "agrafes-shell";

// ─── State ────────────────────────────────────────────────────────────────────

type Mode = "home" | "explorer" | "constituer" | "publish";

let _currentMode: Mode = "home";
let _currentDbPath: string | null = null;
let _currentDispose: (() => void) | null = null;
let _navigating = false;
/** After first successful navigation, `_setMode(m)` skips when `m` is already active (avoids full remount on repeated tab clicks). */
let _shellNavReady = false;
let _pendingDbRemount = false;
const _dbListeners: Set<(path: string | null) => void> = new Set();
let _deepLinkUnlisten: (() => void) | null = null;

// ─── ShellContext factory ─────────────────────────────────────────────────────

function _makeContext(): ShellContext {
  return {
    getDbPath() { return _currentDbPath; },
    onDbChange(cb) {
      _dbListeners.add(cb);
      return () => _dbListeners.delete(cb);
    },
  };
}

// ─── Persistence ──────────────────────────────────────────────────────────────

// ─── Session Logger (local-only, no telemetry) ────────────────────────────────

interface LogEntry {
  ts: string;
  level: "info" | "warn" | "error";
  cat: string;
  msg: string;
  detail?: string;
}

const _sessionLog: LogEntry[] = [];
const _SESSION_LOG_MAX = 500;

function _shellLog(level: LogEntry["level"], cat: string, msg: string, detail?: string): void {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    cat,
    msg,
    detail,
  };
  _sessionLog.push(entry);
  if (_sessionLog.length > _SESSION_LOG_MAX) _sessionLog.shift();
  // Console output for debug builds — never send to network
  if (level === "error") console.error(`[AGRAFES:${cat}] ${msg}`, detail ?? "");
  else if (level === "warn") console.warn(`[AGRAFES:${cat}] ${msg}`, detail ?? "");
}

function _formatLog(): string {
  const header = [
    "=== AGRAFES Shell Session Log ===",
    `Generated: ${new Date().toISOString()}`,
    `App version: ${typeof APP_VERSION !== "undefined" ? APP_VERSION : "?"}`,
    `Platform: ${navigator.platform}`,
    `UserAgent: ${navigator.userAgent}`,
    `DB active: ${_currentDbPath ?? "(none)"}`,
    `Last mode: ${_currentMode}`,
    "=".repeat(40),
    "",
  ].join("\n");

  const entries = _sessionLog.map(e =>
    `[${e.ts}] [${e.level.toUpperCase()}] [${e.cat}] ${e.msg}${e.detail ? "\n  " + e.detail : ""}`
  ).join("\n");

  return header + entries;
}

// ── Crash marker ──────────────────────────────────────────────────────────────

function _writeCrashMarker(): void {
  try { localStorage.setItem(LS_CRASH_MARKER, new Date().toISOString()); } catch { /* */ }
}

function _clearCrashMarker(): void {
  try { localStorage.removeItem(LS_CRASH_MARKER); } catch { /* */ }
}

function _readCrashMarker(): string | null {
  try { return localStorage.getItem(LS_CRASH_MARKER); } catch { return null; }
}

// ── Error capture ─────────────────────────────────────────────────────────────

function _installErrorCapture(): void {
  window.onerror = (msg, src, line, col, err) => {
    _shellLog("error", "uncaught", String(msg), `${src}:${line}:${col} — ${err?.stack ?? ""}`);
    return false; // Don't suppress default behavior
  };

  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason instanceof Error
      ? e.reason.message + "\n" + (e.reason.stack ?? "")
      : String(e.reason);
    _shellLog("error", "unhandledrejection", "Unhandled promise rejection", reason);
  });
}

// ── Log export bundle ─────────────────────────────────────────────────────────

async function _exportLogBundle(): Promise<void> {
  _shellLog("info", "log_export", "User requested log bundle export");

  try {
    // Build a plain-text bundle (no zip needed — keeps scope minimal)
    const logText = _formatLog();

    const { save } = await import("@tauri-apps/plugin-dialog");
    const outPath = await save({
      title: "Enregistrer les logs AGRAFES",
      defaultPath: `agrafes-logs-${new Date().toISOString().slice(0, 10)}.txt`,
      filters: [{ name: "Texte", extensions: ["txt"] }],
    });
    if (!outPath) return;

    // Write via Tauri FS API (scoped to user-chosen path only)
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    await writeTextFile(outPath, logText);
    _showToast(`Logs exportés → ${_pathLabel(outPath)}`, 4000);
    _shellLog("info", "log_export", `Logs written to ${outPath}`);
  } catch (err) {
    _showToast(`Erreur export logs : ${String(err)}`, 5000);
    _shellLog("error", "log_export", "Export failed", String(err));
  }
}

// ── Crash recovery banner ─────────────────────────────────────────────────────

function _showCrashRecoveryBanner(crashTs: string): void {
  const banner = document.createElement("div");
  banner.id = "shell-crash-banner";
  banner.style.cssText = [
    "position:fixed;top:0;left:0;right:0;z-index:99998",
    "background:#c0392b;color:#fff;padding:0.5rem 1rem",
    "display:flex;align-items:center;gap:0.75rem;font-size:0.84rem",
    "box-shadow:0 2px 8px rgba(0,0,0,0.25)",
  ].join(";");

  const date = new Date(crashTs);
  const dateStr = Number.isNaN(date.getTime()) ? crashTs : date.toLocaleString();

  banner.innerHTML = `
    <span style="font-size:1.1rem">⚠</span>
    <span><strong>AGRAFES s'est fermé de façon inattendue</strong> (${_esc(dateStr)})</span>
    <button id="crash-export-logs" style="margin-left:auto;background:#fff;color:#c0392b;border:none;border-radius:4px;padding:4px 10px;cursor:pointer;font-weight:600;font-size:0.79rem">
      Exporter logs…
    </button>
    <button id="crash-dismiss" style="background:none;border:1px solid rgba(255,255,255,0.5);border-radius:4px;padding:4px 10px;color:#fff;cursor:pointer;font-size:0.79rem">
      Ignorer
    </button>
  `;

  banner.querySelector("#crash-export-logs")!.addEventListener("click", () => {
    void _exportLogBundle();
  });
  banner.querySelector("#crash-dismiss")!.addEventListener("click", () => {
    banner.remove();
  });

  document.body.prepend(banner);
  _shellLog("warn", "crash_recovery", `Crash detected from previous session: ${crashTs}`);
}

// ─── MRU (Most Recently Used) DB list ────────────────────────────────────────

interface MruEntry {
  path: string;
  label: string;            // basename
  last_opened_at: string;   // ISO timestamp
  pinned?: boolean;
  missing?: boolean;        // set after async file-existence check
}

function _loadMru(): MruEntry[] {
  try {
    return JSON.parse(localStorage.getItem(LS_DB_RECENT) ?? "[]") as MruEntry[];
  } catch { return []; }
}

function _saveMru(list: MruEntry[]): void {
  try { localStorage.setItem(LS_DB_RECENT, JSON.stringify(list)); } catch { /* */ }
}

function _pathLabel(p: string): string {
  return p.replace(/\\/g, "/").split("/").pop() ?? p;
}

function _addToMru(path: string): void {
  const label = _pathLabel(path);
  const now = new Date().toISOString();
  let list = _loadMru().filter(e => e.path !== path);
  list.unshift({ path, label, last_opened_at: now });
  if (list.length > MRU_MAX) list = list.slice(0, MRU_MAX);
  _saveMru(list);
}

function _removeFromMru(path: string): void {
  _saveMru(_loadMru().filter(e => e.path !== path));
}

function _togglePinMru(path: string): void {
  const list = _loadMru().map(e => e.path === path ? { ...e, pinned: !e.pinned } : e);
  _saveMru(list);
}

/** Async: mark entries as missing if file does not exist (best-effort via fetch/open). */
async function _checkMruPaths(): Promise<void> {
  const { exists } = await import("@tauri-apps/plugin-fs").catch(() => ({ exists: null }));
  if (!exists) return;
  const list = _loadMru();
  let changed = false;
  for (const entry of list) {
    try {
      const ok = await exists(entry.path);
      if (entry.missing !== !ok) { entry.missing = !ok; changed = true; }
    } catch { entry.missing = false; }
  }
  if (changed) { _saveMru(list); _rebuildMruMenu(); }
}

/** Rebuild only the MRU section inside the DB menu (without full header rebuild). */
function _rebuildMruMenu(): void {
  const menu = document.getElementById("shell-db-menu");
  if (!menu) return;
  const section = menu.querySelector(".shell-mru-section");
  if (section) section.replaceWith(_buildMruSection());
}

function _buildMruSection(): HTMLElement {
  const list = _loadMru();
  if (list.length === 0) {
    const empty = document.createElement("div");
    empty.className = "shell-mru-section";
    return empty;
  }

  const section = document.createElement("div");
  section.className = "shell-mru-section";

  const sep = document.createElement("div");
  sep.className = "shell-db-menu-sep";
  section.appendChild(sep);

  const heading = document.createElement("div");
  heading.className = "shell-mru-heading";
  heading.textContent = "Récents";
  section.appendChild(heading);

  // Pinned first, then by last_opened_at desc
  const sorted = [...list].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return b.last_opened_at.localeCompare(a.last_opened_at);
  });

  for (const entry of sorted) {
    const row = document.createElement("div");
    row.className = `shell-mru-row${entry.missing ? " missing" : ""}`;

    const nameBtn = document.createElement("button");
    nameBtn.className = "shell-mru-name";
    nameBtn.title = entry.path;
    nameBtn.innerHTML = `${entry.pinned ? "📌 " : ""}${_esc(entry.label)}${entry.missing ? ' <span class="shell-mru-missing-badge">introuvable</span>' : ""}`;
    nameBtn.addEventListener("click", () => {
      _closeDbMenu();
      if (entry.missing) {
        // Re-select via dialog
        void _onChangeDb(entry.path);
      } else {
        void _switchDb(entry.path);
      }
    });
    row.appendChild(nameBtn);

    const actions = document.createElement("div");
    actions.className = "shell-mru-actions";

    const pinBtn = document.createElement("button");
    pinBtn.className = "shell-mru-action";
    pinBtn.title = entry.pinned ? "Désépingler" : "Épingler";
    pinBtn.textContent = entry.pinned ? "📌" : "📍";
    pinBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      _togglePinMru(entry.path);
      _rebuildMruMenu();
    });
    actions.appendChild(pinBtn);

    const delBtn = document.createElement("button");
    delBtn.className = "shell-mru-action";
    delBtn.title = "Retirer des récents";
    delBtn.textContent = "✕";
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      _removeFromMru(entry.path);
      _rebuildMruMenu();
    });
    actions.appendChild(delBtn);

    row.appendChild(actions);
    section.appendChild(row);
  }
  return section;
}

/** Switch to a different DB with loading state + module remount. */
async function _switchDb(path: string): Promise<void> {
  if (path === _currentDbPath) { _closeDbMenu(); return; }

  // Disable nav during switch
  const dbBtn = document.getElementById("shell-db-btn") as HTMLButtonElement | null;
  const tabs = document.querySelectorAll<HTMLButtonElement>(".shell-tab");
  if (dbBtn) { dbBtn.disabled = true; dbBtn.textContent = "Chargement…"; }
  tabs.forEach(t => t.disabled = true);

  _shellLog("info", "db_switch", `Switching DB: ${_pathLabel(path)}`);

  _currentDbPath = path;
  _persist();
  _addToMru(path);
  _updateDbBadge();
  _dbListeners.forEach(cb => cb(_currentDbPath));

  try {
    await _initDb(path);
    _shellLog("info", "db_switch", `DB ready: ${_pathLabel(path)}`);
    if (_currentMode === "home") {
      // Home is stateless — remount immediately (no context to lose).
      _showToast(`DB active : ${_pathLabel(path)}`);
    } else {
      // Non-home module is mounted: defer remount so the user keeps scroll/context.
      // A banner lets them choose when to refresh.
      _pendingDbRemount = true;
      _updateDbBadge(); // shows ⚠ suffix while remount is pending
      _showToast(`DB changée : ${_pathLabel(path)}`);
      _showDbChangeBanner(_pathLabel(path));
    }
  } catch (err) {
    _shellLog("error", "db_switch", `DB init failed: ${_pathLabel(path)}`, String(err));
    throw err;
  } finally {
    if (dbBtn) { dbBtn.disabled = false; dbBtn.textContent = "DB \u25be"; }
    tabs.forEach(t => t.disabled = false);
  }
}

function _loadPersisted(): { mode: Mode; dbPath: string | null } {
  const raw = localStorage.getItem(LS_MODE);
  const mode: Mode = (raw === "explorer" || raw === "constituer" || raw === "home" || raw === "publish")
    ? raw
    : "home";
  const dbPath = localStorage.getItem(LS_DB) ?? null;
  return { mode, dbPath };
}

function _persist(): void {
  localStorage.setItem(LS_MODE, _currentMode);
  if (_currentDbPath) localStorage.setItem(LS_DB, _currentDbPath);
  else localStorage.removeItem(LS_DB);
}

// ─── Deep-link resolution ─────────────────────────────────────────────────────

interface DeepLinkPayload {
  mode: Mode | null;
  dbPath: string | null;
}

function _normalizeMode(raw: string | null | undefined): Mode | null {
  const mode = (raw ?? "").trim().toLowerCase();
  if (mode === "explorer" || mode === "constituer" || mode === "home" || mode === "publish") {
    return mode;
  }
  return null;
}

function _isDbPathCandidate(path: string): boolean {
  return /\.(db|sqlite|sqlite3)$/i.test(path);
}

function _parseOpenDbDeepLink(uri: string): DeepLinkPayload | null {
  try {
    const u = new URL(uri);
    const protocol = u.protocol.toLowerCase();
    if (protocol !== `${DEEP_LINK_SCHEME}:` && protocol !== "agrafes:") return null;

    const hostPath = (u.hostname || u.pathname || "").replace(/^\/+/, "").toLowerCase();
    if (hostPath && hostPath !== "open-db" && hostPath !== "open") return null;

    const dbRaw = (u.searchParams.get("path") ?? u.searchParams.get("db") ?? u.searchParams.get("open_db") ?? "").trim();
    const mode = _normalizeMode(u.searchParams.get("mode"));
    return {
      mode,
      dbPath: dbRaw && _isDbPathCandidate(dbRaw) ? dbRaw : null,
    };
  } catch {
    return null;
  }
}

function _firstDeepLinkPayload(urls: readonly string[]): DeepLinkPayload | null {
  for (const raw of urls) {
    const parsed = _parseOpenDbDeepLink(raw);
    if (parsed && (parsed.dbPath || parsed.mode)) return parsed;
  }
  return null;
}

function _modeFromLocation(): Mode | null {
  // Check location.hash: #explorer, #constituer, #home
  const hashMode = _normalizeMode(location.hash.replace(/^#/, ""));
  if (hashMode) return hashMode;

  // Check ?mode= query param
  const params = new URLSearchParams(location.search);
  const queryMode = _normalizeMode(params.get("mode"));
  if (queryMode) return queryMode;

  return null;
}

function _dbPathFromLocationSearch(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = (params.get("open_db") ?? params.get("db") ?? params.get("path") ?? "").trim();
    if (!raw || !_isDbPathCandidate(raw)) return null;
    return raw;
  } catch {
    return null;
  }
}

async function _resolveStartupDeepLinkPayload(): Promise<DeepLinkPayload> {
  const fromLocation: DeepLinkPayload = {
    mode: _normalizeMode(new URLSearchParams(window.location.search).get("mode")),
    dbPath: _dbPathFromLocationSearch(),
  };
  if (fromLocation.mode || fromLocation.dbPath) return fromLocation;

  try {
    const initialLinks = await getCurrentDeepLinks();
    const fromPlugin = _firstDeepLinkPayload(initialLinks ?? []);
    if (fromPlugin) return fromPlugin;
  } catch {
    // no deep-link payload available at startup (normal path)
  }
  return { mode: null, dbPath: null };
}

async function _initDeepLinkRuntimeListener(): Promise<void> {
  try {
    _deepLinkUnlisten = await onOpenUrl((urls) => {
      const payload = _firstDeepLinkPayload(urls);
      if (!payload || (!payload.mode && !payload.dbPath)) return;

      void (async () => {
        try {
          if (payload.mode && payload.mode !== _currentMode) {
            await _setMode(payload.mode);
          } else if (!payload.mode && _currentMode === "home") {
            await _setMode("explorer");
          }

          if (payload.dbPath) {
            if (payload.dbPath !== _currentDbPath) {
              await _switchDb(payload.dbPath);
            } else {
              _showToast(`DB déjà active : ${_pathLabel(payload.dbPath)}`);
            }
          }
        } catch (err) {
          _shellLog("error", "deep_link", "Runtime deep-link failed", String(err));
        }
      })();
    });
  } catch {
    _deepLinkUnlisten = null;
  }
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export async function initShell(): Promise<void> {
  // ── Crash detection + error capture (before anything else) ──────────────────
  _installErrorCapture();

  const previousCrash = _readCrashMarker();
  _writeCrashMarker(); // write now; cleared on clean shutdown

  _injectCSS();

  _shellLog("info", "boot", `AGRAFES Shell v${APP_VERSION} starting`);

  // ── Restore persisted state ──────────────────────────────────────────────────
  const { mode: savedMode, dbPath: savedDb } = _loadPersisted();
  _currentDbPath = savedDb;
  if (savedDb) _shellLog("info", "boot", `Restored DB: ${_pathLabel(savedDb)}`);

  const startupDeepLink = await _resolveStartupDeepLinkPayload();
  if (startupDeepLink.dbPath) {
    _currentDbPath = startupDeepLink.dbPath;
    _addToMru(startupDeepLink.dbPath);
    _shellLog("info", "boot", `Deep-link DB: ${_pathLabel(startupDeepLink.dbPath)}`);
  }

  // Deep-link overrides saved mode; without a deep link, always start on home
  const deepLinkMode = startupDeepLink.mode ?? _modeFromLocation();
  const startMode: Mode = deepLinkMode ?? "home";

  _buildHeader();
  _installKeyboardShortcuts();
  // Close DB menu and support menu when clicking outside
  document.addEventListener("click", _closeDbMenu);
  document.addEventListener("click", _closeSupportMenu);
  document.body.dataset.mode = startMode;
  await _setMode(startMode);
  await _initDeepLinkRuntimeListener();

  // ── Show crash recovery banner if previous session crashed ───────────────────
  if (previousCrash) {
    // Small delay so the main UI renders first
    setTimeout(() => _showCrashRecoveryBanner(previousCrash), 500);
  }

  // ── Clean shutdown handler ───────────────────────────────────────────────────
  window.addEventListener("beforeunload", () => {
    _deepLinkUnlisten?.();
    _deepLinkUnlisten = null;
    _shellLog("info", "shutdown", "Clean shutdown");
    _clearCrashMarker();
    // Best-effort: ask Rust to POST /shutdown synchronously before the window closes.
    // The Rust SidecarRegistry was updated via register_sidecar on every connection,
    // so even if this invoke doesn't complete, on_window_event(Destroyed) will fire.
    void invoke("shutdown_sidecar_cmd").catch(() => { /* best-effort */ });
  });

  _shellLog("info", "boot", `Started in mode: ${startMode}`);
}

// ─── CSS ──────────────────────────────────────────────────────────────────────

function _injectCSS(): void {
  if (document.getElementById("shell-css")) return;
  const style = document.createElement("style");
  style.id = "shell-css";
  style.textContent = SHELL_CSS;
  document.head.appendChild(style);
}

// ─── Header ───────────────────────────────────────────────────────────────────

// ─── Support menu ─────────────────────────────────────────────────────────────

function _toggleSupportMenu(): void {
  document.getElementById("shell-support-menu")?.classList.toggle("open");
}

function _closeSupportMenu(): void {
  document.getElementById("shell-support-menu")?.classList.remove("open");
}

// ─── Diagnostics modal ────────────────────────────────────────────────────────

function _openDiagnosticsModal(): void {
  const existing = document.getElementById("shell-diag-modal");
  if (existing) { existing.remove(); return; }

  const modal = document.createElement("div");
  modal.id = "shell-diag-modal";
  modal.className = "shell-about-modal"; // reuse overlay style
  modal.innerHTML = `
    <div class="shell-diag-box" role="dialog" aria-modal="true" aria-label="Diagnostic système">
      <div class="shell-diag-header">
        <span class="shell-diag-title">🔍 Diagnostic système</span>
        <button class="shell-about-close" id="shell-diag-close" aria-label="Fermer">✕</button>
      </div>
      <div class="shell-diag-body shell-diag-loading" id="shell-diag-body">
        Collecte des informations…
      </div>
      <div class="shell-diag-footer" id="shell-diag-footer" style="display:none">
        <button class="shell-diag-btn" id="shell-diag-copy">📋 Copier</button>
        <button class="shell-diag-btn shell-diag-btn-primary" id="shell-diag-export">💾 Exporter…</button>
        <button class="shell-diag-btn" id="shell-diag-close2">Fermer</button>
      </div>
    </div>
  `;

  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
  modal.querySelector("#shell-diag-close")!.addEventListener("click", () => modal.remove());
  modal.querySelector("#shell-diag-close2")!.addEventListener("click", () => modal.remove());
  document.body.appendChild(modal);

  const bodyEl = modal.querySelector<HTMLElement>("#shell-diag-body")!;
  const footerEl = modal.querySelector<HTMLElement>("#shell-diag-footer")!;
  let _lastDiagText = "";

  // Close on Escape
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") { modal.remove(); document.removeEventListener("keydown", onKey); }
  };
  document.addEventListener("keydown", onKey);

  // Collect async
  void (async () => {
    try {
      const { collectDiagnostics, formatDiagnosticsText } = await import("./diagnostics.ts");
      const diag = await collectDiagnostics({
        currentDbPath: _currentDbPath,
        sessionLog: _sessionLog,
        logTailLines: 50,
      });
      _lastDiagText = formatDiagnosticsText(diag);
      bodyEl.className = "shell-diag-body";
      bodyEl.textContent = _lastDiagText;
      footerEl.style.display = "";
    } catch (err) {
      bodyEl.className = "shell-diag-body";
      bodyEl.textContent = `Erreur lors de la collecte :\n${String(err)}`;
      footerEl.style.display = "";
      _shellLog("error", "diagnostics", "Diagnostics collection failed", String(err));
    }
  })();

  // Copy button
  modal.querySelector("#shell-diag-copy")!.addEventListener("click", async () => {
    if (!_lastDiagText) return;
    try {
      await navigator.clipboard.writeText(_lastDiagText);
      _showToast("Diagnostic copié dans le presse-papiers", 2500);
    } catch {
      // Fallback: select all in pre
      const range = document.createRange();
      range.selectNodeContents(bodyEl);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      _showToast("Sélectionnez puis copiez (Ctrl/⌘+C)", 3000);
    }
    _shellLog("info", "diagnostics", "Diagnostic text copied to clipboard");
  });

  // Export button
  modal.querySelector("#shell-diag-export")!.addEventListener("click", () => {
    if (!_lastDiagText) return;
    void _exportDiagnosticFile(_lastDiagText);
  });
}

async function _exportDiagnosticFile(text: string): Promise<void> {
  _shellLog("info", "diagnostics", "User requested diagnostic export");
  try {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const outPath = await save({
      title: "Enregistrer le diagnostic AGRAFES",
      defaultPath: `agrafes-diagnostic-${new Date().toISOString().slice(0, 10)}.txt`,
      filters: [{ name: "Texte", extensions: ["txt"] }],
    });
    if (!outPath) return;

    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    await writeTextFile(outPath, text);
    _showToast(`Diagnostic exporté → ${_pathLabel(outPath)}`, 4000);
    _shellLog("info", "diagnostics", `Diagnostic written to ${outPath}`);
  } catch (err) {
    _showToast(`Erreur export diagnostic : ${String(err)}`, 5000);
    _shellLog("error", "diagnostics", "Diagnostic export failed", String(err));
  }
}

// ─── About dialog ─────────────────────────────────────────────────────────────

// Static version info (embedded at build time)
const APP_VERSION = "1.9.4";
const ENGINE_VERSION_DISPLAY = "0.6.1";
const CONTRACT_VERSION_DISPLAY = "1.4.0";
const TEI_PROFILES = ["generic", "parcolab_like", "parcolab_strict"];
const RELEASES_URL = "https://github.com/Hsbtqemy/AGRAFES/releases";

async function _checkUpdates(): Promise<void> {
  _shellLog("info", "updates", `Check updates requested (current: v${APP_VERSION})`);
  _showToast(`Ouverture des Releases… (version locale : v${APP_VERSION})`, 3500);
  try {
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(RELEASES_URL);
  } catch (err) {
    _shellLog("error", "updates", "Failed to open releases page", String(err));
    _showUpdatesErrorModal(RELEASES_URL);
  }
}

function _showUpdatesErrorModal(url: string): void {
  const existing = document.getElementById("shell-updates-modal");
  if (existing) { existing.remove(); return; }

  const modal = document.createElement("div");
  modal.id = "shell-updates-modal";
  modal.className = "shell-about-modal";
  modal.innerHTML = `
    <div class="shell-diag-box" role="dialog" aria-modal="true" style="min-width:360px;max-width:500px">
      <div class="shell-diag-header">
        <span class="shell-diag-title">⬆ Mises à jour</span>
        <button class="shell-about-close" id="shell-upd-close" aria-label="Fermer">✕</button>
      </div>
      <div style="padding:1rem 1.25rem;font-size:0.84rem;color:#2d3748">
        <p>Impossible d'ouvrir le navigateur automatiquement.</p>
        <p style="margin-top:0.5rem">Rendez-vous sur :</p>
        <div style="background:#f0f4ff;border-radius:6px;padding:0.5rem 0.75rem;margin-top:0.5rem;
                    font-family:monospace;font-size:0.78rem;word-break:break-all;user-select:all">
          ${url}
        </div>
        <p style="margin-top:0.5rem;color:#6c757d;font-size:0.76rem">
          Version locale installée : v${APP_VERSION}
        </p>
      </div>
      <div class="shell-diag-footer">
        <button class="shell-diag-btn" id="shell-upd-copy">📋 Copier le lien</button>
        <button class="shell-diag-btn" id="shell-upd-close2">Fermer</button>
      </div>
    </div>
  `;
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
  modal.querySelector("#shell-upd-close")!.addEventListener("click", () => modal.remove());
  modal.querySelector("#shell-upd-close2")!.addEventListener("click", () => modal.remove());
  modal.querySelector("#shell-upd-copy")!.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(url);
      _showToast("Lien copié !", 2000);
    } catch { /* ignore */ }
  });
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") { modal.remove(); document.removeEventListener("keydown", onKey); }
  };
  document.addEventListener("keydown", onKey);
  document.body.appendChild(modal);
}

function _openAboutDialog(): void {
  const existing = document.getElementById("shell-about-modal");
  if (existing) { existing.remove(); return; }

  const dbName = _currentDbPath ? _pathLabel(_currentDbPath) : "(aucune)";

  const modal = document.createElement("div");
  modal.id = "shell-about-modal";
  modal.className = "shell-about-modal";
  modal.innerHTML = `
    <div class="shell-about-box" role="dialog" aria-modal="true" aria-label="À propos d'AGRAFES">
      <button class="shell-about-close" id="shell-about-close" aria-label="Fermer">✕</button>
      <div class="shell-about-title">AGRAFES</div>
      <div class="shell-about-tagline">Atelier de Gestion et de Recherche en Alignement de Corpus</div>
      <table class="shell-about-table">
        <tr><td>App version</td><td>v${APP_VERSION}</td></tr>
        <tr><td>Engine version</td><td>${ENGINE_VERSION_DISPLAY}</td></tr>
        <tr><td>Contract version</td><td>${CONTRACT_VERSION_DISPLAY}</td></tr>
        <tr><td>DB active</td><td>${_esc(dbName)}</td></tr>
      </table>
      <div class="shell-about-profiles">
        Profils TEI supportés : ${TEI_PROFILES.map(p => `<code style="background:#f4f5f7;border-radius:3px;padding:0 4px">${p}</code>`).join(" · ")}
      </div>
      <div style="margin-top:1rem;font-size:0.75rem;color:#adb5bd">
        Docs : RELEASE_CHECKLIST.md · TEI_PROFILE.md · STATUS_TAURI_SHELL.md
      </div>
      <div style="margin-top:0.85rem;border-top:1px solid #eee;padding-top:0.85rem;display:flex;gap:0.5rem;justify-content:flex-end">
        <button id="shell-about-export-logs" style="font-size:0.78rem;padding:4px 12px;border:1px solid #adb5bd;border-radius:4px;background:#f8f9fa;cursor:pointer;color:#495057">
          📋 Exporter logs…
        </button>
      </div>
    </div>
  `;

  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
  modal.querySelector("#shell-about-close")!.addEventListener("click", () => modal.remove());
  modal.querySelector("#shell-about-export-logs")!.addEventListener("click", () => {
    void _exportLogBundle();
  });
  document.body.appendChild(modal);
  // Close on Escape
  const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") { modal.remove(); document.removeEventListener("keydown", onKey); } };
  document.addEventListener("keydown", onKey);
}

// ─── Shortcuts panel ──────────────────────────────────────────────────────────

function _openShortcutsPanel(): void {
  const existing = document.getElementById("shell-shortcuts-modal");
  if (existing) { existing.remove(); return; }

  const isMac = navigator.platform?.startsWith("Mac") ?? false;
  const mod = isMac ? "⌘" : "Ctrl";

  const shortcuts = [
    [`${mod}+1`, "Explorer"],
    [`${mod}+2`, "Constituer"],
    [`${mod}+3`, "Publier"],
    [`${mod}+0`, "Accueil"],
    ["Echap", "Fermer modal / menu"],
    [`${mod}+O`, "Ouvrir une base de données…"],
    [`${mod}+Maj+N`, "Créer une nouvelle base de données…"],
    [`${mod}+/`, "Afficher cette aide"],
  ];

  const modal = document.createElement("div");
  modal.id = "shell-shortcuts-modal";
  modal.className = "shell-about-modal";
  modal.innerHTML = `
    <div class="shell-shortcuts-box" role="dialog" aria-modal="true" aria-label="Raccourcis clavier">
      <button class="shell-about-close" id="shell-shortcuts-close" aria-label="Fermer">✕</button>
      <div class="shell-about-title" style="font-size:1.05rem;margin-bottom:1rem">⌨ Raccourcis clavier</div>
      <table class="shell-shortcuts-table">
        ${shortcuts.map(([k, d]) => `<tr><td>${_esc(k)}</td><td>${_esc(d)}</td></tr>`).join("")}
      </table>
      <div style="margin-top:0.85rem;font-size:0.75rem;color:#adb5bd">
        Les raccourcis numériques fonctionnent également sans modificateur depuis l'accueil.
      </div>
    </div>
  `;

  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
  modal.querySelector("#shell-shortcuts-close")!.addEventListener("click", () => modal.remove());
  document.body.appendChild(modal);
  const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") { modal.remove(); document.removeEventListener("keydown", onKey); } };
  document.addEventListener("keydown", onKey);
}

function _buildHeader(): void {
  const header = document.getElementById("shell-header")!;
  header.innerHTML = "";

  // Brand — click goes home (does NOT reset DB)
  const brand = document.createElement("span");
  brand.className = "shell-brand";
  brand.textContent = "AGRAFES";
  brand.addEventListener("click", () => _setMode("home"));
  header.appendChild(brand);

  // Tabs
  const tabs = document.createElement("div");
  tabs.className = "shell-tabs";
  tabs.appendChild(_makeTab("Explorer",   "⌘1", "explorer"));
  tabs.appendChild(_makeTab("Constituer", "⌘2", "constituer"));
  header.appendChild(tabs);

  // Presets button
  const presetsBtn = document.createElement("button");
  presetsBtn.className = "shell-presets-btn";
  presetsBtn.textContent = "⚙ Presets";
  presetsBtn.title = "Gérer les presets globaux (langues, alignement, curation)";
  presetsBtn.addEventListener("click", () => _openPresetsModal());
  tabs.appendChild(presetsBtn);

  // Shortcuts button
  const shortcutsBtn = document.createElement("button");
  shortcutsBtn.className = "shell-shortcuts-btn";
  shortcutsBtn.textContent = "⌨";
  shortcutsBtn.title = "Raccourcis clavier";
  shortcutsBtn.setAttribute("aria-label", "Afficher les raccourcis clavier");
  shortcutsBtn.addEventListener("click", () => _openShortcutsPanel());
  tabs.appendChild(shortcutsBtn);

  // About button
  const aboutBtn = document.createElement("button");
  aboutBtn.className = "shell-about-btn";
  aboutBtn.textContent = "ⓘ";
  aboutBtn.title = "À propos d'AGRAFES";
  aboutBtn.setAttribute("aria-label", "À propos d'AGRAFES");
  aboutBtn.addEventListener("click", () => _openAboutDialog());
  tabs.appendChild(aboutBtn);

  // Support menu ("?" dropdown)
  const supportWrap = document.createElement("div");
  supportWrap.className = "shell-support-wrap";

  const supportBtn = document.createElement("button");
  supportBtn.className = "shell-support-btn";
  supportBtn.id = "shell-support-btn";
  supportBtn.textContent = "?";
  supportBtn.title = "Aide & Support";
  supportBtn.setAttribute("aria-label", "Aide & Support");
  supportBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    _toggleSupportMenu();
  });
  supportWrap.appendChild(supportBtn);

  const supportMenu = document.createElement("div");
  supportMenu.className = "shell-support-menu";
  supportMenu.id = "shell-support-menu";

  const _mkSupportItem = (label: string, action: () => void): HTMLButtonElement => {
    const btn = document.createElement("button");
    btn.className = "shell-support-menu-item";
    btn.textContent = label;
    btn.addEventListener("click", () => { _closeSupportMenu(); action(); });
    return btn;
  };

  supportMenu.appendChild(_mkSupportItem("🔍 Diagnostic système…", () => _openDiagnosticsModal()));
  supportMenu.appendChild(_mkSupportItem("📋 Exporter logs…", () => void _exportLogBundle()));
  supportMenu.appendChild(_mkSupportItem("⬆ Vérifier les mises à jour…", () => void _checkUpdates()));
  supportMenu.appendChild((() => { const s = document.createElement("div"); s.className = "shell-support-menu-sep"; return s; })());
  supportMenu.appendChild(_mkSupportItem("ⓘ À propos d'AGRAFES…", () => _openAboutDialog()));
  supportMenu.appendChild(_mkSupportItem("⌨ Raccourcis clavier…", () => _openShortcutsPanel()));

  supportWrap.appendChild(supportMenu);
  tabs.appendChild(supportWrap);

  // DB zone (right-aligned via margin-left:auto in CSS)
  const dbZone = document.createElement("div");
  dbZone.className = "shell-db-zone";

  const badge = document.createElement("span");
  badge.id = "shell-db-badge";
  badge.className = "shell-db-badge";
  badge.textContent = _dbBadgeText();
  dbZone.appendChild(badge);

  // Dropdown menu: Ouvrir… / Créer…
  const menuWrap = document.createElement("div");
  menuWrap.className = "shell-db-menu-wrap";

  const menuTrigger = document.createElement("button");
  menuTrigger.id = "shell-db-btn";
  menuTrigger.className = "shell-db-btn";
  menuTrigger.textContent = "DB \u25be";
  menuTrigger.addEventListener("click", (e) => { e.stopPropagation(); _toggleDbMenu(); });
  menuWrap.appendChild(menuTrigger);

  const menu = document.createElement("div");
  menu.id = "shell-db-menu";
  menu.className = "shell-db-menu";

  const itemOpen = document.createElement("button");
  itemOpen.className = "shell-db-menu-item";
  itemOpen.textContent = "Ouvrir\u2026";
  itemOpen.addEventListener("click", () => { _closeDbMenu(); void _onChangeDb(); });

  const sep = document.createElement("div");
  sep.className = "shell-db-menu-sep";

  const itemCreate = document.createElement("button");
  itemCreate.className = "shell-db-menu-item";
  itemCreate.textContent = "Cr\u00e9er\u2026";
  itemCreate.addEventListener("click", () => { _closeDbMenu(); void _onCreateDb(); });

  menu.appendChild(itemOpen);
  menu.appendChild(sep);
  menu.appendChild(itemCreate);

  // MRU section (appended to menu, rebuilt async)
  menu.appendChild(_buildMruSection());

  menuWrap.appendChild(menu);
  dbZone.appendChild(menuWrap);

  // Async: check if MRU paths still exist
  void _checkMruPaths();

  header.appendChild(dbZone);
}

function _makeTab(label: string, shortcut: string, mode: Mode): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = "shell-tab";
  btn.dataset.mode = mode;
  btn.innerHTML = `${label}<span class="shell-tab-badge">${shortcut}</span>`;
  btn.addEventListener("click", () => _setMode(mode));
  return btn;
}

function _updateHeaderTabs(mode: Mode): void {
  document.querySelectorAll(".shell-tab").forEach((btn) => {
    const el = btn as HTMLElement;
    el.classList.toggle("active", el.dataset.mode === mode);
  });
}

function _dbBadgeText(): string {
  if (!_currentDbPath) return "DB: (aucune)";
  const parts = _currentDbPath.replace(/\\/g, "/").split("/");
  const name = parts[parts.length - 1];
  // ⚠ suffix persists while a DB change is pending (banner "Plus tard" dismissed).
  return _pendingDbRemount ? `DB: ${name} ⚠` : `DB: ${name}`;
}

function _updateDbBadge(): void {
  const badge = document.getElementById("shell-db-badge");
  if (!badge) return;
  badge.textContent = _dbBadgeText();
  if (_pendingDbRemount) {
    badge.classList.add("shell-db-badge--pending");
    badge.title = "DB modifiée — cliquez l'onglet actif ou « Rafraîchir » pour appliquer";
  } else {
    badge.classList.remove("shell-db-badge--pending");
    badge.title = "";
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function _escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ─── DB menu helpers ──────────────────────────────────────────────────────────

function _toggleDbMenu(): void {
  document.getElementById("shell-db-menu")?.classList.toggle("open");
}

function _closeDbMenu(): void {
  document.getElementById("shell-db-menu")?.classList.remove("open");
}

// ─── DB change / create ───────────────────────────────────────────────────────

async function _onCreateDb(): Promise<void> {
  let savePath: string | null;
  try {
    savePath = await dialogSave({
      title: "Créer une nouvelle base de données AGRAFES",
      filters: [{ name: "SQLite", extensions: ["db"] }],
      defaultPath: "nouveau_corpus.db",
    });
  } catch {
    return;
  }
  if (!savePath) return;

  // Ensure .db extension
  if (!/\.(db|sqlite|sqlite3)$/i.test(savePath)) savePath += ".db";

  _currentDbPath = savePath;
  _persist();
  _addToMru(savePath);
  _updateDbBadge();
  _dbListeners.forEach(cb => cb(_currentDbPath));
  _closeDbMenu();

  // Immediate sidecar init (starts sidecar + applies migrations)
  await _initDb(savePath);

  // Re-mount if module active so module uses the new DB
  if (_currentMode !== "home") {
    await _setMode(_currentMode, { force: true });
  }
}

// ─── DB immediate init ────────────────────────────────────────────────────────

async function _initDb(dbPath: string): Promise<void> {
  const btn = document.getElementById("shell-db-btn") as HTMLButtonElement | null;
  if (btn) { btn.textContent = "Initialisation\u2026"; btn.disabled = true; }
  _clearInitError();
  _showSidecarOverlay("Démarrage du moteur de recherche\u2026");

  try {
    // Dynamic import keeps sidecar logic in the explorer chunk (lazy-loaded)
    const { ensureRunning } = await import("../../tauri-app/src/lib/sidecarClient.ts");
    await ensureRunning(dbPath);
    _hideSidecarOverlay();
    _showToast("DB initialis\u00e9e \u2713", 3000);
    _shellLog("info", "sidecar", `Sidecar healthy for DB: ${_pathLabel(dbPath)}`);
  } catch (err) {
    _hideSidecarOverlay();
    _shellLog("error", "sidecar", `Sidecar health failure for DB: ${_pathLabel(dbPath)}`, String(err));
    _showInitError(dbPath, String(err));
  } finally {
    if (btn) { btn.textContent = "DB \u25be"; btn.disabled = false; }
  }
}

function _showInitError(dbPath: string, errorMsg: string): void {
  _clearInitError();

  const banner = document.createElement("div");
  banner.id = "shell-init-error";
  banner.className = "shell-init-error";

  const icon = document.createElement("span");
  icon.className = "shell-init-error-icon";
  icon.textContent = "\u26a0";

  const msg = document.createElement("span");
  msg.className = "shell-init-error-msg";
  msg.textContent = "Impossible d\u2019initialiser la DB";

  const detail = document.createElement("code");
  detail.className = "shell-init-error-detail";
  detail.textContent = errorMsg;

  const btns = document.createElement("div");
  btns.className = "shell-init-error-btns";

  const retryBtn = document.createElement("button");
  retryBtn.className = "shell-db-btn";
  retryBtn.textContent = "R\u00e9essayer";
  retryBtn.addEventListener("click", () => { _clearInitError(); void _initDb(dbPath); });

  const changeBtn = document.createElement("button");
  changeBtn.className = "shell-db-btn";
  changeBtn.textContent = "Choisir un autre fichier\u2026";
  changeBtn.addEventListener("click", () => { _clearInitError(); void _onCreateDb(); });

  const dismissBtn = document.createElement("button");
  dismissBtn.className = "shell-db-btn";
  dismissBtn.textContent = "\u2715";
  dismissBtn.title = "Fermer";
  dismissBtn.addEventListener("click", _clearInitError);

  btns.appendChild(retryBtn);
  btns.appendChild(changeBtn);
  btns.appendChild(dismissBtn);

  banner.appendChild(icon);
  banner.appendChild(msg);
  banner.appendChild(detail);
  banner.appendChild(btns);
  document.body.appendChild(banner);
}

function _clearInitError(): void {
  document.getElementById("shell-init-error")?.remove();
}

// ─── DB change banner (P4-2) ─────────────────────────────────────────────────

/**
 * Show a non-blocking sticky banner informing the user that the active DB
 * has changed and offering to refresh (remount) the current module.
 * The banner is dismissed on any module navigation (_setMode clears it).
 */
function _showDbChangeBanner(dbLabel: string): void {
  _clearDbChangeBanner();

  const banner = document.createElement("div");
  banner.id = "shell-db-change-banner";
  banner.className = "shell-db-change-banner";
  banner.setAttribute("role", "status");
  banner.setAttribute("aria-live", "polite");

  const icon = document.createElement("span");
  icon.className = "shell-db-change-banner-icon";
  icon.textContent = "🔄";

  const msg = document.createElement("span");
  msg.className = "shell-db-change-banner-msg";
  msg.textContent = "DB changée :";

  const name = document.createElement("span");
  name.className = "shell-db-change-banner-name";
  name.title = dbLabel;
  name.textContent = dbLabel;

  const hint = document.createElement("span");
  hint.style.cssText = "color:#3a7ab5;font-size:0.78rem;";
  hint.textContent = "— rafraîchir le module pour l'appliquer";

  const btns = document.createElement("div");
  btns.className = "shell-db-change-banner-btns";

  const refreshBtn = document.createElement("button");
  refreshBtn.className = "shell-db-change-banner-btn primary";
  refreshBtn.textContent = "Rafraîchir maintenant";
  refreshBtn.addEventListener("click", () => {
    _clearDbChangeBanner();
    _pendingDbRemount = false;
    void _setMode(_currentMode, { force: true });
  });

  const laterBtn = document.createElement("button");
  laterBtn.className = "shell-db-change-banner-btn dismiss";
  laterBtn.textContent = "Plus tard";
  laterBtn.title = "La DB sera appliquée à la prochaine navigation";
  laterBtn.addEventListener("click", () => {
    _clearDbChangeBanner();
    // _pendingDbRemount stays true — will be applied on next _setMode
  });

  const dismissBtn = document.createElement("button");
  dismissBtn.className = "shell-db-change-banner-btn dismiss";
  dismissBtn.textContent = "✕";
  dismissBtn.title = "Ignorer";
  dismissBtn.setAttribute("aria-label", "Fermer ce bandeau");
  dismissBtn.addEventListener("click", () => {
    _clearDbChangeBanner();
    _pendingDbRemount = false;
    _updateDbBadge(); // remove ⚠ suffix — user explicitly dismissed the change
  });

  btns.appendChild(refreshBtn);
  btns.appendChild(laterBtn);
  btns.appendChild(dismissBtn);

  banner.appendChild(icon);
  banner.appendChild(msg);
  banner.appendChild(name);
  banner.appendChild(hint);
  banner.appendChild(btns);
  document.body.appendChild(banner);
}

function _clearDbChangeBanner(): void {
  document.getElementById("shell-db-change-banner")?.remove();
}

async function _onChangeDb(defaultPath?: string): Promise<void> {
  let picked: string | string[] | null;
  try {
    picked = await dialogOpen({
      title: "Ouvrir une base de données SQLite",
      filters: [{ name: "SQLite", extensions: ["db", "sqlite", "sqlite3"] }],
      multiple: false,
      defaultPath: defaultPath,
    });
  } catch (err) {
    console.warn("[shell] dialog cancelled or failed:", err);
    return;
  }

  const newPath = Array.isArray(picked) ? picked[0] : picked;
  if (!newPath) return;

  await _switchDb(newPath);
}

// ─── Router / lifecycle ───────────────────────────────────────────────────────

const _MODE_TITLES: Record<Mode, string> = {
  home:       "AGRAFES",
  explorer:   "AGRAFES — Explorer",
  constituer: "AGRAFES — Constituer",
  publish:    "AGRAFES — Publier",
};

function _updateDocTitle(mode: Mode): void {
  document.title = _MODE_TITLES[mode] ?? "AGRAFES";
}

async function _setMode(mode: Mode, opts?: { force?: boolean }): Promise<void> {
  if (_navigating) return;
  if (_shellNavReady && mode === _currentMode && !opts?.force) return;
  _navigating = true;

  // Any navigation clears the DB-change banner and the pending-remount flag.
  _clearDbChangeBanner();
  _pendingDbRemount = false;
  _updateDbBadge(); // remove ⚠ suffix now that remount has occurred

  _shellLog("info", "navigation", `Navigate: ${_currentMode} → ${mode}`);

  _currentMode = mode;
  document.body.dataset.mode = mode;
  _updateHeaderTabs(mode);
  _updateDocTitle(mode);
  _persist();

  // Dispose current module (best-effort)
  try { _currentDispose?.(); } catch { /* ignore */ }
  _currentDispose = null;

  try {
    if (mode === "home") {
      _renderHome(_freshContainer());
      return;
    }

    _showLoading(_freshContainer());
    const ctx = _makeContext();

    if (mode === "explorer") {
      const mod = await import("./modules/explorerModule.ts");
      const fresh = _freshContainer();
      await mod.mount(fresh, ctx);
      _currentDispose = () => mod.dispose();
    } else if (mode === "publish") {
      const fresh = _freshContainer();
      await _renderPublicationWizard(fresh);
    } else {
      const mod = await import("./modules/constituerModule.ts");
      _freshContainer(); // swap out spinner; prep finds #app by id
      await mod.mount(document.getElementById("app")!, ctx);
      _currentDispose = () => mod.dispose();
    }
  } catch (err) {
    console.error("[shell] navigation error:", err);
    const c = document.getElementById("app");
    if (c) c.innerHTML = `<div style="padding:2rem;color:#c0392b">Erreur de chargement du module.<br><code>${String(err)}</code></div>`;
  } finally {
    _navigating = false;
    _shellNavReady = true;
  }
}

/** Replace #app with a new empty div#app — breaks all DOM event listeners on old element. */
function _freshContainer(): HTMLElement {
  const old = document.getElementById("app")!;
  const fresh = document.createElement("div");
  fresh.id = "app";
  fresh.style.paddingTop = "44px";
  fresh.style.minHeight = "100vh";
  old.replaceWith(fresh);
  return fresh;
}

// ─── Global Presets Store ─────────────────────────────────────────────────────

interface GlobalPreset {
  id: string;
  name: string;
  description?: string;
  languages?: string[];
  pivot_language?: string;
  alignment_strategy?: string;
  curation_preset?: string;
  created_at: number;
}

function _loadGlobalPresets(): GlobalPreset[] {
  try {
    const raw = localStorage.getItem(LS_PRESETS_GLOBAL);
    return raw ? (JSON.parse(raw) as GlobalPreset[]) : [];
  } catch { return []; }
}

function _saveGlobalPresets(presets: GlobalPreset[]): void {
  try { localStorage.setItem(LS_PRESETS_GLOBAL, JSON.stringify(presets)); } catch { /* */ }
}

/** Migrate presets from tauri-prep's store into global store (additive, no overwrite). */
function _migratePresetsFromPrep(): number {
  try {
    const raw = localStorage.getItem(LS_PRESETS_PREP);
    if (!raw) return 0;
    const prepPresets = JSON.parse(raw) as GlobalPreset[];
    const existing = _loadGlobalPresets();
    const existingIds = new Set(existing.map(p => p.id));
    const toAdd = prepPresets.filter(p => !existingIds.has(p.id));
    if (toAdd.length === 0) return 0;
    _saveGlobalPresets([...existing, ...toAdd]);
    return toAdd.length;
  } catch { return 0; }
}

function _openPresetsModal(): void {
  const existing = document.getElementById("shell-presets-overlay");
  if (existing) { existing.remove(); return; }

  const overlay = document.createElement("div");
  overlay.id = "shell-presets-overlay";
  overlay.style.cssText = [
    "position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:50000",
    "display:flex;align-items:center;justify-content:center",
  ].join(";");

  const modal = document.createElement("div");
  modal.style.cssText = [
    "background:#fff;border-radius:10px;width:540px;max-width:95vw;max-height:80vh",
    "display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,0.22)",
  ].join(";");

  const _refresh = (): void => {
    const presets = _loadGlobalPresets();
    listEl.innerHTML = presets.length === 0
      ? `<p style="color:#6c757d;font-size:0.85rem;padding:0.5rem 0">Aucun preset global. Créez-en dans Constituer (tab Actions) puis migrez ici.</p>`
      : presets.map(p => `
          <div class="shell-preset-row" data-id="${p.id}" style="display:flex;align-items:center;gap:0.5rem;padding:0.4rem 0;border-bottom:1px solid #eee;font-size:0.83rem">
            <div style="flex:1">
              <span style="font-weight:600">${_esc(p.name)}</span>
              ${p.description ? `<span style="color:#6c757d;margin-left:0.4rem">${_esc(p.description)}</span>` : ""}
              <div style="font-size:0.75rem;color:#adb5bd">
                ${p.languages?.join(", ") ?? ""}${p.alignment_strategy ? ` · ${p.alignment_strategy}` : ""}
              </div>
            </div>
            <button class="shell-preset-del" data-id="${p.id}" style="border:none;background:none;color:#c0392b;cursor:pointer;font-size:0.95rem;padding:2px 5px" title="Supprimer">✕</button>
          </div>
        `).join("");
    listEl.querySelectorAll(".shell-preset-del").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const id = (e.currentTarget as HTMLElement).dataset.id!;
        const updated = _loadGlobalPresets().filter(p => p.id !== id);
        _saveGlobalPresets(updated);
        _refresh();
      });
    });
  };

  modal.innerHTML = `
    <div style="display:flex;align-items:center;padding:1rem 1.2rem;border-bottom:1px solid #eee">
      <h3 style="margin:0;font-size:1rem;font-weight:700;flex:1">Presets globaux</h3>
      <button id="shell-presets-close" style="border:none;background:none;cursor:pointer;font-size:1.2rem;color:#6c757d">✕</button>
    </div>
    <div style="flex:1;overflow-y:auto;padding:0.75rem 1.2rem">
      <div id="shell-preset-list"></div>
    </div>
    <div style="padding:0.75rem 1.2rem;border-top:1px solid #eee;display:flex;gap:0.5rem;flex-wrap:wrap">
      <button id="shell-presets-migrate" style="font-size:0.8rem;padding:5px 10px;border:1px solid #adb5bd;border-radius:5px;background:#f8f9fa;cursor:pointer">
        ↓ Migrer depuis Constituer
      </button>
      <button id="shell-presets-export" style="font-size:0.8rem;padding:5px 10px;border:1px solid #adb5bd;border-radius:5px;background:#f8f9fa;cursor:pointer">
        ↑ Exporter JSON
      </button>
      <label id="shell-presets-import-label" style="font-size:0.8rem;padding:5px 10px;border:1px solid #adb5bd;border-radius:5px;background:#f8f9fa;cursor:pointer">
        ↓ Importer JSON
        <input id="shell-presets-import-file" type="file" accept=".json" style="display:none">
      </label>
    </div>
  `;

  const listEl = modal.querySelector<HTMLElement>("#shell-preset-list")!;
  _refresh();

  modal.querySelector("#shell-presets-close")!.addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

  modal.querySelector("#shell-presets-migrate")!.addEventListener("click", () => {
    const n = _migratePresetsFromPrep();
    _showToast(n > 0 ? `${n} preset(s) migré(s) depuis Constituer` : "Aucun nouveau preset à migrer");
    _refresh();
  });

  modal.querySelector("#shell-presets-export")!.addEventListener("click", () => {
    const presets = _loadGlobalPresets();
    const blob = new Blob([JSON.stringify(presets, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `agrafes_presets_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  });

  modal.querySelector("#shell-presets-import-file")!.addEventListener("change", (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(reader.result as string) as GlobalPreset[];
        const existing = _loadGlobalPresets();
        const existingIds = new Set(existing.map(p => p.id));
        const toAdd = imported.filter(p => p.id && p.name && !existingIds.has(p.id));
        _saveGlobalPresets([...existing, ...toAdd]);
        _showToast(`${toAdd.length} preset(s) importé(s)`);
        _refresh();
      } catch { _showToast("Fichier JSON invalide", 3000); }
    };
    reader.readAsText(file);
  });

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

function _esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ─── Publication Wizard ───────────────────────────────────────────────────────

type WizardStep = 1 | 2 | 3 | 4 | 5;

interface WizardState {
  dbPath: string;
  docIds: number[] | null;       // null = all docs
  docs: Array<{ doc_id: number; title: string; language: string }>;
  includeStructure: boolean;
  includeAlignment: boolean;
  statusFilter: string[];
  teiProfile: "generic" | "parcolab_like" | "parcolab_strict";
  qaPolicy: "lenient" | "strict";
  step: WizardStep;
  jobId: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
}

async function _renderPublicationWizard(container: HTMLElement): Promise<void> {
  if (!_currentDbPath) {
    container.innerHTML = `
      <div style="padding:2rem;text-align:center;color:#c0392b">
        <p>Aucune base de données sélectionnée.</p>
        <button onclick="history.back()" style="padding:6px 14px;border-radius:5px;border:1px solid #adb5bd;background:#f8f9fa;cursor:pointer;margin-top:1rem">← Retour</button>
      </div>`;
    return;
  }

  const state: WizardState = {
    dbPath: _currentDbPath,
    docIds: null,
    docs: [],
    includeStructure: false,
    includeAlignment: false,
    statusFilter: ["accepted"],
    teiProfile: "generic",
    qaPolicy: "lenient",
    step: 1,
    jobId: null,
    result: null,
    error: null,
  };

  const wrap = document.createElement("div");
  wrap.style.cssText = "max-width:700px;margin:2rem auto;padding:0 1rem;font-family:inherit";

  // Progress bar
  const renderProgress = (step: WizardStep): string => {
    const steps = ["DB", "Documents", "Options", "Exporter", "Résumé"];
    return `<div style="display:flex;gap:0;margin-bottom:1.5rem;border-radius:6px;overflow:hidden;border:1px solid #dde1e8">
      ${steps.map((s, i) => {
        const n = (i + 1) as WizardStep;
        const active = n === step;
        const done = n < step;
        const bg = done ? "#1a7f4e" : active ? "#2c5f9e" : "#f8f9fa";
        const color = (done || active) ? "#fff" : "#6c757d";
        return `<div style="flex:1;padding:0.5rem;text-align:center;background:${bg};color:${color};font-size:0.78rem;font-weight:${active ? 700 : 400};border-right:1px solid #dde1e8">${done ? "✓ " : ""}${s}</div>`;
      }).join("")}
    </div>`;
  };

  const render = async (): Promise<void> => {
    wrap.innerHTML = `
      <h2 style="font-size:1.3rem;font-weight:700;margin:0 0 1rem;color:#1a1a2e">
        📦 Assistant de publication
      </h2>
      ${renderProgress(state.step)}
      <div id="wizard-body"></div>
    `;

    const body = wrap.querySelector<HTMLElement>("#wizard-body")!;

    if (state.step === 1) {
      body.innerHTML = `
        <div style="background:#fff;border-radius:8px;border:1px solid #dde1e8;padding:1.5rem">
          <h3 style="margin:0 0 1rem;font-size:1rem">Base de données</h3>
          <p style="background:#f0fff4;border:1px solid #c6efce;border-radius:5px;padding:0.6rem 0.9rem;font-size:0.85rem;color:#1a7f4e;font-family:ui-monospace,monospace;word-break:break-all">
            ✓ ${_esc(state.dbPath)}
          </p>
          <div style="margin-top:1rem;display:flex;justify-content:flex-end">
            <button id="wiz-next1" class="wiz-btn-primary">Suivant → Documents</button>
          </div>
        </div>`;
      body.querySelector("#wiz-next1")!.addEventListener("click", async () => {
        state.step = 2;
        // Load docs
        try {
          const { ensureRunning, listDocuments } = await import("../../tauri-app/src/lib/sidecarClient.ts");
          const conn = await ensureRunning(state.dbPath);
          state.docs = (await listDocuments(conn)) as WizardState["docs"];
        } catch (e) {
          state.error = String(e);
        }
        await render();
      });

    } else if (state.step === 2) {
      const allOpt = `<option value="__all__" selected>— Tous les documents (${state.docs.length}) —</option>`;
      const docOpts = state.docs.map(d =>
        `<option value="${d.doc_id}">#${d.doc_id} ${_esc(d.title)} (${_esc(d.language)})</option>`
      ).join("");
      body.innerHTML = `
        <div style="background:#fff;border-radius:8px;border:1px solid #dde1e8;padding:1.5rem">
          <h3 style="margin:0 0 0.75rem;font-size:1rem">Sélection des documents</h3>
          ${state.error ? `<p style="color:#c0392b;font-size:0.83rem">${_esc(state.error)}</p>` : ""}
          <label style="font-size:0.84rem">Documents à inclure
            <select id="wiz-doc-sel" multiple style="display:block;width:100%;height:140px;margin-top:0.3rem;border:1px solid #dde1e8;border-radius:5px;padding:0.3rem">
              ${allOpt}${docOpts}
            </select>
          </label>
          <p style="font-size:0.77rem;color:#6c757d;margin-top:0.3rem">Ctrl+clic pour sélection multiple. Laisser "Tous" pour exporter l'ensemble.</p>
          <div style="margin-top:1rem;display:flex;justify-content:space-between">
            <button id="wiz-back2" class="wiz-btn-sec">← Retour</button>
            <button id="wiz-next2" class="wiz-btn-primary">Suivant → Options</button>
          </div>
        </div>`;
      body.querySelector("#wiz-back2")!.addEventListener("click", () => { state.step = 1; void render(); });
      body.querySelector("#wiz-next2")!.addEventListener("click", () => {
        const sel = body.querySelector<HTMLSelectElement>("#wiz-doc-sel")!;
        const vals = Array.from(sel.selectedOptions).map(o => o.value);
        state.docIds = vals.includes("__all__") ? null : vals.map(Number);
        state.step = 3;
        void render();
      });

    } else if (state.step === 3) {
      const docLabel = state.docIds === null
        ? `Tous (${state.docs.length}) documents`
        : `${state.docIds.length} document(s) sélectionné(s)`;
      body.innerHTML = `
        <div style="background:#fff;border-radius:8px;border:1px solid #dde1e8;padding:1.5rem">
          <h3 style="margin:0 0 0.75rem;font-size:1rem">Options d'export</h3>
          <p style="font-size:0.82rem;color:#6c757d;margin:0 0 1rem">Portée: <strong>${_esc(docLabel)}</strong></p>
          <div style="display:flex;flex-direction:column;gap:0.6rem;font-size:0.84rem">
            <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer">
              <input type="checkbox" id="wiz-include-struct" ${state.includeStructure ? "checked" : ""}>
              Inclure les unités structurelles (<code>&lt;head&gt;</code>) dans le TEI
            </label>
            <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer">
              <input type="checkbox" id="wiz-include-align" ${state.includeAlignment ? "checked" : ""}>
              Inclure les alignements (<code>&lt;linkGrp&gt;</code>)
            </label>
            <label style="display:flex;align-items:center;gap:0.5rem">
              Filtre de statut des alignements:
              <select id="wiz-status-filter" style="padding:3px 6px;border:1px solid #dde1e8;border-radius:4px">
                <option value="accepted" ${state.statusFilter.includes("accepted") && state.statusFilter.length === 1 ? "selected" : ""}>accepted seulement</option>
                <option value="accepted_unreviewed" ${state.statusFilter.length > 1 ? "selected" : ""}>accepted + non-révisés</option>
                <option value="all">tous</option>
              </select>
            </label>
            <label style="display:flex;align-items:center;gap:0.5rem">
              Profil TEI:
              <select id="wiz-tei-profile" style="padding:3px 6px;border:1px solid #dde1e8;border-radius:4px">
              <option value="generic" ${state.teiProfile === "generic" ? "selected" : ""}>Generic</option>
              <option value="parcolab_like" ${state.teiProfile === "parcolab_like" ? "selected" : ""}>ParCoLab-like (enrichi)</option>
              <option value="parcolab_strict" ${state.teiProfile === "parcolab_strict" ? "selected" : ""}>ParCoLab strict (expert) ⚠</option>
              </select>
            </label>
            <label style="display:flex;align-items:center;gap:0.5rem">
              Politique QA:
              <select id="wiz-qa-policy" style="padding:3px 6px;border:1px solid #dde1e8;border-radius:4px">
                <option value="lenient" ${state.qaPolicy === "lenient" ? "selected" : ""}>Lenient (défaut)</option>
                <option value="strict" ${state.qaPolicy === "strict" ? "selected" : ""}>Strict (expert)</option>
              </select>
              <span title="Lenient: seules les erreurs critiques bloquent. Strict: collisions, trous et métadonnées optionnelles manquantes bloquent aussi." style="color:#6c757d;cursor:help;font-size:0.9rem">ⓘ</span>
            </label>
          </div>
          <div style="margin-top:1.25rem;display:flex;justify-content:space-between">
            <button id="wiz-back3" class="wiz-btn-sec">← Retour</button>
            <button id="wiz-next3" class="wiz-btn-primary">Suivant → Exporter</button>
          </div>
        </div>`;
      body.querySelector("#wiz-back3")!.addEventListener("click", () => { state.step = 2; void render(); });
      body.querySelector("#wiz-next3")!.addEventListener("click", () => {
        state.includeStructure = (body.querySelector<HTMLInputElement>("#wiz-include-struct")!).checked;
        state.includeAlignment = (body.querySelector<HTMLInputElement>("#wiz-include-align")!).checked;
        const sf = (body.querySelector<HTMLSelectElement>("#wiz-status-filter")!).value;
        state.statusFilter = sf === "accepted" ? ["accepted"]
          : sf === "accepted_unreviewed" ? ["accepted", "unreviewed"]
          : ["all"];
        const profileSel = body.querySelector<HTMLSelectElement>("#wiz-tei-profile");
        const profileVal = profileSel?.value ?? "generic";
        state.teiProfile = profileVal === "parcolab_like" ? "parcolab_like"
          : profileVal === "parcolab_strict" ? "parcolab_strict" : "generic";
        const policyVal = (body.querySelector<HTMLSelectElement>("#wiz-qa-policy")?.value) ?? "lenient";
        state.qaPolicy = policyVal === "strict" ? "strict" : "lenient";
        // Suggest strict policy if parcolab_strict profile chosen
        if (state.teiProfile === "parcolab_strict" && state.qaPolicy !== "strict") {
          _showToast("Conseil : le profil ParCoLab strict recommande la politique QA Strict pour bloquer à l'export si métadonnées incomplètes.", 6000);
        }
        state.step = 4;
        void render();
      });

    } else if (state.step === 4) {
      const docLabel = state.docIds === null
        ? `Tous (${state.docs.length}) documents`
        : `${state.docIds.length} document(s)`;
      body.innerHTML = `
        <div style="background:#fff;border-radius:8px;border:1px solid #dde1e8;padding:1.5rem">
          <h3 style="margin:0 0 0.75rem;font-size:1rem">Export du package</h3>
          <div style="font-size:0.83rem;color:#495057;margin-bottom:1rem;line-height:1.6">
            <b>Portée:</b> ${_esc(docLabel)}<br>
            <b>Structure:</b> ${state.includeStructure ? "oui" : "non"} &nbsp;
            <b>Alignements:</b> ${state.includeAlignment ? "oui" : "non"} &nbsp;
            <b>Statut:</b> ${state.statusFilter.join(", ")} &nbsp;
            <b>Profil TEI:</b> ${state.teiProfile === "parcolab_like" ? "ParCoLab-like" : state.teiProfile === "parcolab_strict" ? "ParCoLab strict" : "Generic"} &nbsp;
            <b>Politique QA:</b> ${state.qaPolicy === "strict" ? "Strict" : "Lenient"}
          </div>
          <div id="wiz-export-status" style="margin-bottom:1rem;font-size:0.84rem;color:#6c757d">
            Cliquez "Choisir fichier et lancer" pour démarrer.
          </div>
          <div style="display:flex;justify-content:space-between">
            <button id="wiz-back4" class="wiz-btn-sec">← Retour</button>
            <button id="wiz-launch" class="wiz-btn-primary">Choisir fichier et lancer…</button>
          </div>
        </div>`;

      body.querySelector("#wiz-back4")!.addEventListener("click", () => { state.step = 3; void render(); });
      body.querySelector("#wiz-launch")!.addEventListener("click", async () => {
        const statusEl = body.querySelector<HTMLElement>("#wiz-export-status")!;
        const launchBtn = body.querySelector<HTMLButtonElement>("#wiz-launch")!;
        launchBtn.disabled = true;

        // File save dialog
        const { save } = await import("@tauri-apps/plugin-dialog");
        const outPath = await save({
          title: "Enregistrer le package de publication",
          defaultPath: `agrafes_publication_${new Date().toISOString().slice(0, 10)}.zip`,
          filters: [{ name: "ZIP", extensions: ["zip"] }],
        });
        if (!outPath) { launchBtn.disabled = false; return; }

        statusEl.textContent = "Envoi du job au sidecar…";
        try {
          const { ensureRunning } = await import("../../tauri-app/src/lib/sidecarClient.ts");
          const { enqueueJob, getJob } = await import("../../tauri-prep/src/lib/sidecarClient.ts");
          const conn = await ensureRunning(state.dbPath);

          const params: Record<string, unknown> = {
            out_path: outPath,
            include_structure: state.includeStructure,
            include_alignment: state.includeAlignment,
            status_filter: state.statusFilter,
            tei_profile: state.teiProfile,
          };
          if (state.docIds !== null) params.doc_ids = state.docIds;

          const job = await enqueueJob(conn, "export_tei_package", params);
          state.jobId = job.job_id;
          statusEl.textContent = `Job ${job.job_id} en cours…`;
          _shellLog("info", "publish_wizard", `TEI package job submitted: ${job.job_id}`, JSON.stringify({
            profile: state.teiProfile, policy: state.qaPolicy, docs: state.docIds?.length ?? "all"
          }));

          // Poll until done
          const poll = async (): Promise<void> => {
            const rec = await getJob(conn, state.jobId!);
            if (rec.status === "done") {
              state.result = rec.result as Record<string, unknown>;
              state.step = 5;
              _shellLog("info", "publish_wizard", `Job ${job.job_id} completed`, JSON.stringify(state.result));
              await render();
            } else if (rec.status === "error" || rec.status === "canceled") {
              state.error = (rec as unknown as { error?: string }).error ?? rec.status;
              statusEl.innerHTML = `<span style="color:#c0392b">Erreur: ${_esc(state.error ?? "")}</span>`;
              _shellLog("error", "publish_wizard", `Job ${job.job_id} failed`, state.error ?? rec.status);
              launchBtn.disabled = false;
            } else {
              statusEl.textContent = `Job ${state.jobId} — statut: ${rec.status}…`;
              setTimeout(() => void poll(), 1200);
            }
          };
          setTimeout(() => void poll(), 800);
        } catch (e) {
          state.error = String(e);
          statusEl.innerHTML = `<span style="color:#c0392b">Erreur: ${_esc(String(e))}</span>`;
          _shellLog("error", "publish_wizard", "Wizard launch error", String(e));
          launchBtn.disabled = false;
        }
      });

    } else if (state.step === 5) {
      const zipPath = (state.result?.zip_path as string | undefined) ?? "";
      const docCount = (state.result?.doc_count as number | undefined) ?? 0;
      const warns = (state.result?.warnings as unknown[] | undefined) ?? [];
      body.innerHTML = `
        <div style="background:#f0fff4;border:1px solid #c6efce;border-radius:8px;padding:1.5rem">
          <h3 style="margin:0 0 0.75rem;font-size:1rem;color:#1a7f4e">✓ Package créé</h3>
          <p style="font-size:0.84rem;margin:0 0 0.5rem"><b>${docCount}</b> document(s) exporté(s)</p>
          <p style="font-size:0.78rem;font-family:ui-monospace,monospace;background:#fff;border:1px solid #c6efce;border-radius:4px;padding:0.4rem 0.6rem;word-break:break-all;margin:0 0 0.75rem">${_esc(zipPath)}</p>
          ${warns.length > 0 ? `<p style="font-size:0.82rem;color:#b8590a">⚠ ${warns.length} avertissement(s) — voir manifest.json dans le ZIP.</p>` : ""}
          <button id="wiz-copy-path" style="font-size:0.8rem;padding:4px 10px;border:1px solid #adb5bd;border-radius:4px;background:#fff;cursor:pointer;margin-right:0.5rem">
            📋 Copier le chemin
          </button>
          <button id="wiz-restart" class="wiz-btn-sec">Nouvelle publication</button>
          <button id="wiz-home" class="wiz-btn-primary" style="margin-left:0.5rem">← Accueil</button>
        </div>`;
      body.querySelector("#wiz-copy-path")!.addEventListener("click", () => {
        navigator.clipboard?.writeText(zipPath).catch(() => {});
        _showToast("Chemin copié");
      });
      body.querySelector("#wiz-restart")!.addEventListener("click", () => {
        state.step = 1; state.result = null; state.error = null;
        state.jobId = null; state.docIds = null;
        void render();
      });
      body.querySelector("#wiz-home")!.addEventListener("click", () => void _setMode("home"));
    }

    // Inject wizard CSS once
    if (!document.getElementById("wiz-css")) {
      const s = document.createElement("style");
      s.id = "wiz-css";
      s.textContent = `
        .wiz-btn-primary {
          background:#2c5f9e;color:#fff;border:none;border-radius:5px;
          padding:7px 18px;font-size:0.84rem;font-weight:600;cursor:pointer;
          transition:background 0.15s;
        }
        .wiz-btn-primary:hover { background:#1e4a80; }
        .wiz-btn-primary:disabled { opacity:0.55;cursor:not-allowed; }
        .wiz-btn-sec {
          background:#f8f9fa;color:#495057;border:1px solid #adb5bd;border-radius:5px;
          padding:7px 18px;font-size:0.84rem;cursor:pointer;transition:background 0.15s;
        }
        .wiz-btn-sec:hover { background:#e2e6ea; }
      `;
      document.head.appendChild(s);
    }
  };

  container.appendChild(wrap);
  await render();
}

// ─── Onboarding Guided Tour ────────────────────────────────────────────────────

function _getOnboardingStep(): number {
  try { return parseInt(localStorage.getItem(LS_ONBOARDING_STEP) ?? "0", 10) || 0; } catch { return 0; }
}

function _setOnboardingStep(n: number): void {
  try { localStorage.setItem(LS_ONBOARDING_STEP, String(n)); } catch { /* */ }
}

function _resetOnboarding(): void {
  try { localStorage.removeItem(LS_ONBOARDING_STEP); } catch { /* */ }
}

/** Render the guided tour panel into `container` (async — needs demo db path). */
async function _renderGuidedTour(container: HTMLElement): Promise<void> {
  const demoPath = await _getDemoDbPath();
  const step = _getOnboardingStep();

  const STEPS = [
    {
      label: "Ouvrir Explorer et chercher «&nbsp;prince&nbsp;»",
      action: async () => {
        _currentDbPath = demoPath;
        _persist();
        _addToMru(demoPath);
        _updateDbBadge();
        _dbListeners.forEach(cb => cb(_currentDbPath));
        // Store a prefill hint for Explorer welcome hint
        try { sessionStorage.setItem("agrafes.explorer.prefill", "prince"); } catch { /* */ }
        _setOnboardingStep(1);
        await _setMode("explorer");
      },
    },
    {
      label: "Générer un rapport QA (politique lenient)",
      action: async () => {
        _currentDbPath = demoPath;
        _persist();
        _addToMru(demoPath);
        _updateDbBadge();
        _dbListeners.forEach(cb => cb(_currentDbPath));
        _setOnboardingStep(2);
        await _setMode("constituer");
        // After constituer mounts, user navigates to Exports themselves
        // We show a toast hint
        _showToast("Allez dans l'onglet «\u00a0Exports\u00a0» → Rapport QA pour continuer", 5000);
      },
    },
    {
      label: "Exporter un package publication (TEI generic)",
      action: async () => {
        _currentDbPath = demoPath;
        _persist();
        _addToMru(demoPath);
        _updateDbBadge();
        _dbListeners.forEach(cb => cb(_currentDbPath));
        _setOnboardingStep(3);
        await _setMode("publish");
      },
    },
  ];

  const guideSection = document.createElement("div");
  guideSection.className = "shell-guide-section";

  const allDone = step >= STEPS.length;

  guideSection.innerHTML = `
    <div class="shell-guide-card">
      <div class="shell-guide-title">🎯 Guide rapide — ${allDone ? "Terminé !" : `Étape ${Math.min(step + 1, STEPS.length)} / ${STEPS.length}`}</div>
      <div class="shell-guide-steps">
        ${STEPS.map((s, i) => {
          const done = i < step;
          const active = i === step && !allDone;
          const pending = i > step;
          const numClass = done ? "done" : active ? "active" : "pending";
          const labelClass = done ? "done" : "";
          return `
            <div class="shell-guide-step">
              <div class="shell-guide-step-num ${numClass}">${done ? "✓" : i + 1}</div>
              <span class="shell-guide-step-label ${labelClass}">${s.label}</span>
              ${active ? `<button class="shell-guide-step-btn" data-step="${i}" id="guide-step-btn-${i}">Lancer →</button>` : ""}
            </div>`;
        }).join("")}
      </div>
      <div class="shell-guide-footer">
        <span>${allDone ? "🎉 Vous avez terminé le guide rapide !" : "Cliquez «\u00a0Lancer\u00a0» sur l\u2019étape courante."}</span>
        <button class="shell-guide-reset" id="guide-reset-btn">Réinitialiser le guide</button>
      </div>
    </div>
  `;

  // Wire step buttons
  STEPS.forEach((s, i) => {
    const btn = guideSection.querySelector<HTMLButtonElement>(`#guide-step-btn-${i}`);
    if (btn) {
      btn.addEventListener("click", () => {
        btn.disabled = true;
        void s.action();
      });
    }
  });

  guideSection.querySelector("#guide-reset-btn")!.addEventListener("click", () => {
    _resetOnboarding();
    // Re-render home
    void _setMode("home", { force: true });
  });

  container.appendChild(guideSection);
}

// ─── Home screen ──────────────────────────────────────────────────────────────

function _renderHome(container: HTMLElement): void {
  const wrap = document.createElement("div");
  wrap.className = "shell-home-wrap";
  wrap.innerHTML = `
    <h1 class="shell-home-title">AGRAFES</h1>
    <p class="shell-home-subtitle">Choisissez un module</p>
    <div class="shell-cards">
      <div class="shell-card shell-card-explorer" id="shell-btn-explorer">
        <div class="shell-card-icon">&#128269;</div>
        <span class="shell-card-badge shell-card-badge-explorer">Explorer</span>
        <h2>Explorer</h2>
        <p>Concordancier KWIC et recherche grammaticale CQL sur vos corpus multilingues.</p>
      </div>
      <div class="shell-card shell-card-constituer" id="shell-btn-constituer">
        <div class="shell-card-icon">&#128221;</div>
        <span class="shell-card-badge shell-card-badge-constituer">Constituer</span>
        <h2>Constituer son corpus</h2>
        <p>Importer, aligner, corriger et exporter vos corpus.</p>
      </div>
      <div class="shell-card shell-card-publish" id="shell-btn-publish">
        <div class="shell-card-icon">&#128230;</div>
        <span class="shell-card-badge shell-card-badge-publish">Publier</span>
        <h2>Publier un package</h2>
        <p>Exporter un ZIP TEI avec manifest et checksums en 5&nbsp;&eacute;tapes guid&eacute;es.</p>
      </div>
    </div>
    <div class="shell-demo-section">
      <p class="shell-demo-hint">Ou essayez avec un corpus pr&eacute;install&eacute;&nbsp;:</p>
      <div class="shell-demo-card">
        <span class="shell-demo-icon">&#127981;</span>
        <span class="shell-demo-label">Corpus d&eacute;mo — Il Principe (IT&nbsp;/&nbsp;FR&nbsp;/&nbsp;EN, 148 unit&eacute;s align&eacute;es)</span>
        <div class="shell-demo-btns">
          <button class="shell-demo-btn shell-demo-btn-install" id="shell-demo-install-btn">Installer&hellip;</button>
          <button class="shell-demo-btn shell-demo-btn-open" id="shell-demo-open-btn" style="display:none">Ouvrir Explorer</button>
        </div>
      </div>
    </div>
    <div id="shell-guide-anchor"></div>
  `;
  container.appendChild(wrap);

  wrap.querySelector("#shell-btn-explorer")!
    .addEventListener("click", () => _setMode("explorer"));
  wrap.querySelector("#shell-btn-constituer")!
    .addEventListener("click", () => _setMode("constituer"));
  wrap.querySelector("#shell-btn-publish")!
    .addEventListener("click", () => _setMode("publish"));

  // Async: check demo status + wire buttons + guided tour
  void _initDemoSection(
    wrap.querySelector("#shell-demo-install-btn") as HTMLButtonElement,
    wrap.querySelector("#shell-demo-open-btn") as HTMLButtonElement,
    wrap.querySelector("#shell-guide-anchor") as HTMLElement,
  );
}

async function _initDemoSection(
  installBtn: HTMLButtonElement,
  openBtn: HTMLButtonElement,
  guideAnchor: HTMLElement,
): Promise<void> {
  // Check if already installed
  const installed = await _isDemoInstalled();
  if (installed) {
    installBtn.style.display = "none";
    openBtn.style.display = "";
    await _renderGuidedTour(guideAnchor);
  }

  installBtn.addEventListener("click", async () => {
    installBtn.disabled = true;
    installBtn.textContent = "Installation\u2026";
    try {
      await _installDemo();
      installBtn.style.display = "none";
      openBtn.style.display = "";
      _showToast("D\u00e9mo install\u00e9e avec succ\u00e8s");
      // Show guide tour after fresh install
      await _renderGuidedTour(guideAnchor);
    } catch (err) {
      installBtn.disabled = false;
      installBtn.textContent = "Installer\u2026";
      _showToast(`Erreur installation : ${String(err)}`, 4000);
      console.error("[shell] demo install error:", err);
    }
  });

  openBtn.addEventListener("click", async () => {
    // Toujours réinstaller depuis l'asset bundle.
    // _installDemo() gère la déconnexion du sidecar et la suppression WAL/SHM.
    openBtn.disabled = true;
    const prevLabel = openBtn.textContent;
    openBtn.textContent = "Mise à jour\u2026";
    try {
      await _installDemo();
    } catch (err) {
      console.warn("[shell] demo reinstall failed, opening existing copy:", err);
    } finally {
      openBtn.disabled = false;
      openBtn.textContent = prevLabel;
    }
    const demoPath = await _getDemoDbPath();
    _currentDbPath = demoPath;
    _persist();
    _addToMru(demoPath);
    _updateDbBadge();
    _dbListeners.forEach(cb => cb(_currentDbPath));
    _showToast("DB active\u00a0: corpus d\u00e9mo");
    await _setMode("explorer", { force: true });
  });
}

// ─── Loading indicator ────────────────────────────────────────────────────────

function _showSidecarOverlay(label = "Démarrage du moteur…"): void {
  _hideSidecarOverlay();
  const el = document.createElement("div");
  el.id = "shell-sidecar-overlay";
  el.className = "shell-sidecar-overlay";
  el.innerHTML = `
    <div class="shell-sidecar-card">
      <div class="shell-sidecar-spinner"></div>
      <div class="shell-sidecar-label">${label}</div>
      <div class="shell-sidecar-sub">Cela peut prendre quelques secondes</div>
    </div>
  `;
  document.body.appendChild(el);
}

function _hideSidecarOverlay(): void {
  const el = document.getElementById("shell-sidecar-overlay");
  if (!el) return;
  el.classList.add("shell-sidecar-overlay-hide");
  setTimeout(() => el.remove(), 380);
}

function _showLoading(container: HTMLElement): void {
  container.innerHTML = `
    <div class="shell-loading">
      <div class="shell-loading-dot"></div>
      <div class="shell-loading-dot"></div>
      <div class="shell-loading-dot"></div>
    </div>
  `;
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function _showToast(msg: string, durationMs = 3000): void {
  const existing = document.getElementById("shell-toast");
  existing?.remove();

  const toast = document.createElement("div");
  toast.id = "shell-toast";
  toast.className = "shell-toast";
  toast.textContent = msg;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("shell-toast-hide");
    setTimeout(() => toast.remove(), 450);
  }, durationMs);
}

// ─── Keyboard shortcuts ───────────────────────────────────────────────────────

function _installKeyboardShortcuts(): void {
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      _closeDbMenu();
      _clearInitError();
      return;
    }
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    if (e.key === "1") { e.preventDefault(); void _setMode("explorer"); }
    else if (e.key === "2") { e.preventDefault(); void _setMode("constituer"); }
    else if (e.key === "3") { e.preventDefault(); void _setMode("publish"); }
    else if (e.key === "0") { e.preventDefault(); void _setMode("home"); }
    else if (e.key === "o" || e.key === "O") { e.preventDefault(); void _onChangeDb(); }
    else if ((e.key === "n" || e.key === "N") && e.shiftKey) { e.preventDefault(); void _onCreateDb(); }
    else if (e.key === "/") { e.preventDefault(); _openShortcutsPanel(); }
    else if (e.key === "?") { e.preventDefault(); _openAboutDialog(); }
  });
}
