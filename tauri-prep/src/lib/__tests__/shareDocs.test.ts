import { describe, it, expect } from "vitest";
import {
  authIsComplete,
  buildWebdavAuth,
  folderLabel,
  formatRemoteSize,
  isImportRemoteReport,
  languageRequiredForMode,
  normalizeFolderUrl,
  safeDecodeUrl,
  sortRemoteEntries,
  statusBadgeKind,
  statusLabel,
  summarizeReport,
} from "../shareDocs.ts";
import type { ImportRemoteReport, RemoteEntry } from "../sidecarClient.ts";

const entry = (name: string, is_dir: boolean, size: number | null = null): RemoteEntry => ({
  name,
  href: `https://dav.example/folder/${name}`,
  is_dir,
  size,
  modified: null,
  content_type: null,
});

describe("buildWebdavAuth", () => {
  it("anonymous: drops all credentials", () => {
    expect(buildWebdavAuth("anonymous", { user: "x", password: "y", token: "z" })).toEqual({
      mode: "anonymous",
    });
  });

  it("basic: keeps user + password only, trims user", () => {
    expect(buildWebdavAuth("basic", { user: "  alice ", password: "pw", token: "ignored" })).toEqual({
      mode: "basic",
      user: "alice",
      password: "pw",
    });
  });

  it("bearer: keeps token only, trims it", () => {
    expect(buildWebdavAuth("bearer", { user: "u", password: "p", token: "  tok " })).toEqual({
      mode: "bearer",
      token: "tok",
    });
  });

  it("missing fields default to empty strings (not undefined)", () => {
    expect(buildWebdavAuth("basic", {})).toEqual({ mode: "basic", user: "", password: "" });
  });
});

describe("languageRequiredForMode", () => {
  it("requires a language for non-TEI modes", () => {
    expect(languageRequiredForMode("docx_numbered_lines")).toBe(true);
    expect(languageRequiredForMode("conllu")).toBe(true);
  });
  it("does not require a language for TEI", () => {
    expect(languageRequiredForMode("tei")).toBe(false);
  });
});

describe("authIsComplete", () => {
  it("anonymous is always complete", () => {
    expect(authIsComplete({ mode: "anonymous" })).toBe(true);
  });
  it("basic needs both user and password", () => {
    expect(authIsComplete({ mode: "basic", user: "a", password: "b" })).toBe(true);
    expect(authIsComplete({ mode: "basic", user: "a", password: "" })).toBe(false);
    expect(authIsComplete({ mode: "basic", user: "", password: "b" })).toBe(false);
  });
  it("bearer needs a token", () => {
    expect(authIsComplete({ mode: "bearer", token: "t" })).toBe(true);
    expect(authIsComplete({ mode: "bearer", token: "" })).toBe(false);
  });
});

describe("formatRemoteSize", () => {
  it("null/undefined → em dash", () => {
    expect(formatRemoteSize(null)).toBe("—");
    expect(formatRemoteSize(undefined)).toBe("—");
  });
  it("bytes under 1 KiB stay in 'o'", () => {
    expect(formatRemoteSize(512)).toBe("512 o");
  });
  it("scales to KiB/MiB", () => {
    expect(formatRemoteSize(2048)).toBe("2.0 Kio");
    expect(formatRemoteSize(5 * 1024 * 1024)).toBe("5.0 Mio");
  });
  it("drops the decimal at/above 10 units", () => {
    expect(formatRemoteSize(20 * 1024)).toBe("20 Kio");
  });
});

describe("normalizeFolderUrl", () => {
  it("adds a single trailing slash", () => {
    expect(normalizeFolderUrl("https://x/dir")).toBe("https://x/dir/");
  });
  it("keeps an existing trailing slash", () => {
    expect(normalizeFolderUrl("https://x/dir/")).toBe("https://x/dir/");
  });
  it("trims surrounding whitespace; empty stays empty", () => {
    expect(normalizeFolderUrl("  https://x/d ")).toBe("https://x/d/");
    expect(normalizeFolderUrl("   ")).toBe("");
  });
});

