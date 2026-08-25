// @vitest-environment happy-dom
/**
 * L'ensemble des langues affichées (§2.1/D-W7, ALI-15 + ALI-18).
 *
 * Ce que ces tests tiennent est un invariant, pas une commodité : **ce qui est chargé est
 * ce qui est affiché, et on ne réécrit jamais une colonne masquée**. Les deux moitiés
 * comptent — masquer sans borner le run donnerait la pire des combinaisons : une colonne
 * invisible, purgée sans que personne ne la voie disparaître.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { AlignMatrixView } from "../AlignMatrixView.ts";
import type { AlignMatrix, Conn, MatrixCellLink } from "../../lib/sidecarClient.ts";
import { VISIBLE_COLS_KEY } from "../../lib/alignVisibleCols.ts";

function lk(link_id: number, target: number, raw: string): MatrixCellLink {
  return { link_id, target_unit_id: target, char_start: null, char_end: null, target_text_raw: raw };
}

/** fr (moyeu) + en + ro — la forme qui pose le problème : deux traductions. */
const MATRIX: AlignMatrix = {
  headers: ["paragraphe", "segment", "fr", "en", "ro"],
  languages: ["fr", "en", "ro"],
  hub_doc_id: 2,
  rows: [["1", 1, "FR un", "EN one", "RO unu"]],
  hub_unit_ids: [101],
  language_doc_ids: [2, 3, 4],
  cell_links: [[[lk(11, 900, "EN one")], [lk(12, 950, "RO unu")]]],
  link_count: 40,
  link_counts: [
    { target_doc_id: 3, links: 25, manual: 0 },
    { target_doc_id: 4, links: 15, manual: 3 },
  ],
};

const FAMILY = {
  family_id: 2,
  parent: { doc_id: 2, title: "Le Livre" },
  children: [
    { doc_id: 3, relation_type: "translation_of", doc: { doc_id: 3, language: "en" }, segmented: true, seg_count: 1, aligned_to_parent: true },
    { doc_id: 4, relation_type: "translation_of", doc: { doc_id: 4, language: "ro" }, segmented: true, seg_count: 1, aligned_to_parent: true },
  ],
  stats: { total_docs: 3 },
};

type Call = { path: string; body: unknown };

/** Un sidecar antérieur à 1.6.77 : il IGNORE `target_doc_ids` et ne rend pas `link_counts`. */
function makeOldConn(calls: Call[]): Conn {
  return {
    baseUrl: "http://test", token: null,
    get: async (path: string) => {
      calls.push({ path, body: null });
      if (path === "/families") return { families: [FAMILY] };
      throw new Error(`unexpected GET ${path}`);
    },
    post: async (path: string, body: unknown) => {
      calls.push({ path, body });
      if (path === "/align/matrix") {
        const { link_counts: _drop, ...rest } = MATRIX;   // paramètre ignoré, marqueur absent
        return rest as AlignMatrix;
      }
      if (path === "/families/2/align") throw new Error("le run n'aurait jamais dû partir");
      throw new Error(`unexpected POST ${path}`);
    },
    put: async () => ({}),
  } as Conn;
}

function makeConn(calls: Call[]): Conn {
  return {
    baseUrl: "http://test", token: null,
    get: async (path: string) => {
      calls.push({ path, body: null });
      if (path === "/families") return { families: [FAMILY] };
      throw new Error(`unexpected GET ${path}`);
    },
    post: async (path: string, body: unknown) => {
      calls.push({ path, body });
      if (path === "/align/matrix") {
        // Le serveur ne rend QUE les colonnes demandées : le simuler, sinon le test
        // validerait une requête sans jamais vérifier qu'on sait lire sa réponse.
        const ids = (body as { target_doc_ids?: number[] }).target_doc_ids;
        if (!ids) return MATRIX;
        const keep = MATRIX.language_doc_ids!
          .map((d, i) => ({ d, i })).filter((x) => x.i === 0 || ids.includes(x.d));
        return {
          ...MATRIX,
          headers: ["paragraphe", "segment", ...keep.map((x) => MATRIX.languages[x.i])],
          languages: keep.map((x) => MATRIX.languages[x.i]),
          language_doc_ids: keep.map((x) => x.d),
          rows: MATRIX.rows.map((r) => [r[0], r[1], ...keep.map((x) => r[2 + x.i])]),
          cell_links: MATRIX.cell_links!.map((r) => keep.slice(1).map((x) => r[x.i - 1])),
          link_counts: MATRIX.link_counts!.filter((c) => ids.includes(c.target_doc_id)),
        } as AlignMatrix;
      }
      if (path === "/families/2/align") {
        return {
          family_root_id: 2, strategy: "length_bounded", results: [],
          summary: { total_pairs: 1, aligned: 1, skipped: 0, conflicts: 0, errors: 0, total_links_created: 7 },
        };
      }
      throw new Error(`unexpected POST ${path}`);
    },
    put: async () => ({}),
  } as Conn;
}

