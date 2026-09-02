// Runtime half of docs/widgets/options-strip.mjs. Every number and message
// printed here comes from `parse` running in this tab with the options the
// chips currently show.
import { escapeHtml, formatMs, plural } from '../yuku-shared.js'
import { parse, ready } from '../yuku-wasm.js'
import { createLayeredEditor } from './_editor.js'
import { diagnosticsHtml, highlightedHtml, plainStatus, walkNodes } from './_shared.js'
import { bindMarkedReadout, diagnosticRanges, markRanges } from './_source-pane.js'

const DEFAULTS = { lang: 'tsx', loose: false, semanticErrors: false, attachComments: false }

function callText(options) {
  const parts = [`lang: "${options.lang}"`]
  for (const flag of ['loose', 'semanticErrors', 'attachComments']) {
    if (options[flag]) parts.push(`${flag}: true`)
  }
  return `parse(source, { ${parts.join(', ')} })`
}

function attachedCount(program) {
  let count = 0
  const visit = (value) => {
    if (value === null || typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (typeof value.type === 'string' && Array.isArray(value.comments)) count += 1
    for (const [key, child] of Object.entries(value)) if (key !== 'comments') visit(child)
  }
  visit(program)
  return count
}

function resultHtml(result, records, options) {
  const nodes = walkNodes(result.program)
  const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length
  const warnings = result.diagnostics.length - errors
  const body = result.program.body.map((node) => node.type)
  const found = records.filter((type) => nodes.some((node) => node.type === type))
  const attached = attachedCount(result.program)
  return `<dl class="os-stats">
    <div><dt>nodes</dt><dd>${result.nodeCount}</dd></div>
    <div><dt>diagnostics</dt><dd>${result.diagnostics.length}${result.diagnostics.length ? ` <span class="os-split">(${plural(errors, 'error')}, ${plural(warnings, 'warning')})</span>` : ''}</dd></div>
    <div><dt>comments</dt><dd>${result.comments.length}${options.attachComments ? ` <span class="os-split">(${plural(attached, 'node')} carrying them)</span>` : ''}</dd></div>
    <div><dt>time</dt><dd>${formatMs(result.ms)} ms</dd></div>
  </dl>
  <p class="os-body"><code>program.body</code>: ${body.length ? body.map((type) => `<code>${escapeHtml(type)}</code>`).join(', ') : '<em>empty</em>'}</p>
  <p class="node-chips" data-os-chips>${
    found.length
      ? found.map((type) => `<span class="node-chip" tabindex="0" data-readout="${escapeHtml(`${type} is present in the parsed tree.`)}"><code>${escapeHtml(type)}</code></span>`).join('')
      : '<span class="node-chip node-chip-plain">no TSRX-only nodes</span>'
  }</p>
  ${diagnosticsHtml(result.diagnostics)}`
}

export default function mount(root, { cleanup }) {
  const { seed, broken, records } = JSON.parse(root.querySelector('[data-os-payload]').textContent)
  const host = root.querySelector('[data-os-source]')
  const out = root.querySelector('[data-os-out]')
  const call = root.querySelector('[data-os-call]')
  const status = root.querySelector('[data-widget-status]')
  const controls = root.querySelector('[data-os-controls]')
  const readout = root.querySelector('[data-os-readout]')
  const reset = root.querySelector('[data-os-reset]')
  const options = { ...DEFAULTS }
  let source = seed
  let editor = null
  let run = 0
  let lastDiagnostics = []

  const say = (text) => {
    if (status) status.textContent = text
  }

  const pressChips = () => {
    for (const chip of controls.querySelectorAll('[data-os-lang]')) {
      chip.setAttribute('aria-pressed', String(chip.dataset.osLang === options.lang))
    }
    for (const chip of controls.querySelectorAll('[data-os-flag]')) {
      chip.setAttribute('aria-checked', String(Boolean(options[chip.dataset.osFlag])))
    }
    const breakChip = controls.querySelector('[data-os-break]')
    breakChip.textContent = source === broken ? 'Restore working example' : 'Show broken example'
    reset.hidden = source === seed && Object.entries(DEFAULTS).every(([key, value]) => options[key] === value)
    call.textContent = callText(options)
  }

  async function reparse() {
    const ticket = ++run
    let result
    try {
      result = await parse(source, { ...options, sourceType: 'module' })
    } catch (error) {
      if (ticket !== run) return
      out.innerHTML = `<p class="ex-note ex-unavailable">parse failed: ${escapeHtml(error.message)}</p>`
      say(`parse failed: ${error.message}`)
      root.dataset.widgetState = 'error'
      return
    }
    if (ticket !== run) return
    lastDiagnostics = result.diagnostics
    out.innerHTML = resultHtml(result, records, options)
    await editor.render()
    const sentence = result.diagnostics.length
      ? `${plural(result.diagnostics.length, 'diagnostic')} shown in the source.`
      : `${plural(result.nodeCount, 'node')} parsed with no diagnostics.`
    plainStatus(root, sentence, result.ms)
    root.dataset.widgetState = 'ready'
  }

  const setSource = async (next) => {
    source = next
    lastDiagnostics = []
    await editor.setValue(source)
    pressChips()
    reparse()
  }

  controls.addEventListener('click', (event) => {
    const lang = event.target.closest('[data-os-lang]')
    if (lang) {
      options.lang = lang.dataset.osLang
      pressChips()
      reparse()
      return
    }
    const flag = event.target.closest('[data-os-flag]')
    if (flag) {
      options[flag.dataset.osFlag] = !options[flag.dataset.osFlag]
      pressChips()
      reparse()
      return
    }
    if (event.target.closest('[data-os-break]')) setSource(source === broken ? seed : broken)
  })

  cleanup.push(() => editor?.dispose())
  bindMarkedReadout(host, readout, 'Focus or hover an underline to read the diagnostic.')
  bindMarkedReadout(out, readout, 'Focus or hover an underline or node type to read it.')

  ready()
    .then(() => {
      editor = createLayeredEditor({
        host,
        source,
        render: (value) => highlightedHtml(value, 'ex-source ex-source-plain wd-source'),
        afterRender(mirror) {
          markRanges(mirror, diagnosticRanges(source, lastDiagnostics), 'wd-diag')
        },
        onChange(value) {
          source = value
          pressChips()
          reparse()
        },
        ariaLabel: 'Editable parser source',
        rows: Math.min(Math.max(seed.split('\n').length, 6), 30),
      })
      reset.addEventListener('click', () => {
        Object.assign(options, DEFAULTS)
        setSource(seed)
      })
      pressChips()
      return reparse()
    })
    .catch((error) => {
      out.innerHTML = `<p class="ex-note ex-unavailable">in-browser parser unavailable: ${escapeHtml(error.message)}</p>`
      say(`in-browser parser unavailable: ${error.message}`)
      root.dataset.widgetState = 'unavailable'
    })
}
