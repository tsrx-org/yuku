// Runtime half of docs/widgets/diagnostics-gallery.mjs: each input is parsed
// in this tab and drawn with the underline and message the engine returned.
import { escapeHtml, plural } from '../yuku-shared.js'
import { parse, ready } from '../yuku-wasm.js'
import { diagnosticsHtml, highlightedHtml, plainStatus } from './_shared.js'
import { bindMarkedReadout, diagnosticRanges, markRanges } from './_source-pane.js'

export default function mount(root) {
  const cases = JSON.parse(root.querySelector('[data-dg-payload]').textContent)
  const status = root.querySelector('[data-widget-status]')
  const say = (text) => {
    if (status) status.textContent = text
  }

  async function runCase(item, loose) {
    const li = root.querySelector(`[data-dg-case="${item.id}"]`)
    const sourceHost = li.querySelector('[data-dg-source]')
    const resultHost = li.querySelector('[data-dg-result]')
    const result = await parse(item.source, {
      lang: 'tsx',
      sourceType: 'module',
      semanticErrors: item.semanticErrors,
      loose,
    })
    sourceHost.innerHTML = await highlightedHtml(item.source, 'ex-source ex-source-plain wd-source')
    markRanges(sourceHost, diagnosticRanges(item.source, result.diagnostics), 'wd-diag')
    const body = result.program.body.map((node) => `<code>${escapeHtml(node.type)}</code>`).join(', ')
    resultHost.innerHTML = result.diagnostics.length
      ? diagnosticsHtml(result.diagnostics)
      : `<p class="dg-clean">0 diagnostics · <code>program.body</code>: ${body || '<em>empty</em>'}</p>`
    return result
  }

  root.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-dg-loose]')
    if (!toggle) return
    const item = cases.find((candidate) => candidate.loose)
    const loose = toggle.getAttribute('aria-checked') !== 'true'
    toggle.setAttribute('aria-checked', String(loose))
    runCase(item, loose).catch((error) => say(`parse failed: ${error.message}`))
  })

  ready()
    .then(async () => {
      let errors = 0
      let warnings = 0
      let ms = 0
      for (const item of cases) {
        const result = await runCase(item, false)
        ms += result.ms
        for (const diagnostic of result.diagnostics) {
          if (diagnostic.severity === 'error') errors += 1
          else warnings += 1
        }
      }
      for (const li of root.querySelectorAll('[data-dg-case]')) {
        bindMarkedReadout(
          li.querySelector('[data-dg-source]'),
          li.querySelector('[data-dg-readout]'),
          'Focus or hover the underline to read this diagnostic.',
        )
      }
      root.querySelector('[data-dg-loose]').hidden = false
      plainStatus(root, `${plural(errors, 'error')} and ${plural(warnings, 'warning')} shown across the gallery.`, ms)
      root.dataset.widgetState = 'ready'
    })
    .catch((error) => {
      say(`in-browser parser unavailable: ${error.message}`)
      root.dataset.widgetState = 'unavailable'
    })
}
