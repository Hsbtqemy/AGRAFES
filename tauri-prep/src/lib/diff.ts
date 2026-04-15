/**
 * diff.ts — Utilitaires de diff et d'échappement HTML.
 *
 * Fonctions pures, testables sans DOM.
 * Importées par CurationView et ActionsScreen.
 */

/**
 * Échappe les caractères HTML spéciaux d'une chaîne de texte brut.
 */
export function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Rend les caractères spéciaux/invisibles sous forme de glyphes visibles avec infobulle.
 * À appeler sur du texte déjà échappé HTML (& < > remplacés).
 */
export function renderSpecialChars(escaped: string): string {
  return escaped
    .replace(/\u00a0/g,  '<span class="diff-special-char" title="espace ins\u00e9cable (U+00A0)">\u00b7</span>')
    .replace(/\u202f/g,  '<span class="diff-special-char" title="espace fine ins\u00e9cable (U+202F)">\u02d9</span>')
    .replace(/\u00ad/g,  '<span class="diff-special-char diff-special-invisible" title="tiret conditionnel (U+00AD)">\u2e17</span>')
    .replace(/\u200b/g,  '<span class="diff-special-char diff-special-invisible" title="espace de largeur nulle (U+200B)">\u2423</span>')
    .replace(/\u200c/g,  '<span class="diff-special-char diff-special-invisible" title="ZWNJ (U+200C)">\u27e8\u200c\u27e9</span>')
    .replace(/\u200d/g,  '<span class="diff-special-char diff-special-invisible" title="ZWJ (U+200D)">\u27e8\u200d\u27e9</span>')
    .replace(/\u2028/g,  '<span class="diff-special-char diff-special-invisible" title="s\u00e9parateur de lignes (U+2028)">\u21a9</span>')
    .replace(/\t/g,      '<span class="diff-special-char" title="tabulation">\u2192</span>');
}

/**
 * Diff caractère par caractère (LCS) entre `before` et `after`.
 * Retourne du HTML avec :
 *   - <del class="diff-char-del"> pour les suppressions
 *   - <mark class="diff-char-ins"> pour les insertions
 *
 * Bascule automatiquement sur le diff mot-à-mot pour les chaînes > 600 caractères
 * (LCS O(mn) trop lent au-delà).
 */
export function highlightChanges(before: string, after: string): string {
  if (before.length > 600 || after.length > 600) {
    return highlightChangesWordLevel(before, after);
  }

  const bChars = [...before]; // split Unicode-aware (paires de substitution)
  const aChars = [...after];
  const m = bChars.length, n = aChars.length;

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = bChars[i] === aChars[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);

  const parts: string[] = [];
  let i = 0, j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && bChars[i] === aChars[j]) {
      parts.push(renderSpecialChars(escHtml(aChars[j])));
      i++; j++;
    } else if (j < n && (i >= m || dp[i + 1][j] >= dp[i][j + 1])) {
      parts.push(`<mark class="diff-char-ins">${renderSpecialChars(escHtml(aChars[j]))}</mark>`);
      j++;
    } else {
      parts.push(`<del class="diff-char-del">${renderSpecialChars(escHtml(bChars[i]))}</del>`);
      i++;
    }
  }
  return parts.join("");
}

/**
 * Diff mot-à-mot (LCS) — fallback pour les longues chaînes.
 * Affiche les mots entiers ajoutés/supprimés, sans surlignage intra-mot.
 * Comparaison insensible à la casse.
 */
export function highlightChangesWordLevel(before: string, after: string): string {
  const bWords = before.split(/\s+/).filter(Boolean);
  const aWords = after.split(/\s+/).filter(Boolean);
  const m = bWords.length, n = aWords.length;

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = bWords[i].toLowerCase() === aWords[j].toLowerCase()
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);

  const parts: string[] = [];
  let i = 0, j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && bWords[i].toLowerCase() === aWords[j].toLowerCase()) {
      parts.push(renderSpecialChars(escHtml(aWords[j])));
      i++; j++;
    } else if (j < n && (i >= m || dp[i + 1][j] >= dp[i][j + 1])) {
      parts.push(`<mark class="diff-mark">${renderSpecialChars(escHtml(aWords[j]))}</mark>`);
      j++;
    } else {
      parts.push(`<del class="diff-del">${renderSpecialChars(escHtml(bWords[i]))}</del>`);
      i++;
    }
  }
  return parts.join(" ");
}
