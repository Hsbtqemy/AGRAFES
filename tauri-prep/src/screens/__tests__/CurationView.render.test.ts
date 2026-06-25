// @vitest-environment happy-dom
/**
 * Render-smoke for CurationView (T-05).
 *
 * Mounts the real screen against a headless DOM (happy-dom, opted in via the
 * docblock above — the package default env is "node") with NO sidecar
 * connection, so render() builds its static DOM without any network call.
 * Asserts the screen renders its key structure and tears down cleanly.
 *
 * This is a characterization safety-net: it does not exercise behaviour, only
 * that the large render path stays mountable — the de-risking groundwork for a
 * future decomposition of this 3.8k-line screen (U-02).
 */
import { describe, it, expect } from "vitest";
import { CurationView, type CurationCallbacks } from "../CurationView.ts";

function makeCallbacks(): CurationCallbacks {
  return { log: () => {}, setBusy: () => {}, isBusy: () => false };
}

function mount(): CurationView {
  // getConn -> null so no sidecar calls fire; getDocs -> [] (empty corpus).
  return new CurationView(() => null, () => [], makeCallbacks());
}

describe("CurationView render-smoke", () => {
  it("renders the main element without a connection", () => {
    const view = mount();
    const el = view.render();
    expect(el).toBeInstanceOf(HTMLElement);
    expect(el.getAttribute("role")).toBe("main");
    expect(el.getAttribute("aria-label")).toBe("Vue Curation");
    view.dispose();
  });

  it("renders the expected key panels", () => {
    const el = mount().render();
    for (const sel of [
      "#act-curation-head",
      "#act-curate-doc-list",
      "#act-curate-doc",
      "#act-meta-doc",
    ]) {
      expect(el.querySelector(sel), `missing ${sel}`).not.toBeNull();
    }
  });

  it("populateSelects on an empty corpus does not throw", () => {
    const view = mount();
    view.render();
    expect(() => view.populateSelects()).not.toThrow();
    expect(view.hasPendingChanges()).toBe(false);
    view.dispose();
  });

  it("re-rendering produces a fresh detached element", () => {
    const view = mount();
    const a = view.render();
    const b = view.render();
    expect(a).not.toBe(b);
    expect(b.querySelector("#act-curation-head")).not.toBeNull();
    view.dispose();
  });
});
