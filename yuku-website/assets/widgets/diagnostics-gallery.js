// Runtime half of yuku-website/widgets/diagnostics-gallery.mjs: each input is parsed
// in this tab and drawn with the underline and message the engine returned.
import { escapeHtml } from '../yuku-shared.js'
import { parse, ready } from '../yuku-wasm.js'
import { highlightedHtml, plainStatus } from './_shared.js'
import { diagnosticRanges, markRanges } from './_source-pane.js'

export default function mount(root) {
  const cases = JSON.parse(root.querySelector('[data-dg-payload]').textContent)
  const status = root.querySelector('[data-widget-status]')
  const sourceHost = root.querySelector('[data-dg-source]')
  const readout = root.querySelector('[data-dg-readout]')
  const toggle = root.querySelector('[data-dg-loose]')
  let selected = cases[0]
  let currentDiagnostics = []
  let run = 0
  const say = (text) => {
    if (status) status.textContent = text
  }

  function showDiagnostic(index = 0) {
    const diagnostic = currentDiagnostics[index]
    if (!diagnostic) {
      readout.innerHTML = '<p class="dg-clean">0 diagnostics</p>'
      return
    }
    readout.innerHTML = `<p><code class="wd-severity wd-${diagnostic.severity === 'error' ? 'error' : 'warning'}" data-dg-severity>${escapeHtml(diagnostic.severity)}</code> <span class="dg-message" data-dg-message>${escapeHtml(diagnostic.message)}</span><span class="wd-help" data-dg-help>help: ${escapeHtml(diagnostic.help ?? 'none')}</span></p>`
  }

  async function runCase(item, loose = false) {
    const thisRun = ++run
    const result = await parse(item.source, {
      lang: 'tsx',
      sourceType: 'module',
      semanticErrors: item.semanticErrors,
      loose,
    })
    if (thisRun !== run) return result
    const sourceHtml = await highlightedHtml(item.source, 'ex-source ex-source-plain wd-source')
    if (thisRun !== run) return result
    sourceHost.innerHTML = sourceHtml
    const ranges = result.diagnostics.flatMap((diagnostic, index) =>
      diagnosticRanges(item.source, [diagnostic]).map((range) => ({ ...range, readout: String(index) })),
    )
    markRanges(sourceHost, ranges, 'wd-diag')
    currentDiagnostics = result.diagnostics
    showDiagnostic()
    plainStatus(root, `${item.label}: ${result.diagnostics.length} ${result.diagnostics.length === 1 ? 'diagnostic' : 'diagnostics'}.`, result.ms)
    return result
  }

  root.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-dg-case]')
    if (chip) selectCase(chip.dataset.dgCase)
    const switchButton = event.target.closest('[data-dg-loose]')
    if (!switchButton) return
    const loose = switchButton.getAttribute('aria-checked') !== 'true'
    switchButton.setAttribute('aria-checked', String(loose))
    runCase(selected, loose).catch((error) => say(`parse failed: ${error.message}`))
  })

  sourceHost.addEventListener('mouseover', (event) => showFromUnderline(event.target))
  sourceHost.addEventListener('focusin', (event) => showFromUnderline(event.target))
  sourceHost.addEventListener('click', (event) => showFromUnderline(event.target))

  function showFromUnderline(target) {
    const underline = target.closest?.('[data-readout]')
    if (underline) showDiagnostic(Number(underline.dataset.readout.split(' ')[0]))
  }

  function selectCase(id) {
    const item = cases.find((candidate) => candidate.id === id)
    if (!item || item === selected) return
    selected = item
    for (const chip of root.querySelectorAll('[data-dg-case]')) {
      const active = chip.dataset.dgCase === id
      chip.setAttribute('aria-selected', String(active))
      chip.tabIndex = active ? 0 : -1
    }
    toggle.hidden = !item.loose
    toggle.setAttribute('aria-checked', 'false')
    runCase(item).catch((error) => say(`parse failed: ${error.message}`))
  }

  ready()
    .then(async () => {
      await runCase(selected)
      root.dataset.widgetState = 'ready'
    })
    .catch((error) => {
      say(`in-browser parser unavailable: ${error.message}`)
      root.dataset.widgetState = 'unavailable'
    })
}
