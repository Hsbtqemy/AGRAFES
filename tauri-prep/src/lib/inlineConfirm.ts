/**
 * inlineConfirm.ts — bannière de confirmation inline sans window.confirm.
 *
 * Injecte temporairement un message + boutons Confirmer/Annuler dans un conteneur
 * DOM fourni, puis restore le contenu original à la résolution.
 * Focus automatique sur le bouton Confirmer.
 */

import { safeHtml, raw, setHtml } from "./safeHtml.ts";

/**
 * Affiche un banner de confirmation inline dans `container`.
 * Restore le contenu original du container à la résolution (confirm ou cancel).
 *
 * @param container  Élément DOM qui accueillera le banner.
 * @param message    Message à afficher (plain text, sera échappé).
 * @param opts.confirmLabel  Libellé bouton Confirmer (défaut : "Confirmer").
 * @param opts.cancelLabel   Libellé bouton Annuler  (défaut : "Annuler").
 * @param opts.danger        Si true, bouton Confirmer en `btn-danger` (défaut : true).
 * @returns Promise<boolean> true si confirmé, false si annulé.
 */
export function inlineConfirm(
  container: HTMLElement,
  message: string,
  opts?: { confirmLabel?: string; cancelLabel?: string; danger?: boolean }
): Promise<boolean> {
  const confirmLabel = opts?.confirmLabel ?? "Confirmer";
  const cancelLabel  = opts?.cancelLabel  ?? "Annuler";
  const danger       = opts?.danger       !== false;

  return new Promise(resolve => {
    const original    = container.innerHTML;
    const savedDisplay = container.style.display;

    const restore = (answer: boolean) => {
      setHtml(container, raw(original));  // restore previously-captured DOM
      container.style.display = savedDisplay;
      resolve(answer);
    };

    container.style.display = "";
    setHtml(container, safeHtml`
      <span class="inline-confirm-msg">${message}</span>
      <button class="btn btn-sm ${danger ? "btn-danger" : "btn-primary"}" data-inline-ok>
        ${confirmLabel}
      </button>
      <button class="btn btn-sm btn-ghost" data-inline-cancel>
        ${cancelLabel}
      </button>
    `);

    const okBtn     = container.querySelector<HTMLButtonElement>("[data-inline-ok]")!;
    const cancelBtn = container.querySelector<HTMLButtonElement>("[data-inline-cancel]")!;

    okBtn.addEventListener("click",     () => restore(true),  { once: true });
    cancelBtn.addEventListener("click", () => restore(false), { once: true });

    // Dismiss on Escape
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { document.removeEventListener("keydown", onKey); restore(false); }
    };
    document.addEventListener("keydown", onKey);
    // Remove key listener when resolved via button
    okBtn.addEventListener("click",     () => document.removeEventListener("keydown", onKey), { once: true });
    cancelBtn.addEventListener("click", () => document.removeEventListener("keydown", onKey), { once: true });

    okBtn.focus();
  });
}
