import { escapeHtml, plural } from '../yuku-shared.js'
import { parse, ready } from '../yuku-wasm.js'
import { diagnosticsHtml, highlightedHtml, plainStatus } from './_shared.js'
import { createLayeredEditor } from './_editor.js'
import { bindMarkedReadout, markRanges } from './_source-pane.js'

const PARSE_OPTIONS = { lang: 'tsx', sourceType: 'module' }
const PARAM = /(^|\/):([A-Za-z_$][\w$]*)(?=\/|$)/g

const isNode = (value) =>
  value !== null && typeof value === 'object' && typeof value.type === 'string' && typeof value.start === 'number'

function propertyName(property) {
  if (property.computed || property.type !== 'Property') return null
  if (property.key.type === 'Identifier') return property.key.name
  return typeof property.key.value === 'string' ? property.key.value : null
}

function removalSpan(attributes, index) {
  const attribute = attributes[index]
  if (index > 0) return { start: attributes[index - 1].end, end: attribute.end }
  if (index + 1 < attributes.length) return { start: attribute.start, end: attributes[index + 1].start }
  return { start: attribute.start, end: attribute.end }
}

function linkRewrite(program, source) {
  const edits = []
  const runtime = []
  const visit = (node) => {
    if (node.type === 'JSXOpeningElement' && node.name?.type === 'JSXIdentifier' && node.name.name === 'Link') {
      const href = node.attributes.find((attribute) => attribute.name?.name === 'href')
      const paramsIndex = node.attributes.findIndex((attribute) => attribute.name?.name === 'params')
      const params = node.attributes[paramsIndex]
      const path = href?.value?.value
      const expression = params?.value?.expression
      const needed = typeof path === 'string' ? [...path.matchAll(PARAM)] : []
      if (needed.length > 0 && expression?.type === 'ObjectExpression') {
        const values = new Map(expression.properties.map((property) => [propertyName(property), property.value]))
        const unresolved = needed
          .map((match) => ({ match, value: values.get(match[2]) }))
          .filter(({ value }) => value?.type !== 'Literal' || (typeof value.value !== 'string' && typeof value.value !== 'number'))
        if (unresolved.length === 0) {
          const rewritten = path.replace(PARAM, (segment, slash, name) => `${slash}${String(values.get(name).value)}`)
          edits.push({
            start: href.value.start,
            end: href.value.end,
            replacement: JSON.stringify(rewritten),
            readout: `Resolved ${path} with literal parameters.`,
          })
          edits.push({
            ...removalSpan(node.attributes, paramsIndex),
            replacement: '',
            removed: true,
            readout: 'Removed the params attribute after resolving its literals.',
          })
        } else {
          const needs = unresolved.map(({ match, value }) => value ? source.slice(value.start, value.end) : match[2])
          runtime.push(`left for the runtime: ${path} needs ${needs.join(', ')}`)
        }
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
  return { edits: edits.sort((a, b) => a.start - b.start), runtime }
}

function rewriteOutput(source, edits) {
  let rewritten = ''
  let offset = 0
  const ranges = []
  const removals = []
  for (const edit of edits) {
    rewritten += source.slice(offset, edit.start)
    const start = rewritten.length
    rewritten += edit.replacement
    if (edit.removed) removals.push({ offset: start, readout: edit.readout })
    else ranges.push({ start, end: rewritten.length, tag: 'mark', readout: edit.readout })
    offset = edit.end
  }
  rewritten += source.slice(offset)
  return { rewritten, ranges, removals }
}

function markRemovals(container, removals) {
  const code = container.querySelector('code') ?? container
  for (const removal of [...removals].reverse()) {
    const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT)
    let offset = 0
    while (walker.nextNode()) {
      const node = walker.currentNode
      if (offset + node.data.length < removal.offset) {
        offset += node.data.length
        continue
      }
      const marker = document.createElement('mark')
      marker.className = 'lr-change lr-removed'
      marker.dataset.readout = removal.readout
      marker.tabIndex = 0
      marker.setAttribute('aria-label', 'Removed params attribute')
      const tail = node.splitText(Math.max(0, removal.offset - offset))
      tail.before(marker)
      break
    }
  }
}

const idleReadout = (runtime) => runtime.join(' · ') || 'Focus or hover a highlighted rewrite to see what changed.'

export default function mount(root, { cleanup }) {
  const { source: seed } = JSON.parse(root.querySelector('[data-lr-seed]').textContent)
  const host = root.querySelector('[data-lr-source]')
  const out = root.querySelector('[data-lr-out]')
  const reset = root.querySelector('[data-lr-reset]')
  const readout = root.querySelector('[data-lr-readout]')
  let editor = null
  let run = 0
  let disposed = false
  let idle = ''

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
      const rewrite = linkRewrite(result.program, source)
      const output = rewriteOutput(source, rewrite.edits)
      const html = await highlightedHtml(output.rewritten, 'ex-generated lr-output')
      if (ticket !== run || disposed) return
      out.innerHTML = html
      markRanges(out, output.ranges, 'lr-change')
      markRemovals(out, output.removals)
      out.querySelector('.lr-output')?.setAttribute('data-lr-generated', '')
      idle = idleReadout(rewrite.runtime)
      readout.textContent = idle
      const rewritten = output.ranges.length
      plainStatus(root, `${plural(rewritten, 'link')} rewritten, ${rewrite.runtime.length} left for the runtime`, result.ms)
      root.dataset.widgetState = 'ready'
      root.dataset.rewritten = String(rewritten)
      root.dataset.runtime = String(rewrite.runtime.length)
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

  bindMarkedReadout(out, readout, '')
  out.addEventListener('mouseleave', () => {
    if (!out.contains(document.activeElement)) readout.textContent = idle
  })

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
