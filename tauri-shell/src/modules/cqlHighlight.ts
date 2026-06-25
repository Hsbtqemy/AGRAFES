/**
 * Lightweight CQL syntax tokenizer for the search input's highlight overlay.
 *
 * This is a *visual* tokenizer, not the real parser (that lives in the engine):
 * it segments a CQL string into coloured spans and degrades gracefully on
 * partial/invalid input (everything unknown falls to "plain"). Implemented as a
 * manual character scanner — no regex literals — to stay robust and dependency-free.
 *
 * CQL shape (cf. engine `cql_parser`): `[attr="value"%c]{m,n} ... within s`,
 * attributes word|lemma|pos|upos|xpos|feats, operators `=` / `&` / `|`.
 */

export type CqlTokenKind =
  | "bracket"   // [ ]
  | "attr"      // word lemma pos upos xpos feats
  | "op"        // = & |
  | "string"    // "..."
  | "flag"      // %c
  | "quant"     // {m,n}
  | "keyword"   // within
  | "plain";    // anything else (whitespace, values not in a string, etc.)

export interface CqlToken {
  text: string;
  kind: CqlTokenKind;
}

const ATTRS = new Set(["word", "lemma", "pos", "upos", "xpos", "feats"]);
const KEYWORDS = new Set(["within"]);

function isLetter(c: string): boolean {
  return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z");
}
function isDigit(c: string): boolean {
  return c >= "0" && c <= "9";
}

export function tokenizeCql(src: string): CqlToken[] {
  const out: CqlToken[] = [];
  // Coalesce consecutive "plain" chars into one token; emit typed tokens as-is.
  const pushPlain = (ch: string): void => {
    const last = out[out.length - 1];
    if (last && last.kind === "plain") last.text += ch;
    else out.push({ text: ch, kind: "plain" });
  };

  let i = 0;
  while (i < src.length) {
    const c = src[i];

    // Quoted value — tolerate an unclosed quote while typing.
    if (c === '"') {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === "\\" && j + 1 < src.length) { j += 2; continue; }
        if (src[j] === '"') { j += 1; break; }
        j += 1;
      }
      out.push({ text: src.slice(i, j), kind: "string" });
      i = j;
      continue;
    }

    // Case-insensitive flag %c
    if (c === "%" && src[i + 1] === "c") {
      out.push({ text: "%c", kind: "flag" });
      i += 2;
      continue;
    }

    if (c === "[" || c === "]") { out.push({ text: c, kind: "bracket" }); i += 1; continue; }
    if (c === "=" || c === "&" || c === "|") { out.push({ text: c, kind: "op" }); i += 1; continue; }

    // Quantifier {m} / {m,n} — only digits, commas, spaces inside.
    if (c === "{") {
      let j = i + 1;
      while (j < src.length && src[j] !== "}") {
        const d = src[j];
        if (!isDigit(d) && d !== "," && d !== " ") break;
        j += 1;
      }
      if (j < src.length && src[j] === "}" && j > i + 1) {
        out.push({ text: src.slice(i, j + 1), kind: "quant" });
        i = j + 1;
        continue;
      }
      // not a well-formed quantifier → fall through as plain
    }

    // Identifiers: attribute names and the `within` keyword; others stay plain.
    if (isLetter(c)) {
      let j = i;
      while (j < src.length && isLetter(src[j])) j += 1;
      const word = src.slice(i, j);
      const lower = word.toLowerCase();
      if (ATTRS.has(lower)) out.push({ text: word, kind: "attr" });
      else if (KEYWORDS.has(lower)) out.push({ text: word, kind: "keyword" });
      else for (const ch of word) pushPlain(ch);
      i = j;
      continue;
    }

    pushPlain(c);
    i += 1;
  }
  return out;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Build the highlight layer's inner HTML (escaped; typed tokens wrapped in spans). */
export function cqlTokensToHtml(tokens: CqlToken[]): string {
  return tokens
    .map((t) =>
      t.kind === "plain"
        ? escapeHtml(t.text)
        : `<span class="cqlhl-${t.kind}">${escapeHtml(t.text)}</span>`,
    )
    .join("");
}

/** Convenience: tokenize + render in one call. */
export function cqlToHtml(src: string): string {
  return cqlTokensToHtml(tokenizeCql(src));
}
