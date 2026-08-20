// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AlignUndoBanner } from "../AlignUndoBanner.ts";
import type { UndoableGesture } from "../../lib/alignUndoGesture.ts";

const geste = (o: Partial<UndoableGesture> = {}): UndoableGesture => ({
  opId: 7, label: "⭙ Absorber la phrase voisine", familyId: 3, ...o,
});

describe("AlignUndoBanner", () => {
  let onUndo: ReturnType<typeof vi.fn<(gesture: UndoableGesture) => void>>;
  let banner: AlignUndoBanner;

  beforeEach(() => {
    onUndo = vi.fn<(gesture: UndoableGesture) => void>();
    banner = new AlignUndoBanner(onUndo);
  });

  it("reste invisible tant qu'aucun geste n'est offert", () => {
    expect(banner.element.style.display).toBe("none");
    expect(banner.gesture).toBeNull();
  });

  it("affiche le libellé du geste, pas un libellé recalculé", () => {
    // Le bandeau et le toast doivent nommer la même action ; un nom reconstruit côté
    // client dériverait de celui que l'écran vient d'annoncer.
    banner.arm(geste());
    expect(banner.element.textContent).toContain("⭙ Absorber la phrase voisine");
    expect(banner.element.style.display).not.toBe("none");
  });

  it("rend le geste au clic", () => {
    const g = geste();
    banner.arm(g);
    banner.element.querySelector<HTMLButtonElement>(".prep-align-undo-btn")!.click();
    expect(onUndo).toHaveBeenCalledWith(g);
  });

  it("n'envoie qu'une annulation sur un double-clic", () => {
    // Sans verrou, la seconde échouerait en 404 sur une opération déjà consommée et
    // afficherait un refus qui n'en est pas un.
    banner.arm(geste());
    const btn = banner.element.querySelector<HTMLButtonElement>(".prep-align-undo-btn")!;
    btn.click();
    btn.click();
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(btn.disabled).toBe(true);
  });

  it("rend la main après un refus récupérable", () => {
    banner.arm(geste());
    const btn = banner.element.querySelector<HTMLButtonElement>(".prep-align-undo-btn")!;
    btn.click();
    banner.release();
    btn.click();
    expect(onUndo).toHaveBeenCalledTimes(2);
  });

  it("se retire entièrement au désarmement", () => {
    banner.arm(geste());
    banner.disarm();
    expect(banner.element.style.display).toBe("none");
    expect(banner.element.textContent).toBe("");
    expect(banner.gesture).toBeNull();
  });

  it("ne laisse pas un geste désarmé se déclencher", () => {
    // Le bouton peut avoir été cliqué juste avant que la famille change ; le handler
    // ne doit pas agir sur des liens que la nouvelle grille ne montre pas.
    banner.arm(geste());
    const btn = banner.element.querySelector<HTMLButtonElement>(".prep-align-undo-btn")!;
    banner.disarm();
    btn.click();
    expect(onUndo).not.toHaveBeenCalled();
  });

  it("remplace le geste précédent plutôt que d'empiler", () => {
    banner.arm(geste({ opId: 1, label: "✂ Couper à cheval" }));
    banner.arm(geste({ opId: 2, label: "↺ Rendre la phrase entière" }));
    expect(banner.gesture?.opId).toBe(2);
    expect(banner.element.textContent).not.toContain("Couper");
    expect(banner.element.querySelectorAll(".prep-align-undo-btn")).toHaveLength(1);
  });

  it("s'annonce sans interrompre la lecture en cours", () => {
    // `status` et non `alert` : c'est une offre, pas une alerte.
    expect(banner.element.getAttribute("role")).toBe("status");
    expect(banner.element.getAttribute("aria-live")).toBe("polite");
  });
});
