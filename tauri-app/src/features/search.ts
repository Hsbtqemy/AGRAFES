/**
 * features/search.ts — FTS query builder and FTS preview bar.
 * Pure logic: no DOM rendering of results, no sidecar calls.
 */

import { state } from "../state";

// ─── FTS query builder ────────────────────────────────────────────────────────

/**
 * Detect if raw input already looks like an FTS5 expression.
 * When true, skip builder transformation and pass through as-is.
 */
export function isSimpleInput(raw: string): boolean {
  return /\b(AND|OR|NOT|NEAR)\b|"/.test(raw.trim());
}

/** Show a transient warning below the builder panel. */
export function showBuilderWarn(msg: string): void {
  const el = document.getElementById("builder-warn");
  if (!el) return;
  el.textContent = msg;
  el.style.display = "block";
  setTimeout(() => { el.style.display = "none"; el.textContent = ""; }, 4000);
}

/**
 * Build an FTS5 query string from raw input + builder mode.
 * - simple: pass through as-is
 * - phrase: wrap in double quotes
 * - and:    join tokens with AND
 * - or:     join tokens with OR
 * - near:   NEAR(t1 t2 …, N) — requires ≥2 tokens
 */
export function buildFtsQuery(raw: string): string {
  const trimmed = raw.trim();
  const mode = state.builderMode;
  if (mode === "simple") return trimmed;
  if (mode === "regex" || mode === "cql") return ""; // handled by dedicated backend mode

  if (isSimpleInput(trimmed)) {
    showBuilderWarn("Requête FTS détectée — transformation annulée (mode simple forcé).");
    return trimmed;
  }

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return "";

  if (mode === "phrase") {
    const escaped = trimmed.replace(/"/g, "'");
    return `"${escaped}"`;
  }
  if (mode === "and") return tokens.join(" AND ");
  if (mode === "or") return tokens.join(" OR ");
  if (mode === "near") {
    if (tokens.length < 2) {
      showBuilderWarn("NEAR requiert au moins 2 mots. Requête passée telle quelle.");
      return tokens[0] ?? "";
    }
    return `NEAR(${tokens.join(" ")}, ${state.nearN})`;
  }
  return trimmed;
}

// ─── CQL syntax guard (client-side, lightweight) ─────────────────────────────

function _findCqlTokenEnd(src: string, start: number): number {
  let inString = false;
  let escaped = false;
  for (let i = start + 1; i < src.length; i++) {
    const ch = src[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === "\"") {
      inString = !inString;
      continue;
    }
    if (ch === "]" && !inString) return i;
  }
  return -1;
}

function _splitTopLevelAnd(expr: string): string[] {
  const parts: string[] = [];
  let inString = false;
  let escaped = false;
  let cur = "";
  for (const ch of expr) {
    if (escaped) {
      cur += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      cur += ch;
      escaped = true;
      continue;
    }
    if (ch === "\"") {
      cur += ch;
      inString = !inString;
      continue;
    }
    if (ch === "&" && !inString) {
      const p = cur.trim();
      if (!p) return [];
      parts.push(p);
      cur = "";
      continue;
    }
    cur += ch;
  }
  const tail = cur.trim();
  if (!tail) return [];
  parts.push(tail);
  return parts;
}

/**
 * Lightweight client-side CQL syntax check (Sprint D).
 *
 * This validates structure (token clauses, optional quantifiers, optional
 * trailing `within s`) before sending to the backend.
 *
 * It intentionally does not validate regex semantics in values, to avoid
 * rejecting patterns that are accepted server-side by Python's `re`.
 */
export function validateCqlSyntax(raw: string): string | null {
  let src = raw.trim();
  if (src.endsWith(";")) src = src.slice(0, -1).trim();
  if (!src) return "La requête CQL est vide.";

  const predRe = /^(word|lemma|pos|upos)\s*=\s*"(?:\\.|[^"\\])*"\s*(%c)?\s*$/i;
  const quantRe = /^\{\s*(\d+)\s*(?:,\s*(\d+)\s*)?\}/;

  let i = 0;
  let seenToken = false;
  while (i < src.length) {
    while (i < src.length && /\s/.test(src[i])) i++;
    if (i >= src.length) break;

    const rem = src.slice(i);
    if (/^within\b/i.test(rem)) break;

    if (src[i] !== "[") {
      return `Position ${i + 1}: '[' attendu.`;
    }
    const end = _findCqlTokenEnd(src, i);
    if (end < 0) return "Crochet fermant ']' manquant.";

    const body = src.slice(i + 1, end).trim();
    if (body) {
      const preds = _splitTopLevelAnd(body);
      if (preds.length === 0) return "Clause CQL invalide autour de '&'.";
      for (const p of preds) {
        if (!predRe.test(p)) {
          return `Prédicat invalide: ${p}`;
        }
      }
    }

    seenToken = true;
    i = end + 1;

    while (i < src.length && /\s/.test(src[i])) i++;
    const qm = src.slice(i).match(quantRe);
    if (qm) {
      const m = Number(qm[1]);
      const n = qm[2] !== undefined ? Number(qm[2]) : m;
      if (n < m) return "Quantifieur invalide: borne max < borne min.";
      i += qm[0].length;
    }
  }

  if (!seenToken) return "Aucune clause token CQL détectée.";

  while (i < src.length && /\s/.test(src[i])) i++;
  if (i < src.length) {
    const suffix = src.slice(i).trim();
    if (!/^within\s+s$/i.test(suffix)) {
      return `Contrainte finale non supportée: ${suffix}`;
    }
  }

  return null;
}

// ─── FTS preview bar ──────────────────────────────────────────────────────────

export function updateFtsPreview(raw: string): void {
  const bar = document.getElementById("fts-preview-bar");
  const code = document.getElementById("fts-preview-code");
  const label = document.querySelector<HTMLElement>(".fts-preview-label");
  if (!bar || !code) return;
  const trimmed = raw.trim();
  if (!trimmed) { bar.style.display = "none"; return; }
  if (state.builderMode === "regex") {
    if (label) label.textContent = "Regex :";
    code.textContent = `regex: ${trimmed}`;
    bar.style.display = "";
  } else if (state.builderMode === "cql") {
    if (label) label.textContent = "CQL :";
    // Lightweight syntax coloring without extra dependency.
    const esc = (s: string): string =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    // Mark top-level AND-like operators before escaping to avoid corrupting
    // HTML entities (&amp;) when styling operators.
    const cqlAndSentinel = "__CQL_AND__";
    const markedAnd = trimmed.replace(/\s&\s/g, ` ${cqlAndSentinel} `);
    const safe = esc(markedAnd);
    const withValues = safe.replace(/"([^"]*)"/g, '<span class="cql-value">"$1"</span>');
    const withAttrs = withValues.replace(/\b(lemma|word|pos|upos)\b/gi, '<span class="cql-attr">$1</span>');
    const withOps = withAttrs
      .replace(/%c/gi, '<span class="cql-flag">%c</span>')
      .replace(new RegExp(cqlAndSentinel, "g"), '<span class="cql-op">&amp;</span>')
      .replace(/\[\]/g, '<span class="cql-op">[]</span>')
      .replace(/\{\s*\d+\s*(?:,\s*\d+\s*)?\}/g, (m) => `<span class="cql-flag">${m}</span>`)
      .replace(/\bwithin\s+s\b/gi, '<span class="cql-op">within s</span>');
    code.innerHTML = withOps;
    bar.style.display = "";
  } else {
    if (label) label.textContent = "FTS :";
    code.textContent = buildFtsQuery(trimmed);
    bar.style.display = "";
  }
}