async function mountLoaded(calls: Call[], conn?: Conn) {
  const holder = { conn: conn ?? makeConn(calls) };
  const toasts: string[] = [];
  const view = new AlignMatrixView(() => holder.conn, { toast: (m) => toasts.push(m) });
  const el = view.render();
  document.body.appendChild(el);
  view.onActivated();
  await vi.waitFor(() => {
    expect(el.querySelector<HTMLOptionElement>('#matrix-family option[value="2"]')).not.toBeNull();
  });
  const sel = el.querySelector<HTMLSelectElement>("#matrix-family")!;
  sel.value = "2";
  sel.dispatchEvent(new Event("change"));
  el.querySelector<HTMLButtonElement>("#matrix-load")!.click();
  await vi.waitFor(() => { expect(el.querySelector(".prep-matrix-grid")).not.toBeNull(); });
  return { view, el, toasts, holder };
}

const chip = (el: HTMLElement, docId: number) =>
  el.querySelector<HTMLButtonElement>(`.prep-matrix-col-chip[data-col-doc="${docId}"]`)!;
const matrixCalls = (calls: Call[]) => calls.filter((c) => c.path === "/align/matrix");
/** Attendre la n-ième projection **rendue** — pas seulement partie : `_setVisibleCols`
 *  refuse une bascule pendant un chargement (garde F5), donc un test qui n'attend que
 *  l'appel enchaîne sur un écran encore occupé et croit à une régression. */
async function projected(el: HTMLElement, calls: Call[], n: number) {
  await vi.waitFor(() => {
    expect(matrixCalls(calls).length).toBe(n);
    expect(el.querySelector(".prep-matrix-grid")).not.toBeNull();
  });
}
const lastMatrixBody = (calls: Call[]) => {
  const all = matrixCalls(calls);
  return all[all.length - 1].body as { target_doc_ids?: number[] };
};

afterEach(() => {
  document.body.innerHTML = "";
  sessionStorage.removeItem(VISIBLE_COLS_KEY);
});

describe("barre des langues", () => {
  it("est construite depuis /families — donc AVANT tout chargement, et sans dépendre de la projection", async () => {
    const calls: Call[] = [];
    const { el } = await mountLoaded(calls);
    // Les deux traductions sont là, allumées : le défaut est « toutes les langues ».
    expect(chip(el, 3).getAttribute("aria-pressed")).toBe("true");
    expect(chip(el, 4).getAttribute("aria-pressed")).toBe("true");
    // Tout visible ⇒ la route est appelée comme avant ce chantier.
    expect(lastMatrixBody(calls).target_doc_ids).toBeUndefined();
  });

  it("affiche l'effectif de liens de chaque colonne (ALI-16)", async () => {
    const calls: Call[] = [];
    const { el } = await mountLoaded(calls);
    expect(chip(el, 3).textContent).toContain("25");
    expect(chip(el, 4).textContent).toContain("15");
  });

  it("masquer une langue reprojette SANS elle et le dit", async () => {
    const calls: Call[] = [];
    const { el } = await mountLoaded(calls);
    chip(el, 4).click();
    await projected(el, calls, 2);

    expect(lastMatrixBody(calls).target_doc_ids).toEqual([3]);
    // La grille ne porte plus que le moyeu + en.
    const ths = [...el.querySelectorAll(".prep-matrix-th")].map((t) => t.textContent ?? "");
    expect(ths.some((t) => t.includes("ro"))).toBe(false);
    // Et l'écran dit ce qu'il cache — sans quoi une colonne masquée hier se lit demain
    // comme une traduction absente de la famille.
    expect(el.querySelector(".prep-matrix-cols-note")?.textContent).toContain("ro");
    expect(el.querySelector("#matrix-cols-all")).not.toBeNull();
  });

  it("« Toutes » remet la famille entière", async () => {
    const calls: Call[] = [];
    const { el } = await mountLoaded(calls);
    chip(el, 4).click();
    await projected(el, calls, 2);
    el.querySelector<HTMLButtonElement>("#matrix-cols-all")!.click();
    await projected(el, calls, 3);
    expect(lastMatrixBody(calls).target_doc_ids).toBeUndefined();
  });

  it("tout masquer éteint « Aligner » au lieu de laisser partir un run vide", async () => {
    const calls: Call[] = [];
    const { el } = await mountLoaded(calls);
    chip(el, 3).click();
    await projected(el, calls, 2);
    chip(el, 4).click();
    await projected(el, calls, 3);

    const btn = el.querySelector<HTMLButtonElement>("#matrix-align")!;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toContain("Aucune langue affichée");
  });

  it("survit à une réactivation d'écran : revenir ne réaffiche pas ce qu'on vient de masquer", async () => {
    const calls: Call[] = [];
    const { el, view } = await mountLoaded(calls);
    chip(el, 4).click();
    await projected(el, calls, 2);

    view.onActivated();                       // rejoue _loadFamilies
    await vi.waitFor(() => {
      expect(calls.filter((c) => c.path === "/families").length).toBeGreaterThan(1);
    });
    expect(chip(el, 4).getAttribute("aria-pressed")).toBe("false");
  });
});

