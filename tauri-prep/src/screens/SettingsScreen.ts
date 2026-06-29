/**
 * SettingsScreen.ts — "Paramètres" tab (Phase 3, UI-B). Global settings home; for now
 * it hosts the spaCy model manager (download/remove models, shared across all corpora).
 */

import "../ui/settings.css";
import type { Conn } from "../lib/sidecarClient.ts";
import { ModelManager } from "../components/ModelManager.ts";

export class SettingsScreen {
  private readonly _models = new ModelManager();
  private _root: HTMLElement | null = null;

  render(): HTMLElement {
    const root = document.createElement("div");
    root.className = "prep-settings";
    this._root = root;

    const title = document.createElement("h2");
    title.className = "prep-settings-title";
    title.textContent = "Paramètres";
    root.appendChild(title);

    const section = document.createElement("section");
    section.className = "prep-settings-section";
    const sectionTitle = document.createElement("h3");
    sectionTitle.className = "prep-settings-section-title";
    sectionTitle.textContent = "Modèles spaCy (annotation)";
    const desc = document.createElement("p");
    desc.className = "prep-settings-section-desc";
    desc.textContent =
      "Téléchargez à la demande les modèles nécessaires à l'annotation. " +
      "Ils sont partagés entre tous vos corpus.";
    section.appendChild(sectionTitle);
    section.appendChild(desc);
    section.appendChild(this._models.render());
    root.appendChild(section);

    return root;
  }

  setConn(conn: Conn | null): void {
    this._models.setConn(conn);
  }

  dispose(): void {
    this._models.dispose();
    this._root = null;
  }
}
