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

function fakeConn(cfg: {
  units?: UnitRecord[]; tokens?: TokenRecord[]; onEnqueue?: (body: unknown) => void;
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
      if (path.startsWith("/jobs/")) return { job: { status: "queued", progress_pct: 0 } };
      return {};
    },
    post: async (path: string, body: unknown) => {
      if (path === "/jobs/enqueue") { cfg.onEnqueue?.(body); return { job: { job_id: "j1" } }; }
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
});
