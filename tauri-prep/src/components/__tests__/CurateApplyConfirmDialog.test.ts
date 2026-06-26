// @vitest-environment happy-dom
/**
 * Behavioural test for the curation apply-confirm dialog (U-02).
 *
 * Exercises the real DOM modal against happy-dom (opted in above; package
 * default env is "node"): the two early-out guards, the rendered structure,
 * and each resolution path (OK / Cancel / Escape / backdrop).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { showCurateApplyConfirm } from "../CurateApplyConfirmDialog.ts";

function makeBar(): HTMLElement {
  const bar = document.createElement("div");
  bar.id = "act-curate-confirm-bar";
  bar.style.display = "none";
  document.body.appendChild(bar);
  return bar;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("showCurateApplyConfirm — guards", () => {
  it("résout false immédiatement si bar est null", async () => {
    expect(await showCurateApplyConfirm(null, "msg")).toBe(false);
  });

  it("résout false si la barre est déjà visible (display !== none)", async () => {
    const bar = makeBar();
    bar.style.display = "";
    expect(await showCurateApplyConfirm(bar, "msg")).toBe(false);
    // n'a pas écrasé le contenu existant
    expect(bar.innerHTML).toBe("");
  });
});

describe("showCurateApplyConfirm — rendu", () => {
  it("monte le modal, rend la barre visible, échappe et joint les lignes", () => {
    const bar = makeBar();
    void showCurateApplyConfirm(bar, "Ligne 1\n\n<b>Ligne 2</b>");
    expect(bar.style.display).toBe("");
    expect(bar.querySelector(".prep-curate-confirm-modal")).not.toBeNull();
    const body = bar.querySelector(".prep-curate-confirm-body")!;
    // ligne vide supprimée → 2 spans joints par <br>
    expect(body.querySelectorAll("span")).toHaveLength(2);
    expect(body.innerHTML).toContain("<br>");
    // contenu HTML échappé
    expect(body.innerHTML).toContain("&lt;b&gt;Ligne 2&lt;/b&gt;");
    expect(bar.querySelector("#act-confirm-ok")).not.toBeNull();
    expect(bar.querySelector("#act-confirm-cancel")).not.toBeNull();
  });
});

describe("showCurateApplyConfirm — résolutions", () => {
  it("OK → résout true, nettoie la barre", async () => {
    const bar = makeBar();
    const p = showCurateApplyConfirm(bar, "msg");
    bar.querySelector<HTMLButtonElement>("#act-confirm-ok")!.click();
    expect(await p).toBe(true);
    expect(bar.style.display).toBe("none");
    expect(bar.innerHTML).toBe("");
  });

  it("Annuler → résout false, nettoie la barre", async () => {
    const bar = makeBar();
    const p = showCurateApplyConfirm(bar, "msg");
    bar.querySelector<HTMLButtonElement>("#act-confirm-cancel")!.click();
    expect(await p).toBe(false);
    expect(bar.innerHTML).toBe("");
  });

  it("Escape → résout false", async () => {
    const bar = makeBar();
    const p = showCurateApplyConfirm(bar, "msg");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(await p).toBe(false);
  });

  it("clic sur le backdrop (target === bar) → résout false", async () => {
    const bar = makeBar();
    const p = showCurateApplyConfirm(bar, "msg");
    bar.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(await p).toBe(false);
  });

  it("clic sur le modal interne ne résout pas (pas le backdrop)", async () => {
    const bar = makeBar();
    let settled = false;
    const p = showCurateApplyConfirm(bar, "msg").then(v => { settled = true; return v; });
    const modal = bar.querySelector<HTMLElement>(".prep-curate-confirm-modal")!;
    modal.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    // laisse la microtask se vider
    await Promise.resolve();
    expect(settled).toBe(false);
    // puis on confirme proprement pour ne pas laisser de listener pendouiller
    bar.querySelector<HTMLButtonElement>("#act-confirm-ok")!.click();
    expect(await p).toBe(true);
  });
});
