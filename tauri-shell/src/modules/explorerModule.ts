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

  // Onboarding welcome hint: prefill search bar if requested by guided tour
  _maybeShowWelcomeHint(container);
}

function _maybeShowWelcomeHint(container: HTMLElement): void {
  let prefill: string | null = null;
  try { prefill = sessionStorage.getItem("agrafes.explorer.prefill"); } catch { /* */ }
  if (!prefill) return;

  // Clear the session flag immediately (show once)
  try { sessionStorage.removeItem("agrafes.explorer.prefill"); } catch { /* */ }

  // Try to find the search input and prefill it
  const tryFill = (attempts: number): void => {
    const input = container.querySelector<HTMLInputElement>(
      "input[type='text'], input[type='search'], .search-input, #search-input, #query-input"
    );
    if (input) {
      input.value = prefill!;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      // Show a transient hint tooltip near the input
      const hint = document.createElement("div");
      hint.style.cssText = [
        "position:fixed;bottom:5rem;left:50%;transform:translateX(-50%)",
        "background:#0369a1;color:#fff;font-size:0.82rem;padding:0.4rem 1rem",
        "border-radius:20px;box-shadow:0 2px 8px rgba(0,0,0,0.2);z-index:99999",
        "pointer-events:none;opacity:1;transition:opacity 0.4s",
      ].join(";");
      hint.textContent = `💡 Astuce : la barre de recherche est pré-remplie avec « ${prefill} ». Appuyez Entrée pour chercher.`;
      document.body.appendChild(hint);
      // Auto-remove after first search or 8 seconds
      const remove = (): void => {
        hint.style.opacity = "0";
        setTimeout(() => hint.remove(), 450);
        input.removeEventListener("keydown", remove);
      };
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") remove(); });
      setTimeout(remove, 8000);
    } else if (attempts > 0) {
      setTimeout(() => tryFill(attempts - 1), 300);
    }
  };
  // Wait for Explorer DOM to settle
  setTimeout(() => tryFill(10), 200);
}

export function dispose(): void {
  if (!_mounted) return;
  try { disposeApp(); } catch { /* ignore */ }
  _mounted = false;
}
