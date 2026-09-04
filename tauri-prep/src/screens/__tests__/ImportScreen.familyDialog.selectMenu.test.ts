// @vitest-environment happy-dom
/**
 * SEL-01 — la boîte « Rattacher à une famille ? » de l'import : son choix de parent liste
 * tout le corpus, moins le document qu'on vient d'importer.
 *
 * Elle est le cas le plus exposé du chantier. Une boîte modale est centrée verticalement,
 * donc son sélecteur est à mi-hauteur d'écran : c'est exactement la position où Chromium
 * juge la place insuffisante en dessous et retourne la fenêtre système du `<select>`.
 *
 * Et la boîte est éphémère : elle se pose sur `document.body` et disparaît à la fermeture.
 * L'habillage doit être démonté avec elle, sinon chaque import laisse un observateur.
 */
import { describe, it, expect, afterEach } from "vitest";
import { ImportScreen } from "../ImportScreen.ts";
import type { Conn, DocumentRecord } from "../../lib/sidecarClient.ts";

const DOCS = [
  { doc_id: 1, title: "Le Livre", language: "fr" },
  { doc_id: 2, title: "The Book", language: "en" },
  { doc_id: 3, title: "Das Buch", language: "de" },
] as unknown as DocumentRecord[];

function conn(): Conn {
  return {
    baseUrl: "http://test", token: null,
    get: async (path: string) => {
      if (path.startsWith("/documents")) return { documents: DOCS };
      return {};
    },
    post: async () => ({}),
    put: async () => ({}),
  } as unknown as Conn;
}

/** Ouvre la boîte pour un document fraîchement importé, sans attendre sa fermeture. */
function ouvrirBoite(screen: ImportScreen): Promise<void> {
  const s = screen as unknown as {
    _conn: Conn | null;
    _showFamilyDialog: (id: number, titre: string, langue: string) => Promise<void>;
  };
  s._conn = conn();
  return s._showFamilyDialog(4, "Nouveau document", "fr");
}

async function laisserRendre(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  }
}

afterEach(() => { document.body.innerHTML = ""; });

describe("ImportScreen — la boîte « Rattacher à une famille ? » (SEL-01)", () => {
  it("habille le choix de parent, et le démonte à la fermeture", async () => {
    const screen = new ImportScreen();
    const attente = ouvrirBoite(screen);
    await laisserRendre();

    const sel = document.querySelector<HTMLSelectElement>("#fam-dlg-parent-sel");
    expect(sel, "la boîte doit être posée sur le document").toBeTruthy();
    const enveloppe = sel!.closest(".prep-selmenu");
    expect(enveloppe, "le choix de parent doit être habillé").toBeTruthy();
    expect(enveloppe!.classList.contains("prep-selmenu--doc")).toBe(true);
    // Le <select> reste le modèle : les trois documents du corpus, plus « — Aucun — ».
    expect(sel!.querySelectorAll("option")).toHaveLength(DOCS.length + 1);
    // Et le menu montre la même chose que le <select>.
    expect(enveloppe!.querySelectorAll(".prep-selmenu-opt")).toHaveLength(DOCS.length + 1);

    document.querySelector<HTMLButtonElement>("#fam-dlg-cancel-btn")!.click();
    await attente;
    expect(document.querySelector(".prep-selmenu-trigger"),
      "l'habillage doit partir avec la boîte").toBeNull();
  });

  it("le type de relation reste natif — deux entrées fixes", async () => {
    const screen = new ImportScreen();
    const attente = ouvrirBoite(screen);
    await laisserRendre();
    const relSel = document.querySelector<HTMLSelectElement>("#fam-dlg-relation-type");
    expect(relSel).toBeTruthy();
    expect(relSel!.closest(".prep-selmenu")).toBeNull();
    document.querySelector<HTMLButtonElement>("#fam-dlg-cancel-btn")!.click();
    await attente;
  });
});
