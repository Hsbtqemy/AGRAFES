/**
 * db.ts — DB path helpers for ConcordancierPrep.
 */

import { appDataDir } from "@tauri-apps/api/path";
import { mkdir, exists } from "@tauri-apps/plugin-fs";

let _currentDbPath: string | null = null;

export async function getOrCreateDefaultDbPath(): Promise<string> {
  const dataDir = await appDataDir();
  const dirExists = await exists(dataDir);
  if (!dirExists) {
    await mkdir(dataDir, { recursive: true });
  }
  const sep = dataDir.includes("/") ? "/" : "\\";
  return `${dataDir}${sep}corpus.db`;
}

export function getCurrentDbPath(): string | null {
  return _currentDbPath;
}

export function setCurrentDbPath(p: string): void {
  _currentDbPath = p;
}
