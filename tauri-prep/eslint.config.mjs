// Surgical ESLint config (audit S-03): enforce no-unsanitized on innerHTML/
// outerHTML/insertAdjacentHTML to prevent XSS-regression. Intentionally scoped
// to the no-unsanitized rules only — this is a security gate, not a style suite.
//
// `escape.methods` lists the project's verified HTML escapers (each replaces
// & < > "). A `${escHtml(x)}` substitution is therefore treated as safe; a raw
// `${x}` is still flagged. Keep this list in sync with the real escapers and
// never add a function that does not escape.
import tseslint from 'typescript-eslint';
import nounsanitized from 'eslint-plugin-no-unsanitized';

const escape = {
  // Trusted sink (audit S-03): innerHTML is written only via setHtml()/appendHtml()
  // in lib/safeHtml.ts, which accept a TrustedHtml produced by the safeHtml``
  // tagged template (auto-escapes) or raw() (explicit vouch). Those sinks carry
  // the only disables. The methods below keep LEGACY `${escHtml(x)}` template
  // assignments valid (not yet migrated) — all are verified HTML escapers ...
  methods: [
    'escHtml', '_escHtml', 'esc', '_esc', '_escHtmlApp', '_escHtmlMeta',
    // ... and verified safe renderers whose output is escaped HTML:
    //   richTextToHtml  — text_raw is XML-escaped at import; fallback via _esc
    //   highlightChanges[WordLevel] — every char via renderSpecialChars(escHtml())
    'richTextToHtml', 'highlightChanges', 'highlightChangesWordLevel',
  ],
};

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '**/*.d.ts', 'scripts/**'] },
  {
    files: ['src/**/*.ts'],
    plugins: { 'no-unsanitized': nounsanitized },
    languageOptions: { parser: tseslint.parser },
    rules: {
      'no-unsanitized/method': ['error', { escape }],
      'no-unsanitized/property': ['error', { escape }],
    },
  },
);
