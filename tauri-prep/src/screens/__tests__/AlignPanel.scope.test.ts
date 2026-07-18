// @vitest-environment happy-dom
/**
 * T6.2 (D-P2) — `AlignPanel.scopeTo` : le handoff scopé matrice → « Révision fine ».
 *
 * La matrice (famille-scopée) résout une cellule en paire moyeu ↔ colonne + lien et la
 * passe ici ; `scopeTo` fixe les deux selects, remet les filtres à « tout », charge l'audit
 * de la paire et scrolle/surligne le lien. Ce test pilote le vrai flux en happy-dom via un
 * faux Conn (comme les tests `AlignMatrixView`), sans mock de module.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

interface ConnOpts { links?: AlignLinkRecord[] }

function makeConn(calls: Array<{ path: string; body: unknown }>, opts: ConnOpts = {}): Conn {
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
        const links = opts.links ?? [];
        return {
          ok: true, pivot_doc_id: 2, target_doc_id: 3, limit: 50, offset: 0,
          has_more: false, next_offset: null, stats: { links_returned: links.length }, links,
        };
      }
      throw new Error(`unexpected POST ${path}`);
    },
    put: async () => ({}),
  } as Conn;
}

function mount(calls: Array<{ path: string; body: unknown }>, opts: ConnOpts = {}) {
  const holder = { conn: makeConn(calls, opts) as Conn | null };
  const toasts: Array<{ msg: string; err?: boolean }> = [];
  const panel = new AlignPanel(() => holder.conn, () => DOCS, {
    log: () => {},
    toast: (msg, err) => toasts.push({ msg, err }),
    setBusy: () => {},
    jobCenter: () => null,
    onRunDone: () => {},
    onNav: () => {},
  });
  const el = panel.render();
  document.body.appendChild(el);
  return { panel, el, toasts, holder };
}

beforeEach(() => {
  // happy-dom n'a pas toujours scrollIntoView : le neutraliser pour ne pas casser _focusLink.
  Element.prototype.scrollIntoView = () => {};
});
afterEach(() => { document.body.innerHTML = ""; });

describe("AlignPanel.scopeTo (T6.2)", () => {
  it("fixe la paire, charge l'audit et surligne le lien ciblé", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const { panel, el } = mount(calls, { links: [link(42), link(43)] });

    const ok = await panel.scopeTo({ pivotDocId: 2, targetDocId: 3, linkId: 42 });
    expect(ok).toBe(true);

    // Les deux selects sont fixés sur la paire…
    expect(el.querySelector<HTMLSelectElement>("#align-pivot-sel")!.value).toBe("2");
    expect(el.querySelector<HTMLSelectElement>("#align-target-sel")!.value).toBe("3");
    // …l'audit est chargé pour CETTE paire…
    const audit = calls.find((c) => c.path === "/align/audit");
    expect(audit?.body).toEqual({ pivot_doc_id: 2, target_doc_id: 3, limit: 50, offset: 0 });
    // …et le lien ciblé est rendu puis surligné.
    const row = el.querySelector<HTMLElement>('.prep-align-row[data-link-id="42"]');
    expect(row).not.toBeNull();
    expect(row!.classList.contains("prep-align-row--highlight")).toBe(true);
  });

  it("remet les filtres à « tout » pour ne pas masquer le lien ciblé", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const { panel, el } = mount(calls, { links: [link(42)] });

    // L'utilisateur avait laissé le filtre « Rejetés » actif.
    el.querySelector<HTMLButtonElement>('[data-qf="rejected"]')!.click();
    expect(el.querySelector('[data-qf="rejected"]')!.classList.contains("active")).toBe(true);

    await panel.scopeTo({ pivotDocId: 2, targetDocId: 3, linkId: 42 });

    expect(el.querySelector('[data-qf="all"]')!.classList.contains("active")).toBe(true);
    expect(el.querySelector('[data-qf="rejected"]')!.classList.contains("active")).toBe(false);
  });

  it("paire introuvable (doc absent des selects) → toast + false, pas d'audit", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const { panel, toasts } = mount(calls, { links: [link(42)] });

    const ok = await panel.scopeTo({ pivotDocId: 999, targetDocId: 3, linkId: 42 });
    expect(ok).toBe(false);
    expect(toasts.some((t) => t.err && t.msg.includes("introuvable"))).toBe(true);
    expect(calls.some((c) => c.path === "/align/audit")).toBe(false);
  });

  it("lien hors première page → charge la paire mais signale (pas de handoff cassé)", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    // L'audit ne ramène PAS le lien 42 (il serait au-delà de la 1re page).
    const { panel, toasts } = mount(calls, { links: [link(50), link(51)] });

    const ok = await panel.scopeTo({ pivotDocId: 2, targetDocId: 3, linkId: 42 });
    expect(ok).toBe(true);
    expect(calls.some((c) => c.path === "/align/audit")).toBe(true);
    expect(toasts.some((t) => t.msg.includes("hors de la première page"))).toBe(true);
  });

  // Revue adverse — deux handoffs 🔎 coup sur coup sur des paires différentes, dont les audits
  // se résolvent HORS-ORDRE : seul le DERNIER appel doit peindre la grille (jeton de séquence).
  it("audits concurrents résolus hors-ordre : seul le dernier handoff s'applique", async () => {
    const docs3 = [
      { doc_id: 2, title: "Le Livre", language: "fr" },
      { doc_id: 3, title: "The Book", language: "en" },
      { doc_id: 4, title: "Das Buch", language: "de" },
    ] as unknown as DocumentRecord[];
    // Chaque /align/audit renvoie une promesse suspendue, résolvable par target_doc_id.
    const resolvers = new Map<number, (links: AlignLinkRecord[]) => void>();
    const conn = {
      baseUrl: "http://test", token: null,
      get: async (path: string) => {
        if (path === "/families") return { families: [] };
        if (path === "/align/source_changed_summary") return { total: 0, docs: [] };
        throw new Error(`unexpected GET ${path}`);
      },
      post: async (path: string, body: unknown) => {
        if (path === "/align/audit") {
          const tgt = (body as { target_doc_id: number }).target_doc_id;
          return new Promise((resolve) => {
            resolvers.set(tgt, (links) => resolve({
              ok: true, pivot_doc_id: 2, target_doc_id: tgt, limit: 50, offset: 0,
              has_more: false, next_offset: null, stats: { links_returned: links.length }, links,
            }));
          });
        }
        throw new Error(`unexpected POST ${path}`);
      },
      put: async () => ({}),
    } as Conn;
    const panel = new AlignPanel(() => conn, () => docs3, {
      log: () => {}, toast: () => {}, setBusy: () => {}, jobCenter: () => null,
      onRunDone: () => {}, onNav: () => {},
    });
    const el = panel.render();
    document.body.appendChild(el);

    // Handoff A (paire 2↔3, lien 31) PUIS handoff B (paire 2↔4, lien 41), sans attendre A.
    const pA = panel.scopeTo({ pivotDocId: 2, targetDocId: 3, linkId: 31 });
    const pB = panel.scopeTo({ pivotDocId: 2, targetDocId: 4, linkId: 41 });
    await vi.waitFor(() => { expect(resolvers.has(3)).toBe(true); expect(resolvers.has(4)).toBe(true); });

    // B (le dernier lancé) se résout D'ABORD, A (le premier) ENSUITE → ordre inversé.
    resolvers.get(4)!([link(41, { target_unit_id: 940 })]);
    resolvers.get(3)!([link(31, { target_unit_id: 930 })]);
    await Promise.all([pA, pB]);

    // Le résultat de A, périmé, ne doit PAS avoir écrasé la grille : seul le lien de B est peint.
    expect(el.querySelector('.prep-align-row[data-link-id="41"]')).not.toBeNull();
    expect(el.querySelector('.prep-align-row[data-link-id="31"]')).toBeNull();
    // Et les selects restent cohérents avec la grille (paire B).
    expect(el.querySelector<HTMLSelectElement>("#align-target-sel")!.value).toBe("4");
  });
});
