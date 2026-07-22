// @vitest-environment happy-dom
/**
 * Behavioural test for the canvas Segmentation layer's Brut view (R5.4b-3): anomaly
 * filters (short / orphan), and per-unit merge/split editing + Mode A undo. No real
 * sidecar — a fake Conn returns canned units and records the mutation calls.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { SegmentPane } from "../SegmentPane.ts";
import type { Conn, UnitRecord } from "../../lib/sidecarClient.ts";

function unit(n: number, over: Partial<UnitRecord> = {}): UnitRecord {
  return {
    unit_id: n * 10, n, text_norm: `unit ${n} text`, text_raw: `unit ${n} text`,
    unit_type: "line", unit_role: null, parent_n: null, ...over,
  };
}

interface Call { path: string; body: unknown; }

function fakeConn(cfg: {
  units?: UnitRecord[];
  elig?: unknown;
  calls?: Call[];
  relations?: unknown[];
  propagate?: unknown;
  alignedCount?: number;
  conventions?: unknown[];
}): Conn {
  const rec = cfg.calls ?? [];
  return {
    get: async (path: string) => {
      if (path.startsWith("/units")) {
        const units = cfg.units ?? [];
        return { units, count: units.length, doc_id: 1 };
      }
      if (path.startsWith("/documents/stats")) {
        return { doc_id: 1, line_count: (cfg.units ?? []).length, structure_count: 0,
          external_id_count: 0, parent_count: 0, aligned_count: cfg.alignedCount ?? 0, max_text_len: 0, avg_text_len: 0 };
      }
      if (path.startsWith("/doc_relations")) {
        return { ok: true, doc_id: 1, relations: cfg.relations ?? [], count: (cfg.relations ?? []).length };
      }
      if (path.startsWith("/conventions")) {
        return { conventions: cfg.conventions ?? [] };
      }
      return {};
    },
    post: async (path: string, body: unknown) => {
      rec.push({ path, body });
      const b = (body ?? {}) as Record<string, number>;
      if (path === "/segment/preview") {
        return { ok: true, doc_id: 1, mode: "sentences", units_input: 0, units_output: 0,
          segment_pack: "default", segments: [], warnings: [] };
      }
      if (path === "/segment/propagate_preview") {
        return cfg.propagate ?? { ok: true, doc_id: 1, reference_doc_id: 0, total_segments: 0,
          segment_pack: "default", warnings: [], sections: [] };
      }
      if (path === "/segment/apply_propagated") {
        const u = (body as { units?: unknown[] }).units ?? [];
        return { ok: true, doc_id: 1, units_written: u.length, fts_stale: true };
      }
      if (path === "/units/merge") return { ok: true, doc_id: 1, merged_n: b.n1, deleted_n: b.n2, text: "m", fts_stale: true };
      if (path === "/units/split") return { ok: true, doc_id: 1, unit_n: b.unit_n, new_unit_n: b.unit_n + 1, text_a: "a", text_b: "b", fts_stale: true };
      if (path === "/prep/undo/eligibility") return cfg.elig ?? { eligible: false, reason: "no_action" };
      if (path === "/prep/undo") {
        return { undo_action_id: 1, reverted_action_id: 1, reverted_action_type: "merge_units",
          units_restored: 2, alignments_reflagged: 0, fts_stale: true };
      }
      if (path === "/segment/coarse") return { ok: true, doc_id: 1, blocks: 2, units_grouped: 3, units_changed: 3 };
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

/** Mount a pane, point it at a doc, and switch to the Brut surface (async render). */
async function mountBrut(conn: Conn, opts: { onReseg?: () => void } = {}): Promise<SegmentPane> {
  const pane = new SegmentPane(host, () => conn, () => {}, null, opts.onReseg ?? (() => {}));
  await pane.setDocument(1, "fr");
  (host.querySelector('[data-surface="brut"]') as HTMLButtonElement).click();
  await flush();
  return pane;
}

