/**
 * constituerModule.ts — Shell wrapper for ConcordancierPrep (tauri-prep).
 *
 * Exposes mount/dispose so shell.ts never reaches into module internals directly.
 * The ShellContext propagates the active DB path before init; since App.init()
 * calls getOrCreateDefaultDbPath() which now checks _currentDbPath first,
 * setting it here is sufficient — no change to App needed.
 */

import type { ShellContext } from "../context.ts";
import { setCurrentDbPath } from "../../../tauri-prep/src/lib/db.ts";
import { App } from "../../../tauri-prep/src/app.ts";

let _app: App | null = null;

export async function mount(
  container: HTMLElement,
  ctx: ShellContext
): Promise<void> {
  const dbPath = ctx.getDbPath();
  if (dbPath) setCurrentDbPath(dbPath);
  // tauri-prep's App finds #app via document.getElementById — the shell swaps
  // the container before calling mount, so #app is already the fresh element.
  void container; // container is #app; referenced for API consistency
  _app = new App();
  await _app.init();
}

export function dispose(): void {
  if (!_app) return;
  try { _app.dispose(); } catch { /* ignore */ }
  _app = null;
}
