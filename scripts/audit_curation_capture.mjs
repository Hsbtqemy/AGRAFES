#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const CHROME_BIN = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const SELECTOR_MAP = [
  { key: "shell", component: "shell", mockup: "#shellMain", runtime: "#prep-shell-main" },
  { key: "nav", component: "shell", mockup: "#sectionsNav", runtime: "#prep-nav" },
  { key: "content", component: "shell", mockup: "main.content", runtime: "#prep-main-content > .content" },
  { key: "head_card", component: "head", mockup: ".head-card", runtime: ".acts-seg-head-card" },
  { key: "head_title", component: "head", mockup: ".head-card h1", runtime: ".acts-seg-head-card h1" },
  { key: "head_subtitle", component: "head", mockup: ".head-card p", runtime: ".acts-seg-head-card p" },
  { key: "head_tools", component: "head", mockup: ".head-tools", runtime: ".acts-hub-head-tools" },
  { key: "head_pill", component: "head", mockup: ".head-tools .pill", runtime: "#act-curate-mode-pill" },
  { key: "head_cta_longtext", component: "head", mockup: ".head-tools a[href*='prep-actions-longtext-vnext.html']", runtime: "#act-curate-lt-cta" },
  { key: "workspace", component: "workspace", mockup: ".workspace", runtime: "#act-curate-card .curate-workspace" },
  { key: "col_left", component: "workspace", mockup: ".workspace .col.left", runtime: "#act-curate-card .curate-col-left" },
  { key: "col_center", component: "workspace", mockup: ".workspace .col.center", runtime: "#act-curate-card .curate-col-center" },
  { key: "col_right", component: "workspace", mockup: ".workspace .col.right", runtime: "#act-curate-card .curate-col-right" },
  { key: "params_card", component: "left", mockup: ".workspace .col.left > article:first-child", runtime: "#act-curate-card .curate-col-left > article:first-child" },
  { key: "params_head", component: "left", mockup: ".workspace .col.left > article:first-child .card-head", runtime: "#act-curate-card .curate-col-left > article:first-child .card-head" },
  { key: "doc_select", component: "left", mockup: ".workspace .col.left > article:first-child select", runtime: "#act-curate-doc" },
  { key: "ctx_row", component: "left", mockup: ".workspace .col.left > article:first-child .row", runtime: "#act-curate-ctx" },
  { key: "ctx_cell", component: "left", mockup: ".workspace .col.left > article:first-child .row .f", runtime: "#act-curate-ctx .f" },
  { key: "rules_row", component: "left", mockup: ".workspace .col.left > article:first-child .chip-row", runtime: "#act-curate-card .curation-quick-rules" },
  { key: "rule_chip", component: "left", mockup: ".workspace .col.left > article:first-child .chip-row .chip", runtime: "#act-curate-card .curation-quick-rules .curation-chip" },
  { key: "actions_row", component: "left", mockup: ".workspace .col.left > article:first-child .btns", runtime: "#act-curate-card .curate-primary-actions" },
  { key: "btn_reset", component: "left", mockup: ".workspace .col.left > article:first-child .btns .btn:not(.alt):not(.pri)", runtime: "#act-curate-reset-btn" },
  { key: "btn_preview", component: "left", mockup: ".workspace .col.left > article:first-child .btns .btn.alt", runtime: "#act-preview-btn" },
  { key: "btn_apply", component: "left", mockup: ".workspace .col.left > article:first-child .btns .btn.pri", runtime: "#act-curate-btn" },
  { key: "advanced_panel", component: "left", mockup: ".workspace .col.left > article:first-child + article details", runtime: "#act-curate-advanced" },
  { key: "quick_actions_card", component: "left", mockup: ".workspace .col.left > article:nth-child(2)", runtime: "#act-curate-quick-actions" },
  { key: "preview_card", component: "center", mockup: ".workspace .col.center .preview-card", runtime: "#act-preview-panel" },
  { key: "preview_head", component: "center", mockup: ".workspace .col.center .preview-card .card-head", runtime: "#act-preview-panel .card-head" },
  { key: "preview_controls", component: "center", mockup: ".workspace .col.center .preview-controls", runtime: "#act-preview-panel .preview-controls" },
  { key: "preview_grid", component: "center", mockup: ".workspace .col.center .preview-grid", runtime: "#act-preview-panel .preview-grid" },
  { key: "pane_raw", component: "center", mockup: ".workspace .col.center .preview-grid .pane:nth-child(1)", runtime: "#act-preview-panel .preview-grid .pane:nth-child(1)" },
  { key: "pane_cured", component: "center", mockup: ".workspace .col.center .preview-grid .pane:nth-child(2)", runtime: "#act-preview-panel .preview-grid .pane:nth-child(2)" },
  { key: "pane_head", component: "center", mockup: ".workspace .col.center .pane-head", runtime: "#act-preview-panel .pane-head" },
  { key: "doc_scroll", component: "center", mockup: ".workspace .col.center .doc-scroll", runtime: "#act-preview-panel .doc-scroll" },
  { key: "minimap", component: "center", mockup: ".workspace .col.center .minimap", runtime: "#act-curate-minimap" },
  { key: "minimap_mark", component: "center", mockup: ".workspace .col.center .minimap .mm", runtime: "#act-curate-minimap .mm" },
  { key: "diag_card", component: "right", mockup: ".workspace .col.right > article:first-child", runtime: "#act-curate-card .curate-col-right > article:first-child" },
  { key: "diag_list", component: "right", mockup: ".workspace .col.right .diag-list", runtime: "#act-curate-diag" },
  { key: "diag_item", component: "right", mockup: ".workspace .col.right .diag", runtime: "#act-curate-diag .curate-diag" },
  { key: "review_card", component: "right", mockup: ".workspace .col.right > article:nth-child(2)", runtime: "#act-curate-card .curate-col-right > article:nth-child(2)" },
  { key: "review_log", component: "right", mockup: ".workspace .col.right > article:nth-child(2) .queue", runtime: "#act-curate-review-log" },
  { key: "review_item", component: "right", mockup: ".workspace .col.right > article:nth-child(2) .qitem", runtime: "#act-curate-review-log .curate-qitem, #act-curate-review-log .qitem" },
];

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const cur = argv[i];
    if (!cur.startsWith("--")) continue;
    const key = cur.slice(2);
    const nxt = argv[i + 1];
    if (nxt && !nxt.startsWith("--")) {
      out[key] = nxt;
      i += 1;
    } else {
      out[key] = "true";
    }
  }
  return out;
}