describe("SegmentPane — Brut view (R5.4b-3)", () => {
  it("renders the current units with per-line edit actions", async () => {
    await mountBrut(fakeConn({ units: [unit(1), unit(2)] }));
    const rows = host.querySelectorAll(".prep-seg-canvas-unit");
    expect(rows.length).toBe(2);
    expect(host.querySelector('.prep-seg-canvas-unit[data-n="1"] [data-act="split"]')).not.toBeNull();
    // n=1 has no previous line → no merge-up; n=2 does.
    expect(host.querySelector('.prep-seg-canvas-unit[data-n="1"] [data-act="merge-up"]')).toBeNull();
    expect(host.querySelector('.prep-seg-canvas-unit[data-n="2"] [data-act="merge-up"]')).not.toBeNull();
  });

  it("counts short/orphan anomalies and does not flag structure units", async () => {
    await mountBrut(fakeConn({ units: [
      unit(1),                                   // normal line
      unit(2, { text_norm: "»" }),               // orphan + short
      unit(3, { text_norm: "Titre", unit_type: "structure" }), // structure → never flagged
    ] }));
    expect(host.querySelector(".prep-seg-canvas-anom-chip--short")?.textContent).toBe("1");
    expect(host.querySelector(".prep-seg-canvas-anom-chip--orphan")?.textContent).toBe("1");
    // structure unit shows a badge, not edit actions
    expect(host.querySelector('.prep-seg-canvas-unit[data-n="3"] .prep-seg-canvas-unit-struct')).not.toBeNull();
    expect(host.querySelector('.prep-seg-canvas-unit[data-n="3"] [data-act]')).toBeNull();
  });

  it("orphan filter decorates the target + neighbours", async () => {
    await mountBrut(fakeConn({ units: [unit(1), unit(2, { text_norm: "»" }), unit(3)] }));
    const cb = host.querySelector<HTMLInputElement>("#prep-seg-canvas-f-orphan")!;
    cb.checked = true;
    cb.dispatchEvent(new Event("change"));
    expect(host.querySelectorAll(".prep-seg-canvas-unit--orphan").length).toBe(1);
    expect(host.querySelector('.prep-seg-canvas-unit[data-n="2"]')?.classList.contains("prep-seg-canvas-unit--orphan")).toBe(true);
    expect(host.querySelector('.prep-seg-canvas-unit[data-n="1"]')?.classList.contains("prep-seg-canvas-unit--context")).toBe(true);
  });

  it("merge-up sends adjacent {n1,n2} and reloads via the host", async () => {
    const calls: Call[] = [];
    let reseg = 0;
    await mountBrut(fakeConn({ units: [unit(1), unit(2)], calls }), { onReseg: () => { reseg++; } });
    (host.querySelector('.prep-seg-canvas-unit[data-n="2"] [data-act="merge-up"]') as HTMLButtonElement).click();
    await flush();
    const merge = calls.find((c) => c.path === "/units/merge");
    expect(merge?.body).toMatchObject({ doc_id: 1, n1: 1, n2: 2 });
    expect(reseg).toBe(1);
  });

  it("split opens an inline editor, then confirm sends non-empty halves", async () => {
    const calls: Call[] = [];
    let reseg = 0;
    await mountBrut(fakeConn({ units: [unit(1, { text_norm: "Bonjour le monde ici." })], calls }), { onReseg: () => { reseg++; } });
    (host.querySelector('.prep-seg-canvas-unit[data-n="1"] [data-act="split"]') as HTMLButtonElement).click();
    const editor = host.querySelector('.prep-seg-canvas-unit--editing[data-n="1"]');
    expect(editor).not.toBeNull();
    const tas = editor!.querySelectorAll<HTMLTextAreaElement>(".prep-seg-canvas-split-ta");
    expect(tas.length).toBe(2);
    expect(tas[0].value.length).toBeGreaterThan(0);
    expect(tas[1].value.length).toBeGreaterThan(0);
    (editor!.querySelector('[data-act="split-confirm"]') as HTMLButtonElement).click();
    await flush();
    const split = calls.find((c) => c.path === "/units/split");
    expect(split?.body).toMatchObject({ doc_id: 1, unit_n: 1 });
    const body = split!.body as { text_a: string; text_b: string };
    expect(body.text_a.length).toBeGreaterThan(0);
    expect(body.text_b.length).toBeGreaterThan(0);
    expect(reseg).toBe(1);
  });

  it("preserves the split editor's typed halves across a filter re-render", async () => {
    await mountBrut(fakeConn({ units: [
      unit(1, { text_norm: "Bonjour le monde ici." }),
      unit(2, { text_norm: "»" }), // an orphan so the filter has something to toggle
    ] }));
    (host.querySelector('.prep-seg-canvas-unit[data-n="1"] [data-act="split"]') as HTMLButtonElement).click();
    const taA = host.querySelector<HTMLTextAreaElement>('.prep-seg-canvas-split-ta[data-half="a"]')!;
    taA.value = "moitié éditée à la main";
    taA.dispatchEvent(new Event("input"));
    // Toggle a filter → full Brut re-render; the edit must survive.
    const cb = host.querySelector<HTMLInputElement>("#prep-seg-canvas-f-orphan")!;
    cb.checked = true;
    cb.dispatchEvent(new Event("change"));
    const taA2 = host.querySelector<HTMLTextAreaElement>('.prep-seg-canvas-split-ta[data-half="a"]')!;
    expect(taA2.value).toBe("moitié éditée à la main");
  });

  it("split confirm is refused when a half is emptied", async () => {
    const calls: Call[] = [];
    const errs: string[] = [];
    const conn = fakeConn({ units: [unit(1, { text_norm: "Bonjour le monde ici." })], calls });
    const pane = new SegmentPane(host, () => conn, (m, isErr) => { if (isErr) errs.push(m); }, null, () => {});
    await pane.setDocument(1, "fr");
    (host.querySelector('[data-surface="brut"]') as HTMLButtonElement).click();
    await flush();
    (host.querySelector('[data-act="split"]') as HTMLButtonElement).click();
    const editor = host.querySelector(".prep-seg-canvas-unit--editing")!;
    editor.querySelector<HTMLTextAreaElement>('[data-half="b"]')!.value = "   ";
    (editor.querySelector('[data-act="split-confirm"]') as HTMLButtonElement).click();
    await flush();
    expect(calls.some((c) => c.path === "/units/split")).toBe(false);
    expect(errs.some((e) => /non-vides/.test(e))).toBe(true);
  });

  it("shows an enabled undo button when an action is eligible, and reverts on click", async () => {
    const calls: Call[] = [];
    let reseg = 0;
    await mountBrut(
      fakeConn({
        units: [unit(1), unit(2)], calls,
        elig: { eligible: true, action_id: 5, action_type: "merge_units", description: "Fusion u.1 + u.2", performed_at: "il y a 1 min" },
      }),
      { onReseg: () => { reseg++; } },
    );
    const undo = host.querySelector<HTMLButtonElement>("#prep-seg-canvas-undo")!;
    expect(undo.disabled).toBe(false);
    expect(undo.textContent).toContain("Annuler");
    undo.click();
    await flush();
    expect(calls.some((c) => c.path === "/prep/undo")).toBe(true);
    expect(reseg).toBe(1);
  });

  it("disables the undo button when nothing is eligible", async () => {
    await mountBrut(fakeConn({ units: [unit(1)], elig: { eligible: false, reason: "no_action" } }));
    expect(host.querySelector<HTMLButtonElement>("#prep-seg-canvas-undo")!.disabled).toBe(true);
  });
});

