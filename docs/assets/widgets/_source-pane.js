// Shared by the registry widgets that light up spans of a source snippet.
// The underscore keeps this off the widget namespace: app.js only imports a
// module whose name a <!-- widget:NAME --> marker produced.
import { highlightedHtml } from './_shared.js'

export function markRanges(container, ranges, className) {
  const root = container.matches?.('code') ? container : (container.querySelector('code') ?? container)
  const nodes = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) nodes.push(walker.currentNode)
  const length = nodes.reduce((total, node) => total + node.data.length, 0)
  const normalized = ranges.map((range, index) => {
    const start = Math.max(0, Math.min(range.start, length))
    return { ...range, index, start, end: Math.max(start, Math.min(range.end, length)) }
  })
  const cuts = [...new Set(normalized.flatMap(({ start, end }) => [start, end]))].sort((a, b) => a - b)
  let offset = 0
  for (const node of nodes) {
    const start = offset
    const end = start + node.data.length
    offset = end
    if (start === end) continue
    const bounds = [start, ...cuts.filter((cut) => cut > start && cut < end), end]
    const fragment = document.createDocumentFragment()
    for (let i = 0; i < bounds.length - 1; i++) {
      const from = bounds[i]
      const to = bounds[i + 1]
      const text = node.data.slice(from - start, to - start)
      const hits = normalized.filter((range) => range.start < to && range.end > from)
      if (hits.length === 0) {
        fragment.append(document.createTextNode(text))
        continue
      }
      const mark = document.createElement(hits.find((range) => range.tag)?.tag ?? 'span')
      mark.className = [...new Set([className, ...hits.map((range) => range.className)].filter(Boolean))].join(' ')
      mark.dataset.start = String(from)
      mark.dataset.end = String(to)
      mark.dataset.range = hits.map((range) => range.index).join(' ')
      const titles = [...new Set(hits.map((range) => range.title).filter(Boolean))]
      if (titles.length > 0) mark.title = titles.join('\n')
      const readouts = [...new Set(hits.map((range) => range.readout ?? range.title).filter(Boolean))]
      if (readouts.length > 0) {
        mark.dataset.readout = readouts.join(' ')
        mark.tabIndex = 0
      }
      mark.textContent = text
      fragment.append(mark)
    }
    node.replaceWith(fragment)
  }
  for (const range of normalized.filter(({ eof }) => eof)) {
    const mark = document.createElement(range.tag ?? 'span')
    mark.className = [className, range.className, 'wd-eof'].filter(Boolean).join(' ')
    if (range.title) mark.title = range.title
    if (range.readout ?? range.title) {
      mark.dataset.readout = range.readout ?? range.title
      mark.tabIndex = 0
    }
    mark.textContent = range.text ?? 'end of file'
    root.append(mark)
  }
}

export function diagnosticRanges(source, diagnostics) {
  return diagnostics.flatMap((diagnostic) => {
    const severity = diagnostic.severity === 'error' ? 'error' : 'warning'
    const raw = diagnostic.labels?.length
      ? diagnostic.labels.map((label) => ({ ...label, title: `${diagnostic.message} (${label.message})` }))
      : [{ start: diagnostic.start, end: diagnostic.end, title: diagnostic.message }]
    return raw.map((range) => {
      const start = Math.max(0, Math.min(range.start, source.length))
      const end = Math.max(start, Math.min(range.end, source.length))
      return {
        start,
        end: end === start && start < source.length ? start + 1 : end,
        className: `wd-${severity}`,
        title: range.title,
        eof: start === source.length && end === start,
      }
    })
  })
}

export const isNode = (value) =>
  value !== null &&
  typeof value === 'object' &&
  typeof value.type === 'string' &&
  typeof value.start === 'number' &&
  typeof value.end === 'number'

// Every node in pre-order, keeping the object so a caller can hand it back to
// the analyzer's indexOf(). `comments` is a sibling list, not part of the tree.
export function collectNodes(program) {
  const out = []
  const visit = (node, depth) => {
    out.push({ node, type: node.type, start: node.start, end: node.end, depth })
    for (const [key, value] of Object.entries(node)) {
      if (key === 'comments') continue
      if (Array.isArray(value)) {
        for (const child of value) if (isNode(child)) visit(child, depth + 1)
      } else if (isNode(value)) {
        visit(value, depth + 1)
      }
    }
  }
  visit(program, 0)
  return out
}

// The smallest node whose span covers the offset: what a reader pointing at a
// character means by "this".
export function innermostAt(nodes, offset) {
  let best = null
  for (const entry of nodes) {
    if (entry.start > offset || entry.end <= offset) continue
    if (best === null || entry.end - entry.start <= best.end - best.start) best = entry
  }
  return best
}

export async function renderSegments(container, source, spans) {
  container.innerHTML = await highlightedHtml(source, 'ex-source')
  markRanges(container, [{ start: 0, end: source.length }, ...spans], 'ex-seg')
}

export function readSegments(host) {
  return [...host.querySelectorAll('.ex-seg')].map((node) => ({
    node,
    start: Number(node.dataset.start),
    end: Number(node.dataset.end),
  }))
}

const overlaps = (segment, span) => segment.start < span.end && segment.end > span.start

export function paint(segments, spans, className) {
  for (const segment of segments) {
    segment.node.classList.toggle(
      className,
      spans.some((span) => overlaps(segment, span)),
    )
  }
}

export function clearClass(segments, className) {
  for (const segment of segments) segment.node.classList.remove(className)
}

export function reportStatus(root, text) {
  const status = root.querySelector('[data-widget-status]')
  if (status) status.textContent = text
}

export function bindMarkedReadout(container, readout, idle) {
  const show = (target) => {
    const mark = target.closest?.('[data-readout]')
    if (mark) readout.textContent = mark.dataset.readout
  }
  container.addEventListener('mouseover', (event) => show(event.target))
  container.addEventListener('focusin', (event) => show(event.target))
  container.addEventListener('click', (event) => show(event.target))
  container.addEventListener('mouseleave', () => {
    if (!container.contains(document.activeElement)) readout.textContent = idle
  })
}

export function failWidget(root, prefix, error, state = 'error') {
  const message = error?.message ?? String(error)
  reportStatus(root, `${prefix}: ${message}`)
  root.dataset.widgetState = state
  return message
}
