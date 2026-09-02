// Engine-free helpers shared by the playground and guide-page explorers.

export const escapeHtml = (text) =>
  String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

// Codegen errors carry byte offsets straight out of the wasm payload. The AST
// decoder already maps its own spans to UTF-16 indices, so this is only needed
// for the generate lane.
export function byteToCharIndex(text, byteOffset) {
  let bytes = 0
  let index = 0
  for (const ch of text) {
    if (bytes >= byteOffset) return index
    const cp = ch.codePointAt(0)
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4
    index += ch.length
  }
  return index
}

export const formatMs = (ms) => (ms < 10 ? ms.toFixed(2) : Math.round(ms).toString())

export const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`

export function flagNames(flags, table) {
  if (!table) return ''
  const names = []
  for (const [name, bit] of Object.entries(table)) {
    // The table also carries composite masks (Variable, Import, ValueSpace);
    // only the single-bit entries describe one property of a symbol.
    if ((bit & (bit - 1)) !== 0) continue
    if ((flags & bit) !== 0) names.push(name)
  }
  return names.join(' ')
}
