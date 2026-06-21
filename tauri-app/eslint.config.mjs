// Surgical ESLint config (audit S-03, phase 2 — concordancier): enforce
// no-unsanitized on innerHTML/outerHTML/insertAdjacentHTML to prevent XSS-
// regression. Intentionally scoped to the no-unsanitized rules only — this is a
// security gate, not a style suite. Mirrors tauri-prep/eslint.config.mjs.
//
// `escape.methods` lists tauri-app's verified HTML escapers (each replaces
// & < > "). A `${escapeHtml(x)}` substitution is therefore treated as safe; a
// raw `${x}` is still flagged. Keep this list in sync with the real escapers and
// never add a function that does not escape — in particular do NOT add the two
// inline `& < >`-only escapers (main.ts, search.ts `esc`): their sinks are
// migrated to the safeHtml`` sink in the burndown instead.
import tseslint from 'typescript-eslint';
import nounsanitized from 'eslint-plugin-no-unsanitized';

const escape = {
  // Trusted sink (audit S-03): innerHTML is written only via setHtml()/appendHtml()
  // in lib/safeHtml.ts, which accept a TrustedHtml produced by the safeHtml``
  // tagged template (auto-escapes) or raw() (explicit vouch). Those sinks carry
  // the only disables. The methods below keep LEGACY `${escapeHtml(x)}` template
  // assignments valid (not yet migrated) — both are verified HTML escapers
  // (& < > ", hardened to escape " in S-03 phase 2):
  //   escapeHtml — ui/dom.ts
  //   _escHtml   — features/stats.ts
  methods: ['escapeHtml', '_escHtml'],
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
