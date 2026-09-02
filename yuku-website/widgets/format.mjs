export const className = 'explorer ex-figure'

const OPTIONS = { lang: 'tsx', sourceType: 'module', attachComments: true }
const PRETTY = { format: 'pretty', indent: 2, quotes: 'double' }

export default async function render({ fence, ctx }) {
  if (!fence || fence.lang !== 'tsrx') throw new Error('format needs a ```tsrx fence right after its marker')
  const pretty = await ctx.generate(fence.code, OPTIONS, PRETTY)
  const compact = await ctx.generate(fence.code, OPTIONS, { format: 'compact', minify: true })
  if (pretty.errors.length || compact.errors.length) throw new Error(`format: the fence does not generate: ${(pretty.errors[0] ?? compact.errors[0]).message}`)
  const bytes = new TextEncoder().encode(pretty.code).length
  const compactBytes = new TextEncoder().encode(compact.code).length
  const payload = JSON.stringify({ source: fence.code, prettyBytes: bytes, compactBytes }).replaceAll('<', '\\u003c')
  return `<div class="projection-map-panes">
    <div class="projection-map-pane"><h3>Editable TSRX</h3><div class="ex-source-host" data-fm-source>${fence.html}</div></div>
    <div class="projection-map-pane"><h3>Formatted source</h3><div class="ex-out" data-fm-out>${ctx.highlight(pretty.code, 'tsrx')}</div><p class="ex-call" data-fm-call><code>generate(program, { format: "pretty", indent: 2, quotes: "double" })</code></p><p class="ex-readout" data-fm-readout aria-live="polite">${bytes} bytes</p></div>
  </div>
  <div class="ex-controls ex-toolbar"><button type="button" role="switch" aria-checked="false" data-fm-minify>Minify</button></div>
  <figcaption class="ex-status" data-widget-status aria-live="polite">${bytes} bytes</figcaption>
  <script type="application/json" data-fm-seed>${payload}</script>`
}

export function markdown() {
  return 'On the site the shared editor prints this as pretty TSRX or a minified module.'
}
