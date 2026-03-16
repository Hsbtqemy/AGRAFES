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

// ─── FTS preview bar ──────────────────────────────────────────────────────────

export function updateFtsPreview(raw: string): void {
  const bar = document.getElementById("fts-preview-bar");
  const code = document.getElementById("fts-preview-code");
  if (!bar || !code) return;
  const trimmed = raw.trim();
  if (!trimmed) { bar.style.display = "none"; return; }
  code.textContent = buildFtsQuery(trimmed);
  bar.style.display = "";
}
