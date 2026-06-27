import { describe, it, expect } from "vitest";
import { buildContextDetailHtml } from "../curationContextDetail.ts";
import type { CuratePreviewExample } from "../sidecarClient.ts";

const ex = (over: Partial<CuratePreviewExample> = {}): CuratePreviewExample =>
  ({
    unit_id: 1, unit_index: 0, before: "avant", after: "apres",
    context_before: "", context_after: "", manual_after: null,
    is_manual_override: false, is_exception_ignored: false,
    is_exception_override: false, exception_override: null,
    preview_reason: "standard",
    ...over,
  } as CuratePreviewExample);

describe("buildContextDetailHtml", () => {
  it("display mode shows the modification (arrow + edit button), not the textarea", () => {
    const html = buildContextDetailHtml(ex(), false);
    expect(html).toContain("&#8594;"); // → arrow
    expect(html).toContain('id="act-override-edit"');
    expect(html).toContain(">Modifié<");
    expect(html).not.toContain("act-manual-override-input");
  });

  it("edit mode shows the override textarea and save/cancel, not the edit button", () => {
    const html = buildContextDetailHtml(ex(), true);
    expect(html).toContain('id="act-manual-override-input"');
    expect(html).toContain('id="act-override-save"');
    expect(html).toContain('id="act-override-cancel"');
    expect(html).toContain(">Original<");
    expect(html).not.toContain('id="act-override-edit"');
  });

  it("labels the current row per forced reason", () => {
    expect(buildContextDetailHtml(ex({ preview_reason: "forced_no_change" }), false)).toContain(">Inchangé<");
    expect(buildContextDetailHtml(ex({ preview_reason: "forced_ignored" }), false)).toContain(">Neutralisé<");
  });

  it("emits the forced-open note only for non-standard reasons", () => {
    expect(buildContextDetailHtml(ex({ preview_reason: "forced" }), false)).toContain("Ouverture ciblée depuis le panneau Exceptions");
    expect(buildContextDetailHtml(ex({ preview_reason: "standard" }), false)).not.toContain("prep-ctx-forced-note");
  });

  it("shows the manual-override badge + revert button when overridden (display)", () => {
    const html = buildContextDetailHtml(ex({ is_manual_override: true }), false);
    expect(html).toContain("prep-ctx-override-badge");
    expect(html).toContain('id="act-override-revert"');
  });

  it("shows the persisted-exception badge + delete button (not ignore/override) when an exception exists", () => {
    const html = buildContextDetailHtml(ex({ is_exception_ignored: true }), false);
    expect(html).toContain("prep-ctx-exception-badge");
    expect(html).toContain('id="act-exc-delete"');
    expect(html).not.toContain('id="act-exc-ignore"');
  });

  it("renders the Avant/Après context rows only when context text is present", () => {
    const withCtx = buildContextDetailHtml(ex({ context_before: "ctxB", context_after: "ctxA" }), false);
    expect(withCtx).toContain("ctx-before");
    expect(withCtx).toContain("ctx-after");
    const without = buildContextDetailHtml(ex(), false);
    expect(without).not.toContain("ctx-before");
    expect(without).not.toContain("ctx-after");
  });

  it("escapes HTML in the before text", () => {
    expect(buildContextDetailHtml(ex({ before: "<b>" }), false)).toContain("&lt;b&gt;");
  });
});
