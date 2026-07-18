// @vitest-environment happy-dom
/**
 * D-P9-2b — `AlignPanel.reviewFamily` : le deep-link « à réviser / collisions » (panneau
 * famille de Documents) → « Révision fine » en mode famille.
 *
 * À la différence de `scopeTo` (paire-scopé, T6.2), `reviewFamily` est FAMILLE-scopé : il
 * recharge les familles, fixe le `<select>` famille et entre dans la revue famille (audit de
 * chaque paire moyeu ↔ enfant). Piloté en happy-dom via un faux Conn, sans mock de module.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AlignPanel } from "../AlignPanel.ts";
import type { AlignLinkRecord, Conn, DocumentRecord, FamilyRecord } from "../../lib/sidecarClient.ts";

const DOCS = [
  { doc_id: 2, title: "Le Livre", language: "fr" },
  { doc_id: 3, title: "The Book", language: "en" },
] as unknown as DocumentRecord[];

function family(): FamilyRecord {
  return {
    family_id: 2,
    parent: { doc_id: 2, title: "Le Livre", language: "fr" } as DocumentRecord,
    children: [
      { doc_id: 3, doc: { doc_id: 3, title: "The Book", language: "en" }, segmented: true,
        aligned_to_parent: true, relation_type: "translation_of" },
    ],
    stats: {
      total_docs: 2, segmented_docs: 2, parent_seg_count: 2,
      aligned_pairs: 1, total_pairs: 1, validated_docs: 0, completion_pct: 100,
      ratio_warnings: [], status_counts: { accepted: 0, rejected: 0, unreviewed: 2 }, collision_count: 0,
    },
  } as unknown as FamilyRecord;
}

function link(link_id: number): AlignLinkRecord {
  return {
    link_id, external_id: 1, pivot_unit_id: 100 + link_id, target_unit_id: 900 + link_id,
    pivot_text: "FR", target_text: "EN", target_text_raw: "EN", status: null, bead_id: null,
  } as AlignLinkRecord;
}

function mount(calls: Array<{ path: string; body: unknown }>, families: FamilyRecord[]) {
  const holder = { conn: null as Conn | null };
  holder.conn = {
    baseUrl: "http://test", token: null,
    get: async (path: string) => {
      calls.push({ path, body: null });
      if (path === "/families") return { families };
      if (path === "/align/source_changed_summary") return { total: 0, docs: [] };
      throw new Error(`unexpected GET ${path}`);
    },
    post: async (path: string, body: unknown) => {
      calls.push({ path, body });
      if (path === "/align/audit") {
        return {
          ok: true, pivot_doc_id: 2, target_doc_id: (body as { target_doc_id: number }).target_doc_id,
          limit: 50, offset: 0, has_more: false, next_offset: null,
          stats: { links_returned: 2 }, links: [link(1), link(2)],
        };
      }
      throw new Error(`unexpected POST ${path}`);
    },
    put: async () => ({}),
  } as Conn;
  const toasts: Array<{ msg: string; err?: boolean }> = [];
  const panel = new AlignPanel(() => holder.conn, () => DOCS, {
    log: () => {}, toast: (msg, err) => toasts.push({ msg, err }),
    setBusy: () => {}, jobCenter: () => null, onRunDone: () => {}, onNav: () => {},
  });
  const el = panel.render();
  document.body.appendChild(el);
  return { panel, el, toasts };
}

beforeEach(() => { Element.prototype.scrollIntoView = () => {}; });
afterEach(() => { document.body.innerHTML = ""; });

describe("AlignPanel.reviewFamily (D-P9-2b)", () => {
  it("fixe le <select> famille, entre en revue famille et charge l'audit de la paire", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const { panel, el } = mount(calls, [family()]);

    const ok = await panel.reviewFamily(2);
    expect(ok).toBe(true);

    // Le select famille est fixé sur la famille ciblée…
    expect(el.querySelector<HTMLSelectElement>("#align-family-sel")!.value).toBe("2");
    // …le bitext famille est affiché (mode revue famille actif)…
    const familyBitext = el.querySelector<HTMLElement>("#align-family-bitext");
    expect(familyBitext!.style.display).not.toBe("none");
    // …et l'audit est chargé pour la paire moyeu(2) ↔ enfant(3).
    const audit = calls.find((c) => c.path === "/align/audit");
    expect((audit?.body as { pivot_doc_id: number; target_doc_id: number }))
      .toMatchObject({ pivot_doc_id: 2, target_doc_id: 3 });
  });

  it("famille introuvable → toast + false, pas d'audit", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const { panel, toasts } = mount(calls, [family()]);

    const ok = await panel.reviewFamily(999);
    expect(ok).toBe(false);
    expect(toasts.some((t) => t.err && t.msg.includes("introuvable"))).toBe(true);
    expect(calls.some((c) => c.path === "/align/audit")).toBe(false);
  });

  it("sans connexion → toast + false", async () => {
    const toasts: Array<{ msg: string; err?: boolean }> = [];
    const panel = new AlignPanel(() => null, () => DOCS, {
      log: () => {}, toast: (msg, err) => toasts.push({ msg, err }),
      setBusy: () => {}, jobCenter: () => null, onRunDone: () => {}, onNav: () => {},
    });
    const el = panel.render();
    document.body.appendChild(el);

    const ok = await panel.reviewFamily(2);
    expect(ok).toBe(false);
    expect(toasts.some((t) => t.err && t.msg.includes("connexion"))).toBe(true);
  });
});
