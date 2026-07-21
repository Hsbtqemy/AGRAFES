import { describe, it, expect } from "vitest";
import {
  escHtml,
  renderSpecialChars,
  highlightChanges,
  highlightChangesWordLevel,
} from "../diff.ts";

// ─── escHtml ─────────────────────────────────────────────────────────────────

describe("escHtml", () => {
  it("échappe & < > \"", () => {
    expect(escHtml('a & b < c > d "e"')).toBe("a &amp; b &lt; c &gt; d &quot;e&quot;");
  });

  it("laisse une chaîne sans caractères spéciaux inchangée", () => {
    expect(escHtml("bonjour monde")).toBe("bonjour monde");
  });

  it("est idempotent", () => {
    const s = "a < b";
    expect(escHtml(escHtml(s))).not.toBe(escHtml(s)); // double-échappement visible
    expect(escHtml(s)).toBe("a &lt; b");
  });

  it("chaîne vide → chaîne vide", () => {
    expect(escHtml("")).toBe("");
  });
});

// ─── renderSpecialChars ───────────────────────────────────────────────────────

describe("renderSpecialChars", () => {
  it("rend l'espace insécable (U+00A0) en span visible", () => {
    const out = renderSpecialChars("\u00a0");
    expect(out).toContain("diff-special-char");
    expect(out).toContain("U+00A0");
  });

  it("rend l'espace fine insécable (U+202F)", () => {
    const out = renderSpecialChars("\u202f");
    expect(out).toContain("U+202F");
  });

  it("rend la tabulation", () => {
    const out = renderSpecialChars("\t");
    expect(out).toContain("tabulation");
    expect(out).toContain("\u2192");
  });

  it("laisse le texte normal inchangé", () => {
    expect(renderSpecialChars("bonjour")).toBe("bonjour");
  });

  it("rend le ZWJ (U+200D)", () => {
    const out = renderSpecialChars("\u200d");
    expect(out).toContain("ZWJ");
    expect(out).toContain("diff-special-invisible");
  });

  it("showSpace rend l'espace ordinaire (U+0020) en glyphe", () => {
    const out = renderSpecialChars("a b", true);
    expect(out).toContain("diff-special-space");
    expect(out).toContain("U+0020");
  });

  it("sans showSpace, l'espace ordinaire reste inchang\u00e9", () => {
    expect(renderSpecialChars("a b")).toBe("a b");
  });

  it("showSpace n'alt\u00e8re pas le markup d'un autre invisible (pas de double-remplacement)", () => {
    const out = renderSpecialChars("\u00a0", true); // NBSP seul
    expect(out).toContain("U+00A0");         // rendu comme ins\u00e9cable
    expect(out).not.toContain("U+0020");     // et PAS comme espace ordinaire
  });
});

// ─── highlightChanges ─────────────────────────────────────────────────────────

describe("highlightChanges", () => {
  it("chaînes identiques → aucun <del> ni <mark>", () => {
    const out = highlightChanges("bonjour", "bonjour");
    expect(out).not.toContain("<del");
    expect(out).not.toContain("<mark");
  });

  it("insertion pure → <mark class=\"diff-char-ins\">", () => {
    const out = highlightChanges("ab", "abc");
    expect(out).toContain('<mark class="diff-char-ins">c</mark>');
  });

  it("suppression pure → <del class=\"diff-char-del\">", () => {
    const out = highlightChanges("abc", "ab");
    expect(out).toContain('<del class="diff-char-del">c</del>');
  });

  it("chaîne vide avant → tout en insertion", () => {
    const out = highlightChanges("", "ab");
    expect(out).toContain('<mark class="diff-char-ins">a</mark>');
    expect(out).toContain('<mark class="diff-char-ins">b</mark>');
  });

  it("chaîne vide après → tout en suppression", () => {
    const out = highlightChanges("ab", "");
    expect(out).toContain('<del class="diff-char-del">a</del>');
    expect(out).toContain('<del class="diff-char-del">b</del>');
  });

  it("chaînes > 600 chars → bascule sur word-level sans plantage", () => {
    const long = "a".repeat(700);
    const out = highlightChanges(long, long + " b");
    expect(out).toBeDefined();
    expect(typeof out).toBe("string");
  });

  it("caractères Unicode multi-byte (emoji) → pas de corruption", () => {
    const out = highlightChanges("👋 monde", "👋 monde !");
    expect(out).toContain("monde");
    expect(out).not.toContain("undefined");
  });

  it("échappe le HTML dans les caractères non modifiés", () => {
    const out = highlightChanges("<b>", "<b>");
    expect(out).toContain("&lt;");
    expect(out).toContain("&gt;");
    expect(out).not.toContain("<b>");
  });

  it("changement d'espaces seul (double → simple) est visible", () => {
    const out = highlightChanges("a  b", "a b"); // deux espaces → un
    expect(out).toContain('<del class="diff-char-del">'); // l'espace en trop est supprimé…
    expect(out).toContain("diff-special-space");          // …et rendu en glyphe visible
  });

  it("espace ordinaire → fine insécable : les deux glyphes distincts apparaissent", () => {
    const out = highlightChanges("mot !", "mot !"); // U+0020 → U+202F
    expect(out).toContain('<del class="diff-char-del">'); // espace ordinaire supprimé
    expect(out).toContain('<mark class="diff-char-ins">'); // fine insécable insérée
    expect(out).toContain("U+202F");                       // glyphe de la fine insécable
    expect(out).toContain("diff-special-space");           // et le glyphe de l'espace supprimé
  });

  it("suppression simple -> diff minimal (1 seul <del>, aucune insertion)", () => {
    const out = highlightChanges("ab", "b"); // supprime 'a', garde 'b'
    expect((out.match(/<del/g) || []).length).toBe(1);
    expect(out).not.toContain("<mark");
  });

  it("espace au milieu supprime ne duplique PAS le texte qui suit (alignement)", () => {
    // Avant le fix, la fin commune etait rendue en insert-tout + delete-tout.
    const out = highlightChanges("a.  b c", "a. b c"); // double -> simple espace
    expect(out).not.toContain("<mark");                 // pure suppression
    expect((out.match(/<del/g) || []).length).toBe(1);  // seul l'espace en trop
  });
});

// ─── highlightChangesWordLevel ────────────────────────────────────────────────

describe("highlightChangesWordLevel", () => {
  it("mot remplacé → <del> + <mark>", () => {
    const out = highlightChangesWordLevel("chat noir", "chat blanc");
    expect(out).toContain('<del class="diff-del">noir</del>');
    expect(out).toContain('<mark class="diff-mark">blanc</mark>');
    expect(out).toContain("chat");
    expect(out).not.toContain("<del>chat");
    expect(out).not.toContain('<mark class="diff-mark">chat');
  });

  it("comparaison insensible à la casse → pas de diff", () => {
    const out = highlightChangesWordLevel("Chat", "chat");
    expect(out).not.toContain("<del");
    expect(out).not.toContain("<mark");
  });

  it("chaînes identiques → aucun marquage", () => {
    const out = highlightChangesWordLevel("bonjour monde", "bonjour monde");
    expect(out).not.toContain("<del");
    expect(out).not.toContain("<mark");
  });

  it("chaîne vide avant → tout en insertion", () => {
    const out = highlightChangesWordLevel("", "nouveau");
    expect(out).toContain('<mark class="diff-mark">nouveau</mark>');
  });
});