describe("un run ne touche jamais une colonne masquée", () => {
  it("« Aligner » déclare le périmètre affiché", async () => {
    const calls: Call[] = [];
    const { el } = await mountLoaded(calls);
    chip(el, 4).click();                       // on masque ro
    await vi.waitFor(() => { expect(matrixCalls(calls).length).toBe(2); });

    el.querySelector<HTMLButtonElement>("#matrix-align")!.click();
    // La colonne visible porte déjà 25 liens ⇒ confirmation avant tout run.
    await vi.waitFor(() => {
      expect(el.querySelector("#matrix-align-recalc")).not.toBeNull();
    });
    const strip = el.querySelector<HTMLElement>("#matrix-align-strip")!;
    expect(strip.textContent).toContain("en");
    expect(strip.textContent).toContain("ro");          // nommée comme épargnée
    expect(strip.textContent).toContain("épargnée");
    // Le bouton destructif nomme son périmètre au lieu de dire « global ».
    expect(el.querySelector("#matrix-align-recalc")!.textContent).toContain("Recalculer en");

    el.querySelector<HTMLButtonElement>("#matrix-align-recalc")!.click();
    await vi.waitFor(() => {
      expect(calls.some((c) => c.path === "/families/2/align")).toBe(true);
    });
    const run = calls.find((c) => c.path === "/families/2/align")!.body as Record<string, unknown>;
    expect(run.target_doc_ids).toEqual([3]);
    expect(run.replace_existing).toBe(true);
  });

  it("la confirmation compte les liens manuels du périmètre — ceux que « conserver les validés » ne sauve pas", async () => {
    const calls: Call[] = [];
    const { el } = await mountLoaded(calls);
    chip(el, 3).click();                       // on ne garde que ro (3 liens manuels)
    await vi.waitFor(() => { expect(matrixCalls(calls).length).toBe(2); });

    el.querySelector<HTMLButtonElement>("#matrix-align")!.click();
    await vi.waitFor(() => { expect(el.querySelector("#matrix-align-recalc")).not.toBeNull(); });
    const strip = el.querySelector<HTMLElement>("#matrix-align-strip")!.textContent ?? "";
    expect(strip).toContain("15");             // l'effectif de la colonne, pas celui de la famille
    expect(strip).toContain("3");              // dont 3 posés à la main
    expect(strip).toContain("à la main");
  });

  it("toutes les langues visibles ⇒ run famille-entière, comme avant", async () => {
    const calls: Call[] = [];
    const { el } = await mountLoaded(calls);
    el.querySelector<HTMLButtonElement>("#matrix-align")!.click();
    await vi.waitFor(() => { expect(el.querySelector("#matrix-align-recalc")).not.toBeNull(); });
    expect(el.querySelector("#matrix-align-recalc")!.textContent).toContain("Recalcul global");

    el.querySelector<HTMLButtonElement>("#matrix-align-complete")!.click();
    await vi.waitFor(() => {
      expect(calls.some((c) => c.path === "/families/2/align")).toBe(true);
    });
    const run = calls.find((c) => c.path === "/families/2/align")!.body as Record<string, unknown>;
    expect(run.target_doc_ids).toBeUndefined();
  });

  it("le « ⇄ » d'en-tête relance UNE colonne sans changer l'affichage (ALI-15)", async () => {
    const calls: Call[] = [];
    const { el } = await mountLoaded(calls);
    const before = matrixCalls(calls).length;

    el.querySelector<HTMLButtonElement>('.prep-matrix-col-align-btn[data-align-doc="4"]')!.click();
    await vi.waitFor(() => { expect(el.querySelector("#matrix-align-recalc")).not.toBeNull(); });
    // Le périmètre annoncé est la colonne cliquée, pas l'ensemble visible.
    expect(el.querySelector("#matrix-align-recalc")!.textContent).toContain("Recalculer ro");

    el.querySelector<HTMLButtonElement>("#matrix-align-recalc")!.click();
    await vi.waitFor(() => {
      expect(calls.some((c) => c.path === "/families/2/align")).toBe(true);
    });
    const run = calls.find((c) => c.path === "/families/2/align")!.body as Record<string, unknown>;
    expect(run.target_doc_ids).toEqual([4]);
    // …et l'affichage n'a pas bougé pendant ce temps : les deux chips restent allumés.
    expect(chip(el, 3).getAttribute("aria-pressed")).toBe("true");
    expect(chip(el, 4).getAttribute("aria-pressed")).toBe("true");
    // …et le run se conclut par une reprojection (asynchrone : l'attendre, sinon on
    // mesure l'instant d'avant).
    await vi.waitFor(() => { expect(matrixCalls(calls).length).toBeGreaterThan(before); });
  });

  it("une bascule entre la confirmation et le clic annule le run plutôt que d'élargir sa portée", async () => {
    const calls: Call[] = [];
    const { el, toasts } = await mountLoaded(calls);
    chip(el, 4).click();
    await projected(el, calls, 2);
    el.querySelector<HTMLButtonElement>("#matrix-align")!.click();
    await vi.waitFor(() => { expect(el.querySelector("#matrix-align-recalc")).not.toBeNull(); });

    // On réaffiche ro pendant que la bande est armée : elle est fermée, et rien ne part.
    el.querySelector<HTMLButtonElement>("#matrix-cols-all")!.click();
    await projected(el, calls, 3);
    expect(el.querySelector("#matrix-align-recalc")).toBeNull();
    expect(calls.some((c) => c.path === "/families/2/align")).toBe(false);
    expect(toasts.join(" ")).not.toContain("Alignement");
  });
});


