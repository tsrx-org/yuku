import { generate } from '@tsrx/yuku'
import { lowerProgram } from '../assets/widgets/_lower-to-tsx.js'

export const className = 'explorer ex-figure'

const OPTIONS = { lang: 'tsx', sourceType: 'module' }
const PRINT = { format: 'pretty', indent: 2 }

export default async function render({ fence, ctx }) {
  if (!fence || fence.lang !== 'tsrx') throw new Error('lower-to-tsx needs a ```tsrx fence right after its marker')
  const parsed = await ctx.parse(fence.code, OPTIONS)
  const error = parsed.diagnostics.find((item) => item.severity === 'error')
  if (error) throw new Error(`lower-to-tsx: the fence does not parse: ${error.message}`)
  const lowered = lowerProgram(parsed.program, fence.code)
  const printed = generate(lowered.program, PRINT)
  if (printed.errors.length) throw new Error(`lower-to-tsx: generate failed: ${printed.errors[0].message}`)
  const reparsed = await ctx.parse(printed.code, OPTIONS)
  const parseError = reparsed.diagnostics.find((item) => item.severity === 'error')
  if (parseError) throw new Error(`lower-to-tsx: output does not parse: ${parseError.message}`)
  if (lowered.constructs !== 3) throw new Error(`lower-to-tsx: expected 3 constructs, found ${lowered.constructs}`)
  const payload = JSON.stringify({ source: fence.code }).replaceAll('<', '\\u003c')
  return `<div class="projection-map-panes">
    <div class="projection-map-pane"><h3>Editable TSRX</h3><div class="ex-source-host" data-lt-source>${fence.html}</div></div>
    <div class="projection-map-pane"><h3>Plain TSX</h3><div class="ex-out" data-lt-out>${ctx.highlight(printed.code, 'tsx')}</div><p class="ex-readout" data-lt-readout aria-live="polite">3 constructs lowered</p><p class="ex-note lt-note" data-lt-note hidden></p></div>
  </div>
  <div class="ex-controls ex-toolbar"><button type="button" data-lt-reset hidden>Reset</button></div>
  <figcaption class="ex-status" data-widget-status aria-live="polite">output parses</figcaption>
  <script type="application/json" data-lt-seed>${payload}</script>`
}

export function markdown() {
  return 'On the site, editing the TSRX rewrites its control-flow nodes to plain TSX and proves the printed output parses.'
}
