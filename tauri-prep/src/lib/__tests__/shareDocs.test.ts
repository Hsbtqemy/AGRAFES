import { describe, it, expect } from "vitest";
import {
  authIsComplete,
  authSecret,
  buildNextcloudRoot,
  buildWebdavAuth,
  folderLabel,
  formatRemoteSize,
  groupDetectedFiles,
  isImportRemoteReport,
  keyringAccount,
  languageRequiredForMode,
  mergeReports,
  normalizeFolderUrl,
  safeDecodeUrl,
  sortRemoteEntries,
  statusBadgeKind,
  statusLabel,
  summarizeReport,
  urlHasPath,
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

describe("buildNextcloudRoot", () => {
  it("bare host defaults to https and builds the personal WebDAV root", () => {
    expect(buildNextcloudRoot("dav.huma-num.fr", "alice")).toBe(
      "https://dav.huma-num.fr/remote.php/dav/files/alice/",
    );
  });
  it("keeps an explicit scheme (http stays http)", () => {
    expect(buildNextcloudRoot("http://localhost:8080", "bob")).toBe(
      "http://localhost:8080/remote.php/dav/files/bob/",
    );
  });
  it("reduces a deep URL to its origin", () => {
    expect(buildNextcloudRoot("https://srv/some/deep/path", "u")).toBe(
      "https://srv/remote.php/dav/files/u/",
    );
  });
  it("percent-encodes the identifier in the path segment", () => {
    expect(buildNextcloudRoot("srv", "a b@x")).toBe(
      "https://srv/remote.php/dav/files/a%20b%40x/",
    );
  });
  it("returns empty when host or user is missing/blank", () => {
    expect(buildNextcloudRoot("", "alice")).toBe("");
    expect(buildNextcloudRoot("srv", "  ")).toBe("");
    expect(buildNextcloudRoot("   ", "alice")).toBe("");
  });
  it("returns empty when the host cannot be parsed (catch branch)", () => {
    expect(buildNextcloudRoot("has spaces .fr", "alice")).toBe("");
  });
});

// NOTE: la détection de format (detectFormatFromName / modeFormat / fileMatchesMode,
// drapeau ⚠ de P4D) a été retirée en Phase 5 — le tri connu/inconnu vit désormais
// dans importDetect.isKnownImportExt (voir importDetect.test.ts) et le routage par
// fichier remplace le contrôle de compatibilité mode↔format.

describe("urlHasPath", () => {
  it("bare host or root → no path", () => {
    expect(urlHasPath("dav.huma-num.fr")).toBe(false);
    expect(urlHasPath("https://srv")).toBe(false);
    expect(urlHasPath("https://srv/")).toBe(false);
  });
  it("a deep URL → has a path", () => {
    expect(urlHasPath("dav.huma-num.fr/foo")).toBe(true);
    expect(urlHasPath("https://srv/remote.php/dav/files/alice/")).toBe(true);
  });
  it("empty / blank / unparseable → false", () => {
    expect(urlHasPath("")).toBe(false);
    expect(urlHasPath("   ")).toBe(false);
    expect(urlHasPath("has spaces .fr")).toBe(false);
  });
});

describe("keyringAccount", () => {
  it("keys by origin|mode|user (port and path stripped to origin)", () => {
    expect(keyringAccount("https://dav.example:8443/files/x/dir/", "basic", "alice")).toBe(
      "https://dav.example:8443|basic|alice",
    );
  });
  it("trims the username and tolerates an empty one (bearer)", () => {
    expect(keyringAccount("https://dav.example/d/", "bearer", "  ")).toBe(
      "https://dav.example|bearer|",
    );
  });
  it("distinct origins do not collide", () => {
    const a = keyringAccount("https://a.example/d/", "basic", "u");
    const b = keyringAccount("https://b.example/d/", "basic", "u");
    expect(a).not.toBe(b);
  });
  it("falls back to the trimmed raw URL when unparseable", () => {
    expect(keyringAccount("not a url", "basic", "u")).toBe("not a url|basic|u");
  });
});

describe("authSecret", () => {
  it("basic → password, bearer → token", () => {
    expect(authSecret({ mode: "basic", user: "u", password: "pw" })).toBe("pw");
    expect(authSecret({ mode: "bearer", token: "tok" })).toBe("tok");
  });
  it("anonymous and empty secrets → null", () => {
    expect(authSecret({ mode: "anonymous" })).toBeNull();
    expect(authSecret({ mode: "basic", user: "u", password: "" })).toBeNull();
    expect(authSecret({ mode: "bearer", token: "" })).toBeNull();
  });
});

// NOTE: groupSelectionForImport (groupement P4C par dossier/parent, un mode pour tout
// le panier) a été remplacé en Phase 5 par groupDetectedFiles (groupement par
// (parent, mode, langue)).

describe("groupDetectedFiles (Phase 5)", () => {
  const file = (href: string, name: string, parentUrl: string, mode: string, language: string) => ({
    href, name, parentUrl, mode, language,
  });

  it("regroupe les fichiers de mêmes (parent, mode, langue) en un seul lot", () => {
    const groups = groupDetectedFiles([
      file("https://x/d/a.docx", "a.docx", "https://x/d/", "docx_numbered_lines", "fr"),
      file("https://x/d/b.docx", "b.docx", "https://x/d/", "docx_numbered_lines", "fr"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      url: "https://x/d/",
      mode: "docx_numbered_lines",
      language: "fr",
      hrefs: ["https://x/d/a.docx", "https://x/d/b.docx"],
    });
  });

  it("dossier bilingue (même parent) → un lot par langue", () => {
    const groups = groupDetectedFiles([
      file("https://x/d/roman_fr.docx", "roman_fr.docx", "https://x/d/", "docx_numbered_lines", "fr"),
      file("https://x/d/roman_en.docx", "roman_en.docx", "https://x/d/", "docx_numbered_lines", "en"),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.language).sort()).toEqual(["en", "fr"]);
    expect(groups.every((g) => g.hrefs.length === 1)).toBe(true);
  });

  it("formats mixtes (même parent, même langue) → un lot par mode", () => {
    const groups = groupDetectedFiles([
      file("https://x/d/a.docx", "a.docx", "https://x/d/", "docx_numbered_lines", "fr"),
      file("https://x/d/b.txt", "b.txt", "https://x/d/", "txt_numbered_lines", "fr"),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.mode).sort()).toEqual(["docx_numbered_lines", "txt_numbered_lines"]);
  });

  it("sépare aussi par dossier parent", () => {
    const groups = groupDetectedFiles([
      file("https://x/d1/a.docx", "a.docx", "https://x/d1/", "docx_numbered_lines", "fr"),
      file("https://x/d2/b.docx", "b.docx", "https://x/d2/", "docx_numbered_lines", "fr"),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.url).sort()).toEqual(["https://x/d1/", "https://x/d2/"]);
  });

  it("préserve l'ordre de première apparition", () => {
    const groups = groupDetectedFiles([
      file("https://x/d/a.txt", "a.txt", "https://x/d/", "txt_numbered_lines", "fr"),
      file("https://x/d/b.docx", "b.docx", "https://x/d/", "docx_numbered_lines", "fr"),
    ]);
    expect(groups.map((g) => g.mode)).toEqual(["txt_numbered_lines", "docx_numbered_lines"]);
  });

  it("label : dossier · mode · langue + compte pluralisé", () => {
    const groups = groupDetectedFiles([
      file("https://x/d/a.docx", "a.docx", "https://x/d/", "docx_numbered_lines", "fr"),
      file("https://x/d/b.docx", "b.docx", "https://x/d/", "docx_numbered_lines", "fr"),
    ]);
    expect(groups[0].label).toBe("d · docx_numbered_lines · fr (2 fichiers)");
  });

  it("liste vide → aucun lot", () => {
    expect(groupDetectedFiles([])).toEqual([]);
  });
});

describe("mergeReports", () => {
  const rep = (over: Partial<ImportRemoteReport>): ImportRemoteReport => ({
    url: "https://x/", mode: "docx_numbered_lines",
    total: 0, imported: 0, skipped_duplicate: 0, skipped_filtered: 0,
    skipped_oversize: 0, errors: 0, files: [], ...over,
  });

  it("null base returns the second report unchanged", () => {
    const b = rep({ total: 2, imported: 2 });
    expect(mergeReports(null, b)).toBe(b);
  });

  it("sums counts and concatenates files", () => {
    const a = rep({
      total: 2, imported: 1, errors: 1,
      files: [{ source_url: "u1", name: "a", status: "imported", doc_id: 1 }],
    });
    const b = rep({
      total: 1, imported: 1,
      files: [{ source_url: "u2", name: "b", status: "imported", doc_id: 2 }],
    });
    const m = mergeReports(a, b);
    expect(m.total).toBe(3);
    expect(m.imported).toBe(2);
    expect(m.errors).toBe(1);
    expect(m.files.map((f) => f.name)).toEqual(["a", "b"]);
  });
});
