/**
 * ui/confirmModal.ts — promise-based confirm dialog.
 *
 * Replaces `window.confirm`, which is unreliable on Tauri 2 (audit FE-05 / the
 * "no native dialogs" convention). Reuses the existing `.modal-overlay` /
 * `.modal` / `.modal-body` styling; the button row is laid out inline so it does
 * not depend on a dedicated CSS class. Resolves `true` on confirm, `false` on
 * cancel / Escape / backdrop click.
 */

import { elt } from "./dom";

export function confirmModal(
  message: string,
  opts: { confirmLabel?: string; cancelLabel?: string } = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = elt("div", { class: "modal-overlay", id: "app-confirm-overlay" });
    const modal = elt("div", { class: "modal" });

    const body = elt("div", { class: "modal-body" });
    // Render the message preserving line breaks, without innerHTML.
    message.split("\n").forEach((line, i) => {
      if (i > 0) body.appendChild(elt("br"));
      if (line) body.appendChild(document.createTextNode(line));
    });

    const actions = elt("div", {
      style: "display:flex;justify-content:flex-end;gap:8px;margin-top:16px;",
    });
    const cancelBtn = elt(
      "button",
      { class: "btn btn-ghost", type: "button" },
      opts.cancelLabel ?? "Annuler",
    );
    const okBtn = elt(
      "button",
      { class: "btn btn-primary", type: "button" },
      opts.confirmLabel ?? "Confirmer",
    );

    let settled = false;
    const close = (result: boolean): void => {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKey);
      overlay.remove();
      resolve(result);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") close(false);
      else if (e.key === "Enter") close(true);
    };

    cancelBtn.addEventListener("click", () => close(false));
    okBtn.addEventListener("click", () => close(true));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close(false);
    });
    document.addEventListener("keydown", onKey);

    actions.appendChild(cancelBtn);
    actions.appendChild(okBtn);
    modal.appendChild(body);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    okBtn.focus();
  });
}
