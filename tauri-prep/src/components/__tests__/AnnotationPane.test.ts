// @vitest-environment happy-dom
/**
 * Behavioural test for the Annotation mode of the canvas (R5.2b): the read-only
 * grammatical overlay. An annotated unit's text is repainted as UPOS-coloured prose
 * (shared ui/annotationProse); an unannotated document shows guidance instead. No
 * real sidecar — a fake Conn returns canned conventions / units / tokens payloads.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { AnnotationPane } from "../AnnotationPane.ts";
import type { Conn, TokenRecord, UnitRecord } from "../../lib/sidecarClient.ts";
import type { ModelInfo, ModelSource } from "../../lib/models.ts";

function unit(n: number, over: Partial<UnitRecord> = {}): UnitRecord {
  return {
    unit_id: n * 10, n, text_norm: `u${n}`, text_raw: `u${n}`,
    unit_type: "line", unit_role: null, parent_n: null, ...over,
  };
}

function token(unitId: number, unitN: number, position: number, word: string, upos: string | null): TokenRecord {
  return {
    token_id: unitId * 100 + position, doc_id: 1, unit_id: unitId, unit_n: unitN,
    external_id: null, sent_id: 1, position, word, lemma: word, upos,
    xpos: null, feats: null, misc: null,
  };
}

function modelInfo(name: string, language: string, source: ModelSource, over: Partial<ModelInfo> = {}): ModelInfo {
  return {
    name, language, genre: "core", size_class: name.split("_").pop() ?? "md",
    approx_size_mb: 45, installed: source === "downloaded", source, active: false, version: null, ...over,
  };
}

function fakeConn(cfg: {
  units?: UnitRecord[]; tokens?: TokenRecord[]; models?: ModelInfo[];
  onEnqueue?: (body: unknown) => void; onDownload?: (body: unknown) => void;
  onUpdate?: (body: unknown) => void;
}): Conn {
  return {
    get: async (path: string) => {
      if (path === "/conventions") return { conventions: [] };
      if (path.startsWith("/units")) {
        const units = cfg.units ?? [];
        return { units, count: units.length, doc_id: 1 };
      }
      if (path.startsWith("/tokens")) {
        const tokens = cfg.tokens ?? [];
        return {
          ok: true, doc_id: 1, tokens, count: tokens.length, total: tokens.length,
          limit: 500, offset: 0, next_offset: null, has_more: false,
        };
      }
      if (path.startsWith("/models")) return { models: cfg.models ?? [] };
      if (path.startsWith("/jobs/")) return { job: { status: "queued", progress_pct: 0 } };
      return {};
    },
    post: async (path: string, body: unknown) => {
      if (path === "/jobs/enqueue") { cfg.onEnqueue?.(body); return { job: { job_id: "j1" } }; }
      if (path === "/models/download") { cfg.onDownload?.(body); return { job: { job_id: "m1" } }; }
      if (path === "/tokens/update") { cfg.onUpdate?.(body); return { updated: 1, token: {} }; }
      return {};
    },
  } as unknown as Conn;
}

const flush = () => new Promise((r) => setTimeout(r, 5));

let host: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
});

function row(n: number): HTMLElement {
  return host.querySelector<HTMLElement>(`.prep-conv-unit-row[data-uid="${n * 10}"]`)!;
}

describe("AnnotationPane", () => {
  it("mounts a dock with a summary + search", () => {
    const pane = new AnnotationPane(host, () => null, () => {});
    pane.mount();
    expect(host.querySelector(".prep-annot-dock")).not.toBeNull();
    expect(host.querySelector("#prep-annot-summary")).not.toBeNull();
    expect(host.querySelector("#prep-annot-search")).not.toBeNull();
  });

  it("repaints an annotated unit as coloured prose, leaves an unannotated one plain", async () => {
    const conn = fakeConn({
      units: [unit(1), unit(2)],
      // Only unit 1 (unit_id 10) has tokens.
      tokens: [token(10, 1, 1, "le", "DET"), token(10, 1, 2, "chat", "NOUN")],
    });
    const pane = new AnnotationPane(host, () => conn, () => {});
    await pane.setDocument(1, null);

    const annotated = row(1);
    expect(annotated.classList.contains("prep-annot-unit-row--annotated")).toBe(true);
    const spans = annotated.querySelectorAll(".annot-prose-token");
    expect(spans.length).toBe(2);
    expect(annotated.querySelector(".annot-prose-token--colored")).not.toBeNull(); // NOUN is coloured
    expect(annotated.querySelector<HTMLElement>(".prep-conv-unit-text")?.textContent).toBe("le chat");

    const plain = row(2);
    expect(plain.classList.contains("prep-annot-unit-row--annotated")).toBe(false);
    expect(plain.querySelectorAll(".annot-prose-token").length).toBe(0);
    expect(plain.querySelector<HTMLElement>(".prep-conv-unit-text")?.textContent).toBe("u2");
  });

  it("counts annotated units in the summary", async () => {
    const conn = fakeConn({
      units: [unit(1), unit(2)],
      tokens: [token(10, 1, 1, "mot", "NOUN")],
    });
    const pane = new AnnotationPane(host, () => conn, () => {});
    await pane.setDocument(1, null);
    expect(host.querySelector("#prep-annot-summary")?.textContent).toContain("1 unité annotée");
  });

  it("guides the user when the document has no annotation", async () => {
    const conn = fakeConn({ units: [unit(1), unit(2)], tokens: [] });
    const pane = new AnnotationPane(host, () => conn, () => {});
    await pane.setDocument(1, null);
    const summary = host.querySelector("#prep-annot-summary");
    expect(summary?.textContent).toContain("Document non annoté");
    expect(summary?.classList.contains("prep-annot-summary--empty")).toBe(true);
    expect(host.querySelectorAll(".prep-annot-unit-row--annotated").length).toBe(0);
  });

  it("clears the overlay when the document changes", async () => {
    // Tokens exist only for doc 1; switching to doc 2 must drop the overlay.
    const conn = {
      get: async (path: string) => {
        if (path === "/conventions") return { conventions: [] };
        if (path.startsWith("/units")) return { units: [unit(1)], count: 1, doc_id: 1 };
        if (path.startsWith("/tokens")) {
          const docId = new URLSearchParams(path.split("?")[1]).get("doc_id");
          const tokens = docId === "1" ? [token(10, 1, 1, "x", "NOUN")] : [];
          return {
            ok: true, doc_id: Number(docId), tokens, count: tokens.length, total: tokens.length,
            limit: 500, offset: 0, next_offset: null, has_more: false,
          };
        }
        return {};
      },
      post: async () => ({}),
    } as unknown as Conn;
    const pane = new AnnotationPane(host, () => conn, () => {});
    await pane.setDocument(1, null);
    expect(host.querySelectorAll(".prep-annot-unit-row--annotated").length).toBe(1);

    await pane.setDocument(2, null);
    expect(host.querySelectorAll(".prep-annot-unit-row--annotated").length).toBe(0);
  });

  it("launches annotation from the dock: click enqueues an annotate job (R5.2c-4b)", async () => {
    let enqueued: unknown = null;
    const pane = new AnnotationPane(
      host,
      () => fakeConn({ units: [unit(1)], tokens: [], onEnqueue: (b) => { enqueued = b; } }),
      () => {},
    );
    await pane.setDocument(1, null);
    const btn = host.querySelector<HTMLButtonElement>("#prep-annot-run-btn")!;
    expect(btn).not.toBeNull();
    expect(btn.disabled).toBe(false); // a document is selected
    btn.click();
    await flush();
    expect(enqueued).toEqual({ kind: "annotate", params: { doc_id: 1 } });
    expect(btn.disabled).toBe(true); // running
    pane.dispose(); // stop the poll timer
  });

  it("disables the Annoter button when no document is selected", async () => {
    const pane = new AnnotationPane(host, () => fakeConn({ units: [] }), () => {});
    await pane.setDocument(null, null);
    const btn = host.querySelector<HTMLButtonElement>("#prep-annot-run-btn")!;
    expect(btn.disabled).toBe(true);
  });

  it("model band shows the available model for the language (R5.2c-4c)", async () => {
    const pane = new AnnotationPane(host, () => fakeConn({
      units: [unit(1)], tokens: [],
      models: [modelInfo("fr_core_news_md", "fr", "downloaded"), modelInfo("fr_core_news_lg", "fr", "absent")],
    }), () => {});
    await pane.setDocument(1, null, "fr");
    const band = host.querySelector<HTMLElement>("#prep-annot-model-band")!;
    expect(band.style.display).not.toBe("none");
    expect(band.textContent).toContain("fr_core_news_md");
    expect(band.querySelector("button")).toBeNull(); // available → no download; no manage link wired
  });

  it("model band marks the active model", async () => {
    const pane = new AnnotationPane(host, () => fakeConn({
      units: [unit(1)], tokens: [],
      models: [
        modelInfo("fr_core_news_md", "fr", "bundled"),
        modelInfo("fr_core_news_lg", "fr", "downloaded", { active: true }),
      ],
    }), () => {});
    await pane.setDocument(1, null, "fr");
    const band = host.querySelector<HTMLElement>("#prep-annot-model-band")!;
    expect(band.textContent).toContain("fr_core_news_lg");
    expect(band.textContent).toContain("(actif)");
  });

  it("model band offers a download when nothing is available, recommending md (R5.2c-4c)", async () => {
    let dl: unknown = null;
    const pane = new AnnotationPane(host, () => fakeConn({
      units: [unit(1)], tokens: [],
      models: [modelInfo("fr_core_news_md", "fr", "absent"), modelInfo("fr_core_news_sm", "fr", "absent")],
      onDownload: (b) => { dl = b; },
    }), () => {});
    await pane.setDocument(1, null, "fr");
    const band = host.querySelector<HTMLElement>("#prep-annot-model-band")!;
    expect(band.textContent).toContain("Aucun modèle");
    const btn = band.querySelector<HTMLButtonElement>("button")!;
    expect(btn.textContent).toContain("Télécharger");
    btn.click();
    await flush();
    expect(dl).toEqual({ model: "fr_core_news_md" }); // recommends the md, not the sm
    pane.dispose();
  });

  it("clicking a token opens the editor populated with its fields (R5.2d)", async () => {
    const pane = new AnnotationPane(host, () => fakeConn({
      units: [unit(1)], tokens: [token(10, 1, 1, "chat", "NOUN")],
    }), () => {});
    await pane.setDocument(1, null);
    const editor = host.querySelector<HTMLElement>("#prep-annot-token-editor")!;
    expect(editor.style.display).toBe("none"); // closed initially
    host.querySelector<HTMLElement>(".annot-prose-token")!.click();
    expect(editor.style.display).not.toBe("none");
    expect(editor.textContent).toContain("chat");
    expect(editor.querySelector<HTMLInputElement>('[data-field="word"]')!.value).toBe("chat");
    expect(editor.querySelector<HTMLSelectElement>('[data-field="upos"]')!.value).toBe("NOUN");
  });

  it("saving the editor posts /tokens/update and repaints the token (R5.2d)", async () => {
    let updated: unknown = null;
    const pane = new AnnotationPane(host, () => fakeConn({
      units: [unit(1)], tokens: [token(10, 1, 1, "chat", "NOUN")],
      onUpdate: (b) => { updated = b; },
    }), () => {});
    await pane.setDocument(1, null);
    host.querySelector<HTMLElement>(".annot-prose-token")!.click();
    const editor = host.querySelector<HTMLElement>("#prep-annot-token-editor")!;
    editor.querySelector<HTMLInputElement>('[data-field="lemma"]')!.value = "chien";
    editor.querySelector<HTMLSelectElement>('[data-field="upos"]')!.value = "PROPN";
    editor.querySelector<HTMLButtonElement>(".prep-annot-editor-save")!.click();
    await flush();
    expect(updated).toMatchObject({ token_id: 1001, lemma: "chien", upos: "PROPN", word: "chat" });
    expect(editor.querySelector(".prep-annot-editor-status")?.textContent).toBe("OK");
    // Repaint: the fresh span's title reflects the new lemma.
    expect(host.querySelector<HTMLElement>(".annot-prose-token")!.title).toContain("chien");
  });

  it("closing the editor hides it (R5.2d)", async () => {
    const pane = new AnnotationPane(host, () => fakeConn({
      units: [unit(1)], tokens: [token(10, 1, 1, "x", "NOUN")],
    }), () => {});
    await pane.setDocument(1, null);
    host.querySelector<HTMLElement>(".annot-prose-token")!.click();
    const editor = host.querySelector<HTMLElement>("#prep-annot-token-editor")!;
    expect(editor.style.display).not.toBe("none");
    editor.querySelector<HTMLButtonElement>(".prep-annot-editor-close")!.click();
    expect(editor.style.display).toBe("none");
  });

  it("Étendu toggle repaints the annotated unit as an interlinear grid (R5.2e)", async () => {
    const pane = new AnnotationPane(host, () => fakeConn({
      units: [unit(1)],
      tokens: [token(10, 1, 1, "Le", "DET"), token(10, 1, 2, "chat", "NOUN")],
    }), () => {});
    await pane.setDocument(1, null);
    // Prose by default: no grid.
    expect(row(1).querySelector(".annot-sent")).toBeNull();
    expect(row(1).querySelectorAll(".annot-prose-token").length).toBe(2);

    const extBtn = host.querySelector<HTMLButtonElement>('.prep-annot-viewmode-btn[data-mode="extended"]')!;
    extBtn.click();
    const annotated = row(1);
    expect(extBtn.classList.contains("active")).toBe(true);
    expect(annotated.classList.contains("prep-annot-unit-row--extended")).toBe(true);
    const cells = annotated.querySelectorAll<HTMLElement>(".annot-sent .annot-token");
    expect(cells.length).toBe(2);
    expect(cells[1].querySelector(".annot-upos")!.textContent).toBe("NOUN");
    expect(annotated.querySelectorAll(".annot-prose-token").length).toBe(0); // prose gone
  });

  it("toggling back from Étendu restores the coloured prose (R5.2e)", async () => {
    const pane = new AnnotationPane(host, () => fakeConn({
      units: [unit(1)], tokens: [token(10, 1, 1, "x", "NOUN")],
    }), () => {});
    await pane.setDocument(1, null);
    host.querySelector<HTMLButtonElement>('.prep-annot-viewmode-btn[data-mode="extended"]')!.click();
    expect(row(1).querySelector(".annot-sent")).not.toBeNull();
    host.querySelector<HTMLButtonElement>('.prep-annot-viewmode-btn[data-mode="prose"]')!.click();
    expect(row(1).querySelector(".annot-sent")).toBeNull();
    expect(row(1).classList.contains("prep-annot-unit-row--extended")).toBe(false);
    expect(row(1).querySelectorAll(".annot-prose-token").length).toBe(1);
  });

  it("opens the token editor from an interlinear cell in Étendu mode (R5.2e)", async () => {
    const pane = new AnnotationPane(host, () => fakeConn({
      units: [unit(1)], tokens: [token(10, 1, 1, "chat", "NOUN")],
    }), () => {});
    await pane.setDocument(1, null);
    host.querySelector<HTMLButtonElement>('.prep-annot-viewmode-btn[data-mode="extended"]')!.click();
    const editor = host.querySelector<HTMLElement>("#prep-annot-token-editor")!;
    expect(editor.style.display).toBe("none");
    host.querySelector<HTMLElement>(".annot-sent .annot-token")!.click();
    expect(editor.style.display).not.toBe("none");
    expect(editor.querySelector<HTMLSelectElement>('[data-field="upos"]')!.value).toBe("NOUN");
  });

  it("re-parents the token editor into the shared dock; deactivate() retracts it (R5.3-1)", async () => {
    const dock = document.createElement("div");
    document.body.appendChild(dock);
    const pane = new AnnotationPane(host, () => fakeConn({
      units: [unit(1)], tokens: [token(10, 1, 1, "chat", "NOUN")],
    }), () => {}, undefined, dock);
    await pane.setDocument(1, null);
    // The editor lives in the dock, not the pane host.
    expect(host.querySelector("#prep-annot-token-editor")).toBeNull();
    const editor = dock.querySelector<HTMLElement>("#prep-annot-token-editor")!;
    expect(editor).not.toBeNull();
    expect(editor.style.display).toBe("none");
    // Clicking a token (in the pane list) opens the editor (in the dock).
    host.querySelector<HTMLElement>(".annot-prose-token")!.click();
    expect(editor.style.display).not.toBe("none");
    expect(editor.querySelector<HTMLSelectElement>('[data-field="upos"]')!.value).toBe("NOUN");
    // Switching layer retracts the dock contribution.
    pane.deactivate();
    expect(editor.style.display).toBe("none");
    expect(editor.childElementCount).toBe(0);
  });
});
