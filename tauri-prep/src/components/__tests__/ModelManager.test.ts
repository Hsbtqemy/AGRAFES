// @vitest-environment happy-dom
/**
 * Behavioural test for the ModelManager rows (Lot 1 of the dual-dist/selection design):
 * an embedded ("bundled") model must render as "Intégré" with NO download/remove action —
 * the felt bug was that embedded models showed "Absent" + "Télécharger" even though
 * annotation already worked. Downloaded → "Supprimer"; absent → "Télécharger".
 */
import { describe, it, expect, beforeEach } from "vitest";
import { ModelManager } from "../ModelManager.ts";
import type { Conn } from "../../lib/sidecarClient.ts";
import type { ModelInfo, ModelSource } from "../../lib/models.ts";

function model(name: string, source: ModelSource, over: Partial<ModelInfo> = {}): ModelInfo {
  return {
    name,
    language: "fr",
    approx_size_mb: 40,
    installed: source === "downloaded",
    source,
    version: source === "downloaded" ? "3.8.0" : null,
    ...over,
  };
}

function fakeConn(models: ModelInfo[]): Conn {
  return {
    get: async (path: string) => {
      if (path === "/models") return { models };
      return {};
    },
    post: async () => ({}),
  } as unknown as Conn;
}

const flush = () => new Promise((r) => setTimeout(r, 5));

let host: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
});

function rowFor(name: string): HTMLElement {
  return host.querySelector<HTMLElement>(`.prep-models-row[data-model="${name}"]`)!;
}

describe("ModelManager rows by source", () => {
  it("bundled → 'Intégré', a note, and NO action button", async () => {
    const mgr = new ModelManager();
    host.appendChild(mgr.render());
    mgr.setConn(fakeConn([model("fr_core_news_md", "bundled")]));
    await flush();

    const row = rowFor("fr_core_news_md");
    expect(row.querySelector(".prep-models-status")?.textContent).toBe("Intégré");
    expect(row.querySelector(".prep-models-note")).not.toBeNull();
    expect(row.querySelector("button")).toBeNull(); // read-only, no download/remove
  });

  it("downloaded → 'Supprimer' action", async () => {
    const mgr = new ModelManager();
    host.appendChild(mgr.render());
    mgr.setConn(fakeConn([model("en_core_web_md", "downloaded")]));
    await flush();

    const btn = rowFor("en_core_web_md").querySelector("button");
    expect(btn?.textContent).toBe("Supprimer");
  });

  it("absent → '↓ Télécharger' action", async () => {
    const mgr = new ModelManager();
    host.appendChild(mgr.render());
    mgr.setConn(fakeConn([model("de_core_news_md", "absent")]));
    await flush();

    const btn = rowFor("de_core_news_md").querySelector("button");
    expect(btn?.textContent).toContain("Télécharger");
  });
});
