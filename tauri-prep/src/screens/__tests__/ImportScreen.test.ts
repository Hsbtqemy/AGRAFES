import { describe, it, expect } from "vitest";
import {
  normalizeImportPath,
  modeOptionsForExt,
  parseConlluPreview,
} from "../ImportScreen.ts";

// ─── normalizeImportPath ──────────────────────────────────────────────────────

describe("normalizeImportPath", () => {
  it("remplace les séparateurs \\ par /", () => {
    expect(normalizeImportPath("C:\\Users\\foo\\file.docx")).toBe("c:/users/foo/file.docx");
  });

  it("supprime le trailing slash", () => {
    expect(normalizeImportPath("/home/user/file/")).toBe("/home/user/file");
  });

  it("met en minuscule", () => {
    expect(normalizeImportPath("/Home/User/File.DOCX")).toBe("/home/user/file.docx");
  });

  it("supprime le préfixe long Windows \\\\?\\", () => {
    expect(normalizeImportPath("\\\\?\\C:\\Users\\foo\\file.docx")).toBe("c:/users/foo/file.docx");
  });

  it("est idempotent (double application stable)", () => {
    const path = "C:\\Users\\Foo\\Bar.docx";
    expect(normalizeImportPath(normalizeImportPath(path))).toBe(normalizeImportPath(path));
  });

  it("chemin Unix simple inchangé (hormis casse)", () => {
    expect(normalizeImportPath("/home/user/corpus.txt")).toBe("/home/user/corpus.txt");
  });

  it("chemin vide → chaîne vide", () => {
    expect(normalizeImportPath("")).toBe("");
  });
});

// ─── modeOptionsForExt ───────────────────────────────────────────────────────

describe("modeOptionsForExt", () => {
  it(".docx → 2 options (paragraphes + lignes numérotées)", () => {
    const opts = modeOptionsForExt("docx");
    expect(opts).toHaveLength(2);
    expect(opts.map(o => o.value)).toContain("docx_paragraphs");
    expect(opts.map(o => o.value)).toContain("docx_numbered_lines");
  });

  it(".odt → 2 options", () => {
    const opts = modeOptionsForExt("odt");
    expect(opts).toHaveLength(2);
    expect(opts.map(o => o.value)).toContain("odt_paragraphs");
    expect(opts.map(o => o.value)).toContain("odt_numbered_lines");
  });

  it(".txt → 1 option TXT lignes numérotées", () => {
    const opts = modeOptionsForExt("txt");
    expect(opts).toHaveLength(1);
    expect(opts[0].value).toBe("txt_numbered_lines");
  });

  it(".conllu → 1 option CoNLL-U", () => {
    const opts = modeOptionsForExt("conllu");
    expect(opts).toHaveLength(1);
    expect(opts[0].value).toBe("conllu");
  });

  it(".conll → 1 option CoNLL-U (alias)", () => {
    const opts = modeOptionsForExt("conll");
    expect(opts).toHaveLength(1);
    expect(opts[0].value).toBe("conllu");
  });

  it(".xml → 1 option TEI", () => {
    const opts = modeOptionsForExt("xml");
    expect(opts).toHaveLength(1);
    expect(opts[0].value).toBe("tei");
  });

  it(".tei → 1 option TEI", () => {
    const opts = modeOptionsForExt("tei");
    expect(opts).toHaveLength(1);
    expect(opts[0].value).toBe("tei");
  });

  it("extension inconnue → toutes les options (> 2)", () => {
    const opts = modeOptionsForExt("pdf");
    expect(opts.length).toBeGreaterThan(2);
  });

  it("casse insensible (.DOCX ≡ .docx)", () => {
    expect(modeOptionsForExt("DOCX")).toEqual(modeOptionsForExt("docx"));
  });

  it("chaque option a value et label non vides", () => {
    for (const ext of ["docx", "odt", "txt", "conllu", "xml", "tei", "pdf"]) {
      for (const opt of modeOptionsForExt(ext)) {
        expect(opt.value).toBeTruthy();
        expect(opt.label).toBeTruthy();
      }
    }
  });
});

// ─── parseConlluPreview ───────────────────────────────────────────────────────

