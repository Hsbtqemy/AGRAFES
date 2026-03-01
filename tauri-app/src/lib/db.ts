/**
 * db.ts — DB path management + default corpus location.
 *
 * On first run, if no DB is open, the app creates a default DB in the
 * platform app data directory.
 */

import { appDataDir } from "@tauri-apps/api/path";
import { mkdir, exists } from "@tauri-apps/plugin-fs";

const DB_FILENAME = "corpus.db";
let _currentDbPath: string | null = null;

export function getCurrentDbPath(): string | null {
  return _currentDbPath;
}

export function setCurrentDbPath(path: string): void {
  _currentDbPath = path;
}

export async function getOrCreateDefaultDbPath(): Promise<string> {
  if (_currentDbPath) return _currentDbPath;

  const dataDir = await appDataDir();

  // Ensure the directory exists
  if (!(await exists(dataDir))) {
    await mkdir(dataDir, { recursive: true });
  }

  // Use OS path separator
  const sep = dataDir.includes("/") ? "/" : "\\";
  const dbPath = `${dataDir}${sep}${DB_FILENAME}`;
  _currentDbPath = dbPath;
  return dbPath;
}
