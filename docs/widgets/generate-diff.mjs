// `<!-- widget:generate-diff -->` followed by a ```tsrx fence. The source is
// printed as written on A; B is the only configurable output. `full` adds the
// long-form B controls used by the generate guide.

export const className = 'explorer ex-figure'

export const LANDING = {
  a: {},
  b: { strip: true },
}

const PARSE_OPTIONS = { lang: 'tsx', sourceType: 'module', attachComments: true }

function landingOptions(attrs) {
  const landing = { a: { ...LANDING.a }, b: { ...LANDING.b } }
  for (const name of ['strip', 'minify', 'format', 'quotes', 'comments', 'indent']) {
    const value = attrs[`b-${name}`]
    if (value === undefined) continue
    landing.b[name] = ['strip', 'minify'].includes(name)
      ? value === 'true'
      : name === 'indent'
        ? Number(value)
        : value
  }
  return landing
}

export default async function render({ attrs, fence, ctx }) {
  if (!fence || fence.lang !== 'tsrx') {
    throw new Error('generate-diff needs a ```tsrx fence right after its marker')
  }
  const parsed = await ctx.parse(fence.code, PARSE_OPTIONS)
  const errors = parsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')
  if (errors.length > 0) {
    throw new Error(`generate-diff: the fence does not parse: ${errors[0].message}`)
  }
  const landing = landingOptions(attrs)
  const a = await ctx.generate(fence.code, PARSE_OPTIONS, landing.a)
  const b = await ctx.generate(fence.code, PARSE_OPTIONS, landing.b)
  if (a.errors.length || b.errors.length) {
    throw new Error(`generate-diff: the generator reported ${(a.errors[0] ?? b.errors[0]).message}`)
  }
  if (a.code === b.code) {
    throw new Error('generate-diff: the two landing option sets print the same text, so there is no diff to land on')
  }
  const payload = JSON.stringify({ source: fence.code, landing, full: attrs.full === 'true' }).replaceAll('<', '\\u003c')
  const side = (id, label) => `<div class="projection-map-pane gd-side" data-gd-side="${id}">
      <h3>${label}</h3>
      <div class="ex-out" data-gd-out="${id}"><p class="ex-note">The generator runs when this widget scrolls into view.</p></div>
      <p class="ex-call" data-gd-call="${id}"></p>
    </div>`
  return `<div class="projection-map-pane gd-source-pane"><h3>Source</h3><div class="ex-source-host gd-seed" data-gd-source>${fence.html}</div></div>
  <div class="projection-map-panes">
    ${side('a', 'As written')}
    ${side('b', 'Output B')}
  </div>
  <div class="gd-diff-host">
    <h3>Diff, A to B</h3>
    <div class="ex-out" data-gd-diff></div>
    <p class="ex-readout" data-gd-readout aria-live="polite">Focus or hover a changed line to read the difference.</p>
  </div>
  <div class="ex-controls ex-toolbar gd-toolbar">
    <div class="gd-controls" data-gd-controls="b" aria-label="Output B options"></div>
    <button type="button" data-gd-reset hidden>Reset source</button>
  </div>
  ${attrs.full === 'true' ? `<details class="gd-more"><summary>More options</summary><div class="ex-controls gd-advanced" data-gd-advanced aria-label="More output B options"></div></details>` : ''}
  <figcaption class="ex-status" data-widget-status aria-live="polite">the generator runs in your browser when this widget scrolls into view; with JavaScript off this stays the listing above</figcaption>
  <script type="application/json" data-gd-seed>${payload}</script>`
}

export function markdown() {
  return 'On the site this example is interactive: A prints the source with the generator defaults, B applies the selected options, and a line diff shows what changed.'
}