const args = parseArgs(process.argv);
const mode = args.mode === "runtime" ? "runtime" : "mockup";
const url = args.url;
const outJson = args["out-json"];
const outPng = args["out-png"];
const state = args.state || "nominal";
const viewportW = Number(args.width || 1440);
const viewportH = Number(args.height || 900);

if (!url || !outJson || !outPng) {
  console.error("Usage: --mode mockup|runtime --url <url> --out-json <file> --out-png <file> [--state nominal|one-collapsed|multi-collapsed|long-content] [--width 1440 --height 900]");
  process.exit(2);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(urlValue) {
  const res = await fetch(urlValue);
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${urlValue}`);
  return res.json();
}

async function waitForEndpoint(urlValue, timeoutMs = 10000) {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fetchJson(urlValue);
    } catch (_err) {
      if (Date.now() - start > timeoutMs) throw new Error(`Timeout waiting for ${urlValue}`);
      await sleep(120);
    }
  }
}

function launchChrome(debugPort) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "agrafes-cdp-"));
  const proc = spawn(
    CHROME_BIN,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${userDataDir}`,
      `--window-size=${viewportW},${viewportH}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "ignore"] },
  );
  return { proc, userDataDir };
}

async function connectCdp(debugPort) {
  const targets = await waitForEndpoint(`http://127.0.0.1:${debugPort}/json/list`);
  const pageTarget = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (!pageTarget) throw new Error("No page target with webSocketDebuggerUrl");
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = (e) => reject(e);
  });

  let seq = 0;
  const pending = new Map();
  const eventWaiters = new Map();

  ws.onmessage = (evt) => {
    const msg = JSON.parse(String(evt.data));
    if (msg.id && pending.has(msg.id)) {
      const item = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) item.reject(new Error(msg.error.message || "CDP error"));
      else item.resolve(msg.result);
      return;
    }
    if (msg.method && eventWaiters.has(msg.method)) {
      const list = eventWaiters.get(msg.method);
      eventWaiters.delete(msg.method);
      for (const fn of list) fn(msg.params || {});
    }
  };

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

  const waitEvent = (method, timeoutMs = 10000) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        reject(new Error(`Timeout waiting event ${method}`));
      }, timeoutMs);
      const cb = (params) => {
        clearTimeout(t);
        resolve(params);
      };
      const arr = eventWaiters.get(method) || [];
      arr.push(cb);
      eventWaiters.set(method, arr);
    });

  const close = async () => {
    try {
      ws.close();
    } catch (_err) {
      // ignore
    }
  };

  return { send, waitEvent, close };
}

