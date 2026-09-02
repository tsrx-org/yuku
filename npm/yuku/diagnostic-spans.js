/**
 * A malformed closing tag followed by one extra `>`, with any run of
 * whitespace between it and whatever token the parser stopped on.
 */
const DOUBLED_CLOSING_ANGLE = /<\/[^<>\s]+>>\s*$/;

/**
 * Re-derive the span a reader would point at for the two malformed-markup
 * shapes whose diagnostics the parser aims at the wrong offset.
 *
 * This compensates for spans assigned inside the seam -- yuku-minimal-seam
 * `src/parser/syntax/jsx/root.zig:282` -- where the JSX root recovery attaches
 * a diagnostic to the token it choked on rather than to the markup the author
 * actually wrote. The ideal fix is upstream, at that assignment site; this
 * function exists because that site is outside this package's tree, and it
 * lives here so there is one implementation of the policy instead of one per
 * consumer.
 *
 * Two shapes are compensated, and only those two:
 *
 * 1. A mismatched or stray closing tag, where the seam points at the tag name
 *    and the `</` that opened it is left out. The start moves back two
 *    characters to include it.
 * 2. A doubled closing angle (`</tag>>`), where the seam points past the extra
 *    `>` at the following token. The start moves back onto that extra `>`.
 *    The end is not moved, so the resulting slice still runs through the
 *    following token; that is deliberate parity with the downstream
 *    implementation this replaces, not a claim that it is the ideal span.
 *
 * Every other shape -- including a self-closing tag followed by a stray `>`
 * (`<br/>>`) -- is returned with its span unchanged apart from clamping.
 *
 * Both endpoints are clamped into `source` first, and `end` is never allowed
 * below `start`, so an out-of-range or inverted diagnostic yields a usable
 * span instead of one that slices backwards or off the end.
 *
 * @param {{ start: number, end: number }} diagnostic Diagnostic to place.
 * @param {string} source Source text the diagnostic was produced from.
 * @returns {{ start: number, end: number }} The authored span.
 */
export function authoredDiagnosticSpan(diagnostic, source) {
  const start = Math.max(0, Math.min(source.length, diagnostic.start));
  const end = Math.max(start, Math.min(source.length, diagnostic.end));
  if (source.slice(start - 2, start) === "</") return { start: start - 2, end };

  const prefix = source.slice(0, start);
  const doubled = prefix.match(DOUBLED_CLOSING_ANGLE)?.[0];
  if (doubled !== undefined) {
    return { start: prefix.length - doubled.length + doubled.lastIndexOf(">"), end };
  }
  return { start, end };
}