describe("SegmentPane — Tours surface (R5.4c)", () => {
  it("previews coarse blocks and applies a non-destructive regroup", async () => {
    const calls: Call[] = [];
    let reseg = 0;
    const conn = fakeConn({ units: [
      unit(1, { text_norm: "— Bonjour." }),
      unit(2, { text_norm: "Comment ça va ?" }),
      unit(3, { text_norm: "— Bien." }),
    ], calls });
    const pane = new SegmentPane(host, () => conn, () => {}, null, () => { reseg++; });
    await pane.setDocument(1, "fr");
    (host.querySelector('[data-surface="tours"]') as HTMLButtonElement).click();
    await flush();
    // tour boundaries at n=1 and n=3 → two coarse blocks
    expect(host.querySelectorAll("#prep-seg-canvas-tours-blocks .prep-seg-canvas-group").length).toBe(2);
    const applyBtn = host.querySelector("#prep-seg-canvas-tours-apply") as HTMLButtonElement;
    expect(applyBtn).not.toBeNull();
    applyBtn.click();
    await flush();
    const call = calls.find((c) => c.path === "/segment/coarse");
    expect(call?.body).toMatchObject({ doc_id: 1, preset: "tours" });
    expect(reseg).toBe(1);
  });

  it("a custom pattern overrides the preset and re-groups (debounced)", async () => {
    const calls: Call[] = [];
    const conn = fakeConn({ units: [
      unit(1, { text_norm: "BOB : salut" }),
      unit(2, { text_norm: "suite du propos" }),
      unit(3, { text_norm: "ANNA : bonjour" }),
    ], calls });
    const pane = new SegmentPane(host, () => conn, () => {}, null, () => {});
    await pane.setDocument(1, "fr");
    (host.querySelector('[data-surface="tours"]') as HTMLButtonElement).click();
    await flush();
    // default tours (dialogue dash) → no dashes → a single block
    expect(host.querySelectorAll("#prep-seg-canvas-tours-blocks .prep-seg-canvas-group").length).toBe(1);
    const inp = host.querySelector<HTMLInputElement>("#prep-seg-canvas-tours-pat")!;
    inp.value = "^[A-Z]+ :";
    inp.dispatchEvent(new Event("input"));
    await new Promise((r) => setTimeout(r, 220)); // past the 180 ms debounce
    expect(host.querySelectorAll("#prep-seg-canvas-tours-blocks .prep-seg-canvas-group").length).toBe(2);
    (host.querySelector("#prep-seg-canvas-tours-apply") as HTMLButtonElement).click();
    await flush();
    expect(calls.find((c) => c.path === "/segment/coarse")?.body).toMatchObject({ doc_id: 1, pattern: "^[A-Z]+ :" });
  });

  it("sends the pattern raw (untrimmed) so apply matches the preview", async () => {
    const calls: Call[] = [];
    const conn = fakeConn({ units: [unit(1, { text_norm: "— A" }), unit(2, { text_norm: "— B" })], calls });
    const pane = new SegmentPane(host, () => conn, () => {}, null, () => {});
    await pane.setDocument(1, "fr");
    (host.querySelector('[data-surface="tours"]') as HTMLButtonElement).click();
    await flush();
    const inp = host.querySelector<HTMLInputElement>("#prep-seg-canvas-tours-pat")!;
    inp.value = "^— "; // the trailing space is significant and must not be trimmed away
    inp.dispatchEvent(new Event("input"));
    await new Promise((r) => setTimeout(r, 220));
    (host.querySelector("#prep-seg-canvas-tours-apply") as HTMLButtonElement).click();
    await flush();
    expect(calls.find((c) => c.path === "/segment/coarse")?.body).toMatchObject({ pattern: "^— " });
  });
});

