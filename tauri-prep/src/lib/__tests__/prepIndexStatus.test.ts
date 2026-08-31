import { describe, it, expect, beforeEach } from "vitest";
import {
  indexButtonState,
  isAutoReindexEnabled,
  setAutoReindexEnabled,
  AUTO_REINDEX_LS_KEY,
} from "../prepIndexStatus.ts";

describe("indexButtonState", () => {
  // Invariant — 0 périmé → bouton inactif, pas d'avertissement.
  it("0 doc périmé → disabled, non-stale, libellé « à jour »", () => {
    const s = indexButtonState(0);
    expect(s.disabled).toBe(true);
    expect(s.stale).toBe(false);
    expect(s.label).toContain("à jour");
  });

  it("compte négatif traité comme 0 (défensif)", () => {
    expect(indexButtonState(-3).disabled).toBe(true);
  });

  it("1 doc périmé → actif, stale, singulier", () => {
    const s = indexButtonState(1);
    expect(s.disabled).toBe(false);
    expect(s.stale).toBe(true);
    expect(s.label).toContain("(1 document)");
  });

  it("plusieurs docs périmés → actif, pluriel avec compte", () => {
    const s = indexButtonState(7);
    expect(s.disabled).toBe(false);
    expect(s.label).toContain("(7 documents)");
  });
});

// ─── Fake localStorage (environnement vitest = node) ──────────────────────────
function fakeStorage(): Storage {
  const store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { for (const k in store) delete store[k]; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  } as Storage;
}

describe("auto-reindex opt-in (localStorage)", () => {
  beforeEach(() => {
    (globalThis as { localStorage: Storage }).localStorage = fakeStorage();
  });

  it("désactivé par défaut", () => {
    expect(isAutoReindexEnabled()).toBe(false);
  });

  it("round-trip set → get", () => {
    setAutoReindexEnabled(true);
    expect(localStorage.getItem(AUTO_REINDEX_LS_KEY)).toBe("1");
    expect(isAutoReindexEnabled()).toBe(true);
    setAutoReindexEnabled(false);
    expect(isAutoReindexEnabled()).toBe(false);
  });
});

describe("indexButtonState — index illisible", () => {
  it("ne dit pas « à jour » quand l'index ne peut pas être lu", () => {
    // Le piège corrigé : `staleCount` vaut 0 sur une base cassée comme sur une base
    // à jour, parce que la requête de dérivation échoue en silence. Mesuré sur les
    // deux instantanés corrompus du corpus (FTS-01).
    const st = indexButtonState(0, false);
    expect(st.label).not.toContain("à jour");
    expect(st.label).toContain("illisible");
    expect(st.stale).toBe(true);
  });

  it("n'offre pas un clic qui échouerait", () => {
    // `POST /index` passe par DELETE/INSERT sur la table même qu'on ne peut plus
    // toucher : les six voies SQL mesurées le 25 août échouent toutes.
    expect(indexButtonState(0, false).disabled).toBe(true);
  });

  it("rassure sur ce qui n'est pas perdu", () => {
    // L'index se refabrique depuis `units.text_norm` : aucune donnée n'est en jeu,
    // et c'est la première chose que veut savoir quelqu'un qui voit une alarme.
    expect(indexButtonState(0, false).title).toContain("AUCUN texte n'est perdu");
  });

  it("l'emporte sur le compte de documents périmés", () => {
    // Un index illisible rend le compte de périmés dénué de sens : on ne va pas
    // proposer de réindexer 12 documents dans une table qu'on ne peut pas ouvrir.
    expect(indexButtonState(12, false).label).toContain("illisible");
  });

  it("se tait quand l'index est lisible — comportement inchangé", () => {
    expect(indexButtonState(0, true).label).toBe("✓ Index à jour");
    expect(indexButtonState(0).label).toBe("✓ Index à jour");
    expect(indexButtonState(3, true).label).toContain("3 documents");
  });
});

describe("indexButtonState — état inconnu", () => {
  it("ne rassure pas quand on n'a pas pu demander", () => {
    // `_renderDocList` tourne même après un chargement en échec : sans ce cas, l'écran
    // gardait « ✓ Index à jour » sous un bandeau rouge annonçant l'erreur.
    const st = indexButtonState(0, null);
    expect(st.label).not.toContain("à jour");
    expect(st.label).toContain("inconnu");
  });

  it("n'alarme pas non plus — ignorer n'est pas constater", () => {
    const st = indexButtonState(0, null);
    expect(st.stale).toBe(false);
    expect(st.disabled).toBe(true);
  });
});
