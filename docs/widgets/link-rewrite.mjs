export const className = 'explorer ex-figure'

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

function rewrittenHtml(source, edits, escapeHtml) {
  let html = ''
  let offset = 0
  for (const edit of edits) {
    html += escapeHtml(source.slice(offset, edit.start))
    html += `<mark class="lr-change">${escapeHtml(edit.replacement)}</mark>`
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
  const edits = linkEdits(parsed.program, fence.code)
  const expected = Number(attrs.rewritten ?? 2)
  if (edits.length !== expected) {
    throw new Error(`link-rewrite: expected ${expected} rewritten links but found ${edits.length}`)
  }
  const payload = JSON.stringify({ source: fence.code, expected }).replaceAll('<', '\\u003c')
  return `<div class="projection-map-panes lr-panes">
    <div class="projection-map-pane">
      <h3>Editable TSRX</h3>
      <div class="ex-source-host lr-source" data-lr-source>${fence.html}</div>
    </div>
    <div class="projection-map-pane">
      <h3>Rewritten source</h3>
      <div class="ex-out lr-out" data-lr-out>${rewrittenHtml(fence.code, edits, ctx.escapeHtml)}</div>
      <p class="ex-readout" data-lr-readout aria-live="polite">Focus or hover a highlighted rewrite to see what changed.</p>
    </div>
  </div>
  <div class="ex-controls ex-toolbar"><button type="button" data-lr-reset hidden>Reset source</button></div>
  <figcaption class="ex-status" data-widget-status aria-live="polite">the parser runs in your browser when this widget scrolls into view; with JavaScript off this stays on the seeded rewrite</figcaption>
  <script type="application/json" data-lr-seed>${payload}</script>`
}

export function markdown() {
  return 'On the site this example is editable: each change is parsed in your browser, parameterized `Link` paths become `url(path, params)` calls, and changed spans are highlighted.'
}