describe("SegmentPane — Propager la segmentation (tranche 4)", () => {
  const withSource = [
    { id: 1, doc_id: 1, relation_type: "translation_of", target_doc_id: 7, note: null, created_at: "" },
  ];
  const preview = {
    ok: true, doc_id: 1, reference_doc_id: 7, total_segments: 3, segment_pack: "default", warnings: [],
    sections: [
      { status: "pre", header_text: null, header_role: null, ref_count: 1, raw_count: 1,
        result_count: 1, adjusted: false, delta: 0, segments: [{ n: 1, text: "Intro." }] },
      { status: "matched", header_text: "Chapitre 1", header_role: "chapitre", ref_count: 2, raw_count: 2,
        result_count: 2, adjusted: false, delta: 0, segments: [{ n: 1, text: "Une." }, { n: 2, text: "Deux." }] },
    ],
  };

  it("hides the propagate action when the doc has no declared source", async () => {
    const pane = new SegmentPane(host, () => fakeConn({ units: [unit(1)] }), () => {}, null, () => {});
    await pane.setDocument(1, "fr");
    await flush();
    expect(host.querySelector<HTMLButtonElement>("#prep-seg-canvas-propagate")!.hidden).toBe(true);
  });

  it("shows the action for a translation, previews, and applies the flattened units", async () => {
    const calls: Call[] = [];
    const conn = fakeConn({ units: [unit(1)], relations: withSource, propagate: preview, calls });
    const pane = new SegmentPane(host, () => conn, () => {}, null, () => {});
    await pane.setDocument(1, "fr");
    await flush();

    const btn = host.querySelector<HTMLButtonElement>("#prep-seg-canvas-propagate")!;
    expect(btn.hidden).toBe(false);

    btn.click();
    await flush();
    // reference derived from the translation_of relation (target_doc_id = 7), positional (no mapping)
    expect(calls.find((c) => c.path === "/segment/propagate_preview")?.body).toMatchObject({ doc_id: 1, reference_doc_id: 7 });
    // read-only preview: one head per section + an apply button in the sheet
    expect(host.querySelectorAll(".prep-seg-canvas-prop-head").length).toBe(2);
    expect(host.querySelector("#prep-seg-canvas-prop-apply")).not.toBeNull();

    (host.querySelector("#prep-seg-canvas-prop-apply") as HTMLButtonElement).click();
    await flush();
    const applyCall = calls.find((c) => c.path === "/segment/apply_propagated");
    expect(applyCall).toBeDefined();
    const units = (applyCall!.body as { units: Array<{ type: string; text: string; role?: string }> }).units;
    // pre (1 line, no header) + matched (structure header + 2 lines) → line, structure, line, line
    expect(units.map((u) => u.type)).toEqual(["line", "structure", "line", "line"]);
    expect(units[0]).toMatchObject({ type: "line", text: "Intro." });
    expect(units[1]).toMatchObject({ type: "structure", text: "Chapitre 1", role: "chapitre" });
  });

  it("leaves propagate mode when a surface is selected", async () => {
    const conn = fakeConn({ units: [unit(1)], relations: withSource, propagate: preview });
    const pane = new SegmentPane(host, () => conn, () => {}, null, () => {});
    await pane.setDocument(1, "fr");
    await flush();
    (host.querySelector("#prep-seg-canvas-propagate") as HTMLButtonElement).click();
    await flush();
    expect(host.querySelector("#prep-seg-canvas-prop-apply")).not.toBeNull();
    (host.querySelector('[data-surface="brut"]') as HTMLButtonElement).click();
    await flush();
    expect(host.querySelector("#prep-seg-canvas-prop-apply")).toBeNull();
    expect(host.querySelector("#prep-seg-canvas-propagate")!.classList.contains("active")).toBe(false);
  });

  it("paints the intertitre role badge on the preview header (roles are preserved)", async () => {
    const conventions = [
      { name: "chapitre", label: "Chapitre", color: "#8b5cf6", icon: "§", sort_order: 0, category: "structure" },
    ];
    const conn = fakeConn({ units: [unit(1)], relations: withSource, propagate: preview, conventions });
    const pane = new SegmentPane(host, () => conn, () => {}, null, () => {});
    await pane.setDocument(1, "fr");
    await flush();
    (host.querySelector("#prep-seg-canvas-propagate") as HTMLButtonElement).click();
    await flush();
    const heads = host.querySelectorAll(".prep-seg-canvas-prop-head");
    // pre-section (header_role null) → no badge; matched section (chapitre) → badge with the catalogue label
    expect(heads[0].querySelector(".prep-seg-canvas-prop-role")).toBeNull();
    const badge = heads[1].querySelector(".prep-seg-canvas-prop-role");
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain("Chapitre");
  });

  it("preserves a structural-role line boundary as a line (no line→structure conversion)", async () => {
    const calls: Call[] = [];
    const previewRoleLine = {
      ok: true, doc_id: 1, reference_doc_id: 7, total_segments: 1, segment_pack: "default", warnings: [],
      sections: [
        { status: "matched", header_text: "Chapitre 2", header_role: "intertitre", header_unit_type: "line",
          ref_count: 1, raw_count: 1, result_count: 1, adjusted: false, delta: 0, segments: [{ n: 1, text: "Une." }] },
      ],
    };
    const conn = fakeConn({ units: [unit(1)], relations: withSource, propagate: previewRoleLine, calls });
    const pane = new SegmentPane(host, () => conn, () => {}, null, () => {});
    await pane.setDocument(1, "fr");
    await flush();
    (host.querySelector("#prep-seg-canvas-propagate") as HTMLButtonElement).click();
    await flush();
    (host.querySelector("#prep-seg-canvas-prop-apply") as HTMLButtonElement).click();
    await flush();
    const units = (calls.find((c) => c.path === "/segment/apply_propagated")!.body as
      { units: Array<{ type: string; text: string; role?: string }> }).units;
    // the intertitre-role boundary stays a LINE + role — not converted to structure
    expect(units[0]).toMatchObject({ type: "line", text: "Chapitre 2", role: "intertitre" });
    expect(units[1]).toMatchObject({ type: "line", text: "Une." });
  });

  it("surfaces the engine's line-role-loss warning in the preview", async () => {
    const withWarn = { ...preview, warnings: ["2 ligne(s) portent un rôle de convention qui sera perdu à la propagation."] };
    const conn = fakeConn({ units: [unit(1)], relations: withSource, propagate: withWarn });
    const pane = new SegmentPane(host, () => conn, () => {}, null, () => {});
    await pane.setDocument(1, "fr");
    await flush();
    (host.querySelector("#prep-seg-canvas-propagate") as HTMLButtonElement).click();
    await flush();
    expect(host.querySelector(".prep-seg-canvas-warn")?.textContent).toContain("rôle");
  });
});

