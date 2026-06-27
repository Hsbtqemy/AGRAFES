import { describe, it, expect } from "vitest";
import {
  normalizeImportPath,
  parseConlluPreview,
} from "../importConllu.ts";

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

// NOTE: la couverture de `modeOptionsForExt` a migré vers
// `lib/__tests__/importDetect.test.ts` (la fonction vit désormais dans le module
// pur `lib/importDetect.ts`, partagé avec ShareDocs — Phase 5).

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
