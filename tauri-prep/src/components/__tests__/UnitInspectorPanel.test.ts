// @vitest-environment happy-dom
/**
 * Behavioural test for the inspector's inline unit-text edit (U-02 / DESIGN_inline_text_
 * correction.md D-C1). The inspector must converge on the stylo semantics: edit text_norm
 * only, keeping text_raw as the verbatim import provenance — and seed the editor from
 * text_norm, never from the (possibly <hi>-marked) text_raw.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { UnitInspectorPanel, type UnitInspectorDeps } from "../UnitInspectorPanel.ts";
import type { Conn, DocumentRecord, DocumentPreviewLine } from "../../lib/sidecarClient.ts";

function fakeConn(cfg: {
  lines: DocumentPreviewLine[];
  onUpdateText?: (body: unknown) => void;
}): Conn {
  return {
    get: async (path: string) => {
      if (path === "/conventions") return { conventions: [] };
      if (path.startsWith("/documents/preview")) {
        return { ok: true, lines: cfg.lines, total_lines: cfg.lines.length };
      }
      return {};
    },
    post: async (path: string, body: unknown) => {
      if (path === "/units/update_text") {
        cfg.onUpdateText?.(body);
        const b = body as { unit_id: number; text_norm: string };
        return { unit_id: b.unit_id, doc_id: 1, n: 1, external_id: null, text_raw: "verbatim", text_norm: b.text_norm };
      }
      return {};
    },
  } as unknown as Conn;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

let editPanel: HTMLElement;
const doc = { doc_id: 1 } as DocumentRecord;

function makeDeps(conn: Conn): UnitInspectorDeps {
  return {
    getConn: () => conn,
    getSelectedDoc: () => doc,
    getEditPanelEl: () => editPanel,
    log: () => {},
    showToast: () => {},
  };
}

beforeEach(() => {
  document.body.innerHTML = "";
  editPanel = document.createElement("div");
  editPanel.innerHTML = `<div id="meta-preview-panel"></div><div id="meta-token-editor-panel"></div>`;
  document.body.appendChild(editPanel);
});

function line(over: Partial<DocumentPreviewLine> = {}): DocumentPreviewLine {
  return { unit_id: 10, n: 1, external_id: null, text: "le chat", text_raw: "le chat", unit_role: null, ...over };
}

describe("UnitInspectorPanel — édition inline (D-C1)", () => {
  it("seede l'éditeur depuis text_norm, pas depuis text_raw (évite d'injecter le balisage <hi>)", async () => {
    const conn = fakeConn({
      // text_raw carries rich <hi> markup; text_norm is the clean normalised text.
      lines: [line({ text: "le chat", text_raw: 'le <hi rend="italic">chat</hi>' })],
    });
    const panel = new UnitInspectorPanel(makeDeps(conn));
    panel.resetForDoc(1);
    await panel.loadDocPreview(1);

    editPanel.querySelector<HTMLButtonElement>(".prep-meta-edit-btn")!.click();
    const ta = editPanel.querySelector<HTMLTextAreaElement>(".prep-meta-inline-textarea")!;
    expect(ta.value).toBe("le chat");        // from text_norm
    expect(ta.value).not.toContain("<hi");   // never the raw markup
  });

  it("enregistre text_norm seul (garde text_raw = provenance) et reflète la correction", async () => {
    let saved: unknown = null;
    const conn = fakeConn({ lines: [line()], onUpdateText: (b) => { saved = b; } });
    const panel = new UnitInspectorPanel(makeDeps(conn));
    panel.resetForDoc(1);
    await panel.loadDocPreview(1);

    editPanel.querySelector<HTMLButtonElement>(".prep-meta-edit-btn")!.click();
    const ta = editPanel.querySelector<HTMLTextAreaElement>(".prep-meta-inline-textarea")!;
    ta.value = "le chien";
    editPanel.querySelector<HTMLButtonElement>(".prep-meta-inline-save")!.click();
    await flush();

    // text_norm only — no text_raw key in the payload (D-C1).
    expect(saved).toEqual({ unit_id: 10, text_norm: "le chien" });
    expect((saved as Record<string, unknown>)).not.toHaveProperty("text_raw");
    // The preview reflects the corrected norm.
    expect(editPanel.querySelector(".prep-meta-preview-text")?.textContent).toBe("le chien");
  });
});
