/**
 * CurateApplyConfirmDialog.ts — curation apply-confirm modal, extracted from
 * CurationView (U-02).
 *
 * Stateless: renders a confirmation modal into a host-supplied bar element,
 * wires its own OK / Cancel / backdrop-click / Escape handlers, and resolves a
 * boolean. Holds no persistent state — it clears the bar on close. Behaviour is
 * identical to the original CurationView._showCurateApplyConfirm, including the
 * two early-out guards (no bar, or bar already visible → resolve false without
 * rendering).
 *
 * CSS classes stay `prep-*` (shell bundles prep CSS into one webview).
 */
import { escHtml } from "../lib/diff.ts";
import { setHtml, raw } from "../lib/safeHtml.ts";

/**
 * Show the curation apply-confirm modal in `bar`, resolving true on confirm and
 * false on cancel / backdrop click / Escape / guard failure. Pure DOM, no state.
 *
 * @param bar      Host container (`#act-curate-confirm-bar`), or null.
 * @param message  Plain-text message; blank lines are dropped, the rest are
 *                 HTML-escaped and joined with `<br>`.
 */
export function showCurateApplyConfirm(bar: HTMLElement | null, message: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!bar) { resolve(false); return; }
    if (bar.style.display !== "none") { resolve(false); return; }
    const html = message.split("\n").map(line => line.trim() ? `<span>${escHtml(line)}</span>` : "").filter(Boolean).join("<br>");
    setHtml(bar, raw(
      `<div class="prep-curate-confirm-modal" role="document">` +
        `<div class="prep-curate-confirm-body">${html}</div>` +
        `<div class="prep-curate-confirm-actions">` +
          `<button class="btn btn-ghost btn-sm" id="act-confirm-cancel">Annuler</button>` +
          `<button class="btn prep-btn-warning btn-sm" id="act-confirm-ok">Confirmer l'application</button>` +
        `</div>` +
      `</div>`));
    bar.style.display = "";
    // Backdrop click: NOT once:true — a click on an inner element bubbles up
    // and would consume the listener before any backdrop click could fire.
    // We remove it explicitly in cleanup() instead.
    const onBackdropClick = (e: MouseEvent) => { if (e.target === bar) decide(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") decide(false); };
    const cleanup = () => {
      bar.style.display = "none";
      bar.innerHTML = "";
      bar.removeEventListener("click", onBackdropClick);
      document.removeEventListener("keydown", onKey);
    };
    const decide = (ok: boolean) => { cleanup(); resolve(ok); };
    bar.querySelector("#act-confirm-ok")!.addEventListener("click", () => decide(true), { once: true });
    bar.querySelector("#act-confirm-cancel")!.addEventListener("click", () => decide(false), { once: true });
    bar.addEventListener("click", onBackdropClick);
    document.addEventListener("keydown", onKey);
    bar.querySelector<HTMLButtonElement>("#act-confirm-ok")?.focus();
  });
}
