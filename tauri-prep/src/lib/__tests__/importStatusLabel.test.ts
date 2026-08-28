import { describe, it, expect } from "vitest";
import { importStatusLabel } from "../importStatusLabel.ts";

const ELL = String.fromCharCode(0x2026); // …
const CHECK = String.fromCharCode(0x2713); // ✓
const CROSS = String.fromCharCode(0x2717); // ✗
const WARN = String.fromCharCode(0x26a0); // ⚠

describe("importStatusLabel", () => {
  it("maps pending to a plain label", () => {
    expect(importStatusLabel({ status: "pending", message: "" })).toBe("En attente");
  });

  it("maps importing to a label ending with an ellipsis", () => {
    const out = importStatusLabel({ status: "importing", message: "" });
    expect(out).toContain("Importation");
    expect(out).toContain(ELL);
  });

  it("renders done with the doc id message and a check mark", () => {
    const out = importStatusLabel({ status: "done", message: "42" });
    expect(out).toContain(CHECK);
    expect(out).toContain("doc_id=42");
  });

  it("garde la coche quand le compte d'indexables est absent ou non nul", () => {
    // Absent = import ancien ou reponse muette : on ne peut rien affirmer, donc rien
    // n'est signale. C'est le cas de tous les appels d'avant IMPO-01.
    expect(importStatusLabel({ status: "done", message: "42" })).toContain(CHECK);
    expect(importStatusLabel({ status: "done", message: "42", importedLine: 17 })).toContain(CHECK);
  });

  it("signale sur la ligne un import abouti SANS unite indexable", () => {
    const out = importStatusLabel({ status: "done", message: "42", importedLine: 0 });
    expect(out).toContain(WARN);
    expect(out).not.toContain(CHECK);
    expect(out).toContain("doc_id=42");
    expect(out).toContain("indexable");
  });

  it("renders error with the message and a cross mark", () => {
    const out = importStatusLabel({ status: "error", message: "boom" });
    expect(out).toContain(CROSS);
    expect(out).toContain("boom");
  });

  it("HTML-escapes the message in done/error (inner escaping kept verbatim)", () => {
    expect(importStatusLabel({ status: "done", message: "<x>" })).toContain("doc_id=&lt;x&gt;");
    expect(importStatusLabel({ status: "error", message: "a & b" })).toContain("a &amp; b");
  });

  it("returns an empty string for an unknown status (default branch)", () => {
    // status is typed as a union; force the fall-through to pin the default.
    expect(importStatusLabel({ status: "weird" as never, message: "x" })).toBe("");
  });
});
