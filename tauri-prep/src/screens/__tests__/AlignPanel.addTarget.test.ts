// @vitest-environment happy-dom
/**
 * RA-D7 — « ajouter une 2ᵉ cible » (add-target) groupe la cellule en bead.
 *
 * Avant le fix, add-target créait un 2ᵉ lien manuel SANS bead_uid commun → la cellule
 * (1 pivot → 2 cibles) était re-signalée en collision fantôme (l'outil laissait bâtir un
 * N-M puis le dénonçait comme une erreur). Le fix émet `set_bead` sur les liens de la
 * cellule pour déclarer le 1-M. On pilote `_doPickerSelect` en mode "add" via un faux Conn
 * (comme les tests scope/reviewFamily) et on vérifie l'appel batch set_bead — RED sur
 * l'ancien code, où aucun `/align/links/batch_update` n'était émis.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AlignPanel } from "../AlignPanel.ts";
import type { AlignLinkRecord, Conn, DocumentRecord } from "../../lib/sidecarClient.ts";

function link(link_id: number, over: Partial<AlignLinkRecord> = {}): AlignLinkRecord {
  return {
    link_id, external_id: 1, pivot_unit_id: 101, target_unit_id: 900,
    pivot_text: "FR un", target_text: "EN one", target_text_raw: "EN one",
    status: null, bead_id: null, ...over,
  };
}

const DOCS = [
  { doc_id: 2, title: "Le Livre", language: "fr" },
  { doc_id: 3, title: "The Book", language: "en" },
] as unknown as DocumentRecord[];

function makeConn(
  calls: Array<{ path: string; body: unknown }>, links: AlignLinkRecord[],
): Conn {
  return {
    baseUrl: "http://test", token: null,
    get: async (path: string) => {
      calls.push({ path, body: null });
      if (path === "/families") return { families: [] };
      if (path === "/align/source_changed_summary") return { total: 0, docs: [] };
      throw new Error(`unexpected GET ${path}`);
    },
    post: async (path: string, body: unknown) => {
      calls.push({ path, body });
      if (path === "/align/audit") {
        return {
          ok: true, pivot_doc_id: 2, target_doc_id: 3, limit: 50, offset: 0,
          has_more: false, next_offset: null, stats: { links_returned: links.length }, links,
        };
      }
      if (path === "/align/link/create") return { ok: true, link_id: 99, status: null };
      if (path === "/align/links/batch_update") {
        return { ok: true, applied: 2, deleted: 0, errors: [] };
      }
      throw new Error(`unexpected POST ${path}`);
    },
    put: async () => ({}),
  } as Conn;
}

beforeEach(() => { Element.prototype.scrollIntoView = () => {}; });
afterEach(() => { document.body.innerHTML = ""; });

describe("AlignPanel add-target beads the cell (RA-D7)", () => {
  it("émet set_bead sur les deux liens de la cellule après un « ajouter une 2ᵉ cible »", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const holder = { conn: makeConn(calls, [link(42)]) as Conn | null };
    const panel = new AlignPanel(() => holder.conn, () => DOCS, {
      log: () => {}, toast: () => {}, setBusy: () => {}, jobCenter: () => null,
      onRunDone: () => {}, onNav: () => {},
    });
    const el = panel.render();
    document.body.appendChild(el);

    // Initialise l'état rendu (selects + audit de la paire) via le flux public.
    await panel.scopeTo({ pivotDocId: 2, targetDocId: 3, linkId: 42 });

    // Arme le mode "add" sur le pivot 101 (la ➕ y est ancrée) + un candidat cible.
    const p = panel as unknown as {
      _retargetActive: unknown; _retargetCandidates: unknown;
      _doPickerSelect: (el: HTMLElement, targetUnitId: number) => Promise<void>;
    };
    p._retargetActive = { pivotUnitId: 101, linkId: 42, mode: "add" };
    p._retargetCandidates = [
      { target_unit_id: 901, target_text: "EN two", score: 0.9, reason: "position", external_id: 2 },
    ];

    const before = calls.length;
    await p._doPickerSelect(el, 901);

    // Le 2ᵉ lien est créé…
    expect(calls.some(c => c.path === "/align/link/create")).toBe(true);
    // …PUIS la cellule est groupée : set_bead sur les DEUX liens (42 existant + 99 neuf).
    const bead = calls.slice(before).find(c => c.path === "/align/links/batch_update");
    expect(bead, "un batch set_bead doit suivre l'add (RED sur l'ancien code)").toBeTruthy();
    const actions = (bead!.body as { actions: Array<{ action: string; link_id: number }> }).actions;
    expect(actions.every(a => a.action === "set_bead")).toBe(true);
    expect(new Set(actions.map(a => a.link_id))).toEqual(new Set([42, 99]));
  });

  it("un « create » sur pivot orphelin (1 seul lien) ne déclenche PAS de bead", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const holder = { conn: makeConn(calls, [link(42)]) as Conn | null };
    const panel = new AlignPanel(() => holder.conn, () => DOCS, {
      log: () => {}, toast: () => {}, setBusy: () => {}, jobCenter: () => null,
      onRunDone: () => {}, onNav: () => {},
    });
    const el = panel.render();
    document.body.appendChild(el);
    await panel.scopeTo({ pivotDocId: 2, targetDocId: 3, linkId: 42 });

    const p = panel as unknown as {
      _retargetActive: unknown; _retargetCandidates: unknown;
      _doPickerSelect: (el: HTMLElement, targetUnitId: number) => Promise<void>;
    };
    // mode "create" sur un pivot NEUF (222) sans lien existant → un seul lien → pas de bead.
    p._retargetActive = { pivotUnitId: 222, linkId: null, mode: "create" };
    p._retargetCandidates = [
      { target_unit_id: 901, target_text: "EN two", score: 0.9, reason: "position", external_id: 2 },
    ];

    const before = calls.length;
    await p._doPickerSelect(el, 901);

    expect(calls.some(c => c.path === "/align/link/create")).toBe(true);
    expect(calls.slice(before).some(c => c.path === "/align/links/batch_update")).toBe(false);
  });

  it("échec du set_bead : le toast ne prétend PAS avoir groupé (revue adverse)", async () => {
    const toasts: Array<{ msg: string; err?: boolean }> = [];
    const conn = {
      baseUrl: "http://test", token: null,
      get: async (path: string) => {
        if (path === "/families") return { families: [] };
        if (path === "/align/source_changed_summary") return { total: 0, docs: [] };
        throw new Error(`unexpected GET ${path}`);
      },
      post: async (path: string) => {
        if (path === "/align/audit") {
          return {
            ok: true, pivot_doc_id: 2, target_doc_id: 3, limit: 50, offset: 0,
            has_more: false, next_offset: null, stats: { links_returned: 1 }, links: [link(42)],
          };
        }
        if (path === "/align/link/create") return { ok: true, link_id: 99, status: null };
        if (path === "/align/links/batch_update") throw new Error("boom");
        throw new Error(`unexpected POST ${path}`);
      },
      put: async () => ({}),
    } as Conn;
    const panel = new AlignPanel(() => conn, () => DOCS, {
      log: () => {}, toast: (msg, err) => toasts.push({ msg, err }), setBusy: () => {},
      jobCenter: () => null, onRunDone: () => {}, onNav: () => {},
    });
    const el = panel.render();
    document.body.appendChild(el);
    await panel.scopeTo({ pivotDocId: 2, targetDocId: 3, linkId: 42 });

    const p = panel as unknown as {
      _retargetActive: unknown; _retargetCandidates: unknown;
      _doPickerSelect: (el: HTMLElement, targetUnitId: number) => Promise<void>;
    };
    p._retargetActive = { pivotUnitId: 101, linkId: 42, mode: "add" };
    p._retargetCandidates = [
      { target_unit_id: 901, target_text: "EN two", score: 0.9, reason: "position", external_id: 2 },
    ];
    await p._doPickerSelect(el, 901);

    // Le lien est créé, mais le groupement a échoué → aucun toast ne doit prétendre « groupée ».
    expect(toasts.some(t => /group/i.test(t.msg))).toBe(false);
    expect(toasts.some(t => /2ᵉ cible ajoutée/.test(t.msg))).toBe(true);
  });
});
