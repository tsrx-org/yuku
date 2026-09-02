// `<!-- widget:visitor type="JSXIfExpression" -->` followed by a ```tsrx fence.
// The fence is parsed here so the landing type is proven to occur in it; the
// select is filled from the tree the parser produces in the reader's tab.

export const className = 'explorer ex-figure'

const isNode = (value) =>
  value !== null && typeof value === 'object' && typeof value.type === 'string' && typeof value.start === 'number'

function countTypes(program) {
  const counts = new Map()
  const visit = (node) => {
    counts.set(node.type, (counts.get(node.type) ?? 0) + 1)
    for (const [key, value] of Object.entries(node)) {
      if (key === 'comments') continue
      if (Array.isArray(value)) {
        for (const child of value) if (isNode(child)) visit(child)
      } else if (isNode(value)) {
        visit(value)
      }
    }
  }
  visit(program)
  return counts
}

export default async function render({ attrs, fence, ctx }) {
  if (!fence || fence.lang !== 'tsrx') {
    throw new Error('visitor needs a ```tsrx fence right after its marker')
  }
  const landing = attrs.type ?? 'JSXIfExpression'
  const result = await ctx.parse(fence.code, { lang: 'tsx', sourceType: 'module' })
  const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')
  if (errors.length > 0) {
    throw new Error(`visitor: the fence does not parse: ${errors[0].message}`)
  }
  const counts = countTypes(result.program)
  if (!counts.has(landing)) {
    throw new Error(`visitor: the fence has no ${landing} node, so the landing state would show nothing`)
  }
  const payload = JSON.stringify({ source: fence.code, landing }).replaceAll('<', '\\u003c')
  return `<div class="projection-map-panes">
    <div class="projection-map-pane">
      <h3>Source</h3>
      <div class="ex-source-host" data-vi-source>${fence.html}</div>
      <p class="ex-readout" data-vi-readout aria-live="polite">Focus or hover a match to read its node type and span.</p>
    </div>
    <div class="projection-map-pane">
      <h3>Visitor</h3>
      <div class="ex-out" data-vi-out><p class="ex-note">The parser runs when this widget scrolls into view.</p></div>
    </div>
  </div>
  <div class="ex-controls ex-toolbar vi-controls">
    <label class="vi-pick"><span class="ex-chip-label">Highlight node type</span>
      <select data-vi-type aria-label="Node type to highlight" disabled><option>${ctx.escapeHtml(landing)}</option></select>
    </label>
    <button type="button" data-vi-reset hidden>Reset source</button>
  </div>
  <figcaption class="ex-status" data-widget-status aria-live="polite">the parser runs in your browser when this widget scrolls into view; with JavaScript off this stays the listing above</figcaption>
  <script type="application/json" data-vi-seed>${payload}</script>`
}

export function markdown({ attrs }) {
  return `On the site this example is interactive: a select lists every node type the parser found in your browser, and picking one lights up each node of that type in the source (it lands on \`${attrs.type ?? 'JSXIfExpression'}\`).`
}
