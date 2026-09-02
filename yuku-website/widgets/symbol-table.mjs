// Renders a source readout or the full semantic tables.

export const className = 'explorer ex-figure'

const TABLES = ['reference', 'symbol', 'scope', 'import', 'export']

function expectedUnresolved(attrs) {
  return (attrs.unresolved ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
}

const TAB_LABELS = { reference: 'References', symbol: 'Symbols', scope: 'Scopes', import: 'Imports', export: 'Exports' }

export default async function render({ attrs, fence, ctx }) {
  if (!fence || fence.lang !== 'tsrx') {
    throw new Error('symbol-table needs a ```tsrx fence right after its marker')
  }
  const view = await ctx.analyze(fence.code, { lang: 'tsx', sourceType: 'module' })
  const errors = view.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')
  if (errors.length > 0) {
    throw new Error(`symbol-table: the fence does not analyze clean: ${errors[0].message}`)
  }
  const semantic = view.semantic
  const unresolved = []
  for (let i = 0; i < semantic.reference.count; i++) {
    if (attrs.mode === 'runtime' && semantic.reference.inTypePosition(i)) continue
    if (semantic.reference.symbolId(i) === null) unresolved.push(semantic.reference.name(i))
  }
  const expected = expectedUnresolved(attrs)
  if (expected.join(',') !== unresolved.join(',')) {
    throw new Error(
      `symbol-table: expected the unresolved references [${expected.join(', ')}] but the analyzer reports [${unresolved.join(', ')}]`,
    )
  }
  const readout = attrs.mode === 'readout'
  const payload = JSON.stringify({ source: fence.code, unresolved, mode: attrs.mode ?? 'all' }).replaceAll(
    '<',
    '\\u003c',
  )
  if (readout) {
    const landingName = unresolved[0] ?? 'name'
    return `<div class="projection-map-pane">
      <h3>Source</h3>
      <div class="ex-source-host" data-st-source>${fence.html}</div>
      <p class="st-readout" data-st-readout aria-live="polite">${landingName}: no declaration in this file, symbolId is null</p>
      <p class="ex-call"><code>analyze(source, "Cart.tsrx").semantic</code></p>
    </div>
  <div class="ex-controls ex-toolbar st-readout-toolbar"><button type="button" data-st-reset hidden>Reset source</button></div>
  <figcaption class="ex-status" data-widget-status aria-live="polite">the analyzer runs in your browser when this widget scrolls into view; with JavaScript off this stays the listing above</figcaption>
  <script type="application/json" data-st-seed>${payload}</script>`
  }
  const counts = Object.fromEntries(TABLES.map((name) => [name, semantic[name].count]))
  if (attrs.mode === 'runtime') {
    counts.reference = 0
    for (let i = 0; i < semantic.reference.count; i++) {
      if (!semantic.reference.inTypePosition(i)) counts.reference++
    }
  }
  const tabs = TABLES.map(
    (name, index) =>
      `<button type="button" role="tab" data-st-tab="${name}" aria-selected="${index === 0}" aria-controls="st-table" tabindex="${index === 0 ? '0' : '-1'}">${TAB_LABELS[name]} <span class="st-count" data-st-count="${name}">${counts[name]}</span></button>`,
  ).join('')
  return `<div class="projection-map-panes">
    <div class="projection-map-pane">
      <h3>Source</h3>
      <div class="ex-source-host" data-st-source>${fence.html}</div>
      <p class="st-readout" data-st-readout aria-live="polite">Focus or hover a token to read its scope and symbol.</p>
    </div>
    <div class="projection-map-pane">
      <h3>semantic</h3>
      <div class="ex-out" id="st-table" role="tabpanel" data-st-out><p class="ex-note">The analyzer runs when this widget scrolls into view.</p></div>
    </div>
  </div>
  <div class="ex-controls ex-toolbar">
    <div class="st-tabs" role="tablist" aria-label="Semantic tables" data-st-tabs>${tabs}</div>
    <button type="button" data-st-reset hidden>Reset source</button>
  </div>
  <figcaption class="ex-status" data-widget-status aria-live="polite">the analyzer runs in your browser when this widget scrolls into view; with JavaScript off this stays the listing above</figcaption>
  <script type="application/json" data-st-seed>${payload}</script>`
}

export function markdown({ attrs }) {
  const names = expectedUnresolved(attrs)
  if (attrs.mode === 'readout') return `On the site the source marks ${names.map((name) => `\`${name}\``).join(', ')} as unresolved and reads declarations in place.`
  return `On the site this example is interactive: the analyzer runs in your browser, the five \`SemanticView\` tables are one chip each, hovering a token shows the scope \`nodeScope\` files it under, and the reference${names.length === 1 ? '' : 's'} ${names.map((name) => `\`${name}\``).join(', ')} ${names.length === 1 ? 'is' : 'are'} shown resolving to nothing.`
}
