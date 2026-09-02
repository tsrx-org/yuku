export const className = 'explorer ex-figure'

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
          edits.push({ start: href.value.start, end: href.value.end, replacement: JSON.stringify(rewritten) })
          edits.push({ ...removalSpan(node.attributes, paramsIndex), replacement: '', removed: true })
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

function rewrittenHtml(source, edits, escapeHtml) {
  let html = ''
  let offset = 0
  for (const edit of edits) {
    html += escapeHtml(source.slice(offset, edit.start))
    if (edit.removed) {
      html += '<mark class="lr-change lr-removed" tabindex="0" data-readout="Removed the params attribute after resolving its literals." aria-label="Removed params attribute"></mark>'
    } else {
      html += `<mark class="lr-change" tabindex="0" data-readout="Resolved the path with literal parameters.">${escapeHtml(edit.replacement)}</mark>`
    }
    offset = edit.end
  }
  html += escapeHtml(source.slice(offset))
  return `<pre class="ex-generated lr-output" data-lr-generated><code>${html}</code></pre>`
}

export default async function render({ attrs, fence, ctx }) {
  if (!fence || fence.lang !== 'tsrx') {
    throw new Error('link-rewrite needs a ```tsrx fence right after its marker')
  }
  const parsed = await ctx.parse(fence.code, PARSE_OPTIONS)
  const errors = parsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')
  if (errors.length > 0) throw new Error(`link-rewrite: the fence does not parse: ${errors[0].message}`)
  const rewrite = linkRewrite(parsed.program, fence.code)
  const expected = Number(attrs.rewritten ?? 1)
  const expectedRuntime = Number(attrs.runtime ?? 1)
  const rewritten = rewrite.edits.filter((edit) => !edit.removed).length
  if (rewritten !== expected || rewrite.runtime.length !== expectedRuntime) {
    throw new Error(`link-rewrite: expected ${expected} rewritten and ${expectedRuntime} runtime links but found ${rewritten} and ${rewrite.runtime.length}`)
  }
  const payload = JSON.stringify({ source: fence.code }).replaceAll('<', '\\u003c')
  const readout = rewrite.runtime.join(' · ')
  return `<div class="projection-map-panes lr-panes">
    <div class="projection-map-pane">
      <h3>Editable TSRX</h3>
      <div class="ex-source-host lr-source" data-lr-source>${fence.html}</div>
    </div>
    <div class="projection-map-pane">
      <h3>Rewritten source</h3>
      <div class="ex-out lr-out" data-lr-out>${rewrittenHtml(fence.code, rewrite.edits, ctx.escapeHtml)}</div>
      <p class="ex-readout" data-lr-readout aria-live="polite">${ctx.escapeHtml(readout)}</p>
    </div>
  </div>
  <div class="ex-controls ex-toolbar"><button type="button" data-lr-reset hidden>Reset source</button></div>
  <figcaption class="ex-status" data-widget-status aria-live="polite">${expected} link rewritten, ${expectedRuntime} left for the runtime</figcaption>
  <script type="application/json" data-lr-seed>${payload}</script>`
}

export function markdown() {
  return 'On the site this example is editable: literal parameters are substituted into `Link` paths at build time, while variable parameters are left for the runtime.'
}
