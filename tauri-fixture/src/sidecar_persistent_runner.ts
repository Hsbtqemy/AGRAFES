import { Command } from "@tauri-apps/plugin-shell";
import { readTextFile } from "@tauri-apps/plugin-fs";

type JsonObject = Record<string, unknown>;

function parseSingleJson(text: string): JsonObject {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    throw new Error("stdout is not a single JSON object");
  }
  const parsed = JSON.parse(trimmed);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("stdout JSON payload must be an object");
  }
  return parsed as JsonObject;
}

function readFirstJsonFromStream(getData: (onData: (chunk: string) => void) => void): Promise<JsonObject> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    let depth = 0;
    let started = false;
    const timer = setTimeout(() => reject(new Error("timeout waiting sidecar startup JSON")), 10000);

    getData((chunk) => {
      buffer += chunk;
      for (const ch of chunk) {
        if (ch === "{") {
          depth += 1;
          started = true;
        } else if (ch === "}") {
          depth -= 1;
          if (started && depth === 0) {
            clearTimeout(timer);
            resolve(parseSingleJson(buffer));
            return;
          }
        }
      }
    });
  });
}

async function loadTokenFromPortfile(started: JsonObject): Promise<string | null> {
  const portfile = started.portfile;
  if (typeof portfile !== "string" || portfile.length === 0) {
    return null;
  }
  try {
    const raw = await readTextFile(portfile);
    const payload = JSON.parse(raw) as Record<string, unknown>;
    const token = payload.token;
    if (typeof token === "string" && token.length > 0) {
      return token;
    }
  } catch {
    return null;
  }
  return null;
}

export async function runPersistentSidecarFlow(dbPath: string): Promise<JsonObject> {
  let child;
  try {
    child = await Command.sidecar("binaries/multicorpus", [
      "serve",
      "--db",
      dbPath,
      "--host",
      "127.0.0.1",
      "--port",
      "0",
    ]).spawn();
  } catch (err) {
    throw new Error(`failed to spawn sidecar: ${String(err)}`);
  }

  const started = await readFirstJsonFromStream((onData) => {
    child.stdout.on("data", (line) => onData(line));
  });

  const host = String(started.host ?? "127.0.0.1");
  const port = Number(started.port);
  if (!Number.isFinite(port)) {
    throw new Error("sidecar startup payload missing port");
  }
  const baseUrl = `http://${host}:${port}`;

  const healthRes = await fetch(`${baseUrl}/health`);
  const healthText = await healthRes.text();
  const health = parseSingleJson(healthText);
  if (!healthRes.ok || health.ok !== true) {
    throw new Error(`sidecar health failed: ${healthText}`);
  }
  const token = await loadTokenFromPortfile(started);
  const writeHeaders: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
  };
  if (token) {
    writeHeaders["X-Agrafes-Token"] = token;
  }

  const queryRes = await fetch(`${baseUrl}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ q: "needle", mode: "segment" }),
  });
  const queryText = await queryRes.text();
  const queryPayload = parseSingleJson(queryText);
  if (!queryRes.ok || queryPayload.ok !== true) {
    throw new Error(`sidecar query failed: ${queryText}`);
  }

  await fetch(`${baseUrl}/shutdown`, {
    method: "POST",
    headers: writeHeaders,
    body: "{}",
  });

  return {
    started,
    health,
    query: queryPayload,
  };
}
