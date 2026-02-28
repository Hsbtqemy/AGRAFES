#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function fail(message, details = {}) {
  const payload = { ok: false, error: message, ...details };
  console.log(JSON.stringify(payload, null, 2));
  process.exit(1);
}

function parseSingleJson(label, stdout) {
  const trimmed = (stdout ?? "").trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    fail(`${label}: stdout is not a single JSON object`, { stdout: trimmed });
  }
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    fail(`${label}: stdout is not valid JSON`, { stdout: trimmed, error: String(error) });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail(`${label}: parsed payload is not a JSON object`, { stdout: trimmed });
  }
  return parsed;
}

function resolveSidecarBinary() {
  const explicit = process.env.SIDECAR_BIN;
  if (explicit) {
    if (!fs.existsSync(explicit)) {
      fail("SIDECAR_BIN does not exist", { SIDECAR_BIN: explicit });
    }
    return explicit;
  }

  const sidecarDir = process.env.SIDECAR_DIR
    ? path.resolve(process.env.SIDECAR_DIR)
    : path.resolve(__dirname, "..", "src-tauri", "binaries");

  if (!fs.existsSync(sidecarDir)) {
    fail("Sidecar directory not found", { sidecarDir });
  }

  const manifestPath = path.join(sidecarDir, "sidecar-manifest.json");
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    const explicitExe = manifest?.executable_path;
    if (typeof explicitExe === "string" && explicitExe.length > 0 && fs.existsSync(explicitExe)) {
      return explicitExe;
    }
    const triple = manifest?.target_triple;
    if (typeof triple === "string" && triple.length > 0) {
      const expectedName =
        process.platform === "win32"
          ? `multicorpus-${triple}.exe`
          : `multicorpus-${triple}`;
      const expectedPath = path.join(sidecarDir, expectedName);
      if (fs.existsSync(expectedPath)) {
        return expectedPath;
      }
    }
  }

  const files = fs.readdirSync(sidecarDir).filter((f) => {
    if (!f.startsWith("multicorpus-")) return false;
    return fs.statSync(path.join(sidecarDir, f)).isFile();
  });
  const preferred = files.find((f) => {
    if (process.platform === "darwin") return f.includes("apple-darwin") && !f.endsWith(".exe");
    if (process.platform === "linux") return f.includes("unknown-linux-gnu") && !f.endsWith(".exe");
    if (process.platform === "win32") return f.endsWith(".exe") && f.includes("windows-msvc");
    return true;
  });

  const fallback = preferred || files[0];
  if (!fallback) {
    fail("No sidecar binary found in directory", { sidecarDir });
  }
  return path.join(sidecarDir, fallback);
}

function runOneShotStep(binaryPath, label, args, expectedRc) {
  const proc = spawnSync(binaryPath, args, { encoding: "utf-8" });
  const stderr = (proc.stderr ?? "").trim();
  if (stderr !== "") {
    fail(`${label}: stderr must be empty`, { stderr, rc: proc.status });
  }
  if (proc.status !== expectedRc) {
    fail(`${label}: unexpected exit code`, {
      rc: proc.status,
      expectedRc,
      stdout: (proc.stdout ?? "").trim(),
    });
  }
  const payload = parseSingleJson(label, proc.stdout);
  return {
    label,
    rc: proc.status,
    status: payload.status,
    ok: payload.ok,
    keys: Object.keys(payload).sort(),
  };
}

async function readFirstJsonObject(stream, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    let depth = 0;
    let started = false;

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("timeout waiting for first JSON object from sidecar serve stdout"));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      stream.off("data", onData);
      stream.off("error", onErr);
      stream.off("close", onClose);
      stream.off("end", onClose);
    }

    function onErr(err) {
      cleanup();
      reject(err);
    }

    function onClose() {
      cleanup();
      reject(new Error(`stdout closed before first JSON object: ${buffer}`));
    }

    function onData(chunk) {
      const text = chunk.toString("utf-8");
      buffer += text;
      for (const ch of text) {
        if (ch === "{") {
          depth += 1;
          started = true;
        } else if (ch === "}") {
          depth -= 1;
          if (started && depth === 0) {
            cleanup();
            resolve(parseSingleJson("serve-initial", buffer));
            return;
          }
        }
      }
    }

    stream.on("data", onData);
    stream.on("error", onErr);
    stream.on("close", onClose);
    stream.on("end", onClose);
  });
}

async function httpJson(method, url, payload = null, timeoutMs = 10000, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        ...extraHeaders,
      },
      body: payload === null ? undefined : JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await res.text();
    const data = JSON.parse(text);
    return { statusCode: res.status, payload: data };
  } finally {
    clearTimeout(timer);
  }
}

async function waitForHealth(baseUrl, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const { statusCode, payload } = await httpJson("GET", `${baseUrl}/health`);
      if (statusCode === 200 && payload.ok === true && payload.status === "ok") {
        return payload;
      }
    } catch {
      // retry until timeout
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  fail("persistent-health: sidecar not ready", { baseUrl });
}

