#!/usr/bin/env node
/**
 * audit_import_capture.mjs — Post-Inc1 visual capture for Import view.
 *
 * Usage:
 *   node scripts/audit_import_capture.mjs \
 *     --mode runtime --url http://localhost:1421 \
 *     --out-json audit/prep/import/runtime_after_inc1_1440_metrics.json \
 *     --out-png  audit/prep/import/runtime_after_inc1_1440.png \
 *     [--width 1440 --height 900]
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

const args = parseArgs(process.argv);
const url = args.url;
const outJson = args["out-json"];
const outPng = args["out-png"];
const viewportW = Number(args.width || 1440);
const viewportH = Number(args.height || 900);

if (!url || !outJson || !outPng) {
  console.error("Usage: --url <url> --out-json <file> --out-png <file> [--width 1440 --height 900]");
  process.exit(2);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchJson(u) {
  const res = await fetch(u);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function waitForEndpoint(u, timeoutMs = 15000) {
  const start = Date.now();
  while (true) {
    try { return await fetchJson(u); } catch (_) {
      if (Date.now() - start > timeoutMs) throw new Error(`Timeout waiting ${u}`);
      await sleep(120);
    }
  }
}

function launchChrome(debugPort) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "agrafes-import-cdp-"));
  const proc = spawn(CHROME_BIN, [
    "--headless=new", "--disable-gpu", "--no-first-run",
    "--no-default-browser-check", "--disable-background-networking",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    `--window-size=${viewportW},${viewportH}`,
    "about:blank",
  ], { stdio: ["ignore", "ignore", "ignore"] });
  return { proc, userDataDir };
}

async function connectCdp(debugPort) {
  const targets = await waitForEndpoint(`http://127.0.0.1:${debugPort}/json/list`);
  const pageTarget = targets.find(t => t.type === "page" && t.webSocketDebuggerUrl);
  if (!pageTarget) throw new Error("No page target");
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let seq = 0;
  const pending = new Map();
  const eventWaiters = new Map();
  ws.onmessage = (evt) => {
    const msg = JSON.parse(String(evt.data));
    if (msg.id && pending.has(msg.id)) {
      const item = pending.get(msg.id); pending.delete(msg.id);
      if (msg.error) item.reject(new Error(msg.error.message)); else item.resolve(msg.result);
      return;
    }
    if (msg.method && eventWaiters.has(msg.method)) {
      const list = eventWaiters.get(msg.method); eventWaiters.delete(msg.method);
      for (const fn of list) fn(msg.params || {});
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const waitEvent = (method, timeoutMs = 15000) => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout ${method}`)), timeoutMs);
    const arr = eventWaiters.get(method) || [];
    arr.push((p) => { clearTimeout(t); resolve(p); });
    eventWaiters.set(method, arr);
  });
  const close = async () => { try { ws.close(); } catch (_) {} };
  return { send, waitEvent, close };
}

async function run() {
  const debugPort = 9300 + Math.floor(Math.random() * 400);
  const { proc, userDataDir } = launchChrome(debugPort);
  let cdp = null;
  try {
    await waitForEndpoint(`http://127.0.0.1:${debugPort}/json/version`, 15000);
    cdp = await connectCdp(debugPort);
    const { send, waitEvent } = cdp;

    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", {
      width: viewportW, height: viewportH, deviceScaleFactor: 1, mobile: false,
    });

    const loaded = waitEvent("Page.loadEventFired", 30000);
    await send("Page.navigate", { url });
    await loaded;
    await sleep(800); // wait for JS init

    // Navigate to Import tab (already default, but click to be safe)
    await send("Runtime.evaluate", {
      expression: `
        (() => {
          const tabs = Array.from(document.querySelectorAll(".prep-nav-tab"));
          const imp = tabs.find(t => (t.textContent || "").trim().includes("Import"));
          if (imp) imp.click();
          return true;
        })();
      `,
      returnByValue: true,
    });
    await sleep(400);

    // Wait for import-screen to be active
    for (let i = 0; i < 30; i++) {
      const r = await send("Runtime.evaluate", {
        expression: `Boolean(document.querySelector(".import-screen.active, .import-screen"))`,
        returnByValue: true,
      });
      if (r?.result?.value) break;
      await sleep(150);
    }
    await sleep(300);

    // Measure key elements
    const evalRes = await send("Runtime.evaluate", {
      returnByValue: true,
      expression: `
        (() => {
          const viewport = { w: ${viewportW}, h: ${viewportH} };
          const sel = (s) => document.querySelector(s);
          const rect = (s) => {
            const el = sel(s);
            if (!el) return null;
            const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            return {
              w: Math.round(r.width), h: Math.round(r.height),
              x: Math.round(r.x), y: Math.round(r.y),
              display: cs.display,
              position: cs.position,
              gridTemplateColumns: cs.gridTemplateColumns,
              gap: cs.gap,
              overflow: cs.overflow,
              overflowY: cs.overflowY,
              padding: cs.padding,
              background: cs.background,
              border: cs.border,
              borderTop: cs.borderTop,
              zIndex: cs.zIndex,
              flexDirection: cs.flexDirection,
            };
          };
          const present = (s) => !!sel(s);

          return {
            viewport,
            ts: new Date().toISOString(),
            elements: {
              import_screen:    rect(".import-screen"),
              head_card:        rect(".import-screen .imp-head-card"),
              state_banner:     rect(".import-screen #imp-state-banner"),
              steps:            rect(".import-screen .imp-steps"),
              workspace:        rect(".import-screen .imp-workspace"),
              col_main:         rect(".import-screen .imp-col-main"),
              col_side:         rect(".import-screen .imp-col-side"),
              dropzone:         rect(".import-screen .imp-dropzone"),
              file_list:        rect(".import-screen .imp-file-list"),
              settings_card:    rect(".import-screen .imp-settings-card"),
              precheck_card:    rect(".import-screen .imp-precheck-card"),
              footer_bar:       rect(".import-screen .imp-footer-bar"),
              import_btn:       rect(".import-screen #imp-import-btn"),
              add_btn:          rect(".import-screen #imp-add-btn"),
              summary_chip:     rect(".import-screen #imp-summary"),
            },
            presence: {
              workspace:        present(".import-screen .imp-workspace"),
              dropzone:         present(".import-screen .imp-dropzone"),
              col_main:         present(".import-screen .imp-col-main"),
              col_side:         present(".import-screen .imp-col-side"),
              footer_bar:       present(".import-screen .imp-footer-bar"),
              precheck_card:    present(".import-screen .imp-precheck-card"),
              settings_card:    present(".import-screen .imp-settings-card"),
              steps:            present(".import-screen .imp-steps"),
              state_banner:     present(".import-screen #imp-state-banner"),
            },
          };
        })();
      `,
    });

    const data = evalRes?.result?.value;
    if (!data) throw new Error("Failed to collect metrics");

    const shot = await send("Page.captureScreenshot", {
      format: "png", fromSurface: true,
      clip: { x: 0, y: 0, width: viewportW, height: viewportH, scale: 1 },
    });

    fs.mkdirSync(path.dirname(outJson), { recursive: true });
    fs.mkdirSync(path.dirname(outPng), { recursive: true });
    fs.writeFileSync(outJson, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    fs.writeFileSync(outPng, Buffer.from(shot.data, "base64"));

    console.log(`✓ JSON: ${outJson}`);
    console.log(`✓ PNG:  ${outPng}`);
    console.log(`  viewport: ${viewportW}×${viewportH}`);
    if (data.elements.workspace) {
      const ws = data.elements.workspace;
      console.log(`  workspace: ${ws.w}×${ws.h} px  grid-cols: ${ws.gridTemplateColumns}`);
    }
    if (data.elements.col_main)  console.log(`  col_main:  ${data.elements.col_main.w} px`);
    if (data.elements.col_side)  console.log(`  col_side:  ${data.elements.col_side.w} px`);
    if (data.elements.dropzone)  console.log(`  dropzone:  ${data.elements.dropzone.w}×${data.elements.dropzone.h} px`);
    if (data.elements.footer_bar) console.log(`  footer:    pos=${data.elements.footer_bar.position} z=${data.elements.footer_bar.zIndex}`);

  } finally {
    if (cdp) await cdp.close();
    proc.kill();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) {}
  }
}

run().catch(err => { console.error("✗", err.message); process.exit(1); });
