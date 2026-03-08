/**
 * styleRegistry.ts — Idempotent style injection helpers for tauri-shell.
 *
 * History: created in P3 to prevent <style> tag accumulation across navigations.
 * Since P6, embedded-module CSS is handled by Vite imports (constituerModule.ts),
 * so this module has no active production callers — Vite tree-shakes it from the
 * output bundle.
 *
 * Kept as a utility library because:
 * 1. The 20 unit tests (test_style_registry.mjs) document the idempotency contract.
 * 2. Runtime CSS injection may be needed for future features (dynamic theming,
 *    external stylesheet loading, P8+ modules that can't rely on static Vite imports).
 * 3. Zero build cost when unused.
 *
 * If a new consumer is added, import directly — no registration step is needed.
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
