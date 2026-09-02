export const className = 'explorer ex-figure'

const OPTIONS = { lang: 'tsx', sourceType: 'module' }

export function renameModel(view, source, from = 'count') {
  const semantic = view.semantic
  let symbolId = null
  for (let id = 0; id < semantic.symbol.count; id++) {
    if (semantic.symbol.name(id) === from && semantic.symbol.declCount(id) > 0) {
      const declaration = semantic.symbol.declNode(id, 0)
      if (source.slice(0, declaration.start).includes('@{')) {
        symbolId = id
        break
      }
    }
  }
  if (symbolId === null) return { spans: [], shadowed: 0 }
  const spans = []
  for (let i = 0; i < semantic.symbol.declCount(symbolId); i++) {
    const node = semantic.symbol.declNode(symbolId, i)
    spans.push({ start: node.start, end: node.end })
  }
  for (let i = 0; i < semantic.reference.count; i++) {
    if (semantic.reference.symbolId(i) === symbolId) {
      spans.push({ start: semantic.reference.start(i), end: semantic.reference.end(i) })
    }
  }
  let shadowed = 0
  for (let id = 0; id < semantic.symbol.count; id++) {
    if (id !== symbolId && semantic.symbol.name(id) === from) shadowed++
  }
  return { spans: spans.sort((a, b) => a.start - b.start), shadowed }
}

export function applyRename(source, spans, name) {
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

export default async function render({ fence, ctx }) {
  if (!fence || fence.lang !== 'tsrx') throw new Error('safe-rename needs a ```tsrx fence right after its marker')
  const view = await ctx.analyze(fence.code, OPTIONS)
  const error = view.diagnostics.find((item) => item.severity === 'error')
  if (error) throw new Error(`safe-rename: the fence does not analyze: ${error.message}`)
  const model = renameModel(view, fence.code)
  if (model.spans.length !== 4 || model.shadowed !== 1) throw new Error('safe-rename: the seed must resolve 4 outer places and 1 shadow')
  const { output } = applyRename(fence.code, model.spans, 'total')
  const payload = JSON.stringify({ source: fence.code }).replaceAll('<', '\\u003c')
  return `<div class="projection-map-panes">
    <div class="projection-map-pane"><h3>Editable TSRX</h3><div class="ex-source-host" data-sr-source>${fence.html}</div></div>
    <div class="projection-map-pane"><h3>Renamed source</h3><div class="ex-out" data-sr-out>${ctx.highlight(output, 'tsrx')}</div><p class="ex-readout" data-sr-readout aria-live="polite">4 places renamed, 1 shadowed name left alone</p></div>
  </div>
  <div class="ex-controls ex-toolbar"><label>Rename count to <input type="text" value="total" data-sr-name></label></div>
  <figcaption class="ex-status" data-widget-status aria-live="polite">4 places renamed, 1 shadowed name left alone</figcaption>
  <script type="application/json" data-sr-seed>${payload}</script>`
}

export function markdown() {
  return 'On the site the outer declaration and its references rename by `symbolId`; the inner shadow stays unchanged.'
}
