export const className = 'explorer ex-figure'

const OPTIONS = { lang: 'tsx', sourceType: 'module' }
const isNode = (value) => value && typeof value === 'object' && typeof value.type === 'string'

export function keyLoops(program) {
  const edits = []
  const visit = (node) => {
    if (node.type === 'JSXForExpression' && node.statement?.key === null) {
      const declaration = node.statement.left?.declarations?.[0]?.id
      if (declaration?.type === 'Identifier') {
        edits.push({ at: node.statement.right.end, text: `; key ${declaration.name}.id` })
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'comments') continue
      if (Array.isArray(value)) {
        for (const child of value) if (isNode(child)) visit(child)
      } else if (isNode(value)) visit(value)
    }
  }
  visit(program)
  return edits.sort((a, b) => a.at - b.at)
}

export function applyEdits(source, edits) {
  let output = ''
  let offset = 0
  const ranges = []
  for (const edit of edits) {
    output += source.slice(offset, edit.at)
    const start = output.length
    output += edit.text
    ranges.push({ start, end: output.length, tag: 'mark' })
    offset = edit.at
  }
  return { output: output + source.slice(offset), ranges }
}

export default async function render({ fence, ctx }) {
  if (!fence || fence.lang !== 'tsrx') throw new Error('keyed-loops needs a ```tsrx fence right after its marker')
  const parsed = await ctx.parse(fence.code, OPTIONS)
  const error = parsed.diagnostics.find((item) => item.severity === 'error')
  if (error) throw new Error(`keyed-loops: the fence does not parse: ${error.message}`)
  const edits = keyLoops(parsed.program)
  if (edits.length !== 2) throw new Error(`keyed-loops: expected 2 keyless loops but found ${edits.length}`)
  const { output, ranges } = applyEdits(fence.code, edits)
  const payload = JSON.stringify({ source: fence.code }).replaceAll('<', '\\u003c')
  return `<div class="projection-map-panes">
    <div class="projection-map-pane"><h3>Editable TSRX</h3><div class="ex-source-host" data-kl-source>${fence.html}</div></div>
    <div class="projection-map-pane"><h3>Keyed source</h3><div class="ex-out" data-kl-out>${ctx.highlight(output, 'tsrx')}</div><p class="ex-readout" data-kl-readout aria-live="polite">2 loops keyed</p></div>
  </div>
  <div class="ex-controls ex-toolbar"><button type="button" data-kl-reset hidden>Reset</button></div>
  <figcaption class="ex-status" data-widget-status aria-live="polite">2 loops keyed</figcaption>
  <script type="application/json" data-kl-seed>${payload}</script>
  <script type="application/json" data-kl-ranges>${JSON.stringify(ranges)}</script>`
}

export function markdown() {
  return 'On the site this codemod keys every keyless `@for` from its parsed loop node.'
}
