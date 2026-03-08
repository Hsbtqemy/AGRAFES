/**
 * styleRegistry.ts — Idempotent style injection helpers for tauri-shell.
 *
 * Problem: child modules (esp. tauri-prep's App.init()) inject <style> tags on every
 * mount without guards, causing accumulation in <head> across navigations.
 *
 * Solution: all style injection goes through this registry.  Each tag/link is keyed
 * by a stable string id.  Subsequent calls with the same id are no-ops.
 *
 * This module has zero dependencies and runs in any browser-compatible environment,
 * making it straightforward to unit-test with a JSDOM-like shim (see scripts/test_style_registry.mjs).
 */

/** Insert a <style id="…"> once; subsequent calls with the same id are no-ops. */
export function ensureStyleTag(id: string, cssText: string): HTMLStyleElement {
  const existing = document.getElementById(id);
  if (existing instanceof HTMLStyleElement) return existing;

  const style = document.createElement("style");
  style.id = id;
  style.textContent = cssText;
  document.head.appendChild(style);
  return style;
}

/** Insert a <link rel="stylesheet" id="…"> once; subsequent calls are no-ops. */
export function ensureStylesheetLink(id: string, href: string): HTMLLinkElement {
  const existing = document.getElementById(id);
  if (existing instanceof HTMLLinkElement) return existing;

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.id = id;
  link.href = href;
  document.head.appendChild(link);
  return link;
}

/** Remove a managed <style> or <link> by id; no-op if absent. */
export function removeStyleTag(id: string): void {
  document.getElementById(id)?.remove();
}

/** Alias for removeStyleTag — removes any element (style or link) by id. */
export const removeLink = removeStyleTag;

/**
 * Count style/link elements in <head> whose id starts with the given prefix.
 * Useful for assertions in tests and for runtime diagnostics.
 */
export function countManagedStyles(prefix: string): number {
  let count = 0;
  for (const el of document.head.children) {
    if (
      (el instanceof HTMLStyleElement || el instanceof HTMLLinkElement) &&
      el.id.startsWith(prefix)
    ) {
      count++;
    }
  }
  return count;
}
