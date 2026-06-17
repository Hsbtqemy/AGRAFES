// Trusted HTML sink (audit S-03).
//
// `safeHtml` is a tagged template that auto-escapes every interpolated value, so
//   el.innerHTML = safeHtml`<b>${userInput}</b>`
// is XSS-safe by construction. Pre-built HTML fragments (already escaped, e.g.
// the output of another safeHtml`` call, a .map(...=>safeHtml``) array, or a
// verified renderer) must be wrapped in `raw()` to opt out of escaping.
// (Named `safeHtml`, not `html`, because many screens use a local `html` var.)
//
// The eslint-plugin-no-unsanitized config trusts the `safeHtml` tag, so any
// innerHTML/outerHTML assignment that does NOT go through it is flagged.
// Escaping parity with the legacy escHtml() helper (& < > ") plus ' for safety.

/** Opaque wrapper marking a string as already-safe HTML (skips escaping). */
export class TrustedHtml {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

/** Mark an already-safe HTML string so html`` will not re-escape it. */
export function raw(htmlString: string | TrustedHtml): TrustedHtml {
  return htmlString instanceof TrustedHtml ? htmlString : new TrustedHtml(htmlString);
}

function escapeValue(v: unknown): string {
  if (v instanceof TrustedHtml) return v.value;
  if (v == null) return "";
  if (Array.isArray(v)) return v.map(escapeValue).join("");
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Tagged template producing a TrustedHtml. Static parts are kept verbatim;
 * every ${interpolation} is escaped unless it is a TrustedHtml (via raw() or a
 * nested html``). Arrays are flattened (each item escaped/raw individually).
 */
export function safeHtml(strings: TemplateStringsArray, ...values: unknown[]): TrustedHtml {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) {
    out += escapeValue(values[i]) + strings[i + 1];
  }
  return new TrustedHtml(out);
}

// The two sanctioned innerHTML sinks. They accept ONLY a TrustedHtml, so the
// type system guarantees the value came from safeHtml`` (escaped) or raw()
// (explicit vouch) — a raw string cannot be passed. These are the single place
// innerHTML is written, hence the lone disables.
export function setHtml(el: { innerHTML: string }, html: TrustedHtml): void {
  // eslint-disable-next-line no-unsanitized/property -- sole audited sink; arg is TrustedHtml
  el.innerHTML = html.value;
}

export function appendHtml(el: { innerHTML: string }, html: TrustedHtml): void {
  // eslint-disable-next-line no-unsanitized/property -- sole audited sink; arg is TrustedHtml
  el.innerHTML += html.value;
}
