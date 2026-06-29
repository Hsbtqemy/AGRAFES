// @vitest-environment happy-dom
/**
 * Render-smoke for SettingsScreen (spaCy model manager host, Phase 3).
 *
 * Mounts the real screen against a headless DOM with NO sidecar connection
 * (ModelManager shows "Connexion en cours…" until setConn). Asserts the screen
 * renders its key structure and — critically — that the root carries the
 * `screen` class.
 *
 * Regression guard: app.css reveals the active tab via `.screen.active { display:block }`
 * (the generic `.prep-screen` only sets display:none). A root missing `screen`
 * stays hidden when its tab is active — exactly the "Paramètres vide" bug that
 * shipped in 0.3.0–0.3.2 before this class was added.
 */
import { describe, it, expect } from "vitest";
import { SettingsScreen } from "../SettingsScreen.ts";

describe("SettingsScreen render-smoke", () => {
  it("root carries the `screen` class so `.screen.active` can reveal it", () => {
    const screen = new SettingsScreen();
    const el = screen.render();
    expect(el).toBeInstanceOf(HTMLElement);
    expect(el.classList.contains("screen")).toBe(true);
    expect(el.classList.contains("prep-settings")).toBe(true);
    screen.dispose();
  });

  it("renders the title and the model-manager mount without a connection", () => {
    const screen = new SettingsScreen();
    const el = screen.render();
    expect(el.querySelector(".prep-settings-title")?.textContent).toBe("Paramètres");
    expect(el.querySelector(".prep-settings-section")).not.toBeNull();
    expect(el.querySelector(".prep-models")).not.toBeNull();
    screen.dispose();
  });
});