async function run() {
  const debugPort = 9222 + Math.floor(Math.random() * 500);
  const { proc, userDataDir } = launchChrome(debugPort);
  let cdp = null;
  try {
    await waitForEndpoint(`http://127.0.0.1:${debugPort}/json/version`, 15000);
    cdp = await connectCdp(debugPort);
    const { send, waitEvent } = cdp;

    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", {
      width: viewportW,
      height: viewportH,
      deviceScaleFactor: 1,
      mobile: false,
    });

    const loaded = waitEvent("Page.loadEventFired", 30000);
    await send("Page.navigate", { url });
    await loaded;
    await sleep(300);

    if (mode === "runtime") {
      await send("Runtime.evaluate", {
        expression: `
          (() => {
            const tabs = Array.from(document.querySelectorAll(".prep-nav-tab"));
            const actions = tabs.find((t) => (t.textContent || "").trim() === "Actions");
            if (actions) actions.click();
            const cur = document.querySelector(".prep-nav-tree-link[data-nav='curation']");
            if (cur) cur.click();
            return true;
          })();
        `,
        returnByValue: true,
      });

      for (let i = 0; i < 40; i += 1) {
        const r = await send("Runtime.evaluate", {
          expression: `Boolean(document.querySelector("#act-curate-card"))`,
          returnByValue: true,
        });
        if (r?.result?.value) break;
        await sleep(120);
      }
      await sleep(250);
    }

    await send("Runtime.evaluate", {
      expression: `
        (() => {
          const mode = ${JSON.stringify(mode)};
          const state = ${JSON.stringify(state)};
          const q = (s) => document.querySelector(s);
          const qa = (s) => Array.from(document.querySelectorAll(s));
          const lorem = (n) => {
            const base = "Dans ce passage de travail, le texte reste continu et non segmente; il melange ponctuation forte et sequences longues afin de tester la stabilite de la preview.";
            return Array.from({length:n}, (_,i)=>"<p><span class='ln'>[" + String(i+1).padStart(4,'0') + "]</span>" + base + " Bloc " + (i+1) + ".</p>").join("");
          };

          const setTree = (open) => {
            const tree = q("[data-actions-tree], .prep-nav-tree");
            if (tree && typeof tree.open === "boolean") tree.open = open;
          };
          const setNavCollapsed = (collapsed) => {
            const shell = q("#shellMain, #prep-shell-main");
            if (!shell) return;
            shell.classList.toggle("nav-hidden", collapsed);
          };
          const setAdvanced = (open) => {
            const adv = q("#act-curate-advanced");
            if (adv && typeof adv.open === "boolean") adv.open = open;
          };
          const fillRuntimeLong = () => {
            const raw = q("#act-preview-raw");
            const diff = q("#act-diff-list");
            const diag = q("#act-curate-diag");
            const log = q("#act-curate-review-log");
            const mm = q("#act-curate-minimap");
            if (raw) raw.innerHTML = lorem(24);
            if (diff) diff.innerHTML = lorem(24).replaceAll("texte", "<mark>texte</mark>");
            if (diag) diag.innerHTML = "<div class='curate-diag warn'><strong>24 modifications a valider</strong>18 espaces multiples, 4 NBSP, 2 ponctuations fines.</div>"
              + "<div class='curate-diag'><strong>Impact segmentation estime</strong>0 collision attendue, 3 segments potentiellement fusionnes.</div>"
              + "<div class='curate-diag'><strong>Compat alignement</strong>Aucun changement de numerotation externe detecte.</div>";
            if (log) log.innerHTML = "<div class='curate-qitem'><div class='curate-qmeta'><span>Previsu</span><span>10:14</span></div><div>Rule spaces.normalize: 18 lignes</div></div>"
              + "<div class='curate-qitem'><div class='curate-qmeta'><span>Previsu</span><span>10:15</span></div><div>Rule nbsp.to_space: 4 lignes</div></div>"
              + "<div class='curate-qitem'><div class='curate-qmeta'><span>Apply</span><span>10:16</span></div><div>Preview diff regeneree (420 ms)</div></div>";
            if (mm) {
              mm.innerHTML = "";
              for (let i = 0; i < 18; i += 1) {
                const d = document.createElement("div");
                d.className = "mm" + (i % 5 === 0 ? " changed" : "") + (i === 7 ? " focus" : "");
                mm.appendChild(d);
              }
            }
          };
          const fillMockupLong = () => {
            const panes = qa(".workspace .col.center .doc-scroll");
            panes.forEach((p, idx) => {
              p.innerHTML = lorem(24);
              if (idx === 1) p.innerHTML = p.innerHTML.replaceAll("texte", "<mark>texte</mark>");
            });
            const diag = q(".workspace .col.right .diag-list");
            if (diag) {
              diag.innerHTML = "<div class='diag warn'><strong>24 modifications a valider</strong>18 espaces multiples, 4 NBSP, 2 ponctuations fines.</div>"
                + "<div class='diag'><strong>Impact segmentation estime</strong>0 collision attendue, 3 segments potentiellement fusionnes.</div>"
                + "<div class='diag'><strong>Compat alignement</strong>Aucun changement de numerotation externe detecte.</div>";
            }
            const log = q(".workspace .col.right article:nth-child(2) .queue");
            if (log) {
              log.innerHTML = "<div class='qitem'>10:14 - Rule spaces.normalize: 18 lignes</div>"
                + "<div class='qitem'>10:15 - Rule nbsp.to_space: 4 lignes</div>"
                + "<div class='qitem'>10:16 - Preview diff regeneree (420 ms)</div>";
            }
            const mm = q(".workspace .col.center .minimap");
            if (mm) {
              mm.innerHTML = "";
              for (let i = 0; i < 18; i += 1) {
                const d = document.createElement("div");
                d.className = "mm" + (i % 5 === 0 ? " changed" : "") + (i === 7 ? " focus" : "");
                mm.appendChild(d);
              }
            }
          };

          // Baseline explicit reset for reproducibility.
          setNavCollapsed(false);
          setTree(true);
          if (mode === "runtime") setAdvanced(false);

          if (state === "one-collapsed") {
            setTree(false);
          } else if (state === "multi-collapsed") {
            setTree(false);
            setNavCollapsed(true);
            if (mode === "runtime") setAdvanced(false);
          } else if (state === "long-content") {
            setTree(true);
            setNavCollapsed(false);
            if (mode === "runtime") {
              setAdvanced(false);
              fillRuntimeLong();
            } else {
              fillMockupLong();
            }
          }
          return true;
        })();
      `,
      returnByValue: true,
    });
    await sleep(220);

    const evalRes = await send("Runtime.evaluate", {
      returnByValue: true,
      expression: `
        (() => {
          const map = ${JSON.stringify(SELECTOR_MAP)};
          const modeInner = ${JSON.stringify(mode)};
          const viewport = { w: ${viewportW}, h: ${viewportH} };
      const pick = (cs) => ({
            display: cs.display,
            position: cs.position,
            overflow: cs.overflow,
            overflowY: cs.overflowY,
            gridTemplateColumns: cs.gridTemplateColumns,
            gridTemplateRows: cs.gridTemplateRows,
            gap: cs.gap,
            padding: cs.padding,
            margin: cs.margin,
            width: cs.width,
            height: cs.height,
            minHeight: cs.minHeight,
            maxHeight: cs.maxHeight,
            fontSize: cs.fontSize,
            fontWeight: cs.fontWeight,
            lineHeight: cs.lineHeight,
            borderRadius: cs.borderRadius,
            boxShadow: cs.boxShadow
          });
      const elements = {};
      const domPath = (el) => {
        const parts = [];
        let cur = el;
        while (cur && cur.nodeType === 1 && parts.length < 8) {
          const tag = cur.tagName.toLowerCase();
          const id = cur.id ? "#" + cur.id : "";
          let cls = "";
          if (!id && cur.classList && cur.classList.length) {
            cls = "." + Array.from(cur.classList).slice(0, 2).join(".");
          }
          let nth = "";
          if (!id && cur.parentElement) {
            const sib = Array.from(cur.parentElement.children).filter((c) => c.tagName === cur.tagName);
            if (sib.length > 1) nth = ":nth-of-type(" + (sib.indexOf(cur) + 1) + ")";
          }
          parts.unshift(tag + id + cls + nth);
          if (id) break;
          cur = cur.parentElement;
        }
        return parts.join(" > ");
      };
      const selector_map = [];
          for (const item of map) {
            const selector = modeInner === "mockup" ? item.mockup : item.runtime;
            selector_map.push({ key: item.key, component: item.component, selector });
            if (!selector) {
              elements[item.key] = { missing: true, selector: null, component: item.component };
              continue;
            }
            const el = document.querySelector(selector);
            if (!el) {
              elements[item.key] = { missing: true, selector, component: item.component };
              continue;
            }
            const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            elements[item.key] = {
              missing: false,
              selector,
              component: item.component,
              rect: { x: r.x, y: r.y, w: r.width, h: r.height, top: r.top, left: r.left },
              css: pick(cs),
              domPath: domPath(el),
              className: el.className || null,
              id: el.id || null,
              tag: el.tagName.toLowerCase()
            };
          }
          return {
            href: location.href,
            mode: modeInner,
            state: ${JSON.stringify(state)},
            viewport,
            ts: new Date().toISOString(),
            selector_map,
            elements
          };
        })();
      `,
    });

    const data = evalRes?.result?.value;
    if (!data) throw new Error("Failed to collect metrics from Runtime.evaluate");

    const shot = await send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      clip: { x: 0, y: 0, width: viewportW, height: viewportH, scale: 1 },
    });

    fs.mkdirSync(path.dirname(outJson), { recursive: true });
    fs.mkdirSync(path.dirname(outPng), { recursive: true });
    fs.writeFileSync(outJson, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    fs.writeFileSync(outPng, Buffer.from(shot.data, "base64"));
  } finally {
    if (cdp) await cdp.close();
    try {
      proc.kill("SIGTERM");
    } catch (_err) {
      // ignore
    }
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch (_err) {
      // ignore
    }
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