async function runPersistentScenario(binaryPath, tmpRoot) {
  const dbPath = path.join(tmpRoot, "persistent.db");
  const txtPath = path.join(tmpRoot, "fixture.txt");
  fs.writeFileSync(txtPath, "[1] Bonjour needle.\n[2] Une autre ligne.\n", "utf-8");

  const child = spawn(binaryPath, ["serve", "--db", dbPath, "--host", "127.0.0.1", "--port", "0"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderrCapture = "";
  child.stderr.on("data", (chunk) => {
    stderrCapture += chunk.toString("utf-8");
  });

  try {
    const initial = await readFirstJsonObject(child.stdout, 20000);
    if (initial.status !== "listening") {
      fail("persistent-serve: status must be listening", { initial });
    }
    const host = initial.host ?? "127.0.0.1";
    const port = initial.port;
    if (typeof port !== "number") {
      fail("persistent-serve: missing numeric port", { initial });
    }
    const baseUrl = `http://${host}:${port}`;

    const health = await waitForHealth(baseUrl, 20000);
    let token = null;
    const portfilePath = initial.portfile;
    if (typeof portfilePath === "string" && fs.existsSync(portfilePath)) {
      const portMeta = JSON.parse(fs.readFileSync(portfilePath, "utf-8"));
      token = typeof portMeta?.token === "string" && portMeta.token.length > 0
        ? portMeta.token
        : null;
    }
    if (health.token_required === true && token === null) {
      fail("persistent-auth: sidecar requires token but no token was found in portfile", {
        portfilePath,
      });
    }
    const writeHeaders = token ? { "X-Agrafes-Token": token } : {};

    const imported = await httpJson("POST", `${baseUrl}/import`, {
      mode: "txt_numbered_lines",
      path: txtPath,
      language: "fr",
      title: "Fixture",
    }, 10000, writeHeaders);
    if (imported.statusCode !== 200 || imported.payload.ok !== true) {
      fail("persistent-import failed", imported);
    }

    const indexed = await httpJson("POST", `${baseUrl}/index`, {}, 10000, writeHeaders);
    if (indexed.statusCode !== 200 || indexed.payload.ok !== true) {
      fail("persistent-index failed", indexed);
    }

    const queried = await httpJson("POST", `${baseUrl}/query`, {
      q: "needle",
      mode: "segment",
    });
    if (queried.statusCode !== 200 || queried.payload.ok !== true) {
      fail("persistent-query failed", queried);
    }

    const shut = await httpJson("POST", `${baseUrl}/shutdown`, {}, 10000, writeHeaders);
    if (shut.statusCode !== 200 || shut.payload.ok !== true) {
      fail("persistent-shutdown failed", shut);
    }

    await new Promise((resolve) => {
      const t = setTimeout(() => {
        try {
          child.kill();
        } catch {}
        resolve();
      }, 10000);
      child.once("exit", () => {
        clearTimeout(t);
        resolve();
      });
    });

    if (stderrCapture.trim() !== "") {
      fail("persistent-serve: stderr must be empty", { stderr: stderrCapture.trim() });
    }

    return {
      scenario: "persistent",
      serve: {
        host,
        port,
        pid: initial.pid,
        portfile: initial.portfile,
        token_required: health.token_required === true,
      },
      health_status: health.status,
      query_count: queried.payload.count,
      import_doc_id: imported.payload.doc_id,
    };
  } finally {
    if (!child.killed && child.exitCode === null) {
      try {
        child.kill();
      } catch {}
    }
  }
}

async function main() {
  const scenario = process.env.FIXTURE_SCENARIO || "persistent";
  const binaryPath = resolveSidecarBinary();
  if (process.platform !== "win32") {
    fs.chmodSync(binaryPath, 0o755);
  }

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agrafes-tauri-fixture-"));
  const summary = {
    ok: true,
    binary: binaryPath,
    platform: process.platform,
    scenario,
    runs: [],
  };

  if (scenario === "oneshot" || scenario === "both") {
    const dbPath = path.join(tmpRoot, "oneshot.db");
    summary.runs.push({
      scenario: "oneshot",
      steps: [
        runOneShotStep(binaryPath, "init-project", ["init-project", "--db", dbPath], 0),
        runOneShotStep(binaryPath, "query-segment", ["query", "--db", dbPath, "--q", "needle", "--mode", "segment"], 0),
        runOneShotStep(binaryPath, "query-invalid-mode", ["query", "--db", dbPath, "--q", "needle", "--mode", "invalid"], 1),
      ],
    });
  }

  if (scenario === "persistent" || scenario === "both") {
    summary.runs.push(await runPersistentScenario(binaryPath, tmpRoot));
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  fail("fixture smoke crashed", { error: String(error) });
});