describe("sidecar antérieur à 1.6.77", () => {
  it("refuse un run scopé au lieu de le lancer plus large que ce qu'il annonce", async () => {
    // Un sidecar qui ignore `target_doc_ids` rendrait « Recalculer en » destructeur pour
    // TOUTE la famille — exactement le défaut qu'on est en train de fermer. Sans preuve
    // que le moteur honore le paramètre, le geste est refusé, pas élargi.
    const calls: Call[] = [];
    const { el, toasts } = await mountLoaded(calls, makeOldConn(calls));

    // La divergence affichage/intention est signalée dès le chargement scopé.
    chip(el, 4).click();
    await projected(el, calls, 2);
    expect(toasts.join(" ")).toContain("Sidecar trop ancien");

    el.querySelector<HTMLButtonElement>("#matrix-align")!.click();
    await vi.waitFor(() => {
      expect(toasts.join(" ")).toContain("borner un alignement à une colonne");
    });
    // Ni confirmation armée, ni run parti.
    expect(el.querySelector("#matrix-align-recalc")).toBeNull();
    expect(calls.some((c) => c.path === "/families/2/align")).toBe(false);
  });

  it("laisse passer un run famille-entière : rien n'est promis qu'il ne tienne", async () => {
    const calls: Call[] = [];
    const { el, toasts } = await mountLoaded(calls, makeOldConn(calls));
    el.querySelector<HTMLButtonElement>("#matrix-align")!.click();
    await vi.waitFor(() => {
      expect(el.querySelector("#matrix-align-recalc")).not.toBeNull();
    });
    expect(toasts.join(" ")).not.toContain("borner un alignement");
  });
});
