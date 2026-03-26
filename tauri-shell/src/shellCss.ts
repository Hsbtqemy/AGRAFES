/**
 * shellCss.ts — Shell global CSS injected at runtime via _injectCSS().
 */

export const SHELL_CSS = `
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
