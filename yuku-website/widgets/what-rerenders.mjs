import { rerenderModel } from '../assets/widgets/_what-rerenders.js'

export const className = 'explorer ex-figure'

const OPTIONS = { lang: 'tsx', sourceType: 'module' }

export default async function render({ fence, ctx }) {
  if (!fence || fence.lang !== 'tsrx') throw new Error('what-rerenders needs a ```tsrx fence right after its marker')
  const view = await ctx.analyze(fence.code, OPTIONS)
  const error = view.diagnostics.find((item) => item.severity === 'error')
  if (error) throw new Error(`what-rerenders: the fence does not analyze: ${error.message}`)
  const model = rerenderModel(view, fence.code)
  const selected = model.select(model.symbol('items'))
  if (selected.readout !== 'items feeds 4 places: total, label, the @for, item.title') {
    throw new Error(`what-rerenders: unexpected landing state: ${selected.readout}`)
  }
  const payload = JSON.stringify({ source: fence.code }).replaceAll('<', '\\u003c')
  return `<div class="projection-map-panes">
    <div class="projection-map-pane"><h3>Editable TSRX</h3><div class="ex-source-host" data-wr-source>${fence.html}</div></div>
    <div class="projection-map-pane"><h3>What changes</h3><div class="ex-out" data-wr-out>${ctx.highlight(fence.code, 'tsrx')}</div><p class="ex-readout" data-wr-readout aria-live="polite">${selected.readout}</p></div>
  </div>
  <div class="ex-controls ex-toolbar"></div>
  <figcaption class="ex-status" data-widget-status aria-live="polite">${selected.readout}</figcaption>
  <script type="application/json" data-wr-seed>${payload}</script>`
}

export function markdown() {
  return 'On the site, selecting an input or derived constant highlights every markup expression that depends on its symbol.'
}
