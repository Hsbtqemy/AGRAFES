// @vitest-environment happy-dom
/**
 * SEL-01 — le choix du document cible d'une relation (`#rel-target-sel`, 57 entrées sur la
 * base de travail) passe au menu qui s'ouvre vers le bas.
 *
 * Le piège propre à cet écran : le panneau d'édition se re-rend **en entier** à chaque
 * sélection de document. Le `<select>` est donc un élément neuf à chaque fois, et l'habillage
 * précédent pointe sur du DOM détaché. Sans démontage, chaque aller-retour dans la liste
 * laisserait un `MutationObserver` de plus derrière lui — ce que ces tests tiennent.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MetadataScreen } from "../MetadataScreen.ts";
import type { Conn, DocumentRecord } from "../../lib/sidecarClient.ts";

const DOCS = [
  { doc_id: 1, title: "Le Livre", language: "fr", doc_role: "original" },
  { doc_id: 2, title: "The Book", language: "en", doc_role: "translation" },
  { doc_id: 3, title: "Das Buch", language: "de", doc_role: "translation" },
] as unknown as DocumentRecord[];

function conn(): Conn {
  return {
    baseUrl: "http://test", token: null,
    get: async (path: string) => {
      if (path.startsWith("/documents")) return { documents: DOCS };
      if (path.startsWith("/families")) return { families: [] };
      if (path.startsWith("/conventions")) return { roles: [] };
      if (path.startsWith("/doc_relations")) return { relations: [] };
      return {};
    },
    post: async () => ({}),
    put: async () => ({}),
  } as unknown as Conn;
}

function monter() {
  const screen = new MetadataScreen();
  const el = screen.render();
  document.body.appendChild(el);
  screen.setConn(conn());
  return { screen, el };
}

/** Rend le panneau d'édition pour un document donné, comme le fait un clic dans l'arbre. */
function ouvrirDoc(screen: MetadataScreen, doc: DocumentRecord): void {
  const s = screen as unknown as {
    _docs: DocumentRecord[]; _selectedDoc: DocumentRecord | null;
    _relations: unknown[]; _allRelations: unknown[]; _families: unknown[];
    _renderEditPanel: () => void;
  };
  s._docs = DOCS;
  s._selectedDoc = doc;
  s._relations = [];
  s._allRelations = [];
  s._families = [];
  s._renderEditPanel();
}

beforeEach(() => { Element.prototype.scrollIntoView = () => {}; });
afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); });

describe("MetadataScreen — le document cible d'une relation (SEL-01)", () => {
  it("habille `#rel-target-sel`, avec la largeur des listes de documents", () => {
    const { screen, el } = monter();
    ouvrirDoc(screen, DOCS[0]);
    const sel = el.querySelector<HTMLSelectElement>("#rel-target-sel");
    expect(sel, "le panneau doit porter le sélecteur").toBeTruthy();
    const enveloppe = sel!.closest(".prep-selmenu");
    expect(enveloppe).toBeTruthy();
    expect(enveloppe!.classList.contains("prep-selmenu--doc")).toBe(true);
    // Le <select> reste le modèle : ses options sont les autres documents, comme avant.
    expect(sel!.querySelectorAll("option")).toHaveLength(DOCS.length); // 2 docs + l'invite
  });

  it("`#rel-type` reste natif — trois entrées fixes", () => {
    const { screen, el } = monter();
    ouvrirDoc(screen, DOCS[0]);
    const sel = el.querySelector<HTMLSelectElement>("#rel-type");
    expect(sel).toBeTruthy();
    expect(sel!.closest(".prep-selmenu")).toBeNull();
  });

  it("re-rendre le panneau ne laisse qu'un habillage, et démonte le précédent", () => {
    const { screen, el } = monter();
    ouvrirDoc(screen, DOCS[0]);
    const premier = el.querySelector<HTMLSelectElement>("#rel-target-sel")!;
    ouvrirDoc(screen, DOCS[1]);
    ouvrirDoc(screen, DOCS[2]);
    // Un seul menu vivant dans le panneau, et le <select> d'origine n'est plus le même.
    expect(el.querySelectorAll(".prep-selmenu-trigger")).toHaveLength(1);
    const dernier = el.querySelector<HTMLSelectElement>("#rel-target-sel")!;
    expect(dernier).not.toBe(premier);
    // Le premier a été rendu à son état d'origine avant d'être jeté avec son panneau.
    expect(premier.classList.contains("prep-selmenu-native")).toBe(false);
  });

  it("dispose() démonte l'habillage", () => {
    const { screen, el } = monter();
    ouvrirDoc(screen, DOCS[0]);
    expect(el.querySelectorAll(".prep-selmenu-trigger")).toHaveLength(1);
    screen.dispose();
    expect(el.querySelectorAll(".prep-selmenu-trigger")).toHaveLength(0);
  });
});
