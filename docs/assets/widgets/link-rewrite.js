import { escapeHtml, plural } from '../yuku-shared.js'
import { parse, ready } from '../yuku-wasm.js'
import { diagnosticsHtml, highlightedHtml, plainStatus } from './_shared.js'
import { createLayeredEditor } from './_editor.js'
import { bindMarkedReadout, markRanges } from './_source-pane.js'

const PARSE_OPTIONS = { lang: 'tsx', sourceType: 'module' }

const isNode = (value) =>
  value !== null && typeof value === 'object' && typeof value.type === 'string' && typeof value.start === 'number'

function linkEdits(program, source) {
  const edits = []
  const visit = (node) => {
    if (node.type === 'JSXOpeningElement' && node.name?.type === 'JSXIdentifier' && node.name.name === 'Link') {
      const href = node.attributes.find((attribute) => attribute.name?.name === 'href')
      const params = node.attributes.find((attribute) => attribute.name?.name === 'params')
      const path = href?.value?.value
      const expression = params?.value?.expression
      if (typeof path === 'string' && /(^|\/):[A-Za-z_$][\w$]*/.test(path) && expression) {
        edits.push({
          start: href.value.start,
          end: href.value.end,
          replacement: `{url(${JSON.stringify(path)}, ${source.slice(expression.start, expression.end)})}`,
        })
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
  return edits.sort((a, b) => a.start - b.start)
}

function rewriteOutput(source, edits) {
  let rewritten = ''
  let offset = 0
  const ranges = []
  for (const edit of edits) {
    rewritten += source.slice(offset, edit.start)
    const start = rewritten.length
    rewritten += edit.replacement
    ranges.push({ start, end: rewritten.length, tag: 'mark' })
    offset = edit.end
  }
  rewritten += source.slice(offset)
  return { rewritten, ranges }
}

export default function mount(root, { cleanup }) {
  const { source: seed } = JSON.parse(root.querySelector('[data-lr-seed]').textContent)
  const host = root.querySelector('[data-lr-source]')
  const out = root.querySelector('[data-lr-out]')
  const reset = root.querySelector('[data-lr-reset]')
  const readout = root.querySelector('[data-lr-readout]')
  let editor = null
  let run = 0
  let disposed = false

  const rewrite = async (source) => {
    const ticket = ++run
    try {
      const result = await parse(source, PARSE_OPTIONS)
      if (ticket !== run || disposed) return
      const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')
      if (errors.length > 0) {
        out.innerHTML = `<div data-lr-diagnostics>${diagnosticsHtml(result.diagnostics)}</div>`
        plainStatus(root, `${plural(errors.length, 'parse error')} in the source.`, result.ms)
        root.dataset.widgetState = 'error'
        return
      }
      const edits = linkEdits(result.program, source)
      const output = rewriteOutput(source, edits)
      const html = await highlightedHtml(output.rewritten, 'ex-generated lr-output')
      if (ticket !== run || disposed) return
      out.innerHTML = html
      markRanges(
        out,
        output.ranges.map((range) => ({ ...range, readout: 'This href became a url(path, params) call.' })),
        'lr-change',
      )
      out.querySelector('.lr-output')?.setAttribute('data-lr-generated', '')
      plainStatus(root, `${plural(edits.length, 'link')} rewritten.`, result.ms)
      root.dataset.widgetState = 'ready'
      root.dataset.rewritten = String(edits.length)
    } catch (error) {
      if (ticket !== run || disposed) return
      out.innerHTML = `<p class="ex-note ex-unavailable">parse failed: ${escapeHtml(error.message)}</p>`
      root.querySelector('[data-widget-status]').textContent = `parse failed: ${error.message}`
      root.dataset.widgetState = 'error'
    }
  }

  cleanup.push(() => {
    disposed = true
    editor?.dispose()
  })

  bindMarkedReadout(out, readout, 'Focus or hover a highlighted rewrite to see what changed.')

  ready()
    .then(() => {
      editor = createLayeredEditor({
        host,
        source: seed,
        render: (source) => highlightedHtml(source, 'ex-source ex-source-plain'),
        onChange(value) {
          reset.hidden = value === seed
          rewrite(value)
        },
        ariaLabel: 'Editable TSRX link source',
        rows: seed.split('\n').length,
      })
      reset.addEventListener('click', async () => {
        reset.hidden = true
        await editor.setValue(seed)
        rewrite(seed)
      })
      return rewrite(seed)
    })
    .catch((error) => {
      out.innerHTML = `<p class="ex-note ex-unavailable">in-browser parser unavailable: ${escapeHtml(error.message)}</p>`
      root.querySelector('[data-widget-status]').textContent = `in-browser parser unavailable: ${error.message}`
      root.dataset.widgetState = 'unavailable'
    })
}