describe("SegmentPane — Brut rendering parity (tranche 3)", () => {
  const conventions = [
    { name: "intertitre", label: "Intertitre", color: "#9333ea", icon: "§", sort_order: 0, category: "structure" },
  ];

  it("paints the role badge on a Brut unit that carries a role", async () => {
    await mountBrut(fakeConn({ units: [unit(1, { unit_role: "intertitre" }), unit(2)], conventions }));
    const badge = host.querySelector('.prep-seg-canvas-unit[data-n="1"] .prep-conv-unit-badge');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain("Intertitre");
    // a unit with no role → no badge
    expect(host.querySelector('.prep-seg-canvas-unit[data-n="2"] .prep-conv-unit-badge')).toBeNull();
  });

  it("shows the « voir l'original d'import » fold only when text_source diverges", async () => {
    await mountBrut(fakeConn({ units: [
      unit(1, { text_raw: "fusionné", text_source: "part une. part deux." }), // rewritten → fold
      unit(2, { text_raw: "intact", text_source: null }),                       // pristine → no fold
    ] }));
    expect(host.querySelector('.prep-seg-canvas-unit[data-n="1"] .prep-seg-canvas-source')).not.toBeNull();
    expect(host.querySelector('.prep-seg-canvas-unit[data-n="2"] .prep-seg-canvas-source')).toBeNull();
  });
});
