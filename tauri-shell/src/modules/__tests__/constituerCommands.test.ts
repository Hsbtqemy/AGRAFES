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
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
    // Faux plutôt qu'indéfini : un module démonté n'a rien ouvert, et la commande doit
    // le dire. Le shell ne peint plus son icône depuis ce retour — il écoute
    // `agrafes:prep-journal`, cf. la garde plus bas — mais le contrat reste le même.
    expect(ouvert).toBe(false);
  });

  it("dispose() sur un module jamais monté ne lève pas non plus", async () => {
    const mod = await import("../constituerModule.ts");
    expect(() => mod.dispose()).not.toThrow();
    expect(mod.isMounted()).toBe(false);
  });
});

/**
 * L'autre bout du pont — et une garde sur un fichier, faute de mieux : `shell.ts` n'est
 * importé par AUCUNE des suites du shell, si bien qu'une erreur dedans passe le vitest au
 * vert. Ce qui est en jeu ici ne se rend pas davantage : c'est un abonnement.
 *
 * Le tiroir du Journal se ferme aussi par sa propre ✕, à l'intérieur de prep. Le shell ne
 * voit ce chemin que par l'événement `agrafes:prep-journal` ; peindre l'icône depuis le
 * retour de `toggleJournal()` la laissait allumée sur un tiroir fermé (QA du 2 septembre
 * 2026). Un seul peintre, donc, et c'est l'écouteur.
 */
describe("l'icône du Journal suit l'événement, pas le retour de la commande", () => {
  // Chemin depuis la racine du paquet, et non `import.meta.url` : les suites du shell
  // tournent sous `happy-dom` (celles de prep sous `node`), où cette URL ne résout pas
  // vers le disque — le même code y cherchait `C:\src\shell.ts`. `process.cwd()` est le
  // dossier du paquet, puisque vitest s'y lance (`npm --prefix tauri-shell test`).
  const CHEMIN = resolve(process.cwd(), "src/shell.ts");
  const SHELL_TS = readFileSync(CHEMIN, "utf-8");

  it("le shell s'abonne à `agrafes:prep-journal`", () => {
    expect(SHELL_TS).toMatch(/addEventListener\("agrafes:prep-journal"/);
  });

  it("`_toggleConstituerJournal` ne peint plus rien lui-même", () => {
    const at = SHELL_TS.indexOf("async function _toggleConstituerJournal(");
    expect(at, "fonction _toggleConstituerJournal introuvable dans shell.ts").toBeGreaterThan(-1);
    const corps = SHELL_TS.slice(at, SHELL_TS.indexOf("\n}", at));
    // Deux peintres pour un même état, c'est le retour du défaut : celui qui ne voit
    // qu'un des deux gestes écrase celui qui les voit tous les deux.
    expect(corps, "l'état visuel de l'icône appartient à l'écouteur seul")
      .not.toMatch(/classList|aria-expanded/);
  });

  it("`_updateHeaderTabs` dépeint à CHAQUE navigation, pas seulement en quittant", () => {
    const at = SHELL_TS.indexOf("function _updateHeaderTabs(");
    expect(at, "fonction _updateHeaderTabs introuvable dans shell.ts").toBeGreaterThan(-1);
    const corps = SHELL_TS.slice(at, SHELL_TS.indexOf("\n}", at));

    expect(corps).toMatch(/journalBtn\.classList\.remove\("active"\)/);
    // La condition d'origine — `if (mode !== "constituer")` — laissait passer le remontage
    // à mode ÉGAL, celui de « Rafraîchir maintenant » après un changement de base : le
    // tiroir y est détruit comme ailleurs, et l'icône restait allumée. `_setMode` est le
    // seul appelant, et démonte le module juste après : le dépeint n'a aucune raison
    // d'être conditionnel.
    expect(corps, "le dépeint ne doit dépendre d'aucune condition de mode")
      .not.toMatch(/if \(mode !== "constituer"\) \{/);
  });
});