// Fixture CoNLL-U minimal valide (2 phrases, 5 tokens)
const SAMPLE_CONLLU = `
# sent_id = 1
1\tLe\tle\tDET\t_\t_\t2\tdet\t_\t_
2\tchat\tchat\tNOUN\t_\t_\t0\troot\t_\t_
3\tdort\tdormir\tVERB\t_\t_\t2\tnsubj\t_\t_

# sent_id = 2
1\tMarie\tMarie\tPROPN\t_\t_\t0\troot\t_\t_
2\tchante\tchanter\tVERB\t_\t_\t1\tnsubj\t_\t_
`.trim();

// Fixture avec anomalies
const ANOMALIES_CONLLU = `
1\tle\tle\tDET\t_\t_\t2\tdet\t_\t_
1-2\tdu\t_\t_\t_\t_\t_\t_\t_\t_
1.1\t_\t_\t_\t_\t_\t_\t_\t_\t_
ligne malformée sans tabulations
2\tchat\tchat\tNOUN\t_\t_\t0\troot\t_\t_
`.trim();

describe("parseConlluPreview", () => {
  it("fichier CoNLL-U valide → bon comptage tokens et phrases", () => {
    const r = parseConlluPreview(SAMPLE_CONLLU);
    expect(r.tokensTotal).toBe(5);
    expect(r.sentences).toBe(2);
    expect(r.malformedLines).toBe(0);
    expect(r.skippedRanges).toBe(0);
    expect(r.skippedEmptyNodes).toBe(0);
  });

  it("retourne les bons champs par token (sent, id, form, lemma, upos)", () => {
    const r = parseConlluPreview(SAMPLE_CONLLU);
    expect(r.rows[0]).toMatchObject({ sent: 1, id: "1", form: "Le", lemma: "le", upos: "DET" });
    expect(r.rows[3]).toMatchObject({ sent: 2, id: "1", form: "Marie", lemma: "Marie", upos: "PROPN" });
  });

  it("ligne malformée (≠ 10 colonnes) → incrémente malformedLines, pas de crash", () => {
    const r = parseConlluPreview(ANOMALIES_CONLLU);
    expect(r.malformedLines).toBe(1);
  });

  it("token range (1-2) → incrémente skippedRanges", () => {
    const r = parseConlluPreview(ANOMALIES_CONLLU);
    expect(r.skippedRanges).toBe(1);
  });

  it("empty node (1.1) → incrémente skippedEmptyNodes", () => {
    const r = parseConlluPreview(ANOMALIES_CONLLU);
    expect(r.skippedEmptyNodes).toBe(1);
  });

  it("maxRows respecté exactement", () => {
    const r = parseConlluPreview(SAMPLE_CONLLU, 2);
    expect(r.rows).toHaveLength(2);
    expect(r.tokensTotal).toBe(5); // total compte toujours tous les tokens
  });

  it("maxRows=0 → rows vide mais tokensTotal correct", () => {
    const r = parseConlluPreview(SAMPLE_CONLLU, 0);
    expect(r.rows).toHaveLength(0);
    expect(r.tokensTotal).toBe(5);
  });

  it("fichier vide → tout à 0, rows vide", () => {
    const r = parseConlluPreview("");
    expect(r.tokensTotal).toBe(0);
    expect(r.sentences).toBe(0);
    expect(r.rows).toHaveLength(0);
  });

  it("commentaires # ignorés", () => {
    const onlyComments = "# sent_id = 1\n# text = foo\n";
    const r = parseConlluPreview(onlyComments);
    expect(r.tokensTotal).toBe(0);
    expect(r.sentences).toBe(0);
    expect(r.malformedLines).toBe(0);
  });

  it("lemma _ remplacé par —", () => {
    const line = "1\tfoo\t_\tNOUN\t_\t_\t0\troot\t_\t_";
    const r = parseConlluPreview(line);
    expect(r.rows[0].lemma).toBe("—");
  });

  it("upos _ remplacé par —", () => {
    const line = "1\tfoo\tfoo\t_\t_\t_\t0\troot\t_\t_";
    const r = parseConlluPreview(line);
    expect(r.rows[0].upos).toBe("—");
  });

  it("séparateurs \\r\\n (Windows) acceptés", () => {
    const crlf = SAMPLE_CONLLU.replace(/\n/g, "\r\n");
    const r = parseConlluPreview(crlf);
    expect(r.tokensTotal).toBe(5);
    expect(r.sentences).toBe(2);
  });
});
