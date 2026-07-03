// @vitest-environment happy-dom
/**
 * Behavioural test for ModelManager (R5.2c-3): the language selector, per-source
 * actions (bundled → "Intégré" no button; downloaded → Supprimer; absent → Télécharger),
 * and the "Actif" radio that POSTs /models/active for the language.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { ModelManager } from "../ModelManager.ts";
import type { Conn } from "../../lib/sidecarClient.ts";
import type { ModelInfo, ModelSource } from "../../lib/models.ts";

function model(name: string, source: ModelSource, over: Partial<ModelInfo> = {}): ModelInfo {
  return {
    name, language: "fr", genre: "core", size_class: "md", approx_size_mb: 45,
    installed: source === "downloaded", source, active: false,
    version: source === "downloaded" ? "3.8.0" : null, ...over,
  };
}

function fakeConn(models: ModelInfo[], onActive?: (body: unknown) => void): Conn {
  return {
    get: async (path: string) => (path.startsWith("/models") ? { models } : {}),
    post: async (path: string, body: unknown) => {
      if (path === "/models/active") { onActive?.(body); return body; }
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

function mount(models: ModelInfo[], onActive?: (body: unknown) => void): ModelManager {
  const mgr = new ModelManager();
  host.appendChild(mgr.render());
  mgr.setConn(fakeConn(models, onActive));
  return mgr;
}

function rowFor(name: string): HTMLElement {
  return host.querySelector<HTMLElement>(`.prep-models-row[data-model="${name}"]`)!;
}

describe("ModelManager", () => {
  it("bundled → 'Intégré', a radio, and NO download/remove button", async () => {
    mount([model("fr_core_news_md", "bundled")]);
    await flush();
    const row = rowFor("fr_core_news_md");
    expect(row.querySelector(".prep-models-status")?.textContent).toBe("Intégré");
    expect(row.querySelector('input[type="radio"]')).not.toBeNull(); // available → activable
    expect(row.querySelector("button")).toBeNull();
  });

  it("downloaded → 'Supprimer'; absent → 'Télécharger' + no radio", async () => {
    mount([model("fr_core_news_lg", "downloaded"), model("fr_core_news_sm", "absent")]);
    await flush();
    expect(rowFor("fr_core_news_lg").querySelector("button")?.textContent).toBe("Supprimer");
    const absent = rowFor("fr_core_news_sm");
    expect(absent.querySelector("button")?.textContent).toContain("Télécharger");
    expect(absent.querySelector('input[type="radio"]')).toBeNull(); // absent → not activable
  });

  it("checks the radio of the active model", async () => {
    mount([
      model("fr_core_news_md", "bundled"),
      model("fr_core_news_lg", "downloaded", { active: true }),
    ]);
    await flush();
    const lg = rowFor("fr_core_news_lg").querySelector<HTMLInputElement>('input[type="radio"]')!;
    const md = rowFor("fr_core_news_md").querySelector<HTMLInputElement>('input[type="radio"]')!;
    expect(lg.checked).toBe(true);
    expect(md.checked).toBe(false);
  });

  it("clicking a radio POSTs /models/active with {language, model}", async () => {
    let body: unknown = null;
    mount([model("fr_core_news_lg", "downloaded")], (b) => { body = b; });
    await flush();
    const radio = rowFor("fr_core_news_lg").querySelector<HTMLInputElement>('input[type="radio"]')!;
    radio.checked = true;
    radio.dispatchEvent(new Event("change"));
    await flush();
    expect(body).toEqual({ language: "fr", model: "fr_core_news_lg" });
  });

  it("groups by language: the selector switches the visible rows", async () => {
    mount([
      model("fr_core_news_md", "bundled", { language: "fr" }),
      model("en_core_web_md", "bundled", { language: "en" }),
    ]);
    await flush();
    const select = host.querySelector<HTMLSelectElement>(".prep-models-lang")!;
    expect(select.options.length).toBe(2);
    // First language alphabetically by label ("English" < "Français") is shown first.
    const first = select.value;
    const other = first === "fr" ? "en" : "fr";
    const otherName = other === "fr" ? "fr_core_news_md" : "en_core_web_md";
    expect(host.querySelector(`.prep-models-row[data-model="${otherName}"]`)).toBeNull();
    select.value = other;
    select.dispatchEvent(new Event("change"));
    expect(host.querySelector(`.prep-models-row[data-model="${otherName}"]`)).not.toBeNull();
  });
});
