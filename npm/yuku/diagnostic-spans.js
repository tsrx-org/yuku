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

  const doubled = doubledClosingAngleBefore(source, start);
  if (doubled !== -1) return { start: doubled, end };
  return { start, end };
}

/**
 * Where the extra `>` of a doubled closing angle (`</tag>>`) sits when one
 * ends right before `start`, give or take whitespace; -1 otherwise. The same
 * match as `/<\/[^<>\s]+>>\s*$/` against `source.slice(0, start)`, read
 * backwards from `start` so it costs the length of the match, not of the file.
 */
function doubledClosingAngleBefore(source, start) {
  let index = start;
  while (index > 0 && /\s/.test(source[index - 1])) index--;
  if (index < 2 || source[index - 1] !== ">" || source[index - 2] !== ">") return -1;
  const extra = index - 1;
  let name = index - 2;
  while (name > 0 && !/[<>\s]/.test(source[name - 1])) name--;
  // `name` is where the run of tag characters starts; a `<` must precede it,
  // then `/`, then at least one tag character before the `>>`.
  const lt = name - 1;
  if (lt < 0 || source[lt] !== "<" || source[lt + 1] !== "/" || lt + 2 > index - 3) return -1;
  return extra;
}
