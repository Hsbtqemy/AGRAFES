#!/usr/bin/env node
/**
 * audit_align_capture.mjs — Alignement view captures for parity audit.
 * Usage:
 *   node scripts/audit_align_capture.mjs \
 *     --url http://localhost:1421 \
 *     --out-dir audit/prep/alignement \
 *     [--width 1440 --height 900]
 * Produces: runtime_{W}.png, metrics_{W}.json
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const CHROME_BIN = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const cur = argv[i];
    if (!cur.startsWith("--")) continue;
    const key = cur.slice(2);
    const nxt = argv[i + 1];
    if (nxt && !nxt.startsWith("--")) { out[key] = nxt; i += 1; }
    else out[key] = "true";
  }
  return out;
}

const args      = parseArgs(process.argv);
const url       = args.url;
const outDir    = args["out-dir"] || "audit/prep/alignement";
const viewportW = Number(args.width  || 1440);
const viewportH = Number(args.height || 900);

if (!url) { console.error("Usage: --url <url> [--out-dir <dir>] [--width 1440 --height 900]"); process.exit(2); }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function fetchJson(u) { const res = await fetch(u); if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); }
async function waitFor(u, ms = 15000) {
  const t = Date.now();
  while (true) {
    try { return await fetchJson(u); } catch (_) {
      if (Date.now() - t > ms) throw new Error(`Timeout ${u}`);
      await sleep(120);
    }
  }
}

function launchChrome(port) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agrafes-align-cdp-"));
  const proc = spawn(CHROME_BIN, [
    "--headless=new", "--disable-gpu", "--no-first-run",
    "--no-default-browser-check", "--disable-background-networking",
    `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`,
    `--window-size=${viewportW},${viewportH}`, "about:blank",
  ], { stdio: ["ignore", "ignore", "ignore"] });
  return { proc, dir };
}

async function connectCdp(port) {
  const targets = await waitFor(`http://127.0.0.1:${port}/json/list`);
  const pg = targets.find(t => t.type === "page" && t.webSocketDebuggerUrl);
  if (!pg) throw new Error("No page target");
  const ws = new WebSocket(pg.webSocketDebuggerUrl);
  await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
  let seq = 0; const pending = new Map(); const waiters = new Map();
  ws.onmessage = evt => {
    const m = JSON.parse(String(evt.data));
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); return; }
    if (m.method && waiters.has(m.method)) { const list = waiters.get(m.method); waiters.delete(m.method); list.forEach(fn => fn(m.params || {})); }
  };
  const send = (method, params = {}) => new Promise((ok, err) => { const id = ++seq; pending.set(id, { resolve: ok, reject: err }); ws.send(JSON.stringify({ id, method, params })); });
  const waitEvent = (method, ms = 15000) => new Promise((ok, err) => {
    const t = setTimeout(() => err(new Error(`Timeout ${method}`)), ms);
    const arr = waiters.get(method) || []; arr.push(p => { clearTimeout(t); ok(p); }); waiters.set(method, arr);
  });
  return { send, waitEvent, close: async () => { try { ws.close(); } catch (_) {} } };
}

const MEASURE_EXPR = (vw, vh) => `(() => {
  const S = s => document.querySelector(s);
  const rect = s => {
    const el = S(s);
    if (!el) return null;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y),
      display: cs.display, gridCols: cs.gridTemplateColumns, position: cs.position, maxHeight: cs.maxHeight };
  };
  const has = s => !!S(s);
  return {
    viewport: { w: ${vw}, h: ${vh} },
    ts: new Date().toISOString(),
    elements: {
      align_head_card:   rect(".acts-seg-head-card"),
      align_head_tools:  rect(".acts-hub-head-tools"),
      wf_section:        rect("#wf-section"),
      doc_list_card:     rect("#act-doc-list"),
      align_card:        rect("#act-align-card"),
      align_layout:      rect(".align-layout"),
      align_main:        rect(".align-main"),
      align_focus:       rect(".align-focus"),
      align_launcher:    rect(".align-launcher"),
      align_setup_row:   rect(".align-setup-row"),
      align_results:     rect("#act-align-results"),
      align_kpis:        rect(".align-kpis"),
      audit_panel:       rect("#act-audit-panel"),
      run_toolbar:       rect(".run-toolbar"),
      audit_table_wrap:  rect("#act-audit-table-wrap"),
      audit_run_view:    rect("#act-audit-run-view"),
      audit_batch_bar:   rect(".audit-batch-bar"),
      quality_card:      rect("#act-quality-card"),
      collision_card:    rect("#act-collision-card"),
      report_card:       rect("#act-report-card"),
    },
    presence: {
      align_head_card:  has(".acts-seg-head-card"),
      wf_section:       has("#wf-section"),
      doc_list_card:    has("#act-doc-list"),
      align_card:       has("#act-align-card"),
      align_layout:     has(".align-layout"),
      align_focus:      has(".align-focus"),
      align_launcher:   has(".align-launcher"),
      align_setup_row:  has(".align-setup-row"),
      align_results:    has("#act-align-results"),
      align_kpis:       has(".align-kpis"),
      audit_panel:      has("#act-audit-panel"),
      run_toolbar:      has(".run-toolbar"),
      audit_table_wrap: has("#act-audit-table-wrap"),
      run_view_toggle:  has(".run-view-toggle"),
      quality_card:     has("#act-quality-card"),
      collision_card:   has("#act-collision-card"),
      report_card:      has("#act-report-card"),
      align_run_pill:   has("#act-align-run-pill"),
    },
    scroll_height: document.body.scrollHeight,
  };
})()`;

async function run() {
  const port = 9700 + Math.floor(Math.random() * 200);
  const { proc, dir } = launchChrome(port);
  let cdp = null;
  try {
    await waitFor(`http://127.0.0.1:${port}/json/version`, 15000);
    cdp = await connectCdp(port);
    const { send, waitEvent } = cdp;

    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: viewportW, height: viewportH, deviceScaleFactor: 1, mobile: false });

    const loaded = waitEvent("Page.loadEventFired", 30000);
    await send("Page.navigate", { url });
    await loaded;
    await sleep(900);

    // Click Actions tab
    await send("Runtime.evaluate", {
      expression: `(() => { const t = Array.from(document.querySelectorAll(".prep-nav-tab")).find(b => /action/i.test(b.textContent||"")); t?.click(); return !!t; })();`,
      returnByValue: true,
    });
    await sleep(500);

    // Wait for hub to appear
    for (let i = 0; i < 30; i++) {
      const r = await send("Runtime.evaluate", { expression: `!!document.querySelector(".acts-hub-workspace")`, returnByValue: true });
      if (r?.result?.value) break;
      await sleep(150);
    }

    // Click the Alignement "Ouvrir →" wf-btn
    await send("Runtime.evaluate", {
      expression: `(() => { const btn = document.querySelector(".acts-hub-wf-btn[data-target='alignement']"); btn?.click(); return !!btn; })();`,
      returnByValue: true,
    });
    await sleep(600);

    // Wait for align_card to be visible (non-zero width)
    for (let i = 0; i < 30; i++) {
      const r = await send("Runtime.evaluate", {
        expression: `(() => { const el = document.querySelector("#act-align-card"); if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0; })();`,
        returnByValue: true,
      });
      if (r?.result?.value) break;
      await sleep(150);
    }
    await sleep(400);

    // Measure
    const evalResult = await send("Runtime.evaluate", { returnByValue: true, expression: MEASURE_EXPR(viewportW, viewportH) });
    const data = evalResult?.result?.value;
    if (!data) throw new Error("Failed to collect metrics");

    const shot = await send("Page.captureScreenshot", { format: "png", fromSurface: true, clip: { x: 0, y: 0, width: viewportW, height: viewportH, scale: 1 } });

    fs.mkdirSync(outDir, { recursive: true });
    const pngOut  = path.join(outDir, `runtime_${viewportW}.png`);
    const jsonOut = path.join(outDir, `metrics_${viewportW}.json`);

    fs.writeFileSync(pngOut,  Buffer.from(shot.data, "base64"));
    fs.writeFileSync(jsonOut, JSON.stringify(data, null, 2) + "\n", "utf8");

    console.log(`✓ PNG:  ${pngOut}`);
    console.log(`✓ JSON: ${jsonOut}`);
    console.log(`  viewport: ${viewportW}×${viewportH}`);
    console.log(`  scroll_height: ${data.scroll_height}px`);

    const al = data.elements.align_layout;
    if (al) console.log(`  align-layout: ${al.w}×${al.h}  grid: ${al.gridCols}`);
    const am = data.elements.align_main;
    const af = data.elements.align_focus;
    if (am && af) console.log(`  align-main: ${am.w}px  align-focus: ${af.w}px`);
    const ac = data.elements.align_card;
    if (ac) console.log(`  align-card: ${ac.w}×${ac.h}`);

    console.log(`  presence:`, JSON.stringify(data.presence));

  } finally {
    if (cdp) await cdp.close();
    proc.kill();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
}

run().catch(err => { console.error("✗", err.message); process.exit(1); });
