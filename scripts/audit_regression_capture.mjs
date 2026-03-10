#!/usr/bin/env node
/**
 * audit_regression_capture.mjs — Final global regression captures for tauri-prep.
 * Captures all 7 views at 1440 and 1728px.
 *
 * Usage:
 *   node scripts/audit_regression_capture.mjs --url http://localhost:1421 --out-dir audit/prep/final-regression
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const CHROME_BIN = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i]; if (!k.startsWith("--")) continue;
    const key = k.slice(2), nxt = argv[i + 1];
    if (nxt && !nxt.startsWith("--")) { out[key] = nxt; i++; } else out[key] = "true";
  }
  return out;
}

const args   = parseArgs(process.argv);
const url    = args.url || "http://localhost:1421";
const outDir = args["out-dir"] || "audit/prep/final-regression";

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function fetchJson(u) { const r = await fetch(u); if (!r.ok) throw new Error(`${r.status}`); return r.json(); }
async function waitFor(u, ms = 20000) {
  const t = Date.now();
  while (true) {
    try { return await fetchJson(u); } catch (_) {
      if (Date.now() - t > ms) throw new Error(`Timeout ${u}`);
      await sleep(150);
    }
  }
}

function launchChrome(port, w, h) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agrafes-reg-cdp-"));
  const proc = spawn(CHROME_BIN, [
    "--headless=new", "--disable-gpu", "--no-first-run",
    "--no-default-browser-check", "--disable-background-networking",
    `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`,
    `--window-size=${w},${h}`, "about:blank",
  ], { stdio: ["ignore", "ignore", "ignore"] });
  return { proc, dir };
}

async function connectCdp(port) {
  const targets = await waitFor(`http://127.0.0.1:${port}/json/list`);
  const pg = targets.find(t => t.type === "page" && t.webSocketDebuggerUrl);
  if (!pg) throw new Error("No page target");
  const ws = new WebSocket(pg.webSocketDebuggerUrl);
  await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
  let seq = 0; const pending = new Map(), waiters = new Map();
  ws.onmessage = evt => {
    const m = JSON.parse(String(evt.data));
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); return;
    }
    if (m.method && waiters.has(m.method)) {
      const list = waiters.get(m.method); waiters.delete(m.method); list.forEach(fn => fn(m.params || {}));
    }
  };
  const send = (method, params = {}) => new Promise((ok, err) => {
    const id = ++seq; pending.set(id, { resolve: ok, reject: err });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const waitEvent = (method, ms = 20000) => new Promise((ok, err) => {
    const t = setTimeout(() => err(new Error(`Timeout ${method}`)), ms);
    const arr = waiters.get(method) || []; arr.push(p => { clearTimeout(t); ok(p); });
    waiters.set(method, arr);
  });
  return { send, waitEvent, close: async () => { try { ws.close(); } catch (_) {} } };
}

async function screenshot(send, w, h) {
  const shot = await send("Page.captureScreenshot", {
    format: "png", fromSurface: true,
    clip: { x: 0, y: 0, width: w, height: h, scale: 1 },
  });
  return Buffer.from(shot.data, "base64");
}

async function waitEl(send, selector, maxMs = 5000) {
  const t = Date.now();
  while (Date.now() - t < maxMs) {
    const r = await send("Runtime.evaluate", {
      expression: `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })();`,
      returnByValue: true,
    });
    if (r?.result?.value) return true;
    await sleep(150);
  }
  return false;
}

async function clickEl(send, expr) {
  await send("Runtime.evaluate", { expression: expr, returnByValue: true });
}

async function measure(send, w, h) {
  const r = await send("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => {
      const S = s => document.querySelector(s);
      const rect = s => {
        const el = S(s); if (!el) return null;
        const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
        return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y), display: cs.display, gridCols: cs.gridTemplateColumns };
      };
      const has = s => !!S(s);
      const txt = s => S(s)?.textContent?.trim().slice(0, 60) || null;
      return {
        viewport: { w: ${w}, h: ${h} },
        ts: new Date().toISOString(),
        topbar: rect(".prep-topbar, .app-topbar, header, .topbar"),
        sidebar: rect(".prep-sidebar, .sidebar, aside"),
        content: rect(".prep-content, .content, main"),
        scroll_height: document.body.scrollHeight,
        css_classes_on_body: document.body.className,
      };
    })();`,
  });
  return r?.result?.value ?? {};
}

async function captureAllViews(w, h) {
  const port = 9600 + Math.floor(Math.random() * 300);
  const { proc, dir } = launchChrome(port, w, h);
  let cdp = null;
  const results = [];

  try {
    await waitFor(`http://127.0.0.1:${port}/json/version`, 20000);
    cdp = await connectCdp(port);
    const { send, waitEvent } = cdp;

    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });

    const loaded = waitEvent("Page.loadEventFired", 30000);
    await send("Page.navigate", { url });
    await loaded;
    await sleep(1200);

    // Helper: click a nav tree link
    const navTo = async (navKey) => {
      await clickEl(send, `(() => { const el = document.querySelector('.prep-nav-tree-link[data-nav="${navKey}"]'); el?.click(); return !!el; })()`);
      await sleep(600);
    };
    // Helper: click a nav tab by text
    const navTab = async (text) => {
      await clickEl(send, `(() => { const t = Array.from(document.querySelectorAll(".prep-nav-tab")).find(b => /${text}/i.test(b.textContent||"")); t?.click(); return !!t; })()`);
      await sleep(600);
    };
    // Helper: click wf-btn by target
    const clickWfBtn = async (target) => {
      await clickEl(send, `(() => { const b = document.querySelector('.acts-hub-wf-btn[data-target="${target}"]'); b?.click(); return !!b; })()`);
      await sleep(600);
    };

    // ── 1. IMPORTER ──────────────────────────────────────────────────────────
    await navTo("importer");
    await waitEl(send, ".import-screen, .screen-title", 4000);
    await sleep(400);
    const m_imp = await measure(send, w, h);
    const png_imp = await screenshot(send, w, h);
    results.push({ key: "importer", metrics: m_imp, png: png_imp });
    console.log(`  ✓ importer ${w}px`);

    // ── 2. DOCUMENTS ─────────────────────────────────────────────────────────
    await navTo("documents");
    await waitEl(send, ".meta-screen, .metadata-screen", 4000);
    await sleep(400);
    const m_doc = await measure(send, w, h);
    const png_doc = await screenshot(send, w, h);
    results.push({ key: "documents", metrics: m_doc, png: png_doc });
    console.log(`  ✓ documents ${w}px`);

    // ── 3. ACTIONS HUB ───────────────────────────────────────────────────────
    await navTab("action");
    await waitEl(send, ".acts-hub, .acts-hub-workspace", 5000);
    await sleep(500);
    const m_hub = await measure(send, w, h);
    const png_hub = await screenshot(send, w, h);
    results.push({ key: "hub", metrics: m_hub, png: png_hub });
    console.log(`  ✓ actions-hub ${w}px`);

    // ── 4. CURATION ──────────────────────────────────────────────────────────
    await clickWfBtn("curation");
    // fallback: nav tree link
    await clickEl(send, `(() => { const b = document.querySelector('.acts-hub-wf-btn[data-target="curation"]') || document.querySelector('.prep-nav-tree-link[data-nav="curation"]'); b?.click(); return !!b; })()`);
    await waitEl(send, "#act-curate-card, .curate-workspace, .curate-inner-card", 5000);
    await sleep(500);
    const m_cur = await measure(send, w, h);
    const png_cur = await screenshot(send, w, h);
    results.push({ key: "curation", metrics: m_cur, png: png_cur });
    console.log(`  ✓ curation ${w}px`);

    // ── 5. BACK TO HUB → SEGMENTATION ────────────────────────────────────────
    // Click back button or nav link
    await clickEl(send, `(() => { const b = document.querySelector('.acts-hub-back-btn, [data-action="back"]') || Array.from(document.querySelectorAll("button")).find(b => /vue synth/i.test(b.textContent||"")); b?.click(); return !!b; })()`);
    await sleep(400);
    await navTo("segmentation");
    await waitEl(send, ".seg-workspace, #act-seg-card, .seg-layout", 5000);
    await sleep(500);
    const m_seg = await measure(send, w, h);
    const png_seg = await screenshot(send, w, h);
    results.push({ key: "segmentation", metrics: m_seg, png: png_seg });
    console.log(`  ✓ segmentation ${w}px`);

    // ── 6. ALIGNEMENT ────────────────────────────────────────────────────────
    await navTo("alignement");
    await waitEl(send, ".align-layout, #act-align-card, .align-main", 5000);
    await sleep(500);
    const m_aln = await measure(send, w, h);
    const png_aln = await screenshot(send, w, h);
    results.push({ key: "alignement", metrics: m_aln, png: png_aln });
    console.log(`  ✓ alignement ${w}px`);

    // ── 7. EXPORTER ──────────────────────────────────────────────────────────
    await navTo("exporter");
    await waitEl(send, ".exports-screen, .exp-head-card, .exp-workspace", 5000);
    await sleep(500);
    const m_exp = await measure(send, w, h);
    const png_exp = await screenshot(send, w, h);
    results.push({ key: "exporter", metrics: m_exp, png: png_exp });
    console.log(`  ✓ exporter ${w}px`);

  } finally {
    if (cdp) await cdp.close();
    proc.kill();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }

  return results;
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`\n── Regression captures → ${outDir}\n`);

  for (const [w, h] of [[1440, 900], [1728, 1080]]) {
    console.log(`\n[${w}×${h}]`);
    const results = await captureAllViews(w, h);
    for (const { key, metrics, png } of results) {
      const pngPath  = path.join(outDir, `${key}_${w}.png`);
      const jsonPath = path.join(outDir, `${key}_${w}.json`);
      fs.writeFileSync(pngPath, png);
      fs.writeFileSync(jsonPath, JSON.stringify(metrics, null, 2) + "\n", "utf8");
    }
  }

  console.log(`\n✓ All captures saved to ${outDir}/\n`);
}

main().catch(err => { console.error("✗", err.message); process.exit(1); });
