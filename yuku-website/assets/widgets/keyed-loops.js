import { escapeHtml, plural } from '../yuku-shared.js'
import { parse, ready } from '../yuku-wasm.js'
import { createLayeredEditor } from './_editor.js'
import { diagnosticsHtml, highlightedHtml } from './_shared.js'
import { markRanges } from './_source-pane.js'

const OPTIONS = { lang: 'tsx', sourceType: 'module' }
const isNode = (value) => value && typeof value === 'object' && typeof value.type === 'string'

function keyLoops(program) {
  const edits = []
  const visit = (node) => {
    if (node.type === 'JSXForExpression' && node.statement?.key === null) {
      const declaration = node.statement.left?.declarations?.[0]?.id
      if (declaration?.type === 'Identifier') edits.push({ at: node.statement.right.end, text: `; key ${declaration.name}.id` })
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

function applyEdits(source, edits) {
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

export default function mount(root, { cleanup }) {
  const { source: seed } = JSON.parse(root.querySelector('[data-kl-seed]').textContent)
  const host = root.querySelector('[data-kl-source]')
  const out = root.querySelector('[data-kl-out]')
  const readout = root.querySelector('[data-kl-readout]')
  const status = root.querySelector('[data-widget-status]')
  const reset = root.querySelector('[data-kl-reset]')
  let editor
  let run = 0
  let disposed = false

  const rewrite = async (source) => {
    const ticket = ++run
    try {
      const result = await parse(source, OPTIONS)
      if (ticket !== run || disposed) return
      const errors = result.diagnostics.filter((item) => item.severity === 'error')
      if (errors.length) {
        out.innerHTML = diagnosticsHtml(result.diagnostics)
        status.textContent = `${plural(errors.length, 'parse error')}`
        root.dataset.widgetState = 'error'
        return
      }
      const changed = applyEdits(source, keyLoops(result.program))
      out.innerHTML = await highlightedHtml(changed.output, 'ex-generated kl-output')
      if (ticket !== run || disposed) return
      markRanges(out, changed.ranges, 'kl-change')
      out.querySelector('.ex-generated')?.setAttribute('data-kl-generated', '')
      const message = `${plural(changed.ranges.length, 'loop')} keyed`
      readout.textContent = message
      status.textContent = message
      root.dataset.keyed = String(changed.ranges.length)
      root.dataset.widgetState = 'ready'
    } catch (error) {
      if (ticket !== run || disposed) return
      out.innerHTML = `<p class="ex-note ex-unavailable">parse failed: ${escapeHtml(error.message)}</p>`
      status.textContent = `parse failed: ${error.message}`
      root.dataset.widgetState = 'error'
    }
  }

  cleanup.push(() => { disposed = true; editor?.dispose() })
  ready().then(() => {
    editor = createLayeredEditor({
      host,
      source: seed,
      render: (source) => highlightedHtml(source, 'ex-source ex-source-plain'),
      onChange(source) { reset.hidden = source === seed; rewrite(source) },
      ariaLabel: 'Editable TSRX loops',
      rows: seed.split('\n').length,
    })
    reset.addEventListener('click', async () => { reset.hidden = true; await editor.setValue(seed); rewrite(seed) })
    return rewrite(seed)
  }).catch((error) => {
    status.textContent = `in-browser parser unavailable: ${error.message}`
    root.dataset.widgetState = 'unavailable'
  })
}
