// @vitest-environment happy-dom
/**
 * SEL-01 — les trois listes de l'espace Alignement peuplées par la base (pivot, cible,
 * famille) sont habillées d'un menu qui s'ouvre vers le bas.
 *
 * Ce qui est vérifié ici n'est pas l'ouverture du menu — `lib/__tests__/selectMenu.test.ts`
 * couvre le composant — mais son **branchement** : que les trois bons `<select>` sont
 * habillés et les listes courtes laissées natives, que le `<select>` reste le modèle pour
 * tout le code qui l'interroge, que les trois sites qui posent `value` par programme
 * repeignent le déclencheur, et que `dispose()` rend l'écran à son état d'origine.
 *
 * Le piège que ces tests tiennent : `value` est une propriété, aucune mutation ne la
 * signale. Un site qui l'écrit sans `sync()` laisse le déclencheur afficher l'entrée
 * précédente — l'écran ment alors sur son propre état, en silence.
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

function mount(families: FamilyRecord[] = [], docs: DocumentRecord[] = DOCS) {
  const vus = { docs };
  const conn = {
    baseUrl: "http://test", token: null,
    get: async (path: string) => {
      if (path === "/families") return { families };
      if (path === "/align/source_changed_summary") return { total: 0, docs: [] };
      throw new Error(`unexpected GET ${path}`);
    },
    post: async (path: string, body: unknown) => {
      if (path === "/align/audit") {
        return {
          ok: true, pivot_doc_id: 2, target_doc_id: (body as { target_doc_id: number }).target_doc_id,
          limit: 50, offset: 0, has_more: false, next_offset: null,
          stats: { links_returned: 2 }, links: [link(1), link(2)],
        };
      }
      if (path === "/families/2/align") {
        return {
          ok: true,
          results: [{ pivot_doc_id: 2, target_doc_id: 3, target_lang: "en", status: "aligned",
            links_created: 2, warnings: [] }],
          summary: { total_links_created: 2, aligned: 1, skipped: 0, errors: 0, total_pairs: 1 },
        };
      }
      if (path === "/align/quality") return { ok: true, stats: {} };
      throw new Error(`unexpected POST ${path}`);
    },
    put: async () => ({}),
  } as unknown as Conn;
  const toasts: Array<{ msg: string; err?: boolean }> = [];
  const logs: string[] = [];
  const panel = new AlignPanel(() => conn, () => vus.docs, {
    log: (m) => logs.push(m), toast: (msg, err) => toasts.push({ msg, err }),
    setBusy: () => {}, jobCenter: () => null, onRunDone: () => {}, onNav: () => {},
  });
  const el = panel.render();
  document.body.appendChild(el);
  return { panel, el, toasts, logs, vus };
}

/** Le texte que le déclencheur d'un `<select>` habillé affiche à l'écran. */
function affiche(el: HTMLElement, id: string): string {
  const sel = el.querySelector<HTMLSelectElement>(id);
  const trigger = sel?.closest(".prep-selmenu")?.querySelector(".prep-selmenu-text");
  return trigger?.textContent ?? "";
}

/** Laisse tourner l'observateur de mutations, qui n'est pas synchrone. */
async function laisserObserver(): Promise<void> {
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => { Element.prototype.scrollIntoView = () => {}; });
afterEach(() => { document.body.innerHTML = ""; });

