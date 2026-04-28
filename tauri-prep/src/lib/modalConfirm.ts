/**
 * modalConfirm.ts — Centered modal confirm dialog.
 *
 * Used in place of `window.confirm()` because Tauri's WebView2/WebKit
 * implementation of native confirm() can be erratic (the dialog appears but
 * its blocking semantics are not guaranteed across platforms — leading to
 * cases where the action proceeds even after the user clicked Cancel).
 *
 * Tracking issue : https://github.com/Hsbtqemy/AGRAFES/issues/40
 * (upstream tauri-apps/tauri issue à ouvrir plus tard pour solliciter un fix
 * ou une mise à jour de la doc côté Tauri 2.x ; en attendant, ce helper est
 * la référence interne).
 *
 * Returns a Promise<boolean> that resolves true if confirmed, false if
 * cancelled (via button, Escape, or backdrop click).
 */

function _esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function modalConfirm(opts: {
  message: string;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "prep-modal-confirm-overlay";

    const dialog = document.createElement("div");
    dialog.className = "prep-modal-confirm";
    dialog.setAttribute("role", "alertdialog");
    dialog.setAttribute("aria-modal", "true");

    const titleHtml = opts.title
      ? `<div class="prep-modal-confirm-title">${_esc(opts.title)}</div>`
      : "";
    const bodyHtml = opts.message
      .split("\n")
      .map((line) => (line.trim() ? `<div>${_esc(line)}</div>` : "<div>&nbsp;</div>"))
      .join("");
    const danger = opts.danger !== false;
    const confirmCls = danger ? "btn-danger" : "btn-primary";

    dialog.innerHTML = `
      ${titleHtml}
      <div class="prep-modal-confirm-body">${bodyHtml}</div>
      <div class="prep-modal-confirm-actions">
        <button class="btn btn-ghost btn-sm" data-mc-cancel>${_esc(opts.cancelLabel ?? "Annuler")}</button>
        <button class="btn ${confirmCls} btn-sm" data-mc-ok>${_esc(opts.confirmLabel ?? "Confirmer")}</button>
      </div>
    `;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const okBtn = dialog.querySelector<HTMLButtonElement>("[data-mc-ok]")!;
    const cancelBtn = dialog.querySelector<HTMLButtonElement>("[data-mc-cancel]")!;

    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") decide(false); };
    const onBackdropClick = (e: MouseEvent) => { if (e.target === overlay) decide(false); };

    const cleanup = () => {
      overlay.removeEventListener("click", onBackdropClick);
      document.removeEventListener("keydown", onKey);
      overlay.remove();
    };
    const decide = (ok: boolean) => { cleanup(); resolve(ok); };

    okBtn.addEventListener("click", () => decide(true), { once: true });
    cancelBtn.addEventListener("click", () => decide(false), { once: true });
    overlay.addEventListener("click", onBackdropClick);
    document.addEventListener("keydown", onKey);

    // For destructive actions, focus Cancel by default — pressing Enter
    // reflexively must NOT trigger the destructive operation.
    if (danger) cancelBtn.focus();
    else okBtn.focus();
  });
}
