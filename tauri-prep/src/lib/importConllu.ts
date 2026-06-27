/**
 * importConllu.ts — pure import helpers extracted from ImportScreen (U-02):
 * path normalization for dedup, and a CoNLL-U preview parser. No `this`, no DOM,
 * no side effects. Covered by lib/__tests__/importConllu.test.ts.
 */

/** Normalise un chemin pour détecter les doublons (séparateurs + casse + préfixe long Windows). */
export function normalizeImportPath(p: string): string {
  let s = p.replace(/\\/g, "/").replace(/\/+$/u, "").toLowerCase();
  // \\?\C:\... → //?/c:/... après replace
  if (s.startsWith("//?/")) s = s.slice(4);
  return s;
}

interface ConlluPreviewRow {
  sent: number;
  id: string;
  form: string;
  lemma: string;
  upos: string;
}

export interface ConlluPreviewResult {
  rows: ConlluPreviewRow[];
  tokensTotal: number;
  sentences: number;
  skippedRanges: number;
  skippedEmptyNodes: number;
  malformedLines: number;
}

export function parseConlluPreview(text: string, maxRows = 60): ConlluPreviewResult {
  const rows: ConlluPreviewRow[] = [];
  let tokensTotal = 0;
  let sentences = 0;
  let skippedRanges = 0;
  let skippedEmptyNodes = 0;
  let malformedLines = 0;
  let currentSentence = 0;
  let hasTokenInCurrentSentence = false;

  const finalizeSentence = () => {
    if (hasTokenInCurrentSentence) {
      sentences += 1;
      hasTokenInCurrentSentence = false;
    }
  };

  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) {
      finalizeSentence();
      continue;
    }
    if (line.startsWith("#")) continue;

    const cols = rawLine.split("\t");
    if (cols.length !== 10) {
      malformedLines += 1;
      continue;
    }
    const tokenId = cols[0].trim();
    if (tokenId.includes("-")) {
      skippedRanges += 1;
      continue;
    }
    if (tokenId.includes(".")) {
      skippedEmptyNodes += 1;
      continue;
    }

    if (!hasTokenInCurrentSentence) {
      currentSentence = sentences + 1;
      hasTokenInCurrentSentence = true;
    }

    tokensTotal += 1;
    if (rows.length < maxRows) {
      rows.push({
        sent: currentSentence,
        id: tokenId || "—",
        form: cols[1]?.trim() || "—",
        lemma: cols[2]?.trim() && cols[2].trim() !== "_" ? cols[2].trim() : "—",
        upos: cols[3]?.trim() && cols[3].trim() !== "_" ? cols[3].trim() : "—",
      });
    }
  }
  finalizeSentence();

  return {
    rows,
    tokensTotal,
    sentences,
    skippedRanges,
    skippedEmptyNodes,
    malformedLines,
  };
}
