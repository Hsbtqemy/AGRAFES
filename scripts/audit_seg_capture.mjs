#!/usr/bin/env node
/**
 * audit_seg_capture.mjs — Segmentation view captures for parity audit.
 * Usage:
 *   node scripts/audit_seg_capture.mjs \
 *     --url http://localhost:1421 \
 *     --out-dir audit/prep/segmentation \
 *     [--width 1440 --height 900]
 * Produces: runtime_{W}_units.png, runtime_{W}_longtext.png, metrics_{W}.json
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

const args     = parseArgs(process.argv);
const url      = args.url;
const outDir   = args["out-dir"] || "audit/prep/segmentation";
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agrafes-seg-cdp-"));
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
  const rect = s => { const el = S(s); if (!el) return null; const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y), display: cs.display, gridCols: cs.gridTemplateColumns, position: cs.position, maxHeight: cs.maxHeight }; };
  const has = s => !!S(s);
  return {
    viewport: { w: ${vw}, h: ${vh} },
    ts: new Date().toISOString(),
    elements: {
      seg_panel:          rect(".acts-seg-head-card"),
      mode_bar:           rect(".acts-seg-mode-bar"),
      longtext_hint:      rect("#act-seg-longtext-hint"),
      normal_view:        rect("#act-seg-normal-view"),
      seg_card:           rect("#act-seg-card"),
      seg_workspace:      rect(".seg-workspace:not(.seg-workspace-lt)"),
      seg_side:           rect("details.seg-side"),
      seg_col_left:       rect(".seg-workspace:not(.seg-workspace-lt) .seg-col-left"),
      seg_col_right:      rect(".seg-workspace:not(.seg-workspace-lt) .seg-col-right"),
      preview_card:       rect("#act-seg-preview-card"),
      preview_tabs:       rect("#act-seg-preview-card .preview-tabs"),
      preview_body:       rect("#act-seg-preview-card .preview-body"),
      doc_scroll_seg:     rect("#act-seg-preview-body"),
      minimap_units:      rect("#act-seg-units-minimap"),
      batch_overview:     rect(".seg-batch-overview"),
      params_inner_card:  rect(".seg-workspace .seg-col-left .seg-inner-card"),
      lt_view:            rect("#act-seg-longtext-view"),
      lt_workspace:       rect(".seg-workspace-lt"),
      lt_col_left:        rect(".seg-workspace-lt .seg-col-left"),
      lt_col_right:       rect(".seg-workspace-lt .seg-col-right"),
      lt_preview:         rect(".acts-seg-lt-sticky-preview"),
      lt_preview_body:    rect(".acts-seg-lt-sticky-preview .preview-body"),
      lt_minimap:         rect("#act-seg-lt-minimap"),
    },
    presence: {
      head_card:        has(".acts-seg-head-card"),
      mode_bar:         has(".acts-seg-mode-bar"),
      mode_units:       has("#act-seg-mode-units"),
      mode_traduction:  has("#act-seg-mode-traduction"),
      mode_longtext:    has("#act-seg-mode-longtext"),
      longtext_hint:    has("#act-seg-longtext-hint"),
      seg_side:         has("details.seg-side"),
      seg_col_left:     has(".seg-col-left"),
      seg_col_right:    has(".seg-col-right"),
      batch_overview:   has(".seg-batch-overview"),
      preview_card:     has("#act-seg-preview-card"),
      preview_tabs:     has(".preview-tabs"),
      preview_tools:    has(".preview-tools"),
      doc_scroll:       has("#act-seg-preview-body"),
      minimap:          has("#act-seg-units-minimap"),
      lt_view:          has("#act-seg-longtext-view"),
      lt_preview:       has(".acts-seg-lt-sticky-preview"),
      lt_preview_tools: has(".acts-seg-lt-sticky-preview .preview-tools"),
      lt_minimap:       has("#act-seg-lt-minimap"),
    },
  };
})()`;

async function run() {
  const port = 9600 + Math.floor(Math.random() * 300);
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

    // Wait for hub to appear, then navigate to Segmentation sub-view
    for (let i = 0; i < 30; i++) {
      const r = await send("Runtime.evaluate", { expression: `!!document.querySelector(".acts-hub-workspace")`, returnByValue: true });
      if (r?.result?.value) break;
      await sleep(150);
    }
    // Click the Segmentation "Ouvrir →" wf-btn
    await send("Runtime.evaluate", {
      expression: `(() => { const btn = document.querySelector(".acts-hub-wf-btn[data-target='segmentation']"); btn?.click(); return !!btn; })();`,
      returnByValue: true,
    });
    await sleep(500);

    // Wait for segmentation workspace to be visible (non-zero size)
    for (let i = 0; i < 30; i++) {
      const r = await send("Runtime.evaluate", {
        expression: `(() => { const el = document.querySelector("#act-seg-card"); if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0; })();`,
        returnByValue: true,
      });
      if (r?.result?.value) break;
      await sleep(150);
    }
    await sleep(400);

    // — UNITS MODE (default) —
    const evalUnits = await send("Runtime.evaluate", { returnByValue: true, expression: MEASURE_EXPR(viewportW, viewportH) });
    const dataUnits = evalUnits?.result?.value;
    if (!dataUnits) throw new Error("Failed to collect units metrics");

    const shotUnits = await send("Page.captureScreenshot", { format: "png", fromSurface: true, clip: { x: 0, y: 0, width: viewportW, height: viewportH, scale: 1 } });

    // — LONGTEXT MODE —
    await send("Runtime.evaluate", {
      expression: `document.querySelector("#act-seg-mode-longtext")?.click();`,
      returnByValue: true,
    });
    await sleep(400);

    const evalLt = await send("Runtime.evaluate", { returnByValue: true, expression: MEASURE_EXPR(viewportW, viewportH) });
    const dataLt = evalLt?.result?.value;
    const shotLt = await send("Page.captureScreenshot", { format: "png", fromSurface: true, clip: { x: 0, y: 0, width: viewportW, height: viewportH, scale: 1 } });

    fs.mkdirSync(outDir, { recursive: true });
    const pngUnits = path.join(outDir, `runtime_${viewportW}_units.png`);
    const pngLt   = path.join(outDir, `runtime_${viewportW}_longtext.png`);
    const jsonOut  = path.join(outDir, `metrics_${viewportW}.json`);

    fs.writeFileSync(pngUnits, Buffer.from(shotUnits.data, "base64"));
    fs.writeFileSync(pngLt,    Buffer.from(shotLt.data, "base64"));
    fs.writeFileSync(jsonOut,  JSON.stringify({ units: dataUnits, longtext: dataLt }, null, 2) + "\n", "utf8");

    console.log(`✓ PNG units:    ${pngUnits}`);
    console.log(`✓ PNG longtext: ${pngLt}`);
    console.log(`✓ JSON:         ${jsonOut}`);
    console.log(`  viewport: ${viewportW}×${viewportH}`);

    const ws = dataUnits?.elements?.seg_workspace;
    if (ws) console.log(`  [units] seg-workspace: ${ws.w}×${ws.h}  grid: ${ws.gridCols}`);
    const cl = dataUnits?.elements?.seg_col_left;
    const cr = dataUnits?.elements?.seg_col_right;
    if (cl && cr) console.log(`  [units] col-left: ${cl.w}px  col-right: ${cr.w}px`);

    const ltws = dataLt?.elements?.lt_workspace;
    if (ltws) console.log(`  [lt]    seg-workspace-lt: ${ltws.w}×${ltws.h}  grid: ${ltws.gridCols}`);
    const ltcl = dataLt?.elements?.lt_col_left;
    const ltcr = dataLt?.elements?.lt_col_right;
    if (ltcl && ltcr) console.log(`  [lt]    col-left: ${ltcl.w}px  col-right: ${ltcr.w}px`);

    console.log(`  presence:`, JSON.stringify(dataUnits?.presence));

  } finally {
    if (cdp) await cdp.close();
    proc.kill();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
}

run().catch(err => { console.error("✗", err.message); process.exit(1); });
