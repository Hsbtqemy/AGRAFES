import { describe, it, expect } from "vitest";
import {
  resolveVisible, isAllVisible, targetDocIdsParam, alignScopeOf, langList,
  buildVisibleColsHtml, saveVisibleCols, loadVisibleCols, clearVisibleCols,
  VISIBLE_COLS_KEY,
  type MatrixColumn,
} from "../alignVisibleCols.ts";

const COLS: MatrixColumn[] = [
  { docId: 372, lang: "en" },
  { docId: 419, lang: "es" },
  { docId: 420, lang: "ro" },
];

function store(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

describe("ensemble visible", () => {
  it("garde l'ordre de la famille, pas celui de la sélection", () => {
    expect(resolveVisible(COLS, new Set([420, 372]))).toEqual([
      { docId: 372, lang: "en" }, { docId: 420, lang: "ro" },
    ]);
  });

  it("ne poste target_doc_ids que si une colonne est masquée", () => {
    // Tout visible = chemin historique de la route : on n'envoie rien.
    expect(targetDocIdsParam(COLS, new Set([372, 419, 420]))).toBeUndefined();
    expect(targetDocIdsParam(COLS, new Set([419]))).toEqual([419]);
  });

  it("ignore un doc_id périmé plutôt que de le poster (le moteur le refuserait)", () => {
    expect(targetDocIdsParam(COLS, new Set([419, 999]))).toEqual([419]);
  });

  it("isAllVisible est faux sur une famille vide (rien à afficher n'est pas « tout »)", () => {
    expect(isAllVisible([], new Set())).toBe(false);
  });

  it("colonnes inconnues ⇒ AUCUN scope, jamais un scope vide", () => {
    // « je ne sais pas encore quelles sont les colonnes » et « l'utilisateur a tout
    // masqué » sont deux états très différents : le premier doit retomber sur le chemin
    // historique, le second demander explicitement le moyeu seul.
    expect(targetDocIdsParam([], new Set())).toBeUndefined();
    expect(targetDocIdsParam(COLS, new Set())).toEqual([]);
  });
});

describe("périmètre d'un run", () => {
  it("non scopé quand tout est visible — le run porte sur la famille", () => {
    const s = alignScopeOf(COLS, new Set([372, 419, 420]));
    expect(s.scoped).toBe(false);
    expect(s.spared).toEqual([]);
  });

  it("nomme les colonnes épargnées : c'est la phrase qui manquait à la confirmation", () => {
    const s = alignScopeOf(COLS, new Set([372]));
    expect(s.scoped).toBe(true);
    expect(s.targets.map((c) => c.lang)).toEqual(["en"]);
    expect(langList(s.spared)).toBe("es et ro");
  });

  it("colonnes inconnues ⇒ PAS scopé : « je ne sais pas » n'est pas « je restreins à rien »", () => {
    // `isAllVisible([])` est faux ; en déduire « scopé » a produit trois défauts distincts
    // (options de run, paramètre de projection, garde de capacité), tous du même geste :
    // borner une opération à zéro colonne au lieu de la laisser porter sur la famille.
    const s = alignScopeOf([], new Set());
    expect(s.scoped).toBe(false);
    expect(s.targets).toEqual([]);
    expect(s.spared).toEqual([]);
  });

  it("tout masquer EST un périmètre, lui — l'utilisateur l'a demandé", () => {
    expect(alignScopeOf(COLS, new Set()).scoped).toBe(true);
  });

  it("énumère à la française", () => {
    expect(langList([])).toBe("");
    expect(langList([COLS[0]])).toBe("en");
    expect(langList(COLS)).toBe("en, es et ro");
  });
});

describe("barre de chips", () => {
  it("porte l'état de chaque langue et l'effectif de liens", () => {
    const html = buildVisibleColsHtml(COLS, new Set([372, 419, 420]),
      new Map([[372, 3761], [419, 1924], [420, 1921]]));
    expect(html).toContain('data-col-doc="372"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("3761");
    // Rien de masqué : ni bouton de retour, ni mention.
    expect(html).not.toContain("matrix-cols-all");
    expect(html).not.toContain("masquée");
  });

  it("annonce ce qui est masqué et offre le retour", () => {
    const html = buildVisibleColsHtml(COLS, new Set([372]));
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("matrix-cols-all");
    expect(html).toContain("2 masquées : es et ro");
  });

  it("échappe la langue — elle vient d'un import, donc de l'extérieur", () => {
    const html = buildVisibleColsHtml(
      [{ docId: 1, lang: '<img src=x onerror="alert(1)">' }], new Set([1]));
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("rend une chaîne vide sans colonne (une famille sans traduction)", () => {
    expect(buildVisibleColsHtml([], new Set())).toBe("");
  });
});

describe("persistance", () => {
  it("restitue le choix pour ce corpus et cette famille", () => {
    const s = store();
    saveVisibleCols(s, "/db/corpus.db", 373, [419]);
    expect([...loadVisibleCols(s, "/db/corpus.db", 373, COLS)]).toEqual([419]);
  });

  it("retombe sur TOUT pour une autre famille ou un autre corpus", () => {
    const s = store();
    saveVisibleCols(s, "/db/corpus.db", 373, [419]);
    expect(loadVisibleCols(s, "/db/corpus.db", 396, COLS).size).toBe(3);
    expect(loadVisibleCols(s, "/db/autre.db", 373, COLS).size).toBe(3);
  });

  it("retombe sur TOUT sans chemin de base — mieux vaut tout montrer que deviner", () => {
    const s = store();
    saveVisibleCols(s, "/db/corpus.db", 373, [419]);
    expect(loadVisibleCols(s, null, 373, COLS).size).toBe(3);
    // et n'écrit rien sans corpus identifié
    saveVisibleCols(s, null, 373, [419]);
    expect(s.getItem(VISIBLE_COLS_KEY)).toBe(JSON.stringify(
      { dbPath: "/db/corpus.db", byFamily: { 373: [419] } }));
  });

  it("garde le choix de CHAQUE famille — A → B → A retrouve le sien", () => {
    // Une entrée unique ne gardait que la dernière famille ouverte : revenir sur la
    // précédente réaffichait tout, en contredisant ce que la barre laisse croire.
    const s = store();
    saveVisibleCols(s, "/db/corpus.db", 373, [419]);
    saveVisibleCols(s, "/db/corpus.db", 396, [420]);
    expect([...loadVisibleCols(s, "/db/corpus.db", 373, COLS)]).toEqual([419]);
    expect([...loadVisibleCols(s, "/db/corpus.db", 396, COLS)]).toEqual([420]);
  });

  it("changer de corpus repart de zéro : un doc_id d'une autre base ne désigne rien ici", () => {
    const s = store();
    saveVisibleCols(s, "/db/corpus.db", 373, [419]);
    saveVisibleCols(s, "/db/autre.db", 373, [372]);
    expect([...loadVisibleCols(s, "/db/autre.db", 373, COLS)]).toEqual([372]);
    // l'enregistrement du premier corpus a bien été remplacé, pas fusionné
    expect([...loadVisibleCols(s, "/db/corpus.db", 373, COLS)].length).toBe(3);
  });

  it("intersecte avec la famille du jour : un doc détaché ne doit pas partir au moteur", () => {
    const s = store();
    saveVisibleCols(s, "/db/corpus.db", 373, [419, 999]);
    expect([...loadVisibleCols(s, "/db/corpus.db", 373, COLS)]).toEqual([419]);
  });

  it("une préférence qui ne recoupe plus rien repart de TOUT, jamais de rien", () => {
    const s = store();
    saveVisibleCols(s, "/db/corpus.db", 373, [111, 222]);
    expect(loadVisibleCols(s, "/db/corpus.db", 373, COLS).size).toBe(3);
  });

  it("survit à un contenu illisible", () => {
    const s = store();
    s.setItem(VISIBLE_COLS_KEY, "{pas du json");
    expect(loadVisibleCols(s, "/db/corpus.db", 373, COLS).size).toBe(3);
  });

  it("s'efface", () => {
    const s = store();
    saveVisibleCols(s, "/db/corpus.db", 373, [419]);
    clearVisibleCols(s);
    expect(loadVisibleCols(s, "/db/corpus.db", 373, COLS).size).toBe(3);
  });
});