describe("folderLabel", () => {
  it("returns the decoded last path segment", () => {
    expect(folderLabel("https://dav.example/files/Le%20Corpus/")).toBe("Le Corpus");
  });
  it("falls back to the raw url when unparseable", () => {
    expect(folderLabel("not a url")).toBe("not a url");
  });
});

describe("sortRemoteEntries", () => {
  it("folders first, then files, each alphabetical and case-insensitive", () => {
    const input = [
      entry("beta.docx", false),
      entry("Zeta", true),
      entry("alpha.docx", false),
      entry("apple", true),
    ];
    expect(sortRemoteEntries(input).map((e) => e.name)).toEqual([
      "apple",
      "Zeta",
      "alpha.docx",
      "beta.docx",
    ]);
  });
  it("does not mutate the input array", () => {
    const input = [entry("b", false), entry("a", true)];
    const copy = [...input];
    sortRemoteEntries(input);
    expect(input).toEqual(copy);
  });
});

describe("safeDecodeUrl", () => {
  it("decodes valid percent-encoding", () => {
    expect(safeDecodeUrl("Le%20Corpus")).toBe("Le Corpus");
  });
  it("returns the raw string on a malformed escape instead of throwing", () => {
    expect(safeDecodeUrl("https://x/100%discount")).toBe("https://x/100%discount");
    expect(safeDecodeUrl("%")).toBe("%");
  });
});

describe("isImportRemoteReport", () => {
  it("accepts a well-formed report", () => {
    expect(
      isImportRemoteReport({
        url: "x",
        mode: "y",
        total: 1,
        imported: 1,
        skipped_duplicate: 0,
        skipped_filtered: 0,
        skipped_oversize: 0,
        errors: 0,
        files: [],
      }),
    ).toBe(true);
  });
  it("rejects shape drift (missing counts or files)", () => {
    expect(isImportRemoteReport(null)).toBe(false);
    expect(isImportRemoteReport(undefined)).toBe(false);
    expect(isImportRemoteReport({})).toBe(false);
    expect(isImportRemoteReport({ total: 1, imported: 1 })).toBe(false); // no files[]
    expect(isImportRemoteReport({ total: "1", imported: 1, files: [] })).toBe(false); // total not number
  });
});

describe("status helpers", () => {
  it("maps each status to a badge kind", () => {
    expect(statusBadgeKind("imported")).toBe("ok");
    expect(statusBadgeKind("error")).toBe("error");
    expect(statusBadgeKind("skipped-duplicate")).toBe("muted");
    expect(statusBadgeKind("skipped-filtered")).toBe("warn");
    expect(statusBadgeKind("skipped-oversize")).toBe("warn");
  });
  it("provides a French label for each status", () => {
    expect(statusLabel("imported")).toBe("Importé");
    expect(statusLabel("skipped-oversize")).toBe("Trop volumineux");
    expect(statusLabel("error")).toBe("Erreur");
  });
});

describe("summarizeReport", () => {
  const base: ImportRemoteReport = {
    url: "https://x/",
    mode: "docx_numbered_lines",
    total: 0,
    imported: 0,
    skipped_duplicate: 0,
    skipped_filtered: 0,
    skipped_oversize: 0,
    errors: 0,
    files: [],
  };

  it("lists only the non-zero buckets, imports always shown", () => {
    expect(summarizeReport({ ...base, total: 5, imported: 3, skipped_duplicate: 1, errors: 1 })).toBe(
      "5 fichiers : 3 importés, 1 doublon, 1 erreur",
    );
  });
  it("singular/plural agreement", () => {
    expect(summarizeReport({ ...base, total: 1, imported: 1 })).toBe("1 fichier : 1 importé");
  });
  it("zero imports still reports the import bucket", () => {
    expect(summarizeReport({ ...base, total: 2, skipped_filtered: 2 })).toBe(
      "2 fichiers : 0 importé, 2 filtrés",
    );
  });
});
