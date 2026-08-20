/**
 * AlignUndoBanner.ts — Le bandeau « Annuler » de l'espace Alignement (ALI-20).
 *
 * Rendu seul : la décision d'armer, le libellé et les messages de refus sont dans
 * `lib/alignUndoGesture.ts` (pur, testé). Ce module ne fait que le DOM et le clic.
 *
 * Le bandeau est **éphémère et lié à un geste** : il montre le dernier geste
 * défaisable, et disparaît dès qu'il est défait, refusé, ou que la famille change. Il
 * ne prétend pas être un journal — celui-ci se consulte, se filtre, se date, et se
 * conçoit autrement.
 */

import type { UndoableGesture } from "../lib/alignUndoGesture.ts";

export class AlignUndoBanner {
  private readonly _root: HTMLElement;
  private readonly _onUndo: (gesture: UndoableGesture) => void;
  private _gesture: UndoableGesture | null = null;
  private _busy = false;

  constructor(onUndo: (gesture: UndoableGesture) => void) {
    this._onUndo = onUndo;
    this._root = document.createElement("div");
    this._root.className = "prep-align-undo";
    // `status` et non `alert` : c'est une offre, pas une alerte — un lecteur d'écran
    // ne doit pas interrompre la lecture en cours pour l'annoncer.
    this._root.setAttribute("role", "status");
    this._root.setAttribute("aria-live", "polite");
    this._root.style.display = "none";
  }

  get element(): HTMLElement {
    return this._root;
  }

  /** Le geste actuellement offert à l'annulation, s'il y en a un. */
  get gesture(): UndoableGesture | null {
    return this._gesture;
  }

  /** Arme le bandeau sur un geste. `null` le retire. */
  arm(gesture: UndoableGesture | null): void {
    this._gesture = gesture;
    this._busy = false;
    if (!gesture) {
      this._root.style.display = "none";
      this._root.replaceChildren();
      return;
    }
    this._root.replaceChildren();

    const texte = document.createElement("span");
    texte.className = "prep-align-undo-label";
    texte.textContent = gesture.label;
    this._root.appendChild(texte);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-sm btn-secondary prep-align-undo-btn";
    btn.textContent = "↶ Annuler";
    btn.title = "Défaire ce geste — les liens retrouvent l'état qu'ils avaient avant";
    btn.addEventListener("click", () => {
      // Le geste part en aller-retour : sans ce verrou, un double-clic enverrait deux
      // annulations, dont la seconde échouerait en 404 sur une opération consommée et
      // afficherait un refus qui n'en est pas un.
      if (this._busy || !this._gesture) return;
      this._busy = true;
      btn.disabled = true;
      this._onUndo(this._gesture);
    });
    this._root.appendChild(btn);

    this._root.style.display = "";
  }

  /** Retire le bandeau. À appeler sur tout changement d'entité (famille, connexion). */
  disarm(): void {
    this.arm(null);
  }

  /** Rend la main après un refus : le geste reste offert, le bouton redevient cliquable. */
  release(): void {
    this._busy = false;
    this._root.querySelector<HTMLButtonElement>(".prep-align-undo-btn")
      ?.removeAttribute("disabled");
  }
}
