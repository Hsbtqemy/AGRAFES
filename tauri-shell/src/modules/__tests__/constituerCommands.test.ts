/**
 * Garde du pont shell → prep (CHR-01).
 *
 * Le shell appelle `openCorpusInfo()` / `toggleJournal()` sans savoir si le module
 * est monté : l'utilisateur peut presser l'entrée « Fiche corpus » du menu de la
 * base depuis Explorer, ou pendant un changement de base qui démonte Constituer.
 * Le contrat est donc que ces commandes soient **sans effet** dans ce cas, et non
 * qu'elles lèvent — une exception non rattrapée dans un gestionnaire de clic du
 * header remonte jusqu'au webview, où prep et Explorer partagent le même contexte.
 *
 * `mount()` n'est pas exercé ici : il construit toute l'app prep et demande un
 * sidecar. Ce qui se teste sans lui, c'est l'état « pas monté » — précisément
 * celui que le shell ne vérifie pas.
 */
import { describe, expect, it, vi } from "vitest";

// `constituerModule` importe l'app prep au niveau source, laquelle tire toute la
// chaîne d'écrans et son CSS. On la neutralise : le pont ne dépend que de la
// présence d'une instance, pas de ce qu'elle sait faire.
vi.mock("../../../tauri-prep/src/app.ts", () => ({
  App: class {
    init(): Promise<void> { return Promise.resolve(); }
    dispose(): void { /* rien */ }
    openCorpusInfo(): void { /* rien */ }
    toggleJournal(): boolean { return false; }
  },
}));
vi.mock("../../../tauri-prep/src/lib/db.ts", () => ({
  setCurrentDbPath: () => { /* rien */ },
}));

describe("pont shell → Constituer, module non monté", () => {
  it("isMounted() est faux avant tout montage", async () => {
    const mod = await import("../constituerModule.ts");
    expect(mod.isMounted()).toBe(false);
  });

  it("openCorpusInfo() ne lève pas — le shell appelle sans vérifier", async () => {
    const mod = await import("../constituerModule.ts");
    expect(() => mod.openCorpusInfo()).not.toThrow();
  });

  it("toggleJournal() ne lève pas et rend « fermé »", async () => {
    const mod = await import("../constituerModule.ts");
    let ouvert: boolean | undefined;
    expect(() => { ouvert = mod.toggleJournal(); }).not.toThrow();
    // Faux plutôt qu'indéfini : le shell s'en sert pour peindre l'icône active,
    // et `undefined` la laisserait allumée sur un tiroir qui n'existe pas.
    expect(ouvert).toBe(false);
  });

  it("dispose() sur un module jamais monté ne lève pas non plus", async () => {
    const mod = await import("../constituerModule.ts");
    expect(() => mod.dispose()).not.toThrow();
    expect(mod.isMounted()).toBe(false);
  });
});
