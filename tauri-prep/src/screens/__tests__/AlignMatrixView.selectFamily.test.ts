// @vitest-environment happy-dom
/**
 * D-P9-2b — `AlignMatrixView.selectAndLoadFamily` : le deep-link « couverture → matrice »
 * (panneau famille de Documents). La matrice n'a pas d'équivalent public de `AlignPanel.scopeTo`
 * (note §3) : cette méthode pré-sélectionne la famille + charge sa matrice.
 *
 * On teste aussi la CONVERGENCE avec le `_loadFamilies` concurrent lancé par `onActivated`
 * (que ActionsScreen déclenche en basculant la sous-vue) — c'est le point sensible de la revue
 * adverse T6.2 (deux chargements concurrents ne doivent pas diverger).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { AlignMatrixView } from "../AlignMatrixView.ts";
import type { AlignMatrix, Conn } from "../../lib/sidecarClient.ts";

const MATRIX: AlignMatrix = {
  headers: ["paragraphe", "segment", "fr", "en"],
  languages: ["fr", "en"],
  hub_doc_id: 2,
  rows: [["1", 1, "FR un", "EN one"]],
  hub_unit_ids: [101],
  language_doc_ids: [2, 3],
  cell_links: [[[{ link_id: 11, target_unit_id: 900, char_start: null, char_end: null, target_text_raw: "EN one" }]]],
};

const FAMILY = {
  family_id: 2,
  parent: { doc_id: 2, title: "Le Livre" },
  children: [],
  stats: { total_docs: 2 },
};

function makeConn(calls: Array<{ path: string; body: unknown }>): Conn {
  return {
    baseUrl: "http://test", token: null,
    get: async (path: string) => {
      calls.push({ path, body: null });
      if (path === "/families") return { families: [FAMILY] };
      throw new Error(`unexpected GET ${path}`);
    },
    post: async (path: string, body: unknown) => {
      calls.push({ path, body });
      if (path === "/align/matrix") return MATRIX;
      throw new Error(`unexpected POST ${path}`);
    },
    put: async () => ({}),
  } as Conn;
}

afterEach(() => { document.body.innerHTML = ""; });

describe("AlignMatrixView.selectAndLoadFamily (D-P9-2b)", () => {
  it("pré-sélectionne la famille et charge sa matrice", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const view = new AlignMatrixView(() => makeConn(calls), { toast: () => {} });
    const el = view.render();
    document.body.appendChild(el);

    const ok = await view.selectAndLoadFamily(2);
    expect(ok).toBe(true);
    expect(el.querySelector<HTMLSelectElement>("#matrix-family")!.value).toBe("2");
    expect(el.querySelector(".prep-matrix-grid")).not.toBeNull();
    expect(calls.some((c) => c.path === "/align/matrix")).toBe(true);
  });

  it("famille introuvable → toast + false, pas de matrice chargée", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const toasts: string[] = [];
    const view = new AlignMatrixView(() => makeConn(calls), { toast: (m) => toasts.push(m) });
    const el = view.render();
    document.body.appendChild(el);

    const ok = await view.selectAndLoadFamily(999);
    expect(ok).toBe(false);
    expect(toasts.some((t) => t.includes("introuvable"))).toBe(true);
    expect(calls.some((c) => c.path === "/align/matrix")).toBe(false);
    expect(el.querySelector(".prep-matrix-grid")).toBeNull();
  });

  it("sans connexion → toast + false (pas de faux succès silencieux)", async () => {
    const toasts: string[] = [];
    const view = new AlignMatrixView(() => null, { toast: (m) => toasts.push(m) });
    const el = view.render();
    document.body.appendChild(el);

    const ok = await view.selectAndLoadFamily(2);
    expect(ok).toBe(false);
    expect(toasts.some((t) => t.includes("connexion"))).toBe(true);
    expect(el.querySelector(".prep-matrix-grid")).toBeNull();
  });

  it("converge avec le _loadFamilies concurrent d'onActivated (pas de divergence)", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const view = new AlignMatrixView(() => makeConn(calls), { toast: () => {} });
    const el = view.render();
    document.body.appendChild(el);

    // onActivated (déclenché par le switch de sous-vue) lance un _loadFamilies NON attendu,
    // puis le deep-link appelle selectAndLoadFamily dans la foulée.
    view.onActivated();
    const ok = await view.selectAndLoadFamily(2);

    expect(ok).toBe(true);
    // La grille est celle de la famille 2 et le select y reste fixé, malgré le double chargement.
    expect(el.querySelector<HTMLSelectElement>("#matrix-family")!.value).toBe("2");
    expect(el.querySelector(".prep-matrix-grid")).not.toBeNull();
    // Laisser retomber toute résolution concurrente restante puis re-vérifier la cohérence.
    await vi.waitFor(() => {
      expect(el.querySelector<HTMLSelectElement>("#matrix-family")!.value).toBe("2");
    });
  });
});
