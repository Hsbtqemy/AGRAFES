#!/usr/bin/env node
/**
 * audit_export_capture.mjs — Exporter view captures for parity audit.
 * Usage:
 *   node scripts/audit_export_capture.mjs \
 *     --url http://localhost:1421 \
 *     --out-dir audit/prep/exporter \
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
const outDir    = args["out-dir"] || "audit/prep/exporter";
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agrafes-export-cdp-"));
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
      display: cs.display, gridCols: cs.gridTemplateColumns, position: cs.position };
  };
  const has = s => !!S(s);
  const txt = s => { const el = S(s); return el ? el.textContent?.trim().slice(0,60) : null; };
  return {
    viewport: { w: ${vw}, h: ${vh} },
    ts: new Date().toISOString(),
    elements: {
      screen_root:       rect(".screen.actions-screen"),
      screen_title:      rect(".screen-title"),
      exp_state_banner:  rect("#exp-state-banner"),
      v2_card:           rect(".screen > .card:nth-child(2)"),
      v2_form_row:       rect(".card .form-row"),
      v2_doc_sel:        rect("#v2-doc-sel"),
      v2_stage:          rect("#v2-stage"),
      v2_product:        rect("#v2-product"),
      v2_format:         rect("#v2-format"),
      v2_run_btn:        rect("#v2-run-btn"),
      v2_doc_summary:    rect("#v2-doc-summary"),
      legacy_toggle_card: rect(".export-legacy-toggle-card"),
      legacy_container:  rect("#exports-legacy-container"),
      export_log_card:   rect(".export-log-card"),
    },
    presence: {
      screen_title:      has(".screen-title"),
      v2_doc_sel:        has("#v2-doc-sel"),
      v2_stage:          has("#v2-stage"),
      v2_product:        has("#v2-product"),
      v2_format:         has("#v2-format"),
      v2_run_btn:        has("#v2-run-btn"),
      v2_align_options:  has("#v2-align-options"),
      v2_tei_options:    has("#v2-tei-options"),
      v2_package_options: has("#v2-package-options"),
      legacy_toggle_btn: has("#exports-toggle-legacy-btn"),
      legacy_container:  has("#exports-legacy-container"),
      tei_export_btn:    has("#tei-export-btn"),
      export_log:        has("#export-log"),
    },
    text: {
      screen_title:   txt(".screen-title"),
      v2_run_btn:     txt("#v2-run-btn"),
      v2_doc_summary: txt("#v2-doc-summary"),
    },
    scroll_height: document.body.scrollHeight,
  };
})()`;

async function run() {
  const port = 9800 + Math.floor(Math.random() * 200);
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

    // Click Exporter tab (nav tab labelled "Exporter")
    await send("Runtime.evaluate", {
      expression: `(() => { const t = Array.from(document.querySelectorAll(".prep-nav-tab")).find(b => /export/i.test(b.textContent||"")); t?.click(); return !!t; })();`,
      returnByValue: true,
    });
    await sleep(700);

    // Wait for screen root to be visible
    for (let i = 0; i < 30; i++) {
      const r = await send("Runtime.evaluate", {
        expression: `(() => { const el = document.querySelector(".screen.actions-screen"); if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0; })();`,
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

    const sr = data.elements.screen_root;
    if (sr) console.log(`  screen_root: ${sr.w}×${sr.h}`);
    const btn = data.elements.v2_run_btn;
    if (btn) console.log(`  v2_run_btn: ${btn.w}×${btn.h}  display:${btn.display}`);
    const ltc = data.elements.legacy_toggle_card;
    if (ltc) console.log(`  legacy_toggle_card: ${ltc.w}×${ltc.h}`);
    const lc = data.elements.legacy_container;
    if (lc) console.log(`  legacy_container: display:${lc.display}  h:${lc.h}`);

    console.log(`  presence:`, JSON.stringify(data.presence));
    console.log(`  text:`, JSON.stringify(data.text));

  } finally {
    if (cdp) await cdp.close();
    proc.kill();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
}

run().catch(err => { console.error("✗", err.message); process.exit(1); });
