/**
 * navHistory.test.ts — la pile de navigation (NAV-01, lot 1).
 *
 * L'environnement de test est `node` : ni `window` ni `history` n'existent. On en pose de
 * faux, ce qui a l'avantage de rendre l'historique INSPECTABLE — un vrai `history` ne dit
 * pas combien d'entrées il porte, et c'est précisément ce qu'on veut vérifier (une
 * navigation, une entrée ; un aller-retour, zéro entrée de plus).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  install, uninstall, registerLevel, unregisterLevel, setPendingGuard,
  capture, sync, _resetForTests,
} from "../navHistory.ts";

type Listener = (e: unknown) => void;

const listeners = new Map<string, Set<Listener>>();

const fakeWindow = {
  addEventListener: (type: string, fn: Listener) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type)!.add(fn);
  },
  removeEventListener: (type: string, fn: Listener) => {
    listeners.get(type)?.delete(fn);
  },
};

const emit = (type: string, e: unknown): void => {
  for (const fn of [...(listeners.get(type) ?? [])]) fn(e);
};

/** Historique jouet : une pile d'états et un curseur, comme le vrai. */
class FakeHistory {
  entries: unknown[] = [null];
  idx = 0;
  get state(): unknown { return this.entries[this.idx]; }
  pushState(s: unknown): void {
    this.entries = this.entries.slice(0, this.idx + 1);
    this.entries.push(s);
    this.idx += 1;
  }
  replaceState(s: unknown): void { this.entries[this.idx] = s; }
  back(): void { if (this.idx > 0) { this.idx -= 1; emit("popstate", { state: this.state }); } }
  forward(): void {
    if (this.idx < this.entries.length - 1) { this.idx += 1; emit("popstate", { state: this.state }); }
  }
}

let hist: FakeHistory;

/**
 * L'application d'une destination est asynchrone — `apply` est attendu, parce que changer
 * de mode remonte un module entier. Tant qu'elle court, `sync` est muet exprès. Un test qui
 * mesure l'état APRÈS un retour doit donc laisser la boucle tourner.
 */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Un niveau jouet : une valeur, et la trace de ce qu'on lui a appliqué. */
function level(initial: string, order: number, opts: { refuse?: boolean } = {}) {
  const state = { value: initial, applied: [] as string[] };
  return {
    state,
    level: {
      order,
      read: () => state.value,
      apply: (v: string) => {
        state.applied.push(v);
        if (!opts.refuse) state.value = v;
      },
    },
  };
}

beforeEach(() => {
  listeners.clear();
  hist = new FakeHistory();
  Object.defineProperty(globalThis, "window", { value: fakeWindow, configurable: true });
  Object.defineProperty(globalThis, "history", { value: hist, configurable: true });
  _resetForTests();
});

afterEach(() => {
  _resetForTests();
  listeners.clear();
});

describe("capture", () => {
  it("assemble la destination à partir des niveaux montés", () => {
    registerLevel("mode", level("constituer", 10).level);
    registerLevel("tab", level("actions", 20).level);
    expect(capture()).toEqual({ mode: "constituer", tab: "actions" });
  });

  it("ignore un niveau qui n'est pas monté", () => {
    registerLevel("mode", level("constituer", 10).level);
    registerLevel("layer", { order: 40, read: () => null, apply: () => {} });
    expect(capture()).toEqual({ mode: "constituer" });
  });

  it("ignore un niveau dont la lecture jette", () => {
    registerLevel("mode", level("constituer", 10).level);
    registerLevel("boom", {
      order: 20,
      read: () => { throw new Error("DOM mort"); },
      apply: () => {},
    });
    expect(capture()).toEqual({ mode: "constituer" });
  });
});

describe("sync", () => {
  it("ne pousse rien tant que la pile n'est pas démarrée", () => {
    const m = level("home", 10);
    registerLevel("mode", m.level);
    m.state.value = "explorer";
    sync();
    expect(hist.entries.length).toBe(1);
  });

  it("pousse une entrée quand la destination change", () => {
    const m = level("home", 10);
    registerLevel("mode", m.level);
    install();
    expect(hist.entries.length).toBe(1);   // l'entrée initiale est REMPLACÉE, pas ajoutée

    m.state.value = "explorer";
    sync();
    expect(hist.entries.length).toBe(2);
    expect(hist.state).toEqual({ agrafesNav: { mode: "explorer" } });
  });

  it("ne pousse pas deux fois la même destination", () => {
    const m = level("home", 10);
    registerLevel("mode", m.level);
    install();
    m.state.value = "explorer";
    sync();
    sync();
    sync();
    expect(hist.entries.length).toBe(2);
  });
});

