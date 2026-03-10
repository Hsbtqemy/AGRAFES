#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CAPTURE = path.join(ROOT, "scripts", "audit_curation_capture.mjs");
const OUT_ROOT = path.join(ROOT, "artifacts", "ui-audit");
const OUT_JSON = path.join(OUT_ROOT, "json");
const OUT_PNG = path.join(OUT_ROOT, "screenshots");

const WIDTHS = [1280, 1366, 1440, 1536, 1600, 1728, 1920];
const HEIGHT = 900;
const STATES = ["nominal", "one-collapsed", "multi-collapsed", "long-content"];
const MODES = ["mockup", "runtime"];

const URLS = {
  mockup: "file:///Users/hsmy/Dev/AGRAFES/prototypes/visual-validation/prep/prep-curation-preview-vnext.html",
  runtime: "http://127.0.0.1:4173/",
};

fs.mkdirSync(OUT_JSON, { recursive: true });
fs.mkdirSync(OUT_PNG, { recursive: true });

const index = [];

for (const mode of MODES) {
  for (const state of STATES) {
    for (const width of WIDTHS) {
      const base = `${mode}__${state}__w${width}`;
      const outJson = path.join(OUT_JSON, `${base}.json`);
      const outPng = path.join(OUT_PNG, `${base}.png`);
      const args = [
        CAPTURE,
        "--mode",
        mode,
        "--url",
        URLS[mode],
        "--state",
        state,
        "--out-json",
        outJson,
        "--out-png",
        outPng,
        "--width",
        String(width),
        "--height",
        String(HEIGHT),
      ];
      process.stdout.write(`[audit] ${base}\n`);
      const r = spawnSync("node", args, { cwd: ROOT, stdio: "inherit" });
      if (r.status !== 0) {
        process.stderr.write(`[audit] capture failed: ${base}\n`);
        process.exit(r.status ?? 1);
      }
      index.push({
        mode,
        state,
        width,
        height: HEIGHT,
        json: path.relative(ROOT, outJson),
        screenshot: path.relative(ROOT, outPng),
      });
    }
  }
}

fs.writeFileSync(path.join(OUT_ROOT, "matrix-index.json"), `${JSON.stringify(index, null, 2)}\n`, "utf8");
process.stdout.write(`[audit] wrote ${index.length} captures + matrix-index.json\n`);
