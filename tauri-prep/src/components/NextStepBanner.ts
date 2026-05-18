/**
 * NextStepBanner.ts — Bandeau « étape suivante » contextuel.
 *
 * Rendu du résultat de `computeNextSteps` (lib/prepNextStep.ts) : un bandeau
 * non-bloquant affiché en fin de sous-vue après une action de pipeline réussie
 * (curation appliquée, segmentation validée, alignement terminé). Adresse la
 * friction HANDOFF_PREP Tier A #3.
 *
 * Le calcul des suggestions est pur (prepNextStep.ts, testé Vitest) ; ce module
 * ne fait que le rendu DOM + le câblage des clics.
 */

import type { NextStepResult, PrepNavTarget } from "../lib/prepNextStep.ts";

/**
 * Construit l'élément DOM du bandeau. Réutilisable : remplace son propre
 * contenu à chaque appel via `update()`.
 */
export class NextStepBanner {
  private readonly _root: HTMLElement;
  private readonly _onAction: (target: PrepNavTarget) => void;

  constructor(onAction: (target: PrepNavTarget) => void) {
    this._onAction = onAction;
    this._root = document.createElement("div");
    this._root.className = "prep-nextstep-banner";
    this._root.setAttribute("role", "status");
    this._root.style.display = "none";
  }

  /** L'élément à insérer dans le DOM de la sous-vue. */
  get element(): HTMLElement {
    return this._root;
  }

  /** Affiche / met à jour le bandeau avec un nouveau résultat de suggestions. */
  show(result: NextStepResult): void {
    this._root.innerHTML = "";

    const headline = document.createElement("span");
    headline.className = "prep-nextstep-headline";
    headline.textContent = `➡️ ${result.headline}`;
    this._root.appendChild(headline);

    const actions = document.createElement("span");
    actions.className = "prep-nextstep-actions";
    for (const sug of result.suggestions) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = sug.primary
        ? "btn btn-sm prep-nextstep-btn-primary"
        : "btn btn-sm btn-secondary prep-nextstep-btn";
      btn.textContent = sug.buttonLabel;
      btn.addEventListener("click", () => this._onAction(sug.target));
      actions.appendChild(btn);
    }
    this._root.appendChild(actions);

    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "prep-nextstep-dismiss";
    dismiss.setAttribute("aria-label", "Masquer la suggestion d'étape suivante");
    dismiss.title = "Masquer";
    dismiss.textContent = "✕";
    dismiss.addEventListener("click", () => this.hide());
    this._root.appendChild(dismiss);

    this._root.style.display = "";
  }

  /** Masque le bandeau (sans le détruire). */
  hide(): void {
    this._root.style.display = "none";
  }
}