describe("retour en arrière", () => {
  it("restaure la destination précédente", async () => {
    const m = level("home", 10);
    registerLevel("mode", m.level);
    install();
    m.state.value = "explorer"; sync();
    m.state.value = "constituer"; sync();

    hist.back();
    await flush();
    expect(m.state.value).toBe("explorer");
    hist.back();
    await flush();
    expect(m.state.value).toBe("home");
  });

  it("applique du plus englobant au plus fin", async () => {
    const ordre: string[] = [];
    registerLevel("tab", {
      order: 20, read: () => "actions", apply: () => { ordre.push("tab"); },
    });
    registerLevel("mode", {
      order: 10, read: () => "home", apply: () => { ordre.push("mode"); },
    });
    install();

    // Une destination complète, poussée à la main : les deux niveaux devront bouger.
    hist.pushState({ agrafesNav: { mode: "constituer", tab: "exporter" } });
    hist.back();
    hist.forward();
    await flush();

    expect(ordre).toEqual(["mode", "tab"]);
  });

  it("ne repousse pas d'entrée en restaurant — sinon le geste ne remonterait jamais", async () => {
    const m = level("home", 10);
    // Le niveau appelle `sync` comme le font les vrais points d'accroche.
    registerLevel("mode", {
      order: 10,
      read: () => m.state.value,
      apply: (v) => { m.state.value = v; sync(); },
    });
    install();
    m.state.value = "explorer"; sync();
    m.state.value = "constituer"; sync();
    const avant = hist.entries.length;

    hist.back();
    await flush();
    expect(hist.entries.length).toBe(avant);
    expect(m.state.value).toBe("explorer");
  });

  it("ne rejoue pas un niveau déjà en place", async () => {
    const m = level("home", 10);
    const t = level("actions", 20);
    registerLevel("mode", m.level);
    registerLevel("tab", t.level);
    install();
    t.state.value = "exporter"; sync();

    hist.back();   // seul `tab` doit bouger, `mode` est déjà bon
    await flush();
    expect(t.state.applied).toEqual(["actions"]);
    expect(m.state.applied).toEqual([]);
  });

  it("n'applique pas un niveau absent de l'entrée visée", async () => {
    // Cas réel : le shell démarre sur « home », Prep n'est pas monté, donc l'entrée
    // initiale ne porte pas d'onglet. Revenir dessus ne doit pas inventer d'onglet.
    const m = level("home", 10);
    registerLevel("mode", m.level);
    install();
    m.state.value = "constituer"; sync();
    const t = level("actions", 20);
    registerLevel("tab", t.level);

    hist.back();
    await flush();
    expect(m.state.value).toBe("home");
    expect(t.state.applied).toEqual([]);
  });

  it("garde la pile honnête quand un niveau refuse de bouger", async () => {
    const m = level("home", 10, { refuse: true });
    registerLevel("mode", m.level);
    install();
    // On pousse une destination que le niveau n'atteindra pas.
    hist.pushState({ agrafesNav: { mode: "explorer" } });
    hist.back();
    hist.forward();

    await flush();
    expect(m.state.applied).toEqual(["explorer"]);
    expect(m.state.value).toBe("home");
    // La destination courante doit refléter le RÉEL : un nouveau `sync` sur un état
    // différent doit donc encore pouvoir pousser.
    m.state.value = "constituer";
    const avant = hist.entries.length;
    sync();
    expect(hist.entries.length).toBe(avant + 1);
  });

  it("ignore une entrée d'historique étrangère à la pile", async () => {
    const m = level("home", 10);
    registerLevel("mode", m.level);
    install();
    m.state.value = "explorer"; sync();

    emit("popstate", { state: { autreChose: 1 } });
    await flush();
    expect(m.state.value).toBe("explorer");
  });
});

describe("garde de sortie", () => {
  const press = (button: number) => {
    const e = { button, preventDefault: vi.fn() };
    emit("pointerdown", e);
    return e;
  };

  it("laisse passer le geste quand rien n'est en attente", () => {
    registerLevel("mode", level("home", 10).level);
    install();
    setPendingGuard(() => null);
    expect(press(3).preventDefault).not.toHaveBeenCalled();
  });

  it("laisse passer les autres boutons, y compris avec des modifications en attente", () => {
    registerLevel("mode", level("home", 10).level);
    install();
    setPendingGuard(() => ({ confirm: () => Promise.resolve(true) }));
    expect(press(0).preventDefault).not.toHaveBeenCalled();
    expect(press(1).preventDefault).not.toHaveBeenCalled();
    expect(press(2).preventDefault).not.toHaveBeenCalled();
  });

  it("annule le geste et pose la question quand il y a des modifications en attente", async () => {
    const m = level("home", 10);
    registerLevel("mode", m.level);
    install();
    m.state.value = "explorer"; sync();

    const confirm = vi.fn(() => Promise.resolve(false));
    setPendingGuard(() => ({ confirm }));

    expect(press(3).preventDefault).toHaveBeenCalled();
    await Promise.resolve();
    expect(confirm).toHaveBeenCalled();
    expect(m.state.value).toBe("explorer");   // refus : on n'a pas bougé
  });

  it("navigue après un accord", async () => {
    const m = level("home", 10);
    registerLevel("mode", m.level);
    install();
    m.state.value = "explorer"; sync();

    setPendingGuard(() => ({ confirm: () => Promise.resolve(true) }));
    press(3);
    await flush();
    expect(m.state.value).toBe("home");
  });
});

describe("cycle de vie", () => {
  it("un niveau désenregistré ne répond plus", async () => {
    const m = level("home", 10);
    registerLevel("mode", m.level);
    install();
    m.state.value = "explorer"; sync();

    unregisterLevel("mode");
    hist.back();
    await flush();
    expect(m.state.applied).toEqual([]);
  });

  it("uninstall retire les écouteurs", () => {
    registerLevel("mode", level("home", 10).level);
    install();
    uninstall();
    expect(listeners.get("popstate")?.size ?? 0).toBe(0);
    expect(listeners.get("pointerdown")?.size ?? 0).toBe(0);
  });

  it("install deux fois n'installe qu'une fois", () => {
    registerLevel("mode", level("home", 10).level);
    install();
    install();
    expect(listeners.get("popstate")!.size).toBe(1);
  });
});
