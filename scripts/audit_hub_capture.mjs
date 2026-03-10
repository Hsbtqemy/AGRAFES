#!/usr/bin/env node
/**
 * audit_hub_capture.mjs — Post-Inc1 visual capture for Actions Hub view.
 * Usage:
 *   node scripts/audit_hub_capture.mjs \
 *     --url http://localhost:1421 \
 *     --out-json audit/prep/actions-hub/runtime_after_inc1_1440_metrics.json \
 *     --out-png  audit/prep/actions-hub/runtime_after_inc1_1440.png \
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

const args     = parseArgs(process.argv);
const url      = args.url;
const outJson  = args["out-json"];
const outPng   = args["out-png"];
const viewportW = Number(args.width  || 1440);
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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "agrafes-hub-cdp-"));
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
  const debugPort = 9500 + Math.floor(Math.random() * 400);
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
    await sleep(800);

    // Click Actions tab
    await send("Runtime.evaluate", {
      expression: `(() => {
        const tabs = Array.from(document.querySelectorAll(".prep-nav-tab"));
        const tab = tabs.find(t => (t.textContent || "").trim().toLowerCase().includes("action"));
        if (tab) tab.click();
        return !!tab;
      })();`,
      returnByValue: true,
    });
    await sleep(500);

    // Wait for .acts-hub to appear
    for (let i = 0; i < 30; i++) {
      const r = await send("Runtime.evaluate", {
        expression: `Boolean(document.querySelector(".acts-hub"))`,
        returnByValue: true,
      });
      if (r?.result?.value) break;
      await sleep(150);
    }
    await sleep(400);

    // Measure key elements
    const evalRes = await send("Runtime.evaluate", {
      returnByValue: true,
      expression: `(() => {
        const viewport = { w: ${viewportW}, h: ${viewportH} };
        const sel = (s) => document.querySelector(s);
        const selAll = (s) => Array.from(document.querySelectorAll(s));
        const rect = (s) => {
          const el = sel(s);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return {
            w: Math.round(r.width), h: Math.round(r.height),
            x: Math.round(r.x), y: Math.round(r.y),
            display: cs.display,
            gridTemplateColumns: cs.gridTemplateColumns,
          };
        };
        const present = (s) => !!sel(s);
        const wfCards = selAll(".acts-hub-wf-card").map(el => {
          const r = el.getBoundingClientRect();
          return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) };
        });
        return {
          viewport,
          ts: new Date().toISOString(),
          elements: {
            acts_hub:          rect(".acts-hub"),
            hub_head_card:     rect(".acts-hub-head-card"),
            hub_workspace:     rect(".acts-hub-workspace"),
            hub_wf_card_0:     wfCards[0] || null,
            hub_wf_card_1:     wfCards[1] || null,
            hub_wf_card_2:     wfCards[2] || null,
          },
          presence: {
            acts_hub:          present(".acts-hub"),
            hub_head_card:     present(".acts-hub-head-card"),
            acts_hub_head_title: present(".acts-hub-head-title"),
            hub_workspace:     present(".acts-hub-workspace"),
            hub_wf_card:       present(".acts-hub-wf-card"),
            hub_wf_btn:        present(".acts-hub-wf-btn"),
            hub_wf_link:       present(".acts-hub-wf-link"),
            hub_wf_top:        present(".acts-hub-wf-top"),
            hub_wf_step:       present(".acts-hub-wf-step"),
          },
          wf_card_count: selAll(".acts-hub-wf-card").length,
          wf_btn_count:  selAll(".acts-hub-wf-btn").length,
        };
      })();`,
    });

    const data = evalRes?.result?.value;
    if (!data) throw new Error("Failed to collect metrics");

    const shot = await send("Page.captureScreenshot", {
      format: "png", fromSurface: true,
      clip: { x: 0, y: 0, width: viewportW, height: viewportH, scale: 1 },
    });

    fs.mkdirSync(path.dirname(outJson), { recursive: true });
    fs.mkdirSync(path.dirname(outPng),  { recursive: true });
    fs.writeFileSync(outJson, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    fs.writeFileSync(outPng,  Buffer.from(shot.data, "base64"));

    console.log(`✓ JSON: ${outJson}`);
    console.log(`✓ PNG:  ${outPng}`);
    console.log(`  viewport: ${viewportW}×${viewportH}`);
    console.log(`  wf_card_count: ${data.wf_card_count}  wf_btn_count: ${data.wf_btn_count}`);
    if (data.elements.hub_workspace) {
      const ws = data.elements.hub_workspace;
      console.log(`  hub-workspace: ${ws.w}×${ws.h}  grid-cols: ${ws.gridTemplateColumns}`);
    }
    if (data.elements.hub_wf_card_0) {
      const c0 = data.elements.hub_wf_card_0;
      const c1 = data.elements.hub_wf_card_1;
      const c2 = data.elements.hub_wf_card_2;
      console.log(`  wf-card widths: ${c0?.w}px / ${c1?.w}px / ${c2?.w}px`);
    }
    console.log(`  presence:`, JSON.stringify(data.presence));

  } finally {
    if (cdp) await cdp.close();
    proc.kill();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) {}
  }
}

run().catch(err => { console.error("✗", err.message); process.exit(1); });
