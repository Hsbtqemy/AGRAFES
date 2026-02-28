import { Command } from "@tauri-apps/plugin-shell";

function parseSingleJson(stdout: string): Record<string, unknown> {
  const trimmed = stdout.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    throw new Error("stdout is not a single JSON object");
  }
  const parsed = JSON.parse(trimmed);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("stdout JSON payload must be an object");
  }
  return parsed as Record<string, unknown>;
}

export async function runSidecarInitProject(dbPath: string): Promise<Record<string, unknown>> {
  const command = Command.sidecar("binaries/multicorpus", [
    "init-project",
    "--db",
    dbPath,
  ]);
  const result = await command.execute();
  if (result.stderr.trim() !== "") {
    throw new Error(`stderr must stay empty, got: ${result.stderr}`);
  }
  if (result.code !== 0) {
    throw new Error(`init-project failed with rc=${result.code}`);
  }
  return parseSingleJson(result.stdout);
}
