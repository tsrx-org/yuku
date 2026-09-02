import { escapeHtml } from '../yuku-shared.js'
import { analyze, ready } from '../yuku-wasm.js'
import { createLayeredEditor } from './_editor.js'
import { diagnosticsHtml, highlightedHtml } from './_shared.js'
import { markRanges } from './_source-pane.js'

const OPTIONS = { lang: 'tsx', sourceType: 'module' }
const VALID_NAME = /^[$A-Z_a-z][$\w]*$/

function renameModel(view, source) {
  const semantic = view.semantic
  let symbolId = null
  for (let id = 0; id < semantic.symbol.count; id++) {
    if (semantic.symbol.name(id) === 'count' && semantic.symbol.declCount(id)) {
      const declaration = semantic.symbol.declNode(id, 0)
      if (source.slice(0, declaration.start).includes('@{')) { symbolId = id; break }
    }
  }
  if (symbolId === null) return { spans: [], shadowed: 0 }
  const spans = []
  for (let i = 0; i < semantic.symbol.declCount(symbolId); i++) {
    const node = semantic.symbol.declNode(symbolId, i)
    spans.push({ start: node.start, end: node.end })
  }
  for (let i = 0; i < semantic.reference.count; i++) {
    if (semantic.reference.symbolId(i) === symbolId) spans.push({ start: semantic.reference.start(i), end: semantic.reference.end(i) })
  }
  let shadowed = 0
  for (let id = 0; id < semantic.symbol.count; id++) if (id !== symbolId && semantic.symbol.name(id) === 'count') shadowed++
  return { spans: spans.sort((a, b) => a.start - b.start), shadowed }
}

function applyRename(source, spans, name) {
  let output = ''
  let offset = 0
  const ranges = []
  for (const span of spans) {
    output += source.slice(offset, span.start)
    const start = output.length
    output += name
    ranges.push({ start, end: output.length, tag: 'mark' })
    offset = span.end
  }
  return { output: output + source.slice(offset), ranges }
}

export default function mount(root, { cleanup }) {
  const { source: seed } = JSON.parse(root.querySelector('[data-sr-seed]').textContent)
  const host = root.querySelector('[data-sr-source]')
  const out = root.querySelector('[data-sr-out]')
  const readout = root.querySelector('[data-sr-readout]')
  const status = root.querySelector('[data-widget-status]')
  const input = root.querySelector('[data-sr-name]')
  let source = seed
  let editor
  let run = 0
  let disposed = false

  const rename = async () => {
    const ticket = ++run
    const name = input.value.trim()
    if (!VALID_NAME.test(name)) {
      status.textContent = 'Choose a valid variable name'
      root.dataset.widgetState = 'error'
      return
    }
    try {
      const view = await analyze(source, OPTIONS)
      if (ticket !== run || disposed) return
      const errors = view.diagnostics.filter((item) => item.severity === 'error')
      if (errors.length) {
        out.innerHTML = diagnosticsHtml(view.diagnostics)
        status.textContent = 'Source does not analyze cleanly'
        root.dataset.widgetState = 'error'
        return
      }
      const model = renameModel(view, source)
      const changed = applyRename(source, model.spans, name)
      out.innerHTML = await highlightedHtml(changed.output, 'ex-generated sr-output')
      if (ticket !== run || disposed) return
      markRanges(out, changed.ranges, 'sr-change')
      out.querySelector('.ex-generated')?.setAttribute('data-sr-generated', '')
      const message = `${changed.ranges.length} places renamed, ${model.shadowed} shadowed name left alone`
      readout.textContent = message
      status.textContent = message
      root.dataset.renamed = String(changed.ranges.length)
      root.dataset.shadowed = String(model.shadowed)
      root.dataset.widgetState = 'ready'
    } catch (error) {
      if (ticket !== run || disposed) return
      out.innerHTML = `<p class="ex-note ex-unavailable">analyze failed: ${escapeHtml(error.message)}</p>`
      status.textContent = `analyze failed: ${error.message}`
      root.dataset.widgetState = 'error'
    }
  }

  cleanup.push(() => { disposed = true; editor?.dispose() })
  input.addEventListener('input', rename)
  ready().then(() => {
    editor = createLayeredEditor({
      host,
      source: seed,
      render: (value) => highlightedHtml(value, 'ex-source ex-source-plain'),
      onChange(value) { source = value; rename() },
      ariaLabel: 'Editable TSRX rename source',
      rows: seed.split('\n').length,
    })
    return rename()
  }).catch((error) => {
    status.textContent = `in-browser analyzer unavailable: ${error.message}`
    root.dataset.widgetState = 'unavailable'
  })
}
