// Engine-free helpers for the playground.

export const escapeHtml = (text) =>
  String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

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