describe("AlignPanel — les listes peuplées par la base (SEL-01)", () => {
  it("habille les trois listes de la base, et laisse les listes courtes natives", () => {
    const { el } = mount();
    for (const id of ["#align-pivot-sel", "#align-target-sel", "#align-family-sel"]) {
      const sel = el.querySelector<HTMLSelectElement>(id);
      expect(sel, id).toBeTruthy();
      expect(sel!.closest(".prep-selmenu"), `${id} devrait être habillé`).toBeTruthy();
    }
    // La stratégie d'alignement est une liste de cinq entrées fixes : le contrôle natif y
    // garde ses qualités (clavier système, lecteurs d'écran) et ne peut pas déborder.
    const strat = el.querySelector<HTMLSelectElement>("#align-strategy-sel");
    expect(strat).toBeTruthy();
    expect(strat!.closest(".prep-selmenu")).toBeNull();
  });

  it("le <select> reste le modèle : options, value et change inchangés", () => {
    const { el } = mount();
    const piv = el.querySelector<HTMLSelectElement>("#align-pivot-sel")!;
    // Les options peuplées depuis les documents sont toujours là, interrogeables comme avant.
    expect(piv.querySelector('option[value="2"]')?.textContent).toBe("Le Livre (fr)");
    let vus = 0;
    piv.addEventListener("change", () => { vus += 1; });
    piv.value = "3";
    piv.dispatchEvent(new Event("change", { bubbles: true }));
    expect(vus).toBe(1);
    expect(piv.value).toBe("3");
  });

  it("choisir dans le menu écrit dans le <select> et fait partir change", () => {
    const { el } = mount();
    const piv = el.querySelector<HTMLSelectElement>("#align-pivot-sel")!;
    const menu = piv.closest(".prep-selmenu")!;
    let vus = 0;
    piv.addEventListener("change", () => { vus += 1; });
    const opt = menu.querySelector<HTMLButtonElement>('.prep-selmenu-opt[data-value="3"]');
    expect(opt, "l'option du menu doit exister").toBeTruthy();
    opt!.click();
    expect(piv.value).toBe("3");
    expect(vus).toBe(1);
    expect(affiche(el, "#align-pivot-sel")).toBe("The Book (en)");
  });

  it("scopeTo repeint les deux déclencheurs de paire", async () => {
    const { panel, el } = mount();
    expect(affiche(el, "#align-pivot-sel")).toBe("— choisir —");
    const ok = await panel.scopeTo({ pivotDocId: 2, targetDocId: 3, linkId: 1 });
    expect(ok).toBe(true);
    // Sans `_syncMenus()`, les deux déclencheurs afficheraient encore « — choisir — »
    // pendant que le <select> porte déjà la paire : l'écran mentirait sur son état.
    expect(affiche(el, "#align-pivot-sel")).toBe("Le Livre (fr)");
    expect(affiche(el, "#align-target-sel")).toBe("The Book (en)");
  });

  it("reviewFamily repeint le déclencheur de famille", async () => {
    const { panel, el } = mount([family()]);
    const ok = await panel.reviewFamily(2);
    expect(ok).toBe(true);
    expect(el.querySelector<HTMLSelectElement>("#align-family-sel")!.value).toBe("2");
    expect(affiche(el, "#align-family-sel")).toContain("Le Livre");
  });

  it("reconstruire les options repeint sans qu'on le demande — c'est l'observateur", async () => {
    const { panel, el, vus } = mount();
    expect(affiche(el, "#align-pivot-sel")).toBe("— choisir —");
    // Un document renommé ailleurs : `refreshDocs` reconstruit les <option>, et rien
    // n'appelle `sync()`. Le menu doit se corriger seul, sinon il affiche un titre mort.
    const piv = el.querySelector<HTMLSelectElement>("#align-pivot-sel")!;
    piv.value = "2";
    vus.docs = [
      { doc_id: 2, title: "Le Livre (renommé)", language: "fr" },
      { doc_id: 3, title: "The Book", language: "en" },
    ] as unknown as DocumentRecord[];
    panel.refreshDocs();
    await laisserObserver();
    expect(affiche(el, "#align-pivot-sel")).toBe("Le Livre (renommé) (fr)");
  });

  it("après un run famille, la paire chargée d'office repeint les déclencheurs", async () => {
    const { el } = mount([family()]);
    for (let i = 0; i < 4; i += 1) await laisserObserver();
    const fam = el.querySelector<HTMLSelectElement>("#align-family-sel")!;
    expect(fam.querySelector('option[value="2"]'), "la famille doit être chargée").toBeTruthy();
    fam.value = "2";
    fam.dispatchEvent(new Event("change", { bubbles: true }));
    el.querySelector<HTMLButtonElement>("#align-family-run-btn")!.click();
    el.querySelector<HTMLButtonElement>("#align-confirm-ok")!.click();
    for (let i = 0; i < 8; i += 1) await laisserObserver();
    // Le troisième site qui pose `value` par programme : la paire alignée est chargée
    // d'office après le run, sans que personne ne l'ait choisie dans les deux listes.
    expect(el.querySelector<HTMLSelectElement>("#align-pivot-sel")!.value).toBe("2");
    expect(affiche(el, "#align-pivot-sel")).toBe("Le Livre (fr)");
    expect(affiche(el, "#align-target-sel")).toBe("The Book (en)");
  });

  it("dispose() rend les trois <select> à leur état d'origine", () => {
    const { panel, el } = mount();
    panel.dispose();
    for (const id of ["#align-pivot-sel", "#align-target-sel", "#align-family-sel"]) {
      const sel = el.querySelector<HTMLSelectElement>(id);
      expect(sel, id).toBeTruthy();
      expect(sel!.closest(".prep-selmenu"), `${id} devrait être démonté`).toBeNull();
      expect(sel!.classList.contains("prep-selmenu-native")).toBe(false);
    }
    expect(el.querySelectorAll(".prep-selmenu-trigger").length).toBe(0);
  });
});
