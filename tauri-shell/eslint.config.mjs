// Surgical ESLint config (audit S-03, phase 2 — shell): enforce no-unsanitized
// on innerHTML/outerHTML/insertAdjacentHTML to prevent XSS-regression.
// Intentionally scoped to the no-unsanitized rules only — a security gate, not a
// style suite. Mirrors tauri-prep/tauri-app/eslint.config.mjs.
//
// Lints ONLY tauri-shell's own src/. The prep/app source that shell imports at
// source level (../tauri-prep/src, ../tauri-app/src) is already guarded in those
// packages, so the `src/**/*.ts` glob deliberately excludes them.
//
// `escape.methods` lists shell's verified HTML escaper `_esc` (replaces
// & < > "), defined in shell.ts and modules/rechercheModule.ts. A `${_esc(x)}`
// substitution is therefore treated as safe; a raw `${x}` is still flagged.
// Dynamic innerHTML must go through the safeHtml`` sink reused from prep
// (../../../tauri-prep/src/lib/safeHtml.ts). Do NOT add `_escCqlVal` (CQL, not
// HTML) or any function that does not escape & < > ".
import tseslint from 'typescript-eslint';
import nounsanitized from 'eslint-plugin-no-unsanitized';

const escape = {
  methods: ['_esc'],
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
