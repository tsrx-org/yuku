import { escapeHtml } from '../yuku-shared.js'
import { generate, ready } from '../yuku-wasm.js'
import { createLayeredEditor } from './_editor.js'
import { highlightedHtml } from './_shared.js'

const OPTIONS = { lang: 'tsx', sourceType: 'module', attachComments: true }
const bytes = (text) => new TextEncoder().encode(text).length

export default function mount(root, { cleanup }) {
  const { source: seed } = JSON.parse(root.querySelector('[data-fm-seed]').textContent)
  const host = root.querySelector('[data-fm-source]')
  const out = root.querySelector('[data-fm-out]')
  const call = root.querySelector('[data-fm-call] code')
  const readout = root.querySelector('[data-fm-readout]')
  const status = root.querySelector('[data-widget-status]')
  const toggle = root.querySelector('[data-fm-minify]')
  let source = seed
  let prettyBytes = 0
  let minify = false
  let editor
  let run = 0
  let disposed = false

  const print = async () => {
    const ticket = ++run
    const options = minify ? { format: 'compact', minify: true } : { format: 'pretty', indent: 2, quotes: 'double' }
    try {
      const result = await generate(source, OPTIONS, options)
      if (ticket !== run || disposed) return
      if (result.errors.length) throw new Error(result.errors[0].message)
      out.innerHTML = await highlightedHtml(result.code, 'ex-generated fm-output')
      if (ticket !== run || disposed) return
      out.querySelector('.ex-generated')?.setAttribute('data-fm-generated', '')
      const outputBytes = bytes(result.code)
      if (!minify) prettyBytes = outputBytes
      const message = minify ? `${prettyBytes} bytes → ${outputBytes} bytes` : `${outputBytes} bytes`
      readout.textContent = message
      status.textContent = message
      call.textContent = minify
        ? 'generate(program, { minify: true })'
        : 'generate(program, { format: "pretty", indent: 2, quotes: "double" })'
      root.dataset.bytes = String(outputBytes)
      root.dataset.widgetState = 'ready'
    } catch (error) {
      if (ticket !== run || disposed) return
      out.innerHTML = `<p class="ex-note ex-unavailable">generate failed: ${escapeHtml(error.message)}</p>`
      status.textContent = `generate failed: ${error.message}`
      root.dataset.widgetState = 'error'
    }
  }

  cleanup.push(() => { disposed = true; editor?.dispose() })
  toggle.addEventListener('click', () => { minify = !minify; toggle.setAttribute('aria-checked', String(minify)); print() })
  ready().then(() => {
    editor = createLayeredEditor({
      host,
      source: seed,
      render: (value) => highlightedHtml(value, 'ex-source ex-source-plain'),
      onChange(value) { source = value; print() },
      ariaLabel: 'Editable TSRX formatter source',
      rows: seed.split('\n').length,
    })
    return print()
  }).catch((error) => {
    status.textContent = `in-browser generator unavailable: ${error.message}`
    root.dataset.widgetState = 'unavailable'
  })
}
