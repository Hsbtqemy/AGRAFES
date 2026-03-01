/**
 * explorerModule.ts — Shell wrapper for the Concordancier (tauri-app).
 *
 * Exposes mount/dispose so shell.ts never reaches into module internals directly.
 * The ShellContext propagates the active DB path before init, ensuring the module
 * uses the shell-selected DB rather than computing its own default.
 */

import type { ShellContext } from "../context.ts";
import { setCurrentDbPath } from "../../../tauri-app/src/lib/db.ts";
import { initApp, disposeApp } from "../../../tauri-app/src/app.ts";

let _mounted = false;

export async function mount(
  container: HTMLElement,
  ctx: ShellContext
): Promise<void> {
  const dbPath = ctx.getDbPath();
  if (dbPath) setCurrentDbPath(dbPath);
  await initApp(container);
  _mounted = true;
}

export function dispose(): void {
  if (!_mounted) return;
  try { disposeApp(); } catch { /* ignore */ }
  _mounted = false;
}
